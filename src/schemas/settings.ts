import { z } from 'zod';

// ─── User Settings Schemas ───────────────────────────────────────────────────

export const UserThemeSchema = z.enum(['system', 'light', 'dark']);
export type UserTheme = z.infer<typeof UserThemeSchema>;

export const UpdateUserSettingsSchema = z.object({
  theme: UserThemeSchema.optional(),
  extra: z.record(z.unknown()).optional(),
});

export type UpdateUserSettingsInput = z.infer<typeof UpdateUserSettingsSchema>;

export interface UserSettingsResponse {
  user_id: string;
  theme: UserTheme;
  extra: Record<string, unknown>;
  updated_at?: string;
}
