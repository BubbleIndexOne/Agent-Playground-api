import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength } from 'class-validator';
import { AUTH_CONSTANTS } from '../../common/constants';

export class SignUpDto {
  @ApiProperty({
    description: `User email address`,
    example: 'agent.user@example.com',
  })
  @IsEmail({}, { message: 'email must be a valid email address' })
  email: string;

  @ApiProperty({
    description: `User password (minimum ${AUTH_CONSTANTS.PASSWORD_MIN_LENGTH} characters)`,
    example: 'SecurePassword123!',
    minLength: AUTH_CONSTANTS.PASSWORD_MIN_LENGTH,
  })
  @IsString()
  @MinLength(AUTH_CONSTANTS.PASSWORD_MIN_LENGTH, {
    message: `password must be at least ${AUTH_CONSTANTS.PASSWORD_MIN_LENGTH} characters long`,
  })
  password: string;
}
