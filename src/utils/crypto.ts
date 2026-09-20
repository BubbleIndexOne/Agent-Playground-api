/**
 * Computes a standard hex-encoded SHA-256 hash from a UTF-8 code string.
 *
 * Uses the native Web Crypto API (crypto.subtle), fully supported across
 * Cloudflare Workers and modern Node.js runtimes.
 */
export async function computeCodeHash(code: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(code);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}
