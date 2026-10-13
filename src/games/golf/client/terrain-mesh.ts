import { course, Surf, type Tree } from '../course';
import { WINDS } from '../course/wind';
import { BASE, CHUNK, CUP_DEPTH, CUP_R, PIN_HEIGHT, mulberry, noise2 } from '../scale';

/**
 * One square of the course (`CHUNK` blocks a side) as a glTF file, made from the same landscape
 * the ball rolls on: rolling turf (a vertex a block, shaded by its slope), painted four texels a
 * block and filtered smooth (fairways mown in stripes, greens cut in diamonds, a darker collar,
 * raked bunkers damp at the lip, the cart path, hollows shaded, grain in everything, soft edges
 * between them), its trees (low-poly oaks, birches and spruces), its cup (a round hole
 * with a liner) and its tee markers. Plain code: it runs in a worker (`terrain-worker.ts`), off
 * the game's thread. The flagstick and its flag are a model of their own (`flagFile`), so a
 * screen can take the pin out.
 */

const TEX = 4;
const TW = CHUNK * TEX;
/**
 * Under the painted ground: its last row repeated (so smooth filtering at the chunk's edge meets
 * grass, not the palette), then the palette rows, solid colours for trees, the cup, the flag.
 */
const PAD = 8;
const PAL_ROWS = 16;
const TH = TW + PAD + PAL_ROWS;

type RGB = [number, number, number];

const PALETTE: Record<string, RGB> = {
  oak_bark: [92, 66, 44],
  birch_bark: [214, 210, 196],
  spruce_bark: [74, 54, 38],
  oak_1: [58, 110, 40],
  oak_2: [70, 124, 46],
  oak_3: [50, 98, 36],
  birch_1: [104, 150, 58],
  birch_2: [118, 164, 66],
  spruce_1: [34, 78, 44],
  spruce_2: [42, 90, 50],
  liner: [236, 236, 230],
  hole: [34, 32, 28],
  pole: [244, 244, 236],
  flag: [220, 44, 38],
  flag_dark: [180, 32, 30],
  marker_white: [240, 240, 240],
  marker_red: [214, 50, 44],
};
const PAL_NAMES = Object.keys(PALETTE);
const palUV = (name: string): [number, number] => {
  const i = PAL_NAMES.indexOf(name);
  const cx = (i % 32) * 8 + 4;
  const cy = TW + PAD + Math.floor(i / 32) * 8 + 4;
  return [cx / TW, cy / TH];
};

// ---------------------------------------------------------------------------------------------
// The ground's colours
// ---------------------------------------------------------------------------------------------

const BASES: Record<Surf, RGB> = {
  [Surf.Out]: [64, 116, 42],
  [Surf.Rough]: [72, 128, 46],
  [Surf.Deep]: [62, 112, 40],
  [Surf.Fairway]: [104, 168, 60],
  [Surf.Fringe]: [92, 166, 62],
  [Surf.Green]: [116, 192, 80],
  [Surf.Tee]: [108, 180, 70],
  [Surf.Sand]: [224, 202, 146],
  [Surf.Water]: [66, 78, 56],
  [Surf.Path]: [178, 174, 164],
};

