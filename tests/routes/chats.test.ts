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

import { chatsRouter } from '../../src/routes/chats';

function createChatsApp() {
  const app = new Hono();
  app.route('/chats', chatsRouter);
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
  email: 'chat.owner@example.com',
};

const sampleSessionRow = {
  id: '7b084922-261c-43f6-9fcf-bdf0716fa55a',
  user_id: 'user-uuid-111',
  agent_id: 'e4b2d184-722a-4632-a5e2-040212a42167',
  title: 'Quantum Algorithm Bounds',
  is_archived: false,
  created_at: '2026-11-15T09:25:00.000Z',
  updated_at: '2026-11-15T09:35:10.000Z',
  message_count: 2,
  last_message_preview: 'Regarding your calculation...',
};

const sampleMessageRows = [
  {
    id: '11d1fa01-0941-4775-9ba4-f5a0b7774130',
    chat_id: '7b084922-261c-43f6-9fcf-bdf0716fa55a',
    user_id: 'user-uuid-111',
    role: 'user',
    content: 'Evaluate 42 * 17',
    tool_calls_json: [],
    error_text: null,
    created_at: '2026-11-15T09:25:02.000Z',
  },
  {
    id: '22d2fa02-0941-4775-9ba4-f5a0b7774131',
    chat_id: '7b084922-261c-43f6-9fcf-bdf0716fa55a',
    user_id: 'user-uuid-111',
    role: 'assistant',
    content: 'Regarding your calculation: 42 * 17 = 714',
    tool_calls_json: [
      {
        id: 'call_math_1',
        tool_id: '8a931920-58f1-4db8-bca7-8173426e2f42',
        tool_name: 'math_calculator',
        input: { expression: '42 * 17' },
        output: { result: 714 },
        duration_ms: 14,
        status: 'completed',
      },
    ],
    error_text: null,
    created_at: '2026-11-15T09:25:05.000Z',
  },
];

