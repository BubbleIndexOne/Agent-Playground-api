import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { requireAuth } from '../middleware/auth';
import { query } from '../services/database';
import { DEFAULT_MODEL_CONFIGS } from '../constants';
import {
  CreateModelPresetSchema,
  UpdateModelPresetSchema,
  ModelConfigSchema,
  toSparseDelta,
  hydrateWithDefaults,
  normalizeModelConfigKeys,
  validateProviderConstraints,
} from '../schemas/modelPresets';

export const modelPresetsRouter = new Hono();

/**
 * GET /model-presets/defaults
 * Returns the centralized baseline model hyperparameter defaults.
 */
modelPresetsRouter.get('/defaults', (c) => {
  return c.json({
    success: true,
    defaults: DEFAULT_MODEL_CONFIGS,
  });
});

/**
 * POST /model-presets
 * Creates a new model preset, storing only the sparse delta in params_json,
 * and returning the fully hydrated configuration.
 */
modelPresetsRouter.post('/', requireAuth, async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => ({}));
  const parseResult = CreateModelPresetSchema.safeParse(body);

  if (!parseResult.success) {
    const errorMsg = parseResult.error.errors[0]?.message || 'Invalid model preset input';
    throw new HTTPException(400, { message: errorMsg });
  }

  const { name, provider, model_id, params = {} } = parseResult.data;

  // 1. Normalize and validate configuration
  const normalizedParams = normalizeModelConfigKeys(params);
  const configParseResult = ModelConfigSchema.safeParse(normalizedParams);
  if (!configParseResult.success) {
    const errorMsg = configParseResult.error.errors[0]?.message || 'Invalid model parameters';
    throw new HTTPException(400, { message: errorMsg });
  }

  try {
    validateProviderConstraints(provider, normalizedParams);
  } catch (err: any) {
    throw new HTTPException(400, { message: err.message });
  }

  // 2. Prune baseline defaults -> store sparse delta
  const sparseDelta = toSparseDelta(normalizedParams);

  // 3. Persist to database
  const result = await query<{
    id: string;
    owner_id: string;
    name: string;
    provider: string;
    model_id: string | null;
    params_json: Record<string, any>;
    is_archived: boolean;
    created_at: string;
    updated_at: string;
  }>(
    `INSERT INTO public.model_presets (owner_id, name, provider, model_id, params_json)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, owner_id, name, provider, model_id, params_json, is_archived, created_at, updated_at`,
    [user.id, name, provider, model_id || null, JSON.stringify(sparseDelta)],
  );

  const row = result.rows[0];

  return c.json(
    {
      success: true,
      message: 'Model preset created successfully',
      preset: {
        id: row.id,
        owner_id: row.owner_id,
        name: row.name,
        provider: row.provider,
        model_id: row.model_id,
        params: hydrateWithDefaults(row.params_json),
        is_archived: row.is_archived,
        created_at: row.created_at,
        updated_at: row.updated_at,
      },
    },
    201,
  );
});

/**
 * GET /model-presets
 * Lists all active model presets for the authenticated user with optional provider/model filters.
 * Returns fully hydrated parameters for every preset.
 */
