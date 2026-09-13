import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const pgMocks = vi.hoisted(() => ({
  construct: vi.fn(),
  connect: vi.fn(),
  query: vi.fn(),
  end: vi.fn(),
}));

vi.mock('pg', () => ({
  Client: class MockClient {
    constructor(options: unknown) {
      pgMocks.construct(options);
    }

    connect = pgMocks.connect;
    query = pgMocks.query;
    end = pgMocks.end;
  },
}));

import { getCurrentTime, query } from '../../src/services/database';

describe('database service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.DATABASE_URL;
    delete process.env.DATABASE_CONNECTION_SOURCE;
    pgMocks.connect.mockResolvedValue(undefined);
    pgMocks.end.mockResolvedValue(undefined);
  });

  afterEach(() => {
    delete process.env.DATABASE_URL;
    delete process.env.DATABASE_CONNECTION_SOURCE;
  });

  it('fails before constructing a client when DATABASE_URL is missing', async () => {
    await expect(query('SELECT 1')).rejects.toThrow('DATABASE_URL is not configured');
    expect(pgMocks.construct).not.toHaveBeenCalled();
  });

  it('connects, forwards query parameters, and closes the client', async () => {
    process.env.DATABASE_URL = 'postgres://local/test';
    const result = { rows: [{ id: 7 }], rowCount: 1 };
    pgMocks.query.mockResolvedValue(result);

    await expect(query('SELECT * FROM profiles WHERE id = $1', ['7'])).resolves.toBe(result);

    expect(pgMocks.construct).toHaveBeenCalledWith({
      connectionString: 'postgres://local/test',
      ssl: { rejectUnauthorized: true },
      connectionTimeoutMillis: 5000,
      query_timeout: 5000,
      statement_timeout: 5000,
    });
    expect(pgMocks.connect).toHaveBeenCalledOnce();
    expect(pgMocks.query).toHaveBeenCalledWith('SELECT * FROM profiles WHERE id = $1', ['7']);
    expect(pgMocks.end).toHaveBeenCalledOnce();
  });

  it('lets Hyperdrive supply its own connection settings', async () => {
    process.env.DATABASE_URL = 'postgres://hyperdrive/test';
    process.env.DATABASE_CONNECTION_SOURCE = 'hyperdrive';
    pgMocks.query.mockResolvedValue({ rows: [] });

    await query('SELECT 1');

    expect(pgMocks.construct).toHaveBeenCalledWith({
      connectionString: 'postgres://hyperdrive/test',
      connectionTimeoutMillis: 5000,
      query_timeout: 5000,
      statement_timeout: 5000,
    });
  });

  it('uses an empty parameter list by default', async () => {
    process.env.DATABASE_URL = 'postgres://local/test';
    pgMocks.query.mockResolvedValue({ rows: [] });

    await query('SELECT 1');

    expect(pgMocks.query).toHaveBeenCalledWith('SELECT 1', []);
  });

  it('closes the client when the query rejects', async () => {
    process.env.DATABASE_URL = 'postgres://local/test';
    pgMocks.query.mockRejectedValue(new Error('query failed'));

    await expect(query('BROKEN SQL')).rejects.toThrow('query failed');
    expect(pgMocks.end).toHaveBeenCalledOnce();
  });

  it('returns the timestamp from the database time query', async () => {
    process.env.DATABASE_URL = 'postgres://local/test';
    pgMocks.query.mockResolvedValue({ rows: [{ current_time: '2026-09-13T20:00:00.000Z' }] });

    await expect(getCurrentTime()).resolves.toBe('2026-09-13T20:00:00.000Z');
    expect(pgMocks.query).toHaveBeenCalledWith('SELECT NOW() as current_time', []);
  });

  it('returns undefined when the time query has no rows', async () => {
    process.env.DATABASE_URL = 'postgres://local/test';
    pgMocks.query.mockResolvedValue({ rows: [] });

    await expect(getCurrentTime()).resolves.toBeUndefined();
  });
});
