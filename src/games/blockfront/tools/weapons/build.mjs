#!/usr/bin/env node
/**
 * Blockfront II: the arsenal (the blasters, the thermal detonator and the heroes' sabers), built as
 * micro-voxel models in Call of Blocky's style and written as binary glTF 2.0 (`.glb`) to
 * `src/games/blockfront/models/weapons/`. Dependency-free (Node 22+):
 * `node src/games/blockfront/tools/weapons/build.mjs [ids...] [--show]` (`--show` prints each
 * model's voxels side on, from behind and from above). Each file is parsed back and checked after
 * it's written (chunks, accessors, winding, markers), each optic's window is checked open from the
 * aiming eye, and each saber's blade checked alight.
 *
 * Conventions (Call of Blocky's guns', which the platform's holds and the game's code rely on):
 *
 * - Units: 1 glTF unit = 1 block = 16 pixels. The models are voxels 0.625 px on a side (5/128
 *   block): in first person (drawn at 0.42) about 1.6 cm, held by a trooper (at 0.68) about 2.7
 *   cm. Shapes are authored in px and filled with the voxels whose centres they hold; widths are
 *   counted in voxels, centred on the model's axis. Every model here is on the odd grid across x
 *   (a voxel centred on the axis: `offset` x -0.5), so round sections (a blaster's barrel jacket, a
 *   saber's blade) centre on a voxel.
 * - Orientation: the barrel (the blade) runs along +z (the muzzle, the tip, is the +z end), +y is
 *   up. A blaster's right side is -x; its left side (the one the player sees in first person, where
 *   the E-12's magazine sticks out) is +x.
 * - Origin (0,0,0): the centre of the firing hand's fist round the pistol grip (= `grip`); a
 *   saber's rear hand on the hilt; the detonator's middle.
 * - Sizes (overall length along z, px): pistols 12-13.5 (held under 0.6 m, so troopers hold them
 *   as pistols), rifles 27-32, the heavies 28-36, the snipers 36-38; sabers about 27 (a 5 px hilt,
 *   a 22 px blade); the detonator 4.4 across.
 * - Marker nodes: empty nodes (no mesh), children of the root, their translation in blocks:
 *   - `grip`: the centre of the firing fist on the pistol grip (the origin).
 *   - `grip2`: where the support hand holds: under the barrel jacket or handguard, on the Z-7's
 *     front handle; the pistols' below and in front of the grip (the cupping hand).
 *   - `muzzle`: the centre of the barrel's tip (bolts and flashes start here); on the Z-7 the
 *     middle of its barrel cluster's front.
 *   - `sight`: the eye point aiming down sights. The rifles, heavies and pistols have open optics
 *     (`holo` or `dot`, weapons.ts): a frame one voxel thick and one deep round an open window,
 *     `sight` the window's centre at the frame's rear face. Nothing shows through the window from
 *     the aiming eye (EYE_BACKS behind it), ahead of the frame or between the eye and the frame;
 *     the platform draws the reticle. On the E-12, the A-28, the T-22 and the heavy pistol the frame
 *     is the front housing of a slim scope on top (the scope's tube runs back from it at the
 *     window's sill); the Z-7's stands on the back of its carry handle, the scout pistol's on the
 *     back of the slide. On the snipers, `sight` is the centre of the scope's rear lens.
 *   - `mag`: the centre of the magazine or power pack (reloads, here vents, send the support hand
 *     there): the E-12's out on its left side, the Z-7's drum.
 * - Sabers: a hilt (about 5 px) and a blade (about 22 px) along +z, roughly square in section: a
 *   white-hot core (glowing white) showing down the middle of each face, the corners the blade's
 *   colour (glowing), rounding off to a white tip. The corners' base colour is a deeper, purer
 *   shade of the hero's `blade` (heroes/defs.ts): lit, glowing at full and through the screen's
 *   filmic tone mapping it comes out as that colour (the `blade` itself, glowing, would come out
 *   pale: salmon for a red, near white for the green). `grip` is the rear hand on the hilt (the origin),
 *   `grip2` the front hand, `muzzle` the blade's tip; no `mag`. Held like Call of Blocky's katana
 *   (`rotation: [0, 0, 90]`): the hilt's side +x faces up in the hand.
 * - The thermal detonator (thrown) has one marker, `grip`, the origin at its middle, +y up: a
 *   steel ball with a raised band of lit panels round its middle, the arming lever on top.
 * - Look (tools/voxel.mjs): flat, clean voxels: a quad per visible voxel face (faces of a colour
 *   in a plane merged where nothing shades them), each on a tile of one palette atlas, soft
 *   occlusion in the concave corners baked into tile variants. One material: baseColorTexture,
 *   metallicRoughnessTexture (G roughness, B metalness; the factors 1) and emissiveTexture (what
 *   glows: indicator lights, muzzle rings, lenses, the blades; the platform adds the base colour
 *   times its level times 4 to a figure's, 3 in first person, and blooms what's bright). What glows
 *   is coloured deep (a red light #b00a0a), as the blades are: lit and glowing it comes out a clean
 *   red on screen, where a bright one (#ff2a2a) would come out salmon. One
 *   mesh; POSITION (with min/max) and NORMAL as floats, TEXCOORD_0 as normalized unsigned shorts,
 *   indices. Node tree: root (named after the item id, extras.title its name) > [mesh node,
 *   marker nodes].
 */
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Palette, Voxels, faces, atlas, quadCorners, png, writeGlb, readGlb, cellOf, DIRS } from '../voxel.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '../../models/weapons');
/** A voxel, in px. */
const V = 0.625;
const MAX_BYTES = 300 * 1024;
/**
 * How far behind the `sight` point the eye can be when aiming, in model px: the platform holds an
 * optic's sight 0.3 blocks in front of the eye with the gun at scale 0.42 (0.3 / 0.42 * 16), and
 * Blockfront's holds it 0.4 out (client/looks.ts); the window is checked clear from both.
 */
const EYE_BACKS = [(0.3 / 0.42) * 16, (0.4 / 0.42) * 16];

// ---------------------------------------------------------------------------------------------
// 2D helpers: polygons (with rounded corners) and their insides

const DEG = Math.PI / 180;
const clamp = (v, lo = 0, hi = 1) => (v < lo ? lo : v > hi ? hi : v);
const area2 = (poly) => {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
};
const norm2 = (a) => {
  const l = Math.hypot(a[0], a[1]);
  return l > 1e-12 ? [a[0] / l, a[1] / l] : [0, 0];
};

/**
 * A polygon (or an open path) with rounded corners: points [a, b, r?], where r rounds that corner
 * in about `seg` segments per quarter turn.
 */
function fillet(pts, closed = true, seg = 4) {
  const out = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const [x, y, r = 0] = pts[i];
    if (!r || (!closed && (i === 0 || i === n - 1))) {
      out.push([x, y]);
      continue;
    }
    const A = pts[(i - 1 + n) % n], B = pts[(i + 1) % n];
    const la = Math.hypot(A[0] - x, A[1] - y), lb = Math.hypot(B[0] - x, B[1] - y);
    const d1 = norm2([A[0] - x, A[1] - y]), d2 = norm2([B[0] - x, B[1] - y]);
    const theta = Math.acos(clamp(d1[0] * d2[0] + d1[1] * d2[1], -1, 1));
    if (theta < 1e-3 || Math.PI - theta < 1e-3) {
      out.push([x, y]);
      continue;
    }
    const steps = Math.max(1, Math.ceil(((Math.PI - theta) / (Math.PI / 2)) * seg));
    const half = theta / 2;
    let rr = r;
    let t = rr / Math.tan(half);
    const lim = Math.min(la, lb) * 0.5;
    if (t > lim) {
      t = lim;
      rr = t * Math.tan(half);
    }
    const bis = norm2([d1[0] + d2[0], d1[1] + d2[1]]);
    const cd = rr / Math.sin(half);
    const c = [x + bis[0] * cd, y + bis[1] * cd];
    const p1 = [x + d1[0] * t, y + d1[1] * t], p2 = [x + d2[0] * t, y + d2[1] * t];
    const a1 = Math.atan2(p1[1] - c[1], p1[0] - c[0]);
    let da = Math.atan2(p2[1] - c[1], p2[0] - c[0]) - a1;
    while (da > Math.PI) da -= 2 * Math.PI;
    while (da < -Math.PI) da += 2 * Math.PI;
    for (let k = 0; k <= steps; k++) {
      const a = a1 + (da * k) / steps;
      out.push([c[0] + rr * Math.cos(a), c[1] + rr * Math.sin(a)]);
    }
  }
  return out;
}

/** Is (x, y) inside the polygon (even-odd)? */
function inside(poly, x, y) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

// ---------------------------------------------------------------------------------------------
// A model: voxel parts, colours, markers, an optic's window. Cell (i, j, k) is the voxel from
// (i, j, k) + offset to (i+1, j+1, k+1) + offset voxels from the origin. Shapes are given in px
// and fill the cells whose centres they hold; widths across x in voxels, centred on the axis (odd,
// on this grid).

