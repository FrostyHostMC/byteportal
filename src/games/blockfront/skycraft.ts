import { Blueprint, type Vec3 } from '@platform';

/**
 * The starfighters over Blockfront's battles (`skies.ts`): the Rebels' wing fighter and the
 * Empire's eye fighter, built from blocks (from Starfighter's builds: games don't share code).
 * Craft space: the nose points to -z, up is +y, the right wing is +x, and (0, 0, 0) is the
 * centre of mass. Meshed at `CRAFT_SCALE`: a block is a quarter of one of the world's.
 */
export interface SkyCraft {
  blueprint: Blueprint;
  /** Laser muzzles and engine exhausts, in blocks (craft space). */
  guns: Vec3[];
  engines: Vec3[];
  /** Rough radius in blocks. */
  radius: number;
}

export const CRAFT_SCALE = 0.25;

// ---------------------------------------------------------------------------------------------
// Voxel helpers. Integer coordinates are cell centres, so a build symmetric about x = 0 has a
// centre column (odd widths) and mirrors cell for cell.

type Paint = string | undefined;
type Pt = [number, number];

/** An empty build spanning -r..r on each axis around the centre of mass. */
function canvas(rx: number, ry: number, rz: number): Blueprint {
  return new Blueprint({ x: -rx, y: -ry, z: -rz }, { x: 2 * rx + 1, y: 2 * ry + 1, z: 2 * rz + 1 });
}

/** A round tube along z around (cx, cy): `radius(z)` (undefined skips the slice), `paint(d, z, dx, dy)`. */
function tubeZ(bp: Blueprint, cx: number, cy: number, z0: number, z1: number, radius: (z: number) => number | undefined, paint: (d: number, z: number, dx: number, dy: number) => Paint) {
  for (let z = z0; z <= z1; z++) {
    const r = radius(z);
    if (r === undefined) continue;
    const n = Math.ceil(r);
    for (let dy = -n; dy <= n; dy++)
      for (let dx = -n; dx <= n; dx++) {
        const d = Math.hypot(dx, dy);
        const b = d <= r ? paint(d, z, dx, dy) : undefined;
        if (b) bp.set(cx + dx, cy + dy, z, b);
      }
  }
}

/** A round tube along x around (cy, cz), for both sides at once when `mirror` is set. */
function tubeX(bp: Blueprint, cy: number, cz: number, x0: number, x1: number, radius: (x: number) => number, paint: (d: number, x: number, dy: number, dz: number) => Paint, mirror = true) {
  for (let x = x0; x <= x1; x++) {
    const r = radius(x);
    const n = Math.ceil(r);
    for (let dz = -n; dz <= n; dz++)
      for (let dy = -n; dy <= n; dy++) {
        const d = Math.hypot(dy, dz);
        const b = d <= r ? paint(d, x, dy, dz) : undefined;
        if (!b) continue;
        bp.set(x, cy + dy, cz + dz, b);
        if (mirror) bp.set(-x, cy + dy, cz + dz, b);
      }
  }
}

/** Even-odd point-in-polygon. */
function inPoly(px: number, py: number, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Distance from a point to the segment a-b. */
function segDist(px: number, py: number, [ax, ay]: Pt, [bx, by]: Pt): number {
  const vx = bx - ax;
  const vy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy || 1)));
  return Math.hypot(px - ax - t * vx, py - ay - t * vy);
}

/** Distance from a point to the outline of a polygon. */
function edgeDist(px: number, py: number, poly: Pt[]): number {
  let d = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) d = Math.min(d, segDist(px, py, poly[j], poly[i]));
  return d;
}

/** Bounding radius of everything written, measured to the far corner of each cell. */
function radiusOf(bp: Blueprint): number {
  let r2 = 0;
  bp.forEach((x, y, z) => {
    r2 = Math.max(r2, x * x + y * y + z * z);
  });
  return Math.ceil(Math.sqrt(r2) + 0.9);
}

// ---------------------------------------------------------------------------------------------
// The Rebels' wing fighter: ~49 long (nose z = -26 to exhausts z = +22), ~45 across its four open wings.

