/**
 * Block Ice's models, built in code (Node 22+, no dependencies): the puck; the rink's markings (one
 * painted plane over the ice: the lines, the circles, the creases, the logo); the boards round it
 * (white, a yellow kick plate, the rail, the glass's stanchions, ad panels); a goal (its frame) and
 * its net (apart, so each screen can bulge it); a stick; a skate's blade; a helmet in each team's
 * colour; a goalie's mask, pads, glove and blocker; the goal light. Written to `models/`.
 *
 *   node src/games/blockice/tools/models.mjs
 *
 * Sizes are in blocks (metres), from `rink.ts`. The goal's origin is the middle of its goal line on
 * the ice, the net out behind it along +x (the right-hand goal; each screen turns the left one round).
 * The gear's origins are the joints they hang from (the head, a foot, a shin, a hand), +z ahead.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { png, writeGlb } from './voxel.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '../models');

// The rink's numbers (kept in step with rink.ts).
const HALF_LENGTH = 20;
const HALF_WIDTH = 9.5;
const CORNER = 5;
const BOARDS = 1.15;
const GOAL_X = 16.6;
const GOAL_HALF_WIDTH = 1.1;
const GOAL_HEIGHT = 1.25;
const GOAL_DEPTH = 1.05;
const POST = 0.055;
const CREASE = 1.7;
const BLUE_LINE = 6;
const CENTER_CIRCLE = 4;
const DOT_X = 11.4;
const DOT_Z = 4.6;
const DOT_CIRCLE = 3.2;
const PUCK_RADIUS = 0.15;
const PUCK_HALF = 0.045;
/** The teams' helmets (kept in step with teams.ts). */
const HELMETS = { yetis: '#1d3f73', blades: '#16181f', rhinos: '#d8262e', jacks: '#123d26' };
/** A character's voxel (the platform's: `character/build.ts`). */
const V = 1 / 26;

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

/**
 * A mesh of flat-coloured faces: each colour a texel of a one-row palette texture, with how rough
 * and metallic it is, and how much it glows.
 */
