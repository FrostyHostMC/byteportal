import type { HitscanOptions, PlayerHitbox, Vec3 } from '../api/types';

/**
 * Where bullets meet players: the hitboxes of the figure everyone sees, and how far back the host
 * looks for a shot's target (lag compensation). The game's `hitscan` option; the host and every
 * screen resolve the same rules from it.
 */
export interface HitscanRules {
  rewind: number;
  /** Per stance (standing, crouching, sliding): the neck and the top of the head, and the body's and head's half widths. */
  boxes: [StanceBox, StanceBox, StanceBox];
}

/** A stance's hitboxes: [neck, top of the head, body half width, head half width], blocks from the feet. */
type StanceBox = [number, number, number, number];

/**
 * The figure is two blocks tall: legs and body to 1.5, the head above. Crouched it's 0.3 lower;
 * sliding it leans back from the hips, so the boxes are lower and wider.
 */
const BOXES: [StanceBox, StanceBox, StanceBox] = [
  [1.5, 2.0, 0.36, 0.28],
  [1.2, 1.7, 0.38, 0.3],
  [0.85, 1.4, 0.45, 0.45],
];

/** A game's `hitscan`, with the defaults filled in (a hitbox's widths halved, as `playerBoxes` uses them). */
export function resolveHitscan(o: HitscanOptions = {}): HitscanRules {
  const box = (i: Stance, h: Partial<PlayerHitbox> | undefined): StanceBox => {
    const [neck, top, bw, hw] = BOXES[i];
    return [h?.neck ?? neck, h?.height ?? top, h?.width === undefined ? bw : h.width / 2, h?.headWidth === undefined ? hw : h.headWidth / 2];
  };
  const hb = o.hitboxes ?? {};
  return {
    // A laggy shooter doesn't get to hit where someone was a second ago.
    rewind: Math.max(0, o.rewind ?? 0.35),
    boxes: [box(0, hb.stand), box(1, hb.crouch), box(2, hb.slide)],
  };
}

export const DEFAULT_HITSCAN = resolveHitscan();

/** Stance for hitboxes: standing, crouching or sliding. */
export type Stance = 0 | 1 | 2;

/** Where a lean (`AbilityBody.lean`, blocks to the right of the view) puts the head, from upright: world x and z. */
export function leanOffset(yaw: number, lean: number): { x: number; z: number } {
  return { x: Math.cos(yaw) * lean, z: -Math.sin(yaw) * lean };
}

/**
 * A player's hitboxes where they stand (feet at `p`): the body and the head, as min / max corners.
 * They match the figure everyone sees: upright, crouched, or leaning back in a slide (the game's
 * `hitscan.hitboxes` can change them). Leaning out (`lean`, the head's offset from `leanOffset`)
 * moves the head that far and reaches the body half as far that way (the shoulder that shows).
 */
export function playerBoxes(p: Vec3, stance: Stance, rules: HitscanRules = DEFAULT_HITSCAN, lean?: { x: number; z: number }): { body: [Vec3, Vec3]; head: [Vec3, Vec3] } {
  const [bodyTop, headTop, bw, hw] = rules.boxes[stance];
  const lx = lean?.x ?? 0;
  const lz = lean?.z ?? 0;
  return {
    body: [
      { x: p.x - bw + Math.min(0, lx / 2), y: p.y, z: p.z - bw + Math.min(0, lz / 2) },
      { x: p.x + bw + Math.max(0, lx / 2), y: p.y + bodyTop, z: p.z + bw + Math.max(0, lz / 2) },
    ],
    head: [
      { x: p.x + lx - hw, y: p.y + bodyTop, z: p.z + lz - hw },
      { x: p.x + lx + hw, y: p.y + headTop, z: p.z + lz + hw },
    ],
  };
}

/** Where a ray (unit direction) first enters a box, or null. */
export function rayBox(o: Vec3, d: Vec3, min: Vec3, max: Vec3): number | null {
  let t0 = 0;
  let t1 = Infinity;
  const os = [o.x, o.y, o.z];
  const ds = [d.x, d.y, d.z];
  const lo = [min.x, min.y, min.z];
  const hi = [max.x, max.y, max.z];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(ds[i]) < 1e-9) {
      if (os[i] < lo[i] || os[i] > hi[i]) return null;
      continue;
    }
    let a = (lo[i] - os[i]) / ds[i];
    let b = (hi[i] - os[i]) / ds[i];
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, b);
    if (t0 > t1) return null;
  }
  return t0;
}
