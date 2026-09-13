const esbuild = require('esbuild');

// All Node.js built-in module names (bare, no node: prefix).
// We alias each one to its `node:` prefixed form so esbuild emits them as
// proper top-level ESM `import "node:*"` statements rather than dynamic
// `require()` calls wrapped in the CJS shim.
//
// Cloudflare Workers with `nodejs_compat` resolves `node:*` imports natively
// at runtime — but it cannot resolve bare names like `require("perf_hooks")`
// emitted inside the CJS shim (__require), which is what causes error 10021.
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
 * Build an alias map: `perf_hooks` → `node:perf_hooks`, etc.
 * esbuild's `alias` option rewrites the import path before bundling, so the
 * output contains `import ... from "node:perf_hooks"` (a proper ESM external),
 * not `__require("perf_hooks")` (which CF Workers' validator rejects).
 */
const nodeBuiltinAliases = Object.fromEntries(
  NODE_BUILTINS.map((name) => [name, `node:${name}`]),
);

/**
 * Plugin that marks every `node:*`-prefixed import as external, so esbuild
 * doesn't try to bundle the polyfill and instead emits a bare ESM import.
 * This covers both the original `node:` imports AND the aliased ones above.
 */
const nodeExternalPlugin = {
  name: 'node-externals',
  setup(build) {
    build.onResolve({ filter: /^node:/ }, (args) => ({
      path: args.path,
      external: true,
    }));
  },
};

async function bundle() {
  await esbuild.build({
    entryPoints: ['src/main.ts'],
    bundle: true,
    platform: 'node',
    format: 'esm',
    // Alias bare built-in names → node: prefix so the CJS shim emits proper
    // ESM external imports that CF Workers' nodejs_compat can resolve.
    alias: nodeBuiltinAliases,
    plugins: [nodeExternalPlugin],
    external: [
      // NestJS optional peer deps (never needed in this project)
      '@nestjs/microservices',
      '@nestjs/websockets',
      'class-transformer/storage',
    ],
    banner: {
      // createRequire lets CJS-style require() calls work inside the ESM bundle.
      // Guard import.meta.url because it may be undefined in certain Workers
      // environments.
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
