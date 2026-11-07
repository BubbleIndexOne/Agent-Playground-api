import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import { requireAuth } from '../middleware/auth';
import { query, withTransaction } from '../services/database';
import { computeCodeHash } from '../utils/crypto';
import {
  InstallToolSchema,
  MarketplaceQuerySchema,
  ToolReportSchema,
} from '../schemas/marketplace';

export const marketplaceRouter = new Hono();

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * GET /marketplace/tools
 * Lists and searches verified public tools available in the community marketplace.
 * Never returns executable source code.
 */
marketplaceRouter.get(
  '/tools',
  zValidator('query', MarketplaceQuerySchema, (result, c) => {
    if (!result.success && 'error' in result) {
      return c.json({ statusCode: 400, message: result.error.errors.map((e) => e.message) }, 400);
    }
  }),
  async (c) => {
    const filters = c.req.valid('query');
    const user = c.get('user'); // Optional / available if caller is authenticated

    const conditions: string[] = [
      't.is_archived = false',
      "(t.visibility = 'public' OR t.is_public = true)",
      "(t.status = 'registered' OR t.status = 'verified')",
    ];
    const params: any[] = [];
    let paramIdx = 1;

    // Search query filter
    if (filters.q && filters.q.trim() !== '') {
      conditions.push(
        `(to_tsvector('english', t.name || ' ' || coalesce(t.description, '')) @@ websearch_to_tsquery('english', $${paramIdx}) OR t.name ILIKE $${paramIdx + 1} OR coalesce(t.description, '') ILIKE $${paramIdx + 1})`,
      );
      params.push(filters.q.trim());
      params.push(`%${filters.q.trim()}%`);
      paramIdx += 2;
    }

    // Type filter
    if (filters.type) {
      conditions.push(`t.type = $${paramIdx++}`);
      params.push(filters.type);
    }

    // Connector type filter
    if (filters.connector) {
      conditions.push(`t.connector_type = $${paramIdx++}`);
      params.push(filters.connector);
    }

    // Tag filter
    if (filters.tag) {
      conditions.push(`$${paramIdx++} = ANY(t.tags)`);
      params.push(filters.tag);
    }

    // Hosting tier filter
    if (filters.hosting_tier === 'mcp') {
      conditions.push('t.is_mcp_hosted = true');
    } else if (filters.hosting_tier === 'client') {
      conditions.push('(t.is_mcp_hosted = false AND t.allow_client_execution = true)');
    }

    // Sorting
    let orderBy = 'ORDER BY coalesce(t.install_count, 0) DESC, t.updated_at DESC';
    if (filters.sort === 'recent') {
      orderBy = 'ORDER BY t.created_at DESC';
    } else if (filters.sort === 'name') {
      orderBy = 'ORDER BY t.name ASC';
    }

    // Cursor pagination (offset-based cursor)
    let offset = 0;
    if (filters.cursor) {
      try {
        const decoded = Buffer.from(filters.cursor, 'base64').toString('utf8');
        const parsedOffset = parseInt(decoded, 10);
        if (!isNaN(parsedOffset) && parsedOffset >= 0) {
          offset = parsedOffset;
        }
      } catch {
        // Ignore invalid cursor
      }
    }

    const limit = filters.limit || 20;
    params.push(limit + 1);
    const limitIdx = paramIdx++;
    params.push(offset);
    const offsetIdx = paramIdx++;

    let result;
    try {
      const sql = `
        SELECT t.id, t.owner_id, t.name, t.description, t.type, t.connector_type,
               t.visibility, t.slug, t.tags, t.install_count,
               t.allow_client_execution, t.is_mcp_hosted, t.mcp_hosting_status,
               t.created_at, t.updated_at,
               p.handle as author_handle, p.display_name as author_name,
               tv.version_number as current_version_number,
               tv.capabilities_json, tv.test_results_json
        FROM public.tools t
        LEFT JOIN public.profiles p ON t.owner_id = p.id
        LEFT JOIN public.tool_versions tv ON t.current_version_id = tv.id
        WHERE ${conditions.join(' AND ')}
        ${orderBy}
        LIMIT $${limitIdx} OFFSET $${offsetIdx}
      `;
      result = await query(sql, params);
    } catch {
      // Fallback if profiles or new columns not fully present
      const fallbackSql = `
        SELECT t.id, t.owner_id, t.name, t.description, t.type, t.connector_type,
               t.is_public, t.allow_client_execution, t.created_at, t.updated_at,
               tv.version_number as current_version_number,
               tv.capabilities_json, tv.test_results_json
        FROM public.tools t
        LEFT JOIN public.tool_versions tv ON t.current_version_id = tv.id
        WHERE ${conditions.join(' AND ')}
        LIMIT $${limitIdx} OFFSET $${offsetIdx}
      `;
      result = await query(fallbackSql, params);
    }

    const rows = result.rows;
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore
      ? Buffer.from(String(offset + limit)).toString('base64')
      : null;

    // Check connector credentials for authenticated viewer
    let userConnectors: Set<string> = new Set();
    let installedToolIds: Set<string> = new Set();

    if (user?.id) {
      try {
        const credRes = await query<{ connector_type: string }>(
          `SELECT connector_type FROM public.user_connector_credentials WHERE user_id = $1`,
          [user.id],
        );
        userConnectors = new Set(credRes.rows.map((r) => r.connector_type));

        const installRes = await query<{ tool_id: string }>(
          `SELECT tool_id FROM public.tool_installs WHERE user_id = $1`,
          [user.id],
        );
        installedToolIds = new Set(installRes.rows.map((r) => r.tool_id));
      } catch {
        // ignore if tables not present
      }
    }

    const tools = items.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      slug: t.slug || null,
      type: t.type,
      connector_type: t.connector_type || null,
      tags: t.tags || [],
      install_count: t.install_count || 0,
      is_installed: installedToolIds.has(t.id),
      allow_client_execution: Boolean(t.allow_client_execution),
      is_mcp_hosted: Boolean(t.is_mcp_hosted),
      mcp_hosting_status: t.mcp_hosting_status || 'none',
      author: {
        id: t.owner_id,
        handle: t.author_handle || null,
        display_name: t.author_name || 'Tool Author',
      },
      requires_connector: t.connector_type || null,
      has_connector_configured: t.connector_type ? userConnectors.has(t.connector_type) : false,
      capabilities: Array.isArray(t.capabilities_json) ? t.capabilities_json : [],
      created_at: t.created_at,
      updated_at: t.updated_at,
    }));

    return c.json({
      success: true,
      tools,
      pagination: {
        limit,
        has_more: hasMore,
        next_cursor: nextCursor,
      },
    });
  },
);

