import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import { swaggerUI } from '@hono/swagger-ui';
import { authRouter } from './routes/auth';
import { healthRouter } from './routes/health';
import { APP_CONSTANTS } from './constants';

// ─── OpenAPI spec ─────────────────────────────────────────────────────────────
// A minimal static OpenAPI 3.1 spec describing all endpoints.
// Scalar renders this into a full interactive UI at /api/docs.

const openApiSpec = {
  openapi: '3.1.0',
  info: {
    title: APP_CONSTANTS.SWAGGER_TITLE,
    description: APP_CONSTANTS.SWAGGER_DESCRIPTION,
    version: APP_CONSTANTS.SWAGGER_VERSION,
  },
  components: {
    securitySchemes: {
      bearer: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Enter your JWT access token',
      },
      adminKey: {
        type: 'apiKey',
        in: 'header',
        name: 'x-admin-key',
        description: 'Admin Secret Key for administrative endpoints',
      },
    },
    schemas: {
      SignUp: {
        type: 'object',
        required: ['email', 'password', 'first_name'],
        properties: {
          email: { type: 'string', format: 'email', example: 'agent.user@example.com' },
          password: { type: 'string', minLength: 8, example: 'SecurePassword123!' },
          first_name: { type: 'string', example: 'John' },
          middle_name: { type: 'string', nullable: true, example: 'William' },
          last_name: { type: 'string', nullable: true, example: 'Doe' },
          display_name: { type: 'string', nullable: true, example: 'Johnny' },
        },
      },
      SignUpResponse: {
        type: 'object',
        required: ['message'],
        properties: {
          message: {
            type: 'string',
            example: 'Account created successfully',
          },
        },
      },
      Login: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email: { type: 'string', format: 'email', example: 'agent.user@example.com' },
          password: { type: 'string', example: 'SecurePassword123!' },
        },
      },
      RefreshToken: {
        type: 'object',
        required: ['refreshToken'],
        properties: {
          refreshToken: { type: 'string', example: 'v1.eyJpZCI6IjEyMzQ1NiJ9...' },
        },
      },
      AuthTokensResponse: {
        type: 'object',
        required: ['accessToken', 'refreshToken'],
        properties: {
          accessToken: {
            type: 'string',
            example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
          },
          refreshToken: {
            type: 'string',
            example: 'v1.eyJpZCI6IjEyMzQ1NiJ9...',
          },
        },
      },
      UpdateProfile: {
        type: 'object',
        properties: {
          first_name: { type: 'string', example: 'John' },
          middle_name: { type: 'string', nullable: true, example: 'William' },
          last_name: { type: 'string', nullable: true, example: 'Doe' },
          display_name: { type: 'string', nullable: true, example: 'Johnny' },
          current_password: { type: 'string', example: 'CurrentPassword123!' },
          new_password: { type: 'string', minLength: 8, example: 'NewPassword123!' },
        },
      },
      DeleteAccount: {
        type: 'object',
        required: ['password'],
        properties: {
          password: { type: 'string', example: 'SecurePassword123!' },
        },
      },
      MessageResponse: {
        type: 'object',
        required: ['message'],
        properties: {
          message: { type: 'string', example: 'Operation completed successfully' },
        },
      },
      UserProfileResponse: {
        type: 'object',
        required: ['id', 'email', 'first_name'],
        properties: {
          id: {
            type: 'string',
            format: 'uuid',
            example: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
          },
          email: {
            type: 'string',
            format: 'email',
            example: 'agent.user@example.com',
          },
          first_name: {
            type: 'string',
            example: 'John',
          },
          middle_name: {
            type: 'string',
            nullable: true,
            example: 'William',
          },
          last_name: {
            type: 'string',
            nullable: true,
            example: 'Doe',
          },
          display_name: {
            type: 'string',
            nullable: true,
            example: 'Johnny',
          },
          created_at: {
            type: 'string',
            format: 'date-time',
            example: '2026-09-14T12:00:00.000Z',
          },
        },
      },
      ErrorResponse: {
        type: 'object',
        required: ['statusCode', 'message'],
        properties: {
          statusCode: { type: 'integer', example: 400 },
          message: {
            description: 'Error message description or array of validation error messages',
            oneOf: [
              { type: 'string', example: 'Invalid login credentials' },
              {
                type: 'array',
                items: { type: 'string' },
                example: ['email must be a valid email address'],
              },
            ],
          },
        },
      },
      DatabaseHealthResponse: {
        type: 'object',
        required: ['environment', 'status', 'currentTime', 'latencyMs'],
        properties: {
          environment: { type: 'string', example: 'dev' },
          status: { type: 'string', example: 'connected' },
          currentTime: { type: 'string', example: '2026-09-14 12:00:00.000000+00' },
          latencyMs: { type: 'integer', example: 12 },
        },
      },
      HealthResponse: {
        type: 'object',
        required: ['status', 'timestamp', 'databases'],
        properties: {
          status: { type: 'string', example: 'ok' },
          timestamp: {
            type: 'string',
            format: 'date-time',
            example: '2026-09-14T12:00:00.012Z',
          },
          databases: {
            type: 'array',
            items: { $ref: '#/components/schemas/DatabaseHealthResponse' },
          },
        },
      },
    },
  },
  paths: {
    '/auth/signup': {
      post: {
        tags: ['auth'],
        summary: 'Register a new user',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/SignUp' } } },
        },
        responses: {
          201: {
            description: 'Account created successfully',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/SignUpResponse' } } },
          },
          400: {
            description: 'Validation error',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
          409: {
            description: 'Account with this email already exists',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
          500: {
            description: 'Internal server error',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
        },
      },
    },
    '/auth/login': {
      post: {
        tags: ['auth'],
        summary: 'Authenticate and receive JWT tokens',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Login' } } },
        },
        responses: {
          200: {
            description: 'Authentication tokens',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/AuthTokensResponse' } } },
          },
          400: {
            description: 'Validation error',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
          401: {
            description: 'Invalid credentials',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
        },
      },
    },
    '/auth/refresh': {
      post: {
        tags: ['auth'],
        summary: 'Refresh access token',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/RefreshToken' } } },
        },
        responses: {
          200: {
            description: 'New tokens returned',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/AuthTokensResponse' } } },
          },
          400: {
            description: 'Validation error',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
          401: {
            description: 'Invalid or expired refresh token',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
        },
      },
    },
    '/auth/me': {
      get: {
        tags: ['auth'],
        summary: 'Get current user profile',
        security: [{ bearer: [] }],
        responses: {
          200: {
            description: 'Profile data',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/UserProfileResponse' } } },
          },
          401: {
            description: 'Unauthorized',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
          404: {
            description: 'Profile not found',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
        },
      },
      patch: {
        tags: ['auth'],
        summary: 'Update current user profile and/or password',
        security: [{ bearer: [] }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/UpdateProfile' } } },
        },
        responses: {
          200: {
            description: 'Updated profile data',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/UserProfileResponse' } } },
          },
          400: {
            description: 'Validation error',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
          401: {
            description: 'Unauthorized or current password mismatch',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
          404: {
            description: 'User not found',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
        },
      },
      delete: {
        tags: ['auth'],
        summary: 'Self-delete current user account',
        security: [{ bearer: [] }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/DeleteAccount' } } },
        },
        responses: {
          200: {
            description: 'Account deleted successfully',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/MessageResponse' } } },
          },
          400: {
            description: 'Validation error',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
          401: {
            description: 'Unauthorized or invalid password',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
          404: {
            description: 'User not found',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
        },
      },
    },
    '/auth/users/{id}': {
      delete: {
        tags: ['auth'],
        summary: 'Admin delete user account by ID',
        security: [{ adminKey: [] }],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
            description: 'User ID to delete',
          },
        ],
        responses: {
          200: {
            description: 'User account deleted successfully',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/MessageResponse' } } },
          },
          403: {
            description: 'Forbidden: invalid or missing admin key',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
          404: {
            description: 'User not found',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
        },
      },
    },
    '/health': {
      get: {
        tags: ['health'],
        summary: 'Service and database health',
        responses: {
          200: {
            description: 'Health status with DB timestamp',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/HealthResponse' } } },
          },
        },
      },
    },
    '/health/db': {
      get: {
        tags: ['health'],
        summary: 'Database connectivity check',
        responses: {
          200: {
            description: 'DB latency and timestamp',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/DatabaseHealthResponse' } } },
          },
        },
      },
    },
  },
};

// ─── App factory ──────────────────────────────────────────────────────────────

/** Create and configure the Hono application and its API routes. */
export function createApp() {
  const app = new Hono();

  // CORS — allow all origins (same behaviour as app.enableCors() in NestJS)
  app.use('*', cors());

  // Routes
  app.route('/auth', authRouter);
  app.route('/health', healthRouter);

  // OpenAPI spec endpoint (consumed by Scalar UI)
  app.get('/api/openapi.json', (c) => c.json(openApiSpec));

  // Standard Swagger UI at /api/docs
  app.get(
    APP_CONSTANTS.SWAGGER_DOCS_PATH,
    swaggerUI({
      url: '/api/openapi.json',
    }),
  );

  // Global error handler
  app.onError((err, c) => {
    if (err instanceof HTTPException) {
      return c.json(
        { statusCode: err.status, message: err.message },
        err.status,
      );
    }
    console.error('[Unhandled error]', err);
    return c.json({ statusCode: 500, message: 'Internal server error' }, 500);
  });

  // 404 fallback
  app.notFound((c) =>
    c.json({ statusCode: 404, message: `Route ${c.req.method} ${c.req.path} not found` }, 404),
  );

  return app;
}
