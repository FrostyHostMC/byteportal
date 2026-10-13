import { readFileSync } from 'node:fs';
import { defineGame, type GameContext } from '../../src/platform';
import { defineClient } from '../../src/platform/api/client';
import type { ClientEvent, Me } from '../../src/platform/api/client';
import { ClientRuntime } from '../../src/platform/client/api/client';
import { Presenter } from '../../src/platform/client/present';
import { GameHost } from '../../src/platform/host/game';
import { decode, encode } from '../../src/platform/net/codec';
import type { HostBatch, PresentCall } from '../../src/platform/net/protocol';
import { sanitizeCommand } from '../../src/platform/net/validate';
import { check } from './_harness';

const wasm = readFileSync('engine/pkg/voxel_engine_bg.wasm');

/** What the game's server heard from its clients (`clientMessage`). */
const heard: { player: string; name: string; data: unknown }[] = [];
let game: GameContext | null = null;

const chat = defineGame({
  id: 'chat',
  title: 'Chat',
  world: { terrain: 'flat', flatHeight: 64, spawn: { x: 0.5, y: 65, z: 0.5 }, time: 0.5, freezeTime: true },
  setup(g) {
    game = g;
    g.events.on('clientMessage', (e) => heard.push({ player: e.player.name, name: e.name, data: e.data }));
  },
});

const throws = (fn: () => void) => {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
};

/**
 * One player's screen: the batches as they come over the socket, through the Presenter, into the
 * game's client code (`client.on`) and its kits' events.
 */
function screen(name: string) {
  const got: [string, unknown][] = [];
  const platform: [string, unknown][] = [];
  const events: ClientEvent[] = [];
  const client = new ClientRuntime(chat, defineClient(chat, { setup: (c) => c.on('hello', (d) => got.push(['hello', d])), frame: (c) => events.push(...c.events) }).client, {
    services: {} as never,
    item: () => undefined,
    send: () => {},
    running: () => true,
  });
  client.setup({} as Me);
  const presenter = new Presenter(null, {
    hud: {} as never,
    fx: {} as never,
    sfx: {} as never,
    view: {} as never,
    send: () => {},
    // As the runtime does: the platform's own (`$`) stay with the engine; the rest are the game's.
    message: (n, d) => (n.startsWith('$') ? platform.push([n, d]) : client.message(n, d)),
  });
  return {
    name,
    got,
    platform,
    events,
    /** A batch as it arrives over the socket. */
    take(b: HostBatch) {
      for (const e of decode<HostBatch>(encode(b)).events) {
        if (e.t === 'joined') presenter.player = e.player;
        else if (e.t === 'call') presenter.apply(e.call);
      }
      client.frame(1 / 60, {} as Me);
    },
    messages: (b: HostBatch) => b.events.flatMap((e) => (e.t === 'call' && e.call.target === 'message' ? [e.call] : [])) as PresentCall[],
  };
}

/**
 * Messages between a game's server and its client code, both ways: `game.clients.send(to, name,
 * data)` reaches `client.on(name)` on the screens it's for (one player, a list, everyone) and no
 * others, as plain data; a bad name or too much data throws in the game's code. `client.send(name,
 * data)` reaches `clientMessage` on the server as the connection's player (whatever the message
 * says), after the server has checked its name, shape and size (anything else is dropped). The
 * platform's own messages (`$` names) can't be sent by either.
 */
