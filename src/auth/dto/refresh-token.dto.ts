import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class RefreshTokenDto {
  @ApiProperty({
    description: 'Supabase refresh token',
    example: 'dGhpcy1pcy1hLXJlZnJlc2gtdG9rZW4...',
  })
  @IsString()
  @IsNotEmpty({ message: 'refreshToken should not be empty' })
  refreshToken: string;
}
