const esbuild = require('esbuild');

async function bundle() {
  await esbuild.build({
    entryPoints: ['src/main.ts'],
    bundle: true,
    platform: 'node',
    format: 'esm',
    external: [
      '@nestjs/microservices',
      '@nestjs/websockets',
      'class-transformer/storage',
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
