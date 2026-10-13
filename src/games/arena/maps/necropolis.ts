import { Blueprint, type BlockRef, type Vec3 } from '@platform';
import { faceTo, hash, voxels, wallTorch, yawTo } from './kit';
import { banner, parts, type BannerDesign, type Model, type Part } from './models';
import { FLOOR, type ArenaMap, type Decor, type Fire, type Gate, type Portcullis, type TrapSpec } from './registry';

/**
 * The Necropolis: a walled graveyard under the moon. A plaza in the middle ringed with soul fire;
 * north, a roofless chapel whose crypt gate lets the dead in at the altar to walk the nave under
 * the Reaper's Pendulum; the bell tower beside it, whose Great Bell blasts them back; east, an
 * avenue of mausoleums to the cemetery gate between braziers that spew green fire; west, sunken
 * graves under a hill with a crypt dug into it; south, the ossuary's bone gate; the Old Crypt in
 * the north-west corner. Headstones to weave between, dead trees, iron railings, a wall round it
 * all, and spruce woods on the hills beyond.
 */

/** The middle block's place in the world; everything below is in blocks from it (`lx`, `lz`). */
const OX = 512;
const OZ = 0;
const C = { x: OX + 0.5, z: OZ + 0.5 };
/** The middle of block (lx, lz) at height y, in the world. */
const at = (lx: number, y: number, lz: number): Vec3 => ({ x: OX + lx + 0.5, y, z: OZ + lz + 0.5 });

/** The graveyard wall's lines, and the box the map's main build covers (the woods beyond are another). */
const WX0 = -28;
const WX1 = 28;
const WZ0 = -32;
const WZ1 = 27;
const MAIN = { x0: -36, x1: 36, z0: -38, z1: 34 };
const LAND = 68;
/** The chapel's nave (inside its walls), raised a step; the bell tower's square; the sunken graves. */
const NAVE = { x0: -6, x1: 6, z0: -26, z1: -10 };
const NAVE_Y = FLOOR + 1;
const TOWER = { x0: 10, x1: 16, z0: -14, z1: -8 };
const SUNK = { x0: -26, x1: -10, z0: -11, z1: 11 };
/** The Reaper's Pendulum: its blades hang over the nave here (z), from this high. */
const BLADES_Z = [-14, -20];
const BLADE_PIVOT = FLOOR + 9.6;
const BLADE = 6.5;

/** A blueprint addressed in blocks from the middle. */
class Plan {
  constructor(readonly bp: Blueprint) {}
  set(x: number, y: number, z: number, b: BlockRef) {
    this.bp.set(OX + x, y, OZ + z, b);
  }
  get(x: number, y: number, z: number): BlockRef | undefined {
    return this.bp.get(OX + x, y, OZ + z);
  }
  fill(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, b: BlockRef | ((x: number, y: number, z: number) => BlockRef | undefined)) {
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++)
      for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++)
        for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) {
          const v = typeof b === 'function' ? b(x, y, z) : b;
          if (v !== undefined) this.set(x, y, z, v);
        }
  }
}

const smooth = (t: number) => t * t * (3 - 2 * t);
/** Smooth value noise (0..1) over blocks, in cells `s` across. */
function noise(x: number, z: number, s: number, k: number): number {
  const gx = Math.floor(x / s);
  const gz = Math.floor(z / s);
  const u = smooth(x / s - gx);
  const v = smooth(z / s - gz);
  const a = hash(gx, gz, k) + (hash(gx + 1, gz, k) - hash(gx, gz, k)) * u;
  const b = hash(gx, gz + 1, k) + (hash(gx + 1, gz + 1, k) - hash(gx, gz + 1, k)) * u;
  return a + (b - a) * v;
}

/** How far out of the graveyard's wall a block is (0 inside it). */
function beyond(x: number, z: number): number {
  const dx = Math.max(WX0 - x, x - WX1, 0);
  const dz = Math.max(WZ0 - z, z - WZ1, 0);
  return Math.hypot(dx, dz);
}

/** The west hill the crypt is dug into. */
const inHill = (x: number, z: number) => x <= SUNK.x0 - 1 && Math.abs(z) <= 17;
/** The old road up through the woods from the south to the ossuary: how far into its banks `x` is (0 on it, 1 clear of it). */
const offRoad = (x: number, z: number) => (z > WZ1 ? smooth(Math.min(1, Math.max(0, (Math.abs(x) - 3) / 6))) : 1);

/** The ground's height over the floor (blocks): rising into hills beyond the wall, a ridge behind the chapel, the west hill. */
function hillAt(x: number, z: number): number {
  const e = beyond(x, z);
  let h = Math.min(8, e * 0.3) + (noise(x, z, 9, 1) - 0.35) * Math.min(4, e * 0.5);
  if (z < WZ0 - 4) h += Math.min(5, (WZ0 - 4 - z) * 0.35);
  h *= offRoad(x, z);
  if (inHill(x, z)) h = Math.max(h, 6 + noise(x, z, 5, 2) * 2 - Math.max(0, Math.abs(z) - 13) * 1.2 + (WX0 - x > 0 ? (WX0 - x) * 0.3 : 0));
  return Math.max(0, Math.round(h));
}

/** A column of the land beyond the wall (and the west hill): earth, its top in podzol and grass, a stone outcrop here and there. */
function landColumn(p: Plan, x: number, z: number) {
  const h = hillAt(x, z);
  const r = hash(x, z, 3);
  // The west hill's a crag (its face shows); the rest, earth with stones in it.
  const crag = inHill(x, z);
  for (let y = FLOOR; y < FLOOR + h; y++) {
    const s = hash(x, y, z);
    p.set(x, y, z, crag ? (s < 0.45 ? 'stone' : s < 0.7 ? 'andesite' : s < 0.85 ? 'cobblestone' : 'grave_soil') : s < 0.12 ? 'stone' : 'dirt');
  }
  const rock = noise(x, z, 4, 4) > 0.78 && h > 1;
  const road = offRoad(x, z) < 0.05 && z > WZ1 + 5;
  p.set(x, FLOOR + h, z, road ? (r < 0.6 ? 'gravel' : r < 0.85 ? 'cobblestone' : 'dirt') : rock ? (r < 0.5 ? 'stone' : 'andesite') : r < 0.55 ? 'podzol' : r < 0.85 ? 'grass_block' : 'grave_soil');
}

/** A spruce, dark and tall, its foot on the block at `y`. */
function spruce(p: Plan, x: number, y: number, z: number, h: number) {
  for (let k = 1; k <= h; k++) p.set(x, y + k, z, 'spruce_log');
  for (let k = 3; k <= h + 1; k++) {
    const r = Math.max(0, Math.round(((h + 1 - k) / (h - 2)) * 3.2 - ((k % 2) * 0.6)));
    for (let dx = -r; dx <= r; dx++)
      for (let dz = -r; dz <= r; dz++) {
        if (Math.abs(dx) + Math.abs(dz) > r + (r > 1 ? 1 : 0) || (dx === 0 && dz === 0 && k <= h)) continue;
        p.set(x + dx, y + k, z + dz, 'spruce_leaves');
      }
  }
}