class Mesh {
  constructor(colours) {
    this.names = Object.keys(colours);
    this.colours = colours;
    this.pos = [];
    this.nor = [];
    this.uv = [];
    this.idx = [];
  }
  u(col) {
    const i = this.names.indexOf(col);
    if (i < 0) throw new Error(`no colour ${col}`);
    return Math.round(((i + 0.5) / this.names.length) * 65535);
  }
  vert(p, n, col) {
    this.pos.push(...p);
    this.nor.push(...n);
    this.uv.push(this.u(col), 32768);
    return this.pos.length / 3 - 1;
  }
  quad(a, b, c, d, n, col) {
    const i = [a, b, c, d].map((p) => this.vert(p, n, col));
    this.idx.push(i[0], i[1], i[2], i[0], i[2], i[3]);
  }
  /** An axis-aligned box, faces outward. */
  box(x0, y0, z0, x1, y1, z1, col) {
    this.quad([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [0, 1, 0], col);
    this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0], col);
    this.quad([x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0], [0, 0, -1], col);
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], col);
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], col);
    this.quad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], [1, 0, 0], col);
  }
  /** A box along a segment (a tube, a strut, a string): `w` across. */
  strut(a, b, w, col) {
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const l = Math.hypot(...d) || 1;
    const f = d.map((q) => q / l);
    const up = Math.abs(f[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
    let s = [f[1] * up[2] - f[2] * up[1], f[2] * up[0] - f[0] * up[2], f[0] * up[1] - f[1] * up[0]];
    const sl = Math.hypot(...s);
    s = s.map((q) => (q / sl) * (w / 2));
    let t = [f[1] * s[2] - f[2] * s[1], f[2] * s[0] - f[0] * s[2], f[0] * s[1] - f[1] * s[0]];
    const tl = Math.hypot(...t);
    t = t.map((q) => (q / tl) * (w / 2));
    const c = (p, i, j) => [p[0] + s[0] * i + t[0] * j, p[1] + s[1] * i + t[1] * j, p[2] + s[2] * i + t[2] * j];
    const ring = (p) => [c(p, -1, -1), c(p, 1, -1), c(p, 1, 1), c(p, -1, 1)];
    const A = ring(a);
    const B = ring(b);
    for (let k = 0; k < 4; k++) {
      const k1 = (k + 1) % 4;
      const mid = [(A[k][0] + A[k1][0]) / 2 - a[0], (A[k][1] + A[k1][1]) / 2 - a[1], (A[k][2] + A[k1][2]) / 2 - a[2]];
      const ml = Math.hypot(...mid) || 1;
      this.quad(A[k], A[k1], B[k1], B[k], mid.map((q) => q / ml), col);
    }
    this.quad(A[3], A[2], A[1], A[0], f.map((q) => -q), col);
    this.quad(B[0], B[1], B[2], B[3], f, col);
  }
  /** An upright cylinder (`n` sides): its middle at `c`, from `y0` to `y1`, capped. */
  cylinder(c, r, y0, y1, n, col, top = col) {
    for (let k = 0; k < n; k++) {
      const a0 = (k / n) * Math.PI * 2;
      const a1 = ((k + 1) / n) * Math.PI * 2;
      const p0 = [c[0] + Math.cos(a0) * r, c[2] + Math.sin(a0) * r];
      const p1 = [c[0] + Math.cos(a1) * r, c[2] + Math.sin(a1) * r];
      const nm = [Math.cos((a0 + a1) / 2), 0, Math.sin((a0 + a1) / 2)];
      this.quad([p0[0], y0, p0[1]], [p0[0], y1, p0[1]], [p1[0], y1, p1[1]], [p1[0], y0, p1[1]], nm, col);
      this.tri3([c[0], y1, c[2]], [p1[0], y1, p1[1]], [p0[0], y1, p0[1]], [0, 1, 0], top);
      this.tri3([c[0], y0, c[2]], [p0[0], y0, p0[1]], [p1[0], y0, p1[1]], [0, -1, 0], col);
    }
  }
  tri3(a, b, c, n, col) {
    const i = [a, b, c].map((p) => this.vert(p, n, col));
    this.idx.push(...i);
  }
  glb(name) {
    const n = this.names.length;
    const tex = { w: n, h: 1, px: new Uint8Array(n * 4) };
    const mr = { w: n, h: 1, px: new Uint8Array(n * 4) };
    const glow = { w: n, h: 1, px: new Uint8Array(n * 4) };
    let glows = false;
    this.names.forEach((c, i) => {
      const k = this.colours[c];
      tex.px.set([...hex(k.rgb), 255], i * 4);
      mr.px.set([0, Math.round((k.rough ?? 0.85) * 255), Math.round((k.metal ?? 0) * 255), 255], i * 4);
      const g = k.glow ?? 0;
      if (g > 0) glows = true;
      glow.px.set([...hex(k.rgb).map((q) => Math.round(q * g)), 255], i * 4);
    });
    return writeGlb({
      generator: `Block Ice src/games/blockice/tools/models.mjs`,
      nodes: [{ name, children: [1] }, { name: `${name}_body` }],
      sceneName: name,
      meshName: `${name}_body`,
      meshNode: 1,
      attributes: {
        POSITION: { values: this.pos, componentType: 5126, type: 'VEC3', minmax: true },
        NORMAL: { values: this.nor, componentType: 5126, type: 'VEC3' },
        TEXCOORD_0: { values: this.uv, componentType: 5123, type: 'VEC2', normalized: true },
      },
      indices: this.idx,
      material: { name, albedo: png(tex), mr: png(mr), ...(glows ? { glow: png(glow) } : {}) },
      compress: true,
    });
  }
}

function save(file, bytes) {
  writeFileSync(join(OUT, file), bytes);
  console.log(`${file.padEnd(18)} ${bytes.length} bytes`);
}

// ---------------------------------------------------------------------------------------------
// The puck: black vulcanised rubber, a grippy band round its edge, a logo on top. Its middle at
// the origin.

function puck() {
  const m = new Mesh({ rubber: { rgb: '#141417', rough: 0.75 }, band: { rgb: '#26262c', rough: 0.95 }, logo: { rgb: '#3fa9f5', rough: 0.6 } });
  m.cylinder([0, 0, 0], PUCK_RADIUS, -PUCK_HALF, PUCK_HALF, 18, 'rubber');
  m.cylinder([0, 0, 0], PUCK_RADIUS + 0.004, -PUCK_HALF * 0.45, PUCK_HALF * 0.45, 18, 'band');
  m.cylinder([0, 0, 0], PUCK_RADIUS * 0.45, PUCK_HALF, PUCK_HALF + 0.003, 12, 'logo');
  return m.glb('ice_puck');
}

// ---------------------------------------------------------------------------------------------
// The boards: walked round the rounded rectangle, each piece a wall (white, the yellow kick plate
// at the bottom, a rail along the top), ad panels on the inside along the far side and the ends,
// and the glass's stanchions and top rail over the far side and the ends (the camera's side has
// none: it looks over).

/** The rink's outline, counter-clockwise from above: points round the rounded rectangle, and each one's inward normal. */
function outline(inset = 0) {
  const pts = [];
  const cx = HALF_LENGTH - CORNER;
  const cz = HALF_WIDTH - CORNER;
  const r = CORNER - inset;
  const N = 14;
  // Corners in order: (+x,+z), (-x,+z), (-x,-z), (+x,-z), each an arc, the straights joining them.
  const corners = [[cx, cz, 0], [-cx, cz, Math.PI / 2], [-cx, -cz, Math.PI], [cx, -cz, Math.PI * 1.5]];
  for (const [ox, oz, a0] of corners) {
    for (let k = 0; k <= N; k++) {
      const a = a0 + (k / N) * (Math.PI / 2);
      pts.push({ x: ox + Math.cos(a) * r, z: oz + Math.sin(a) * r, nx: -Math.cos(a), nz: -Math.sin(a) });
    }
  }
  return pts;
}

function boards() {
  const m = new Mesh({
    white: { rgb: '#f2f4f7', rough: 0.55 },
    kick: { rgb: '#ffd23f', rough: 0.6 },
    rail: { rgb: '#1d3f73', rough: 0.45, metal: 0.2 },
    back: { rgb: '#c9ced8', rough: 0.7 },
    steel: { rgb: '#9aa3b2', rough: 0.35, metal: 0.7 },
    adRed: { rgb: '#d8262e', rough: 0.5 },
    adBlue: { rgb: '#3fa9f5', rough: 0.5 },
    adGold: { rgb: '#ffd23f', rough: 0.5 },
    adInk: { rgb: '#16181f', rough: 0.5 },
    adWhite: { rgb: '#ffffff', rough: 0.5 },
  });
  const T = 0.16;
  const KICK = 0.24;
  const pts = outline();
  const n = pts.length;
  // Lengths along the outline (for the ads and the stanchions).
  let along = 0;
  const at = [0];
  for (let i = 1; i <= n; i++) {
    const a = pts[i - 1];
    const b = pts[i % n];
    along += Math.hypot(b.x - a.x, b.z - a.z);
    at.push(along);
  }
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (len < 1e-6) continue;
    // The inner face (toward the ice), the kick plate under it; the top; the outer face.
    const ia = [a.x, a.z];
    const ib = [b.x, b.z];
    const oa = [a.x - a.nx * T, a.z - a.nz * T];
    const ob = [b.x - b.nx * T, b.z - b.nz * T];
    const nIn = [(a.nx + b.nx) / 2, 0, (a.nz + b.nz) / 2];
    const nl = Math.hypot(nIn[0], nIn[2]) || 1;
    const ni = [nIn[0] / nl, 0, nIn[2] / nl];
    m.quad([ia[0], 0, ia[1]], [ib[0], 0, ib[1]], [ib[0], KICK, ib[1]], [ia[0], KICK, ia[1]], ni, 'kick');
    // An ad panel on the far side's and the ends' straights, every few metres.
    const mid = (at[i] + at[i + 1]) / 2;
    const straight = Math.abs(a.nx - b.nx) < 1e-6 && Math.abs(a.nz - b.nz) < 1e-6;
    const camSide = a.nz < -0.5;
    let face = 'white';
    if (straight && !camSide) {
      const slot = Math.floor(mid / 3.2);
      face = ['adRed', 'white', 'adBlue', 'white', 'adGold', 'white', 'adInk', 'white'][slot % 8];
    }
    m.quad([ia[0], KICK, ia[1]], [ib[0], KICK, ib[1]], [ib[0], BOARDS, ib[1]], [ia[0], BOARDS, ia[1]], ni, face);
    m.quad([ia[0], BOARDS, ia[1]], [ib[0], BOARDS, ib[1]], [ob[0], BOARDS, ob[1]], [oa[0], BOARDS, oa[1]], [0, 1, 0], 'rail');
    m.quad([oa[0], 0, oa[1]], [oa[0], BOARDS, oa[1]], [ob[0], BOARDS, ob[1]], [ob[0], 0, ob[1]], [-ni[0], 0, -ni[2]], 'back');
    // The rail's lip over the inner face.
    m.quad([ia[0] + ni[0] * 0.03, BOARDS - 0.07, ia[1] + ni[2] * 0.03], [ib[0] + ni[0] * 0.03, BOARDS - 0.07, ib[1] + ni[2] * 0.03], [ib[0] + ni[0] * 0.03, BOARDS, ib[1] + ni[2] * 0.03], [ia[0] + ni[0] * 0.03, BOARDS, ia[1] + ni[2] * 0.03], ni, 'rail');
  }
  // The ads' white bands (a stripe across each coloured panel: a logo's line).
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const straight = Math.abs(a.nx - b.nx) < 1e-6 && Math.abs(a.nz - b.nz) < 1e-6;
    if (!straight || a.nz < -0.5) continue;
    const mid = (at[i] + at[i + 1]) / 2;
    const slot = Math.floor(mid / 3.2) % 8;
    if (slot % 2 === 1) continue;
    const off = 0.004;
    const col = slot === 6 ? 'adGold' : 'adWhite';
    const p = (q, y) => [q.x + q.nx * off, y, q.z + q.nz * off];
    m.quad(p(a, 0.62), p(b, 0.62), p(b, 0.74), p(a, 0.74), [a.nx, 0, a.nz], col);
  }
  // The glass's stanchions and the top rail: over the far side and the ends (not the camera's side).
  const GLASS = 1.75;
  let next = 0;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    if (a.nz < -0.5) continue;
    if (at[i] < next) continue;
    next = at[i] + 2.4;
    const x = a.x - a.nx * T * 0.5;
    const z = a.z - a.nz * T * 0.5;
    m.box(x - 0.03, BOARDS, z - 0.03, x + 0.03, BOARDS + GLASS, z + 0.03, 'steel');
  }
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    if (a.nz < -0.5 || b.nz < -0.5) continue;
    m.strut([a.x - a.nx * T * 0.5, BOARDS + GLASS, a.z - a.nz * T * 0.5], [b.x - b.nx * T * 0.5, BOARDS + GLASS, b.z - b.nz * T * 0.5], 0.06, 'steel');
  }
  return m.glb('ice_boards');
}

