import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import { query, withTransaction } from '../services/database';
import { requireAuth } from '../middleware/auth';
import {
  CreateChatSessionSchema,
  UpdateChatSessionSchema,
  ListChatsQuerySchema,
  GetChatMessagesQuerySchema,
  AddMessagesSchema,
  ChatMessage,
  ChatSessionSummary,
  ChatSessionDetail,
} from '../schemas/chats';

export const chatsRouter = new Hono();

chatsRouter.use('*', requireAuth);

function formatMessageRow(row: any): ChatMessage {
  return {
    id: row.id,
    chat_id: row.chat_id,
    role: row.role,
    content: row.content,
    tool_calls: Array.isArray(row.tool_calls_json) ? row.tool_calls_json : [],
    error: row.error_text ?? null,
    created_at: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
  };
}

// ─── GET /chats ──────────────────────────────────────────────────────────────

chatsRouter.get(
  '/',
  zValidator('query', ListChatsQuerySchema, (result, c) => {
    if (!result.success && 'error' in result) {
      return c.json({ statusCode: 400, message: result.error.errors.map((e) => e.message) }, 400);
    }
  }),
  async (c) => {
    const user = c.get('user');
    const { agent_id, include_archived, limit, offset } = c.req.valid('query');

    const chatsRes = await query<{
      id: string;
      agent_id: string;
      title: string;
      is_archived: boolean;
      created_at: string;
      updated_at: string;
      message_count: number;
      last_message_preview: string | null;
    }>(
      `SELECT 
         s.id,
         s.agent_id,
         s.title,
         s.is_archived,
         s.created_at,
         s.updated_at,
         coalesce(m.msg_count, 0)::int as message_count,
         m.last_content as last_message_preview
       FROM public.chat_sessions s
       LEFT JOIN LATERAL (
         SELECT 
           count(*)::int as msg_count,
           (SELECT substring(content from 1 for 120) FROM public.chat_messages WHERE chat_id = s.id ORDER BY created_at DESC LIMIT 1) as last_content
         FROM public.chat_messages
         WHERE chat_id = s.id
       ) m ON true
       WHERE s.user_id = $1
         AND ($2::uuid IS NULL OR s.agent_id = $2)
         AND ($3::boolean = true OR s.is_archived = false)
       ORDER BY s.updated_at DESC
       LIMIT $4 OFFSET $5`,
      [user.id, agent_id || null, include_archived ?? false, limit, offset],
    );

    const countRes = await query<{ total: number }>(
      `SELECT count(*)::int as total
       FROM public.chat_sessions
       WHERE user_id = $1
         AND ($2::uuid IS NULL OR agent_id = $2)
         AND ($3::boolean = true OR is_archived = false)`,
      [user.id, agent_id || null, include_archived ?? false],
    );

    const chats: ChatSessionSummary[] = chatsRes.rows.map((row) => ({
      id: row.id,
      agent_id: row.agent_id,
      title: row.title,
      message_count: Number(row.message_count),
      last_message_preview: row.last_message_preview ? (row.last_message_preview.length >= 120 ? `${row.last_message_preview}...` : row.last_message_preview) : undefined,
      is_archived: Boolean(row.is_archived),
      created_at: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
      updated_at: row.updated_at ? new Date(row.updated_at).toISOString() : new Date().toISOString(),
    }));

    return c.json({
      success: true,
      chats,
      total: Number(countRes.rows[0]?.total ?? 0),
    });
  },
);

// ─── POST /chats ─────────────────────────────────────────────────────────────

