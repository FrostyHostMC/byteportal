/**
 * Block Jam's models, built in code (Node 22+, no dependencies): the ball, a basket (rim, backboard,
 * stanchion and its padding), its net (apart, so each screen can swish it), and the court's
 * markings (one painted plane over the floor: the hardwood, the lines, the keys, the logo).
 * Written to `models/`.
 *
 *   node src/games/blockjam/tools/models.mjs
 *
 * Sizes are in blocks (metres), from `court.ts`: the rim's middle is the hoop's origin, the board
 * behind it along +x (the right-hand basket; each screen turns the left one round).
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { png, writeGlb } from './voxel.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '../models');

// The court's numbers (kept in step with court.ts).
const HALF_LENGTH = 14;
const HALF_WIDTH = 7.5;
const RIM_HEIGHT = 3.05;
const RIM_RADIUS = 0.34;
const RIM_FROM_BASELINE = 1.75;
const BOARD_FROM_BASELINE = 1.15;
const BOARD_HALF_WIDTH = 0.95;
const BOARD_BOTTOM = 2.85;
const BOARD_TOP = 3.95;
const BOARD_THICK = 0.08;
const THREE_RADIUS = 6.6;
const THREE_CORNER = 6.7;
const KEY_HALF_WIDTH = 2.45;
const KEY_LENGTH = 5.8;

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
  tri(a, b, c, col, n) {
    if (!n) {
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const l = Math.hypot(...n) || 1;
      n = n.map((q) => q / l);
    }
    const i = [a, b, c].map((p) => this.vert(p, n, col));
    this.idx.push(...i);
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
  /** A box along a segment (a strut, a string): `w` across. */
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
      generator: `Block Jam src/games/blockjam/tools/models.mjs`,
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
  console.log(`${file.padEnd(14)} ${bytes.length} bytes`);
}

// ---------------------------------------------------------------------------------------------
// The ball: a sphere of radius 0.5 (each screen scales it), orange pebbled leather with black
// seams: an equator, a meridian, and the two curved seams round its poles.

function ball() {
  const m = new Mesh({ leather: { rgb: '#e8661c', rough: 0.7 }, leather2: { rgb: '#d95a16', rough: 0.72 }, seam: { rgb: '#1a1210', rough: 0.9 } });
  const t = (1 + Math.sqrt(5)) / 2;
  const norm = (v) => {
    const l = Math.hypot(...v);
    return v.map((c) => c / l);
  };
  let verts = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map(norm);
  let faces = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  for (let s = 0; s < 3; s++) {
    const mid = new Map();
    const mk = (a, b) => {
      const k = a < b ? `${a},${b}` : `${b},${a}`;
      if (!mid.has(k)) {
        verts.push(norm(verts[a].map((c, i) => (c + verts[b][i]) / 2)));
        mid.set(k, verts.length - 1);
      }
      return mid.get(k);
    };
    faces = faces.flatMap(([a, b, c]) => {
      const ab = mk(a, b), bc = mk(b, c), ca = mk(c, a);
      return [[a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]];
    });
  }
  const W = 0.045;
  for (const [a, b, c] of faces) {
    const cen = norm([0, 1, 2].map((i) => (verts[a][i] + verts[b][i] + verts[c][i]) / 3));
    const [x, y, z] = cen;
    const seam = Math.abs(y) < W || Math.abs(x) < W || Math.abs(Math.hypot(x, y) - 0.72) < W * 0.8;
    const pebble = Math.sin(x * 61 + y * 37) * Math.sin(z * 53 - x * 29) > 0.3;
    const col = seam ? 'seam' : pebble ? 'leather2' : 'leather';
    const P = (v) => v.map((q) => q * 0.5);
    const i0 = m.vert(P(verts[a]), verts[a], col);
    const i1 = m.vert(P(verts[b]), verts[b], col);
    const i2 = m.vert(P(verts[c]), verts[c], col);
    m.idx.push(i0, i1, i2);
  }
  return m.glb('jam_ball');
}

// ---------------------------------------------------------------------------------------------
// The basket: the rim (a ring of short struts) at the origin, the backboard behind it (+x), the
// bracket between, and the stanchion: an arm back to a padded pole standing on the floor behind
// the baseline.

