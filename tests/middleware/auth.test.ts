import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';

const supabaseMocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  getSupabaseClient: vi.fn(),
}));

vi.mock('../../src/services/supabase', () => ({
  getSupabaseClient: supabaseMocks.getSupabaseClient,
}));

import { requireAuth } from '../../src/middleware/auth';

function createProtectedApp() {
  const app = new Hono();
  app.get('/protected', requireAuth, (c) => c.json(c.get('user')));
  app.onError((error, c) => {
    if (error instanceof HTTPException) {
      return c.json({ statusCode: error.status, message: error.message }, error.status);
    }
    throw error;
  });
  return app;
}

describe('requireAuth middleware', () => {
  const app = createProtectedApp();

  beforeEach(() => {
    vi.clearAllMocks();
    supabaseMocks.getSupabaseClient.mockReturnValue({ auth: { getUser: supabaseMocks.getUser } });
  });

  it('rejects requests without an Authorization header', async () => {
    const response = await app.request('/protected');

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      statusCode: 401,
      message: 'Authorization header is missing',
    });
    expect(supabaseMocks.getUser).not.toHaveBeenCalled();
  });

  it.each(['Basic token', 'bearer token', 'Bearer', 'Bearer  token']) (
    'rejects malformed authorization header %j',
    async (authorization) => {
      const response = await app.request('/protected', { headers: { Authorization: authorization } });

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({
        statusCode: 401,
        message: 'Invalid authorization header format. Expected Bearer <token>',
      });
      expect(supabaseMocks.getUser).not.toHaveBeenCalled();
    },
  );

  it('returns the provider error when token verification fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    supabaseMocks.getUser.mockResolvedValue({ data: { user: null }, error: { message: 'JWT expired' } });

    const response = await app.request('/protected', { headers: { Authorization: 'Bearer expired' } });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ statusCode: 401, message: 'Profile retrieval failed' });
    expect(consoleError).toHaveBeenCalledWith(
      '[Auth] Supabase user lookup failed',
      { message: 'JWT expired' },
    );
    consoleError.mockRestore();
  });

  it('uses a stable fallback error when verification returns no user', async () => {
    supabaseMocks.getUser.mockResolvedValue({ data: { user: null }, error: null });

    const response = await app.request('/protected', { headers: { Authorization: 'Bearer unknown' } });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      statusCode: 401,
      message: 'Invalid or expired access token',
    });
  });

  it('stores the verified user in context and continues', async () => {
    const user = { id: 'user-1', email: 'agent@example.com', role: 'member' };
    supabaseMocks.getUser.mockResolvedValue({ data: { user }, error: null });

    const response = await app.request('/protected', { headers: { Authorization: 'Bearer valid-token' } });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(user);
    expect(supabaseMocks.getUser).toHaveBeenCalledWith('valid-token');
  });
});
