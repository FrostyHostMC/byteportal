import type { BlockRef } from '@platform';
import { box, disc, dist, hash, slab, stairs, type Canvas } from './build';

/**
 * The ships of Mos Blockley, homages rather than anyone's in particular, block-built and nose
 * west (-x) in their own coordinates (put them on a `Place` to turn them), standing on the floor
 * at y (the feet level): the battered saucer freighter in the docking bay, the Rebels' Vox-wing
 * fighters, the Empire's folded-wing shuttle and its twin-panelled fighter, and the wedge of a
 * Star Demolisher lying half buried out in the dunes.
 */

/**
 * The saucer freighter: a round hull (its middle `(0.5, 0.5)`, `R` across the radius) thick in the
 * middle and thin at the rim, on landing legs a block high; two cargo prongs out front with a slot
 * between them, the cockpit tube off the starboard side (north, as built), the engines glowing
 * round the back, a gun turret and a sensor dish on top. A ramp comes down to starboard behind the
 * cockpit, and its back is walkable, in half steps, from the rim to the turret.
 */
export function freighter(c: Canvas, y: number, R = 9.5) {
  const topAt = (d: number) => 5.2 - 2.8 * (d / R) ** 2;
  // The slot between the prongs runs back into the hull a little.
  const slot = (x: number, z: number) => x < -R + 3 && z >= -1 && z <= 1;
  disc(0.5, 0.5, R, (x, z, d) => {
    if (slot(x, z)) return;
    const bottom = d < R - 2 ? 1 : 2;
    const t = topAt(d);
    const full = Math.floor(t);
    const rear = x > R * 0.35 && d > R - 1.3;
    for (let k = bottom; k < full; k++) c.set(x, y + k, z, rear && k === 2 ? 'engine_glow' : k === bottom && d > R - 4 ? 'hull_dark' : 'hull');
    if (t - full >= 0.5) c.set(x, y + full, z, slab('hull'));
    else if (rear && full === 2) c.set(x, y + 2, z, 'engine_glow');
    // Panel lines on top: a darker ring, and the spokes of the plating.
    const ang = Math.atan2(z + 0.5 - 0.5, x + 0.5 - 0.5);
    const spoke = Math.abs(((ang / (Math.PI / 4)) % 1) + 1) % 1 < 0.08 * (6 / Math.max(d, 1));
    if ((d > 3.6 && d < 4.4) || (spoke && d > 2.5 && d < R - 1.5)) {
      if (c.get(x, y + full - 1, z) === 'hull' && t - full < 0.5) c.set(x, y + full - 1, z, 'hull_dark');
    }
  });
  // The prongs: out past the rim, tapering.
  for (const side of [-1, 1])
    for (let x = Math.floor(-R) - 6; x <= Math.floor(-R) + 3; x++)
      for (let w = 2; w <= 4; w++) {
        const z = side * w;
        if (dist(x, z, 0.5, 0.5) <= R - 1) continue;
        const tip = x <= Math.floor(-R) - 5;
        c.set(x, y + 2, z, tip ? slab('hull') : w === 4 ? 'hull_dark' : 'hull');
        if (!tip && w < 4 && x >= Math.floor(-R) - 3) c.set(x, y + 3, z, slab('hull'));
      }
  // The cockpit: a tube out to starboard and forward, glass at its end.
  const cz = -Math.round(R) - 1;
  box(c, -8, y + 2, cz - 1, -1, y + 3, cz, 'hull');
  box(c, -1, y + 2, cz + 1, 1, y + 3, cz + 1, 'hull');
  box(c, -9, y + 2, cz - 1, -9, y + 3, cz, 'cockpit');
  box(c, -8, y + 4, cz - 1, -6, y + 4, cz, slab('hull'));
  c.set(-8, y + 3, cz, 'cockpit');
  // The turret on top, its guns, and the sensor dish.
  box(c, 0, y + 5, 0, 1, y + 5, 1, 'hull_dark');
  c.set(-1, y + 5, 0, 'vaporator_pipe');
  c.set(-1, y + 5, 1, 'vaporator_pipe');
  c.set(3, y + 5, 5, 'pole');
  box(c, 2, y + 6, 4, 4, y + 6, 6, slab('hull'));
  c.set(3, y + 6, 5, 'hull_dark');
  // Legs.
  for (const [x, z] of [[-5, -5], [-5, 5], [5, -5], [5, 5], [-1, 0], [-13, -3], [-13, 3]] as const) c.set(x, y, z, 'hull_dark');
  // The ramp down to starboard behind the cockpit, climbing to the rim.
  const rz = -Math.round(R) - 1;
  for (let x = 1; x <= 3; x++) {
    c.set(x, y, rz - 1, stairs('plaster', 'south'));
    c.set(x, y, rz, 'hull_dark');
    c.set(x, y + 1, rz, stairs('plaster', 'south'));
    c.set(x, y, rz + 1, 'hull_dark');
    c.set(x, y + 1, rz + 1, 'hull_dark');
    c.set(x, y + 2, rz + 1, stairs('plaster', 'south'));
  }
}