class Model {
  constructor(id, name, kind, { offset = [-0.5, 0, 0] } = {}) {
    this.id = id;
    this.name = name;
    /** `blaster`, `saber` or `detonator`: what the markers must be. */
    this.kind = kind;
    this.vox = new Voxels();
    this.P = new Palette();
    this.markers = {};
    /** An optic's open window: cells x [x0, x1), y [y0, y1) at the frame's cells z = k; `corners` its chamfers. */
    this.window = null;
    this.offset = offset;
  }
  /** Colours: name -> [hex, rough, metal, glow]. */
  colours(list) {
    for (const [name, [rgb, rough = 0.8, metal = 0, glow = 0]] of Object.entries(list)) this.P.add(name, rgb, { rough, metal, glow, vary: 0 });
    return this;
  }
  /** The cells along axis `a` whose centres are in [lo, hi) px: a range [i0, i1). */
  span(a, lo, hi) {
    const o = this.offset[a];
    const f = (v) => Math.ceil(v / V - 0.5 - o - 1e-9);
    return [f(lo), f(hi)];
  }
  /** `w` cells across x centred on the axis (its parity the model's), or an explicit range [i0, i1). */
  xs(w) {
    if (Array.isArray(w)) return w;
    const a = -w / 2 - this.offset[0];
    if (!Number.isInteger(a)) throw new Error(`${this.id}: ${w} voxels can't centre on this grid`);
    return [a, a + w];
  }
  /** A cell's centre along axis `a`, in px. */
  c(a, i) {
    return (i + 0.5 + this.offset[a]) * V;
  }
  /** The cell along axis `a` that holds `v` px. */
  cell(a, v) {
    return Math.floor(v / V - this.offset[a]);
  }
  /** A cell boundary along axis `a` (the lower face of cell i), in px. */
  b(a, i) {
    return (i + this.offset[a]) * V;
  }
  /** Set one cell (a colour, or `false` to clear it). */
  set(i, j, k, c) {
    if (c === false) this.vox.del('body', i, j, k);
    else if (c) this.vox.set('body', i, j, k, c);
    return this;
  }
  /** Fill cells [lo, hi); `c` a colour or `(i, j, k) => colour | false | undefined`. */
  box(lo, hi, c) {
    const f = typeof c === 'function' ? c : () => c;
    this.vox.paint('body', lo, hi, f);
    return this;
  }
  /** A box in px (y, z) and voxels across x. */
  pbox(w, [y0, y1], [z0, z1], c) {
    const [i0, i1] = this.xs(w), [j0, j1] = this.span(1, y0, y1), [k0, k1] = this.span(2, z0, z1);
    return this.box([i0, j0, k0], [i1, j1, k1], c);
  }
  /** A side profile: a polygon of (z, y) px points (with fillet radii), `w` voxels across x. */
  prof(pts, w, c) {
    const poly = fillet(pts);
    const f = typeof c === 'function' ? c : () => c;
    const [i0, i1] = this.xs(w);
    const zs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
    const [k0, k1] = this.span(2, Math.min(...zs), Math.max(...zs) + 1e-6), [j0, j1] = this.span(1, Math.min(...ys), Math.max(...ys) + 1e-6);
    for (let k = k0; k < k1; k++)
      for (let j = j0; j < j1; j++)
        if (inside(poly, this.c(2, k), this.c(1, j)))
          for (let i = i0; i < i1; i++) this.set(i, j, k, f(i, j, k));
    return this;
  }
  /** A round section along z: the cells whose centres are within `r` px of (x, y), from z0 to z1 px. */
  disc(r, [x, y], [z0, z1], c) {
    const f = typeof c === 'function' ? c : () => c;
    const [i0, i1] = this.span(0, x - r, x + r + 1e-6), [j0, j1] = this.span(1, y - r, y + r + 1e-6), [k0, k1] = this.span(2, z0, z1);
    for (let k = k0; k < k1; k++)
      for (let j = j0; j < j1; j++)
        for (let i = i0; i < i1; i++) if (Math.hypot(this.c(0, i) - x, this.c(1, j) - y) <= r + 1e-6) this.set(i, j, k, f(i, j, k));
    return this;
  }
  /** A round section along x (a drum on its side): the cells whose centres are within `r` px of (y, z), `w` voxels across. */
  drum(r, [y, z], w, c) {
    const f = typeof c === 'function' ? c : () => c;
    const [i0, i1] = this.xs(w), [j0, j1] = this.span(1, y - r, y + r + 1e-6), [k0, k1] = this.span(2, z - r, z + r + 1e-6);
    for (let k = k0; k < k1; k++)
      for (let j = j0; j < j1; j++)
        if (Math.hypot(this.c(1, j) - y, this.c(2, k) - z) <= r + 1e-6) for (let i = i0; i < i1; i++) this.set(i, j, k, f(i, j, k));
    return this;
  }
  /** A ball: the cells whose centres are within `r` px of the point (px). */
  ball(r, [x, y, z], c) {
    const f = typeof c === 'function' ? c : () => c;
    const [i0, i1] = this.span(0, x - r, x + r + 1e-6), [j0, j1] = this.span(1, y - r, y + r + 1e-6), [k0, k1] = this.span(2, z - r, z + r + 1e-6);
    for (let k = k0; k < k1; k++)
      for (let j = j0; j < j1; j++)
        for (let i = i0; i < i1; i++) if (Math.hypot(this.c(0, i) - x, this.c(1, j) - y, this.c(2, k) - z) <= r + 1e-6) this.set(i, j, k, f(i, j, k));
    return this;
  }
  /** A rod a voxel thick in the side profile, from (z, y) to (z, y) px, `w` voxels across (a wire stock's struts, a bipod's legs). */
  rod(w, [z0, y0], [z1, y1], c) {
    const [i0, i1] = this.xs(w);
    const n = Math.ceil(Math.max(Math.abs(z1 - z0), Math.abs(y1 - y0)) / V) * 2 + 1;
    for (let s = 0; s <= n; s++) {
      const t = s / n;
      const k = this.cell(2, z0 + (z1 - z0) * t), j = this.cell(1, y0 + (y1 - y0) * t);
      for (let i = i0; i < i1; i++) this.set(i, j, k, c);
    }
    return this;
  }
  /**
   * A pistol grip raked `deg` back, `w` voxels across and `depth` deep in every row, its front
   * edge `front` px ahead of the origin at y 0 (moving back as it goes down), from y0 to y1 px:
   * a clean staircase. `c(i, j, k, back)` gets each row's rearmost cell too.
   */
  grip(w, [y0, y1], front, depth, deg, c) {
    const f = typeof c === 'function' ? c : () => c;
    const [i0, i1] = this.xs(w), [j0, j1] = this.span(1, y0, y1);
    for (let j = j0; j < j1; j++) {
      const k1 = Math.round((front + this.c(1, j) * Math.tan(deg * DEG)) / V - this.offset[2]);
      for (let k = k1 - depth; k < k1; k++)
        for (let i = i0; i < i1; i++) {
          const col = f(i, j, k, k1 - depth);
          if (col) this.vox.set('body', i, j, k, col);
        }
    }
    return this;
  }
  /** Recolour the filled cells in [lo, hi) that `pick(i, j, k, c)` names a colour for (or `false`: clear). */
  paint(lo, hi, pick) {
    this.vox.recolour('body', (i, j, k, c) => (i >= lo[0] && i < hi[0] && j >= lo[1] && j < hi[1] && k >= lo[2] && k < hi[2] ? pick(i, j, k, c) : undefined));
    return this;
  }
  has(i, j, k) {
    return this.vox.filled(i, j, k);
  }
  /**
   * Wear on the edges: the voxels of the colours `from` with two or more faces open (an edge, a
   * corner), every so many by their cell (`rate` of them), turn `to` (a worn finish's metal showing).
   */
  wear(from, to, rate) {
    const open = (i, j, k) => DIRS.filter(({ n }) => !this.has(i + n[0], j + n[1], k + n[2])).length;
    const hash = (i, j, k) => (((Math.imul(i + 101, 73856093) ^ Math.imul(j + 211, 19349663) ^ Math.imul(k + 307, 83492791)) >>> 0) % 1000) / 1000;
    const hit = [...this.vox.parts.get('body')].filter(([key, c]) => from.includes(c) && open(...cellOf(key)) >= 2 && hash(...cellOf(key)) < rate);
    for (const [key] of hit) this.vox.set('body', ...cellOf(key), to);
    return this;
  }
  /** An arm in the x-z plane (a bow's): the cells within `r` px of a path of (x, z) px points, from y0 to y1 px; `c(i, j, k, t)` gets how far along the path (0..1) each is. */
  arm(pts, r, [y0, y1], c) {
    const f = typeof c === 'function' ? c : () => c;
    const seg = pts.slice(1).map((p, n) => Math.hypot(p[0] - pts[n][0], p[1] - pts[n][1]));
    const total = seg.reduce((x, y) => x + y, 0);
    const xs = pts.map((p) => p[0]), zs = pts.map((p) => p[1]);
    const [i0, i1] = this.span(0, Math.min(...xs) - r, Math.max(...xs) + r + 1e-6), [k0, k1] = this.span(2, Math.min(...zs) - r, Math.max(...zs) + r + 1e-6), [j0, j1] = this.span(1, y0, y1);
    for (let k = k0; k < k1; k++)
      for (let i = i0; i < i1; i++) {
        const x = this.c(0, i), z = this.c(2, k);
        let best = Infinity, at = 0, run = 0;
        seg.forEach((len, n) => {
          const [ax, az] = pts[n], [bx, bz] = pts[n + 1];
          const t = clamp(((x - ax) * (bx - ax) + (z - az) * (bz - az)) / (len * len));
          const d = Math.hypot(x - (ax + (bx - ax) * t), z - (az + (bz - az) * t));
          if (d < best) (best = d), (at = (run + t * len) / total);
          run += len;
        });
        if (best <= r + 1e-6) for (let j = j0; j < j1; j++) this.set(i, j, k, f(i, j, k, at));
      }
    return this;
  }
  /** A rod through a path of (z, y) px points (rounded through its corners), `w` voxels across. */
  path(w, pts, c) {
    const p = fillet(pts, false, 6);
    for (let n = 1; n < p.length; n++) this.rod(w, p[n - 1], p[n], c);
    return this;
  }
  mark(name, p) {
    this.markers[name] = p.map((v) => Math.round(v * 1e4) / 1e4);
    return this;
  }
}

/**
 * An open reflex sight: a window `w` x `h` voxels (centred across x, or `x` voxels to the left, its
 * sill at `sill` px and the frame's rear face at `z` px, both on the grid) in a frame one voxel
 * thick and one deep, its top
 * corners chamfered (`chamfer`, on a window three or more tall); the body under it `body` voxels
 * tall and `bodyW` wide, from `back` voxels behind the frame, running on `len` voxels ahead of it
 * `drop` voxels lower and `aheadW` wide. Returns the `sight` point: the window's centre at the
 * frame's rear face.
 */
function optic(g, { w, h, sill, z, frame, body = 2, bodyW = w + 2, back = 1, len = 0, drop = 1, aheadW = bodyW, colour = 'anod', chamfer = h >= 3, x = 0 }) {
  const across = (n) => g.xs(n).map((i) => i + x);
  const [x0, x1] = across(w);
  const j0 = Math.round(sill / V - g.offset[1]), k = Math.round(z / V - g.offset[2]);
  if (Math.abs(g.b(1, j0) - sill) > 1e-6 || Math.abs(g.b(2, k) - z) > 1e-6) throw new Error(`${g.id}: optic off the grid`);
  const [b0, b1] = across(bodyW), [a0, a1] = across(aheadW);
  g.box([b0, j0 - body, k - back], [b1, j0, k + 1], colour);
  g.box([a0, j0 - body, k + 1], [a1, j0 - drop, k + 1 + len], colour);
  for (const x of [x0 - 1, x1]) g.box([x, j0, k], [x + 1, j0 + h, k + 1], frame);
  g.box([x0, j0 + h, k], [x1, j0 + h + 1, k + 1], frame);
  const corners = chamfer ? [[x0, j0 + h - 1], [x1 - 1, j0 + h - 1]] : [];
  for (const [i, j] of corners) g.box([i, j, k], [i + 1, j + 1, k + 1], frame);
  g.window = { x0, x1, y0: j0, y1: j0 + h, k, corners };
  return [x * V, (g.b(1, j0) + g.b(1, j0 + h)) / 2, z];
}

/**
 * A slim scope whose front housing is an open sight: the frame (a window `w` x `h` voxels, its sill
 * at `sill` px, its rear face at `z` px) on a base `baseW` wide, and the scope's tube running back
 * from it `tubeW` voxels wide and `tube` tall, its top at the sill (so it never shows in the
 * window), to its eyepiece at `back` px, `eyeW` wide; `mounts` (z px) under the tube down to `seat`
 * px. Returns the `sight` point.
 */
function scopeSight(g, { w = 3, h = 3, sill, z, back, frame, tube = 2, tubeW = 3, baseW = w + 2, eyeW = tubeW + 2, body, eye = body, mounts = [], seat, mount = body, chamfer }) {
  const sight = optic(g, { w, h, sill, z, frame, body: tube, bodyW: baseW, back: 0, len: 0, colour: body, chamfer });
  const lo = sill - tube * V;
  g.pbox(tubeW, [lo, sill], [back + V, z], body);
  g.pbox(eyeW, [lo, sill], [back, back + V], eye);
  for (const m of mounts) g.pbox(tubeW, [seat, lo], [m, m + V], mount);
  return sight;
}

// ---------------------------------------------------------------------------------------------
// The blasters

/** The rows of cooling holes round a 5-voxel jacket (radius 1.45 px about y `yc`), from k0 to k1: which cells to open. */
const perforated = (g, yc, [k0, k1], hole) => (i, j, k) => {
  const jj = j - g.cell(1, yc);
  const edge = Math.abs(i) === 2 || Math.abs(jj) === 2;
  if (!edge) return 'bore';
  if (k < k0 || k >= k1) return undefined;
  return hole(i, jj, k) ? false : undefined;
};

