import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import { getSupabaseClient } from '../services/supabase';
import { requireAuth } from '../middleware/auth';
import { SignUpSchema, LoginSchema, RefreshTokenSchema } from '../schemas/auth';
import { AUTH_CONSTANTS } from '../constants';

// ─── Auth Router ──────────────────────────────────────────────────────────────

export const authRouter = new Hono();

// POST /auth/signup
authRouter.post(
  '/signup',
  zValidator('json', SignUpSchema, (result, c) => {
    if (!result.success) {
      return c.json({ statusCode: 400, message: result.error.errors.map(e => e.message) }, 400);
    }
  }),
  async (c) => {
    const { email, password } = c.req.valid('json');
    const supabase = getSupabaseClient();

    // Create user via admin API (auto-confirms email)
    const { data: userData, error: createError } =
      await supabase.auth.admin.createUser({ email, password, email_confirm: true });

    if (createError) {
      throw new HTTPException(400, { message: createError.message });
    }
    if (!userData.user) {
      throw new HTTPException(400, { message: 'User creation failed unexpectedly' });
    }

    // Insert profile row
    await supabase
      .from(AUTH_CONSTANTS.PROFILES_TABLE)
      .insert({ id: userData.user.id, email: userData.user.email });
    // Profile insert errors are non-fatal (table may not yet exist on fresh env)

    // Sign in to get tokens
    const { data: sessionData, error: signInError } =
      await supabase.auth.signInWithPassword({ email, password });

    if (signInError || !sessionData.session) {
      throw new HTTPException(400, {
        message: signInError?.message || 'Failed to establish session after registration',
      });
    }

    return c.json(
      {
        accessToken: sessionData.session.access_token,
        refreshToken: sessionData.session.refresh_token,
      },
      201,
    );
  },
);

// POST /auth/login
authRouter.post(
  '/login',
  zValidator('json', LoginSchema, (result, c) => {
    if (!result.success) {
      return c.json({ statusCode: 400, message: result.error.errors.map(e => e.message) }, 400);
    }
  }),
  async (c) => {
    const { email, password } = c.req.valid('json');
    const { data, error } = await getSupabaseClient().auth.signInWithPassword({ email, password });

    if (error || !data.session) {
      throw new HTTPException(401, { message: error?.message || 'Invalid login credentials' });
    }

    return c.json({
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
    });
  },
);

// POST /auth/refresh
authRouter.post(
  '/refresh',
  zValidator('json', RefreshTokenSchema, (result, c) => {
    if (!result.success) {
      return c.json({ statusCode: 400, message: result.error.errors.map(e => e.message) }, 400);
    }
  }),
  async (c) => {
    const { refreshToken } = c.req.valid('json');
    const { data, error } = await getSupabaseClient().auth.refreshSession({
      refresh_token: refreshToken,
    });

    if (error || !data.session) {
      throw new HTTPException(401, {
        message: error?.message || 'Invalid or expired refresh token',
      });
    }

    return c.json({
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
    });
  },
);

// GET /auth/me  (protected)
authRouter.get('/me', requireAuth, async (c) => {
  const user = c.get('user');
  const { data, error } = await getSupabaseClient()
    .from(AUTH_CONSTANTS.PROFILES_TABLE)
    .select('*')
    .eq('id', user.id)
    .maybeSingle();

  if (error) {
    throw new HTTPException(400, { message: error.message });
  }
  if (!data) {
    throw new HTTPException(404, { message: `Profile for user ${user.id} not found` });
  }

  return c.json(data);
});
