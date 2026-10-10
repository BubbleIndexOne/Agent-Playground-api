const { getQuickJS } = require('quickjs-emscripten');
async function test() {
  const QuickJS = await getQuickJS();
  const vm = QuickJS.newContext();
  const httpGetHandle = vm.newFunction('httpGet', (urlHandle) => {
    const promise = vm.newPromise();
    setTimeout(() => {
      const resHandle = vm.newString('success');
      promise.resolve(resHandle);
      resHandle.dispose();
      promise.dispose();
      vm.runtime.executePendingJobs();
    }, 10);
    return promise.handle;
  });
  vm.setProp(vm.global, 'httpGet', httpGetHandle);
  httpGetHandle.dispose();
  const result = vm.evalCode('(async () => await httpGet("test"))()');
  const promiseHandle = result.value;
  const resolved = await vm.resolvePromise(promiseHandle);
  console.log('Result:', vm.getString(resolved.value));
  resolved.value.dispose();
  promiseHandle.dispose();
  vm.dispose();
}
test();