/** White noise per texel (four a block): grain. */
function grain(x: number, z: number, seed: number): number {
  let n = Math.imul(Math.floor(x * 4) + seed * 131, 374761393) ^ Math.imul(Math.floor(z * 4) - seed * 71, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 2147483648 - 1;
}

/**
 * The colour of the ground of one kind at a point: `v` / `u` along and across its hole (for the
 * mowing), `edge` how near another kind of ground (0 in the middle of it, up to 1 at its edge),
 * `ao` how much of a hollow it's in (shaded) or a crest (lit).
 */
function groundColor(x: number, z: number, surf: Surf, v: number, u: number, edge: number, ao: number, out: RGB): RGB {
  const b = BASES[surf];
  let k = 1;
  let warm = 0;
  switch (surf) {
    case Surf.Fairway: {
      // Mown in stripes across the line of play, a fainter cut along it, grain in the grass.
      const stripe = Math.floor(v / 5) % 2 === 0 ? 0.93 : 1.04;
      const cross = Math.floor(u / 6) % 2 === 0 ? 0.99 : 1.01;
      k = stripe * cross + noise2(x / 7, z / 7, 5) * 0.03 + grain(x, z, 1) * 0.025;
      break;
    }
    case Surf.Green: {
      // Cut in diamonds, fine and even.
      const d = (Math.floor((v + u) / 2.2) + Math.floor((v - u) / 2.2)) % 2 === 0 ? 0.965 : 1.03;
      k = d + noise2(x * 0.8, z * 0.8, 7) * 0.012 + grain(x, z, 2) * 0.012;
      break;
    }
    case Surf.Fringe:
      // The collar: a little longer, a shade darker.
      k = 0.98 + noise2(x / 1.5, z / 1.5, 8) * 0.025 + grain(x, z, 3) * 0.03;
      break;
    case Surf.Tee:
      k = (Math.floor(v / 1.8) % 2 === 0 ? 0.97 : 1.03) + grain(x, z, 4) * 0.02;
      break;
    case Surf.Sand: {
      // Raked in long sweeps, gritty, damp and shadowed where it meets the grass.
      const a = noise2(x / 12, z / 12, 14) * 1.5;
      const rake = Math.sin((x * Math.cos(a) + z * Math.sin(a)) * 7) * 0.025;
      k = 1 + rake + grain(x, z, 5) * 0.06 + noise2(x / 3, z / 3, 10) * 0.03 - edge * 0.14;
      break;
    }
    case Surf.Path:
      k = 1 + grain(x, z, 6) * 0.05 + noise2(x * 1.5, z * 1.5, 11) * 0.03 - edge * 0.08;
      break;
    case Surf.Water:
      k = 1 + noise2(x / 2, z / 2, 15) * 0.08;
      break;
    default: {
      // Rough and the plain: clumps, patches going yellow, a flower now and then.
      const clump = noise2(x / 1.3, z / 1.3, 4) * 0.08 + noise2(x / 5, z / 5, 6) * 0.06 + noise2(x / 23, z / 23, 12) * 0.06;
      k = 1 + clump + grain(x, z, 7) * 0.07;
      warm = Math.max(0, noise2(x / 17, z / 17, 16)) * 0.35;
      const f = grain(x, z, 8);
      if (f > 0.994 && surf !== Surf.Rough) {
        const y = grain(x, z, 9) > 0 ? [236, 226, 120] : [238, 238, 232];
        out[0] = y[0];
        out[1] = y[1];
        out[2] = y[2];
        return out;
      }
    }
  }
  // Hollows darker, crests a touch lighter.
  k *= 1 - Math.max(-0.07, Math.min(0.2, ao));
  const r = b[0] + (150 - b[0]) * warm * 0.5;
  const g = b[1] + (150 - b[1]) * warm * 0.2;
  const bl = b[2] + (70 - b[2]) * warm * 0.4;
  out[0] = Math.max(0, Math.min(255, r * k));
  out[1] = Math.max(0, Math.min(255, g * k));
  out[2] = Math.max(0, Math.min(255, bl * k));
  return out;
}

// ---------------------------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------------------------

class Mesh {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  idx: number[] = [];
  constructor(
    readonly ox: number,
    readonly oy: number,
    readonly oz: number,
  ) {}

  vert(x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number): number {
    this.pos.push(x - this.ox, y - this.oy, z - this.oz);
    this.nor.push(nx, ny, nz);
    this.uv.push(u, v);
    return this.pos.length / 3 - 1;
  }

  /** A flat triangle (its own normal), front face counter-clockwise, coloured from the palette. */
  tri(a: number[], b: number[], c: number[], uv: [number, number]) {
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    const i = this.vert(a[0], a[1], a[2], nx, ny, nz, uv[0], uv[1]);
    this.vert(b[0], b[1], b[2], nx, ny, nz, uv[0], uv[1]);
    this.vert(c[0], c[1], c[2], nx, ny, nz, uv[0], uv[1]);
    this.idx.push(i, i + 1, i + 2);
  }
}

/** Where a point of the ground falls in the chunk's texture. */
const groundUV = (x: number, z: number, x0: number, z0: number): [number, number] => [(x - x0) / CHUNK, ((z - z0) / CHUNK) * (TW / TH)];

function buildGround(m: Mesh, x0: number, z0: number, shaped: boolean, cup: { x: number; z: number } | null) {
  const n = shaped ? CHUNK : 1;
  const step = CHUNK / n;
  // Heights on the grid, a ring beyond the edges for the normals.
  const H = new Float64Array((n + 3) * (n + 3));
  const at = (i: number, j: number) => H[(j + 1) * (n + 3) + (i + 1)];
  for (let j = -1; j <= n + 1; j++) for (let i = -1; i <= n + 1; i++) H[(j + 1) * (n + 3) + (i + 1)] = shaped ? course.height(x0 + i * step, z0 + j * step) : BASE;
  const base = m.pos.length / 3;
  for (let j = 0; j <= n; j++)
    for (let i = 0; i <= n; i++) {
      const dx = (at(i + 1, j) - at(i - 1, j)) / (2 * step);
      const dz = (at(i, j + 1) - at(i, j - 1)) / (2 * step);
      const l = Math.hypot(dx, 1, dz);
      const x = x0 + i * step;
      const z = z0 + j * step;
      const [u, v] = groundUV(x, z, x0, z0);
      m.vert(x, at(i, j), z, -dx / l, 1 / l, -dz / l, u, v);
    }
  const cupCell = cup ? { i: Math.floor(cup.x) - x0, j: Math.floor(cup.z) - z0 } : null;
  const w = n + 1;
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      if (cupCell && i === cupCell.i && j === cupCell.j) continue;
      const a = base + j * w + i;
      const b = a + 1;
      const c = a + w;
      const d = c + 1;
      // (x, z), (x, z + 1), (x + 1, z) faces up counter-clockwise; then the other half.
      m.idx.push(a, c, b, b, c, d);
    }
  if (cup && cupCell) buildCup(m, x0, z0, cup, cupCell, at);
}