/** A dead tree: a bare twisted trunk, branches reaching out, its foot on the block at `y`. */
function deadTree(p: Plan, x: number, y: number, z: number, h: number, k: number) {
  for (let i = 1; i <= h; i++) p.set(x + (i > h * 0.6 && hash(x, z, k) < 0.5 ? 1 : 0), y + i, z, 'spruce_log');
  const n = 3 + Math.floor(hash(x, z, k + 1) * 3);
  for (let b = 0; b < n; b++) {
    const a = hash(x, b, k + 2) * Math.PI * 2;
    const from = Math.floor(h * (0.45 + 0.5 * hash(z, b, k + 3)));
    const len = 2 + Math.floor(hash(b, x + z, k + 4) * 3);
    for (let i = 1; i <= len; i++) {
      const bx = x + Math.round(Math.cos(a) * i);
      const bz = z + Math.round(Math.sin(a) * i);
      const axis = Math.abs(Math.cos(a)) > Math.abs(Math.sin(a)) ? 'x' : 'z';
      p.set(bx, y + from + Math.floor(i / 2), bz, `spruce_log[axis=${axis}]`);
    }
  }
}

/** Trees in the woods beyond the wall, on a jittered grid; those whose trunks fall in `keep`. */
function woods(p: Plan, keep: (x: number, z: number) => boolean) {
  for (let gx = -12; gx <= 12; gx++)
    for (let gz = -12; gz <= 12; gz++) {
      const x = gx * 6 + Math.floor(hash(gx, gz, 5) * 5);
      const z = gz * 6 + Math.floor(hash(gx, gz, 6) * 5);
      const e = beyond(x, z);
      if (e < 4 || Math.hypot(x, z) > LAND - 4 || hash(gx, gz, 7) > 0.62 || inHill(x, z) || offRoad(x, z) < 0.9 || !keep(x, z)) continue;
      const y = FLOOR + hillAt(x, z);
      if (hash(gx, gz, 8) < 0.12) deadTree(p, x, y, z, 6 + Math.floor(hash(gx, gz, 9) * 4), gx * 31 + gz);
      else spruce(p, x, y, z, 8 + Math.floor(hash(gx, gz, 9) * 6));
    }
}

/** The woods and hills beyond the main build: all the ground out to `LAND`. */
function land(): Blueprint {
  const p = new Plan(Blueprint.centered(OX, OZ, LAND, FLOOR, FLOOR + 24));
  const inMain = (x: number, z: number) => x >= MAIN.x0 && x <= MAIN.x1 && z >= MAIN.z0 && z <= MAIN.z1;
  for (let x = -LAND; x <= LAND; x++)
    for (let z = -LAND; z <= LAND; z++) {
      if (inMain(x, z) || Math.hypot(x, z) > LAND + 0.5) continue;
      landColumn(p, x, z);
    }
  woods(p, (x, z) => !inMain(x, z));
  // Lanterns on posts down the road, in pairs.
  for (let z = WZ1 + 12; z < LAND - 6; z += 9)
    for (const x of [-4, 4]) {
      const y = FLOOR + hillAt(x, z);
      p.set(x, y + 1, z, 'crypt_bricks');
      p.set(x, y + 2, z, 'stone_bricks');
      p.set(x, y + 3, z, 'soul_lantern');
    }
  return p.bp;
}

// -------------------------------------------------------------------------------------------------
// The graveyard
// -------------------------------------------------------------------------------------------------

function build(): Blueprint {
  const p = new Plan(new Blueprint({ x: OX + MAIN.x0, y: FLOOR - 3, z: OZ + MAIN.z0 }, { x: MAIN.x1 - MAIN.x0 + 1, y: 36, z: MAIN.z1 - MAIN.z0 + 1 }));
  ground(p);
  sunken(p);
  plaza(p);
  wall(p);
  chapel(p);
  tower(p);
  avenue(p);
  eastGate(p);
  westCrypt(p);
  ossuary(p);
  oldCrypt(p);
  graves(p);
  lights(p);
  woods(p, (x, z) => x >= MAIN.x0 && x <= MAIN.x1 && z >= MAIN.z0 && z <= MAIN.z1);
  return p.bp;
}

/** The ground: inside the wall, grave soil and podzol, a little grass and gravel; beyond it, the hills. */
function ground(p: Plan) {
  for (let x = MAIN.x0; x <= MAIN.x1; x++)
    for (let z = MAIN.z0; z <= MAIN.z1; z++) {
      if (beyond(x, z) > 0 || inHill(x, z)) {
        landColumn(p, x, z);
        continue;
      }
      const r = hash(x, z, 11);
      const patch = noise(x, z, 5, 12);
      p.set(x, FLOOR, z, patch > 0.66 ? (r < 0.6 ? 'grass_block' : 'podzol') : r < 0.5 ? 'grave_soil' : r < 0.85 ? 'podzol' : r < 0.95 ? 'dirt' : 'gravel');
    }
}

/**
 * The sunken graves: a block down, retaining walls round them, steps up, open graves and headstones
 * in rows. (No railings round them: a body can't hop a railing, and one walking straight at a
 * fighter on the far side would stand there pushing.)
 */
function sunken(p: Plan) {
  const s = SUNK;
  p.fill(s.x0, FLOOR, s.z0, s.x1, FLOOR, s.z1, 'air');
  p.fill(s.x0, FLOOR - 1, s.z0, s.x1, FLOOR - 1, s.z1, (x, _y, z) => (hash(x, z, 13) < 0.7 ? 'grave_soil' : hash(x, z, 14) < 0.5 ? 'podzol' : 'gravel'));
  // The retaining wall's top round the edge (its face is the drop).
  for (let x = s.x0 - 1; x <= s.x1 + 1; x++)
    for (const z of [s.z0 - 1, s.z1 + 1]) if (!inHill(x, z)) p.set(x, FLOOR, z, hash(x, z, 15) < 0.3 ? 'mossy_cobblestone' : 'stone_bricks');
  for (let z = s.z0 - 1; z <= s.z1 + 1; z++) p.set(s.x1 + 1, FLOOR, z, hash(s.x1, z, 15) < 0.3 ? 'mossy_cobblestone' : 'stone_bricks');
  // Steps down from the plaza, and at the north and south.
  for (let z = -2; z <= 2; z++) p.set(s.x1, FLOOR, z, 'stone_brick_stairs[facing=east]');
  for (let x = -20; x <= -18; x++) {
    p.set(x, FLOOR, s.z0, 'stone_brick_stairs[facing=north]');
    p.set(x, FLOOR, s.z1, 'stone_brick_stairs[facing=south]');
  }
  // The graves: rows north and south of the middle, the middle kept open.
  let n = 0;
  for (const z0 of [-10, -6, 4, 8])
    for (const x of [-25, -23, -21, -19, -15, -13, -11]) {
      const outer = z0 === -10 || z0 === 8;
      if ((x === -19 || x === -15) && !outer) continue;
      grave(p, x, FLOOR - 1, z0, n++);
    }
}

/**
 * A grave: its headstone (or a broken one), the plot behind it (south of it) two blocks long:
 * heaped earth, flowers, or dug open to the coffin. `y` is the ground's top.
 */
