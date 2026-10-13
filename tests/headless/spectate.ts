import { readFileSync } from 'node:fs';
import { Blueprint, defineGame, Models, type Player } from '../../src/platform';
import { GameHost } from '../../src/platform/host/game';
import type { HostBatch, PlayerInput } from '../../src/platform/net/protocol';
import { guns, melee } from '../../src/platform/kits';
import { check } from './_harness';

const wasm = readFileSync('engine/pkg/voxel_engine_bg.wasm');
const FLOOR = 40;

/** A stone floor with a wall across it at z = -4, three high. */
function yard(): Blueprint {
  const bp = new Blueprint({ x: -8, y: FLOOR - 1, z: -10 }, { x: 17, y: 5, z: 19 });
  bp.fill({ x: -8, y: FLOOR - 1, z: -10 }, { x: 8, y: FLOOR - 1, z: 8 }, 'stone');
  bp.fill({ x: -8, y: FLOOR, z: -4 }, { x: 8, y: FLOOR + 2, z: -4 }, 'stone');
  return bp;
}

/** What the creature's `nearestPlayer` last said. */
let nearest: Player | null | undefined;

const game = defineGame({
  id: 'spectate',
  title: 'Spectate',
  world: { terrain: 'void', structures: [yard()], spawn: { x: 0.5, y: FLOOR, z: 0.5 }, time: 0.5, freezeTime: true },
  player: { health: 20, hurtCooldown: 0, hotbar: 'items', pvp: true },
  items: [guns({ autoReload: false }), melee()],
  setup(g) {
    g.items.define('sword', { kind: 'melee', name: 'Sword', icon: 'iron_sword', damage: 5, cooldown: 0.3, reach: 3.3 });
    g.items.define('pistol', { kind: 'gun', name: 'Pistol', icon: 'iron_sword', rpm: 300, damage: 5, magazine: 12, reload: 0.5, spread: { hip: 0, aim: 0, move: 0, air: 0, bloom: 0 }, recoil: { up: 0, side: 0 } });
    g.items.define('gem', { kind: 'misc', name: 'Gem', icon: 'iron_sword' });
    g.entities.define('watcher', {
      name: 'Watcher',
      model: Models.character({}),
      hitbox: { width: 0.6, height: 1.8 },
      health: 20,
      speed: 0,
      ai: (self) => {
        nearest = self.nearestPlayer();
      },
    });
  },
});

/**
 * Spectating (`player.spectate`): a spectator flies through anything, never lands, and is left out
 * of everything that touches a player: damage, blades, bullets, creatures' notice, pickups, other
 * screens' figures; their hotbar and hands are put away. Dead or alive, they fly; a revive ends it.
 */
