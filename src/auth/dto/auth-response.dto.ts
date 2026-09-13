import { ApiProperty } from '@nestjs/swagger';

export class AuthResponseDto {
  @ApiProperty({
    description: 'Supabase JWT access token for Bearer authentication',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  accessToken: string;

  @ApiProperty({
    description: 'Supabase refresh token used to obtain a new access token',
    example: 'dGhpcy1pcy1hLXJlZnJlc2gtdG9rZW4...',
  })
  refreshToken: string;
}
