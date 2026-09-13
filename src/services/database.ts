import { Client, QueryResult, QueryResultRow } from 'pg';
import { DATABASE_CONSTANTS } from '../constants';

// ─── pg Client ────────────────────────────────────────────────────────────────
//
// We DO NOT use pg.Pool in Cloudflare Workers. 
// Cloudflare Workers suspend execution between requests, which breaks background 
// timers and socket keep-alives used by pg.Pool, resulting in 1101 Uncaught Exceptions.
// Instead, Hyperdrive acts as our connection pool at the edge. We simply instantiate 
// a new pg.Client, connect, query, and close it for every single database operation.

export async function query<T extends QueryResultRow = any>(
  sqlText: string,
  params: any[] = [],
): Promise<QueryResult<T>> {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      'DATABASE_URL is not configured. Set it in .dev.vars (local) or via Hyperdrive binding (Worker).',
    );
  }

  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  try {
    return await client.query<T>(sqlText, params);
  } finally {
    // Hyperdrive intercepts this and releases the connection back to its local pool
    // immediately without network overhead.
    await client.end();
  }
}

export async function getCurrentTime(): Promise<string> {
  const result = await query<{ current_time: string }>(
    DATABASE_CONSTANTS.NOW_QUERY,
  );
  return result.rows[0]?.current_time;
}
