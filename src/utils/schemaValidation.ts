/**
 * Validates that the parsed schema matches the expected parameters in the code.
 */
export function validateSchemaConsistency(code: string, schemaJson: any): { valid: boolean; error?: string } {
  if (!schemaJson || typeof schemaJson !== 'object') {
    return { valid: false, error: 'schema_json is missing or invalid' };
  }

  const properties = schemaJson.properties || {};
  
  // 1. Ensure all schema properties have a type and description
  for (const [key, prop] of Object.entries<any>(properties)) {
    if (!prop.type) {
      return { valid: false, error: `@param ${key} documented but missing a type` };
    }
    if (!prop.description || prop.description.trim() === '') {
      return { valid: false, error: `@param ${key} documented but missing a description` };
    }
  }

  // 2. Check if the code actually reads the documented parameters
  for (const key of Object.keys(properties)) {
    const paramRegex = new RegExp(`\\b${key}\\b`);
    if (!paramRegex.test(code)) {
      return { valid: false, error: `@param ${key} documented but not read in function body` };
    }
  }

  return { valid: true };
}
