const path = require('path');
const esbuild = require('esbuild');

// Absolute path to the stubs directory
const STUBS_DIR = path.resolve(__dirname, 'stubs');

/**
 * The set of bare Node.js built-in names for which we have ESM stubs.
 * Each stub (e.g. scripts/stubs/perf_hooks.mjs) does:
 *   export * from 'node:perf_hooks';
 *
 * Aliasing bare names to these stubs causes esbuild to hoist their imports
 * into top-level static `import` statements in the output bundle — which
 * Cloudflare Workers' validator accepts (error 10021 is triggered by dynamic
 * require() calls to node built-ins, not by static imports).
 */
const STUBBED_BUILTINS = new Set([
  'perf_hooks',
  'async_hooks',
  'stream',
  'util',
  'crypto',
  'os',
  'path',
  'tty',
  'fs',
  'net',
  'events',
  'zlib',
  'buffer',
]);

/**
 * esbuild plugin that:
 * 1. Routes bare built-in names (exact match only) → ESM stub files.
 *    Uses onResolve with exact matching to avoid the prefix-match side-effects
 *    of esbuild's `alias` option (which would wrongly remap `util/types` →
 *    `stubs/util.mjs/types`).
 * 2. Marks every `node:*` import as external so esbuild emits them as static
 *    top-level ESM imports that CF Workers' nodejs_compat can resolve.
 */
const nodeCompatPlugin = {
  name: 'node-compat',
  setup(build) {
    // Exact-match bare built-in names → stub files
    build.onResolve({ filter: /^[a-z_]+$/ }, (args) => {
      if (STUBBED_BUILTINS.has(args.path)) {
        return {
          path: path.join(STUBS_DIR, `${args.path}.mjs`),
        };
      }
    });

    // Mark every `node:*` import as external (including those re-exported by
    // the stubs above). esbuild will emit: import * as X from "node:perf_hooks"
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
    plugins: [nodeCompatPlugin],
    external: [
      // NestJS optional peer deps (never needed in this project)
      '@nestjs/microservices',
      '@nestjs/websockets',
      'class-transformer/storage',
    ],
    outfile: 'dist/worker.mjs',
  });

  console.log('✓ Worker bundled successfully to dist/worker.mjs');
}

bundle().catch((err) => {
  console.error('Bundle failed:', err);
  process.exit(1);
});
