import { defineConfig, type Plugin } from 'vite';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/**
 * The files the games' server code names by URL (`import rifle from './rifle.glb?url'`: models,
 * pictures), in the games a production server runs: following the server registry's static
 * imports within `src/games` (the development games are dynamic imports, so they're left out).
 * The server sends those URLs to players' screens as the build names them (`/assets/rifle-<hash>.glb`).
 */
function serverAssets(root = r('.')): string[] {
  const games = join(root, 'src/games');
  const asFile = (p: string) => ['', '.ts', '/index.ts'].map((e) => p + e).find((f) => existsSync(f) && statSync(f).isFile());
  const seen = new Set<string>();
  const assets = new Set<string>();
  const queue = [join(games, 'server.ts')];
  while (queue.length) {
    const file = queue.shift()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const code = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const m of code.matchAll(/\b(?:import|export)\s+(type\s+)?(?:[\w$*{}\s,]*?\bfrom\s*)?['"](\.[^'"\n]*)['"]/g)) {
      if (m[1]) continue;
      const path = resolve(dirname(file), m[2].replace(/\?.*$/, ''));
      if (!path.startsWith(games + sep)) continue;
      if (m[2].endsWith('?url')) assets.add(path);
      else {
        const next = asFile(path);
        if (next) queue.push(next);
      }
    }
  }
  return [...assets];
}

/**
 * The site has every file the games' server code names by URL, although that code isn't in the
 * browser's build (see `serverAssets`): a client build emits each, as the server's build names it
 * (the same name and contents give the same hashed file name). In development Vite serves them
 * from the source folders.
 */
function withServerAssets(): Plugin {
  return {
    name: 'server-assets',
    apply: (_, env) => env.command === 'build' && !env.isSsrBuild,
    buildStart() {
      for (const file of serverAssets()) this.emitFile({ type: 'asset', name: basename(file), originalFileName: relative(r('.'), file), source: readFileSync(file) });
    },
  };
}

/** Each output chunk's modules (the page's and its workers'), for `scripts/check-bundle.mjs`. */
const chunks: { file: string; worker: boolean; modules: { id: string; length: number }[] }[] = [];

/**
 * With `BUNDLE_REPORT` set, a client build writes which modules each of its chunks carries (and
 * how much of each is left after tree-shaking) to `<outDir>/.bundle-report.json`: the bundle
 * check reads it (and deletes it). `worker`: the plugin as the workers' builds run it.
 */
function bundleReport(worker: boolean): Plugin | null {
  if (!process.env.BUNDLE_REPORT) return null;
  return {
    name: 'bundle-report',
    apply: (_, env) => !env.isSsrBuild,
    buildStart() {
      if (!worker) chunks.length = 0;
    },
    generateBundle(_, bundle) {
      for (const out of Object.values(bundle)) {
        if (out.type !== 'chunk') continue;
        const modules = Object.entries(out.modules).map(([id, m]) => ({ id, length: m.renderedLength }));
        chunks.push({ file: out.fileName, worker, modules });
      }
    },
    writeBundle(options) {
      if (worker) return;
      writeFileSync(join(options.dir ?? 'dist', '.bundle-report.json'), JSON.stringify({ chunks }, null, 1));
    },
  };
}

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@platform\/art$/, replacement: r('./src/platform/art/index.ts') },
      { find: /^@platform\/kits$/, replacement: r('./src/platform/kits/index.ts') },
      { find: /^@platform\/items$/, replacement: r('./src/platform/items/index.ts') },
      { find: /^@platform\/client\/kits$/, replacement: r('./src/platform/client-kits/index.ts') },
      { find: /^@platform\/client\/math$/, replacement: r('./src/platform/api/client/math.ts') },
      { find: /^@platform\/client$/, replacement: r('./src/platform/api/client.ts') },
      { find: /^@platform$/, replacement: r('./src/platform/index.ts') },
      { find: /^@engine\//, replacement: r('./engine/pkg/') },
    ],
  },
  plugins: [withServerAssets(), bundleReport(false)],
  // (A sandboxed frame is an opaque origin: its requests for the page's modules come from `null`.)
  server: { port: 5173, strictPort: false, cors: { origin: [/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/, 'null'] } },
  worker: { format: 'es', plugins: () => [bundleReport(true)] },
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 1500,
    // The site's page, and the page an uploaded game's sandboxed frame shows (src/frame.ts).
    rollupOptions: { input: { main: r('./index.html'), frame: r('./frame.html') } },
  },
});
