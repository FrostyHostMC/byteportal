import type { Entity, GameContext, Player, Vec3 } from '@platform';
import { inFight, map } from '../run/state';
import { inBox, type Box, type Hazard } from './registry';
import { chill } from './traps';

/**
 * The maps' hazards: the Forge's lava burns whoever's in it (fighters and monsters alike: knock
 * them in), the Sanctum's frozen pool bites and slows. Checked a few times a second, not every
 * tick. Each time it hurts a body it throws it up and toward the nearest bank, so falling in costs
 * a burn or two, never a fighter stuck in a pit too deep to climb out of (nor a monster stalling
 * a wave in one): in it means feet in it, or afloat at its surface. (A fighter in a liquid only
 * swims, slowly, however hard they're pushed, and can't climb a bank out of lava: so the lava
 * spits them out, up over its edge and in a short arc onto the bank, embers and a whoomp where
 * they leave it and land, their screen flashing.)
 */

const EVERY = 0.25;
let check = 0;
/** When each body last showed it (a burst, a hiss), by id: not every check. */
const shown = new Map<string, number>();

/** How each kind hurts, each check: fighters, monsters. */
const HURT: Record<Hazard['kind'], { player: number; monster: number; color: string; sound: string }> = {
  lava: { player: 2, monster: 4, color: '#ff7a1a', sound: 'hazard_sizzle' },
  frost: { player: 0.75, monster: 1.5, color: '#bfe8ff', sound: 'hazard_chill' },
};

/** How hard it throws a monster up out of a 2-deep pool and toward the bank (blocks a second). */
const THROW_UP = 11;
const THROW_OUT = 6.5;
/**
 * A fighter's spit: from just over the hazard's edge (this far out from the bank's middle, this
 * high over its floor) in an arc onto the bank's middle, rising at `ARC_UP` blocks a second; or,
 * with no room over the edge, a hop on the bank itself.
 */
const ARC_FROM = 1.1;
const ARC_LIFT = 0.35;
const ARC_UP = 7;
const HOP = 5;
/** Gravity (blocks a second, squared): a player's, the movement's default. */
const GRAVITY = 32;
/** A body just spat out isn't spat again while it arcs over the edge (seconds). */
const GRACE = 0.6;
/** Each kind's look as it spits: its sparks and the voice of the spit. */
const SPIT: Record<Hazard['kind'], { color: string; hot: string; flash: string; sound: string }> = {
  lava: { color: '#ff7a1a', hot: '#ffd25a', flash: '#ff4a10', sound: 'hazard_spit' },
  frost: { color: '#bfe8ff', hot: '#ffffff', flash: '#9fdcff', sound: 'hazard_splash' },
};
/** Bodies just spat out (by id), till when. */
const spat = new Map<string, number>();
/** How far round it looks for a bank (blocks): far enough to reach back out of the Forge's lava cave. */
const BANK_REACH = 12;
/** A body afloat has its feet up to this far over the surface. */
const AFLOAT = 0.45;

export function startHazards() {
  check = 0;
  shown.clear();
  spat.clear();
}

/** Whether a body with its feet at `p` is in a hazard's zone: feet in it, or afloat on it. */
export function inHazard(zone: Box[], p: Vec3): boolean {
  return zone.some((b) => inBox(b, { x: p.x, y: p.y + 0.3, z: p.z }) || inBox(b, { x: p.x, y: p.y - AFLOAT, z: p.z }));
}

/** Whether a column is part of a hazard, at any height. */
const hazardColumn = (zone: Box[], x: number, z: number) => zone.some((b) => x >= b.min.x && x <= b.max.x && z >= b.min.z && z <= b.max.z);

/**
 * The nearest bank to `p` out of a hazard: the middle of the nearest column off it with floor a
 * body stands on, near the height of the pool's own bottom (not a ledge up a lavafall a body's
 * swum up). Null if there's none near.
 */
export function bankFrom(game: GameContext, zone: Box[], p: Vec3): Vec3 | null {
  const bx = Math.floor(p.x);
  const bz = Math.floor(p.z);
  // The bottom of the hazard under the body (else where its feet are).
  let y0 = Math.floor(p.y);
  for (const b of zone) if (bx >= b.min.x && bx <= b.max.x && bz >= b.min.z && bz <= b.max.z && b.min.y <= p.y + 0.5) y0 = Math.min(y0, b.min.y);
  let best: Vec3 | null = null;
  let bestD = Infinity;
  for (let r = 1; r <= BANK_REACH && !best; r++)
    for (let dx = -r; dx <= r; dx++)
      for (let dz = -r; dz <= r; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const x = bx + dx;
        const z = bz + dz;
        if (hazardColumn(zone, x, z)) continue;
        for (let y = y0 - 1; y <= y0 + 3; y++) {
          const at = { x: x + 0.5, y, z: z + 0.5 };
          if (!game.world.fits(at) || game.world.fits({ x: at.x, y: y - 1, z: at.z })) continue;
          const d = Math.hypot(dx, dz) + Math.abs(y - p.y) * 0.5;
          if (d < bestD) {
            bestD = d;
            best = at;
          }
          break;
        }
      }
  return best;
}

