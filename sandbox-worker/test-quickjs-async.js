const { getQuickJS } = require('quickjs-emscripten');

async function test() {
  const QuickJS = await getQuickJS();
  const vm = QuickJS.newContext();

  const httpGetHandle = vm.newFunction("httpGet", (urlHandle) => {
    const url = vm.getString(urlHandle);
    console.log("Called httpGet with", url);
    
    // Create a promise inside QuickJS
    const promise = vm.newPromise();
    
    // Resolve it asynchronously in host
    setTimeout(() => {
      console.log("Resolving promise");
      const res = vm.newString("fake async response");
      promise.resolve(res);
      res.dispose();
      vm.runtime.executePendingJobs();
    }, 100);

    return promise.handle;
  });
  vm.setProp(vm.global, "httpGet", httpGetHandle);
  httpGetHandle.dispose();

  const code = `
    (async () => {
      const res = await httpGet("https://example.com");
      return res;
    })()
  `;

  const result = vm.evalCode(code);
  const promiseHandle = result.value;
  
  // Wait for pending jobs (microtasks)
  vm.runtime.executePendingJobs();
  
  console.log("Result promise type:", vm.typeof(promiseHandle));
  
  // Actually resolving the returned promise from evalCode requires AsyncContext
  
  // Clean up
  promiseHandle.dispose();
  vm.dispose();
}
test();
