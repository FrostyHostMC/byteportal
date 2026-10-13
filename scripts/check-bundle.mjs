#!/usr/bin/env node
// Checks the browser's build (dist/) for server code: run after `vite build` with BUNDLE_REPORT=1
// (`npm run build` does both), which records the modules in each output chunk. It fails if the
// output carries
//
// - the server's own modules: src/platform/host/ (the game host, rooms, the server, stores), the
//   whole simulation (src/platform/sim/sim.ts), the server kits (src/platform/kits/: bots,
//   building, which only a game's server code may use), the server registry and entries, or a
//   Node module;
// - anything of a game's that its client code doesn't reach: a module only its server code
//   reaches (worked out from the import graph: what its `server.ts` reaches, less what the
//   browser's code, its client code, shared code and meta reach), or, for a game not split into
//   meta / shared / server / client yet, any of it (its whole definition, rules and all).
//
// The platform's simulation modules the browser uses to predict (movement, guns, throwables,
// hitscan, abilities, the world query, movers…) are fine: they're reached from the browser's code.
//
// It also fails if the output lacks a file the games' server code names by URL (a model, a
// picture: `import rifle from './rifle.glb?url'`): the server sends players that URL, so the site
// must have the file (vite.config.ts's `server-assets` emits them).
//
//   node scripts/check-bundle.mjs [--report dist/.bundle-report.json] [--root <project>] [--keep]
//
// The report is deleted after reading (it isn't part of the site), unless --keep.
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { ImportGraph, projectRoot, role, sourceFiles, under } from './import-graph.mjs';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const root = resolve(flag('root') ?? projectRoot);
const reportFile = resolve(root, flag('report') ?? 'dist/.bundle-report.json');
if (!existsSync(reportFile)) {
  console.error(`Bundle check: no report at ${reportFile}. Build with it first: BUNDLE_REPORT=1 vite build (npm run build does).`);
  process.exit(1);
}
/** @type {{ chunks: { file: string; worker: boolean; modules: { id: string; length: number }[] }[] }} */
const report = JSON.parse(readFileSync(reportFile, 'utf8'));
if (!args.includes('--keep')) rmSync(reportFile);

const graph = new ImportGraph(root);
const at = (p) => join(root, p);
const rel = (f) => graph.rel(f);

// What's in the output: each module with code left after tree-shaking, and the chunks it's in.
/** @type {Map<string, Set<string>>} */
const shipped = new Map();
let nodeModules = 0;
for (const chunk of report.chunks) {
  for (const m of chunk.modules) {
    if (m.length === 0) continue;
    if (m.id.includes('__vite-browser-external')) {
      nodeModules++;
      continue;
    }
    if (m.id.startsWith('\0')) continue;
    const id = m.id.replace(/[?#].*$/, '');
    if (!id.startsWith(root)) continue;
    if (!shipped.has(id)) shipped.set(id, new Set());
    shipped.get(id).add(chunk.file);
  }
}
const where = (f) => [...shipped.get(f)].join(', ');

const problems = [];
const report_ = (title, lines) => lines.length && problems.push(`${title}\n${lines.map((l) => `    ${l}`).join('\n')}`);

// The server's own modules.
const SERVER = ['src/platform/sim/sim.ts', 'src/games/server.ts', 'src/server.ts', 'src/serve.ts'].map(at);
report_(
  "Server code (the host, the whole simulation, the server kits, the server's registry and entries):",
  [...shipped.keys()].filter((f) => under(f, at('src/platform/host')) || under(f, at('src/platform/kits')) || SERVER.includes(f)).map((f) => `${rel(f)}  (${where(f)})`),
);
if (nodeModules) problems.push(`Node modules: ${nodeModules} import(s) of a Node built-in were stubbed out for the browser (something of the server's is in it).`);

// The games, by their parts.
const gamesDir = at('src/games');
const games = existsSync(gamesDir) ? readdirSync(gamesDir).filter((n) => statSync(join(gamesDir, n)).isDirectory()) : [];
const byGame = games.map((name) => {
  const dir = join(gamesDir, name);
  const files = sourceFiles(dir);
  const parts = (r) => files.filter((f) => role(f, dir) === r);
  return { name, dir, server: parts('server'), client: [...parts('client'), ...parts('shared'), ...parts('meta')] };
});
// What the browser legitimately reaches: its own code (not following into the games: the
// registry's imports are what's being checked), and every game's client code, shared code and meta.
const browser = graph.reach([at('src/main.ts'), at('src/frame.ts')], { within: (f) => !under(f, gamesDir) });
const clients = graph.reach(byGame.flatMap((g) => g.client));
const client = new Set([...browser.keys(), ...clients.keys()]);

for (const g of byGame) {
  const mine = [...shipped.keys()].filter((f) => under(f, g.dir));
  if (!g.server.length && !g.client.length) {
    // Not split yet: its definition (setup / start / update) ships whole.
    if (!mine.length) continue;
    const code = mine.filter((f) => /\.(ts|js|mjs)$/.test(f));
    const shown = code.slice(0, 8).map(rel);
    if (code.length > shown.length) shown.push(`and ${code.length - shown.length} more`);
    report_(`${g.name}: not split into meta / shared / server / client yet, so its whole definition (its rules too) is in the browser's build (${mine.length} modules):`, shown);
    continue;
  }
  const server = graph.reach(g.server);
  report_(
    `${g.name}: in the browser's build, but its client code (client, shared, meta) doesn't reach them:`,
    mine.filter((f) => !client.has(f)).map((f) => (server.has(f) ? `${rel(f)}  (${where(f)}), its server code's: ${graph.path(server, f)}` : `${rel(f)}  (${where(f)})`)),
  );
}

// Other platform modules that only games' server code reaches.
const serverOnly = graph.reach(byGame.flatMap((g) => g.server));
report_(
  "Platform code only games' server code reaches:",
  [...shipped.keys()].filter((f) => !under(f, gamesDir) && serverOnly.has(f) && !client.has(f)).map((f) => `${rel(f)}  (${where(f)}): ${graph.path(serverOnly, f)}`),
);

// Files the production games' server code names by URL: each must be in the output, as the
// server's build names it (`<name>-<hash><ext>`, in the site's assets).
const outDir = dirname(reportFile);
const assetsDir = join(outDir, 'assets');
const built = existsSync(assetsDir) ? readdirSync(assetsDir) : [];
const named = new Set();
for (const f of graph.reach([at('src/games/server.ts')], { dynamic: false, within: (f) => under(f, gamesDir) }).keys()) {
  for (const { spec, to } of graph.edges(f)) if (/\?url$/.test(spec) && under(to, gamesDir)) named.add(to);
}
const escape = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
report_(
  "Files the games' server code names by URL (the server sends players their URL), missing from the site:",
  [...named]
    .filter((f) => {
      const ext = extname(f);
      const re = new RegExp(`^${escape(basename(f, ext))}-[\\w-]+${escape(ext)}$`);
      return !built.some((b) => re.test(b));
    })
    .map(rel),
);

const modules = shipped.size;
if (problems.length) {
  console.error(`Bundle check failed (the browser's build in ${rel(outDir)}):\n\n  ${problems.join('\n\n  ')}\n`);
  process.exit(1);
}
console.log(`Bundle OK: ${report.chunks.length} chunks, ${modules} modules of this project, none of them the server's; the ${named.size} files the server names by URL are there.`);
