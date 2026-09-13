const path = require('path');
const esbuild = require('esbuild');

const STUBS_DIR = path.resolve(__dirname, 'stubs');
const stub = (name) => path.join(STUBS_DIR, `${name}.mjs`);

// Node.js built-ins used by `pg` (our only remaining Node-dependent package).
// Hono itself is pure Web API — no Node built-ins needed.
// We alias bare names → ESM stubs that re-export from node:* so esbuild emits
// them as static top-level imports (CF Workers nodejs_compat resolves these).
const STUBBED_BUILTINS = new Set([
  'crypto',
  'dns',
  'events',
  'fs',
  'net',
  'os',
  'path',
  'stream',
  'tls',
  'tty',
  'url',
  'util',
  'util/types',
  'zlib',
  'buffer',
]);

const nodeCompatPlugin = {
  name: 'node-compat',
  setup(build) {
    // Exact-match bare built-in names → ESM stub files
    build.onResolve({ filter: /^[a-z_/]+$/ }, (args) => {
      if (STUBBED_BUILTINS.has(args.path)) {
        return { path: stub(args.path.replace('/', '_')) };
      }
    });

    // Mark every node:* import as external — esbuild emits static ESM imports
    // that CF Workers' nodejs_compat resolves natively at runtime
    build.onResolve({ filter: /^node:/ }, (args) => ({
      path: args.path,
      external: true,
    }));
  },
};

async function bundle() {
  const result = await esbuild.build({
    entryPoints: ['src/worker.ts'],
    bundle: true,
    platform: 'node',
    format: 'esm',
    plugins: [nodeCompatPlugin],
    external: [
      // pg tries to dynamically load optional native bindings — exclude them
      'pg-native',
      'pg-cloudflare',
    ],
    outfile: 'dist/worker.mjs',
    logLevel: 'info',
  });

  if (result.errors.length) {
    console.error('Bundle failed with errors');
    process.exit(1);
  }

  console.log('✓ Worker bundled successfully to dist/worker.mjs');
}

bundle().catch((err) => {
  console.error('Bundle failed:', err);
  process.exit(1);
});
