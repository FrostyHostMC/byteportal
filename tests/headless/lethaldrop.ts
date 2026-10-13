import { readFileSync } from 'node:fs';
import { LETHALS } from '../../src/games/callofblocky/weapons';
import { Blueprint, defineGame, type Player } from '../../src/platform';
import { GameHost } from '../../src/platform/host/game';
import { melee, throwables } from '../../src/platform/kits';
import type { PlayerInput } from '../../src/platform/net/protocol';
import { check } from './_harness';

const wasm = readFileSync('engine/pkg/voxel_engine_bg.wasm');
const FLOOR = 64;

const yard = defineGame({
  id: 'drop',
  title: 'Dropped frags',
  world: { terrain: 'void', structures: [new Blueprint({ x: -8, y: FLOOR - 1, z: -8 }, { x: 17, y: 1, z: 17 }).fill({ x: -8, y: FLOOR - 1, z: -8 }, { x: 8, y: FLOOR - 1, z: 8 }, 'stone')], spawn: { x: 0.5, y: FLOOR, z: 0.5 }, time: 0.5, freezeTime: true },
  player: { health: 100, hurtCooldown: 0, hotbar: 'items', pvp: true },
  items: [throwables(), melee()],
  setup(game) {
    game.items.define('frag', LETHALS.frag);
  },
});

/**
 * Dying with a frag cooked: it drops where they fell, still live, and goes off when its fuse runs
 * out. A person's screen drops it (its throw, sent once it knows they're dead, taken though they
 * are); a bot's is dropped on the host.
 */
export default function lethalDrop() {
  const host = new GameHost(yard, { engine: wasm, seed: 1, remote: true, radius: 2, budget: Infinity, player: { id: 'p1', name: 'Ann' } });
  const ann = host.connect('Ann');
  host.command(ann.id, { t: 'start' });
  const sim = host.sim;
  const A = sim.players.find((p) => p.id === ann.id)!;
  const step = (n = 1) => {
    for (let i = 0; i < n; i++) host.step(1 / 30);
  };
  const booms: string[] = [];
  sim.ctx.events.on('damage', (e) => {
    if (e.cause === 'explosion') booms.push((e.target as Player).name);
  });
  const inAir = () => sim.ctx.items.kind<import('../../src/platform/kits').Throwables>('throwable')!.thrown();
  step(5);
  A.api.inventory.give('frag', 2);
  // (Someone standing by, to be caught in each blast: a frag that goes off hurts.)
  const near = sim.ctx.bots.add('Near');
  step(3);
  near.teleport({ x: 2.5, y: FLOOR, z: 0.5 }, 0, 0);
  step(40);
  near.protect(0);

  // Ann's screen cooked one for 1.2 s, and she died: her screen drops it (a throw straight down).
  A.api.protect(0);
  A.api.damage(1000, { source: 'world' });
  step(2);
  const eye = A.api.eye;
  const drop: PlayerInput = { active: false, down: [], pressed: [], buttons: 0, clicked: 0, mouseX: 0, mouseY: 0, wheel: 0, yaw: 0, pitch: 0, viewSeq: A.viewSeq, acts: { throwable: [[1, 'frag', eye.x, eye.y, eye.z, 0, -1, 0, 1.2]] } };
  host.command(ann.id, { t: 'input', input: drop });
  step();
  const flying = inAir();
  check(!A.api.alive && flying.length === 1 && flying[0].by === A.api && A.api.inventory.count('frag') === 1, `a dead player's screen drops her cooked frag, and the host takes it: ${flying.length} in the air, ${A.api.inventory.count('frag')} left`);
  check(Math.abs(flying[0].left - (3.2 - 1.2)) < 0.1, `its fuse burns on from where she cooked it to (${flying[0].left.toFixed(2)} s left)`);
  // Only that one: another from her screen while she's dead (past its cooldown) is turned down.
  step(30);
  host.command(ann.id, { t: 'input', input: { ...drop, acts: { throwable: [[2, 'frag', eye.x, eye.y, eye.z, 10, 5, 0, 0]] } } });
  step();
  check(inAir().length === 1 && A.api.inventory.count('frag') === 1, `no more from a dead player's screen: ${inAir().length} in the air, ${A.api.inventory.count('frag')} left`);
  step(45);
  check(inAir().length === 0 && booms.includes('Near'), `it went off (${JSON.stringify(booms)} caught)`);
  near.revive();
  near.protect(0);

  // A bot holding its lethal key with a frag cooked, killed: dropped on the host, and it goes off.
  const bot = sim.ctx.bots.add('Cooker');
  step(3);
  bot.teleport({ x: 4.5, y: FLOOR, z: 4.5 }, 0, 0);
  near.teleport({ x: 6.5, y: FLOOR, z: 4.5 }, 0, 0);
  booms.length = 0;
  bot.inventory.give('frag', 2);
  bot.controls.hold('KeyG');
  step(15);
  check(inAir().length === 0, 'cooking, not thrown yet');
  bot.protect(0);
  bot.damage(1000, { source: 'world' });
  step(2);
  const dropped = inAir();
  check(dropped.length === 1 && dropped[0].by === bot && Math.abs(dropped[0].position.x - 4.5) < 0.5 && bot.inventory.count('frag') === 1, `a bot killed with its frag cooked drops it where it fell: ${JSON.stringify(dropped.map((d) => ({ at: d.position, left: d.left })))}`);
  step(90);
  check(inAir().length === 0 && booms.includes('Near'), `and it went off (${JSON.stringify(booms)} caught)`);
  console.log(`  dropped on death, and went off: Ann's (her screen's) with ${flying[0].left.toFixed(2)} s of fuse left; a bot's with ${dropped[0].left.toFixed(2)} s`);
}