/**
 * GET /marketplace/tools/:idOrSlug
 * Detailed metadata view of a marketplace tool. Never returns source code.
 */
marketplaceRouter.get('/tools/:idOrSlug{.+}', async (c) => {
  const idOrSlug = c.req.param('idOrSlug');
  const user = c.get('user');

  const isUuid = UUID_REGEX.test(idOrSlug);
  const condition = isUuid ? 't.id = $1' : 't.slug = $1';

  let result;
  try {
    result = await query(
      `SELECT t.id, t.owner_id, t.name, t.description, t.type, t.connector_type,
              t.visibility, t.slug, t.tags, t.install_count,
              t.allow_client_execution, t.is_mcp_hosted, t.mcp_hosting_status,
              t.is_archived, t.status, t.current_version_id, t.created_at, t.updated_at,
              p.handle as author_handle, p.display_name as author_name,
              tv.version_number as current_version_number,
              tv.schema_json, tv.capabilities_json, tv.code_hash, tv.test_results_json
       FROM public.tools t
       LEFT JOIN public.profiles p ON t.owner_id = p.id
       LEFT JOIN public.tool_versions tv ON t.current_version_id = tv.id
       WHERE ${condition} AND t.is_archived = false
       LIMIT 1`,
      [idOrSlug],
    );
  } catch {
    result = await query(
      `SELECT t.id, t.owner_id, t.name, t.description, t.type, t.connector_type,
              t.is_public, t.allow_client_execution, t.is_archived, t.status,
              t.current_version_id, t.created_at, t.updated_at,
              tv.version_number as current_version_number,
              tv.schema_json, tv.capabilities_json, tv.code_hash, tv.test_results_json
       FROM public.tools t
       LEFT JOIN public.tool_versions tv ON t.current_version_id = tv.id
       WHERE t.id = $1 AND t.is_archived = false
       LIMIT 1`,
      [idOrSlug],
    );
  }

  if (result.rows.length === 0) {
    throw new HTTPException(404, { message: `Tool "${idOrSlug}" not found in marketplace` });
  }

  const tool = result.rows[0];

  // Must be public, unlisted, or owned by caller
  const isOwner = user?.id && tool.owner_id === user.id;
  const isVisible = tool.visibility === 'public' || tool.visibility === 'unlisted' || tool.is_public;
  if (!isVisible && !isOwner) {
    throw new HTTPException(404, { message: `Tool "${idOrSlug}" not found in marketplace` });
  }

  // Version history (safe metadata only — NO code column!)
  const versionsResult = await query(
    `SELECT id, version_number, schema_json, capabilities_json, code_hash, test_results_json, created_at
     FROM public.tool_versions
     WHERE tool_id = $1
     ORDER BY version_number DESC`,
    [tool.id],
  );

  let isInstalled = false;
  let pinnedVersionNumber: number | null = null;
  let hasConnectorConfigured = false;

  if (user?.id) {
    try {
      const installRes = await query<{ pinned_version_id: string }>(
        `SELECT pinned_version_id FROM public.tool_installs WHERE user_id = $1 AND tool_id = $2 LIMIT 1`,
        [user.id, tool.id],
      );
      if (installRes.rows.length > 0) {
        isInstalled = true;
        const pinnedVer = versionsResult.rows.find((v) => v.id === installRes.rows[0].pinned_version_id);
        pinnedVersionNumber = pinnedVer ? pinnedVer.version_number : null;
      }

      if (tool.connector_type) {
        const credRes = await query(
          `SELECT id FROM public.user_connector_credentials WHERE user_id = $1 AND connector_type = $2 LIMIT 1`,
          [user.id, tool.connector_type],
        );
        hasConnectorConfigured = credRes.rows.length > 0;
      }
    } catch {
      // ignore
    }
  }

  return c.json({
    success: true,
    tool: {
      id: tool.id,
      name: tool.name,
      description: tool.description,
      slug: tool.slug || null,
      type: tool.type,
      connector_type: tool.connector_type || null,
      tags: tool.tags || [],
      install_count: tool.install_count || 0,
      is_installed: isInstalled,
      pinned_version_number: pinnedVersionNumber,
      allow_client_execution: Boolean(tool.allow_client_execution),
      is_mcp_hosted: Boolean(tool.is_mcp_hosted),
      mcp_hosting_status: tool.mcp_hosting_status || 'none',
      author: {
        id: tool.owner_id,
        handle: tool.author_handle || null,
        display_name: tool.author_name || 'Tool Author',
      },
      requires_connector: tool.connector_type || null,
      has_connector_configured: hasConnectorConfigured,
      current_version: {
        version_number: tool.current_version_number,
        schema_json: tool.schema_json,
        capabilities_json: tool.capabilities_json,
        code_hash: tool.code_hash,
        test_results_json: tool.test_results_json,
      },
      versions: versionsResult.rows,
      created_at: tool.created_at,
      updated_at: tool.updated_at,
    },
  });
});

