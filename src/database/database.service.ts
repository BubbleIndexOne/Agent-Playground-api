import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, QueryResult, QueryResultRow } from 'pg';
import { DATABASE_CONSTANTS } from '../common/constants';
import { getWranglerConnectionString } from '../common/utils/wrangler-config.util';

export type DatabaseTarget = 'dev' | 'prod';

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  private devPool: Pool;
  private prodPool: Pool;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    const devUrl =
      this.configService.get<string>('DEV_DATABASE_URL') ||
      this.configService.get<string>('DATABASE_URL') ||
      getWranglerConnectionString('dev');

    const prodUrl =
      this.configService.get<string>('PROD_DATABASE_URL') ||
      getWranglerConnectionString('production');

    if (devUrl) {
      this.devPool = new Pool({
        connectionString: devUrl,
        ssl: { rejectUnauthorized: false },
        max: DATABASE_CONSTANTS.DEFAULT_MAX_POOL_CONNECTIONS,
        idleTimeoutMillis: DATABASE_CONSTANTS.DEFAULT_IDLE_TIMEOUT_MS,
        connectionTimeoutMillis: DATABASE_CONSTANTS.DEFAULT_CONNECTION_TIMEOUT_MS,
      });
    } else {
      this.logger.warn(
        'DEV_DATABASE_URL is not configured in environment or wrangler.toml.',
      );
    }

    if (prodUrl) {
      this.prodPool = new Pool({
        connectionString: prodUrl,
        ssl: { rejectUnauthorized: false },
        max: DATABASE_CONSTANTS.DEFAULT_MAX_POOL_CONNECTIONS,
        idleTimeoutMillis: DATABASE_CONSTANTS.DEFAULT_IDLE_TIMEOUT_MS,
        connectionTimeoutMillis: DATABASE_CONSTANTS.DEFAULT_CONNECTION_TIMEOUT_MS,
      });
    } else {
      this.logger.warn(
        'PROD_DATABASE_URL is not configured in environment or wrangler.toml.',
      );
    }

    this.logger.log('Database pools initialized.');
  }

  getPool(target: DatabaseTarget = 'dev'): Pool {
    const pool = target === 'prod' ? this.prodPool : this.devPool;
    if (!pool) {
      throw new Error(
        `Database connection pool for target "${target}" is not configured. Please set ${
          target === 'prod' ? 'PROD_DATABASE_URL' : 'DEV_DATABASE_URL'
        } in your environment or wrangler.toml.`,
      );
    }
    return pool;
  }

  async query<T extends QueryResultRow = any>(
    sqlText: string,
    params: any[] = [],
    target: DatabaseTarget = 'dev',
  ): Promise<QueryResult<T>> {
    const pool = this.getPool(target);
    return pool.query<T>(sqlText, params);
  }

  async getCurrentTime(target: DatabaseTarget = 'dev'): Promise<string> {
    const result = await this.query<{ current_time: string }>(
      DATABASE_CONSTANTS.NOW_QUERY,
      [],
      target,
    );
    return result.rows[0]?.current_time;
  }

  async onModuleDestroy() {
    if (this.devPool) {
      await this.devPool.end();
    }
    if (this.prodPool) {
      await this.prodPool.end();
    }
  }
}
