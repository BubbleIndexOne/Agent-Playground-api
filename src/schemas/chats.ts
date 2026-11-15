import { z } from 'zod';

// ─── Tool Calls in Chat ───────────────────────────────────────────────────────

export const ChatToolCallSchema = z.object({
  id: z.string().min(1, 'Tool call ID is required'),
  tool_id: z.string().min(1, 'tool_id is required'),
  tool_name: z.string().min(1, 'tool_name is required'),
  input: z.record(z.unknown()).default({}),
  output: z.unknown().optional(),
  error: z.string().optional(),
  duration_ms: z.number().int().nonnegative().optional(),
  status: z.enum(['running', 'completed', 'failed', 'unavailable']),
});

export type ChatToolCall = z.infer<typeof ChatToolCallSchema>;

// ─── Chat Messages ────────────────────────────────────────────────────────────

export const ChatMessageInputSchema = z.object({
  id: z.string().uuid('Message ID must be a valid UUID').optional(),
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string().default(''),
  tool_calls: z.array(ChatToolCallSchema).default([]),
  error: z.string().nullable().optional(),
  created_at: z.string().datetime({ offset: true }).optional(),
});

export type ChatMessageInput = z.infer<typeof ChatMessageInputSchema>;

export const AddMessagesSchema = z.object({
  messages: z.array(ChatMessageInputSchema).min(1, 'At least one message is required'),
});

export type AddMessagesInput = z.infer<typeof AddMessagesSchema>;

export interface ChatMessage {
  id: string;
  chat_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  tool_calls: ChatToolCall[];
  error?: string | null;
  created_at: string;
}

// ─── Chat Sessions ────────────────────────────────────────────────────────────

export const CreateChatSessionSchema = z.object({
  id: z.string().uuid('id must be a valid UUID').optional(),
  agent_id: z.string().uuid('agent_id must be a valid UUID'),
  title: z.string().trim().min(1, 'Title cannot be empty').max(200, 'Title must not exceed 200 characters').default('New Conversation'),
});

export type CreateChatSessionInput = z.infer<typeof CreateChatSessionSchema>;

export const UpdateChatSessionSchema = z.object({
  title: z.string().trim().min(1, 'Title cannot be empty').max(200, 'Title must not exceed 200 characters').optional(),
  is_archived: z.boolean().optional(),
});

export type UpdateChatSessionInput = z.infer<typeof UpdateChatSessionSchema>;

export const ListChatsQuerySchema = z.object({
  agent_id: z.string().uuid().optional(),
  include_archived: z
    .string()
    .optional()
    .transform((val) => val === 'true'),
  limit: z
    .string()
    .optional()
    .transform((val) => (val ? Math.min(Math.max(parseInt(val, 10) || 50, 1), 100) : 50)),
  offset: z
    .string()
    .optional()
    .transform((val) => (val ? Math.max(parseInt(val, 10) || 0, 0) : 0)),
});

export type ListChatsQuery = z.infer<typeof ListChatsQuerySchema>;

export const GetChatMessagesQuerySchema = z.object({
  limit: z
    .string()
    .optional()
    .transform((val) => (val ? Math.min(Math.max(parseInt(val, 10) || 100, 1), 100) : 100)),
  before: z.string().optional(),
});

export type GetChatMessagesQuery = z.infer<typeof GetChatMessagesQuerySchema>;

// ─── Chat Response Contracts ──────────────────────────────────────────────────

export interface ChatSessionSummary {
  id: string;
  agent_id: string;
  title: string;
  message_count: number;
  last_message_preview?: string;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface ChatSessionDetail extends ChatSessionSummary {
  messages: ChatMessage[];
}
