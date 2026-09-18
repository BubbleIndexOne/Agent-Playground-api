import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import bcrypt from 'bcryptjs';
import { query } from '../services/database';
import { signAccessToken, generateRefreshToken } from '../services/jwt';
import { requireAuth } from '../middleware/auth';
import { SignUpSchema, LoginSchema, RefreshTokenSchema } from '../schemas/auth';
import { AUTH_CONSTANTS, JWT_CONSTANTS } from '../constants';

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

    // Check if email is already taken
    const existing = await query<{ id: string }>(
      'SELECT id FROM public.users WHERE email = $1 LIMIT 1',
      [email],
    );
    if (existing.rows.length > 0) {
      throw new HTTPException(409, { message: 'An account with this email already exists' });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, AUTH_CONSTANTS.BCRYPT_SALT_ROUNDS);

    // Insert user and auto-create profile in one transaction
    const insertResult = await query<{ id: string; email: string }>(
      `WITH inserted_user AS (
         INSERT INTO public.users (email, password_hash)
         VALUES ($1, $2)
         RETURNING id, email
       )
       INSERT INTO public.profiles (id, email)
       SELECT id, email FROM inserted_user
       RETURNING (SELECT id FROM inserted_user), (SELECT email FROM inserted_user)`,
      [email, passwordHash],
    );

    if (insertResult.rows.length === 0) {
      throw new HTTPException(500, { message: 'Account creation failed unexpectedly' });
    }

    return c.json({ message: 'Account created successfully' }, 201);
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

    // Look up user
    const result = await query<{ id: string; email: string; password_hash: string }>(
      'SELECT id, email, password_hash FROM public.users WHERE email = $1 LIMIT 1',
      [email],
    );

    const user = result.rows[0];

    // Constant-time failure — don't leak whether the email exists
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      throw new HTTPException(401, { message: 'Invalid email or password' });
    }

    // Sign access token
    const accessToken = await signAccessToken(user.id, user.email);

    // Generate and store refresh token
    const refreshToken = generateRefreshToken();
    const expiresAt = new Date(Date.now() + JWT_CONSTANTS.REFRESH_TOKEN_TTL_MS);

    await query(
      'INSERT INTO public.refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
      [user.id, refreshToken, expiresAt.toISOString()],
    );

    return c.json({ accessToken, refreshToken });
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

    // Look up refresh token
    const result = await query<{ id: string; user_id: string; expires_at: string }>(
      `SELECT id, user_id, expires_at
       FROM public.refresh_tokens
       WHERE token = $1 LIMIT 1`,
      [refreshToken],
    );

    const tokenRow = result.rows[0];

    if (!tokenRow) {
      throw new HTTPException(401, { message: 'Invalid or expired refresh token' });
    }

    if (new Date(tokenRow.expires_at) < new Date()) {
      // Clean up the expired token
      await query('DELETE FROM public.refresh_tokens WHERE id = $1', [tokenRow.id]);
      throw new HTTPException(401, { message: 'Invalid or expired refresh token' });
    }

    // Look up user to get email for new access token
    const userResult = await query<{ id: string; email: string }>(
      'SELECT id, email FROM public.users WHERE id = $1 LIMIT 1',
      [tokenRow.user_id],
    );

    const user = userResult.rows[0];
    if (!user) {
      throw new HTTPException(401, { message: 'Invalid or expired refresh token' });
    }

    // Rotate: delete old token, issue new pair
    await query('DELETE FROM public.refresh_tokens WHERE id = $1', [tokenRow.id]);

    const newAccessToken = await signAccessToken(user.id, user.email);
    const newRefreshToken = generateRefreshToken();
    const expiresAt = new Date(Date.now() + JWT_CONSTANTS.REFRESH_TOKEN_TTL_MS);

    await query(
      'INSERT INTO public.refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
      [user.id, newRefreshToken, expiresAt.toISOString()],
    );

    return c.json({ accessToken: newAccessToken, refreshToken: newRefreshToken });
  },
);

// GET /auth/me  (protected)
authRouter.get('/me', requireAuth, async (c) => {
  const user = c.get('user');

  const result = await query<{
    id: string;
    email: string;
    display_name: string | null;
    created_at: string;
  }>(
    `SELECT p.id, p.email, p.display_name, p.created_at
     FROM public.profiles p
     WHERE p.id = $1`,
    [user.id],
  );

  if (result.rows.length === 0) {
    throw new HTTPException(404, { message: `Profile for user ${user.id} not found` });
  }

  return c.json(result.rows[0]);
});
