import { describe, expect, it } from 'vitest';
import { validateSchemaConsistency } from '../../src/utils/schemaValidation';

describe('validateSchemaConsistency', () => {
  it('validates matching schema properties and code parameters', () => {
    const code = 'const { city, units } = args; return city;';
    const schema = {
      properties: {
        city: { type: 'string', description: 'Target city' },
        units: { type: 'string', description: 'Temperature units' },
      },
    };
    const result = validateSchemaConsistency(code, schema);
    expect(result.valid).toBe(true);
  });

  it('fails if a property is missing type or description', () => {
    const code = 'const { city } = args;';
    const schemaWithoutType = {
      properties: {
        city: { description: 'Target city' },
      },
    };
    expect(validateSchemaConsistency(code, schemaWithoutType).valid).toBe(false);

    const schemaWithoutDesc = {
      properties: {
        city: { type: 'string', description: '  ' },
      },
    };
    expect(validateSchemaConsistency(code, schemaWithoutDesc).valid).toBe(false);
  });

  it('fails if documented param is not read in code', () => {
    const code = 'const { city } = args;';
    const schema = {
      properties: {
        city: { type: 'string', description: 'City' },
        country: { type: 'string', description: 'Country' },
      },
    };
    const result = validateSchemaConsistency(code, schema);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('@param country documented but not read in function body');
  });

  it('safely handles regex special characters in property names without throwing SyntaxError', () => {
    const code = 'const val = args["$cost+tax"];';
    const schema = {
      properties: {
        '$cost+tax': { type: 'number', description: 'Cost with tax' },
      },
    };
    // Should not throw SyntaxError
    expect(() => validateSchemaConsistency(code, schema)).not.toThrow();
  });
});
