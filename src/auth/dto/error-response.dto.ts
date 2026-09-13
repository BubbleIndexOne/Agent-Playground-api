import { ApiProperty } from '@nestjs/swagger';

export class ErrorResponseDto {
  @ApiProperty({
    description: 'HTTP status code',
    example: 400,
  })
  statusCode: number;

  @ApiProperty({
    description: 'Error message details or validation failure array',
    example: 'email must be a valid email address',
  })
  message: string | string[];

  @ApiProperty({
    description: 'Error name or category',
    example: 'Bad Request',
  })
  error: string;
}

export class UnauthorizedErrorResponseDto {
  @ApiProperty({
    description: 'HTTP status code',
    example: 401,
  })
  statusCode: number;

  @ApiProperty({
    description: 'Unauthorized error message',
    example: 'Invalid login credentials',
  })
  message: string;

  @ApiProperty({
    description: 'Error category',
    example: 'Unauthorized',
  })
  error: string;
}
