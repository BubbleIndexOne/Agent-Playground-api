import { readFileSync } from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';
import { describe, expect, it, vi } from 'vitest';

const scriptPath = fileURLToPath(new URL('../scripts/migrate.js', import.meta.url));
const scriptSource = readFileSync(scriptPath, 'utf8');

class ProcessExit extends Error {
  constructor(readonly code: number) {
    super(`process.exit(${code})`);
  }
}

interface RunOptions {
  env?: Record<string, string>;
  argument?: string;
  files?: string[];
  applied?: string[];
  sql?: Record<string, string>;
  migrationsDirectoryExists?: boolean;
  connectError?: Error;
  queryErrorFor?: string;
}

function startMigration(options: RunOptions = {}) {
  const migrationsDirectoryExists = options.migrationsDirectoryExists ?? true;
  const files = options.files ?? [];
  const sql = options.sql ?? {};
  const migrationsDirectory = path.resolve(path.dirname(scriptPath), '..', 'migrations');

  const fs = {
    existsSync: vi.fn(() => migrationsDirectoryExists),
    readdirSync: vi.fn(() => files),
    readFileSync: vi.fn((filePath: string) => sql[path.basename(filePath)] ?? ''),
  };
  const connect = options.connectError
    ? vi.fn().mockRejectedValue(options.connectError)
    : vi.fn().mockResolvedValue(undefined);
  const end = vi.fn().mockResolvedValue(undefined);
  const query = vi.fn(async (statement: string) => {
    if (statement === 'SELECT name FROM _migrations;') {
      return { rows: (options.applied ?? []).map((name) => ({ name })) };
    }
    if (statement === options.queryErrorFor) {
      throw new Error('database rejected migration');
    }
    return { rows: [] };
  });
  const construct = vi.fn();

  class Client {
    constructor(clientOptions: unknown) {
      construct(clientOptions);
    }

    connect = connect;
    query = query;
    end = end;
  }

  const exit = vi.fn((code: number): never => {
    throw new ProcessExit(code);
  });
  const console = {
    log: vi.fn(),
    error: vi.fn(),
  };

  const completion = vm.runInNewContext(scriptSource, {
    __dirname: path.dirname(scriptPath),
    console,
    process: {
      env: { ...options.env },
      argv: ['node', scriptPath, ...(options.argument ? [options.argument] : [])],
      exit,
    },
    require: (moduleName: string) => {
      if (moduleName === 'fs') return fs;
      if (moduleName === 'path') return path;
      if (moduleName === 'pg') return { Client };
      throw new Error(`Unexpected module: ${moduleName}`);
    },
  });

  return { completion, connect, console, construct, end, exit, fs, migrationsDirectory, query };
}

async function runMigration(options: RunOptions = {}) {
  const run = startMigration(options);
  await run.completion;
  return run;
}

