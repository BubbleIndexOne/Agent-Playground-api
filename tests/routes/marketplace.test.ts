import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';

// ─── Mock: database query ─────────────────────────────────────────────────────

const dbMocks = vi.hoisted(() => ({
  query: vi.fn(),
}));

vi.mock('../../src/services/database', () => ({
  query: dbMocks.query,
  withTransaction: vi.fn((cb: (client: { query: typeof dbMocks.query }) => Promise<unknown>) =>
    cb({ query: dbMocks.query }),
  ),
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

import { marketplaceRouter } from '../../src/routes/marketplace';

function createApp(env: Record<string, unknown> = {}) {
  const app = new Hono<{ Bindings: Record<string, unknown> }>();
  app.use('*', async (c, next) => {
    c.env = Object.assign({}, c.env, env);
    await next();
  });
  app.route('/marketplace', marketplaceRouter);
  app.onError((error, c) => {
    if (error instanceof HTTPException) {
      return c.json({ statusCode: error.status, message: error.message }, error.status);
    }
    throw error;
  });
  return app;
}

describe('Marketplace Discovery, Version Pinning, Forking, and Moderation', () => {
  const defaultEnv = { TOOL_REPORT_AUTOHOLD_THRESHOLD: '5', ENVIRONMENT: 'dev' };
  const app = createApp(defaultEnv);
  const authHeaders = { Authorization: 'Bearer valid-user-token' };

  beforeEach(() => {
    vi.clearAllMocks();
    jwtMocks.verifyAccessToken.mockResolvedValue({ sub: 'user-visitor-1', email: 'visitor@example.com' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('GET /marketplace/tools', () => {
    it('returns public registered tools with safe metadata and pagination', async () => {
      const mockTools = [
        {
          id: 'tool-uuid-1',
          owner_id: 'owner-uuid-1',
          name: 'Web Scraper',
          description: 'Extracts data cleanly',
          type: 'client',
          connector_type: null,
          visibility: 'public',
          slug: 'alice/web-scraper',
          tags: ['scraping', 'web'],
          install_count: 42,
          allow_client_execution: true,
          is_mcp_hosted: false,
          mcp_hosting_status: 'none',
          created_at: '2026-10-01T00:00:00Z',
          updated_at: '2026-10-05T00:00:00Z',
          author_handle: 'alice',
          author_name: 'Alice Developer',
          current_version_number: 1,
          capabilities_json: ['network:http_get'],
          test_results_json: { passed: true },
        },
      ];

      dbMocks.query.mockResolvedValueOnce({ rows: mockTools });

      const res = await app.request('/marketplace/tools');
      expect(res.status).toBe(200);
      const data = await res.json();

      expect(data.success).toBe(true);
      expect(data.tools).toHaveLength(1);
      expect(data.tools[0].name).toBe('Web Scraper');
      expect(data.tools[0].slug).toBe('alice/web-scraper');
      expect(data.tools[0].install_count).toBe(42);
      expect(data.tools[0].code).toBeUndefined(); // code must never be returned
      expect(data.pagination.has_more).toBe(false);
    });

    it('filters by search term, connector, and tags', async () => {
      dbMocks.query.mockResolvedValueOnce({ rows: [] });

      const res = await app.request('/marketplace/tools?q=scraper&connector=slack&tag=search&sort=recent');
      expect(res.status).toBe(200);

      const queryCall = dbMocks.query.mock.calls[0];
      const sql = queryCall[0] as string;
      const params = queryCall[1] as any[];

      expect(sql).toContain('to_tsvector');
      expect(sql).toContain('t.connector_type =');
      expect(sql).toContain('= ANY(t.tags)');
      expect(sql).toContain('ORDER BY t.created_at DESC');
      expect(params).toContain('slack');
      expect(params).toContain('search');
    });

    it('returns cursor for pagination when results exceed limit', async () => {
      // Mock 3 items returned when limit is 2
      const items = [
        { id: 'tool-1', name: 'Tool 1', visibility: 'public', tags: [], allow_client_execution: true },
        { id: 'tool-2', name: 'Tool 2', visibility: 'public', tags: [], allow_client_execution: true },
        { id: 'tool-3', name: 'Tool 3', visibility: 'public', tags: [], allow_client_execution: true },
      ];

      dbMocks.query.mockResolvedValueOnce({ rows: items });

      const res = await app.request('/marketplace/tools?limit=2');
      expect(res.status).toBe(200);
      const data = await res.json();

      expect(data.tools).toHaveLength(2);
      expect(data.pagination.has_more).toBe(true);
      expect(data.pagination.next_cursor).toBeDefined();

      const decodedOffset = Buffer.from(data.pagination.next_cursor, 'base64').toString('utf8');
      expect(decodedOffset).toBe('2');
    });
  });

  describe('GET /marketplace/tools/:idOrSlug', () => {
    const toolRow = {
      id: 'tool-uuid-1',
      owner_id: 'author-uuid-1',
      name: 'Web Scraper',
      description: 'Clean scraper',
      type: 'client',
      connector_type: null,
      visibility: 'public',
      slug: 'alice/web-scraper',
      tags: ['web'],
      install_count: 10,
      allow_client_execution: true,
      is_mcp_hosted: false,
      mcp_hosting_status: 'none',
      is_archived: false,
      status: 'registered',
      current_version_id: 'version-1',
      created_at: '2026-10-01T00:00:00Z',
      updated_at: '2026-10-05T00:00:00Z',
      author_handle: 'alice',
      author_name: 'Alice Developer',
      current_version_number: 1,
      schema_json: { type: 'object' },
      capabilities_json: ['network:http_get'],
      code_hash: 'hash-abc',
      test_results_json: { passed: true },
    };

    it('returns detailed metadata by slug without code', async () => {
      dbMocks.query
        .mockResolvedValueOnce({ rows: [toolRow] }) // tool lookup
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'version-1',
              version_number: 1,
              schema_json: { type: 'object' },
              capabilities_json: ['network:http_get'],
              code_hash: 'hash-abc',
              created_at: '2026-10-01T00:00:00Z',
            },
          ],
        }); // version history

      const res = await app.request('/marketplace/tools/alice/web-scraper');
      expect(res.status).toBe(200);
      const data = await res.json();

      expect(data.success).toBe(true);
      expect(data.tool.id).toBe('tool-uuid-1');
      expect(data.tool.author.handle).toBe('alice');
      expect(data.tool.current_version.code_hash).toBe('hash-abc');
      expect(data.tool.current_version.code).toBeUndefined();
      expect(data.tool.versions[0].code).toBeUndefined();
    });

    it('returns 404 for unknown tools', async () => {
      dbMocks.query.mockResolvedValueOnce({ rows: [] });

      const res = await app.request('/marketplace/tools/non-existent-tool');
      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.message).toContain('not found');
    });
  });

  describe('POST /marketplace/tools/:id/install and DELETE /marketplace/tools/:id/install', () => {
    const toolId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    const versionId = 'v1b2c3d4-e5f6-7890-abcd-ef1234567890';

    it('installs and pins a tool version to caller account', async () => {
      dbMocks.query
        .mockResolvedValueOnce({
          rows: [{ id: toolId, name: 'Web Scraper', current_version_id: versionId, is_archived: false, status: 'registered' }],
        }) // tool check
        .mockResolvedValueOnce({
          rows: [{ user_id: 'user-visitor-1', tool_id: toolId, pinned_version_id: versionId, installed_at: '2026-11-01T00:00:00Z' }],
        }) // insert tool_installs
        .mockResolvedValueOnce({ rows: [] }); // update install_count

      const res = await app.request(`/marketplace/tools/${toolId}/install`, {
        method: 'POST',
        headers: authHeaders,
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.message).toContain('successfully installed');
      expect(data.install.pinned_version_id).toBe(versionId);

      // Verify incremented install_count
      const updateCall = dbMocks.query.mock.calls[2];
      expect(updateCall[0]).toContain('SET install_count = coalesce(install_count, 0) + 1');
    });

    it('uninstalls tool from caller account and decrements install_count', async () => {
      dbMocks.query
        .mockResolvedValueOnce({ rows: [{ tool_id: toolId }] }) // delete tool_installs
        .mockResolvedValueOnce({ rows: [] }); // decrement install_count

      const res = await app.request(`/marketplace/tools/${toolId}/install`, {
        method: 'DELETE',
        headers: authHeaders,
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.message).toContain('successfully uninstalled');

      // Verify decremented install_count
      const updateCall = dbMocks.query.mock.calls[1];
      expect(updateCall[0]).toContain('SET install_count = greatest(0, coalesce(install_count, 1) - 1)');
    });

    it('returns 404 when attempting to uninstall a tool not in account', async () => {
      dbMocks.query.mockResolvedValueOnce({ rows: [] });

      const res = await app.request(`/marketplace/tools/${toolId}/install`, {
        method: 'DELETE',
        headers: authHeaders,
      });

      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.message).toContain('not installed');
    });
  });

  describe('POST /marketplace/tools/:id/fork', () => {
    const openSourceToolId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    const protectedToolId = 'b2c3d4e5-f6a7-8901-bcde-f12345678901';

    it('successfully forks an open-source tool into caller workspace', async () => {
      dbMocks.query
        .mockResolvedValueOnce({
          rows: [
            {
              id: openSourceToolId,
              name: 'Open Scraper',
              description: 'Open source web tool',
              type: 'client',
              current_version_id: 'ver-1',
              allow_client_execution: true,
              is_mcp_hosted: false,
              is_archived: false,
            },
          ],
        }) // tool check
        .mockResolvedValueOnce({
          rows: [
            {
              code: 'export default async function run() { return { ok: true }; }',
              schema_json: { type: 'object' },
              capabilities_json: ['network:http_get'],
            },
          ],
        }) // tool_sources lookup
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'forked-tool-uuid',
              name: 'Fork of Open Scraper',
              description: 'Open source web tool',
              type: 'client',
              status: 'draft',
              is_public: false,
              visibility: 'private',
              allow_client_execution: true,
              created_at: '2026-11-01T00:00:00Z',
            },
          ],
        }) // create tool
        .mockResolvedValueOnce({
          rows: [{ id: 'forked-version-uuid', version_number: 1 }],
        }); // create_tool_version RPC

      const res = await app.request(`/marketplace/tools/${openSourceToolId}/fork`, {
        method: 'POST',
        headers: authHeaders,
      });

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.message).toContain('successfully forked');
      expect(data.tool.name).toBe('Fork of Open Scraper');
      expect(data.tool.status).toBe('draft');
      expect(data.tool.visibility).toBe('private');
    });

    it('rejects forking of protected server/MCP hosted tools with 403 Forbidden', async () => {
      dbMocks.query.mockResolvedValueOnce({
        rows: [
          {
            id: protectedToolId,
            name: 'Protected MCP Tool',
            description: 'Proprietary tool',
            type: 'client',
            current_version_id: 'ver-2',
            allow_client_execution: false,
            is_mcp_hosted: true,
            is_archived: false,
          },
        ],
      });

      const res = await app.request(`/marketplace/tools/${protectedToolId}/fork`, {
        method: 'POST',
        headers: authHeaders,
      });

      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.message).toContain('Protected server tools cannot be forked');
    });
  });

  describe('POST /marketplace/tools/:id/report (Moderation & Auto-Hold)', () => {
    const reportedToolId = 'c3d4e5f6-a7b8-9012-cdef-123456789012';

    it('accepts valid report and returns received status when below threshold', async () => {
      dbMocks.query
        .mockResolvedValueOnce({
          rows: [{ id: reportedToolId, name: 'Reported Tool', visibility: 'public', is_public: true, is_archived: false }],
        }) // tool check
        .mockResolvedValueOnce({ rows: [] }) // insert tool_reports
        .mockResolvedValueOnce({ rows: [{ count: 1 }] }); // count distinct reporters = 1 (< 5)

      const res = await app.request(`/marketplace/tools/${reportedToolId}/report`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'spam', details: 'Unsolicited links in tool response' }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.reported).toBe(true);
      expect(data.status).toBe('received');
      expect(data.message).toContain('keeping the marketplace safe');
    });

    it('deduplicates open reports from the same user with 409 Conflict', async () => {
      const uniqueConstraintError: any = new Error('duplicate key value violates unique constraint "idx_tool_reports_user_open"');
      uniqueConstraintError.code = '23505';

      dbMocks.query
        .mockResolvedValueOnce({
          rows: [{ id: reportedToolId, name: 'Reported Tool', visibility: 'public', is_public: true, is_archived: false }],
        }) // tool check
        .mockRejectedValueOnce(uniqueConstraintError); // insert tool_reports fails with 23505

      const res = await app.request(`/marketplace/tools/${reportedToolId}/report`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'malicious', details: 'Malicious code detected' }),
      });

      expect(res.status).toBe(409);
      const data = await res.json();
      expect(data.message).toContain('already have an open report pending review');
    });

    it('triggers auto-hold (flips visibility to unlisted) when open reports reach threshold', async () => {
      // Threshold in dev is 5
      dbMocks.query
        .mockResolvedValueOnce({
          rows: [{ id: reportedToolId, name: 'Reported Tool', visibility: 'public', is_public: true, is_archived: false }],
        }) // tool check
        .mockResolvedValueOnce({ rows: [] }) // insert tool_reports
        .mockResolvedValueOnce({ rows: [{ count: 5 }] }) // count = 5 (>= threshold 5)
        .mockResolvedValueOnce({ rows: [] }); // update tools SET visibility = 'unlisted'

      const res = await app.request(`/marketplace/tools/${reportedToolId}/report`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'malicious', details: 'Exploitative payload' }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.status).toBe('under_review');
      expect(data.message).toContain('administrative review hold');

      // Verify the auto-hold query was executed
      const updateCall = dbMocks.query.mock.calls[3];
      expect(updateCall[0]).toContain("SET visibility = 'unlisted'");
      expect(updateCall[0]).toContain('is_public = false');
    });

    it('enforces stricter auto-hold threshold (3) in production environment', async () => {
      const prodApp = createApp({ ENVIRONMENT: 'production' }); // no explicit threshold -> defaults to 3 for prod

      dbMocks.query
        .mockResolvedValueOnce({
          rows: [{ id: reportedToolId, name: 'Reported Tool', visibility: 'public', is_public: true, is_archived: false }],
        }) // tool check
        .mockResolvedValueOnce({ rows: [] }) // insert tool_reports
        .mockResolvedValueOnce({ rows: [{ count: 3 }] }) // count = 3 (>= threshold 3)
        .mockResolvedValueOnce({ rows: [] }); // update tools SET visibility = 'unlisted'

      const res = await prodApp.request(`/marketplace/tools/${reportedToolId}/report`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'broken', details: 'Endpoints throwing 500' }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.status).toBe('under_review');
      expect(data.message).toContain('administrative review hold');
    });
  });
});