/** A glowing ring round a dark bore on a round muzzle's front face: the outer cells of a disc at cell k. */
function muzzleRing(g, r, [x, y], k, glow, bore = 'bore') {
  const cx = g.cell(0, x), cy = g.cell(1, y);
  g.disc(r, [x, y], [g.b(2, k), g.b(2, k + 1)], (i, j) => (Math.abs(i - cx) <= 0 && Math.abs(j - cy) <= 0 ? bore : glow));
}

/** E-12 Blaster Rifle: the stormtroopers' carbine, a black jacket in rows of cooling holes, a slim scope, its magazine out the left side, a wire stock. */
function impRifle() {
  const g = new Model('imp_rifle', 'E-12 Blaster Rifle', 'blaster').colours({
    black: [0x1d1e22, 0.3, 0.55], blackMatte: [0x202124, 0.75], ribs: [0x2c2d31, 0.75], gunmetal: [0x3c4048, 0.32, 0.8], steel: [0xa8adb4, 0.28, 1],
    bore: [0x0b0b0d, 0.7], red: [0xb00a0a, 0.4, 0, 1], green: [0x0e9a2a, 0.4, 0, 1], ring: [0xb0081c, 0.4, 0, 1],
  });
  const YC = 3.4375;
  // The jacket, its rows of holes (the middle of the sides on even voxels, the top and bottom on odd ones), the rear cap and knob.
  const holes = perforated(g, YC, [6, 21], (i, jj, k) => (Math.abs(i) === 2 && jj === 0 ? k % 2 === 0 : i === 0 && Math.abs(jj) === 2 && jj < 0 ? k % 2 === 1 : false));
  g.disc(1.45, [0, YC], [-3.75, 13.125], 'black');
  g.paint([-3, 0, -6], [4, 12, 21], (i, j, k) => holes(i, j, k));
  // (The top row of holes under the scope's front, where the scope leaves room: behind it.)
  g.paint([0, 7, 9], [1, 8, 21], (i, j, k) => (k % 2 === 1 ? false : undefined));
  g.disc(1.0, [0, YC], [-4.375, -3.75], 'gunmetal');
  g.disc(0.7, [0, YC], [-5.0, -4.375], 'steel');
  // The front cap, the barrel, the front sight post, the glowing muzzle.
  g.disc(1.45, [0, YC], [13.125, 13.75], 'gunmetal');
  g.disc(0.9, [0, YC], [13.75, 15.625], 'gunmetal');
  g.pbox(1, [4.375, 5.625], [14.375, 15.0], 'steel');
  muzzleRing(g, 0.9, [0, YC], 25, 'ring');
  // Under the jacket: the trigger housing, the grip (ribbed), the guard and trigger.
  g.pbox(3, [1.25, 1.875], [-2.5, 4.375], 'gunmetal');
  g.grip(3, [-3.125, 1.25], 1.29, 4, 15, (i, j, k) => (j === -5 ? 'gunmetal' : j % 2 ? 'ribs' : 'blackMatte'));
  g.pbox(1, [0, 0.625], [1.25, 4.375], 'gunmetal');
  g.pbox(1, [0, 1.25], [3.75, 4.375], 'gunmetal');
  g.box([0, 1, 3], [1, 2, 4], 'steel');
  // The magazine out the left side (+x): its well, the magazine, its base cap.
  g.box([3, 3, 2], [4, 8, 7], 'gunmetal');
  g.box([4, 4, 3], [7, 7, 6], 'black');
  g.box([7, 4, 3], [8, 7, 6], 'gunmetal');
  // The power counter on the left, behind the magazine: two lights.
  g.box([3, 4, -4], [4, 7, 0], (i, j, k) => (j === 5 && k === -3 ? 'red' : j === 5 && k === -2 ? 'green' : 'gunmetal'));
  // The wire stock, unfolded: its struts from the hinge at the rear cap and under the grip's heel, the butt plate.
  for (const x of [[-1, 0], [1, 2]]) {
    g.rod(x, [-4.0, 2.2], [-10.6, 2.2], 'steel');
    g.rod(x, [-2.2, -2.2], [-10.6, -1.2], 'steel');
  }
  g.pbox(3, [-1.875, 3.125], [-11.25, -10.625], (i, j) => (j === -3 || j === 4 ? 'gunmetal' : 'blackMatte'));
  // The scope: mounts on the jacket, the tube back from the front housing (the open sight) to the eyepiece.
  const sight = scopeSight(g, { sill: 6.875, z: 4.375, back: -0.625, frame: 'gunmetal', body: 'black', eye: 'blackMatte', eyeW: 3, mounts: [0.625, 3.125], seat: 5.0, mount: 'gunmetal' });
  g.box([-1, 9, 6], [2, 11, 7], (i, j) => (i === 0 && j === 10 ? 'red' : 'black'));
  return g.mark('grip', [0, 0, 0]).mark('grip2', [0, 1.25, 8.75]).mark('muzzle', [0, YC, 16.25]).mark('sight', sight).mark('mag', [3.125, YC, 2.8125]);
}

/** A-28 Blaster Rifle: the Rebels' long rifle, angular grey steel in sand-coloured furniture, a skeleton stock, a boxy scope, a boxy flash hider. */
function rebelRifle() {
  const g = new Model('rebel_rifle', 'A-28 Blaster Rifle', 'blaster').colours({
    grey: [0x5c6068, 0.34, 0.75], greyDark: [0x3a3d43, 0.36, 0.75], sand: [0xb89a6c, 0.7], sandDark: [0x957a52, 0.72], black: [0x222326, 0.7],
    steel: [0xa8adb4, 0.28, 1], bore: [0x0b0b0d, 0.7], vent: [0x141416, 0.7], green: [0x0e9a2a, 0.4, 0, 1], amber: [0xc07008, 0.4, 0, 1], ring: [0xc04008, 0.4, 0, 1],
  });
  // The receiver, its top angling down at the front; the rail.
  g.prof([[-3.2, 1.9], [-3.2, 4.4], [6.9, 4.4], [8.1, 3.4], [8.1, 1.9]], 3, 'grey');
  g.pbox(3, [1.25, 1.9], [-1.9, 4.4], 'greyDark');
  g.pbox(3, [4.375, 5.0], [-2.5, 5.0], 'greyDark');
  // Its ejection port on the right, the charging handle on the left.
  g.box([-1, 5, 2], [0, 6, 6], (i, j, k) => (k === 2 || k === 5 ? undefined : 'vent'));
  g.box([2, 5, 0], [3, 6, 1], 'steel');
  // The skeleton stock (sand), its butt pad.
  g.prof([[-3.1, 4.4], [-11.2, 4.1], [-11.2, -1.0], [-9.4, -1.0], [-3.1, 1.9]], 3, (i, j, k) => (k === -18 ? 'black' : 'sand'));
  g.prof([[-4.6, 3.5], [-9.8, 3.3], [-9.8, 0.1], [-4.6, 2.5]], 3, false);
  // The grip (ribbed black), the guard and trigger.
  g.grip(3, [-3.125, 1.25], 1.29, 4, 16, (i, j) => (j === -5 ? 'greyDark' : j % 2 ? 'black' : 'greyDark'));
  g.pbox(1, [0, 0.625], [1.25, 3.75], 'greyDark');
  g.pbox(1, [0, 1.25], [3.125, 3.75], 'greyDark');
  g.box([0, 1, 3], [1, 2, 4], 'steel');
  // The power pack under the receiver, ahead of the guard, a green charge light on its left.
  g.prof([[3.9, 1.3], [7.4, 1.3], [7.9, -1.6], [4.6, -1.6]], 3, (i, j, k) => (j === -3 ? 'sandDark' : i === 1 && (j === -1 || j === 0) && k === 9 ? 'green' : 'black'));
  // The handguard (sand), five across with rounded top edges, a row of vents down each side.
  g.prof([[8.1, 1.4], [8.1, 4.4], [14.9, 4.4], [15.6, 3.7], [15.6, 2.2], [14.4, 1.4]], 5, (i, j, k) => {
    if (Math.abs(i) === 2 && (j === 6 || j === 2)) return false;
    if (Math.abs(i) === 2 && j === 4 && k >= 14 && k <= 23 && k % 3 !== 1) return 'vent';
    return j === 6 ? 'sandDark' : 'sand';
  });
  g.box([-2, 3, 13], [-1, 4, 15], 'amber');
  // The barrel, the boxy flash hider with its slots, the glowing muzzle.
  g.disc(0.9, [0, 3.4375], [15.625, 19.375], 'greyDark');
  g.pbox(3, [1.875, 5.0], [19.375, 21.25], (i, j, k) => (Math.abs(i) === 1 && (j === 3 || j === 7) ? false : k === 32 && Math.abs(i) === 1 && (j === 4 || j === 6) ? 'vent' : 'grey'));
  muzzleRing(g, 0.9, [0, 3.4375], 34, 'ring');
  // The scope: a square housing on a boxy tube, on the rail.
  const sight = scopeSight(g, { sill: 6.875, z: 4.375, back: -0.625, frame: 'grey', body: 'greyDark', eye: 'black', eyeW: 3, mounts: [0.625, 3.125], seat: 5.0, mount: 'grey', chamfer: false });
  g.box([2, 9, 7], [3, 10, 8], 'green');
  return g.mark('grip', [0, 0, 0]).mark('grip2', [0, 0.9375, 11.5625]).mark('muzzle', [0, 3.4375, 21.875]).mark('sight', sight).mark('mag', [0, -0.3125, 5.9375]);
}

