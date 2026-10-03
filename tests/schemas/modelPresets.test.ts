import { describe, expect, it } from 'vitest';
import {
  toSparseDelta,
  hydrateWithDefaults,
  normalizeModelConfigKeys,
  ModelConfigSchema,
  validateProviderConstraints,
  CreateModelPresetSchema,
} from '../../src/schemas/modelPresets';
import { DEFAULT_MODEL_CONFIGS } from '../../src/constants';

describe('Model Presets Schemas & Delta Utilities', () => {
  describe('normalizeModelConfigKeys', () => {
    it('normalizes snake_case and legacy keys to canonical camelCase', () => {
      const input = {
        top_p: 0.8,
        top_k: 50,
        frequency_penalty: 0.5,
        presence_penalty: -0.2,
        max_output_tokens: 1500,
        stop_sequences: ['END', 'STOP'],
        tool_choice: 'auto',
      };

      const normalized = normalizeModelConfigKeys(input);
      expect(normalized).toEqual({
        topP: 0.8,
        topK: 50,
        frequencyPenalty: 0.5,
        presencePenalty: -0.2,
        maxOutputTokens: 1500,
        stopSequences: ['END', 'STOP'],
        toolChoice: 'auto',
      });
    });
  });

  describe('toSparseDelta', () => {
    it('prunes parameters that match the baseline default configurations', () => {
      const input = {
        temperature: 0.7, // modified from default 1.0
        topP: 1.0,        // matches default 1.0 -> should be pruned
        topK: 40,         // matches default 40 -> should be pruned
        presencePenalty: 0.0, // matches default 0.0 -> should be pruned
        frequencyPenalty: 0.0, // matches default 0.0 -> should be pruned
        maxOutputTokens: 2048, // custom -> kept
      };

      const delta = toSparseDelta(input);
      expect(delta).toEqual({
        temperature: 0.7,
        maxOutputTokens: 2048,
      });
      expect(delta.topP).toBeUndefined();
      expect(delta.topK).toBeUndefined();
    });

    it('handles snake_case inputs and prunes defaults accurately', () => {
      const input = {
        top_p: 1.0, // default -> pruned
        frequency_penalty: 0.8, // non-default -> kept as frequencyPenalty
      };

      const delta = toSparseDelta(input);
      expect(delta).toEqual({
        frequencyPenalty: 0.8,
      });
    });
  });

  describe('hydrateWithDefaults', () => {
    it('hydrates a sparse delta into the complete default ModelConfig', () => {
      const delta = {
        temperature: 0.4,
        maxOutputTokens: 1024,
      };

      const hydrated = hydrateWithDefaults(delta);
      expect(hydrated).toEqual({
        temperature: 0.4,
        topP: DEFAULT_MODEL_CONFIGS.topP,
        topK: DEFAULT_MODEL_CONFIGS.topK,
        presencePenalty: DEFAULT_MODEL_CONFIGS.presencePenalty,
        frequencyPenalty: DEFAULT_MODEL_CONFIGS.frequencyPenalty,
        maxOutputTokens: 1024,
      });
    });

    it('returns baseline defaults when delta is empty', () => {
      const hydrated = hydrateWithDefaults({});
      expect(hydrated).toEqual(DEFAULT_MODEL_CONFIGS);
    });
  });

  describe('ModelConfigSchema and Provider Constraints', () => {
    it('validates standard Vercel AI SDK fields', () => {
      const valid = {
        temperature: 1.2,
        topP: 0.9,
        topK: 30,
        presencePenalty: 0.2,
        frequencyPenalty: -0.1,
        maxOutputTokens: 4096,
        seed: 42,
        stopSequences: ['###'],
        reasoning: 'high',
        toolChoice: 'required',
      };

      expect(() => ModelConfigSchema.parse(valid)).not.toThrow();
    });

    it('enforces Anthropic temperature ceiling of 1.0 and blocks penalties', () => {
      expect(() =>
        validateProviderConstraints('anthropic', { temperature: 1.5 }),
      ).toThrow(/between 0.0 and 1.0/);

      expect(() =>
        validateProviderConstraints('anthropic', { frequencyPenalty: 0.5 }),
      ).toThrow(/does not support frequencyPenalty/);
    });

    it('enforces Google Gemini topK ceiling of 100', () => {
      expect(() =>
        validateProviderConstraints('google', { topK: 150 }),
      ).toThrow(/cannot exceed 100/);
    });
  });

  describe('CreateModelPresetSchema', () => {
    it('validates a correct preset input', () => {
      const input = {
        name: 'Creative Writing Assistant',
        provider: 'anthropic',
        model_id: 'claude-3-5-sonnet-20240620',
        params: {
          temperature: 0.8,
          maxOutputTokens: 4000,
        },
      };

      const parsed = CreateModelPresetSchema.parse(input);
      expect(parsed.name).toBe('Creative Writing Assistant');
      expect(parsed.provider).toBe('anthropic');
    });

    it('rejects empty name or provider', () => {
      expect(() =>
        CreateModelPresetSchema.parse({ name: '', provider: 'openai' }),
      ).toThrow(/name cannot be empty/);

      expect(() =>
        CreateModelPresetSchema.parse({ name: 'Valid', provider: '' }),
      ).toThrow(/provider cannot be empty/);
    });
  });
});
