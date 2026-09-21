import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import { swaggerUI } from '@hono/swagger-ui';
import { authRouter } from './routes/auth';
import { healthRouter } from './routes/health';
import { toolsRouter } from './routes/tools';
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
      CreateTool: {
        type: 'object',
        required: ['name', 'type'],
        properties: {
          name: { type: 'string', example: 'Web Scraper' },
          description: { type: 'string', nullable: true, example: 'Extracts data from HTML pages' },
          type: { type: 'string', enum: ['client', 'mcp'], example: 'client' },
          connector_type: { type: 'string', nullable: true, example: null },
          is_public: { type: 'boolean', default: false, example: false },
          allow_client_execution: { type: 'boolean', default: false, example: false },
        },
      },
      UpdateTool: {
        type: 'object',
        properties: {
          name: { type: 'string', example: 'Enhanced Web Scraper' },
          description: { type: 'string', nullable: true, example: 'Fast distributed web scraper' },
          is_public: { type: 'boolean', example: true },
          allow_client_execution: { type: 'boolean', example: true },
          status: {
            type: 'string',
            enum: ['draft', 'testing', 'verified', 'registered', 'rejected', 'deprecated'],
            example: 'verified',
          },
        },
      },
      CreateToolVersion: {
        type: 'object',
        required: ['schema_json'],
        properties: {
          code: {
            type: 'string',
            nullable: true,
            example: 'export default async function run(params) { return { content: "result" }; }',
          },
          schema_json: {
            type: 'object',
            example: {
              type: 'object',
              properties: { url: { type: 'string', description: 'Target URL' } },
              required: ['url'],
            },
          },
          capabilities_json: {
            type: 'array',
            items: { type: 'string' },
            example: ['network:http_get'],
          },
          test_results_json: {
            type: 'object',
            nullable: true,
            example: { passed: true, duration_ms: 42 },
          },
        },
      },
      ToolVersionResponse: {
        type: 'object',
        required: ['id', 'tool_id', 'version_number', 'schema_json', 'created_at'],
        properties: {
          id: { type: 'string', format: 'uuid', example: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d' },
          tool_id: { type: 'string', format: 'uuid', example: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' },
          version_number: { type: 'integer', example: 1 },
          code: { type: 'string', nullable: true, example: 'export default async function run() {}' },
          schema_json: {
            type: 'object',
            example: { type: 'object', properties: { url: { type: 'string' } } },
          },
          capabilities_json: {
            type: 'array',
            items: { type: 'string' },
            example: ['network:http_get'],
          },
          code_hash: {
            type: 'string',
            nullable: true,
            example: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
          },
          test_results_json: { type: 'object', nullable: true, example: { passed: true } },
          created_at: { type: 'string', format: 'date-time', example: '2026-09-20T12:00:00.000Z' },
        },
      },
      ToolResponse: {
        type: 'object',
        required: ['id', 'owner_id', 'name', 'type', 'status', 'is_public', 'created_at', 'updated_at'],
        properties: {
          id: { type: 'string', format: 'uuid', example: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' },
          owner_id: { type: 'string', format: 'uuid', example: 'c1eebc99-9c0b-4ef8-bb6d-6bb9bd380a22' },
          name: { type: 'string', example: 'Web Scraper' },
          description: { type: 'string', nullable: true, example: 'Extracts data from HTML pages' },
          type: { type: 'string', enum: ['client', 'mcp'], example: 'client' },
          status: {
            type: 'string',
            enum: ['draft', 'testing', 'verified', 'registered', 'rejected', 'deprecated'],
            example: 'draft',
          },
          is_public: { type: 'boolean', example: false },
          allow_client_execution: { type: 'boolean', example: false },
          connector_type: { type: 'string', nullable: true, example: null },
          current_version_id: {
            type: 'string',
            format: 'uuid',
            nullable: true,
            example: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
          },
          is_archived: { type: 'boolean', example: false },
          created_at: { type: 'string', format: 'date-time', example: '2026-09-20T12:00:00.000Z' },
          updated_at: { type: 'string', format: 'date-time', example: '2026-09-20T12:00:00.000Z' },
          current_version: {
            $ref: '#/components/schemas/ToolVersionResponse',
            nullable: true,
          },
        },
      },
      ToolDiffResponse: {
        type: 'object',
        required: ['tool_id', 'from', 'to', 'diff'],
        properties: {
          tool_id: { type: 'string', format: 'uuid', example: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' },
          from: { $ref: '#/components/schemas/ToolVersionResponse' },
          to: { $ref: '#/components/schemas/ToolVersionResponse' },
          diff: {
            type: 'object',
            required: ['code_changed', 'schema_changed'],
            properties: {
              code_changed: { type: 'boolean', example: true },
              schema_changed: { type: 'boolean', example: false },
            },
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
    '/tools': {
      post: {
        tags: ['tools'],
        summary: 'Create a new tool shell in draft status',
        security: [{ bearer: [] }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateTool' } } },
        },
        responses: {
          201: {
            description: 'Tool shell created successfully',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ToolResponse' } } },
          },
          400: {
            description: 'Validation error',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
          401: {
            description: 'Unauthorized',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
          500: {
            description: 'Internal server error',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
        },
      },
      get: {
        tags: ['tools'],
        summary: 'List tools owned by caller, optionally including verified public tools',
        security: [{ bearer: [] }, { adminKey: [] }],
        parameters: [
          {
            name: 'include_public',
            in: 'query',
            schema: { type: 'boolean' },
            description: 'Include verified public tools',
          },
          {
            name: 'include_archived',
            in: 'query',
            schema: { type: 'boolean' },
            description: 'Admin only: include archived tools',
          },
          {
            name: 'type',
            in: 'query',
            schema: { type: 'string', enum: ['client', 'mcp'] },
            description: 'Filter by tool type',
          },
          {
            name: 'status',
            in: 'query',
            schema: { type: 'string' },
            description: 'Filter by lifecycle status',
          },
        ],
        responses: {
          200: {
            description: 'List of tools',
            content: {
              'application/json': {
                schema: { type: 'array', items: { $ref: '#/components/schemas/ToolResponse' } },
              },
            },
          },
          401: {
            description: 'Unauthorized',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
        },
      },
    },
    '/tools/{id}': {
      get: {
        tags: ['tools'],
        summary: 'Get tool by ID with current version details',
        security: [{ bearer: [] }, { adminKey: [] }],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
            description: 'Tool UUID',
          },
        ],
        responses: {
          200: {
            description: 'Tool details',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ToolResponse' } } },
          },
          401: {
            description: 'Unauthorized',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
          404: {
            description: 'Tool not found or archived',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
        },
      },
      patch: {
        tags: ['tools'],
        summary: 'Update tool metadata',
        security: [{ bearer: [] }, { adminKey: [] }],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
            description: 'Tool UUID',
          },
        ],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/UpdateTool' } } },
        },
        responses: {
          200: {
            description: 'Updated tool details',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ToolResponse' } } },
          },
          400: {
            description: 'Validation error',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
          401: {
            description: 'Unauthorized',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
          403: {
            description: 'Forbidden: caller is not the owner or MCP verified transition requires admin',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
          404: {
            description: 'Tool not found',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
        },
      },
      delete: {
        tags: ['tools'],
        summary: 'Soft-delete a tool (sets is_archived = true)',
        security: [{ bearer: [] }, { adminKey: [] }],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
            description: 'Tool UUID',
          },
        ],
        responses: {
          200: {
            description: 'Tool archived successfully',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/MessageResponse' } } },
          },
          401: {
            description: 'Unauthorized',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
          403: {
            description: 'Forbidden: only owner or admin can delete tool',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
          404: {
            description: 'Tool not found',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
        },
      },
    },
    '/tools/{id}/versions': {
      post: {
        tags: ['tools'],
        summary: 'Create a new version for a tool atomically',
        security: [{ bearer: [] }],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
            description: 'Tool UUID',
          },
        ],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateToolVersion' } } },
        },
        responses: {
          201: {
            description: 'Tool version created successfully',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ToolVersionResponse' } } },
          },
          400: {
            description: 'Validation error (e.g. missing code for client tool or code present for mcp)',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
          401: {
            description: 'Unauthorized',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
          403: {
            description: 'Forbidden: caller is not the owner',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
          404: {
            description: 'Tool not found',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
          500: {
            description: 'Internal server error',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
        },
      },
      get: {
        tags: ['tools'],
        summary: 'List all historical versions of a tool ordered descending',
        security: [{ bearer: [] }, { adminKey: [] }],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
            description: 'Tool UUID',
          },
        ],
        responses: {
          200: {
            description: 'List of tool versions',
            content: {
              'application/json': {
                schema: { type: 'array', items: { $ref: '#/components/schemas/ToolVersionResponse' } },
              },
            },
          },
          401: {
            description: 'Unauthorized',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
          404: {
            description: 'Tool not found',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
        },
      },
    },
    '/tools/{id}/versions/{versionNumber}': {
      get: {
        tags: ['tools'],
        summary: 'Get full details of a specific tool version',
        security: [{ bearer: [] }, { adminKey: [] }],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
            description: 'Tool UUID',
          },
          {
            name: 'versionNumber',
            in: 'path',
            required: true,
            schema: { type: 'integer' },
            description: 'Version number',
          },
        ],
        responses: {
          200: {
            description: 'Tool version details',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ToolVersionResponse' } } },
          },
          400: {
            description: 'Invalid version number parameter',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
          401: {
            description: 'Unauthorized',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
          404: {
            description: 'Tool or version not found',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
        },
      },
    },
    '/tools/{id}/diff': {
      get: {
        tags: ['tools'],
        summary: 'Compare two historical tool versions for visual diffing',
        security: [{ bearer: [] }, { adminKey: [] }],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
            description: 'Tool UUID',
          },
          {
            name: 'from',
            in: 'query',
            required: true,
            schema: { type: 'integer' },
            description: 'Base version number',
          },
          {
            name: 'to',
            in: 'query',
            required: true,
            schema: { type: 'integer' },
            description: 'Target version number',
          },
        ],
        responses: {
          200: {
            description: 'Comparative version diff payload',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ToolDiffResponse' } } },
          },
          400: {
            description: 'Invalid query parameters',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
          401: {
            description: 'Unauthorized',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
          404: {
            description: 'Tool or version not found',
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
  app.route('/tools', toolsRouter);

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
