const { getQuickJS } = require('quickjs-emscripten');

async function test() {
  const QuickJS = await getQuickJS();
  const vm = QuickJS.newContext();

  const httpGetHandle = vm.newFunction("httpGet", (urlHandle) => {
    const url = vm.getString(urlHandle);
    console.log("Called httpGet with", url);
    
    const promise = vm.newPromise();
    
    // Do the async work
    setTimeout(() => {
      const resHandle = vm.newString("fake async response");
      promise.resolve(resHandle);
      resHandle.dispose();
      promise.dispose();
      
      // Execute the pending jobs so QuickJS resolves the promise!
      vm.runtime.executePendingJobs();
    }, 100);

    // we must return the promise handle for the user script to await
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
  
  if (result.error) {
    console.error("Error:", vm.getString(result.error));
    result.error.dispose();
    vm.dispose();
    return;
  }
  
  const promiseHandle = result.value;

  // We need a way to know when the top-level promise finishes.
  // vm.resolvePromise converts QuickJS promise to JS promise!
  try {
    const resolvedResult = await vm.resolvePromise(promiseHandle);
    if (resolvedResult.error) {
      console.error("Promise rejected:", vm.getString(resolvedResult.error));
      resolvedResult.error.dispose();
    } else {
      console.log("Final Result:", vm.getString(resolvedResult.value));
      resolvedResult.value.dispose();
    }
  } catch (err) {
    console.error("JS Error:", err);
  }

  vm.dispose();
}
test();
