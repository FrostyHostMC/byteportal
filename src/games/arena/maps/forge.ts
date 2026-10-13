import { Blueprint, type BlockRef, type Vec3 } from '@platform';
import { box, faceTo, hash, wallTorch, yawTo } from './kit';
import { banner, parts, type BannerDesign, type Model } from './models';
import { FLOOR, type ArenaMap, type Box, type Decor, type Fire, type Gate, type Hazard, type Portcullis, type TrapSpec } from './registry';

/**
 * The Forge: the old smiths' forge in the caldera of a volcano. Basalt cliffs ring a floor of
 * cinder cut by a river of lava (bridges over it, the Drop Hammer over the eastern one); the
 * great forge hall stands built into the cliff at the north, its furnace mouth roaring over a
 * terrace (the Bellows breathe fire across it) and its side doors letting out what's penned
 * inside; a lava cistern to the west can be let down a channel across the western approach (the
 * Sluice). Mine tunnels in the cliffs, a loading dock to the east, slag heaps and lava pockets to
 * the south; lavafalls down the cliffs, chimneys smoking.
 */

/** Its middle block: everything below is laid out round it (local x, z), at (OX, OZ) in the world. */
const OX = 0;
const OZ = 512;
const C = { x: OX + 0.5, z: OZ + 0.5 };
/** The caldera's reach: its cliffs out to here, its ground ring further. */
const RIM = 62;
const GROUND = 82;
const TOP = FLOOR + 32;

/** The mine-tunnel gates in the cliffs: west, east, south-west, south-east (radians, 0 toward +x, a quarter turn toward +z). */
const TUNNELS = [Math.PI, 0, 2.2, 0.94];
/** Where a tunnel's gatehouse stands out from the cliff, where its monsters come in, how deep it goes. */
const HOUSE = 25.5;
const PEN = 30;
const DEEP = 35;

/** The forge hall: across x, from its facade (z) back into the cliff; its floor raised to the terrace's. */
const HALL = { x0: -13, x1: 13, front: -22, back: -34, roof: FLOOR + 13 };
const TERRACE = { x0: -12, x1: 12, z0: -21, z1: -15, top: FLOOR + 2 };
/** The hall's side doors (x), out of the pens behind them onto the terrace. */
const DOORS = [-9, 9];

/** The lava river's middle (z) at x, and its cells' reach either side. */
const riverZ = (x: number) => 14 + 2 * Math.sin((x + 6) * 0.12);
const riverCells = (x: number) => {
  const c = Math.round(riverZ(x));
  return { z0: c - 1, z1: c + 2 };
};
/** The bridges over it: x from..to (the deck; parapets either side). */
const BRIDGES = [
  { x0: -13, x1: -9 },
  { x0: 8, x1: 12 },
];
/** The cistern of lava by the hall, and the dry channel the Sluice floods (x, from z to z). */
const CISTERN = { x0: -19, x1: -14, z0: -15, z1: -11 };
const CHANNEL = { x0: -17, x1: -16, z0: -10, z1: 8 };
/** The loading dock to the east, a block high. */
const DOCK = { x0: 17, x1: 24, z0: -11, z1: -3 };
/** Pockets of lava in the slag field (corners, 2 deep). */
const POCKETS = [
  { x0: 3, x1: 5, z0: 21, z1: 22 },
  { x0: -9, x1: -7, z0: 25, z1: 26 },
  { x0: 20, x1: 21, z0: 18, z1: 20 },
];
/** Basalt obelisks to fight round, veined with magma, capped in bronze (their corner: 2 by 2). */
const OBELISKS = [
  [-14, -5],
  [14, 6],
  [-7, 9],
  [11, -10],
];
/** Slag heaps: middle, radius. */
const HEAPS = [
  { x: -6, z: 24, r: 3.6 },
  { x: 9, z: 27, r: 3 },
  { x: -22, z: 20, r: 2.6 },
  { x: 25, z: 5, r: 3 },
  { x: -25, z: -12, r: 3 },
  { x: 17, z: -17, r: 2.8 },
];

const at = (x: number, y: number, z: number): Vec3 => ({ x: OX + x, y, z: OZ + z });

/** Where the cliffs begin (local radius) at angle `a`: wandering, pulled in at the tunnels so their gatehouses meet the rock. */
function edge(a: number): number {
  let r = 33 + 2 * Math.sin(3 * a + 1.3) + 1.3 * Math.sin(7 * a + 0.4) + 0.7 * Math.sin(13 * a);
  for (const t of TUNNELS) {
    const d = Math.abs(Math.atan2(Math.sin(a - t), Math.cos(a - t)));
    if (d < 0.22) r = Math.min(r, 30.5);
  }
  return r;
}

/** How high the cliffs stand at angle `a` (blocks over the floor), peaks and saddles. */
const peak = (a: number) => 20 + 5 * Math.sin(2 * a + 0.7) + 3 * Math.sin(5 * a + 2) + 1.5 * Math.sin(11 * a);

