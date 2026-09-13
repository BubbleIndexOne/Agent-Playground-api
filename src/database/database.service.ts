import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, QueryResult, QueryResultRow } from 'pg';

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
      'postgresql://postgres.kvxhozhsstdtlrqeaxgs:CTnU6iLEuETfKUIS@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres';

    const prodUrl =
      this.configService.get<string>('PROD_DATABASE_URL') ||
      'postgresql://postgres.egnpcdukuzckjxuwlypn:t5usnRNZBhV83Mha@aws-0-ap-south-1.pooler.supabase.com:5432/postgres';

    this.devPool = new Pool({
      connectionString: devUrl,
      ssl: { rejectUnauthorized: false },
      max: 5,
      idleTimeoutMillis: 30000,
    });

    this.prodPool = new Pool({
      connectionString: prodUrl,
      ssl: { rejectUnauthorized: false },
      max: 5,
      idleTimeoutMillis: 30000,
    });

    this.logger.log('Database pools initialized for both Dev and Prod Supabase projects.');
  }

  getPool(target: DatabaseTarget = 'dev'): Pool {
    return target === 'prod' ? this.prodPool : this.devPool;
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
      'SELECT NOW() as current_time',
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
