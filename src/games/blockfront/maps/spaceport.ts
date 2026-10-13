import { Blueprint, type BlockRef } from '@platform';
import { box, disc, dist, dome, hash, OPPOSITE, Place, rim, ring, slab, sprite, stairs, STEP, type Facing, type Fill } from './build';
import { spawnAt, type MapSpec, type PostSpec, type SpawnPoint, type Terraform } from './kit';
import * as props from './props';
import * as ships from './ships';

/**
 * Mos Blockley Spaceport: a sun-baked town of plaster domes in a canyon, the Rebels' hangar dug
 * into its west wall and the Empire's garrison against its east one.
 *
 * - **A, the Rebel hangar** (west, the Rebels' for good): a vaulted hangar, two Vox-wings
 *   parked inside, a gantry across its back; its mouth opens east onto an apron, doors north and
 *   south onto the back ways.
 * - **B, the market** (south-west, the Rebels' at the start): a paved square of stalls under
 *   striped awnings round a cistern, shops on every side.
 * - **C, the docking bay** (the middle, nobody's): a round pit three deep inside a ring wall with
 *   six gates, a battered saucer freighter parked in it (its ramp comes down into the fight, its
 *   back is high ground), crates and fuel drums round the post.
 * - **D, the cantina** (north-east, the Empire's at the start): a great domed hall, the bar round
 *   its middle pillar, six ways in (one through a little domed porch off the main street).
 * - **E, the Imperial garrison** (east, the Empire's for good): durasteel walls round a landing
 *   pad, a shuttle on it, barracks either side.
 *
 * Three lanes run the length of it: the main street (the hangar's apron, past the market, through
 * or round the bay, past the cantina to the garrison's gate); the north way (from the hangar's
 * north door along the north alley, across the square north of the bay, past the back of the
 * cantina); and the south way, its mirror. The town is laid out with a half-turn's symmetry about
 * the bay (the market's square answers the cantina's hall), so neither side has the better road.
 * Rooftops: a row along the main street on each side (stairs up, planks between), the walk along
 * the top of the bay's ring wall (ladders), the hangar's gantry, the freighter's back. Everything
 * else is built so nothing a bot can climb from the street reaches a roof (every house is at least
 * five high), and nowhere it can drop into is a pocket it can't walk out of (`fillPockets`).
 * Beyond the canyon's rim the dunes roll off to a Star Demolisher's wreck lying on its side.
 */

const FLOOR = 64;
const G = FLOOR - 1;
/** The docking bay's floor, where feet stand in the pit. */
const PIT = FLOOR - 3;

/** The play area's edge (the canyon walls start just outside, a little ragged). */
const WEST = -104;
const EAST = 104;
const NORTH = -58;
const SOUTH = 58;

/** The docking bay: its middle, the pit's radius, the ring wall's. */
const BAY = { x: 0.5, z: 0.5 };
const PIT_R = 19.5;
const LEDGE_R = 22.5;
const WALL_R = 24.5;
const ROAD_R = 30.5;
/**
 * Where the bay's gates are, in degrees round from east (toward the south): six of them, so no
 * one gate is the way in, each with a screen in front of it (nobody sees through from the street).
 */
const GATES = [30, 90, 150, 210, 270, 330];

// Everything from the pit's floor up past the tower, out to the canyon's rim.
const bp = new Blueprint({ x: WEST - 10, y: PIT - 2, z: NORTH - 12 }, { x: EAST - WEST + 21, y: 36, z: SOUTH - NORTH + 25 });
const set = (x: number, y: number, z: number, b: BlockRef) => bp.set(x, y, z, b);
const fill = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, b: Fill) => box(bp, x0, y0, z0, x1, y1, z1, b);
/** A prop built nose west, put at (x, z) turned `turns` quarter turns. */
const at = (x: number, z: number, turns = 0) => new Place(bp, x, z, turns);

/** Smooth value noise in [0, 1). */
function noise(x: number, z: number, scale: number, k: number): number {
  const fx = x / scale;
  const fz = z / scale;
  const ix = Math.floor(fx);
  const iz = Math.floor(fz);
  const sm = (t: number) => t * t * (3 - 2 * t);
  const tx = sm(fx - ix);
  const tz = sm(fz - iz);
  const a = hash(ix, iz, k) + (hash(ix + 1, iz, k) - hash(ix, iz, k)) * tx;
  const b = hash(ix, iz + 1, k) + (hash(ix + 1, iz + 1, k) - hash(ix, iz + 1, k)) * tx;
  return a + (b - a) * tz;
}

// ---------------------------------------------------------------------------------------------
// The ground and the canyon
// ---------------------------------------------------------------------------------------------

/** Where the canyon's wall starts on each side of a column (ragged). */
const edgeN = (x: number) => NORTH - 3 * noise(x, 0, 9, 1);
const edgeS = (x: number) => SOUTH + 3 * noise(x, 0, 9, 2);
const edgeW = (z: number) => WEST - 3 * noise(0, z, 9, 3);
const edgeE = (z: number) => EAST + 3 * noise(0, z, 9, 4);

function ground() {
  for (let z = NORTH - 12; z <= SOUTH + 12; z++)
    for (let x = WEST - 10; x <= EAST + 10; x++) {
      const n = noise(x, z, 5, 10);
      const speck = hash(x, z, 11);
      set(x, G, z, n < 0.3 ? 'sand' : speck < 0.05 ? 'sandstone' : n < 0.55 ? 'packed_sand' : 'sand');
    }
}

/** The canyon's walls: banded rock, rising steeply from the edge, ragged along the top. */
function canyon() {
  for (let z = NORTH - 12; z <= SOUTH + 12; z++)
    for (let x = WEST - 10; x <= EAST + 10; x++) {
      const out = Math.max(edgeN(x) - z, z - edgeS(x), edgeW(z) - x, x - edgeE(z));
      if (out <= 0) continue;
      const side = z < NORTH ? 16 : z > SOUTH ? 9 : x < WEST ? 15 : 12;
      const h = Math.round(side + 7 * noise(x, z, 6, 12) - 3 + Math.min(out, 6) * 0.8);
      const wobble = Math.floor(noise(x, z, 11, 13) * 3);
      for (let k = 0; k < h; k++) set(x, FLOOR + k, z, ((k + wobble) >> 1) % 3 === 0 ? 'canyon_rock_pale' : 'canyon_rock');
    }
}

/** An outcrop of the canyon's rock: sheer at the foot (nobody climbs it), lumpy on top. */
function outcrop(cx: number, cz: number, r: number, h: number, k = 0) {
  disc(cx, cz, r, (x, z, d) => {
    const top = Math.round(3 + (h - 3) * (1 - (d / r) ** 3) + noise(x, z, 3, 20 + k) * 2 - 0.5);
    for (let y = 0; y < top; y++) set(x, FLOOR + y, z, (y >> 1) % 3 === 0 ? 'canyon_rock_pale' : 'canyon_rock');
  });
}

// ---------------------------------------------------------------------------------------------
// Houses
// ---------------------------------------------------------------------------------------------

/** Each plaster's round window. */
const WINDOWS: Record<string, string> = { plaster: 'plaster_window', plaster_sand: 'sand_window', adobe: 'adobe_window' };

interface Door {
  side: Facing;
  /** The door's first cell along the side (its x on a north or south side, its z on an east or west one). */
  at: number;
  w?: number;
}

interface HouseOpts {
  /** Wall height in blocks: the roof is the top course, and feet stand on it at FLOOR + h. */
  h: number;
  mat?: 'plaster' | 'plaster_sand' | 'adobe';
  /** A dome on the roof, this radius (plaster, cream on any wall). */
  dome?: number;
  /** Hollow, with a floor and doors that go through: a way through for anyone. */
  hollow?: boolean;
  doors?: Door[];
  /** Doors painted dark on a solid house. */
  fake?: Door[];
  /** Stairs up the outside of a wall to the roof: on `side`, the first step at `at`, climbing toward `dir`. */
  stairs?: { side: Facing; at: number; dir: 1 | -1 };
  /** A wall round the roof, with gaps (the stairs' landing gets one of its own). */
  parapet?: boolean;
  gaps?: Door[];
  /** An awning over each real or painted door. */
  awning?: BlockRef;
  /** A vaporator on the roof. */
  vaporator?: boolean;
  /** A barrel vault along its length, in cream plaster. */
  vault?: boolean;
  /** An upper storey this many high, set back two from the walls (domed if `dome` is given). */
  upper?: number;
  /** Odds and ends on a flat roof: crates, drums, an antenna, a sunshade. */
  clutter?: number;
}

function doorCells(d: Door, x0: number, z0: number, x1: number, z1: number): [number, number][] {
  const w = d.w ?? 2;
  const cells: [number, number][] = [];
  for (let i = 0; i < w; i++) {
    if (d.side === 'north') cells.push([d.at + i, z0]);
    else if (d.side === 'south') cells.push([d.at + i, z1]);
    else if (d.side === 'west') cells.push([x0, d.at + i]);
    else cells.push([x1, d.at + i]);
  }
  return cells;
}

/**
 * A house on the footprint x0..x1, z0..z1: plaster or adobe walls with a band of dust at their
 * foot, round windows at head height (open, if it's hollow), the corners cut, a flat roof; as
 * asked, a dome, a barrel vault or an upper storey on it, a parapet round it, stairs up the
 * outside, doors (or niches) under awnings, odds and ends on the roof.
 */
