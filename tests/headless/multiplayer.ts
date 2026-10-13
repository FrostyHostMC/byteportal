import { readFileSync } from 'node:fs';
import { GameHost } from '../../src/platform/host/game';
import type { HostBatch } from '../../src/platform/net/protocol';
import { check, games } from './_harness';

const wasm = readFileSync('engine/pkg/voxel_engine_bg.wasm');
const game = (id: string) => games.find((g) => g.id === id)!;
const idle = { active: true, down: [] as string[], pressed: [] as string[], buttons: 0, clicked: 0, mouseX: 0, mouseY: 0, wheel: 0, yaw: 0, pitch: 0, viewSeq: 0 };

/** Several clients on one host, the way a server runs it: joining, moving, building, leaving. */
export default function multiplayer() {
  sandbox();
  arena();
}

function sandbox() {
  const host = new GameHost(game('sandbox'), { engine: wasm, seed: 9, remote: true, radius: 3, budget: Infinity, cheats: true, player: { id: 'p1', name: 'Host' } });
  const ann = host.connect('Ann');
  check(ann.id === 'p1', `the first client takes the first player: ${ann.id}`);
  check(ann.batch.events.some((e) => e.t === 'ready'), 'the catch-up says ready');
  const bob = host.connect('Bob');
  check(bob.id === 'p2', `second player ${bob.id}`);
  host.command(ann.id, { t: 'start' });
  host.command(bob.id, { t: 'start' });
  let last = new Map<string, HostBatch>();
  const step = (n: number) => {
    for (let i = 0; i < n; i++) last = host.step(1 / 30);
  };
  step(5);
  const start = (id: string) => last.get(id)!.frame!.players.find((p) => p.id === id)!;
  const a0 = start(ann.id);
  const b0 = start(bob.id);
  // Bob walks; Ann doesn't.
  host.command(bob.id, { t: 'input', input: { ...idle, down: ['KeyW'], viewSeq: host.sim.players[1].viewSeq } });
  step(30);
  const a1 = start(ann.id);
  const b1 = start(bob.id);
  check(Math.hypot(b1.x - b0.x, b1.z - b0.z) > 0.5, `Bob walked: ${Math.hypot(b1.x - b0.x, b1.z - b0.z).toFixed(2)}`);
  check(Math.hypot(a1.x - a0.x, a1.z - a0.z) < 0.01, 'Ann stood still');
  check(last.get(ann.id)!.frame!.players.map((p) => p.name).join() === 'Ann,Bob', 'both in the frame, by name');

  // Bob builds: both clients hear about it; a late joiner gets it in their catch-up.
  const x = Math.floor(b1.x) + 2;
  const z = Math.floor(b1.z);
  const y = host.sim.surfaceY(x, z) + 1;
  check(host.sim.placeBlockAt(x, y, z, 'glowstone', host.sim.players[1].api), 'Bob placed glowstone');
  step(1);
  for (const id of [ann.id, bob.id]) check(last.get(id)!.events.some((e) => e.t === 'edits' && e.cells.some(([cx, cy, cz]) => cx === x && cy === y && cz === z)), `${id} heard of the glowstone`);
  const cat = host.connect('Cat');
  const edits = cat.batch.events.find((e) => e.t === 'edits');
  check(edits?.t === 'edits' && edits.cells.some(([cx, cy, cz, b]) => cx === x && cy === y && cz === z && b === host.sim.blockId('glowstone')), 'the late joiner gets the glowstone');

  // Personal calls reach only their player; replies too.
  host.sim.players[1].api.hud.toast('for Bob');
  host.command(cat.id, { t: 'exec', id: 7, line: 'heal' });
  step(1);
  const toasts = (id: string) => last.get(id)!.events.filter((e) => e.t === 'call' && e.call.method === 'toast').length;
  check(toasts(bob.id) === 1 && toasts(ann.id) === 0 && toasts(cat.id) === 0, 'a personal toast went to Bob only');
  const replies = (id: string) => last.get(id)!.events.filter((e) => e.t === 'reply').length;
  check(replies(cat.id) === 1 && replies(ann.id) === 0, 'the reply went to whoever asked');

  // A button Bob presses that calls game.exit() sends Bob away, not everyone.
  host.sim.players[1].api.hud.menu({ title: 'Leave?', sections: [{ title: '', entries: [{ label: 'Quit', onSelect: () => host.sim.ctx.exit() }] }] });
  step(1);
  const menu = last.get(bob.id)!.events.find((e) => e.t === 'call' && e.call.method === 'menu');
  const cb = menu?.t === 'call' ? (menu.call.args[1] as { sections: { entries: { onSelect: { $cb: number } }[] }[] }).sections[0].entries[0].onSelect.$cb : -1;
  host.command(bob.id, { t: 'message', msg: { t: 'callback', player: bob.id, id: cb } });
  step(1);
  const exits = (id: string) => last.get(id)!.events.filter((e) => e.t === 'exit').length;
  check(exits(bob.id) === 1 && exits(ann.id) === 0 && exits(cat.id) === 0, 'exit went to Bob only');

  // Leaving: Bob is gone; Ann's place (the first player) waits for the next to join.
  let left = '';
  host.sim.ctx.events.on('playerLeave', (e) => (left += e.player.name));
  host.disconnect(bob.id);
  host.disconnect(ann.id);
  step(1);
  check(left === 'BobAnn', `playerLeave for both: ${left}`);
  check(last.get(cat.id)!.frame!.players.map((p) => p.name).join() === 'Cat', 'only Cat is drawn now');
  const dan = host.connect('Dan');
  check(dan.id === 'p1' && host.sim.ctx.player.name === 'Dan', `Dan takes the first player's place: ${dan.id}`);
  console.log(`  sandbox: 4 clients joined, walked, built, left; ${host.connected} connected at the end`);
}

