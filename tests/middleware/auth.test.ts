import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';

// ─── Mock: jwt service ────────────────────────────────────────────────────────

const jwtMocks = vi.hoisted(() => ({
  verifyAccessToken: vi.fn(),
}));

vi.mock('../../src/services/jwt', () => ({
  verifyAccessToken: jwtMocks.verifyAccessToken,
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
    // Default: valid token resolves to a user payload
    jwtMocks.verifyAccessToken.mockResolvedValue({ sub: 'user-1', email: 'agent@example.com' });
  });

  it('rejects requests without an Authorization header', async () => {
    const response = await app.request('/protected');

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      statusCode: 401,
      message: 'Authorization header is missing',
    });
    expect(jwtMocks.verifyAccessToken).not.toHaveBeenCalled();
  });

  it.each(['Basic token', 'bearer token', 'Bearer', 'Bearer  token'])(
    'rejects malformed authorization header %j',
    async (authorization) => {
      const response = await app.request('/protected', { headers: { Authorization: authorization } });

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({
        statusCode: 401,
        message: 'Invalid authorization header format. Expected Bearer <token>',
      });
      expect(jwtMocks.verifyAccessToken).not.toHaveBeenCalled();
    },
  );

  it('returns 401 when token verification throws (e.g. expired or invalid signature)', async () => {
    jwtMocks.verifyAccessToken.mockRejectedValue(new Error('JWTExpired: jwt expired'));

    const response = await app.request('/protected', { headers: { Authorization: 'Bearer expired' } });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      statusCode: 401,
      message: 'Invalid or expired access token',
    });
  });

  it('stores the verified user in context and continues to the handler', async () => {
    const response = await app.request('/protected', { headers: { Authorization: 'Bearer valid-token' } });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: 'user-1', email: 'agent@example.com' });
    expect(jwtMocks.verifyAccessToken).toHaveBeenCalledWith('valid-token');
  });
});
