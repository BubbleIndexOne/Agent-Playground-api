import { describe, expect, it } from 'vitest';
import {
  encryptVaultPayload,
  decryptVaultPayload,
  generateVaultMasterKey,
  DEFAULT_DEV_VAULT_KEY,
} from '../../src/utils/vault';

describe('Vault Crypto Utility (AES-GCM)', () => {
  it('generates a valid 32-byte (256-bit) base64 master key', () => {
    const key = generateVaultMasterKey();
    expect(typeof key).toBe('string');
    const bytes = atob(key);
    expect(bytes.length).toBe(32);
  });

  it('successfully encrypts and decrypts a plaintext payload round-trip', async () => {
    const key = generateVaultMasterKey();
    const secretData = JSON.stringify({
      host: 'db.example.internal',
      port: 5432,
      database: 'prod_db',
      user: 'admin',
      password: 'superSecretPassword!#123',
    });

    const encrypted = await encryptVaultPayload(secretData, key);
    expect(encrypted).toContain(':');
    expect(encrypted).not.toContain('superSecretPassword');

    const decrypted = await decryptVaultPayload(encrypted, key);
    expect(decrypted).toBe(secretData);
    const parsed = JSON.parse(decrypted);
    expect(parsed.password).toBe('superSecretPassword!#123');
  });

  it('works seamlessly with the default dev key when key is omitted', async () => {
    const payload = 'test-token-xoxb-123456';
    const encrypted = await encryptVaultPayload(payload);
    const decrypted = await decryptVaultPayload(encrypted);
    expect(decrypted).toBe(payload);
  });

  it('fails to decrypt if an incorrect master key is supplied', async () => {
    const key1 = generateVaultMasterKey();
    const key2 = generateVaultMasterKey();
    const encrypted = await encryptVaultPayload('top-secret', key1);

    await expect(decryptVaultPayload(encrypted, key2)).rejects.toThrow();
  });

  it('fails to decrypt if the ciphertext has been tampered with', async () => {
    const key = generateVaultMasterKey();
    const encrypted = await encryptVaultPayload('confidential', key);
    const [iv, cipher] = encrypted.split(':');
    
    // Tamper with the last character of ciphertext
    const tamperedCipher = cipher.slice(0, -2) + 'AA';
    const tamperedPayload = `${iv}:${tamperedCipher}`;

    await expect(decryptVaultPayload(tamperedPayload, key)).rejects.toThrow();
  });

  it('rejects invalid key lengths', async () => {
    const invalidKey = btoa('too-short-key');
    await expect(encryptVaultPayload('hello', invalidKey)).rejects.toThrow(/Invalid vault master key length/);
  });
});