/** T-22 Repeater: the Empire's heavy repeater, a long jacket slotted for cooling (warm inside), a scope, a bipod folded under, a flared muzzle. */
function impHeavy() {
  const g = new Model('imp_heavy', 'T-22 Repeater', 'blaster').colours({
    black: [0x1d1e22, 0.3, 0.55], blackMatte: [0x202124, 0.75], ribs: [0x2c2d31, 0.75], gunmetal: [0x3c4048, 0.32, 0.8], steel: [0xa8adb4, 0.28, 1],
    bore: [0x0b0b0d, 0.7], heat: [0x6a1a08, 0.7, 0, 0.35], red: [0xb00a0a, 0.4, 0, 1], ring: [0xb0081c, 0.4, 0, 1],
  });
  const YC = 3.4375;
  // The receiver: boxy, its top edges bevelled; its left side's power pack with a row of lights.
  g.pbox(5, [1.875, 5.625], [-3.75, 6.25], (i, j) => (Math.abs(i) === 2 && j === 8 ? false : 'black'));
  g.pbox(3, [1.25, 1.875], [-2.5, 5.0], 'gunmetal');
  g.box([3, 3, 1], [5, 8, 9], (i, j, k) => (i === 4 && j === 6 && k >= 2 && k <= 6 && k % 2 === 0 ? 'red' : i === 4 && (j === 3 || j === 7) ? 'gunmetal' : 'blackMatte'));
  // The stock, angled down to its butt plate.
  g.prof([[-3.75, 5.0], [-12.5, 4.0], [-12.5, -0.9], [-11.0, -0.9], [-3.75, 1.875]], 3, (i, j, k) => (k === -20 ? 'gunmetal' : 'black'));
  g.prof([[-5.6, 3.6], [-10.6, 3.0], [-10.6, 1.0], [-5.6, 2.5]], 3, (i) => (Math.abs(i) === 1 ? false : 'ribs'));
  // The grip, the guard, the trigger.
  g.grip(3, [-3.125, 1.25], 1.29, 4, 15, (i, j) => (j === -5 ? 'gunmetal' : j % 2 ? 'ribs' : 'blackMatte'));
  g.pbox(1, [0, 0.625], [1.25, 4.375], 'gunmetal');
  g.pbox(1, [0, 1.25], [3.75, 4.375], 'gunmetal');
  g.box([0, 1, 3], [1, 2, 4], 'steel');
  // The jacket: slots two voxels long down each side and along the top, the heat inside them.
  g.disc(1.45, [0, YC], [6.25, 22.5], 'black');
  g.paint([-3, 0, 10], [4, 12, 35], (i, j, k) => {
    const jj = j - g.cell(1, YC);
    const edge = Math.abs(i) === 2 || Math.abs(jj) === 2;
    if (!edge) return 'heat';
    if (Math.abs(i) === 2 && jj === 0 && k % 3 !== 0) return false;
    if (i === 0 && jj === 2 && k % 3 !== 1) return false;
    return undefined;
  });
  g.disc(1.45, [0, YC], [6.25, 6.875], 'gunmetal');
  g.disc(1.45, [0, YC], [21.875, 22.5], 'gunmetal');
  // The bipod folded under the jacket: its clamp, the legs laid forward, their feet.
  g.disc(2.0, [0, YC], [11.25, 11.875], (i, j) => (j < g.cell(1, YC) ? 'gunmetal' : undefined));
  g.rod([-1, 0], [11.9, 1.5], [21.2, 1.5], 'steel');
  g.rod([1, 2], [11.9, 1.5], [21.2, 1.5], 'steel');
  g.box([-1, 1, 33], [2, 2, 34], (i) => (i === 0 ? false : 'gunmetal'));
  // The barrel, the flared muzzle and its glowing ring.
  g.disc(0.9, [0, YC], [22.5, 24.375], 'gunmetal');
  g.disc(1.3, [0, YC], [24.375, 25.0], 'gunmetal');
  g.disc(1.45, [0, YC], [25.0, 25.625], (i, j) => (i === 0 && j === g.cell(1, YC) ? 'bore' : Math.abs(i) <= 1 && Math.abs(j - g.cell(1, YC)) <= 1 ? 'bore' : 'ring'));
  // The scope: mounts on the receiver, the tube back from the front housing.
  const sight = scopeSight(g, { sill: 7.5, z: 5.0, back: -0.625, frame: 'gunmetal', body: 'black', eye: 'blackMatte', eyeW: 3, mounts: [0.625, 3.75], seat: 5.625, mount: 'gunmetal' });
  g.box([0, 10, 9], [1, 11, 10], 'red');
  return g.mark('grip', [0, 0, 0]).mark('grip2', [0, 1.25, 9.0625]).mark('muzzle', [0, YC, 25.625]).mark('sight', sight).mark('mag', [2.1875, YC, 3.125]);
}

/** Z-7 Rotary Blaster: the Rebels' rotary cannon, six barrels round a hub in steel collars, a drum under the housing lit round its rim, a carry handle with the sight on it. */
function rebelHeavy() {
  const g = new Model('rebel_heavy', 'Z-7 Rotary Blaster', 'blaster').colours({
    grey: [0x4c5159, 0.34, 0.75], greyDark: [0x33363c, 0.36, 0.75], barrel: [0x26282c, 0.3, 0.7], steel: [0xa8adb4, 0.28, 1], sand: [0xb89a6c, 0.7], sandDark: [0x957a52, 0.72],
    olive: [0x5b6446, 0.6, 0.2], oliveDark: [0x444b34, 0.62, 0.2], orange: [0xf08a24, 0.5], bore: [0x0b0b0d, 0.7], amber: [0xc07008, 0.4, 0, 1], green: [0x0e9a2a, 0.4, 0, 1],
    tip: [0xc04008, 0.4, 0, 1],
  });
  const YC = 3.4375;
  const jc = g.cell(1, YC);
  // The barrel cluster: six barrels round a hub, in collars at the back, the middle and the front; their tips glowing.
  const BARRELS = [[0, 2], [0, -2], [2, 1], [-2, 1], [2, -1], [-2, -1]];
  for (const [i, jj] of BARRELS) g.box([i, jc + jj, 10], [i + 1, jc + jj + 1, 35], 'barrel');
  for (const [k0, k1] of [[10, 12], [20, 21], [32, 34]]) g.disc(1.45, [0, YC], [g.b(2, k0), g.b(2, k1)], (i, j) => (Math.abs(i) + Math.abs(j - jc) <= 1 ? 'greyDark' : 'steel'));
  for (const [i, jj] of BARRELS) g.box([i, jc + jj, 34], [i + 1, jc + jj + 1, 35], 'tip');
  g.box([0, jc, 34], [1, jc + 1, 35], 'bore');
  // The housing: boxy, seven across, its long edges bevelled; an orange stripe and vents down its sides.
  g.pbox(7, [1.25, 6.25], [-3.75, 6.25], (i, j, k) => {
    if (Math.abs(i) === 3 && (j === 2 || j === 9)) return false;
    if (Math.abs(i) === 3 && j === 7 && k >= -5 && k <= 7) return 'orange';
    if (Math.abs(i) === 3 && j >= 3 && j <= 5 && k >= 2 && k <= 8 && k % 2 === 0) return 'bore';
    return 'grey';
  });
  g.pbox(5, [1.875, 5.625], [-4.375, -3.75], 'greyDark');
  g.box([3, 4, -4], [4, 5, 0], (i, j, k) => (k === -3 ? 'green' : k === -1 ? 'amber' : undefined));
  // The rear grip (sand), the guard and trigger.
  g.grip(3, [-3.125, 1.25], 1.29, 4, 15, (i, j) => (j === -5 ? 'greyDark' : j % 2 ? 'sandDark' : 'sand'));
  g.pbox(1, [0, 0.625], [1.25, 3.125], 'greyDark');
  g.box([0, 1, 2], [1, 2, 3], 'steel');
  // The drum under the housing, ahead of the grip: olive, a steel hub, amber lights round its rim.
  g.drum(2.2, [-0.9, 5.3], 5, (i, j, k) => {
    const r = Math.hypot(g.c(1, j) + 0.9, g.c(2, k) - 5.3);
    if (Math.abs(i) === 2) return r < 0.7 ? 'steel' : r < 1.4 ? 'oliveDark' : 'olive';
    if (i === 0 && r > 1.5) return (j + k) % 2 === 0 ? 'amber' : 'oliveDark';
    return 'olive';
  });
  // The front handle (sand) under the barrels.
  g.pbox(3, [0.625, 1.875], [11.25, 13.75], 'greyDark');
  g.prof([[11.6, 0.7], [13.5, 0.7], [13.3, -2.5, 0.3], [11.4, -2.5, 0.3]], 3, (i, j) => (j === -4 ? 'sandDark' : j % 2 ? 'sandDark' : 'sand'));
  // The carry handle over the barrels, its rear post under the sight, its front post on the middle collar.
  const sight = optic(g, { w: 3, h: 3, sill: 8.75, z: -0.625, frame: 'orange', body: 3, bodyW: 5, back: 4, len: 20, drop: 2, aheadW: 3, colour: 'greyDark' });
  g.pbox(5, [5.625, 6.875], [-3.125, 0], (i, j, k) => (Math.abs(i) === 2 && j === 10 ? false : 'greyDark'));
  g.pbox(1, [5.0, 6.875], [11.875, 13.125], 'greyDark');
  return g.mark('grip', [0, 0, 0]).mark('grip2', [0, -0.9375, 12.5]).mark('muzzle', [0, YC, 21.875]).mark('sight', sight).mark('mag', [0, -0.9, 5.3]);
}

/** A sniper's scope along z at height `sc`: its tube, rings on mounts, the eyepiece bell (its rear lens the `sight`), the objective bell (its lens glinting), turrets. */
function scope(g, { sc, z0, z1, seat, rings, tube = 0.9, bell = 1.45, obj = 1.8, body, rim, lens, glint, hot, mount }) {
  g.disc(tube, [0, sc], [z0 + 1.875, z1 - 2.5], body);
  for (const z of rings) {
    g.pbox(3, [seat, sc], [z, z + 0.625], mount);
    g.disc(tube + 0.35, [0, sc], [z, z + 0.625], mount);
  }
  const kr = g.cell(2, z0 + 1e-6), kf = g.cell(2, z1 - 1e-6);
  g.disc(bell, [0, sc], [z0, z0 + 1.875], (i, j, k) => (k === kr ? (Math.hypot(g.c(0, i), g.c(1, j) - sc) < 0.9 ? lens : rim) : body));
  g.disc(obj, [0, sc], [z1 - 2.5, z1], (i, j, k) => {
    if (k !== kf) return body;
    const r = Math.hypot(g.c(0, i), g.c(1, j) - sc);
    return r > 1.3 ? rim : r > 0.9 ? glint : i === 0 && j === g.cell(1, sc) + 1 ? hot : lens;
  });
  // The turrets: elevation on top, windage on the right.
  const kt = g.cell(2, (z0 + z1) / 2);
  g.box([0, g.cell(1, sc) + 2, kt], [1, g.cell(1, sc) + 3, kt + 2], rim);
  g.box([-2, g.cell(1, sc), kt], [-1, g.cell(1, sc) + 1, kt + 2], rim);
  return [0, sc, z0];
}

/** E-12 Sniper: the E-12 stretched for the long view, a long barrel out of the jacket, a thumbhole stock, a big scope. */
function impSniper() {
  const g = new Model('imp_sniper', 'E-12 Sniper', 'blaster').colours({
    black: [0x1d1e22, 0.3, 0.55], blackMatte: [0x202124, 0.75], ribs: [0x2c2d31, 0.75], gunmetal: [0x3c4048, 0.32, 0.8], steel: [0xa8adb4, 0.28, 1],
    bore: [0x0b0b0d, 0.7], red: [0xb00a0a, 0.4, 0, 1], ring: [0xb0081c, 0.4, 0, 1],
    scope: [0x222328, 0.32, 0.45], lens: [0x10161a, 0.05, 0.3], glint: [0xd01c28, 0.08, 0.2, 0.7], hot: [0xffd6c4, 0.1, 0, 1],
  });
  const YC = 3.4375;
  // The jacket (holes as the rifle's), its rear cap; the long barrel with its rings, the glowing muzzle.
  const holes = perforated(g, YC, [6, 23], (i, jj, k) => (Math.abs(i) === 2 && jj === 0 ? k % 2 === 0 : i === 0 && jj === -2 ? k % 2 === 1 : false));
  g.disc(1.45, [0, YC], [-3.75, 14.375], 'black');
  g.paint([-3, 0, -6], [4, 12, 23], (i, j, k) => holes(i, j, k));
  g.disc(1.0, [0, YC], [-4.375, -3.75], 'gunmetal');
  g.disc(1.45, [0, YC], [14.375, 15.0], 'gunmetal');
  g.disc(0.7, [0, YC], [15.0, 24.375], 'gunmetal');
  for (const z of [17.5, 21.25]) g.disc(0.9, [0, YC], [z, z + 0.625], 'black');
  g.disc(0.9, [0, YC], [24.375, 25.0], 'gunmetal');
  muzzleRing(g, 0.9, [0, YC], 40, 'ring');
  // The magazine out the left, as the rifle's.
  g.box([3, 3, 2], [4, 8, 7], 'gunmetal');
  g.box([4, 4, 3], [6, 7, 6], 'black');
  g.box([6, 4, 3], [7, 7, 6], 'gunmetal');
  g.box([3, 5, -3], [4, 6, -2], 'red');
  // Under the jacket: the housing, the grip, the guard and trigger.
  g.pbox(3, [1.25, 1.875], [-2.5, 4.375], 'gunmetal');
  g.grip(3, [-3.125, 1.25], 1.29, 4, 15, (i, j) => (j === -5 ? 'gunmetal' : j % 2 ? 'ribs' : 'blackMatte'));
  g.pbox(1, [0, 0.625], [1.25, 4.375], 'gunmetal');
  g.pbox(1, [0, 1.25], [3.75, 4.375], 'gunmetal');
  g.box([0, 1, 3], [1, 2, 4], 'steel');
  // The thumbhole stock: its comb, the hole behind the grip, the butt plate.
  g.prof([[-4.375, 5.0], [-8.0, 5.3], [-12.2, 4.7], [-12.2, -1.3], [-10.6, -1.3], [-6.2, 0.3], [-3.2, 1.25], [-3.2, 1.9], [-4.375, 1.9]], 3, (i, j, k) => (k === -20 ? 'gunmetal' : 'black'));
  g.prof([[-4.8, 2.9], [-7.5, 3.3], [-7.5, 1.1], [-4.8, 1.3]], 3, false);
  // The scope on its mounts.
  const sight = scope(g, { sc: 7.8125, z0: -3.125, z1: 11.25, seat: 5.0, rings: [0.0, 6.25], body: 'scope', rim: 'gunmetal', lens: 'lens', glint: 'glint', hot: 'hot', mount: 'gunmetal' });
  return g.mark('grip', [0, 0, 0]).mark('grip2', [0, 1.25, 9.375]).mark('muzzle', [0, YC, 25.625]).mark('sight', sight).mark('mag', [3.125, YC, 2.8125]);
}