/**
 * POST /marketplace/tools/:id/install
 * Installs and pins a tool version to caller's account via tool_installs.
 */
marketplaceRouter.post(
  '/tools/:id/install',
  requireAuth,
  zValidator('json', InstallToolSchema.optional(), (result, c) => {
    if (!result.success && 'error' in result) {
      return c.json({ statusCode: 400, message: result.error.errors.map((e) => e.message) }, 400);
    }
  }),
  async (c) => {
    const user = c.get('user');
    const toolId = c.req.param('id');
    const body = (await c.req.json().catch(() => ({}))) || {};

    const toolCheck = await query<{
      id: string;
      name: string;
      current_version_id: string;
      is_archived: boolean;
      status: string;
    }>(
      'SELECT id, name, current_version_id, is_archived, status FROM public.tools WHERE id = $1 LIMIT 1',
      [toolId],
    );

    if (toolCheck.rows.length === 0 || toolCheck.rows[0].is_archived) {
      throw new HTTPException(404, { message: `Tool ${toolId} not found` });
    }

    const tool = toolCheck.rows[0];
    const targetVersionId = body.version_id || tool.current_version_id;

    if (!targetVersionId) {
      throw new HTTPException(400, { message: 'Tool has no registered version to install' });
    }

    const result = await query<{
      user_id: string;
      tool_id: string;
      pinned_version_id: string;
      installed_at: string;
    }>(
      `INSERT INTO public.tool_installs (user_id, tool_id, pinned_version_id, installed_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (user_id, tool_id)
       DO UPDATE SET pinned_version_id = excluded.pinned_version_id, installed_at = now()
       RETURNING user_id, tool_id, pinned_version_id, installed_at`,
      [user.id, toolId, targetVersionId],
    );

    // Increment install_count atomically
    await query(
      `UPDATE public.tools SET install_count = coalesce(install_count, 0) + 1 WHERE id = $1`,
      [toolId],
    ).catch(() => {});

    return c.json({
      success: true,
      message: `Tool ${tool.name} successfully installed`,
      install: result.rows[0],
    });
  },
);

