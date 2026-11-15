import { z } from 'zod';

// ─── Blobbie Avatar Schema & Defaults ────────────────────────────────────────

export const BlobbieConfigSchema = z.object({
  sides: z.union([z.literal(0), z.literal(3), z.literal(4), z.literal(5), z.literal(6)]),
  round: z.number().min(0.0).max(1.0),
  bumps: z.number().min(0.0).max(0.14),
  point: z.number().min(0.0).max(0.6),
  pa: z.number().min(-3.0).max(-1.8),
  sx: z.number().min(0.7).max(1.3),
  sy: z.number().min(0.7).max(1.3),
  rot: z.number().min(-1.6).max(1.6),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Must be a valid hex color code (e.g. #00a590)'),
  es: z.number().min(0.6).max(1.4),
  tilt: z.number().min(-0.5).max(0.7),
  sp: z.number().min(0.15).max(0.55),
  fx: z.number().min(-0.25).max(0.35),
  fy: z.number().min(-0.4).max(0.15),
});

export type BlobbieConfig = z.infer<typeof BlobbieConfigSchema>;

/**
 * Returns a deterministically seeded default Blobbie avatar configuration.
 */
export function getDefaultBlobbie(seed: string = 'agent'): BlobbieConfig {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }
  const posHash = Math.abs(hash);

  const colors = ['#00a590', '#3b82f6', '#8b5cf6', '#ec4899', '#f97316', '#10b981'];
  const color = colors[posHash % colors.length];

  return {
    sides: 0,
    round: 0.85,
    bumps: 0.04,
    point: 0.3,
    pa: -2.3,
    sx: 1.0,
    sy: 1.0,
    rot: 0.0,
    color,
    es: 1.0,
    tilt: 0.0,
    sp: 0.35,
    fx: 0.0,
    fy: -0.15,
  };
}

// ─── Attached Tools & Connectors ──────────────────────────────────────────────

export const AttachedToolInputSchema = z.object({
  tool_id: z.string().uuid('tool_id must be a valid UUID'),
  pinned_version: z.number().int().min(1).nullable().optional(),
});

export type AttachedToolInput = z.infer<typeof AttachedToolInputSchema>;

export const ConnectorTypeSchema = z.enum(['postgres', 'slack']);
export type ConnectorType = z.infer<typeof ConnectorTypeSchema>;

// ─── Agent Request Schemas ────────────────────────────────────────────────────

export const CreateAgentSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100, 'Name must not exceed 100 characters'),
  description: z.string().trim().max(500, 'Description must not exceed 500 characters').default(''),
  system_prompt: z.string().default(''),
  source_preset_id: z.string().uuid('source_preset_id must be a valid UUID').nullable().optional(),
  model_provider: z.enum(['google', 'openai', 'anthropic', 'deepseek']).optional(),
  model_id: z.string().min(1).optional(),
  model_params: z.record(z.unknown()).default({}),
  avatar: BlobbieConfigSchema.optional(),
  attached_tools: z.array(AttachedToolInputSchema).default([]),
  attached_connectors: z.array(ConnectorTypeSchema).default([]),
});

export type CreateAgentInput = z.infer<typeof CreateAgentSchema>;

export const UpdateAgentSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100, 'Name must not exceed 100 characters').optional(),
  description: z.string().trim().max(500, 'Description must not exceed 500 characters').optional(),
  system_prompt: z.string().optional(),
  source_preset_id: z.string().uuid('source_preset_id must be a valid UUID').nullable().optional(),
  model_provider: z.enum(['google', 'openai', 'anthropic', 'deepseek']).optional(),
  model_id: z.string().min(1).optional(),
  model_params: z.record(z.unknown()).optional(),
  avatar: BlobbieConfigSchema.optional(),
  attached_tools: z.array(AttachedToolInputSchema).optional(),
  attached_connectors: z.array(ConnectorTypeSchema).optional(),
  is_archived: z.boolean().optional(),
});

export type UpdateAgentInput = z.infer<typeof UpdateAgentSchema>;

export const ListAgentsQuerySchema = z.object({
  include_archived: z
    .string()
    .optional()
    .transform((val) => val === 'true'),
  search: z.string().trim().optional(),
});

export type ListAgentsQuery = z.infer<typeof ListAgentsQuerySchema>;

// ─── Agent Response Contract ──────────────────────────────────────────────────

export interface AttachedToolDetail {
  tool_id: string;
  name: string;
  pinned_version: number | null;
  current_version: number;
  status: string;
  type: 'client' | 'mcp';
}

export interface AgentResponse {
  id: string;
  name: string;
  description: string;
  system_prompt: string;
  source_preset_id: string | null;
  model_provider: string;
  model_id: string;
  model_params: Record<string, unknown>;
  avatar: BlobbieConfig;
  attached_tools: AttachedToolDetail[];
  attached_connectors: ConnectorType[];
  is_archived: boolean;
  created_at: string;
  updated_at: string;
}