/** The cup: the green round it down to a ring, the liner, the bottom (the flagstick is `flagFile`). */
function buildCup(m: Mesh, x0: number, z0: number, cup: { x: number; z: number }, cell: { i: number; j: number }, at: (i: number, j: number) => number) {
  const N = 24;
  const cx = cup.x;
  const cz = cup.z;
  const top = course.height(cx, cz);
  // The cell's corners, for the height of its edges (so it meets its neighbours exactly).
  const h00 = at(cell.i, cell.j);
  const h10 = at(cell.i + 1, cell.j);
  const h01 = at(cell.i, cell.j + 1);
  const h11 = at(cell.i + 1, cell.j + 1);
  const edgeY = (fx: number, fz: number) => h00 * (1 - fx) * (1 - fz) + h10 * fx * (1 - fz) + h01 * (1 - fx) * fz + h11 * fx * fz;
  const cellX = x0 + cell.i;
  const cellZ = z0 + cell.j;
  const outer: number[][] = [];
  const ring: number[][] = [];
  for (let k = 0; k < N; k++) {
    const a = Math.PI / 4 + (k * Math.PI * 2) / N;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const e = 0.5 / Math.max(Math.abs(c), Math.abs(s));
    const ox = cx + c * e;
    const oz = cz + s * e;
    outer.push([ox, edgeY(ox - cellX, oz - cellZ), oz]);
    const rx = cx + c * CUP_R;
    const rz = cz + s * CUP_R;
    ring.push([rx, course.height(rx, rz), rz]);
  }
  // The green between the cell's edge and the hole, smooth-shaded like the rest.
  const vtx = (p: number[]) => {
    const s = course.slope(p[0], p[2]);
    const l = Math.hypot(s.x, 1, s.z);
    const [u, v] = groundUV(p[0], p[2], x0, z0);
    return m.vert(p[0], p[1], p[2], -s.x / l, 1 / l, -s.z / l, u, v);
  };
  const o = outer.map(vtx);
  const r = ring.map(vtx);
  for (let k = 0; k < N; k++) {
    const k1 = (k + 1) % N;
    // Each quad between the edge and the ring, its faces up.
    m.idx.push(o[k], r[k], o[k1], o[k1], r[k], r[k1]);
  }
  // The liner: white at the lip, dark below; facing in.
  const liner = palUV('liner');
  const hole = palUV('hole');
  const lip = 0.06;
  for (let k = 0; k < N; k++) {
    const k1 = (k + 1) % N;
    const a = ring[k];
    const b = ring[k1];
    const a1 = [a[0], a[1] - lip, a[2]];
    const b1 = [b[0], b[1] - lip, b[2]];
    const a2 = [a[0], top - CUP_DEPTH, a[2]];
    const b2 = [b[0], top - CUP_DEPTH, b[2]];
    // Facing in, toward the middle (seen from above and inside).
    m.tri(a, a1, b, liner);
    m.tri(b, a1, b1, liner);
    m.tri(a1, a2, b1, hole);
    m.tri(b1, a2, b2, hole);
  }
  // Its bottom.
  const bottom = [cx, top - CUP_DEPTH, cz];
  for (let k = 0; k < N; k++) {
    const k1 = (k + 1) % N;
    m.tri(bottom, [ring[k1][0], top - CUP_DEPTH, ring[k1][2]], [ring[k][0], top - CUP_DEPTH, ring[k][2]], hole);
  }
}

