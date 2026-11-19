import { build } from 'esbuild';

const common = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  sourcemap: false,
  minify: true,
  external: ['electron'],
  logLevel: 'info'
};

await build({ ...common, entryPoints: ['src/main/main.ts'], outfile: 'dist/main/main.js', format: 'cjs' });
await build({ ...common, entryPoints: ['src/preload/preload.ts'], outfile: 'dist/preload/preload.js', format: 'cjs' });