function house(x0: number, z0: number, x1: number, z1: number, o: HouseOpts) {
  const top = FLOOR + o.h - 1;
  const mat = o.mat ?? 'plaster';
  const win = WINDOWS[mat];
  const inside = (x: number, z: number) => x >= x0 && x <= x1 && z >= z0 && z <= z1 && !((x === x0 || x === x1) && (z === z0 || z === z1));
  const edge = (x: number, z: number) => !inside(x + 1, z) || !inside(x - 1, z) || !inside(x, z + 1) || !inside(x, z - 1);
  const doors = new Set<string>();
  const fakes = new Set<string>();
  for (const d of o.doors ?? []) for (const [x, z] of doorCells(d, x0, z0, x1, z1)) doors.add(`${x},${z}`);
  for (const d of o.fake ?? []) for (const [x, z] of doorCells(d, x0, z0, x1, z1)) fakes.add(`${x},${z}`);
  for (let z = z0; z <= z1; z++)
    for (let x = x0; x <= x1; x++) {
      if (!inside(x, z)) continue;
      const e = edge(x, z);
      if (o.hollow && !e) set(x, G, z, 'paving');
      for (let y = FLOOR; y <= top; y++) {
        if (o.hollow && !e && y < top) {
          set(x, y, z, 'air');
          continue;
        }
        let b: BlockRef = y === FLOOR ? 'plaster_grime' : mat;
        if (e && (y === FLOOR + 2 || y === FLOOR + 6) && y < top - 1 && (x + z) % 3 === 0) b = o.hollow ? 'air' : win;
        if (e && y < FLOOR + 3 && (doors.has(`${x},${z}`) || fakes.has(`${x},${z}`))) b = 'air';
        // A painted door is a niche a block deep, dark at the back (somewhere to duck into).
        else if (!e && y < FLOOR + 3 && fakes.size && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => fakes.has(`${x + dx},${z + dz}`))) b = 'doorway';
        set(x, y, z, b);
      }
      // A softened rim round a roof nobody's meant to walk (a slab course on plaster).
      if (e && !o.parapet && mat === 'plaster') set(x, top, z, slab('plaster', true));
    }
  // Arched tops on the doors and niches (cream plaster, whatever the walls), awnings over them.
  for (const d of [...(o.doors ?? []), ...(o.fake ?? [])]) {
    const cells = doorCells(d, x0, z0, x1, z1);
    const along: Facing = d.side === 'north' || d.side === 'south' ? 'west' : 'north';
    const [ax, az] = cells[0];
    const [bx, bz] = cells[cells.length - 1];
    set(ax, FLOOR + 2, az, stairs('plaster', along, true));
    set(bx, FLOOR + 2, bz, stairs('plaster', OPPOSITE[along], true));
    if (o.awning) {
      const [sx, sz] = STEP[d.side];
      for (let i = -1; i <= cells.length; i++) {
        const [cx, cz] = cells[Math.max(0, Math.min(cells.length - 1, i))];
        const ox = along === 'west' ? (i < 0 ? -1 : i >= cells.length ? 1 : 0) : 0;
        const oz = along === 'north' ? (i < 0 ? -1 : i >= cells.length ? 1 : 0) : 0;
        set(cx + ox + sx, FLOOR + 3, cz + oz + sz, o.awning);
      }
    }
  }
  // The parapet.
  const gapSet = new Set<string>();
  for (const d of o.gaps ?? []) for (const [x, z] of doorCells(d, x0, z0, x1, z1)) gapSet.add(`${x},${z}`);
  if (o.stairs) {
    const s = o.stairs;
    const landing = s.at + s.dir * (o.h - 1);
    for (const k of [landing, landing - s.dir]) {
      if (s.side === 'north') gapSet.add(`${k},${z0}`);
      else if (s.side === 'south') gapSet.add(`${k},${z1}`);
      else if (s.side === 'west') gapSet.add(`${x0},${k}`);
      else gapSet.add(`${x1},${k}`);
    }
  }
  if (o.parapet)
    for (let z = z0; z <= z1; z++)
      for (let x = x0; x <= x1; x++) {
        if (!inside(x, z) || !edge(x, z) || gapSet.has(`${x},${z}`)) continue;
        set(x, top + 1, z, (x + z) % 4 === 0 ? slab(mat === 'plaster' ? 'plaster' : 'sandstone') : mat);
      }
  // Stairs up the outside.
  if (o.stairs) {
    const s = o.stairs;
    const f: Facing = s.side === 'north' || s.side === 'south' ? (s.dir > 0 ? 'east' : 'west') : s.dir > 0 ? 'south' : 'north';
    for (let i = 0; i < o.h; i++) {
      const k = s.at + s.dir * i;
      for (const off of [1, 2]) {
        const [x, z] = s.side === 'north' ? [k, z0 - off] : s.side === 'south' ? [k, z1 + off] : s.side === 'west' ? [x0 - off, k] : [x1 + off, k];
        for (let y = FLOOR; y < FLOOR + i; y++) set(x, y, z, y === FLOOR ? 'plaster_grime' : mat);
        set(x, FLOOR + i, z, stairs('plaster', f));
      }
    }
  }
  if (o.upper && x1 - x0 >= 6 && z1 - z0 >= 6) {
    house(x0 + 2, z0 + 2, x1 - 2, z1 - 2, { h: o.h + o.upper, mat: mat === 'adobe' ? 'plaster_sand' : mat, dome: o.dome ? Math.min(o.dome, Math.floor(Math.min(x1 - x0, z1 - z0) / 2) - 2.5) : 0 });
    return;
  }
  if (o.dome) {
    const cx = (x0 + x1 + 1) / 2;
    const cz = (z0 + z1 + 1) / 2;
    dome(bp, cx, cz, o.dome, o.dome * 0.8, top + 1, 'plaster');
  }
  if (o.vault) {
    const alongX = x1 - x0 >= z1 - z0;
    const span = alongX ? z1 - z0 + 1 : x1 - x0 + 1;
    const R = span / 2;
    const rise = Math.max(1.6, span * 0.34);
    const c0 = alongX ? (z0 + z1 + 1) / 2 : (x0 + x1 + 1) / 2;
    const at = (u: number) => rise * Math.sqrt(Math.max(0, 1 - (u / R) ** 2));
    for (let z = z0; z <= z1; z++)
      for (let x = x0; x <= x1; x++) {
        if (!inside(x, z)) continue;
        const u = (alongX ? z : x) + 0.5 - c0;
        const hgt = at(u);
        const full = Math.floor(hgt);
        for (let k = 0; k < full; k++) set(x, top + 1 + k, z, 'plaster');
        const frac = hgt - full;
        if (frac < 0.3) continue;
        const f: Facing = alongX ? (u < 0 ? 'south' : 'north') : u < 0 ? 'east' : 'west';
        set(x, top + 1 + full, z, frac > 0.72 ? 'plaster' : at(Math.abs(u) - 1) - hgt > 0.6 ? stairs('plaster', f) : slab('plaster'));
      }
  }
  if (o.vaporator) props.vaporator(bp, x1 - 2, top + 1, z0 + 2, 6);
  if (o.clutter && !o.dome && !o.vault) {
    // A few things left on the roof, kept off its edge.
    for (let i = 0; i < o.clutter; i++) {
      const cx = x0 + 2 + Math.floor(hash(x0, z0, 70 + i) * Math.max(1, x1 - x0 - 3));
      const cz = z0 + 2 + Math.floor(hash(z0, x0, 71 + i) * Math.max(1, z1 - z0 - 3));
      const kind = hash(cx, cz, 72 + i);
      if (kind < 0.3) props.drums(bp, cx, top + 1, cz, 2, i);
      else if (kind < 0.55) set(cx, top + 1, cz, hash(cx, cz, 73) < 0.5 ? 'crate' : 'crate_metal');
      else if (kind < 0.75) {
        // An antenna: a pole with a little dish.
        fill(cx, top + 1, cz, cx, top + 3, cz, 'vaporator_pipe');
        set(cx, top + 4, cz, slab('hull'));
      } else {
        // A sunshade: an awning on four poles.
        for (const [dx, dz] of [[0, 0], [2, 0], [0, 2], [2, 2]]) if (inside(cx + dx, cz + dz)) fill(cx + dx, top + 1, cz + dz, cx + dx, top + 2, cz + dz, 'pole');
        fill(cx, top + 3, cz, cx + 2, top + 3, cz + 2, (x, _y, z) => (inside(x, z) ? AWNINGS[Math.floor(hash(x0, z0, 74) * 3)] : undefined));
      }
    }
  }
}

/**
 * A round hut: a drum of wall `r` round (cx, cz: a block's corner or middle) and `h` high, a dome
 * on it, doors cut through the drum where asked (compass points), open or painted.
 */
function hut(cx: number, cz: number, r: number, h: number, o: { mat?: string; doors?: Facing[]; open?: boolean; dome?: number; bands?: boolean } = {}) {
  const mat = o.mat ?? 'plaster_sand';
  const top = FLOOR + h - 1;
  const win = WINDOWS[mat] ?? 'plaster_window';
  disc(cx, cz, r, (x, z) => {
    const e = rim(x, z, cx, cz, r);
    if (o.open && !e) set(x, G, z, 'paving');
    for (let y = FLOOR; y <= top; y++) {
      if (o.open && !e && y < top) set(x, y, z, 'air');
      else set(x, y, z, y === FLOOR ? 'plaster_grime' : o.bands && y === top - 1 ? 'adobe' : e && !o.open && y === FLOOR + 2 && (x * 3 + z) % 5 === 0 ? win : mat);
    }
  });
  dome(bp, cx, cz, o.dome ?? r, (o.dome ?? r) * 0.75, top + 1, 'plaster');
  for (const f of o.doors ?? []) {
    const [sx, sz] = STEP[f];
    const ex = Math.floor(cx + sx * (r - 0.5));
    const ez = Math.floor(cz + sz * (r - 0.5));
    const cells: [number, number][] = sx ? [[ex, ez - 1], [ex, ez]] : [[ex - 1, ez], [ex, ez]];
    for (const [x, z] of cells) for (let y = FLOOR; y < FLOOR + 3; y++) set(x, y, z, o.open ? 'air' : 'doorway');
  }
}

/** A plank bridge between two roofs at feet level y, over x0..x1, z0..z1. */
function bridge(x0: number, z0: number, x1: number, z1: number, y: number) {
  fill(x0, y - 1, z0, x1, y - 1, z1, slab('spruce', true));
}

// ---------------------------------------------------------------------------------------------
// A: the Rebel hangar
// ---------------------------------------------------------------------------------------------

/** Rock the hangar's dug into, round its back corners: x, z, radius, height, seed. */
const OUTCROPS: [number, number, number, number, number][] = [
  [-99, -17, 6, 12, 1],
  [-99, 18, 6, 11, 2],
  [-94, -21, 4, 7, 3],
  [-94, 22, 4, 6, 4],
];

