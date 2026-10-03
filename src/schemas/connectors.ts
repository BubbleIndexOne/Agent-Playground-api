import { z } from 'zod';

export const SUPPORTED_CONNECTOR_TYPES = ['postgres', 'slack'] as const;
export type SupportedConnectorType = (typeof SUPPORTED_CONNECTOR_TYPES)[number];

export const PostgresCredentialSchema = z.object({
  host: z.string({ required_error: 'host is required' }).trim().min(1, 'host cannot be empty'),
  port: z.number().int().min(1).max(65535).default(5432),
  database: z.string({ required_error: 'database is required' }).trim().min(1, 'database cannot be empty'),
  user: z.string({ required_error: 'user is required' }).trim().min(1, 'user cannot be empty'),
  password: z.string({ required_error: 'password is required' }).min(1, 'password cannot be empty'),
  ssl: z.boolean().default(true),
});

export const SlackCredentialSchema = z.object({
  botToken: z
    .string({ required_error: 'botToken is required' })
    .trim()
    .min(1, 'botToken cannot be empty')
    .refine((val) => val.startsWith('xoxb-'), {
      message: 'botToken must start with "xoxb-"',
    }),
  signingSecret: z.string().trim().optional().nullable(),
});

export const CONNECTOR_SCHEMAS: Record<SupportedConnectorType, z.ZodSchema> = {
  postgres: PostgresCredentialSchema,
  slack: SlackCredentialSchema,
};

/**
 * Generates a sanitized, non-sensitive string preview of the credential.
 * Passwords, tokens, and secrets are strictly excluded or masked.
 */
export function generateConnectorPreview(type: string, data: Record<string, any>): string {
  switch (type) {
    case 'postgres': {
      const port = data.port || 5432;
      return `${data.user}@${data.host}:${port}/${data.database}`;
    }
    case 'slack': {
      const token = String(data.botToken || '');
      const last4 = token.length >= 4 ? token.slice(-4) : '••••';
      return `xoxb-••••${last4}`;
    }
    default:
      return `${type} ••••`;
  }
}
