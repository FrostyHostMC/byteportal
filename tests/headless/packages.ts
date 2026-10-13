import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { GameLibrary } from '../../src/platform/host/library';
import { loadPackaged, smokeTest } from '../../src/platform/host/packaged';
import { serve } from '../../src/platform/host/server';
import { decode, encode } from '../../src/platform/net/codec';
import type { ClientCommand, ServerWelcome } from '../../src/platform/net/protocol';
import { BuildError, buildGame } from '../../src/platform/package/build';
import type { PackageEntry } from '../../src/platform/package/link';
import { check, roomWorker } from './_harness';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A game of four files, with `files` replacing or adding some. */
function tiny(root: string, name: string, files: Record<string, string> = {}): string {
  const dir = join(root, name);
  const all: Record<string, string> = {
    'meta.ts': `import { defineMeta } from '@platform';\nexport default defineMeta({ id: 'tiny', title: 'Tiny' });\n`,
    'shared.ts': `import { defineShared } from '@platform';\nimport meta from './meta';\nexport const shared = defineShared({ ...meta, world: { terrain: 'void' } });\n`,
    'server.ts': `import { defineServer } from '@platform';\nimport { shared } from './shared';\nexport default defineServer(shared, {});\n`,
    'client.ts': `import { defineClient } from '@platform/client';\nimport { shared } from './shared';\nexport default defineClient(shared);\n`,
    ...files,
  };
  for (const [file, text] of Object.entries(all)) {
    mkdirSync(join(dir, file, '..'), { recursive: true });
    writeFileSync(join(dir, file), text);
  }
  return dir;
}

/** The problems building `folder` finds (none: it built). */
async function problems(folder: string, out: string): Promise<string[]> {
  try {
    await buildGame(folder, { out });
    return [];
  } catch (err) {
    if (err instanceof BuildError) return err.problems;
    throw err;
  }
}

/**
 * Built games (docs/PROPOSAL-UPLOADS.md): a game's folder packaged the way an upload is, its
 * boundaries held, smoke-tested, then hosted by a server (a room in a worker thread of its own
 * importing the built server code) that serves screens its client code and files, never its server code.
 */
