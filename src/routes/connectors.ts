import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { requireAuth } from '../middleware/auth';
import { query } from '../services/database';
import {
  CONNECTOR_SCHEMAS,
  generateConnectorPreview,
  SUPPORTED_CONNECTOR_TYPES,
  SupportedConnectorType,
} from '../schemas/connectors';
import { encryptVaultPayload, decryptVaultPayload } from '../utils/vault';

export const connectorsRouter = new Hono();

// Helper to verify connection for supported connectors
async function testConnectorConnection(
  type: SupportedConnectorType,
  data: Record<string, any>,
): Promise<{ ok: boolean; message: string; details?: any }> {
  if (type === 'slack') {
    try {
      const res = await fetch('https://slack.com/api/auth.test', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${data.botToken}`,
          'Content-Type': 'application/json',
        },
      });
      const body: any = await res.json().catch(() => ({}));
      if (body.ok) {
        return {
          ok: true,
          message: 'Slack connection verified successfully',
          details: { team: body.team, user: body.user, team_id: body.team_id },
        };
      }
      return { ok: false, message: `Slack verification failed: ${body.error || 'invalid_auth'}` };
    } catch (err: any) {
      return { ok: false, message: `Failed to contact Slack API: ${err.message}` };
    }
  }

  if (type === 'postgres') {
    // In edge runtime without Hyperdrive or sockets for arbitrary hosts, validate basic connectivity inputs
    if (!data.host || !data.database || !data.user || !data.password) {
      return { ok: false, message: 'Incomplete postgres parameters' };
    }
    return { ok: true, message: 'Postgres credential structure validated' };
  }

  return { ok: true, message: 'Configuration validated' };
}

// ─── Endpoints ───────────────────────────────────────────────────────────────

/**
 * GET /connectors
 * Returns all configured connector integrations for the authenticated user with metadata and previews.
 * Never touches or decrypts the encrypted payload.
 */
connectorsRouter.get('/', requireAuth, async (c) => {
  const user = c.get('user');

  const result = await query<{
    id: string;
    connector_type: string;
    preview: string | null;
    key_version: number;
    created_at: string;
    updated_at: string;
  }>(
    `SELECT id, connector_type, preview, key_version, created_at, updated_at
     FROM public.user_connector_credentials
     WHERE user_id = $1
     ORDER BY connector_type ASC`,
    [user.id],
  );

  return c.json({
    success: true,
    connectors: result.rows,
  });
});

/**
 * PUT /connectors/:type/credentials
 * Idempotently creates or replaces encrypted credentials for a given connector type.
 * Optional query parameter ?verify=true tests connection before committing to storage.
 */
connectorsRouter.put('/:type/credentials', requireAuth, async (c) => {
  const user = c.get('user');
  const typeParam = c.req.param('type') as SupportedConnectorType;
  const env = c.env as any;

  if (!SUPPORTED_CONNECTOR_TYPES.includes(typeParam)) {
    throw new HTTPException(400, {
      message: `Unsupported connector type "${typeParam}". Supported types: ${SUPPORTED_CONNECTOR_TYPES.join(', ')}`,
    });
  }

  const schema = CONNECTOR_SCHEMAS[typeParam];
  const body = await c.req.json().catch(() => ({}));
  const parseResult = schema.safeParse(body);

  if (!parseResult.success) {
    const errorMsg = parseResult.error.errors[0]?.message || 'Invalid connector credentials payload';
    throw new HTTPException(400, { message: errorMsg });
  }

  const validatedData = parseResult.data;

  // Optional connection test verification on save
  const shouldVerify = c.req.query('verify') === 'true';
  if (shouldVerify) {
    const verification = await testConnectorConnection(typeParam, validatedData);
    if (!verification.ok) {
      throw new HTTPException(400, { message: verification.message });
    }
  }

  // Generate sanitized preview
  const preview = generateConnectorPreview(typeParam, validatedData);

  // Encrypt payload using AES-GCM vault master key
  const vaultKey = env.VAULT_ENCRYPTION_KEY;
  const encryptedPayload = await encryptVaultPayload(JSON.stringify(validatedData), vaultKey);

  // Upsert into database
  const result = await query<{
    id: string;
    connector_type: string;
    preview: string;
    key_version: number;
    created_at: string;
    updated_at: string;
  }>(
    `INSERT INTO public.user_connector_credentials 
       (user_id, connector_type, encrypted_payload, preview, key_version, updated_at)
     VALUES ($1, $2, $3, $4, 1, now())
     ON CONFLICT (user_id, connector_type)
     DO UPDATE SET
       encrypted_payload = excluded.encrypted_payload,
       preview = excluded.preview,
       key_version = excluded.key_version,
       updated_at = now()
     RETURNING id, connector_type, preview, key_version, created_at, updated_at`,
    [user.id, typeParam, encryptedPayload, preview],
  );

  const row = result.rows[0];

  return c.json({
    success: true,
    message: `Credentials for ${typeParam} saved successfully`,
    connector: {
      id: row.id,
      connector_type: row.connector_type,
      preview: row.preview,
      key_version: row.key_version,
      created_at: row.created_at,
      updated_at: row.updated_at,
    },
  });
});

/**
 * DELETE /connectors/:type/credentials
 * Deletes credentials for a given connector type.
 */
connectorsRouter.delete('/:type/credentials', requireAuth, async (c) => {
  const user = c.get('user');
  const typeParam = c.req.param('type');

  const result = await query<{ id: string; connector_type: string }>(
    `DELETE FROM public.user_connector_credentials
     WHERE user_id = $1 AND connector_type = $2
     RETURNING id, connector_type`,
    [user.id, typeParam],
  );

  if (result.rows.length === 0) {
    throw new HTTPException(404, {
      message: `No credentials configured for connector type "${typeParam}"`,
    });
  }

  return c.json({
    success: true,
    message: `Credentials for ${typeParam} deleted successfully`,
  });
});

/**
 * POST /connectors/:type/test
 * Tests connection with either provided credentials or already saved credentials.
 */
connectorsRouter.post('/:type/test', requireAuth, async (c) => {
  const user = c.get('user');
  const typeParam = c.req.param('type') as SupportedConnectorType;
  const env = c.env as any;

  if (!SUPPORTED_CONNECTOR_TYPES.includes(typeParam)) {
    throw new HTTPException(400, {
      message: `Unsupported connector type "${typeParam}". Supported types: ${SUPPORTED_CONNECTOR_TYPES.join(', ')}`,
    });
  }

  let credentialsData: Record<string, any>;
  const body = await c.req.json().catch(() => ({}));

  if (body && Object.keys(body).length > 0) {
    const parseResult = CONNECTOR_SCHEMAS[typeParam].safeParse(body);
    if (!parseResult.success) {
      const errorMsg = parseResult.error.errors[0]?.message || 'Invalid test payload';
      throw new HTTPException(400, { message: errorMsg });
    }
    credentialsData = parseResult.data;
  } else {
    // Decrypt saved credentials from database
    const saved = await query<{ encrypted_payload: string }>(
      `SELECT encrypted_payload FROM public.user_connector_credentials
       WHERE user_id = $1 AND connector_type = $2 LIMIT 1`,
      [user.id, typeParam],
    );
    if (saved.rows.length === 0) {
      throw new HTTPException(404, {
        message: `No credentials found to test for connector "${typeParam}". Please supply credentials in the request body.`,
      });
    }
    const decrypted = await decryptVaultPayload(saved.rows[0].encrypted_payload, env.VAULT_ENCRYPTION_KEY);
    credentialsData = JSON.parse(decrypted);
  }

  const result = await testConnectorConnection(typeParam, credentialsData);
  if (!result.ok) {
    return c.json({ success: false, message: result.message }, 400);
  }

  return c.json({ success: true, message: result.message, details: result.details });
});
