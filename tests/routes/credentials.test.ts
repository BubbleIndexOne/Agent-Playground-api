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

import { credentialsRouter } from '../../src/routes/credentials';
import { DEFAULT_DEV_VAULT_KEY } from '../../src/constants';
import { encryptVaultPayload } from '../../src/utils/vault';

function createCredentialsApp(env: Record<string, unknown> = {}) {
  const app = new Hono<{ Bindings: Record<string, unknown> }>();
  app.route('/credentials', credentialsRouter);
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

describe('Credentials Routes (/credentials/models)', () => {
  let app: ReturnType<typeof createCredentialsApp>;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createCredentialsApp({ VAULT_ENCRYPTION_KEY: DEFAULT_DEV_VAULT_KEY });
    jwtMocks.verifyAccessToken.mockResolvedValue(mockUser);
    vi.stubGlobal('fetch', vi.fn());
  });

  describe('GET /credentials/models', () => {
    it('returns configured model provider credentials list with masked previews', async () => {
      dbMocks.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'cred-1',
            provider: 'anthropic',
            preview: 'sk-ant-••••a3f9',
            key_version: 1,
            last_verified_at: '2026-11-01T12:00:00.000Z',
            created_at: '2026-11-01T11:00:00.000Z',
            updated_at: '2026-11-01T12:00:00.000Z',
          },
        ],
      });

      const res = await app.request('/credentials/models', {
        headers: { Authorization: 'Bearer valid.jwt.token' },
      });

      expect(res.status).toBe(200);
      const data: any = await res.json();
      expect(data.success).toBe(true);
      expect(data.credentials).toHaveLength(1);
      expect(data.credentials[0].provider).toBe('anthropic');
      expect(data.credentials[0].preview).toBe('sk-ant-••••a3f9');
    });
  });

  describe('PUT /credentials/models/:provider', () => {
    it('rejects unsupported provider with 400', async () => {
      const res = await app.request('/credentials/models/cohere', {
        method: 'PUT',
        headers: {
          Authorization: 'Bearer valid.jwt.token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ apiKey: 'sk-some-key' }),
      });

      expect(res.status).toBe(400);
      const data: any = await res.json();
      expect(data.message).toContain('Unsupported model provider');
    });

    it('rejects invalid key format for provider with 400', async () => {
      const res = await app.request('/credentials/models/anthropic', {
        method: 'PUT',
        headers: {
          Authorization: 'Bearer valid.jwt.token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ apiKey: 'invalid-key-no-prefix' }),
      });

      expect(res.status).toBe(400);
      const data: any = await res.json();
      expect(data.message).toContain('must start with "sk-ant-"');
    });

    it('verifies with upstream and saves encrypted key with AAD', async () => {
      // Mock upstream Anthropic verification success
      (fetch as any).mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [{ id: 'claude-3-5-sonnet' }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      dbMocks.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'cred-1',
            provider: 'anthropic',
            preview: 'sk-ant-••••1234',
            key_version: 1,
            last_verified_at: new Date().toISOString(),
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ],
      });

      const res = await app.request('/credentials/models/anthropic', {
        method: 'PUT',
        headers: {
          Authorization: 'Bearer valid.jwt.token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ apiKey: 'sk-ant-api03-abcdefg1234' }),
      });

      expect(res.status).toBe(200);
      const data: any = await res.json();
      expect(data.success).toBe(true);
      expect(data.credential.preview).toBe('sk-ant-••••1234');
      expect(dbMocks.query).toHaveBeenCalledTimes(1);

      // Verify that the query bound the user_id, kind='model_provider', provider='anthropic'
      const queryArgs = dbMocks.query.mock.calls[0][1];
      expect(queryArgs[0]).toBe('user-uuid-1111');
      expect(queryArgs[1]).toBe('anthropic');
      expect(queryArgs[2]).toContain(':'); // encrypted iv:ciphertext
      expect(queryArgs[3]).toBe('sk-ant-••••1234');
    });

    it('fails when upstream verification rejects key', async () => {
      (fetch as any).mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: { message: 'invalid x-api-key provided' } }),
          { status: 401, headers: { 'Content-Type': 'application/json' } }
        )
      );

      const res = await app.request('/credentials/models/anthropic', {
        method: 'PUT',
        headers: {
          Authorization: 'Bearer valid.jwt.token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ apiKey: 'sk-ant-api03-invalidkey123' }),
      });

      expect(res.status).toBe(400);
      const data: any = await res.json();
      expect(data.message).toContain('invalid x-api-key provided');
      expect(dbMocks.query).not.toHaveBeenCalled();
    });
  });

  describe('DELETE /credentials/models/:provider', () => {
    it('deletes stored credentials for provider', async () => {
      dbMocks.query.mockResolvedValueOnce({
        rows: [{ id: 'cred-1', connector_type: 'anthropic' }],
      });

      const res = await app.request('/credentials/models/anthropic', {
        method: 'DELETE',
        headers: { Authorization: 'Bearer valid.jwt.token' },
      });

      expect(res.status).toBe(200);
      const data: any = await res.json();
      expect(data.success).toBe(true);
      expect(data.message).toContain('deleted successfully');
    });

    it('returns 404 when no credentials configured to delete', async () => {
      dbMocks.query.mockResolvedValueOnce({ rows: [] });

      const res = await app.request('/credentials/models/openai', {
        method: 'DELETE',
        headers: { Authorization: 'Bearer valid.jwt.token' },
      });

      expect(res.status).toBe(404);
    });
  });

  describe('POST /credentials/models/:provider/test', () => {
    it('decrypts stored key and verifies against upstream', async () => {
      const aad = `${mockUser.id}:model_provider:openai`;
      const encrypted = await encryptVaultPayload(
        JSON.stringify({ apiKey: 'sk-proj-testkey12345' }),
        DEFAULT_DEV_VAULT_KEY,
        aad
      );

      dbMocks.query.mockResolvedValueOnce({
        rows: [{ encrypted_payload: encrypted }],
      });

      (fetch as any).mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      );

      const res = await app.request('/credentials/models/openai/test', {
        method: 'POST',
        headers: { Authorization: 'Bearer valid.jwt.token' },
      });

      expect(res.status).toBe(200);
      const data: any = await res.json();
      expect(data.success).toBe(true);
      expect(data.message).toContain('verified successfully');
    });

    it('returns 404 when key is not found in database', async () => {
      dbMocks.query.mockResolvedValueOnce({ rows: [] });

      const res = await app.request('/credentials/models/openai/test', {
        method: 'POST',
        headers: { Authorization: 'Bearer valid.jwt.token' },
      });

      expect(res.status).toBe(404);
    });
  });
});