export function wingFighter(): SkyCraft {
  const bp = canvas(24, 12, 27);
  const NOSE = -26;
  const TAIL = 21; // rear bulkhead of the fuselage

  // Fuselage cross-section at z: half-width, top, bottom and the top/bottom corner chamfers. The
  // nose tapers to a flattened wedge; the cockpit section sits one block lower than the rear deck.
  const section = (z: number) => {
    if (z < NOSE || z > TAIL) return undefined;
    if (z < -9) {
      const t = (z - NOSE) / (-9 - NOSE);
      return { w: 1 + 2.6 * t, top: 0.4 + 1.6 * t, bot: -1.4 - 1.6 * t, ct: 0.6 + 1.2 * t, cb: 0.4 + 0.6 * t };
    }
    return { w: z < -3 ? 3.6 + (z + 9) * 0.07 : 4, top: z <= 1 ? 2 : 3, bot: -3, ct: 1.5, cb: 1 };
  };
  const inBody = (x: number, y: number, z: number) => {
    const s = section(z);
    if (!s) return false;
    const ax = Math.abs(x);
    return ax <= s.w && y <= s.top && y >= s.bot && ax + y <= s.w + s.top - s.ct && ax - y <= s.w - s.bot - s.cb;
  };
  bp.fill({ x: -5, y: -4, z: NOSE }, { x: 5, y: 4, z: TAIL }, (x, y, z) => {
    if (!inBody(x, y, z)) return undefined;
    const ax = Math.abs(x);
    const s = section(z)!;
    if (z <= NOSE + 1) return 'light_gray_concrete';
    if (z === -21 || z === -20) return 'red_concrete'; // nose bands
    if (z < -9 && y === Math.floor(s.top) && ax <= 1 && z > -18 && z < -11) return 'light_gray_concrete';
    if (z === TAIL) {
      // Rear bulkhead: grey rim around a vent grille.
      const rim = !inBody(x - 1, y, z) || !inBody(x + 1, y, z) || !inBody(x, y - 1, z) || !inBody(x, y + 1, z);
      if (ax <= 1 && Math.abs(y) <= 1) return y === 0 ? 'gray_concrete' : 'black_concrete'; // vent grille
      return rim ? 'gray_concrete' : 'light_gray_concrete';
    }
    if (z > 1 && y <= -2 && ax <= 2 && z >= 6 && z <= 16) return 'light_gray_concrete';
    return 'white_concrete';
  });
  // Rear deck spine and greebles, for the chase camera.
  bp.fill({ x: 0, y: 4, z: 9 }, { x: 0, y: 4, z: 19 }, (_x, _y, z) => (z % 3 === 0 ? 'gray_concrete' : 'light_gray_concrete'));
  for (const x of [-2, 2]) bp.fill({ x, y: 4, z: 13 }, { x, y: 4, z: 14 }, 'iron_block').set(x, 4, 18, 'gray_concrete');

  // Canopy: a raked windscreen, faceted sides and a flat roof: glass in a grey frame over a
  // dark cockpit, so it reads as tinted glass with the pilot's helmet showing through.
  const roof = (z: number) => Math.min(5, Math.floor(3 + (z + 9) / 1.5));
  const inCanopy = (x: number, y: number, z: number) => z >= -9 && z <= 1 && y >= 3 && y <= roof(z) && Math.abs(x) <= (y === 5 ? 1 : 2);
  bp.fill({ x: -3, y: 3, z: -9 }, { x: 3, y: 5, z: 1 }, (x, y, z) => {
    if (!inCanopy(x, y, z)) return undefined;
    const shell = !inCanopy(x - 1, y, z) || !inCanopy(x + 1, y, z) || !inCanopy(x, y + 1, z) || !inCanopy(x, y, z - 1) || !inCanopy(x, y, z + 1);
    if (!shell) return 'black_concrete';
    if (z === 1) return 'light_gray_concrete';
    if (z === -6 || z === -2) return 'gray_concrete';
    if (y === 5 && Math.abs(x) === 1) return 'gray_concrete';
    return 'glass';
  });
  bp.fill({ x: -1, y: 2, z: -8 }, { x: 1, y: 2, z: 0 }, 'black_concrete');
  bp.set(0, 4, -2, 'white_concrete').set(0, 4, -3, 'white_concrete').set(0, 3, -3, 'red_wool');

  // A droid's dome behind the cockpit, sitting in a dark socket: white with blue panels,
  // radar eye to the front.
  const r2 = { x: 0, y: 3.5, z: 4 };
  bp.fill({ x: -3, y: 3, z: r2.z - 3 }, { x: 3, y: 3, z: r2.z + 3 }, (x, _y, z) => (Math.hypot(x, z - r2.z) <= 3.2 ? 'gray_concrete' : undefined));
  bp.fill({ x: -3, y: 4, z: r2.z - 3 }, { x: 3, y: 6, z: r2.z + 3 }, (x, y, z) => {
    const dz = z - r2.z;
    if (Math.hypot(x, y - r2.y, dz) > 2.6) return undefined;
    if (y === 6) return 'white_concrete';
    if (y === 4 && dz === -2 && x === 0) return 'black_concrete'; // radar eye
    if (y === 4 && dz === -2 && x === 1) return 'red_concrete';
    const sector = Math.round((Math.atan2(dz, x) / Math.PI) * 4 + 8) % 2;
    if (y === 5) return sector ? 'blue_wool' : 'white_concrete';
    return Math.abs(x) === 2 || Math.abs(dz) === 2 ? (sector ? 'white_concrete' : 'blue_wool') : 'white_concrete';
  });

  // S-foils in attack position: four wings hinged at the fuselage sides, opened 18 degrees (a
  // little more than the real 13, so the X reads from behind). `s` is the span (|x|).
  const slope = Math.tan((18 * Math.PI) / 180);
  const wingY = (s: number) => 1 + (s - 4) * slope; // mid-plane height of the upper wings
  const TIP = 20;
  const lead = (s: number) => 4 + ((s - 5) * 2) / 15;
  const trail = (s: number) => 18 - ((s - 5) * 5) / 15;
  for (const sx of [-1, 1])
    for (const sy of [-1, 1])
      for (let s = 5; s <= TIP; s++) {
        // Cover the plane's rise across the column so the steps stay watertight.
        const ya = Math.round(wingY(s - 0.5));
        const yb = Math.round(wingY(s + 0.5));
        for (let z = Math.ceil(lead(s)); z <= Math.floor(trail(s)); z++) {
          let b = 'white_concrete';
          if (s === 12 || s === 13 || s === TIP - 2) b = 'red_concrete';
          else if (z >= Math.floor(trail(s))) b = 'light_gray_concrete';
          else if (s >= 14 && s <= 16 && z >= 8 && z <= 10) b = 'light_gray_concrete';
          for (let y = ya; y <= yb; y++) bp.set(sx * s, sy * y, z, b);
        }
      }

  // Engines at the wing roots: pale intake ring, long body, glow recessed in a grey nozzle.
  const engines: Vec3[] = [];
  for (const sx of [-1, 1])
    for (const sy of [-1, 1]) {
      const cx = sx * 7;
      const cy = sy * 4;
      tubeZ(bp, cx, cy, 2, 22, (z) => (z <= 4 ? 3.2 : 2.6), (d, z) => {
        if (z === 2) return d >= 2.5 ? 'light_gray_concrete' : d < 0.5 ? 'gray_concrete' : undefined;
        if (z === 3) return d >= 2.5 ? 'light_gray_concrete' : d < 1.2 ? 'gray_concrete' : 'black_concrete';
        if (z === 4) return 'light_gray_concrete';
        if (z === 22) return d < 1.6 ? undefined : 'gray_concrete';
        if (z === 21) return d < 1.2 ? 'glowstone' : d < 1.6 ? 'red_concrete' : 'gray_concrete';
        if (z === 18) return 'gray_concrete';
        if (z >= 19) return 'light_gray_concrete';
        if (z === 10 || z === 11) return 'light_gray_concrete';
        return 'white_concrete';
      });
      engines.push({ x: cx, y: cy, z: 22.5 });
    }

  // Wing-tip laser cannons: thick base along the tip, thin barrel, flash suppressor.
  const guns: Vec3[] = [];
  for (const sx of [-1, 1])
    for (const sy of [-1, 1]) {
      const cx = sx * (TIP + 1);
      const cy = sy * Math.round(wingY(TIP + 1));
      tubeZ(bp, cx, cy, -17, 14, (z) => (z >= 0 ? 1.5 : z >= -3 ? 1.2 : z >= -14 ? 0.5 : z >= -16 ? 1.2 : 0.5), (_d, z) => {
        if (z >= 0) return z === 4 || z === 12 ? 'gray_concrete' : 'light_gray_concrete';
        if (z >= -3) return 'gray_concrete';
        if (z >= -14) return 'iron_block';
        return z === -17 ? 'black_concrete' : 'gray_concrete';
      });
      guns.push({ x: cx, y: cy, z: -17.5 });
    }

  return { blueprint: bp, guns, engines, radius: radiusOf(bp) };
}

