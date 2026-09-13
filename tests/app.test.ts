import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/routes/auth', async () => {
  const { Hono } = await import('hono');
  const { HTTPException } = await import('hono/http-exception');
  const authRouter = new Hono();
  authRouter.get('/http-error', () => {
    throw new HTTPException(403, { message: 'Forbidden by test route' });
  });
  authRouter.get('/crash', () => {
    throw new Error('unexpected failure');
  });
  return { authRouter };
});

vi.mock('../src/routes/health', async () => {
  const { Hono } = await import('hono');
  return { healthRouter: new Hono() };
});

import { createApp } from '../src/app';

describe('application factory', () => {
  it('serves an OpenAPI document describing every public route', async () => {
    const response = await createApp().request('/api/openapi.json');
    const spec = await response.json() as any;

    expect(response.status).toBe(200);
    expect(spec).toMatchObject({
      openapi: '3.1.0',
      info: {
        title: 'Agent Playground Backend API',
        version: '1.0',
      },
      components: {
        securitySchemes: {
          bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        },
      },
    });
    expect(Object.keys(spec.paths)).toEqual([
      '/auth/signup',
      '/auth/login',
      '/auth/refresh',
      '/auth/me',
      '/health',
      '/health/db',
    ]);
    expect(spec.paths['/auth/me'].get.security).toEqual([{ bearer: [] }]);
    expect(spec.paths['/auth/signup'].post.responses).toMatchObject({
      201: { description: 'User created; email verification required' },
      500: { description: 'Profile creation failed' },
    });
  });

  it('serves Swagger UI configured to load the OpenAPI document', async () => {
    const response = await createApp().request('/api/docs');
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(html).toContain('/api/openapi.json');
  });

  it('adds permissive CORS headers and handles preflight requests', async () => {
    const response = await createApp().request('/api/openapi.json', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://frontend.example.com',
        'Access-Control-Request-Method': 'GET',
      },
    });

    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.get('access-control-allow-methods')).toContain('GET');
  });

  it('formats HTTP exceptions consistently', async () => {
    const response = await createApp().request('/auth/http-error');

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ statusCode: 403, message: 'Forbidden by test route' });
  });

  it('hides unexpected error details and logs the original error', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const response = await createApp().request('/auth/crash');

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ statusCode: 500, message: 'Internal server error' });
    expect(consoleError).toHaveBeenCalledWith('[Unhandled error]', expect.any(Error));
    consoleError.mockRestore();
  });

  it('returns a method- and path-specific 404 response', async () => {
    const response = await createApp().request('/does-not-exist', { method: 'PATCH' });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      statusCode: 404,
      message: 'Route PATCH /does-not-exist not found',
    });
  });
});