/**
 * DELETE /marketplace/tools/:id/install
 * Uninstalls a tool from caller's account.
 */
marketplaceRouter.delete('/tools/:id/install', requireAuth, async (c) => {
  const user = c.get('user');
  const toolId = c.req.param('id');

  const result = await query(
    `DELETE FROM public.tool_installs WHERE user_id = $1 AND tool_id = $2 RETURNING tool_id`,
    [user.id, toolId],
  );

  if (result.rows.length === 0) {
    throw new HTTPException(404, { message: 'Tool is not installed in your account' });
  }

  // Decrement install_count atomically
  await query(
    `UPDATE public.tools SET install_count = greatest(0, coalesce(install_count, 1) - 1) WHERE id = $1`,
    [toolId],
  ).catch(() => {});

  return c.json({
    success: true,
    message: 'Tool successfully uninstalled',
  });
});

/**
 * POST /marketplace/tools/:id/fork
 * Creates a personal copy of an open-source tool.
 * Strictly forbidden for protected / server-hosted MCP tools.
 */
marketplaceRouter.post('/tools/:id/fork', requireAuth, async (c) => {
  const user = c.get('user');
  const toolId = c.req.param('id');

  const toolCheck = await query<{
    id: string;
    name: string;
    description: string | null;
    type: string;
    current_version_id: string;
    allow_client_execution: boolean;
    is_mcp_hosted?: boolean;
    is_archived: boolean;
  }>(
    'SELECT id, name, description, type, current_version_id, allow_client_execution, is_mcp_hosted, is_archived FROM public.tools WHERE id = $1 LIMIT 1',
    [toolId],
  );

  if (toolCheck.rows.length === 0 || toolCheck.rows[0].is_archived) {
    throw new HTTPException(404, { message: `Tool ${toolId} not found` });
  }

  const tool = toolCheck.rows[0];

  // Strictly protected check
  if (!tool.allow_client_execution || tool.is_mcp_hosted) {
    throw new HTTPException(403, {
      message:
        'Protected server tools cannot be forked. Only open-source tools with client execution enabled may be forked.',
    });
  }

  // Fetch source code and schema from source tables
  let versionRow;
  try {
    versionRow = await query<{ code: string; schema_json: any; capabilities_json: any }>(
      `SELECT coalesce(ts.code, tv.code) as code, tv.schema_json, tv.capabilities_json
       FROM public.tool_versions tv
       LEFT JOIN public.tool_sources ts ON tv.id = ts.version_id
       WHERE tv.id = $1 LIMIT 1`,
      [tool.current_version_id],
    );
  } catch {
    versionRow = await query<{ code: string; schema_json: any; capabilities_json: any }>(
      `SELECT code, schema_json, capabilities_json FROM public.tool_versions WHERE id = $1 LIMIT 1`,
      [tool.current_version_id],
    );
  }

  if (versionRow.rows.length === 0 || !versionRow.rows[0].code) {
    throw new HTTPException(400, { message: 'Source code not available for forking' });
  }

  const { code, schema_json, capabilities_json } = versionRow.rows[0];

  // Atomically create new draft tool and initial version
  const newTool = await withTransaction(async (client) => {
    const forkName = `Fork of ${tool.name}`.slice(0, 100);
    const toolInsert = await client.query<{ id: string; name: string }>(
      `INSERT INTO public.tools (
         owner_id, name, description, type, is_public, visibility, allow_client_execution, status
       ) VALUES ($1, $2, $3, 'client', false, 'private', true, 'draft')
       RETURNING id, name, description, type, status, is_public, visibility, allow_client_execution, created_at`,
      [user.id, forkName, tool.description],
    );

    const newToolId = toolInsert.rows[0].id;
    const codeHash = await computeCodeHash(code);

    await client.query(
      `SELECT * FROM public.create_tool_version($1, $2, $3::jsonb, $4::jsonb, $5, null)`,
      [
        newToolId,
        code,
        JSON.stringify(schema_json),
        JSON.stringify(capabilities_json || []),
        codeHash,
      ],
    );

    return toolInsert.rows[0];
  });

  return c.json(
    {
      success: true,
      message: `Tool ${tool.name} successfully forked into your workspace`,
      tool: newTool,
    },
    201,
  );
});

