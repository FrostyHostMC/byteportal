// The packager: turns a game's folder (as it sits in src/games/<id>/) into a built game a server
// can host and players' screens can load without the game being compiled into the platform.
//
//   <out>/<id>/<version>/server.js      shared + server code: what a room's worker imports
//   <out>/<id>/<version>/client.js      client + shared code: what a player's screen imports
//   <out>/<id>/<version>/workers/*.js   the client's Web Workers (`new Worker(new URL('./x.ts', import.meta.url))`)
//   <out>/<id>/<version>/game.json      the manifest (`PackageManifest`)
//   <out>/<id>/assets/…                 its `?url` files, named by content, shared by every version
//
// A built game leaves the platform out: each `@platform…` import reads the running platform's
// module from `globalThis.__blockyard` (see ./link.ts), so it binds to whatever platform loads it.
// Building also holds the game to its boundaries (see scripts/check-boundaries.mjs): it imports
// only its folder's files and the public API, each side only its own part of it, and its client
// code never its server code or the other way round. Runs in Node (the CLI, the game server).
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, extname, join, relative, resolve, sep } from 'node:path';
import * as esbuild from 'esbuild';
import { skipped } from './zip';
import { BuildError, CLIENT_MODULES, GAME_ID, GLOBAL, SERVER_MODULES, WORKER_MODULES, type PackageManifest, type PlatformModule } from './link';

export interface BuildOptions {
  /** Where built games go: `<out>/<id>/…`. */
  out: string;
  /** Host it under this id rather than its meta's (a second copy of a game, say). */
  id?: string;
  /** Built for a development server: `import.meta.env.DEV` is true (games' debugging hooks). */
  dev?: boolean;
}

export interface BuiltGame {
  id: string;
  version: string;
  /** The built version's folder (`<out>/<id>/<version>`). */
  dir: string;
  manifest: PackageManifest;
}

export { BuildError, GAME_ID };

/** Which part of the game a bundle is: what it may import, and how it names its files. */
type Side = 'meta' | 'server' | 'client' | 'worker';

const ALLOWED: Record<Side, readonly string[]> = { meta: ['@platform'], server: SERVER_MODULES, client: CLIENT_MODULES, worker: WORKER_MODULES };

/** The files a game may name by URL (`?url`): the kinds a server serves. */
const SERVABLE = new Set(['.glb', '.gltf', '.bin', '.png', '.webp', '.jpg', '.jpeg', '.ogg', '.mp3', '.wav', '.json', '.css', '.txt']);

