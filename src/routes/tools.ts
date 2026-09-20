import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import { requireAuth } from '../middleware/auth';
import { query } from '../services/database';
import { computeCodeHash } from '../utils/crypto';
import { CreateToolSchema, CreateToolVersionSchema } from '../schemas/tools';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatToolRow(row: any) {
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
    current_version: row.current_version_id
      ? {
          id: row.current_version_id,
          tool_id: row.id,
          version_number: current_version_number,
          code: current_code,
          schema_json: current_schema_json,
          capabilities_json: current_capabilities_json,
          code_hash: current_code_hash,
          test_results_json: current_test_results_json,
          created_at: current_version_created_at,
        }
      : null,
  };
}

function checkIsAdmin(c: any): boolean {
  const adminKey = c.req.header('x-admin-key');
  const expectedAdminKey =
    (c.env as { ADMIN_SECRET_KEY?: string } | undefined)?.ADMIN_SECRET_KEY ||
    process.env.ADMIN_SECRET_KEY;
  return Boolean(expectedAdminKey && adminKey && adminKey === expectedAdminKey);
}

async function verifyToolAccess(toolId: string, user: { id: string }, isAdmin: boolean) {
  const result = await query<{
    id: string;
    owner_id: string;
    is_public: boolean;
    status: string;
    is_archived: boolean;
  }>(
    'SELECT id, owner_id, is_public, status, is_archived FROM public.tools WHERE id = $1 LIMIT 1',
    [toolId],
  );

  if (result.rows.length === 0) {
    throw new HTTPException(404, { message: `Tool ${toolId} not found` });
  }

  const tool = result.rows[0];
  if (tool.is_archived && !isAdmin) {
    throw new HTTPException(404, { message: `Tool ${toolId} not found` });
  }

  const isOwner = tool.owner_id === user.id;
  const isPublicVerified = tool.is_public && tool.status === 'verified';

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
    if (!result.success) {
      return c.json({ statusCode: 400, message: result.error.errors.map((e) => e.message) }, 400);
    }
  }),
  async (c) => {
    const user = c.get('user');
    const { name, description, type, connector_type, is_public, allow_client_execution } =
      c.req.valid('json');

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
  const isAdmin = checkIsAdmin(c);

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

  const sql = `
    SELECT t.id, t.owner_id, t.name, t.description, t.type, t.status,
           t.is_public, t.allow_client_execution, t.connector_type,
           t.current_version_id, t.is_archived, t.created_at, t.updated_at,
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

  const result = await query(sql, params);
  return c.json(result.rows.map(formatToolRow));
});

// GET /tools/:id/diff — Comparative version diff
toolsRouter.get('/:id/diff', requireAuth, async (c) => {
  const user = c.get('user');
  const toolId = c.req.param('id');
  const isAdmin = checkIsAdmin(c);

  await verifyToolAccess(toolId, user, isAdmin);

  const fromVersion = parseInt(c.req.query('from') || '', 10);
  const toVersion = parseInt(c.req.query('to') || '', 10);

  if (isNaN(fromVersion) || isNaN(toVersion)) {
    throw new HTTPException(400, {
      message: 'Both "from" and "to" query parameters must be valid integer version numbers',
    });
  }

  const result = await query(
    `SELECT id, tool_id, version_number, code, schema_json, capabilities_json, code_hash, created_at
     FROM public.tool_versions
     WHERE tool_id = $1 AND version_number IN ($2, $3)`,
    [toolId, fromVersion, toVersion],
  );

  const fromRow = result.rows.find((r) => r.version_number === fromVersion);
  const toRow = result.rows.find((r) => r.version_number === toVersion);

  if (!fromRow || !toRow) {
    throw new HTTPException(404, {
      message: `One or both versions (${fromVersion}, ${toVersion}) could not be found for tool ${toolId}`,
    });
  }

  const codeChanged = fromRow.code !== toRow.code;
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
  const isAdmin = checkIsAdmin(c);

  await verifyToolAccess(toolId, user, isAdmin);

  const result = await query(
    `SELECT id, tool_id, version_number, code, schema_json, capabilities_json,
            code_hash, test_results_json, created_at
     FROM public.tool_versions
     WHERE tool_id = $1
     ORDER BY version_number DESC`,
    [toolId],
  );

  return c.json(result.rows);
});

// GET /tools/:id/versions/:versionNumber — Specific version
toolsRouter.get('/:id/versions/:versionNumber', requireAuth, async (c) => {
  const user = c.get('user');
  const toolId = c.req.param('id');
  const versionNumber = parseInt(c.req.param('versionNumber'), 10);
  const isAdmin = checkIsAdmin(c);

  if (isNaN(versionNumber)) {
    throw new HTTPException(400, { message: 'versionNumber must be a valid integer' });
  }

  await verifyToolAccess(toolId, user, isAdmin);

  const result = await query(
    `SELECT id, tool_id, version_number, code, schema_json, capabilities_json,
            code_hash, test_results_json, created_at
     FROM public.tool_versions
     WHERE tool_id = $1 AND version_number = $2
     LIMIT 1`,
    [toolId, versionNumber],
  );

  if (result.rows.length === 0) {
    throw new HTTPException(404, {
      message: `Version ${versionNumber} not found for tool ${toolId}`,
    });
  }

  return c.json(result.rows[0]);
});

// GET /tools/:id — Get tool by ID with its current version
toolsRouter.get('/:id', requireAuth, async (c) => {
  const user = c.get('user');
  const toolId = c.req.param('id');
  const isAdmin = checkIsAdmin(c);

  const result = await query(
    `SELECT t.id, t.owner_id, t.name, t.description, t.type, t.status,
            t.is_public, t.allow_client_execution, t.connector_type,
            t.current_version_id, t.is_archived, t.created_at, t.updated_at,
            tv.version_number as current_version_number,
            tv.code as current_code,
            tv.schema_json as current_schema_json,
            tv.capabilities_json as current_capabilities_json,
            tv.code_hash as current_code_hash,
            tv.test_results_json as current_test_results_json,
            tv.created_at as current_version_created_at
     FROM public.tools t
     LEFT JOIN public.tool_versions tv ON t.current_version_id = tv.id
     WHERE t.id = $1
     LIMIT 1`,
    [toolId],
  );

  if (result.rows.length === 0) {
    throw new HTTPException(404, { message: `Tool ${toolId} not found` });
  }

  const row = result.rows[0];

  // Soft-deleted tools are completely invisible to regular users
  if (row.is_archived && !isAdmin) {
    throw new HTTPException(404, { message: `Tool ${toolId} not found` });
  }

  // Access check: owner, admin, or verified public tool
  const isOwner = row.owner_id === user.id;
  const isPublicVerified = row.is_public && row.status === 'verified';

  if (!isOwner && !isAdmin && !isPublicVerified) {
    throw new HTTPException(404, { message: `Tool ${toolId} not found` });
  }

  return c.json(formatToolRow(row));
});

// POST /tools/:id/versions — Create a new version atomically
toolsRouter.post(
  '/:id/versions',
  requireAuth,
  zValidator('json', CreateToolVersionSchema, (result, c) => {
    if (!result.success) {
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
      status: string;
      is_archived: boolean;
    }>(
      'SELECT id, owner_id, type, status, is_archived FROM public.tools WHERE id = $1 LIMIT 1',
      [toolId],
    );

    if (toolCheck.rows.length === 0 || toolCheck.rows[0].is_archived) {
      throw new HTTPException(404, { message: `Tool ${toolId} not found` });
    }

    const tool = toolCheck.rows[0];
    if (tool.owner_id !== user.id) {
      throw new HTTPException(403, { message: 'You do not have permission to modify this tool' });
    }

    // 2. Enforce type-specific code constraints
    if (tool.type === 'client' && (!code || code.trim() === '')) {
      throw new HTTPException(400, { message: 'code is required for client tools' });
    }
    if (tool.type === 'mcp' && code && code.trim() !== '') {
      throw new HTTPException(400, { message: 'code must not be provided for mcp tools' });
    }

    // 3. Compute code_hash for client tools
    let codeHash: string | null = null;
    if (code) {
      codeHash = await computeCodeHash(code);
    }

    // 4. MCP holding logic: reset to 'testing' for server-side verification review
    if (tool.type === 'mcp') {
      await query("UPDATE public.tools SET status = 'testing', updated_at = now() WHERE id = $1", [
        toolId,
      ]);
    }

    // 5. Invoke atomic PostgreSQL RPC to create version and update current_version_id
    const rpcResult = await query(
      `SELECT id, tool_id, version_number, code, schema_json, capabilities_json,
              code_hash, test_results_json, created_at
       FROM public.create_tool_version($1, $2, $3::jsonb, $4::jsonb, $5)`,
      [
        toolId,
        code ?? null,
        JSON.stringify(schema_json),
        JSON.stringify(capabilities_json ?? []),
        codeHash,
      ],
    );

    if (rpcResult.rows.length === 0) {
      throw new HTTPException(500, { message: 'Failed to create tool version' });
    }

    return c.json(rpcResult.rows[0], 201);
  },
);
