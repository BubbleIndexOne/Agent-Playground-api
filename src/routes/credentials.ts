import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { requireAuth } from '../middleware/auth';
import { query } from '../services/database';
import {
  SUPPORTED_MODEL_PROVIDERS,
  SupportedModelProvider,
  SaveModelCredentialSchema,
  validateProviderKeyFormat,
  generateModelCredentialPreview,
  testModelProviderKey,
} from '../schemas/credentials';
import { encryptVaultPayload, decryptVaultPayload } from '../utils/vault';

export const credentialsRouter = new Hono();

function getVaultKey(env: any): string | undefined {
  return (
    env?.VAULT_ENCRYPTION_KEY ||
    env?.PROD_VAULT_ENCRYPTION_KEY ||
    env?.DEV_VAULT_ENCRYPTION_KEY ||
    process.env.VAULT_ENCRYPTION_KEY ||
    process.env.PROD_VAULT_ENCRYPTION_KEY ||
    process.env.DEV_VAULT_ENCRYPTION_KEY
  );
}

// ─── Endpoints ───────────────────────────────────────────────────────────────

/**
 * GET /credentials/models
 * Returns all configured model provider integrations for the authenticated user with metadata and previews.
 * Never touches or decrypts the encrypted payload.
 */
credentialsRouter.get('/models', requireAuth, async (c) => {
  const user = c.get('user');

  const result = await query<{
    id: string;
    provider: string;
    preview: string | null;
    key_version: number;
    last_verified_at: string | null;
    created_at: string;
    updated_at: string;
  }>(
    `SELECT id, connector_type as provider, preview, key_version, last_verified_at, created_at, updated_at
     FROM public.user_connector_credentials
     WHERE user_id = $1 AND kind = 'model_provider'
     ORDER BY connector_type ASC`,
    [user.id]
  );

  return c.json({
    success: true,
    credentials: result.rows,
  });
});

/**
 * PUT /credentials/models/:provider
 * Idempotently saves or replaces an encrypted API key for a model provider.
 * Optional query parameter ?verify=true (defaults to true) tests the key with upstream provider before saving.
 */
credentialsRouter.put('/models/:provider', requireAuth, async (c) => {
  const user = c.get('user');
  const providerParam = c.req.param('provider') as SupportedModelProvider;
  const env = c.env as any;

  if (!SUPPORTED_MODEL_PROVIDERS.includes(providerParam)) {
    throw new HTTPException(400, {
      message: `Unsupported model provider "${providerParam}". Supported providers: ${SUPPORTED_MODEL_PROVIDERS.join(', ')}`,
    });
  }

  const body = await c.req.json().catch(() => ({}));
  const parseResult = SaveModelCredentialSchema.safeParse(body);
  if (!parseResult.success) {
    const errorMsg = parseResult.error.errors[0]?.message || 'Invalid model credentials payload';
    throw new HTTPException(400, { message: errorMsg });
  }

  const { apiKey } = parseResult.data;

  // Format validation
  const formatValidation = validateProviderKeyFormat(providerParam, apiKey);
  if (!formatValidation.valid) {
    throw new HTTPException(400, { message: formatValidation.error || 'Invalid API key format' });
  }

  // Verification check: defaults to true unless explicitly disabled (?verify=false)
  const shouldVerify = c.req.query('verify') !== 'false';
  let lastVerifiedAt: Date | null = null;

  if (shouldVerify) {
    const verification = await testModelProviderKey(providerParam, apiKey);
    if (!verification.ok) {
      throw new HTTPException(400, { message: verification.message });
    }
    lastVerifiedAt = new Date();
  }

  // Generate masked preview
  const preview = generateModelCredentialPreview(providerParam, apiKey);

  // Encrypt payload using AES-GCM with row-bound AAD (userId:kind:provider)
  const vaultKey = getVaultKey(env);
  if (!vaultKey) {
    throw new HTTPException(500, { message: 'Vault encryption key is not configured' });
  }

  const aad = `${user.id}:model_provider:${providerParam}`;
  const encryptedPayload = await encryptVaultPayload(
    JSON.stringify({ apiKey }),
    vaultKey,
    aad
  );

  // Upsert into database
  const result = await query<{
    id: string;
    provider: string;
    preview: string;
    key_version: number;
    last_verified_at: string | null;
    created_at: string;
    updated_at: string;
  }>(
    `INSERT INTO public.user_connector_credentials 
       (user_id, kind, connector_type, encrypted_payload, preview, key_version, last_verified_at, updated_at)
     VALUES ($1, 'model_provider', $2, $3, $4, 1, $5, now())
     ON CONFLICT (user_id, kind, connector_type)
     DO UPDATE SET
       encrypted_payload = excluded.encrypted_payload,
       preview = excluded.preview,
       key_version = excluded.key_version,
       last_verified_at = excluded.last_verified_at,
       updated_at = now()
     RETURNING id, connector_type as provider, preview, key_version, last_verified_at, created_at, updated_at`,
    [user.id, providerParam, encryptedPayload, preview, lastVerifiedAt ? lastVerifiedAt.toISOString() : null]
  );

  const row = result.rows[0];

  return c.json({
    success: true,
    message: `Credentials for ${providerParam} saved successfully`,
    credential: {
      id: row.id,
      provider: row.provider,
      preview: row.preview,
      key_version: row.key_version,
      last_verified_at: row.last_verified_at,
      created_at: row.created_at,
      updated_at: row.updated_at,
    },
  });
});

