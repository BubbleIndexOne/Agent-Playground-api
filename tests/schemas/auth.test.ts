import { describe, expect, it } from 'vitest';
import { LoginSchema, RefreshTokenSchema, SignUpSchema } from '../../src/schemas/auth';

describe('authentication schemas', () => {
  describe('SignUpSchema', () => {
    it('accepts a valid email and a password at the minimum length', () => {
      expect(
        SignUpSchema.safeParse({ email: 'agent@example.com', password: '123456' }).success,
      ).toBe(true);
    });

    it.each([
      [{ email: 'not-an-email', password: '123456' }, 'email must be a valid email address'],
      [{ email: 'agent@example.com', password: '12345' }, 'password must be at least 6 characters long'],
      [{ password: '123456' }, 'Required'],
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
});