/** The flagstick's colours: its own little texture (a block of each), and where each is in it. */
const FLAG_COLOURS = ['pole', 'flag', 'flag_dark'];
const flagUV = (name: string): [number, number] => [(FLAG_COLOURS.indexOf(name) + 0.5) / FLAG_COLOURS.length, 0.5];

/**
 * A hole's flagstick and its flag, flying downwind: a model of its own (not part of the green's
 * square), so a screen can take it out while its golfer putts. Its origin is the cup's middle at
 * the world's base height.
 */
export function flagFile(hole: number): Uint8Array<ArrayBuffer> {
  const pin = course.holes[hole].green.pin;
  const m = new Mesh(pin.x, BASE, pin.z);
  buildFlag(m, hole, pin.x, pin.z);
  const px = new Uint8Array(FLAG_COLOURS.length * 8 * 8 * 3);
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < FLAG_COLOURS.length * 8; x++) px.set(PALETTE[FLAG_COLOURS[Math.floor(x / 8)]], (y * FLAG_COLOURS.length * 8 + x) * 3);
  return glb(m, png(FLAG_COLOURS.length * 8, 8, px));
}

function buildFlag(m: Mesh, hi: number, cx: number, cz: number) {
  const top = course.height(cx, cz);
  // The flagstick, standing in the middle of the cup.
  prism(m, cx, top - CUP_DEPTH, cz, 0.03, 0.03, CUP_DEPTH + PIN_HEIGHT, 6, flagUV('pole'));
  // The flag, flying downwind from the top (both sides).
  const w = WINDS[hi];
  const wl = Math.hypot(w.x, w.z);
  const fx = wl > 0.3 ? w.x / wl : 1;
  const fz = wl > 0.3 ? w.z / wl : 0;
  const yTop = top + PIN_HEIGHT - 0.02;
  const pts: number[][] = [];
  for (let s = 0; s <= 3; s++) {
    const d = 0.03 + (s / 3) * 0.85;
    const ripple = Math.sin(s * 1.9) * 0.05 * (s / 3);
    const px = cx + fx * d - fz * ripple;
    const pz = cz + fz * d + fx * ripple;
    const droop = (s / 3) * 0.08 * (1 - Math.min(1, wl / 6));
    pts.push([px, yTop - droop, pz], [px, yTop - 0.55 - droop, pz]);
  }
  for (let s = 0; s < 3; s++) {
    const [a, b, c, d] = [pts[s * 2], pts[s * 2 + 1], pts[s * 2 + 2], pts[s * 2 + 3]];
    const col = flagUV(s % 2 ? 'flag_dark' : 'flag');
    m.tri(a, b, c, col);
    m.tri(c, b, d, col);
    m.tri(a, c, b, col);
    m.tri(c, d, b, col);
  }
}

