import { z } from 'zod';

// ─── Constants ──────────────────────────────────────────────────────────────

export const TOOL_TYPES = ['client', 'mcp'] as const;
export type ToolType = (typeof TOOL_TYPES)[number];

export const TOOL_STATUSES = [
  'draft',
  'testing',
  'verified',
  'registered',
  'rejected',
  'deprecated',
] as const;
export type ToolStatus = (typeof TOOL_STATUSES)[number];

// ─── Request Schemas ──────────────────────────────────────────────────────────

export const CreateToolSchema = z
  .object({
    name: z
      .string({ required_error: 'name is required' })
      .trim()
      .min(1, { message: 'name must not be empty' })
      .max(100, { message: 'name must not exceed 100 characters' }),
    description: z
      .string()
      .trim()
      .max(500, { message: 'description must not exceed 500 characters' })
      .optional()
      .nullable(),
    type: z.enum(TOOL_TYPES, {
      required_error: 'type is required and must be either "client" or "mcp"',
    }),
    connector_type: z
      .string()
      .trim()
      .max(50, { message: 'connector_type must not exceed 50 characters' })
      .optional()
      .nullable(),
    is_public: z.boolean().optional().default(false),
    allow_client_execution: z.boolean().optional().default(false),
  })
  .superRefine((data, ctx) => {
    if (data.type === 'mcp' && (!data.connector_type || data.connector_type.trim() === '')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['connector_type'],
        message: 'connector_type is required when type is "mcp"',
      });
    }
    if (data.type === 'client' && data.connector_type && data.connector_type.trim() !== '') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['connector_type'],
        message: 'connector_type must be empty or null when type is "client"',
      });
    }
  });

export const UpdateToolSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, { message: 'name must not be empty' })
    .max(100, { message: 'name must not exceed 100 characters' })
    .optional(),
  description: z
    .string()
    .trim()
    .max(500, { message: 'description must not exceed 500 characters' })
    .optional()
    .nullable(),
  is_public: z.boolean().optional(),
  allow_client_execution: z.boolean().optional(),
  status: z.enum(TOOL_STATUSES).optional(),
});

export const CreateToolVersionSchema = z.object({
  code: z.string().optional().nullable(),
  schema_json: z.record(z.any(), {
    required_error: 'schema_json is required and must be a valid JSON Schema object',
  }),
  capabilities_json: z.union([z.array(z.any()), z.record(z.any())]).optional().default([]),
  test_results_json: z.record(z.any()).optional().nullable(),
});

// ─── Inferred Types ───────────────────────────────────────────────────────────

export type CreateToolInput = z.infer<typeof CreateToolSchema>;
export type UpdateToolInput = z.infer<typeof UpdateToolSchema>;
export type CreateToolVersionInput = z.infer<typeof CreateToolVersionSchema>;
