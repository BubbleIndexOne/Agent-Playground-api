import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ProfileResponseDto {
  @ApiProperty({
    description: 'Unique identifier for the user (Supabase Auth UID)',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  id: string;

  @ApiProperty({
    description: 'User email address',
    example: 'agent.user@example.com',
  })
  email: string;

  @ApiPropertyOptional({
    description: 'Timestamp when the profile was created',
    example: '2026-09-13T19:20:00.000Z',
  })
  created_at?: string;

  @ApiPropertyOptional({
    description: 'Timestamp when the profile was last updated',
    example: '2026-09-13T19:20:00.000Z',
  })
  updated_at?: string;
}