/**
 * A Vox-wing on its landing gear: a long nose, the cockpit and a little droid behind it,
 * four wings splayed from engines at their roots, a cannon at each wingtip, red squadron stripes.
 * Its tail is at x = 0.
 */
export function xfighter(c: Canvas, y: number, stripe: BlockRef = 'red_concrete') {
  const b = y + 3;
  // The fuselage: broad at the back, a long thin nose.
  box(c, -4, b, -1, 1, b + 1, 1, 'hull');
  box(c, -9, b, 0, -5, b + 1, 0, 'hull');
  box(c, -12, b, 0, -10, b, 0, 'hull');
  c.set(-13, b, 0, slab('hull'));
  c.set(-8, b + 1, 0, stripe);
  c.set(-5, b + 2, 0, 'cockpit');
  c.set(-4, b + 2, 0, 'cockpit');
  c.set(-3, b + 2, 0, slab('hull'));
  c.set(-1, b + 2, 0, 'blue_concrete');
  box(c, -4, b - 1, -1, 1, b - 1, 1, 'hull_dark');
  // The wings: out and up, out and down, from engines at their roots.
  for (const s of [-1, 1]) {
    box(c, -5, b - 1, s * 2, 1, b + 2, s * 2, (x, yy) => (yy === b - 1 || yy === b + 2 ? 'hull_dark' : x === 1 ? 'hull_dark' : 'hull'));
    c.set(2, b - 1, s * 2, 'engine_glow');
    c.set(2, b + 2, s * 2, 'engine_glow');
    const lift = [0, 0, 1, 1, 2, 2];
    for (let w = 3; w <= 7; w++) {
      const up = b + 2 + lift[w - 2];
      const down = b - 1 - lift[w - 2];
      for (let x = -3; x <= 0; x++) {
        const mark = w === 5 && x >= -2;
        c.set(x, up, s * w, mark ? stripe : 'hull');
        c.set(x, down, s * w, mark ? stripe : 'hull');
      }
    }
    // The cannons at the tips.
    for (const yy of [b + 4, b - 3]) for (let x = -9; x <= 0; x++) c.set(x, yy, s * 8, x === -9 ? 'hull_dark' : x > -3 ? 'hull' : 'hull_dark');
  }
  // Gear.
  for (let k = 0; k < 2; k++) {
    c.set(-8, y + k, 0, 'hull_dark');
    c.set(-1, y + k, -1, 'hull_dark');
    c.set(-1, y + k, 1, 'hull_dark');
  }
}

/**
 * The Empire's shuttle, landed: a boxy body, a stepped cockpit out front, the tall fin on top and
 * both wings folded up beside it. White and grey, the engines glowing at the back.
 */
