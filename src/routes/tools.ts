import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import { requireAuth } from '../middleware/auth';
import { query } from '../services/database';
import { CreateToolSchema } from '../schemas/tools';

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