function grave(p: Plan, x: number, y: number, z: number, k: number) {
  const r = hash(x, z, 16 + k);
  p.set(x, y + 1, z, r < 0.12 ? 'cobblestone_slab' : 'headstone[facing=south]');
  if (k % 3 === 1) {
    // Dug open: the coffin's lid at the bottom.
    p.set(x, y, z + 1, 'air');
    p.set(x, y, z + 2, 'air');
    p.set(x, y - 1, z + 1, 'spruce_planks');
    p.set(x, y - 1, z + 2, 'spruce_planks');
    return;
  }
  p.set(x, y, z + 1, 'podzol');
  p.set(x, y, z + 2, 'podzol');
  if (r > 0.7) p.set(x, y + 1, z + 1, r > 0.85 ? 'poppy' : 'dead_bush');
  if (r > 0.45 && r < 0.6) p.set(x, y + 1, z - 1, 'candles');
}

/** The plaza: worn stone, a ring of soul fire set in it, a border of crypt brick; soul braziers round it. */
function plaza(p: Plan) {
  for (let x = -8; x <= 8; x++)
    for (let z = -8; z <= 8; z++) {
      const d = Math.hypot(x, z);
      if (d > 7.6) continue;
      let b: BlockRef = hash(x, z, 17) < 0.1 ? 'mossy_cobblestone' : hash(x, z, 18) < 0.14 ? 'cobblestone' : hash(x, z, 19) < 0.12 ? 'andesite' : 'stone_bricks';
      if (d > 6.7) b = 'crypt_bricks';
      else if (d > 4.5 && d < 5.4) b = 'soul_coals';
      else if (d < 1.3) b = 'crypt_bricks';
      else if (d < 2.4 && Math.abs(Math.abs(x) - Math.abs(z)) < 0.6) b = 'bone_block';
      p.set(x, FLOOR, z, b);
    }
  for (const f of PLAZA_FIRES) brazier(p, f.at, 'soul_coals');
}

/** A brazier on a pedestal of crypt brick, its fire (`f` the flames' place) on `coals`. */
function brazier(p: Plan, f: Vec3, coals: BlockRef) {
  const x = Math.floor(f.x) - OX;
  const z = Math.floor(f.z) - OZ;
  const top = Math.floor(f.y) - 1;
  p.set(x, top, z, coals);
  const base = groundTop(p, x, z);
  for (let y = base + 1; y < top; y++) p.set(x, y, z, y === top - 1 ? 'stone_bricks' : 'crypt_bricks');
}

/** The top of what's standing at (x, z) now, looking down from a few blocks over the floor. */
function groundTop(p: Plan, x: number, z: number): number {
  for (let y = FLOOR + 3; y > FLOOR - 3; y--) {
    const b = p.get(x, y, z);
    if (b !== undefined && b !== 'air') return y;
  }
  return FLOOR;
}

/**
 * The graveyard's wall: crypt brick under a coping, piers with soul lanterns, crumbled here and
 * there; low on the south side with railings on it, so the woods show. (The gates, the hill and
 * the buildings set into it cut their own ways through.)
 */
function wall(p: Plan) {
  const run = (x: number, z: number, i: number, low: boolean) => {
    const pier = i % 6 === 0;
    const crumbled = !pier && noise(i, x + z, 4, 19) > 0.72;
    const top = low ? FLOOR + 2 : crumbled ? FLOOR + 2 + Math.floor(hash(x, z, 20) * 2) : FLOOR + 4;
    for (let y = FLOOR + 1; y <= top; y++) p.set(x, y, z, pier ? 'stone_bricks' : hash(x, y, z) < 0.15 ? 'mossy_cobblestone' : 'crypt_bricks');
    if (pier) {
      p.set(x, top + 1, z, 'stone_bricks');
      p.set(x, top + 2, z, 'stone_brick_slab');
      if (i % 12 === 0) p.set(x, top + 2, z, 'soul_lantern');
    } else if (low) p.set(x, top + 1, z, 'iron_railing');
    else if (!crumbled) p.set(x, top + 1, z, 'stone_brick_slab');
    else if (hash(x, z, 21) < 0.5) p.set(x + (hash(x, z, 22) < 0.5 ? 1 : -1), FLOOR + 1, z + (z === WZ0 ? 1 : z === WZ1 ? -1 : 0), 'cobblestone');
  };
  for (let x = WX0; x <= WX1; x++) {
    run(x, WZ0, x - WX0, false);
    run(x, WZ1, x - WX0, true);
  }
  for (let z = WZ0 + 1; z < WZ1; z++) {
    if (!inHill(WX0, z)) run(WX0, z, z - WZ0, false);
    run(WX1, z, z - WZ0, false);
  }
}

// -------------------------------------------------------------------------------------------------
// The chapel and its bell tower
// -------------------------------------------------------------------------------------------------

/**
 * The ruined chapel: its nave a step up, roofless but for the beams the pendulum's blades hang
 * from; broken walls with pointed windows between buttresses; a gable with a rose window over the
 * door; the altar on its dais; behind it, in the apse wall, the crypt's gate.
 */