/** An upright prism (a trunk, a pole): `sides` faces, tapering from r0 to r1. */
function prism(m: Mesh, x: number, y: number, z: number, r0: number, r1: number, height: number, sides: number, uv: [number, number]) {
  for (let k = 0; k < sides; k++) {
    const a0 = (k / sides) * Math.PI * 2;
    const a1 = ((k + 1) / sides) * Math.PI * 2;
    const p0 = [x + Math.cos(a0) * r0, y, z + Math.sin(a0) * r0];
    const p1 = [x + Math.cos(a1) * r0, y, z + Math.sin(a1) * r0];
    const q0 = [x + Math.cos(a0) * r1, y + height, z + Math.sin(a0) * r1];
    const q1 = [x + Math.cos(a1) * r1, y + height, z + Math.sin(a1) * r1];
    // Its faces outward.
    m.tri(p0, q0, p1, uv);
    m.tri(p1, q0, q1, uv);
  }
}

/** A faceted blob (an icosahedron, split once): a clump of leaves. */
const ICO = (() => {
  const t = (1 + Math.sqrt(5)) / 2;
  let v = [
    [-1, t, 0],
    [1, t, 0],
    [-1, -t, 0],
    [1, -t, 0],
    [0, -1, t],
    [0, 1, t],
    [0, -1, -t],
    [0, 1, -t],
    [t, 0, -1],
    [t, 0, 1],
    [-t, 0, -1],
    [-t, 0, 1],
  ].map((p) => {
    const l = Math.hypot(p[0], p[1], p[2]);
    return p.map((c) => c / l);
  });
  let f = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];
  const mid = new Map<string, number>();
  const m = (a: number, b: number) => {
    const k = a < b ? `${a},${b}` : `${b},${a}`;
    if (!mid.has(k)) {
      const p = v[a].map((c, i) => (c + v[b][i]) / 2);
      const l = Math.hypot(p[0], p[1], p[2]);
      v.push(p.map((c) => c / l));
      mid.set(k, v.length - 1);
    }
    return mid.get(k)!;
  };
  f = f.flatMap(([a, b, c]) => {
    const ab = m(a, b);
    const bc = m(b, c);
    const ca = m(c, a);
    return [[a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]];
  });
  v = v.map((p) => [...p]);
  return { v, f };
})();

function blob(m: Mesh, x: number, y: number, z: number, rx: number, ry: number, rz: number, colours: string[], seed: number) {
  const rnd = mulberry(seed);
  // A little lumpy: each corner pushed in or out.
  const bumps = ICO.v.map(() => 0.88 + rnd() * 0.24);
  const p = ICO.v.map((q, i) => [x + q[0] * rx * bumps[i], y + q[1] * ry * bumps[i], z + q[2] * rz * bumps[i]]);
  for (const [a, b, c] of ICO.f) m.tri(p[a], p[b], p[c], palUV(colours[Math.floor(rnd() * colours.length)]));
}

function cone(m: Mesh, x: number, y: number, z: number, r: number, height: number, sides: number, colours: string[], seed: number) {
  const rnd = mulberry(seed);
  const tip = [x, y + height, z];
  for (let k = 0; k < sides; k++) {
    const a0 = (k / sides) * Math.PI * 2;
    const a1 = ((k + 1) / sides) * Math.PI * 2;
    const p0 = [x + Math.cos(a0) * r, y, z + Math.sin(a0) * r];
    const p1 = [x + Math.cos(a1) * r, y, z + Math.sin(a1) * r];
    const c = palUV(colours[Math.floor(rnd() * colours.length)]);
    m.tri(p0, tip, p1, c);
    m.tri(p0, p1, [x, y, z], c);
  }
}

