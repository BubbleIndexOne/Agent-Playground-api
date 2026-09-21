import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import bcrypt from 'bcryptjs';
import { query } from '../services/database';
import { signAccessToken, generateRefreshToken } from '../services/jwt';
import { requireAuth } from '../middleware/auth';
import {
  SignUpSchema,
  LoginSchema,
  RefreshTokenSchema,
  UpdateProfileSchema,
  DeleteAccountSchema,
} from '../schemas/auth';
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
    const { email, password, first_name, middle_name, last_name, display_name } = c.req.valid('json');

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

    // Default display_name to first_name if not provided
    const finalDisplayName = display_name || first_name;

    // Insert user and auto-create profile in one transaction
    const insertResult = await query<{ id: string; email: string }>(
      `WITH inserted_user AS (
         INSERT INTO public.users (email, password_hash)
         VALUES ($1, $2)
         RETURNING id, email
       )
       INSERT INTO public.profiles (id, email, first_name, middle_name, last_name, display_name)
       SELECT id, email, $3, $4, $5, $6 FROM inserted_user
       RETURNING (SELECT id FROM inserted_user), (SELECT email FROM inserted_user)`,
      [
        email,
        passwordHash,
        first_name,
        middle_name ?? null,
        last_name ?? null,
        finalDisplayName,
      ],
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
    first_name: string;
    middle_name: string | null;
    last_name: string | null;
    display_name: string | null;
    created_at: string;
  }>(
    `SELECT p.id, p.email, p.first_name, p.middle_name, p.last_name, p.display_name, p.created_at
     FROM public.profiles p
     WHERE p.id = $1`,
    [user.id],
  );

  if (result.rows.length === 0) {
    throw new HTTPException(404, { message: `Profile for user ${user.id} not found` });
  }

  return c.json(result.rows[0]);
});

// PATCH /auth/me  (protected: update profile and/or password)
authRouter.patch(
  '/me',
  requireAuth,
  zValidator('json', UpdateProfileSchema, (result, c) => {
    if (!result.success) {
      return c.json({ statusCode: 400, message: result.error.errors.map(e => e.message) }, 400);
    }
  }),
  async (c) => {
    const user = c.get('user');
    const data = c.req.valid('json');

    // 1. If password update requested:
    if (data.new_password) {
      const userRecord = await query<{ password_hash: string }>(
        'SELECT password_hash FROM public.users WHERE id = $1 LIMIT 1',
        [user.id],
      );
      if (userRecord.rows.length === 0) {
        throw new HTTPException(404, { message: `User ${user.id} not found` });
      }

      const match = await bcrypt.compare(data.current_password!, userRecord.rows[0].password_hash);
      if (!match) {
        throw new HTTPException(401, { message: 'Current password does not match' });
      }

      const newHash = await bcrypt.hash(data.new_password, AUTH_CONSTANTS.BCRYPT_SALT_ROUNDS);
      await query('UPDATE public.users SET password_hash = $1 WHERE id = $2', [newHash, user.id]);
    }

    // 2. If profile fields updated:
    const fieldsToUpdate: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (data.first_name !== undefined) {
      fieldsToUpdate.push(`first_name = $${paramIndex++}`);
      values.push(data.first_name);
    }
    if (data.middle_name !== undefined) {
      fieldsToUpdate.push(`middle_name = $${paramIndex++}`);
      values.push(data.middle_name);
    }
    if (data.last_name !== undefined) {
      fieldsToUpdate.push(`last_name = $${paramIndex++}`);
      values.push(data.last_name);
    }
    if (data.display_name !== undefined) {
      fieldsToUpdate.push(`display_name = $${paramIndex++}`);
      values.push(data.display_name);
    }

    let updatedProfileRow;
    if (fieldsToUpdate.length > 0) {
      values.push(user.id);
      const updateResult = await query<{
        id: string;
        email: string;
        first_name: string;
        middle_name: string | null;
        last_name: string | null;
        display_name: string | null;
        created_at: string;
      }>(
        `UPDATE public.profiles SET ${fieldsToUpdate.join(', ')} WHERE id = $${paramIndex}
         RETURNING id, email, first_name, middle_name, last_name, display_name, created_at`,
        values,
      );
      updatedProfileRow = updateResult.rows[0];
    }

    if (!updatedProfileRow) {
      const result = await query<{
        id: string;
        email: string;
        first_name: string;
        middle_name: string | null;
        last_name: string | null;
        display_name: string | null;
        created_at: string;
      }>(
        `/* bypass_cache:${Date.now()} */
         SELECT p.id, p.email, p.first_name, p.middle_name, p.last_name, p.display_name, p.created_at
         FROM public.profiles p
         WHERE p.id = $1`,
        [user.id],
      );

      if (result.rows.length === 0) {
        throw new HTTPException(404, { message: `Profile for user ${user.id} not found` });
      }
      updatedProfileRow = result.rows[0];
    }

    return c.json(updatedProfileRow);
  },
);

// DELETE /auth/me  (protected: user self-deletion with password confirmation)
authRouter.delete(
  '/me',
  requireAuth,
  zValidator('json', DeleteAccountSchema, (result, c) => {
    if (!result.success) {
      return c.json({ statusCode: 400, message: result.error.errors.map(e => e.message) }, 400);
    }
  }),
  async (c) => {
    const user = c.get('user');
    const { password } = c.req.valid('json');

    const userRecord = await query<{ password_hash: string }>(
      'SELECT password_hash FROM public.users WHERE id = $1 LIMIT 1',
      [user.id],
    );

    if (userRecord.rows.length === 0) {
      throw new HTTPException(404, { message: `User ${user.id} not found` });
    }

    const match = await bcrypt.compare(password, userRecord.rows[0].password_hash);
    if (!match) {
      throw new HTTPException(401, { message: 'Invalid password' });
    }

    // Cascade deletes profiles, refresh_tokens, agents, etc.
    await query('DELETE FROM public.users WHERE id = $1', [user.id]);

    return c.json({ message: 'Account deleted successfully' });
  },
);

// DELETE /auth/users/:id  (admin deletion guarded by x-admin-key header)
authRouter.delete('/users/:id', async (c) => {
  const adminKey = c.req.header('x-admin-key');
  const expectedAdminKey =
    (c.env as { ADMIN_SECRET_KEY?: string } | undefined)?.ADMIN_SECRET_KEY ||
    process.env.ADMIN_SECRET_KEY;

  if (!expectedAdminKey || !adminKey || adminKey !== expectedAdminKey) {
    throw new HTTPException(403, { message: 'Forbidden: invalid or missing admin key' });
  }

  const targetId = c.req.param('id');
  const deleteResult = await query<{ id: string }>(
    'DELETE FROM public.users WHERE id = $1 RETURNING id',
    [targetId],
  );

  if (deleteResult.rows.length === 0) {
    throw new HTTPException(404, { message: `User ${targetId} not found` });
  }

  return c.json({ message: 'User account deleted successfully' });
});
