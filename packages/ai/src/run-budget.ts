import { estimateTokens } from '@ai-reading-partner/core';
import { estimateMessageTokens, type CompletionRequest, type CompletionUsage } from './model-client';

export interface BudgetLimits {
  timeoutMs?: number;
  maxModelCalls?: number;
  maxToolCalls?: number;
  maxTokens?: number;
}

export class RunBudget {
  readonly deadline: number;
  readonly signal: AbortSignal;
  readonly calls: Array<{ input: number; output: number; status: 'reserved' | 'reported' | 'estimated' }> = [];
  toolCalls = 0;
  private readonly controller = new AbortController();
  private readonly timer: ReturnType<typeof setTimeout>;

  constructor(readonly limits: BudgetLimits = {}, signal?: AbortSignal) {
    this.deadline = Date.now() + (limits.timeoutMs ?? 180_000);
    this.signal = signal ? AbortSignal.any([signal, this.controller.signal]) : this.controller.signal;
    this.timer = setTimeout(() => this.controller.abort(new Error('请求超时')), this.remainingMs);
    this.timer.unref?.();
  }

  get remainingMs() { return Math.max(0, this.deadline - Date.now()); }
  get usedTokens() { return this.calls.reduce((total, call) => total + call.input + call.output, 0); }
  get remainingTokens() { return Math.max(0, (this.limits.maxTokens ?? 24000) - this.usedTokens); }

  start(request: CompletionRequest): number {
    this.signal.throwIfAborted();
    const input = estimateMessageTokens(request.messages, request.tools);
    const output = request.maxTokens ?? 1200;
    if (this.calls.length >= (this.limits.maxModelCalls ?? 12) || input + output > this.remainingTokens) {
      throw new Error('请求调用或 token 预算已耗尽');
    }
    this.calls.push({ input, output, status: 'reserved' });
    return this.calls.length - 1;
  }

  finish(id: number, content: string, usage?: CompletionUsage, reported = false) {
    const call = this.calls[id];
    if (!call || call.status !== 'reserved') return;
    this.calls[id] = {
      input: reported && usage ? usage.prompt_tokens : call.input,
      output: reported && usage ? usage.completion_tokens : content ? estimateTokens(content) : call.output,
      status: reported ? 'reported' : 'estimated',
    };
  }

  tool() {
    this.signal.throwIfAborted();
    if (this.toolCalls >= (this.limits.maxToolCalls ?? 16)) throw new Error('工具调用预算已耗尽');
    this.toolCalls++;
  }

  canExpand(finalInput = 6000, finalOutput = 2400) {
    return this.remainingMs > 1000 && this.calls.length + 1 < (this.limits.maxModelCalls ?? 12)
      && this.remainingTokens > finalInput + finalOutput;
  }

  snapshot() {
    return {
      modelCalls: this.calls.length, toolCalls: this.toolCalls,
      prompt_tokens: this.calls.reduce((total, call) => total + call.input, 0),
      completion_tokens: this.calls.reduce((total, call) => total + call.output, 0),
      total_tokens: this.usedTokens,
      estimated: this.calls.some((call) => call.status !== 'reported'),
      calls: this.calls.map((call) => ({ ...call, status: call.status === 'reserved' ? 'estimated' : call.status })),
    };
  }

  close() { clearTimeout(this.timer); }
}
