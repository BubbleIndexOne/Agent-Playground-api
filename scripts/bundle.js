const esbuild = require('esbuild');

// Exhaustive list of Node.js built-in module names (bare, no node: prefix).
// Cloudflare Workers with `nodejs_compat` provides these at runtime.
const NODE_BUILTINS = [
  'assert',
  'assert/strict',
  'async_hooks',
  'buffer',
  'child_process',
  'cluster',
  'console',
  'constants',
  'crypto',
  'dgram',
  'diagnostics_channel',
  'dns',
  'dns/promises',
  'domain',
  'events',
  'fs',
  'fs/promises',
  'http',
  'http2',
  'https',
  'inspector',
  'module',
  'net',
  'os',
  'path',
  'path/posix',
  'path/win32',
  'perf_hooks',
  'process',
  'punycode',
  'querystring',
  'readline',
  'readline/promises',
  'repl',
  'stream',
  'stream/consumers',
  'stream/promises',
  'stream/web',
  'string_decoder',
  'sys',
  'timers',
  'timers/promises',
  'tls',
  'trace_events',
  'tty',
  'url',
  'util',
  'util/types',
  'v8',
  'vm',
  'wasi',
  'worker_threads',
  'zlib',
];

/**
 * esbuild plugin that marks ALL Node.js built-in imports as external —
 * both bare names (e.g. `perf_hooks`) and `node:`-prefixed names
 * (e.g. `node:perf_hooks`).
 *
 * Using platform: 'neutral' means esbuild won't auto-handle Node built-ins,
 * so we must be exhaustive here. Cloudflare Workers with the `nodejs_compat`
 * compatibility flag provides all of these at runtime.
 */
const nodeBuiltinsPlugin = {
  name: 'node-builtins-external',
  setup(build) {
    // Handle `node:*` prefixed imports (e.g. import from 'node:perf_hooks')
    build.onResolve({ filter: /^node:/ }, (args) => ({
      path: args.path,
      external: true,
    }));

    // Handle bare built-in names (e.g. require('perf_hooks'))
    const bareFilter = new RegExp(
      `^(${NODE_BUILTINS.map((m) => m.replace('/', '\\/')).join('|')})$`,
    );
    build.onResolve({ filter: bareFilter }, (args) => ({
      path: args.path,
      external: true,
    }));
  },
};

async function bundle() {
  await esbuild.build({
    entryPoints: ['src/main.ts'],
    bundle: true,
    // 'neutral' platform: esbuild makes no assumptions about the target runtime.
    // Our plugin above handles all Node built-ins explicitly.
    platform: 'neutral',
    // Target a modern ESM environment (Workers V8 isolate)
    format: 'esm',
    mainFields: ['module', 'main'],
    conditions: ['import', 'require', 'default'],
    plugins: [nodeBuiltinsPlugin],
    external: [
      // NestJS optional peer deps (never needed in this project)
      '@nestjs/microservices',
      '@nestjs/websockets',
      'class-transformer/storage',
    ],
    banner: {
      // createRequire lets CommonJS-style require() calls work inside the ESM
      // bundle. Guard import.meta.url because it is undefined in the Worker
      // V8 isolate runtime (Workers are not file-based modules).
      js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url ?? 'file:///');\n",
    },
    outfile: 'dist/worker.mjs',
  });

  console.log('✓ Worker bundled successfully to dist/worker.mjs');
}

bundle().catch((err) => {
  console.error('Bundle failed:', err);
  process.exit(1);
});
