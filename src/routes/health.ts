import { Hono } from 'hono';
import { getCurrentTime } from '../services/database';
import { HEALTH_CONSTANTS } from '../constants';

// ─── Health Router ────────────────────────────────────────────────────────────

export const healthRouter = new Hono();

/** Check database connectivity and return status, timestamp, and latency details. */
async function checkDb() {
  const start = Date.now();
  try {
    const currentTime = await getCurrentTime();
    return {
      environment: process.env.ENVIRONMENT || 'worker',
      status: HEALTH_CONSTANTS.STATUS_CONNECTED,
      currentTime,
      latencyMs: Date.now() - start,
    };
  } catch (err: any) {
    console.error('[Health] Database check failed', err);
    return {
      environment: process.env.ENVIRONMENT || 'worker',
      status: HEALTH_CONSTANTS.STATUS_UNAVAILABLE,
      currentTime: HEALTH_CONSTANTS.STATUS_UNAVAILABLE,
      latencyMs: Date.now() - start,
    };
  }
}

// GET /health
healthRouter.get('/', async (c) => {
  const detail = await checkDb();
  const overallStatus =
    detail.status === HEALTH_CONSTANTS.STATUS_CONNECTED
      ? HEALTH_CONSTANTS.STATUS_OK
      : HEALTH_CONSTANTS.STATUS_UNAVAILABLE;

  return c.json({
    status: overallStatus,
    timestamp: new Date().toISOString(),
    databases: [detail],
  });
});

// GET /health/db
healthRouter.get('/db', async (c) => {
  return c.json(await checkDb());
});
