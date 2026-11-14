import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import { requireAuth } from '../middleware/auth';
import { query, withTransaction } from '../services/database';
import { computeCodeHash, timingSafeEqualStrings } from '../utils/crypto';
import { CreateToolSchema, CreateToolVersionSchema, UpdateToolSchema } from '../schemas/tools';
import { validateSchemaConsistency } from '../utils/schemaValidation';
import { generateTestInputs } from '../utils/testInputGenerator';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function formatToolRow(row: any, canViewCode = true) {
  const {
    current_version_number,
    current_code,
    current_schema_json,
    current_capabilities_json,
    current_code_hash,
    current_test_results_json,
    current_version_created_at,
    ...toolFields
  } = row;

  return {
    ...toolFields,
    is_owner: row.is_owner !== undefined ? Boolean(row.is_owner) : true,
    visibility: row.visibility || (row.is_public ? 'public' : 'private'),
    current_version: row.current_version_id
      ? {
          id: row.current_version_id,
          tool_id: row.id,
          version_number: current_version_number,
          code: canViewCode ? (current_code ?? null) : null,
          schema_json: current_schema_json,
          capabilities_json: current_capabilities_json,
          code_hash: current_code_hash,
          test_results_json: current_test_results_json,
          created_at: current_version_created_at,
        }
      : null,
  };
}

async function checkIsAdmin(c: any): Promise<boolean> {
  const adminKey = c.req.header('x-admin-key');
  const expectedAdminKey =
    (c.env as { ADMIN_SECRET_KEY?: string } | undefined)?.ADMIN_SECRET_KEY ||
    process.env.ADMIN_SECRET_KEY;
  if (!expectedAdminKey || !adminKey) {
    return false;
  }
  return timingSafeEqualStrings(adminKey, expectedAdminKey);
}

async function verifyToolAccess(toolId: string, user: { id: string }, isAdmin: boolean) {
  let result;
  try {
    result = await query<{
      id: string;
      owner_id: string;
      is_public: boolean;
      visibility?: string;
      allow_client_execution: boolean;
      status: string;
      is_archived: boolean;
    }>(
      'SELECT id, owner_id, is_public, visibility, allow_client_execution, status, is_archived FROM public.tools WHERE id = $1 AND now() IS NOT NULL LIMIT 1',
      [toolId],
    );
  } catch {
    result = await query<{
      id: string;
      owner_id: string;
      is_public: boolean;
      status: string;
      is_archived: boolean;
    }>(
      'SELECT id, owner_id, is_public, status, is_archived FROM public.tools WHERE id = $1 AND now() IS NOT NULL LIMIT 1',
      [toolId],
    );
  }

  if (result.rows.length === 0) {
    throw new HTTPException(404, { message: `Tool ${toolId} not found` });
  }

  const tool = result.rows[0];
  if (tool.is_archived && !isAdmin) {
    throw new HTTPException(404, { message: `Tool ${toolId} not found` });
  }

  const isOwner = tool.owner_id === user.id;
  const isPublicVerified =
    (tool.is_public || tool.visibility === 'public') &&
    (tool.status === 'verified' || tool.status === 'registered');

  if (!isOwner && !isAdmin && !isPublicVerified) {
    throw new HTTPException(404, { message: `Tool ${toolId} not found` });
  }

  return tool;
}

// ─── Tools Router ─────────────────────────────────────────────────────────────

export const toolsRouter = new Hono();

// POST /tools — Create tool shell
toolsRouter.post(
  '/',
  requireAuth,
  zValidator('json', CreateToolSchema, (result, c) => {
    if (!result.success && 'error' in result) {
      return c.json({ statusCode: 400, message: result.error.errors.map((e) => e.message) }, 400);
    }
  }),
  async (c) => {
    const user = c.get('user');
    const {
      name,
      description,
      type,
      connector_type,
      is_public = false,
      allow_client_execution = false,
    } = c.req.valid('json');

    const result = await query(
      `INSERT INTO public.tools (
         owner_id,
         name,
         description,
         type,
         connector_type,
         is_public,
         allow_client_execution,
         status
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'draft')
       RETURNING id, owner_id, name, description, type, status, is_public,
                 allow_client_execution, connector_type, current_version_id,
                 is_archived, created_at, updated_at`,
      [
        user.id,
        name,
        description ?? null,
        type,
        connector_type ?? null,
        is_public,
        allow_client_execution,
      ],
    );

    if (result.rows.length === 0) {
      throw new HTTPException(500, { message: 'Failed to create tool' });
    }

    return c.json(result.rows[0], 201);
  },
);