/** Longshot Cycler: the Rebels' long rifle, a worn wooden stock wrapped in cloth, a long thin barrel bound in cloth and brass, a brass-trimmed scope. */
function rebelSniper() {
  const g = new Model('rebel_sniper', 'Longshot Cycler', 'blaster').colours({
    wood: [0x6e4428, 0.62], woodLight: [0x8a5a34, 0.6], cloth: [0xbfa57c, 0.9], clothDark: [0x9c8560, 0.9], brass: [0xc9a152, 0.3, 1], brassDark: [0x9a7a3a, 0.35, 1],
    iron: [0x3d3b38, 0.4, 0.7], ironDark: [0x2a2927, 0.45, 0.7], bore: [0x0b0b0d, 0.7], green: [0x0e9a2a, 0.4, 0, 1], ring: [0xc04008, 0.4, 0, 1],
    scope: [0x2a2622, 0.38, 0.4], lens: [0x10161a, 0.05, 0.3], glint: [0x2aa8d8, 0.08, 0.2, 0.6], hot: [0xe8fbff, 0.1, 0, 1],
  });
  // The stock: long and slim, curving down to a broad butt; cloth wound round its wrist.
  g.prof([[-2.0, 4.2], [-5.5, 3.7], [-9.5, 3.5], [-12.6, 3.9, 0.5], [-13.0, 1.0, 0.8], [-12.2, -1.9, 0.4], [-10.9, -1.9], [-8.6, 0.4, 1.2], [-5.5, 1.6], [-2.0, 1.6]], 3, (i, j) => (j >= 5 ? 'woodLight' : 'wood'));
  g.pbox(3, [0.625, 4.375], [-4.375, -2.5], (i, j, k) => ((j + k) % 2 === 0 ? 'cloth' : 'clothDark'));
  // The receiver (iron) and its brass bands; the grip (wood), the guard and trigger.
  g.pbox(3, [1.875, 4.375], [-2.5, 6.25], (i, j, k) => (k === -4 || k === 9 ? 'brass' : 'iron'));
  g.grip(3, [-3.125, 1.25], 1.29, 4, 18, (i, j) => (j === -5 ? 'brassDark' : 'wood'));
  g.pbox(1, [0, 0.625], [1.25, 3.75], 'ironDark');
  g.pbox(1, [0, 1.25], [3.125, 3.75], 'ironDark');
  g.box([0, 1, 3], [1, 2, 4], 'brass');
  // The power cell under the receiver ahead of the guard, a green light on its left.
  g.pbox(3, [0.0, 1.875], [3.75, 6.25], (i, j, k) => (i === 1 && j === 1 && k === 8 ? 'green' : j === 0 ? 'brassDark' : 'ironDark'));
  // The forend (wood) under the barrel.
  g.prof([[6.25, 1.9], [6.25, 3.1], [13.1, 3.1], [13.1, 2.5], [11.9, 1.9]], 3, 'wood');
  // The long barrel, bound in cloth and brass bands; a flare at its end and the glowing ring.
  g.disc(0.7, [0, 3.4375], [6.25, 26.875], 'iron');
  for (const [z0, z1] of [[14.375, 15.625], [20.0, 21.25]]) g.disc(0.9, [0, 3.4375], [z0, z1], (i, j, k) => ((i + j + k) % 2 === 0 ? 'cloth' : 'clothDark'));
  for (const z of [13.125, 16.25, 19.375, 21.875]) g.disc(0.9, [0, 3.4375], [z, z + 0.625], 'brass');
  g.disc(0.9, [0, 3.4375], [26.875, 27.5], 'brassDark');
  muzzleRing(g, 0.9, [0, 3.4375], 44, 'ring');
  // The scope, brass-trimmed.
  const sight = scope(g, { sc: 7.8125, z0: -3.75, z1: 11.875, seat: 4.375, rings: [-0.625, 6.25], body: 'scope', rim: 'brass', lens: 'lens', glint: 'glint', hot: 'hot', mount: 'brassDark' });
  return g.mark('grip', [0, 0, 0]).mark('grip2', [0, 1.25, 10.0]).mark('muzzle', [0, 3.4375, 28.125]).mark('sight', sight).mark('mag', [0, 0.9375, 5.0]);
}

/** Scout Blaster Pistol: the Empire's sidearm, slim and black, a slotted slide, a steep grip, a mini red dot on its back. */
function impPistol() {
  const g = new Model('imp_pistol', 'Scout Blaster Pistol', 'blaster').colours({
    black: [0x1d1e22, 0.3, 0.55], blackMatte: [0x202124, 0.75], ribs: [0x2c2d31, 0.75], gunmetal: [0x3c4048, 0.32, 0.8], steel: [0xa8adb4, 0.28, 1],
    bore: [0x0b0b0d, 0.7], vent: [0x0f0f11, 0.7], red: [0xb00a0a, 0.4, 0, 1], ring: [0xb0081c, 0.4, 0, 1], anod: [0x2a2c31, 0.45, 0.4],
  });
  // The frame, the steep grip (ribbed), its heel; the guard and trigger.
  g.prof([[-2.4, 3.1], [6.9, 3.1], [6.9, 2.1], [1.9, 2.1], [1.4, 1.25], [-1.4, 1.25], [-2.6, 2.4]], 3, 'gunmetal');
  g.grip(3, [-3.125, 1.875], 1.4, 4, 20, (i, j, k, back) => (j === -5 ? 'gunmetal' : k === back ? 'blackMatte' : j % 2 ? 'ribs' : 'blackMatte'));
  g.pbox(1, [0, 0.625], [1.25, 4.375], 'gunmetal');
  g.pbox(1, [0, 1.875], [3.75, 4.375], 'gunmetal');
  g.box([0, 2, 3], [1, 3, 4], 'steel');
  // The slide: long and black, a row of vents along its top half, a red power light on its left.
  g.pbox(3, [3.125, 5.0], [-2.5, 7.5], (i, j, k) => (Math.abs(i) === 1 && j === 7 && k >= 2 && k <= 10 && k % 2 === 0 ? 'vent' : 'black'));
  g.set(1, 6, -3, 'red');
  // The barrel out of the slide's front, its shroud; the glowing muzzle.
  g.disc(0.7, [0, 4.0625], [7.5, 10.0], 'gunmetal');
  g.pbox(3, [3.125, 3.75], [7.5, 8.75], 'black');
  muzzleRing(g, 0.9, [0, 4.0625], 16, 'ring');
  // The mini red dot on the back of the slide.
  const sight = optic(g, { w: 3, h: 2, sill: 6.25, z: -1.25, frame: 'steel', body: 2, bodyW: 5, back: 1, len: 3, drop: 1, aheadW: 3 });
  const muzzle = [0, 4.0625, g.b(2, 17)];
  return g.mark('grip', [0, 0, 0]).mark('grip2', [0, -2, 2]).mark('muzzle', muzzle).mark('sight', sight).mark('mag', [0, -3.0, -0.4]);
}

/** Heavy Blaster Pistol: the Rebels' hand cannon: a broomhandle grip, the magazine ahead of the guard, a ribbed barrel, a flared flash hider, a scope on top. */
function rebelPistol() {
  const g = new Model('rebel_pistol', 'Heavy Blaster Pistol', 'blaster').colours({
    black: [0x1d1e22, 0.3, 0.55], blackMatte: [0x222326, 0.75], gunmetal: [0x3c4048, 0.32, 0.8], steel: [0xa8adb4, 0.28, 1], wood: [0x4a2e1c, 0.55], woodDark: [0x38210f, 0.6],
    bore: [0x0b0b0d, 0.7], blue: [0x1664d4, 0.4, 0, 1], ring: [0xc04008, 0.4, 0, 1],
  });
  const YC = 3.4375;
  // The receiver: long, flat-sided, its hammer behind.
  g.pbox(3, [1.875, 4.375], [-2.5, 6.25], 'black');
  g.pbox(1, [3.75, 5.0], [-3.125, -2.5], 'gunmetal');
  // The broomhandle grip (ribbed wood), rounded at its heel; a lanyard ring.
  g.grip(3, [-3.75, 1.875], 1.2, 4, 10, (i, j, k, back) => (j === -6 ? 'gunmetal' : (Math.abs(i) === 1 && (k === back || k === back + 3)) ? undefined : j % 2 ? 'woodDark' : 'wood'));
  g.box([0, -7, -3], [1, -6, -2], 'steel');
  // The guard and trigger, the magazine ahead of them.
  g.pbox(1, [0, 0.625], [1.25, 3.125], 'gunmetal');
  g.pbox(1, [0, 1.875], [2.5, 3.125], 'gunmetal');
  g.box([0, 1, 2], [1, 2, 3], 'steel');
  g.pbox(3, [-1.25, 1.875], [3.125, 5.0], (i, j) => (j === -2 ? 'gunmetal' : 'black'));
  g.box([1, 0, 6], [2, 1, 7], 'blue');
  // The barrel in its ribbed cooling sleeve, the flared flash hider and its glowing ring.
  g.disc(0.9, [0, YC], [6.25, 9.375], 'gunmetal');
  for (const z of [6.875, 8.125]) g.disc(1.3, [0, YC], [z, z + 0.625], 'black');
  g.disc(1.3, [0, YC], [9.375, 10.0], 'gunmetal');
  g.disc(1.45, [0, YC], [10.0, 10.625], (i, j) => (Math.abs(i) <= 1 && Math.abs(j - g.cell(1, YC)) <= 1 ? 'bore' : 'ring'));
  // The scope on top: its front housing the dot sight, the tube back to its eyepiece.
  const sight = scopeSight(g, { h: 2, sill: 6.25, z: 3.75, back: -1.25, frame: 'gunmetal', body: 'black', eye: 'blackMatte', eyeW: 3, mounts: [-0.625, 2.5], seat: 4.375, mount: 'gunmetal' });
  return g.mark('grip', [0, 0, 0]).mark('grip2', [0, -2, 2]).mark('muzzle', [0, YC, 10.625]).mark('sight', sight).mark('mag', [0, 0.3125, 4.0625]);
}

// ---------------------------------------------------------------------------------------------
// The thermal detonator