describe('Chats Routes (/chats)', () => {
  let app: ReturnType<typeof createChatsApp>;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createChatsApp();
    jwtMocks.verifyAccessToken.mockResolvedValue(mockUser);
    dbMocks.withTransaction.mockImplementation(async (cb: any) => {
      const client = {
        query: dbMocks.query,
      };
      return cb(client);
    });
  });

  describe('GET /chats', () => {
    it('returns conversation sessions with preview and message count', async () => {
      dbMocks.query
        .mockResolvedValueOnce({ rows: [sampleSessionRow] }) // list sessions
        .mockResolvedValueOnce({ rows: [{ total: 1 }] }); // count

      const res = await app.request('/chats', {
        headers: { Authorization: 'Bearer valid.jwt.token' },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.chats).toHaveLength(1);
      expect(body.chats[0].title).toBe('Quantum Algorithm Bounds');
      expect(body.chats[0].message_count).toBe(2);
      expect(body.total).toBe(1);
    });
  });

  describe('POST /chats', () => {
    it('creates a new chat session for an agent', async () => {
      dbMocks.query
        .mockResolvedValueOnce({ rows: [{ id: sampleSessionRow.agent_id }] }) // check agent exists
        .mockResolvedValueOnce({ rows: [sampleSessionRow] }); // insert session

      const res = await app.request('/chats', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer valid.jwt.token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          agent_id: sampleSessionRow.agent_id,
          title: 'Quantum Algorithm Bounds',
        }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.chat.id).toBe(sampleSessionRow.id);
      expect(body.chat.title).toBe('Quantum Algorithm Bounds');
      expect(body.chat.messages).toEqual([]);
    });

    it('returns 404 when agent does not exist', async () => {
      dbMocks.query.mockResolvedValueOnce({ rows: [] });

      const res = await app.request('/chats', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer valid.jwt.token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          agent_id: '00000000-0000-0000-0000-000000000000',
          title: 'New Chat',
        }),
      });

      expect(res.status).toBe(404);
    });
  });

  describe('GET /chats/:id', () => {
    it('returns session with full chronological messages and tool traces', async () => {
      dbMocks.query
        .mockResolvedValueOnce({ rows: [sampleSessionRow] }) // get session
        .mockResolvedValueOnce({ rows: sampleMessageRows }); // get messages

      const res = await app.request(`/chats/${sampleSessionRow.id}`, {
        headers: { Authorization: 'Bearer valid.jwt.token' },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.chat.id).toBe(sampleSessionRow.id);
      expect(body.chat.messages).toHaveLength(2);
      expect(body.chat.messages[1].tool_calls).toHaveLength(1);
      expect(body.chat.messages[1].tool_calls[0].tool_name).toBe('math_calculator');
    });

    it('returns 404 if chat session does not exist', async () => {
      dbMocks.query.mockResolvedValueOnce({ rows: [] });

      const res = await app.request('/chats/00000000-0000-0000-0000-000000000000', {
        headers: { Authorization: 'Bearer valid.jwt.token' },
      });

      expect(res.status).toBe(404);
    });
  });

  describe('PATCH /chats/:id', () => {
    it('renames and updates chat session', async () => {
      dbMocks.query
        .mockResolvedValueOnce({ rows: [{ id: sampleSessionRow.id }] }) // check existence
        .mockResolvedValueOnce({
          rows: [
            {
              id: sampleSessionRow.id,
              title: 'Renamed Chat',
              updated_at: '2026-11-15T09:40:00.000Z',
            },
          ],
        }); // update

      const res = await app.request(`/chats/${sampleSessionRow.id}`, {
        method: 'PATCH',
        headers: {
          Authorization: 'Bearer valid.jwt.token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ title: 'Renamed Chat' }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.chat.title).toBe('Renamed Chat');
    });
  });

  describe('DELETE /chats/:id', () => {
    it('deletes chat session and cascades', async () => {
      dbMocks.query
        .mockResolvedValueOnce({ rows: [{ id: sampleSessionRow.id }] }) // check existence
        .mockResolvedValueOnce({ rows: [] }); // delete

      const res = await app.request(`/chats/${sampleSessionRow.id}`, {
        method: 'DELETE',
        headers: { Authorization: 'Bearer valid.jwt.token' },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.message).toBe('Chat session deleted successfully');
    });
  });

  describe('POST /chats/:id/messages', () => {
    it('appends batch of messages and bumps updated_at', async () => {
      dbMocks.query
        .mockResolvedValueOnce({ rows: [{ id: sampleSessionRow.id }] }) // check existence
        .mockResolvedValueOnce({ rows: [sampleMessageRows[0]] }) // insert msg 1
        .mockResolvedValueOnce({ rows: [sampleMessageRows[1]] }) // insert msg 2
        .mockResolvedValueOnce({ rows: [] }); // bump session updated_at

      const payload = {
        messages: [
          { role: 'user', content: 'Evaluate 42 * 17' },
          {
            role: 'assistant',
            content: 'Regarding your calculation: 42 * 17 = 714',
            tool_calls: sampleMessageRows[1].tool_calls_json,
          },
        ],
      };

      const res = await app.request(`/chats/${sampleSessionRow.id}/messages`, {
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
      expect(body.count).toBe(2);
      expect(body.messages).toHaveLength(2);
    });
  });

  describe('DELETE /chats/:id/messages/:messageId', () => {
    it('removes an individual message from the thread', async () => {
      dbMocks.query
        .mockResolvedValueOnce({ rows: [{ id: sampleSessionRow.id }] }) // check session exists
        .mockResolvedValueOnce({ rowCount: 1 }); // delete message

      const res = await app.request(
        `/chats/${sampleSessionRow.id}/messages/${sampleMessageRows[0].id}`,
        {
          method: 'DELETE',
          headers: { Authorization: 'Bearer valid.jwt.token' },
        },
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.message).toBe('Message removed');
    });
  });
});