export default async function packages() {
  const dir = mkdtempSync(join(tmpdir(), 'blockyard-packages-'));
  const out = join(dir, 'games');
  const wasm = readFileSync('engine/pkg/voxel_engine_bg.wasm');
  try {
    // Sky Obby, under another id: both sides built, the platform left out, its cover alongside.
    const obby = await buildGame('src/games/obby', { out, id: 'obby-pkg' });
    const m = obby.manifest;
    check(m.id === 'obby-pkg' && /^[0-9a-f]{12}$/.test(m.version), `built: ${m.id} ${m.version}`);
    check(m.modules.server.includes('@platform/kits') && !m.modules.client.includes('@platform/kits') && m.modules.client.includes('@platform/client'), `each side imports its own API: ${JSON.stringify(m.modules)}`);
    const server = readFileSync(join(obby.dir, 'server.js'), 'utf8');
    const client = readFileSync(join(obby.dir, 'client.js'), 'utf8');
    check(!/from\s*["']@platform/.test(server + client), 'no @platform import is left in the bundles');
    check(!server.includes('defineSounds') && client.includes('defineSounds'), "the client's code is only in client.js");
    check(m.assets.length === 1 && existsSync(join(out, 'obby-pkg', 'assets', m.assets[0])), `its cover is in assets/: ${m.assets}`);
    const again = await buildGame('src/games/obby', { out, id: 'obby-pkg' });
    check(again.version === obby.version, 'the same folder builds the same version');

    // Golf: its client's terrain workers are bundled on their own and started through the platform.
    const golf = await buildGame('src/games/golf', { out, id: 'golf-pkg' });
    const golfClient = readFileSync(join(golf.dir, 'client.js'), 'utf8');
    check(golf.manifest.workers.length === 1 && existsSync(join(golf.dir, 'workers', golf.manifest.workers[0])), `a worker of its own: ${golf.manifest.workers}`);
    check(golfClient.includes('__blockyard.worker(') && !golfClient.includes('terrain-worker.ts'), 'started through the platform');

    // Boundaries: what a game may not import is refused, with where.
    check((await problems(tiny(dir, 'ok'), out)).length === 0, 'the tiny game builds');
    const cases: [string, Record<string, string>, RegExp][] = [
      ['client-kits', { 'client.ts': `import { melee } from '@platform/kits';\nimport { defineClient } from '@platform/client';\nimport { shared } from './shared';\nexport default defineClient(shared, { setup() { console.log(melee); } });\n` }, /client\.ts: client code may not import '@platform\/kits'/],
      ['server-client', { 'server.ts': `import { defineServer } from '@platform';\nimport { view } from './client/view';\nimport { shared } from './shared';\nexport default defineServer(shared, { setup() { console.log(view); } });\n`, 'client/view.ts': `export const view = 1;\n` }, /server code reaches client\/view\.ts/],
      ['outside', { 'shared.ts': `import { defineShared } from '@platform';\nimport meta from './meta';\nimport { x } from '../ok/shared';\nexport const shared = defineShared({ ...meta, world: { terrain: 'void' } });\nconsole.log(x);\n` }, /'\.\.\/ok\/shared' is outside the game's folder/],
      ['package', { 'server.ts': `import { defineServer } from '@platform';\nimport { readFileSync } from 'node:fs';\nimport { shared } from './shared';\nexport default defineServer(shared, { setup() { readFileSync('/'); } });\n` }, /may not import 'node:fs'/],
      ['bad-id', { 'meta.ts': `import { defineMeta } from '@platform';\nexport default defineMeta({ id: 'Not An Id', title: 'Tiny' });\n` }, /the id "Not An Id"/],
    ];
    for (const [name, files, expect] of cases) {
      const found = await problems(tiny(dir, name, files), out);
      check(found.some((p) => expect.test(p)), `${name}: refused (${found.join(' | ') || 'it built'})`);
    }
    const missing = tiny(dir, 'missing');
    rmSync(join(missing, 'client.ts'));
    check((await problems(missing, out)).some((p) => p.startsWith('client.ts: missing')), 'a game without client.ts is refused');

    // The smoke test: Sky Obby plays; a game that throws as it plays doesn't pass.
    const smoke = await smokeTest(obby.dir, wasm, { seconds: 4 });
    check(smoke.ok, `Sky Obby passes its smoke test: ${smoke.errors.join(' | ')}`);
    const throws = await buildGame(tiny(dir, 'throws', { 'server.ts': `import { defineServer } from '@platform';\nimport { shared } from './shared';\nlet n = 0;\nexport default defineServer(shared, { update() { if (++n > 30) throw new Error('boom'); } });\n` }), { out, id: 'throws' });
    const failed = await smokeTest(throws.dir, wasm, { seconds: 2 });
    check(!failed.ok && failed.errors.some((e) => e.includes('boom')), `a game that throws fails it: ${failed.errors[0]?.split('\n')[0]}`);
    // Built for production, `import.meta.env` is Vite's, as plain Node runs it.
    const env = await buildGame(tiny(dir, 'env', { 'server.ts': `import { defineServer } from '@platform';\nimport { shared } from './shared';\nexport default defineServer(shared, { setup() { if (import.meta.env.DEV || !import.meta.env.PROD) throw new Error('not production'); } });\n` }), { out, id: 'env' });
    const envSmoke = await smokeTest(env.dir, wasm, { seconds: 1 });
    check(envSmoke.ok, `import.meta.env is production's: ${envSmoke.errors[0]}`);

    // Hosted: a server with the built Obby, not listed, its room in a thread of its own.
    const publicUrl = 'http://players.example';
    const def = await loadPackaged(obby.dir, publicUrl);
    check(def.id === 'obby-pkg' && def.cover?.startsWith(`${publicUrl}/g/obby-pkg/assets/`), `named by its hosted id, its cover by the server's address: ${def.id} ${def.cover}`);
    const library = GameLibrary.open({ root: join(dir, 'library'), publicUrl, platform: 'test', taken: () => false, build: (folder, to, id) => buildGame(folder, { out: to, id }), smoke: (d) => smokeTest(d, wasm, { publicUrl, seconds: 2 }) });
    const installed = await library.install('src/games/obby', 'local', 'obby-pkg');
    check(installed.ok && installed.version === obby.version, `installed in a library: ${installed.ok ? installed.version : installed.problems.join(' | ')}`);
    const threads: Worker[] = [];
    const srv = await serve({
      games: [],
      library,
      port: 0,
      seed: 1,
      wasm,
      worker: (workerData) => {
        const w = roomWorker(workerData);
        threads.push(w);
        return w;
      },
      log: () => {},
    });
    const base = `http://localhost:${srv.port}`;
    try {
      const entry = (await (await fetch(`${base}/g/obby-pkg`)).json()) as PackageEntry;
      check(entry.version === obby.version && entry.client === `${publicUrl}/g/obby-pkg/${obby.version}/client.js` && entry.meta.title === 'Sky Obby', `GET /g/<id>: ${JSON.stringify({ ...entry, meta: undefined })}`);
      const js = await fetch(`${base}/g/obby-pkg/${obby.version}/client.js`);
      check(js.ok && js.headers.get('content-type')?.startsWith('text/javascript') && js.headers.get('access-control-allow-origin') === '*', `its client code, for any page: ${js.status} ${js.headers.get('content-type')}`);
      const cover = await fetch(`${base}/g/obby-pkg/assets/${m.assets[0]}`);
      check(cover.ok && cover.headers.get('content-type') === 'image/webp', `its cover: ${cover.status}`);
      for (const path of [`${obby.version}/server.js`, `${obby.version}/server.js.map`, 'assets/..%2fgame.json', `assets/..%2f${obby.version}%2fserver.js`, `${obby.version}/workers/..%2fserver.js`, 'nope']) {
        const res = await fetch(`${base}/g/obby-pkg/${path}`);
        check(res.status === 404, `${path} isn't served: ${res.status}`);
      }
      const list = (await (await fetch(`${base}/games`)).json()) as { games: { id: string }[] };
      check(!list.games.some((g) => g.id === 'obby-pkg'), 'not listed');

      // A player joins: the room's thread imports the built server code and plays it.
      const ws = new WebSocket(`ws://localhost:${srv.port}/obby-pkg`);
      let welcome: ServerWelcome | null = null;
      let batches = 0;
      ws.onmessage = (e) => {
        const msg = decode<ServerWelcome | { t?: undefined }>(String(e.data));
        if (msg.t === 'welcome') {
          welcome = msg;
          ws.send(encode({ t: 'start', name: 'Ann' } satisfies ClientCommand));
        } else batches++;
      };
      for (const t0 = Date.now(); batches < 30; await wait(50)) if (Date.now() - t0 > 20000) throw new Error(`timed out: the room plays (${batches} batches)`);
      check((welcome as ServerWelcome | null)?.game === 'obby-pkg' && threads.length === 1, `played in a thread of its own: ${(welcome as ServerWelcome | null)?.game}`);
      ws.close();
    } finally {
      await srv.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
