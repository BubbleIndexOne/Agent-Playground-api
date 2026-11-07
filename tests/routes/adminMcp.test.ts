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

import { adminMcpRouter } from '../../src/routes/adminMcp';
import { internalMcpRouter } from '../../src/routes/internalMcp';
import { toolsRouter } from '../../src/routes/tools';

function createApp(env: Record<string, unknown> = {}) {
  const app = new Hono<{ Bindings: Record<string, unknown> }>();
  app.use('*', async (c, next) => {
    c.env = Object.assign({}, c.env, env);
    await next();
  });
  app.route('/tools', toolsRouter);
  app.route('/admin/mcp', adminMcpRouter);
  app.route('/internal/mcp', internalMcpRouter);
  app.onError((error, c) => {
    if (error instanceof HTTPException) {
      return c.json({ statusCode: error.status, message: error.message }, error.status);
    }
    throw error;
  });
  return app;
}

describe('Milestone 2: MCP Hosting Lifecycle & Admin Automation Pipeline', () => {
  const defaultEnv = { ADMIN_SECRET_KEY: 'super-admin-key' };
  const app = createApp(defaultEnv);
  const authHeaders = { Authorization: 'Bearer valid-user-token' };
  const adminHeaders = { 'x-admin-key': 'super-admin-key' };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ADMIN_SECRET_KEY = 'super-admin-key';
    jwtMocks.verifyAccessToken.mockResolvedValue({ sub: 'user-author', email: 'author@example.com' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Admin Automation Gating (x-admin-key ONLY)', () => {
    it('rejects GET /admin/mcp/queue without x-admin-key', async () => {
      const response = await app.request(new Request('http://localhost/admin/mcp/queue'));
      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.message).toContain('valid x-admin-key header is required');
    });

    it('rejects POST /admin/mcp/:id/promote when authenticated ONLY with Bearer JWT', async () => {
      // User requirement: Promotion endpoint accepts x-admin-key ONLY.
      const response = await app.request(
        new Request('http://localhost/admin/mcp/tool-1/promote', {
          method: 'POST',
          headers: authHeaders, // Has Bearer token, but NO x-admin-key!
        }),
      );
      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.message).toContain('valid x-admin-key header is required');
    });

    it('allows GET /admin/mcp/queue with valid x-admin-key', async () => {
      dbMocks.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'tool-queue-1',
            name: 'Vector Database Search',
            mcp_hosting_status: 'requested',
            code: 'export default function() {}',
          },
        ],
      });

      const response = await app.request(
        new Request('http://localhost/admin/mcp/queue', { headers: adminHeaders }),
      );

      expect(response.status).toBe(200);
      const data = (await response.json()) as any;
      expect(data.success).toBe(true);
      expect(data.count).toBe(1);
      expect(data.queue[0].name).toBe('Vector Database Search');
    });

    it('successfully promotes tool via POST /admin/mcp/:id/promote with x-admin-key', async () => {
      dbMocks.query.mockResolvedValueOnce({
        rows: [{ id: 'tool-1', name: 'Verified Tool', owner_id: 'user-author', is_archived: false }],
      });
      dbMocks.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'tool-1',
            name: 'Verified Tool',
            is_mcp_hosted: true,
            mcp_hosting_status: 'approved',
            mcp_promoted_at: '2026-11-01T23:00:00.000Z',
            visibility: 'public',
            is_public: true,
          },
        ],
      });

      const response = await app.request(
        new Request('http://localhost/admin/mcp/tool-1/promote', {
          method: 'POST',
          headers: adminHeaders,
        }),
      );

      expect(response.status).toBe(200);
      const data = (await response.json()) as any;
      expect(data.success).toBe(true);
      expect(data.tool.is_mcp_hosted).toBe(true);
      expect(data.tool.mcp_hosting_status).toBe('approved');
    });

    it('rejects tool via POST /admin/mcp/:id/reject with reason', async () => {
      dbMocks.query.mockResolvedValueOnce({
        rows: [{ id: 'tool-1', name: 'Malicious Tool', is_archived: false }],
      });
      dbMocks.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'tool-1',
            name: 'Malicious Tool',
            is_mcp_hosted: false,
            mcp_hosting_status: 'rejected',
            mcp_review_notes: 'Excessive memory usage in sandbox isolate',
          },
        ],
      });

      const response = await app.request(
        new Request('http://localhost/admin/mcp/tool-1/reject', {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...adminHeaders },
          body: JSON.stringify({ reason: 'Excessive memory usage in sandbox isolate' }),
        }),
      );

      expect(response.status).toBe(200);
      const data = (await response.json()) as any;
      expect(data.success).toBe(true);
      expect(data.tool.mcp_hosting_status).toBe('rejected');
      expect(data.tool.mcp_review_notes).toBe('Excessive memory usage in sandbox isolate');
    });
  });

  describe('End-User MCP Hosting Requests', () => {
    it('allows tool owner to submit request on registered tool', async () => {
      dbMocks.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'tool-reg',
            owner_id: 'user-author',
            name: 'Registered Tool',
            status: 'registered',
            is_mcp_hosted: false,
            mcp_hosting_status: 'none',
            is_archived: false,
          },
        ],
      });
      dbMocks.query.mockResolvedValueOnce({
        rows: [{ id: 'tool-reg', name: 'Registered Tool', mcp_hosting_status: 'requested', is_mcp_hosted: false }],
      });

      const response = await app.request(
        new Request('http://localhost/tools/tool-reg/mcp-request', {
          method: 'POST',
          headers: authHeaders,
        }),
      );

      expect(response.status).toBe(200);
      const data = (await response.json()) as any;
      expect(data.success).toBe(true);
      expect(data.tool.mcp_hosting_status).toBe('requested');
    });

    it('rejects MCP request on draft / unverified tool', async () => {
      dbMocks.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'tool-draft',
            owner_id: 'user-author',
            name: 'Draft Tool',
            status: 'draft', // 💥 Not registered
            is_mcp_hosted: false,
            mcp_hosting_status: 'none',
            is_archived: false,
          },
        ],
      });

      const response = await app.request(
        new Request('http://localhost/tools/tool-draft/mcp-request', {
          method: 'POST',
          headers: authHeaders,
        }),
      );

      expect(response.status).toBe(400);
      const data = (await response.json()) as any;
      expect(data.message).toContain('must be tested and registered');
    });

    it('allows author to cancel pending MCP request', async () => {
      dbMocks.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'tool-pending',
            owner_id: 'user-author',
            name: 'Pending Tool',
            is_mcp_hosted: false,
            mcp_hosting_status: 'requested',
            is_archived: false,
          },
        ],
      });
      dbMocks.query.mockResolvedValueOnce({
        rows: [{ id: 'tool-pending', name: 'Pending Tool', mcp_hosting_status: 'none', is_mcp_hosted: false }],
      });

      const response = await app.request(
        new Request('http://localhost/tools/tool-pending/mcp-request', {
          method: 'DELETE',
          headers: authHeaders,
        }),
      );

      expect(response.status).toBe(200);
      const data = (await response.json()) as any;
      expect(data.success).toBe(true);
      expect(data.tool.mcp_hosting_status).toBe('none');
    });
  });

  describe('Internal MCP Server Sync Hook (/internal/mcp/tools)', () => {
    it('rejects unauthenticated internal sync requests', async () => {
      const response = await app.request(new Request('http://localhost/internal/mcp/tools'));
      expect(response.status).toBe(401);
    });

    it('returns approved tools and code to Agent-Playground-MCP with admin key', async () => {
      dbMocks.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'mcp-tool-1',
            name: 'Cloudflare DNS Lookup',
            code: 'export default async function() {}',
            schema_json: { properties: {} },
            capabilities_json: ['network:fetch'],
          },
        ],
      });

      const response = await app.request(
        new Request('http://localhost/internal/mcp/tools', { headers: adminHeaders }),
      );

      expect(response.status).toBe(200);
      const data = (await response.json()) as any;
      expect(data.success).toBe(true);
      expect(data.count).toBe(1);
      expect(data.tools[0].name).toBe('Cloudflare DNS Lookup');
      expect(data.tools[0].code).toBeDefined();
    });
  });
});

