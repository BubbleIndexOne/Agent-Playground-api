import { describe, expect, it } from 'vitest';
import {
  CreateToolSchema,
  UpdateToolSchema,
  CreateToolVersionSchema,
} from '../../src/schemas/tools';

describe('tools validation schemas', () => {
  describe('CreateToolSchema', () => {
    it('accepts valid client tool input without connector_type', () => {
      const result = CreateToolSchema.safeParse({
        name: 'Web Scraper',
        description: 'Scrapes web pages',
        type: 'client',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.is_public).toBe(false);
        expect(result.data.allow_client_execution).toBe(false);
      }
    });

    it('accepts valid mcp tool input with connector_type', () => {
      const result = CreateToolSchema.safeParse({
        name: 'GitHub Connector',
        type: 'mcp',
        connector_type: 'github',
        is_public: true,
      });
      expect(result.success).toBe(true);
    });

    it('rejects mcp tool without connector_type', () => {
      const result = CreateToolSchema.safeParse({
        name: 'GitHub Connector',
        type: 'mcp',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors.map((e) => e.message)).toContain(
          'connector_type is required when type is "mcp"',
        );
      }
    });

    it('rejects client tool with non-empty connector_type', () => {
      const result = CreateToolSchema.safeParse({
        name: 'Python Runner',
        type: 'client',
        connector_type: 'custom_connector',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors.map((e) => e.message)).toContain(
          'connector_type must be empty or null when type is "client"',
        );
      }
    });

    it('rejects empty or missing tool name', () => {
      const result = CreateToolSchema.safeParse({
        name: '   ',
        type: 'client',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors.map((e) => e.message)).toContain(
          'name must not be empty',
        );
      }
    });
  });

  describe('UpdateToolSchema', () => {
    it('accepts partial metadata updates', () => {
      const result = UpdateToolSchema.safeParse({
        name: 'Updated Name',
        is_public: true,
        status: 'verified',
      });
      expect(result.success).toBe(true);
    });

    it('rejects invalid status values', () => {
      const result = UpdateToolSchema.safeParse({
        status: 'unknown_status',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('CreateToolVersionSchema', () => {
    it('accepts valid version payload with schema_json', () => {
      const result = CreateToolVersionSchema.safeParse({
        code: 'export default () => {}',
        schema_json: { type: 'object', properties: { url: { type: 'string' } } },
        capabilities_json: ['network_read'],
      });
      expect(result.success).toBe(true);
    });

    it('rejects version payload missing schema_json', () => {
      const result = CreateToolVersionSchema.safeParse({
        code: 'console.log()',
      });
      expect(result.success).toBe(false);
    });
  });
});
