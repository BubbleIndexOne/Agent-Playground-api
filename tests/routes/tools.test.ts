import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';

// ─── Mock: database query ─────────────────────────────────────────────────────

const dbMocks = vi.hoisted(() => ({
  query: vi.fn(),
}));

vi.mock('../../src/services/database', () => ({
  query: dbMocks.query,
}));

// ─── Mock: JWT service ────────────────────────────────────────────────────────

const jwtMocks = vi.hoisted(() => ({
  signAccessToken: vi.fn(),
  verifyAccessToken: vi.fn(),
  generateRefreshToken: vi.fn(),
}));

vi.mock('../../src/services/jwt', () => ({
  signAccessToken: jwtMocks.signAccessToken,
  verifyAccessToken: jwtMocks.verifyAccessToken,
  generateRefreshToken: jwtMocks.generateRefreshToken,
}));

import { toolsRouter } from '../../src/routes/tools';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function jsonRequest(
  path: string,
  body: unknown,
  method = 'POST',
  headers: Record<string, string> = {},
) {
  return new Request(`http://localhost${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

function createToolsApp(env: Record<string, unknown> = {}) {
  const app = new Hono<{ Bindings: Record<string, unknown> }>();
  app.use('*', async (c, next) => {
    c.env = Object.assign({}, c.env, env);
    await next();
  });
  app.route('/tools', toolsRouter);
  app.onError((error, c) => {
    if (error instanceof HTTPException) {
      return c.json({ statusCode: error.status, message: error.message }, error.status);
    }
    throw error;
  });
  return app;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('tools routes', () => {
  const defaultEnv = { ADMIN_SECRET_KEY: 'test-admin-key' };
  const app = createToolsApp(defaultEnv);
  const authHeaders = { Authorization: 'Bearer valid-token' };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ADMIN_SECRET_KEY = 'test-admin-key';
    jwtMocks.verifyAccessToken.mockResolvedValue({ sub: 'user-123', email: 'agent@example.com' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('POST /tools', () => {
    it('returns 401 when Authorization header is missing', async () => {
      const response = await app.request(
        jsonRequest('/tools', { name: 'Test Tool', type: 'client' }),
      );
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({
        statusCode: 401,
        message: 'Authorization header is missing',
      });
    });

    it('rejects invalid tool creation payloads', async () => {
      // Missing connector_type for mcp
      const response = await app.request(
        jsonRequest('/tools', { name: 'MCP Tool', type: 'mcp' }, 'POST', authHeaders),
      );
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        statusCode: 400,
        message: ['connector_type is required when type is "mcp"'],
      });
      expect(dbMocks.query).not.toHaveBeenCalled();
    });

    it('creates a client tool shell in draft status', async () => {
      const createdToolRow = {
        id: 'tool-1',
        owner_id: 'user-123',
        name: 'Web Scraper',
        description: 'Scrapes HTML pages',
        type: 'client',
        status: 'draft',
        is_public: false,
        allow_client_execution: false,
        connector_type: null,
        current_version_id: null,
        is_archived: false,
        created_at: '2026-09-20T12:00:00.000Z',
        updated_at: '2026-09-20T12:00:00.000Z',
      };

      dbMocks.query.mockResolvedValueOnce({ rows: [createdToolRow] });

      const response = await app.request(
        jsonRequest(
          '/tools',
          {
            name: 'Web Scraper',
            description: 'Scrapes HTML pages',
            type: 'client',
          },
          'POST',
          authHeaders,
        ),
      );

      expect(response.status).toBe(201);
      expect(await response.json()).toEqual(createdToolRow);
      expect(dbMocks.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO public.tools'),
        ['user-123', 'Web Scraper', 'Scrapes HTML pages', 'client', null, false, false],
      );
    });

    it('creates an MCP tool shell with connector_type', async () => {
      const createdMcpRow = {
        id: 'tool-2',
        owner_id: 'user-123',
        name: 'GitHub Connector',
        description: null,
        type: 'mcp',
        status: 'draft',
        is_public: true,
        allow_client_execution: false,
        connector_type: 'github',
        current_version_id: null,
        is_archived: false,
        created_at: '2026-09-20T12:00:00.000Z',
        updated_at: '2026-09-20T12:00:00.000Z',
      };

      dbMocks.query.mockResolvedValueOnce({ rows: [createdMcpRow] });

      const response = await app.request(
        jsonRequest(
          '/tools',
          {
            name: 'GitHub Connector',
            type: 'mcp',
            connector_type: 'github',
            is_public: true,
          },
          'POST',
          authHeaders,
        ),
      );

      expect(response.status).toBe(201);
      expect(await response.json()).toEqual(createdMcpRow);
      expect(dbMocks.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO public.tools'),
        ['user-123', 'GitHub Connector', null, 'mcp', 'github', true, false],
      );
    });
  });
});
