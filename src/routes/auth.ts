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

    // Use the public signup flow so Supabase requires email verification.
    const { data: userData, error: createError } =
      await supabase.auth.signUp({ email, password });

    if (createError) {
      throw new HTTPException(400, { message: createError.message });
    }
    if (!userData.user) {
      throw new HTTPException(400, { message: 'User creation failed unexpectedly' });
    }

    // Use upsert so that if the database trigger (handle_new_user) already created
    // the profile record upon auth.users creation, this safely updates/attaches the email
    // without failing with a duplicate key error.
    const { error: profileError } = await supabase
      .from(AUTH_CONSTANTS.PROFILES_TABLE)
      .upsert({ id: userData.user.id, email: userData.user.email });

    if (profileError) {
      console.error('[Auth] Profile creation failed', profileError);
      const { error: cleanupError } = await supabase.auth.admin.deleteUser(userData.user.id);

      if (cleanupError) {
        console.error('[Auth] Failed to remove user after profile creation failure', cleanupError);
      }

      throw new HTTPException(500, { message: 'Profile creation failed' });
    }

    return c.json(
      { message: 'Check your email to verify your account before signing in' },
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