function buildTree(m: Mesh, t: Tree, seed: number) {
  const y = t.base - 0.25;
  if (t.kind === 'spruce') {
    prism(m, t.x, y, t.z, 0.3, 0.12, t.trunk + 0.6, 6, palUV('spruce_bark'));
    const tiers = 3;
    for (let i = 0; i < tiers; i++) {
      const k = i / tiers;
      const r = t.r * (1.15 - k * 0.55);
      const base = t.base + 1.3 + k * (t.trunk - 1.8);
      cone(m, t.x, base, t.z, r, t.trunk * 0.5, 9, ['spruce_1', 'spruce_2'], seed + i);
    }
    return;
  }
  const birch = t.kind === 'birch';
  prism(m, t.x, y, t.z, birch ? 0.2 : 0.3, birch ? 0.14 : 0.22, t.cy + 0.25, 6, palUV(birch ? 'birch_bark' : 'oak_bark'));
  const leaves = birch ? ['birch_1', 'birch_2'] : ['oak_1', 'oak_2', 'oak_3'];
  const cy = t.base + t.cy;
  const rnd = mulberry(seed);
  blob(m, t.x, cy, t.z, t.r, t.h * 0.95, t.r, leaves, seed);
  for (let i = 0; i < (birch ? 2 : 3); i++) {
    const a = rnd() * Math.PI * 2;
    const d = t.r * 0.55;
    blob(m, t.x + Math.cos(a) * d, cy + (rnd() - 0.2) * t.h * 0.6, t.z + Math.sin(a) * d, t.r * 0.62, t.h * 0.6, t.r * 0.62, leaves, seed * 7 + i);
  }
}

// ---------------------------------------------------------------------------------------------
// Pictures and files
// ---------------------------------------------------------------------------------------------

function paint(x0: number, z0: number, shaped: boolean): Uint8Array {
  // The ground sampled twice a block (and a ring beyond the edges): what it is, where along and
  // across its hole, how high; then how near an edge each sample is, and how deep a hollow.
  const SPB = 2;
  const BORDER = 4;
  const N = CHUNK * SPB + BORDER * 2 + 1;
  const at = (i: number) => (i - BORDER + 0.5) / SPB;
  const surf = new Uint8Array(N * N);
  const vs = new Float32Array(N * N);
  const us = new Float32Array(N * N);
  const ys = new Float32Array(N * N);
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const k = j * N + i;
      if (!shaped) {
        surf[k] = Surf.Out;
        ys[k] = BASE;
        continue;
      }
      const g = course.ground(x0 + at(i), z0 + at(j));
      surf[k] = g.surf;
      vs[k] = g.v;
      us[k] = g.u;
      ys[k] = g.y;
    }
  const edge = new Float32Array(N * N);
  const ao = new Float32Array(N * N);
  for (let j = 2; j < N - 2; j++)
    for (let i = 2; i < N - 2; i++) {
      const k = j * N + i;
      let other = 0;
      for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) if (surf[k + dj * N + di] !== surf[k]) other++;
      edge[k] = Math.min(1, other / 8);
      ao[k] = ((ys[k - 2] + ys[k + 2] + ys[k - 2 * N] + ys[k + 2 * N]) / 4 - ys[k]) * 0.35;
    }

  const px = new Uint8Array(TW * TH * 3);
  const c: RGB = [0, 0, 0];
  const mix: RGB = [0, 0, 0];
  for (let ty = 0; ty < TW; ty++)
    for (let tx = 0; tx < TW; tx++) {
      const x = x0 + (tx + 0.5) / TEX;
      const z = z0 + (ty + 0.5) / TEX;
      // The four samples round the texel, blended: colours meet softly at the edges of things.
      const fx = (x - x0) * SPB - 0.5 + BORDER;
      const fz = (z - z0) * SPB - 0.5 + BORDER;
      const i0 = Math.floor(fx);
      const j0 = Math.floor(fz);
      const ax = fx - i0;
      const az = fz - j0;
      const k00 = j0 * N + i0;
      const ks = [k00, k00 + 1, k00 + N, k00 + N + 1];
      const ws = [(1 - ax) * (1 - az), ax * (1 - az), (1 - ax) * az, ax * az];
      const e = ws[0] * edge[ks[0]] + ws[1] * edge[ks[1]] + ws[2] * edge[ks[2]] + ws[3] * edge[ks[3]];
      const o = ws[0] * ao[ks[0]] + ws[1] * ao[ks[1]] + ws[2] * ao[ks[2]] + ws[3] * ao[ks[3]];
      const v = ws[0] * vs[ks[0]] + ws[1] * vs[ks[1]] + ws[2] * vs[ks[2]] + ws[3] * vs[ks[3]];
      const u = ws[0] * us[ks[0]] + ws[1] * us[ks[1]] + ws[2] * us[ks[2]] + ws[3] * us[ks[3]];
      const s0 = surf[ks[0]];
      const k = (ty * TW + tx) * 3;
      if (s0 === surf[ks[1]] && s0 === surf[ks[2]] && s0 === surf[ks[3]]) {
        groundColor(x, z, s0 as Surf, v, u, e, o, c);
        px[k] = c[0];
        px[k + 1] = c[1];
        px[k + 2] = c[2];
        continue;
      }
      mix[0] = mix[1] = mix[2] = 0;
      for (let n = 0; n < 4; n++) {
        if (ws[n] <= 0) continue;
        groundColor(x, z, surf[ks[n]] as Surf, vs[ks[n]], us[ks[n]], e, o, c);
        mix[0] += c[0] * ws[n];
        mix[1] += c[1] * ws[n];
        mix[2] += c[2] * ws[n];
      }
      px[k] = mix[0];
      px[k + 1] = mix[1];
      px[k + 2] = mix[2];
    }
  for (let y = TW; y < TW + PAD; y++) px.copyWithin(y * TW * 3, (TW - 1) * TW * 3, TW * TW * 3);
  PAL_NAMES.forEach((name, i) => {
    const col = PALETTE[name];
    const cx = (i % 32) * 8;
    const cy = TW + PAD + Math.floor(i / 32) * 8;
    for (let y = cy; y < cy + 8; y++)
      for (let x = cx; x < cx + 8; x++) {
        const k = (y * TW + x) * 3;
        px[k] = col[0];
        px[k + 1] = col[1];
        px[k + 2] = col[2];
      }
  });
  return png(TW, TH, px);
}