function build(): Blueprint {
  const bp = Blueprint.centered(OX, OZ, RIM, FLOOR - 3, TOP);
  const set = (x: number, y: number, z: number, b: BlockRef) => bp.set(OX + x, y, OZ + z, b);
  /** Each column's top (local, by key): the cliffs' and the floor's, for the lavafalls. */
  const tops = new Map<string, number>();

  // The caldera: the floor of cinder, and the cliffs round it, banded, veined with magma.
  bp.columns(OX, OZ, RIM, (wx, wz, d, a) => {
    const x = wx - OX;
    const z = wz - OZ;
    const e = edge(a);
    if (d < e) {
      for (let y = FLOOR - 3; y < FLOOR; y++) set(x, y, z, 'basalt');
      const r = hash(x, z, 1);
      const patch = hash(x >> 2, z >> 2, 2);
      // Cracks through the cinder glowing from below, and the odd ember.
      const crack = Math.abs(Math.sin(x * 0.37 + 1.7 * Math.sin(z * 0.23)) + Math.sin(z * 0.29 + 1.3 * Math.sin(x * 0.19))) < 0.035;
      set(x, FLOOR, z, crack || r < 0.006 ? 'magma' : patch > 0.78 ? 'basalt' : r < 0.12 ? 'basalt' : 'cinder');
      tops.set(`${x},${z}`, FLOOR);
      return;
    }
    const rise = d - e;
    const outer = Math.max(0, Math.min(1, (RIM - d) / 9));
    const h = Math.round(Math.min(peak(a) + hash(x, z, 3) * 1.6, 4 + rise * 2.6) * outer);
    const top = FLOOR + Math.max(0, h);
    tops.set(`${x},${z}`, top);
    // Strata: basalt in thick beds, rusty scoria between them, seams of deepslate and obsidian.
    const band = Math.floor(hash(x >> 3, z >> 3, 4) * 4);
    for (let y = FLOOR - 3; y <= top; y++) {
      let b: BlockRef = 'basalt';
      const k = (y + band + Math.round(Math.sin((x + z) * 0.08) * 2)) % 9;
      if (y === top) b = h > 1 && hash(x, z, 5) < 0.6 ? 'cinder' : 'scoria';
      else if (hash(x * 7 + y, z * 3 - y, 6) < 0.02) b = 'magma';
      else if (k === 0 || k === 1) b = 'scoria';
      else if (k === 4) b = 'deepslate';
      else if (k === 6 && hash(x, z, 7) < 0.6) b = 'obsidian';
      set(x, y, z, b);
    }
  });

  paths(set);
  river(set, tops);
  plaza(set);
  cistern(set);
  forgeHall(set);
  dock(set);
  slag(set);
  for (const a of TUNNELS) tunnel(set, a);
  gantry(set);
  lavafalls(set, tops);
  braziers(set);
  return bp;
}

type Set = (x: number, y: number, z: number, b: BlockRef) => void;

/** Basalt flagstone ways across the cinder: the gates and the bridges to the plaza, the plaza to the terrace. */
function paths(set: Set) {
  const way = (x0: number, z0: number, x1: number, z1: number, half: number) => {
    const n = Math.ceil(Math.hypot(x1 - x0, z1 - z0) * 2);
    for (let i = 0; i <= n; i++) {
      const cx = x0 + ((x1 - x0) * i) / n;
      const cz = z0 + ((z1 - z0) * i) / n;
      for (let x = Math.floor(cx - half); x <= Math.ceil(cx + half); x++)
        for (let z = Math.floor(cz - half); z <= Math.ceil(cz + half); z++) {
          if (Math.hypot(x - cx, z - cz) > half + 0.2) continue;
          set(x, FLOOR, z, hash(x, z, 20) < 0.12 ? 'cinder' : 'basalt_bricks');
        }
    }
  };
  way(0, -7, 0, -11, 3);
  way(-5, 4, -11, 10, 1.6);
  way(5, 4, 10, 10, 1.6);
  way(-28, 0, -6, 0, 1.2);
  way(28, 0, 6, 0, 1.2);
  way(-11, 19, -15, 22, 1.4);
  way(10, 19, 15, 22, 1.4);
}

/** The plaza in the middle: basalt flags in a ring of magma, an anvil inlaid in iron at its heart. */
function plaza(set: Set) {
  for (let x = -7; x <= 7; x++)
    for (let z = -7; z <= 7; z++) {
      const d = Math.hypot(x, z);
      if (d > 6.6) continue;
      let b: BlockRef = (x + z) % 2 ? 'basalt_bricks' : 'basalt';
      if (d > 5.5) b = 'magma';
      else if (d > 4.8) b = 'basalt_bricks';
      // The anvil: a horn to the west, a broad face, a waist, a foot.
      if ((z === -1 && x >= -3 && x <= 2) || (z === 0 && x >= -1 && x <= 1) || (z === 1 && x >= -2 && x <= 2) || (z === -1 && x === -4)) b = 'gilt';
      set(x, FLOOR, z, b);
    }
}

/**
 * The lava river: in from a lavafall on the west cliff, out through a cave in the east one, up to
 * the floor and two deep (whatever's knocked in can't climb out: a fighter swims up and steps
 * out), its banks crusted dark and glowing; the bridges over it flush with the floor, parapets
 * either side.
 */
function river(set: Set, tops: Map<string, number>) {
  for (let x = -46; x <= 46; x++) {
    const { z0, z1 } = riverCells(x);
    for (let z = z0; z <= z1; z++) {
      set(x, FLOOR - 2, z, 'basalt');
      set(x, FLOOR - 1, z, 'lava');
      set(x, FLOOR, z, 'lava');
      // Through the cliffs at either end: a slot in the rock, open over the lava.
      const top = tops.get(`${x},${z}`) ?? FLOOR;
      for (let y = FLOOR + 1; y <= Math.min(top, FLOOR + (Math.abs(x) > 30 ? 3 : 0)); y++) set(x, y, z, 'air');
    }
    // The banks: crust here and there.
    for (const z of [z0 - 1, z1 + 1]) if ((tops.get(`${x},${z}`) ?? FLOOR) === FLOOR && hash(x, z, 21) < 0.45) set(x, FLOOR, z, hash(x, z, 22) < 0.35 ? 'magma' : 'deepslate');
  }
  // The cave the river runs out into, east: a mouth in the cliff, glowing round its rim.
  for (let x = 30; x <= 40; x++) {
    const { z0, z1 } = riverCells(x);
    for (let z = z0 - 1; z <= z1 + 1; z++) {
      for (let y = FLOOR; y <= FLOOR + 4; y++) {
        if (y === FLOOR && z >= z0 && z <= z1) continue;
        const rim = z === z0 - 1 || z === z1 + 1 || y === FLOOR + 4;
        if ((tops.get(`${x},${z}`) ?? FLOOR) > y) set(x, y, z, rim ? (hash(x, y + z, 23) < 0.35 ? 'magma' : 'basalt') : 'air');
      }
    }
  }
  for (const b of BRIDGES) {
    const e = bridgeEnds(b);
    // Flush with the floor (nothing to step up onto: nothing to fall off), parapets either side,
    // posts at the corners and every other block.
    for (let x = b.x0 - 1; x <= b.x1 + 1; x++)
      for (let z = e.lo; z <= e.hi; z++) {
        const side = x === b.x0 - 1 || x === b.x1 + 1;
        const end = z === e.lo || z === e.hi;
        set(x, FLOOR, z, side ? 'basalt_bricks' : (x + z) % 3 ? 'basalt_bricks' : 'basalt');
        if (!side) continue;
        const post = end || z === e.lo + 1 || z === e.hi - 1;
        set(x, FLOOR + 1, z, post || z % 2 === 0 ? 'basalt_bricks' : 'basalt_slab');
        if (post) set(x, FLOOR + 2, z, 'bronze');
      }
  }
}

