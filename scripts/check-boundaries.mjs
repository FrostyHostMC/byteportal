// Keeps games and kits on the public API, and each side's code on its side.
//
// Games (src/games/<name>/): each is split into parts (see docs/PLATFORM.md), by file name:
// `meta.ts`, `shared.ts`, `server.ts`, `client.ts` and anything in a `client/` folder (a preview
// sharing a folder prefixes them: `previews/shipyard.server.ts`). What each may import:
//
// - `meta.ts`: '@platform' only (types, `defineMeta`), and nothing of its own folder but pictures by
//   URL (`import cover from './cover.webp?url'`).
// - `shared.ts`: '@platform', '@platform/art' and its folder's files, but never (however
//   indirectly) its server or client code, '@platform/client' or '@platform/kits'. The server and
//   every screen run it.
// - Client code: '@platform', '@platform/art', '@platform/client' (and its '/kits' and '/math')
//   and its folder's files, but
//   never (however indirectly) its server code or '@platform/kits' (server kits).
// - `server.ts`: '@platform', '@platform/art', '@platform/kits' and its folder's files, but
//   never (however indirectly) its client code or '@platform/client'.
// - Its other files (helpers): '@platform', '@platform/art', '@platform/kits' and its folder's
//   files. Build tools (`tools/`, Node scripts that write the game's models and art, never part
//   of the game itself) may also use Node's built-ins (`node:*`), and read the platform's
//   characters (src/platform/character/) to make figures of their own in its people's style.
//
// The indirect rules follow imports within the game's folder, types included.
//
// Client kits (src/platform/client-kits/) may import only '@platform', '@platform/art',
// '@platform/items', '@platform/client' and '@platform/client/math', and files in their own
// folder: a game can copy one. The item kits' shared parts (src/platform/items/, '@platform/items':
// what an item kit's host half and screen half both run) import only '@platform'; every part of
// a game may use them.
// Kits and the art toolkit (src/platform/kits/, src/platform/art/) may import only '@platform'
// (and '@platform/art') and files inside their own folder: they get no access a game doesn't
// have, so any kit could be copied into a game unchanged.
//
// The platform reaches the games only through the registries, which the entries hand it: nothing
// in src/platform imports src/games. The browser's code (from src/main.ts) never reaches the
// server's (src/platform/host/, the whole simulation, a game's server code, the server registry),
// and the server's (src/serve.ts, src/server.ts, src/platform/host/) never reaches the browser's
// (src/main.ts, the runtime, src/platform/client/ and render/, '@platform/client', a game's
// client code, the browser registry). `scripts/check-bundle.mjs` checks the built output too.
import { readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { ImportGraph, role, sourceFiles, under } from './import-graph.mjs';

const graph = new ImportGraph();
const root = graph.root;
const rel = (f) => graph.rel(f);
const at = (p) => join(root, p);
const problems = [];

const inside = (file, spec, folder) => spec.startsWith('.') && under(resolve(dirname(file), spec), folder);
/**
 * A game's own build tools (`src/games/<name>/tools/`) may use Node's built-ins and read the
 * platform's characters (to build figures in their style); they never run in the game.
 */
const tool = (file, folder, spec) => under(file, join(folder, 'tools')) && (spec.startsWith('node:') || (spec.startsWith('.') && under(resolve(dirname(file), spec), at('src/platform/character'))));

/** Direct imports: each file in `folder` imports only `allowed(file)` packages and files inside the folder. */
function check(folder, allowed, what, { relative: own = () => true } = {}) {
  for (const file of sourceFiles(folder)) {
    for (const { spec } of graph.edges(file)) {
      if (allowed(file).includes(spec) || tool(file, folder, spec)) continue;
      if (inside(file, spec, folder) && own(file, spec)) continue;
      problems.push(`${rel(file)}: ${what(file)} may not import '${spec}'`);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Games
// ---------------------------------------------------------------------------------------------

const PUBLIC = ['@platform', '@platform/art', '@platform/items'];
const CLIENT = ['@platform/client', '@platform/client/kits', '@platform/client/math'];
const ALLOWED = { meta: ['@platform'], shared: PUBLIC, client: [...PUBLIC, ...CLIENT], server: [...PUBLIC, '@platform/kits'] };
const NAMES = { meta: 'its meta', shared: 'its shared code', client: 'its client code', server: 'its server code' };
/** What each part must never reach, however indirectly: other parts, and packages. */
const NEVER = {
  shared: { roles: ['server', 'client'], packages: [...CLIENT, '@platform/kits'] },
  client: { roles: ['server'], packages: ['@platform/kits'] },
  server: { roles: ['client'], packages: CLIENT },
};

const games = at('src/games');
/** Every game's parts, for the checks across the whole app below. */
const parts = { server: [], client: [], shared: [], meta: [] };
for (const name of readdirSync(games)) {
  const dir = join(games, name);
  if (!statSync(dir).isDirectory()) continue;
  const files = sourceFiles(dir);
  for (const f of files) if (role(f, dir)) parts[role(f, dir)].push(f);
  const part = (f) => role(f, dir);
  check(dir, (f) => ALLOWED[part(f)] ?? [...PUBLIC, '@platform/kits'], (f) => (part(f) ? `game '${name}': ${NAMES[part(f)]} (${relative(dir, f)})` : `game '${name}'`), { relative: (f, spec) => part(f) !== 'meta' || /\?url$/.test(spec) });
  // What each part reaches in its folder (following types too).
  for (const file of files) {
    const never = NEVER[part(file)];
    if (!never) continue;
    const via = graph.reach([file], { types: true, within: (f) => under(f, dir) });
    for (const f of via.keys()) {
      if (under(f, dir) && never.roles.includes(part(f))) problems.push(`${rel(file)}: ${NAMES[part(file)]} reaches ${NAMES[part(f)]}: ${graph.path(via, f)}`);
      if (!under(f, dir)) continue;
      for (const { spec } of graph.edges(f)) if (never.packages.includes(spec) && f !== file) problems.push(`${rel(file)}: ${NAMES[part(file)]} reaches '${spec}': ${graph.path(via, f)} -> ${spec}`);
    }
  }
}

check(at('src/platform/kits'), () => ['@platform', '@platform/art', '@platform/items'], () => 'a kit');
check(at('src/platform/items'), () => ['@platform'], () => "an item kit's shared part");
check(at('src/platform/client-kits'), () => ['@platform', '@platform/art', '@platform/items', '@platform/client', '@platform/client/math'], () => 'a client kit');
check(at('src/platform/art'), () => ['@platform'], () => 'the art toolkit');

// ---------------------------------------------------------------------------------------------
// The platform and the games; the browser and the server
// ---------------------------------------------------------------------------------------------

for (const file of sourceFiles(at('src/platform'))) {
  for (const { spec, to } of graph.edges(file)) {
    if (!to.startsWith('pkg:') && under(to, games)) problems.push(`${rel(file)}: the platform may not import a game ('${spec}'): the entries hand it the registries`);
  }
}

/** Files one side may never reach, and why. */
function never(side, entries, forbidden) {
  const via = graph.reach(entries.map(at));
  for (const f of via.keys()) {
    const why = forbidden(f);
    if (why) problems.push(`${side} reaches ${why}: ${graph.path(via, f)}`);
  }
}

const serverParts = new Set(parts.server);
const clientParts = new Set(parts.client);
never('the browser (src/main.ts, src/frame.ts)', ['src/main.ts', 'src/frame.ts'], (f) => {
  if (under(f, at('src/platform/host'))) return 'the server host';
  if (f === at('src/platform/sim/sim.ts')) return 'the whole simulation';
  if (f === at('src/games/server.ts') || f === at('src/server.ts') || f === at('src/serve.ts') || f === at('src/sandbox.ts') || under(f, at('src/platform/sandbox'))) return 'the server';
  if (serverParts.has(f)) return "a game's server code";
  return null;
});
never('the server (src/serve.ts, src/sandbox.ts)', ['src/serve.ts', 'src/server.ts', 'src/sandbox.ts', ...sourceFiles(at('src/platform/host')).map(rel), ...sourceFiles(at('src/platform/sandbox')).map(rel)], (f) => {
  if (f === at('src/main.ts') || f === at('src/frame.ts') || f === at('src/games/browser.ts') || f === at('src/platform/runtime.ts')) return "the browser's code";
  if (under(f, at('src/platform/client')) || under(f, at('src/platform/render'))) return "the browser's code";
  if (f === at('src/platform/api/client.ts') || under(f, at('src/platform/api/client')) || under(f, at('src/platform/client-kits'))) return "'@platform/client'";
  if (clientParts.has(f)) return "a game's client code";
  return null;
});

if (problems.length) {
  console.error(`Boundary check failed:\n  ${[...new Set(problems)].join('\n  ')}`);
  process.exit(1);
}
console.log("Boundaries OK: games and kits use only the public API, and the browser's and the server's code keep to their sides.");
