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

    // Ignore pg-native and pg-cloudflare by resolving them to an empty module.
    // If we mark them as external, esbuild emits a dynamic require which CF Workers reject.
    build.onResolve({ filter: /^(pg-native|pg-cloudflare)$/ }, (args) => ({
      path: args.path,
      namespace: 'ignore',
    }));
    build.onLoad({ filter: /.*/, namespace: 'ignore' }, () => ({
      contents: 'export default {}',
    }));

    // Intercept pg's stream.js to force it to use Node.js sockets instead of
    // Cloudflare raw sockets. Hyperdrive intercepts Node.js sockets natively.
    // If pg uses raw sockets, it bypasses Hyperdrive connection pooling.
    build.onLoad({ filter: /pg[\\/]lib[\\/]stream\.js$/ }, async (args) => {
      const fs = require('fs');
      let text = await fs.promises.readFile(args.path, 'utf8');
      const cloudflareRuntimeMarker = 'function isCloudflareRuntime() {';

      if (!text.includes(cloudflareRuntimeMarker)) {
        throw new Error(
          `Unable to disable pg's Cloudflare runtime branch: marker not found in ${args.path}`
        );
      }

      text = text.replace(
        cloudflareRuntimeMarker,
        'function isCloudflareRuntime() { return false;'
      );
      return { contents: text, loader: 'js' };
    });
  },
};

/** Bundle the Cloudflare Worker entry point and report any build failures. */
async function bundle() {
  const result = await esbuild.build({
    entryPoints: ['src/worker.ts'],
    bundle: true,
    platform: 'node',
    format: 'esm',
    inject: ['./scripts/stubs/globals.js'],
    plugins: [nodeCompatPlugin],
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