/**
 * DELETE /credentials/models/:provider
 * Deletes stored credentials for a model provider.
 */
credentialsRouter.delete('/models/:provider', requireAuth, async (c) => {
  const user = c.get('user');
  const providerParam = c.req.param('provider');

  const result = await query<{ id: string; connector_type: string }>(
    `DELETE FROM public.user_connector_credentials
     WHERE user_id = $1 AND kind = 'model_provider' AND connector_type = $2
     RETURNING id, connector_type`,
    [user.id, providerParam]
  );

  if (result.rows.length === 0) {
    throw new HTTPException(404, {
      message: `No credentials configured for model provider "${providerParam}"`,
    });
  }

  return c.json({
    success: true,
    message: `Credentials for ${providerParam} deleted successfully`,
  });
});

/**
 * POST /credentials/models/:provider/test
 * Tests existing stored credentials for a model provider.
 */
credentialsRouter.post('/models/:provider/test', requireAuth, async (c) => {
  const user = c.get('user');
  const providerParam = c.req.param('provider') as SupportedModelProvider;
  const env = c.env as any;

  if (!SUPPORTED_MODEL_PROVIDERS.includes(providerParam)) {
    throw new HTTPException(400, {
      message: `Unsupported model provider "${providerParam}". Supported providers: ${SUPPORTED_MODEL_PROVIDERS.join(', ')}`,
    });
  }

  // Decrypt saved credentials from database
  const saved = await query<{ encrypted_payload: string }>(
    `SELECT encrypted_payload FROM public.user_connector_credentials
     WHERE user_id = $1 AND kind = 'model_provider' AND connector_type = $2 LIMIT 1`,
    [user.id, providerParam]
  );

  if (saved.rows.length === 0) {
    throw new HTTPException(404, {
      message: `No saved credentials found for model provider "${providerParam}"`,
    });
  }

  const vaultKey = getVaultKey(env);
  if (!vaultKey) {
    throw new HTTPException(500, { message: 'Vault encryption key is not configured' });
  }

  let apiKey: string;
  const aad = `${user.id}:model_provider:${providerParam}`;
  try {
    const decrypted = await decryptVaultPayload(saved.rows[0].encrypted_payload, vaultKey, aad);
    const parsed = JSON.parse(decrypted);
    apiKey = parsed.apiKey;
    if (!apiKey) throw new Error('Missing apiKey in decrypted payload');
  } catch {
    throw new HTTPException(400, {
      message: `Failed to decrypt stored credentials for model provider "${providerParam}"`,
    });
  }

  const result = await testModelProviderKey(providerParam, apiKey);

  if (!result.ok) {
    // Clear last_verified_at on failure
    await query(
      `UPDATE public.user_connector_credentials
       SET last_verified_at = NULL, updated_at = now()
       WHERE user_id = $1 AND kind = 'model_provider' AND connector_type = $2`,
      [user.id, providerParam]
    );
    return c.json({ success: false, message: result.message }, 400);
  }

  // Update last_verified_at on success
  await query(
    `UPDATE public.user_connector_credentials
     SET last_verified_at = now(), updated_at = now()
     WHERE user_id = $1 AND kind = 'model_provider' AND connector_type = $2`,
    [user.id, providerParam]
  );

  return c.json({ success: true, message: result.message, details: result.details });
});

