import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import { verifyAccessToken } from '../services/jwt';
import { AUTH_CONSTANTS } from '../constants';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AuthUser {
  id: string;
  email: string;
}

// Extend Hono's context Variables type
declare module 'hono' {
  interface ContextVariableMap {
    user: AuthUser;
  }
}

// ─── JWT Bearer-token guard ───────────────────────────────────────────────────
//
// Extracts the Bearer token from the Authorization header, verifies it locally
// using the SECRET_KEY (HS256) — zero network calls. Stores the decoded user
// on the Hono context for downstream handlers.

export const requireAuth = createMiddleware(async (c, next) => {
  const authHeader = c.req.header('Authorization');

  if (!authHeader) {
    throw new HTTPException(401, { message: 'Authorization header is missing' });
  }

  const [scheme, token] = authHeader.split(' ');
  if (scheme !== 'Bearer' || !token) {
    throw new HTTPException(401, {
      message: `Invalid authorization header format. Expected ${AUTH_CONSTANTS.BEARER_AUTH_HEADER_PREFIX}<token>`,
    });
  }

  try {
    const payload = await verifyAccessToken(token);
    c.set('user', { id: payload.sub, email: payload.email });
  } catch {
    throw new HTTPException(401, { message: 'Invalid or expired access token' });
  }

  await next();
});
