import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';

// ─── Mock: database query ─────────────────────────────────────────────────────

const dbMocks = vi.hoisted(() => ({
  query: vi.fn(),
}));

vi.mock('../../src/services/database', () => ({
  query: dbMocks.query,
}));

// ─── Mock: JWT service ────────────────────────────────────────────────────────

const jwtMocks = vi.hoisted(() => ({
  signAccessToken: vi.fn(),
  verifyAccessToken: vi.fn(),
  generateRefreshToken: vi.fn(),
}));

vi.mock('../../src/services/jwt', () => ({
  signAccessToken: jwtMocks.signAccessToken,
  verifyAccessToken: jwtMocks.verifyAccessToken,
  generateRefreshToken: jwtMocks.generateRefreshToken,
}));

// ─── Mock: bcryptjs ───────────────────────────────────────────────────────────

const bcryptMocks = vi.hoisted(() => ({
  hash: vi.fn(),
  compare: vi.fn(),
}));

vi.mock('bcryptjs', () => ({
  default: {
    hash: bcryptMocks.hash,
    compare: bcryptMocks.compare,
  },
}));

import { authRouter } from '../../src/routes/auth';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function jsonRequest(
  path: string,
  body: unknown,
  method = 'POST',
  headers: Record<string, string> = {},
) {
  return new Request(`http://localhost${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

function createAuthApp(env: Record<string, unknown> = {}) {
  const app = new Hono<{ Bindings: Record<string, unknown> }>();
  app.use('*', async (c, next) => {
    c.env = Object.assign({}, c.env, env);
    await next();
  });
  app.route('/auth', authRouter);
  app.onError((error, c) => {
    if (error instanceof HTTPException) {
      return c.json({ statusCode: error.status, message: error.message }, error.status);
    }
    throw error;
  });
  return app;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('authentication routes', () => {
  const defaultEnv = { ADMIN_SECRET_KEY: 'test-admin-key' };
  const app = createAuthApp(defaultEnv);

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ADMIN_SECRET_KEY = 'test-admin-key';

    // Default happy-path stubs
    bcryptMocks.hash.mockResolvedValue('hashed_password');
    bcryptMocks.compare.mockResolvedValue(true);
    jwtMocks.signAccessToken.mockResolvedValue('mock-access-token');
    jwtMocks.generateRefreshToken.mockReturnValue('mock-refresh-token');
    jwtMocks.verifyAccessToken.mockResolvedValue({ sub: 'user-1', email: 'agent@example.com' });

    // Default: no existing user (for signup), then successful insert
    dbMocks.query
      .mockResolvedValueOnce({ rows: [] })       // SELECT — user does not exist
      .mockResolvedValueOnce({ rows: [{ id: 'user-1' }] }); // INSERT user+profile
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── POST /auth/signup ──────────────────────────────────────────────────────

  describe('POST /auth/signup', () => {
    it('rejects invalid email and short password without touching the DB', async () => {
      const response = await app.request(jsonRequest('/auth/signup', {
        email: 'invalid',
        password: 'short',
      }));

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        statusCode: 400,
        message: [
          'email must be a valid email address',
          'password must be at least 6 characters long',
          'first_name is required',
        ],
      });
      expect(dbMocks.query).not.toHaveBeenCalled();
    });

    it('creates the user and profile, defaulting display_name to first_name', async () => {
      const response = await app.request(jsonRequest('/auth/signup', {
        email: 'agent@example.com',
        password: 'secret1',
        first_name: 'John',
      }));

      expect(response.status).toBe(201);
      expect(await response.json()).toEqual({ message: 'Account created successfully' });

      // First query checks for existing user
      expect(dbMocks.query).toHaveBeenNthCalledWith(
        1,
        'SELECT id FROM public.users WHERE email = $1 LIMIT 1',
        ['agent@example.com'],
      );

      // Password was hashed before insert
      expect(bcryptMocks.hash).toHaveBeenCalledWith('secret1', 12);

      // Second query inserts user + profile with display_name = 'John'
      expect(dbMocks.query).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('INSERT INTO public.profiles'),
        ['agent@example.com', 'hashed_password', 'John', null, null, 'John'],
      );
    });

    it('creates the user with custom middle_name, last_name, and display_name', async () => {
      const response = await app.request(jsonRequest('/auth/signup', {
        email: 'agent@example.com',
        password: 'secret1',
        first_name: 'John',
        middle_name: 'William',
        last_name: 'Doe',
        display_name: 'Johnny',
      }));

      expect(response.status).toBe(201);
      expect(dbMocks.query).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('INSERT INTO public.profiles'),
        ['agent@example.com', 'hashed_password', 'John', 'William', 'Doe', 'Johnny'],
      );
    });

    it('returns 409 when the email is already registered', async () => {
      dbMocks.query.mockReset();
      dbMocks.query.mockResolvedValueOnce({ rows: [{ id: 'existing-user' }] });

      const response = await app.request(jsonRequest('/auth/signup', {
        email: 'agent@example.com',
        password: 'secret1',
        first_name: 'John',
      }));

      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({
        statusCode: 409,
        message: 'An account with this email already exists',
      });
      expect(dbMocks.query).toHaveBeenCalledTimes(1);
    });

    it('returns 500 when the insert returns no rows', async () => {
      dbMocks.query.mockReset();
      dbMocks.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      const response = await app.request(jsonRequest('/auth/signup', {
        email: 'agent@example.com',
        password: 'secret1',
        first_name: 'John',
      }));

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({
        statusCode: 500,
        message: 'Account creation failed unexpectedly',
      });
    });
  });

  // ── POST /auth/login ───────────────────────────────────────────────────────

  describe('POST /auth/login', () => {
    const loginUser = { id: 'user-1', email: 'agent@example.com', password_hash: 'hashed_password' };

    beforeEach(() => {
      dbMocks.query.mockReset();
      dbMocks.query
        .mockResolvedValueOnce({ rows: [loginUser] })
        .mockResolvedValueOnce({ rows: [] });
    });

    it('rejects an empty password without touching the DB', async () => {
      dbMocks.query.mockReset();

      const response = await app.request(jsonRequest('/auth/login', {
        email: 'agent@example.com',
        password: '',
      }));

      expect(response.status).toBe(400);
      expect(dbMocks.query).not.toHaveBeenCalled();
    });

    it('returns access and refresh tokens for valid credentials', async () => {
      const response = await app.request(jsonRequest('/auth/login', {
        email: 'agent@example.com',
        password: 'secret',
      }));

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        accessToken: 'mock-access-token',
        refreshToken: 'mock-refresh-token',
      });
      expect(bcryptMocks.compare).toHaveBeenCalledWith('secret', 'hashed_password');
      expect(jwtMocks.signAccessToken).toHaveBeenCalledWith('user-1', 'agent@example.com');
    });

    it('returns 401 when the user does not exist', async () => {
      dbMocks.query.mockReset();
      dbMocks.query.mockResolvedValueOnce({ rows: [] });

      const response = await app.request(jsonRequest('/auth/login', {
        email: 'nobody@example.com',
        password: 'secret',
      }));

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({
        statusCode: 401,
        message: 'Invalid email or password',
      });
    });

    it('returns 401 when the password is wrong', async () => {
      bcryptMocks.compare.mockResolvedValue(false);

      const response = await app.request(jsonRequest('/auth/login', {
        email: 'agent@example.com',
        password: 'wrong',
      }));

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({
        statusCode: 401,
        message: 'Invalid email or password',
      });
    });
  });

  // ── POST /auth/refresh ─────────────────────────────────────────────────────

  describe('POST /auth/refresh', () => {
    const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const tokenRow = { id: 'rt-1', user_id: 'user-1', expires_at: futureDate };
    const userRow = { id: 'user-1', email: 'agent@example.com' };

    beforeEach(() => {
      dbMocks.query.mockReset();
      dbMocks.query
        .mockResolvedValueOnce({ rows: [tokenRow] })
        .mockResolvedValueOnce({ rows: [userRow] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });
    });

    it('rejects an empty refresh token without touching the DB', async () => {
      dbMocks.query.mockReset();

      const response = await app.request(jsonRequest('/auth/refresh', { refreshToken: '' }));

      expect(response.status).toBe(400);
      expect(dbMocks.query).not.toHaveBeenCalled();
    });

    it('returns a new access + refresh token pair', async () => {
      jwtMocks.signAccessToken.mockResolvedValue('new-access-token');
      jwtMocks.generateRefreshToken.mockReturnValue('new-refresh-token');

      const response = await app.request(jsonRequest('/auth/refresh', {
        refreshToken: 'mock-refresh-token',
      }));

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
      });
    });

    it('returns 401 when the refresh token does not exist in DB', async () => {
      dbMocks.query.mockReset();
      dbMocks.query.mockResolvedValueOnce({ rows: [] });

      const response = await app.request(jsonRequest('/auth/refresh', {
        refreshToken: 'unknown-token',
      }));

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({
        statusCode: 401,
        message: 'Invalid or expired refresh token',
      });
    });

    it('returns 401 and cleans up when the token is expired', async () => {
      const pastDate = new Date(Date.now() - 1000).toISOString();
      dbMocks.query.mockReset();
      dbMocks.query
        .mockResolvedValueOnce({ rows: [{ ...tokenRow, expires_at: pastDate }] })
        .mockResolvedValueOnce({ rows: [] });

      const response = await app.request(jsonRequest('/auth/refresh', {
        refreshToken: 'expired-token',
      }));

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({
        statusCode: 401,
        message: 'Invalid or expired refresh token',
      });
      expect(dbMocks.query).toHaveBeenCalledTimes(2);
    });
  });

  // ── GET /auth/me ───────────────────────────────────────────────────────────

  describe('GET /auth/me', () => {
    const profileData = {
      id: 'user-1',
      email: 'agent@example.com',
      first_name: 'John',
      middle_name: null,
      last_name: null,
      display_name: 'John',
      created_at: '2026-09-14T12:00:00.000Z',
    };

    function profileRequest() {
      return new Request('http://localhost/auth/me', {
        headers: { Authorization: 'Bearer valid-token' },
      });
    }

    beforeEach(() => {
      dbMocks.query.mockReset();
      dbMocks.query.mockResolvedValueOnce({ rows: [profileData] });
    });

    it('returns the authenticated user profile with name fields', async () => {
      const response = await app.request(profileRequest());

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(profileData);
      expect(jwtMocks.verifyAccessToken).toHaveBeenCalledWith('valid-token');
    });

    it('returns 401 when Authorization header is missing', async () => {
      const response = await app.request(new Request('http://localhost/auth/me'));

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({
        statusCode: 401,
        message: 'Authorization header is missing',
      });
    });

    it('returns 401 when the JWT is invalid', async () => {
      jwtMocks.verifyAccessToken.mockRejectedValue(new Error('jwt expired'));

      const response = await app.request(profileRequest());

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({
        statusCode: 401,
        message: 'Invalid or expired access token',
      });
    });

    it('returns 404 when no profile exists for the authenticated user', async () => {
      dbMocks.query.mockReset();
      dbMocks.query.mockResolvedValueOnce({ rows: [] });

      const response = await app.request(profileRequest());

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({
        statusCode: 404,
        message: 'Profile for user user-1 not found',
      });
    });
  });

  // ── PATCH /auth/me ──────────────────────────────────────────────────────────

  describe('PATCH /auth/me', () => {
    const updatedProfile = {
      id: 'user-1',
      email: 'agent@example.com',
      first_name: 'Jane',
      middle_name: null,
      last_name: 'Smith',
      display_name: 'Jane Smith',
      created_at: '2026-09-14T12:00:00.000Z',
    };

    it('updates profile name fields and returns updated profile', async () => {
      dbMocks.query.mockReset();
      dbMocks.query
        .mockResolvedValueOnce({ rows: [] })                // UPDATE public.profiles
        .mockResolvedValueOnce({ rows: [updatedProfile] }); // SELECT updated profile

      const response = await app.request(
        jsonRequest('/auth/me', { first_name: 'Jane', last_name: 'Smith' }, 'PATCH', {
          Authorization: 'Bearer valid-token',
        }),
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(updatedProfile);
      expect(dbMocks.query).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining('UPDATE public.profiles SET first_name = $1, last_name = $2 WHERE id = $3'),
        ['Jane', 'Smith', 'user-1'],
      );
    });

    it('updates password when valid current_password is provided', async () => {
      dbMocks.query.mockReset();
      dbMocks.query
        .mockResolvedValueOnce({ rows: [{ password_hash: 'old_hashed' }] }) // SELECT user password_hash
        .mockResolvedValueOnce({ rows: [] })                                // UPDATE public.users password_hash
        .mockResolvedValueOnce({ rows: [updatedProfile] });                 // SELECT profile

      const response = await app.request(
        jsonRequest('/auth/me', { current_password: 'OldPassword123', new_password: 'NewPassword123' }, 'PATCH', {
          Authorization: 'Bearer valid-token',
        }),
      );

      expect(response.status).toBe(200);
      expect(bcryptMocks.compare).toHaveBeenCalledWith('OldPassword123', 'old_hashed');
      expect(bcryptMocks.hash).toHaveBeenCalledWith('NewPassword123', 12);
    });

    it('returns 401 when current_password does not match', async () => {
      dbMocks.query.mockReset();
      dbMocks.query.mockResolvedValueOnce({ rows: [{ password_hash: 'old_hashed' }] });
      bcryptMocks.compare.mockResolvedValue(false);

      const response = await app.request(
        jsonRequest('/auth/me', { current_password: 'WrongPassword', new_password: 'NewPassword123' }, 'PATCH', {
          Authorization: 'Bearer valid-token',
        }),
      );

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({
        statusCode: 401,
        message: 'Current password does not match',
      });
    });
  });

  // ── DELETE /auth/me (Self-deletion) ─────────────────────────────────────────

  describe('DELETE /auth/me', () => {
    it('deletes user account when password is confirmed', async () => {
      dbMocks.query.mockReset();
      dbMocks.query
        .mockResolvedValueOnce({ rows: [{ password_hash: 'hashed_password' }] }) // SELECT password_hash
        .mockResolvedValueOnce({ rows: [] });                                    // DELETE from public.users

      const response = await app.request(
        jsonRequest('/auth/me', { password: 'CorrectPassword123' }, 'DELETE', {
          Authorization: 'Bearer valid-token',
        }),
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ message: 'Account deleted successfully' });
      expect(bcryptMocks.compare).toHaveBeenCalledWith('CorrectPassword123', 'hashed_password');
      expect(dbMocks.query).toHaveBeenNthCalledWith(
        2,
        'DELETE FROM public.users WHERE id = $1',
        ['user-1'],
      );
    });

    it('returns 401 when password confirmation fails', async () => {
      dbMocks.query.mockReset();
      dbMocks.query.mockResolvedValueOnce({ rows: [{ password_hash: 'hashed_password' }] });
      bcryptMocks.compare.mockResolvedValue(false);

      const response = await app.request(
        jsonRequest('/auth/me', { password: 'WrongPassword' }, 'DELETE', {
          Authorization: 'Bearer valid-token',
        }),
      );

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({
        statusCode: 401,
        message: 'Invalid password',
      });
      expect(dbMocks.query).toHaveBeenCalledTimes(1);
    });
  });

  // ── DELETE /auth/users/:id (Admin deletion) ─────────────────────────────────

  describe('DELETE /auth/users/:id', () => {
    it('deletes user account when valid x-admin-key header is supplied', async () => {
      dbMocks.query.mockReset();
      dbMocks.query.mockResolvedValueOnce({ rows: [{ id: 'target-user-id' }] });

      const response = await app.request(new Request('http://localhost/auth/users/target-user-id', {
        method: 'DELETE',
        headers: { 'x-admin-key': 'test-admin-key' },
      }));

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ message: 'User account deleted successfully' });
      expect(dbMocks.query).toHaveBeenCalledWith(
        'DELETE FROM public.users WHERE id = $1 RETURNING id',
        ['target-user-id'],
      );
    });

    it('returns 403 when x-admin-key header is missing or incorrect', async () => {
      const response = await app.request(new Request('http://localhost/auth/users/target-user-id', {
        method: 'DELETE',
        headers: { 'x-admin-key': 'wrong-admin-key' },
      }));

      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({
        statusCode: 403,
        message: 'Forbidden: invalid or missing admin key',
      });
    });

    it('returns 404 when target user is not found', async () => {
      dbMocks.query.mockReset();
      dbMocks.query.mockResolvedValueOnce({ rows: [] });

      const response = await app.request(new Request('http://localhost/auth/users/unknown-user-id', {
        method: 'DELETE',
        headers: { 'x-admin-key': 'test-admin-key' },
      }));

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({
        statusCode: 404,
        message: 'User unknown-user-id not found',
      });
    });
  });
});