/** The cistern of lava, walled, by the hall's west end; its iron sluice gate; the dry channel south from it. */
function cistern(set: Set) {
  const c = CISTERN;
  for (let x = c.x0; x <= c.x1; x++)
    for (let z = c.z0; z <= c.z1; z++) {
      const wall = x === c.x0 || x === c.x1 || z === c.z0 || z === c.z1;
      set(x, FLOOR, z, 'basalt');
      if (wall) {
        set(x, FLOOR + 1, z, 'basalt_bricks');
        set(x, FLOOR + 2, z, 'basalt_slab');
      } else {
        set(x, FLOOR + 1, z, 'lava');
        set(x, FLOOR + 2, z, 'lava');
      }
    }
  // The sluice gate: iron in the cistern's south wall over the channel's head.
  for (let x = CHANNEL.x0; x <= CHANNEL.x1; x++) {
    set(x, FLOOR + 1, c.z1, 'bronze');
    set(x, FLOOR + 2, c.z1, 'bronze');
    set(x, FLOOR + 3, c.z1, 'deepslate');
  }
  // The channel: a block deep, lined in brick, its rims edged.
  const k = CHANNEL;
  for (let z = k.z0; z <= k.z1; z++) {
    for (let x = k.x0; x <= k.x1; x++) {
      set(x, FLOOR - 1, z, 'basalt_bricks');
      set(x, FLOOR, z, 'air');
    }
    set(k.x0 - 1, FLOOR, z, 'basalt_bricks');
    set(k.x1 + 1, FLOOR, z, 'basalt_bricks');
  }
  // Its foot: a grate of iron short of the river (the lava stops there).
  for (let x = k.x0 - 1; x <= k.x1 + 1; x++) set(x, FLOOR, k.z1 + 1, 'basalt_bricks');
}

/**
 * The great forge hall, cut into the cliff: its facade with the furnace mouth (a sill, lava
 * behind it, a fire that never goes out) and two doors from the pens inside; the terrace before it
 * with a balustrade and stairs down the middle; a roof to watch from, two chimneys.
 */
