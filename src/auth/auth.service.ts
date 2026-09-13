import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { SignUpDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { AuthResponseDto } from './dto/auth-response.dto';
import { RefreshResponseDto } from './dto/refresh-response.dto';
import { ProfileResponseDto } from './dto/profile-response.dto';
import { AUTH_CONSTANTS } from '../common/constants';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  /**
   * Register user via Supabase Auth, insert profile row, and return tokens.
   */
  async signUp(signUpDto: SignUpDto): Promise<AuthResponseDto> {
    const supabase = this.supabaseService.getClient();

    // Create user via admin API with email auto-confirmed using service role key
    const { data: userData, error: createError } =
      await supabase.auth.admin.createUser({
        email: signUpDto.email,
        password: signUpDto.password,
        email_confirm: true,
      });

    if (createError) {
      this.logger.warn(`User creation failed: ${createError.message}`);
      throw new BadRequestException(createError.message);
    }

    if (!userData.user) {
      throw new BadRequestException('User creation failed unexpectedly');
    }

    // Insert corresponding row into profiles table
    const { error: profileError } = await supabase
      .from(AUTH_CONSTANTS.PROFILES_TABLE)
      .insert({
      id: userData.user.id,
      email: userData.user.email,
    });

    if (profileError) {
      this.logger.error(
        `Failed to insert profile row for user ${userData.user.id}: ${profileError.message}`,
      );
      // Note: Do not block returning tokens if profile insertion failed due to unmigrated table,
      // but log the error for visibility.
    }

    // Sign in to retrieve valid access and refresh tokens
    const { data: sessionData, error: signInError } =
      await supabase.auth.signInWithPassword({
        email: signUpDto.email,
        password: signUpDto.password,
      });

    if (signInError || !sessionData.session) {
      this.logger.error(
        `Failed to establish session after signup: ${signInError?.message}`,
      );
      throw new BadRequestException(
        signInError?.message || 'Failed to establish session after registration',
      );
    }

    return {
      accessToken: sessionData.session.access_token,
      refreshToken: sessionData.session.refresh_token,
    };
  }

  /**
   * Sign in user via Supabase Auth and return tokens.
   */
  async login(loginDto: LoginDto): Promise<AuthResponseDto> {
    const supabase = this.supabaseService.getClient();

    const { data, error } = await supabase.auth.signInWithPassword({
      email: loginDto.email,
      password: loginDto.password,
    });

    if (error || !data.session) {
      throw new UnauthorizedException(error?.message || 'Invalid login credentials');
    }

    return {
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
    };
  }

  /**
   * Refresh session using Supabase refresh token.
   */
  async refresh(refreshTokenDto: RefreshTokenDto): Promise<RefreshResponseDto> {
    const supabase = this.supabaseService.getClient();

    const { data, error } = await supabase.auth.refreshSession({
      refresh_token: refreshTokenDto.refreshToken,
    });

    if (error || !data.session) {
      throw new UnauthorizedException(
        error?.message || 'Invalid or expired refresh token',
      );
    }

    return {
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
    };
  }

  /**
   * Retrieve profile row from the profiles table for authenticated user.
   */
  async getMe(userId: string): Promise<ProfileResponseDto> {
    const supabase = this.supabaseService.getClient();

    const { data, error } = await supabase
      .from(AUTH_CONSTANTS.PROFILES_TABLE)
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    if (error) {
      this.logger.error(`Database error fetching profile: ${error.message}`);
      throw new BadRequestException(error.message);
    }

    if (!data) {
      throw new NotFoundException(`Profile for user ${userId} not found`);
    }

    return data as ProfileResponseDto;
  }
}
