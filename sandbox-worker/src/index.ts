import {
  newQuickJSWASMModuleFromVariant,
  RELEASE_SYNC,
  shouldInterruptAfterDeadline,
  type QuickJSContext,
  type QuickJSHandle,
} from 'quickjs-emscripten';

let quickJsPromise: ReturnType<typeof newQuickJSWASMModuleFromVariant> | null = null;
function getQuickJSInstance() {
  if (!quickJsPromise) {
    quickJsPromise = newQuickJSWASMModuleFromVariant(RELEASE_SYNC);
  }
  return quickJsPromise;
}

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

      let vm: QuickJSContext | null = null;
      let isVmAlive = false;
      let promiseHandle: QuickJSHandle | null = null;

      try {
        const QuickJS = await getQuickJSInstance();
        vm = QuickJS.newContext();
        isVmAlive = true;

        // Bound synchronous guest execution, memory and stack limits
        vm.runtime.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + 5000));
        vm.runtime.setMemoryLimit(16 * 1024 * 1024); // 16 MB limit
        vm.runtime.setMaxStackSize(512 * 1024);       // 512 KB stack

        const hostHttpGetHandle = vm.newFunction('hostHttpGet', (urlHandle) => {
          if (!isVmAlive || !vm) return;
          const url = vm.getString(urlHandle);
          const promise = vm.newPromise();

          scopedHttpGet(url)
            .then(async (response) => {
              if (!isVmAlive || !vm) return;
              try {
                const body = await response.text();
                if (!isVmAlive || !vm) return;
                const resultStr = JSON.stringify({
                  status: response.status,
                  statusText: response.statusText,
                  body: body,
                });
                const resHandle = vm.newString(resultStr);
                promise.resolve(resHandle);
                resHandle.dispose();
                promise.dispose();
                vm.runtime.executePendingJobs();
              } catch {
                try { promise.dispose(); } catch {}
              }
            })
            .catch((err) => {
              if (!isVmAlive || !vm) return;
              try {
                const errHandle = vm.newString(err.message || String(err));
                promise.reject(errHandle);
                errHandle.dispose();
                promise.dispose();
                vm.runtime.executePendingJobs();
              } catch {
                try { promise.dispose(); } catch {}
              }
            });

          return promise.handle;
        });

        vm.setProp(vm.global, 'hostHttpGet', hostHttpGetHandle);
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
          promiseHandle = evalResult.value;

          const p = vm.resolvePromise(promiseHandle);
          vm.runtime.executePendingJobs();

          // Use Promise.race to enforce timeout on the QuickJS promise resolution
          const resolvedResult = await Promise.race([
            p.then((r) => {
              if (promiseHandle) {
                promiseHandle.dispose();
                promiseHandle = null;
              }
              return r;
            }),
            timeoutPromise.then((r) => {
              if (promiseHandle) {
                try { promiseHandle.dispose(); } catch {}
                promiseHandle = null;
              }
              throw r;
            }),
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

        return Response.json({ success: true, result: finalResult, observedCalls });
      } catch (err: any) {
        return Response.json({ success: false, error: err.message, observedCalls });
      } finally {
        controller.abort();
        clearTimeout(timeoutId);
        if (promiseHandle) {
          try { promiseHandle.dispose(); } catch {}
          promiseHandle = null;
        }
        if (isVmAlive && vm) {
          isVmAlive = false;
          try { vm.dispose(); } catch {}
          vm = null;
        }
      }
    } catch (err: any) {
      return Response.json({ success: false, error: 'Invalid request: ' + err.message }, { status: 400 });
    }
  },
};