function forgeHall(set: Set) {
  const h = HALL;
  // Clear the cliff where it stands, and over its roof.
  for (let x = h.x0 - 1; x <= h.x1 + 1; x++)
    for (let z = h.back; z <= h.front + 1; z++) for (let y = FLOOR + 1; y <= TOP; y++) set(x, y, z, 'air');
  for (let x = h.x0; x <= h.x1; x++)
    for (let z = h.back; z <= h.front; z++) {
      const wall = x === h.x0 || x === h.x1 || z === h.back || z === h.front;
      for (let y = FLOOR; y <= h.roof; y++) {
        let b: BlockRef | 'air' = 'air';
        if (wall) b = y === FLOOR + 11 ? 'bronze' : y % 5 === 0 && z !== h.front ? 'deepslate' : 'basalt_bricks';
        else if (y <= FLOOR + 2 || y === h.roof) b = 'basalt_bricks';
        set(x, y, z, b);
      }
      // The roof's parapet, front and sides.
      if ((z === h.front || x === h.x0 || x === h.x1) && (x + z) % 2 === 0) set(x, h.roof + 1, z, 'basalt_bricks');
    }
  // The facade's pilasters at its corners: magma seams glowing between dark bricks; the smith-kings' plinths.
  for (const x of [-12, 12]) for (let y = FLOOR + 3; y <= FLOOR + 10; y++) set(x, y, h.front + 1, y % 3 === 0 ? 'magma' : 'basalt_bricks');
  for (const x of [-7, -6, 6, 7]) set(x, FLOOR + 3, h.front + 1, 'basalt_bricks');
  // Inside: the furnace chamber in the middle (lava behind a sill, glowing walls), the pens either side.
  for (let z = h.back + 1; z < h.front; z++) {
    for (const x of [-6, 6]) for (let y = FLOOR + 1; y < h.roof; y++) set(x, y, z, 'basalt_bricks');
    for (let x = -5; x <= 5; x++) {
      set(x, FLOOR, z, 'basalt');
      set(x, FLOOR + 1, z, 'lava');
      set(x, FLOOR + 2, z, 'lava');
      for (let y = FLOOR + 3; y < h.roof; y++) set(x, y, z, z === h.back + 1 || Math.abs(x) === 5 ? (hash(x, y + z, 30) < 0.5 ? 'magma' : 'bricks') : 'air');
    }
  }
  // The furnace mouth: an arch over the sill, iron round it, an iron grate across it (the fire
  // shows through; nobody climbs in, where the lava's too deep to climb back out of).
  for (let x = -5; x <= 5; x++)
    for (let y = FLOOR + 3; y <= FLOOR + 11; y++) {
      const open = Math.abs(x) <= 4 && y >= FLOOR + 4 && (y <= FLOOR + 8 || (y === FLOOR + 9 && Math.abs(x) <= 3) || (y === FLOOR + 10 && Math.abs(x) <= 1));
      const frame = !open && (Math.abs(x) === 5 || y === FLOOR + 3 || y >= FLOOR + 9);
      if (open) set(x, y, h.front, 'arena_grate');
      else if (frame && y <= FLOOR + 11) set(x, y, h.front, y === FLOOR + 3 ? 'basalt_bricks' : 'bronze');
    }
  // The doors, and the pens behind them: floors at the terrace's height, torch-lit.
  for (const dx of DOORS) {
    for (let x = dx - 1; x <= dx + 1; x++) for (let y = FLOOR + 3; y <= FLOOR + 6; y++) set(x, y, h.front, 'air');
    for (let x = dx - 2; x <= dx + 2; x++) set(x, FLOOR + 7, h.front, 'bronze');
    const side = Math.sign(dx);
    for (let z = h.back + 3; z < h.front; z += 4) {
      set(side * 7, FLOOR + 5, z, wallTorch(side > 0 ? 'east' : 'west'));
      set(side * 12, FLOOR + 5, z, wallTorch(side > 0 ? 'west' : 'east'));
    }
  }
  // The chimneys, smoking at the top.
  for (const cx of [-9, 9])
    for (let x = cx - 1; x <= cx + 1; x++)
      for (let z = -31; z <= -29; z++)
        for (let y = h.roof + 1; y <= TOP - 2; y++) {
          const inner = x === cx && z === -30;
          set(x, y, z, inner ? (y >= TOP - 3 ? 'magma' : 'air') : y >= TOP - 3 ? 'bronze' : (y + x) % 6 === 0 ? 'deepslate' : 'basalt_bricks');
        }
  // The terrace.
  const t = TERRACE;
  for (let x = t.x0; x <= t.x1; x++)
    for (let z = t.z0; z <= t.z1; z++) {
      set(x, FLOOR + 1, z, 'basalt_bricks');
      set(x, t.top, z, (x + z) % 2 ? 'basalt_bricks' : 'basalt');
      const front = z === t.z1 && Math.abs(x) > 3;
      const end = x === t.x0 || x === t.x1;
      if (front || end) {
        set(x, t.top + 1, z, 'basalt_bricks');
        set(x, t.top + 2, z, 'basalt_slab');
      }
    }
  // Vents in its face glowing from the forge below it; a seam of magma along the facade's foot.
  for (let x = t.x0 + 1; x <= t.x1 - 1; x++) {
    if (Math.abs(x) > 4 && x % 3 === 0) set(x, FLOOR + 1, t.z1, 'magma');
    if (Math.abs(x) > 5 && x % 2 === 0) set(x, t.top, t.z0, 'magma');
  }
  // The stairs down its middle, their cheeks either side.
  for (let x = -3; x <= 3; x++) {
    set(x, FLOOR + 1, t.z1 + 1, 'basalt_bricks');
    set(x, FLOOR + 2, t.z1 + 1, 'basalt_slab');
    set(x, FLOOR + 1, t.z1 + 2, 'basalt_bricks');
    set(x, FLOOR + 1, t.z1 + 3, 'basalt_slab');
  }
  for (const x of [-4, 4]) for (let z = t.z1 + 1; z <= t.z1 + 3; z++) for (let y = FLOOR + 1; y <= FLOOR + 3; y++) set(x, y, z, y === FLOOR + 3 ? 'basalt_slab' : 'basalt_bricks');
}

/** The loading dock east: a block high, a half step up its west side, crates on it. */
function dock(set: Set) {
  const d = DOCK;
  for (let x = d.x0; x <= d.x1; x++) for (let z = d.z0; z <= d.z1; z++) set(x, FLOOR + 1, z, x === d.x0 || z === d.z1 || z === d.z0 ? 'basalt_bricks' : 'spruce_planks');
  for (let z = d.z0 + 1; z <= d.z1 - 1; z++) set(d.x0 - 1, FLOOR + 1, z, 'basalt_slab');
  // Crates stacked at its back.
  for (const [x, z, n] of [
    [23, -10, 2],
    [24, -10, 1],
    [24, -9, 2],
    [22, -10, 1],
    [24, -5, 1],
  ] as const)
    for (let y = FLOOR + 2; y < FLOOR + 2 + n; y++) set(x, y, z, 'spruce_planks');
}

/** The slag field: heaps stepped a block at a time, pockets of lava (2 deep), and the odd cooling trough. */
function slag(set: Set) {
  for (const hp of HEAPS) {
    const r = Math.ceil(hp.r);
    for (let x = hp.x - r; x <= hp.x + r; x++)
      for (let z = hp.z - r; z <= hp.z + r; z++) {
        const d = Math.hypot(x - hp.x, z - hp.z) + hash(x, z, 40) * 0.6;
        if (d > hp.r) continue;
        const n = d < hp.r * 0.45 ? 2 : 1;
        for (let y = FLOOR + 1; y <= FLOOR + n; y++) set(x, y, z, y === FLOOR + n ? (hash(x, z, 41) < 0.2 ? 'magma' : 'cinder') : 'basalt');
      }
  }
  for (const p of POCKETS)
    for (let x = p.x0 - 1; x <= p.x1 + 1; x++)
      for (let z = p.z0 - 1; z <= p.z1 + 1; z++) {
        const inside = x >= p.x0 && x <= p.x1 && z >= p.z0 && z <= p.z1;
        if (!inside) {
          set(x, FLOOR, z, hash(x, z, 42) < 0.4 ? 'magma' : 'deepslate');
          continue;
        }
        set(x, FLOOR - 2, z, 'basalt');
        set(x, FLOOR - 1, z, 'lava');
        set(x, FLOOR, z, 'lava');
      }
  for (const [ox, oz] of OBELISKS)
    for (let x = ox; x <= ox + 1; x++)
      for (let z = oz; z <= oz + 1; z++) {
        set(x, FLOOR, z, 'basalt_bricks');
        for (let y = FLOOR + 1; y <= FLOOR + 5; y++) set(x, y, z, y === FLOOR + 1 ? 'basalt_bricks' : y === FLOOR + 5 ? 'bronze' : hash(x * 3 + y, z, 43) < 0.25 ? 'magma' : 'basalt');
      }
  // Cooling troughs by the dock, water hissing.
  for (let x = 13; x <= 15; x++)
    for (let z = -13; z <= -11; z++) {
      const rim = x === 13 || x === 15 || z === -13 || z === -11;
      set(x, FLOOR + 1, z, rim ? 'basalt_bricks' : 'water');
    }
}

