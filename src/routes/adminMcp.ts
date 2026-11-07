import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { query } from '../services/database';
import { timingSafeEqualStrings } from '../utils/crypto';

export const adminMcpRouter = new Hono();

// Middleware: Strictly enforces x-admin-key ONLY (Bearer tokens rejected)
adminMcpRouter.use('*', async (c, next) => {
  const adminKey = c.req.header('x-admin-key');
  const expectedAdminKey =
    (c.env as { ADMIN_SECRET_KEY?: string } | undefined)?.ADMIN_SECRET_KEY ||
    process.env.ADMIN_SECRET_KEY;

  if (!expectedAdminKey || !adminKey || !timingSafeEqualStrings(adminKey, expectedAdminKey)) {
    throw new HTTPException(401, { message: 'Unauthorized: valid x-admin-key header is required' });
  }

  await next();
});

/**
 * GET /admin/mcp/queue
 * Returns tools awaiting automated security audit and MCP promotion.
 */
adminMcpRouter.get('/queue', async (c) => {
  const result = await query(
    `SELECT t.id, t.owner_id, t.name, t.description, t.type, t.status,
            t.mcp_hosting_status, t.is_mcp_hosted, t.mcp_promoted_at, t.mcp_review_notes,
            t.slug, t.tags, t.created_at, t.updated_at,
            p.handle as author_handle, p.display_name as author_name, p.email as author_email,
            tv.id as version_id, tv.version_number,
            coalesce(ts.code, tv.code) as code,
            tv.schema_json, tv.capabilities_json, tv.code_hash, tv.test_results_json
     FROM public.tools t
     LEFT JOIN public.profiles p ON t.owner_id = p.id
     LEFT JOIN public.tool_versions tv ON t.current_version_id = tv.id
     LEFT JOIN public.tool_sources ts ON tv.id = ts.version_id
     WHERE t.mcp_hosting_status IN ('requested', 'in_review')
       AND t.is_archived = false
     ORDER BY t.updated_at ASC`,
  );

  return c.json({
    success: true,
    count: result.rows.length,
    queue: result.rows,
  });
});

/**
 * POST /admin/mcp/:id/promote
 * Called exclusively by CI/CD test automations to promote a verified tool to the MCP server.
 */
adminMcpRouter.post('/:id/promote', async (c) => {
  const toolId = c.req.param('id');

  const toolCheck = await query<{ id: string; name: string; owner_id: string; is_archived: boolean }>(
    'SELECT id, name, owner_id, is_archived FROM public.tools WHERE id = $1 LIMIT 1',
    [toolId],
  );

  if (toolCheck.rows.length === 0 || toolCheck.rows[0].is_archived) {
    throw new HTTPException(404, { message: `Tool ${toolId} not found` });
  }

  const result = await query<{
    id: string;
    name: string;
    is_mcp_hosted: boolean;
    mcp_hosting_status: string;
    mcp_promoted_at: string;
    visibility: string;
    is_public: boolean;
  }>(
    `UPDATE public.tools
     SET is_mcp_hosted = true,
         mcp_hosting_status = 'approved',
         mcp_promoted_at = now(),
         allow_client_execution = false,
         visibility = 'public',
         is_public = true,
         updated_at = now()
     WHERE id = $1
     RETURNING id, name, is_mcp_hosted, mcp_hosting_status, mcp_promoted_at, visibility, is_public`,
    [toolId],
  );

  return c.json({
    success: true,
    message: `Tool ${toolCheck.rows[0].name} successfully promoted to MCP server`,
    tool: result.rows[0],
  });
});

/**
 * POST /admin/mcp/:id/reject
 * Rejects an MCP hosting request with review notes.
 */
adminMcpRouter.post('/:id/reject', async (c) => {
  const toolId = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const reason =
    typeof body.reason === 'string' && body.reason.trim().length > 0
      ? body.reason.trim()
      : 'Automated security/sandboxing checks failed';

  const toolCheck = await query<{ id: string; name: string; is_archived: boolean }>(
    'SELECT id, name, is_archived FROM public.tools WHERE id = $1 LIMIT 1',
    [toolId],
  );

  if (toolCheck.rows.length === 0 || toolCheck.rows[0].is_archived) {
    throw new HTTPException(404, { message: `Tool ${toolId} not found` });
  }

  const result = await query<{
    id: string;
    name: string;
    is_mcp_hosted: boolean;
    mcp_hosting_status: string;
    mcp_review_notes: string;
  }>(
    `UPDATE public.tools
     SET mcp_hosting_status = 'rejected',
         mcp_review_notes = $2,
         updated_at = now()
     WHERE id = $1
     RETURNING id, name, is_mcp_hosted, mcp_hosting_status, mcp_review_notes`,
    [toolId, reason],
  );

  return c.json({
    success: true,
    message: `Tool ${toolCheck.rows[0].name} rejected from MCP server hosting`,
    tool: result.rows[0],
  });
});

