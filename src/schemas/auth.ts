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
  first_name: z
    .string({ required_error: 'first_name is required' })
    .trim()
    .min(1, { message: 'first_name must not be empty' })
    .max(50, { message: 'first_name must not exceed 50 characters' }),
  middle_name: z
    .string()
    .trim()
    .max(50, { message: 'middle_name must not exceed 50 characters' })
    .optional()
    .nullable(),
  last_name: z
    .string()
    .trim()
    .max(50, { message: 'last_name must not exceed 50 characters' })
    .optional()
    .nullable(),
  display_name: z
    .string()
    .trim()
    .max(100, { message: 'display_name must not exceed 100 characters' })
    .optional()
    .nullable(),
});

export const LoginSchema = z.object({
  email: z.string().email({ message: 'email must be a valid email address' }),
  password: z.string().min(1, { message: 'password should not be empty' }),
});

export const RefreshTokenSchema = z.object({
  refreshToken: z.string().min(1, { message: 'refreshToken should not be empty' }),
});

export const UpdateProfileSchema = z.object({
    first_name: z
      .string()
      .trim()
      .min(1, { message: 'first_name must not be empty' })
      .max(50, { message: 'first_name must not exceed 50 characters' })
      .optional(),
    middle_name: z
      .string()
      .trim()
      .max(50, { message: 'middle_name must not exceed 50 characters' })
      .optional()
      .nullable(),
    last_name: z
      .string()
      .trim()
      .max(50, { message: 'last_name must not exceed 50 characters' })
      .optional()
      .nullable(),
    display_name: z
      .string()
      .trim()
      .max(100, { message: 'display_name must not exceed 100 characters' })
      .optional()
      .nullable(),
    current_password: z.string().optional(),
    new_password: z
      .string()
      .min(AUTH_CONSTANTS.PASSWORD_MIN_LENGTH, {
        message: `new_password must be at least ${AUTH_CONSTANTS.PASSWORD_MIN_LENGTH} characters long`,
      })
      .optional(),
  })
  .refine(
    (data) => {
      if (data.new_password && !data.current_password) {
        return false;
      }
      return true;
    },
    {
      message: 'current_password is required when updating password',
      path: ['current_password'],
    },
  );

export const DeleteAccountSchema = z.object({
  password: z.string().min(1, { message: 'password is required to confirm account deletion' }),
});

// ─── Inferred types ───────────────────────────────────────────────────────────

export type SignUpInput = z.infer<typeof SignUpSchema>;
export type LoginInput = z.infer<typeof LoginSchema>;
export type RefreshTokenInput = z.infer<typeof RefreshTokenSchema>;
export type UpdateProfileInput = z.infer<typeof UpdateProfileSchema>;
export type DeleteAccountInput = z.infer<typeof DeleteAccountSchema>;
