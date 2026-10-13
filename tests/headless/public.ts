import { readFileSync } from 'node:fs';
import { CLOSE_FULL, CLOSE_LIMIT, serve } from '../../src/platform/host/server';
import { MemoryStore } from '../../src/platform/host/store';
import { decode, encode } from '../../src/platform/net/codec';
import { FrameReader } from '../../src/platform/net/delta';
import type { ClientCommand, ServerWelcome, TimedBatch, WireBatch } from '../../src/platform/net/protocol';
import type { SimFrame } from '../../src/platform/sim/sim';
import { check, games } from './_harness';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A socket client; `closed` resolves with the close code and reason. */
function client(port: number, path: string, name: string) {
  const ws = new WebSocket(`ws://localhost:${port}/${path}?name=${encodeURIComponent(name)}`);
  const batches: TimedBatch[] = [];
  const frames = new FrameReader<SimFrame>();
  const read = (w: WireBatch): TimedBatch => ({ events: w.events, frame: w.f === undefined ? null : frames.read(w.f), time: w.time });
  let welcome: ServerWelcome | null = null;
  const closed = new Promise<{ code: number; reason: string }>((resolve) => (ws.onclose = (e) => resolve({ code: e.code, reason: e.reason })));
  const opened = new Promise<void>((resolve) => (ws.onopen = () => resolve()));
  ws.onmessage = (e) => {
    const m = decode<ServerWelcome | WireBatch>(String(e.data));
    if ('t' in m && m.t === 'welcome') {
      welcome = m;
      // Watching; press Play.
      ws.send(encode({ t: 'start', name } satisfies ClientCommand));
    } else batches.push(read(m as WireBatch));
  };
  return {
    ws,
    batches,
    closed,
    opened,
    get welcome() {
      return welcome;
    },
    send: (c: ClientCommand | string) => ws.send(typeof c === 'string' ? c : encode(c)),
    replies: () => batches.flatMap((b) => b.events.filter((e) => e.t === 'reply').map((e) => (e.t === 'reply' ? e.value : null))),
  };
}

/** The server as the internet sees it: several games on one port, limits, bad input, idle games. */
export default async function publicServer() {
  const wasm = readFileSync('engine/pkg/voxel_engine_bg.wasm');
  const defs = ['sandbox', 'bedwars'].map((id) => games.find((g) => g.id === id)!);
  const stores = new Map<string, MemoryStore>();
  const logs: string[] = [];
  const srv = await serve({
    games: defs,
    port: 0,
    seed: 5,
    wasm,
    idleStop: 0.5,
    store: (g) => stores.get(g) ?? stores.set(g, new MemoryStore()).get(g)!,
    limits: { playersPerGame: 2, perAddress: 3, messagesPerSecond: 60, maxMessage: 4096 },
    log: (line) => logs.push(line),
  });
  const base = `http://localhost:${srv.port}`;
  try {
    check((await (await fetch(`${base}/health`)).text()) === 'ok', 'health');
    const listed = (await (await fetch(`${base}/games`)).json()) as { games: { id: string; running: boolean }[] };
    check(listed.games.map((g) => g.id).join() === 'sandbox,bedwars' && listed.games.every((g) => !g.running), `games listed, none running: ${JSON.stringify(listed)}`);

    // Two into Sandbox (its limit), one into Bed Wars; a third into Sandbox is turned away, and a
    // fourth connection from this address too.
    const ann = client(srv.port, 'sandbox', 'Ann');
    const bob = client(srv.port, 'sandbox', 'Bob');
    const cat = client(srv.port, 'bedwars', 'Cat');
    await wait(400);
    check(ann.welcome?.game === 'sandbox' && cat.welcome?.game === 'bedwars', 'each joined their game');
    const full = client(srv.port, 'sandbox', 'Dan');
    const turned = await full.closed;
    check(turned.code === CLOSE_FULL || turned.code === CLOSE_LIMIT, `turned away: ${turned.code} ${turned.reason}`);

    // Rubbish of every kind is ignored; the game goes on.
    ann.send('not json');
    ann.send(JSON.stringify({ t: 'input', input: { active: 'yes' } }));
    ann.send(JSON.stringify({ t: 'input', input: { active: true, down: new Array(100).fill("KeyW"), pressed: [], buttons: 0, clicked: 0, mouseX: 0, mouseY: 0, wheel: 0, yaw: 0, pitch: 0, viewSeq: 0 } }));
    ann.send(JSON.stringify({ t: 'message', msg: { t: 'callback', id: 'x' } }));
    ann.send(JSON.stringify({ t: 'tick', dt: 5, running: true }));
    ann.send({ t: 'exec', id: 1, line: 'give diamond_sword' });
    ann.send({ t: 'restart' });
    await wait(300);
    check(ann.ws.readyState === WebSocket.OPEN, 'still connected after rubbish');
    check(String((ann.replies()[0] as { text?: string } | undefined)?.text).startsWith('Unknown command'), `cheats are off: ${JSON.stringify(ann.replies())}`);

    // Too big a message closes that one connection.
    bob.send(JSON.stringify({ t: 'exec', id: 2, line: 'x'.repeat(10000) }));
    // (1009 says why; Node's own client, busy inflating the compressed batches still coming,
    // reports the close as 1006. Browsers see 1009.)
    const big = await bob.closed;
    check((big.code === 1009 || big.code === 1006) && logs.some((l) => l.includes('Max payload size exceeded')), `oversized message closed it: ${big.code}`);

    // A flood is cut off.
    for (let i = 0; i < 400; i++) cat.send({ t: 'input', input: { active: true, down: [], pressed: [], buttons: 0, clicked: 0, mouseX: 0, mouseY: 0, wheel: 0, yaw: 0, pitch: 0, viewSeq: 0 } });
    const flood = await cat.closed;
    check(flood.code === CLOSE_LIMIT, `flooding: ${flood.code} ${flood.reason}`);

    // Everyone leaves: the games save and stop; someone coming back starts Sandbox again.
    ann.ws.close();
    await ann.closed;
    await wait(1200);
    check(!srv.host('sandbox') && !srv.host('bedwars'), 'empty games stopped');
    check(stores.get('sandbox')?.world()?.seed === 5, 'and were saved');
    const eve = client(srv.port, 'sandbox', 'Eve');
    await wait(400);
    check(eve.welcome?.seed === 5 && !!srv.host('sandbox'), 'Sandbox started again on the kept world');
    eve.ws.close();
    console.log('  2 games on one port · full, per-address, oversized and flood limits · rubbish ignored · cheats off · idle stop and restart');
  } finally {
    await srv.close();
  }
}