/**
 * POST /marketplace/tools/:id/report
 * Files a moderation report for a tool. Deduplicates open reports per user.
 * Automatically holds the tool to 'unlisted' if distinct open reports reach threshold.
 */
marketplaceRouter.post(
  '/tools/:id/report',
  requireAuth,
  zValidator('json', ToolReportSchema, (result, c) => {
    if (!result.success && 'error' in result) {
      return c.json({ statusCode: 400, message: result.error.errors.map((e) => e.message) }, 400);
    }
  }),
  async (c) => {
    const user = c.get('user');
    const toolId = c.req.param('id');
    const { reason, details } = c.req.valid('json');

    const toolCheck = await query<{
      id: string;
      name: string;
      visibility?: string;
      is_public: boolean;
      is_archived: boolean;
    }>('SELECT id, name, visibility, is_public, is_archived FROM public.tools WHERE id = $1 LIMIT 1', [
      toolId,
    ]);

    if (toolCheck.rows.length === 0 || toolCheck.rows[0].is_archived) {
      throw new HTTPException(404, { message: `Tool ${toolId} not found` });
    }

    const tool = toolCheck.rows[0];

    // Deduplication check: only one open report per user on this tool
    try {
      await query(
        `INSERT INTO public.tool_reports (tool_id, reporter_id, reason, status, created_at)
         VALUES ($1, $2, $3, 'open', now())`,
        [toolId, user.id, details ? `${reason}: ${details}` : reason],
      );
    } catch (err: any) {
      if (err.code === '23505' || String(err.message).includes('unique')) {
        throw new HTTPException(409, {
          message: 'You already have an open report pending review for this tool',
        });
      }
      throw err;
    }

    // Check count of distinct open reporters on this tool
    const countRes = await query<{ count: string | number }>(
      `SELECT count(distinct reporter_id) as count FROM public.tool_reports WHERE tool_id = $1 AND status = 'open'`,
      [toolId],
    );
    const openReportsCount = parseInt(String(countRes.rows[0]?.count || '1'), 10);

    // Resolve configurable auto-hold threshold (5 for dev, 3 for prod)
    const env = c.env as any;
    const configuredThreshold = parseInt(
      env?.TOOL_REPORT_AUTOHOLD_THRESHOLD ||
        (env?.ENVIRONMENT === 'production' ? '3' : '5') ||
        '3',
      10,
    );

    let underReviewHold = false;
    if (openReportsCount >= configuredThreshold) {
      // Auto-hold: flip visibility to 'unlisted' (never auto-delete!)
      await query(
        `UPDATE public.tools
         SET visibility = 'unlisted',
             is_public = false,
             updated_at = now()
         WHERE id = $1`,
        [toolId],
      );
      underReviewHold = true;
    }

    return c.json({
      success: true,
      reported: true,
      status: underReviewHold ? 'under_review' : 'received',
      message: underReviewHold
        ? `Report submitted. Tool placed on administrative review hold pending moderator inspection.`
        : 'Report submitted successfully. Thank you for keeping the marketplace safe.',
    });
  },
);