// ---------------------------------------------------------------------------------------------
// The goal: red posts and crossbar, the white base frame on the ice running back round the net,
// its origin the middle of the goal line. The net apart: a mesh of strings over the back, the
// sides and the top.

function goalFrame() {
  const m = new Mesh({ red: { rgb: '#e0242c', rough: 0.35, metal: 0.4 }, white: { rgb: '#f2f2f2', rough: 0.5, metal: 0.2 } });
  const W = GOAL_HALF_WIDTH;
  const H = GOAL_HEIGHT;
  const D = GOAL_DEPTH;
  const w = POST * 2;
  m.strut([0, 0, -W], [0, H, -W], w, 'red');
  m.strut([0, 0, W], [0, H, W], w, 'red');
  m.strut([0, H, -W], [0, H, W], w, 'red');
  // The base: round the back on the ice, and up to the top's back corners.
  const back = [[D * 0.55, 0, -W], [D, 0, -W * 0.55], [D, 0, W * 0.55], [D * 0.55, 0, W]];
  m.strut([0, 0.02, -W], back[0], 0.05, 'white');
  for (let i = 0; i < back.length - 1; i++) m.strut(back[i], back[i + 1], 0.05, 'white');
  m.strut(back[3], [0, 0.02, W], 0.05, 'white');
  m.strut([0, H, -W], [D * 0.35, H * 0.92, -W * 0.9], 0.04, 'red');
  m.strut([0, H, W], [D * 0.35, H * 0.92, W * 0.9], 0.04, 'red');
  return m.glb('ice_goal');
}

