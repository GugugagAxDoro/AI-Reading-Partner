import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from '@ltd/j-toml';
import { z } from 'zod';

const providerSchema = z.object({
  type: z.literal('openai-compatible'),
  base_url: z.string().url(),
  api_key: z.string().min(1),
});

const modelSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  context_window: tomlInteger().pipe(z.number().int().positive()),
  supports_tool_calling: z.boolean().default(false),
});

export const providerFileSchema = z.object({
  providers: z.record(z.string(), providerSchema),
  models: z.object({ light: modelSchema, strong: modelSchema }),
  settings: z
    .object({
      quality_mode: z.enum(['fast', 'balanced', 'quality']).default('balanced'),
    })
    .default({ quality_mode: 'balanced' }),
  searxng: z
    .object({
      base_url: z.string().url().optional(),
      timeout_ms: tomlInteger().pipe(z.number().int().positive().max(120_000)).default(20_000),
      max_results: tomlInteger().pipe(z.number().int().min(1).max(50)).default(8),
    })
    .optional(),
});

export type ProviderFile = z.infer<typeof providerFileSchema>;

function tomlInteger() {
  return z.preprocess((value) => (typeof value === 'bigint' ? Number(value) : value), z.number());
}

export class ProviderConfigError extends Error {
  readonly code: 'missing' | 'invalid';

  constructor(code: 'missing' | 'invalid', message: string) {
    super(message);
    this.name = 'ProviderConfigError';
    this.code = code;
  }
}

export function loadProviderConfig(dataRoot: string): ProviderFile {
  const configPath = join(dataRoot, 'config', 'providers.toml');
  let raw: string;
  try {
    raw = readFileSync(configPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new ProviderConfigError('missing', `Provider configuration is missing: ${configPath}`);
    }
    throw error;
  }

  try {
    const parsed = parse(raw) as Record<string, unknown>;
    return providerFileSchema.parse(parsed);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new ProviderConfigError('invalid', `Provider configuration is invalid: ${detail}`);
  }
}

export function redactSecret(value: string): string {
  if (value.length <= 8) return '********';
  return `${value.slice(0, 4)}********${value.slice(-4)}`;
}

export interface RedactedProviderStatus {
  configured: boolean;
  active: boolean;
  light_model: string | null;
  strong_model: string | null;
  quality_mode: 'fast' | 'balanced' | 'quality' | null;
  searxng_configured: boolean;
  supports_tool_calling: boolean;
  error: string | null;
}

export class ProviderConfig {
  private cachedConfig?: ProviderFile;

  constructor(private readonly dataRoot: string) {}

  get current(): ProviderFile {
    this.cachedConfig ??= loadProviderConfig(this.dataRoot);
    return this.cachedConfig;
  }

  reload(): RedactedProviderStatus {
    this.cachedConfig = loadProviderConfig(this.dataRoot);
    return this.status();
  }

  reset(): void {
    this.cachedConfig = undefined;
  }

  status(): RedactedProviderStatus {
    try {
      const config = this.current;
      return {
        configured: true,
        active: true,
        light_model: config.models.light.model,
        strong_model: config.models.strong.model,
        quality_mode: config.settings.quality_mode,
        searxng_configured: Boolean(config.searxng?.base_url),
        supports_tool_calling: config.models.strong.supports_tool_calling,
        error: null,
      };
    } catch (error) {
      return {
        configured: false,
        active: false,
        light_model: null,
        strong_model: null,
        quality_mode: null,
        searxng_configured: false,
        supports_tool_calling: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