export default function messages() {
  const host = new GameHost(chat, { engine: wasm, seed: 3, remote: true, radius: 2, budget: Infinity });
  const ann = host.connect('Ann');
  const bob = host.connect('Bob');
  // (No name: watching, not in the game.)
  const watcher = host.connect();
  host.command(ann.id, { t: 'start' });
  host.command(bob.id, { t: 'start' });
  const screens = { [ann.id]: screen('Ann'), [bob.id]: screen('Bob'), [watcher.id]: screen('Watcher') };
  for (const c of [ann, bob, watcher]) screens[c.id].take(c.batch);
  const step = () => {
    const batches = host.step(1 / 30);
    for (const [id, b] of batches) screens[id]?.take(b);
    return batches;
  };
  step();
  check(game, 'the game is set up');
  const g = game as GameContext;
  const A = g.players.find((p) => p.name === 'Ann')!;
  const B = g.players.find((p) => p.name === 'Bob')!;
  check(A && B, `both players are in: ${g.players.map((p) => p.name).join(', ')}`);

  // ---- Server to client ----
  g.clients.send(A, 'hello', { n: 1, list: [1, 'two', null], fn: () => 1, gone: undefined });
  let out = step();
  const annSaw = screens[ann.id].messages(out.get(ann.id)!);
  check(annSaw.length === 1 && annSaw[0].method === 'hello' && annSaw[0].to === A.id, `Ann's screen is sent it: ${JSON.stringify(annSaw)}`);
  check(screens[bob.id].messages(out.get(bob.id)!).length === 0 && screens[watcher.id].messages(out.get(watcher.id)!).length === 0, 'nobody else is sent it');
  check(JSON.stringify(screens[ann.id].got) === JSON.stringify([['hello', { n: 1, list: [1, 'two', null] }]]), `client.on('hello') hears it as plain data: ${JSON.stringify(screens[ann.id].got)}`);
  check(screens[ann.id].events.some((e) => e.t === 'message' && e.name === 'hello'), "and the kits see it among the frame's events");
  check(screens[bob.id].got.length === 0, "Bob's client code hears nothing");

  // A list (each once), and everyone.
  g.clients.send([A, B, A], 'hello', 2);
  g.clients.send('all', 'hello', 'everyone');
  step();
  check(JSON.stringify(screens[ann.id].got.slice(1)) === JSON.stringify([['hello', 2], ['hello', 'everyone']]), `Ann: a list once, then everyone's: ${JSON.stringify(screens[ann.id].got)}`);
  check(JSON.stringify(screens[bob.id].got) === JSON.stringify([['hello', 2], ['hello', 'everyone']]), `Bob too: ${JSON.stringify(screens[bob.id].got)}`);
  check(JSON.stringify(screens[watcher.id].got) === JSON.stringify([['hello', 'everyone']]), `someone watching gets everyone's: ${JSON.stringify(screens[watcher.id].got)}`);

  // Checked in the game's code: names, and size.
  for (const bad of ['$reset', '', '1st', 'a b', 'x'.repeat(65)]) check(throws(() => g.clients.send(A, bad, 1)), `the name "${bad}" is refused`);
  check(throws(() => g.clients.send(A, 'big', 'x'.repeat(70_000))), 'more than 64 KB is refused');
  check(!throws(() => g.clients.send(A, 'ok.name:with-parts_1', 'x'.repeat(60_000))), 'a long name of the allowed kind, and 60 KB, go');
  step();

  // ---- Client to server ----
  const wire = (msg: unknown) => sanitizeCommand(decode(encode({ t: 'message', msg })));
  const buy = wire({ t: 'game', player: B.id, name: 'buy', data: { item: 'rifle', n: 2, fn: 'not a function' } });
  check(buy?.t === 'message' && buy.msg.t === 'game' && buy.msg.player === '', `a message is taken, the player it claims dropped: ${JSON.stringify(buy)}`);
  host.command(ann.id, buy!);
  check(JSON.stringify(heard) === JSON.stringify([{ player: 'Ann', name: 'buy', data: { item: 'rifle', n: 2, fn: 'not a function' } }]), `clientMessage hears it as the connection's player (Ann, not Bob): ${JSON.stringify(heard)}`);
  // Shapes the server drops.
  const refused = [
    { t: 'game', name: '$reset', data: null },
    { t: 'game', name: 'x'.repeat(65), data: null },
    { t: 'game', name: 7, data: null },
    { t: 'game', name: 'big', data: 'x'.repeat(9000) },
    { t: 'game', name: 'list', data: Array.from({ length: 3000 }, (_, i) => i) },
  ];
  for (const m of refused) check(wire(m) === null, `refused: ${JSON.stringify(m).slice(0, 80)}`);
  // Too deep: cut off (what's past the depth arrives as null).
  const deep = wire({ t: 'game', name: 'deep', data: [[[[[[[[[[[1]]]]]]]]]]] });
  check(deep?.t === 'message' && deep.msg.t === 'game' && !JSON.stringify(deep.msg.data).includes('1'), `too deep is cut off: ${JSON.stringify(deep)}`);
  // Nothing becomes plain data: undefined arrives as null.
  const empty = wire({ t: 'game', name: 'ping' });
  check(empty?.t === 'message' && empty.msg.t === 'game' && empty.msg.data === null, `no data is null: ${JSON.stringify(empty)}`);
  // Someone only watching has no player to say it.
  host.command(watcher.id, empty!);
  check(heard.length === 1, 'a watching connection says nothing to the game');
  host.command(bob.id, empty!);
  check(heard.at(-1)?.player === 'Bob' && heard.length > 1 && heard[1].name === 'ping', `Bob's ping, the second message heard: ${JSON.stringify(heard)}`);

  // The platform's own messages still reach every screen's engine (a restart), never the game's code.
  g.restart();
  step();
  check(screens[ann.id].platform.some(([n]) => n === '$reset') && !screens[ann.id].got.some(([n]) => n === '$reset'), `a restart is the platform's message: ${JSON.stringify(screens[ann.id].platform.map(([n]) => n))}`);
  console.log(`  server -> client: one, a list, everyone; ${5 + 1} bad sends refused; client -> server: as the connection's player, ${refused.length} bad shapes refused`);
}