function hoop() {
  const m = new Mesh({
    rim: { rgb: '#ff5a1a', rough: 0.4, metal: 0.6 },
    board: { rgb: '#eef2f6', rough: 0.35 },
    border: { rgb: '#1c1f2b', rough: 0.6 },
    target: { rgb: '#e0303a', rough: 0.5 },
    steel: { rgb: '#3a3f4f', rough: 0.5, metal: 0.5 },
    pad: { rgb: '#1f3b7a', rough: 0.9 },
    padtrim: { rgb: '#ff6b1a', rough: 0.9 },
    shotclock: { rgb: '#111318', rough: 0.6 },
    led: { rgb: '#ff3b30', rough: 0.4, glow: 1 },
  });
  const floor = -RIM_HEIGHT;
  // The rim.
  const N = 28;
  for (let k = 0; k < N; k++) {
    const a0 = (k / N) * Math.PI * 2;
    const a1 = ((k + 1) / N) * Math.PI * 2;
    m.strut([Math.cos(a0) * RIM_RADIUS, 0, Math.sin(a0) * RIM_RADIUS], [Math.cos(a1) * RIM_RADIUS, 0, Math.sin(a1) * RIM_RADIUS], 0.045, 'rim');
  }
  const face = RIM_FROM_BASELINE - BOARD_FROM_BASELINE; // 0.6: the board's face, behind the rim
  // The bracket: rim to board.
  m.box(RIM_RADIUS - 0.02, -0.05, -0.08, face, 0.02, 0.08, 'rim');
  // The backboard: white, a dark border, the red square over the rim.
  const y0 = BOARD_BOTTOM - RIM_HEIGHT;
  const y1 = BOARD_TOP - RIM_HEIGHT;
  const bw = BOARD_HALF_WIDTH;
  m.box(face, y0, -bw, face + BOARD_THICK, y1, bw, 'board');
  const e = 0.04;
  const f = face - 0.004;
  // Border: four bars on the court side.
  m.box(f, y0, -bw, face, y0 + e, bw, 'border');
  m.box(f, y1 - e, -bw, face, y1, bw, 'border');
  m.box(f, y0, -bw, face, y1, -bw + e, 'border');
  m.box(f, y0, bw - e, face, y1, bw, 'border');
  // The square: 0.59 wide, 0.45 tall, its bottom at the rim.
  const sq = 0.3;
  const s0 = 0.02;
  const s1 = 0.47;
  const w = 0.035;
  m.box(f, s0, -sq, face, s0 + w, sq, 'target');
  m.box(f, s1 - w, -sq, face, s1, sq, 'target');
  m.box(f, s0, -sq, face, s1, -sq + w, 'target');
  m.box(f, s0, sq - w, face, s1, sq, 'target');
  // A shot clock on top of the board.
  m.box(face + 0.0, y1, -0.32, face + 0.12, y1 + 0.22, 0.32, 'shotclock');
  m.box(face - 0.003, y1 + 0.05, -0.2, face, y1 + 0.17, 0.2, 'led');
  // The stanchion: an arm back from the board to the pole behind the baseline.
  const back = face + BOARD_THICK;
  const pole = RIM_FROM_BASELINE + 0.9;
  m.box(back, 0.18, -0.07, pole + 0.08, 0.34, 0.07, 'steel');
  m.strut([back, -0.25, 0], [pole, 0.25, 0], 0.1, 'steel');
  m.box(pole - 0.1, floor + 1.1, -0.12, pole + 0.12, 0.42, 0.12, 'steel');
  // Its padded base on the floor.
  m.box(pole - 0.45, floor, -0.6, pole + 0.75, floor + 1.15, 0.6, 'pad');
  m.box(pole - 0.47, floor + 0.85, -0.62, pole + 0.77, floor + 0.95, 0.62, 'padtrim');
  return m.glb('jam_hoop');
}

/** The net: strings from the rim down to a narrower ring, crossing. Its origin the rim's middle. */
function net() {
  const m = new Mesh({ string: { rgb: '#f4f4f0', rough: 0.95 } });
  const N = 12;
  const depth = 0.48;
  const r0 = RIM_RADIUS - 0.01;
  const r1 = RIM_RADIUS * 0.62;
  const rings = 4;
  const at = (k, j) => {
    const t = j / rings;
    const r = r0 + (r1 - r0) * t;
    const a = ((k + (j % 2) * 0.5) / N) * Math.PI * 2;
    return [Math.cos(a) * r, -depth * t, Math.sin(a) * r];
  };
  for (let j = 0; j < rings; j++) {
    for (let k = 0; k < N; k++) {
      // Each knot to the two below it: the diamonds of a net.
      const p = at(k, j);
      const k2 = j % 2 === 0 ? k : k + 1;
      m.strut(p, at(k2 % N, j + 1), 0.014, 'string');
      m.strut(p, at((k2 - 1 + N) % N, j + 1), 0.014, 'string');
    }
  }
  return m.glb('jam_net');
}