/** `new Worker(new URL('./x.ts', import.meta.url)`: a client Web Worker, bundled on its own. */
const WORKER = /new\s+Worker\(\s*new\s+URL\(\s*(['"])([^'"\n]+)\1\s*,\s*import\.meta\.url\s*\)/g;

/** One game's build: what all its bundles share. */
interface Build {
  root: string;
  id: string;
  dev: boolean;
  /** Its `?url` files, by their served name. */
  assets: Map<string, Buffer>;
  /** Its client's workers, by their file name in `workers/`. */
  workers: Map<string, { code: string; map: string }>;
}

/** Build the game in `folder`; throws a `BuildError` listing what's wrong with it. */
export async function buildGame(folder: string, o: BuildOptions): Promise<BuiltGame> {
  if (!existsSync(folder) || !statSync(folder).isDirectory()) throw new BuildError([`${folder}: not a folder`]);
  // Built from a copy of its own, so nothing round the folder counts (a package.json or tsconfig.json
  // above it would change esbuild's output): the same folder builds the same version anywhere.
  const staging = mkdtempSync(join(tmpdir(), 'blockyard-build-'));
  try {
    const source = resolve(folder);
    cpSync(source, join(staging, 'game'), { recursive: true, filter: (f) => f === source || !skipped(relative(source, f).split(sep).join('/')) });
    writeFileSync(join(staging, 'package.json'), '{ "type": "module" }\n');
    // Its real path: esbuild names files by theirs (a temporary folder on macOS is under a link).
    return await buildFrom(realpathSync(join(staging, 'game')), o);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

async function buildFrom(root: string, o: BuildOptions): Promise<BuiltGame> {
  for (const part of ['meta.ts', 'shared.ts', 'server.ts', 'client.ts']) {
    if (!existsSync(join(root, part))) throw new BuildError([`${part}: missing (a game is meta.ts, shared.ts, server.ts and client.ts; see docs/PLATFORM.md)`]);
  }
  // Its meta first, on its own (it may import only '@platform' and pictures): the id, and a check
  // that it's data.
  const meta = await readMeta(root);
  const id = o.id ?? meta.id;
  if (typeof id !== 'string' || !GAME_ID.test(id)) throw new BuildError([`meta.ts: the id "${String(id)}" must be 2 to 32 lowercase letters, digits and dashes, starting with a letter`]);

  const b: Build = { root, id, dev: o.dev ?? false, assets: new Map(), workers: new Map() };
  const [server, client] = await Promise.all([bundle(b, 'server', join(root, 'server.ts')), bundle(b, 'client', join(root, 'client.ts'))]);
  const workers = [...b.workers.entries()].sort(([a], [z]) => a.localeCompare(z));
  const version = hash([server.code, client.code, ...workers.map(([, w]) => w.code), ...[...b.assets.keys()].sort()].join('\0')).slice(0, 12);
  const gameDir = join(resolve(o.out), id);
  const dir = join(gameDir, version);
  mkdirSync(join(gameDir, 'assets'), { recursive: true });
  mkdirSync(join(dir, 'workers'), { recursive: true });
  for (const [name, bytes] of b.assets) {
    const file = join(gameDir, 'assets', name);
    if (!existsSync(file)) writeFileSync(file, bytes);
  }
  const files: [string, string][] = [
    ['server.js', server.code],
    ['server.js.map', server.map],
    ['client.js', client.code],
    ['client.js.map', client.map],
    ...workers.flatMap(([name, w]): [string, string][] => [
      [`workers/${name}`, w.code],
      [`workers/${name}.map`, w.map],
    ]),
  ];
  for (const [name, text] of files) writeFileSync(join(dir, name), text);
  const manifest: PackageManifest = {
    id,
    version,
    title: String(meta.title ?? id),
    built: new Date().toISOString(),
    modules: { server: server.modules, client: client.modules },
    workers: workers.map(([name]) => name),
    assets: [...b.assets.keys()].sort(),
  };
  writeFileSync(join(dir, 'game.json'), JSON.stringify(manifest, null, 1));
  return { id, version, dir, manifest };
}

/**
 * The game's id and title, read from meta.ts as text (`id: 'my-game'`, `title: 'My Game'`): a
 * build never runs a game's code (its smoke test does, in a thread of its own). Bundled too, for
 * its boundaries (meta.ts imports only '@platform' and pictures).
 */
async function readMeta(root: string): Promise<{ id?: string; title?: string }> {
  await bundle({ root, id: 'meta', dev: false, assets: new Map(), workers: new Map() }, 'meta', join(root, 'meta.ts'));
  const source = readFileSync(join(root, 'meta.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const from = source.indexOf('defineMeta(');
  if (from < 0) throw new BuildError(["meta.ts: its default export must be the game's meta (`export default defineMeta({ … })`)"]);
  const field = (name: string) => new RegExp(`\\b${name}\\s*:\\s*(['"\`])([^'"\`\\n]+)\\1`).exec(source.slice(from))?.[2];
  const id = field('id');
  if (!id) throw new BuildError(["meta.ts: its id must be written as a string (`id: 'my-game'`), the first field of its meta"]);
  return { id, title: field('title') };
}

/** One side's bundle: one ES module, the platform left out, its pictures and models alongside. */
async function bundle(b: Build, side: Side, entry: string): Promise<{ code: string; map: string; modules: PlatformModule[] }> {
  const { root, id } = b;
  const problems: string[] = [];
  const used = new Set<PlatformModule>();
  const allowed = ALLOWED[side];
  const rel = (f: string) => relative(root, f).split(sep).join('/');
  const inside = (f: string) => f === root || f.startsWith(root + sep);
  const who = side === 'meta' ? 'meta.ts' : `${side} code`;
  /** A file of another part's code, which this side must never reach (however indirectly). */
  const forbidden = (f: string) => {
    const r = rel(f);
    if (side === 'server') return r === 'client.ts' || r.startsWith('client/');
    if (side === 'client' || side === 'worker') return r === 'server.ts';
    return r !== 'meta.ts';
  };
  const plugin: esbuild.Plugin = {
    name: 'blockyard-package',
    setup(build) {
      // The public API: read from the running platform.
      build.onResolve({ filter: /^@platform(\/|$)/ }, (a) => {
        if (!allowed.includes(a.path)) {
          problems.push(`${rel(a.importer)}: ${who} may not import '${a.path}'`);
          return { path: a.path, external: true };
        }
        used.add(a.path as PlatformModule);
        return { path: a.path, namespace: 'platform' };
      });
      build.onLoad({ filter: /.*/, namespace: 'platform' }, (a) => ({
        contents: `const m = globalThis.${GLOBAL}?.modules?.[${JSON.stringify(a.path)}];\nif (!m) throw new Error(${JSON.stringify(`the platform has no ${a.path} here`)});\nmodule.exports = m;`,
        loader: 'js',
      }));
      // Pictures and models by URL; text (styles) inline.
      build.onResolve({ filter: /\?(url|raw)$/ }, (a) => {
        const [spec, kind] = a.path.split('?');
        const file = resolve(a.resolveDir, spec);
        if (!spec.startsWith('.') || !inside(file)) {
          problems.push(`${rel(a.importer)}: '${a.path}' is outside the game's folder`);
          return { path: a.path, external: true };
        }
        if (!existsSync(file) || !statSync(file).isFile()) {
          problems.push(`${rel(a.importer)}: '${a.path}' doesn't exist`);
          return { path: a.path, external: true };
        }
        // Named in the bundle by its place in the folder (esbuild prints a namespace's paths whole:
        // an absolute one would differ build to build, and tell where the server keeps things).
        return { path: rel(file), namespace: kind === 'url' ? 'asset' : 'text', pluginData: file };
      });
      build.onLoad({ filter: /.*/, namespace: 'text' }, (a) => ({ contents: readFileSync(a.pluginData as string, 'utf8'), loader: 'text' }));
      build.onLoad({ filter: /.*/, namespace: 'asset' }, (a) => {
        const file = a.pluginData as string;
        const ext = extname(file).toLowerCase();
        if (!SERVABLE.has(ext)) problems.push(`${rel(file)}: a ${ext || 'file without an extension'} can't be served (${[...SERVABLE].join(', ')})`);
        const bytes = readFileSync(file);
        const name = `${basename(file, extname(file))}-${hash(bytes).slice(0, 8)}${ext}`;
        b.assets.set(name, bytes);
        const path = `assets/${name}`;
        // A screen fetches it by its code's address (`/g/<id>/<version>/client.js`, its workers one
        // folder further down); the server names it by the server's public address.
        const up = side === 'worker' ? '../../' : '../';
        const contents = side === 'client' || side === 'worker' ? `export default new URL(${JSON.stringify(up + path)}, import.meta.url).href;` : `export default globalThis.${GLOBAL}.asset(${JSON.stringify(id)}, ${JSON.stringify(path)});`;
        return { contents, loader: 'js' };
      });
      // Its own files, inside its folder, never the other side's; nothing else.
      build.onResolve({ filter: /.*/ }, (a) => {
        if (a.kind === 'entry-point') return undefined;
        if (!a.path.startsWith('.')) {
          problems.push(`${rel(a.importer)}: may not import '${a.path}' (a game imports only its own files and ${allowed.map((m) => `'${m}'`).join(', ')})`);
          return { path: a.path, external: true };
        }
        if (!inside(resolve(a.resolveDir, a.path))) {
          problems.push(`${rel(a.importer)}: '${a.path}' is outside the game's folder`);
          return { path: a.path, external: true };
        }
        return undefined;
      });
      build.onLoad({ filter: /\.[cm]?[jt]sx?$/ }, async (a) => {
        if (a.namespace !== 'file') return undefined;
        if (forbidden(a.path)) problems.push(`${who} reaches ${rel(a.path)}, which is the ${side === 'server' ? 'client' : side === 'meta' ? "rest of the game's" : 'server'} code`);
        if (side !== 'client') return undefined;
        const source = readFileSync(a.path, 'utf8');
        if (!/new\s+Worker\(/.test(source)) return undefined;
        // Its workers: each bundled on its own, started through the platform (which hands it the
        // public API there too, and starts it from the game server's address).
        let contents = source;
        for (const m of [...source.matchAll(WORKER)].reverse()) {
          const file = resolve(join(a.path, '..'), m[2]);
          if (!m[2].startsWith('.') || !inside(file) || !existsSync(file)) {
            problems.push(`${rel(a.path)}: the worker '${m[2]}' isn't a file in the game's folder`);
            continue;
          }
          const worker = await bundle(b, 'worker', file);
          const name = `${basename(file, extname(file))}-${hash(worker.code).slice(0, 8)}.js`;
          b.workers.set(name, { code: worker.code, map: worker.map });
          const call = `globalThis.${GLOBAL}.worker(new URL(${JSON.stringify(`./workers/${name}`)}, import.meta.url).href`;
          contents = contents.slice(0, m.index) + call + contents.slice(m.index + m[0].length);
        }
        return { contents, loader: extname(a.path).slice(1) as esbuild.Loader };
      });
    },
  };
  const env = { DEV: b.dev, PROD: !b.dev, MODE: b.dev ? 'development' : 'production', SSR: side === 'server' };
  let result: esbuild.BuildResult<{ write: false; metafile: true }>;
  try {
    result = await esbuild.build({
      entryPoints: [entry],
      absWorkingDir: root,
      bundle: true,
      write: false,
      metafile: true,
      format: 'esm',
      platform: 'neutral',
      target: 'es2022',
      // The default `neutral` main fields are none; a game has no packages anyway.
      mainFields: ['module', 'main'],
      // What the repo's tsconfig.json says that changes the output (and no tsconfig.json is read).
      tsconfigRaw: { compilerOptions: { target: 'ES2022', strict: true, useDefineForClassFields: true } },
      // What Vite gives a game's code (debugging hooks behind `import.meta.env.DEV`).
      define: { 'import.meta.env': JSON.stringify(env), ...Object.fromEntries(Object.entries(env).map(([k, v]) => [`import.meta.env.${k}`, JSON.stringify(v)])) },
      outfile: join(root, `${basename(entry, extname(entry))}.js`),
      // Linked: errors in a room name the game's own files and lines (the platform turns source
      // maps on where it runs built games), and so do a browser's tools.
      sourcemap: side === 'meta' ? false : 'linked',
      sourcesContent: true,
      sourceRoot: `blockyard://${id}/`,
      logLevel: 'silent',
      plugins: [plugin],
    });
  } catch (err) {
    const errors = (err as { errors?: esbuild.Message[] }).errors;
    throw new BuildError([...new Set(problems), ...(errors?.map(describe) ?? [String(err)])]);
  }
  if (problems.length) throw new BuildError([...new Set(problems)]);
  const js = result.outputFiles.find((f) => f.path.endsWith('.js'))!;
  const map = result.outputFiles.find((f) => f.path.endsWith('.map'));
  return { code: js.text, map: map?.text ?? '', modules: [...used].sort() };
}

function describe(m: esbuild.Message): string {
  const at = m.location ? `${m.location.file}:${m.location.line}:${m.location.column}: ` : '';
  return `${at}${m.text}`;
}

const hash = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
