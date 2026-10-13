import type { GameContext, Prop, Vec3 } from '@platform';
import { map } from '../run/state';
import { portcullis, type Model } from './models';
import { place } from './props';
import type { Portcullis } from './registry';

/**
 * The gates' portcullises: solid iron, down while nothing's coming. One rises when a monster's
 * brought in behind it (`opened`), and stays up while anything's near it (a monster on its way
 * through, a goblin making for the pen) or a fighter's in the pen behind it; then it drops.
 */

interface Raised {
  spec: Portcullis;
  prop: Prop;
  /** The way into the arena through it (blocks: x, z), and across it. */
  way: { x: number; z: number };
  /** How far up it is (0 down, 1 up), and until when it's held up after a monster came in. */
  lift: number;
  hold: number;
  moving: 0 | 1 | -1;
}

const raised: Raised[] = [];
/** One model for each size of portcullis. */
const models = new Map<string, Model>();
let check = 0;

/** It rises this fast and drops this fast (of its travel a second). */
const UP = 1.3;
const DOWN = 0.9;
/** Anything this near it (blocks) holds it up. */
const NEAR = 4.5;

function modelFor(spec: Portcullis): Model {
  const key = `${spec.width}x${spec.height}`;
  let m = models.get(key);
  if (!m) models.set(key, (m = portcullis(spec.width, spec.height)));
  return m;
}

/** A fight begins: the current map's portcullises, all down. */
export function startGates(game: GameContext) {
  raised.length = 0;
  check = 0;
  for (const spec of map().portcullises ?? []) {
    const way = { x: -Math.sin(spec.yaw), z: -Math.cos(spec.yaw) };
    const prop = place(game, modelFor(spec), spec.at, Math.atan2(way.x, way.z), { solid: true });
    raised.push({ spec, prop, way, lift: 0, hold: 0, moving: 0 });
  }
}

/** A monster came in at `at`: the portcullis nearest (if it's at a gate) goes up. */
export function opened(game: GameContext, at: Vec3) {
  let best: Raised | null = null;
  let bestD = 9;
  for (const r of raised) {
    const d = Math.hypot(at.x - r.spec.at.x, at.z - r.spec.at.z);
    if (d < bestD) {
      bestD = d;
      best = r;
    }
  }
  if (best) best.hold = game.clock.now + 2.5;
}

/** Every tick: each portcullis up or down as it's wanted, rising and falling with its chains' sounds. */
export function updateGates(game: GameContext, dt: number) {
  check -= dt;
  const look = check <= 0;
  if (look) check = 0.2;
  for (const r of raised) {
    if (look) r.moving = wanted(game, r) ? 1 : -1;
    const was = r.lift;
    r.lift = Math.max(0, Math.min(1, r.lift + (r.moving > 0 ? UP : -DOWN) * dt));
    if (r.lift === was) continue;
    if (was === 0) game.audio.play('gate_up', { at: r.spec.at });
    if (r.lift === 0) {
      game.audio.play('gate_down', { at: r.spec.at });
      game.fx.burst({ x: r.spec.at.x, y: r.spec.at.y + 0.1, z: r.spec.at.z }, { color: '#bba98a', count: 14, speed: 1.6, gravity: 3, size: 0.14, life: 0.8, drag: 2 });
    }
    // Eased: quick off the ground, slowing as it reaches the top.
    const e = 1 - (1 - r.lift) * (1 - r.lift);
    r.prop.position.y = r.spec.at.y + e * (r.spec.height - 0.6);
  }
}

/** Whether a portcullis should be up: a monster just in, anything near it, or a fighter in the pen behind it. */
function wanted(game: GameContext, r: Raised): boolean {
  if (game.clock.now < r.hold) return true;
  const at = r.spec.at;
  if (game.entities.near(at, NEAR).some((e) => e.alive)) return true;
  for (const p of game.players) {
    if (!p.alive || p.spectating) continue;
    const dx = p.position.x - at.x;
    const dz = p.position.z - at.z;
    const along = dx * r.way.x + dz * r.way.z;
    const across = Math.abs(-dx * r.way.z + dz * r.way.x);
    // In the pen (behind it), or right under it.
    if (across < r.spec.width / 2 + 1 && along < 0.8 && along > -10) return true;
  }
  return false;
}
