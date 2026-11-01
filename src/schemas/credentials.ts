import { z } from 'zod';

export const SUPPORTED_MODEL_PROVIDERS = ['anthropic', 'openai', 'google'] as const;
export type SupportedModelProvider = (typeof SUPPORTED_MODEL_PROVIDERS)[number];

export const SaveModelCredentialSchema = z.object({
  apiKey: z.string().min(1, 'API key is required').trim(),
});

export type SaveModelCredentialInput = z.infer<typeof SaveModelCredentialSchema>;

/**
 * Validate format constraints per provider before attempting upstream network verification.
 */
export function validateProviderKeyFormat(provider: SupportedModelProvider, apiKey: string): { valid: boolean; error?: string } {
  const trimmed = apiKey.trim();
  if (!trimmed) {
    return { valid: false, error: 'API key cannot be empty' };
  }

  if (provider === 'anthropic') {
    if (!trimmed.startsWith('sk-ant-') || trimmed.length < 15) {
      return { valid: false, error: 'Anthropic API key must start with "sk-ant-" and be at least 15 characters' };
    }
  } else if (provider === 'openai') {
    if (!trimmed.startsWith('sk-') || trimmed.length < 15) {
      return { valid: false, error: 'OpenAI API key must start with "sk-" and be at least 15 characters' };
    }
  } else if (provider === 'google') {
    if (trimmed.length < 15) {
      return { valid: false, error: 'Google Gemini API key must be at least 15 characters' };
    }
  }

  return { valid: true };
}

/**
 * Generates a masked preview of an API key for display in the UI without exposing the secret.
 */
export function generateModelCredentialPreview(provider: SupportedModelProvider, apiKey: string): string {
  const trimmed = apiKey.trim();
  const last4 = trimmed.slice(-4);

  if (provider === 'anthropic') {
    return `sk-ant-••••${last4}`;
  }
  if (provider === 'openai') {
    return `sk-••••${last4}`;
  }
  if (provider === 'google') {
    return `AIza••••${last4}`;
  }
  return `••••${last4}`;
}

/**
 * Validates a model provider API key against the provider's upstream metadata endpoint.
 */
export async function testModelProviderKey(
  provider: SupportedModelProvider,
  apiKey: string
): Promise<{ ok: boolean; message: string; details?: any }> {
  const trimmed = apiKey.trim();

  if (provider === 'anthropic') {
    try {
      const res = await fetch('https://api.anthropic.com/v1/models', {
        method: 'GET',
        headers: {
          'x-api-key': trimmed,
          'anthropic-version': '2023-06-01',
        },
      });
      if (res.ok) {
        return { ok: true, message: 'Anthropic API key verified successfully' };
      }
      const body: any = await res.json().catch(() => ({}));
      return {
        ok: false,
        message: body?.error?.message || `Anthropic verification failed with status ${res.status}`,
      };
    } catch (err: any) {
      return { ok: false, message: `Failed to contact Anthropic API: ${err.message}` };
    }
  }

  if (provider === 'openai') {
    try {
      const res = await fetch('https://api.openai.com/v1/models', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${trimmed}`,
        },
      });
      if (res.ok) {
        return { ok: true, message: 'OpenAI API key verified successfully' };
      }
      const body: any = await res.json().catch(() => ({}));
      return {
        ok: false,
        message: body?.error?.message || `OpenAI verification failed with status ${res.status}`,
      };
    } catch (err: any) {
      return { ok: false, message: `Failed to contact OpenAI API: ${err.message}` };
    }
  }

  if (provider === 'google') {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(trimmed)}&pageSize=1`,
        { method: 'GET' }
      );
      if (res.ok) {
        return { ok: true, message: 'Google Gemini API key verified successfully' };
      }
      const body: any = await res.json().catch(() => ({}));
      return {
        ok: false,
        message: body?.error?.message || `Google API key verification failed with status ${res.status}`,
      };
    } catch (err: any) {
      return { ok: false, message: `Failed to contact Google API: ${err.message}` };
    }
  }

  return { ok: false, message: `Unsupported provider "${provider}"` };
}

