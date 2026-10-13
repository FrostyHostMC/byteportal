import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { GameLibrary } from '../../src/platform/host/library';
import { gameFiles, SandboxLink } from '../../src/platform/host/sandbox-link';
import { serve } from '../../src/platform/host/server';
import { MemoryStore } from '../../src/platform/host/store';
import { decode, encode } from '../../src/platform/net/codec';
import type { ClientCommand, ServerWelcome } from '../../src/platform/net/protocol';
import { buildGame } from '../../src/platform/package/build';
import { supervise } from '../../src/platform/sandbox/supervisor';
import { check } from './_harness';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until(what: string, ok: () => boolean, ms = 30000) {
  for (const t0 = Date.now(); !ok(); await wait(50)) if (Date.now() - t0 > ms) throw new Error(`timed out: ${what}`);
}

/** A game of four files whose server code is `server` (its rules object). */
function tiny(root: string, id: string, server = '{}'): string {
  const dir = join(root, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'meta.ts'), `import { defineMeta } from '@platform';\nexport default defineMeta({ id: '${id}', title: 'Tiny ${id}' });\n`);
  writeFileSync(join(dir, 'shared.ts'), `import { defineShared } from '@platform';\nimport meta from './meta';\nexport const shared = defineShared({ ...meta, world: { terrain: 'void' } });\n`);
  writeFileSync(join(dir, 'server.ts'), `import { defineServer } from '@platform';\nimport { shared } from './shared';\nexport default defineServer(shared, ${server});\n`);
  writeFileSync(join(dir, 'client.ts'), `import { defineClient } from '@platform/client';\nimport { shared } from './shared';\nexport default defineClient(shared);\n`);
  return dir;
}

/** A player: welcomed, then playing as `name`; how many batches, and how it was let go. */
function player(port: number, game: string, name: string) {
  const ws = new WebSocket(`ws://localhost:${port}/${game}`);
  const state = { welcome: null as ServerWelcome | null, batches: 0, closed: null as { code: number; reason: string } | null };
  ws.onmessage = (e) => {
    const m = decode<ServerWelcome | { t?: undefined }>(String(e.data));
    if (m.t === 'welcome') {
      state.welcome = m;
      ws.send(encode({ t: 'start', name } satisfies ClientCommand));
    } else state.batches++;
  };
  ws.onclose = (e) => (state.closed = { code: e.code, reason: e.reason });
  return { state, close: () => ws.close() };
}

/**
 * The sandbox (docs/PROPOSAL-OPEN-UPLOADS.md, stage 2): the sandbox's own bundle (built as for the
 * machine), its supervisor (at `permission` isolation: Node's permission model, what any machine
 * can do; `full` adds no network and a user of its own, on Linux), and the game server's link to it.
 * An upload is smoke-tested there; a game reaching for the file system or other programs is
 * refused; rooms run there, their store changes kept by the game server; a stuck one is stopped;
 * only the game server (with the token) may connect.
 */