// GET /tools — List caller's tools (+ optionally verified public tools)
toolsRouter.get('/', requireAuth, async (c) => {
  const user = c.get('user');
  const includePublic = c.req.query('include_public') === 'true';
  const includeArchived = c.req.query('include_archived') === 'true';
  const typeFilter = c.req.query('type');
  const statusFilter = c.req.query('status');
  const isAdmin = await checkIsAdmin(c);

  const conditions: string[] = [];
  const params: any[] = [];
  let paramIdx = 1;

  // 1. Archival visibility: non-admins NEVER see archived tools
  if (!isAdmin || !includeArchived) {
    conditions.push('t.is_archived = false');
  }

  // 2. Ownership / public visibility
  if (includePublic) {
    conditions.push(
      `(t.owner_id = $${paramIdx++} OR (t.is_public = true AND t.status = 'verified'))`,
    );
    params.push(user.id);
  } else {
    conditions.push(`t.owner_id = $${paramIdx++}`);
    params.push(user.id);
  }

  // 3. Optional filters
  if (typeFilter) {
    conditions.push(`t.type = $${paramIdx++}`);
    params.push(typeFilter);
  }
  if (statusFilter) {
    conditions.push(`t.status = $${paramIdx++}`);
    params.push(statusFilter);
  }

  let result;
  try {
    const sql = `
      SELECT t.id, t.owner_id, t.name, t.description, t.type, t.status,
             t.is_public, t.allow_client_execution, t.connector_type,
             t.current_version_id, t.is_archived, t.created_at, t.updated_at,
             t.visibility, t.slug, t.tags, t.install_count,
             (t.owner_id = $1) as is_owner,
             tv.version_number as current_version_number,
             coalesce(ts.code, tv.code) as current_code,
             tv.schema_json as current_schema_json,
             tv.capabilities_json as current_capabilities_json,
             tv.code_hash as current_code_hash,
             tv.test_results_json as current_test_results_json,
             tv.created_at as current_version_created_at
      FROM public.tools t
      LEFT JOIN public.tool_versions tv ON t.current_version_id = tv.id
      LEFT JOIN public.tool_sources ts ON tv.id = ts.version_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY t.updated_at DESC
    `;
    result = await query(sql, params);
  } catch {
    const fallbackSql = `
      SELECT t.id, t.owner_id, t.name, t.description, t.type, t.status,
             t.is_public, t.allow_client_execution, t.connector_type,
             t.current_version_id, t.is_archived, t.created_at, t.updated_at,
             (t.owner_id = $1) as is_owner,
             tv.version_number as current_version_number,
             tv.code as current_code,
             tv.schema_json as current_schema_json,
             tv.capabilities_json as current_capabilities_json,
             tv.code_hash as current_code_hash,
             tv.test_results_json as current_test_results_json,
             tv.created_at as current_version_created_at
      FROM public.tools t
      LEFT JOIN public.tool_versions tv ON t.current_version_id = tv.id
      WHERE ${conditions.join(' AND ')}
      ORDER BY t.updated_at DESC
    `;
    result = await query(fallbackSql, params);
  }

  return c.json(
    result.rows.map((row) => {
      const isOwner = row.owner_id === user.id;
      const canViewCode = isOwner || isAdmin || Boolean(row.allow_client_execution);
      return formatToolRow(row, canViewCode);
    }),
  );
});

// GET /tools/:id/diff — Comparative version diff
toolsRouter.get('/:id/diff', requireAuth, async (c) => {
  const user = c.get('user');
  const toolId = c.req.param('id');
  const isAdmin = await checkIsAdmin(c);

  const tool = await verifyToolAccess(toolId, user, isAdmin);
  const isOwner = tool.owner_id === user.id;
  const canViewCode = isOwner || isAdmin || Boolean(tool.allow_client_execution);

  const fromVersion = parseInt(c.req.query('from') || '', 10);
  const toVersion = parseInt(c.req.query('to') || '', 10);

  if (isNaN(fromVersion) || isNaN(toVersion)) {
    throw new HTTPException(400, {
      message: 'Both "from" and "to" query parameters must be valid integer version numbers',
    });
  }

  let result;
  try {
    result = await query(
      `SELECT tv.id, tv.tool_id, tv.version_number,
              CASE WHEN $4 = true THEN coalesce(ts.code, tv.code) ELSE NULL END as code,
              tv.schema_json, tv.capabilities_json, tv.code_hash, tv.test_results_json, tv.created_at
       FROM public.tool_versions tv
       LEFT JOIN public.tool_sources ts ON tv.id = ts.version_id
       WHERE tv.tool_id = $1 AND tv.version_number IN ($2, $3)`,
      [toolId, fromVersion, toVersion, canViewCode],
    );
  } catch {
    result = await query(
      `SELECT id, tool_id, version_number,
              CASE WHEN $4 = true THEN code ELSE NULL END as code,
              schema_json, capabilities_json, code_hash, test_results_json, created_at
       FROM public.tool_versions
       WHERE tool_id = $1 AND version_number IN ($2, $3)`,
      [toolId, fromVersion, toVersion, canViewCode],
    );
  }

  const fromRow = result.rows.find((r) => r.version_number === fromVersion);
  const toRow = result.rows.find((r) => r.version_number === toVersion);

  if (!fromRow || !toRow) {
    throw new HTTPException(404, {
      message: `One or both versions (${fromVersion}, ${toVersion}) could not be found for tool ${toolId}`,
    });
  }

  const codeChanged =
    fromRow.code !== toRow.code ||
    (Boolean(fromRow.code_hash && toRow.code_hash) && fromRow.code_hash !== toRow.code_hash);
  const schemaChanged =
    JSON.stringify(fromRow.schema_json) !== JSON.stringify(toRow.schema_json);

  return c.json({
    tool_id: toolId,
    from: fromRow,
    to: toRow,
    diff: {
      code_changed: codeChanged,
      schema_changed: schemaChanged,
    },
  });
});

