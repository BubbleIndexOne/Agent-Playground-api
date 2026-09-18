import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';

// ─── Mock: database query ─────────────────────────────────────────────────────
// We mock the `query` function directly so tests never touch a real DB.

const dbMocks = vi.hoisted(() => ({
  query: vi.fn(),
}));

vi.mock('../../src/services/database', () => ({
  query: dbMocks.query,
}));

// ─── Mock: JWT service ────────────────────────────────────────────────────────
// Keep JWT signing/verification deterministic in unit tests.

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

function jsonRequest(path: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

function createAuthApp() {
  const app = new Hono();
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
  const app = createAuthApp();

  beforeEach(() => {
    vi.clearAllMocks();

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
        ],
      });
      expect(dbMocks.query).not.toHaveBeenCalled();
    });

    it('creates the user and profile, returns 201 with success message', async () => {
      const response = await app.request(jsonRequest('/auth/signup', {
        email: 'agent@example.com',
        password: 'secret1',
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
    });

    it('returns 409 when the email is already registered', async () => {
      dbMocks.query.mockReset();
      dbMocks.query.mockResolvedValueOnce({ rows: [{ id: 'existing-user' }] });

      const response = await app.request(jsonRequest('/auth/signup', {
        email: 'agent@example.com',
        password: 'secret1',
      }));

      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({
        statusCode: 409,
        message: 'An account with this email already exists',
      });
      // Only one query (the existence check) — no insert
      expect(dbMocks.query).toHaveBeenCalledTimes(1);
    });

    it('returns 500 when the insert returns no rows', async () => {
      dbMocks.query.mockReset();
      dbMocks.query
        .mockResolvedValueOnce({ rows: [] })   // no existing user
        .mockResolvedValueOnce({ rows: [] });  // insert returns nothing

      const response = await app.request(jsonRequest('/auth/signup', {
        email: 'agent@example.com',
        password: 'secret1',
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
        .mockResolvedValueOnce({ rows: [loginUser] })   // SELECT user
        .mockResolvedValueOnce({ rows: [] });            // INSERT refresh token
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
        .mockResolvedValueOnce({ rows: [tokenRow] })  // SELECT refresh token
        .mockResolvedValueOnce({ rows: [userRow] })   // SELECT user
        .mockResolvedValueOnce({ rows: [] })           // DELETE old token
        .mockResolvedValueOnce({ rows: [] });          // INSERT new token
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
        .mockResolvedValueOnce({ rows: [] }); // DELETE

      const response = await app.request(jsonRequest('/auth/refresh', {
        refreshToken: 'expired-token',
      }));

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({
        statusCode: 401,
        message: 'Invalid or expired refresh token',
      });
      // Expired token should be cleaned up
      expect(dbMocks.query).toHaveBeenCalledTimes(2);
    });
  });

  // ── GET /auth/me ───────────────────────────────────────────────────────────

  describe('GET /auth/me', () => {
    const profileData = {
      id: 'user-1',
      email: 'agent@example.com',
      display_name: null,
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

    it('returns the authenticated user profile', async () => {
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
});
