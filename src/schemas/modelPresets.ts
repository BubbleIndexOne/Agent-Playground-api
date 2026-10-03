import { z } from 'zod';
import { DEFAULT_MODEL_CONFIGS } from '../constants';

export const SUPPORTED_PROVIDERS = ['anthropic', 'openai', 'google', 'all'] as const;
export type SupportedProvider = (typeof SUPPORTED_PROVIDERS)[number];

export const REASONING_LEVELS = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'provider-default',
] as const;

export const TOOL_CHOICES = ['auto', 'required', 'none'] as const;

/**
 * Normalizes input configuration keys from snake_case or legacy aliases to standard camelCase.
 */
export function normalizeModelConfigKeys(raw: Record<string, any>): Record<string, any> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }

  const normalized: Record<string, any> = {};

  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined) continue;

    switch (key) {
      case 'top_p':
        normalized.topP = value;
        break;
      case 'top_k':
        normalized.topK = value;
        break;
      case 'presence_penalty':
        normalized.presencePenalty = value;
        break;
      case 'frequency_penalty':
        normalized.frequencyPenalty = value;
        break;
      case 'max_tokens':
      case 'maxTokens':
      case 'max_output_tokens':
        normalized.maxOutputTokens = value;
        break;
      case 'stop_sequences':
        normalized.stopSequences = value;
        break;
      case 'tool_choice':
        normalized.toolChoice = value;
        break;
      default:
        normalized[key] = value;
        break;
    }
  }

  return normalized;
}

/**
 * Strips out parameters that match the baseline default configurations,
 * returning only the sparse delta to be stored in the database.
 */
export function toSparseDelta(config: Record<string, any>): Record<string, any> {
  const normalized = normalizeModelConfigKeys(config);
  const delta: Record<string, any> = {};

  for (const [key, value] of Object.entries(normalized)) {
    if (value === undefined) continue;

    // If key exists in defaults and has exact matching value, prune it
    if (key in DEFAULT_MODEL_CONFIGS) {
      const defaultVal = (DEFAULT_MODEL_CONFIGS as any)[key];
      if (value === defaultVal) {
        continue;
      }
    }

    delta[key] = value;
  }

  return delta;
}

/**
 * Merges a sparse delta read from the database with the default model configuration,
 * returning the full hydrated configuration object.
 */
export function hydrateWithDefaults(delta: Record<string, any>): Record<string, any> {
  const normalizedDelta = normalizeModelConfigKeys(delta || {});
  return {
    ...DEFAULT_MODEL_CONFIGS,
    ...normalizedDelta,
  };
}

/**
 * Validates a ModelConfig object according to provider rules.
 */
export const ModelConfigSchema = z
  .object({
    temperature: z.number().min(0).max(2).optional(),
    topP: z.number().min(0).max(1).optional(),
    topK: z.number().int().min(2).max(100).optional(),
    presencePenalty: z.number().min(-2).max(2).optional(),
    frequencyPenalty: z.number().min(-2).max(2).optional(),
    maxOutputTokens: z.number().int().positive().optional(),
    seed: z.number().int().nonnegative().optional(),
    stopSequences: z.array(z.string().trim().min(1)).optional(),
    reasoning: z.enum(REASONING_LEVELS).optional(),
    toolChoice: z.enum(TOOL_CHOICES).optional(),
  })
  .passthrough();

/**
 * Validates provider-specific constraints on model parameters.
 */
export function validateProviderConstraints(provider: string, config: Record<string, any>): void {
  const p = provider.toLowerCase();

  if (p === 'anthropic') {
    if (config.temperature !== undefined && config.temperature > 1.0) {
      throw new Error('Anthropic temperature must be between 0.0 and 1.0');
    }
    if (config.frequencyPenalty !== undefined && config.frequencyPenalty !== 0) {
      throw new Error('Anthropic does not support frequencyPenalty');
    }
    if (config.presencePenalty !== undefined && config.presencePenalty !== 0) {
      throw new Error('Anthropic does not support presencePenalty');
    }
  }

  if (p === 'google') {
    if (config.topK !== undefined && config.topK > 100) {
      throw new Error('Google Gemini topK cannot exceed 100');
    }
  }
}

export const CreateModelPresetSchema = z.object({
  name: z
    .string({ required_error: 'name is required' })
    .trim()
    .min(1, 'name cannot be empty')
    .max(100, 'name cannot exceed 100 characters'),
  provider: z.enum(SUPPORTED_PROVIDERS, {
    errorMap: () => ({
      message: `Invalid provider. Supported providers: ${SUPPORTED_PROVIDERS.join(', ')}`,
    }),
  }),
  model_id: z.string().trim().nullable().optional(),
  params: z.record(z.any()).optional().default({}),
});

export const UpdateModelPresetSchema = z.object({
  name: z.string().trim().min(1, 'name cannot be empty').max(100).optional(),
  provider: z
    .enum(SUPPORTED_PROVIDERS, {
      errorMap: () => ({
        message: `Invalid provider. Supported providers: ${SUPPORTED_PROVIDERS.join(', ')}`,
      }),
    })
    .optional(),
  model_id: z.string().trim().nullable().optional(),
  params: z.record(z.any()).optional(),
  is_archived: z.boolean().optional(),
});
