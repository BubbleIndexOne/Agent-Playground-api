import type { ExecutionContext } from 'hono';
import { createApp } from './app';

// ─── Types ────────────────────────────────────────────────────────────────────

interface CloudflareEnv {
  HYPERDRIVE?: { connectionString: string };
  SECRET_KEY?: string;
  ENVIRONMENT?: string;
  ADMIN_SECRET_KEY?: string;
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
    if (env?.SECRET_KEY) {
      process.env.SECRET_KEY = env.SECRET_KEY;
    }
    if (env?.ENVIRONMENT) {
      process.env.ENVIRONMENT = env.ENVIRONMENT;
    }
    if (env?.ADMIN_SECRET_KEY) {
      process.env.ADMIN_SECRET_KEY = env.ADMIN_SECRET_KEY;
    }

    return app.fetch(request, env, ctx);
  },
};
