import type { ProviderFile } from './provider-config';
import { estimateTokens } from '@ai-reading-partner/core';
import type { RunBudget } from './run-budget';

export type ModelTier = 'light' | 'strong';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
}

export interface CompletionRequest {
  tier: ModelTier;
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  toolChoice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  retries?: number;
  signal?: AbortSignal;
  onToolCalls?: (calls: ToolCall[]) => void;
}

export function estimateMessageTokens(messages: ChatMessage[], tools?: ToolDefinition[]): number {
  return 3 + messages.reduce((sum, message) => sum + estimateTokens(JSON.stringify(message)) + 8, 0)
    + (tools?.length ? estimateTokens(JSON.stringify(tools)) : 0);
}

export interface CompletionUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface CompletionResult {
  content: string;
  toolCalls: ToolCall[];
  finishReason: string | null;
  usage: CompletionUsage;
  model: string;
  providerId: string;
  usageEstimated?: boolean;
}

export interface ModelClientError {
  code: 'unconfigured' | 'timeout' | 'rate_limit' | 'provider_error' | 'network' | 'invalid_response';
  message: string;
  statusCode?: number;
}

export class ModelRequestError extends Error {
  readonly code: ModelClientError['code'];
  readonly statusCode?: number;
  readonly retryable: boolean;

  constructor(error: Omit<ModelClientError, 'retryable'>) {
    super(error.message);
    this.name = 'ModelRequestError';
    this.code = error.code;
    this.statusCode = error.statusCode;
    this.retryable =
      error.code === 'timeout' ||
      error.code === 'rate_limit' ||
      error.code === 'network' ||
      (error.statusCode !== undefined && [408, 409, 500, 502, 503, 504].includes(error.statusCode));
  }
}

interface ChatCompletionChoice {
  message?: {
    role?: string;
    content?: string | null;
    tool_calls?: ToolCall[];
  };
  finish_reason?: string;
}

