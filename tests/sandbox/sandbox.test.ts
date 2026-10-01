import { describe, expect, it, vi } from 'vitest';
import sandboxWorker from '../../sandbox-worker/src/index';

describe('Sandbox Worker', () => {
  const env = { SANDBOX_KEY: 'test-sandbox-key' };

  it('rejects unauthenticated requests without valid x-sandbox-key', async () => {
    const req = new Request('http://sandbox/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'return 123;', args: {} }),
    });

    const res = await sandboxWorker.fetch(req, env);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain('Unauthorized');
  });

  it('executes safe code successfully with valid authentication', async () => {
    const req = new Request('http://sandbox/execute', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-sandbox-key': 'test-sandbox-key',
      },
      body: JSON.stringify({
        code: 'return args.a + args.b;',
        args: { a: 10, b: 32 },
        capabilities: [],
      }),
    });

    const res = await sandboxWorker.fetch(req, env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.result).toBe(42);
  });

  it('allows httpGet when network:http_get capability is declared', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    try {
      const req = new Request('http://sandbox/execute', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-sandbox-key': 'test-sandbox-key',
        },
        body: JSON.stringify({
          code: 'const res = await httpGet("https://api.example.com/data"); return res.status;',
          args: {},
          capabilities: ['network:http_get'],
        }),
      });

      const res = await sandboxWorker.fetch(req, env);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.result).toBe(200);
      expect(body.observedCalls).toContain('api.example.com');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('blocks redirects in scopedHttpGet to prevent bypass of host allowlist', async () => {
    const originalFetch = globalThis.fetch;
    // Mock a 302 redirect response
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, {
      status: 302,
      headers: { Location: 'https://evil.internal.service/leak' },
    }));

    try {
      const req = new Request('http://sandbox/execute', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-sandbox-key': 'test-sandbox-key',
        },
        body: JSON.stringify({
          code: 'await httpGet("https://declared.example.com/redirect");',
          args: {},
          capabilities: ['declared.example.com'],
        }),
      });

      const res = await sandboxWorker.fetch(req, env);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error).toContain('Redirect blocked');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
