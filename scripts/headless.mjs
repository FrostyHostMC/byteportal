#!/usr/bin/env node
// Runs headless test files (tests/headless/*.ts) in Node: no browser, no GPU. Vite's SSR loader
// compiles the TypeScript and resolves @platform / @engine the same way the dev server does.
//
//   node scripts/headless.mjs                      all tests
//   node scripts/headless.mjs tests/headless/arena.ts
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { createServer } from 'vite';
import { devWorker } from './dev-worker.mjs';

const dir = 'tests/headless';
const files = process.argv.slice(2).length
  ? process.argv.slice(2)
  : readdirSync(dir)
      .filter((f) => f.endsWith('.ts') && !f.startsWith('_'))
      .map((f) => path.join(dir, f));

const vite = await createServer({
  appType: 'custom',
  logLevel: 'warn',
  server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] },
});
// Tests' rooms in worker threads compile their modules through this Vite (see dev-worker.mjs).
globalThis.__blockyardDevWorker = devWorker(vite);

let failed = 0;
try {
  for (const file of files) {
    const t0 = performance.now();
    try {
      const mod = await vite.ssrLoadModule(path.resolve(file));
      await mod.default();
      console.log(`PASS ${file} (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
    } catch (err) {
      failed++;
      console.log(`FAIL ${file}\n${err instanceof Error ? err.stack : String(err)}`);
    }
  }
} finally {
  await vite.close();
}
process.exit(failed ? 1 : 0);