modelPresetsRouter.get('/', requireAuth, async (c) => {
  const user = c.get('user');
  const providerFilter = c.req.query('provider');
  const modelIdFilter = c.req.query('model_id');

  const conditions: string[] = ['owner_id = $1', 'is_archived = false'];
  const params: any[] = [user.id];

  if (providerFilter && providerFilter.trim() !== '') {
    params.push(providerFilter.trim());
    conditions.push(`(provider = $${params.length} OR provider = 'all')`);
  }

  if (modelIdFilter && modelIdFilter.trim() !== '') {
    params.push(modelIdFilter.trim());
    conditions.push(`(model_id = $${params.length} OR model_id IS NULL)`);
  }

  const sql = `
    SELECT id, owner_id, name, provider, model_id, params_json, is_archived, created_at, updated_at
    FROM public.model_presets
    WHERE ${conditions.join(' AND ')}
    ORDER BY created_at DESC
  `;

  const result = await query<{
    id: string;
    owner_id: string;
    name: string;
    provider: string;
    model_id: string | null;
    params_json: Record<string, any>;
    is_archived: boolean;
    created_at: string;
    updated_at: string;
  }>(sql, params);

  const presets = result.rows.map((row) => ({
    id: row.id,
    owner_id: row.owner_id,
    name: row.name,
    provider: row.provider,
    model_id: row.model_id,
    params: hydrateWithDefaults(row.params_json),
    is_archived: row.is_archived,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));

  return c.json({
    success: true,
    presets,
  });
});

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validatePresetId(presetId: string): void {
  if (!presetId || !UUID_REGEX.test(presetId)) {
    throw new HTTPException(404, { message: `Model preset ${presetId} not found` });
  }
}

/**
 * GET /model-presets/:id
 * Retrieves a single model preset by ID with full hydrated parameters.
 */
modelPresetsRouter.get('/:id', requireAuth, async (c) => {
  const user = c.get('user');
  const presetId = c.req.param('id');
  validatePresetId(presetId);

  const result = await query<{
    id: string;
    owner_id: string;
    name: string;
    provider: string;
    model_id: string | null;
    params_json: Record<string, any>;
    is_archived: boolean;
    created_at: string;
    updated_at: string;
  }>(
    `SELECT id, owner_id, name, provider, model_id, params_json, is_archived, created_at, updated_at
     FROM public.model_presets
     WHERE id = $1 AND owner_id = $2 AND is_archived = false
     LIMIT 1`,
    [presetId, user.id],
  );

  if (result.rows.length === 0) {
    throw new HTTPException(404, { message: `Model preset ${presetId} not found` });
  }

  const row = result.rows[0];

  return c.json({
    success: true,
    preset: {
      id: row.id,
      owner_id: row.owner_id,
      name: row.name,
      provider: row.provider,
      model_id: row.model_id,
      params: hydrateWithDefaults(row.params_json),
      is_archived: row.is_archived,
      created_at: row.created_at,
      updated_at: row.updated_at,
    },
  });
});

/**
 * PATCH /model-presets/:id
 * Updates preset metadata and/or parameters.
 */
modelPresetsRouter.patch('/:id', requireAuth, async (c) => {
  const user = c.get('user');
  const presetId = c.req.param('id');
  validatePresetId(presetId);

  const body = await c.req.json().catch(() => ({}));
  const parseResult = UpdateModelPresetSchema.safeParse(body);

  if (!parseResult.success) {
    const errorMsg = parseResult.error.errors[0]?.message || 'Invalid update payload';
    throw new HTTPException(400, { message: errorMsg });
  }

  const data = parseResult.data;

  // Check existence and ownership
  const check = await query<{ id: string; provider: string; params_json: any }>(
    `SELECT id, provider, params_json FROM public.model_presets
     WHERE id = $1 AND owner_id = $2 AND is_archived = false
     LIMIT 1`,
    [presetId, user.id],
  );

  if (check.rows.length === 0) {
    throw new HTTPException(404, { message: `Model preset ${presetId} not found` });
  }

  const existing = check.rows[0];
  const targetProvider = data.provider || existing.provider;

  const updates: string[] = ['updated_at = now()'];
  const params: any[] = [];

  if (data.name !== undefined) {
    params.push(data.name);
    updates.push(`name = $${params.length}`);
  }

  if (data.provider !== undefined) {
    params.push(data.provider);
    updates.push(`provider = $${params.length}`);
  }

  if (data.model_id !== undefined) {
    params.push(data.model_id);
    updates.push(`model_id = $${params.length}`);
  }

  if (data.is_archived !== undefined) {
    params.push(data.is_archived);
    updates.push(`is_archived = $${params.length}`);
  }

  // If provider changed but params were omitted, validate existing params against targetProvider
  if (data.params === undefined && data.provider !== undefined && data.provider !== existing.provider) {
    const existingDelta =
      typeof existing.params_json === 'string'
        ? JSON.parse(existing.params_json)
        : (existing.params_json || {});
    try {
      validateProviderConstraints(targetProvider, existingDelta);
    } catch (err: any) {
      throw new HTTPException(400, { message: err.message });
    }
  }

  if (data.params !== undefined) {
    const normalized = normalizeModelConfigKeys(data.params);
    const existingDelta =
      typeof existing.params_json === 'string'
        ? JSON.parse(existing.params_json)
        : (existing.params_json || {});

    // Treat incoming null values as delete markers: remove those keys from merged
    const merged: Record<string, any> = { ...existingDelta };
    for (const [key, value] of Object.entries(normalized)) {
      if (value === null) {
        delete merged[key];
      } else {
        merged[key] = value;
      }
    }

    const configParse = ModelConfigSchema.safeParse(merged);
    if (!configParse.success) {
      throw new HTTPException(400, { message: configParse.error.errors[0]?.message });
    }
    try {
      validateProviderConstraints(targetProvider, merged);
    } catch (err: any) {
      throw new HTTPException(400, { message: err.message });
    }

    const sparseDelta = toSparseDelta(merged);
    params.push(JSON.stringify(sparseDelta));
    updates.push(`params_json = $${params.length}`);
  }

  params.push(presetId);
  const idIndex = params.length;
  params.push(user.id);
  const ownerIndex = params.length;

  const result = await query<{
    id: string;
    owner_id: string;
    name: string;
    provider: string;
    model_id: string | null;
    params_json: Record<string, any>;
    is_archived: boolean;
    created_at: string;
    updated_at: string;
  }>(
    `UPDATE public.model_presets
     SET ${updates.join(', ')}
     WHERE id = $${idIndex} AND owner_id = $${ownerIndex} AND is_archived = false
     RETURNING id, owner_id, name, provider, model_id, params_json, is_archived, created_at, updated_at`,
    params,
  );

  if (result.rows.length === 0) {
    throw new HTTPException(404, { message: `Model preset ${presetId} not found` });
  }

  const row = result.rows[0];

  return c.json({
    success: true,
    message: 'Model preset updated successfully',
    preset: {
      id: row.id,
      owner_id: row.owner_id,
      name: row.name,
      provider: row.provider,
      model_id: row.model_id,
      params: hydrateWithDefaults(row.params_json),
      is_archived: row.is_archived,
      created_at: row.created_at,
      updated_at: row.updated_at,
    },
  });
});

/**
 * DELETE /model-presets/:id
 * Soft-deletes a model preset (is_archived = true). Supports ?purge=true for testing.
 */
modelPresetsRouter.delete('/:id', requireAuth, async (c) => {
  const user = c.get('user');
  const presetId = c.req.param('id');
  validatePresetId(presetId);
  const purge = c.req.query('purge') === 'true';

  let result;
  if (purge) {
    result = await query<{ id: string }>(
      `DELETE FROM public.model_presets WHERE id = $1 AND owner_id = $2 RETURNING id`,
      [presetId, user.id],
    );
  } else {
    result = await query<{ id: string }>(
      `UPDATE public.model_presets 
       SET is_archived = true, updated_at = now()
       WHERE id = $1 AND owner_id = $2 AND is_archived = false
       RETURNING id`,
      [presetId, user.id],
    );
  }

  if (result.rows.length === 0) {
    throw new HTTPException(404, { message: `Model preset ${presetId} not found` });
  }

  return c.json({
    success: true,
    message: purge ? 'Model preset purged successfully' : 'Model preset archived successfully',
  });
});
