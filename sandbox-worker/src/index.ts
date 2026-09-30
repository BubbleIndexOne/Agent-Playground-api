export default {
  async fetch(req: Request, env: any) {
    if (req.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    try {
      const { code, args, capabilities } = await req.json<{
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
        if (!capabilities.includes(domain)) {
          throw new Error(`Blocked: ${domain} not declared`);
        }
        return fetch(url, { signal: controller.signal });
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
