/**
 * Web Crypto AES-GCM Encrypted Vault Utility.
 * Provides zero-plaintext storage for third-party connector credentials.
 */

// Deterministic 32-byte fallback master key used ONLY for local dev/testing environments
export const DEFAULT_DEV_VAULT_KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

/**
 * Encodes a Uint8Array into a standard Base64 string.
 */
function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Decodes a Base64 string into a Uint8Array.
 */
function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Generates a fresh random 256-bit Base64-encoded AES-GCM master key.
 */
export function generateVaultMasterKey(): string {
  const keyBytes = crypto.getRandomValues(new Uint8Array(32));
  return uint8ArrayToBase64(keyBytes);
}

/**
 * Imports a raw 256-bit AES-GCM CryptoKey from Base64 string.
 */
async function importVaultKey(keyB64: string, usage: 'encrypt' | 'decrypt'): Promise<CryptoKey> {
  const rawBytes = base64ToUint8Array(keyB64 || DEFAULT_DEV_VAULT_KEY);
  if (rawBytes.byteLength !== 32) {
    throw new Error(`Invalid vault master key length: expected 32 bytes (256-bit), got ${rawBytes.byteLength}`);
  }
  return crypto.subtle.importKey(
    'raw',
    rawBytes,
    { name: 'AES-GCM' },
    false,
    [usage]
  );
}

/**
 * Encrypts a plaintext string using AES-GCM (12-byte IV).
 * Returns serialized format: `${ivBase64}:${ciphertextBase64}`
 */
export async function encryptVaultPayload(plaintext: string, masterKeyB64?: string): Promise<string> {
  const key = await importVaultKey(masterKeyB64 || DEFAULT_DEV_VAULT_KEY, 'encrypt');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encodedPlaintext = new TextEncoder().encode(plaintext);

  const cipherBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encodedPlaintext
  );

  const ivB64 = uint8ArrayToBase64(iv);
  const cipherB64 = uint8ArrayToBase64(new Uint8Array(cipherBuffer));

  return `${ivB64}:${cipherB64}`;
}

/**
 * Decrypts an encrypted payload formatted as `${ivBase64}:${ciphertextBase64}`.
 */
export async function decryptVaultPayload(encryptedPayload: string, masterKeyB64?: string): Promise<string> {
  if (!encryptedPayload || !encryptedPayload.includes(':')) {
    throw new Error('Invalid encrypted payload format: expected "iv:ciphertext"');
  }

  const [ivB64, cipherB64] = encryptedPayload.split(':');
  if (!ivB64 || !cipherB64) {
    throw new Error('Invalid encrypted payload components');
  }

  const key = await importVaultKey(masterKeyB64 || DEFAULT_DEV_VAULT_KEY, 'decrypt');
  const iv = base64ToUint8Array(ivB64);
  const cipherBytes = base64ToUint8Array(cipherB64);

  const plainBuffer = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    cipherBytes
  );

  return new TextDecoder().decode(plainBuffer);
}
