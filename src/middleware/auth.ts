import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import { getSupabaseClient } from '../services/supabase';
import { AUTH_CONSTANTS } from '../constants';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AuthUser {
  id: string;
  email?: string;
  [key: string]: any;
}

// Extend Hono's context Variables type
declare module 'hono' {
  interface ContextVariableMap {
    user: AuthUser;
  }
}

// ─── Supabase Bearer-token guard ──────────────────────────────────────────────
//
// Extracts the Bearer token from Authorization header, calls
// supabase.auth.getUser() to verify it, and stores the user on context.
// Equivalent to the NestJS SupabaseAuthGuard.

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

  const { data, error } = await getSupabaseClient().auth.getUser(token);

  if (error || !data.user) {
    throw new HTTPException(401, {
      message: error?.message || 'Invalid or expired access token',
    });
  }

  c.set('user', data.user as AuthUser);
  await next();
});