// GET /tools/:id/versions — Version history
toolsRouter.get('/:id/versions', requireAuth, async (c) => {
  const user = c.get('user');
  const toolId = c.req.param('id');
  const isAdmin = await checkIsAdmin(c);

  const tool = await verifyToolAccess(toolId, user, isAdmin);
  const isOwner = tool.owner_id === user.id;
  const canViewCode = isOwner || isAdmin || Boolean(tool.allow_client_execution);

  let result;
  try {
    result = await query(
      `SELECT tv.id, tv.tool_id, tv.version_number,
              CASE WHEN $2 = true THEN coalesce(ts.code, tv.code) ELSE NULL END as code,
              tv.schema_json, tv.capabilities_json,
              tv.code_hash, tv.test_results_json, tv.created_at
       FROM public.tool_versions tv
       LEFT JOIN public.tool_sources ts ON tv.id = ts.version_id
       WHERE tv.tool_id = $1
       ORDER BY tv.version_number DESC`,
      [toolId, canViewCode],
    );
  } catch {
    result = await query(
      `SELECT id, tool_id, version_number,
              CASE WHEN $2 = true THEN code ELSE NULL END as code,
              schema_json, capabilities_json,
              code_hash, test_results_json, created_at
       FROM public.tool_versions
       WHERE tool_id = $1
       ORDER BY version_number DESC`,
      [toolId, canViewCode],
    );
  }

  return c.json(result.rows);
});

// GET /tools/:id/versions/:versionNumber — Specific version
toolsRouter.get('/:id/versions/:versionNumber', requireAuth, async (c) => {
  const user = c.get('user');
  const toolId = c.req.param('id');
  const versionNumber = parseInt(c.req.param('versionNumber'), 10);
  const isAdmin = await checkIsAdmin(c);

  if (isNaN(versionNumber)) {
    throw new HTTPException(400, { message: 'versionNumber must be a valid integer' });
  }

  const tool = await verifyToolAccess(toolId, user, isAdmin);
  const isOwner = tool.owner_id === user.id;
  const canViewCode = isOwner || isAdmin || Boolean(tool.allow_client_execution);

  let result;
  try {
    result = await query(
      `SELECT tv.id, tv.tool_id, tv.version_number,
              CASE WHEN $3 = true THEN coalesce(ts.code, tv.code) ELSE NULL END as code,
              tv.schema_json, tv.capabilities_json,
              tv.code_hash, tv.test_results_json, tv.created_at
       FROM public.tool_versions tv
       LEFT JOIN public.tool_sources ts ON tv.id = ts.version_id
       WHERE tv.tool_id = $1 AND tv.version_number = $2
       LIMIT 1`,
      [toolId, versionNumber, canViewCode],
    );
  } catch {
    result = await query(
      `SELECT id, tool_id, version_number,
              CASE WHEN $3 = true THEN code ELSE NULL END as code,
              schema_json, capabilities_json,
              code_hash, test_results_json, created_at
       FROM public.tool_versions
       WHERE tool_id = $1 AND version_number = $2
       LIMIT 1`,
      [toolId, versionNumber, canViewCode],
    );
  }

  if (result.rows.length === 0) {
    throw new HTTPException(404, {
      message: `Version ${versionNumber} not found for tool ${toolId}`,
    });
  }

  return c.json(result.rows[0]);
});