/** A mine tunnel into the cliff at angle `a`: a gatehouse standing out from the rock, timbered inside, torch-lit. */
function tunnel(set: Set, a: number) {
  const fx = Math.cos(a);
  const fz = Math.sin(a);
  const R = DEEP + 4;
  for (let x = -R; x <= R; x++)
    for (let z = -R; z <= R; z++) {
      const along = x * fx + z * fz;
      const side = -x * fz + z * fx;
      if (along < HOUSE || along > DEEP + 1 || Math.abs(side) > 4) continue;
      const inside = Math.abs(side) <= 1.8 && along <= DEEP;
      const house = along <= HOUSE + 6;
      if (inside) {
        const frame = Math.round(along) % 3 === 0;
        set(x, FLOOR, z, 'basalt_bricks');
        for (let y = FLOOR + 1; y <= FLOOR + 4; y++) set(x, y, z, 'air');
        set(x, FLOOR + 5, z, frame ? 'spruce_planks' : 'basalt');
        if (house) for (let y = FLOOR + 6; y <= FLOOR + 7; y++) set(x, y, z, 'basalt_bricks');
        continue;
      }
      if (Math.abs(side) <= 2.8) {
        // The tunnel's walls: timber posts at its frames, torches between.
        const frame = Math.round(along) % 3 === 0;
        for (let y = FLOOR + 1; y <= FLOOR + 4; y++) set(x, y, z, frame && along <= DEEP ? 'spruce_log' : 'basalt');
        if (house) for (let y = FLOOR + 5; y <= FLOOR + 7; y++) set(x, y, z, 'basalt_bricks');
        continue;
      }
      if (house) {
        for (let y = FLOOR + 1; y <= FLOOR + 7; y++) set(x, y, z, 'basalt_bricks');
        if ((Math.round(along) + Math.round(side)) % 2 === 0) set(x, FLOOR + 8, z, 'basalt_bricks');
      }
    }
  // Over the mouth: the lintel, iron-banded.
  for (let s = -3; s <= 3; s++) {
    const x = Math.round(fx * HOUSE - fz * s);
    const z = Math.round(fz * HOUSE + fx * s);
    for (let y = FLOOR + 5; y <= FLOOR + 7; y++) set(x, y, z, y === FLOOR + 6 ? 'bronze' : 'basalt_bricks');
  }
  // Torches inside.
  for (const along of [HOUSE + 4, HOUSE + 7]) {
    for (const s of [-1, 1]) {
      const x = Math.round(fx * along - fz * s * 1.6);
      const z = Math.round(fz * along + fx * s * 1.6);
      const dx = s * fz;
      const dz = -s * fx;
      set(x, FLOOR + 3, z, wallTorch(Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? 'east' : 'west') : dz > 0 ? 'south' : 'north'));
    }
  }
}

/** The Drop Hammer's gantry over the eastern bridge: four posts off its parapets, beams across, and the guide its shaft slides in. */
function gantry(set: Set) {
  const h = HAMMER;
  const lx0 = h.min.x - OX - 1;
  const lx1 = h.max.x - OX + 1;
  const lz0 = h.min.z - OZ - 1;
  const lz1 = h.max.z - OZ + 1;
  const beam = FLOOR + 13;
  for (const x of [lx0, lx1])
    for (const z of [lz0, lz1]) for (let y = FLOOR + 1; y < beam; y++) set(x, y, z, y % 4 === 0 ? 'bronze' : 'basalt_bricks');
  for (let x = lx0; x <= lx1; x++) {
    set(x, beam, lz0, 'basalt_bricks');
    set(x, beam, lz1, 'basalt_bricks');
  }
  for (let z = lz0; z <= lz1; z++) {
    set(lx0, beam, z, 'basalt_bricks');
    set(lx1, beam, z, 'basalt_bricks');
    set(Math.round((lx0 + lx1) / 2), beam + 1, z, 'bronze');
  }
  // The guide: a column hanging from the cross-beam over the head's middle, the shaft inside it.
  const gx = Math.round((lx0 + lx1) / 2);
  const gz = Math.round((lz0 + lz1) / 2);
  for (let y = Math.ceil(h.max.y) + 1; y <= beam + 6; y++) set(gx, y, gz, y % 3 === 0 ? 'bronze' : 'basalt_bricks');
}

/** Lavafalls down the cliff faces: one feeding the river at the west, two more into pools at the cliffs' feet. */
function lavafalls(set: Set, tops: Map<string, number>) {
  const fall = (x: number, z: number) => {
    // From the face inward: the first column of cliff.
    const d = Math.hypot(x, z);
    const ux = x / d;
    const uz = z / d;
    for (let k = 0; k < 20; k++) {
      const cx = Math.round(x + ux * k);
      const cz = Math.round(z + uz * k);
      const top = tops.get(`${cx},${cz}`) ?? FLOOR;
      if (top < FLOOR + 6) continue;
      for (let y = FLOOR - 1; y < top; y++) set(cx, y, cz, 'lava');
      return;
    }
  };
  // Into the river's west end.
  for (let z = riverCells(-34).z0; z <= riverCells(-34).z1; z++) fall(-29, z);
  // Two more, into pools at the cliffs' feet.
  for (const a of FALLS) for (const da of [-0.03, 0, 0.03]) fall(Math.cos(a + da) * 24, Math.sin(a + da) * 24);
  for (const c of FALL_POOL) {
    set(c.x - OX, FLOOR - 2, c.z - OZ, 'basalt');
    set(c.x - OX, FLOOR - 1, c.z - OZ, 'lava');
    set(c.x - OX, FLOOR, c.z - OZ, 'lava');
  }
}

