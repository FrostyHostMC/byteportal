import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { CLOSE_LIMIT, CLOSE_UNKNOWN, serve } from '../../src/platform/host/server';
import { SqliteStore } from '../../src/platform/host/sqlite';
import { decode, encode } from '../../src/platform/net/codec';
import { FrameReader } from '../../src/platform/net/delta';
import type { ClientCommand, ServerWelcome, TimedBatch, WireBatch } from '../../src/platform/net/protocol';
import type { SimFrame } from '../../src/platform/sim/sim';
import { check, games, roomWorker } from './_harness';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A socket client that presses Play as `name` once welcomed. */
function client(port: number, path: string, name: string) {
  const ws = new WebSocket(`ws://localhost:${port}/${path}`);
  const batches: TimedBatch[] = [];
  const frames = new FrameReader<SimFrame>();
  let welcome: ServerWelcome | null = null;
  const closed = new Promise<{ code: number; reason: string }>((done) => (ws.onclose = (e) => done({ code: e.code, reason: e.reason })));
  ws.onmessage = (e) => {
    const m = decode<ServerWelcome | WireBatch>(String(e.data));
    if ('t' in m && m.t === 'welcome') {
      welcome = m;
      ws.send(encode({ t: 'start', name } satisfies ClientCommand));
    } else batches.push({ events: (m as WireBatch).events, frame: (m as WireBatch).f === undefined ? null : frames.read((m as WireBatch).f), time: (m as WireBatch).time });
  };
  return {
    closed,
    get welcome() {
      return welcome;
    },
    /** Who's playing, as this client last saw. */
    players: () => [...batches].reverse().find((b) => b.frame)?.frame?.players.map((p) => p.name) ?? [],
    /** The time of day, as this client last saw. */
    time: () => [...batches].reverse().find((b) => b.frame)?.frame?.time ?? -1,
    send: (cmd: ClientCommand) => ws.send(encode(cmd)),
    close: () => ws.close(),
  };
}

async function until(what: string, ok: () => boolean, ms = 20000) {
  for (const t0 = Date.now(); !ok(); await wait(50)) if (Date.now() - t0 > ms) throw new Error(`timed out: ${what}`);
}

/**
 * Rooms of one's own: Bed Wars' public room and a room of Bob's run side by side, each in a worker
 * thread of its own (the games' module-level state kept apart), each seeing only its own players;
 * `/games` counts them; a game without instances, a bad code and too many rooms are turned away;
 * an empty room of one's own stops and goes; and the rooms share the game's data.
 */
