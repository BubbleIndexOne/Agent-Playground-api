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
    summary: 'Check service and database health',
    description:
      'Executes SELECT NOW() on the connected Supabase PostgreSQL database via Hyperdrive and returns the current timestamp.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Health status with current timestamp from the database',
    type: HealthResponseDto,
  })
  async getOverallHealth(): Promise<HealthResponseDto> {
    const detail = await this.checkDb();
    return {
      status: HEALTH_CONSTANTS.STATUS_OK,
      timestamp: new Date().toISOString(),
      databases: [detail],
    };
  }

  @Get('db')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Check database connectivity',
    description:
      'Directly executes SELECT NOW() on the connected Supabase PostgreSQL database to verify the Hyperdrive connection.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Database health and CURRENT_TIME timestamp',
    type: DatabaseHealthDetailDto,
  })
  async getDbHealth(): Promise<DatabaseHealthDetailDto> {
    return this.checkDb();
  }

  private async checkDb(): Promise<DatabaseHealthDetailDto> {
    const start = Date.now();
    try {
      const currentTime = await this.databaseService.getCurrentTime();
      return {
        environment: process.env.ENVIRONMENT || 'worker',
        status: HEALTH_CONSTANTS.STATUS_CONNECTED,
        currentTime,
        latencyMs: Date.now() - start,
      };
    } catch (err: any) {
      return {
        environment: process.env.ENVIRONMENT || 'worker',
        status: `error: ${err.message}`,
        currentTime: HEALTH_CONSTANTS.STATUS_UNAVAILABLE,
        latencyMs: Date.now() - start,
      };
    }
  }
}