/** Where the other lavafalls come down (angles), and the pools at their feet: the floor's blocks just short of the cliff. */
const FALLS = [-2.35, -0.78, 1.55, 2.75, 0.3];
const FALL_POOL: Vec3[] = FALLS.flatMap((a) => {
  const cells: Vec3[] = [];
  const e = edge(a);
  for (let x = -40; x <= 40; x++)
    for (let z = -40; z <= 40; z++) {
      const d = Math.hypot(x, z);
      const b = Math.atan2(z, x);
      const off = Math.abs(Math.atan2(Math.sin(b - a), Math.cos(b - a))) * d;
      if (off < 2.6 && d < edge(b) && d > e - 3.2) cells.push(at(x, FLOOR - 1, z));
    }
  return cells;
});

/** Braziers: at the terrace's stairs and ends, the bridges' ends, the gatehouses. */
function braziers(set: Set) {
  for (const f of FIRES) {
    if (f.size > 1.15) continue;
    const x = Math.floor(f.at.x) - OX;
    const z = Math.floor(f.at.z) - OZ;
    const top = Math.floor(f.at.y) - 1;
    set(x, top, z, 'magma');
    set(x, top - 1, z, 'bronze');
    set(x, top - 2, z, 'basalt_bricks');
  }
}

// -------------------------------------------------------------------------------------------------
// The places
// -------------------------------------------------------------------------------------------------

/** The bridges' ends (local z), for what stands at them. */
function bridgeEnds(b: { x0: number; x1: number }) {
  let lo = Infinity;
  let hi = -Infinity;
  for (let x = b.x0; x <= b.x1; x++) {
    lo = Math.min(lo, riverCells(x).z0);
    hi = Math.max(hi, riverCells(x).z1);
  }
  return { lo: lo - 2, hi: hi + 2, mid: Math.round((lo + hi) / 2) };
}
const EAST = bridgeEnds(BRIDGES[1]);

/** The Drop Hammer's head: over the eastern bridge's middle, its foot `HAMMER_DROP` over the deck. */
const HAMMER_DROP = 4.5;
const DECK = FLOOR + 1;
const HAMMER: Box = box(at(BRIDGES[1].x0, DECK + HAMMER_DROP, EAST.mid - 2), at(BRIDGES[1].x1, DECK + HAMMER_DROP + 2, EAST.mid + 2));

const FIRES: Fire[] = [
  // The terrace: either side of the stairs, at its ends.
  ...[-4, 4, -12, 12].map((x) => ({ at: at(x + 0.5, TERRACE.top + 5, TERRACE.z1 + 0.5), size: 0.9 })),
  // The bridges' corners.
  ...BRIDGES.flatMap((b) => {
    const e = bridgeEnds(b);
    return [b.x0 - 2, b.x1 + 2].flatMap((x) => [e.lo, e.hi].map((z) => ({ at: at(x + 0.5, FLOOR + 3, z + 0.5), size: 0.85 })));
  }),
  // Either side of each gatehouse's mouth.
  ...TUNNELS.flatMap((a) =>
    [-3.2, 3.2].map((s) => {
      const x = Math.round(Math.cos(a) * (HOUSE - 1.5) - Math.sin(a) * s);
      const z = Math.round(Math.sin(a) * (HOUSE - 1.5) + Math.cos(a) * s);
      return { at: at(x + 0.5, FLOOR + 3, z + 0.5), size: 0.8 };
    }),
  ),
  // The furnace's fire, and the chimneys'.
  ...[-3, 0, 3].map((x) => ({ at: at(x + 0.5, FLOOR + 3.2, HALL.front - 1.5), size: 1.3 })),
  ...[-9, 9].map((x) => ({ at: at(x + 0.5, TOP - 1.4, -29.5), size: 1.4 })),
];

/** The gates: the hall's two doors (their pens inside it), and the mine tunnels. */
const hallGate = (x: number): Gate => ({ at: at(x + 0.5, TERRACE.top + 1.05, -28.5), yaw: Math.PI, spread: 1.4 });
const tunnelGate = (a: number): Gate => {
  const x = OX + 0.5 + Math.cos(a) * PEN;
  const z = OZ + 0.5 + Math.sin(a) * PEN;
  return { at: { x, y: FLOOR + 1.05, z }, yaw: yawTo(x, z, C.x, C.z), spread: 0.8 };
};
const GATES: Gate[] = [...DOORS.map(hallGate), ...TUNNELS.map(tunnelGate)];

const PORTCULLISES: Portcullis[] = [
  ...DOORS.map((x) => ({ at: at(x + 0.5, TERRACE.top + 1, HALL.front + 0.5), yaw: Math.PI, width: 3, height: 4 })),
  ...TUNNELS.map((a) => {
    const x = OX + 0.5 + Math.cos(a) * (HOUSE + 0.8);
    const z = OZ + 0.5 + Math.sin(a) * (HOUSE + 0.8);
    return { at: { x, y: FLOOR + 1, z }, yaw: yawTo(x, z, C.x, C.z), width: 4, height: 4 };
  }),
];

/** Bosses come in the open: before the terrace, west, east, and in the slag field. */
const bossGate = (x: number, z: number): Gate => ({ at: at(x + 0.5, FLOOR + 1.05, z + 0.5), yaw: yawTo(OX + x + 0.5, OZ + z + 0.5, C.x, C.z) });

/** The caldera, built once (the world's structure, and where its lava is). */
const BUILT = build();

/**
 * Lava that burns: every lava block the caldera has (the river and its cave, the slag field's
 * pockets, the lavafalls and their pools, the furnace behind its grate), a box to each unbroken
 * run of it up a column, so there's nowhere lava can be waded into or fallen into that doesn't
 * burn, and nothing that isn't lava (a ledge between a fall's blocks) does.
 */
