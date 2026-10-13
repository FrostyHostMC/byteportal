import type { BlockRef } from '@platform';
import { box, hash, slab, stairs, type Canvas } from './build';

/**
 * Mos Blockley's street furniture, each standing on y (the feet level) at a spot: crates and fuel
 * drums, moisture vaporators, market stalls under cloth awnings, lamps, landspeeders (whole and
 * crashed), the command posts' consoles. The ones with a front are built nose west (-x); put
 * them on a `Place` to turn them.
 */

/** A stack of crates: a footprint of w x d, `h` high, the top course ragged. */
export function crates(c: Canvas, x0: number, y: number, z0: number, w: number, d: number, h: number, seed = 0) {
  for (let x = x0; x < x0 + w; x++)
    for (let z = z0; z < z0 + d; z++) {
      const top = h - (hash(x, z, 90 + seed) < 0.35 ? 1 : 0);
      for (let k = 0; k < Math.max(1, top); k++) c.set(x, y + k, z, hash(x, z + k, 91 + seed) < 0.3 ? 'crate_metal' : 'crate');
    }
}

/** A cluster of fuel drums, some stacked two high. */
export function drums(c: Canvas, x: number, y: number, z: number, n = 3, seed = 0) {
  const spots: [number, number][] = [[0, 0], [1, 0], [0, 1], [1, 1], [2, 0], [0, 2]];
  for (let i = 0; i < Math.min(n, spots.length); i++) {
    const [dx, dz] = spots[i];
    c.set(x + dx, y, z + dz, 'fuel_drum');
    if (hash(x + dx, z + dz, 92 + seed) < 0.3) c.set(x + dx, y + 1, z + dz, 'fuel_drum');
  }
}

/** A moisture vaporator: a squat base, a tall pipe with collars up it, a pointed tip. */
export function vaporator(c: Canvas, x: number, y: number, z: number, h = 7) {
  c.set(x, y, z, 'vaporator_base');
  c.set(x, y + 1, z, 'vaporator_base');
  for (let k = 2; k < h; k++) c.set(x, y + k, z, k === h - 2 || k === h - 4 || k === 3 ? 'vaporator_ring' : 'vaporator_pipe');
  c.set(x, y + h, z, 'vaporator_pipe');
}

/**
 * A gun emplacement, facing west: a round base of panels, a squat dark turret on it with a shield
 * over its twin barrels. Somewhere to stand and fight from.
 */
export function turret(c: Canvas, x: number, y: number, z: number) {
  for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) if (Math.abs(dx) + Math.abs(dz) < 4) c.set(x + dx, y, z + dz, 'base_panel');
  box(c, x, y + 1, z - 1, x + 1, y + 2, z + 1, 'durasteel_dark');
  box(c, x - 1, y + 3, z - 1, x + 1, y + 3, z + 1, slab('hull'));
  for (const dz of [-1, 1]) box(c, x - 4, y + 2, z + dz, x - 1, y + 2, z + dz, 'hull_dark');
}

/** A water tank on stilts: four legs, a drum of dark plating three across, a vent on top (walk under it). */
export function waterTank(c: Canvas, x: number, y: number, z: number) {
  for (const [dx, dz] of [[0, 0], [2, 0], [0, 2], [2, 2]] as const) for (let k = 0; k < 3; k++) c.set(x + dx, y + k, z + dz, 'pole');
  box(c, x, y + 3, z, x + 2, y + 4, z + 2, (bx, by, bz) => ((bx === x || bx === x + 2) && (bz === z || bz === z + 2) && by === y + 4 ? slab('hull') : by === y + 3 ? 'hull_dark' : 'vaporator_base'));
  c.set(x + 1, y + 5, z + 1, 'vaporator_ring');
  c.set(x + 1, y + 6, z + 1, 'vaporator_pipe');
}

/** A lamp on a pole: a dark post, a glowing head. */
export function lamp(c: Canvas, x: number, y: number, z: number, head: BlockRef = 'pad_amber', h = 3) {
  for (let k = 0; k < h; k++) c.set(x, y + k, z, 'vaporator_pipe');
  c.set(x, y + h, z, head);
}

/**
 * A market stall facing west (its counter along its west side, x0): a 4-post frame under a
 * striped awning at head height and a little over, a counter of crates with wares on it, a
 * back wall of stock two high (cover, and a break in the view across the square). w along z
 * (3..5), 3 deep.
 */
export function stall(c: Canvas, x0: number, y: number, z0: number, w: number, awning: string, wares: BlockRef[], seed = 0) {
  const x1 = x0 + 2;
  const z1 = z0 + w - 1;
  for (const [x, z] of [[x0, z0], [x0, z1], [x1, z0], [x1, z1]] as const) for (let k = 0; k < 3; k++) c.set(x, y + k, z, 'pole');
  // The awning: over the frame and one row out over the counter.
  box(c, x0 - 1, y + 3, z0, x1, y + 3, z1, awning);
  // The counter, wares on it.
  for (let z = z0 + 1; z < z1; z++) {
    c.set(x0, y, z, hash(z, x0, 93 + seed) < 0.5 ? 'crate' : 'spruce_planks');
    const ware = wares[Math.floor(hash(x0, z, 94 + seed) * wares.length)];
    if (hash(z, x0, 95 + seed) < 0.75) c.set(x0, y + 1, z, ware);
  }
  // Stock at the back, two high.
  for (let z = z0 + 1; z < z1; z++) {
    const r = hash(x1, z, 96 + seed);
    c.set(x1, y, z, r < 0.35 ? 'fuel_drum' : r < 0.7 ? 'crate' : 'crate_metal');
    c.set(x1, y + 1, z, hash(z, x1, 97 + seed) < 0.5 ? 'crate' : wares[Math.floor(r * wares.length)]);
  }
}

