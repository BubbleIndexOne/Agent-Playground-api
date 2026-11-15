import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import { query, withTransaction } from '../services/database';
import { requireAuth } from '../middleware/auth';
import {
  CreateAgentSchema,
  UpdateAgentSchema,
  ListAgentsQuerySchema,
  ImportAgentsSchema,
  getDefaultBlobbie,
  AgentResponse,
  AttachedToolDetail,
} from '../schemas/agents';

export const agentsRouter = new Hono();

agentsRouter.use('*', requireAuth);

/**
 * Helper to fetch attached tools for an array of agent IDs.
 */
async function fetchToolsForAgents(
  agentIds: string[],
  userId: string,
): Promise<Map<string, AttachedToolDetail[]>> {
  const result = new Map<string, AttachedToolDetail[]>();
  if (agentIds.length === 0) return result;

  for (const id of agentIds) {
    result.set(id, []);
  }

  const toolRows = await query<{
    agent_id: string;
    tool_id: string;
    name: string;
    pinned_version: number | null;
    current_version: number | null;
    status: string;
    type: 'client' | 'mcp';
  }>(
    `SELECT 
       at.agent_id,
       at.tool_id,
       at.pinned_version,
       t.name,
       coalesce(tv.version_number, 1) as current_version,
       t.status,
       t.type
     FROM public.agent_tools at
     JOIN public.tools t ON t.id = at.tool_id
     LEFT JOIN public.tool_versions tv ON tv.id = t.current_version_id
     WHERE at.agent_id = ANY($1::uuid[])
       AND (t.owner_id = $2 OR t.status IN ('registered', 'verified'))
     ORDER BY t.name ASC`,
    [agentIds, userId],
  );

  for (const row of toolRows.rows) {
    const list = result.get(row.agent_id) || [];
    list.push({
      tool_id: row.tool_id,
      name: row.name,
      pinned_version: row.pinned_version,
      current_version: row.current_version ?? 1,
      status: row.status,
      type: row.type,
    });
    result.set(row.agent_id, list);
  }

  return result;
}

function formatAgentRow(row: any, tools: AttachedToolDetail[] = []): AgentResponse {
  const avatar =
    row.avatar_json && typeof row.avatar_json === 'object' && Object.keys(row.avatar_json).length > 0
      ? row.avatar_json
      : getDefaultBlobbie(row.name || row.id);

  return {
    id: row.id,
    name: row.name,
    description: row.description || '',
    system_prompt: row.system_prompt || '',
    source_preset_id: row.source_preset_id || null,
    model_provider: row.model_provider,
    model_id: row.model_id,
    model_params: row.model_params || {},
    avatar,
    attached_tools: tools,
    attached_connectors: Array.isArray(row.attached_connectors) ? row.attached_connectors : [],
    is_archived: Boolean(row.is_archived),
    created_at: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
    updated_at: row.updated_at ? new Date(row.updated_at).toISOString() : new Date().toISOString(),
  };
}

// ─── GET /agents ─────────────────────────────────────────────────────────────

agentsRouter.get(
  '/',
  zValidator('query', ListAgentsQuerySchema, (result, c) => {
    if (!result.success && 'error' in result) {
      return c.json({ statusCode: 400, message: result.error.errors.map((e) => e.message) }, 400);
    }
  }),
  async (c) => {
    const user = c.get('user');
    const { include_archived, search } = c.req.valid('query');

    const searchPattern = search ? `%${search}%` : null;

    const res = await query(
      `SELECT 
         id, name, description, system_prompt, source_preset_id,
         model_provider, model_id, model_params, avatar_json,
         attached_connectors, is_archived, created_at, updated_at
       FROM public.agents
       WHERE owner_id = $1
         AND ($2::boolean = true OR is_archived = false)
         AND ($3::text IS NULL OR name ILIKE $3 OR description ILIKE $3)
       ORDER BY updated_at DESC`,
      [user.id, include_archived ?? false, searchPattern],
    );

    const agentIds = res.rows.map((r: any) => r.id);
    const toolsMap = await fetchToolsForAgents(agentIds, user.id);

    const agents: AgentResponse[] = res.rows.map((row: any) =>
      formatAgentRow(row, toolsMap.get(row.id) || []),
    );

    return c.json({ success: true, agents });
  },
);

