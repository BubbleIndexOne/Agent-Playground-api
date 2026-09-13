import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { DatabaseService } from '../database/database.service';
import {
  DatabaseHealthDetailDto,
  HealthResponseDto,
} from './dto/health-response.dto';
import { HEALTH_CONSTANTS } from '../common/constants';

@ApiTags(HEALTH_CONSTANTS.TAG)
@Controller(HEALTH_CONSTANTS.TAG)
export class HealthController {
  constructor(private readonly databaseService: DatabaseService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Check service and databases health',
    description:
      'Queries both Dev and Prod Supabase PostgreSQL databases (executing SELECT NOW()) and returns current database timestamps to keep free tier instances active.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Health status with current timestamps from databases',
    type: HealthResponseDto,
  })
  async getOverallHealth(): Promise<HealthResponseDto> {
    const checkDb = async (
      target: 'dev' | 'prod',
    ): Promise<DatabaseHealthDetailDto> => {
      const start = Date.now();
      try {
        const currentTime = await this.databaseService.getCurrentTime(target);
        return {
          environment: target,
          status: HEALTH_CONSTANTS.STATUS_CONNECTED,
          currentTime,
          latencyMs: Date.now() - start,
        };
      } catch (err: any) {
        return {
          environment: target,
          status: `error: ${err.message}`,
          currentTime: HEALTH_CONSTANTS.STATUS_UNAVAILABLE,
          latencyMs: Date.now() - start,
        };
      }
    };

    const [devResult, prodResult] = await Promise.all([
      checkDb('dev'),
      checkDb('prod'),
    ]);

    return {
      status: HEALTH_CONSTANTS.STATUS_OK,
      timestamp: new Date().toISOString(),
      databases: [devResult, prodResult],
    };
  }

  @Get('dev')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Check Dev Supabase database health',
    description:
      'Directly executes SELECT NOW() on the Dev Supabase PostgreSQL database to keep it warm and prevent pause.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Dev database health and CURRENT_TIME timestamp',
    type: DatabaseHealthDetailDto,
  })
  async getDevHealth(): Promise<DatabaseHealthDetailDto> {
    const start = Date.now();
    const currentTime = await this.databaseService.getCurrentTime('dev');
    return {
      environment: 'dev',
      status: HEALTH_CONSTANTS.STATUS_CONNECTED,
      currentTime,
      latencyMs: Date.now() - start,
    };
  }

  @Get('prod')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Check Prod Supabase database health',
    description:
      'Directly executes SELECT NOW() on the Prod Supabase PostgreSQL database to keep it warm and prevent pause.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Prod database health and CURRENT_TIME timestamp',
    type: DatabaseHealthDetailDto,
  })
  async getProdHealth(): Promise<DatabaseHealthDetailDto> {
    const start = Date.now();
    const currentTime = await this.databaseService.getCurrentTime('prod');
    return {
      environment: 'prod',
      status: HEALTH_CONSTANTS.STATUS_CONNECTED,
      currentTime,
      latencyMs: Date.now() - start,
    };
  }
}