/** Throw a monster up out of a hazard and toward its nearest bank. */
function throwOut(game: GameContext, zone: Box[], e: Entity) {
  const p = e.position;
  const bank = bankFrom(game, zone, p);
  if (!bank) return e.impulse(0, THROW_UP, 0);
  const dx = bank.x - p.x;
  const dz = bank.z - p.z;
  const l = Math.hypot(dx, dz) || 1;
  e.impulse((dx / l) * THROW_OUT, THROW_UP, (dz / l) * THROW_OUT);
}

/**
 * Spit a fighter out: up out of the liquid to just over its edge, then in a short arc landing on
 * the middle of the nearest bank (timed to land there: a bank may be a strip between two pools).
 * With no room over the edge, onto the bank with a hop. Sparks and a whoomp where they leave it,
 * sparks where they land, and their screen flashes.
 */
function spitOut(game: GameContext, h: Hazard, p: Player) {
  const from = p.position;
  const bank = bankFrom(game, h.zone, from);
  if (!bank) return;
  const dx = bank.x - from.x;
  const dz = bank.z - from.z;
  const l = Math.hypot(dx, dz) || 1;
  const edge = { x: bank.x - (dx / l) * ARC_FROM, y: bank.y + ARC_LIFT, z: bank.z - (dz / l) * ARC_FROM };
  const look = SPIT[h.kind];
  erupt(game, { x: from.x, y: bank.y - 0.9, z: from.z }, look.color, look.hot);
  game.audio.play(look.sound, { at: from });
  if (l > 0.3 && game.world.fits(edge)) {
    // Up from `edge` at ARC_UP, down to the bank's floor: its time in the air, and the speed across that lands it in the middle.
    const air = (ARC_UP + Math.sqrt(ARC_UP * ARC_UP + 2 * GRAVITY * ARC_LIFT)) / GRAVITY;
    p.teleport(edge);
    p.impulse((dx / l) * (ARC_FROM / air), ARC_UP, (dz / l) * (ARC_FROM / air));
  } else {
    p.teleport({ x: bank.x, y: bank.y + 0.05, z: bank.z });
    p.impulse(0, HOP, 0);
  }
  spat.set(p.id, game.clock.now + GRACE);
  // Their own screen: blasted, a flash over the cut and a jolt.
  p.fx.flash(look.flash, 0.6, 0.7);
  p.fx.shake(0.3, 0.45);
  game.clock.after(0.4, () => burst(game, bank, look.color, look.hot, 14));
}

/** Where it spits a body from: a ring across its surface, a column of sparks (or spray) thrown up out of it. */
function erupt(game: GameContext, at: Vec3, color: string, hot: string) {
  game.fx.shockwave({ x: at.x, y: at.y + 0.1, z: at.z }, 2.2, color);
  for (let k = 0; k < 3; k++) game.fx.burst({ x: at.x, y: at.y + 0.3 + k * 0.7, z: at.z }, { color: k === 1 ? hot : color, count: 16, speed: 2.5 + k, gravity: 6, size: 0.18 - k * 0.03, glow: 1, life: 0.9, drag: 1 });
  burst(game, at, color, hot, 20);
}

/** A spray of sparks (or spray) and a few hot ones flying higher. */
function burst(game: GameContext, at: Vec3, color: string, hot: string, count: number) {
  game.fx.burst({ x: at.x, y: at.y + 0.2, z: at.z }, { color, count, speed: 4, gravity: 9, size: 0.14, glow: 0.8, life: 0.9, drag: 1.2 });
  game.fx.burst({ x: at.x, y: at.y + 0.4, z: at.z }, { color: hot, count: Math.round(count / 2), speed: 6, gravity: 14, size: 0.08, glow: 1, life: 0.7 });
}

export function updateHazards(game: GameContext, dt: number) {
  const hazards = map().hazards;
  if (!hazards?.length || !inFight()) return;
  check -= dt;
  if (check > 0) return;
  check = EVERY;
  const t = game.clock.now;
  const show = (key: string, at: Vec3, h: Hazard) => {
    if ((shown.get(key) ?? 0) > t) return;
    shown.set(key, t + 0.6);
    game.fx.burst({ x: at.x, y: at.y + 0.5, z: at.z }, { color: HURT[h.kind].color, count: 10, speed: 2, gravity: h.kind === 'lava' ? -4 : 2, glow: h.kind === 'lava' ? 1 : 0.3, size: 0.12 });
    game.audio.play(HURT[h.kind].sound, { at, volume: 0.7 });
  };
  for (const h of hazards) {
    for (const p of game.players) {
      if (!p.alive || p.spectating || (spat.get(p.id) ?? 0) > t || !inHazard(h.zone, p.position)) continue;
      p.damage(HURT[h.kind].player, { source: 'world', cause: h.kind === 'lava' ? 'fire' : 'frost', knockback: 0 });
      if (p.alive) spitOut(game, h, p);
      else show(p.id, p.position, h);
    }
    for (const e of game.entities.all()) {
      if (!e.alive || !inHazard(h.zone, e.position)) continue;
      e.damage(HURT[h.kind].monster, { source: 'world', cause: h.kind === 'lava' ? 'fire' : 'frost', knockback: 0 });
      if (h.kind === 'frost') chill(game, e);
      if (e.alive) throwOut(game, h.zone, e);
      show(`e${e.id}`, e.position, h);
    }
  }
}