let crcTable: Uint32Array | null = null;
function crc32(buf: Uint8Array, from: number, to: number): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = from; i < to; i++) c = crcTable[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** An RGB PNG, stored rather than compressed (it's made and read on this screen). */
function png(w: number, h: number, rgb: Uint8Array): Uint8Array {
  const raw = new Uint8Array((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) raw.set(rgb.subarray(y * w * 3, (y + 1) * w * 3), y * (w * 3 + 1) + 1);
  // zlib: stored blocks of up to 65535 bytes, then the Adler-32.
  const blocks = Math.ceil(raw.length / 65535);
  const z = new Uint8Array(2 + raw.length + blocks * 5 + 4);
  z[0] = 0x78;
  z[1] = 0x01;
  let o = 2;
  for (let b = 0; b < blocks; b++) {
    const start = b * 65535;
    const len = Math.min(65535, raw.length - start);
    z[o++] = b === blocks - 1 ? 1 : 0;
    z[o++] = len & 255;
    z[o++] = len >>> 8;
    z[o++] = ~len & 255;
    z[o++] = (~len >>> 8) & 255;
    z.set(raw.subarray(start, start + len), o);
    o += len;
  }
  let a = 1;
  let bsum = 0;
  for (let i = 0; i < raw.length; i++) {
    a = (a + raw[i]) % 65521;
    bsum = (bsum + a) % 65521;
  }
  const adler = ((bsum << 16) | a) >>> 0;
  z[o++] = adler >>> 24;
  z[o++] = (adler >>> 16) & 255;
  z[o++] = (adler >>> 8) & 255;
  z[o++] = adler & 255;
  const chunks: [string, Uint8Array][] = [
    ['IHDR', new Uint8Array([w >>> 24, (w >>> 16) & 255, (w >>> 8) & 255, w & 255, h >>> 24, (h >>> 16) & 255, (h >>> 8) & 255, h & 255, 8, 2, 0, 0, 0])],
    ['IDAT', z],
    ['IEND', new Uint8Array(0)],
  ];
  const size = 8 + chunks.reduce((s, [, d]) => s + 12 + d.length, 0);
  const out = new Uint8Array(size);
  out.set([137, 80, 78, 71, 13, 10, 26, 10]);
  let p = 8;
  const dv = new DataView(out.buffer);
  for (const [type, data] of chunks) {
    dv.setUint32(p, data.length);
    for (let i = 0; i < 4; i++) out[p + 4 + i] = type.charCodeAt(i);
    out.set(data, p + 8);
    dv.setUint32(p + 8 + data.length, crc32(out, p + 4, p + 8 + data.length));
    p += 12 + data.length;
  }
  return out;
}

/** A binary glTF: one mesh (positions, normals, texture coordinates), one textured matte material. */
function glb(m: Mesh, image: Uint8Array): Uint8Array<ArrayBuffer> {
  const pos = new Float32Array(m.pos);
  const nor = new Float32Array(m.nor);
  const uv = new Float32Array(m.uv);
  const big = pos.length / 3 > 65535;
  const idx = big ? new Uint32Array(m.idx) : new Uint16Array(m.idx);
  const parts = [pos, nor, uv, idx, image];
  const views: { buffer: 0; byteOffset: number; byteLength: number; target?: number }[] = [];
  let length = 0;
  for (const [i, p] of parts.entries()) {
    length = Math.ceil(length / 4) * 4;
    views.push({ buffer: 0, byteOffset: length, byteLength: p.byteLength, ...(i < 3 ? { target: 34962 } : i === 3 ? { target: 34963 } : {}) });
    length += p.byteLength;
  }
  length = Math.ceil(length / 4) * 4;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3)
    for (let c = 0; c < 3; c++) {
      min[c] = Math.min(min[c], pos[i + c]);
      max[c] = Math.max(max[c], pos[i + c]);
    }
  const count = pos.length / 3;
  const json = {
    asset: { version: '2.0', generator: 'Blockyard Links client/terrain.ts' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, indices: 3, material: 0 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: 1 } }],
    textures: [{ sampler: 0, source: 0 }],
    samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 33071, wrapT: 33071 }],
    images: [{ bufferView: 4, mimeType: 'image/png' }],
    accessors: [
      { bufferView: 0, componentType: 5126, count, type: 'VEC3', min, max },
      { bufferView: 1, componentType: 5126, count, type: 'VEC3' },
      { bufferView: 2, componentType: 5126, count, type: 'VEC2' },
      { bufferView: 3, componentType: big ? 5125 : 5123, count: idx.length, type: 'SCALAR' },
    ],
    bufferViews: views,
    buffers: [{ byteLength: length }],
  };
  let text = new TextEncoder().encode(JSON.stringify(json));
  const pad = (4 - (text.length % 4)) % 4;
  if (pad) {
    const t = new Uint8Array(text.length + pad).fill(0x20);
    t.set(text);
    text = t;
  }
  const out = new Uint8Array(12 + 8 + text.length + 8 + length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, out.length, true);
  dv.setUint32(12, text.length, true);
  dv.setUint32(16, 0x4e4f534a, true);
  out.set(text, 20);
  const bin = 20 + text.length;
  dv.setUint32(bin, length, true);
  dv.setUint32(bin + 4, 0x004e4942, true);
  parts.forEach((p, i) => out.set(new Uint8Array(p.buffer, p.byteOffset, p.byteLength), bin + 8 + views[i].byteOffset));
  return out;
}