export function shuttle(c: Canvas, y: number) {
  const b = y + 1;
  // Body.
  box(c, -6, b, -2, 5, b + 3, 2, (x, yy, z) => {
    if (yy === b + 3 && Math.abs(z) === 2) return undefined;
    if (yy === b) return 'durasteel_dark';
    if (yy === b + 2 && Math.abs(z) === 2 && x % 3 === 0) return 'cockpit';
    return 'durasteel';
  });
  // Cockpit, stepping down to the nose.
  box(c, -8, b, -1, -7, b + 2, 1, 'durasteel');
  box(c, -10, b, -1, -9, b + 1, 1, 'durasteel');
  box(c, -8, b + 2, -1, -8, b + 2, 1, 'cockpit');
  box(c, -10, b + 1, -1, -10, b + 1, 1, 'cockpit');
  c.set(-11, b, 0, 'durasteel_dark');
  // The fin: tall, tapering back.
  for (let k = 0; k < 9; k++) {
    const x0 = -4 + Math.floor(k * 0.45);
    const x1 = 4 - Math.floor(k * 0.2);
    for (let x = x0; x <= x1; x++) c.set(x, b + 4 + k, 0, x === x0 || k === 8 ? 'durasteel_dark' : 'durasteel');
  }
  // The wings, folded up: leaning out as they rise.
  for (const s of [-1, 1])
    for (let k = 0; k < 9; k++) {
      const z = s * (3 + Math.floor(k * 0.34));
      const x0 = -3 + Math.floor(k * 0.3);
      for (let x = x0; x <= 3; x++) c.set(x, b + 1 + k, z, x === x0 ? 'durasteel_dark' : k === 8 ? 'durasteel_dark' : 'durasteel');
    }
  // Engines.
  box(c, 6, b + 1, -2, 6, b + 2, 2, 'engine_glow');
  box(c, 6, b, -2, 6, b, 2, 'durasteel_dark');
  // Gear.
  for (const [x, z] of [[-8, 0], [3, -2], [3, 2]] as const) c.set(x, y, z, 'durasteel_dark');
}

/**
 * The Empire's twin-panelled fighter, standing on its wings: a ball of a cockpit with a round
 * window forward (west), a pylon each side out to a tall six-sided panel.
 */
export function tieFighter(c: Canvas, y: number) {
  const mid = y + 4;
  // The ball.
  for (let dx = -1; dx <= 1; dx++)
    for (let dy = -1; dy <= 1; dy++)
      for (let dz = -1; dz <= 1; dz++) {
        if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) === 3) continue;
        c.set(dx, mid + dy, dz, 'durasteel_dark');
      }
  c.set(-2, mid, 0, 'cockpit');
  c.set(-1, mid, 0, 'durasteel');
  // Pylons and panels.
  const HALF = [1, 2, 3, 4, 4, 4, 3, 2, 1];
  for (const s of [-1, 1]) {
    c.set(0, mid, s * 2, 'durasteel');
    c.set(0, mid, s * 3, 'durasteel');
    for (let k = 0; k < HALF.length; k++)
      for (let x = -HALF[k]; x <= HALF[k]; x++) {
        const edge = Math.abs(x) === HALF[k] || k === 0 || k === HALF.length - 1;
        const strut = x === 0 || k === 4;
        c.set(x, y + k, s * 4, edge ? 'durasteel' : strut ? 'durasteel_dark' : 'black_concrete');
      }
  }
}

/**
 * The wreck of a Star Demolisher: a dagger-shaped wedge `len` long, its nose at the origin and its
 * stern along +x, rolled most of the way onto its side so its flat belly stands up like a wall
 * facing -z, a great grey triangle of plating sunk in the sand (put dunes round it); its dead
 * engines face +x, and plates are torn away here and there. For the backdrop: nobody gets near it.
 */