function chapel(p: Plan) {
  const n = NAVE;
  const wallX = [n.x0 - 1, n.x1 + 1];
  const front = n.z1 + 1;
  const back = n.z0 - 1;
  // The floor: stone, cracked and mossy, a tattered red runner up the middle.
  p.fill(n.x0, NAVE_Y, n.z0, n.x1, NAVE_Y, n.z1, (x, _y, z) => {
    if (Math.abs(x) <= 1 && z > n.z0 + 3 && hash(x, z, 23) < 0.75) return 'red_wool';
    const r = hash(x, z, 24);
    return r < 0.2 ? 'mossy_cobblestone' : r < 0.3 ? 'andesite' : 'stone_bricks';
  });
  p.fill(n.x0, FLOOR - 1, n.z0, n.x1, FLOOR, n.z1, 'stone');
  // The side walls, ragged at the top, tall enough at the beams.
  const windows = [-14, -20, -24];
  for (const x of wallX)
    for (let z = back; z <= front; z++) {
      let top = FLOOR + 8 + Math.floor(noise(x, z, 3, 25) * 4) + (hash(x, z, 26) < 0.3 ? -1 : 0);
      if (BLADES_Z.includes(z)) top = Math.max(top, FLOOR + 11);
      if (z === front || z === back) top = Math.max(top, FLOOR + 11);
      for (let y = FLOOR - 1; y <= top; y++) {
        const win = windows.some((w) => Math.abs(z - w) <= 1 && y >= FLOOR + 4 && (y <= FLOOR + 7 || (y === FLOOR + 8 && z === w)));
        p.set(x, y, z, win ? 'air' : hash(x, y, z) < 0.18 ? 'mossy_cobblestone' : 'crypt_bricks');
      }
      // Window sills.
      if (windows.some((w) => Math.abs(z - w) <= 1)) p.set(x, FLOOR + 3, z, 'stone_bricks');
    }
  // Buttresses outside, stepping down.
  for (const z of [-11, -17, -22, back])
    for (const side of [-1, 1]) {
      const x0 = side < 0 ? n.x0 - 2 : n.x1 + 2;
      for (let k = 0; k < 2; k++) {
        const x = x0 + side * k;
        for (let y = FLOOR + 1; y <= FLOOR + 7 - k * 3; y++) p.set(x, y, z, 'stone_bricks');
        p.set(x, FLOOR + 8 - k * 3, z, `stone_brick_stairs[facing=${side < 0 ? 'east' : 'west'}]`);
      }
    }
  // The front: a pointed door, the gable over it (half fallen), a rose window.
  for (let x = n.x0 - 1; x <= n.x1 + 1; x++) {
    const ax = Math.abs(x);
    let top = FLOOR + 11 + (7 - ax);
    if (x > 2) top = Math.min(top, FLOOR + 10 + Math.floor(hash(x, front, 27) * 3));
    for (let y = FLOOR - 1; y <= top; y++) {
      const door = ax <= 2 && y >= NAVE_Y + 1 && (y <= FLOOR + 6 || (y === FLOOR + 7 && ax <= 1) || (y === FLOOR + 8 && ax === 0));
      const rose = Math.hypot(x, y - (FLOOR + 12)) < 2.3 && !(x === 0 || y === FLOOR + 12);
      const frame = Math.abs(Math.hypot(x, y - (FLOOR + 12)) - 2.8) < 0.5;
      p.set(x, y, front, door || rose ? 'air' : frame ? 'stone_bricks' : hash(x, y, front) < 0.15 ? 'mossy_cobblestone' : 'crypt_bricks');
    }
  }
  // Steps up to the door.
  for (let x = -2; x <= 2; x++) p.set(x, NAVE_Y, front + 1, 'stone_brick_stairs[facing=north]');
  // The apse wall, its tall window, the crypt's gate under it.
  for (let x = n.x0 - 1; x <= n.x1 + 1; x++)
    for (let y = FLOOR - 1; y <= FLOOR + 13 - Math.max(0, Math.abs(x) - 4); y++) {
      const gate = Math.abs(x) <= 2 && y >= NAVE_Y + 1 && y <= NAVE_Y + 5;
      const win = Math.abs(x) <= 1 && y >= FLOOR + 9 && (y <= FLOOR + 11 || x === 0);
      p.set(x, y, back, gate || win ? 'air' : x === 0 && y === NAVE_Y + 6 ? 'bone_block' : 'crypt_bricks');
    }
  // The beams the blades hang from, and one fallen half across the far end.
  for (const z of BLADES_Z) for (let x = n.x0 - 1; x <= n.x1 + 1; x++) p.set(x, FLOOR + 10, z, 'spruce_log[axis=x]');
  for (let x = n.x0 - 1; x <= -2; x++) p.set(x, FLOOR + 11, -24, 'spruce_log[axis=x]');
  // Piers down the nave, broken off, torches on them; rubble at their feet; cobwebs high up.
  for (const z of [-11, -17, -24])
    for (const x of [-4, 4]) {
      const top = NAVE_Y + 4 + Math.floor(hash(x, z, 28) * 5);
      for (let y = NAVE_Y + 1; y <= top; y++) p.set(x, y, z, y === NAVE_Y + 1 ? 'stone_bricks' : 'crypt_bricks');
      p.set(x - Math.sign(x), NAVE_Y + 3, z, wallTorch(x > 0 ? 'west' : 'east'));
      if (hash(x, z, 29) < 0.6) p.set(x + Math.sign(x), NAVE_Y + 1, z + 1, hash(x, z, 30) < 0.5 ? 'cobblestone' : 'cobblestone_slab');
    }
  for (const [x, z] of [[-6, -10], [6, -10], [-6, -26], [6, -26], [-6, -18], [6, -21]]) p.set(x, FLOOR + 7 + Math.floor(hash(x, z, 31) * 2), z, 'cobweb');
  // Torches high on the walls between the windows, lighting the blades' sweep.
  for (const z of [-12, -17, -22]) {
    p.set(n.x0, FLOOR + 7, z, wallTorch('east'));
    p.set(n.x1, FLOOR + 7, z, wallTorch('west'));
  }
  // The altar on its dais, candles on it, a candle-stand either side.
  p.fill(-3, NAVE_Y + 1, n.z0, 3, NAVE_Y + 1, n.z0 + 3, (x, _y, z) => (Math.abs(x) === 3 || z === n.z0 + 3 ? 'stone_brick_slab' : 'stone_bricks'));
  p.fill(-3, NAVE_Y + 1, n.z0, 3, NAVE_Y + 1, n.z0 + 2, 'stone_bricks');
  for (let x = -3; x <= 3; x++) p.set(x, NAVE_Y + 1, n.z0 + 3, 'stone_brick_stairs[facing=north]');
  p.fill(-1, NAVE_Y + 2, -25, 1, NAVE_Y + 2, -25, 'crypt_bricks');
  p.set(-1, NAVE_Y + 3, -25, 'candles');
  p.set(1, NAVE_Y + 3, -25, 'candles');
  p.set(0, NAVE_Y + 3, -25, 'bone_block');
  for (const f of CRYPT_FIRES) brazier(p, f, 'magma');
  // The crypt behind the gate: a vault where the dead wait.
  p.fill(-4, NAVE_Y, back - 4, 4, NAVE_Y + 6, back - 1, (x, y, z) => (Math.abs(x) === 4 || z === back - 4 || y === NAVE_Y || y === NAVE_Y + 6 ? 'crypt_bricks' : 'air'));
  p.fill(-4, FLOOR - 1, back - 4, 4, NAVE_Y - 1, back - 1, 'stone');
  p.set(-3, NAVE_Y + 3, back - 2, wallTorch('east'));
  p.set(3, NAVE_Y + 3, back - 2, wallTorch('west'));
}

/**
 * The bell tower: open arches at its foot, a shaft up to the belfry, the Great Bell hanging in it
 * under a beam, a dark spire on top with an iron cross.
 */
function tower(p: Plan) {
  const t = TOWER;
  const cx = (t.x0 + t.x1) / 2;
  const cz = (t.z0 + t.z1) / 2;
  const pier = (x: number, z: number) => (x <= t.x0 + 1 || x >= t.x1 - 1) && (z <= t.z0 + 1 || z >= t.z1 - 1);
  const edge = (x: number, z: number) => x === t.x0 || x === t.x1 || z === t.z0 || z === t.z1;
  const archAt = (x: number, z: number, y0: number, h: number, y: number) => {
    const along = x === t.x0 || x === t.x1 ? z - cz : x - cx;
    return Math.abs(along) <= 1 && y >= y0 && (y < y0 + h || (y === y0 + h && along === 0));
  };
  for (let x = t.x0; x <= t.x1; x++)
    for (let z = t.z0; z <= t.z1; z++) {
      p.set(x, FLOOR, z, 'stone_bricks');
      for (let y = FLOOR + 1; y <= FLOOR + 18; y++) {
        let b: BlockRef = 'air';
        if (pier(x, z)) b = 'crypt_bricks';
        else if (edge(x, z)) {
          const open = archAt(x, z, FLOOR + 1, 3, y) || archAt(x, z, FLOOR + 13, 3, y);
          b = open ? 'air' : y === FLOOR + 12 || y === FLOOR + 18 ? 'stone_bricks' : hash(x, y, z) < 0.15 ? 'mossy_cobblestone' : 'crypt_bricks';
        } else if (y === FLOOR + 12) b = 'spruce_planks';
        p.set(x, y, z, b);
      }
    }
  // The beam the bell hangs from; soul lanterns in the belfry's corners, lighting it from below.
  for (let x = t.x0 + 1; x <= t.x1 - 1; x++) p.set(x, FLOOR + 18, cz, 'spruce_log[axis=x]');
  for (const [x, z] of [[t.x0 + 1, cz], [t.x1 - 1, cz], [cx, t.z0 + 1], [cx + 1, t.z1 - 1]]) p.set(x, FLOOR + 13, z, 'soul_lantern');
  // A cornice, then the spire, an iron cross on its point.
  for (let x = t.x0 - 1; x <= t.x1 + 1; x++)
    for (let z = t.z0 - 1; z <= t.z1 + 1; z++) if (x === t.x0 - 1 || x === t.x1 + 1 || z === t.z0 - 1 || z === t.z1 + 1) p.set(x, FLOOR + 18, z, 'stone_brick_slab');
  for (let k = 0; k <= 9; k++) {
    const s = 3 - Math.floor(k / 3);
    const y = FLOOR + 19 + k;
    for (let x = -s; x <= s; x++) for (let z = -s; z <= s; z++) p.set(cx + x, y, cz + z, 'deepslate');
  }
  for (let y = FLOOR + 29; y <= FLOOR + 31; y++) p.set(cx, y, cz, 'iron_block');
  p.set(cx - 1, FLOOR + 30, cz, 'iron_block');
  p.set(cx + 1, FLOOR + 30, cz, 'iron_block');
  // Lanterns at its foot.
  p.set(t.x0 - 1, FLOOR + 1, t.z1 + 1, 'soul_lantern');
  p.set(t.x1 + 1, FLOOR + 1, t.z1 + 1, 'soul_lantern');
}