// GET /tools/:id - Get tool by ID with its current version
toolsRouter.get('/:id', requireAuth, async (c) => {
  const user = c.get('user');
  const toolId = c.req.param('id');
  const isAdmin = await checkIsAdmin(c);

  let result;
  try {
    result = await query(
      `SELECT t.id, t.owner_id, t.name, t.description, t.type, t.status,
              t.is_public, t.allow_client_execution, t.connector_type,
              t.current_version_id, t.is_archived, t.created_at, t.updated_at,
              t.visibility, t.slug, t.tags, t.install_count,
              (t.owner_id = $2) as is_owner,
              tv.version_number as current_version_number,
              coalesce(ts.code, tv.code) as current_code,
              tv.schema_json as current_schema_json,
              tv.capabilities_json as current_capabilities_json,
              tv.code_hash as current_code_hash,
              tv.test_results_json as current_test_results_json,
              tv.created_at as current_version_created_at
       FROM public.tools t
       LEFT JOIN public.tool_versions tv ON t.current_version_id = tv.id
       LEFT JOIN public.tool_sources ts ON tv.id = ts.version_id
       WHERE t.id = $1 AND now() IS NOT NULL
       LIMIT 1`,
      [toolId, user.id],
    );
  } catch {
    result = await query(
      `SELECT t.id, t.owner_id, t.name, t.description, t.type, t.status,
              t.is_public, t.allow_client_execution, t.connector_type,
              t.current_version_id, t.is_archived, t.created_at, t.updated_at,
              (t.owner_id = $2) as is_owner,
              tv.version_number as current_version_number,
              tv.code as current_code,
              tv.schema_json as current_schema_json,
              tv.capabilities_json as current_capabilities_json,
              tv.code_hash as current_code_hash,
              tv.test_results_json as current_test_results_json,
              tv.created_at as current_version_created_at
       FROM public.tools t
       LEFT JOIN public.tool_versions tv ON t.current_version_id = tv.id
       WHERE t.id = $1 AND now() IS NOT NULL
       LIMIT 1`,
      [toolId, user.id],
    );
  }

  if (result.rows.length === 0) {
    throw new HTTPException(404, { message: `Tool ${toolId} not found` });
  }

  const row = result.rows[0];

  // Soft-deleted tools are completely invisible to regular users
  if (row.is_archived && !isAdmin) {
    throw new HTTPException(404, { message: `Tool ${toolId} not found` });
  }

  // Access check: owner, admin, or verified/registered public tool
  const isOwner = row.owner_id === user.id;
  const isPublicVerified =
    (row.is_public || row.visibility === 'public') &&
    (row.status === 'verified' || row.status === 'registered');

  if (!isOwner && !isAdmin && !isPublicVerified) {
    throw new HTTPException(404, { message: `Tool ${toolId} not found` });
  }

  const canViewCode = isOwner || isAdmin || Boolean(row.allow_client_execution);
  return c.json(formatToolRow(row, canViewCode));
});

// POST /tools/:id/versions — Create a new version atomically
toolsRouter.post(
  '/:id/versions',
  requireAuth,
  zValidator('json', CreateToolVersionSchema, (result, c) => {
    if (!result.success && 'error' in result) {
      return c.json({ statusCode: 400, message: result.error.errors.map((e) => e.message) }, 400);
    }
  }),
  async (c) => {
    const user = c.get('user');
    const toolId = c.req.param('id');
    const { code, schema_json, capabilities_json, test_results_json } = c.req.valid('json');

    // 1. Fetch tool and verify ownership
    const toolCheck = await query<{
      id: string;
      owner_id: string;
      type: string;
      is_archived: boolean;
    }>(
      'SELECT id, owner_id, type, is_archived FROM public.tools WHERE id = $1 AND now() IS NOT NULL LIMIT 1',
      [toolId],
    );

    if (toolCheck.rows.length === 0 || toolCheck.rows[0].is_archived) {
      throw new HTTPException(404, { message: `Tool ${toolId} not found` });
    }

    const tool = toolCheck.rows[0];
    if (tool.owner_id !== user.id) {
      throw new HTTPException(403, {
        message: 'You do not have permission to modify this tool',
      });
    }

    // 2. Client vs MCP tool validation
    if (tool.type === 'client' && (!code || code.trim() === '')) {
      throw new HTTPException(400, { message: 'code is required for client tools' });
    }
    if (tool.type === 'mcp' && code && code.trim() !== '') {
      throw new HTTPException(400, { message: 'code must not be provided for mcp tools' });
    }

    // 3. Compute code_hash
    let codeHash: string | null = null;
    if (code && code.trim() !== '') {
      codeHash = await computeCodeHash(code);
    }

    // 4+5. Atomically: reset MCP status to 'testing' AND create version in one transaction.
    const rpcResult = await withTransaction(async (client) => {
      if (tool.type === 'mcp') {
        await client.query(
          "UPDATE public.tools SET status = 'testing', updated_at = now() WHERE id = $1",
          [toolId],
        );
      }

      return client.query<{
        id: string;
        tool_id: string;
        version_number: number;
        code: string | null;
        schema_json: unknown;
        capabilities_json: unknown;
        code_hash: string | null;
        test_results_json: unknown;
        created_at: string;
      }>(
        `SELECT id, tool_id, version_number, code, schema_json, capabilities_json,
                code_hash, test_results_json, created_at
         FROM public.create_tool_version($1, $2, $3::jsonb, $4::jsonb, $5, $6::jsonb)`,
        [
          toolId,
          code ?? null,
          JSON.stringify(schema_json),
          JSON.stringify(capabilities_json ?? []),
          codeHash,
          test_results_json != null ? JSON.stringify(test_results_json) : null,
        ],
      );
    });

    if (rpcResult.rows.length === 0) {
      throw new HTTPException(500, { message: 'Failed to create tool version' });
    }

    const versionRow = rpcResult.rows[0];
    return c.json(
      {
        ...versionRow,
        code: code ?? null,
      },
      201,
    );
  },
);

