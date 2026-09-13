const esbuild = require('esbuild');

/**
 * esbuild plugin that marks all `node:*` prefixed imports as external.
 *
 * NestJS and its dependencies use the `node:` URL scheme for built-ins
 * (e.g. `node:perf_hooks`, `node:crypto`, `node:stream`). esbuild treats
 * `node:perf_hooks` and `perf_hooks` as different specifiers, so listing
 * bare names in `external` doesn't cover the prefixed variants.
 *
 * Cloudflare Workers with `nodejs_compat` provides these modules — they
 * must NOT be bundled inline.
 */
const nodeBuiltinsPlugin = {
  name: 'node-builtins-external',
  setup(build) {
    // Mark every import that starts with `node:` as external
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
    plugins: [nodeBuiltinsPlugin],
    external: [
      // NestJS optional peer deps (never needed in this project)
      '@nestjs/microservices',
      '@nestjs/websockets',
      'class-transformer/storage',
      // Bare Node.js built-in names (for deps that don't use the node: prefix)
      'fs',
      'path',
      'os',
      'crypto',
      'stream',
      'http',
      'https',
      'net',
      'tls',
      'dns',
      'perf_hooks',
      'child_process',
      'worker_threads',
      'readline',
      'util',
      'events',
      'buffer',
      'assert',
      'url',
      'querystring',
      'zlib',
      'v8',
      'vm',
    ],
    banner: {
      // createRequire lets CommonJS-style require() calls work inside the ESM
      // bundle. Guard import.meta.url because it is undefined in the Worker
      // V8 isolate runtime (Workers are not file-based modules).
      js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url ?? 'file:///');",
    },
    outfile: 'dist/worker.mjs',
  });

  console.log('✓ Worker bundled successfully to dist/worker.mjs');
}

bundle().catch((err) => {
  console.error('Bundle failed:', err);
  process.exit(1);
});
