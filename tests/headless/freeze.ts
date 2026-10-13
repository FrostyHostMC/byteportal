import { readFileSync } from 'node:fs';
import { defineGame } from '../../src/platform';
import { GameHost } from '../../src/platform/host/game';
import type { PlayerInput } from '../../src/platform/net/protocol';
import { guns, melee, throwables } from '../../src/platform/kits';
import { check } from './_harness';

const wasm = readFileSync('engine/pkg/voxel_engine_bg.wasm');

/** A yard with two guns and no reloading by itself; whoever joins as "Late" is frozen as they join. */
const yard = defineGame({
  id: 'yard',
  title: 'Yard',
  world: { terrain: 'void', ground: { y: 40 }, spawn: { x: 0.5, y: 41, z: 0.5 }, time: 0.5, freezeTime: true },
  player: { health: 100, hotbar: 'items' },
  items: [throwables(), guns({ autoReload: false }), melee()],
  setup(game) {
    const still = { spread: { hip: 0, aim: 0, move: 0, air: 0, bloom: 0 }, recoil: { up: 0, side: 0 } };
    game.items.define('pistol', { kind: 'gun', name: 'Pistol', icon: 'iron_sword', rpm: 300, damage: 10, magazine: 6, reserve: 30, reload: 0.5, ...still });
    game.items.define('rifle', { kind: 'gun', name: 'Rifle', icon: 'iron_sword', rpm: 600, auto: true, damage: 10, magazine: 20, reload: 1, ...still });
    game.items.define('frag', { kind: 'throwable', name: 'Frag', icon: 'iron_sword', key: 'KeyG', fuse: 3, cooldown: 0, blast: { radius: 1, damage: 50 } });
    game.events.on('playerJoin', ({ player }) => {
      if (player.name === 'Late') player.freeze(true, { weapons: true });
    });
  },
});

/**
 * Freezing: `freeze(true, { weapons: true })` locks a player's weapons with their body (no
 * switching, reloading or firing, and the shots their screen sends anyway are refused, no rounds
 * spent), a plain freeze leaves them free, and the lock ends with the freeze. `player.frozen` and
 * `player.reloading` say how they are; a freeze as they join holds when they press Play. And the
 * clocks: a restart puts `clock.now` back to 0, and `clock.total` runs on.
 */