const HX0 = -100;
const HX1 = -71;
const HZ = 14;

function hangar() {
  const wallTop = FLOOR + 8;
  const vault = (z: number) => Math.floor(5 * Math.sqrt(Math.max(0, 1 - (z / (HZ + 1)) ** 2)));
  // Floor: concrete, a hazard border, the fighters' bays marked out in yellow.
  fill(HX0, G, -HZ, HX1, G, HZ, (x, _y, z) => (Math.abs(z) === HZ - 1 || x === HX0 + 1 ? 'hazard' : (x - HX0) % 7 === 3 && Math.abs(z) > 2 ? 'yellow_concrete' : 'hangar_floor'));
  for (let x = HX1 + 1; x <= HX1 + 13; x++) for (let z = -12; z <= 12; z++) set(x, G, z, Math.abs(z) === 12 ? 'hazard' : (x + z) % 9 === 0 ? 'hangar_floor' : 'paving');
  // Walls, the vault over them, the back and front gables.
  for (let x = HX0; x <= HX1; x++)
    for (let z = -HZ; z <= HZ; z++) {
      const side = Math.abs(z) === HZ;
      const end = x === HX0 || x === HX1;
      const roofY = wallTop + vault(z);
      if (side || end) {
        for (let y = FLOOR; y <= (end ? roofY : wallTop); y++) {
          const mouth = x === HX1 && Math.abs(z) <= 9 && y <= FLOOR + 7;
          if (mouth) {
            set(x, y, z, 'air');
            continue;
          }
          const frame = x === HX1 && (Math.abs(z) === 10 || y === FLOOR + 8);
          set(x, y, z, frame ? (y === FLOOR + 8 && Math.abs(z) % 3 === 0 ? 'rebel_light' : 'durasteel_dark') : y === FLOOR ? 'durasteel_dark' : y === FLOOR + 6 && !end ? 'rebel_light' : 'rebel_panel');
        }
      }
      set(x, roofY, z, (x - HX0) % 6 === 0 ? 'durasteel_dark' : 'rebel_panel');
      if (!side && !end) for (let y = FLOOR; y < roofY; y++) set(x, y, z, 'air');
    }
  // Side doors, north and south, and lamps over them.
  for (const s of [-1, 1]) {
    fill(-86, FLOOR, s * HZ, -85, FLOOR + 2, s * HZ, 'air');
    set(-87, FLOOR + 3, s * (HZ + 1), 'rebel_light');
    set(-84, FLOOR + 3, s * (HZ + 1), 'rebel_light');
  }
  // Lights under the vault, and a strip low round the walls.
  for (let x = HX0 + 3; x < HX1; x += 4) for (const z of [-8, -3, 3, 8]) set(x, wallTop + vault(z) - 1, z, 'rebel_light');
  for (let x = HX0 + 2; x < HX1 - 1; x += 3) for (const z of [-HZ, HZ]) set(x, FLOOR + 3, z, 'rebel_light');
  for (let z = -HZ + 2; z < HZ - 1; z += 3) set(HX0, FLOOR + 3, z, 'rebel_light');
  // The gantry across the back: a deck four up, stairs to it along each side wall, a rail.
  const deck = FLOOR + 4;
  fill(HX0 + 1, deck - 1, -HZ + 1, HX0 + 4, deck - 1, HZ - 1, 'durasteel_dark');
  for (let z = -HZ + 3; z <= HZ - 3; z++) if (z % 4 !== 0) set(HX0 + 5, deck, z, 'railing');
  for (const s of [-1, 1])
    for (let i = 0; i < 4; i++) {
      const x = HX0 + 5 + (3 - i);
      for (const z of [s * (HZ - 1), s * (HZ - 2)]) {
        set(x, FLOOR + i, z, stairs('plaster', 'west'));
        for (let y = FLOOR; y < FLOOR + i; y++) set(x, y, z, 'durasteel_dark');
      }
    }
  // Posts under the deck.
  for (const z of [-8, 0, 8]) fill(HX0 + 4, FLOOR, z, HX0 + 4, deck - 2, z, 'pole');
  // Two fighters parked nose out, crates and fuel round them.
  ships.xfighter(at(-93, -6, 2), FLOOR);
  ships.xfighter(at(-86, 7, 2), FLOOR, 'orange_concrete');
  props.crates(bp, -97, FLOOR, 10, 2, 2, 2, 1);
  props.crates(bp, -80, FLOOR, -12, 3, 2, 2, 2);
  props.drums(bp, -76, FLOOR, 10, 4, 3);
  props.crates(bp, -93, FLOOR, 1, 2, 2, 1, 4);
  // The apron: landing lights, a speeder, cover.
  for (let x = HX1 + 2; x <= HX1 + 12; x += 3) {
    set(x, G, -11, 'pad_amber');
    set(x, G, 11, 'pad_amber');
  }
  props.landspeeder(at(-64, -10, 1), 0, FLOOR, 0);
  props.crates(bp, -62, FLOOR, 6, 2, 3, 2, 5);
  props.lowWall(bp, -67, FLOOR, -3, 4, 'z', 'hull_dark', 6);
  // The rock it's dug into, round its back corners.
  for (const [x, z, r, h, k] of OUTCROPS) outcrop(x, z, r, h, k);
  props.banner(bp, HX1 + 1, FLOOR, -13, 'banner_rebel', 8);
  props.banner(bp, HX1 + 1, FLOOR, 10, 'banner_rebel', 8);
}

// ---------------------------------------------------------------------------------------------
// B: the market
// ---------------------------------------------------------------------------------------------

const MARKET = { x: -42.5, z: 22.5 };

function market() {
  // The square's paving.
  for (let z = 9; z <= 35; z++) for (let x = -57; x <= -28; x++) set(x, G, z, 'paving');
  // The cistern in the middle: a round tank two high to crouch behind, a vaporator over it.
  disc(MARKET.x, MARKET.z, 2.5, (x, z) => fill(x, FLOOR, z, x, FLOOR + 1, z, (_x, y) => (rim(x, z, MARKET.x, MARKET.z, 2.5) ? (y === FLOOR ? 'ashlar' : 'plaster_sand') : y === FLOOR ? 'ashlar' : 'pad_blue')));
  props.vaporator(bp, -43, FLOOR, 22, 8);
  // An inner ring of stalls with their backs to the cistern: a little fort round the post, a way
  // in at each corner. (A stall is built facing west; one turn faces it north, two east, three south.)
  const WARES: BlockRef[][] = [
    ['orange_concrete', 'yellow_wool', 'green_wool'],
    ['cyan_concrete', 'white_wool', 'iron_block'],
    ['brown_concrete', 'red_wool', 'yellow_concrete'],
    ['light_blue_concrete', 'white_concrete', 'crate'],
    ['green_wool', 'orange_concrete', 'fuel_drum'],
    ['red_wool', 'white_wool', 'brown_concrete'],
  ];
  const stall = (x: number, z: number, turns: number, w: number, k: number) => props.stall(at(x, z, turns), 0, FLOOR, 0, w, AWNINGS[k % 3], WARES[k % WARES.length], k);
  stall(-41, 15, 1, 5, 0); // north of the cistern, facing north
  stall(-44, 30, 3, 5, 1); // south, facing south
  stall(-50, 20, 0, 5, 2); // west, facing west
  stall(-35, 25, 2, 5, 3); // east, facing east
  // Round the edges, facing in: the west side (a gap for the way west), the south, the east.
  stall(-55, 16, 2, 4, 4);
  stall(-55, 27, 2, 5, 5);
  stall(-49, 33, 1, 4, 6);
  stall(-33, 33, 1, 4, 7);
  stall(-30, 22, 0, 4, 8);
  stall(-30, 27, 0, 5, 9);
  stall(-38, 11, 3, 4, 10);
  stall(-53, 11, 3, 4, 11);
  // Crates and drums between them, lamps on poles.
  props.crates(bp, -33, FLOOR, 12, 2, 2, 2, 8);
  props.drums(bp, -56, FLOOR, 33, 3, 9);
  props.crates(bp, -46, FLOOR, 35, 3, 1, 2, 10);
  props.drums(bp, -31, FLOOR, 16, 3, 12);
  props.crates(bp, -54, FLOOR, 23, 1, 2, 2, 13);
  props.lamp(bp, -47, FLOOR, 17);
  props.lamp(bp, -38, FLOOR, 28);
  props.lamp(bp, -47, FLOOR, 28);
  props.lamp(bp, -38, FLOOR, 17);
  props.commandPost(bp, -46, FLOOR, 22, 'pad_blue', 2);
}

// ---------------------------------------------------------------------------------------------
// C: the docking bay
// ---------------------------------------------------------------------------------------------