// ---------------------------------------------------------------------------------------------
// The eye fighter's cockpit ball: ~13 across, round front window with a spoked frame.

const BALL_R = 6.5;

function eyeBall(bp: Blueprint): { chin: Vec3[]; exhausts: Vec3[] } {
  bp.fill({ x: -7, y: -7, z: -4 }, { x: 7, y: 7, z: 7 }, (x, y, z) => {
    if (Math.hypot(x, y, z) > BALL_R) return undefined;
    if (z === -4) return 'gray_concrete'; // dark collar around the window
    if (y >= 6) return Math.hypot(x, z) < 1.5 ? 'light_gray_concrete' : 'gray_concrete'; // top hatch
    if (z === 6) return 'gray_concrete'; // rear plate
    if (Math.abs(x) >= 5 && Math.hypot(y, z) <= 3) return 'gray_concrete'; // pylon roots
    return 'light_gray_concrete';
  });
  // Front window: black panes between eight spokes and a hub, in a raised ring.
  for (let y = -5; y <= 5; y++)
    for (let x = -5; x <= 5; x++) {
      const r = Math.hypot(x, y);
      if (r > 4.7) continue;
      const a = Math.atan2(y, x);
      const off = Math.abs(a - Math.round(a / (Math.PI / 4)) * (Math.PI / 4));
      const strut = r < 1 || r >= 3.9 || r * Math.sin(off) < 0.5;
      bp.set(x, y, -5, strut ? 'light_gray_concrete' : 'black_concrete');
      if (r >= 3.9) bp.set(x, y, -6, 'light_gray_concrete');
    }
  bp.set(0, 0, -6, 'gray_concrete');
  // Twin ion exhausts on a round rear hatch.
  for (let y = -2; y <= 2; y++) for (let x = -2; x <= 2; x++) if (Math.hypot(x, y) <= 2.3) bp.set(x, y, 7, Math.abs(x) === 1 && y === 0 ? 'sea_lantern' : 'gray_concrete');
  // Chin guns under the window.
  const chin: Vec3[] = [];
  for (const sx of [-2, 2]) {
    bp.fill({ x: sx, y: -5, z: -7 }, { x: sx, y: -5, z: -4 }, (_x, _y, z) => (z === -4 ? 'gray_concrete' : 'black_concrete'));
    chin.push({ x: sx, y: -5, z: -7.5 });
  }
  return { chin, exhausts: [{ x: -1, y: 0, z: 7.5 }, { x: 1, y: 0, z: 7.5 }] };
}