// -------------------------------------------------------------------------------------------------
// The tombs and gates
// -------------------------------------------------------------------------------------------------

/**
 * A mausoleum: walls `w` by `d` from (x0, z0), its door on side `door` between marble columns,
 * a gabled roof whose ridge runs from the door to the back. Solid, but for a hollow vault (`vault`).
 */
function tomb(p: Plan, x0: number, z0: number, w: number, d: number, door: 'n' | 's', h: number, opts: { vault?: boolean; doorW?: number } = {}) {
  const x1 = x0 + w - 1;
  const z1 = z0 + d - 1;
  const fz = door === 's' ? z1 : z0;
  const mid = Math.floor((x0 + x1) / 2);
  const dw = opts.doorW ?? 1;
  for (let x = x0; x <= x1; x++)
    for (let z = z0; z <= z1; z++) {
      p.set(x, FLOOR, z, 'stone_bricks');
      const shell = x === x0 || x === x1 || z === z0 || z === z1;
      for (let y = FLOOR + 1; y <= FLOOR + h; y++) {
        const inside = !shell && opts.vault;
        p.set(x, y, z, inside ? 'air' : y === FLOOR + 1 ? 'stone_bricks' : y === FLOOR + h ? 'andesite' : hash(x, y, z) < 0.12 ? 'mossy_cobblestone' : 'crypt_bricks');
      }
    }
  // The roof: stairs up both slopes, the gables filled in.
  const half = Math.floor((w - 1) / 2);
  for (let i = 0; i <= half; i++) {
    const y = FLOOR + h + 1 + i;
    for (let z = z0; z <= z1; z++) {
      if (x0 + i === x1 - i) p.set(x0 + i, y, z, 'stone_bricks');
      else {
        p.set(x0 + i, y, z, 'stone_brick_stairs[facing=east]');
        p.set(x1 - i, y, z, 'stone_brick_stairs[facing=west]');
      }
    }
    for (let x = x0 + i + 1; x <= x1 - i - 1; x++) {
      p.set(x, y, z0, 'crypt_bricks');
      p.set(x, y, z1, 'crypt_bricks');
      if (!opts.vault) for (let z = z0 + 1; z < z1; z++) p.set(x, y, z, 'crypt_bricks');
    }
  }
  // The door (dark, or open into the vault), columns either side, a skull over it.
  const out = door === 's' ? 1 : -1;
  for (let x = mid - Math.floor((dw - 1) / 2); x <= mid + Math.ceil((dw - 1) / 2); x++)
    for (let y = FLOOR + 1; y <= FLOOR + Math.min(h - 1, opts.vault ? 4 : 2); y++) p.set(x, y, fz, opts.vault ? 'air' : 'black_concrete');
  for (const x of [mid - Math.floor((dw - 1) / 2) - 1, mid + Math.ceil((dw - 1) / 2) + 1]) for (let y = FLOOR + 1; y <= FLOOR + h - 1; y++) p.set(x, y, fz + out, y === FLOOR + h - 1 ? 'stone_bricks' : 'marble');
  p.set(mid, FLOOR + h, fz + out, 'bone_block');
}

/** The avenue east: cobbles between mausoleums, the soul braziers that breathe across it. */
function avenue(p: Plan) {
  for (let x = 8; x < WX1; x++)
    for (let z = -2; z <= 2; z++) p.set(x, FLOOR, z, hash(x, z, 32) < 0.25 ? 'mossy_cobblestone' : hash(x, z, 33) < 0.2 ? 'gravel' : 'cobblestone');
  tomb(p, 18, -9, 5, 5, 's', 4);
  tomb(p, 11, 5, 5, 5, 'n', 4);
  tomb(p, 20, 5, 5, 5, 'n', 4);
  tomb(p, 20, -21, 5, 6, 's', 5);
  // The braziers: a skull on a pedestal facing across the avenue (the fire comes out of its mouth), soul coals on top.
  for (const f of JET_FIRES) {
    const x = Math.floor(f.at.x) - OX;
    const z = Math.floor(f.at.z) - OZ;
    p.set(x, FLOOR + 1, z, 'crypt_bricks');
    p.set(x, FLOOR + 2, z, 'bone_block');
    p.set(x, FLOOR + 3, z, 'soul_coals');
  }
}

/** The cemetery gate east: an arch in the wall between braziered piers, the pen beyond under a roof. */
function eastGate(p: Plan) {
  const x = WX1;
  for (let z = -4; z <= 4; z++)
    for (let y = FLOOR + 1; y <= FLOOR + 7; y++) {
      const pier = Math.abs(z) >= 3;
      const open = Math.abs(z) <= 2 && y <= FLOOR + 5;
      p.set(x, y, z, open ? 'air' : pier ? (y === FLOOR + 7 ? 'magma' : 'stone_bricks') : y === FLOOR + 6 && z === 0 ? 'bone_block' : y <= FLOOR + 6 ? 'stone_bricks' : 'air');
    }
  p.fill(x, FLOOR, -2, x, FLOOR, 2, 'cobblestone');
  // The pen: walls, a roof, cobbles; torches inside.
  p.fill(x + 1, FLOOR, -4, x + 5, FLOOR + 6, 4, (xx, y, z) => {
    const shell = xx === x + 5 || Math.abs(z) === 4 || y === FLOOR + 6;
    if (y === FLOOR) return 'cobblestone';
    return shell ? 'crypt_bricks' : 'air';
  });
  p.set(x + 4, FLOOR + 3, -3, wallTorch('south'));
  p.set(x + 4, FLOOR + 3, 3, wallTorch('north'));
}

