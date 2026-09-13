const esbuild = require('esbuild');

async function bundle() {
  await esbuild.build({
    entryPoints: ['src/main.ts'],
    bundle: true,
    platform: 'node',
    format: 'esm',
    // These are provided by Cloudflare's nodejs_compat layer or are genuinely
    // unused in the Worker path. Marking them external prevents esbuild from
    // trying to inline Node.js built-ins that would break the Worker runtime.
    external: [
      // NestJS optional peer deps
      '@nestjs/microservices',
      '@nestjs/websockets',
      'class-transformer/storage',
      // Node.js built-ins — provided by nodejs_compat in the Worker runtime
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
      'child_process',
      'worker_threads',
      'readline',
    ],
    banner: {
      js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
    },
    outfile: 'dist/worker.mjs',
  });

  console.log('✓ Worker bundled successfully to dist/worker.mjs');
}

bundle().catch((err) => {
  console.error('Bundle failed:', err);
  process.exit(1);
});