// ─── POST /agents ────────────────────────────────────────────────────────────

agentsRouter.post(
  '/',
  zValidator('json', CreateAgentSchema, (result, c) => {
    if (!result.success && 'error' in result) {
      return c.json({ statusCode: 400, message: result.error.errors.map((e) => e.message) }, 400);
    }
  }),
  async (c) => {
    const user = c.get('user');
    const data = c.req.valid('json');

    let provider = data.model_provider;
    let modelId = data.model_id;
    let modelParams = data.model_params || {};

    // If source_preset_id is provided, verify ownership or fallback defaults
    if (data.source_preset_id) {
      const presetRes = await query<{
        provider: string;
        model_id: string | null;
        params_json: Record<string, unknown>;
      }>(
        `SELECT provider, model_id, params_json 
         FROM public.model_presets 
         WHERE id = $1 AND (owner_id = $2 OR owner_id IS NULL)
         LIMIT 1`,
        [data.source_preset_id, user.id],
      );

      if (presetRes.rows.length > 0) {
        const p = presetRes.rows[0];
        if (!provider) provider = p.provider as any;
        if (!modelId && p.model_id) modelId = p.model_id;
        if (Object.keys(modelParams).length === 0 && p.params_json) {
          modelParams = p.params_json;
        }
      }
    }

    if (!provider) provider = 'google';
    if (!modelId) modelId = 'gemini-2.5-flash';

    const avatar = data.avatar || getDefaultBlobbie(data.name);

    const agent = await withTransaction(async (client) => {
      const agentId = data.id || crypto.randomUUID();
      const insertRes = await client.query(
        `INSERT INTO public.agents (
           id, owner_id, name, description, system_prompt, source_preset_id,
           model_provider, model_id, model_params, avatar_json, attached_connectors
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           description = EXCLUDED.description,
           system_prompt = EXCLUDED.system_prompt,
           source_preset_id = EXCLUDED.source_preset_id,
           model_provider = EXCLUDED.model_provider,
           model_id = EXCLUDED.model_id,
           model_params = EXCLUDED.model_params,
           avatar_json = EXCLUDED.avatar_json,
           attached_connectors = EXCLUDED.attached_connectors,
           is_archived = false,
           updated_at = now()
         RETURNING *`,
        [
          agentId,
          user.id,
          data.name,
          data.description || '',
          data.system_prompt || '',
          data.source_preset_id || null,
          provider,
          modelId,
          JSON.stringify(modelParams),
          JSON.stringify(avatar),
          JSON.stringify(data.attached_connectors || []),
        ],
      );

      const createdAgent = insertRes.rows[0];

      if (data.attached_tools && data.attached_tools.length > 0) {
        for (const tool of data.attached_tools) {
          await client.query(
            `INSERT INTO public.agent_tools (agent_id, tool_id, pinned_version)
             VALUES ($1, $2, $3)
             ON CONFLICT (agent_id, tool_id) DO UPDATE SET pinned_version = EXCLUDED.pinned_version`,
            [createdAgent.id, tool.tool_id, tool.pinned_version ?? null],
          );
        }
      }

      return createdAgent;
    });

    const toolsMap = await fetchToolsForAgents([agent.id], user.id);
    const agentResponse = formatAgentRow(agent, toolsMap.get(agent.id) || []);

    return c.json(agentResponse, 201);
  },
);

// ─── POST /agents/export ─────────────────────────────────────────────────────

agentsRouter.post('/export', async (c) => {
  const user = c.get('user');

  const res = await query(
    `SELECT 
       id, name, description, system_prompt, source_preset_id,
       model_provider, model_id, model_params, avatar_json,
       attached_connectors, is_archived, created_at, updated_at
     FROM public.agents
     WHERE owner_id = $1 AND is_archived = false
     ORDER BY name ASC`,
    [user.id],
  );

  const agentIds = res.rows.map((r: any) => r.id);
  const toolsMap = await fetchToolsForAgents(agentIds, user.id);

  const agents: AgentResponse[] = res.rows.map((row: any) =>
    formatAgentRow(row, toolsMap.get(row.id) || []),
  );

  return c.json({
    version: 1,
    exported_at: new Date().toISOString(),
    agents,
  });
});

