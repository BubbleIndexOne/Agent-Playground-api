import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const workerMocks = vi.hoisted(() => {
  const appFetch = vi.fn();
  return {
    appFetch,
    createApp: vi.fn(() => ({ fetch: appFetch })),
    resetSupabaseClient: vi.fn(),
  };
});

vi.mock('../src/app', () => ({
  createApp: workerMocks.createApp,
}));

vi.mock('../src/services/supabase', () => ({
  resetSupabaseClient: workerMocks.resetSupabaseClient,
}));

import worker from '../src/worker';

const ENV_KEYS = [
  'DATABASE_URL',
  'DATABASE_CONNECTION_SOURCE',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'ENVIRONMENT',
] as const;

describe('Cloudflare Worker entry point', () => {
  beforeEach(() => {
    workerMocks.appFetch.mockReset();
    workerMocks.resetSupabaseClient.mockReset();
    for (const key of ENV_KEYS) delete process.env[key];
    workerMocks.appFetch.mockResolvedValue(new Response('ok', { status: 202 }));
  });

  afterEach(() => {
    for (const key of ENV_KEYS) delete process.env[key];
  });

  it('creates the Hono application once when the module loads', () => {
    expect(workerMocks.createApp).toHaveBeenCalledOnce();
  });

  it('injects Worker bindings, resets a changed Supabase client, and forwards the request', async () => {
    const request = new Request('https://worker.example/health');
    const env = {
      HYPERDRIVE: { connectionString: 'postgres://hyperdrive/test' },
      SUPABASE_URL: 'https://project.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
      ENVIRONMENT: 'preview',
    };
    const ctx = { waitUntil: vi.fn() } as any;

    const response = await worker.fetch(request, env, ctx);

    expect(response.status).toBe(202);
    expect(process.env.DATABASE_URL).toBe('postgres://hyperdrive/test');
    expect(process.env.DATABASE_CONNECTION_SOURCE).toBe('hyperdrive');
    expect(process.env.SUPABASE_URL).toBe('https://project.supabase.co');
    expect(process.env.SUPABASE_SERVICE_ROLE_KEY).toBe('service-role-key');
    expect(process.env.ENVIRONMENT).toBe('preview');
    expect(workerMocks.resetSupabaseClient).toHaveBeenCalledOnce();
    expect(workerMocks.appFetch).toHaveBeenCalledWith(request, env, ctx);
  });

  it('does not reset the Supabase singleton when the URL is unchanged', async () => {
    process.env.SUPABASE_URL = 'https://project.supabase.co';

    await worker.fetch(
      new Request('https://worker.example/auth/me'),
      { SUPABASE_URL: 'https://project.supabase.co' },
      {} as any,
    );

    expect(workerMocks.resetSupabaseClient).not.toHaveBeenCalled();
  });

  it('preserves existing process configuration when optional bindings are absent', async () => {
    process.env.DATABASE_URL = 'postgres://existing/test';
    process.env.DATABASE_CONNECTION_SOURCE = 'direct';
    process.env.SUPABASE_URL = 'https://existing.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'existing-key';
    process.env.ENVIRONMENT = 'existing';

    await worker.fetch(new Request('https://worker.example/health'), {}, {} as any);

    expect(process.env.DATABASE_URL).toBe('postgres://existing/test');
    expect(process.env.DATABASE_CONNECTION_SOURCE).toBe('direct');
    expect(process.env.SUPABASE_URL).toBe('https://existing.supabase.co');
    expect(process.env.SUPABASE_SERVICE_ROLE_KEY).toBe('existing-key');
    expect(process.env.ENVIRONMENT).toBe('existing');
    expect(workerMocks.resetSupabaseClient).not.toHaveBeenCalled();
  });
});
