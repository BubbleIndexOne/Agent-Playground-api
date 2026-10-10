const { getQuickJS, newAsyncContext } = require('quickjs-emscripten');

async function test() {
  const QuickJS = await getQuickJS();
  const vm = await newAsyncContext(QuickJS);

  const httpGetHandle = vm.newFunction("httpGet", async (urlHandle) => {
    const url = vm.getString(urlHandle);
    console.log("Called async httpGet with", url);
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

  const result = await vm.evalCodeAsync(code);
  console.log("Result:", vm.getString(result.value));
  result.value.dispose();
  vm.dispose();
}
test();