function bay() {
  disc(BAY.x, BAY.z, ROAD_R, (x, z, d) => {
    if (d < PIT_R) {
      // The pit: its floor three down, a ring of landing lights, sand blown in here and there.
      const ringed = Math.abs(d - 16.5) < 0.5;
      set(x, PIT - 1, z, ringed && (x + z) % 3 === 0 ? 'pad_amber' : ringed ? 'ashlar' : hash(x >> 1, z >> 1, 30) < 0.05 ? 'packed_sand' : 'paving');
      for (let y = PIT; y <= G; y++) set(x, y, z, 'air');
    } else if (d < PIT_R + 1) {
      for (let y = PIT - 1; y <= G; y++) set(x, y, z, 'ashlar');
    } else if (d < LEDGE_R) set(x, G, z, 'paving');
    else if (d < WALL_R) {
      // The ring wall, eight high (nobody on a roof sees over it), a band of adobe, merlons
      // along its outer edge and a walk along its top.
      for (let y = FLOOR; y < FLOOR + 8; y++) set(x, y, z, y === FLOOR ? 'plaster_grime' : y === FLOOR + 5 ? 'adobe' : 'plaster_sand');
      if (d > WALL_R - 1 && (x + z) % 3 !== 0) set(x, FLOOR + 8, z, 'plaster_sand');
      set(x, G, z, 'paving');
    } else set(x, G, z, hash(x, z, 31) < 0.5 ? 'packed_sand' : 'sand');
  });
  // The gates (5 wide, 4 high), a lamp either side, and a ramp down into the pit from each (but
  // the one behind the freighter).
  for (const deg of GATES) {
    const t = (deg * Math.PI) / 180;
    const [c, sn] = [Math.cos(t), Math.sin(t)];
    disc(BAY.x, BAY.z, WALL_R + 1, (x, z, d) => {
      if (d < LEDGE_R - 1) return;
      const along = (x + 0.5 - BAY.x) * c + (z + 0.5 - BAY.z) * sn;
      const across = -(x + 0.5 - BAY.x) * sn + (z + 0.5 - BAY.z) * c;
      if (along > 0 && Math.abs(across) < 2.5) for (let y = FLOOR; y < FLOOR + 4; y++) set(x, y, z, 'air');
      if (along > 0 && Math.abs(Math.abs(across) - 3.5) < 0.5 && d > WALL_R - 0.6) set(x, FLOOR + 4, z, 'pad_amber');
    });
    // Cargo on the ledge either side of it, inside: somewhere to get to when coming through.
    for (const side of [-1, 1]) {
      const a = t + side * (4.2 / (LEDGE_R - 1.5));
      const x = Math.floor(BAY.x + Math.cos(a) * (LEDGE_R - 1.5));
      const z = Math.floor(BAY.z + Math.sin(a) * (LEDGE_R - 1.5));
      set(x, FLOOR, z, side > 0 ? 'crate_metal' : 'fuel_drum');
      set(x, FLOOR + 1, z, 'crate');
    }
    // A screen out on the ring road in front of it: nobody sees in through it from the street.
    disc(BAY.x, BAY.z, ROAD_R, (x, z) => {
      const along = (x + 0.5 - BAY.x) * c + (z + 0.5 - BAY.z) * sn;
      const across = -(x + 0.5 - BAY.x) * sn + (z + 0.5 - BAY.z) * c;
      if (Math.abs(across) < 4.5 && Math.abs(along - (WALL_R + 3.5)) < 0.6) {
        for (let y = FLOOR; y < FLOOR + 3; y++) set(x, y, z, y === FLOOR ? 'plaster_grime' : 'plaster_sand');
        set(x, FLOOR + 3, z, slab('plaster'));
      }
    });
    // The ramp: three stairs down from the ledge's lip to the floor, three wide.
    if (deg === 270) continue;
    const alongX = Math.abs(c) > Math.abs(sn);
    const f: Facing = alongX ? (c < 0 ? 'west' : 'east') : sn < 0 ? 'north' : 'south';
    const mid = alongX ? Math.round(BAY.z + sn * (PIT_R - 1) - 0.5) : Math.round(BAY.x + c * (PIT_R - 1) - 0.5);
    for (let w = mid - 1; w <= mid + 1; w++) {
      const [ox, oz] = STEP[f];
      // In from outside the ledge to the pit's lip.
      let k = Math.ceil(LEDGE_R) + 1;
      let x = 0;
      let z = 0;
      for (; k > 0; k--) {
        x = alongX ? Math.floor(BAY.x) + ox * k : w;
        z = alongX ? w : Math.floor(BAY.z) + oz * k;
        if (dist(x, z, BAY.x, BAY.z) < PIT_R + 1) break;
      }
      for (let i = 0; i < 3; i++) {
        const sx = x - ox * i;
        const sz = z - oz * i;
        fill(sx, PIT - 1, sz, sx, G - 1 - i, sz, 'ashlar');
        set(sx, G - i, sz, stairs('plaster', f));
        for (let y = G - i + 1; y <= G + 2; y++) set(sx, y, sz, 'air');
      }
    }
  }
  // Ladders up the ring wall's outside, east and west, to the walk along its top.
  for (let y = FLOOR; y <= FLOOR + 8; y++) {
    set(25, y, 0, 'ladder[facing=east]');
    set(-25, y, 0, 'ladder[facing=west]');
  }
  set(24, FLOOR + 8, 0, 'air');
  set(-24, FLOOR + 8, 0, 'air');
  // The freighter, nose east, north of the post.
  ships.freighter(at(0, -8, 2), PIT);
  // Cargo round the post: crates, drums, a fuel line, a cargo sled.
  props.crates(bp, -7, PIT, 5, 2, 2, 2, 12);
  props.crates(bp, 6, PIT, 9, 3, 2, 1, 13);
  props.crates(bp, -11, PIT, -1, 2, 3, 2, 14);
  props.crates(bp, 11, PIT, 1, 2, 2, 2, 15);
  props.drums(bp, -3, PIT, 11, 4, 16);
  props.drums(bp, 9, PIT, -12, 3, 17);
  props.crates(bp, -13, PIT, -9, 2, 2, 1, 18);
  fill(1, PIT, 12, 4, PIT, 13, 'crate_metal');
  props.commandPost(bp, 0, PIT, 9, 'pad_blue', 2);
  // Lamps round the ledge.
  for (let a = 0; a < 16; a++) {
    const t = (a / 16) * Math.PI * 2 + 0.2;
    const x = Math.floor(BAY.x + Math.cos(t) * (WALL_R - 1.6));
    const z = Math.floor(BAY.z + Math.sin(t) * (WALL_R - 1.6));
    if (a % 4 !== 0) set(x, FLOOR + 3, z, 'pad_amber');
  }
}

// ---------------------------------------------------------------------------------------------
// D: the cantina
// ---------------------------------------------------------------------------------------------

const CANTINA = { x: 42.5, z: -21.5 };
const HALL_R = 11.5;

/** The cantina's porch: a little domed hall off the main street, a door through to the big one. */
const PORCH: Rect = [39, -9, 45, -5];

function cantina() {
  const top = FLOOR + 6;
  // The hall: a drum of thick plaster, a great dome on it; a floor of flags ringed in dark tile,
  // boards inside the bar.
  disc(CANTINA.x, CANTINA.z, HALL_R + 0.5, (x, z, d) => {
    set(x, G, z, d < 4.5 ? 'spruce_planks' : Math.abs(d - 7.5) < 0.6 ? 'brown_concrete' : d < HALL_R - 1 ? 'ashlar' : 'paving');
    // Windows high in the drum let the afternoon in (and shots through).
    if (d >= HALL_R - 1) for (let y = FLOOR; y <= top; y++) set(x, y, z, y === FLOOR ? 'plaster_grime' : y === top - 1 ? 'adobe' : y === FLOOR + 4 && (x + z) % 4 === 0 && d < HALL_R ? 'air' : 'plaster');
    else for (let y = FLOOR; y <= top; y++) set(x, y, z, 'air');
  });
  dome(bp, CANTINA.x, CANTINA.z, HALL_R + 0.5, 8, top + 1, 'plaster', 1);
  // Lamps round the foot of the dome inside.
  ring(bp, CANTINA.x, CANTINA.z, HALL_R - 1.5, top, top, (x, _y, z) => ((x * 7 + z) % 4 === 0 ? 'pad_amber' : undefined));
  // A lantern on top of the dome.
  disc(CANTINA.x, CANTINA.z, 1.5, (x, z) => fill(x, top + 8, z, x, top + 9, z, (_x, y) => (y === top + 9 ? slab('plaster') : 'pad_amber')));
  // The bar: a ring of counter round the pillar that holds the dome up, lit from underneath.
  ring(bp, CANTINA.x, CANTINA.z, 4.5, FLOOR, FLOOR, 'spruce_planks');
  ring(bp, CANTINA.x, CANTINA.z, 4.5, FLOOR + 1, FLOOR + 1, slab('spruce'));
  ring(bp, CANTINA.x, CANTINA.z, 3.5, FLOOR, FLOOR, (x, _y, z) => ((x + z) % 3 === 0 ? 'pad_amber' : undefined));
  disc(CANTINA.x, CANTINA.z, 1.5, (x, z) => fill(x, FLOOR, z, x, top + 7, z, (_x, y) => (y === FLOOR + 4 || y === top + 2 ? 'pad_amber' : (y - FLOOR) % 3 === 0 ? 'adobe' : 'plaster')));
  // Gaps in the bar to get behind it.
  fill(42, FLOOR, -26, 43, FLOOR + 1, -26, 'air');
  fill(42, FLOOR, -17, 43, FLOOR + 1, -17, 'air');
  // Booths round the wall between the doors: a bench each side of a table, a lamp over each.
  for (let a = 0; a < 12; a++) {
    const deg = a * 30 + 15;
    if ([0, 60, 90, 120, 180, 270].some((door) => Math.abs(((deg - door + 540) % 360) - 180) < 20)) continue;
    const t = (deg * Math.PI) / 180;
    const at = (r: number): [number, number] => [Math.floor(CANTINA.x + Math.cos(t) * r), Math.floor(CANTINA.z + Math.sin(t) * r)];
    const [tx, tz] = at(HALL_R - 2.6);
    set(tx, FLOOR, tz, 'pole');
    set(tx, FLOOR + 1, tz, slab('spruce'));
    const [bx, bz] = at(HALL_R - 1.6);
    set(bx, FLOOR, bz, slab('spruce'));
    const [lx, lz] = at(HALL_R - 1.1);
    set(lx, FLOOR + 3, lz, 'pad_amber');
  }
  // Six ways in: through the porch (south), either side of it, west, north and east.
  const doorAt = (angle: number, w: number) => {
    const t = (angle * Math.PI) / 180;
    for (let r = HALL_R - 2; r <= HALL_R + 1; r += 0.5)
      for (let k = -w / 2 + 0.5; k <= w / 2 - 0.5; k++) {
        const x = Math.floor(CANTINA.x + Math.cos(t) * r - Math.sin(t) * k);
        const z = Math.floor(CANTINA.z + Math.sin(t) * r + Math.cos(t) * k);
        for (let y = FLOOR; y < FLOOR + 3; y++) set(x, y, z, 'air');
        set(x, FLOOR + 3, z, dist(x, z, CANTINA.x, CANTINA.z) > HALL_R - 1 ? 'adobe' : 'plaster');
      }
  };
  for (const deg of [0, 60, 90, 120, 180, 270]) doorAt(deg, 3);
  // The porch: its own little dome, a door to the street and one to the hall, a sign over it.
  const [px0, pz0, px1, pz1] = PORCH;
  house(px0, pz0, px1, pz1, { h: 5, mat: 'adobe', hollow: true, doors: [{ side: 'south', at: 41, w: 3 }, { side: 'north', at: 41, w: 3 }], dome: 3, awning: 'awning_ochre' });
  // The sign: a dark board on the porch's roof, a glass in neon.
  const GLASS = ['X.X', '.X.', '.X.', 'XXX'];
  fill(px0 + 2, FLOOR + 5, pz1, px1 - 2, FLOOR + 9, pz1, 'durasteel_dark');
  sprite(bp, GLASS, { X: 'neon_yellow' }, (u, v) => ({ x: px0 + 2 + u, y: FLOOR + 5 + v, z: pz1 + 1 }));
  props.commandPost(bp, 46, FLOOR, -21, 'pad_blue', 2);
  for (const x of [34, 51]) props.lamp(bp, x, FLOOR, -8);
}