/** The west crypt, dug into the hill: a carved doorway in its face, a vault behind. */
function westCrypt(p: Plan) {
  const x = SUNK.x0 - 1;
  const y0 = FLOOR - 1;
  // The vault.
  p.fill(x - 6, y0, -4, x - 1, y0 + 6, 4, (xx, y, z) => {
    const shell = xx === x - 6 || Math.abs(z) === 4 || y === y0 + 6;
    if (y === y0) return 'stone_bricks';
    return shell ? 'stone_bricks' : 'air';
  });
  // The doorway in the hill's face: columns, a lintel with a skull.
  for (let z = -4; z <= 4; z++)
    for (let y = y0; y <= y0 + 7; y++) {
      const open = Math.abs(z) <= 2 && y > y0 && y <= y0 + 5;
      const column = Math.abs(z) === 3;
      p.set(x, y, z, open ? 'air' : y === y0 ? 'stone_bricks' : column && y <= y0 + 5 ? 'marble' : y === y0 + 6 && z === 0 ? 'bone_block' : 'stone_bricks');
    }
  p.set(x - 5, y0 + 3, -3, wallTorch('south'));
  p.set(x - 5, y0 + 3, 3, wallTorch('north'));
}

/**
 * The ossuary: a hall of bone across the south, a passage through it to the gate in the wall,
 * candles in niches down the passage's walls, the pen beyond.
 */
function ossuary(p: Plan) {
  const z0 = 21;
  const z1 = WZ1;
  for (let x = -7; x <= 7; x++)
    for (let z = z0; z <= z1; z++) {
      p.set(x, FLOOR, z, Math.abs(x) <= 2 ? 'stone_bricks' : 'bone_block');
      for (let y = FLOOR + 1; y <= FLOOR + 7; y++) {
        const passage = Math.abs(x) <= 2 && (y <= FLOOR + 4 || (y === FLOOR + 5 && Math.abs(x) <= 1));
        const niche = Math.abs(x) === 3 && (y === FLOOR + 2 || y === FLOOR + 3) && z > z0 && z < z1 && z % 2 === 0;
        const trim = y === FLOOR + 7 || ((Math.abs(x) === 7 || z === z0) && y === FLOOR + 1);
        p.set(x, y, z, passage ? 'air' : niche ? (y === FLOOR + 2 ? 'candles' : 'air') : trim ? 'crypt_bricks' : 'bone_block');
      }
    }
  // A pediment over the front, a skull at its peak.
  for (let i = 0; i <= 4; i++) for (let x = -7 + i; x <= 7 - i; x++) p.set(x, FLOOR + 8 + i, z0, i === 4 ? 'bone_block' : 'crypt_bricks');
  // The pen beyond the wall.
  p.fill(-4, FLOOR, z1 + 1, 4, FLOOR + 5, z1 + 5, (x, y, z) => {
    const shell = Math.abs(x) === 4 || z === z1 + 5 || y === FLOOR + 5;
    if (y === FLOOR) return 'stone_bricks';
    return shell ? 'crypt_bricks' : 'air';
  });
  p.set(-3, FLOOR + 3, z1 + 3, wallTorch('east'));
  p.set(3, FLOOR + 3, z1 + 3, wallTorch('west'));
  // Its back, where the road from the woods ends: a sealed gate under a gable, lanterns either side.
  const back = z1 + 5;
  for (let x = -5; x <= 5; x++) {
    p.set(x, FLOOR + 6, back, Math.abs(x) === 5 ? 'crypt_bricks' : `stone_brick_stairs[facing=north]`);
    for (let i = 0; i <= 3; i++) if (Math.abs(x) <= 4 - i) p.set(x, FLOOR + 7 + i, back, i === 3 || Math.abs(x) === 4 - i ? 'bone_block' : 'crypt_bricks');
  }
  for (let x = -1; x <= 1; x++) for (let y = FLOOR + 1; y <= FLOOR + 3; y++) p.set(x, y, back, 'spruce_planks');
  p.set(0, FLOOR + 4, back, 'spruce_planks');
  for (const x of [-2, 2]) for (let y = FLOOR + 1; y <= FLOOR + 4; y++) p.set(x, y, back, 'marble');
  for (const x of [-4, 4]) {
    p.set(x, FLOOR + 1, back + 1, 'crypt_bricks');
    p.set(x, FLOOR + 2, back + 1, 'soul_lantern');
  }
  for (const f of OSSUARY_FIRES) brazier(p, f.at, 'magma');
}

/** The Old Crypt in the north-west corner: a great mausoleum whose doors open on the dead. */
function oldCrypt(p: Plan) {
  tomb(p, -20, -27, 7, 7, 's', 6, { vault: true, doorW: 3 });
  for (const f of OLD_CRYPT_FIRES) brazier(p, f.at, 'soul_coals');
  p.set(-19, FLOOR + 3, -24, wallTorch('east'));
  p.set(-15, FLOOR + 3, -24, wallTorch('west'));
}

/**
 * The graves round about: rows of headstones south of the plaza either side of the way to the
 * ossuary, plots north-east and north-west, sarcophagi in the south-east, dead trees, plinths for
 * the statues.
 */
function graves(p: Plan) {
  let n = 100;
  // South, either side of the way (kept five wide).
  for (const z of [10, 13, 16])
    for (const x of [-12, -10, -8, -6, 6, 8, 10, 12]) if (hash(x, z, 34) < 0.85) grave(p, x, FLOOR, z, n++);
  // South-west, under the angel.
  for (const z of [14, 18, 22]) for (const x of [-25, -23, -21, -16, -14]) if (hash(x, z, 35) < 0.8) grave(p, x, FLOOR, z, n++);
  // North-west, before the Old Crypt.
  for (const z of [-19, -16]) for (const x of [-25, -11]) grave(p, x, FLOOR, z, n++);
  // North-east, between the tower and the far mausoleum.
  for (const z of [-27, -24]) for (const x of [10, 12, 14, 17]) grave(p, x, FLOOR, z, n++);
  // South-east: sarcophagi, stone with slab lids.
  for (const [x, z] of [[16, 12], [16, 15], [23, 12], [23, 22], [12, 22]]) {
    p.set(x, FLOOR + 1, z, 'stone_bricks');
    p.set(x, FLOOR + 1, z + 1, 'stone_bricks');
    p.set(x, FLOOR + 2, z, 'stone_brick_slab');
    p.set(x, FLOOR + 2, z + 1, 'stone_brick_slab');
  }
  // Dead trees.
  deadTree(p, -16, FLOOR, 21, 10, 1);
  deadTree(p, 25, FLOOR, 24, 8, 2);
  deadTree(p, -25, FLOOR - 1, 9, 7, 3);
  deadTree(p, 26, FLOOR, -11, 9, 4);
  deadTree(p, -8, FLOOR, -28, 7, 5);
  // The statues' plinths.
  for (const d of STATUES) {
    const x = Math.floor(d.at.x) - OX;
    const z = Math.floor(d.at.z) - OZ;
    for (let y = FLOOR + 1; y < d.at.y; y++) p.fill(x - 1, y, z - 1, x + 1, y, z + 1, y === Math.ceil(d.at.y) - 1 ? 'stone_bricks' : 'crypt_bricks');
    // Candles left at its corners.
    for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) if (hash(x + dx, z + dz, 36) < 0.75) p.set(x + dx, Math.ceil(d.at.y), z + dz, 'candles');
  }
}

/** Soul lanterns on posts where the ways meet the plaza and along the avenue. */
function lights(p: Plan) {
  const posts: [number, number][] = [
    [-4, -8],
    [4, -8],
    [8, -3],
    [8, 3],
    [-3, 8],
    [3, 8],
    [-9, -10],
    [-9, 10],
    [17, -3],
    [24, -3],
    [17, 3],
    [24, 3],
  ];
  for (const [x, z] of posts) {
    p.set(x, FLOOR + 1, z, 'crypt_bricks');
    p.set(x, FLOOR + 2, z, 'stone_bricks');
    p.set(x, FLOOR + 3, z, 'soul_lantern');
  }
}