/**
 * An open-topped landspeeder, nose west: a long low body, a windscreen, two seats, three
 * engines on the back (one on top), hovering a slab off the ground.
 */
export function landspeeder(c: Canvas, x0: number, y: number, z0: number, body: BlockRef = 'red_concrete') {
  const x1 = x0 + 6;
  const z1 = z0 + 2;
  // The body: a bottom slab first (it hovers), then the hull.
  for (let x = x0; x <= x1; x++)
    for (let z = z0; z <= z1; z++) {
      const nose = x === x0 && z !== z0 + 1;
      if (nose) continue;
      c.set(x, y, z, x === x0 ? slab('plaster', true) : body);
    }
  // Windscreen, seats (a cockpit sunk into the body), the engines.
  c.set(x0 + 2, y + 1, z0, 'glass');
  c.set(x0 + 2, y + 1, z0 + 1, 'glass');
  c.set(x0 + 2, y + 1, z1, 'glass');
  c.set(x0 + 3, y, z0 + 1, stairs('spruce', 'east'));
  c.set(x0 + 4, y, z0 + 1, stairs('spruce', 'east'));
  // Three engines across the back, the middle one a little higher (a slab: never a step up to anything).
  c.set(x1, y + 1, z0, 'hull_dark');
  c.set(x1, y + 1, z1, 'hull_dark');
  c.set(x1, y + 1, z0 + 1, 'hull');
  c.set(x1, y + 2, z0 + 1, slab('hull'));
  c.set(x1 + 1, y + 1, z0, 'thruster[axis=x]');
  c.set(x1 + 1, y + 1, z1, 'thruster[axis=x]');
}

/**
 * A landspeeder crashed nose first: dug in at the front, its tail up, an engine torn off and
 * lying beside it, scorch round it. Cover to crouch behind, two blocks high at most (a step up to
 * nothing).
 */
export function crashedSpeeder(c: Canvas, x0: number, y: number, z0: number, body: BlockRef = 'orange_concrete') {
  const z1 = z0 + 2;
  // Rising from the nose (a slab, dug in) to the tail (two up).
  for (let i = 0; i < 7; i++) {
    const x = x0 + i;
    for (let z = z0; z <= z1; z++) {
      if (i < 2) c.set(x, y, z, i === 0 ? slab('plaster') : body);
      else if (i < 5) {
        c.set(x, y, z, 'hull_dark');
        c.set(x, y + 1, z, i === 2 ? 'glass' : z === z0 + 1 ? slab('hull') : body);
      } else {
        c.set(x, y, z, 'hull_dark');
        c.set(x, y + 1, z, body);
      }
    }
  }
  // Fins on the tail, and the torn-off engine.
  c.set(x0 + 6, y + 2, z0, slab('hull'));
  c.set(x0 + 6, y + 2, z1, slab('hull'));
  // The engine thrown off, and scorch.
  c.set(x0 + 5, y, z1 + 2, 'hull_dark');
  c.set(x0 + 6, y, z1 + 2, 'hull');
  for (const [dx, dz] of [[-1, 0], [-1, 1], [-1, 2], [0, -1], [1, 3], [3, -1], [-2, 1]] as const) c.set(x0 + dx, y - 1, z0 + dz, 'black_concrete');
}

/**
 * A command post's console: a squat pedestal of dark durasteel with a glowing top, and a ring of
 * pad lights round it in the floor (y is the feet level; the ring is set in the floor below).
 */
export function commandPost(c: Canvas, x: number, y: number, z: number, light: BlockRef, r = 3) {
  c.set(x, y, z, 'durasteel_dark');
  c.set(x, y + 1, z, light);
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) c.set(x + dx, y, z + dz, slab('plaster'));
  for (let a = 0; a < 16; a++) {
    const t = (a / 16) * Math.PI * 2;
    c.set(Math.round(x + Math.cos(t) * r), y - 1, Math.round(z + Math.sin(t) * r), light);
  }
}

/** A low wall of sandbags or rubble, cover to crouch behind: along x or z, `n` long, ragged. */
export function lowWall(c: Canvas, x: number, y: number, z: number, n: number, along: 'x' | 'z', block: BlockRef = 'plaster_grime', seed = 0) {
  for (let i = 0; i < n; i++) {
    const cx = along === 'x' ? x + i : x;
    const cz = along === 'z' ? z + i : z;
    c.set(cx, y, cz, block);
    if (i > 0 && i < n - 1 && hash(cx, cz, 98 + seed) < 0.55) c.set(cx, y + 1, cz, slab('plaster'));
  }
}

/** A banner hanging from a crossbar on a pole: `h` tall, 2 wide along z. */
export function banner(c: Canvas, x: number, y: number, z: number, cloth: BlockRef, h = 6) {
  for (let k = 0; k < h + 1; k++) c.set(x, y + k, z, 'vaporator_pipe');
  for (let k = 2; k < h; k++) {
    c.set(x, y + k, z + 1, cloth);
    c.set(x, y + k, z + 2, cloth);
  }
  c.set(x, y + h, z + 1, 'vaporator_pipe');
  c.set(x, y + h, z + 2, 'vaporator_pipe');
}