const HAZARDS: Hazard[] = [{ kind: 'lava', zone: lavaColumns(BUILT) }];

function lavaColumns(bp: Blueprint): Box[] {
  const ys = new Map<string, { x: number; z: number; y: number[] }>();
  bp.forEach((x, y, z, b) => {
    if (b !== 'lava') return;
    const k = `${x},${z}`;
    const c = ys.get(k) ?? { x, z, y: [] };
    c.y.push(y);
    ys.set(k, c);
  });
  const boxes: Box[] = [];
  for (const c of ys.values()) {
    const y = c.y.sort((a, b) => a - b);
    let lo = y[0];
    for (let i = 1; i <= y.length; i++) {
      if (i < y.length && y[i] === y[i - 1] + 1) continue;
      boxes.push(box({ x: c.x, y: lo, z: c.z }, { x: c.x, y: y[i - 1], z: c.z }));
      lo = y[i];
    }
  }
  return boxes;
}

const TRAPS: TrapSpec[] = [
  {
    id: 'forge.hammer',
    name: 'The Drop Hammer',
    kind: 'crusher',
    lever: { at: at(5.5, FLOOR + 1, EAST.lo - 1.5), face: -Math.PI / 2 },
    price: 90,
    time: 8,
    cooldown: 40,
    zone: [box(at(BRIDGES[1].x0, DECK - 1, EAST.mid - 2), at(BRIDGES[1].x1, DECK - 1, EAST.mid + 2))],
    head: HAMMER,
    drop: HAMMER_DROP,
  },
  {
    id: 'forge.sluice',
    name: 'The Lava Sluice',
    kind: 'sluice',
    lever: { at: at(-12.5, FLOOR + 1, -7.5), face: Math.PI / 2 },
    price: 80,
    time: 9,
    cooldown: 40,
    zone: [box(at(CHANNEL.x0, FLOOR - 1, CHANNEL.z0), at(CHANNEL.x1, FLOOR, CHANNEL.z1))],
    channel: Array.from({ length: CHANNEL.z1 - CHANNEL.z0 + 1 }, (_, i) => [CHANNEL.x0, CHANNEL.x1].map((x) => at(x, FLOOR, CHANNEL.z0 + i))).flat(),
  },
  {
    id: 'forge.bellows',
    name: 'The Bellows',
    kind: 'jets',
    element: 'fire',
    lever: { at: at(-7.5, TERRACE.top + 1, -16.5), face: -Math.PI / 2 },
    price: 70,
    time: 7,
    cooldown: 35,
    zone: [],
    jets: [-0.55, 0, 0.55].map((s) => {
      const l = Math.hypot(s, 1);
      return { at: at(0.5 + s * 0.8, TERRACE.top + 2.4, HALL.front + 1.1), dir: { x: s / l, y: -0.13, z: 1 / l }, length: 9 };
    }),
  },
];

// -------------------------------------------------------------------------------------------------
// Set pieces
// -------------------------------------------------------------------------------------------------

/** The Forge's banner: black, an orange border, a hammer raised over an anvil, sparks, swallow-tailed. */
function design(): BannerDesign {
  const rows: string[] = [];
  for (let y = 0; y < 40; y++) {
    let row = '';
    for (let x = 0; x < 16; x++) {
      const tail = y > 33 && Math.abs(x - 7.5) < (y - 33) * 1.2;
      let c = 'k';
      if (y < 2) c = 'b';
      else if (x === 0 || x === 15 || y === 2) c = 'o';
      // The hammer: its head across, its haft down to the anvil.
      else if (y >= 7 && y <= 10 && x >= 3 && x <= 12) c = y === 7 || x === 3 || x === 12 ? 'o' : 'y';
      else if (y >= 11 && y <= 19 && (x === 7 || x === 8)) c = 'y';
      // The anvil: its face, the horn west, its waist, its foot.
      else if ((y === 21 || y === 22) && x >= 3 && x <= 13) c = 'o';
      else if (y === 21 && (x === 1 || x === 2)) c = 'o';
      else if ((y === 23 || y === 24) && x >= 6 && x <= 10) c = 'o';
      else if ((y === 25 || y === 26) && x >= 4 && x <= 12) c = 'o';
      // Sparks off the blow.
      else if ([[2, 15], [13, 16], [11, 13], [4, 12], [14, 19], [1, 18]].some(([sx, sy]) => sx === x && sy === y)) c = 'y';
      else if (y === 30 || y === 31) c = 'o';
      if (tail) c = '.';
      row += c;
    }
    rows.push(row);
  }
  return { rows, palette: { k: 'black_concrete', o: 'orange_concrete', y: 'yellow_concrete', b: 'bronze' } };
}
const BANNER = banner(design());

/** An anvil, iron on dark steel, its horn to the side. Pivot: its foot, facing +z. */
function anvil(): Model {
  const bp = parts([
    [0, 0, 0, 9, 1, 5, 'deepslate'],
    [2, 2, 1, 7, 4, 4, 'deepslate'],
    [-2, 5, 0, 11, 6, 5, 'deepslate'],
    [-2, 7, 0, 11, 7, 5, 'iron_block'],
    [-5, 6, 1, -3, 7, 4, 'deepslate'],
    [-7, 7, 2, -6, 7, 3, 'deepslate'],
  ]);
  return { bp, scale: 1 / 8, pivot: { x: 4.5, y: 0, z: 2.5 } };
}