chatsRouter.post(
  '/',
  zValidator('json', CreateChatSessionSchema, (result, c) => {
    if (!result.success && 'error' in result) {
      return c.json({ statusCode: 400, message: result.error.errors.map((e) => e.message) }, 400);
    }
  }),
  async (c) => {
    const user = c.get('user');
    const { agent_id, title } = c.req.valid('json');

    // Verify agent exists and belongs to user
    const agentRes = await query<{ id: string }>(
      'SELECT id FROM public.agents WHERE id = $1 AND owner_id = $2 LIMIT 1',
      [agent_id, user.id],
    );

    if (agentRes.rows.length === 0) {
      throw new HTTPException(404, { message: 'Agent not found' });
    }

    const insertRes = await query<{
      id: string;
      user_id: string;
      agent_id: string;
      title: string;
      is_archived: boolean;
      created_at: string;
      updated_at: string;
    }>(
      `INSERT INTO public.chat_sessions (user_id, agent_id, title)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [user.id, agent_id, title || 'New Conversation'],
    );

    const row = insertRes.rows[0];

    const chatDetail: ChatSessionDetail = {
      id: row.id,
      agent_id: row.agent_id,
      title: row.title,
      message_count: 0,
      messages: [],
      is_archived: Boolean(row.is_archived),
      created_at: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
      updated_at: row.updated_at ? new Date(row.updated_at).toISOString() : new Date().toISOString(),
    };

    return c.json({ success: true, chat: chatDetail }, 201);
  },
);

// ─── GET /chats/:id ──────────────────────────────────────────────────────────

chatsRouter.get(
  '/:id',
  zValidator('query', GetChatMessagesQuerySchema, (result, c) => {
    if (!result.success && 'error' in result) {
      return c.json({ statusCode: 400, message: result.error.errors.map((e) => e.message) }, 400);
    }
  }),
  async (c) => {
    const user = c.get('user');
    const chatId = c.req.param('id');
    const { limit, before } = c.req.valid('query');

    const sessionRes = await query<{
      id: string;
      agent_id: string;
      title: string;
      is_archived: boolean;
      created_at: string;
      updated_at: string;
    }>(
      `SELECT id, agent_id, title, is_archived, created_at, updated_at
       FROM public.chat_sessions
       WHERE id = $1 AND user_id = $2
       LIMIT 1`,
      [chatId, user.id],
    );

    if (sessionRes.rows.length === 0) {
      throw new HTTPException(404, { message: 'Chat session not found' });
    }

    const session = sessionRes.rows[0];

    const messagesRes = await query(
      `SELECT id, chat_id, role, content, tool_calls_json, error_text, created_at
       FROM public.chat_messages
       WHERE chat_id = $1 AND user_id = $2
         AND ($3::timestamptz IS NULL OR created_at < $3)
       ORDER BY created_at ASC
       LIMIT $4`,
      [chatId, user.id, before || null, limit],
    );

    const messages: ChatMessage[] = messagesRes.rows.map(formatMessageRow);

    const chatDetail: ChatSessionDetail = {
      id: session.id,
      agent_id: session.agent_id,
      title: session.title,
      message_count: messages.length,
      last_message_preview: messages.length > 0 ? messages[messages.length - 1].content.slice(0, 120) : undefined,
      is_archived: Boolean(session.is_archived),
      created_at: session.created_at ? new Date(session.created_at).toISOString() : new Date().toISOString(),
      updated_at: session.updated_at ? new Date(session.updated_at).toISOString() : new Date().toISOString(),
      messages,
    };

    return c.json({ success: true, chat: chatDetail });
  },
);

// ─── PATCH /chats/:id ────────────────────────────────────────────────────────

chatsRouter.patch(
  '/:id',
  zValidator('json', UpdateChatSessionSchema, (result, c) => {
    if (!result.success && 'error' in result) {
      return c.json({ statusCode: 400, message: result.error.errors.map((e) => e.message) }, 400);
    }
  }),
  async (c) => {
    const user = c.get('user');
    const chatId = c.req.param('id');
    const { title, is_archived } = c.req.valid('json');

    const checkRes = await query<{ id: string }>(
      'SELECT id FROM public.chat_sessions WHERE id = $1 AND user_id = $2 LIMIT 1',
      [chatId, user.id],
    );

    if (checkRes.rows.length === 0) {
      throw new HTTPException(404, { message: 'Chat session not found' });
    }

    const updates: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (title !== undefined) {
      updates.push(`title = $${idx++}`);
      values.push(title);
    }
    if (is_archived !== undefined) {
      updates.push(`is_archived = $${idx++}`);
      values.push(is_archived);
    }

    let updatedSession;
    if (updates.length > 0) {
      values.push(chatId, user.id);
      const updateSql = `
        UPDATE public.chat_sessions
        SET ${updates.join(', ')}
        WHERE id = $${idx++} AND user_id = $${idx++}
        RETURNING id, title, updated_at`;
      const res = await query(updateSql, values);
      updatedSession = res.rows[0];
    } else {
      const res = await query(
        'SELECT id, title, updated_at FROM public.chat_sessions WHERE id = $1 AND user_id = $2',
        [chatId, user.id],
      );
      updatedSession = res.rows[0];
    }

    return c.json({
      success: true,
      chat: {
        id: updatedSession.id,
        title: updatedSession.title,
        updated_at: new Date(updatedSession.updated_at).toISOString(),
      },
    });
  },
);

// ─── DELETE /chats/:id ───────────────────────────────────────────────────────

chatsRouter.delete('/:id', async (c) => {
  const user = c.get('user');
  const chatId = c.req.param('id');

  const checkRes = await query<{ id: string }>(
    'SELECT id FROM public.chat_sessions WHERE id = $1 AND user_id = $2 LIMIT 1',
    [chatId, user.id],
  );

  if (checkRes.rows.length === 0) {
    throw new HTTPException(404, { message: 'Chat session not found' });
  }

  await query('DELETE FROM public.chat_sessions WHERE id = $1 AND user_id = $2', [chatId, user.id]);

  return c.json({ success: true, message: 'Chat session deleted successfully' });
});

// ─── POST /chats/:id/messages ────────────────────────────────────────────────

chatsRouter.post(
  '/:id/messages',
  zValidator('json', AddMessagesSchema, (result, c) => {
    if (!result.success && 'error' in result) {
      return c.json({ statusCode: 400, message: result.error.errors.map((e) => e.message) }, 400);
    }
  }),
  async (c) => {
    const user = c.get('user');
    const chatId = c.req.param('id');
    const { messages: messageInputs } = c.req.valid('json');

    // Verify chat session exists and belongs to user
    const checkRes = await query<{ id: string }>(
      'SELECT id FROM public.chat_sessions WHERE id = $1 AND user_id = $2 LIMIT 1',
      [chatId, user.id],
    );

    if (checkRes.rows.length === 0) {
      throw new HTTPException(404, { message: 'Chat session not found' });
    }

    const insertedMessages = await withTransaction(async (client) => {
      const results: ChatMessage[] = [];

      for (const m of messageInputs) {
        const id = m.id || crypto.randomUUID();
        const createdAt = m.created_at || new Date().toISOString();

        const insertRes = await client.query(
          `INSERT INTO public.chat_messages (
             id, chat_id, user_id, role, content, tool_calls_json, error_text, created_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING id, chat_id, role, content, tool_calls_json, error_text, created_at`,
          [
            id,
            chatId,
            user.id,
            m.role,
            m.content,
            JSON.stringify(m.tool_calls || []),
            m.error || null,
            createdAt,
          ],
        );

        results.push(formatMessageRow(insertRes.rows[0]));
      }

      // Bump chat_sessions.updated_at
      await client.query(
        'UPDATE public.chat_sessions SET updated_at = now() WHERE id = $1',
        [chatId],
      );

      return results;
    });

    return c.json(
      {
        success: true,
        count: insertedMessages.length,
        messages: insertedMessages,
      },
      201,
    );
  },
);

// ─── DELETE /chats/:id/messages/:messageId ───────────────────────────────────

chatsRouter.delete('/:id/messages/:messageId', async (c) => {
  const user = c.get('user');
  const chatId = c.req.param('id');
  const messageId = c.req.param('messageId');

  // Verify chat session belongs to user
  const checkRes = await query<{ id: string }>(
    'SELECT id FROM public.chat_sessions WHERE id = $1 AND user_id = $2 LIMIT 1',
    [chatId, user.id],
  );

  if (checkRes.rows.length === 0) {
    throw new HTTPException(404, { message: 'Chat session not found' });
  }

  const deleteRes = await query(
    'DELETE FROM public.chat_messages WHERE id = $1 AND chat_id = $2 AND user_id = $3',
    [messageId, chatId, user.id],
  );

  if (deleteRes.rowCount === 0) {
    throw new HTTPException(404, { message: 'Message not found' });
  }

  return c.json({ success: true, message: 'Message removed' });
});
