const { getQuickJS, newAsyncContext } = require('quickjs-emscripten');

async function test() {
  const QuickJS = await getQuickJS();
  const vm = await newAsyncContext(QuickJS);

  const httpGetHandle = vm.newAsyncifiedFunction("httpGet", async (urlHandle) => {
    const url = vm.getString(urlHandle);
    console.log("Called asyncified httpGet with", url);
    await new Promise(r => setTimeout(r, 100));
    return vm.newString("fake async response");
  });
  vm.setProp(vm.global, "httpGet", httpGetHandle);
  httpGetHandle.dispose();

  const code = `
    (async () => {
      const res = await httpGet("https://example.com");
      return res;
    })()
  `;

  const result = await vm.evalCodeAsync(code); // returns the promise object
  
  if (result.error) {
    console.error("Error:", vm.getString(result.error));
    result.error.dispose();
  } else {
    // wait for it
    const resolvedResult = await vm.resolvePromise(result.value);
    
    if (resolvedResult.error) {
      console.error("Promise Rejected:", vm.getString(resolvedResult.error));
      resolvedResult.error.dispose();
    } else {
      console.log("Result:", vm.getString(resolvedResult.value));
      resolvedResult.value.dispose();
    }
  }
  
  vm.dispose();
}
test();