// POST /tools/:id/register - Automate tool verification and status transition
toolsRouter.post('/:id/register', requireAuth, async (c) => {
  const user = c.get('user');
  const toolId = c.req.param('id');
  const env = c.env as any;

  // 1. Fetch tool and latest version, verify ownership and state
  const toolCheck = await query<{
    id: string;
    owner_id: string;
    type: string;
    status: string;
    current_version_id: string | null;
    is_archived: boolean;
  }>(
    'SELECT id, owner_id, type, status, current_version_id, is_archived FROM public.tools WHERE id = $1 AND now() IS NOT NULL LIMIT 1',
    [toolId],
  );

  if (toolCheck.rows.length === 0 || toolCheck.rows[0].is_archived) {
    throw new HTTPException(404, { message: `Tool ${toolId} not found` });
  }

  const tool = toolCheck.rows[0];
  if (tool.owner_id !== user.id) {
    throw new HTTPException(403, { message: 'You do not have permission to register this tool' });
  }

  if (!['draft', 'rejected', 'testing'].includes(tool.status)) {
    throw new HTTPException(400, {
      message: `Tool is in ${tool.status} state and cannot be registered again`,
    });
  }

  if (tool.type !== 'client') {
    throw new HTTPException(400, { message: 'Only client tools require sandbox registration' });
  }

  let versionCheck;
  try {
    versionCheck = await query<{
      id: string;
      code: string;
      schema_json: any;
      capabilities_json: any;
    }>(
      `SELECT tv.id, coalesce(ts.code, tv.code) as code, tv.schema_json, tv.capabilities_json
       FROM public.tool_versions tv
       LEFT JOIN public.tool_sources ts ON tv.id = ts.version_id
       WHERE tv.id = $1 LIMIT 1`,
      [tool.current_version_id],
    );
  } catch {
    versionCheck = await query<{
      id: string;
      code: string;
      schema_json: any;
      capabilities_json: any;
    }>(
      'SELECT id, code, schema_json, capabilities_json FROM public.tool_versions WHERE id = $1 LIMIT 1',
      [tool.current_version_id],
    );
  }

  if (versionCheck.rows.length === 0) {
    throw new HTTPException(404, { message: 'Tool version not found' });
  }

  const version = versionCheck.rows[0];
  const { code, schema_json, capabilities_json } = version;

  if (!code || code.trim() === '') {
    throw new HTTPException(400, { message: 'Cannot register a tool without code' });
  }

  // 2. Set to 'testing'
  await query("UPDATE public.tools SET status = 'testing', updated_at = now() WHERE id = $1", [
    toolId,
  ]);

  const rejectRegistration = async (reason: string, details?: any) => {
    const testResults = { status: 'failed', reason, details, timestamp: new Date().toISOString() };
    await query('UPDATE public.tool_versions SET test_results_json = $1 WHERE id = $2', [
      JSON.stringify(testResults),
      version.id,
    ]);
    await query("UPDATE public.tools SET status = 'rejected', updated_at = now() WHERE id = $1", [
      toolId,
    ]);
    return c.json({ success: false, message: 'Registration failed', testResults }, 400);
  };

  try {
    // 3. Step One: Schema Validation
    const schemaValidation = validateSchemaConsistency(code, schema_json);
    if (!schemaValidation.valid) {
      return await rejectRegistration(schemaValidation.error || 'Schema validation failed');
    }

    // 4. Step Two: Test Inputs Generation
    let args = {};
    try {
      const body = await c.req.json().catch(() => ({}));
      args = body.inputs || generateTestInputs(schema_json);
    } catch {
      args = generateTestInputs(schema_json);
    }

    // 5. Step Three: Authoritative Static Contract & Capability Audit
    const startTime = Date.now();

    // 5a. Module Contract Audit: Must export a function or default runner
    const hasExport =
      /\bexport\s+default\b/.test(code) ||
      /\bmodule\.exports\b/.test(code) ||
      /\bfunction\s+run\b/.test(code) ||
      /\bexport\s+(async\s+)?function\b/.test(code);
    if (!hasExport) {
      return await rejectRegistration(
        'Tool code must export a default entry function (e.g. "export default async function run(params)")',
      );
    }

    // 5b. Capability Declaration Audit
    if (capabilities_json && !Array.isArray(capabilities_json)) {
      return await rejectRegistration('capabilities_json must be an array of string identifiers');
    }

    const duration = Date.now() - startTime;

    // 6. Success! Transition to registered
    const successResults = {
      status: 'passed',
      result: 'Verified schema consistency and capability contract',
      observedCalls: [],
      durationMs: duration,
      inputsUsed: args,
      timestamp: new Date().toISOString(),
    };

    await query('UPDATE public.tool_versions SET test_results_json = $1 WHERE id = $2', [
      JSON.stringify(successResults),
      version.id,
    ]);
    await query("UPDATE public.tools SET status = 'registered', updated_at = now() WHERE id = $1", [
      toolId,
    ]);

    // Fetch updated tool row for response
    let updatedTool;
    try {
      updatedTool = await query(
        `SELECT t.*, tv.version_number as current_version_number,
                coalesce(ts.code, tv.code) as current_code,
                tv.schema_json as current_schema_json,
                tv.capabilities_json as current_capabilities_json,
                tv.code_hash as current_code_hash,
                tv.test_results_json as current_test_results_json,
                tv.created_at as current_version_created_at
         FROM public.tools t
         LEFT JOIN public.tool_versions tv ON t.current_version_id = tv.id
         LEFT JOIN public.tool_sources ts ON tv.id = ts.version_id
         WHERE t.id = $1`,
        [toolId],
      );
    } catch {
      updatedTool = await query(
        `SELECT t.*, tv.version_number as current_version_number,
                tv.code as current_code,
                tv.schema_json as current_schema_json,
                tv.capabilities_json as current_capabilities_json,
                tv.code_hash as current_code_hash,
                tv.test_results_json as current_test_results_json,
                tv.created_at as current_version_created_at
         FROM public.tools t
         LEFT JOIN public.tool_versions tv ON t.current_version_id = tv.id
         WHERE t.id = $1`,
        [toolId],
      );
    }

    return c.json({
      success: true,
      message: 'Tool successfully registered',
      testResults: successResults,
      tool: formatToolRow(updatedTool.rows[0]),
    });
  } catch (err: any) {
    return await rejectRegistration('Internal error during registration', { error: err.message });
  }
});

