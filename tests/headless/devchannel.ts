import { readFileSync } from 'node:fs';
import { defineGame } from '../../src/platform';
import { GameHost } from '../../src/platform/host/game';
import { serveGame } from '../../src/platform/host/server';
import { decode, encode } from '../../src/platform/net/codec';
import { FrameReader } from '../../src/platform/net/delta';
import type { ClientCommand, DevReply, ServerWelcome, WireBatch } from '../../src/platform/net/protocol';
import { sanitizeCommand } from '../../src/platform/net/validate';
import type { SimFrame } from '../../src/platform/sim/sim';
import { check } from './_harness';

const wasm = readFileSync('engine/pkg/voxel_engine_bg.wasm');

const field = defineGame({
  id: 'field',
  title: 'Field',
  world: { terrain: 'flat', flatHeight: 64, spawn: { x: 0.5, y: 65, z: 0.5 }, time: 0.5, freezeTime: true },
});

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A client as the browser is one: watching once connected, and in the game after `start` (with a name). */
async function connect(port: number) {
  const ws = new WebSocket(`ws://localhost:${port}/`);
  const replies = new Map<number, DevReply>();
  const frames = new FrameReader<SimFrame>();
  let frame: SimFrame | null = null;
  let player = '';
  await new Promise<ServerWelcome>((resolve, reject) => {
    ws.onerror = () => reject(new Error('socket error'));
    ws.onmessage = (e) => {
      const m = decode<ServerWelcome | WireBatch>(String(e.data));
      if ('t' in m) return resolve(m);
      if (m.f !== undefined) frame = frames.read(m.f);
      for (const ev of m.events) {
        if (ev.t === 'reply') replies.set(ev.id, ev.value as DevReply);
        if (ev.t === 'joined') player = ev.player;
      }
    };
  });
  let next = 1;
  const send = (c: ClientCommand) => ws.send(encode(c));
  return {
    send,
    /** `__game.dev(js)`, as the browser sends it: the reply, or null if none came. */
    async dev(js: string): Promise<DevReply | null> {
      const id = next++;
      send({ t: 'dev', id, js });
      for (let i = 0; i < 100 && !replies.has(id); i++) await wait(10);
      return replies.get(id) ?? null;
    },
    async join(name: string) {
      send({ t: 'start', name });
      for (let i = 0; i < 100 && !player; i++) await wait(10);
      return player;
    },
    me: () => (frame as SimFrame | null)?.players.find((p) => p.id === player),
    close: () => ws.close(),
  };
}

/**
 * The development channel (`__game.dev(js)` in the browser): a development server runs a
 * client's snippet in its room, with the game's context and the client's own player, and answers
 * with the result as JSON (or the error). Any other server refuses it, and so does a host not in
 * development mode, without running a line of it.
 */
export default async function devchannel() {
  const ran = globalThis as { __devRan?: number };
  ran.__devRan = 0;
  check(sanitizeCommand({ t: 'dev', id: 3, js: 'game' })?.t === 'dev' && sanitizeCommand({ t: 'dev', id: 3, js: 7 }) === null, 'a dev command is checked like the rest');

  // A server that isn't in development mode refuses it at the socket.
  const prod = await serveGame(field, { port: 0, seed: 1, wasm, tickRate: 30, cheats: true });
  try {
    const ann = await connect(prod.port);
    await ann.join('Ann');
    const r = await ann.dev('globalThis.__devRan = 1; return 2');
    check(r && !r.ok && /refused/.test(r.error), `refused without development mode: ${JSON.stringify(r)}`);
    await wait(100);
    check(ran.__devRan === 0, 'and the snippet never ran');
    ann.close();
  } finally {
    await prod.close();
  }

  // So does a host not in development mode (whatever reaches it).
  const host = new GameHost(field, { engine: wasm, seed: 1, remote: true, radius: 2, budget: Infinity });
  const c = host.connect('Ann');
  host.command(c.id, { t: 'dev', id: 9, js: 'globalThis.__devRan = 1' });
  const answer = host.step(1 / 30).get(c.id)!.events.find((e) => e.t === 'reply' && e.id === 9);
  check(answer?.t === 'reply' && !(answer.value as DevReply).ok && ran.__devRan === 0, `the host refuses it too: ${JSON.stringify(answer)}`);
  host.dispose();

  // A development server runs it in the room: `game`, and `me` for whoever sent it.
  const dev = await serveGame(field, { port: 0, seed: 1, wasm, tickRate: 30, cheats: true, dev: true });
  try {
    const ann = await connect(dev.port);
    const watching = await ann.dev('me === null && game.players.length === 0');
    check(watching?.ok && watching.value === true, `watching, there's no me yet: ${JSON.stringify(watching)}`);
    await ann.join('Ann');
    const bob = await connect(dev.port);
    await bob.join('Bob');
    const count = await ann.dev('game.players.length');
    check(count?.ok && count.value === 2, `an expression: ${JSON.stringify(count)}`);
    const who = await bob.dev('me.name');
    check(who?.ok && who.value === 'Bob', `me is the sender's player: ${JSON.stringify(who)}`);
    const moved = await ann.dev('me.teleport({ x: 6.5, y: 65, z: 7.5 }); return me.position');
    check(moved?.ok && (moved.value as { x: number }).x === 6.5, `a function body, its result as JSON: ${JSON.stringify(moved)}`);
    await wait(200);
    const at = ann.me();
    check(at && Math.hypot(at.x - 6.5, at.z - 7.5) < 0.01, `the teleport shows in the frames: ${at?.x}, ${at?.z}`);
    const failed = await ann.dev('throw new Error("boom")');
    check(failed && !failed.ok && failed.error.includes('boom'), `an error comes back: ${JSON.stringify(failed)}`);
    const later = await ann.dev('new Promise((done) => setTimeout(() => done(41 + 1), 50))');
    check(later?.ok && later.value === 42, `a promise is awaited: ${JSON.stringify(later)}`);
    const odd = await ann.dev('const o = { n: 1, f() {}, big: 2n }; o.self = o; return o');
    check(odd?.ok && JSON.stringify(odd.value) === '{"n":1,"big":"2","self":"[repeated]"}', `anything becomes JSON: ${JSON.stringify(odd)}`);
    check(ran.__devRan === 0, 'the refused snippets still never ran');
    ann.close();
    bob.close();
    console.log('  refused by a server and a host not in development mode; in development: expressions, bodies, me per client, errors, promises');
  } finally {
    await dev.close();
    delete ran.__devRan;
  }
}
