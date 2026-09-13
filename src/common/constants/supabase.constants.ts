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
