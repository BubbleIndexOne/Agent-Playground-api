import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { requireAuth } from '../middleware/auth';
import { query } from '../services/database';
import { SUPPORTED_MODEL_PROVIDERS, SupportedModelProvider } from '../schemas/credentials';
import { decryptVaultPayload } from '../utils/vault';

export const llmProxyRouter = new Hono();

function getVaultKey(env: any): string | undefined {
  return (
    env?.VAULT_ENCRYPTION_KEY ||
    env?.PROD_VAULT_ENCRYPTION_KEY ||
    env?.DEV_VAULT_ENCRYPTION_KEY ||
    process.env.VAULT_ENCRYPTION_KEY ||
    process.env.PROD_VAULT_ENCRYPTION_KEY ||
    process.env.DEV_VAULT_ENCRYPTION_KEY
  );
}

export interface ProviderProxyConfig {
  baseUrl: string;
  allowedPaths: RegExp[];
  buildHeaders: (apiKey: string) => Record<string, string>;
}

export const PROVIDER_CONFIGS: Record<SupportedModelProvider, ProviderProxyConfig> = {
  anthropic: {
    baseUrl: 'https://api.anthropic.com',
    allowedPaths: [/^\/v1\/messages$/],
    buildHeaders: (key: string) => ({
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    }),
  },
  openai: {
    baseUrl: 'https://api.openai.com',
    allowedPaths: [/^\/v1\/chat\/completions$/, /^\/v1\/responses$/],
    buildHeaders: (key: string) => ({
      Authorization: `Bearer ${key}`,
    }),
  },
  google: {
    baseUrl: 'https://generativelanguage.googleapis.com',
    allowedPaths: [/^\/v1beta\/models\/[\w.-]+:(streamG|g)enerateContent$/],
    buildHeaders: (key: string) => ({
      'x-goog-api-key': key,
    }),
  },
};

/**
 * Handle proxied LLM requests for a specified provider.
 * Intercepts user requests, attaches decrypted upstream API keys, and pipes streams directly.
 */
llmProxyRouter.all('/:provider/*', requireAuth, async (c) => {
  const user = c.get('user');
  const provider = c.req.param('provider') as SupportedModelProvider;
  const env = c.env as any;

  if (!SUPPORTED_MODEL_PROVIDERS.includes(provider)) {
    throw new HTTPException(400, {
      message: `Unsupported model provider "${provider}". Supported providers: ${SUPPORTED_MODEL_PROVIDERS.join(', ')}`,
    });
  }

  const config = PROVIDER_CONFIGS[provider];
  const url = new URL(c.req.url);
  // Match path after /llm/:provider
  const match = url.pathname.match(new RegExp(`^/llm/${provider}(/.*)$`));
  const subPath = match ? match[1] : '';

  // Validate against path allowlist
  const isAllowed = config.allowedPaths.some((rx) => rx.test(subPath));
  if (!isAllowed) {
    throw new HTTPException(403, {
      message: `Path "${subPath}" is not allowed for provider "${provider}" proxy`,
    });
  }

  // Retrieve user's encrypted API key from database
  const saved = await query<{ encrypted_payload: string }>(
    `SELECT encrypted_payload FROM public.user_connector_credentials
     WHERE user_id = $1 AND kind = 'model_provider' AND connector_type = $2 LIMIT 1`,
    [user.id, provider]
  );

  if (saved.rows.length === 0) {
    throw new HTTPException(404, {
      message: `No API key configured for provider "${provider}". Please configure a key in credentials settings.`,
    });
  }

  const vaultKey = getVaultKey(env);
  if (!vaultKey) {
    throw new HTTPException(500, { message: 'Vault encryption key is not configured' });
  }

  let apiKey: string;
  const aad = `${user.id}:model_provider:${provider}`;
  try {
    const decrypted = await decryptVaultPayload(saved.rows[0].encrypted_payload, vaultKey, aad);
    const parsed = JSON.parse(decrypted);
    apiKey = parsed.apiKey;
    if (!apiKey) throw new Error('Missing apiKey in decrypted payload');
  } catch {
    throw new HTTPException(400, {
      message: `Failed to decrypt stored credentials for provider "${provider}"`,
    });
  }

  const upstreamUrl = `${config.baseUrl}${subPath}${url.search}`;
  const providerHeaders = config.buildHeaders(apiKey);

  const requestHeaders = new Headers(c.req.raw.headers);
  // Strip client auth header (Loom bearer token) and host
  requestHeaders.delete('authorization');
  requestHeaders.delete('host');

  // Inject upstream provider auth headers
  for (const [headerName, headerVal] of Object.entries(providerHeaders)) {
    requestHeaders.set(headerName, headerVal);
  }

  // Forward request with raw streaming body
  const fetchOptions: RequestInit = {
    method: c.req.method,
    headers: requestHeaders,
    body: ['GET', 'HEAD'].includes(c.req.method) ? undefined : c.req.raw.body,
    // @ts-expect-error duplex is required in node environments when body is a stream
    duplex: 'half',
  };

  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetch(upstreamUrl, fetchOptions);
  } catch (err: any) {
    throw new HTTPException(502, {
      message: `Failed to connect to upstream ${provider} API: ${err.message}`,
    });
  }

  // If upstream returns 401 Unauthorized, mark key as unverified asynchronously
  if (upstreamResponse.status === 401) {
    try {
      const updatePromise = query(
        `UPDATE public.user_connector_credentials
         SET last_verified_at = NULL, updated_at = now()
         WHERE user_id = $1 AND kind = 'model_provider' AND connector_type = $2`,
        [user.id, provider]
      );
      if (updatePromise && typeof updatePromise.catch === 'function') {
        updatePromise.catch(() => {});
      }
    } catch {}
  }

  // Return streamed response directly
  const responseHeaders = new Headers();
  const contentType = upstreamResponse.headers.get('content-type');
  if (contentType) {
    responseHeaders.set('content-type', contentType);
  }

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    headers: responseHeaders,
  });
});
