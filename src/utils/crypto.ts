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

/**
 * Compares two strings in constant time to mitigate timing attacks against API keys and secrets.
 * Compares fixed-length 32-byte SHA-256 digests to ensure strict constant-time comparison
 * even when the inputs have different lengths.
 */
export async function timingSafeEqualStrings(a: string, b: string): Promise<boolean> {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }
  const enc = new TextEncoder();
  const [aHash, bHash] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a)),
    crypto.subtle.digest('SHA-256', enc.encode(b)),
  ]);
  const aBuf = new Uint8Array(aHash);
  const bBuf = new Uint8Array(bHash);
  let diff = 0;
  for (let i = 0; i < aBuf.length; i++) {
    diff |= aBuf[i] ^ bBuf[i];
  }
  return diff === 0 && a === b;
}
