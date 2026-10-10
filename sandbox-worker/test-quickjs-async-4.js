const { getQuickJS, newAsyncContext } = require('quickjs-emscripten');

async function test() {
  const QuickJS = await getQuickJS();
  const vm = await newAsyncContext(QuickJS);

  const httpGetHandle = vm.newFunction("httpGet", (urlHandle) => {
    const url = vm.getString(urlHandle);
    console.log("Called httpGet with", url);
    
    const promise = vm.newPromise();
    
    // Do the async work
    setTimeout(() => {
      const resHandle = vm.newString("fake async response");
      promise.resolve(resHandle);
      resHandle.dispose();
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

  const result = await vm.evalCodeAsync(code);
  console.log("Result:", vm.getString(result.value));
  result.value.dispose();
  vm.dispose();
}
test();
