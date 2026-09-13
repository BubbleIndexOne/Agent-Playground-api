import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RefreshResponseDto {
  @ApiProperty({
    description: 'New Supabase JWT access token',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  accessToken: string;

  @ApiPropertyOptional({
    description: 'Updated Supabase refresh token if rotated',
    example: 'dGhpcy1pcy1hLXJlZnJlc2gtdG9rZW4...',
  })
  refreshToken?: string;
}