interface ChatCompletionResponse {
  model?: string;
  choices?: ChatCompletionChoice[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

export class ModelClient {
  constructor(private readonly config: ProviderFile, private readonly budget?: RunBudget) {}

  supportsNativeTools(tier: ModelTier): boolean {
    return this.config.models[tier].supports_tool_calling;
  }

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    request = this.withBudget(request);
    this.validateBudget(request);
    const modelConfig = this.config.models[request.tier];
    const provider = this.config.providers[modelConfig.provider];
    if (!provider) throw new ModelRequestError({ code: 'unconfigured', message: `Unknown provider: ${modelConfig.provider}` });

    const timeoutMs = request.timeoutMs ?? 120_000;
    const maxRetries = Math.min(request.retries ?? 1, 1);
    let attempt = 0;
    for (;;) {
      const attemptId = this.budget?.start(request);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(new Error('Model request timed out')), timeoutMs);
      const onRequestAbort = () => controller.abort(new Error('Model request aborted'));
      request.signal?.addEventListener('abort', onRequestAbort, { once: true });
      if (request.signal?.aborted) onRequestAbort();
      try {
        const response = await fetch(buildChatCompletionsUrl(provider.base_url), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${provider.api_key}`,
          },
          body: JSON.stringify({
            model: modelConfig.model,
            messages: request.messages,
            temperature: request.temperature ?? 0.2,
            max_tokens: request.maxTokens ?? 1200,
            tools: request.tools && request.tools.length > 0 ? request.tools : undefined,
            tool_choice: request.tools?.length ? request.toolChoice : undefined,
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const body = await response.text().catch(() => '');
          const code = response.status === 429 ? 'rate_limit' : 'provider_error';
          const message = normalizeProviderMessage(response.status, body);
          throw new ModelRequestError({ code, message, statusCode: response.status });
        }

        const payload = (await response.json()) as ChatCompletionResponse;
        const choice = payload.choices?.[0];
        if (!choice) {
          throw new ModelRequestError({ code: 'invalid_response', message: 'Provider returned no choices' });
        }
        const reported = typeof payload.usage?.prompt_tokens === 'number' && typeof payload.usage?.completion_tokens === 'number';
        const usage = {
          prompt_tokens: payload.usage?.prompt_tokens ?? estimateMessageTokens(request.messages, request.tools),
          completion_tokens: payload.usage?.completion_tokens ?? estimateTokens(choice.message?.content ?? JSON.stringify(choice.message?.tool_calls ?? [])),
          total_tokens: 0,
        };
        usage.total_tokens = usage.prompt_tokens + usage.completion_tokens;
        if (attemptId !== undefined) this.budget?.finish(attemptId, (choice.message?.content ?? '') + (choice.message?.tool_calls?.length ? JSON.stringify(choice.message.tool_calls) : ''), usage, reported);
        if (choice.finish_reason === 'length') throw new ModelRequestError({ code: 'invalid_response', message: 'Model output budget exhausted before completion' });
        return {
          content: choice.message?.content ?? '',
          toolCalls: choice.message?.tool_calls ?? [],
          finishReason: choice.finish_reason ?? null,
          usage,
          model: payload.model ?? modelConfig.model,
          providerId: modelConfig.provider,
          usageEstimated: !reported,
        };
      } catch (error) {
        const normalized = error instanceof ModelRequestError ? error : normalizeNetworkError(error);
        if (normalized.retryable && attempt < maxRetries && !request.signal?.aborted) {
          attempt += 1;
          await new Promise((resolve) => setTimeout(resolve, Math.min(1000 * 2 ** attempt, 5000)));
          continue;
        }
        throw normalized;
      } finally {
        clearTimeout(timer);
        request.signal?.removeEventListener('abort', onRequestAbort);
      }
    }
  }

  async *streamText(request: CompletionRequest): AsyncGenerator<string, void, void> {
    request = this.withBudget(request);
    this.validateBudget(request);
    const attemptId = this.budget?.start(request);
    let generated = '';
    let streamedUsage: CompletionUsage | undefined;
    const toolCalls = new Map<number, ToolCall>();
    const modelConfig = this.config.models[request.tier];
    const provider = this.config.providers[modelConfig.provider];
    if (!provider) throw new ModelRequestError({ code: 'unconfigured', message: `Unknown provider: ${modelConfig.provider}` });

    const timeoutMs = request.timeoutMs ?? 120_000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('Model request timed out')), timeoutMs);
    const onAbort = () => controller.abort(new Error('Model request aborted'));
    request.signal?.addEventListener('abort', onAbort, { once: true });
    if (request.signal?.aborted) onAbort();
    try {
      const response = await fetch(buildChatCompletionsUrl(provider.base_url), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${provider.api_key}`,
        },
        body: JSON.stringify({
          model: modelConfig.model,
          messages: request.messages,
          temperature: request.temperature ?? 0.2,
          max_tokens: request.maxTokens ?? 1200,
          stream: true,
          tools: request.tools?.length ? request.tools : undefined,
          tool_choice: request.tools?.length ? request.toolChoice : undefined,
        }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        const body = await response.text().catch(() => '');
        throw new ModelRequestError({
          code: response.status === 429 ? 'rate_limit' : 'provider_error',
          message: normalizeProviderMessage(response.status, body),
          statusCode: response.status,
        });
      }

      const decoder = new TextDecoder();
      let buffer = '';
      let finished = false;
      let outputLimited = false;
      for await (const chunk of response.body) {
        buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const data = trimmed.slice(5).trim();
          if (data === '[DONE]') {
            if (outputLimited) throw new ModelRequestError({ code: 'invalid_response', message: 'Model output budget exhausted before completion' });
            request.onToolCalls?.([...toolCalls.values()]); return;
          }
          try {
            const payload = JSON.parse(data) as {
              choices?: Array<{ delta?: { content?: string | null; tool_calls?: Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }> }; finish_reason?: string | null }>;
              usage?: CompletionUsage;
            };
            if (typeof payload.usage?.prompt_tokens === 'number' && typeof payload.usage.completion_tokens === 'number') streamedUsage = payload.usage;
            if (payload.choices?.[0]?.finish_reason) finished = true;
            if (payload.choices?.[0]?.finish_reason === 'length') outputLimited = true;
            for (const delta of payload.choices?.[0]?.delta?.tool_calls ?? []) {
              const call = toolCalls.get(delta.index) ?? { id: '', type: 'function' as const, function: { name: '', arguments: '' } };
              if (delta.id) call.id = delta.id;
              if (delta.function?.name) call.function.name += delta.function.name;
              if (delta.function?.arguments) call.function.arguments += delta.function.arguments;
              toolCalls.set(delta.index, call);
            }
            const text = payload.choices?.[0]?.delta?.content;
            if (text) { generated += text; yield text; }
          } catch {
            throw new ModelRequestError({ code: 'invalid_response', message: 'Invalid streaming response' });
          }
        }
      }
      if (buffer.trim() === 'data: [DONE]') finished = true;
      if (!finished) throw new ModelRequestError({ code: 'invalid_response', message: 'Stream interrupted before completion' });
      if (outputLimited) throw new ModelRequestError({ code: 'invalid_response', message: 'Model output budget exhausted before completion' });
      request.onToolCalls?.([...toolCalls.values()]);
    } finally {
      if (attemptId !== undefined) this.budget?.finish(attemptId, generated + (toolCalls.size ? JSON.stringify([...toolCalls.values()]) : ''), streamedUsage, Boolean(streamedUsage));
      clearTimeout(timer);
      request.signal?.removeEventListener('abort', onAbort);
    }
  }

  private withBudget(request: CompletionRequest): CompletionRequest {
    if (!this.budget) return request;
    return { ...request, timeoutMs: Math.min(request.timeoutMs ?? 120000, this.budget.remainingMs),
      signal: request.signal ? AbortSignal.any([request.signal, this.budget.signal]) : this.budget.signal };
  }

  private validateBudget(request: CompletionRequest): void {
    request.signal?.throwIfAborted();
    const estimate = estimateMessageTokens(request.messages, request.tools);
    if (estimate + (request.maxTokens ?? 1200) + 512 > this.config.models[request.tier].context_window) {
      throw new ModelRequestError({ code: 'invalid_response', message: 'Request exceeds model context budget' });
    }
  }
}

function buildChatCompletionsUrl(baseUrl: string): string {
  return new URL('chat/completions', baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).toString();
}

function normalizeProviderMessage(statusCode: number, body: string): string {
  const streamUnsupported = [400, 422, 501].includes(statusCode)
    && /stream/iu.test(body) && /not supported|unsupported|not implemented/iu.test(body);
  return `Model provider returned HTTP ${statusCode}${streamUnsupported ? ': streaming unsupported' : ''}`;
}

function normalizeNetworkError(error: unknown): ModelRequestError {
  if (error instanceof Error) {
    if (error.name === 'AbortError' || error.message.includes('timed out')) {
      return new ModelRequestError({ code: 'timeout', message: error.message });
    }
    return new ModelRequestError({ code: 'network', message: error.message });
  }
  return new ModelRequestError({ code: 'network', message: String(error) });
}
