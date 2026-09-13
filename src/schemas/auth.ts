import { z } from 'zod';
import { AUTH_CONSTANTS } from '../constants';

// ─── Request schemas ──────────────────────────────────────────────────────────

export const SignUpSchema = z.object({
  email: z.string().email({ message: 'email must be a valid email address' }),
  password: z
    .string()
    .min(AUTH_CONSTANTS.PASSWORD_MIN_LENGTH, {
      message: `password must be at least ${AUTH_CONSTANTS.PASSWORD_MIN_LENGTH} characters long`,
    }),
});

export const LoginSchema = z.object({
  email: z.string().email({ message: 'email must be a valid email address' }),
  password: z.string().min(1, { message: 'password should not be empty' }),
});

export const RefreshTokenSchema = z.object({
  refreshToken: z.string().min(1, { message: 'refreshToken should not be empty' }),
});

// ─── Inferred types ───────────────────────────────────────────────────────────

export type SignUpInput = z.infer<typeof SignUpSchema>;
export type LoginInput = z.infer<typeof LoginSchema>;
export type RefreshTokenInput = z.infer<typeof RefreshTokenSchema>;
