import { Pool, QueryResult, QueryResultRow } from 'pg';
import { DATABASE_CONSTANTS } from '../constants';

// ─── pg Pool singleton ────────────────────────────────────────────────────────
//
// The pool is created lazily on the first query so that the Worker can start
// without a DATABASE_URL if one isn't configured (dev without Hyperdrive).
// worker.ts injects env.HYPERDRIVE.connectionString into process.env.DATABASE_URL
// before any request is handled.

let _pool: Pool | null = null;

function getPool(): Pool {
  if (_pool) return _pool;

  const connectionString =
    process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      'DATABASE_URL is not configured. Set it in .dev.vars (local) or via Hyperdrive binding (Worker).',
    );
  }

  _pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
    max: DATABASE_CONSTANTS.DEFAULT_MAX_POOL_CONNECTIONS,
    idleTimeoutMillis: DATABASE_CONSTANTS.DEFAULT_IDLE_TIMEOUT_MS,
    connectionTimeoutMillis: DATABASE_CONSTANTS.DEFAULT_CONNECTION_TIMEOUT_MS,
  });

  return _pool;
}

export async function query<T extends QueryResultRow = any>(
  sqlText: string,
  params: any[] = [],
): Promise<QueryResult<T>> {
  return getPool().query<T>(sqlText, params);
}

export async function getCurrentTime(): Promise<string> {
  const result = await query<{ current_time: string }>(
    DATABASE_CONSTANTS.NOW_QUERY,
  );
  return result.rows[0]?.current_time;
}