function goalNet() {
  const m = new Mesh({ string: { rgb: '#f4f4f0', rough: 0.95 } });
  const W = GOAL_HALF_WIDTH;
  const H = GOAL_HEIGHT;
  const D = GOAL_DEPTH;
  // The net's shape: from the top's back edge (out a little) down to the base round the back.
  const top = (u) => [D * 0.35, H * 0.92, -W * 0.9 + u * W * 1.8];
  const base = (u) => {
    // Round the back: u 0..1 along it.
    const pts = [[0, 0, -W], [D * 0.55, 0, -W], [D, 0, -W * 0.55], [D, 0, W * 0.55], [D * 0.55, 0, W], [0, 0, W]];
    const seg = u * (pts.length - 1);
    const i = Math.min(pts.length - 2, Math.floor(seg));
    const k = seg - i;
    return pts[i].map((q, j) => q + (pts[i + 1][j] - q) * k);
  };
  const lerp3 = (a, b, k) => a.map((q, j) => q + (b[j] - q) * k);
  const S = 0.012;
  // The back and the sides: strings from the top's line down to the base, and across.
  const cols = 14;
  const rows = 6;
  for (let c = 0; c <= cols; c++) {
    const u = c / cols;
    const t = u < 0.2 ? lerp3([0, H, -W], top(0), u / 0.2) : u > 0.8 ? lerp3(top(1), [0, H, W], (u - 0.8) / 0.2) : top((u - 0.2) / 0.6);
    m.strut(t, base(u), S, 'string');
  }
  for (let r = 1; r < rows; r++) {
    const k = r / rows;
    for (let c = 0; c < cols; c++) {
      const pt = (u) => {
        const t = u < 0.2 ? lerp3([0, H, -W], top(0), u / 0.2) : u > 0.8 ? lerp3(top(1), [0, H, W], (u - 0.8) / 0.2) : top((u - 0.2) / 0.6);
        return lerp3(t, base(u), k);
      };
      m.strut(pt(c / cols), pt((c + 1) / cols), S, 'string');
    }
  }
  // The roof: from the crossbar back to the top's line.
  for (let c = 0; c <= 8; c++) {
    const z = -W + (c / 8) * W * 2;
    m.strut([0, H, z], [D * 0.35, H * 0.92, z * 0.9], S, 'string');
  }
  for (let r = 1; r <= 2; r++) {
    const k = r / 3;
    m.strut([D * 0.35 * k, H - H * 0.08 * k, -W + W * 0.1 * k], [D * 0.35 * k, H - H * 0.08 * k, W - W * 0.1 * k], S, 'string');
  }
  return m.glb('ice_net');
}

