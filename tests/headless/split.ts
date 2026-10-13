import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import type { GameDefinition } from '../../src/platform/api/types';
import * as browser from '../../src/games/browser';
import * as server from '../../src/games/server';
import { check } from './_harness';

const GAMES = resolve('src/games');

/**
 * Modules only a game's server may reach (its rules: bots, match state, scoring, content it
 * registers in `setup`), by folder. Each must be reached from the game's server code (so the list
 * stays true), and never from its shared code, its client code or its meta.
 */
const SERVER_ONLY: Record<string, string[]> = {
  arena: ['run/director.ts', 'monsters/index.ts', 'bosses/index.ts'],
  bedwars: ['bots.ts', 'fireballs.ts', 'items.ts', 'nav.ts', 'shop.ts', 'state.ts'],
  callofblocky: ['bots.ts', 'briefcase.ts', 'hud.ts', 'match.ts', 'progression.ts', 'weapons.ts'],
  highnoon: ['bots.ts', 'hud.ts', 'weapons.ts'],
  skyship: ['ship.ts'],
  starfighter: ['capital.ts', 'enemies.ts', 'pilot.ts', 'weapons.ts'],
};

/**
 * Modules only a game's client code may reach (its looks: the model files its items are drawn
 * from, its voices), by folder: the game's client code reaches each, its server code and its
 * shared code never do (the server names the items, and plays the voices by name).
 */
const CLIENT_ONLY: Record<string, string[]> = {
  arena: ['client/looks.ts', 'client/sounds/index.ts'],
  bedwars: ['client/looks.ts', 'client/sounds.ts'],
  callofblocky: ['models/index.ts', 'client/looks.ts', 'client/progression.ts', 'client/sounds.ts'],
  gallery: ['client/looks.ts', 'models/blocky_sword.gltf'],
  // (Its cowboys, `models/index.ts`, are the server's to choose: only the guns' model files are the screens'.)
  highnoon: ['models/revolver.glb', 'models/rifle.glb', 'client/looks.ts', 'client/sounds.ts'],
  obby: ['client/sounds.ts'],
  skyship: ['client/sounds.ts'],
  starfighter: ['client/sounds.ts'],
};

/** What a file imports (static, dynamic, re-exports and type-only alike), comments aside. */
function imports(file: string): string[] {
  const code = readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  return [...code.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)['"]([^'"]+)['"]/g)].map((m) => m[1]);
}

/** A module: a source file (absolute path), or a package by name (`@platform/kits`), or an asset. */
function resolveSpec(from: string, spec: string): string {
  if (!spec.startsWith('.')) return spec;
  const path = resolve(dirname(from), spec.replace(/\?.*$/, ''));
  for (const p of [path, `${path}.ts`, join(path, 'index.ts')]) if (existsSync(p) && statSync(p).isFile()) return p;
  throw new Error(`${relative('.', from)}: can't resolve '${spec}'`);
}

/** Everything `entry` reaches, following source files (not packages or assets). */
function graph(entry: string): Set<string> {
  const seen = new Set<string>([entry]);
  const todo = [entry];
  while (todo.length) {
    const file = todo.pop()!;
    for (const spec of imports(file)) {
      const m = resolveSpec(file, spec);
      if (seen.has(m)) continue;
      seen.add(m);
      if (m.endsWith('.ts')) todo.push(m);
    }
  }
  return seen;
}

const isPart = (part: string) => (m: string) => new RegExp(`(^|\\.)${part}\\.ts$`).test(basename(m)) && m.startsWith(GAMES + '/') && dirname(m) !== GAMES;
const isServer = isPart('server');
/** A game's client code: its `client.ts` (or `<preview>.client.ts`), and anything in a `client/` folder of its own. */
const isClient = (m: string) => isPart('client')(m) || (m.startsWith(GAMES + '/') && relative(GAMES, m).split('/').slice(1, -1).includes('client'));
const name = (m: string) => (m.startsWith('/') ? relative('.', m) : m);

/** Every game's four parts: each `meta.ts` (or `<preview>.meta.ts`) in a game's folder, and its siblings. */
function parts() {
  const found: { dir: string; prefix: string; folder: string }[] = [];
  const walk = (dir: string) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) {
        if (f !== 'tools' && f !== 'models') walk(p);
      } else if (dir !== GAMES && /(^|\.)meta\.ts$/.test(f)) found.push({ dir, prefix: f.slice(0, -'meta.ts'.length), folder: relative(GAMES, dir).split('/')[0] });
    }
  };
  walk(GAMES);
  return found.map(({ dir, prefix, folder }) => {
    const at = (part: string) => join(dir, `${prefix}${part}.ts`);
    for (const part of ['meta', 'shared', 'server', 'client']) check(existsSync(at(part)), `${name(at('meta'))} has no ${prefix}${part}.ts beside it`);
    return { folder, meta: at('meta'), shared: at('shared'), server: at('server'), client: at('client') };
  });
}

/**
 * The split of every game into meta / shared / server / client (docs/REDESIGN-CLIENT-SERVER.md):
 * the launcher's `meta.ts` imports nothing but `@platform` (and its cover picture, by URL); the client code (`client.ts`) imports
 * only `@platform/client` and its shared code, and never reaches server code; the shared code
 * (the world, blocks, movement, vehicles: what every screen runs too) never reaches the rules
 * (server files, bots, match state, `@platform/kits`); the server never reaches client code. And
 * both registries list the same games, in the same order, with the same shared definitions.
 */
