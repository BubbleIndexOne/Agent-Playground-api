const { getQuickJS } = require('quickjs-emscripten');

async function test() {
  const QuickJS = await getQuickJS();
  const vm = QuickJS.newContext();

  const httpGetHandle = vm.newFunction("httpGet", (urlHandle) => {
    const url = vm.getString(urlHandle);
    console.log("Called httpGet with", url);
    return vm.newString("fake response");
  });
  vm.setProp(vm.global, "httpGet", httpGetHandle);
  httpGetHandle.dispose();

  const result = vm.evalCode(`httpGet("https://example.com");`);
  console.log("Result:", vm.getString(result.value));
  result.value.dispose();
  vm.dispose();
}
test();
