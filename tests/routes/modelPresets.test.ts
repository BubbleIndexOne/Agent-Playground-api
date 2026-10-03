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

import { modelPresetsRouter } from '../../src/routes/modelPresets';
import { DEFAULT_MODEL_CONFIGS } from '../../src/constants';

function createModelPresetsApp() {
  const app = new Hono();
  app.route('/model-presets', modelPresetsRouter);
  app.onError((error, c) => {
    if (error instanceof HTTPException) {
      return c.json({ statusCode: error.status, message: error.message }, error.status);
    }
    return c.json({ statusCode: 500, message: (error as Error).message }, 500);
  });
  return app;
}

const mockUser = {
  id: 'user-uuid-preset-111',
  sub: 'user-uuid-preset-111',
  email: 'preset.user@example.com',
};

describe('Model Presets Routes (/model-presets)', () => {
  let app: ReturnType<typeof createModelPresetsApp>;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createModelPresetsApp();
    jwtMocks.verifyAccessToken.mockResolvedValue(mockUser);
  });

  describe('GET /model-presets/defaults', () => {
    it('returns the centralized baseline model hyperparameter defaults', async () => {
      const res = await app.request('/model-presets/defaults');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.defaults).toEqual(DEFAULT_MODEL_CONFIGS);
    });
  });

  describe('POST /model-presets', () => {
    it('requires authentication', async () => {
      const res = await app.request('/model-presets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Preset', provider: 'openai' }),
      });
      expect(res.status).toBe(401);
    });

    it('validates provider-specific constraints (rejects Anthropic temperature > 1.0)', async () => {
      const res = await app.request('/model-presets', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer valid.jwt.token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: 'Invalid Anthropic',
          provider: 'anthropic',
          params: { temperature: 1.5 },
        }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.message).toContain('Anthropic temperature must be between 0.0 and 1.0');
    });

    it('stores sparse delta in database and returns fully hydrated response', async () => {
      const payload = {
        name: 'Deterministic Coding',
        provider: 'openai',
        model_id: 'gpt-4o',
        params: {
          temperature: 0.2, // non-default -> should be kept
          topP: 1.0,        // default -> should be pruned
          topK: 40,         // default -> should be pruned
          presencePenalty: 0.0, // default -> should be pruned
          frequencyPenalty: 0.0, // default -> should be pruned
          maxOutputTokens: 2048, // custom -> kept
        },
      };

      // Mock database returning the stored sparse delta
      dbMocks.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'preset-uuid-1',
            owner_id: mockUser.id,
            name: payload.name,
            provider: payload.provider,
            model_id: payload.model_id,
            params_json: { temperature: 0.2, maxOutputTokens: 2048 },
            is_archived: false,
            created_at: '2026-10-03T12:00:00.000Z',
            updated_at: '2026-10-03T12:00:00.000Z',
          },
        ],
      });

      const res = await app.request('/model-presets', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer valid.jwt.token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.success).toBe(true);

      // Verify that database received sparse delta (topP and penalties pruned)
      const [sql, params] = dbMocks.query.mock.calls[0];
      expect(sql).toContain('INSERT INTO public.model_presets');
      const savedDelta = JSON.parse(params[4]);
      expect(savedDelta).toEqual({
        temperature: 0.2,
        maxOutputTokens: 2048,
      });
      expect(savedDelta.topP).toBeUndefined();

      // Verify response returns fully hydrated configuration
      expect(body.preset.params).toEqual({
        temperature: 0.2,
        topP: DEFAULT_MODEL_CONFIGS.topP,
        topK: DEFAULT_MODEL_CONFIGS.topK,
        presencePenalty: DEFAULT_MODEL_CONFIGS.presencePenalty,
        frequencyPenalty: DEFAULT_MODEL_CONFIGS.frequencyPenalty,
        maxOutputTokens: 2048,
      });
    });
  });

  describe('GET /model-presets', () => {
    it('returns user presets fully hydrated and supports provider filter', async () => {
      dbMocks.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'preset-1',
            owner_id: mockUser.id,
            name: 'Claude Creative',
            provider: 'anthropic',
            model_id: null,
            params_json: { temperature: 0.9 },
            is_archived: false,
            created_at: '2026-10-03T12:00:00Z',
            updated_at: '2026-10-03T12:00:00Z',
          },
        ],
      });

      const res = await app.request('/model-presets?provider=anthropic', {
        headers: { Authorization: 'Bearer valid.jwt.token' },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.presets.length).toBe(1);
      expect(body.presets[0].params.temperature).toBe(0.9);
      expect(body.presets[0].params.topP).toBe(DEFAULT_MODEL_CONFIGS.topP);

      const [sql, params] = dbMocks.query.mock.calls[0];
      expect(sql).toContain('provider = $2 OR provider = \'all\'');
      expect(params).toContain('anthropic');
    });
  });

  describe('GET /model-presets/:id', () => {
    it('returns 404 if preset not found or does not belong to user', async () => {
      dbMocks.query.mockResolvedValueOnce({ rows: [] });

      const res = await app.request('/model-presets/00000000-0000-0000-0000-000000000000', {
        headers: { Authorization: 'Bearer valid.jwt.token' },
      });

      expect(res.status).toBe(404);
    });

    it('returns hydrated preset details', async () => {
      dbMocks.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'preset-uuid-2',
            owner_id: mockUser.id,
            name: 'Precise Fast',
            provider: 'openai',
            model_id: 'gpt-4o',
            params_json: { temperature: 0.1 },
            is_archived: false,
            created_at: '2026-10-03T12:00:00Z',
            updated_at: '2026-10-03T12:00:00Z',
          },
        ],
      });

      const res = await app.request('/model-presets/preset-uuid-2', {
        headers: { Authorization: 'Bearer valid.jwt.token' },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.preset.params.temperature).toBe(0.1);
      expect(body.preset.params.topK).toBe(DEFAULT_MODEL_CONFIGS.topK);
    });
  });

  describe('PATCH /model-presets/:id', () => {
    it('updates preset parameters with sparse delta re-pruning', async () => {
      // 1. Existence check mock
      dbMocks.query.mockResolvedValueOnce({
        rows: [{ id: 'preset-uuid-3', provider: 'openai', params_json: {} }],
      });

      // 2. Update execution mock
      dbMocks.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'preset-uuid-3',
            owner_id: mockUser.id,
            name: 'Updated Name',
            provider: 'openai',
            model_id: 'gpt-4o',
            params_json: { temperature: 0.5 },
            is_archived: false,
            created_at: '2026-10-03T12:00:00Z',
            updated_at: '2026-10-03T12:05:00Z',
          },
        ],
      });

      const res = await app.request('/model-presets/preset-uuid-3', {
        method: 'PATCH',
        headers: {
          Authorization: 'Bearer valid.jwt.token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: 'Updated Name',
          params: { temperature: 0.5, topP: 1.0 }, // topP is default -> pruned
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.preset.name).toBe('Updated Name');
      expect(body.preset.params.temperature).toBe(0.5);

      const [updateSql, updateParams] = dbMocks.query.mock.calls[1];
      expect(updateSql).toContain('UPDATE public.model_presets');
      expect(updateParams).toContain(JSON.stringify({ temperature: 0.5 }));
    });

    it('merges new partial params with existing sparse delta', async () => {
      dbMocks.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'preset-uuid-3b',
            provider: 'anthropic',
            params_json: { temperature: 0.25, maxOutputTokens: 2048 },
          },
        ],
      });

      dbMocks.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'preset-uuid-3b',
            owner_id: mockUser.id,
            name: 'Anthropic Preset',
            provider: 'anthropic',
            model_id: 'claude-3-7-sonnet-latest',
            params_json: { temperature: 0.5, maxOutputTokens: 2048 },
            is_archived: false,
            created_at: '2026-10-03T12:00:00Z',
            updated_at: '2026-10-03T12:05:00Z',
          },
        ],
      });

      const res = await app.request('/model-presets/preset-uuid-3b', {
        method: 'PATCH',
        headers: {
          Authorization: 'Bearer valid.jwt.token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          params: { temperature: 0.5 },
        }),
      });

      expect(res.status).toBe(200);
      const [, updateParams] = dbMocks.query.mock.calls[1];
      const savedDelta = JSON.parse(updateParams[0]);
      expect(savedDelta).toEqual({
        temperature: 0.5,
        maxOutputTokens: 2048,
      });
    });
  });

  describe('DELETE /model-presets/:id', () => {
    it('soft deletes preset by setting is_archived = true', async () => {
      dbMocks.query.mockResolvedValueOnce({ rows: [{ id: 'preset-uuid-4' }] });

      const res = await app.request('/model-presets/preset-uuid-4', {
        method: 'DELETE',
        headers: { Authorization: 'Bearer valid.jwt.token' },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.message).toContain('archived successfully');

      const [sql] = dbMocks.query.mock.calls[0];
      expect(sql).toContain('SET is_archived = true');
    });

    it('hard purges preset when ?purge=true is specified', async () => {
      dbMocks.query.mockResolvedValueOnce({ rows: [{ id: 'preset-uuid-5' }] });

      const res = await app.request('/model-presets/preset-uuid-5?purge=true', {
        method: 'DELETE',
        headers: { Authorization: 'Bearer valid.jwt.token' },
      });

      expect(res.status).toBe(200);
      const [sql] = dbMocks.query.mock.calls[0];
      expect(sql).toContain('DELETE FROM public.model_presets');
    });
  });
});
