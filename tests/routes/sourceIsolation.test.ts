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

import { toolsRouter } from '../../src/routes/tools';

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

describe('Milestone 1: Source Code Isolation & Privacy Rules', () => {
  const defaultEnv = { ADMIN_SECRET_KEY: 'test-admin-key' };
  const app = createToolsApp(defaultEnv);
  const authHeaders = { Authorization: 'Bearer valid-token' };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ADMIN_SECRET_KEY = 'test-admin-key';
    jwtMocks.verifyAccessToken.mockResolvedValue({ sub: 'user-visitor', email: 'visitor@example.com' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const protectedPublicTool = {
    id: 'tool-protected',
    owner_id: 'user-author',
    name: 'Proprietary Algorithm Tool',
    description: 'Runs securely on server',
    type: 'client',
    status: 'registered',
    is_public: true,
    visibility: 'public',
    allow_client_execution: false, // 🔒 Protected: execution only in isolate
    connector_type: null,
    current_version_id: 'ver-100',
    is_archived: false,
    is_owner: false,
    created_at: '2026-09-20T12:00:00.000Z',
    updated_at: '2026-09-20T12:00:00.000Z',
    current_version_number: 1,
    current_code: 'export default function secretAlgorithm() { return 42; }',
    current_schema_json: { params: [] },
    current_capabilities_json: [],
    current_code_hash: 'hash-abc-123',
    current_test_results_json: { status: 'passed' },
    current_version_created_at: '2026-09-20T12:00:00.000Z',
  };

  it('masks source code (returns code: null) when non-owner views protected public tool', async () => {
    dbMocks.query.mockResolvedValueOnce({
      rows: [protectedPublicTool],
    });

    const response = await app.request(
      new Request('http://localhost/tools/tool-protected', { headers: authHeaders }),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as any;
    expect(body.id).toBe('tool-protected');
    expect(body.is_owner).toBe(false);
    expect(body.current_version).toBeDefined();
    expect(body.current_version.code).toBeNull(); // 🔒 Strictly masked!
    expect(body.current_version.code_hash).toBe('hash-abc-123'); // Integrity hash preserved
  });

  it('returns full source code when tool author views their own tool', async () => {
    jwtMocks.verifyAccessToken.mockResolvedValueOnce({ sub: 'user-author', email: 'author@example.com' });

    dbMocks.query.mockResolvedValueOnce({
      rows: [{ ...protectedPublicTool, is_owner: true }],
    });

    const response = await app.request(
      new Request('http://localhost/tools/tool-protected', { headers: authHeaders }),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as any;
    expect(body.is_owner).toBe(true);
    expect(body.current_version.code).toBe('export default function secretAlgorithm() { return 42; }');
  });

  it('returns full source code when admin views protected tool with x-admin-key', async () => {
    dbMocks.query.mockResolvedValueOnce({
      rows: [protectedPublicTool],
    });

    const response = await app.request(
      new Request('http://localhost/tools/tool-protected', {
        headers: { ...authHeaders, 'x-admin-key': 'test-admin-key' },
      }),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as any;
    expect(body.current_version.code).toBe('export default function secretAlgorithm() { return 42; }');
  });

  it('returns full source code to any visitor when tool is marked open source (allow_client_execution = true)', async () => {
    const openTool = {
      ...protectedPublicTool,
      allow_client_execution: true, // 🌐 Open source tool
    };

    dbMocks.query.mockResolvedValueOnce({
      rows: [openTool],
    });

    const response = await app.request(
      new Request('http://localhost/tools/tool-protected', { headers: authHeaders }),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as any;
    expect(body.current_version.code).toBe('export default function secretAlgorithm() { return 42; }');
  });

  it('masks code in version history for non-owners on protected tools', async () => {
    // 1. verifyToolAccess query
    dbMocks.query.mockResolvedValueOnce({
      rows: [{
        id: 'tool-protected',
        owner_id: 'user-author',
        is_public: true,
        visibility: 'public',
        allow_client_execution: false,
        status: 'registered',
        is_archived: false,
      }],
    });
    // 2. versions query
    dbMocks.query.mockResolvedValueOnce({
      rows: [
        {
          id: 'v-1',
          tool_id: 'tool-protected',
          version_number: 1,
          code: null, // query returned null because canViewCode was false
          schema_json: {},
          capabilities_json: [],
          code_hash: 'hash-abc',
          test_results_json: null,
          created_at: '2026-09-20T12:00:00.000Z',
        },
      ],
    });

    const response = await app.request(
      new Request('http://localhost/tools/tool-protected/versions', { headers: authHeaders }),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as any[];
    expect(body).toHaveLength(1);
    expect(body[0].code).toBeNull();
  });

  it('rejects publishing a tool that is not in registered status', async () => {
    jwtMocks.verifyAccessToken.mockResolvedValueOnce({ sub: 'user-author', email: 'author@example.com' });

    dbMocks.query.mockResolvedValueOnce({
      rows: [{
        id: 'tool-draft',
        owner_id: 'user-author',
        name: 'Draft Tool',
        description: 'Ready to publish',
        type: 'client',
        status: 'draft', // 💥 Not registered
        is_public: false,
        visibility: 'private',
        allow_client_execution: false,
        is_archived: false,
      }],
    });

    const response = await app.request(
      new Request('http://localhost/tools/tool-draft', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', ...authHeaders },
        body: JSON.stringify({ visibility: 'public' }),
      }),
    );

    expect(response.status).toBe(400);
    const body = (await response.json()) as any;
    expect(body.message).toContain('must be in "registered" status');
  });
});
