import { SignJWT, jwtVerify } from 'jose';
import { JWT_CONSTANTS } from '../constants';

// ─── JWT Service ──────────────────────────────────────────────────────────────
//
// Uses the Web Crypto API via `jose` — works natively in Cloudflare Workers
// without any Node.js polyfills.
//
// Access tokens: short-lived HS256 JWTs (15 min). Verified locally — no DB hit.
// Refresh tokens: opaque random hex strings stored in the DB refresh_tokens
// table. Not JWTs — this allows server-side revocation.

// ─── Key materialisation ──────────────────────────────────────────────────────

function getSecretKey(): Uint8Array {
  const raw = process.env.SECRET_KEY;
  if (!raw) {
    throw new Error(
      'SECRET_KEY is not configured. ' +
        'Set it via `wrangler secret put SECRET_KEY` (deployed) or in .dev.vars (local).',
    );
  }
  return new TextEncoder().encode(raw);
}

// ─── Access token ─────────────────────────────────────────────────────────────

export interface AccessTokenPayload {
  sub: string;  // user UUID
  email: string;
}

/**
 * Sign a short-lived access token (HS256).
 * Expiry: JWT_CONSTANTS.ACCESS_TOKEN_TTL (default 15 minutes).
 */
export async function signAccessToken(userId: string, email: string): Promise<string> {
  return new SignJWT({ email })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(JWT_CONSTANTS.ACCESS_TOKEN_TTL)
    .sign(getSecretKey());
}

/**
 * Verify and decode an access token.
 * Throws if the token is invalid or expired.
 */
export async function verifyAccessToken(token: string): Promise<AccessTokenPayload> {
  const { payload } = await jwtVerify(token, getSecretKey(), {
    algorithms: ['HS256'],
  });

  const sub = payload.sub;
  const email = payload['email'];

  if (typeof sub !== 'string' || typeof email !== 'string') {
    throw new Error('Malformed access token payload');
  }

  return { sub, email };
}

// ─── Refresh token ────────────────────────────────────────────────────────────

/**
 * Generate a cryptographically random opaque refresh token string.
 * The token is stored in the refresh_tokens table — not a JWT.
 */
export function generateRefreshToken(): string {
  const bytes = new Uint8Array(48);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
