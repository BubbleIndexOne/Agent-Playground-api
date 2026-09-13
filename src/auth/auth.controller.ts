import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { SignUpDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { AuthResponseDto } from './dto/auth-response.dto';
import { RefreshResponseDto } from './dto/refresh-response.dto';
import { ProfileResponseDto } from './dto/profile-response.dto';
import {
  ErrorResponseDto,
  UnauthorizedErrorResponseDto,
} from './dto/error-response.dto';
import {
  AuthenticatedRequest,
  SupabaseAuthGuard,
} from './guards/supabase-auth.guard';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('signup')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Register a new user',
    description:
      'Creates a user in Supabase Auth, inserts a record into the profiles table, and returns access and refresh tokens.',
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'User successfully created and authenticated.',
    type: AuthResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Validation error or user registration failure.',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Unauthorized operation or credentials rejected.',
    type: UnauthorizedErrorResponseDto,
  })
  async signUp(@Body() signUpDto: SignUpDto): Promise<AuthResponseDto> {
    return this.authService.signUp(signUpDto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Authenticate existing user',
    description:
      'Validates user email and password against Supabase Auth, returning access and refresh tokens.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Authentication successful.',
    type: AuthResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Validation error on request body.',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Invalid credentials.',
    type: UnauthorizedErrorResponseDto,
  })
  async login(@Body() loginDto: LoginDto): Promise<AuthResponseDto> {
    return this.authService.login(loginDto);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Refresh access token',
    description:
      'Exchanges a valid Supabase refresh token for a newly issued access token.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Access token successfully refreshed.',
    type: RefreshResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Validation error on request body.',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Invalid, revoked, or expired refresh token.',
    type: UnauthorizedErrorResponseDto,
  })
  async refresh(
    @Body() refreshTokenDto: RefreshTokenDto,
  ): Promise<RefreshResponseDto> {
    return this.authService.refresh(refreshTokenDto);
  }

  @Get('me')
  @UseGuards(SupabaseAuthGuard)
  @ApiBearerAuth('bearer')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get current user profile',
    description:
      'Protected endpoint. Verifies the Bearer access token against Supabase Auth and returns the matching profile row.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'User profile retrieved successfully.',
    type: ProfileResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Database or query error occurred.',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Missing, invalid, or expired Bearer token.',
    type: UnauthorizedErrorResponseDto,
  })
  async getMe(
    @Req() req: AuthenticatedRequest,
  ): Promise<ProfileResponseDto> {
    const userId = req.user?.id;
    return this.authService.getMe(userId);
  }
}