// -------------------------------------------------------------------------------------------------
// Fires, set pieces, traps
// -------------------------------------------------------------------------------------------------

const PLAZA_FIRES: Fire[] = [1, 3, 5, 7].map((i): Fire => {
  const a = (i * Math.PI) / 4;
  return { at: at(Math.round(Math.cos(a) * 6.6), FLOOR + 3, Math.round(Math.sin(a) * 6.6)), size: 0.8, tint: 'soul' };
});
/** The avenue's braziers, either side of it, a few blocks apart (their skulls breathe the soul fire). */
const JET_FIRES: Fire[] = [
  { at: at(15, FLOOR + 4, -3), size: 0.75, tint: 'soul' },
  { at: at(19, FLOOR + 4, 3), size: 0.75, tint: 'soul' },
];
const CRYPT_FIRES: Vec3[] = [at(-5, NAVE_Y + 4, -25), at(5, NAVE_Y + 4, -25)];
const OSSUARY_FIRES: Fire[] = [-4, 4].map((x): Fire => ({ at: at(x, FLOOR + 3, 19), size: 0.8 }));
const OLD_CRYPT_FIRES: Fire[] = [-22, -12].map((x): Fire => ({ at: at(x, FLOOR + 3, -19), size: 0.7, tint: 'soul' }));
const FIRES: Fire[] = [
  ...PLAZA_FIRES,
  ...JET_FIRES,
  ...CRYPT_FIRES.map((f): Fire => ({ at: f, size: 0.65 })),
  ...OSSUARY_FIRES,
  ...OLD_CRYPT_FIRES,
  { at: at(WX1, FLOOR + 8, -3), size: 0.8 },
  { at: at(WX1, FLOOR + 8, 3), size: 0.8 },
  { at: at(-1, NAVE_Y + 3.45, -25), size: 0.18 },
  { at: at(1, NAVE_Y + 3.45, -25), size: 0.18 },
];

/** The Necropolis's banner: black, a purple border, a skull over crossed bones, its foot in tatters. */
const NECRO_BANNER: BannerDesign = {
  rows: [
    'rrrrrrrrrrrrrrrr',
    'pkkkkkkkkkkkkkkp',
    'pkkkkkkkkkkkkkkp',
    'pkkkkwwwwwwkkkkp',
    'pkkkwwwwwwwwkkkp',
    'pkkwwwwwwwwwwkkp',
    'pkkwwwwwwwwwwkkp',
    'pkkwoowwwwoowkkp',
    'pkkwoowwwwoowkkp',
    'pkkwwwwggwwwwkkp',
    'pkkkwwwggwwwkkkp',
    'pkkkkwwwwwwkkkkp',
    'pkkkkwgwgwgkkkkp',
    'pkkkkwwwwwwkkkkp',
    'pkkkkkkkkkkkkkkp',
    'pkwwkkkkkkkkwwkp',
    'pkkwwkkkkkkwwkkp',
    'pkkkkwwkkwwkkkkp',
    'pkkkkkkwwkkkkkkp',
    'pkkkkwwkkwwkkkkp',
    'pkkwwkkkkkkwwkkp',
    'pkwwkkkkkkkkwwkp',
    'pkkkkkkkkkkkkkkp',
    'pppppppppppppppp',
    'pkkkkkkkkkkkkkkp',
    'pkkkkkkkkkkkkkkp',
    'pkkkkkkkkkkkkkkp',
    'pkkk.kkkkkkkkkkp',
    'pkkk.kkkkkk.kkkp',
    'pk...kkkkkk.kkkp',
    'pk...kkk.k...kkp',
    '.k...kk..k...k.p',
    '.....k...k.....p',
    '.........k......',
  ],
  palette: { r: 'spruce_planks', p: 'purple_concrete', k: 'black_concrete', w: 'white_concrete', g: 'gray_concrete', o: 'soul_coals' },
};
const BANNER = banner(NECRO_BANNER);

/** A weeping angel in marble, wings folded down behind her, head bowed over clasped hands, facing +z. */
function angel(): Model {
  const m: BlockRef = 'marble';
  const bp = voxels({ x: 27, y: 30, z: 11 }, (x, y, z) => {
    const dx = x - 13;
    const adx = Math.abs(dx);
    // The robe, flaring to the ground.
    if (y <= 17 && adx <= 4.6 - y * 0.09 && Math.abs(z - 5) <= 2.2) return y === 0 ? 'andesite' : m;
    // Shoulders and chest.
    if (y >= 18 && y <= 19 && adx <= 3.5 && Math.abs(z - 5) <= 2) return m;
    // Arms in sleeves down to the hands, clasped before her.
    if (y >= 12 && y <= 18 && adx >= 2 && adx <= 4 && z >= 5 && z <= 7) return m;
    if (y >= 12 && y <= 14 && adx <= 1.5 && z >= 7 && z <= 8) return m;
    // The head, bowed forward, a veil over it.
    if (y >= 20 && y <= 24 && adx <= 2 && z >= 5 && z <= 8 - (y > 22 ? 1 : 0)) return y >= 23 || z <= 5 ? 'andesite' : m;
    // The wings: from her shoulders, out and down, feathered at the tips.
    const t = adx - 3;
    if (t >= 0 && t <= 10 && z >= 1 && z <= (t < 2 ? 4 : 2)) {
      const top = 27 - t * 0.35;
      const bottom = 25 - t * 2.1 + (Math.floor(t) % 2 ? 1.5 : 0);
      if (y >= bottom && y <= top) return y > top - 1 ? 'white_concrete' : m;
    }
    return undefined;
  });
  return { bp, scale: 1 / 8, pivot: { x: 13.5, y: 0, z: 5.5 } };
}

/** The Reaper in weathered stone: hooded, cloaked to the ground, scythe in hand, eyes of soul fire. Facing +z. */
function reaper(): Model {
  const s: BlockRef = 'andesite';
  const list: Part[] = [];
  for (let y = 0; y <= 22; y++) {
    const r = 5.2 - y * 0.08;
    for (let x = -6; x <= 6; x++) for (let z = -6; z <= 6; z++) if (Math.hypot(x, z * 1.25) <= r) list.push([x, y, z, x, y, z, y < 2 || (x + z + y) % 7 === 0 ? 'cobblestone' : s]);
  }
  // The hood, open at the front onto darkness; two eyes burning in it.
  for (let y = 23; y <= 29; y++)
    for (let x = -3; x <= 3; x++)
      for (let z = -3; z <= 3; z++) {
        const r = Math.hypot(x, z, (y - 25) * 0.9);
        if (r > 3.6) continue;
        const face = z >= 1 && Math.abs(x) <= 1 && y >= 24 && y <= 26;
        list.push([x, y, z, x, y, z, face ? 'black_concrete' : s]);
      }
  list.push([-1, 25, 2, -1, 25, 2, 'soul_coals'], [1, 25, 2, 1, 25, 2, 'soul_coals']);
  // An arm out to the scythe, its shaft, the blade sweeping over his head.
  list.push([3, 18, 0, 6, 20, 2, s], [7, 0, 1, 7, 36, 1, 'spruce_planks'], [6, 35, 1, 8, 36, 1, 'iron_block']);
  for (let i = 0; i <= 13; i++) {
    const y = 36 - Math.round((i * i) / 18);
    list.push([7 - i, y, 1, 7 - i, y + (i < 10 ? 1 : 0), 1, i > 11 ? 'iron_block' : 'light_gray_concrete']);
  }
  return { bp: parts(list), scale: 1 / 7, pivot: { x: 0.5, y: 0, z: 0.5 } };
}

