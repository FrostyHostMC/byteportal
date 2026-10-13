import { Blueprint, type Vec3 } from '@platform';

/** The capital ship: a world-scale block build hovering over the battle, and its weak points. */
export interface Destroyer {
  blueprint: Blueprint;
  /** Shield generator domes (world block coords, the centre of each dome). Destroy both to expose the bridge. */
  generators: Vec3[];
  /** Bridge centre (world coords): the final target. */
  bridge: Vec3;
  /** Turret mounts on the hull (world coords, the block the turret sits on). */
  turrets: Vec3[];
  /** Engine exhaust centres (world coords). */
  engines: Vec3[];
}

// Ship space: +x starboard, +y up, the nose toward -z; (0, 0, 0) is the middle of the hull.
// The hull is a dagger in plan (a triangle from the nose to the flat stern). In cross-section the
// upper hull slopes up from the rim to the spine, the lower hull slopes down to a flat keel, and
// the rim between them carries the dark equatorial trench (y = -1..-2).

const NOSE = -100;
const STERN = 96; // last hull slice; the engines stick out behind it
const BEAM = 60; // half-width at the stern
const RIM_TOP = 1;
const RIM_BOT = -4;
const UP_SLOPE = 0.3; // upper hull rise per block in from the rim
const LO_SLOPE = 0.28; // lower hull drop per block in from the rim (flat keel past half the beam)
const STEP_AT = 0.34; // the upper hull steps up one block this far in from the rim (fraction of the half-width)

/**
 * Superstructure decks, a stepped ziggurat of nested arrowheads: front tip z, how fast it widens
 * aft (half-width per block), half-width, deck height. The low decks are ledges on the hull slopes.
 */
const TERRACES = [
  { tip: -30, taper: 0.3, hw: 38, top: 12 },
  { tip: -15, taper: 0.3, hw: 32, top: 15 },
  { tip: 0, taper: 0.3, hw: 26, top: 18 },
  { tip: 18, taper: 0.3, hw: 20, top: 22 },
  { tip: 36, taper: 0.4, hw: 16, top: 26 },
  { tip: 52, taper: 0.5, hw: 13, top: 30 },
  { tip: 64, taper: 0.6, hw: 10, top: 34 },
];
const TOP_DECK = TERRACES[TERRACES.length - 1].top;

/** Command tower: a tapered neck on the top deck, the T-shaped bridge on it, shield domes on the bridge ends. */
const NECK = { z0: 80, z1: 93, hw0: 8, hw1: 4 };
const BRIDGE = { hw: 18, z0: 76, z1: 93, y0: 48, y1: 52 };
// Dome centres sit on block corners (x = 0.5 is the centreline) so the spheres are an even 10 blocks across.
const DOME = { dx: 13.5, y: 59, z: 85, r: 5 };
const DOME_X = [0.5 - DOME.dx, 0.5 + DOME.dx];

/** Engine nozzles on the stern: three main ones, then four auxiliaries. */
const NOZZLES = [
  { x: -24, y: 3, r: 9.5 },
  { x: 0, y: 3, r: 9.5 },
  { x: 24, y: 3, r: 9.5 },
  { x: -44, y: -1, r: 4.5 },
  { x: 44, y: -1, r: 4.5 },
  { x: -12, y: -8, r: 3.5 },
  { x: 12, y: -8, r: 3.5 },
];

/** Turret emplacements: along the upper hull near the rim (d = blocks in from the rim), and on deck ledges. */
const HULL_TURRETS = [-62, -28, 6, 40, 72].map((z) => ({ z, d: 7 }));
const DECK_TURRETS = [
  { x: 34, z: 88 },
  { x: 16, z: 60 },
];

// The local box the build fits in.
const LX = BEAM + 1;
const LY0 = -15;
const LY1 = 64;
const LZ0 = NOSE;
const LZ1 = STERN + 5;

// Parts of the ship, painted into blocks at the end.
const HULL = 1;
const TRENCH = 2;
const BELLY = 3;
const DECK = 4;
const TOWER = 5;
const BRIDGE_P = 6;
const DOME_P = 7;
const HOUSING = 8;
const RIM = 9;
const THROAT = 10;
const EXHAUST = 11;
const DETAIL = 12; // explicit block (see `mat`)

