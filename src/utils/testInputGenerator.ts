/**
 * Auto-generates dummy input arguments based on a JSON Schema.
 * Used for smoke testing tools when no example inputs are provided.
 */
export function generateTestInputs(schemaJson: any): Record<string, any> {
  const inputs: Record<string, any> = {};
  
  if (!schemaJson || typeof schemaJson !== 'object') {
    return inputs;
  }

  const properties = schemaJson.properties || {};
  
  for (const [key, prop] of Object.entries<any>(properties)) {
    const type = prop.type;
    switch (type) {
      case 'string':
        inputs[key] = 'test';
        break;
      case 'number':
      case 'integer':
        inputs[key] = 0;
        break;
      case 'boolean':
        inputs[key] = true;
        break;
      case 'array':
        inputs[key] = [];
        break;
      case 'object':
        inputs[key] = {};
        break;
      default:
        inputs[key] = 'test';
    }
  }

  return inputs;
}
