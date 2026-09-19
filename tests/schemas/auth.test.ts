import { describe, expect, it } from 'vitest';
import {
  LoginSchema,
  RefreshTokenSchema,
  SignUpSchema,
  UpdateProfileSchema,
  DeleteAccountSchema,
} from '../../src/schemas/auth';

describe('authentication schemas', () => {
  describe('SignUpSchema', () => {
    it('accepts valid signup input with first_name only', () => {
      expect(
        SignUpSchema.safeParse({
          email: 'agent@example.com',
          password: '123456',
          first_name: 'John',
        }).success,
      ).toBe(true);
    });

    it('accepts valid signup input with all name fields', () => {
      expect(
        SignUpSchema.safeParse({
          email: 'agent@example.com',
          password: '123456',
          first_name: 'John',
          middle_name: 'William',
          last_name: 'Doe',
          display_name: 'Johnny',
        }).success,
      ).toBe(true);
    });

    it.each([
      [{ email: 'not-an-email', password: '123456', first_name: 'John' }, 'email must be a valid email address'],
      [{ email: 'agent@example.com', password: '12345', first_name: 'John' }, 'password must be at least 6 characters long'],
      [{ email: 'agent@example.com', password: '123456' }, 'first_name is required'],
      [{ email: 'agent@example.com', password: '123456', first_name: '   ' }, 'first_name must not be empty'],
    ])('rejects invalid signup input %#', (input, expectedMessage) => {
      const result = SignUpSchema.safeParse(input);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors.map((error) => error.message)).toContain(expectedMessage);
      }
    });
  });

  describe('LoginSchema', () => {
    it('accepts valid credentials', () => {
      expect(LoginSchema.safeParse({ email: 'agent@example.com', password: 'secret' }).success).toBe(true);
    });

    it.each([
      [{ email: 'invalid', password: 'secret' }, 'email must be a valid email address'],
      [{ email: 'agent@example.com', password: '' }, 'password should not be empty'],
    ])('rejects invalid login input %#', (input, expectedMessage) => {
      const result = LoginSchema.safeParse(input);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors.map((error) => error.message)).toContain(expectedMessage);
      }
    });
  });

  describe('RefreshTokenSchema', () => {
    it('accepts a non-empty refresh token', () => {
      expect(RefreshTokenSchema.safeParse({ refreshToken: 'refresh-token' }).success).toBe(true);
    });

    it.each([{}, { refreshToken: '' }])('rejects a missing or empty refresh token %#', (input) => {
      expect(RefreshTokenSchema.safeParse(input).success).toBe(false);
    });
  });

  describe('UpdateProfileSchema', () => {
    it('accepts partial name updates', () => {
      expect(
        UpdateProfileSchema.safeParse({
          first_name: 'Jane',
          last_name: 'Smith',
        }).success,
      ).toBe(true);
    });

    it('accepts password update when current_password is provided', () => {
      expect(
        UpdateProfileSchema.safeParse({
          current_password: 'OldPassword123',
          new_password: 'NewPassword123',
        }).success,
      ).toBe(true);
    });

    it('rejects new_password when current_password is missing', () => {
      const result = UpdateProfileSchema.safeParse({
        new_password: 'NewPassword123',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors.map((e) => e.message)).toContain(
          'current_password is required when updating password',
        );
      }
    });
  });

  describe('DeleteAccountSchema', () => {
    it('accepts non-empty password', () => {
      expect(DeleteAccountSchema.safeParse({ password: 'myPassword123' }).success).toBe(true);
    });

    it.each([{}, { password: '' }])('rejects missing or empty password %#', (input) => {
      expect(DeleteAccountSchema.safeParse(input).success).toBe(false);
    });
  });
});
