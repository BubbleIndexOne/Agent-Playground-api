import { describe, expect, it } from 'vitest';
import {
  PostgresCredentialSchema,
  SlackCredentialSchema,
  generateConnectorPreview,
  SUPPORTED_CONNECTOR_TYPES,
} from '../../src/schemas/connectors';

describe('Connector Schemas & Preview Generation', () => {
  describe('PostgresCredentialSchema', () => {
    it('accepts valid postgres configuration and applies defaults', () => {
      const valid = {
        host: 'pg.internal.io',
        database: 'analytics',
        user: 'service_agent',
        password: 'db-secret-password',
      };
      const parsed = PostgresCredentialSchema.parse(valid);
      expect(parsed.port).toBe(5432);
      expect(parsed.ssl).toBe(true);
      expect(parsed.host).toBe('pg.internal.io');
    });

    it('rejects missing or empty required fields', () => {
      expect(() =>
        PostgresCredentialSchema.parse({
          host: '',
          database: 'db',
          user: 'u',
          password: 'p',
        }),
      ).toThrow();
    });
  });

  describe('SlackCredentialSchema', () => {
    it('accepts valid xoxb bot token', () => {
      const valid = { botToken: 'xoxb-1234567890-abcdefgh' };
      const parsed = SlackCredentialSchema.parse(valid);
      expect(parsed.botToken).toBe('xoxb-1234567890-abcdefgh');
    });

    it('rejects tokens that do not start with xoxb-', () => {
      expect(() =>
        SlackCredentialSchema.parse({ botToken: 'xoxp-user-token-not-allowed' }),
      ).toThrow(/must start with.*xoxb-/i);
    });
  });

  describe('generateConnectorPreview', () => {
    it('generates non-sensitive preview for postgres without password', () => {
      const data = {
        host: 'db.example.com',
        port: 5432,
        database: 'production',
        user: 'db_admin',
        password: 'superSecretPassword!',
      };
      const preview = generateConnectorPreview('postgres', data);
      expect(preview).toBe('db_admin@db.example.com:5432/production');
      expect(preview).not.toContain('superSecretPassword');
    });

    it('generates masked preview for slack botToken showing only the last 4 characters', () => {
      const data = { botToken: 'xoxb-9988776655-abcd' };
      const preview = generateConnectorPreview('slack', data);
      expect(preview).toBe('xoxb-••••abcd');
      expect(preview).not.toContain('9988776655');
    });
  });
});