/** The client API's packages: client code imports them; server and shared code never do. */
const CLIENT_PKGS = ['@platform/client', '@platform/client/kits', '@platform/client/math'];

export default async function split() {
  const all = parts();
  const walked = new Set<string>();
  for (const g of all) {
    // (And its cover picture, by URL: a string, not code.)
    const metaOk = (s: string) => s === '@platform' || (s.startsWith('./') && s.endsWith('?url'));
    const meta = imports(g.meta);
    check(meta.every(metaOk), `${name(g.meta)} may import only '@platform' and pictures by URL, not ${meta.filter((s) => !metaOk(s)).join(', ')}`);

    // The client API (and its kits and math), the public API, its shared code and its own client files.
    const clientOk = (m: string) => CLIENT_PKGS.includes(m) || m === '@platform' || m === '@platform/art' || m === g.shared || isClient(m);
    const client = imports(g.client).map((s) => resolveSpec(g.client, s));
    check(client.every(clientOk), `${name(g.client)} may import only the client API, the public API, its shared code and its client files, not ${client.filter((m) => !clientOk(m)).map(name).join(', ')}`);

    const shared = graph(g.shared);
    const serverOnly = (SERVER_ONLY[g.folder] ?? []).map((f) => join(GAMES, g.folder, f));
    for (const m of shared) {
      check(!isServer(m) && !isClient(m), `${name(g.shared)} reaches ${name(m)}`);
      check(m !== '@platform/kits' && !CLIENT_PKGS.includes(m), `${name(g.shared)} reaches '${m}' (shared code imports neither side)`);
      check(!serverOnly.includes(m), `${name(g.shared)} reaches ${name(m)}, which only the server may`);
    }
    for (const m of graph(g.client)) check(!isServer(m) && !serverOnly.includes(m) && m !== '@platform/kits', `${name(g.client)} reaches ${name(m)}`);
    for (const m of graph(g.meta)) check(m === g.meta || m === '@platform' || /\.(webp|jpe?g|png)$/.test(m), `${name(g.meta)} reaches ${name(m)}`);

    const rules = graph(g.server);
    for (const m of rules) check(!isClient(m) && !CLIENT_PKGS.includes(m), `${name(g.server)} reaches ${name(m)}`);
    for (const m of [...shared, ...rules]) walked.add(m);
  }
  for (const [folder, list] of Object.entries(SERVER_ONLY)) {
    const reached = new Set(all.filter((g) => g.folder === folder).flatMap((g) => [...graph(g.server)]));
    for (const f of list) check(reached.has(join(GAMES, folder, f)), `src/games/${folder}/${f} is listed as server-only but no server code of ${folder} reaches it`);
  }
  let clientOnly = 0;
  for (const [folder, list] of Object.entries(CLIENT_ONLY)) {
    // The game itself (not its previews: Call of Blocky's gun gallery stands the models on pedestals, props its server places).
    const games = all.filter((g) => g.server === join(GAMES, folder, 'server.ts'));
    const onScreen = new Set(games.flatMap((g) => [...graph(g.client)]));
    const elsewhere = new Set(games.flatMap((g) => [...graph(g.server), ...graph(g.shared)]));
    for (const f of list) {
      const m = join(GAMES, folder, f);
      check(onScreen.has(m), `src/games/${folder}/${f} is listed as client-only but no client code of ${folder} reaches it`);
      check(!elsewhere.has(m), `src/games/${folder}/${f} is client-only (its looks, its voices), but ${folder}'s server or shared code reaches it`);
      clientOnly++;
    }
  }

  // The registries: the browser's catalog and the server's, the same games in the same order.
  const hosted: GameDefinition[] = [...server.games, ...(await server.devGames())];
  const listed = [...browser.games, ...(await browser.devGames())];
  check(listed.map((e) => e.meta.id).join() === hosted.map((d) => d.id).join(), `the browser lists ${listed.map((e) => e.meta.id).join(', ')}; the server hosts ${hosted.map((d) => d.id).join(', ')}`);
  check(hosted.length === all.length, `${all.length} games are split, the server hosts ${hosted.length}`);
  for (const [i, entry] of listed.entries()) {
    const def = hosted[i];
    for (const [k, v] of Object.entries(entry.meta)) check(def[k as keyof GameDefinition] === v, `${def.id}: the launcher's ${k} isn't the game's`);
    const { shared } = await entry.load();
    // The client's shared definition is the one the server runs, value for value: `{ ...shared, ...rules }`.
    for (const [k, v] of Object.entries(shared)) check(def[k as keyof GameDefinition] === v, `${def.id}: the server's ${k} isn't the client's shared one`);
    for (const k of Object.keys(def)) check(k in shared || k === 'setup' || k === 'start' || k === 'update' || k === 'items' || k === 'autoStart', `${def.id}: the server's definition has ${k}, which isn't shared or a rule`);
  }
  console.log(`  ${all.length} games split (${server.games.length} listed, ${all.length - server.games.length} in development): meta alone, clients only on shared code, shared code clear of the rules, ${clientOnly} looks-and-voices modules on screens only (${walked.size} modules walked)`);
}