// ---------------------------------------------------------------------------------------------
// E: the Imperial garrison
// ---------------------------------------------------------------------------------------------

const GX0 = 70;
const GX1 = 103;
const GZ = 21;

function garrison() {
  // The floor: plates in a dark grid, grated walkways; the pad a disc of grates ringed in lights.
  for (let z = -GZ; z <= GZ; z++)
    for (let x = GX0 - 12; x <= GX1; x++) {
      const walk = Math.abs(z) <= 1 || x === GX0 + 6;
      set(x, G, z, x < GX0 ? ((x + z) % 5 === 0 ? 'floor_grate' : 'durasteel') : walk ? 'floor_grate' : (x & 3) === 0 || (z & 3) === 0 ? 'durasteel_dark' : 'durasteel');
    }
  disc(89.5, 0.5, 8.5, (x, z, d) => set(x, G, z, d > 7.6 ? ((x + z) % 2 ? 'imperial_light' : 'durasteel_dark') : d < 2 ? 'durasteel_dark' : 'floor_grate'));
  // The walls: eight high, two thick; a dark foot and cornice, dark pilasters down the outside
  // with a red strip light in each; a gate in each of the west, north and south walls.
  const gate = (x: number, z: number) => (x <= GX0 + 1 && Math.abs(z) <= 4) || (Math.abs(z) >= GZ - 1 && x >= 80 && x <= 84);
  for (let z = -GZ; z <= GZ; z++)
    for (let x = GX0; x <= GX1; x++) {
      const outer = x === GX0 || x === GX1 || Math.abs(z) === GZ;
      if (!outer && !(x === GX0 + 1 || x === GX1 - 1 || Math.abs(z) === GZ - 1)) continue;
      const along = x === GX0 || x === GX1 ? z : x;
      const pilaster = outer && ((along % 5) + 5) % 5 === 0;
      for (let y = FLOOR; y < FLOOR + 8; y++) {
        if (gate(x, z) && y < FLOOR + 5) {
          set(x, y, z, 'air');
          continue;
        }
        const base = y <= FLOOR + 1 || y === FLOOR + 7;
        set(x, y, z, pilaster && y === FLOOR + 4 ? 'imperial_red' : base || pilaster ? 'durasteel_dark' : 'durasteel');
      }
    }
  // The main gate's portal: a tall dark frame standing out from the wall, lights up its sides,
  // the blast door's lower edge hanging over the opening.
  fill(GX0 - 1, FLOOR, -7, GX0 - 1, FLOOR + 10, 7, (_x, y, z) => {
    if (Math.abs(z) <= 4 && y < FLOOR + 5) return 'air';
    if (Math.abs(z) === 5 && y >= FLOOR + 1 && y <= FLOOR + 6) return 'imperial_red';
    return y >= FLOOR + 9 && Math.abs(z) > 5 ? undefined : 'durasteel_dark';
  });
  fill(GX0, FLOOR + 5, -4, GX0 + 1, FLOOR + 5, 4, 'hull_dark');
  for (let x = GX0 - 1; x <= GX0 + 1; x++) for (let z = -4; z <= 4; z++) set(x, G, z, z % 2 ? 'hazard' : 'durasteel_dark');
  // Towers at the four corners, tapering at the top, a red band round them.
  for (const [cx, cz] of [[GX0 + 1, -GZ + 1], [GX0 + 1, GZ - 1], [GX1 - 1, -GZ + 1], [GX1 - 1, GZ - 1]])
    fill(cx - 3, FLOOR, cz - 3, cx + 3, FLOOR + 12, cz + 3, (x, y, z) => {
      const r = Math.max(Math.abs(x - cx), Math.abs(z - cz));
      if (y >= FLOOR + 11 && r === 3) return undefined;
      if (y === FLOOR + 12 && r === 2) return undefined;
      if (y === FLOOR + 9 && r === 3) return (x + z) % 2 ? 'imperial_red' : 'durasteel_dark';
      return y <= FLOOR + 1 || y >= FLOOR + 10 ? 'durasteel_dark' : 'durasteel';
    });
  // Barracks along the north and south walls: long, low, dark roofed, strip lights, doors toward the pad.
  for (const s of [-1, 1]) {
    const z0 = s < 0 ? -GZ + 2 : GZ - 8;
    const z1 = s < 0 ? -GZ + 8 : GZ - 2;
    fill(GX0 + 12, FLOOR, z0, GX1 - 5, FLOOR + 5, z1, (x, y, z) => {
      const edge = x === GX0 + 12 || x === GX1 - 5 || z === z0 || z === z1;
      if (!edge && y < FLOOR + 5) return 'air';
      if (y === FLOOR + 5 || y === FLOOR) return 'durasteel_dark';
      if (y === FLOOR + 3 && edge && x % 3 === 0) return 'imperial_light';
      return 'durasteel';
    });
    const zf = s < 0 ? z1 : z0;
    for (const x of [GX0 + 15, GX0 + 25]) fill(x, FLOOR, zf, x + 1, FLOOR + 2, zf, 'air');
    fill(GX0 + 12, FLOOR + 6, z0 + 1, GX1 - 5, FLOOR + 6, z1 - 1, (x) => (x % 4 === 0 ? 'durasteel_dark' : undefined));
  }
  // The shuttle on the pad, nose toward the gate; a fighter parked by the south barracks.
  ships.shuttle(at(90, 0), FLOOR);
  ships.tieFighter(at(78, 12), FLOOR);
  // Cover in the forecourt and the yard: cargo, barriers, guard booths either side of the gate.
  props.crates(bp, 62, FLOOR, -9, 2, 3, 2, 20);
  props.crates(bp, 64, FLOOR, 7, 3, 2, 2, 21);
  for (const s of [-1, 1]) {
    fill(GX0 - 4, FLOOR, s * 8 - 1, GX0 - 2, FLOOR + 3, s * 8 + 1, (x, y, z) => (y === FLOOR + 3 ? 'durasteel_dark' : y === FLOOR + 2 && x === GX0 - 4 && z === s * 8 ? 'cockpit' : 'durasteel'));
    fill(76, FLOOR, s * 5, 76, FLOOR + 1, s * 8, (_x, y) => (y === FLOOR ? 'durasteel_dark' : 'hull_dark'));
    fill(84, FLOOR, s * 11 - 1, 86, FLOOR + 1, s * 11 + 1, (x, y, z) => ((x + y + z) % 3 === 0 ? 'crate_metal' : 'durasteel_dark'));
  }
  props.banner(bp, GX0 - 2, FLOOR, -12, 'banner_imperial', 8);
  props.banner(bp, GX0 - 2, FLOOR, 9, 'banner_imperial', 8);
}

// ---------------------------------------------------------------------------------------------
// The town: streets laid out first, houses filling everything else
// ---------------------------------------------------------------------------------------------

/** A rectangle of columns: x0, z0, x1, z1 (inclusive). */
type Rect = [number, number, number, number];
/** Half a turn round the bay: the west's street is the east's. */
const turned = ([x0, z0, x1, z1]: Rect): Rect => [-x1, -z1, -x0, -z0];

/**
 * The west half's streets; the east half's are the same turned half round the bay (the main
 * street, the alleys, the squares north and south of the bay), except round the cantina, whose
 * ways in are its own.
 */
const WEST_STREETS: Rect[] = [
  [-70, -12, -58, 12], // the hangar's apron
  [-58, -4, -24, 4], // the main street
  [-88, -26, -81, -15], // from the hangar's north door
  [-88, -30, -12, -25], // the north alley
  [-65, -33, -56, -22], // round the hut in the north alley
  [-57, -14, -29, -12], // behind the row of roofs on the main street
  [-49, -11, -48, -5], // under the bridges between those roofs
  [-39, -11, -38, -5],
  [-45, -24, -44, -15], // from behind the row to the north alley
  [-68, -24, -66, -13], // from the apron to the north alley
  [-88, 15, -81, 45], // from the hangar's south door
  [-88, 40, -12, 45], // the south alley
  [-12, -44, 12, -28], // the square north of the bay
];
const MARKET_WAYS: Rect[] = [
  [-57, 5, -52, 8], // to the main street
  [-34, 5, -29, 8],
  [-28, 12, -20, 20], // to the ring road
  [-46, 36, -39, 40], // to the south alley
  [-80, 17, -58, 22], // west, to the hangar's south path
];
const CANTINA_WAYS: Rect[] = [
  [35, -9, 38, -5], // to the main street, from its two south doors
  [46, -9, 49, -5],
  [18, -24, 29, -12], // west, to the ring road
  [39, -40, 46, -36], // north, to the north alley
  [58, -23, 80, -17], // east, to the garrison's north path
];
const STREETS: Rect[] = [...WEST_STREETS, ...WEST_STREETS.map(turned), ...MARKET_WAYS, ...CANTINA_WAYS];

/** Open ground that isn't street: the market's square, the moisture farms. */
const OPEN: Rect[] = [
  [-57, 9, -28, 35],
  [-100, 46, -70, 57],
  [70, -57, 100, -46],
];

