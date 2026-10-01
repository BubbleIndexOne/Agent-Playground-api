export default {
  async fetch(req: Request, env: any) {
    if (req.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    const authKey = req.headers.get('x-sandbox-key');
    const expectedKey = env.SANDBOX_KEY || 'agent-playground-internal-sandbox-key';
    if (authKey !== expectedKey) {
      return Response.json({ success: false, error: 'Unauthorized: invalid sandbox key' }, { status: 401 });
    }

    try {
      const { code, args, capabilities = [] } = await req.json<{
        code: string;
        args: Record<string, any>;
        capabilities: string[];
      }>();

      const controller = new AbortController();
      let timeoutId: any;
      const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          controller.abort();
          reject(new Error('Execution timed out after 5000ms'));
        }, 5000);
      });

      const observedCalls: string[] = [];
      const scopedHttpGet = async (url: string) => {
        const domain = new URL(url).hostname;
        observedCalls.push(domain);
        if (!capabilities.includes(domain) && !capabilities.includes('network:http_get')) {
          throw new Error(`Blocked: ${domain} not declared`);
        }
        const response = await fetch(url, { signal: controller.signal, redirect: 'manual' });
        if (response.status >= 300 && response.status < 400) {
          throw new Error(`Redirect blocked: redirect to ${response.headers.get('location') || 'unknown'} is not allowed`);
        }
        return response;
      };

      try {
        const fn = new Function('args', 'httpGet', `return (async () => { ${code} })()`);
        const result = await Promise.race([
          fn(args, scopedHttpGet),
          timeoutPromise,
        ]);
        clearTimeout(timeoutId);
        return Response.json({ success: true, result, observedCalls });
      } catch (err: any) {
        clearTimeout(timeoutId);
        return Response.json({ success: false, error: err.message, observedCalls });
      }
    } catch (err: any) {
      return Response.json({ success: false, error: 'Invalid request: ' + err.message }, { status: 400 });
    }
  }
};