/** Thermal Detonator: a bright steel ball, a raised band round its middle of dark panels between blinking red lights, the arming lever on top. */
function detonator() {
  const g = new Model('detonator', 'Thermal Detonator', 'detonator', { offset: [-0.5, -0.5, -0.5] }).colours({
    steel: [0xd4d8de, 0.24, 1], steelDark: [0x8a9098, 0.3, 1], band: [0x2c2e33, 0.4, 0.6], red: [0xb00a0a, 0.4, 0, 1], lever: [0x46494f, 0.35, 0.8],
  });
  g.ball(2.2, [0, 0, 0], 'steel');
  // The band: a voxel proud of the ball round its middle, lights and dark panels by turns all round it.
  for (let k = -4; k <= 4; k++)
    for (let i = -4; i <= 4; i++) {
      const r = Math.hypot(g.c(0, i), g.c(2, k));
      if (r > 2.45) continue;
      const n = Math.floor(((Math.atan2(g.c(2, k), g.c(0, i)) / (2 * Math.PI)) * 12 + 12.5) % 12);
      g.set(i, 0, k, r > 1.9 && n % 2 === 0 ? 'red' : 'band');
    }
  // Seams above and below the band.
  g.paint([-4, 1, -4], [5, 2, 5], (i, j, k) => (Math.hypot(g.c(0, i), g.c(2, k)) > 1.7 ? 'steelDark' : undefined));
  g.paint([-4, -1, -4], [5, 0, 5], (i, j, k) => (Math.hypot(g.c(0, i), g.c(2, k)) > 1.7 ? 'steelDark' : undefined));
  // The arming lever on top: its hinge post and the lever laid back along it, a red button under its tip.
  g.box([0, 4, -1], [1, 5, 3], 'lever');
  g.box([0, 3, 2], [1, 4, 3], 'red');
  return g.mark('grip', [0, 0, 0]);
}

// ---------------------------------------------------------------------------------------------
// The heroes' guns

/**
 * Wookiee Crossblaster (the bowcaster): the Wookiee's crossbow-blaster, big and hand-made: a wooden
 * stock bound in leather, a riveted receiver panelled in wood, a quiver of quarrels on its right, a
 * scope on its left (its open sight at the back), the loaded quarrel glowing green along its top,
 * two bow arms over the short barrel, out to the sides and curving forward to brass tips, the
 * string across the front between them.
 */
function heroBowcaster() {
  const g = new Model('hero_bowcaster', 'Wookiee Crossblaster', 'blaster').colours({
    wood: [0x7a4a26, 0.62], woodDark: [0x5a3418, 0.66], leather: [0x3e2818, 0.85], brass: [0xc9a152, 0.3, 1], brassDark: [0x9a7a3a, 0.35, 1],
    metal: [0x4f4a43, 0.4, 0.7], metalDark: [0x35322e, 0.45, 0.7], string: [0xd8cfb8, 0.8], bore: [0x0b0b0d, 0.7],
    bolt: [0x0e9a2a, 0.4, 0, 1], boltHot: [0xd8ffd8, 0.4, 0, 1], scope: [0x2a2622, 0.38, 0.4], lens: [0x10161a, 0.05, 0.3], glint: [0x0e9a2a, 0.08, 0.2, 0.7],
  });
  const YC = 3.4375;
  // The receiver: iron, long and tall, its sides panelled in wood with brass rivets at the panels' corners; a brass rail on top.
  g.pbox(5, [1.875, 5.625], [-3.125, 10.625], (i, j, k) => {
    if (Math.abs(i) === 2 && j === 8) return false;
    if (Math.abs(i) === 2 && j >= 4 && j <= 7 && k >= -3 && k <= 14) return (j === 4 || j === 7) && (k === -3 || k === 14) ? 'brass' : 'wood';
    return 'metal';
  });
  g.pbox(3, [5.625, 6.25], [-1.875, 17.5], 'brassDark');
  // The stock: long and hand-cut, lashed with leather, a brass butt plate.
  g.prof([[-3.1, 5.6], [-8.1, 5.3], [-15.6, 5.0, 0.8], [-16.9, 3.4], [-16.9, -2.2, 0.6], [-14.4, -2.5], [-10.0, 0.0, 1.2], [-3.75, 1.9], [-3.1, 1.9]], 3, (i, j, k) =>
    k === -28 ? 'brass' : k === -12 || k === -11 ? 'leather' : (j + (k >> 2)) % 5 === 0 ? 'woodDark' : 'wood');
  // The grip (wood, bound in leather), the brass guard and trigger.
  g.grip(3, [-3.125, 1.875], 1.29, 4, 15, (i, j) => (j === -5 ? 'brass' : j % 3 === 0 ? 'leather' : 'wood'));
  g.pbox(1, [0, 0.625], [1.25, 4.375], 'brass');
  g.pbox(1, [0, 1.875], [3.75, 4.375], 'brass');
  g.box([0, 1, 3], [1, 2, 4], 'brassDark');
  // The quiver of spare quarrels on the right, their green heads showing at its back.
  g.box([-4, 3, 2], [-2, 8, 13], (i, j, k) => (k === 2 && i === -3 && (j === 4 || j === 6) ? 'bolt' : j === 3 || j === 7 ? 'brassDark' : 'leather'));
  // The barrel under the bow, brass bands, the fore-grip under it; the glowing muzzle.
  g.disc(0.9, [0, YC], [10.625, 22.5], (i, j, k) => (k === 21 || k === 30 ? 'brass' : 'metalDark'));
  g.prof([[14.4, 2.6], [16.2, 2.6], [15.9, -1.9, 0.3], [14.1, -1.9, 0.3]], 3, (i, j) => (j === -1 || j === -2 ? 'leather' : 'wood'));
  muzzleRing(g, 0.9, [0, YC], 36, 'bolt');
  // The bow: its mount on the barrel, two arms out to the sides and curving forward to their brass tips, the string across the front between them.
  g.box([-2, 7, 26], [3, 11, 29], (i, j, k) => (k === 28 ? 'brassDark' : 'metalDark'));
  for (const sgn of [1, -1])
    g.arm([[1.25, 17.2], [5.0, 16.6], [8.8, 17.2], [11.2, 18.8], [12.2, 21.0], [12.2, 22.5]].map(([x, z]) => [x * sgn, z]), 0.55, [4.375, 6.875], (i, j, k, t) =>
      t > 0.86 ? 'brass' : t < 0.14 ? 'leather' : (j === 8 || j === 9) && t > 0.3 && t < 0.7 ? 'metalDark' : 'metal');
  g.box([g.cell(0, -12.2), 8, 36], [g.cell(0, 12.2) + 1, 9, 37], (i, j, k) => (g.has(i, j, k) ? undefined : 'string'));
  // The quarrel loaded along the top: its nock, the shaft glowing, the head over the bow.
  g.box([0, 10, -2], [1, 11, -1], 'brass');
  g.box([0, 10, -1], [1, 11, 31], 'bolt');
  g.box([-1, 10, 31], [2, 11, 32], (i) => (i === 0 ? 'boltHot' : 'bolt'));
  g.box([0, 10, 32], [1, 11, 33], 'boltHot');
  // The scope on the left: brackets from the receiver, the open sight at its back on a block, the tube ahead a voxel under the window, the objective glinting green.
  const sight = optic(g, { w: 3, h: 2, sill: 8.125, z: -1.25, frame: 'brass', body: 5, bodyW: 5, back: 1, colour: 'metalDark', x: 3 });
  g.box([2, 10, -1], [5, 12, 15], 'scope');
  g.box([1, 9, 15], [6, 12, 17], (i, j, k) => (k === 16 && i >= 2 && i <= 4 && j >= 10 ? (i === 3 && j === 11 ? 'glint' : 'lens') : 'metalDark'));
  for (const k of [1, 10]) g.box([3, 6, k], [4, 10, k + 1], 'brassDark');
  return g.mark('grip', [0, 0, 0]).mark('grip2', [0, 0.3125, 15.3125]).mark('muzzle', [0, YC, g.b(2, 37)]).mark('sight', sight).mark('mag', [-2.1875, 3.4375, 4.6875]);
}

/**
 * EE-4 Carbine (the bounty hunter's EE-3): a short, scoped blaster carbine, dark metal worn silver on
 * its edges: a thick round barrel vented down its sides, the break-open frame and its hammer, a
 * small curved stock, a long scope on the left of the barrel (its open sight at the back), a
 * leather sling.
 */
function heroEe3() {
  const g = new Model('hero_ee3', 'EE-4 Carbine', 'blaster').colours({
    black: [0x1d1e22, 0.34, 0.55], gunmetal: [0x363a41, 0.34, 0.8], worn: [0xa8adb4, 0.28, 1], grip: [0x3a2a1e, 0.6], rubber: [0x1c1c1e, 0.9],
    sling: [0x5a3a22, 0.85], bore: [0x0b0b0d, 0.7], ring: [0xb0081c, 0.4, 0, 1], red: [0xb00a0a, 0.4, 0, 1],
    scope: [0x222328, 0.32, 0.45], lens: [0x10161a, 0.05, 0.3], glint: [0xd01c28, 0.08, 0.2, 0.6],
  });
  const YC = 3.4375;
  // The barrel: thick and round, vented down its sides, bands round it; its front cap, the front sight post, the glowing muzzle.
  g.disc(1.45, [0, YC], [0.625, 11.25], (i, j, k) => (k === 7 || k === 13 ? 'gunmetal' : 'black'));
  g.paint([-3, 0, 2], [4, 12, 18], (i, j, k) => {
    const jj = j - g.cell(1, YC);
    if (Math.abs(i) <= 1 && Math.abs(jj) <= 1) return 'bore';
    return Math.abs(i) === 2 && jj === 0 && k >= 3 && k <= 16 && k !== 7 && k !== 13 && k % 3 !== 0 ? false : undefined;
  });
  g.disc(1.45, [0, YC], [11.25, 11.875], 'gunmetal');
  g.pbox(1, [5.0, 5.625], [10.625, 11.25], 'worn');
  muzzleRing(g, 0.9, [0, YC], 19, 'ring');
  // The frame: the break-open action behind the barrel, its hinge, the hammer's spur behind; the trigger housing under the barrel.
  g.pbox(3, [1.25, 5.0], [-3.125, 0.625], 'gunmetal');
  g.box([0, 8, -5], [1, 9, -3], 'black');
  g.box([-1, 2, 0], [2, 3, 1], 'worn');
  g.pbox(3, [1.25, 1.875], [0.625, 3.75], 'gunmetal');
  // The grip (dark wood), the guard and trigger.
  g.grip(3, [-3.125, 1.25], 1.1, 4, 22, (i, j, k, back) => (j === -5 ? 'gunmetal' : k === back ? 'black' : 'grip'));
  g.pbox(1, [0, 0.625], [1.25, 3.75], 'gunmetal');
  g.pbox(1, [0, 1.25], [3.125, 3.75], 'gunmetal');
  g.box([0, 1, 3], [1, 2, 4], 'worn');
  // The small curved stock: two struts from the frame to a rubber butt.
  g.path(3, [[-3.1, 4.4], [-6.4, 4.0, 1.5], [-9.4, 2.2]], 'gunmetal');
  g.path(3, [[-2.5, 1.0], [-6.2, 0.4, 1.5], [-9.4, -0.1]], 'gunmetal');
  g.pbox(3, [-0.625, 3.125], [-10.625, -9.375], (i, j, k) => (k === -17 ? 'rubber' : 'gunmetal'));
  // A red power light on the frame's left.
  g.set(1, 5, -3, 'red');
  // The long scope on the left: brackets on the barrel, the open sight at its back on a block, the tube ahead a voxel under the window, the objective glinting.
  const sight = optic(g, { w: 3, h: 2, sill: 6.875, z: -1.25, frame: 'gunmetal', body: 3, bodyW: 5, back: 1, colour: 'black', x: 3 });
  g.box([2, 8, -1], [5, 10, 13], 'scope');
  g.box([1, 7, 13], [6, 10, 15], (i, j, k) => (k === 14 && i >= 2 && i <= 4 && j >= 8 ? (i === 3 && j === 9 ? 'glint' : 'lens') : 'black'));
  for (const k of [1, 9]) g.box([1, 7, k], [4, 8, k + 1], 'gunmetal');
  // The worn silver on its edges.
  g.wear(['black', 'gunmetal'], 'worn', 0.1);
  // The sling on the left: from a swivel under the barrel's front, slack under the gun, to the butt.
  g.path([2, 3], [[9.4, 1.6], [4.4, -2.2, 3], [-1.9, -3.4, 3], [-7.5, -2.2, 2], [-10.0, -0.3]], 'sling');
  return g.mark('grip', [0, 0, 0]).mark('grip2', [0, 1.25, 6.5625]).mark('muzzle', [0, YC, g.b(2, 20)]).mark('sight', sight).mark('mag', [0, 1.875, 0.3125]);
}