// ---------------------------------------------------------------------------------------------
// The court's markings: one plane the size of the court (and a little apron), painted at PX
// pixels a block: maple boards, the lines, both keys in the home side's colour, the centre circle
// and the logo. Its origin the court's middle, at floor level.

const PX = 24;
const APRON = 1;
const BIG_FONT = {
  B: ['####.', '#...#', '####.', '#...#', '#...#', '####.'],
  L: ['#....', '#....', '#....', '#....', '#....', '#####'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '.###.'],
  C: ['.####', '#....', '#....', '#....', '#....', '.####'],
  K: ['#...#', '#..#.', '###..', '#..#.', '#...#', '#...#'],
  J: ['..###', '...#.', '...#.', '...#.', '#..#.', '.##..'],
  A: ['.###.', '#...#', '#####', '#...#', '#...#', '#...#'],
  M: ['#...#', '##.##', '#.#.#', '#...#', '#...#', '#...#'],
  ' ': ['.....', '.....', '.....', '.....', '.....', '.....'],
};

function court() {
  const L = HALF_LENGTH + APRON;
  const Wd = HALF_WIDTH + APRON;
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
  const MAPLE = ['#e2b47b', '#d9a86c', '#dcab70', '#e6bb84', '#d4a265'].map(hex);
  const STAIN = ['#9a5530', '#8f4c2a', '#a35d36', '#86462a'].map(hex);
  const HOME = hex('#ff6b1a');
  const HOME_DARK = hex('#c94f0e');
  const LINE = hex('#ffffff');
  const BLUE = hex('#2f6fe0');
  // World point of a pixel's middle.
  const wx = (x) => (x + 0.5) / PX - L;
  const wz = (y) => (y + 0.5) / PX - Wd;
  const lineW = 1.6 / PX;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const X = wx(x);
      const Z = wz(y);
      // Boards: running along the court, 6 pixels wide, ends staggered.
      const row = Math.floor(y / 6);
      const shift = Math.floor(rnd(row, 0, 1) * 200);
      const along = (x + shift) % 96;
      const inside = Math.abs(X) <= HALF_LENGTH && Math.abs(Z) <= HALF_WIDTH;
      const woods = inside ? MAPLE : STAIN;
      let c = woods[Math.floor(rnd(row, Math.floor((x + shift) / 96), 3) * woods.length) % woods.length];
      if (y % 6 === 5 || along === 0) c = c.map((q) => Math.round(q * 0.86));
      else if (rnd(x, y, 9) < 0.05) c = c.map((q) => Math.round(q * 0.95));
      // The keys, in the home side's colour.
      for (const side of [-1, 1]) {
        const base = side * HALF_LENGTH;
        const inKey = Math.abs(Z) <= KEY_HALF_WIDTH && side * (base - X) >= 0 && side * (base - X) <= KEY_LENGTH;
        if (inKey) c = (row & 1) ? HOME : HOME_DARK;
      }
      // The centre circle, filled.
      const cr = Math.hypot(X, Z);
      if (cr < 1.8) c = (row & 1) ? HOME : HOME_DARK;
      set(x, y, c);
    }
  }
  // The lines.
  const line = (f) => {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (f(wx(x), wz(y))) set(x, y, LINE);
  };
  const near = (v) => Math.abs(v) < lineW;
  line((X, Z) => (near(Math.abs(X) - HALF_LENGTH) && Math.abs(Z) <= HALF_WIDTH + lineW) || (near(Math.abs(Z) - HALF_WIDTH) && Math.abs(X) <= HALF_LENGTH + lineW));
  line((X, Z) => near(X) && Math.abs(Z) <= HALF_WIDTH);
  line((X, Z) => near(Math.hypot(X, Z) - 1.8) || near(Math.hypot(X, Z) - 0.6));
  for (const side of [-1, 1]) {
    const base = side * HALF_LENGTH;
    const rimX = side * (HALF_LENGTH - RIM_FROM_BASELINE);
    const ft = base - side * KEY_LENGTH;
    // The key's edges and the free-throw line, and its circle.
    line((X, Z) => {
      const inX = side * (base - X) >= 0 && side * (base - X) <= KEY_LENGTH;
      if (inX && near(Math.abs(Z) - KEY_HALF_WIDTH)) return true;
      if (near(X - ft) && Math.abs(Z) <= KEY_HALF_WIDTH) return true;
      const d = Math.hypot(X - ft, Z);
      return near(d - 1.8) && side * (X - ft) <= 0;
    });
    // The three-point line: straight in the corners, then the arc.
    line((X, Z) => {
      const d = Math.hypot(X - rimX, Z);
      const behind = side * (X - rimX);
      if (Math.abs(Z) >= THREE_CORNER - lineW && Math.abs(Z) <= THREE_CORNER + lineW && side * (base - X) >= 0 && behind > -Math.sqrt(Math.max(0, THREE_RADIUS ** 2 - THREE_CORNER ** 2))) return true;
      return near(d - THREE_RADIUS) && Math.abs(Z) <= THREE_CORNER;
    });
    // The restricted arc under the basket.
    line((X, Z) => near(Math.hypot(X - rimX, Z) - 1.25) && side * (X - rimX) <= 0);
  }
  // The logo across centre court: BLOCK over JAM, in blocky letters.
  const word = (text, cy, scale, col, shadow) => {
    const cols = text.length * 6 - 1;
    const x0 = Math.round(w / 2 - (cols * scale) / 2);
    const y0 = Math.round(cy - (6 * scale) / 2);
    [...text].forEach((ch, i) => {
      const g = BIG_FONT[ch] ?? BIG_FONT[' '];
      g.forEach((rowS, gy) => {
        [...rowS].forEach((p, gx) => {
          if (p !== '#') return;
          for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) {
            set(x0 + (i * 6 + gx) * scale + sx + 2, y0 + gy * scale + sy + 2, shadow);
            set(x0 + (i * 6 + gx) * scale + sx, y0 + gy * scale + sy, col);
          }
        });
      });
    });
  };
  word('BLOCK', h / 2 - 14, 4, LINE, hex('#1c1f2b'));
  word('JAM', h / 2 + 16, 5, BLUE, hex('#1c1f2b'));

  // A plane, texture and all (its corners the texture's).
  const pos = [-L, 0, -Wd, L, 0, -Wd, L, 0, Wd, -L, 0, Wd];
  const nor = [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0];
  const uv = [0, 0, 65535, 0, 65535, 65535, 0, 65535];
  const mr = { w: 2, h: 2, px: new Uint8Array(16).map((_, i) => (i % 4 === 1 ? 150 : 0)) };
  return writeGlb({
    generator: 'Block Jam src/games/blockjam/tools/models.mjs',
    nodes: [{ name: 'jam_court', children: [1] }, { name: 'jam_court_body' }],
    sceneName: 'jam_court',
    meshName: 'jam_court_body',
    meshNode: 1,
    attributes: {
      POSITION: { values: pos, componentType: 5126, type: 'VEC3', minmax: true },
      NORMAL: { values: nor, componentType: 5126, type: 'VEC3' },
      TEXCOORD_0: { values: uv, componentType: 5123, type: 'VEC2', normalized: true },
    },
    indices: [0, 3, 2, 0, 2, 1],
    material: { name: 'jam_court', albedo: png({ w, h, px }), mr: png(mr) },
  });
}

