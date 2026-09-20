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

  describe('POST /tools/:id/versions', () => {
    const validVersionPayload = {
      code: 'export default () => "executed";',
      schema_json: { type: 'object', properties: {} },
      capabilities_json: ['network'],
    };

    it('returns 404 if tool does not exist or is archived', async () => {
      dbMocks.query.mockResolvedValueOnce({ rows: [] });

      const response = await app.request(
        jsonRequest('/tools/non-existent/versions', validVersionPayload, 'POST', authHeaders),
      );

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({
        statusCode: 404,
        message: 'Tool non-existent not found',
      });
    });

    it('returns 403 if caller is not the tool owner', async () => {
      dbMocks.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'tool-1',
            owner_id: 'different-user',
            type: 'client',
            status: 'draft',
            is_archived: false,
          },
        ],
      });

      const response = await app.request(
        jsonRequest('/tools/tool-1/versions', validVersionPayload, 'POST', authHeaders),
      );

      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({
        statusCode: 403,
        message: 'You do not have permission to modify this tool',
      });
    });

    it('returns 400 when client tool is missing code', async () => {
      dbMocks.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'tool-1',
            owner_id: 'user-123',
            type: 'client',
            status: 'draft',
            is_archived: false,
          },
        ],
      });

      const response = await app.request(
        jsonRequest(
          '/tools/tool-1/versions',
          { schema_json: { type: 'object' } },
          'POST',
          authHeaders,
        ),
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        statusCode: 400,
        message: 'code is required for client tools',
      });
    });

    it('returns 400 when mcp tool includes code', async () => {
      dbMocks.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'tool-2',
            owner_id: 'user-123',
            type: 'mcp',
            status: 'draft',
            is_archived: false,
          },
        ],
      });

      const response = await app.request(
        jsonRequest(
          '/tools/tool-2/versions',
          { code: 'console.log()', schema_json: { type: 'object' } },
          'POST',
          authHeaders,
        ),
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        statusCode: 400,
        message: 'code must not be provided for mcp tools',
      });
    });

    it('creates client tool version atomically and computes code_hash', async () => {
      const versionRow = {
        id: 'ver-1',
        tool_id: 'tool-1',
        version_number: 1,
        code: validVersionPayload.code,
        schema_json: validVersionPayload.schema_json,
        capabilities_json: validVersionPayload.capabilities_json,
        code_hash: 'mock-hash',
        test_results_json: null,
        created_at: '2026-09-20T12:00:00.000Z',
      };

      dbMocks.query
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'tool-1',
              owner_id: 'user-123',
              type: 'client',
              status: 'draft',
              is_archived: false,
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [versionRow] });

      const response = await app.request(
        jsonRequest('/tools/tool-1/versions', validVersionPayload, 'POST', authHeaders),
      );

      expect(response.status).toBe(201);
      expect(await response.json()).toEqual(versionRow);
      expect(dbMocks.query).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('SELECT id, tool_id, version_number, code'),
        ['tool-1', validVersionPayload.code, JSON.stringify(validVersionPayload.schema_json), JSON.stringify(validVersionPayload.capabilities_json), expect.any(String)],
      );
    });

    it('creates mcp tool version and resets status to testing holding state', async () => {
      const mcpVersionPayload = {
        schema_json: { type: 'object' },
        capabilities_json: [],
      };

      const versionRow = {
        id: 'ver-2',
        tool_id: 'tool-2',
        version_number: 1,
        code: null,
        schema_json: mcpVersionPayload.schema_json,
        capabilities_json: [],
        code_hash: null,
        test_results_json: null,
        created_at: '2026-09-20T12:00:00.000Z',
      };

      dbMocks.query
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'tool-2',
              owner_id: 'user-123',
              type: 'mcp',
              status: 'draft',
              is_archived: false,
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [] }) // UPDATE status = 'testing'
        .mockResolvedValueOnce({ rows: [versionRow] }); // create_tool_version RPC

      const response = await app.request(
        jsonRequest('/tools/tool-2/versions', mcpVersionPayload, 'POST', authHeaders),
      );

      expect(response.status).toBe(201);
      expect(await response.json()).toEqual(versionRow);

      // Verify MCP holding update
      expect(dbMocks.query).toHaveBeenNthCalledWith(
        2,
        "UPDATE public.tools SET status = 'testing', updated_at = now() WHERE id = $1",
        ['tool-2'],
      );
    });
  });

  describe('GET /tools', () => {
    const mockToolRow = {
      id: 'tool-1',
      owner_id: 'user-123',
      name: 'My Tool',
      description: 'Test description',
      type: 'client',
      status: 'verified',
      is_public: false,
      allow_client_execution: false,
      connector_type: null,
      current_version_id: 'ver-1',
      is_archived: false,
      created_at: '2026-09-20T12:00:00.000Z',
      updated_at: '2026-09-20T12:00:00.000Z',
      current_version_number: 1,
      current_code: 'export default () => {}',
      current_schema_json: { type: 'object' },
      current_capabilities_json: [],
      current_code_hash: 'hash-1',
      current_test_results_json: null,
      current_version_created_at: '2026-09-20T12:00:00.000Z',
    };

    it('returns caller owned tools excluding archived', async () => {
      dbMocks.query.mockResolvedValueOnce({ rows: [mockToolRow] });

      const response = await app.request(
        new Request('http://localhost/tools', { headers: authHeaders }),
      );

      expect(response.status).toBe(200);
      const data = await response.json() as any[];
      expect(data).toHaveLength(1);
      expect(data[0].id).toBe('tool-1');
      expect(data[0].current_version).toBeDefined();
      expect(data[0].current_version.version_number).toBe(1);

      expect(dbMocks.query).toHaveBeenCalledWith(
        expect.stringContaining('t.is_archived = false AND t.owner_id = $1'),
        ['user-123'],
      );
    });

    it('supports include_public parameter', async () => {
      dbMocks.query.mockResolvedValueOnce({ rows: [mockToolRow] });

      const response = await app.request(
        new Request('http://localhost/tools?include_public=true', { headers: authHeaders }),
      );

      expect(response.status).toBe(200);
      expect(dbMocks.query).toHaveBeenCalledWith(
        expect.stringContaining("(t.owner_id = $1 OR (t.is_public = true AND t.status = 'verified'))"),
        ['user-123'],
      );
    });

    it('allows admin with x-admin-key to include archived tools', async () => {
      dbMocks.query.mockResolvedValueOnce({ rows: [] });

      const response = await app.request(
        new Request('http://localhost/tools?include_archived=true', {
          headers: { ...authHeaders, 'x-admin-key': 'test-admin-key' },
        }),
      );

      expect(response.status).toBe(200);
      // Non-admin filter `t.is_archived = false` is omitted for admin with include_archived=true
      expect(dbMocks.query).toHaveBeenCalledWith(
        expect.not.stringContaining('t.is_archived = false'),
        ['user-123'],
      );
    });
  });

  describe('GET /tools/:id', () => {
    const mockToolRow = {
      id: 'tool-1',
      owner_id: 'user-123',
      name: 'My Tool',
      description: 'Test',
      type: 'client',
      status: 'draft',
      is_public: false,
      allow_client_execution: false,
      connector_type: null,
      current_version_id: null,
      is_archived: false,
      created_at: '2026-09-20T12:00:00.000Z',
      updated_at: '2026-09-20T12:00:00.000Z',
      current_version_number: null,
      current_code: null,
      current_schema_json: null,
      current_capabilities_json: null,
      current_code_hash: null,
      current_test_results_json: null,
      current_version_created_at: null,
    };

    it('returns tool for owner', async () => {
      dbMocks.query.mockResolvedValueOnce({ rows: [mockToolRow] });

      const response = await app.request(
        new Request('http://localhost/tools/tool-1', { headers: authHeaders }),
      );

      expect(response.status).toBe(200);
      const data = await response.json() as any;
      expect(data.id).toBe('tool-1');
      expect(data.current_version).toBeNull();
    });

    it('returns 404 for archived tool when requested by regular user', async () => {
      dbMocks.query.mockResolvedValueOnce({
        rows: [{ ...mockToolRow, is_archived: true }],
      });

      const response = await app.request(
        new Request('http://localhost/tools/tool-1', { headers: authHeaders }),
      );

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({
        statusCode: 404,
        message: 'Tool tool-1 not found',
      });
    });

    it('returns archived tool when requested by admin with x-admin-key', async () => {
      dbMocks.query.mockResolvedValueOnce({
        rows: [{ ...mockToolRow, is_archived: true }],
      });

      const response = await app.request(
        new Request('http://localhost/tools/tool-1', {
          headers: { ...authHeaders, 'x-admin-key': 'test-admin-key' },
        }),
      );

      expect(response.status).toBe(200);
      const data = await response.json() as any;
      expect(data.id).toBe('tool-1');
      expect(data.is_archived).toBe(true);
    });

    it('returns 404 when tool belongs to another user and is not public verified', async () => {
      dbMocks.query.mockResolvedValueOnce({
        rows: [{ ...mockToolRow, owner_id: 'other-user', is_public: false }],
      });

      const response = await app.request(
        new Request('http://localhost/tools/tool-1', { headers: authHeaders }),
      );

      expect(response.status).toBe(404);
    });

    it('returns tool when tool belongs to another user but is public verified', async () => {
      dbMocks.query.mockResolvedValueOnce({
        rows: [{ ...mockToolRow, owner_id: 'other-user', is_public: true, status: 'verified' }],
      });

      const response = await app.request(
        new Request('http://localhost/tools/tool-1', { headers: authHeaders }),
      );

      expect(response.status).toBe(200);
    });
  });

  describe('GET /tools/:id/versions', () => {
    it('returns version history ordered by version number descending', async () => {
      // 1. verifyToolAccess query
      dbMocks.query.mockResolvedValueOnce({
        rows: [{ id: 'tool-1', owner_id: 'user-123', is_public: false, status: 'draft', is_archived: false }],
      });
      // 2. tool_versions query
      const versions = [
        { id: 'v-2', tool_id: 'tool-1', version_number: 2, code: 'v2' },
        { id: 'v-1', tool_id: 'tool-1', version_number: 1, code: 'v1' },
      ];
      dbMocks.query.mockResolvedValueOnce({ rows: versions });

      const response = await app.request(
        new Request('http://localhost/tools/tool-1/versions', { headers: authHeaders }),
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(versions);
    });
  });

  describe('GET /tools/:id/versions/:versionNumber', () => {
    it('returns specific version payload', async () => {
      dbMocks.query.mockResolvedValueOnce({
        rows: [{ id: 'tool-1', owner_id: 'user-123', is_public: false, status: 'draft', is_archived: false }],
      });
      const version = { id: 'v-1', tool_id: 'tool-1', version_number: 1, code: 'v1' };
      dbMocks.query.mockResolvedValueOnce({ rows: [version] });

      const response = await app.request(
        new Request('http://localhost/tools/tool-1/versions/1', { headers: authHeaders }),
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(version);
    });

    it('returns 404 when version number is not found', async () => {
      dbMocks.query.mockResolvedValueOnce({
        rows: [{ id: 'tool-1', owner_id: 'user-123', is_public: false, status: 'draft', is_archived: false }],
      });
      dbMocks.query.mockResolvedValueOnce({ rows: [] });

      const response = await app.request(
        new Request('http://localhost/tools/tool-1/versions/99', { headers: authHeaders }),
      );

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({
        statusCode: 404,
        message: 'Version 99 not found for tool tool-1',
      });
    });
  });

  describe('GET /tools/:id/diff', () => {
    it('returns comparative diff payload between two versions', async () => {
      dbMocks.query.mockResolvedValueOnce({
        rows: [{ id: 'tool-1', owner_id: 'user-123', is_public: false, status: 'draft', is_archived: false }],
      });
      const v1 = { id: 'v-1', tool_id: 'tool-1', version_number: 1, code: 'code1', schema_json: { a: 1 } };
      const v2 = { id: 'v-2', tool_id: 'tool-1', version_number: 2, code: 'code2', schema_json: { a: 1 } };
      dbMocks.query.mockResolvedValueOnce({ rows: [v1, v2] });

      const response = await app.request(
        new Request('http://localhost/tools/tool-1/diff?from=1&to=2', { headers: authHeaders }),
      );

      expect(response.status).toBe(200);
      const data = await response.json() as any;
      expect(data.tool_id).toBe('tool-1');
      expect(data.from.version_number).toBe(1);
      expect(data.to.version_number).toBe(2);
      expect(data.diff.code_changed).toBe(true);
      expect(data.diff.schema_changed).toBe(false);
    });

    it('returns 400 when from or to parameters are missing/invalid', async () => {
      dbMocks.query.mockResolvedValueOnce({
        rows: [{ id: 'tool-1', owner_id: 'user-123', is_public: false, status: 'draft', is_archived: false }],
      });

      const response = await app.request(
        new Request('http://localhost/tools/tool-1/diff?from=abc', { headers: authHeaders }),
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        statusCode: 400,
        message: 'Both "from" and "to" query parameters must be valid integer version numbers',
      });
    });
  });
});
