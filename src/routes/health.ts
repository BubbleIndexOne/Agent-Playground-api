import { Hono } from 'hono';
import { getCurrentTime } from '../services/database';
import { HEALTH_CONSTANTS } from '../constants';

// ─── Health Router ────────────────────────────────────────────────────────────

export const healthRouter = new Hono();

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
    return {
      environment: process.env.ENVIRONMENT || 'worker',
      status: `error: ${err.message}`,
      currentTime: HEALTH_CONSTANTS.STATUS_UNAVAILABLE,
      latencyMs: Date.now() - start,
    };
  }
}

// GET /health
healthRouter.get('/', async (c) => {
  const detail = await checkDb();
  return c.json({
    status: HEALTH_CONSTANTS.STATUS_OK,
    timestamp: new Date().toISOString(),
    databases: [detail],
  });
});

// GET /health/db
healthRouter.get('/db', async (c) => {
  return c.json(await checkDb());
});
