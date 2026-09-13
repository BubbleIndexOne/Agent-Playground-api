import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CONSTANTS } from '../common/constants';

@Injectable()
export class SupabaseService implements OnModuleInit {
  private readonly logger = new Logger(SupabaseService.name);
  private client: SupabaseClient;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    const supabaseUrl = this.configService.get<string>('SUPABASE_URL') || '';
    const supabaseServiceKey =
      this.configService.get<string>('SUPABASE_SERVICE_ROLE_KEY') || '';

    if (!supabaseUrl || !supabaseServiceKey) {
      this.logger.warn(
        'SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not configured in environment. Supabase client initialized with fallback parameters.',
      );
    }

    this.client = createClient(
      supabaseUrl || SUPABASE_CONSTANTS.FALLBACK_URL,
      supabaseServiceKey || SUPABASE_CONSTANTS.FALLBACK_SERVICE_ROLE_KEY,
      SUPABASE_CONSTANTS.CLIENT_CONFIG,
    );
  }

  getClient(): SupabaseClient {
    return this.client;
  }
}
