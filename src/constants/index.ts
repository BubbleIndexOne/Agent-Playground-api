// ─── Constants ───────────────────────────────────────────────────────────────

export const AUTH_CONSTANTS = {
  PASSWORD_MIN_LENGTH: 6,
  PROFILES_TABLE: 'profiles',
  BEARER_AUTH_SCHEME_NAME: 'bearer',
  BEARER_AUTH_HEADER_PREFIX: 'Bearer ',
  TAG: 'auth',
} as const;

export const APP_CONSTANTS = {
  DEFAULT_PORT: 3000,
  SWAGGER_DOCS_PATH: '/api/docs',
  SWAGGER_TITLE: 'Agent Playground Backend API',
  SWAGGER_DESCRIPTION:
    'API documentation for Agent Playground backend service (Milestone S1: Authentication)',
  SWAGGER_VERSION: '1.0',
} as const;

export const DATABASE_CONSTANTS = {
  DEFAULT_MAX_POOL_CONNECTIONS: 5,
  DEFAULT_IDLE_TIMEOUT_MS: 30000,
  DEFAULT_CONNECTION_TIMEOUT_MS: 5000,
  DEFAULT_QUERY_TIMEOUT_MS: 5000,
  DEFAULT_STATEMENT_TIMEOUT_MS: 5000,
  MIGRATIONS_TABLE: '_migrations',
  TARGET_ENV_DEV: 'dev',
  TARGET_ENV_PROD: 'prod',
  TARGET_ENV_PRODUCTION: 'production',
  NOW_QUERY: 'SELECT NOW() as current_time',
} as const;

export const HEALTH_CONSTANTS = {
  TAG: 'health',
  STATUS_OK: 'ok',
  STATUS_CONNECTED: 'connected',
  STATUS_UNAVAILABLE: 'unavailable',
} as const;

export const SUPABASE_CONSTANTS = {
  FALLBACK_URL: 'https://placeholder.supabase.co',
  FALLBACK_SERVICE_ROLE_KEY: 'placeholder-key',
  CLIENT_CONFIG: {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  },
} as const;