function arena() {
  // Two players at opposite ends of the arena: the monsters split between them.
  const host = new GameHost(game('arena'), { engine: wasm, seed: 1337, remote: true, radius: 3, budget: Infinity, cheats: true });
  const a = host.connect('Ann');
  const b = host.connect('Bob');
  const kinds = new Set(b.batch.events.flatMap((e) => (e.t === 'content' ? [e.def.kind] : [])));
  // (No voices: the Arena's are each screen's own, `client/sounds.ts`.)
  check(['atlas', 'entity', 'item'].every((k) => kinds.has(k as never)) && !kinds.has('sound' as never), `the catch-up has the game's content: ${[...kinds]}`);
  host.command(a.id, { t: 'start' });
  host.command(b.id, { t: 'start' });
  const [pa, pb] = host.sim.players;
  for (const p of [pa, pb]) {
    p.api.maxHealth = 400;
    p.api.health = 400;
  }
  // Either side of the middle of whichever arena the fight's on (an earlier test's run in this
  // process may have rotated the public room on from the Colosseum), on floor a body fits.
  const mid = host.sim.ctx.world.spawn;
  const at = (side: number) => {
    for (const d of [5, 4, 6, 3, 7, 2]) {
      const p = { x: mid.x + side * d, y: mid.y, z: mid.z };
      if (host.sim.ctx.world.fits(p)) return p;
    }
    return mid;
  };
  pa.api.teleport(at(-1));
  pb.api.teleport(at(1));
  // (A fight opens with the map's fly-over and the class pick before the first wave comes in:
  // up to 90 s, until both have been hurt.)
  let t = 0;
  for (; t < 90 && !(pa.api.health < 400 && pb.api.health < 400); t += 1 / 30) host.step(1 / 30);
  const hurt = [pa, pb].map((p) => 400 - p.api.health);
  console.log(`  arena: after ${t.toFixed(0)} s the monsters hurt Ann ${hurt[0].toFixed(0)} and Bob ${hurt[1].toFixed(0)}`);
  check(hurt[0] > 0 && hurt[1] > 0, 'monsters went after both players');
}