// ---------------------------------------------------------------------------------------------
// The sabers

/**
 * A saber's blade from cell `k0`, `len` voxels long, three across: a white-hot core down the
 * middle of each face, the corners the blade's colour; the last two voxels round off (the corners
 * gone, then the core alone) to a white tip. Returns the tip (px).
 */
function blade(g, k0, len) {
  const tip = k0 + len - 1;
  for (let k = k0; k <= tip; k++)
    for (let j = -1; j <= 1; j++)
      for (let i = -1; i <= 1; i++) {
        const corner = i !== 0 && j !== 0;
        if (k === tip && (i !== 0 || j !== 0)) continue;
        if (k === tip - 1 && corner) continue;
        g.set(i, j, k, corner ? 'glow' : 'core');
      }
  return [0, 0, g.b(2, tip + 1)];
}

/** A saber's model: its hilt (`hilt(g, ring, square)`) and blade, the markers. */
function saber(id, name, blade_, colours, hilt) {
  const g = new Model(id, name, 'saber', { offset: [-0.5, -0.5, 0] }).colours({ core: [0xffffff, 0.5, 0, 1], glow: [blade_, 0.5, 0, 1], ...colours });
  /** A 5-voxel round section (the square's corners off) at cells k0..k1. */
  const ring = (k0, k1, c) => g.box([-2, -2, k0], [3, 3, k1], (i, j, k) => (Math.abs(i) === 2 && Math.abs(j) === 2 ? undefined : typeof c === 'function' ? c(i, j, k) : c));
  /** The 3-voxel square body at cells k0..k1. */
  const square = (k0, k1, c) => g.box([-1, -1, k0], [2, 2, k1], c);
  const { end, grip2 } = hilt(g, ring, square);
  const tip = blade(g, end, 35);
  return g.mark('grip', [0, 0, 0]).mark('grip2', [0, 0, grip2]).mark('muzzle', tip);
}

/** Luke's (the green one): black and silver, a silver pommel and emitter shroud, a grooved black grip, the control box with its switch. */
function saberLuke() {
  return saber('saber_luke', "Luke Skyblocker's saber", 0x0c8418, {
    black: [0x1c1d20, 0.35, 0.5], blackMatte: [0x202124, 0.8], silver: [0xc8ccd2, 0.22, 1], silverDark: [0x8e939a, 0.28, 1], red: [0xb00a0a, 0.4, 0, 1],
  }, (g, ring, square) => {
    // The pommel: a silver cap, a ring.
    square(-3, -2, 'silver');
    ring(-2, -1, 'silverDark');
    // The grip: black, grooved round every other voxel.
    square(-1, 3, (i, j, k) => (k % 2 === 0 && (Math.abs(i) === 1) !== (Math.abs(j) === 1) ? 'blackMatte' : 'black'));
    // The control box (on +x, up in the hand) and its switch; the silver neck; the emitter shroud.
    g.box([2, -1, 0], [3, 2, 3], 'silverDark');
    g.set(2, 0, 1, 'red');
    square(3, 4, 'silver');
    ring(4, 6, 'silver');
    return { end: 6, grip2: 2.5 };
  });
}

/** Ben's (the blue one): ribbed silver, black strips down the grip's faces, a knob of a pommel, a ribbed emitter. */
function saberBen() {
  return saber('saber_ben', "Ben Kenoblock's saber", 0x1664d4, {
    silver: [0xc8ccd2, 0.22, 1], silverDark: [0x8e939a, 0.28, 1], black: [0x1c1d20, 0.6], blackMatte: [0x202124, 0.8], brass: [0xc9a152, 0.3, 1],
  }, (g, ring, square) => {
    // The pommel: a knob, its flange.
    g.box([-1, -1, -3], [2, 2, -2], (i, j) => (Math.abs(i) === 1 && Math.abs(j) === 1 ? undefined : 'silverDark'));
    ring(-2, -1, 'silver');
    // The grip: silver, black strips down its four faces.
    square(-1, 3, (i, j) => ((i === 0) !== (j === 0) ? 'blackMatte' : 'silver'));
    // The ribbed emitter: a brass ring, a groove (the activator in it), a silver ring.
    ring(3, 4, 'brass');
    square(4, 5, 'silverDark');
    g.set(0, 2, 4, 'black');
    ring(5, 6, 'silver');
    return { end: 6, grip2: 2.5 };
  });
}

/** Vader's (a red one): a black pommel, raised black tracks down a silver grip, the clamp and its switch box, a black shroud round the emitter. */
function saberVader() {
  return saber('saber_vader', "Darth Voxel's saber", 0xa00808, {
    silver: [0xc8ccd2, 0.22, 1], silverDark: [0x8e939a, 0.28, 1], black: [0x17181b, 0.35, 0.5], blackMatte: [0x1c1d20, 0.8], red: [0xb00a0a, 0.4, 0, 1], green: [0x0e9a2a, 0.4, 0, 1],
  }, (g, ring, square) => {
    // The pommel: black, a silver ring.
    square(-3, -2, 'black');
    ring(-2, -1, 'silverDark');
    // The grip: silver, black rubber tracks raised down its four faces.
    square(-1, 2, 'silver');
    for (const [i, j] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) g.box([i, j, -1], [i + 1, j + 1, 2], 'blackMatte');
    // The clamp: a band round the body, its switch box out on +x (buttons red and green).
    ring(2, 4, 'silver');
    g.box([3, -1, 2], [4, 2, 4], 'black');
    g.set(3, 0, 2, 'red');
    g.set(3, 1, 3, 'green');
    // The black shroud round the emitter, its rim notched.
    ring(4, 6, (i, j, k) => (k === 5 && (Math.abs(i) === 2 || Math.abs(j) === 2) && (i + j) % 2 === 0 ? false : 'black'));
    return { end: 6, grip2: 2.5 };
  });
}

/** The Emperor's (the other red one): slim and dark, electrum rings, its pommel curving down to a point. */
function saberEmperor() {
  return saber('saber_emperor', "Emperor Palpablock's saber", 0xa80a24, {
    dark: [0x1e1b22, 0.3, 0.6], darkMatte: [0x241f28, 0.75], electrum: [0xd8c07a, 0.25, 1], electrumDark: [0xa88e4a, 0.3, 1],
  }, (g, ring) => {
    /** The slim section (the square's corners off), `dy` voxels down. */
    const slim = (k0, k1, c, dy = 0) => g.box([-1, -1 - dy, k0], [2, 2 - dy, k1], (i, j) => (Math.abs(i) === 1 && Math.abs(j + dy) === 1 ? undefined : c));
    // The pommel curving down and back to a point.
    g.set(0, -2, -4, 'electrum');
    slim(-3, -2, 'darkMatte', 1);
    // The grip, slim, electrum rings at its ends and middle; the emitter's electrum crown.
    slim(-2, 5, 'dark');
    for (const k of [-2, 1, 4]) g.box([-1, -1, k], [2, 2, k + 1], 'electrum');
    ring(5, 6, (i, j) => (Math.abs(i) === 2 || Math.abs(j) === 2 ? 'electrumDark' : 'electrum'));
    return { end: 6, grip2: 2.5 };
  });
}

// ---------------------------------------------------------------------------------------------
// Writing and checking

function glb(g) {
  const { faces: list, before } = faces(g.vox, g.P, { merge: true });
  const A = atlas(list, g.P);
  const pos = [], nor = [], uv = [], idx = [];
  list.forEach((f, fi) => {
    const base = pos.length / 3;
    const off = g.offset;
    const n = DIRS[f.dir].n;
    quadCorners(f).forEach((c, ci) => {
      pos.push(...c.map((v, a) => ((v + off[a]) * V) / 16));
      nor.push(...n);
      uv.push(Math.round(A.uvs[fi][ci][0] * 65535), Math.round(A.uvs[fi][ci][1] * 65535));
    });
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  });
  const markerNames = Object.keys(g.markers);
  const nodes = [
    { name: g.id, children: [1, ...markerNames.map((_, k) => k + 2)], extras: { title: g.name } },
    { name: `${g.id}_body` },
    ...markerNames.map((m) => ({ name: m, translation: g.markers[m].map((v) => Math.round((v / 16) * 1e6) / 1e6) })),
  ];
  const glows = [...g.P.colours.values()].some((c) => c.glow > 0);
  const bytes = writeGlb({
    generator: 'Blockfront II src/games/blockfront/tools/weapons/build.mjs',
    nodes,
    sceneName: g.id,
    meshName: `${g.id}_body`,
    meshNode: 1,
    attributes: {
      POSITION: { values: pos, componentType: 5126, type: 'VEC3', minmax: true },
      NORMAL: { values: nor, componentType: 5126, type: 'VEC3' },
      TEXCOORD_0: { values: uv, componentType: 5123, type: 'VEC2', normalized: true },
    },
    indices: idx,
    material: { name: `${g.id}_atlas`, albedo: png(A.albedo), mr: png(A.mr), glow: glows ? png(A.glow, { grey: true }) : null },
  });
  return { bytes, stats: { voxels: g.vox.count, faces: before, quads: list.length, tiles: A.tiles, atlas: `${A.width}x${A.height}` }, pos };
}

/** Each model's intended size (px, x y z): the build says how far each is off. */
const SIZES = {
  imp_rifle: [7.2, 12.9, 27.5], rebel_rifle: [3.1, 12.9, 33], imp_heavy: [5.6, 13.1, 38], rebel_heavy: [4.4, 14.4, 26.3], imp_sniper: [4.4, 14, 37.8], rebel_sniper: [4.4, 12.7, 40.6],
  imp_pistol: [3.1, 10, 12.4], rebel_pistol: [3.1, 12.5, 14.4], hero_bowcaster: [25, 13.1, 40], hero_ee3: [6.2, 12.5, 23], detonator: [4.4, 5.6, 4.4], saber_luke: [3.8, 3.1, 28.1], saber_ben: [3.1, 3.1, 28.8], saber_vader: [3.1, 3.1, 28.1], saber_emperor: [3.1, 3.8, 29.4],
};

