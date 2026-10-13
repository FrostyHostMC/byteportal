import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CLOSE_FULL, serve } from '../../src/platform/host/server';
import { decode, encode } from '../../src/platform/net/codec';
import { FrameReader } from '../../src/platform/net/delta';
import type { ClientCommand, ServerWelcome, WireBatch } from '../../src/platform/net/protocol';
import type { SimFrame } from '../../src/platform/sim/sim';
import { check, games, roomWorker } from './_harness';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A socket client that presses Play as `name` once welcomed. */
function client(port: number, path: string, name: string) {
  const ws = new WebSocket(`ws://localhost:${port}/${path}`);
  const frames = new FrameReader<SimFrame>();
  let welcome: ServerWelcome | null = null;
  let last: SimFrame | null = null;
  const closed = new Promise<{ code: number; reason: string }>((done) => (ws.onclose = (e) => done({ code: e.code, reason: e.reason })));
  ws.onmessage = (e) => {
    const m = decode<ServerWelcome | WireBatch>(String(e.data));
    if ('t' in m && m.t === 'welcome') {
      welcome = m;
      ws.send(encode({ t: 'start', name } satisfies ClientCommand));
    } else if ((m as WireBatch).f !== undefined) last = frames.read((m as WireBatch).f);
  };
  return {
    closed,
    get welcome() {
      return welcome;
    },
    /** Who's playing, as this client last saw. */
    players: () => last?.players.map((p) => p.name) ?? [],
    close: () => ws.close(),
  };
}

async function until(what: string, ok: () => boolean, ms = 20000) {
  for (const t0 = Date.now(); !ok(); await wait(50)) if (Date.now() - t0 > ms) throw new Error(`timed out: ${what}`);
}

/**
 * A full public game overflows: with two to a room, Arena's third arrival gets a copy of its
 * public game (a world and a thread of its own, still `public` to the game); an invite link's
 * `?shard=` lands in that copy while it has a place; arrivals fill the fullest copy first; a game
 * without `instances` (Sky Obby) is full instead; the server's room limit turns the rest away as
 * busy; `/games` counts every copy; an empty copy stops and goes.
 */
export default async function overflow() {
  const dir = mkdtempSync(join(tmpdir(), 'blockyard-overflow-'));
  const defs = ['arena', 'obby'].map((id) => games.find((g) => g.id === id)!);
  const logs: string[] = [];
  const srv = await serve({
    games: defs,
    port: 0,
    seed: 3,
    wasm: readFileSync('engine/pkg/voxel_engine_bg.wasm'),
    worker: (workerData) => {
      const w = roomWorker(workerData);
      return w;
    },
    storeFile: (game) => join(dir, `${game}.sqlite`),
    saveEvery: 1,
    idleStopOwn: 0.5,
    limits: { playersPerGame: 2, rooms: 4, perAddress: 100 },
    log: (line) => logs.push(line),
  });
  const base = `http://localhost:${srv.port}`;
  const all: ReturnType<typeof client>[] = [];
  const enter = (path: string, name: string) => {
    const c = client(srv.port, path, name);
    all.push(c);
    return c;
  };
  try {
    const ann = enter('arena', 'Ann');
    const bob = enter('arena', 'Bob');
    await until('the public game welcomes two', () => !!ann.welcome && !!bob.welcome);
    check(ann.welcome!.room === 'public' && ann.welcome!.shard === undefined && bob.welcome!.shard === undefined, `the first two in the public game proper: ${JSON.stringify([ann.welcome!.shard, bob.welcome!.shard])}`);

    // The third: a copy of it, still the public game to Arena, a world of its own.
    const cy = enter('arena', 'Cy');
    await until('Cy welcomed', () => !!cy.welcome);
    check(cy.welcome!.room === 'public' && cy.welcome!.shard === 2, `a full public game overflows into copy 2: ${JSON.stringify({ room: cy.welcome!.room, shard: cy.welcome!.shard })}`);
    await until('all three playing', () => ann.players().includes('Bob') && cy.players().includes('Cy'));
    await wait(300);
    check(!cy.players().includes('Ann') && !ann.players().includes('Cy'), `each copy sees only its own: ${ann.players()} | ${cy.players()}`);

    // An invite link to copy 2 lands there; once it's full, the next goes to a new copy 3.
    const dee = enter('arena?shard=2', 'Dee');
    await until('Dee welcomed', () => !!dee.welcome);
    check(dee.welcome!.shard === 2, `?shard=2 lands in copy 2: ${dee.welcome!.shard}`);
    await until('Dee with Cy', () => cy.players().includes('Dee'));
    const eve = enter('arena?shard=2', 'Eve');
    await until('Eve welcomed', () => !!eve.welcome);
    check(eve.welcome!.shard === 3, `copy 2 full: a new copy 3: ${eve.welcome!.shard}`);

    // Sky Obby has no copies: its third is turned away as full.
    const o1 = enter('obby', 'Fay');
    const o2 = enter('obby', 'Gus');
    await until('Obby welcomes two', () => !!o1.welcome && !!o2.welcome);
    const o3 = await enter('obby', 'Hal').closed;
    check(o3.code === CLOSE_FULL && o3.reason === 'This game is full', `a game without instances is full: ${o3.code} ${o3.reason}`);

    // Four rooms running (three of Arena, Obby's): the next copy is one too many.
    check(srv.rooms === 4, `four rooms: ${srv.rooms}`);
    const ivy = enter('arena', 'Ivy');
    await until('Ivy placed', () => !!ivy.welcome);
    check(ivy.welcome?.shard === 3, `Ivy fills copy 3 first (the fullest with a place): ${ivy.welcome?.shard}`);
    const jo = await enter('arena', 'Jo').closed;
    check(jo.code === CLOSE_FULL && /busy/.test(jo.reason), `no place, and no room for another copy: ${jo.code} ${jo.reason}`);

    // /games counts every copy.
    await wait(500);
    const list = (await (await fetch(`${base}/games`)).json()) as { games: { id: string; players: number; copies: number; running: boolean }[]; rooms: number };
    const arena = list.games.find((g) => g.id === 'arena')!;
    check(arena.running && arena.copies === 3 && arena.players === 6, `/games: Arena in 3 copies, 6 playing: ${JSON.stringify(arena)}`);

    // Copy 2 empties: it stops and goes, and a new arrival asking for it fills the fullest instead.
    cy.close();
    dee.close();
    await until('copy 2 stops', () => srv.rooms === 3, 15000);
    eve.close();
    await until('copy 3 has a place', () => srv.rooms === 3 && logs.some((l) => l.startsWith('[arena/public-3]') && l.includes('left (1 here)')), 5000);
    const kim = enter('arena?shard=2', 'Kim');
    await until('Kim placed', () => !!kim.welcome);
    check(kim.welcome!.shard === 3, `copy 2 is gone: an old link to it finds the fullest with a place: ${kim.welcome!.shard}`);
    console.log(`  overflow into copies (still public to the game) · invite links name a copy · fullest first · no copies without instances · busy at the room limit · /games counts copies · empty copies go`);
  } catch (err) {
    console.log(logs.slice(-30).join('\n'));
    throw err;
  } finally {
    for (const c of all) c.close();
    await srv.close();
    rmSync(dir, { recursive: true, force: true });
  }
}