export default async function sandboxedRooms() {
  const root = resolve('.');
  const dir = mkdtempSync(join(tmpdir(), 'blockyard-sandbox-'));
  // The bundle inside the repo, where it finds its packages (`ws`).
  const bundle = join(root, 'dist-sandbox/test/sandbox.js');
  execFileSync(process.execPath, ['scripts/build-sandbox.mjs', '--out', bundle], { stdio: 'pipe' });
  const wasmPath = join(root, 'engine/pkg/voxel_engine_bg.wasm');
  const wasm = readFileSync(wasmPath);
  const logs: string[] = [];
  const supervisor = await supervise({ port: 0, token: 'sekrit', isolation: 'permission', roomCommand: { node: process.execPath, script: bundle, args: ['--wasm', wasmPath] }, readable: [root, wasmPath], rooms: join(dir, 'rooms'), log: (l) => logs.push(l) });
  const url = `ws://localhost:${supervisor.port}`;
  const publicUrl = 'http://players.example';
  const link = new SandboxLink({ url, token: 'sekrit', idle: 2 });
  const library = GameLibrary.open({ root: join(dir, 'games'), publicUrl, platform: 'test', taken: () => false, build: (folder, out, id) => buildGame(folder, { out, id }), smoke: (d) => link.smoke(gameFiles(d), publicUrl) });
  const stores = new Map<string, MemoryStore>();
  const srv = await serve({ games: [], library, sandbox: link, store: (g) => stores.get(g) ?? (stores.set(g, new MemoryStore()), stores.get(g)!), port: 0, seed: 1, wasm, dev: true, stuckAfter: 3, idleStop: 0.3, saveEvery: 1, log: (l) => logs.push(l) });
  try {
    // Only the game server, with the token.
    const wrong = new SandboxLink({ url, token: 'guess' });
    const refused = await wrong.smoke({ 'server.js': '', 'game.json': '{}' }, publicUrl).catch((err: unknown) => ({ ok: false, errors: [String(err)] }));
    check(!refused.ok, `a wrong token is turned away: ${refused.errors[0]}`);

    // An upload, smoke-tested in the sandbox (in a process of its own).
    const obby = await library.install('src/games/obby', 'local', 'obby-sbx');
    check(obby.ok && link.isolation === 'permission', `Sky Obby passes its smoke test in the sandbox: ${obby.ok ? obby.summary : obby.problems.join(' | ')}`);
    // A game that reaches for what a game may not (no import needed: `process` is there): refused.
    for (const [id, reach] of [
      ['reads', `process.getBuiltinModule('node:fs').readFileSync('/etc/hosts', 'utf8')`],
      ['spawns', `process.getBuiltinModule('node:child_process').execSync('echo hi')`],
      ['writes', `process.getBuiltinModule('node:fs').writeFileSync('/tmp/blockyard-sandbox-escape', 'x')`],
    ]) {
      const tried = await library.install(tiny(dir, id, `{ setup() { ${reach}; } }`), 'local');
      check(!tried.ok && tried.problems.some((p) => /ERR_ACCESS_DENIED|Access to this API has been restricted/.test(p)), `${id}: denied (${tried.ok ? 'it passed!' : tried.problems.find((p) => p.includes('Error')) ?? tried.problems[0]})`);
    }

    // A room in the sandbox: played through the game server, its store changes kept here.
    const counter = await library.install(tiny(dir, 'counter', `{ setup(game) { game.store.set('visits', (game.store.get('visits') ?? 0) + 1); } }`), 'local');
    check(counter.ok, 'a game that counts its runs');
    const a = player(srv.port, 'counter', 'Ann');
    await until('Ann plays in the sandbox', () => a.state.batches > 20);
    check(a.state.welcome?.game === 'counter' && supervisor.running === 1, `a room's process in the sandbox: ${supervisor.running}`);
    await until('the store change kept', () => stores.get('counter')?.data().get('visits') === 1);
    a.close();
    await until('the room stops', () => srv.rooms === 0, 15000);
    await until('its process ends', () => supervisor.running === 0, 15000);
    // Its next run starts from what was kept.
    const b = player(srv.port, 'counter', 'Bob');
    await until('Bob plays', () => b.state.batches > 5);
    await until('the next run counts on', () => stores.get('counter')?.data().get('visits') === 2);
    b.close();

    // A room stuck in a loop: stopped, its players told, its process killed.
    check((await library.install(tiny(dir, 'stuck', `{ update(game) { if (game.players.some((p) => p.name === 'Hang')) for (;;) {} } }`), 'local')).ok, 'a game that gets stuck');
    const h = player(srv.port, 'stuck', 'Hang');
    await until('turned away', () => h.state.closed !== null, 20000);
    check(h.state.closed?.reason === 'The game stopped responding', `told: ${JSON.stringify(h.state.closed)}`);
    await until('its process killed', () => supervisor.running === 0, 15000);

    // Idle, the link lets the sandbox go (so its machine can sleep).
    await until('disconnected when idle', () => logs.some((l) => l.includes('game server gone')), 15000);
    console.log(`  sandbox: smoke tests and rooms in processes of their own (${link.isolation ?? 'permission'} isolation); file system and programs denied; store changes kept by the game server; a stuck room killed; the token; idle disconnect`);
  } catch (err) {
    console.log(logs.slice(-25).join('\n'));
    throw err;
  } finally {
    await srv.close();
    link.close();
    await supervisor.close();
    rmSync(dir, { recursive: true, force: true });
  }
}
