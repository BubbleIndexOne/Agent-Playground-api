import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';

// Mock database query & transaction
const dbMocks = vi.hoisted(() => ({
  query: vi.fn(),
  withTransaction: vi.fn(),
}));

vi.mock('../../src/services/database', () => ({
  query: dbMocks.query,
  withTransaction: dbMocks.withTransaction,
}));

// Mock JWT
const jwtMocks = vi.hoisted(() => ({
  verifyAccessToken: vi.fn(),
}));

vi.mock('../../src/services/jwt', () => ({
  verifyAccessToken: jwtMocks.verifyAccessToken,
}));

import { agentsRouter } from '../../src/routes/agents';

function createAgentsApp() {
  const app = new Hono();
  app.route('/agents', agentsRouter);
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
  email: 'agent.owner@example.com',
};

const sampleAgentRow = {
  id: 'e4b2d184-722a-4632-a5e2-040212a42167',
  owner_id: 'user-uuid-111',
  name: 'Dr. Elena Vance',
  description: 'Senior Quant Specialist',
  system_prompt: 'You analyze formulas rigorously.',
  source_preset_id: 'c1f72a44-8839-4d6b-9c29-379a0b18e69b',
  model_provider: 'google',
  model_id: 'gemini-2.5-flash',
  model_params: { temperature: 0.2 },
  avatar_json: {
    sides: 0,
    round: 0.88,
    bumps: 0.04,
    point: 0.32,
    pa: -2.3,
    sx: 1.05,
    sy: 0.96,
    rot: 0.12,
    color: '#00a590',
    es: 1.1,
    tilt: 0.15,
    sp: 0.36,
    fx: 0.05,
    fy: -0.15,
  },
  attached_connectors: ['postgres'],
  is_archived: false,
  created_at: '2026-11-15T09:20:00.000Z',
  updated_at: '2026-11-15T09:20:00.000Z',
};

const sampleToolRow = {
  agent_id: 'e4b2d184-722a-4632-a5e2-040212a42167',
  tool_id: '8a931920-58f1-4db8-bca7-8173426e2f42',
  name: 'math_calculator',
  pinned_version: null,
  current_version: 2,
  status: 'verified',
  type: 'client',
};