/** What each column of the town is: free to build on, a house, a street or square, something special, the canyon. */
const FREE = 0;
const HOUSE = 1;
const STREET = 2;
const SPECIAL = 3;
const ROCK = 4;
const MX0 = WEST - 10;
const MZ0 = NORTH - 12;
const MW = EAST - WEST + 21;
const MD = SOUTH - NORTH + 25;
const plan = new Uint8Array(MW * MD);
const cellOf = (x: number, z: number) => (x < MX0 || z < MZ0 || x >= MX0 + MW || z >= MZ0 + MD ? -1 : (z - MZ0) * MW + (x - MX0));
const kind = (x: number, z: number) => {
  const i = cellOf(x, z);
  return i < 0 ? ROCK : plan[i];
};
function mark(r: Rect, k: number, only = -1) {
  for (let z = r[1]; z <= r[3]; z++)
    for (let x = r[0]; x <= r[2]; x++) {
      const i = cellOf(x, z);
      if (i >= 0 && (only < 0 || plan[i] === only)) plan[i] = k;
    }
}

function layout() {
  for (let z = MZ0; z < MZ0 + MD; z++)
    for (let x = MX0; x < MX0 + MW; x++) {
      const out = Math.max(edgeN(x) - z, z - edgeS(x), edgeW(z) - x, x - edgeE(z));
      if (out > 0) plan[cellOf(x, z)] = ROCK;
      else if (dist(x, z, BAY.x, BAY.z) < ROAD_R + 1) plan[cellOf(x, z)] = STREET;
      else if (dist(x, z, CANTINA.x, CANTINA.z) < HALL_R + 4) plan[cellOf(x, z)] = STREET;
    }
  for (const r of STREETS) mark(r, STREET, FREE);
  for (const r of OPEN) mark(r, STREET, FREE);
  // The cantina's porch.
  mark(PORCH, SPECIAL);
  // The two bases, the rock round the hangar.
  mark([HX0, -HZ, HX1, HZ], SPECIAL);
  for (const [cx, cz, r] of OUTCROPS) disc(cx, cz, r, (x, z) => mark([x, z, x, z], SPECIAL, FREE));
  mark([GX0 - 1, -GZ - 1, GX1, GZ + 1], SPECIAL);
}

/** Reserve a hand-built house's footprint (and build it). */
function placed(x0: number, z0: number, x1: number, z1: number, o: HouseOpts) {
  const st = o.stairs;
  if (st) {
    // The stairs, and a block of street round them: no roof beside them to step across to.
    const lo = Math.min(st.at, st.at + st.dir * (o.h - 1)) - 1;
    const hi = Math.max(st.at, st.at + st.dir * (o.h - 1)) + 1;
    const r: Rect = st.side === 'north' ? [lo, z0 - 3, hi, z0 - 1] : st.side === 'south' ? [lo, z1 + 1, hi, z1 + 3] : st.side === 'west' ? [x0 - 3, lo, x0 - 1, hi] : [x1 + 1, lo, x1 + 3, hi];
    mark(r, STREET, FREE);
  }
  mark([x0, z0, x1, z1], SPECIAL);
  house(x0, z0, x1, z1, o);
}
function placedHut(cx: number, cz: number, r: number, h: number, o: Parameters<typeof hut>[4] = {}) {
  mark([Math.floor(cx - r - 1), Math.floor(cz - r - 1), Math.ceil(cx + r), Math.ceil(cz + r)], SPECIAL, FREE);
  hut(cx, cz, r, h, o);
}

const AWNINGS = ['awning_red', 'awning_blue', 'awning_ochre'];
const MATS = ['plaster', 'plaster_sand', 'adobe', 'plaster', 'plaster_sand'] as const;

/**
 * Fill every free column with houses: rectangles grown from the north-west corner of each free
 * patch, 6 to 12 across, of mixed heights and plasters, domed now and then; each with a painted
 * door (and often an awning) on its side to a street.
 */
function fillHouses() {
  for (let z = NORTH; z <= SOUTH; z++)
    for (let x = WEST; x <= EAST; x++) {
      if (kind(x, z) !== FREE) continue;
      const tw = 6 + Math.floor(hash(x, z, 50) * 7);
      const td = 6 + Math.floor(hash(x, z, 51) * 6);
      let w = 1;
      while (w < tw && kind(x + w, z) === FREE) w++;
      let d = 1;
      while (d < td) {
        let ok = true;
        for (let i = 0; i < w; i++) if (kind(x + i, z + d) !== FREE) ok = false;
        if (!ok) break;
        d++;
      }
      // A sliver left over by the next house: fold it into this one.
      if (d < td) {
        let more = 0;
        while (more < 2) {
          let ok = true;
          for (let i = 0; i < w; i++) if (kind(x + i, z + d + more) !== FREE) ok = false;
          if (!ok) break;
          more++;
        }
        const next = kind(x, z + d + more);
        if (more > 0 && more < 3 && next !== FREE) d += more;
      }
      const x1 = x + w - 1;
      const z1 = z + d - 1;
      mark([x, z, x1, z1], HOUSE);
      if (w < 3 || d < 3) {
        // Too narrow for a house: a stretch of wall between the ones beside it, as high as they
        // are (nobody climbs from it onto the roofs).
        box(bp, x, FLOOR, z, x1, FLOOR + 4 + Math.floor(hash(x, z, 52) * 2), z1, (_x, y) => (y === FLOOR ? 'plaster_grime' : hash(x, z, 53) < 0.5 ? 'adobe' : 'plaster_sand'));
        continue;
      }
      // Its door: on the side with the most street along it.
      const sides: [Facing, number, number][] = [];
      const count = (f: Facing) => {
        let n = 0;
        let first = 0;
        const len = f === 'north' || f === 'south' ? w : d;
        for (let i = 0; i < len; i++) {
          const [cx, cz] = f === 'north' ? [x + i, z - 1] : f === 'south' ? [x + i, z1 + 1] : f === 'west' ? [x - 1, z + i] : [x1 + 1, z + i];
          if (kind(cx, cz) === STREET) {
            if (!n) first = i;
            n++;
          }
        }
        sides.push([f, n, first]);
      };
      (['north', 'south', 'west', 'east'] as Facing[]).forEach(count);
      sides.sort((a, b) => b[1] - a[1]);
      const [side, n, first] = sides[0];
      const fake: Door[] = [];
      if (n >= 4) fake.push({ side, at: (side === 'north' || side === 'south' ? x : z) + first + Math.floor((n - 2) / 2) });
      const r = hash(x, z, 54);
      const small = Math.min(w, d);
      // Never under five high: nothing standing in the street (a crate, a speeder) gets anyone onto a roof.
      const h = 5 + Math.floor(hash(x, z, 55) * 2.6) + (small >= 8 && r < 0.2 ? 2 : 0);
      // Its roof: a dome, a barrel vault, an upper storey (domed, now and then), or flat with things on it.
      const style = small >= 6 && r > 0.62 ? 'dome' : small >= 5 && r > 0.38 && r <= 0.62 ? 'vault' : small >= 9 && r < 0.18 ? 'upper' : 'flat';
      house(x, z, x1, z1, {
        h,
        mat: MATS[Math.floor(hash(x, z, 56) * MATS.length)],
        dome: style === 'dome' || (style === 'upper' && r < 0.1) ? Math.min(5, Math.floor(small / 2) - 0.5) : 0,
        vault: style === 'vault',
        upper: style === 'upper' ? 2 + Math.floor(hash(x, z, 59) * 2) : 0,
        fake,
        awning: hash(x, z, 57) < 0.6 ? AWNINGS[Math.floor(hash(x, z, 58) * 3)] : undefined,
        vaporator: style === 'flat' && small >= 5 && hash(x, z, 60) < 0.3,
        parapet: style === 'flat' && hash(x, z, 61) < 0.3,
        clutter: style === 'flat' ? 1 + Math.floor(hash(x, z, 62) * 3) : 0,
      });
    }
}

/**
 * Fill the pockets: open ground walled in by houses, rock and each other that no street leads to
 * (a corner cut off a house, a gap by the rocks). A bot dropped into one could never walk out, so
 * they're built up as high as the houses round them.
 */
function fillPockets() {
  const open = (x: number, z: number) => {
    const k = kind(x, z);
    if (k === ROCK) return false;
    const a = bp.get(x, FLOOR, z);
    const b = bp.get(x, FLOOR + 1, z);
    const free = (v: BlockRef | undefined) => v === undefined || v === 'air' || (typeof v === 'string' && v.startsWith('awning'));
    return free(a) && free(b);
  };
  const seen = new Uint8Array(MW * MD);
  const queue: number[] = [];
  for (let z = NORTH; z <= SOUTH; z++)
    for (let x = WEST; x <= EAST; x++)
      if (kind(x, z) === STREET && open(x, z)) {
        seen[cellOf(x, z)] = 1;
        queue.push(x, z);
      }
  while (queue.length) {
    const z = queue.pop()!;
    const x = queue.pop()!;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const i = cellOf(x + dx, z + dz);
      if (i < 0 || seen[i] || !open(x + dx, z + dz)) continue;
      seen[i] = 1;
      queue.push(x + dx, z + dz);
    }
  }
  for (let z = NORTH; z <= SOUTH; z++)
    for (let x = WEST; x <= EAST; x++) if (!seen[cellOf(x, z)] && open(x, z) && kind(x, z) !== SPECIAL) box(bp, x, FLOOR, z, x, FLOOR + 4, z, (_x, y) => (y === FLOOR ? 'plaster_grime' : 'adobe'));
}

