import { describe, expect, it } from 'vitest';
import { computeCodeHash } from '../../src/utils/crypto';

describe('computeCodeHash', () => {
  it('computes expected SHA-256 hex string for empty string', async () => {
    // SHA-256 of empty string is well-known: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
    const hash = await computeCodeHash('');
    expect(hash).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('computes consistent 64-character lowercase hex hash for JavaScript code', async () => {
    const code = 'export default function hello() { return "world"; }';
    const hash1 = await computeCodeHash(code);
    const hash2 = await computeCodeHash(code);

    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[a-f0-9]{64}$/);
  });

  it('generates distinct hashes for different code strings', async () => {
    const hashA = await computeCodeHash('console.log("a");');
    const hashB = await computeCodeHash('console.log("b");');

    expect(hashA).not.toBe(hashB);
  });
});
