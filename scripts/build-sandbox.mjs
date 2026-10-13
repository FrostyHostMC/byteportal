#!/usr/bin/env node
// Bundles the sandbox machine's program (src/sandbox.ts: the supervisor, and rooms' processes) into
// one file for plain Node: dist-sandbox/sandbox.js (or --out). The platform's server code, the
// engine's glue (the .wasm stays in engine/pkg) and nothing of the games: the sandbox only runs
// uploaded ones, which the game server sends.
//
//   node scripts/build-sandbox.mjs [--out dist-sandbox/sandbox.js]
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const args = process.argv.slice(2);
const out = args[args.indexOf('--out') + 1] && args.includes('--out') ? args[args.indexOf('--out') + 1] : 'dist-sandbox/sandbox.js';
const root = fileURLToPath(new URL('..', import.meta.url));

await esbuild.build({
  entryPoints: [`${root}src/sandbox.ts`],
  outfile: out,
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  sourcemap: true,
  alias: { '@engine': `${root}engine/pkg` },
  // `ws` is a package (installed); the rest is bundled.
  external: ['ws'],
  define: { 'import.meta.env.DEV': 'false', 'import.meta.env.PROD': 'true', 'import.meta.env.MODE': '"production"', 'import.meta.env.SSR': 'true' },
  logLevel: 'warning',
  plugins: [
    {
      // The browser's engine loader names the .wasm by URL; the sandbox reads it from disk instead.
      name: 'no-urls',
      setup(b) {
        b.onResolve({ filter: /\?url$/ }, (a) => ({ path: a.path, namespace: 'url-stub' }));
        b.onLoad({ filter: /.*/, namespace: 'url-stub' }, () => ({ contents: 'export default "";', loader: 'js' }));
      },
    },
  ],
});
console.log(`built ${out}`);
