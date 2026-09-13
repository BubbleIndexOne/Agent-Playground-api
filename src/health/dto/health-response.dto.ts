import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class DatabaseHealthDetailDto {
  @ApiProperty({ example: 'dev', description: 'Target database environment' })
  environment: string;

  @ApiProperty({ example: 'connected', description: 'Connection status' })
  status: string;

  @ApiProperty({
    example: '2026-09-13T14:06:20.620Z',
    description: 'PostgreSQL CURRENT_TIME (NOW()) timestamp directly from database',
  })
  currentTime: string;

  @ApiPropertyOptional({ example: 45, description: 'Query execution latency in milliseconds' })
  latencyMs?: number;
}

export class HealthResponseDto {
  @ApiProperty({ example: 'ok', description: 'Overall health status' })
  status: string;

  @ApiProperty({ example: '2026-09-13T14:06:20.620Z', description: 'Server system timestamp' })
  timestamp: string;

  @ApiProperty({
    type: [DatabaseHealthDetailDto],
    description: 'Database health check details per environment',
  })
  databases: DatabaseHealthDetailDto[];
}