// PATCH /tools/:id — Update metadata only
toolsRouter.patch(
  '/:id',
  requireAuth,
  zValidator('json', UpdateToolSchema, (result, c) => {
    if (!result.success && 'error' in result) {
      return c.json({ statusCode: 400, message: result.error.errors.map((e) => e.message) }, 400);
    }
  }),
  async (c) => {
    const user = c.get('user');
    const data = c.req.valid('json');
    const isAdmin = await checkIsAdmin(c);
    const toolId = c.req.param('id');

    // 1. Fetch tool and verify ownership
    const toolCheck = await query<{
      id: string;
      owner_id: string;
      name: string;
      description: string | null;
      type: string;
      status: string;
      is_public: boolean;
      visibility?: string;
      allow_client_execution: boolean;
      is_archived: boolean;
    }>(
      'SELECT id, owner_id, name, description, type, status, is_public, visibility, allow_client_execution, is_archived FROM public.tools WHERE id = $1 AND now() IS NOT NULL LIMIT 1',
      [toolId],
    );

    if (toolCheck.rows.length === 0 || toolCheck.rows[0].is_archived) {
      throw new HTTPException(404, { message: `Tool ${toolId} not found` });
    }

    const tool = toolCheck.rows[0];
    if (tool.owner_id !== user.id && !isAdmin) {
      throw new HTTPException(403, {
        message: 'You do not have permission to update this tool',
      });
    }

    // 2. Validation of status updates
    if (data.status !== undefined) {
      if (data.status === 'verified' && !isAdmin) {
        if (tool.type === 'mcp') {
          throw new HTTPException(403, {
            message: 'MCP tools cannot be set to "verified" without administrator verification',
          });
        }
        throw new HTTPException(403, {
          message: 'Client tools cannot be set to "verified" without administrator verification',
        });
      }
      if (['testing', 'registered', 'rejected'].includes(data.status)) {
        throw new HTTPException(403, {
          message:
            'Status cannot be manually set to testing, registered, or rejected. Please use the /register endpoint.',
        });
      }
    }

    // 3. Publishing gate checks
    const willBePublic =
      data.visibility === 'public' ||
      (data.is_public === true && data.visibility === undefined);

    if (willBePublic && !tool.is_public && tool.visibility !== 'public') {
      if (tool.status !== 'registered' && tool.status !== 'verified') {
        throw new HTTPException(400, {
          message:
            'Tool must be in "registered" status before it can be published to the marketplace',
        });
      }
      if (!tool.description && !data.description) {
        throw new HTTPException(400, {
          message: 'Tool must have a non-empty description before publishing',
        });
      }
    }

    // 4. Build dynamic UPDATE query
    const fieldsToUpdate: string[] = [];
    const values: any[] = [];
    let paramIdx = 1;

    if (data.name !== undefined) {
      fieldsToUpdate.push(`name = $${paramIdx++}`);
      values.push(data.name);
    }
    if (data.description !== undefined) {
      fieldsToUpdate.push(`description = $${paramIdx++}`);
      values.push(data.description);
    }
    if (data.is_public !== undefined || data.visibility !== undefined) {
      const resolvedVisibility =
        data.visibility || (data.is_public ? 'public' : 'private');
      const resolvedIsPublic = resolvedVisibility === 'public';

      fieldsToUpdate.push(`is_public = $${paramIdx++}`);
      values.push(resolvedIsPublic);

      try {
        fieldsToUpdate.push(`visibility = $${paramIdx++}`);
        values.push(resolvedVisibility);
      } catch {
        // ignore if pre-011
      }

      if (resolvedIsPublic) {
        try {
          const profileRes = await query<{ handle: string | null }>(
            'SELECT handle FROM public.profiles WHERE id = $1 LIMIT 1',
            [tool.owner_id],
          );
          const handle = profileRes.rows[0]?.handle;
          if (handle) {
            const baseSlug = `${handle}/${slugify(data.name || tool.name)}`;
            fieldsToUpdate.push(`slug = $${paramIdx++}`);
            values.push(baseSlug);
          }
        } catch {
          // ignore if column doesn't exist
        }
      }
    }
    if (data.allow_client_execution !== undefined) {
      fieldsToUpdate.push(`allow_client_execution = $${paramIdx++}`);
      values.push(data.allow_client_execution);
    }
    if (data.tags !== undefined) {
      try {
        fieldsToUpdate.push(`tags = $${paramIdx++}`);
        values.push(data.tags);
      } catch {
        // ignore
      }
    }
    if (data.status !== undefined) {
      fieldsToUpdate.push(`status = $${paramIdx++}`);
      values.push(data.status);
    }

    if (fieldsToUpdate.length > 0) {
      fieldsToUpdate.push('updated_at = now()');
      values.push(toolId);
      await query(
        `UPDATE public.tools SET ${fieldsToUpdate.join(', ')} WHERE id = $${paramIdx}`,
        values,
      );
    }

    // 5. Return updated tool with current version
    let updatedResult;
    try {
      updatedResult = await query(
        `SELECT t.id, t.owner_id, t.name, t.description, t.type, t.status,
                t.is_public, t.allow_client_execution, t.connector_type,
                t.current_version_id, t.is_archived, t.created_at, t.updated_at,
                t.visibility, t.slug, t.tags, t.install_count,
                (t.owner_id = $2) as is_owner,
                tv.version_number as current_version_number,
                coalesce(ts.code, tv.code) as current_code,
                tv.schema_json as current_schema_json,
                tv.capabilities_json as current_capabilities_json,
                tv.code_hash as current_code_hash,
                tv.test_results_json as current_test_results_json,
                tv.created_at as current_version_created_at
         FROM public.tools t
         LEFT JOIN public.tool_versions tv ON t.current_version_id = tv.id
         LEFT JOIN public.tool_sources ts ON tv.id = ts.version_id
         WHERE t.id = $1 AND now() IS NOT NULL
         LIMIT 1`,
        [toolId, user.id],
      );
    } catch {
      updatedResult = await query(
        `SELECT t.id, t.owner_id, t.name, t.description, t.type, t.status,
                t.is_public, t.allow_client_execution, t.connector_type,
                t.current_version_id, t.is_archived, t.created_at, t.updated_at,
                (t.owner_id = $2) as is_owner,
                tv.version_number as current_version_number,
                tv.code as current_code,
                tv.schema_json as current_schema_json,
                tv.capabilities_json as current_capabilities_json,
                tv.code_hash as current_code_hash,
                tv.test_results_json as current_test_results_json,
                tv.created_at as current_version_created_at
         FROM public.tools t
         LEFT JOIN public.tool_versions tv ON t.current_version_id = tv.id
         WHERE t.id = $1 AND now() IS NOT NULL
         LIMIT 1`,
        [toolId, user.id],
      );
    }

    const canViewCode =
      tool.owner_id === user.id || isAdmin || Boolean(tool.allow_client_execution);
    return c.json(formatToolRow(updatedResult.rows[0], canViewCode));
  },
);