describe('migration runner', () => {
  it.each([
    ['dev by default', {}, undefined, 'postgres://dev', 'postgres://dev'],
    ['production argument', { PROD_DATABASE_URL: 'postgres://prod' }, 'production', undefined, 'postgres://prod'],
    ['TARGET_ENV before the argument', { TARGET_ENV: 'prod', PROD_DATABASE_URL: 'postgres://target' }, 'dev', undefined, 'postgres://target'],
    ['DATABASE_URL before environment-specific URLs', { DATABASE_URL: 'postgres://explicit', PROD_DATABASE_URL: 'postgres://prod' }, 'prod', undefined, 'postgres://explicit'],
  ])('selects the connection URL for %s', async (_name, env, argument, devUrl, expected) => {
    const result = await runMigration({
      env: { ...(devUrl ? { DEV_DATABASE_URL: devUrl } : {}), ...env },
      argument,
      migrationsDirectoryExists: false,
    });

    expect(result.construct).toHaveBeenCalledWith({
      connectionString: expected,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 5000,
      query_timeout: 5000,
      statement_timeout: 5000,
    });
  });

  it('fails before creating a client when no connection URL is configured', async () => {
    const run = startMigration();

    await expect(run.completion).rejects.toMatchObject({ code: 1 });
    expect(run.exit).toHaveBeenCalledWith(1);
    expect(run.construct).not.toHaveBeenCalled();
    expect(run.console.error).toHaveBeenCalledWith(
      'Error: No database connection URL found for environment "dev". Set DATABASE_URL or DEV_DATABASE_URL.',
    );
  });

  it('creates the tracker and closes cleanly when the migrations directory is absent', async () => {
    const result = await runMigration({
      env: { DEV_DATABASE_URL: 'postgres://dev' },
      migrationsDirectoryExists: false,
    });

    expect(result.connect).toHaveBeenCalledOnce();
    expect(result.fs.existsSync).toHaveBeenCalledWith(result.migrationsDirectory);
    expect(result.query).toHaveBeenCalledOnce();
    expect(result.query.mock.calls[0][0]).toContain('CREATE TABLE IF NOT EXISTS _migrations');
    expect(result.end).toHaveBeenCalledOnce();
  });

  it('filters and sorts SQL files, skips applied migrations, and applies each pending migration transactionally', async () => {
    const result = await runMigration({
      env: { DEV_DATABASE_URL: 'postgres://dev' },
      files: ['003_notes.txt', '002_second.sql', '001_first.sql'],
      applied: ['001_first.sql'],
      sql: { '002_second.sql': 'CREATE TABLE second_table (id integer);' },
    });

    expect(result.fs.readFileSync).toHaveBeenCalledOnce();
    expect(result.fs.readFileSync.mock.calls[0][0]).toBe(
      path.join(result.migrationsDirectory, '002_second.sql'),
    );
    expect(result.query.mock.calls.slice(2)).toEqual([
      ['BEGIN'],
      ['CREATE TABLE second_table (id integer);'],
      ['INSERT INTO _migrations (name) VALUES ($1);', ['002_second.sql']],
      ['COMMIT'],
    ]);
    expect(result.end).toHaveBeenCalledOnce();
  });

  it('does not record empty or placeholder migrations as applied', async () => {
    const result = await runMigration({
      env: { DEV_DATABASE_URL: 'postgres://dev' },
      files: ['001_empty.sql', '002_placeholder.sql'],
      sql: {
        '001_empty.sql': ' \n\t ',
        '002_placeholder.sql': '-- schema pasted here manually\n',
      },
    });

    const statements = result.query.mock.calls.map(([statement]) => statement);
    expect(statements).not.toContain('BEGIN');
    expect(statements).not.toContain('INSERT INTO _migrations (name) VALUES ($1);');
    expect(result.fs.readFileSync).toHaveBeenCalledTimes(2);
  });

  it('rolls back a failed migration, exits unsuccessfully, and always closes the client', async () => {
    const run = startMigration({
      env: { DEV_DATABASE_URL: 'postgres://dev' },
      files: ['001_broken.sql'],
      sql: { '001_broken.sql': 'INVALID SQL' },
      queryErrorFor: 'INVALID SQL',
    });

    await expect(run.completion).rejects.toMatchObject({ code: 1 });
    expect(run.query.mock.calls.slice(-2)).toEqual([['INVALID SQL'], ['ROLLBACK']]);
    expect(run.exit).toHaveBeenCalledWith(1);
    expect(run.end).toHaveBeenCalledOnce();
  });

  it('exits and closes the client when the initial connection fails', async () => {
    const run = startMigration({
      env: { DEV_DATABASE_URL: 'postgres://dev' },
      connectError: new Error('connection refused'),
    });

    await expect(run.completion).rejects.toMatchObject({ code: 1 });
    expect(run.query).not.toHaveBeenCalled();
    expect(run.exit).toHaveBeenCalledWith(1);
    expect(run.end).toHaveBeenCalledOnce();
  });
});