/** One square of the course, as a glTF file. */
export function chunkFile(x0: number, z0: number, shaped: boolean): Uint8Array<ArrayBuffer> {
  const m = new Mesh(x0, BASE, z0);
  const pin = course.holes.map((h) => h.green.pin).find((p) => p.x >= x0 && p.x < x0 + CHUNK && p.z >= z0 && p.z < z0 + CHUNK) ?? null;
  buildGround(m, x0, z0, shaped, pin);
  for (const t of course.trees) if (t.x >= x0 && t.x < x0 + CHUNK && t.z >= z0 && t.z < z0 + CHUNK) buildTree(m, t, Math.floor(t.x * 131 + t.z * 7919));
  for (const h of course.holes) {
    const l = h.legs[0];
    for (const side of [-1, 1]) {
      const x = h.tee.x + l.dx * 2.5 - l.dz * side * 2.6;
      const z = h.tee.z + l.dz * 2.5 + l.dx * side * 2.6;
      if (x < x0 || x >= x0 + CHUNK || z < z0 || z >= z0 + CHUNK) continue;
      blob(m, x, course.height(x, z) + 0.08, z, 0.14, 0.12, 0.14, [h.par === 3 ? 'marker_red' : 'marker_white'], h.index * 2 + side);
    }
  }
  return glb(m, paint(x0, z0, shaped));
}

