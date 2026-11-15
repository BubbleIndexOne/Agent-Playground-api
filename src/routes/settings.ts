import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { query } from '../services/database';
import { requireAuth } from '../middleware/auth';
import {
  UpdateUserSettingsSchema,
  UserSettingsResponse,
} from '../schemas/settings';

export const settingsRouter = new Hono();

settingsRouter.use('*', requireAuth);

// ─── GET /users/me/settings ──────────────────────────────────────────────────

settingsRouter.get('/', async (c) => {
  const user = c.get('user');

  const res = await query<{
    user_id: string;
    theme: 'system' | 'light' | 'dark';
    extra_json: Record<string, unknown>;
    updated_at: string;
  }>(
    `SELECT user_id, theme, extra_json, updated_at
     FROM public.user_settings
     WHERE user_id = $1
     LIMIT 1`,
    [user.id],
  );

  if (res.rows.length === 0) {
    const defaultSettings: UserSettingsResponse = {
      user_id: user.id,
      theme: 'system',
      extra: {},
    };
    return c.json({ success: true, settings: defaultSettings });
  }

  const row = res.rows[0];
  const settings: UserSettingsResponse = {
    user_id: row.user_id,
    theme: row.theme,
    extra: row.extra_json || {},
    updated_at: new Date(row.updated_at).toISOString(),
  };

  return c.json({ success: true, settings });
});

// ─── PUT & PATCH /users/me/settings ──────────────────────────────────────────

const handleUpsertSettings = async (c: any) => {
  const user = c.get('user');
  const data = c.req.valid('json');

  const theme = data.theme || null;
  const extraJson = data.extra !== undefined ? JSON.stringify(data.extra) : null;

  const res = await query<{
    user_id: string;
    theme: 'system' | 'light' | 'dark';
    extra_json: Record<string, unknown>;
    updated_at: string;
  }>(
    `INSERT INTO public.user_settings (user_id, theme, extra_json, updated_at)
     VALUES ($1, coalesce($2, 'system'), coalesce($3::jsonb, '{}'::jsonb), now())
     ON CONFLICT (user_id) DO UPDATE SET
       theme = coalesce($2, public.user_settings.theme),
       extra_json = coalesce($3::jsonb, public.user_settings.extra_json),
       updated_at = now()
     RETURNING user_id, theme, extra_json, updated_at`,
    [user.id, theme, extraJson],
  );

  const row = res.rows[0];
  const settings: UserSettingsResponse = {
    user_id: row.user_id,
    theme: row.theme,
    extra: row.extra_json || {},
    updated_at: new Date(row.updated_at).toISOString(),
  };

  return c.json({ success: true, settings });
};

settingsRouter.put(
  '/',
  zValidator('json', UpdateUserSettingsSchema, (result, c) => {
    if (!result.success && 'error' in result) {
      return c.json({ statusCode: 400, message: result.error.errors.map((e) => e.message) }, 400);
    }
  }),
  handleUpsertSettings,
);

settingsRouter.patch(
  '/',
  zValidator('json', UpdateUserSettingsSchema, (result, c) => {
    if (!result.success && 'error' in result) {
      return c.json({ statusCode: 400, message: result.error.errors.map((e) => e.message) }, 400);
    }
  }),
  handleUpsertSettings,
);
