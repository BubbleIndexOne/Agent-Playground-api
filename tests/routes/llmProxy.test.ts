import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';

// Mock database query
const dbMocks = vi.hoisted(() => ({
  query: vi.fn(),
}));

vi.mock('../../src/services/database', () => ({
  query: dbMocks.query,
}));

// Mock JWT
const jwtMocks = vi.hoisted(() => ({
  verifyAccessToken: vi.fn(),
}));

vi.mock('../../src/services/jwt', () => ({
  verifyAccessToken: jwtMocks.verifyAccessToken,
}));

import { llmProxyRouter } from '../../src/routes/llmProxy';
import { DEFAULT_DEV_VAULT_KEY } from '../../src/constants';
import { encryptVaultPayload } from '../../src/utils/vault';

function createLLMProxyApp(env: Record<string, unknown> = {}) {
  const app = new Hono<{ Bindings: Record<string, unknown> }>();
  app.route('/llm', llmProxyRouter);
  app.onError((error, c) => {
    if (error instanceof HTTPException) {
      return c.json({ statusCode: error.status, message: error.message }, error.status);
    }
    return c.json({ statusCode: 500, message: (error as Error).message }, 500);
  });
  const originalRequest = app.request.bind(app);
  app.request = (input: RequestInfo | URL, init?: RequestInit, customEnv?: unknown, executionCtx?: unknown) => {
    return originalRequest(input, init, (customEnv !== undefined ? customEnv : env) as any, executionCtx);
  };
  return app;
}

const mockUser = {
  id: 'user-uuid-1111',
  sub: 'user-uuid-1111',
  email: 'tester@example.com',
  is_admin: false,
};

describe('LLM Key-Injecting Proxy Routes (/llm/:provider/*)', () => {
  let app: ReturnType<typeof createLLMProxyApp>;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createLLMProxyApp({ VAULT_ENCRYPTION_KEY: DEFAULT_DEV_VAULT_KEY });
    jwtMocks.verifyAccessToken.mockResolvedValue(mockUser);
    dbMocks.query.mockResolvedValue({ rows: [] });
    vi.stubGlobal('fetch', vi.fn());
  });

  it('rejects unauthenticated requests with 401', async () => {
    jwtMocks.verifyAccessToken.mockRejectedValueOnce(new Error('Invalid token'));

    const res = await app.request('/llm/anthropic/v1/messages', {
      method: 'POST',
      headers: { Authorization: 'Bearer invalid.token' },
    });

    expect(res.status).toBe(401);
  });

  it('rejects unsupported provider with 400', async () => {
    const res = await app.request('/llm/unknown-provider/v1/messages', {
      method: 'POST',
      headers: { Authorization: 'Bearer valid.jwt.token' },
    });

    expect(res.status).toBe(400);
    const data: any = await res.json();
    expect(data.message).toContain('Unsupported model provider');
  });

  it('rejects unauthorized paths outside provider allowlist with 403', async () => {
    const res = await app.request('/llm/anthropic/v1/org/billing', {
      method: 'POST',
      headers: { Authorization: 'Bearer valid.jwt.token' },
    });

    expect(res.status).toBe(403);
    const data: any = await res.json();
    expect(data.message).toContain('not allowed for provider');
  });

  it('returns 404 when user has not saved an API key for the provider', async () => {
    dbMocks.query.mockResolvedValueOnce({ rows: [] });

    const res = await app.request('/llm/anthropic/v1/messages', {
      method: 'POST',
      headers: { Authorization: 'Bearer valid.jwt.token' },
    });

    expect(res.status).toBe(404);
    const data: any = await res.json();
    expect(data.message).toContain('No API key configured for provider "anthropic"');
  });

  it('injects decrypted key into upstream headers and pipes response stream', async () => {
    const userApiKey = 'sk-ant-api03-live-test-secret-key-12345';
    const aad = `${mockUser.id}:model_provider:anthropic`;
    const encrypted = await encryptVaultPayload(
      JSON.stringify({ apiKey: userApiKey }),
      DEFAULT_DEV_VAULT_KEY,
      aad
    );

    dbMocks.query.mockResolvedValueOnce({
      rows: [{ encrypted_payload: encrypted }],
    });

    const upstreamMockResponse = new Response(
      JSON.stringify({ id: 'msg_123', type: 'message', content: [{ text: 'Hello from Claude' }] }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'custom-upstream-header': 'test' },
      }
    );

    (fetch as any).mockResolvedValueOnce(upstreamMockResponse);

    const clientRequestBody = JSON.stringify({
      model: 'claude-3-5-sonnet-20240620',
      messages: [{ role: 'user', content: 'Say hello' }],
    });

    const res = await app.request('/llm/anthropic/v1/messages', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer valid.jwt.token',
        'Content-Type': 'application/json',
        Cookie: 'session=secret-cookie',
        Origin: 'https://browser.example.com',
        Referer: 'https://browser.example.com/chat',
        'X-Forwarded-For': '203.0.113.195',
        'CF-Ray': '8d39c0119a-IAD',
      },
      body: clientRequestBody,
    });

    expect(res.status).toBe(200);
    const data: any = await res.json();
    expect(data.id).toBe('msg_123');

    // Verify upstream fetch call
    expect(fetch).toHaveBeenCalledTimes(1);
    const [fetchUrl, fetchOptions] = (fetch as any).mock.calls[0];
    expect(fetchUrl).toBe('https://api.anthropic.com/v1/messages');
    
    // Check headers sent to upstream
    const sentHeaders = fetchOptions.headers;
    expect(sentHeaders.get('x-api-key')).toBe(userApiKey);
    expect(sentHeaders.get('anthropic-version')).toBe('2023-06-01');
    // Ensure Loom client token and browser/tracking headers were stripped
    expect(sentHeaders.has('authorization')).toBe(false);
    expect(sentHeaders.has('cookie')).toBe(false);
    expect(sentHeaders.has('origin')).toBe(false);
    expect(sentHeaders.has('referer')).toBe(false);
    expect(sentHeaders.has('x-forwarded-for')).toBe(false);
    expect(sentHeaders.has('cf-ray')).toBe(false);
  });

  it('clears last_verified_at and returns 502 with distinct error code if upstream returns 401', async () => {
    const userApiKey = 'sk-ant-api03-revoked-key';
    const aad = `${mockUser.id}:model_provider:anthropic`;
    const encrypted = await encryptVaultPayload(
      JSON.stringify({ apiKey: userApiKey }),
      DEFAULT_DEV_VAULT_KEY,
      aad
    );

    dbMocks.query.mockResolvedValueOnce({
      rows: [{ encrypted_payload: encrypted }],
    });

    (fetch as any).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const res = await app.request('/llm/anthropic/v1/messages', {
      method: 'POST',
      headers: { Authorization: 'Bearer valid.jwt.token' },
    });

    expect(res.status).toBe(502);
    const body: any = await res.json();
    expect(body.code).toBe('UPSTREAM_PROVIDER_AUTH_ERROR');
    expect(body.message).toContain('rejected the configured API key');

    // Asynchronous query update triggered for clearing last_verified_at
    expect(dbMocks.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE public.user_connector_credentials'),
      [mockUser.id, 'anthropic']
    );
  });
});