// ---------------------------------------------------------------------------------------------
// The rink's markings: one plane the size of the rink, painted at PX pixels a block: the ice, the
// red centre line and goal lines, the blue lines, the circles and dots, the creases, and the logo
// at centre ice. Its origin the rink's middle, at ice level. Outside the boards' corners it's the
// walkway's rubber (the boards stand on the line).

const PX = 20;
const FONT = {
  B: ['####.', '#...#', '####.', '#...#', '#...#', '####.'],
  L: ['#....', '#....', '#....', '#....', '#....', '#####'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '.###.'],
  C: ['.####', '#....', '#....', '#....', '#....', '.####'],
  K: ['#...#', '#..#.', '###..', '#..#.', '#...#', '#...#'],
  I: ['###', '.#.', '.#.', '.#.', '.#.', '###'],
  E: ['#####', '#....', '####.', '#....', '#....', '#####'],
  ' ': ['...', '...', '...', '...', '...', '...'],
};

function rink() {
  const L = HALF_LENGTH;
  const Wd = HALF_WIDTH;
  const w = Math.round(L * 2 * PX);
  const h = Math.round(Wd * 2 * PX);
  const px = new Uint8Array(w * h * 4);
  const rnd = (x, y, k = 0) => {
    let q = Math.imul(x + 31, 374761393) + Math.imul(y + 17, 668265263) + Math.imul(k + 7, 1274126177);
    q = Math.imul(q ^ (q >>> 13), 1274126177);
    return ((q ^ (q >>> 16)) >>> 0) / 4294967296;
  };
  const set = (x, y, c) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    px.set([c[0], c[1], c[2], 255], (y * w + x) * 4);
  };
  const get = (x, y) => [px[(y * w + x) * 4], px[(y * w + x) * 4 + 1], px[(y * w + x) * 4 + 2]];
  const ICE = hex('#eef5fa');
  const ICE2 = hex('#e6eff6');
  const MAT = hex('#23262f');
  const RED = hex('#d8262e');
  const BLUE = hex('#2f6fe0');
  const CREASE_BLUE = hex('#7fc4f0');
  const wx = (x) => (x + 0.5) / PX - L;
  const wz = (y) => (y + 0.5) / PX - Wd;
  const inside = (X, Z) => {
    const ax = Math.abs(X);
    const az = Math.abs(Z);
    const cx = L - CORNER;
    const cz = Wd - CORNER;
    if (ax > cx && az > cz) return Math.hypot(ax - cx, az - cz) <= CORNER;
    return ax <= L && az <= Wd;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const X = wx(x);
      const Z = wz(y);
      if (!inside(X, Z)) {
        set(x, y, MAT);
        continue;
      }
      // The ice: a cool white, a little cloudy, faint skate marks.
      let c = rnd(x >> 3, y >> 3, 1) < 0.5 ? ICE : ICE2;
      if (rnd(x, y, 2) < 0.02) c = hex('#d6e4ee');
      set(x, y, c);
    }
  }
  const paint = (f, col) => {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const X = wx(x);
        const Z = wz(y);
        if (inside(X, Z) && f(X, Z)) set(x, y, col);
      }
    }
  };
  const near = (v, half) => Math.abs(v) < half;
  // The creases: a half circle in front of each goal, filled pale blue, a red edge.
  for (const s of [-1, 1]) {
    const gx = s * GOAL_X;
    paint((X, Z) => s * (gx - X) >= 0 && Math.hypot(X - gx, Z) <= CREASE, CREASE_BLUE);
    paint((X, Z) => s * (gx - X) >= 0 && near(Math.hypot(X - gx, Z) - CREASE, 0.05), RED);
  }
  // The centre line (red, a dotted look), the blue lines, the goal lines.
  paint((X) => near(X, 0.16), RED);
  paint((X, Z) => near(X, 0.16) && Math.floor((Z + 20) / 0.5) % 2 === 0 && near(Math.abs(X) - 0.1, 0.04), hex('#ffffff'));
  for (const s of [-1, 1]) {
    paint((X) => near(X - s * BLUE_LINE, 0.17), BLUE);
    paint((X) => near(X - s * GOAL_X, 0.05), RED);
  }
  // The centre circle and dot (blue), the end zones' circles and dots (red), the neutral dots.
  paint((X, Z) => near(Math.hypot(X, Z) - CENTER_CIRCLE, 0.06), BLUE);
  paint((X, Z) => Math.hypot(X, Z) < 0.2, BLUE);
  for (const s of [-1, 1]) {
    for (const t of [-1, 1]) {
      const dx = s * DOT_X;
      const dz = t * DOT_Z;
      paint((X, Z) => near(Math.hypot(X - dx, Z - dz) - DOT_CIRCLE, 0.05), RED);
      paint((X, Z) => Math.hypot(X - dx, Z - dz) < 0.3, RED);
      // The hash marks off the circle's sides.
      paint((X, Z) => near(Math.abs(Z - dz) - DOT_CIRCLE - 0.3, 0.3) && near(Math.abs(X - dx) - 0.45, 0.04), RED);
      const nx = s * (BLUE_LINE - 1.5);
      paint((X, Z) => Math.hypot(X - nx, Z - dz) < 0.25, RED);
    }
  }
  // The logo at centre ice: BLOCK over ICE, under the circle's dot, a little faded into the ice.
  const word = (text, cy, scale, col) => {
    const widths = [...text].map((ch) => (FONT[ch] ?? FONT[' '])[0].length);
    const cols = widths.reduce((a, b) => a + b + 1, -1);
    let x0 = Math.round(w / 2 - (cols * scale) / 2);
    const y0 = Math.round(cy - (6 * scale) / 2);
    [...text].forEach((ch, i) => {
      const g = FONT[ch] ?? FONT[' '];
      g.forEach((rowS, gy) => {
        [...rowS].forEach((p, gx) => {
          if (p !== '#') return;
          for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) {
            const X = x0 + gx * scale + sx;
            const Y = y0 + gy * scale + sy;
            if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
            const under = get(X, Y);
            set(X, Y, under.map((q, k) => Math.round(q * 0.25 + col[k] * 0.75)));
          }
        });
      });
      x0 += (widths[i] + 1) * scale;
    });
  };
  word('BLOCK', h / 2 - 22, 5, hex('#1d3f73'));
  word('ICE', h / 2 + 22, 6, hex('#3fa9f5'));

  const pos = [-L, 0, -Wd, L, 0, -Wd, L, 0, Wd, -L, 0, Wd];
  const nor = [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0];
  const uv = [0, 0, 65535, 0, 65535, 65535, 0, 65535];
  // The ice shines a little (rough 0.25), the rest is matte; one roughness for the plane.
  const mr = { w: 2, h: 2, px: new Uint8Array(16).map((_, i) => (i % 4 === 1 ? 70 : 0)) };
  return writeGlb({
    generator: 'Block Ice src/games/blockice/tools/models.mjs',
    nodes: [{ name: 'ice_rink', children: [1] }, { name: 'ice_rink_body' }],
    sceneName: 'ice_rink',
    meshName: 'ice_rink_body',
    meshNode: 1,
    attributes: {
      POSITION: { values: pos, componentType: 5126, type: 'VEC3', minmax: true },
      NORMAL: { values: nor, componentType: 5126, type: 'VEC3' },
      TEXCOORD_0: { values: uv, componentType: 5123, type: 'VEC2', normalized: true },
    },
    indices: [0, 3, 2, 0, 2, 1],
    material: { name: 'ice_rink', albedo: png({ w, h, px }), mr: png(mr) },
  });
}

