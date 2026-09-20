import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import { requireAuth } from '../middleware/auth';
import { query } from '../services/database';
import { computeCodeHash } from '../utils/crypto';
import { CreateToolSchema, CreateToolVersionSchema } from '../schemas/tools';

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