export default function spectate() {
  const host = new GameHost(game, { engine: wasm, seed: 1, remote: true, radius: 2, budget: Infinity, player: { id: 'p1', name: 'Ann' } });
  const ann = host.connect('Ann');
  const bob = host.connect('Bob');
  host.command(ann.id, { t: 'start' });
  host.command(bob.id, { t: 'start' });
  let last = new Map<string, HostBatch>();
  const step = (n = 1) => {
    for (let i = 0; i < n; i++) last = host.step(1 / 30);
  };
  step(5);
  const [A, B] = host.sim.players;
  const a = A.api;
  const b = B.api;
  const input = (p: typeof A, down: string[], clicked = 0, yaw = 0, pitch = 0): PlayerInput => ({ active: true, down, pressed: [], buttons: clicked, clicked, mouseX: 0, mouseY: 0, wheel: 0, yaw, pitch, viewSeq: p.viewSeq });
  const hold = (p: typeof A, id: string, down: string[], seconds: number) => {
    host.command(id, { t: 'input', input: input(p, down) });
    step(Math.round(seconds * 30));
    host.command(id, { t: 'input', input: input(p, []) });
    step(2);
  };
  host.sim.ctx.entities.spawn('watcher', { x: 4.5, y: FLOOR, z: 4.5 });
  // Ann is nearer the creature than Bob: it notices her.
  b.teleport({ x: -6.5, y: FLOOR, z: 6.5 });
  step(5);
  check(nearest === a, `the creature notices Ann: ${nearest?.name}`);

  // Ann spectates, carrying a gem.
  a.inventory.give('gem');
  a.spectate(true);
  step(3);
  const mine = last.get(ann.id)!.frame!.players.find((p) => p.id === ann.id)!;
  const seen = last.get(bob.id)!.frame!.players.find((p) => p.id === ann.id)!;
  check(a.spectating && !a.frozen && a.alive, `spectating, free, still alive: ${a.spectating} ${a.frozen} ${a.alive}`);
  check(mine.hotbar === null && mine.hand.state === null && a.inventory.count('gem') === 1, 'her hotbar and hands put away, what she carries kept');
  check(seen.spectating === true, "Bob's screen is told (and draws no figure for her)");
  check(nearest === b, `the creature notices Bob now, not her: ${nearest?.name}`);

  // She flies up, and doesn't come down by herself.
  const y0 = a.position.y;
  hold(A, ann.id, ['Space'], 1);
  check(a.position.y > y0 + 3, `up: ${y0} -> ${a.position.y.toFixed(1)}`);
  const y1 = a.position.y;
  step(30);
  check(a.position.y >= y1 - 0.05, `and stays up (no falling): ${y1.toFixed(1)} -> ${a.position.y.toFixed(1)}`);
  // Down through the floor, and forward through the wall.
  hold(A, ann.id, ['ShiftLeft'], 1.5);
  check(a.position.y < FLOOR - 1, `down through the floor: ${a.position.y.toFixed(1)}`);
  a.teleport({ x: 0.5, y: FLOOR, z: 0.5 }, 0, 0);
  hold(A, ann.id, ['KeyW'], 1);
  check(a.position.z < -5, `through the wall at z -4: ${a.position.z.toFixed(1)}`);

  // Nothing touches her: damage, Bob's blade and his bullets, the creature, a pickup.
  check(!a.damage(5, { source: 'world' }) && a.health === a.maxHealth, 'unhurt');
  a.teleport({ x: 0.5, y: FLOOR, z: -1 }, 0, 0);
  b.teleport({ x: 0.5, y: FLOOR, z: 1 }, 0, 0);
  b.inventory.clear();
  b.inventory.give('sword');
  b.inventory.select(0);
  step(3);
  for (let i = 0; i < 4; i++) {
    host.command(bob.id, { t: 'input', input: input(B, [], 1, 0, -0.2) });
    step(1);
    host.command(bob.id, { t: 'input', input: input(B, [], 0, 0, -0.2) });
    step(12);
  }
  b.inventory.clear();
  b.inventory.give('pistol');
  b.inventory.select(0);
  step(3);
  for (let i = 0; i < 4; i++) {
    host.command(bob.id, { t: 'input', input: input(B, [], 1, 0, -0.05) });
    step(1);
    host.command(bob.id, { t: 'input', input: input(B, [], 0, 0, -0.05) });
    step(10);
  }
  check(a.health === a.maxHealth, `neither the blade nor the bullets: ${a.health}`);
  b.teleport({ x: -6.5, y: FLOOR, z: 6.5 });
  a.teleport({ x: 4.5, y: FLOOR, z: 3.5 });
  host.sim.ctx.items.spawnPickup('gem', { x: 4.5, y: FLOOR + 0.5, z: 3.5 }, { count: 1 });
  step(40);
  check(a.inventory.count('gem') === 1, `she picks nothing up: ${a.inventory.count('gem')} gems`);

  // A revive ends it; dead, she can spectate too.
  a.revive();
  step(3);
  check(!a.spectating && !a.frozen, 'a revive ends it');
  // (Past the revive's second of protection.) The same swing now lands: it was the spectating.
  step(40);
  a.teleport({ x: 0.5, y: FLOOR, z: -1 }, 0, 0);
  b.teleport({ x: 0.5, y: FLOOR, z: 1 }, 0, 0);
  b.inventory.clear();
  b.inventory.give('sword');
  b.inventory.select(0);
  step(3);
  host.command(bob.id, { t: 'input', input: input(B, [], 1, 0, -0.2) });
  step(1);
  host.command(bob.id, { t: 'input', input: input(B, [], 0, 0, -0.2) });
  step(3);
  check(a.health < a.maxHealth, `back in play, Bob's blade hurts her: ${a.health}`);
  a.damage(1000, { source: 'world' });
  step(2);
  check(!a.alive && a.frozen, 'dead: frozen');
  a.spectate(true);
  const yd = a.position.y;
  hold(A, ann.id, ['Space'], 1);
  check(a.spectating && !a.alive && a.position.y > yd + 3, `dead and spectating, she flies: ${yd} -> ${a.position.y.toFixed(1)}`);
  a.spectate(false);
  step(2);
  check(a.frozen && !a.alive, 'back to lying dead');
  console.log('  flies through walls and floors, never lands; unhurt, unseen, untouched by blades, bullets, creatures and pickups; dead or alive; a revive ends it');
}