export default async function instances() {
  const dir = mkdtempSync(join(tmpdir(), 'blockyard-rooms-'));
  const defs = ['bedwars', 'arena', 'sandbox'].map((id) => games.find((g) => g.id === id)!);
  const logs: string[] = [];
  const threads: Worker[] = [];
  const started = () => threads.length;
  const srv = await serve({
    games: defs,
    port: 0,
    seed: 3,
    wasm: readFileSync('engine/pkg/voxel_engine_bg.wasm'),
    worker: (workerData) => {
      const w = roomWorker(workerData);
      threads.push(w);
      return w;
    },
    storeFile: (game) => join(dir, `${game}.sqlite`),
    saveEvery: 1,
    idleStopOwn: 0.5,
    limits: { roomsPerAddress: 2 },
    log: (line) => logs.push(line),
  });
  const base = `http://localhost:${srv.port}`;
  try {
    const ann = client(srv.port, 'bedwars', 'Ann');
    const bob = client(srv.port, 'bedwars/bobs1234', 'Bob');
    await until('both rooms welcome', () => !!ann.welcome && !!bob.welcome);
    check(ann.welcome!.room === 'public' && bob.welcome!.room === 'bobs1234', `welcomed to their rooms: ${ann.welcome!.room}, ${bob.welcome!.room}`);
    await until('both playing', () => ann.players().includes('Ann') && bob.players().includes('Bob'));
    await wait(500);
    check(!ann.players().includes('Bob') && !bob.players().includes('Ann'), `each room sees only its own: ${ann.players()} | ${bob.players()}`);
    // The time of day (and restarting) is Bob's to change in his own room, and nobody's in the
    // public one (a server without cheats).
    const before = ann.time();
    ann.send({ t: 'env', time: 0.9 });
    bob.send({ t: 'env', time: 0.9 });
    await until('Bob’s clock set', () => Math.abs(bob.time() - 0.9) < 0.01);
    check(Math.abs(ann.time() - before) < 0.01, `the public game's clock stays: ${before} -> ${ann.time()}`);
    check(started() === 2, `a thread per room: ${started()}`);
    const list = (await (await fetch(`${base}/games`)).json()) as { games: { id: string; players: number; rooms: number; playingOwn: number; instances: boolean }[]; rooms: number };
    const bw = list.games.find((g) => g.id === 'bedwars')!;
    check(bw.instances && bw.players === 1 && bw.rooms === 1 && bw.playingOwn === 1 && list.rooms === 2, `/games counts them: ${JSON.stringify(bw)}, ${list.rooms} running`);
    check(!list.games.find((g) => g.id === 'sandbox')!.instances, 'Sandbox has no rooms of its own');

    // Turned away: a game without them, a bad code, a third room of one's own.
    const sandboxOwn = await client(srv.port, 'sandbox/abcd1234', 'Cy').closed;
    const badCode = await client(srv.port, 'bedwars/NOPE!', 'Cy').closed;
    check(sandboxOwn.code === CLOSE_UNKNOWN && badCode.code === CLOSE_UNKNOWN, `no such rooms: ${sandboxOwn.code}, ${badCode.code}`);
    const second = client(srv.port, 'arena/bobarena1', 'Bob');
    await until('a second room of his own', () => !!second.welcome);
    const third = await client(srv.port, 'bedwars/bobthird1', 'Bob').closed;
    check(third.code === CLOSE_LIMIT, `a third is too many: ${third.code} ${third.reason}`);
    // Someone else joins Bob's room by its code: same room, a friend.
    const cy = client(srv.port, 'bedwars/bobs1234', 'Cy');
    await until('Cy in Bob’s room', () => bob.players().includes('Cy'));
    check(!ann.players().includes('Cy') && started() === 3, `Cy joined Bob's room, not a new one: ${bob.players()}`);

    // Everyone leaves Bob's room: it stops, its thread ends, it's gone.
    bob.close();
    cy.close();
    second.close();
    await until('the rooms of his own stop', () => srv.rooms === 1, 30000);
    await until('their threads end', () => threads.filter((t) => t.threadId !== -1).length === 1, 15000);
    const again = client(srv.port, 'bedwars/bobs1234', 'Bob');
    await until('the code again: a fresh room', () => again.players().includes('Bob'));
    check(!again.players().includes('Cy') && started() === 4, 'the same code later: a new room');
    again.close();

    // The rooms share the game's data: what one writes, another's store picks up on its next flush.
    const a = SqliteStore.open(join(dir, 'bedwars.sqlite'), 'bedwars');
    const b = SqliteStore.open(join(dir, 'bedwars.sqlite'), 'bedwars');
    a.put('stats:Ann', { wins: 1 });
    a.flush();
    check(b.data().get('stats:Ann') === undefined, 'not before it looks again');
    b.flush();
    check((b.data().get('stats:Ann') as { wins: number })?.wins === 1, `picked up: ${JSON.stringify(b.data().get('stats:Ann'))}`);
    a.close();
    b.close();
    console.log(`  public and own rooms side by side, a thread each · only their own players · /games counts · limits · empty rooms of one's own go · shared data`);
    ann.close();
  } catch (err) {
    console.log(logs.slice(-30).join('\n'));
    throw err;
  } finally {
    await srv.close();
    rmSync(dir, { recursive: true, force: true });
  }
}
