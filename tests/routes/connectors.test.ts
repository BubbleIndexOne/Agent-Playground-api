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

import { connectorsRouter } from '../../src/routes/connectors';

function createConnectorsApp(env: Record<string, unknown> = {}) {
  const app = new Hono<{ Bindings: Record<string, unknown> }>();
  app.use('*', async (c, next) => {
    c.env = Object.assign({}, c.env, env);
    await next();
  });
  app.route('/connectors', connectorsRouter);
  app.onError((error, c) => {
    if (error instanceof HTTPException) {
      return c.json({ statusCode: error.status, message: error.message }, error.status);
    }
    return c.json({ statusCode: 500, message: (error as Error).message }, 500);
  });
  return app;
}

const mockUser = {
  id: 'user-uuid-1111',
  sub: 'user-uuid-1111',
  email: 'tester@example.com',
  is_admin: false,
};

describe('Connectors Routes (/connectors)', () => {
  let app: ReturnType<typeof createConnectorsApp>;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createConnectorsApp();
    // Default valid token
    jwtMocks.verifyAccessToken.mockResolvedValue(mockUser);
  });

  describe('Authentication', () => {
    it('returns 401 when no Authorization header is present', async () => {
      const res = await app.request('/connectors');
      expect(res.status).toBe(401);
    });
  });

  describe('GET /connectors', () => {
    it('returns list of configured connectors with metadata and preview', async () => {
      const rows = [
        {
          id: 'conn-1',
          connector_type: 'postgres',
          preview: 'agent_user@db.example.com:5432/analytics',
          key_version: 1,
          created_at: '2026-10-01T12:00:00.000Z',
          updated_at: '2026-10-01T12:00:00.000Z',
        },
      ];
      dbMocks.query.mockResolvedValueOnce({ rows });

      const res = await app.request('/connectors', {
        headers: { Authorization: 'Bearer valid.jwt.token' },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.connectors).toEqual(rows);
      expect(dbMocks.query).toHaveBeenCalledWith(expect.stringContaining('WHERE user_id = $1'), [mockUser.id]);
    });
  });

  describe('PUT /connectors/:type/credentials', () => {
    it('rejects unsupported connector types', async () => {
      const res = await app.request('/connectors/unsupported_service/credentials', {
        method: 'PUT',
        headers: {
          Authorization: 'Bearer valid.jwt.token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ token: 'abc' }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.message).toContain('Unsupported connector type');
    });

    it('validates schema and rejects invalid payload', async () => {
      const res = await app.request('/connectors/postgres/credentials', {
        method: 'PUT',
        headers: {
          Authorization: 'Bearer valid.jwt.token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ host: 'localhost' }), // missing database, user, password
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.message).toBeDefined();
    });

    it('encrypts credentials and upserts postgres configuration cleanly', async () => {
      const postgresPayload = {
        host: 'pg.internal.corp',
        port: 5432,
        database: 'warehouse',
        user: 'etl_user',
        password: 'myTopSecretPassword123!',
      };

      dbMocks.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'cred-uuid-1',
            connector_type: 'postgres',
            preview: 'etl_user@pg.internal.corp:5432/warehouse',
            key_version: 1,
            created_at: '2026-10-01T12:00:00Z',
            updated_at: '2026-10-01T12:00:00Z',
          },
        ],
      });

      const res = await app.request('/connectors/postgres/credentials', {
        method: 'PUT',
        headers: {
          Authorization: 'Bearer valid.jwt.token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(postgresPayload),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.connector.preview).toBe('etl_user@pg.internal.corp:5432/warehouse');

      // Ensure database was called with encrypted ciphertext, NOT plaintext
      const [sql, params] = dbMocks.query.mock.calls[0];
      expect(sql).toContain('INSERT INTO public.user_connector_credentials');
      expect(params[0]).toBe(mockUser.id);
      expect(params[1]).toBe('postgres');
      // params[2] is encrypted_payload (iv:ciphertext)
      expect(params[2]).toContain(':');
      expect(params[2]).not.toContain('myTopSecretPassword123!');
      // params[3] is preview
      expect(params[3]).toBe('etl_user@pg.internal.corp:5432/warehouse');
    });

    it('upserts slack credentials with masked preview', async () => {
      const slackPayload = {
        botToken: 'xoxb-9876543210-xyz9',
      };

      dbMocks.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'cred-uuid-2',
            connector_type: 'slack',
            preview: 'xoxb-••••xyz9',
            key_version: 1,
            created_at: '2026-10-01T12:00:00Z',
            updated_at: '2026-10-01T12:00:00Z',
          },
        ],
      });

      const res = await app.request('/connectors/slack/credentials', {
        method: 'PUT',
        headers: {
          Authorization: 'Bearer valid.jwt.token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(slackPayload),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.connector.preview).toBe('xoxb-••••xyz9');
    });

    it('verifies connection on save when ?verify=true is provided', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: false, error: 'invalid_auth' }), { status: 200 }),
      );

      try {
        const res = await app.request('/connectors/slack/credentials?verify=true', {
          method: 'PUT',
          headers: {
            Authorization: 'Bearer valid.jwt.token',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ botToken: 'xoxb-bad-token' }),
        });

        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.message).toContain('Slack verification failed');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe('DELETE /connectors/:type/credentials', () => {
    it('returns 404 when connector credentials do not exist', async () => {
      dbMocks.query.mockResolvedValueOnce({ rows: [] });

      const res = await app.request('/connectors/postgres/credentials', {
        method: 'DELETE',
        headers: { Authorization: 'Bearer valid.jwt.token' },
      });

      expect(res.status).toBe(404);
    });

    it('returns 200 when connector credentials are deleted', async () => {
      dbMocks.query.mockResolvedValueOnce({ rows: [{ id: 'cred-1', connector_type: 'postgres' }] });

      const res = await app.request('/connectors/postgres/credentials', {
        method: 'DELETE',
        headers: { Authorization: 'Bearer valid.jwt.token' },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.message).toContain('deleted successfully');
    });
  });

  describe('POST /connectors/:type/test', () => {
    it('tests slack connection with supplied credentials in request body', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValueOnce(
        new Response(
          JSON.stringify({ ok: true, team: 'AgentTeam', user: 'BotUser', team_id: 'T123' }),
          { status: 200 },
        ),
      );

      try {
        const res = await app.request('/connectors/slack/test', {
          method: 'POST',
          headers: {
            Authorization: 'Bearer valid.jwt.token',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ botToken: 'xoxb-valid-token' }),
        });

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.success).toBe(true);
        expect(body.details.team).toBe('AgentTeam');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});
