import type { Entity, GameContext, Player, Vec3 } from '@platform';
import { map } from '../run/state';

/** Ground distance between two points (heights apart don't count). */
export const flat = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.z - b.z);

/** The heading from `a` to `b` (radians; the figures' own: 0 faces +z, a quarter turn +x). */
export const heading = (a: Vec3, b: Vec3) => Math.atan2(b.x - a.x, b.z - a.z);

/** An angle put in -π..π. */
export const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** `from` turned toward `to`, by at most `max`. */
export function turnToward(from: number, to: number, max: number): number {
  const d = wrap(to - from);
  return wrap(from + Math.max(-max, Math.min(max, d)));
}

/** A spot `d` along `h` from `at`. */
export const ahead = (at: Vec3, h: number, d: number, y = 0): Vec3 => ({ x: at.x + Math.sin(h) * d, y: at.y + y, z: at.z + Math.cos(h) * d });

/** Somewhere in the map's pit (not out past its rim), where a body fits. */
export function inPit(game: GameContext, at: Vec3): boolean {
  const m = map();
  return flat(at, m.center) < m.radius - 2 && game.world.fits(at);
}

/**
 * Tell every screen something the bestiary draws itself (`client/bestiary.ts`): a ring on the
 * ground filling until something lands there, an elite's aura, a tether, a patch of fire. Sent once
 * per thing, each screen animating it, so the server never streams effects.
 */
export function show(game: GameContext, what: string, data: Record<string, unknown>) {
  game.clients.send('all', `bestiary.${what}`, data);
}

/** A warning ring on the ground at `at`, `radius` across, filling for `time` seconds. */
export function ring(game: GameContext, at: Vec3, radius: number, time: number, color: string) {
  show(game, 'ring', { x: at.x, y: at.y, z: at.z, radius, time, color });
}

/** A thump felt by those near it: each fighter's screen shakes as hard as they're close. */
export function shakeNear(game: GameContext, at: Vec3, strength: number, duration: number, reach = 18) {
  for (const p of game.players) {
    const d = flat(p.position, at);
    if (d < reach) p.fx.shake(strength * (1 - d / reach), duration);
  }
}

/**
 * Frozen or reeling (the armory's statuses set `data.stunned`, the seconds left): it stands still
 * and does nothing, its own timers held. Whatever it was winding up is undone as it's caught
 * (`undo`, which says whether it was showing a tell), and that tell's glow goes when it comes to,
 * so its next move gets a fresh tell. Whether it's held.
 */
export function held(self: Entity, undo: () => boolean): boolean {
  const d = self.data as { stunned?: number; _held?: boolean; _unglow?: boolean };
  if ((d.stunned ?? 0) > 0) {
    if (!d._held) {
      d._held = true;
      d._unglow = undo();
      if (d._unglow) self.animate('none');
    }
    self.stop();
    return true;
  }
  if (d._held) {
    d._held = false;
    if (d._unglow) self.glow(null);
    d._unglow = false;
  }
  return false;
}

/** Players standing (not in the air) within `radius` of `at`. */
export function grounded(game: GameContext, at: Vec3, radius: number, rise = 1.2): Player[] {
  return game.players.filter((p) => p.alive && !p.spectating && flat(p.position, at) <= radius && p.position.y - at.y < rise && (p.onGround || p.position.y - at.y < 0.5));
}

/** The monsters (not bosses) within `radius` of `at`, but `self`. */
export function near(game: GameContext, at: Vec3, radius: number, self?: Entity): Entity[] {
  return game.entities.near(at, radius).filter((e) => e !== self && e.alive);
}

/**
 * A push back toward the middle for one keeping its distance near the arena's edge (to add to its
 * way): nothing well inside it, more the nearer the edge (`map().radius`), so it turns along the
 * wall rather than backing out through a gate.
 */
export function inward(at: Vec3): [number, number] {
  const m = map();
  const ox = at.x - m.center.x;
  const oz = at.z - m.center.z;
  const r = Math.hypot(ox, oz) || 1;
  const k = r > m.radius - 4 ? 0.8 : 0;
  return [(-ox / r) * k, (-oz / r) * k];
}