// ---------------------------------------------------------------------------------------------
// The stick: its knob at the origin, the shaft down -y, the blade at the bottom out along +z
// (ahead), taped. 1.45 long to the heel.

export const STICK = 1.45;

function stick() {
  const m = new Mesh({ shaft: { rgb: '#2a2d36', rough: 0.4, metal: 0.2 }, grip: { rgb: '#e9e9e4', rough: 0.95 }, blade: { rgb: '#1c1e25', rough: 0.5 }, tape: { rgb: '#f4f4ee', rough: 0.95 } });
  const s = 0.028;
  m.box(-s, -STICK, -s, s, 0, s, 'shaft');
  m.box(-s - 0.004, -0.2, -s - 0.004, s + 0.004, 0.01, s + 0.004, 'grip');
  // The blade: low, long, thin, curving a touch.
  m.box(-0.012, -STICK - 0.02, -0.03, 0.012, -STICK + 0.07, 0.3, 'blade');
  m.box(-0.015, -STICK - 0.015, 0.02, 0.015, -STICK + 0.06, 0.24, 'tape');
  return m.glb('ice_stick');
}

/** A skate's blade and holder, under the boot: its origin the ankle joint, the runner on the ice 3 voxels below. */
function blade() {
  const m = new Mesh({ steel: { rgb: '#d9dde4', rough: 0.2, metal: 0.9 }, holder: { rgb: '#111216', rough: 0.6 } });
  const ground = -3 * V;
  m.box(-0.012, ground - 0.035, -3.2 * V, 0.012, ground + 0.005, 5.5 * V, 'steel');
  m.box(-0.03, ground + 0.004, -2.8 * V, 0.03, ground + 0.04, 5 * V, 'holder');
  return m.glb('ice_blade');
}