function town() {
  // The row of roofs along the main street, west: stairs up at either end, planks between.
  placed(-57, -11, -50, -5, { h: 6, mat: 'plaster', parapet: true, stairs: { side: 'west', at: -5, dir: -1 }, fake: [{ side: 'south', at: -55 }], awning: 'awning_red', gaps: [{ side: 'east', at: -10, w: 3 }] });
  placed(-47, -11, -40, -5, { h: 6, mat: 'plaster_sand', parapet: true, gaps: [{ side: 'west', at: -10, w: 3 }, { side: 'east', at: -10, w: 3 }], fake: [{ side: 'south', at: -44 }], awning: 'awning_blue', vaporator: true });
  placed(-37, -11, -30, -5, { h: 6, mat: 'plaster', parapet: true, stairs: { side: 'east', at: -5, dir: -1 }, gaps: [{ side: 'west', at: -10, w: 3 }], fake: [{ side: 'south', at: -34 }], awning: 'awning_ochre' });
  bridge(-49, -10, -48, -8, FLOOR + 6);
  bridge(-39, -10, -38, -8, FLOOR + 6);
  // Behind it: a domed house, and a hall with doors front and back (a way through to the north alley).
  placed(-57, -24, -46, -15, { h: 5, mat: 'adobe', dome: 4, fake: [{ side: 'south', at: -52 }], awning: 'awning_ochre' });
  placed(-43, -24, -30, -15, { h: 7, mat: 'plaster_sand', hollow: true, doors: [{ side: 'north', at: -38 }, { side: 'south', at: -38 }], dome: 4 });
  // The same on the east side, turned.
  placed(50, 5, 57, 11, { h: 6, mat: 'plaster', parapet: true, stairs: { side: 'east', at: 5, dir: 1 }, fake: [{ side: 'north', at: 54 }], awning: 'awning_red', gaps: [{ side: 'west', at: 8, w: 3 }] });
  placed(40, 5, 47, 11, { h: 6, mat: 'plaster_sand', parapet: true, gaps: [{ side: 'west', at: 8, w: 3 }, { side: 'east', at: 8, w: 3 }], fake: [{ side: 'north', at: 43 }], awning: 'awning_blue', vaporator: true });
  placed(30, 5, 37, 11, { h: 6, mat: 'plaster', parapet: true, stairs: { side: 'west', at: 5, dir: 1 }, gaps: [{ side: 'east', at: 8, w: 3 }], fake: [{ side: 'north', at: 33 }], awning: 'awning_ochre' });
  bridge(48, 8, 49, 10, FLOOR + 6);
  bridge(38, 8, 39, 10, FLOOR + 6);
  placed(46, 15, 57, 24, { h: 5, mat: 'adobe', dome: 4, fake: [{ side: 'north', at: 51 }], awning: 'awning_ochre' });
  placed(30, 15, 43, 24, { h: 7, mat: 'plaster_sand', hollow: true, doors: [{ side: 'north', at: 36 }, { side: 'south', at: 36 }], dome: 4 });
  // Landmarks: the port's control tower north of the bay, the office south of it, a tall hut in each farm's corner.
  placedHut(0.5, -51.5, 5, 14, { mat: 'plaster', bands: true, dome: 5 });
  placed(-7, 46, 8, 56, { h: 7, mat: 'plaster_sand', dome: 5, fake: [{ side: 'north', at: -1 }], awning: 'awning_blue' });
  placedHut(-62.5, 51.5, 5, 9, { mat: 'plaster', bands: true });
  placedHut(62.5, -51.5, 5, 9, { mat: 'plaster', bands: true });
  // Huts splitting the north alley west and the south alley east.
  placedHut(-60.5, -27.5, 3.2, 5, { mat: 'adobe' });
  placedHut(61.5, 28.5, 3.2, 5, { mat: 'adobe' });
  // The moisture farms.
  for (let x = -97; x <= -72; x += 5) for (let z = 49; z <= 55; z += 4) props.vaporator(bp, x + ((z >> 2) & 1) * 2, FLOOR, z, 6 + Math.floor(hash(x, z, 40) * 3));
  for (let x = 72; x <= 97; x += 5) for (let z = -55; z <= -49; z += 4) props.vaporator(bp, x + ((z >> 2) & 1) * 2, FLOOR, z, 6 + Math.floor(hash(x, z, 41) * 3));
  for (const s of [-1, 1]) for (let x = 70; x <= 100; x++) if (x % 7 !== 3) set(s * x, FLOOR, s * -46, 'adobe');
  fillHouses();
}

// ---------------------------------------------------------------------------------------------
// The streets' furniture: cover along the lanes, vaporators, lamps, speeders
// ---------------------------------------------------------------------------------------------

/**
 * Cloth strung across a lane, over head height, from the wall on one side to the one on the
 * other: along z at column x (from z0 to z1, the lane's width) or along x at row z. Only where
 * there's a wall to tie it to at both ends.
 */
function bunting(along: 'x' | 'z', at: number, from: number, to: number, k: number) {
  const y = FLOOR + 4;
  const cell = (i: number): [number, number] => (along === 'z' ? [at, i] : [i, at]);
  const solid = (i: number) => {
    const [x, z] = cell(i);
    const b = bp.get(x, y, z);
    return b !== undefined && b !== 'air' && !(typeof b === 'string' && b.startsWith('awning'));
  };
  let a = from;
  let b = to;
  while (a > from - 3 && !solid(a - 1)) a--;
  while (b < to + 3 && !solid(b + 1)) b++;
  if (!solid(a - 1) || !solid(b + 1)) return;
  for (let i = a; i <= b; i++) {
    const [x, z] = cell(i);
    set(x, y, z, AWNINGS[(((i + k) % 3) + 3) % 3]);
  }
}

/** A wall across part of a street, two high: cover, and a break in the view down it. */
function barrier(x0: number, z0: number, x1: number, z1: number) {
  fill(x0, FLOOR, z0, x1, FLOOR + 1, z1, (x, y, z) => (y === FLOOR ? 'plaster_grime' : (x + z) % 4 === 0 ? 'adobe_window' : 'adobe'));
}

function streets() {
  // The main streets: walls across alternate halves (nobody sees from one end to the other), a
  // parked speeder, crates, a vaporator.
  barrier(-52, -4, -51, 0);
  barrier(-41, 0, -40, 4);
  barrier(51, 0, 52, 4);
  barrier(33, -4, 34, 0);
  props.landspeeder(at(-47, 1), 0, FLOOR, 0, 'light_blue_concrete');
  props.crates(bp, -56, FLOOR, 1, 2, 2, 2, 30);
  props.vaporator(bp, -34, FLOOR, -2, 7);
  props.drums(bp, -30, FLOOR, 2, 3, 31);
  props.crashedSpeeder(at(60, -1, 2), 0, FLOOR, 0, 'red_concrete');
  props.crates(bp, 44, FLOOR, 1, 2, 2, 2, 32);
  props.vaporator(bp, 34, FLOOR, 2, 7);
  props.drums(bp, 29, FLOOR, -3, 3, 33);
  // The alleys: the same, turned.
  barrier(-77, -28, -76, -25);
  barrier(-47, -30, -46, -27);
  barrier(76, 25, 77, 28);
  barrier(46, 27, 47, 30);
  barrier(-70, 40, -69, 42);
  barrier(-37, 43, -36, 45);
  barrier(69, -42, 70, -40);
  barrier(36, -45, 37, -43);
  barrier(-26, -28, -25, -25);
  barrier(25, 25, 26, 28);
  barrier(-22, 40, -21, 42);
  barrier(21, -42, 22, -40);
  // The north alley west and the south alley east: huts to split them, crates, vaporators.
  props.crates(bp, -80, FLOOR, -29, 2, 2, 2, 34);
  props.vaporator(bp, -45, FLOOR, -27, 6);
  props.drums(bp, -30, FLOOR, -29, 3, 35);
  props.crates(bp, 78, FLOOR, 27, 2, 2, 2, 36);
  props.vaporator(bp, 45, FLOOR, 27, 6);
  props.drums(bp, 29, FLOOR, 27, 3, 37);
  // The south alley west and the north alley east.
  props.crates(bp, -70, FLOOR, 42, 2, 2, 2, 38);
  props.landspeeder(at(-52, 41), 0, FLOOR, 0, 'yellow_concrete');
  props.drums(bp, -30, FLOOR, 43, 3, 39);
  props.crates(bp, 68, FLOOR, -43, 2, 2, 2, 40);
  props.landspeeder(at(51, -44, 2), 0, FLOOR, 0, 'white_concrete');
  props.drums(bp, 29, FLOOR, -43, 3, 41);
  // Cloth strung across the alleys (and their half-turned twins).
  for (const x of [-84, -71, -52, -36, -18]) {
    bunting('z', x, -30, -25, x);
    bunting('z', -x, 25, 30, x);
  }
  for (const x of [-76, -58, -30]) {
    bunting('z', x, 40, 45, x);
    bunting('z', -x, -45, -40, x);
  }
  for (const x of [-53, -43, -34]) {
    bunting('z', x, -14, -12, x);
    bunting('z', -x, 12, 14, x);
  }
  // The squares north and south of the bay: a water tank on stilts, a speeder, cargo.
  props.waterTank(bp, -8, FLOOR, -39);
  props.landspeeder(at(5, -38, 1), 0, FLOOR, 0, 'orange_concrete');
  props.crates(bp, -3, FLOOR, -34, 2, 2, 2, 42);
  props.drums(bp, 9, FLOOR, -43, 3, 43);
  props.waterTank(bp, 6, FLOOR, 37);
  props.landspeeder(at(-5, 38, 3), 0, FLOOR, 0, 'cyan_concrete');
  props.crates(bp, 2, FLOOR, 33, 2, 2, 2, 44);
  props.drums(bp, -10, FLOOR, 42, 3, 45);
  // Along the ring road, between the gates: lamps, and cargo against the outer edge to fight from.
  for (let a = 0; a < 12; a++) {
    const t = (a / 12) * Math.PI * 2 + 0.26;
    props.lamp(bp, Math.floor(BAY.x + Math.cos(t) * (ROAD_R - 0.5)), FLOOR, Math.floor(BAY.z + Math.sin(t) * (ROAD_R - 0.5)));
  }
  GATES.forEach((deg, i) => {
    const t = ((deg + 30) * Math.PI) / 180;
    const x = Math.floor(BAY.x + Math.cos(t) * (ROAD_R - 2));
    const z = Math.floor(BAY.z + Math.sin(t) * (ROAD_R - 2));
    if (i % 2) props.crates(bp, x, FLOOR, z, 2, 2, 2, 50 + i);
    else props.drums(bp, x, FLOOR, z, 4, 50 + i);
  });
}

// ---------------------------------------------------------------------------------------------
// The backdrop: a wreck in the dunes, mesas round the canyon
// ---------------------------------------------------------------------------------------------

/**
 * Out in the dunes south of the canyon, the wreck of a Star Demolisher lying across the horizon on
 * its side, its decks and bridge tower toward the town, its nose buried in the west and its stern
 * reared up in the east: the town's landmark from anywhere.
 */
