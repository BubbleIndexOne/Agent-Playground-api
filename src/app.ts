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
        description: 'Enter your Supabase access token',
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
          201: { description: 'User created and tokens returned' },
          400: { description: 'Validation error or signup failure' },
        },
      },
    },
    '/auth/login': {
      post: {
        tags: ['auth'],
        summary: 'Authenticate existing user',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Login' } } },
        },
        responses: {
          200: { description: 'Tokens returned' },
          401: { description: 'Invalid credentials' },
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
          200: { description: 'New tokens returned' },
          401: { description: 'Invalid or expired refresh token' },
        },
      },
    },
    '/auth/me': {
      get: {
        tags: ['auth'],
        summary: 'Get current user profile',
        security: [{ bearer: [] }],
        responses: {
          200: { description: 'Profile data' },
          401: { description: 'Unauthorized' },
          404: { description: 'Profile not found' },
        },
      },
    },
    '/health': {
      get: {
        tags: ['health'],
        summary: 'Service and database health',
        responses: { 200: { description: 'Health status with DB timestamp' } },
      },
    },
    '/health/db': {
      get: {
        tags: ['health'],
        summary: 'Database connectivity check',
        responses: { 200: { description: 'DB latency and timestamp' } },
      },
    },
  },
  components_schemas: {
    SignUp: {
      type: 'object',
      required: ['email', 'password'],
      properties: {
        email: { type: 'string', format: 'email', example: 'agent.user@example.com' },
        password: { type: 'string', minLength: 6, example: 'SecurePassword123!' },
      },
    },
    Login: {
      type: 'object',
      required: ['email', 'password'],
      properties: {
        email: { type: 'string', format: 'email' },
        password: { type: 'string' },
      },
    },
    RefreshToken: {
      type: 'object',
      required: ['refreshToken'],
      properties: {
        refreshToken: { type: 'string' },
      },
    },
  },
};

// ─── App factory ──────────────────────────────────────────────────────────────

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