describe('Agents Routes (/agents)', () => {
  let app: ReturnType<typeof createAgentsApp>;

  beforeEach(() => {
    vi.clearAllMocks();
    dbMocks.query.mockReset();
    dbMocks.withTransaction.mockReset();
    jwtMocks.verifyAccessToken.mockReset();

    app = createAgentsApp();
    jwtMocks.verifyAccessToken.mockResolvedValue(mockUser);
    dbMocks.withTransaction.mockImplementation(async (cb: any) => {
      const client = {
        query: dbMocks.query,
      };
      return cb(client);
    });
  });

  describe('GET /agents', () => {
    it('returns active user agents with attached tools', async () => {
      dbMocks.query
        .mockResolvedValueOnce({ rows: [sampleAgentRow] }) // agent query
        .mockResolvedValueOnce({ rows: [sampleToolRow] }); // tool query

      const res = await app.request('/agents', {
        headers: { Authorization: 'Bearer valid.jwt.token' },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.agents).toHaveLength(1);
      expect(body.agents[0].name).toBe('Dr. Elena Vance');
      expect(body.agents[0].attached_tools).toHaveLength(1);
      expect(body.agents[0].attached_tools[0].name).toBe('math_calculator');
    });

    it('returns 401 when token is missing', async () => {
      const res = await app.request('/agents');
      expect(res.status).toBe(401);
    });
  });

  describe('POST /agents', () => {
    it('creates an agent with avatar and attached tools', async () => {
      dbMocks.query
        .mockResolvedValueOnce({
          rows: [
            {
              provider: 'google',
              model_id: 'gemini-2.5-flash',
              params_json: { temperature: 0.2 },
            },
          ],
        }) // preset lookup
        .mockResolvedValueOnce({ rows: [sampleAgentRow] }) // insert agent
        .mockResolvedValueOnce({ rows: [] }) // insert tool
        .mockResolvedValueOnce({ rows: [sampleToolRow] }); // fetch tools

      const payload = {
        name: 'Dr. Elena Vance',
        description: 'Senior Quant Specialist',
        system_prompt: 'You analyze formulas rigorously.',
        source_preset_id: 'c1f72a44-8839-4d6b-9c29-379a0b18e69b',
        model_provider: 'google',
        model_id: 'gemini-2.5-flash',
        model_params: { temperature: 0.2 },
        avatar: sampleAgentRow.avatar_json,
        attached_tools: [{ tool_id: '8a931920-58f1-4db8-bca7-8173426e2f42', pinned_version: null }],
        attached_connectors: ['postgres'],
      };

      const res = await app.request('/agents', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer valid.jwt.token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.id).toBe(sampleAgentRow.id);
      expect(body.name).toBe('Dr. Elena Vance');
      expect(body.avatar.color).toBe('#00a590');
    });

    it('generates a deterministic fallback Blobbie avatar if avatar is omitted', async () => {
      const agentWithoutAvatar = { ...sampleAgentRow, avatar_json: null };
      dbMocks.query
        .mockResolvedValueOnce({ rows: [agentWithoutAvatar] })
        .mockResolvedValueOnce({ rows: [] });

      const res = await app.request('/agents', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer valid.jwt.token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'Fallback Bot' }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.avatar).toBeDefined();
      expect(body.avatar.sides).toBe(0);
      expect(body.avatar.color).toMatch(/^#[0-9a-fA-F]{6}$/);
    });

    it('returns 400 when name is empty', async () => {
      const res = await app.request('/agents', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer valid.jwt.token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: '' }),
      });

      expect(res.status).toBe(400);
    });
  });

  describe('GET /agents/:id', () => {
    it('returns agent details when agent exists', async () => {
      dbMocks.query
        .mockResolvedValueOnce({ rows: [sampleAgentRow] })
        .mockResolvedValueOnce({ rows: [sampleToolRow] });

      const res = await app.request(`/agents/${sampleAgentRow.id}`, {
        headers: { Authorization: 'Bearer valid.jwt.token' },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.id).toBe(sampleAgentRow.id);
      expect(body.name).toBe('Dr. Elena Vance');
    });

    it('returns 404 when agent not found', async () => {
      dbMocks.query.mockResolvedValueOnce({ rows: [] });

      const res = await app.request('/agents/00000000-0000-0000-0000-000000000000', {
        headers: { Authorization: 'Bearer valid.jwt.token' },
      });

      expect(res.status).toBe(404);
    });
  });

  describe('PATCH /agents/:id', () => {
    it('updates agent and re-links attached tools', async () => {
      const updatedAgent = { ...sampleAgentRow, name: 'Dr. Elena Vance (Updated)' };
      dbMocks.query
        .mockResolvedValueOnce({ rows: [{ id: sampleAgentRow.id }] }) // check existence
        .mockResolvedValueOnce({ rows: [updatedAgent] }) // update agent
        .mockResolvedValueOnce({ rows: [] }) // delete tools
        .mockResolvedValueOnce({ rows: [] }) // insert tools
        .mockResolvedValueOnce({ rows: [sampleToolRow] }); // fetch tools

      const res = await app.request(`/agents/${sampleAgentRow.id}`, {
        method: 'PATCH',
        headers: {
          Authorization: 'Bearer valid.jwt.token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: 'Dr. Elena Vance (Updated)',
          attached_tools: [{ tool_id: sampleToolRow.tool_id, pinned_version: 1 }],
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.name).toBe('Dr. Elena Vance (Updated)');
    });

    it('returns 404 if agent to update does not exist', async () => {
      dbMocks.query.mockResolvedValueOnce({ rows: [] });

      const res = await app.request('/agents/00000000-0000-0000-0000-000000000000', {
        method: 'PATCH',
        headers: {
          Authorization: 'Bearer valid.jwt.token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'New Name' }),
      });

      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /agents/:id', () => {
    it('soft deletes by default (is_archived = true)', async () => {
      dbMocks.query
        .mockResolvedValueOnce({ rows: [{ id: sampleAgentRow.id }] }) // check existence
        .mockResolvedValueOnce({ rows: [] }); // update archive

      const res = await app.request(`/agents/${sampleAgentRow.id}`, {
        method: 'DELETE',
        headers: { Authorization: 'Bearer valid.jwt.token' },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.message).toBe('Agent archived successfully');
      expect(dbMocks.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE public.agents SET is_archived = true'),
        expect.anything(),
      );
    });

    it('hard deletes when hard=true query param is supplied', async () => {
      dbMocks.query
        .mockResolvedValueOnce({ rows: [{ id: sampleAgentRow.id }] }) // check existence
        .mockResolvedValueOnce({ rows: [] }); // delete query

      const res = await app.request(`/agents/${sampleAgentRow.id}?hard=true`, {
        method: 'DELETE',
        headers: { Authorization: 'Bearer valid.jwt.token' },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.message).toBe('Agent permanently deleted');
      expect(dbMocks.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM public.agents'),
        expect.anything(),
      );
    });
  });

  describe('POST /agents/export', () => {
    it('exports all active user agents as a bundle', async () => {
      dbMocks.query
        .mockResolvedValueOnce({ rows: [sampleAgentRow] })
        .mockResolvedValueOnce({ rows: [sampleToolRow] });

      const res = await app.request('/agents/export', {
        method: 'POST',
        headers: { Authorization: 'Bearer valid.jwt.token' },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.version).toBe(1);
      expect(body.exported_at).toBeDefined();
      expect(body.agents).toHaveLength(1);
    });
  });

  describe('POST /agents/import', () => {
    it('imports agents in a batch transaction', async () => {
      dbMocks.query
        .mockResolvedValueOnce({ rows: [sampleAgentRow] }) // insert agent inside tx
        .mockResolvedValueOnce({ rows: [sampleToolRow] }); // fetch tools after tx

      const res = await app.request('/agents/import', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer valid.jwt.token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          agents: [
            {
              id: sampleAgentRow.id,
              name: 'Imported Agent',
              description: 'Imported Bio',
              system_prompt: 'System prompt',
            },
          ],
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.count).toBe(1);
      expect(body.agents[0].id).toBe(sampleAgentRow.id);
    });
  });
});