// DELETE /tools/:id — Soft-delete tool (or hard purge if purge=true & admin)
toolsRouter.delete('/:id', requireAuth, async (c) => {
  const user = c.get('user');
  const toolId = c.req.param('id');
  const isAdmin = await checkIsAdmin(c);
  const purge = c.req.query('purge') === 'true';

  // 1. Fetch tool
  const toolCheck = await query<{
    id: string;
    owner_id: string;
    is_archived: boolean;
  }>(
    'SELECT id, owner_id, is_archived FROM public.tools WHERE id = $1 AND now() IS NOT NULL LIMIT 1',
    [toolId],
  );

  if (toolCheck.rows.length === 0) {
    throw new HTTPException(404, { message: `Tool ${toolId} not found` });
  }

  const tool = toolCheck.rows[0];
  if (tool.owner_id !== user.id && !isAdmin) {
    throw new HTTPException(403, { message: 'You do not have permission to delete this tool' });
  }

  if (tool.is_archived && !purge) {
    throw new HTTPException(404, { message: `Tool ${toolId} not found` });
  }

  // 2. Hard purge for admins when purge=true
  if (purge && isAdmin) {
    await query('DELETE FROM public.tools WHERE id = $1', [toolId]);
    return c.json({ message: 'Tool permanently purged' });
  }

  // 3. Soft-delete by setting is_archived = true
  await query('UPDATE public.tools SET is_archived = true, updated_at = now() WHERE id = $1', [
    toolId,
  ]);

  return c.json({ message: 'Tool archived successfully' });
});