/**
 * A helmet, over the head (the head joint's space, before the head's made big): a shell over the
 * crown and the back, ear guards down the sides, a brow over the eyes, a visor's strip, vents.
 * The skull spans x -6..6, y 0..12, z -5..6 voxels from the joint (the face at the front).
 */
function helmet(color) {
  const m = new Mesh({ shell: { rgb: color, rough: 0.35 }, visor: { rgb: '#c8e6f7', rough: 0.15, metal: 0.3 }, strap: { rgb: '#16181f', rough: 0.8 }, vent: { rgb: '#0b0c10', rough: 0.9 } });
  const b = (x0, y0, z0, x1, y1, z1, c) => m.box(x0 * V, y0 * V, z0 * V, x1 * V, y1 * V, z1 * V, c);
  b(-6.7, 8.6, -6.2, 6.7, 13.4, 6.3, 'shell');
  b(-7, 4, -6.2, -5.9, 9.5, 2.5, 'shell');
  b(5.9, 4, -6.2, 7, 9.5, 2.5, 'shell');
  b(-6.7, 4.5, -6.6, 6.7, 9.5, -5.6, 'shell');
  b(-5.6, 7.9, 6.1, 5.6, 8.7, 6.9, 'visor');
  b(-2.2, 13.3, -3, -1.2, 13.6, 3, 'vent');
  b(1.2, 13.3, -3, 2.2, 13.6, 3, 'vent');
  b(-6.2, 1, 1, -5.5, 4.5, 2.2, 'strap');
  b(5.5, 1, 1, 6.2, 4.5, 2.2, 'strap');
  return m.glb(`ice_helmet`);
}