export function wreck(c: Canvas, y: number, len = 120) {
  const W = len * 0.3;
  const rise = 0.05;
  const roll = (-62 * Math.PI) / 180;
  const [cr, sr] = [Math.cos(roll), Math.sin(roll)];
  const base = (u: number) => y - 5 + u * rise;
  /** A cell of the hull in its own frame (u along it, v across its belly, k up from the belly), rolled. */
  const put = (u: number, v: number, k: number, b: BlockRef) => {
    const yy = Math.floor(base(u) + v * sr + k * cr);
    if (yy < y - 3) return;
    c.set(Math.floor(u), yy, Math.round(v * cr - k * sr), b);
  };
  /** The belly's plating: big panels ruled in dark lines, a few holes torn in it. */
  const plate = (u: number, v: number): BlockRef => {
    const hole = hash(u >> 4, Math.floor(v) >> 3, 9) < 0.07;
    if (hole) return 'black_concrete';
    return u % 12 === 0 || Math.floor(v) % 9 === 0 || hash(u, Math.floor(v), 8) < 0.015 ? 'hull_dark' : 'hull';
  };
  for (let u = 0; u <= len; u++) {
    const t = u / len;
    const half = Math.max(1, W * t);
    const thick = 3 + 10 * t;
    for (let v = -half; v <= half; v += 0.5) {
      const edge = Math.abs(v) / half;
      // Stepped decks on the far side: the spine highest, the flanks falling away.
      const top = thick * (1 - 0.55 * edge) + (edge < 0.18 ? 2 : 0);
      for (let k = 0; k <= top; k += 0.5) {
        const skin = k === 0 || k > top - 1 || Math.abs(v) > half - 1 || u === len;
        if (skin) put(u, v, k, k === 0 ? plate(u, v) : 'hull');
      }
    }
  }
  // The stern: plated over, three dead engines.
  for (let v = -W; v <= W; v += 0.5)
    for (let k = 0; k <= 15; k += 0.5) {
      const top = 13 * (1 - 0.55 * (Math.abs(v) / W)) + (Math.abs(v) / W < 0.18 ? 2 : 0);
      if (k > top) continue;
      const engine = [-12, 0, 12].some((e) => Math.hypot(v - e, k - 6) < 3.2);
      put(len, v, k, engine ? 'black_concrete' : 'hull_dark');
    }
}

/**
 * The Empire's four-legged walker, standing (nose west): a long armoured body seventeen up on four
 * jointed legs (knees and broad feet), a ribbed neck and the boxy head out front with its chin
 * guns. Its middle is at the origin; walk right under it.
 */
export function walker(c: Canvas, y: number) {
  const b = y + 17;
  // The body: panels with a dark seam round it and dark ribs, the roof narrower, its edges cut.
  box(c, -10, b, -4, 9, b + 7, 4, (x, yy, z) => {
    const top = yy === b + 7;
    if (top && Math.abs(z) === 4) return undefined;
    if ((x === -10 || x === 9) && (yy === b + 7 || yy === b) && Math.abs(z) === 4) return undefined;
    if (yy === b || yy === b + 4 || (Math.abs(z) === 4 && (x + 10) % 5 === 0)) return 'durasteel_dark';
    return top && (x & 1) === 0 ? 'hull' : 'durasteel';
  });
  box(c, -9, b + 7, -3, 8, b + 7, 3, (x) => (x % 4 === 0 ? 'durasteel_dark' : slab('hull')));
  // The legs: broad feet, knees and hips, dark joints on grey.
  for (const [lx, lz] of [[-8, -4], [-8, 3], [5, -4], [5, 3]] as const) {
    box(c, lx - 1, y, lz - 1, lx + 2, y, lz + 2, 'durasteel_dark');
    box(c, lx, y + 1, lz, lx + 1, b - 1, lz + 1, (_x, yy) => (yy === y + 1 ? 'hull_dark' : 'durasteel'));
    box(c, lx - 1, y + 8, lz - 1, lx + 2, y + 9, lz + 2, (xx, yy, zz) => (yy === y + 9 && (xx === lx - 1 || xx === lx + 2) && (zz === lz - 1 || zz === lz + 2) ? undefined : 'durasteel_dark'));
    box(c, lx - 1, b - 1, lz - 1, lx + 2, b - 1, lz + 2, 'durasteel_dark');
  }
  // The neck, ribbed.
  box(c, -14, b + 3, -1, -11, b + 5, 1, (x) => (x % 2 === 0 ? 'hull_dark' : 'durasteel_dark'));
  // The head: boxy, its front narrower, a dark visor, chin guns and cheek guns.
  box(c, -22, b + 1, -3, -15, b + 6, 3, (x, yy, z) => {
    const front = x <= -21;
    if (front && Math.abs(z) === 3) return undefined;
    if (yy === b + 6 && (Math.abs(z) === 3 || x === -22)) return undefined;
    if (x === -22 && yy === b + 4) return 'cockpit';
    return yy === b + 1 || (x + z) % 5 === 0 ? 'durasteel_dark' : 'durasteel';
  });
  box(c, -21, b + 6, -2, -16, b + 6, 2, slab('hull'));
  for (const z of [-2, 2]) box(c, -26, b + 1, z, -23, b + 1, z, 'hull_dark');
  for (const z of [-4, 4]) box(c, -22, b + 3, z, -20, b + 3, z, 'hull_dark');
}

