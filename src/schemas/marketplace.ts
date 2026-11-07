import { z } from 'zod';

export const MARKETPLACE_SORTS = ['popular', 'recent', 'name'] as const;
export type MarketplaceSort = (typeof MARKETPLACE_SORTS)[number];

export const MarketplaceQuerySchema = z.object({
  q: z.string().trim().optional(),
  type: z.enum(['client', 'mcp']).optional(),
  connector: z.string().trim().optional(),
  tag: z.string().trim().optional(),
  hosting_tier: z.enum(['client', 'mcp']).optional(),
  sort: z.enum(MARKETPLACE_SORTS).optional().default('popular'),
  cursor: z.string().trim().optional(),
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
});

export const ToolReportSchema = z.object({
  reason: z.enum(['malicious', 'broken', 'spam', 'other'], {
    required_error: 'reason is required and must be one of: malicious, broken, spam, other',
  }),
  details: z.string().trim().max(1000).optional(),
});

export const InstallToolSchema = z.object({
  version_id: z.string().uuid().optional(),
});

export type MarketplaceQueryInput = z.infer<typeof MarketplaceQuerySchema>;
export type ToolReportInput = z.infer<typeof ToolReportSchema>;
export type InstallToolInput = z.infer<typeof InstallToolSchema>;