/** Clip a 2D polygon by a convex counter-clockwise one. */
function clipConvex(poly, clip) {
  let out = poly;
  for (let i = 0; i < clip.length && out.length; i++) {
    const a = clip[i], b = clip[(i + 1) % clip.length];
    const side = (p) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    const inp = out;
    out = [];
    for (let k = 0; k < inp.length; k++) {
      const p = inp[k], q = inp[(k + 1) % inp.length];
      const sp = side(p), sq = side(q);
      if (sp >= 0) out.push(p);
      if (sp >= 0 !== sq >= 0) {
        const t = sp / (sp - sq);
        out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
      }
    }
  }
  return out;
}
/** The convex hull of 2D points (counter-clockwise). */
function hull(pts) {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], hi = [];
  for (const q of p) {
    while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop();
    lo.push(q);
  }
  for (const q of p.reverse()) {
    while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], q) <= 0) hi.pop();
    hi.push(q);
  }
  return [...lo.slice(0, -1), ...hi.slice(0, -1)];
}

/**
 * What blocks an optic's window: a voxel in it, or one that shows through it from the aiming eye
 * (on the sight line, each of EYE_BACKS behind the frame's rear face), beyond its front or between
 * the eye and its rear. The window is its cells less the chamfered corners, a hair inside their edges.
 */
function blocked(g) {
  const w = g.window;
  if (!w) return [];
  return [...new Set(EYE_BACKS.flatMap((back) => blockedFrom(g, back)))];
}

function blockedFrom(g, EYE_BACK) {
  const w = g.window;
  const e = 0.03;
  const X0 = g.b(0, w.x0), X1 = g.b(0, w.x1), Y0 = g.b(1, w.y0), Y1 = g.b(1, w.y1);
  const rects = (w.corners.length ? [[X0 + V + e, Y0 + e, X1 - V - e, Y1 - e], [X0 + e, Y0 + e, X1 - e, Y1 - V - e]] : [[X0 + e, Y0 + e, X1 - e, Y1 - e]]).map(([a, b, c, d]) => [[a, b], [c, b], [c, d], [a, d]]);
  const zr = g.b(2, w.k), zf = g.b(2, w.k + 1);
  const s = g.markers.sight;
  const eye = [s[0], s[1], zr - EYE_BACK];
  const bad = [];
  for (const cells of g.vox.parts.values())
    for (const key of cells.keys()) {
      const [i, j, k] = cellOf(key);
      const box = [[g.b(0, i), g.b(0, i + 1)], [g.b(1, j), g.b(1, j + 1)], [g.b(2, k), g.b(2, k + 1)]];
      let shape;
      if (k === w.k) shape = [[box[0][0], box[1][0]], [box[0][1], box[1][0]], [box[0][1], box[1][1]], [box[0][0], box[1][1]]];
      else {
        const plane = k > w.k ? zf : zr;
        const zs = k > w.k ? box[2] : [Math.max(box[2][0], eye[2] + 0.5), box[2][1]];
        if (zs[0] >= zs[1]) continue;
        const pts = [];
        for (const x of box[0]) for (const y of box[1]) for (const z of zs) {
          const t = (plane - eye[2]) / (z - eye[2]);
          pts.push([eye[0] + (x - eye[0]) * t, eye[1] + (y - eye[1]) * t]);
        }
        shape = hull(pts);
      }
      for (const r of rects) if (Math.abs(area2(clipConvex(shape, r))) > 1e-4) {
        bad.push(`${i}, ${j}, ${k}`);
        break;
      }
    }
  return bad;
}

/** The markers each kind of model must have (and must not). */
const MARKERS = { blaster: ['grip', 'grip2', 'muzzle', 'sight', 'mag'], saber: ['grip', 'grip2', 'muzzle'], detonator: ['grip'] };

function validate(buf, g) {
  const fail = (m) => {
    throw new Error(`${g.id}.glb: ${m}`);
  };
  const { json, read } = readGlb(buf);
  if (json.nodes[json.scenes[0].nodes[0]].name !== g.id) fail('root not named after the model');
  if (json.meshes.length !== 1 || json.meshes[0].primitives.length !== 1 || json.materials.length !== 1) fail('not one mesh, one primitive, one material');
  const want = MARKERS[g.kind];
  if (Object.keys(g.markers).sort().join() !== [...want].sort().join()) fail(`markers ${Object.keys(g.markers).join(', ')} (a ${g.kind} has ${want.join(', ')})`);
  for (const [name, p] of Object.entries(g.markers)) {
    const n = json.nodes.find((x) => x.name === name);
    if (!n || n.mesh !== undefined || n.children || n.translation.some((v, a) => Math.abs(v * 16 - p[a]) > 1e-4)) fail(`marker ${name}`);
  }
  if (g.markers.grip.some((v) => v !== 0)) fail('grip not at the origin');
  const prim = json.meshes[0].primitives[0];
  const P = read(json.accessors[prim.attributes.POSITION]), N = read(json.accessors[prim.attributes.NORMAL]), I = read(json.accessors[prim.indices]);
  const count = json.accessors[prim.attributes.POSITION].count;
  for (let t = 0; t < I.length; t += 3) {
    const [a, b, c] = [I[t], I[t + 1], I[t + 2]];
    if (a >= count || b >= count || c >= count) fail('index out of range');
    const e1 = [0, 1, 2].map((k) => P[b * 3 + k] - P[a * 3 + k]), e2 = [0, 1, 2].map((k) => P[c * 3 + k] - P[a * 3 + k]);
    const cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    if (cr[0] * N[a * 3] + cr[1] * N[a * 3 + 1] + cr[2] * N[a * 3 + 2] <= 0) fail('triangle winding');
  }
  if (buf.length > MAX_BYTES) fail(`${buf.length} bytes (budget ${MAX_BYTES})`);
  if (!json.materials[0].emissiveTexture) fail('nothing glows');
  // A blaster's optic: its window open, its frame whole round it (sides and top, one voxel deep); a sniper's scope has no window.
  const w = g.window;
  if (g.kind === 'blaster' && !w && !g.id.endsWith('_sniper')) fail('no open sight');
  if (w) {
    const bad = blocked(g);
    if (bad.length) fail(`the optic's window isn't clear from the eye: voxels at ${bad.slice(0, 6).join('; ')}${bad.length > 6 ? ` and ${bad.length - 6} more` : ''}`);
    for (let j = w.y0; j <= w.y1; j++)
      for (let i = w.x0 - 1; i <= w.x1; i++) {
        const rim = i === w.x0 - 1 || i === w.x1 || j === w.y1;
        const corner = (i === w.x0 - 1 || i === w.x1) && j === w.y1;
        if (rim && !corner && (!g.has(i, j, w.k) || g.has(i, j, w.k - 1) || g.has(i, j, w.k + 1))) fail(`the frame at ${i}, ${j}`);
      }
  }
  // A pistol is short enough for a trooper (at 0.68) to hold as one (under 0.6 m).
  const zs = P.filter((_, m) => m % 3 === 2);
  const length = (Math.max(...zs) - Math.min(...zs)) * 16;
  if (g.id.endsWith('_pistol') && (length / 16) * 0.68 >= 0.6) fail(`${length.toFixed(2)} px long: held as a rifle`);
  // A saber's blade: every voxel of it alight, and it's the model's front.
  if (g.kind === 'saber') {
    const lit = [...g.vox.parts.get('body')].filter(([, c]) => g.P.get(c).glow > 0).map(([key]) => cellOf(key)[2]);
    const tip = g.markers.muzzle[2];
    if (Math.abs(Math.max(...lit.map((k) => g.b(2, k + 1))) - tip) > 1e-6 || Math.abs(Math.max(...zs) * 16 - tip) > 1e-4) fail('the blade isn\'t the front');
  }
  return { tris: I.length / 3 };
}

/** The model's voxels in letters: side on from +x, from behind (-z, the aiming view) and from above. */
function show(g) {
  const names = [...g.P.colours.keys()];
  const ch = (c) => (c ? 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'[names.indexOf(c)] : '.');
  const cells = [...g.vox.parts.get('body')].map(([key, c]) => [...cellOf(key), c]);
  const lo = [0, 1, 2].map((a) => Math.min(...cells.map((p) => p[a]))), hi = [0, 1, 2].map((a) => Math.max(...cells.map((p) => p[a])));
  const view = (u, v, d, nearMax, label) => {
    const grid = new Map();
    for (const p of cells) {
      const key = `${p[u]},${p[v]}`;
      const cur = grid.get(key);
      if (!cur || (nearMax ? p[d] > cur[d] : p[d] < cur[d])) grid.set(key, p);
    }
    console.log(`  ${label}`);
    for (let y = hi[v]; y >= lo[v]; y--) {
      let row = `${g.b(v, y).toFixed(2).padStart(7)} `;
      for (let x = lo[u]; x <= hi[u]; x++) row += grid.has(`${x},${y}`) ? ch(grid.get(`${x},${y}`)[3]) : x === Math.round(-g.offset[u]) || y === Math.round(-g.offset[v]) ? '+' : '.';
      console.log(row);
    }
  };
  console.log(`  colours: ${names.map((n) => `${ch(n)} ${n}`).join(', ')}`);
  view(2, 1, 0, true, `side (z across from ${g.b(2, lo[2])}, y up), from +x`);
  view(0, 1, 2, false, `behind (x across from ${g.b(0, lo[0])}, y up), from -z`);
  view(2, 0, 1, true, `above (z across, x up), from +y`);
}

const MODELS = {
  imp_rifle: impRifle, rebel_rifle: rebelRifle, imp_heavy: impHeavy, rebel_heavy: rebelHeavy, imp_sniper: impSniper, rebel_sniper: rebelSniper, imp_pistol: impPistol, rebel_pistol: rebelPistol,
  detonator, hero_bowcaster: heroBowcaster, hero_ee3: heroEe3, saber_luke: saberLuke, saber_ben: saberBen, saber_vader: saberVader, saber_emperor: saberEmperor,
};
const args = process.argv.slice(2);
const only = args.filter((a) => !a.startsWith('--'));
mkdirSync(OUT, { recursive: true });
for (const [id, make] of Object.entries(MODELS)) {
  if (only.length && !only.includes(id)) continue;
  const g = make();
  const { bytes, stats, pos } = glb(g);
  const file = join(OUT, `${g.id}.glb`);
  writeFileSync(file, bytes);
  if (args.includes('--show')) show(g);
  const v = validate(readFileSync(file), g);
  const lo = [0, 1, 2].map((k) => Math.min(...pos.filter((_, m) => m % 3 === k)) * 16);
  const hi = [0, 1, 2].map((k) => Math.max(...pos.filter((_, m) => m % 3 === k)) * 16);
  const size = hi.map((x, k) => +(x - lo[k]).toFixed(2));
  const want = SIZES[id];
  const fmt = (p) => `(${p.map((x) => +x.toFixed(2)).join(', ')})`;
  console.log(`${g.id}.glb  ${g.name}: ${stats.voxels} voxels, ${stats.faces} faces as ${stats.quads} quads, ${v.tris} tris, ${stats.tiles} tiles in ${stats.atlas}, ${(bytes.length / 1024).toFixed(1)} KB`);
  console.log(`  size (px) x ${size[0]}  y ${size[1]}  z ${size[2]}  (${size.map((x, k) => `${x >= want[k] ? '+' : ''}${Math.round((x / want[k] - 1) * 100)}%`).join(' ')})   z ${fmt([lo[2], hi[2]])}  y ${fmt([lo[1], hi[1]])}`);
  console.log(`  markers ${Object.entries(g.markers).map(([k, p]) => `${k} ${fmt(p)}`).join('  ')}${g.window ? `   window ${fmt([g.b(0, g.window.x1) - g.b(0, g.window.x0), g.b(1, g.window.y1) - g.b(1, g.window.y0)])} px, clear` : ''}`);
}