/** A soft dark disc for the ball's shadow on the floor (radius 0.5: each screen scales it). */
function shadow() {
  const m = new Mesh({ dark: { rgb: '#1a120c', rough: 1 }, mid: { rgb: '#5a3a24', rough: 1 } });
  const N = 20;
  for (let k = 0; k < N; k++) {
    const a0 = (k / N) * Math.PI * 2;
    const a1 = ((k + 1) / N) * Math.PI * 2;
    m.tri([0, 0, 0], [Math.cos(a1) * 0.32, 0, Math.sin(a1) * 0.32], [Math.cos(a0) * 0.32, 0, Math.sin(a0) * 0.32], 'dark', [0, 1, 0]);
    m.quad([Math.cos(a0) * 0.32, 0, Math.sin(a0) * 0.32], [Math.cos(a1) * 0.32, 0, Math.sin(a1) * 0.32], [Math.cos(a1) * 0.5, 0, Math.sin(a1) * 0.5], [Math.cos(a0) * 0.5, 0, Math.sin(a0) * 0.5], [0, 1, 0], 'mid');
  }
  return m.glb('jam_shadow');
}

save('ball.glb', ball());
save('shadow.glb', shadow());
save('hoop.glb', hoop());
save('net.glb', net());
save('court.glb', court());
