import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, QueryResult, QueryResultRow } from 'pg';
import { DATABASE_CONSTANTS } from '../common/constants';

export type DatabaseTarget = 'dev' | 'prod';

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  private pool: Pool | null = null;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    // DATABASE_URL is injected into process.env by the Worker fetch handler
    // from env.HYPERDRIVE.connectionString before NestJS bootstraps.
    // For local Node.js dev (npm run dev), it reads from .env / .dev.vars.
    const connectionString =
      this.configService.get<string>('DATABASE_URL') ||
      process.env.DATABASE_URL;

    if (!connectionString) {
      this.logger.warn(
        'DATABASE_URL is not configured. Set it in .env (local dev) or via Hyperdrive binding (Worker).',
      );
      return;
    }

    this.pool = new Pool({
      connectionString,
      ssl: { rejectUnauthorized: false },
      max: DATABASE_CONSTANTS.DEFAULT_MAX_POOL_CONNECTIONS,
      idleTimeoutMillis: DATABASE_CONSTANTS.DEFAULT_IDLE_TIMEOUT_MS,
      connectionTimeoutMillis: DATABASE_CONSTANTS.DEFAULT_CONNECTION_TIMEOUT_MS,
    });

    this.logger.log('Database pool initialized.');
  }

  getPool(): Pool {
    if (!this.pool) {
      throw new Error(
        'Database pool is not initialized. Ensure DATABASE_URL is configured.',
      );
    }
    return this.pool;
  }

  async query<T extends QueryResultRow = any>(
    sqlText: string,
    params: any[] = [],
  ): Promise<QueryResult<T>> {
    return this.getPool().query<T>(sqlText, params);
  }

  async getCurrentTime(): Promise<string> {
    const result = await this.query<{ current_time: string }>(
      DATABASE_CONSTANTS.NOW_QUERY,
    );
    return result.rows[0]?.current_time;
  }

  async onModuleDestroy() {
    if (this.pool) {
      await this.pool.end();
    }
  }
}