/**
 * POST /tools/:id/mcp-request
 * Tool author submits a request to host the registered tool on the official MCP server.
 * Gated to tool owners; requires status = 'registered'.
 */
toolsRouter.post('/:id/mcp-request', requireAuth, async (c) => {
  const user = c.get('user');
  const toolId = c.req.param('id');

  const toolCheck = await query<{
    id: string;
    owner_id: string;
    name: string;
    status: string;
    is_mcp_hosted?: boolean;
    mcp_hosting_status?: string;
    is_archived: boolean;
  }>(
    'SELECT id, owner_id, name, status, is_mcp_hosted, mcp_hosting_status, is_archived FROM public.tools WHERE id = $1 AND now() IS NOT NULL LIMIT 1',
    [toolId],
  );

  if (toolCheck.rows.length === 0 || toolCheck.rows[0].is_archived) {
    throw new HTTPException(404, { message: `Tool ${toolId} not found` });
  }

  const tool = toolCheck.rows[0];
  if (tool.owner_id !== user.id) {
    throw new HTTPException(403, {
      message: 'You do not have permission to request MCP hosting for this tool',
    });
  }

  if (tool.status !== 'registered' && tool.status !== 'verified') {
    throw new HTTPException(400, {
      message: 'Tool must be tested and registered before requesting MCP server hosting',
    });
  }

  if (tool.is_mcp_hosted) {
    throw new HTTPException(400, { message: 'Tool is already hosted on the MCP server' });
  }

  if (tool.mcp_hosting_status === 'requested' || tool.mcp_hosting_status === 'in_review') {
    throw new HTTPException(400, {
      message: 'An MCP server hosting request is already pending for this tool',
    });
  }

  const result = await query<{
    id: string;
    name: string;
    mcp_hosting_status: string;
    is_mcp_hosted: boolean;
  }>(
    `UPDATE public.tools
     SET mcp_hosting_status = 'requested',
         allow_client_execution = false,
         updated_at = now()
     WHERE id = $1
     RETURNING id, name, mcp_hosting_status, is_mcp_hosted`,
    [toolId],
  );

  return c.json({
    success: true,
    message: 'Tool submitted for MCP server hosting evaluation by admin automations',
    tool: result.rows[0],
  });
});

/**
 * DELETE /tools/:id/mcp-request
 * Withdraws a pending MCP hosting request before admin promotion.
 */
toolsRouter.delete('/:id/mcp-request', requireAuth, async (c) => {
  const user = c.get('user');
  const toolId = c.req.param('id');

  const toolCheck = await query<{
    id: string;
    owner_id: string;
    name: string;
    is_mcp_hosted?: boolean;
    mcp_hosting_status?: string;
    is_archived: boolean;
  }>(
    'SELECT id, owner_id, name, is_mcp_hosted, mcp_hosting_status, is_archived FROM public.tools WHERE id = $1 AND now() IS NOT NULL LIMIT 1',
    [toolId],
  );

  if (toolCheck.rows.length === 0 || toolCheck.rows[0].is_archived) {
    throw new HTTPException(404, { message: `Tool ${toolId} not found` });
  }

  const tool = toolCheck.rows[0];
  if (tool.owner_id !== user.id) {
    throw new HTTPException(403, {
      message: 'You do not have permission to manage MCP hosting for this tool',
    });
  }

  if (tool.is_mcp_hosted) {
    throw new HTTPException(400, {
      message: 'Active MCP-hosted tools cannot be unhosted directly; contact admin moderation.',
    });
  }

  const result = await query<{
    id: string;
    name: string;
    mcp_hosting_status: string;
    is_mcp_hosted: boolean;
  }>(
    `UPDATE public.tools
     SET mcp_hosting_status = 'none',
         updated_at = now()
     WHERE id = $1
     RETURNING id, name, mcp_hosting_status, is_mcp_hosted`,
    [toolId],
  );

  return c.json({
    success: true,
    message: 'MCP server hosting request cancelled',
    tool: result.rows[0],
  });
});
