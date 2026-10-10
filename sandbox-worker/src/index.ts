import { getQuickJS } from 'quickjs-emscripten';

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
        const QuickJS = await getQuickJS();
        const vm = QuickJS.newContext();

        const hostHttpGetHandle = vm.newFunction("hostHttpGet", (urlHandle) => {
          const url = vm.getString(urlHandle);
          const promise = vm.newPromise();
          
          scopedHttpGet(url).then(async (response) => {
            const body = await response.text();
            const resultStr = JSON.stringify({
              status: response.status,
              statusText: response.statusText,
              body: body
            });
            const resHandle = vm.newString(resultStr);
            promise.resolve(resHandle);
            resHandle.dispose();
            promise.dispose();
            vm.runtime.executePendingJobs();
          }).catch((err) => {
            const errHandle = vm.newString(err.message);
            promise.reject(errHandle);
            errHandle.dispose();
            promise.dispose();
            vm.runtime.executePendingJobs();
          });

          return promise.handle;
        });

        vm.setProp(vm.global, "hostHttpGet", hostHttpGetHandle);
        hostHttpGetHandle.dispose();

        const wrapperCode = `
          var httpGet = async function(url) {
            var resultStr = await hostHttpGet(url);
            var result = JSON.parse(resultStr);
            return {
              status: result.status,
              statusText: result.statusText,
              ok: result.status >= 200 && result.status < 300,
              text: async function() { return result.body; },
              json: async function() { return JSON.parse(result.body); }
            };
          };
          (async (args) => {
            ${code}
          })(JSON.parse(${JSON.stringify(JSON.stringify(args))}))
        `;

        const evalResult = vm.evalCode(wrapperCode);
        let finalResult: any;

        if (evalResult.error) {
          const errStr = vm.getString(evalResult.error);
          let errDump;
          try { errDump = vm.dump(evalResult.error); } catch {}
          evalResult.error.dispose();
          throw new Error(errDump?.message || errStr);
        } else {
          const promiseHandle = evalResult.value;
          
          const p = vm.resolvePromise(promiseHandle);
          vm.runtime.executePendingJobs();

          // Use Promise.race to enforce timeout on the QuickJS promise resolution
          const resolvedResult = await Promise.race([
            p.then(r => {
              promiseHandle.dispose();
              return r;
            }),
            timeoutPromise.then(r => {
              promiseHandle.dispose(); // clean up if timeout happens
              throw r; // this will be caught by outer try-catch
            })
          ]);

          if (resolvedResult.error) {
            const errStr = vm.getString(resolvedResult.error);
            let errDump;
            try { errDump = vm.dump(resolvedResult.error); } catch {}
            resolvedResult.error.dispose();
            throw new Error(errDump?.message || errStr);
          } else {
            finalResult = vm.dump(resolvedResult.value);
            resolvedResult.value.dispose();
          }
        }

        vm.dispose();
        clearTimeout(timeoutId);
        return Response.json({ success: true, result: finalResult, observedCalls });
      } catch (err: any) {
        clearTimeout(timeoutId);
        return Response.json({ success: false, error: err.message, observedCalls });
      }
    } catch (err: any) {
      return Response.json({ success: false, error: 'Invalid request: ' + err.message }, { status: 400 });
    }
  }
};