// ─── POST /agents/import ─────────────────────────────────────────────────────

agentsRouter.post(
  '/import',
  zValidator('json', ImportAgentsSchema, (result, c) => {
    if (!result.success && 'error' in result) {
      return c.json({ statusCode: 400, message: result.error.errors.map((e) => e.message) }, 400);
    }
  }),
  async (c) => {
    const user = c.get('user');
    const { agents } = c.req.valid('json');

    const imported = await withTransaction(async (client) => {
      const results: any[] = [];

      for (const item of agents) {
        const agentId = item.id || crypto.randomUUID();
        const avatar = item.avatar || getDefaultBlobbie(item.name);
        const provider = item.model_provider || 'google';
        const modelId = item.model_id || 'gemini-2.5-flash';
        const modelParams = item.model_params || {};

        const insertRes = await client.query(
          `INSERT INTO public.agents (
             id, owner_id, name, description, system_prompt, source_preset_id,
             model_provider, model_id, model_params, avatar_json, attached_connectors
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           ON CONFLICT (id) DO UPDATE SET
             name = EXCLUDED.name,
             description = EXCLUDED.description,
             system_prompt = EXCLUDED.system_prompt,
             source_preset_id = EXCLUDED.source_preset_id,
             model_provider = EXCLUDED.model_provider,
             model_id = EXCLUDED.model_id,
             model_params = EXCLUDED.model_params,
             avatar_json = EXCLUDED.avatar_json,
             attached_connectors = EXCLUDED.attached_connectors,
             is_archived = false,
             updated_at = now()
           RETURNING *`,
          [
            agentId,
            user.id,
            item.name,
            item.description || '',
            item.system_prompt || '',
            item.source_preset_id || null,
            provider,
            modelId,
            JSON.stringify(modelParams),
            JSON.stringify(avatar),
            JSON.stringify(item.attached_connectors || []),
          ],
        );

        const createdAgent = insertRes.rows[0];

        if (item.attached_tools && item.attached_tools.length > 0) {
          await client.query('DELETE FROM public.agent_tools WHERE agent_id = $1', [createdAgent.id]);
          for (const tool of item.attached_tools) {
            await client.query(
              `INSERT INTO public.agent_tools (agent_id, tool_id, pinned_version)
               VALUES ($1, $2, $3)
               ON CONFLICT (agent_id, tool_id) DO UPDATE SET pinned_version = EXCLUDED.pinned_version`,
              [createdAgent.id, tool.tool_id, tool.pinned_version ?? null],
            );
          }
        }

        results.push(createdAgent);
      }

      return results;
    });

    const agentIds = imported.map((a: any) => a.id);
    const toolsMap = await fetchToolsForAgents(agentIds, user.id);
    const responseAgents: AgentResponse[] = imported.map((row: any) =>
      formatAgentRow(row, toolsMap.get(row.id) || []),
    );

    return c.json({ success: true, count: responseAgents.length, agents: responseAgents });
  },
);

// ─── GET /agents/:id ─────────────────────────────────────────────────────────

agentsRouter.get('/:id', async (c) => {
  const user = c.get('user');
  const agentId = c.req.param('id');

  const res = await query(
    `SELECT 
       id, name, description, system_prompt, source_preset_id,
       model_provider, model_id, model_params, avatar_json,
       attached_connectors, is_archived, created_at, updated_at
     FROM public.agents
     WHERE id = $1 AND owner_id = $2
     LIMIT 1`,
    [agentId, user.id],
  );

  if (res.rows.length === 0) {
    throw new HTTPException(404, { message: 'Agent not found' });
  }

  const toolsMap = await fetchToolsForAgents([agentId], user.id);
  const agentResponse = formatAgentRow(res.rows[0], toolsMap.get(agentId) || []);

  return c.json(agentResponse);
});

// ─── PATCH /agents/:id ───────────────────────────────────────────────────────