function backdrop(): Blueprint {
  const len = 150;
  const ox = -78;
  const oz = 106;
  const w = new Blueprint({ x: ox - 4, y: FLOOR - 8, z: oz - 36 }, { x: len + 10, y: 60, z: 62 });
  ships.wreck(new Place(w, ox, oz, 0), FLOOR, len);
  return w;
}

const TERRAFORM: Terraform[] = [
  // North: tall mesas behind the cliff.
  { x: -80, z: -100, radius: 26, blend: 10, height: FLOOR + 26 },
  { x: -20, z: -108, radius: 30, blend: 12, height: FLOOR + 30 },
  { x: 45, z: -98, radius: 22, blend: 9, height: FLOOR + 22 },
  { x: 110, z: -105, radius: 28, blend: 12, height: FLOOR + 28 },
  // West, behind the hangar.
  { x: -150, z: -30, radius: 26, blend: 10, height: FLOOR + 24 },
  { x: -148, z: 40, radius: 24, blend: 12, height: FLOOR + 20 },
  // East, behind the garrison.
  { x: 150, z: 30, radius: 24, blend: 12, height: FLOOR + 18 },
  { x: 148, z: -45, radius: 26, blend: 10, height: FLOOR + 22 },
  // South: the dunes, rolling off toward the wreck, and heaped round it.
  { x: -70, z: 95, radius: 14, blend: 30, height: FLOOR + 10 },
  { x: -130, z: 130, radius: 20, blend: 34, height: FLOOR + 14 },
  { x: -60, z: 100, radius: 12, blend: 26, height: FLOOR + 6 },
  { x: 0, z: 118, radius: 12, blend: 26, height: FLOOR + 7 },
  { x: 60, z: 112, radius: 10, blend: 24, height: FLOOR + 5 },
  { x: 110, z: 95, radius: 12, blend: 30, height: FLOOR + 9 },
];

// ---------------------------------------------------------------------------------------------
// The posts
// ---------------------------------------------------------------------------------------------

function posts() {
  // The bases' markers: a console in a ring of lights.
  props.commandPost(bp, -81, FLOOR, 0, 'pad_amber', 2);
  props.commandPost(bp, 80, FLOOR, 0, 'imperial_red', 2);
}

function build(): Blueprint {
  layout();
  ground();
  canyon();
  town();
  hangar();
  market();
  bay();
  cantina();
  garrison();
  streets();
  posts();
  fillPockets();
  return bp;
}


const TOWN = build();

/** Whether a blueprint cell is clear for a body: nothing written there (the void's air), air, or cloth overhead. */
const clear = (x: number, y: number, z: number) => {
  const b = bp.get(x, y, z);
  return b === undefined || b === 'air' || (typeof b === 'string' && b.startsWith('awning'));
};
/** Whether a body stands on something at (x, y, z): the ground under the town, or a block. */
const footing = (x: number, y: number, z: number) => {
  const b = bp.get(x, y - 1, z);
  if (b === undefined) return y - 1 <= G;
  return b !== 'air' && !(typeof b === 'string' && (b.startsWith('awning') || b.startsWith('ladder')));
};

/**
 * A spawn point near (x, y, z), facing (tx, tz): the nearest column (spiralling out a few blocks)
 * with two clear blocks for a body and something under its feet, so a change to what's built
 * round it can't leave anyone spawning in a wall.
 */
function s(x: number, y: number, z: number, tx: number, tz: number): SpawnPoint {
  for (let r = 0; r <= 4; r++)
    for (let dz = -r; dz <= r; dz++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const cx = x + dx;
        const cz = z + dz;
        if (footing(cx, y, cz) && clear(cx, y, cz) && clear(cx, y + 1, cz)) return spawnAt(cx, y, cz, tx, tz);
      }
  throw new Error(`spaceport: no room for a spawn near (${x}, ${y}, ${z})`);
}

/** A spawn round the bay, `r` out at `deg` round from east, facing its middle. */
const bayAt = (r: number, deg: number, y: number) => s(Math.floor(BAY.x + Math.cos((deg * Math.PI) / 180) * r), y, Math.floor(BAY.z + Math.sin((deg * Math.PI) / 180) * r), BAY.x, BAY.z);

const POSTS: PostSpec[] = [
  {
    id: 'A',
    name: 'the Rebel hangar',
    at: { x: -80.5, y: FLOOR, z: 0.5 },
    radius: 8,
    owner: 0,
    locked: true,
    spawns: [
      s(-94, FLOOR, -11, -80, 0),
      s(-94, FLOOR, 11, -80, 0),
      s(-90, FLOOR, -2, -80, 0),
      s(-90, FLOOR, 3, -80, 0),
      s(-83, FLOOR, -11, -70, 0),
      s(-80, FLOOR, 11, -70, 0),
      s(-98, FLOOR + 4, -6, -80, 0),
      s(-98, FLOOR + 4, 6, -80, 0),
      s(-98, FLOOR + 4, 0, -80, 0),
      s(-77, FLOOR, -5, -60, 0),
    ],
  },
  {
    id: 'B',
    name: 'the market',
    at: { x: MARKET.x, y: FLOOR, z: MARKET.z },
    radius: 8,
    owner: 0,
    spawns: [
      s(-54, FLOOR, 14, MARKET.x, MARKET.z),
      s(-54, FLOOR, 33, MARKET.x, MARKET.z),
      s(-30, FLOOR, 12, MARKET.x, MARKET.z),
      s(-30, FLOOR, 25, MARKET.x, MARKET.z),
      s(-42, FLOOR, 34, MARKET.x, MARKET.z),
      s(-58, FLOOR, 20, MARKET.x, MARKET.z),
      s(-53, FLOOR, 6, MARKET.x, MARKET.z),
      s(-33, FLOOR, 6, MARKET.x, MARKET.z),
      s(-43, FLOOR, 41, MARKET.x, MARKET.z),
    ],
  },
  {
    id: 'C',
    name: 'the docking bay',
    at: { x: 0.5, y: PIT, z: 9.5 },
    radius: 8,
    height: 6,
    owner: null,
    // On the ring road outside the wall (in through the gates), on the ledge, two down in the pit.
    spawns: [
      ...[0, 90, 180, 270, 165, 345].map((a) => bayAt(ROAD_R - 3, a, FLOOR)),
      ...[60, 150, 240, 330].map((a) => bayAt(LEDGE_R - 1, a, FLOOR)),
      s(-13, PIT, 13, 0, 9),
      s(13, PIT, 13, 0, 9),
    ],
  },
  {
    id: 'D',
    name: 'the cantina',
    at: { x: CANTINA.x, y: FLOOR, z: CANTINA.z },
    radius: 8,
    height: 6,
    owner: 1,
    spawns: [
      s(34, FLOOR, -26, CANTINA.x, CANTINA.z),
      s(34, FLOOR, -17, CANTINA.x, CANTINA.z),
      s(51, FLOOR, -26, CANTINA.x, CANTINA.z),
      s(51, FLOOR, -17, CANTINA.x, CANTINA.z),
      s(38, FLOOR, -30, CANTINA.x, CANTINA.z),
      s(47, FLOOR, -30, CANTINA.x, CANTINA.z),
      s(38, FLOOR, -13, CANTINA.x, CANTINA.z),
      s(47, FLOOR, -13, CANTINA.x, CANTINA.z),
      s(58, FLOOR, -21, CANTINA.x, CANTINA.z),
    ],
  },
  {
    id: 'E',
    name: 'the Imperial garrison',
    at: { x: 80.5, y: FLOOR, z: 0.5 },
    radius: 8,
    owner: 1,
    locked: true,
    spawns: [
      s(98, FLOOR, -11, 80, 0),
      s(98, FLOOR, 11, 80, 0),
      s(95, FLOOR, -5, 80, 0),
      s(95, FLOOR, 6, 80, 0),
      s(88, FLOOR, -16, 80, 0),
      s(88, FLOOR, 16, 80, 0),
      s(76, FLOOR, -12, 60, 0),
      s(76, FLOOR, 13, 60, 0),
      s(100, FLOOR, 0, 80, 0),
      s(84, FLOOR, -9, 60, 0),
    ],
  },
];

export const SPACEPORT: MapSpec = {
  id: 'spaceport',
  name: 'Mos Blockley Spaceport',
  blurb: 'A desert spaceport: take the market, the docking bay and the cantina',
  floorY: FLOOR,
  time: 0.7,
  ground: { top: 'sand', fill: 'sandstone' },
  structures: [TOWN, backdrop()],
  terraform: TERRAFORM,
  bounds: { min: { x: WEST, y: PIT - 1, z: NORTH }, max: { x: EAST, y: FLOOR + 12, z: SOUTH } },
  posts: POSTS,
  // Over the square north of the bay (the home page's camera circles here), first looking south
  // across the bay to the wreck beyond the canyon.
  home: spawnAt(-2, FLOOR + 22, -36, 0, 20),
  overview: { position: { x: 20, y: FLOOR + 55, z: -80 }, target: { x: -5, y: FLOOR, z: 10 } },
  // The opening fly-over (cinema.ts): high over the Rebel hangar, low over the market's stalls, down
  // over the docking bay, past the cantina, up over the Imperial garrison.
  intro: [
    { at: { x: -118, y: FLOOR + 46, z: 62 }, look: { x: -64, y: FLOOR, z: 0 } },
    { at: { x: -70, y: FLOOR + 24, z: 48 }, look: { x: -42, y: FLOOR, z: 18 } },
    { at: { x: -14, y: FLOOR + 20, z: 40 }, look: { x: 2, y: PIT, z: 6 } },
    { at: { x: 28, y: FLOOR + 22, z: 16 }, look: { x: 44, y: FLOOR, z: -24 } },
    { at: { x: 104, y: FLOOR + 34, z: 36 }, look: { x: 78, y: FLOOR + 2, z: 0 } },
  ],
  hotspots: [...POSTS.map((p) => ({ ...p.at })), { x: -44, y: FLOOR, z: 0 }, { x: 44, y: FLOOR, z: 0 }, { x: 0, y: FLOOR, z: -36 }, { x: 0, y: FLOOR, z: 36 }],
};
