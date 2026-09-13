import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength } from 'class-validator';

export class SignUpDto {
  @ApiProperty({
    description: 'User email address',
    example: 'agent.user@example.com',
  })
  @IsEmail({}, { message: 'email must be a valid email address' })
  email: string;

  @ApiProperty({
    description: 'User password (minimum 6 characters)',
    example: 'SecurePassword123!',
    minLength: 6,
  })
  @IsString()
  @MinLength(6, { message: 'password must be at least 6 characters long' })
  password: string;
}