const ANGEL = angel();
const REAPER = reaper();

/** The statues, on their plinths (`at` is their feet: on top of the plinth). */
const statueAt = (model: Model, x: number, y: number, z: number): Decor => {
  const p = at(x, y, z);
  return { model, at: p, face: faceTo(p.x, p.z, C.x, C.z) };
};
const STATUES: Decor[] = [statueAt(ANGEL, -25, FLOOR + 2, -23), statueAt(ANGEL, 24, FLOOR + 2, -27), statueAt(ANGEL, -20, FLOOR + 2, 25), statueAt(REAPER, 18, FLOOR + 3, 18)];

const DECOR: Decor[] = [
  ...STATUES,
  // On the chapel's front either side of the door, the tower's south face, the cemetery gate, the ossuary's front.
  { model: BANNER, at: { x: OX - 3.5, y: FLOOR + 10, z: NAVE.z1 + 2.06 }, face: 0 },
  { model: BANNER, at: { x: OX + 4.5, y: FLOOR + 10, z: NAVE.z1 + 2.06 }, face: 0 },
  { model: BANNER, at: { x: OX + 13.5, y: FLOOR + 11.5, z: TOWER.z1 + 1.06 }, face: 0 },
  { model: BANNER, at: { x: OX + WX1 - 0.06, y: FLOOR + 5.2, z: -5.5 }, face: -Math.PI / 2 },
  { model: BANNER, at: { x: OX + WX1 - 0.06, y: FLOOR + 5.2, z: 6.5 }, face: -Math.PI / 2 },
  { model: BANNER, at: { x: OX - 5.5, y: FLOOR + 6.6, z: 20.94 }, face: Math.PI },
  { model: BANNER, at: { x: OX + 6.5, y: FLOOR + 6.6, z: 20.94 }, face: Math.PI },
];

const TRAPS: TrapSpec[] = [
  {
    id: 'necropolis.pendulum',
    name: "Reaper's Pendulum",
    kind: 'pendulum',
    lever: { at: at(-4, FLOOR + 1, -5), face: 0 },
    price: 80,
    time: 8,
    cooldown: 35,
    zone: [],
    blades: BLADES_Z.map((z) => ({ pivot: { x: C.x, y: BLADE_PIVOT, z: OZ + z + 0.5 }, axis: 'z' as const, length: BLADE })),
  },
  {
    id: 'necropolis.bell',
    name: 'The Great Bell',
    kind: 'bell',
    lever: { at: at(13, FLOOR + 1, -6), face: 0 },
    price: 100,
    time: 5,
    cooldown: 40,
    zone: [],
    bell: { x: OX + 13.5, y: FLOOR + 18, z: OZ - 10.5 },
    reach: 8.5,
  },
  {
    id: 'necropolis.soulfire',
    name: 'Soul Fire',
    kind: 'jets',
    element: 'soul',
    lever: { at: at(9, FLOOR + 1, 5), face: Math.PI },
    price: 70,
    time: 7,
    cooldown: 35,
    zone: [],
    jets: [
      { at: { x: OX + 15.5, y: FLOOR + 2.4, z: OZ - 2.05 }, dir: { x: 0, y: -0.06, z: 1 }, length: 6.5 },
      { at: { x: OX + 19.5, y: FLOOR + 2.4, z: OZ + 3.05 }, dir: { x: 0, y: -0.06, z: -1 }, length: 6.5 },
    ],
  },
];

/** A gate at `p` (feet), facing the middle. */
const gate = (p: Vec3): Gate => ({ at: p, yaw: yawTo(p.x, p.z, C.x, C.z) });

/** The gates: the crypt behind the altar, the cemetery gate, the hill crypt, the ossuary, the Old Crypt. */
const GATES: Gate[] = [gate(at(0, NAVE_Y + 1.05, NAVE.z0 - 4)), gate(at(WX1 + 2, FLOOR + 1.05, 0)), gate(at(SUNK.x0 - 4, FLOOR + 0.05, 0)), gate(at(0, FLOOR + 1.05, WZ1 + 2)), gate(at(-17, FLOOR + 1.05, -24))];

const PORTCULLISES: Portcullis[] = [
  { at: { x: C.x, y: NAVE_Y + 1, z: OZ + NAVE.z0 - 0.5 }, yaw: GATES[0].yaw, width: 5, height: 5 },
  { at: { x: OX + WX1 + 0.5, y: FLOOR + 1, z: C.z }, yaw: GATES[1].yaw, width: 5, height: 5 },
  { at: { x: OX + SUNK.x0 - 0.5, y: FLOOR, z: C.z }, yaw: GATES[2].yaw, width: 5, height: 5 },
  { at: { x: C.x, y: FLOOR + 1, z: OZ + WZ1 + 0.5 }, yaw: GATES[3].yaw, width: 5, height: 4 },
  { at: { x: OX - 16.5, y: FLOOR + 1, z: OZ - 20.5 }, yaw: GATES[4].yaw, width: 3, height: 4 },
];

export const NECROPOLIS: ArenaMap = {
  id: 'necropolis',
  name: 'The Necropolis',
  line: "Where the dead don't stay buried",
  color: '#7dffb0',
  icon: 'crypt_bricks',
  origin: C,
  build: () => [build(), land()],
  center: { x: C.x, y: FLOOR + 1, z: C.z },
  radius: 20,
  gates: GATES,
  // On open ground (big bosses need room): east of the plaza, the south path, the sunken graves.
  bossGates: [gate(at(12, FLOOR + 1.05, 0)), gate(at(0, FLOOR + 1.05, 14)), gate(at(-17, FLOOR + 0.05, 0))],
  portcullises: PORTCULLISES,
  lookout: at(12, FLOOR + 13, -9),
  time: 0.86,
  dusk: 0.08,
  intro: [
    { at: { x: OX, y: FLOOR + 6, z: OZ + 56 }, look: { x: OX, y: FLOOR + 7, z: OZ + 22 } },
    { at: { x: OX + 1, y: FLOOR + 15, z: OZ + 33 }, look: { x: OX + 1, y: FLOOR + 8, z: OZ - 12 } },
    { at: { x: OX - 9, y: FLOOR + 10, z: OZ + 12 }, look: { x: OX + 13.5, y: FLOOR + 16, z: OZ - 10.5 } },
    { at: { x: OX + 2, y: FLOOR + 6, z: OZ - 1 }, look: { x: OX, y: FLOOR + 4, z: OZ - 20 } },
  ],
  shop: at(-6, FLOOR + 1, 2),
  chests: [at(-17, FLOOR, -8), at(22, FLOOR + 1, -2), at(-10, FLOOR + 1, 19)],
  crowd: false,
  traps: TRAPS,
  decor: DECOR,
  fires: FIRES,
  air: { kind: 'mist', heading: 2.2, wind: 0.8, gust: 2.6, loop: 'amb_crypt_wind', calls: ['amb_crow', 'amb_owl', 'amb_bell'] },
};

