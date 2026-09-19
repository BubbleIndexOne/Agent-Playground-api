import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const workerMocks = vi.hoisted(() => {
  const appFetch = vi.fn();
  return {
    appFetch,
    createApp: vi.fn(() => ({ fetch: appFetch })),
  };
});

vi.mock('../src/app', () => ({
  createApp: workerMocks.createApp,
}));

import worker from '../src/worker';

const ENV_KEYS = [
  'DATABASE_URL',
  'DATABASE_CONNECTION_SOURCE',
  'SECRET_KEY',
  'ENVIRONMENT',
  'ADMIN_SECRET_KEY',
] as const;

describe('Cloudflare Worker entry point', () => {
  beforeEach(() => {
    workerMocks.appFetch.mockReset();
    for (const key of ENV_KEYS) delete process.env[key];
    workerMocks.appFetch.mockResolvedValue(new Response('ok', { status: 202 }));
  });

  afterEach(() => {
    for (const key of ENV_KEYS) delete process.env[key];
  });

  it('creates the Hono application once when the module loads', () => {
    expect(workerMocks.createApp).toHaveBeenCalledOnce();
  });

  it('injects Worker bindings and forwards the request', async () => {
    const request = new Request('https://worker.example/health');
    const env = {
      HYPERDRIVE: { connectionString: 'postgres://hyperdrive/test' },
      SECRET_KEY: 'supersecret-key-for-test',
      ENVIRONMENT: 'preview',
      ADMIN_SECRET_KEY: 'admin-key-test',
    };
    const ctx = { waitUntil: vi.fn() } as any;

    const response = await worker.fetch(request, env, ctx);

    expect(response.status).toBe(202);
    expect(process.env.DATABASE_URL).toBe('postgres://hyperdrive/test');
    expect(process.env.DATABASE_CONNECTION_SOURCE).toBe('hyperdrive');
    expect(process.env.SECRET_KEY).toBe('supersecret-key-for-test');
    expect(process.env.ENVIRONMENT).toBe('preview');
    expect(process.env.ADMIN_SECRET_KEY).toBe('admin-key-test');
    expect(workerMocks.appFetch).toHaveBeenCalledWith(request, env, ctx);
  });

  it('preserves existing process configuration when optional bindings are absent', async () => {
    process.env.DATABASE_URL = 'postgres://existing/test';
    process.env.DATABASE_CONNECTION_SOURCE = 'direct';
    process.env.SECRET_KEY = 'existing-secret';
    process.env.ENVIRONMENT = 'existing';

    await worker.fetch(new Request('https://worker.example/health'), {}, {} as any);

    expect(process.env.DATABASE_URL).toBe('postgres://existing/test');
    expect(process.env.DATABASE_CONNECTION_SOURCE).toBe('direct');
    expect(process.env.SECRET_KEY).toBe('existing-secret');
    expect(process.env.ENVIRONMENT).toBe('existing');
  });

  it('does not inject DATABASE_URL when HYPERDRIVE binding is absent', async () => {
    await worker.fetch(
      new Request('https://worker.example/health'),
      { SECRET_KEY: 'test-key' },
      {} as any,
    );

    expect(process.env.DATABASE_URL).toBeUndefined();
    expect(process.env.DATABASE_CONNECTION_SOURCE).toBeUndefined();
  });
});
