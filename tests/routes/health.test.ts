import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

const databaseMocks = vi.hoisted(() => ({ getCurrentTime: vi.fn() }));

vi.mock('../../src/services/database', () => ({
  getCurrentTime: databaseMocks.getCurrentTime,
}));

import { healthRouter } from '../../src/routes/health';

describe('health routes', () => {
  const app = new Hono().route('/health', healthRouter);

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-13T20:00:00.000Z'));
    delete process.env.ENVIRONMENT;
    databaseMocks.getCurrentTime.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.ENVIRONMENT;
  });

  it('reports aggregate service and database health', async () => {
    process.env.ENVIRONMENT = 'test';
    databaseMocks.getCurrentTime.mockImplementation(async () => {
      vi.setSystemTime(new Date('2026-09-13T20:00:00.012Z'));
      return '2026-09-13T19:59:59.000Z';
    });

    const response = await app.request('/health');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: 'ok',
      timestamp: '2026-09-13T20:00:00.012Z',
      databases: [{
        environment: 'test',
        status: 'connected',
        currentTime: '2026-09-13T19:59:59.000Z',
        latencyMs: 12,
      }],
    });
  });

  it('reports database connectivity directly and defaults the environment to worker', async () => {
    databaseMocks.getCurrentTime.mockResolvedValue('2026-09-13T20:00:00.000Z');

    const response = await app.request('/health/db');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      environment: 'worker',
      status: 'connected',
      currentTime: '2026-09-13T20:00:00.000Z',
      latencyMs: 0,
    });
  });

  it('keeps the endpoint responsive when the database check fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const databaseError = new Error('connection refused');
    databaseMocks.getCurrentTime.mockImplementation(async () => {
      vi.setSystemTime(new Date('2026-09-13T20:00:00.025Z'));
      throw databaseError;
    });

    const response = await app.request('/health/db');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      environment: 'worker',
      status: 'unavailable',
      currentTime: 'unavailable',
      latencyMs: 25,
    });
    expect(consoleError).toHaveBeenCalledWith('[Health] Database check failed', databaseError);
    consoleError.mockRestore();
  });
});
