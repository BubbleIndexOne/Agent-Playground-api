const { getQuickJS } = require('quickjs-emscripten');

async function test() {
  const code = 'return args.a + (await httpGet("http://example.com")).status;';
  const args = { a: 10 };
  
  const QuickJS = await getQuickJS();
  const vm = QuickJS.newContext();

  const hostHttpGetHandle = vm.newFunction("hostHttpGet", (urlHandle) => {
    const url = vm.getString(urlHandle);
    const promise = vm.newPromise();
    
    Promise.resolve({ status: 200, statusText: "OK", text: async () => "Hello" }).then(async (response) => {
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
  if (evalResult.error) {
    console.error("Eval Error:", vm.getString(evalResult.error));
    evalResult.error.dispose();
  } else {
    const promiseHandle = evalResult.value;
    const resolvedResult = await vm.resolvePromise(promiseHandle);
    if (resolvedResult.error) {
      // In case of an exception during evaluation
      console.error("Runtime Error:", vm.getString(resolvedResult.error));
      
      // If it's a JS Error object in QuickJS, we might want to dump it to get the stack
      // Wait, vm.dump() on an Error object works too!
      console.error(vm.dump(resolvedResult.error));
      
      resolvedResult.error.dispose();
    } else {
      console.log("Success:", vm.dump(resolvedResult.value));
      resolvedResult.value.dispose();
    }
    promiseHandle.dispose();
  }

  vm.dispose();
}
test();
