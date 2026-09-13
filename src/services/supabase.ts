import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CONSTANTS } from '../constants';

// ─── Supabase client factory ──────────────────────────────────────────────────
//
// Creates a single SupabaseClient per Worker isolate lifetime using the
// service-role key (admin access). Env vars are injected by worker.ts before
// any route handler runs.

let _client: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (_client) return _client;

  const url = process.env.SUPABASE_URL || SUPABASE_CONSTANTS.FALLBACK_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    SUPABASE_CONSTANTS.FALLBACK_SERVICE_ROLE_KEY;

  _client = createClient(url, key, SUPABASE_CONSTANTS.CLIENT_CONFIG);
  return _client;
}

/** Reset the singleton (used when env vars change between requests in dev). */
export function resetSupabaseClient(): void {
  _client = null;
}
