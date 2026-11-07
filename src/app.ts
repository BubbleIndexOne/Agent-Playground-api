import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import { swaggerUI } from '@hono/swagger-ui';
import { authRouter } from './routes/auth';
import { healthRouter } from './routes/health';
import { toolsRouter } from './routes/tools';
import { connectorsRouter } from './routes/connectors';
import { modelPresetsRouter } from './routes/modelPresets';
import { credentialsRouter } from './routes/credentials';
import { llmProxyRouter } from './routes/llmProxy';
import { adminMcpRouter } from './routes/adminMcp';
import { internalMcpRouter } from './routes/internalMcp';
import { marketplaceRouter } from './routes/marketplace';
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
      ToolRegisterInput: {
        type: 'object',
        properties: {
          inputs: {
            type: 'object',
            description: 'Optional custom inputs matching tool schema to test against in the sandbox',
            example: { url: 'https://example.com' },
          },
        },
      },
      ToolRegistrationResponse: {
        type: 'object',
        required: ['success', 'message', 'testResults'],
        properties: {
          success: { type: 'boolean', example: true },
          message: { type: 'string', example: 'Tool successfully registered' },
          testResults: {
            type: 'object',
            required: ['status', 'timestamp'],
            properties: {
              status: { type: 'string', enum: ['passed', 'failed'], example: 'passed' },
              result: { type: 'object', nullable: true },
              observedCalls: { type: 'array', items: { type: 'string' }, example: ['fetch'] },
              durationMs: { type: 'integer', example: 120 },
              inputsUsed: { type: 'object' },
              timestamp: { type: 'string', format: 'date-time' },
              reason: { type: 'string', nullable: true },
              details: { type: 'object', nullable: true },
            },
          },
        },
      },
      PostgresCredentials: {
        type: 'object',
        required: ['host', 'database', 'user', 'password'],
        properties: {
          host: { type: 'string', example: 'postgres.example.com' },
          port: { type: 'integer', default: 5432, example: 5432 },
          database: { type: 'string', example: 'analytics' },
          user: { type: 'string', example: 'agent_user' },
          password: { type: 'string', example: 'P@ssw0rd123' },
          ssl: { type: 'boolean', default: true, example: true },
        },
      },
      SlackCredentials: {
        type: 'object',
        required: ['botToken'],
        properties: {
          botToken: { type: 'string', example: 'xoxb-1234567890-abcdefgh' },
          signingSecret: { type: 'string', example: 'a1b2c3d4e5f6' },
        },
      },
      ConnectorItem: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          connector_type: { type: 'string', example: 'postgres' },
          preview: { type: 'string', example: 'agent_user@postgres.example.com:5432/analytics' },
          key_version: { type: 'integer', example: 1 },
          created_at: { type: 'string', format: 'date-time' },
          updated_at: { type: 'string', format: 'date-time' },
        },
      },
      ModelPresetItem: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          owner_id: { type: 'string', format: 'uuid' },
          name: { type: 'string', example: 'Creative Writer' },
          provider: { type: 'string', example: 'anthropic' },
          model_id: { type: 'string', nullable: true, example: 'claude-3-5-sonnet-20240620' },
          params: {
            type: 'object',
            properties: {
              temperature: { type: 'number', example: 0.8 },
              topP: { type: 'number', example: 1.0 },
              topK: { type: 'integer', example: 40 },
              presencePenalty: { type: 'number', example: 0.0 },
              frequencyPenalty: { type: 'number', example: 0.0 },
              maxOutputTokens: { type: 'integer', example: 4096 },
              seed: { type: 'integer', example: 123 },
              stopSequences: { type: 'array', items: { type: 'string' } },
              reasoning: { type: 'string', example: 'high' },
              toolChoice: { type: 'string', example: 'auto' },
            },
          },
          is_archived: { type: 'boolean', example: false },
          created_at: { type: 'string', format: 'date-time' },
          updated_at: { type: 'string', format: 'date-time' },
        },
      },
      CreateModelPresetInput: {
        type: 'object',
        required: ['name', 'provider'],
        properties: {
          name: { type: 'string', example: 'Creative Writer' },
          provider: { type: 'string', example: 'anthropic' },
          model_id: { type: 'string', nullable: true, example: 'claude-3-5-sonnet-20240620' },
          params: { type: 'object' },
        },
      },
      UpdateModelPresetInput: {
        type: 'object',
        properties: {
          name: { type: 'string', example: 'Updated Preset Name' },
          provider: { type: 'string', example: 'openai' },
          model_id: { type: 'string', nullable: true, example: 'gpt-4o' },
          params: { type: 'object' },
          is_archived: { type: 'boolean', example: false },
        },
      },
      ModelCredentialItem: {
        type: 'object',
        required: ['id', 'provider', 'key_version', 'created_at', 'updated_at'],
        properties: {
          id: { type: 'string', format: 'uuid', example: 'd0b84df4-82a1-43ee-b14d-9a9be51ea972' },
          provider: { type: 'string', enum: ['anthropic', 'openai', 'google'], example: 'anthropic' },
          preview: { type: 'string', nullable: true, example: 'sk-ant-••••a3f9' },
          key_version: { type: 'integer', example: 1 },
          last_verified_at: { type: 'string', format: 'date-time', nullable: true, example: '2026-11-01T12:00:00.000Z' },
          created_at: { type: 'string', format: 'date-time', example: '2026-11-01T11:00:00.000Z' },
          updated_at: { type: 'string', format: 'date-time', example: '2026-11-01T12:00:00.000Z' },
        },
      },
      SaveModelCredential: {
        type: 'object',
        required: ['apiKey'],
        properties: {
          apiKey: { type: 'string', example: 'sk-ant-api03-abcdef1234567890' },
        },
      },
      MarketplaceToolAuthor: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          handle: { type: 'string', nullable: true, example: 'alice' },
          display_name: { type: 'string', example: 'Alice Developer' },
        },
      },
      MarketplaceToolSummary: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string', example: 'Web Scraper' },
          description: { type: 'string', nullable: true, example: 'Extracts clean data from HTML pages' },
          slug: { type: 'string', nullable: true, example: 'alice/web-scraper' },
          type: { type: 'string', enum: ['client', 'mcp'] },
          connector_type: { type: 'string', nullable: true },
          tags: { type: 'array', items: { type: 'string' } },
          install_count: { type: 'integer', example: 42 },
          is_installed: { type: 'boolean', example: false },
          allow_client_execution: { type: 'boolean', example: true },
          is_mcp_hosted: { type: 'boolean', example: false },
          mcp_hosting_status: { type: 'string', enum: ['none', 'requested', 'in_review', 'approved', 'rejected'] },
          author: { $ref: '#/components/schemas/MarketplaceToolAuthor' },
          requires_connector: { type: 'string', nullable: true },
          has_connector_configured: { type: 'boolean', example: false },
          capabilities: { type: 'array', items: { type: 'string' } },
          created_at: { type: 'string', format: 'date-time' },
          updated_at: { type: 'string', format: 'date-time' },
        },
      },
      MarketplaceToolsResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          tools: {
            type: 'array',
            items: { $ref: '#/components/schemas/MarketplaceToolSummary' },
          },
          pagination: {
            type: 'object',
            properties: {
              limit: { type: 'integer', example: 20 },
              has_more: { type: 'boolean', example: false },
              next_cursor: { type: 'string', nullable: true },
            },
          },
        },
      },
      MarketplaceToolDetail: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string', example: 'Web Scraper' },
          description: { type: 'string', nullable: true },
          slug: { type: 'string', nullable: true },
          type: { type: 'string' },
          connector_type: { type: 'string', nullable: true },
          tags: { type: 'array', items: { type: 'string' } },
          install_count: { type: 'integer' },
          is_installed: { type: 'boolean' },
          pinned_version_number: { type: 'integer', nullable: true },
          allow_client_execution: { type: 'boolean' },
          is_mcp_hosted: { type: 'boolean' },
          mcp_hosting_status: { type: 'string' },
          author: { $ref: '#/components/schemas/MarketplaceToolAuthor' },
          requires_connector: { type: 'string', nullable: true },
          has_connector_configured: { type: 'boolean' },
          current_version: {
            type: 'object',
            properties: {
              version_number: { type: 'integer' },
              schema_json: { type: 'object' },
              capabilities_json: { type: 'array', items: { type: 'string' } },
              code_hash: { type: 'string' },
              test_results_json: { type: 'object', nullable: true },
            },
          },
          versions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', format: 'uuid' },
                version_number: { type: 'integer' },
                schema_json: { type: 'object' },
                capabilities_json: { type: 'array', items: { type: 'string' } },
                code_hash: { type: 'string' },
                created_at: { type: 'string', format: 'date-time' },
              },
            },
          },
        },
      },
      InstallToolInput: {
        type: 'object',
        properties: {
          version_id: { type: 'string', format: 'uuid' },
        },
      },
      ToolReportInput: {
        type: 'object',
        required: ['reason'],
        properties: {
          reason: { type: 'string', enum: ['malicious', 'broken', 'spam', 'other'] },
          details: { type: 'string', maxLength: 1000 },
        },
      },
      ToolMcpRequestResponse: {
        type: 'object',
        required: ['success', 'message', 'tool'],
        properties: {
          success: { type: 'boolean', example: true },
          message: { type: 'string', example: 'Tool submitted for MCP server hosting evaluation' },
          tool: { type: 'object' },
        },
      },
      ToolInstallResponse: {
        type: 'object',
        required: ['success', 'message', 'install'],
        properties: {
          success: { type: 'boolean', example: true },
          message: { type: 'string', example: 'Tool installed successfully' },
          install: { type: 'object' },
        },
      },
      ToolUninstallResponse: {
        type: 'object',
        required: ['success', 'message'],
        properties: {
          success: { type: 'boolean', example: true },
          message: { type: 'string', example: 'Tool successfully uninstalled' },
        },
      },
      ToolForkResponse: {
        type: 'object',
        required: ['success', 'message', 'tool'],
        properties: {
          success: { type: 'boolean', example: true },
          message: { type: 'string', example: 'Tool successfully forked' },
          tool: { type: 'object' },
        },
      },
      ToolReportResponse: {
        type: 'object',
        required: ['success', 'reported', 'status', 'message'],
        properties: {
          success: { type: 'boolean', example: true },
          reported: { type: 'boolean', example: true },
          status: { type: 'string', example: 'received' },
          message: { type: 'string', example: 'Report submitted successfully' },
        },
      },
      AdminMcpQueueResponse: {
        type: 'object',
        required: ['success', 'count', 'queue'],
        properties: {
          success: { type: 'boolean', example: true },
          count: { type: 'integer', example: 1 },
          queue: { type: 'array', items: { type: 'object' } },
        },
      },
      AdminMcpActionResponse: {
        type: 'object',
        required: ['success', 'message', 'tool'],
        properties: {
          success: { type: 'boolean', example: true },
          message: { type: 'string', example: 'Tool promoted to MCP server' },
          tool: { type: 'object' },
        },
      },
      InternalMcpToolsResponse: {
        type: 'object',
        required: ['success', 'count', 'tools'],
        properties: {
          success: { type: 'boolean', example: true },
          count: { type: 'integer', example: 1 },
          tools: { type: 'array', items: { type: 'object' } },
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
          {
            name: 'purge',
            in: 'query',
            required: false,
            schema: { type: 'boolean' },
            description: 'Admin only: permanently purge tool and its versions from the database',
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
    '/tools/{id}/register': {
      post: {
        tags: ['tools'],
        summary: 'Run automated sandbox registration audit for client tool',
        description: 'Validates schema consistency, generates test inputs, and executes client tool code inside isolated Cloudflare Sandbox Worker to transition status from draft to registered.',
        security: [{ bearer: [] }],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
            description: 'Tool UUID to register',
          },
        ],
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ToolRegisterInput' },
            },
          },
        },
        responses: {
          200: {
            description: 'Tool registered successfully',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ToolRegistrationResponse' },
              },
            },
          },
          400: {
            description: 'Registration rejected (schema mismatch, runtime exception, or capability violation)',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ToolRegistrationResponse' },
              },
            },
          },
          401: {
            description: 'Unauthorized',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
          403: {
            description: 'Forbidden: only tool owner can initiate registration',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
          404: {
            description: 'Tool not found or missing version',
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
    '/connectors': {
      get: {
        tags: ['connectors'],
        summary: 'List configured connector integrations (metadata & previews only)',
        security: [{ bearer: [] }],
        responses: {
          200: {
            description: 'List of configured connectors',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    connectors: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/ConnectorItem' },
                    },
                  },
                },
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
    '/connectors/{type}/credentials': {
      put: {
        tags: ['connectors'],
        summary: 'Upsert encrypted connector credentials',
        description: 'Idempotently stores credentials in AES-GCM encrypted vault. Pass ?verify=true to test connection before persisting.',
        security: [{ bearer: [] }],
        parameters: [
          {
            name: 'type',
            in: 'path',
            required: true,
            schema: { type: 'string', enum: ['postgres', 'slack'] },
            description: 'Connector type identifier',
          },
          {
            name: 'verify',
            in: 'query',
            required: false,
            schema: { type: 'boolean' },
            description: 'Optional flag to test connection before saving',
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                oneOf: [
                  { $ref: '#/components/schemas/PostgresCredentials' },
                  { $ref: '#/components/schemas/SlackCredentials' },
                ],
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Credentials saved successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    message: { type: 'string', example: 'Credentials for postgres saved successfully' },
                    connector: { $ref: '#/components/schemas/ConnectorItem' },
                  },
                },
              },
            },
          },
          400: {
            description: 'Validation or verification error',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
          401: {
            description: 'Unauthorized',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
        },
      },
      delete: {
        tags: ['connectors'],
        summary: 'Delete connector credentials',
        security: [{ bearer: [] }],
        parameters: [
          {
            name: 'type',
            in: 'path',
            required: true,
            schema: { type: 'string', enum: ['postgres', 'slack'] },
            description: 'Connector type identifier',
          },
        ],
        responses: {
          200: {
            description: 'Credentials deleted successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    message: { type: 'string', example: 'Credentials for postgres deleted successfully' },
                  },
                },
              },
            },
          },
          404: {
            description: 'Connector credentials not found',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
        },
      },
    },
    '/connectors/{type}/test': {
      post: {
        tags: ['connectors'],
        summary: 'Test connector connection with supplied or stored credentials',
        security: [{ bearer: [] }],
        parameters: [
          {
            name: 'type',
            in: 'path',
            required: true,
            schema: { type: 'string', enum: ['postgres', 'slack'] },
          },
        ],
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: {
                oneOf: [
                  { $ref: '#/components/schemas/PostgresCredentials' },
                  { $ref: '#/components/schemas/SlackCredentials' },
                ],
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Connection test passed',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    message: { type: 'string', example: 'Slack connection verified successfully' },
                  },
                },
              },
            },
          },
          400: {
            description: 'Connection test failed',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
        },
      },
    },
    '/model-presets/defaults': {
      get: {
        tags: ['model-presets'],
        summary: 'Get system-wide baseline hyperparameter defaults',
        responses: {
          200: {
            description: 'Baseline model hyperparameter defaults',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    defaults: { type: 'object' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/model-presets': {
      get: {
        tags: ['model-presets'],
        summary: 'List active model presets for authenticated user',
        security: [{ bearer: [] }],
        parameters: [
          {
            name: 'provider',
            in: 'query',
            required: false,
            schema: { type: 'string' },
            description: 'Optional filter by provider (e.g. anthropic, openai)',
          },
          {
            name: 'model_id',
            in: 'query',
            required: false,
            schema: { type: 'string' },
            description: 'Optional filter by model ID',
          },
        ],
        responses: {
          200: {
            description: 'List of model presets with fully hydrated parameters',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    presets: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/ModelPresetItem' },
                    },
                  },
                },
              },
            },
          },
          401: {
            description: 'Unauthorized',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
        },
      },
      post: {
        tags: ['model-presets'],
        summary: 'Create a new model preset',
        description: 'Stores only the sparse delta in database and returns full hydrated configuration.',
        security: [{ bearer: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/CreateModelPresetInput' },
            },
          },
        },
        responses: {
          201: {
            description: 'Model preset created successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    message: { type: 'string', example: 'Model preset created successfully' },
                    preset: { $ref: '#/components/schemas/ModelPresetItem' },
                  },
                },
              },
            },
          },
          400: {
            description: 'Validation error',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
        },
      },
    },
    '/model-presets/{id}': {
      get: {
        tags: ['model-presets'],
        summary: 'Get single model preset by ID',
        security: [{ bearer: [] }],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        responses: {
          200: {
            description: 'Model preset details with hydrated configuration',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    preset: { $ref: '#/components/schemas/ModelPresetItem' },
                  },
                },
              },
            },
          },
          404: {
            description: 'Preset not found',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
        },
      },
      patch: {
        tags: ['model-presets'],
        summary: 'Update model preset metadata and parameters',
        security: [{ bearer: [] }],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/UpdateModelPresetInput' },
            },
          },
        },
        responses: {
          200: {
            description: 'Preset updated successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    message: { type: 'string', example: 'Model preset updated successfully' },
                    preset: { $ref: '#/components/schemas/ModelPresetItem' },
                  },
                },
              },
            },
          },
          404: {
            description: 'Preset not found',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
        },
      },
      delete: {
        tags: ['model-presets'],
        summary: 'Delete or archive a model preset',
        security: [{ bearer: [] }],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
          {
            name: 'purge',
            in: 'query',
            required: false,
            schema: { type: 'boolean' },
            description: 'Permanently purge preset from database instead of soft-archiving',
          },
        ],
        responses: {
          200: {
            description: 'Preset deleted successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    message: { type: 'string', example: 'Model preset archived successfully' },
                  },
                },
              },
            },
          },
          404: {
            description: 'Preset not found',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
        },
      },
    },
    '/credentials/models': {
      get: {
        tags: ['credentials'],
        summary: 'List configured model provider credentials for user',
        security: [{ bearer: [] }],
        responses: {
          200: {
            description: 'List of configured model provider credentials with previews',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    credentials: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/ModelCredentialItem' },
                    },
                  },
                },
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
    '/credentials/models/{provider}': {
      put: {
        tags: ['credentials'],
        summary: 'Save or update model provider API key in encrypted vault',
        security: [{ bearer: [] }],
        parameters: [
          {
            name: 'provider',
            in: 'path',
            required: true,
            schema: { type: 'string', enum: ['anthropic', 'openai', 'google'] },
          },
          {
            name: 'verify',
            in: 'query',
            required: false,
            schema: { type: 'boolean', default: true },
            description: 'Verify key against upstream provider before saving',
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/SaveModelCredential' },
            },
          },
        },
        responses: {
          200: {
            description: 'Credentials saved successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    message: { type: 'string', example: 'Credentials for anthropic saved successfully' },
                    credential: { $ref: '#/components/schemas/ModelCredentialItem' },
                  },
                },
              },
            },
          },
          400: {
            description: 'Invalid key or upstream verification failed',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
          401: {
            description: 'Unauthorized',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
        },
      },
      delete: {
        tags: ['credentials'],
        summary: 'Delete saved model provider API key from vault',
        security: [{ bearer: [] }],
        parameters: [
          {
            name: 'provider',
            in: 'path',
            required: true,
            schema: { type: 'string', enum: ['anthropic', 'openai', 'google'] },
          },
        ],
        responses: {
          200: {
            description: 'Credentials deleted successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    message: { type: 'string', example: 'Credentials for anthropic deleted successfully' },
                  },
                },
              },
            },
          },
          404: {
            description: 'No credentials found for provider',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
        },
      },
    },
    '/credentials/models/{provider}/test': {
      post: {
        tags: ['credentials'],
        summary: 'Test saved model provider credentials against upstream API',
        security: [{ bearer: [] }],
        parameters: [
          {
            name: 'provider',
            in: 'path',
            required: true,
            schema: { type: 'string', enum: ['anthropic', 'openai', 'google'] },
          },
        ],
        responses: {
          200: {
            description: 'Credentials verified successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    message: { type: 'string', example: 'Anthropic API key verified successfully' },
                  },
                },
              },
            },
          },
          400: {
            description: 'Verification failed or decryption error',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
          404: {
            description: 'No saved credentials found for provider',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
        },
      },
    },
    '/llm/{provider}/*': {
      post: {
        tags: ['llm-proxy'],
        summary: 'Forward requests to LLM provider with just-in-time injected API key',
        security: [{ bearer: [] }],
        parameters: [
          {
            name: 'provider',
            in: 'path',
            required: true,
            schema: { type: 'string', enum: ['anthropic', 'openai', 'google'] },
          },
        ],
        responses: {
          200: {
            description: 'Streamed upstream response from model provider',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  description: 'Upstream raw JSON or event stream output',
                },
              },
            },
          },
          403: {
            description: 'Path not in provider allowlist',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
          404: {
            description: 'No credentials configured for provider',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
        },
      },
    },
    '/tools/{id}/mcp-request': {
      post: {
        tags: ['tools'],
        summary: 'Submit a tool for MCP server hosting evaluation by admin automations',
        security: [{ bearer: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          200: {
            description: 'Tool submitted for MCP server hosting',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ToolMcpRequestResponse' } } },
          },
          400: {
            description: 'Invalid tool state or already requested',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
          403: {
            description: 'Permission denied',
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
        summary: 'Withdraw a pending MCP server hosting request',
        security: [{ bearer: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          200: {
            description: 'Request withdrawn',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ToolMcpRequestResponse' } } },
          },
          400: {
            description: 'Tool already active on MCP server',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
          403: {
            description: 'Permission denied',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
          404: {
            description: 'Tool not found',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
        },
      },
    },
    '/marketplace/tools': {
      get: {
        tags: ['marketplace'],
        summary: 'List and search public community tools (never exposes source code)',
        parameters: [
          { name: 'q', in: 'query', schema: { type: 'string' }, description: 'Full-text search query' },
          { name: 'type', in: 'query', schema: { type: 'string', enum: ['client', 'mcp'] } },
          { name: 'connector', in: 'query', schema: { type: 'string' } },
          { name: 'tag', in: 'query', schema: { type: 'string' } },
          { name: 'hosting_tier', in: 'query', schema: { type: 'string', enum: ['client', 'mcp'] } },
          { name: 'sort', in: 'query', schema: { type: 'string', enum: ['popular', 'recent', 'name'], default: 'popular' } },
          { name: 'cursor', in: 'query', schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
        ],
        responses: {
          200: {
            description: 'List of marketplace tools',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/MarketplaceToolsResponse' } } },
          },
        },
      },
    },
    '/marketplace/tools/{idOrSlug}': {
      get: {
        tags: ['marketplace'],
        summary: 'Get marketplace tool details and version metadata by UUID or author/slug',
        parameters: [{ name: 'idOrSlug', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: {
            description: 'Tool details',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/MarketplaceToolDetail' } } },
          },
          404: {
            description: 'Tool not found in marketplace',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
        },
      },
    },
    '/marketplace/tools/{id}/install': {
      post: {
        tags: ['marketplace'],
        summary: 'Install and pin a tool to caller workspace',
        security: [{ bearer: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: {
          content: { 'application/json': { schema: { $ref: '#/components/schemas/InstallToolInput' } } },
        },
        responses: {
          200: {
            description: 'Tool installed successfully',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ToolInstallResponse' } } },
          },
          400: {
            description: 'Tool has no registered version',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
          404: {
            description: 'Tool not found',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
        },
      },
      delete: {
        tags: ['marketplace'],
        summary: 'Uninstall a tool from caller workspace',
        security: [{ bearer: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          200: {
            description: 'Tool uninstalled successfully',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ToolUninstallResponse' } } },
          },
          404: {
            description: 'Tool not installed in account',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
        },
      },
    },
    '/marketplace/tools/{id}/fork': {
      post: {
        tags: ['marketplace'],
        summary: 'Fork an open-source client tool into caller workspace',
        security: [{ bearer: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          201: {
            description: 'Tool successfully forked',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ToolForkResponse' } } },
          },
          400: {
            description: 'Source code not available for forking',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
          403: {
            description: 'Protected tools cannot be forked',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
          404: {
            description: 'Tool not found',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
        },
      },
    },
    '/marketplace/tools/{id}/report': {
      post: {
        tags: ['marketplace'],
        summary: 'Report a broken or malicious tool (triggers auto-hold at threshold)',
        security: [{ bearer: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ToolReportInput' } } },
        },
        responses: {
          200: {
            description: 'Report filed successfully',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ToolReportResponse' } } },
          },
          400: {
            description: 'Invalid input',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
          404: {
            description: 'Tool not found',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
          409: {
            description: 'Open report already pending for this tool',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
        },
      },
    },
    '/admin/mcp/queue': {
      get: {
        tags: ['admin-mcp'],
        summary: 'Get queue of tools awaiting MCP promotion (Admin Key Only)',
        security: [{ adminKey: [] }],
        responses: {
          200: {
            description: 'MCP promotion review queue',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/AdminMcpQueueResponse' } } },
          },
          401: {
            description: 'Valid x-admin-key header required',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
        },
      },
    },
    '/admin/mcp/{id}/promote': {
      post: {
        tags: ['admin-mcp'],
        summary: 'Promote a tool to the MCP server hosting pool (Admin Key Only)',
        security: [{ adminKey: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          200: {
            description: 'Tool promoted to MCP server',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/AdminMcpActionResponse' } } },
          },
          401: {
            description: 'Valid x-admin-key header required',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
          404: {
            description: 'Tool not found',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
        },
      },
    },
    '/admin/mcp/{id}/reject': {
      post: {
        tags: ['admin-mcp'],
        summary: 'Reject an MCP server hosting request (Admin Key Only)',
        security: [{ adminKey: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: { reason: { type: 'string', example: 'Failed security checks' } },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Tool hosting request rejected',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/AdminMcpActionResponse' } } },
          },
          401: {
            description: 'Valid x-admin-key header required',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
          404: {
            description: 'Tool not found',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
        },
      },
    },
    '/internal/mcp/tools': {
      get: {
        tags: ['internal-mcp'],
        summary: 'Sync promoted tools for Agent-Playground-MCP daemon',
        security: [{ adminKey: [] }],
        responses: {
          200: {
            description: 'List of active MCP hosted tools with source code',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/InternalMcpToolsResponse' } } },
          },
          401: {
            description: 'Internal secret or admin key required',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
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
  app.route('/connectors', connectorsRouter);
  app.route('/model-presets', modelPresetsRouter);
  app.route('/credentials', credentialsRouter);
  app.route('/llm', llmProxyRouter);
  app.route('/admin/mcp', adminMcpRouter);
  app.route('/internal/mcp', internalMcpRouter);
  app.route('/marketplace', marketplaceRouter);

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