/**
 * One of the walkers, brought down: lying on its side along x (nose west), its roof toward +z
 * and its underside toward -z, its lower legs out along the snow that way, the upper pair broken
 * off short, a hole burnt in its flank, the head torn away (`walkerHead` puts it somewhere). Nine
 * high: a wall of armour.
 */
export function walkerWreck(c: Canvas, y: number) {
  // The body, fallen: nine tall (its width), eight deep (its height), its long edges cut off.
  box(c, -10, y, 0, 9, y + 8, 7, (x, yy, z) => {
    const k = yy - y;
    const corner = (k === 0 || k === 8) && (z === 0 || z === 7);
    if (corner || (z === 7 && (k <= 1 || k >= 7))) return undefined;
    if ((x === -10 || x === 9) && (k === 0 || k === 8)) return undefined;
    // Seams: round the middle, and a rib every five along the roof and the flank on top.
    if (z === 4 && (k === 0 || k === 8)) return 'durasteel_dark';
    if ((x + 10) % 5 === 0 && (z === 7 || k === 8)) return 'durasteel_dark';
    return hash(x, yy, z) < 0.05 ? 'hull_dark' : 'durasteel';
  });
  // A hole burnt in the flank on top, embers in it.
  box(c, -3, y + 7, 2, 1, y + 8, 5, (x, yy, z) => (yy === y + 7 && (x + z) % 2 === 0 ? 'pad_amber' : yy === y + 7 ? 'black_concrete' : 'air'));
  // Ribs across the belly, and the hips the legs hang from.
  for (let x = -8; x <= 7; x += 3) box(c, x, y + 2, -1, x, y + 6, -1, 'hull_dark');
  for (const lx of [-8, 5]) {
    box(c, lx - 1, y, -1, lx + 2, y + 2, -1, 'durasteel_dark');
    box(c, lx - 1, y + 6, -1, lx + 2, y + 8, -1, 'durasteel_dark');
  }
  // The legs that were underneath: out along the snow, a knee halfway, a broad foot at the end.
  for (const lx of [-8, 5]) {
    box(c, lx, y, -12, lx + 1, y + 1, -2, 'durasteel');
    box(c, lx - 1, y, -8, lx + 2, y + 2, -6, (x, yy, z) => (yy === y + 2 && (x === lx - 1 || x === lx + 2) && (z === -8 || z === -6) ? undefined : 'durasteel_dark'));
    box(c, lx - 1, y, -15, lx + 2, y, -13, 'durasteel_dark');
    box(c, lx, y + 1, -14, lx + 1, y + 1, -13, 'hull_dark');
    // The upper ones, snapped off.
    box(c, lx, y + 7, -3, lx + 1, y + 8, -1, 'durasteel');
    c.set(lx, y + 7, -4, 'hull_dark');
  }
  // The neck's stump, torn cables out of it.
  box(c, -13, y + 3, 2, -11, y + 5, 4, 'hull_dark');
  c.set(-14, y + 4, 3, 'vaporator_pipe');
  c.set(-14, y + 3, 2, 'black_concrete');
}

