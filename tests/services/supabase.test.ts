import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const supabaseMocks = vi.hoisted(() => ({ createClient: vi.fn() }));

vi.mock('@supabase/supabase-js', () => ({ createClient: supabaseMocks.createClient }));

import { SUPABASE_CONSTANTS } from '../../src/constants';
import { getSupabaseClient, resetSupabaseClient } from '../../src/services/supabase';

describe('Supabase client service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSupabaseClient();
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  afterEach(() => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  it('creates a client from configured environment values', () => {
    process.env.SUPABASE_URL = 'https://project.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
    const client = { name: 'configured-client' };
    supabaseMocks.createClient.mockReturnValue(client);

    expect(getSupabaseClient()).toBe(client);
    expect(supabaseMocks.createClient).toHaveBeenCalledWith(
      'https://project.supabase.co',
      'service-role-key',
      SUPABASE_CONSTANTS.CLIENT_CONFIG,
    );
  });

  it('uses safe placeholder values when configuration is absent', () => {
    supabaseMocks.createClient.mockReturnValue({});

    getSupabaseClient();

    expect(supabaseMocks.createClient).toHaveBeenCalledWith(
      SUPABASE_CONSTANTS.FALLBACK_URL,
      SUPABASE_CONSTANTS.FALLBACK_SERVICE_ROLE_KEY,
      SUPABASE_CONSTANTS.CLIENT_CONFIG,
    );
  });

  it('reuses one client for the lifetime of the isolate', () => {
    const client = { name: 'singleton' };
    supabaseMocks.createClient.mockReturnValue(client);

    expect(getSupabaseClient()).toBe(client);
    expect(getSupabaseClient()).toBe(client);
    expect(supabaseMocks.createClient).toHaveBeenCalledOnce();
  });

  it('creates a fresh client after reset', () => {
    const firstClient = { name: 'first' };
    const secondClient = { name: 'second' };
    supabaseMocks.createClient.mockReturnValueOnce(firstClient).mockReturnValueOnce(secondClient);

    expect(getSupabaseClient()).toBe(firstClient);
    resetSupabaseClient();
    expect(getSupabaseClient()).toBe(secondClient);
    expect(supabaseMocks.createClient).toHaveBeenCalledTimes(2);
  });
});