/** A goalie's mask: a white shell over the head and a black cage over the face. */
function mask() {
  const m = new Mesh({ shell: { rgb: '#f2f4f7', rough: 0.3 }, stripe: { rgb: '#3fa9f5', rough: 0.3 }, cage: { rgb: '#16181f', rough: 0.5, metal: 0.4 } });
  const b = (x0, y0, z0, x1, y1, z1, c) => m.box(x0 * V, y0 * V, z0 * V, x1 * V, y1 * V, z1 * V, c);
  b(-7, 8, -6.5, 7, 14, 6.4, 'shell');
  b(-7.3, -0.5, -6.5, -5.8, 9, 5, 'shell');
  b(5.8, -0.5, -6.5, 7.3, 9, 5, 'shell');
  b(-7, 0, -7, 7, 9, -5.8, 'shell');
  b(-1, 13.9, -6, 1, 14.3, 6.2, 'stripe');
  // The cage: bars across and down over the face.
  for (const y of [1, 3.5, 6]) b(-6, y, 6.2, 6, y + 0.5, 6.8, 'cage');
  for (const x of [-4.5, -1.5, 1.5, 4.5]) b(x - 0.25, -0.5, 6.2, x + 0.25, 8.2, 6.8, 'cage');
  b(-3, -1.5, 5.5, 3, -0.5, 6.8, 'shell');
  return m.glb('ice_mask');
}

/** A goalie's leg pad, on the shin (the lower leg joint: the knee, the bone down -y to the ankle). */
function pad() {
  const m = new Mesh({ pad: { rgb: '#f2f4f7', rough: 0.85 }, trim: { rgb: '#1d3f73', rough: 0.85 }, roll: { rgb: '#d9dde4', rough: 0.85 } });
  const b = (x0, y0, z0, x1, y1, z1, c) => m.box(x0 * V, y0 * V, z0 * V, x1 * V, y1 * V, z1 * V, c);
  b(-4.2, -11.5, -1, 4.2, 3, 4.5, 'pad');
  b(-4.6, -11.5, 1, -4.2, 3, 4.5, 'roll');
  b(4.2, -11.5, 1, 4.6, 3, 4.5, 'roll');
  for (const y of [-8, -3.5, 1]) b(-4.3, y, 4.4, 4.3, y + 0.8, 4.8, 'trim');
  // The knee's block over the top.
  b(-3.6, 2, -0.5, 3.6, 5, 4.2, 'pad');
  return m.glb('ice_pad');
}

/** The catching glove, on the left hand: a cuff and a big round pocket facing ahead. */
function glove() {
  const m = new Mesh({ glove: { rgb: '#f2f4f7', rough: 0.8 }, pocket: { rgb: '#c8a676', rough: 0.9 }, trim: { rgb: '#1d3f73', rough: 0.8 } });
  const b = (x0, y0, z0, x1, y1, z1, c) => m.box(x0 * V, y0 * V, z0 * V, x1 * V, y1 * V, z1 * V, c);
  b(-2.5, -1, -2.5, 2.5, 3, 2.5, 'trim');
  b(-4.5, -9, -2, 4.5, -1, 3, 'glove');
  b(-3.5, -8, 3, 3.5, -2, 3.6, 'pocket');
  b(-5.5, -12, -1.5, 2.5, -8.5, 2.5, 'glove');
  return m.glb('ice_glove');
}

/** The blocker, on the right hand: a flat board on the back of it. */
function blocker() {
  const m = new Mesh({ board: { rgb: '#f2f4f7', rough: 0.8 }, trim: { rgb: '#1d3f73', rough: 0.8 } });
  const b = (x0, y0, z0, x1, y1, z1, c) => m.box(x0 * V, y0 * V, z0 * V, x1 * V, y1 * V, z1 * V, c);
  b(-2.5, -1, -2.5, 2.5, 3, 2.5, 'trim');
  b(2.5, -9, -4, 3.5, 3, 5, 'board');
  b(2.4, -8, -3, 2.6, 2, 4, 'trim');
  return m.glb('ice_blocker');
}

/** The goal light: a red dome on a little box, glowing (each screen shows it when the lamp's lit). */
function light() {
  const m = new Mesh({ base: { rgb: '#16181f', rough: 0.6 }, lamp: { rgb: '#ff2a1f', rough: 0.3, glow: 1 } });
  m.box(-0.16, 0, -0.16, 0.16, 0.12, 0.16, 'base');
  m.cylinder([0, 0, 0], 0.13, 0.12, 0.36, 12, 'lamp');
  return m.glb('ice_light');
}

save('puck.glb', puck());
save('boards.glb', boards());
save('goal.glb', goalFrame());
save('net.glb', goalNet());
save('rink.glb', rink());
save('stick.glb', stick());
save('blade.glb', blade());
for (const [id, c] of Object.entries(HELMETS)) save(`helmet_${id}.glb`, helmet(c));
save('mask.glb', mask());
save('pad.glb', pad());
save('glove.glb', glove());
save('blocker.glb', blocker());
save('light.glb', light());