/** A walker's head, torn off and lying tipped on its side, half in the snow. */
export function walkerHead(c: Canvas, y: number) {
  box(c, -4, y - 1, -3, 3, y + 4, 3, (x, yy, z) => (yy === y + 4 && Math.abs(z) === 3 ? undefined : x === -4 && yy === y + 1 ? 'cockpit' : (x + z) % 5 === 0 ? 'durasteel_dark' : 'durasteel'));
  box(c, -7, y, -2, -5, y, -2, 'hull_dark');
  box(c, -6, y + 1, 2, -5, y + 1, 2, 'hull_dark');
}

/**
 * The Rebels' medium transport, parked on its struts (nose west): a long hull, the cockpit up at
 * the front, a row of cargo pods along its back, three engines glowing at the stern, a Rebel
 * orange stripe.
 */
export function transport(c: Canvas, y: number) {
  box(c, -13, y + 2, -3, 12, y + 5, 3, (x, yy, z) => {
    const nose = x <= -11;
    if (nose && Math.abs(z) === 3) return undefined;
    if (x === -13 && (yy === y + 5 || Math.abs(z) >= 2)) return undefined;
    if (yy === y + 5 && Math.abs(z) === 3) return slab('hull');
    if (yy === y + 2) return 'hull_dark';
    if (yy === y + 3 && Math.abs(z) === 3 && x > -10 && x < 10) return 'orange_concrete';
    return 'hull';
  });
  box(c, -11, y + 6, -1, -9, y + 6, 1, (x) => (x === -11 ? 'cockpit' : 'hull'));
  c.set(-10, y + 7, 0, slab('hull'));
  for (let x = -6; x <= 8; x += 4) box(c, x, y + 6, -2, x + 2, y + 7, 2, (_x, yy, z) => (yy === y + 7 && Math.abs(z) === 2 ? slab('hull') : 'crate_metal'));
  for (const z of [-2, 0, 2]) {
    c.set(13, y + 3, z, 'engine_glow');
    c.set(13, y + 4, z, 'engine_glow');
  }
  for (const [x, z] of [[-9, -2], [-9, 2], [8, -2], [8, 2]] as const) box(c, x, y, z, x, y + 1, z, 'hull_dark');
}

/**
 * The Rebels' two-seat snowspeeder (nose west): a flat wedge, white with orange flashes, the
 * cockpit glass, an engine pod each side at the back, on its skids. `wrecked`: nose buried in
 * the snow, tail up, a scorched furrow behind it.
 */
export function snowspeeder(c: Canvas, y: number, wrecked = false) {
  const lift = (x: number) => (wrecked ? (x < -2 ? -1 : x < 2 ? 0 : 1) : 1);
  for (let x = -6; x <= 3; x++) {
    const half = x < -3 ? 1 : 2;
    for (let z = -half; z <= half; z++) {
      const yy = y + lift(x);
      c.set(x, yy, z, x <= -4 && Math.abs(z) === 1 ? 'orange_concrete' : x === 3 ? 'hull_dark' : 'hull');
      if (x >= -2 && x <= 1 && Math.abs(z) <= 1) c.set(x, yy + 1, z, x === -2 ? 'cockpit' : slab('hull'));
    }
  }
  for (const s of [-1, 1]) {
    for (let x = 0; x <= 3; x++) c.set(x, y + lift(x), s * 3, 'hull_dark');
    c.set(4, y + lift(4), s * 3, wrecked ? 'black_concrete' : 'engine_glow');
  }
  if (!wrecked) {
    c.set(-3, y, 0, 'hull_dark');
    c.set(2, y, 0, 'hull_dark');
    return;
  }
  // Snow heaped at the nose, the furrow it ploughed behind it.
  for (let z = -2; z <= 2; z++) c.set(-7, y, z, 'snow_block');
  for (let x = 5; x <= 14; x++) for (let z = -1; z <= 1; z++) c.set(x, y - 1, z, hash(x, z, 5) < 0.6 ? 'gray_concrete' : 'packed_snow');
}