const halfWidth = (z: number) => 1 + ((BEAM - 1) * (z - NOSE)) / (STERN - NOSE);

/** Top of the upper hull in a column inside the plan. */
function hullTop(x: number, z: number): number {
  const w = halfWidth(z);
  const d = w - Math.abs(x);
  return RIM_TOP + Math.floor(d * UP_SLOPE) + (d > w * STEP_AT ? 1 : 0);
}

/** Bottom of the lower hull in a column inside the plan. */
function hullBottom(x: number, z: number): number {
  const w = halfWidth(z);
  const d = w - Math.abs(x);
  return RIM_BOT - Math.floor(Math.min(d, w * 0.5) * LO_SLOPE);
}

function terraceWidth(t: (typeof TERRACES)[number], z: number): number {
  if (z < t.tip) return -1;
  return Math.min(t.hw, (z - t.tip) * t.taper);
}

/** The terrace whose wall band holds height y. */
function terraceAt(y: number) {
  return TERRACES.find((t) => y <= t.top) ?? TERRACES[TERRACES.length - 1];
}

/** Deterministic 0..1 hash for panel patterns. */
function hash(a: number, b: number, c = 0): number {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(c | 0, 1440662683);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Pick a hull plating block for one panel. */
function plate(h: number, bright: number, dark: number): string {
  if (h < bright * 0.6) return 'iron_block';
  if (h < bright) return 'white_concrete';
  if (h < bright + dark) return 'gray_concrete';
  return 'light_gray_concrete';
}

class Ship {
  readonly sx = 2 * LX + 1;
  readonly sy = LY1 - LY0 + 1;
  readonly sz = LZ1 - LZ0 + 1;
  readonly part = new Uint8Array(this.sx * this.sy * this.sz);
  readonly mat = new Map<number, string>();

  private idx(x: number, y: number, z: number): number {
    if (x < -LX || x > LX || y < LY0 || y > LY1 || z < LZ0 || z > LZ1) return -1;
    return ((y - LY0) * this.sz + (z - LZ0)) * this.sx + (x + LX);
  }

  get(x: number, y: number, z: number): number {
    const i = this.idx(x, y, z);
    return i < 0 ? 0 : this.part[i];
  }

  set(x: number, y: number, z: number, p: number, block?: string) {
    const i = this.idx(x, y, z);
    if (i < 0) return;
    this.part[i] = p;
    if (block) this.mat.set(i, block);
    else this.mat.delete(i);
  }

  /** An explicit block (windows, lights, fittings) on top of the shape. */
  put(x: number, y: number, z: number, block: string) {
    this.set(x, y, z, DETAIL, block);
  }

  clear(x: number, y: number, z: number) {
    this.set(x, y, z, 0);
  }

  /** Highest solid y in a column (or LY0 - 1). */
  top(x: number, z: number): number {
    for (let y = LY1; y >= LY0; y--) if (this.get(x, y, z)) return y;
    return LY0 - 1;
  }

  hull() {
    for (let z = NOSE; z <= STERN; z++) {
      const w = halfWidth(z);
      for (let x = -Math.floor(w); x <= Math.floor(w); x++) {
        const d = w - Math.abs(x);
        for (let y = hullBottom(x, z); y <= hullTop(x, z); y++) {
          const trench = y === -1 || y === -2;
          if (trench && d < 1) continue; // the recessed equatorial trench
          this.set(x, y, z, trench ? TRENCH : y >= 0 ? HULL : BELLY);
        }
      }
      // A raised spine running forward from the superstructure to the nose.
      if (z > NOSE + 8 && z < TERRACES[0].tip + 8) {
        const sw = 1 + Math.floor((z - NOSE) / 45);
        for (let x = -sw; x <= sw; x++) this.set(x, hullTop(x, z) + 1, z, HULL);
        this.set(0, hullTop(0, z) + 2, z, HULL);
      }
    }
  }

  superstructure() {
    for (const t of TERRACES) {
      for (let z = t.tip; z <= STERN; z++) {
        const hw = Math.floor(terraceWidth(t, z));
        for (let x = -hw; x <= hw; x++)
          for (let y = hullTop(x, z) + 1; y <= t.top; y++) if (!this.get(x, y, z)) this.set(x, y, z, DECK);
      }
    }
  }

  tower() {
    // The neck tapers from the top deck up to the bridge.
    for (let y = TOP_DECK + 1; y < BRIDGE.y0; y++) {
      const f = (y - TOP_DECK - 1) / (BRIDGE.y0 - TOP_DECK - 2);
      const hw = Math.round(NECK.hw0 + (NECK.hw1 - NECK.hw0) * f);
      for (let z = NECK.z0; z <= NECK.z1; z++) for (let x = -hw; x <= hw; x++) this.set(x, y, z, TOWER);
    }
    // The bridge: a wide slab with chamfered edges and a lit window strip across its face.
    const { hw, z0, z1, y0, y1 } = BRIDGE;
    for (let y = y0; y <= y1; y++) {
      const front = z0 + (y === y0 ? 2 : y === y0 + 1 || y === y1 ? 1 : 0);
      const half = y === y0 || y === y1 ? hw - 1 : hw;
      for (let z = front; z <= z1; z++) for (let x = -half; x <= half; x++) this.set(x, y, z, BRIDGE_P);
    }
    const wy = y0 + 3;
    for (let x = -hw + 1; x <= hw - 1; x++) this.put(x, wy, z0, x % 5 === 0 ? 'gray_concrete' : 'glowstone');
    for (let z = z0 + 2; z <= z1 - 2; z++) {
      const lit = z % 3 !== 0 ? 'glowstone' : 'gray_concrete';
      this.put(-hw, wy, z, lit);
      this.put(hw, wy, z, lit);
    }
    // Sensor hump between the domes.
    for (let z = z0 + 5; z <= z1 - 3; z++) for (let x = -6; x <= 6; x++) this.set(x, y1 + 1, z, BRIDGE_P);
    // Shield generator domes on short stalks.
    for (const cx of DOME_X) {
      for (let y = y1 + 1; y < DOME.y - DOME.r; y++)
        for (let z = DOME.z - 1; z <= DOME.z; z++) for (let x = cx - 1; x <= cx; x++) this.put(x, y, z, 'gray_concrete');
      this.sphere(cx, DOME.y, DOME.z, DOME.r, DOME_P);
    }
  }

  /** Every cell whose centre is within r of the point (cx, cy, cz). */
  sphere(cx: number, cy: number, cz: number, r: number, p: number) {
    for (let y = Math.floor(cy - r); y <= cy + r; y++)
      for (let z = Math.floor(cz - r); z <= cz + r; z++)
        for (let x = Math.floor(cx - r); x <= cx + r; x++)
          if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 + (z + 0.5 - cz) ** 2 <= r * r) this.set(x, y, z, p);
  }

  /** Ventral keel bulge with the main hangar bay cut into it. */
  belly() {
    for (let z = -30; z <= 90; z++) {
      const kw = Math.min(14, (z + 30) * 0.45);
      const flat = hullBottom(0, z);
      for (let i = 1; i <= 3; i++) {
        const half = Math.floor(kw) - (i - 1);
        for (let x = -half; x <= half; x++) this.set(x, flat - i, z, BELLY);
      }
    }
    for (let z = 18; z <= 46; z++) {
      const flat = hullBottom(0, z);
      for (let x = -7; x <= 7; x++) {
        this.clear(x, flat - 3, z);
        this.clear(x, flat - 2, z);
        const light = x % 3 === 0 && z % 4 === 0;
        this.put(x, flat - 1, z, light ? 'glowstone' : 'black_concrete');
      }
    }
  }

  engines() {
    // The engine housing: the middle of the stern outline, pushed three blocks aft.
    for (let z = STERN + 1; z <= STERN + 3; z++) {
      const hw = 37 - (z - STERN - 1);
      for (let x = -hw; x <= hw; x++)
        for (let y = Math.max(hullBottom(x, STERN), -12) + (z - STERN - 1); y <= Math.min(hullTop(x, STERN), 15) - (z - STERN - 1); y++)
          this.set(x, y, z, HOUSING);
    }
    // Nozzles: a steel collar sticking out of the housing, a dark lip, and the glowing disc set back inside.
    for (const n of NOZZLES) {
      const deep = n.r > 6 ? 2 : 1; // the disc face
      const collar = n.r > 6 ? 1.6 : 1;
      const k = Math.ceil(n.r);
      for (let y = -k; y <= k; y++)
        for (let x = -k; x <= k; x++) {
          const r = Math.hypot(x, y);
          if (r > n.r) continue;
          for (let z = STERN + 1; z <= STERN + deep + 3; z++) {
            const [wx, wy] = [n.x + x, n.y + y];
            if (r > n.r - collar) this.set(wx, wy, z, RIM);
            else if (r > n.r - collar - 1) this.set(wx, wy, z, THROAT);
            else if (z <= STERN + deep) this.set(wx, wy, z, EXHAUST);
            else this.clear(wx, wy, z);
          }
        }
    }
  }

  /** Raised gun emplacements; returns the mount blocks (ship space). */
  turrets(): Vec3[] {
    const mounts: Vec3[] = [];
    const emplace = (x: number, z: number) => {
      let base = LY0;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) base = Math.max(base, this.top(x + dx, z + dz));
      for (let dz = -1; dz <= 1; dz++)
        for (let dx = -1; dx <= 1; dx++)
          for (let y = this.top(x + dx, z + dz) + 1; y <= base + 1; y++) this.put(x + dx, y, z + dz, 'light_gray_concrete');
      this.put(x, base + 2, z, 'gray_concrete');
      mounts.push({ x, y: base + 2, z });
    };
    for (const side of [-1, 1]) {
      for (const t of HULL_TURRETS) emplace(side * Math.round(halfWidth(t.z) - t.d), t.z);
      for (const t of DECK_TURRETS) emplace(side * t.x, t.z);
    }
    return mounts;
  }

  /** Small vents and boxes on the decks and upper hull, and a scatter of larger hull blocks. */
  greebles() {
    for (const side of [-1, 1])
      for (let z = NOSE + 30; z <= STERN - 8; z += 6) {
        const h = hash(z, side, 11);
        if (h > 0.55) continue;
        const w = halfWidth(z);
        const d = w * (0.22 + 0.5 * hash(z, side, 12));
        this.hullBlock(side * Math.round(w - d), z, 2 + Math.floor(h * 5), 3 + Math.floor(hash(z, side, 13) * 5), h < 0.2 ? 2 : 1);
      }
    for (let z = NOSE + 10; z <= STERN - 2; z++)
      for (let x = -LX; x <= LX; x++) {
        const h = hash(x, z, 7);
        const y = this.top(x, z);
        const p = this.get(x, y, z);
        if (p === DECK && h < 0.03) {
          this.put(x, y + 1, z, h < 0.01 ? 'iron_block' : h < 0.02 ? 'white_concrete' : 'light_gray_concrete');
          if (h < 0.006) this.put(x, y + 2, z, 'light_gray_concrete');
        } else if (p === HULL && y > RIM_TOP + 2 && h < 0.008) this.put(x, y + 1, z, h < 0.004 ? 'white_concrete' : 'iron_block');
      }
  }

  /** A box sitting on the sloped upper hull (skipped where it would touch the superstructure). */
  private hullBlock(x0: number, z0: number, sx: number, sz: number, h: number) {
    let base = LY0;
    for (let z = z0; z < z0 + sz; z++)
      for (let x = x0; x < x0 + sx; x++) {
        const y = this.top(x, z);
        if (this.get(x, y, z) !== HULL) return;
        base = Math.max(base, y);
      }
    for (let z = z0; z < z0 + sz; z++)
      for (let x = x0; x < x0 + sx; x++)
        for (let y = this.top(x, z) + 1; y <= base + h; y++) this.put(x, y, z, y === base + h ? 'iron_block' : 'light_gray_concrete');
  }

  private open(x: number, y: number, z: number): boolean {
    return this.get(x, y, z) === 0;
  }

  /** Choose the block for one solid cell. */
  private paint(x: number, y: number, z: number, p: number, i: number): string | undefined {
    if (p === DETAIL) return this.mat.get(i);
    const up = this.open(x, y + 1, z);
    const side = this.open(x - 1, y, z) || this.open(x + 1, y, z) || this.open(x, y, z - 1) || this.open(x, y, z + 1);
    const down = this.open(x, y - 1, z);
    if (!up && !side && !down) return 'light_gray_concrete'; // hidden
    const ax = Math.abs(x);
    const sgn = x < 0 ? -1 : 1;
    const stern = z >= STERN && this.open(x, y, z + 1);
    switch (p) {
      case HULL: {
        if (stern && !up) return hash(Math.floor(x / 6), Math.floor(y / 3), 3) < 0.3 ? 'white_concrete' : 'light_gray_concrete';
        const w = halfWidth(z);
        const d = w - ax;
        // The riser where the upper hull steps up carries a line of lit ports.
        if (!up && side && d > w * STEP_AT && d < w * STEP_AT + 1.5) return z % 6 === 0 ? 'glowstone' : 'gray_concrete';
        const px = Math.floor((ax + 2) / 5);
        return plate(hash(px * sgn, Math.floor((z + (px & 1) * 4) / 8), 1), 0.09, 0);
      }
      case TRENCH:
        return y === -1 && (z & 3) === 0 && !stern ? 'glowstone' : 'black_concrete';
      case BELLY: {
        if (stern) return 'light_gray_concrete';
        // Running lights under the hull (the belly gets no sky light).
        if (down && x % 10 === 0 && z % 12 === 0) return 'sea_lantern';
        const lane = Math.floor(ax / 6);
        return plate(hash(lane * sgn, Math.floor((z + lane * 5) / 13), 2), 0.2, 0.05);
      }
      case DECK: {
        const t = terraceAt(y);
        if (side) {
          if (y === t.top) return 'white_concrete';
          if (y === t.top - 1) return hash(x, y, z) < 0.3 ? 'glowstone' : 'gray_concrete';
          return 'light_gray_concrete';
        }
        const lane = Math.floor(ax / 4);
        return plate(hash(lane * sgn, Math.floor((z + lane * 3) / 9), 4), 0.2, 0);
      }
      case TOWER:
        if (side && !up && y % 3 === 0) return hash(x, y, z) < 0.35 ? 'glowstone' : 'gray_concrete';
        return 'light_gray_concrete';
      case BRIDGE_P:
        if (side && !up && y === BRIDGE.y0 + 1) return 'gray_concrete';
        return up ? 'white_concrete' : 'light_gray_concrete';
      case DOME_P:
        return 'white_concrete';
      case HOUSING:
        return 'gray_concrete';
      case RIM:
        return 'light_gray_concrete';
      case THROAT:
        return 'black_concrete';
      case EXHAUST:
        return 'sea_lantern';
    }
    return undefined;
  }

  /** Visit every solid cell with its block. */
  forEachBlock(fn: (x: number, y: number, z: number, block: string) => void) {
    for (let y = LY0; y <= LY1; y++)
      for (let z = LZ0; z <= LZ1; z++)
        for (let x = -LX; x <= LX; x++) {
          const i = this.idx(x, y, z);
          const p = this.part[i];
          if (!p) continue;
          const b = this.paint(x, y, z, p, i);
          if (b) fn(x, y, z, b);
        }
  }
}

export function buildDestroyer(center: Vec3): Destroyer {
  const ship = new Ship();
  ship.hull();
  ship.superstructure();
  ship.tower();
  ship.belly();
  ship.engines();
  const mounts = ship.turrets();
  ship.greebles();

  const c = { x: Math.floor(center.x), y: Math.floor(center.y), z: Math.floor(center.z) };
  const at = (p: Vec3): Vec3 => ({ x: c.x + p.x, y: c.y + p.y, z: c.z + p.z });
  const bp = new Blueprint(at({ x: -LX, y: LY0, z: LZ0 }), { x: ship.sx, y: ship.sy, z: ship.sz });
  ship.forEachBlock((x, y, z, block) => bp.set(c.x + x, c.y + y, c.z + z, block));

  return {
    blueprint: bp,
    generators: DOME_X.map((x) => at({ x, y: DOME.y, z: DOME.z })),
    bridge: at({ x: 0, y: Math.round((BRIDGE.y0 + BRIDGE.y1) / 2), z: Math.round((BRIDGE.z0 + BRIDGE.z1) / 2) }),
    turrets: mounts.map(at),
    engines: NOZZLES.map((n) => at({ x: n.x, y: n.y, z: STERN + (n.r > 6 ? 3 : 2) })),
  };
}