export default function freeze() {
  const host = new GameHost(yard, { engine: wasm, seed: 1, remote: true, radius: 2, budget: Infinity, player: { id: 'p1', name: 'Ann' } });
  const ann = host.connect('Ann');
  host.command(ann.id, { t: 'start' });
  const sim = host.sim;
  const A = sim.players.find((p) => p.id === ann.id)!;
  const a = A.api;
  const step = (n = 1) => {
    for (let i = 0; i < n; i++) host.step(1 / 30);
  };
  step(10);
  a.inventory.give('pistol');
  a.inventory.give('rifle');
  a.inventory.select(0);
  step(15);
  const heard = { shots: 0 };
  sim.ctx.events.on('shot', () => heard.shots++);
  const shots = () => heard.shots;
  let serial = 0;
  /** One step of Ann's controls: a shot her screen fired (and the click), and keys pressed. */
  const act = (o: { fire?: boolean; pressed?: string[] } = {}) => {
    const input: PlayerInput = { active: true, down: [...(o.pressed ?? [])], pressed: o.pressed ?? [], buttons: o.fire ? 1 : 0, clicked: o.fire ? 1 : 0, mouseX: 0, mouseY: 0, wheel: 0, yaw: 0, pitch: 0, viewSeq: A.viewSeq, acts: { gun: o.fire ? [[++serial, 0, 0, 0]] : [], throwable: [] } };
    host.command(ann.id, { t: 'input', input });
    step();
    // (Held keys let go.)
    host.command(ann.id, { t: 'input', input: { ...input, down: [], pressed: [], buttons: 0, clicked: 0, acts: { gun: [], throwable: [] } } });
    step(8);
  };
  const mag = () => guns.of(sim.ctx)!.ammo(a, 'pistol')!.magazine;
  const frame = () => sim.frame().players.find((p) => p.id === a.id)!;

  // Locked: nothing answers, nothing is spent.
  a.freeze(true, { weapons: true });
  check(a.frozen && frame().locked, `frozen and locked: ${a.frozen}, ${frame().locked}`);
  act({ fire: true });
  act({ fire: true, pressed: ['Digit2'] });
  act({ pressed: ['KeyR'] });
  check(shots() === 0 && mag() === 6, `a locked gun fired nothing and spent nothing: ${shots()} shots, ${mag()} rounds`);
  check(a.inventory.selected === 0 && !guns.of(sim.ctx)!.reloading(a), `no switching or reloading while locked: slot ${a.inventory.selected}, reloading ${guns.of(sim.ctx)!.reloading(a)}`);
  const inAir = () => throwables.of(sim.ctx)!.thrown().length;
  // Nor throwing: the key held does nothing, and a throw the screen sent anyway is turned away.
  a.inventory.give('frag', 2);
  act({ pressed: ['KeyG'] });
  const idle: PlayerInput = { active: true, down: [], pressed: [], buttons: 0, clicked: 0, mouseX: 0, mouseY: 0, wheel: 0, yaw: 0, pitch: 0, viewSeq: A.viewSeq, acts: { gun: [], throwable: [] } };
  host.command(ann.id, { t: 'input', input: { ...idle, acts: { gun: [], throwable: [[1, 'frag', 0.5, 42.6, 0.5, 0, 4, 10, 0]] } } });
  step(3);
  check(a.inventory.count('frag') === 2 && inAir() === 0, `nothing thrown while locked: ${a.inventory.count('frag')} frags, ${inAir()} in the air`);

  // Frozen alone: the weapons are free (as a plain freeze always was).
  a.freeze(true);
  act({ fire: true });
  check(a.frozen && !frame().locked && shots() === 1 && mag() === 5, `a plain freeze leaves the gun working: ${shots()} shots, ${mag()} rounds`);

  // Let go: free, and reloading shows.
  a.freeze(false);
  host.command(ann.id, { t: 'input', input: { ...idle, acts: { gun: [], throwable: [[2, 'frag', 0.5, 42.6, 0.5, 0, 4, 10, 0]] } } });
  step(3);
  check(a.inventory.count('frag') === 1 && inAir() === 1, `unlocked, a throw is taken: ${a.inventory.count('frag')} frags, ${inAir()} in the air`);
  act({ fire: true });
  check(!a.frozen && shots() === 2 && mag() === 4, `free again: ${shots()} shots, ${mag()} rounds`);
  host.command(ann.id, { t: 'input', input: { active: true, down: ['KeyR'], pressed: ['KeyR'], buttons: 0, clicked: 0, mouseX: 0, mouseY: 0, wheel: 0, yaw: 0, pitch: 0, viewSeq: A.viewSeq, acts: { gun: [], throwable: [] } } });
  step();
  const reloading = guns.of(sim.ctx)!.reloading(a);
  step(30);
  check(reloading && !guns.of(sim.ctx)!.reloading(a) && mag() === 6, `player.reloading while the rounds go in, then full: ${reloading}, ${guns.of(sim.ctx)!.reloading(a)}, ${mag()}`);

  // The lock ends with the freeze: a revive lets them go, and the gun with them.
  a.freeze(true, { weapons: true });
  a.revive();
  act({ fire: true });
  check(!a.frozen && !frame().locked && shots() === 3, `a revive ends the freeze and its lock: ${shots()} shots`);

  // Frozen as they joined (before they pressed Play): still frozen, and locked, once in play.
  const late = host.connect();
  host.command(late.id, { t: 'start', name: 'Late' });
  step();
  const L = sim.players.find((p) => p.name === 'Late')!;
  check(L.api.frozen && L.weaponsLocked, `a freeze at playerJoin holds through Play: frozen ${L.api.frozen}, locked ${L.weaponsLocked}`);

  // The clocks: the match's back to 0 on a restart, all the game's time runs on.
  const now = sim.ctx.clock.now;
  const total = sim.ctx.clock.total;
  check(now > 1 && Math.abs(total - now) < 1e-9, `before a restart the clocks agree: ${now.toFixed(2)}, ${total.toFixed(2)}`);
  sim.ctx.restart();
  check(sim.ctx.clock.now === 0 && sim.ctx.clock.total === total, `a restart: now ${sim.ctx.clock.now}, total ${sim.ctx.clock.total.toFixed(2)}`);
  check(!L.api.frozen && !L.weaponsLocked, 'a restart lets everyone go');
  step(30);
  check(Math.abs(sim.ctx.clock.now - 1) < 1e-6 && Math.abs(sim.ctx.clock.total - total - 1) < 1e-6, `both run on together: ${sim.ctx.clock.now.toFixed(2)}, ${sim.ctx.clock.total.toFixed(2)}`);
  console.log(`  locked: 0 of 3 shots, no switch, reload or throw; a plain freeze fired; ${shots()} shots in all; frozen at join held through Play; clock.now back to 0 on restart, clock.total ${sim.ctx.clock.total.toFixed(1)} s`);
}
