import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';

// Mock database query
const dbMocks = vi.hoisted(() => ({
  query: vi.fn(),
}));

vi.mock('../../src/services/database', () => ({
  query: dbMocks.query,
}));

// Mock JWT
const jwtMocks = vi.hoisted(() => ({
  verifyAccessToken: vi.fn(),
}));

vi.mock('../../src/services/jwt', () => ({
  verifyAccessToken: jwtMocks.verifyAccessToken,
}));

import { settingsRouter } from '../../src/routes/settings';

function createSettingsApp() {
  const app = new Hono();
  app.route('/users/me/settings', settingsRouter);
  app.onError((error, c) => {
    if (error instanceof HTTPException) {
      return c.json({ statusCode: error.status, message: error.message }, error.status);
    }
    return c.json({ statusCode: 500, message: (error as Error).message }, 500);
  });
  return app;
}

const mockUser = {
  id: 'user-uuid-111',
  sub: 'user-uuid-111',
  email: 'settings.user@example.com',
};

describe('User Settings Routes (/users/me/settings)', () => {
  let app: ReturnType<typeof createSettingsApp>;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createSettingsApp();
    jwtMocks.verifyAccessToken.mockResolvedValue(mockUser);
  });

  describe('GET /users/me/settings', () => {
    it('returns default system theme when no settings row exists', async () => {
      dbMocks.query.mockResolvedValueOnce({ rows: [] });

      const res = await app.request('/users/me/settings', {
        headers: { Authorization: 'Bearer valid.jwt.token' },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.settings.theme).toBe('system');
      expect(body.settings.extra).toEqual({});
    });

    it('returns persisted settings when row exists', async () => {
      dbMocks.query.mockResolvedValueOnce({
        rows: [
          {
            user_id: mockUser.id,
            theme: 'dark',
            extra_json: { auto_scroll_composer: true },
            updated_at: '2026-11-15T09:42:00.000Z',
          },
        ],
      });

      const res = await app.request('/users/me/settings', {
        headers: { Authorization: 'Bearer valid.jwt.token' },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.settings.theme).toBe('dark');
      expect(body.settings.extra.auto_scroll_composer).toBe(true);
    });

    it('returns 401 when token is missing', async () => {
      const res = await app.request('/users/me/settings');
      expect(res.status).toBe(401);
    });
  });

  describe('PUT /users/me/settings', () => {
    it('upserts user theme and extra preferences', async () => {
      dbMocks.query.mockResolvedValueOnce({
        rows: [
          {
            user_id: mockUser.id,
            theme: 'light',
            extra_json: { sidebar_open: false },
            updated_at: '2026-11-15T09:45:00.000Z',
          },
        ],
      });

      const res = await app.request('/users/me/settings', {
        method: 'PUT',
        headers: {
          Authorization: 'Bearer valid.jwt.token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          theme: 'light',
          extra: { sidebar_open: false },
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.settings.theme).toBe('light');
      expect(body.settings.extra.sidebar_open).toBe(false);
    });

    it('returns 400 for invalid theme choice', async () => {
      const res = await app.request('/users/me/settings', {
        method: 'PUT',
        headers: {
          Authorization: 'Bearer valid.jwt.token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          theme: 'neon-cyberpunk',
        }),
      });

      expect(res.status).toBe(400);
    });
  });

  describe('PATCH /users/me/settings', () => {
    it('supports partial updates via PATCH', async () => {
      dbMocks.query.mockResolvedValueOnce({
        rows: [
          {
            user_id: mockUser.id,
            theme: 'dark',
            extra_json: {},
            updated_at: '2026-11-15T09:46:00.000Z',
          },
        ],
      });

      const res = await app.request('/users/me/settings', {
        method: 'PATCH',
        headers: {
          Authorization: 'Bearer valid.jwt.token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          theme: 'dark',
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.settings.theme).toBe('dark');
    });
  });
});
