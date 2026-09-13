import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';

const supabaseMocks = vi.hoisted(() => ({
  signUp: vi.fn(),
  deleteUser: vi.fn(),
  signInWithPassword: vi.fn(),
  refreshSession: vi.fn(),
  getUser: vi.fn(),
  from: vi.fn(),
  insert: vi.fn(),
  select: vi.fn(),
  eq: vi.fn(),
  maybeSingle: vi.fn(),
  getSupabaseClient: vi.fn(),
}));

vi.mock('../../src/services/supabase', () => ({
  getSupabaseClient: supabaseMocks.getSupabaseClient,
}));

import { authRouter } from '../../src/routes/auth';

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

describe('authentication routes', () => {
  const app = createAuthApp();
  const tableQuery = {
    insert: supabaseMocks.insert,
    select: supabaseMocks.select,
    eq: supabaseMocks.eq,
    maybeSingle: supabaseMocks.maybeSingle,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    supabaseMocks.getSupabaseClient.mockReturnValue({
      auth: {
        admin: {
          deleteUser: supabaseMocks.deleteUser,
        },
        signUp: supabaseMocks.signUp,
        signInWithPassword: supabaseMocks.signInWithPassword,
        refreshSession: supabaseMocks.refreshSession,
        getUser: supabaseMocks.getUser,
      },
      from: supabaseMocks.from,
    });
    supabaseMocks.from.mockReturnValue(tableQuery);
    supabaseMocks.select.mockReturnValue(tableQuery);
    supabaseMocks.eq.mockReturnValue(tableQuery);
    supabaseMocks.insert.mockResolvedValue({ error: null });
    supabaseMocks.signUp.mockResolvedValue({
      data: { user: { id: 'user-1', email: 'agent@example.com' } },
      error: null,
    });
    supabaseMocks.deleteUser.mockResolvedValue({ error: null });
    supabaseMocks.signInWithPassword.mockResolvedValue({
      data: { session: { access_token: 'access-token', refresh_token: 'refresh-token' } },
      error: null,
    });
    supabaseMocks.refreshSession.mockResolvedValue({
      data: { session: { access_token: 'new-access', refresh_token: 'new-refresh' } },
      error: null,
    });
    supabaseMocks.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
    supabaseMocks.maybeSingle.mockResolvedValue({
      data: { id: 'user-1', email: 'agent@example.com' },
      error: null,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('POST /auth/signup', () => {
    it('validates the request before calling Supabase', async () => {
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
      expect(supabaseMocks.signUp).not.toHaveBeenCalled();
    });

    it('creates the user and profile, then requires email verification', async () => {
      const response = await app.request(jsonRequest('/auth/signup', {
        email: 'agent@example.com',
        password: 'secret1',
      }));

      expect(response.status).toBe(201);
      expect(await response.json()).toEqual({
        message: 'Check your email to verify your account before signing in',
      });
      expect(supabaseMocks.signUp).toHaveBeenCalledWith({
        email: 'agent@example.com',
        password: 'secret1',
      });
      expect(supabaseMocks.from).toHaveBeenCalledWith('profiles');
      expect(supabaseMocks.insert).toHaveBeenCalledWith({
        id: 'user-1',
        email: 'agent@example.com',
      });
      expect(supabaseMocks.signInWithPassword).not.toHaveBeenCalled();
    });

    it('deletes the new auth user when profile insertion fails', async () => {
      const profileError = { message: 'profiles table missing' };
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      supabaseMocks.insert.mockResolvedValue({ error: profileError });

      const response = await app.request(jsonRequest('/auth/signup', {
        email: 'agent@example.com',
        password: 'secret1',
      }));

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ statusCode: 500, message: 'Profile creation failed' });
      expect(supabaseMocks.deleteUser).toHaveBeenCalledWith('user-1');
      expect(consoleError).toHaveBeenCalledWith('[Auth] Profile creation failed', profileError);
    });

    it('still reports profile failure when compensating user deletion fails', async () => {
      const profileError = { message: 'profile unavailable' };
      const cleanupError = { message: 'cleanup unavailable' };
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      supabaseMocks.insert.mockResolvedValue({ error: profileError });
      supabaseMocks.deleteUser.mockResolvedValue({ error: cleanupError });

      const response = await app.request(jsonRequest('/auth/signup', {
        email: 'agent@example.com',
        password: 'secret1',
      }));

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ statusCode: 500, message: 'Profile creation failed' });
      expect(consoleError).toHaveBeenCalledWith(
        '[Auth] Failed to remove user after profile creation failure',
        cleanupError,
      );
    });

    it('returns the user creation error', async () => {
      supabaseMocks.signUp.mockResolvedValue({
        data: { user: null },
        error: { message: 'Email already registered' },
      });

      const response = await app.request(jsonRequest('/auth/signup', {
        email: 'agent@example.com',
        password: 'secret1',
      }));

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ statusCode: 400, message: 'Email already registered' });
      expect(supabaseMocks.insert).not.toHaveBeenCalled();
    });

    it('handles a successful provider response without a user', async () => {
      supabaseMocks.signUp.mockResolvedValue({ data: { user: null }, error: null });

      const response = await app.request(jsonRequest('/auth/signup', {
        email: 'agent@example.com',
        password: 'secret1',
      }));

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        statusCode: 400,
        message: 'User creation failed unexpectedly',
      });
    });

  });

  describe('POST /auth/login', () => {
    it('rejects an empty password without calling Supabase', async () => {
      const response = await app.request(jsonRequest('/auth/login', {
        email: 'agent@example.com',
        password: '',
      }));

      expect(response.status).toBe(400);
      expect(supabaseMocks.signInWithPassword).not.toHaveBeenCalled();
    });

    it('returns access and refresh tokens for valid credentials', async () => {
      const response = await app.request(jsonRequest('/auth/login', {
        email: 'agent@example.com',
        password: 'secret',
      }));

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
      });
    });

    it('returns provider authentication errors', async () => {
      supabaseMocks.signInWithPassword.mockResolvedValue({
        data: { session: null },
        error: { message: 'Invalid credentials' },
      });

      const response = await app.request(jsonRequest('/auth/login', {
        email: 'agent@example.com',
        password: 'wrong',
      }));

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ statusCode: 401, message: 'Invalid credentials' });
    });

    it('uses a stable fallback when the provider omits a session', async () => {
      supabaseMocks.signInWithPassword.mockResolvedValue({ data: { session: null }, error: null });

      const response = await app.request(jsonRequest('/auth/login', {
        email: 'agent@example.com',
        password: 'secret',
      }));

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ statusCode: 401, message: 'Invalid login credentials' });
    });
  });

  describe('POST /auth/refresh', () => {
    it('rejects an empty refresh token without calling Supabase', async () => {
      const response = await app.request(jsonRequest('/auth/refresh', { refreshToken: '' }));

      expect(response.status).toBe(400);
      expect(supabaseMocks.refreshSession).not.toHaveBeenCalled();
    });

    it('refreshes the session', async () => {
      const response = await app.request(jsonRequest('/auth/refresh', {
        refreshToken: 'old-refresh',
      }));

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        accessToken: 'new-access',
        refreshToken: 'new-refresh',
      });
      expect(supabaseMocks.refreshSession).toHaveBeenCalledWith({ refresh_token: 'old-refresh' });
    });

    it('returns refresh errors from the provider', async () => {
      supabaseMocks.refreshSession.mockResolvedValue({
        data: { session: null },
        error: { message: 'Refresh token expired' },
      });

      const response = await app.request(jsonRequest('/auth/refresh', {
        refreshToken: 'expired',
      }));

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ statusCode: 401, message: 'Refresh token expired' });
    });

    it('uses a stable fallback when refresh returns no session', async () => {
      supabaseMocks.refreshSession.mockResolvedValue({ data: { session: null }, error: null });

      const response = await app.request(jsonRequest('/auth/refresh', {
        refreshToken: 'unknown',
      }));

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({
        statusCode: 401,
        message: 'Invalid or expired refresh token',
      });
    });
  });

  describe('GET /auth/me', () => {
    function profileRequest() {
      return new Request('http://localhost/auth/me', {
        headers: { Authorization: 'Bearer valid-token' },
      });
    }

    it('looks up and returns the authenticated user profile', async () => {
      const response = await app.request(profileRequest());

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ id: 'user-1', email: 'agent@example.com' });
      expect(supabaseMocks.getUser).toHaveBeenCalledWith('valid-token');
      expect(supabaseMocks.from).toHaveBeenCalledWith('profiles');
      expect(supabaseMocks.select).toHaveBeenCalledWith('*');
      expect(supabaseMocks.eq).toHaveBeenCalledWith('id', 'user-1');
      expect(supabaseMocks.maybeSingle).toHaveBeenCalledOnce();
    });

    it('returns profile query errors', async () => {
      supabaseMocks.maybeSingle.mockResolvedValue({ data: null, error: { message: 'DB unavailable' } });

      const response = await app.request(profileRequest());

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ statusCode: 400, message: 'DB unavailable' });
    });

    it('returns 404 when the authenticated user has no profile', async () => {
      supabaseMocks.maybeSingle.mockResolvedValue({ data: null, error: null });

      const response = await app.request(profileRequest());

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({
        statusCode: 404,
        message: 'Profile for user user-1 not found',
      });
    });
  });
});
