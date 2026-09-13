import { createApp } from './app';
import { resetSupabaseClient } from './services/supabase';

// ─── Types ────────────────────────────────────────────────────────────────────

interface CloudflareEnv {
  HYPERDRIVE?: { connectionString: string };
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  ENVIRONMENT?: string;
}

// ─── App singleton ────────────────────────────────────────────────────────────
// Hono is created once per isolate; it's cheap and stateless.
const app = createApp();

// ─── CF Worker entry point ────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: CloudflareEnv, ctx: ExecutionContext): Promise<Response> {
    // Inject Cloudflare bindings into process.env so services can read them
    // without any platform-specific imports. Must happen before any request
    // handler runs (services read from process.env lazily on first call).
    if (env?.HYPERDRIVE?.connectionString) {
      process.env.DATABASE_URL = env.HYPERDRIVE.connectionString;
      process.env.DATABASE_CONNECTION_SOURCE = 'hyperdrive';
    }
    if (env?.SUPABASE_URL) {
      // If the URL changed (shouldn't happen in prod, but resets in dev),
      // reset the Supabase singleton so it picks up the new value.
      if (process.env.SUPABASE_URL !== env.SUPABASE_URL) {
        resetSupabaseClient();
      }
      process.env.SUPABASE_URL = env.SUPABASE_URL;
    }
    if (env?.SUPABASE_SERVICE_ROLE_KEY) {
      process.env.SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
    }
    if (env?.ENVIRONMENT) {
      process.env.ENVIRONMENT = env.ENVIRONMENT;
    }

    return app.fetch(request, env, ctx);
  },
};