/** A dwarven smith-king in bronze, his great hammer head-down before him, hands on its pommel; about 4 blocks tall. Pivot: his feet, facing +z. */
function smithKing(): Model {
  const b = 'bronze';
  const g = 'gilt';
  const bp = parts([
    // Boots, a wide stance; legs.
    [0, 0, 0, 3, 2, 4, b],
    [5, 0, 0, 8, 2, 4, b],
    [1, 3, 1, 3, 5, 3, b],
    [5, 3, 1, 7, 5, 3, b],
    // A barrel of a body, belted.
    [-1, 6, 0, 9, 12, 4, b],
    [-1, 7, 0, 9, 7, 4, g],
    [3, 7, 4, 5, 7, 4, 'magma'],
    // Arms down to the pommel.
    [-3, 8, 1, -2, 12, 3, b],
    [10, 8, 1, 11, 12, 3, b],
    [-2, 7, 4, 1, 8, 6, b],
    [7, 7, 4, 10, 8, 6, b],
    // The hammer: its head on the ground before him, the haft up to his hands.
    [1, 0, 6, 7, 3, 9, 'iron_block'],
    [3, 4, 7, 5, 8, 8, 'spruce_planks'],
    [2, 9, 6, 6, 9, 9, g],
    // The head, the great braided beard down his chest, a crowned helm.
    [2, 13, 1, 6, 16, 4, b],
    [1, 8, 4, 7, 13, 5, g],
    [3, 5, 5, 5, 8, 5, g],
    [2, 16, 0, 6, 17, 4, 'deepslate'],
    [1, 15, 0, 7, 15, 4, g],
    [2, 18, 1, 2, 19, 1, g],
    [4, 18, 1, 4, 20, 1, g],
    [6, 18, 1, 6, 19, 1, g],
    [3, 14, 5, 3, 14, 5, 'black_concrete'],
    [5, 14, 5, 5, 14, 5, 'black_concrete'],
  ]);
  return { bp, scale: 1 / 5, pivot: { x: 4, y: 0, z: 2 } };
}

/** An ore cart, heaped with glowing ore. Pivot: its foot's middle, facing +z. */
function oreCart(): Model {
  const bp = parts([
    [0, 2, 0, 11, 8, 7, 'deepslate'],
    [0, 4, 0, 11, 4, 7, 'bronze'],
    [1, 3, 1, 10, 8, 6, 'deepslate'],
    [1, 8, 1, 10, 9, 6, 'gold_ore'],
    [3, 10, 2, 8, 10, 5, 'magma'],
    [1, 0, -1, 3, 2, -1, 'deepslate'],
    [8, 0, -1, 10, 2, -1, 'deepslate'],
    [1, 0, 8, 3, 2, 8, 'deepslate'],
    [8, 0, 8, 10, 2, 8, 'deepslate'],
  ]);
  return { bp, scale: 1 / 8, pivot: { x: 6, y: 0, z: 3.5 } };
}

const ANVIL = anvil();
const KING = smithKing();
const CART = oreCart();

const DECOR: Decor[] = [
  // Banners over the doors and at the facade's corners, facing out.
  ...[-12.4, -9, 9, 12.4].map((x) => ({ model: BANNER, at: at(x + 0.5, FLOOR + 12.4, HALL.front + 1.06), face: 0 })),
  // The smith-kings either side of the furnace, on their plinths.
  ...[-6, 7].map((x) => ({ model: KING, at: at(x, TERRACE.top + 2, HALL.front + 1.55), face: 0 })),
  // Anvils at the terrace's ends; carts on the dock and in the slag field.
  { model: ANVIL, at: at(-9.5, TERRACE.top + 1, -18), face: 0.3 },
  { model: ANVIL, at: at(10.5, TERRACE.top + 1, -17.5), face: -0.4 },
  { model: CART, at: at(20.5, FLOOR + 2, -6), face: Math.PI / 2 },
  { model: CART, at: at(6.5, FLOOR + 1, 24.5), face: 0.4 },
  { model: ANVIL, at: at(-23.5, FLOOR + 1, 6.5), face: faceTo(-23.5, 6.5, 0, 0) },
];

export const FORGE: ArenaMap = {
  id: 'forge',
  name: 'The Forge',
  line: 'Iron, fire and rivers of lava',
  color: '#ff7a1a',
  icon: 'magma',
  origin: C,
  build: () => [BUILT, ground()],
  center: { x: C.x, y: FLOOR + 1, z: C.z },
  radius: 22,
  gates: GATES,
  // On the open floor round the plaza (big bosses need room).
  bossGates: [bossGate(0, -8), bossGate(-11, 0), bossGate(11, 0), bossGate(0, 10)],
  portcullises: PORTCULLISES,
  lookout: at(0.5, HALL.roof + 1, -24.5),
  time: 0.725,
  dusk: 0.05,
  intro: [
    { at: at(28, FLOOR + 36, 42), look: at(0, FLOOR + 9, -24) },
    { at: at(19, FLOOR + 14, 27), look: at(10, FLOOR + 5, 17) },
    { at: at(-6, FLOOR + 11, 4), look: at(0.5, FLOOR + 7, -22) },
    { at: at(-14, FLOOR + 9, -6), look: at(0.5, FLOOR + 2, 4) },
  ],
  shop: at(7.5, FLOOR + 1, -6.5),
  chests: [at(-17.5, FLOOR + 1, 18.5), at(20.5, FLOOR + 2, -7.5), at(-21.5, FLOOR + 1, -5.5)],
  crowd: false,
  traps: TRAPS,
  hazards: HAZARDS,
  decor: DECOR,
  fires: FIRES,
  air: { kind: 'embers', heading: 0.3, wind: 1.4, gust: 4, loop: 'amb_forge', calls: ['amb_hammer', 'amb_rumble', 'amb_steam'] },
};

/** The ground beyond the caldera, under its outer slopes: cinder, out past the haze. */
function ground(): Blueprint {
  const bp = Blueprint.centered(OX, OZ, GROUND, FLOOR, FLOOR);
  bp.columns(OX, OZ, GROUND, (x, z, d) => {
    if (d < RIM - 1) return;
    bp.set(x, FLOOR, z, hash(x, z, 60) < 0.3 ? 'basalt' : 'cinder');
  });
  return bp;
}
