import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { query } from '../services/database';
import { timingSafeEqualStrings } from '../utils/crypto';

export const internalMcpRouter = new Hono();

// Auth: accepts x-admin-key OR x-mcp-internal-key
internalMcpRouter.use('*', async (c, next) => {
  const adminKey = c.req.header('x-admin-key');
  const internalKey = c.req.header('x-mcp-internal-key');
  const expectedAdmin =
    (c.env as { ADMIN_SECRET_KEY?: string } | undefined)?.ADMIN_SECRET_KEY ||
    process.env.ADMIN_SECRET_KEY;
  const expectedInternal =
    (c.env as { MCP_INTERNAL_KEY?: string } | undefined)?.MCP_INTERNAL_KEY ||
    process.env.MCP_INTERNAL_KEY ||
    expectedAdmin;

  const validAdmin = Boolean(expectedAdmin && adminKey && timingSafeEqualStrings(adminKey, expectedAdmin));
  const validInternal = Boolean(
    expectedInternal && internalKey && timingSafeEqualStrings(internalKey, expectedInternal),
  );

  if (!validAdmin && !validInternal) {
    throw new HTTPException(401, { message: 'Unauthorized: internal MCP secret or admin key required' });
  }

  await next();
});

/**
 * GET /internal/mcp/tools
 * Returns all tools promoted to MCP server hosting for Agent-Playground-MCP registration.
 */
internalMcpRouter.get('/tools', async (c) => {
  const result = await query(
    `SELECT t.id, t.name, t.description, t.slug, t.mcp_promoted_at,
            tv.id as version_id, tv.version_number,
            coalesce(ts.code, tv.code) as code,
            tv.schema_json, tv.capabilities_json, tv.code_hash
     FROM public.tools t
     LEFT JOIN public.tool_versions tv ON t.current_version_id = tv.id
     LEFT JOIN public.tool_sources ts ON tv.id = ts.version_id
     WHERE t.is_mcp_hosted = true
       AND t.is_archived = false
     ORDER BY t.name ASC`,
  );

  return c.json({
    success: true,
    count: result.rows.length,
    tools: result.rows,
  });
});

