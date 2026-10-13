import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { Accounts } from '../../src/platform/host/accounts';
import { GameLibrary } from '../../src/platform/host/library';
import { smokeTest, type SmokeResult } from '../../src/platform/host/packaged';
import { CLOSE_UNKNOWN, serve } from '../../src/platform/host/server';
import { decode, encode } from '../../src/platform/net/codec';
import type { ClientCommand, ServerWelcome } from '../../src/platform/net/protocol';
import { buildGame } from '../../src/platform/package/build';
import type { MyGames } from '../../src/platform/package/link';
import { check, roomWorker } from './_harness';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A socket to a game: welcomed (and playing), or turned away (the close's code and reason). */
function connect(port: number, path: string) {
  const ws = new WebSocket(`ws://localhost:${port}/${path}`);
  const state = { welcome: null as ServerWelcome | null, closed: null as { code: number; reason: string } | null };
  ws.onmessage = (e) => {
    const m = decode<ServerWelcome | { t?: undefined }>(String(e.data));
    if (m.t === 'welcome') {
      state.welcome = m;
      ws.send(encode({ t: 'start', name: 'Ann' } satisfies ClientCommand));
    }
  };
  ws.onclose = (e) => (state.closed = { code: e.code, reason: e.reason });
  return { state, close: () => ws.close() };
}

async function until(what: string, ok: () => boolean, ms = 20000) {
  for (const t0 = Date.now(); !ok(); await wait(50)) if (Date.now() - t0 > ms) throw new Error(`timed out: ${what}`);
}

/**
 * Uploaded games after an update to the platform (docs/PROPOSAL-UPLOADS.md, phase 4): a server on
 * a new build smoke-tests each hosted game's current version again (only those last checked on
 * another build); one that fails is broken: off the list, turned away with a reason, its owners
 * told (with what went wrong) until it passes again ("check again") or a new version comes.
 */
export default async function rechecks() {
  const dir = mkdtempSync(join(tmpdir(), 'blockyard-rechecks-'));
  const root = join(dir, 'games');
  const wasm = readFileSync('engine/pkg/voxel_engine_bg.wasm');
  const publicUrl = 'http://players.example';
  const build = (folder: string, out: string, id: string | undefined) => buildGame(folder, { out, id });
  const realSmoke = (d: string) => smokeTest(d, wasm, { publicUrl, seconds: 2 });
  try {
    // Uploaded on platform build p1: checked there as it went in.
    const p1 = GameLibrary.open({ root, publicUrl, platform: 'p1', taken: () => false, build, smoke: realSmoke });
    const up = await p1.install('src/games/obby', 'local', 'obby-x');
    check(up.ok && p1.record('obby-x')?.versions[0].check?.platform === 'p1' && p1.record('obby-x')?.versions[0].check?.ok, 'checked on p1 as it was uploaded');
    p1.setListed('obby-x', true);
    p1.setHome('obby-x', 'approved');
    check((await p1.recheck()).length === 0, 'the same build: nothing to check again');

    // An update to the platform (build p2) that breaks it: checked again on boot, broken.
    let breaks = true;
    const p2Smoke = async (d: string): Promise<SmokeResult> => (breaks ? { ok: false, errors: ["TypeError: game.oldThing is not a function\n    at setup (server.js:12:3)"], summary: 'it threw' } : realSmoke(d));
    const p2 = GameLibrary.open({ root, publicUrl, platform: 'p2', taken: () => false, build, smoke: p2Smoke });
    const found = await p2.recheck();
    check(found.length === 1 && !found[0].ok && p2.broken('obby-x')?.errors?.[0].includes('oldThing'), `broken by p2: ${JSON.stringify(found)}`);
    check((await p2.recheck()).length === 0, 'checked once per build');

    // Hosted broken: not listed, turned away saying why, its owner told.
    const accounts = Accounts.open(':memory:');
    const threads: Worker[] = [];
    const srv = await serve({ games: [], library: p2, accounts, port: 0, seed: 1, wasm, dev: true, worker: (workerData) => {
      const w = roomWorker(workerData);
      threads.push(w);
      return w;
    }, log: () => {} });
    const base = `http://localhost:${srv.port}`;
    try {
      const listed = (await (await fetch(`${base}/games`)).json()) as { games: { id: string }[] };
      check(!listed.games.some((g) => g.id === 'obby-x'), 'not listed while broken');
      const turned = connect(srv.port, 'obby-x');
      await until('turned away', () => turned.state.closed !== null);
      check(turned.state.closed?.code === CLOSE_UNKNOWN && turned.state.closed.reason.includes('update to Blockyard'), `turned away: ${JSON.stringify(turned.state.closed)}`);
      const mine = (await (await fetch(`${base}/g/mine`)).json()) as MyGames;
      const game = mine.games.find((g) => g.id === 'obby-x');
      check(game?.broken?.errors[0].includes('oldThing'), `her page says so: ${JSON.stringify(game?.broken)}`);

      // Fixed (the platform patched): "check again", and it's back.
      breaks = false;
      const again = await fetch(`${base}/g/obby-x/manage`, { method: 'POST', body: JSON.stringify({ recheck: true }) });
      const body = (await again.json()) as { broken: unknown };
      check(again.ok && body.broken === null && !p2.broken('obby-x'), 'passes again');
      const back = (await (await fetch(`${base}/games`)).json()) as { games: { id: string }[] };
      check(back.games.some((g) => g.id === 'obby-x'), 'listed again');
      const plays = connect(srv.port, 'obby-x');
      await until('it plays', () => !!plays.state.welcome);
      check(plays.state.welcome?.game === 'obby-x' && threads.length >= 1, 'played again');
      plays.close();
    } finally {
      await srv.close();
    }

    // A new upload while broken also mends it (checked as it goes in).
    breaks = true;
    await p2.recheck({ force: true });
    check(!!p2.broken('obby-x'), 'broken again');
    breaks = false;
    const fixed = await p2.install('src/games/heart-hunt', 'local', 'obby-x');
    check(fixed.ok && !p2.broken('obby-x'), `a new version mends it: ${fixed.ok ? fixed.version : fixed.problems[0]}`);
    console.log('  rechecks: once per platform build, broken (off the list, turned away with why, owners told), check again, a new version mends it');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