/**
 * One wing panel per side: `outline` in the (z, y) plane, `xAt(y)` places the panel (so it can
 * bend), spokes run from `hub` to each of `corners`. Black panel, grey frame and spokes; the frame
 * also thickens by the x offsets in `rim` (outward is +).
 */
function eyeWing(bp: Blueprint, outline: Pt[], hub: Pt, corners: Pt[], xAt: (y: number) => number, rim: number[]) {
  const zs = outline.map((p) => p[0]);
  const ys = outline.map((p) => p[1]);
  for (let y = Math.floor(Math.min(...ys)); y <= Math.ceil(Math.max(...ys)); y++)
    for (let z = Math.floor(Math.min(...zs)); z <= Math.ceil(Math.max(...zs)); z++) {
      const d = edgeDist(z, y, outline);
      if (!inPoly(z, y, outline) && d > 0.5) continue;
      const edge = d < 0.9;
      const spoke = corners.some((c) => segDist(z, y, hub, c) < 0.7);
      // Solar-cell ribs run parallel to the outline, a shade off black.
      const b = edge || spoke || Math.hypot(z - hub[0], y - hub[1]) < 2.5 ? 'gray_concrete' : Math.round(d) % 3 === 0 ? 'black_wool' : 'black_concrete';
      const x = xAt(y);
      // Where the panel bends, also fill toward the next row so it stays watertight.
      const xs = new Set([x, xAt(y + Math.sign(y))]);
      for (const sx of [-1, 1]) {
        for (const px of xs) bp.set(sx * px, y, z, b);
        if (edge) for (const o of rim) bp.set(sx * (x + o), y, z, 'gray_concrete');
      }
    }
}

/** Pylons from the ball out to the wing hubs at x = ±xWing, with a cap on the outer face. */
function eyePylons(bp: Blueprint, xWing: number) {
  tubeX(bp, 0, 0, 6, xWing + 2, (x) => (x <= 7 ? 2.6 : x < xWing - 1 ? 1.5 : x === xWing - 1 ? 3 : 2), (_d, x) => (x <= 7 || x >= xWing - 1 ? 'gray_concrete' : 'light_gray_concrete'));
}

// ---------------------------------------------------------------------------------------------
// The Empire's eye fighter: a ball cockpit between two tall hexagonal wing panels at x = ±13.

export function eyeFighter(): SkyCraft {
  const bp = canvas(16, 17, 15);
  const { chin, exhausts } = eyeBall(bp);
  const hex: Pt[] = [[-13, 0], [-7, 15], [7, 15], [13, 0], [7, -15], [-7, -15]];
  eyeWing(bp, hex, [0, 0], hex, () => 13, [-1, 1]);
  eyePylons(bp, 13);
  return { blueprint: bp, guns: chin, engines: exhausts, radius: radiusOf(bp) };
}