agentsRouter.patch(
  '/:id',
  zValidator('json', UpdateAgentSchema, (result, c) => {
    if (!result.success && 'error' in result) {
      return c.json({ statusCode: 400, message: result.error.errors.map((e) => e.message) }, 400);
    }
  }),
  async (c) => {
    const user = c.get('user');
    const agentId = c.req.param('id');
    const data = c.req.valid('json');

    // Verify existing agent
    const checkRes = await query<{ id: string }>(
      'SELECT id FROM public.agents WHERE id = $1 AND owner_id = $2 LIMIT 1',
      [agentId, user.id],
    );

    if (checkRes.rows.length === 0) {
      throw new HTTPException(404, { message: 'Agent not found' });
    }

    const updated = await withTransaction(async (client) => {
      const updates: string[] = [];
      const values: any[] = [];
      let idx = 1;

      if (data.name !== undefined) {
        updates.push(`name = $${idx++}`);
        values.push(data.name);
      }
      if (data.description !== undefined) {
        updates.push(`description = $${idx++}`);
        values.push(data.description);
      }
      if (data.system_prompt !== undefined) {
        updates.push(`system_prompt = $${idx++}`);
        values.push(data.system_prompt);
      }
      if (data.source_preset_id !== undefined) {
        updates.push(`source_preset_id = $${idx++}`);
        values.push(data.source_preset_id);
      }
      if (data.model_provider !== undefined) {
        updates.push(`model_provider = $${idx++}`);
        values.push(data.model_provider);
      }
      if (data.model_id !== undefined) {
        updates.push(`model_id = $${idx++}`);
        values.push(data.model_id);
      }
      if (data.model_params !== undefined) {
        updates.push(`model_params = $${idx++}`);
        values.push(JSON.stringify(data.model_params));
      }
      if (data.avatar !== undefined) {
        updates.push(`avatar_json = $${idx++}`);
        values.push(JSON.stringify(data.avatar));
      }
      if (data.attached_connectors !== undefined) {
        updates.push(`attached_connectors = $${idx++}`);
        values.push(JSON.stringify(data.attached_connectors));
      }
      if (data.is_archived !== undefined) {
        updates.push(`is_archived = $${idx++}`);
        values.push(data.is_archived);
      }

      let updatedRow;
      if (updates.length > 0) {
        values.push(agentId, user.id);
        const updateSql = `
          UPDATE public.agents
          SET ${updates.join(', ')}
          WHERE id = $${idx++} AND owner_id = $${idx++}
          RETURNING *`;
        const res = await client.query(updateSql, values);
        updatedRow = res.rows[0];
      } else {
        const res = await client.query(
          'SELECT * FROM public.agents WHERE id = $1 AND owner_id = $2',
          [agentId, user.id],
        );
        updatedRow = res.rows[0];
      }

      // If attached_tools is provided, replace tool list
      if (data.attached_tools !== undefined) {
        await client.query('DELETE FROM public.agent_tools WHERE agent_id = $1', [agentId]);
        for (const tool of data.attached_tools) {
          await client.query(
            `INSERT INTO public.agent_tools (agent_id, tool_id, pinned_version)
             VALUES ($1, $2, $3)
             ON CONFLICT (agent_id, tool_id) DO UPDATE SET pinned_version = EXCLUDED.pinned_version`,
            [agentId, tool.tool_id, tool.pinned_version ?? null],
          );
        }
      }

      return updatedRow;
    });

    const toolsMap = await fetchToolsForAgents([agentId], user.id);
    return c.json(formatAgentRow(updated, toolsMap.get(agentId) || []));
  },
);

// ─── DELETE /agents/:id ──────────────────────────────────────────────────────

agentsRouter.delete('/:id', async (c) => {
  const user = c.get('user');
  const agentId = c.req.param('id');
  const hard = c.req.query('hard') === 'true';

  const checkRes = await query<{ id: string }>(
    'SELECT id FROM public.agents WHERE id = $1 AND owner_id = $2 LIMIT 1',
    [agentId, user.id],
  );

  if (checkRes.rows.length === 0) {
    throw new HTTPException(404, { message: 'Agent not found' });
  }

  if (hard) {
    await query('DELETE FROM public.agents WHERE id = $1 AND owner_id = $2', [agentId, user.id]);
    return c.json({ success: true, message: 'Agent permanently deleted' });
  } else {
    await query(
      'UPDATE public.agents SET is_archived = true WHERE id = $1 AND owner_id = $2',
      [agentId, user.id],
    );
    return c.json({ success: true, message: 'Agent archived successfully' });
  }
});
