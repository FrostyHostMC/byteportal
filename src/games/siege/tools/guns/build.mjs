#!/usr/bin/env node
/**
 * Call of Blocky: the weapon models (and the briefcase and the lethals), built as micro-voxel
 * models and written as binary glTF 2.0 (`.glb`) to `src/games/callofblocky/models/`.
 * Dependency-free (Node 22+): `node src/games/callofblocky/tools/guns/build.mjs [ids...] [--show]`
 * (`--show` prints each model's voxels side on, from behind and from above). Each file is parsed
 * back and checked after it's written (chunks, accessors, winding, markers), and each optic's
 * window is checked open from the aiming eye.
 *
 * Conventions (the game's code relies on these exactly):
 *
 * - Units: 1 glTF unit = 1 block = 16 pixels. The models are voxels 0.625 px on a side (5/128
 *   block): in first person (drawn at 0.42) about 1.6 cm, held by a fighter (at 0.68) about 2.7
 *   cm. Shapes are authored in px from the hard-surface guns these replaced (their side profiles,
 *   sections and lengths) and filled with the voxels whose centres they hold; widths are counted
 *   in voxels, centred on the gun's axis. Each model picks its grid across x (`offset`): odd
 *   widths (a one-voxel barrel, a three-voxel receiver: the pistol, the rifle, the katana) or
 *   even ones (a two-voxel barrel, a four-voxel receiver: the SMG, the shotgun, the sniper, the
 *   briefcase and the lethals), whichever lands the visible parts nearer the old sizes.
 * - Orientation: the barrel runs along +z (the muzzle is the +z end), +y is up. The gun's right
 *   side (ejection port, bolt handle) is -x; its left side (the one the player sees in first
 *   person) is +x.
 * - Origin (0,0,0): the centre of the firing hand's fist around the pistol grip (= `grip`).
 * - Sizes (overall length along z, px, within 5% of the hard-surface models): pistol 12, SMG 17,
 *   rifle 28, shotgun 29.5, sniper 33, katana 30; and the ones added since: the Tommy gun 27, the
 *   machine gun 33, the marksman rifle 32, the sawn-off 16, the revolver 15.5 (held as a pistol:
 *   `stance` in its look). Receivers 1.9-2.5 px wide, pistol grips 1.9-2.5
 *   px wide and 5 tall, raked 15 degrees (the shotgun's wrist 25, the sniper's 18). A gun whose
 *   muzzle is less than 11 px ahead of the grip is held as a compact gun (the pistol and the SMG).
 * - Marker nodes: empty nodes (no mesh), children of the root, their translation in blocks:
 *   - `grip`: the centre of the firing fist on the pistol grip (the origin).
 *   - `grip2`: where the support hand holds, under the handguard / pump / forend (the SMG: its
 *     hand strap; the pistol: below and in front of the grip, the cupping hand).
 *   - `muzzle`: the centre of the barrel's tip (flashes and tracers start here).
 *   - `sight`: the eye point when aiming down sights. On the pistol, SMG, rifle and shotgun it's
 *     the centre of the optic's open window (a red dot or holo) at the frame's rear face. The
 *     optics are open reflex sights: a frame one voxel thick and one deep round the window (its
 *     top corners chamfered a voxel), standing on a long low body that steps down ahead of it.
 *     The window holds no voxel, and seen from the aiming eye (EYE_BACKS behind it) nothing shows
 *     through it, ahead of the frame or between the eye and the frame; the platform draws the
 *     reticle. On the sniper, `sight` is the centre of the scope's rear lens.
 *   - `mag`: the centre of the magazine (reloads send the support hand there): the pistol's is its
 *     base plate below the grip; the shotgun's its loading port under the receiver. The katana
 *     has none; its `grip` is the rear hand on the handle and `grip2` the front hand, and its blade
 *     runs along +z with the edge facing +y (its flats face +-x).
 * - The briefcase (a pickup, not a weapon) has no markers: its origin is the centre of its bottom
 *   face, +y up, its front (latches, the lid ajar and glowing) toward +z; about 10 x 9.4 x 4.4 px
 *   with the handle.
 * - The ammo can (a pickup the fallen drop) has no markers: it stands up along +z (the platform
 *   stands a model up that way to drop it), its origin the middle of its bottom, about 6.9 x 4.4 x
 *   5.6 px.
 * - The lethals (thrown) have one marker, `grip`, and their origin is the middle of the body, +y
 *   up. The frag (The Pineapple) is about 4.4 x 6.3 x 4.4 px, its pull ring in front (+z), the
 *   spoon down its right side (-x); `grip` the origin. The molotov (The Mia, a soda bottle
 *   stuffed with a burning napkin) is about 3.8 x 12.5 x 3.8 px, the bottle from y -3.75, its
 *   label round its waist, the napkin flopped toward +x, the flame on top; `grip` 1.5 px below
 *   the origin.
 * - Look (tools/voxel.mjs): flat, clean voxels: a quad per visible voxel face (faces of a colour
 *   in a plane merged where nothing shades them), each on a tile of one palette atlas, soft
 *   occlusion in the concave corners baked into tile variants. One material: baseColorTexture,
 *   metallicRoughnessTexture (G roughness, B metalness; the factors 1) and emissiveTexture (what
 *   glows: lenses, the briefcase's gold, the molotov's flame), sampled LINEAR with mipmaps. One
 *   mesh; POSITION (with min/max) and NORMAL as floats, TEXCOORD_0 as normalized unsigned shorts,
 *   indices (core glTF: the platform's held-model pipeline transforms positions in place). Node
 *   tree: root (named after the model's id, extras.title its name) > [mesh node, marker nodes].
 */
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Palette, Voxels, faces, atlas, quadCorners, png, writeGlb, readGlb, cellOf, DIRS } from '../voxel.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '../../models');
/** A voxel, in px. */
const V = 0.625;
const MAX_BYTES = 300 * 1024;
/**
 * How far behind the `sight` point the eye can be when aiming, in model px: the platform holds an
 * optic's sight 0.3 blocks in front of the eye with the gun at scale 0.42 (0.3 / 0.42 * 16), and
 * Call of Blocky's holds it 0.4 out (weapons.ts); the window is checked clear from both.
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

/** A side-profile point (z, y) of a part raked `deg` back about the origin; keeps a fillet radius. */
const rake = (deg) => (z, y, r) => {
  const c = Math.cos(deg * DEG), s = Math.sin(deg * DEG);
  const p = [y * s + z * c, y * c - z * s];
  return r === undefined ? p : [...p, r];
};

/** The point a fraction `t` of the way along a path of 2D points (by length). */
function alongPath(path, t) {
  const seg = path.slice(1).map((p, n) => Math.hypot(p[0] - path[n][0], p[1] - path[n][1]));
  let d = t * seg.reduce((a, b) => a + b, 0);
  for (let n = 0; n < seg.length; n++) {
    if (d <= seg[n]) return [0, 1].map((a) => path[n][a] + ((path[n + 1][a] - path[n][a]) * d) / seg[n]);
    d -= seg[n];
  }
  return path[path.length - 1];
}

// ---------------------------------------------------------------------------------------------
// A model: voxel parts, colours, markers, an optic's window. Cell (i, j, k) is the voxel from
// (i, j, k) + offset to (i+1, j+1, k+1) + offset voxels from the origin. Shapes are given in px
// and fill the cells whose centres they hold; widths across x in voxels, centred on the axis (so
// their parity is the model's: odd with the offset's x at -0.5, even with it at 0).

class Gun {
  constructor(id, name, { offset = [-0.5, 0, 0] } = {}) {
    this.id = id;
    this.name = name;
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
          for (let i = i0; i < i1; i++) {
            const col = f(i, j, k);
            if (col === false) this.vox.del('body', i, j, k);
            else if (col) this.vox.set('body', i, j, k, col);
          }
    return this;
  }
  /** A round section along z: the cells whose centres are within `r` px of (x, y), from z0 to z1 px. */
  disc(r, [x, y], [z0, z1], c) {
    const f = typeof c === 'function' ? c : () => c;
    const [i0, i1] = this.span(0, x - r, x + r + 1e-6), [j0, j1] = this.span(1, y - r, y + r + 1e-6), [k0, k1] = this.span(2, z0, z1);
    for (let k = k0; k < k1; k++)
      for (let j = j0; j < j1; j++)
        for (let i = i0; i < i1; i++)
          if (Math.hypot(this.c(0, i) - x, this.c(1, j) - y) <= r + 1e-6) {
            const col = f(i, j, k);
            if (col === false) this.vox.del('body', i, j, k);
            else if (col) this.vox.set('body', i, j, k, col);
          }
    return this;
  }
  /** A round section along y: the cells whose centres are within `r` px of (x, z), from y0 to y1 px. */
  ring(r, [x, z], [y0, y1], c) {
    const f = typeof c === 'function' ? c : () => c;
    const [i0, i1] = this.span(0, x - r, x + r + 1e-6), [j0, j1] = this.span(1, y0, y1), [k0, k1] = this.span(2, z - r, z + r + 1e-6);
    for (let j = j0; j < j1; j++)
      for (let k = k0; k < k1; k++)
        for (let i = i0; i < i1; i++)
          if (Math.hypot(this.c(0, i) - x, this.c(2, k) - z) <= r + 1e-6) {
            const col = f(i, j, k);
            if (col === false) this.vox.del('body', i, j, k);
            else if (col) this.vox.set('body', i, j, k, col);
          }
    return this;
  }
  /** A round section across x (a drum, a wheel): the cells whose centres are within `r` px of (y, z), `w` voxels across. */
  wheel(r, [y, z], w, c) {
    const f = typeof c === 'function' ? c : () => c;
    const [i0, i1] = this.xs(w), [j0, j1] = this.span(1, y - r, y + r + 1e-6), [k0, k1] = this.span(2, z - r, z + r + 1e-6);
    for (let j = j0; j < j1; j++)
      for (let k = k0; k < k1; k++)
        if (Math.hypot(this.c(1, j) - y, this.c(2, k) - z) <= r + 1e-6)
          for (let i = i0; i < i1; i++) {
            const col = f(i, j, k);
            if (col === false) this.vox.del('body', i, j, k);
            else if (col) this.vox.set('body', i, j, k, col);
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
  /** Recolour the filled cells in [lo, hi) that `pick(i, j, k, c)` names a colour for. */
  paint(lo, hi, pick) {
    this.vox.recolour('body', (i, j, k, c) => (i >= lo[0] && i < hi[0] && j >= lo[1] && j < hi[1] && k >= lo[2] && k < hi[2] ? pick(i, j, k, c) : undefined));
    return this;
  }
  has(i, j, k) {
    return this.vox.filled(i, j, k);
  }
  mark(name, p) {
    this.markers[name] = p.map((v) => Math.round(v * 1e4) / 1e4);
    return this;
  }
}

/**
 * An open reflex sight: a window `w` x `h` voxels (centred across x, its sill at `sill` px and the
 * frame's rear face at `z` px, both on the grid) in a frame one voxel thick and one deep, its top
 * corners chamfered (`chamfer`, on a window three or more tall); the body under it `body` voxels tall and `bodyW` wide, from `back` voxels
 * behind the frame, running on `len` voxels ahead of it `drop` voxels lower and `aheadW` wide.
 * Returns the `sight` point: the window's centre at the frame's rear face.
 */
function optic(g, { w, h, sill, z, frame, body = 2, bodyW = w + 2, back = 1, len, drop = 1, aheadW = bodyW, colour = 'anod', chamfer = h >= 3 }) {
  const [x0, x1] = g.xs(w);
  const j0 = Math.round(sill / V - g.offset[1]), k = Math.round(z / V - g.offset[2]);
  if (Math.abs(g.b(1, j0) - sill) > 1e-6 || Math.abs(g.b(2, k) - z) > 1e-6) throw new Error(`${g.id}: optic off the grid`);
  const [b0, b1] = g.xs(bodyW), [a0, a1] = g.xs(aheadW);
  g.box([b0, j0 - body, k - back], [b1, j0, k + 1], colour);
  g.box([a0, j0 - body, k + 1], [a1, j0 - drop, k + 1 + len], colour);
  for (const x of [x0 - 1, x1]) g.box([x, j0, k], [x + 1, j0 + h, k + 1], frame);
  g.box([x0, j0 + h, k], [x1, j0 + h + 1, k + 1], frame);
  const corners = chamfer ? [[x0, j0 + h - 1], [x1 - 1, j0 + h - 1]] : [];
  for (const [i, j] of corners) g.box([i, j, k], [i + 1, j + 1, k + 1], frame);
  g.window = { x0, x1, y0: j0, y1: j0 + h, k, corners };
  return [0, (g.b(1, j0) + g.b(1, j0 + h)) / 2, z];
}

// ---------------------------------------------------------------------------------------------
// The guns: their hard-surface shapes in slim voxels; flat runs, steps only where a shape angles.

/** Lucky 45: a 1911, a nickel slide on a blued frame, pearl grips, gold touches, a mini red dot. */
function pistol() {
  const g = new Gun('pistol', 'Lucky 45', { offset: [-0.5, 0, 0] }).colours({
    nickel: [0x2b2d31, 0.4, 0.6], nickelDark: [0x1f2024, 0.45, 0.6], blued: [0x9a8a64, 0.5, 0.2], pearl: [0x222326, 0.55],
    gold: [0x3a3c41, 0.4, 0.6], anod: [0x2a2c31, 0.45, 0.4], port: [0x1a1a1a, 0.5, 0.5],
  });
  const G = rake(15);
  // The frame (blued): dust cover, trigger slot, the raked grip frame, the beavertail.
  g.prof([[-2.4, 3.1], [6.35, 3.1], [6.35, 2.15], [1.9, 2.15], [1.4, 1.25], [-1.4, 1.25], [-1.7, 1.6], [-2.55, 2.0, 0.3], [-3.35, 2.4, 0.2], [-3.3, 2.78, 0.15], [-2.45, 2.8, 0.15]], 3, 'blued');
  // The grip: pearl panels on its sides behind a blued backstrap, gold screws; a gold base plate.
  const screws = [G(0, 0.75), G(0, -1.95)].map(([z, y]) => [g.cell(2, z), g.cell(1, y)]);
  g.grip(3, [-3.125, 1.875], 1.5, 5, 15, (i, j, k, back) => (i === 0 || k === back || j > 1 ? 'blued' : screws.some(([sk, sj]) => sk === k && sj === j) ? 'gold' : 'pearl'));
  g.grip(3, [-3.75, -3.125], 1.5, 5, 15, 'gold');
  // The slide (nickel, serrated at the back, the port on the right, the bore at the front).
  g.pbox(3, [3.0, 4.95], [-2.45, 8.55], (i, j, k) => (i !== 0 && j < 7 && k <= -2 && k % 2 === 0 ? 'nickelDark' : 'nickel'));
  g.box([-1, 7, 3], [0, 8, 6], 'port');
  g.box([0, 6, 13], [1, 7, 14], 'port');
  // Hammer, cocked; trigger; the trigger guard.
  g.prof([[-1.95, 3.0], [-1.95, 3.7], [-2.55, 4.45], [-3.2, 4.8], [-3.4, 4.55], [-2.9, 4.1], [-2.55, 3.1]], 1, 'gold');
  g.box([0, 2, 4], [1, 3, 5], 'gold');
  g.pbox(1, [0, 0.625], [1.25, 5.0], 'blued');
  g.pbox(1, [0, 1.875], [4.375, 5.0], 'blued');
  // The mini red dot: the body on the back of the slide, a gold frame, the nose stepping down.
  const sight = optic(g, { w: 3, h: 2, sill: 6.25, z: -1.875, frame: 'gold', body: 2, bodyW: 5, back: 1, len: 4, drop: 1, aheadW: 3 });
  g.box([-3, 9, -4], [4, 10, -2], 'anod');
  const muzzle = [0, (g.b(1, 5) + g.b(1, 8)) / 2, g.b(2, 14)];
  const [mz, my] = G(-0.05, -3.1);
  return g.mark('grip', [0, 0, 0]).mark('grip2', [0, -2, 2]).mark('muzzle', muzzle).mark('sight', sight).mark('mag', [0, my, mz]);
}

/** Mac-10: black parkerized steel, gold furniture, a hot-pink strap and a pink-hooded holo. */
function smg() {
  const g = new Gun('smg', 'Mac-10', { offset: [0, 0, 0] }).colours({
    parker: [0x2e3033, 0.7, 0.3], parkerDark: [0x222426, 0.7, 0.3], gold: [0x3d4044, 0.5, 0.5], goldDark: [0x2c2e31, 0.55, 0.5], polymer: [0x1f2023, 0.65], pink: [0x3b3e43, 0.5, 0.3], steel: [0xa4a8ae, 0.3, 1], anod: [0x2a2c31, 0.45, 0.4],
  });
  // Grip (polymer) and the magazine below it, a gold base.
  g.pbox(4, [-3.25, 2.3], [-1.6, 1.45], 'polymer');
  g.pbox(2, [-8.3, -2.9], [-1.2, 1.05], 'parker');
  g.pbox(4, [-8.85, -8.28], [-1.2, 1.05], 'gold');
  // The receiver: upper and lower, the end cap; the barrel and its knurled gold thread protector.
  g.pbox(4, [3.55, 5.8], [-4.3, 6.0], 'parker');
  g.pbox(4, [2.1, 3.6], [-4.15, 5.7], 'parker');
  g.pbox(4, [2.35, 5.45], [-4.75, -4.2], 'parkerDark');
  g.pbox(2, [3.75, 5.0], [6.0, 8.45], 'parkerDark');
  g.pbox(2, [3.75, 5.0], [8.45, 10.0], (i, j, k) => (k === 14 ? 'goldDark' : 'gold'));
  // The gold cocking knob on top, low under the holo's view.
  g.pbox(2, [5.625, 6.25], [2.5, 3.75], 'gold');
  // Trigger guard and trigger.
  g.pbox(2, [0, 0.625], [1.25, 4.375], 'parker');
  g.pbox(2, [0, 1.875], [3.75, 4.375], 'parker');
  g.pbox(2, [1.25, 1.875], [1.875, 2.5], 'gold');
  // The hot-pink hand strap under the front, its gold buckle.
  g.pbox(2, [-0.625, 1.875], [4.375, 5.0], 'pink');
  g.pbox(2, [-0.625, 0], [4.375, 6.25], 'pink');
  g.pbox(2, [-0.625, 1.875], [5.625, 6.25], (i, j) => (j === 1 ? 'gold' : 'pink'));
  // The wire stock, retracted: rods down the sides, the butt loop behind with its rubber pad.
  for (const x of [-3, 2]) g.box([x, 4, -10], [x + 1, 5, 7], 'steel');
  g.box([-3, -1, -11], [3, 5, -10], (i, j) => (j === -1 ? 'anod' : i === -3 || i === 2 || j === 4 ? 'parkerDark' : false));
  // The holo on a plate on the back of the top, its hood hot pink.
  g.pbox(4, [5.625, 6.25], [-4.375, 0], 'parker');
  const sight = optic(g, { w: 4, h: 3, sill: 7.5, z: -3.75, frame: 'pink', body: 2, bodyW: 6, back: 1, len: 5, drop: 1, aheadW: 4 });
  return g.mark('grip', [0, 0, 0]).mark('grip2', [0, -0.3125, 5.3125]).mark('muzzle', [0, 4.375, 10]).mark('sight', sight).mark('mag', [0, -5.625, 0]);
}

/** Big Kahuna: an AKM in blued steel, koa wood, a plum bakelite magazine and a yellow holo. */
function rifle() {
  const g = new Gun('rifle', 'Big Kahuna', { offset: [-0.5, 0, 0] }).colours({
    blued: [0x2d3035, 0.45, 0.6], bluedDark: [0x23262a, 0.5, 0.6], steel: [0x9aa0a8, 0.3, 1], darksteel: [0x575c64, 0.35, 0.8],
    koa: [0x9b8a64, 0.55], koaLight: [0xb09d74, 0.55], plum: [0x2a2c30, 0.55], plumDark: [0x202225, 0.6], yellow: [0x202226, 0.4, 0.3], anod: [0x2a2c31, 0.45, 0.4],
  });
  const G = rake(15);
  // Pistol grip (koa), raked; the magazine, plum bakelite, curving forward to its floor plate.
  g.grip(3, [-3.125, 1.875], 1.29, 4, 15, 'koa');
  // (Row by row, four voxels deep, its front on the curve of the old one's middle.)
  const magPath = fillet([[5.5, 2.3], [5.62, -0.6, 5.5], [8.9, -5.75]], false, 12);
  const zAt = (y) => {
    for (let n = 1; n < magPath.length; n++) {
      const [za, ya] = magPath[n - 1], [zb, yb] = magPath[n];
      if (y <= ya && y >= yb) return za + ((zb - za) * (y - ya)) / (yb - ya);
    }
    const [za, ya] = magPath[magPath.length - 2], [zb, yb] = magPath[magPath.length - 1];
    return y > magPath[0][1] ? magPath[0][0] : zb + ((zb - za) * (y - yb)) / (yb - ya);
  };
  for (let j = 2; j >= -10; j--) {
    const k0 = Math.round((zAt(g.c(1, j)) - 1.25) / V);
    g.box([-1, j, k0], [2, j + 1, k0 + 4], j === -10 ? 'plumDark' : 'plum');
  }
  // Receiver, its dust cover (ribbed at the back), the rail; the rear sight block.
  g.pbox(3, [1.95, 4.5], [-3.0, 7.8], 'blued');
  g.pbox(3, [4.35, 5.0], [-3.25, 6.3], (i, j, k) => (k < -1 && k % 2 === 0 ? 'bluedDark' : 'blued'));
  g.pbox(3, [5.0, 5.625], [-0.625, 4.375], 'anod');
  g.pbox(3, [4.375, 5.0], [6.25, 8.125], 'blued');
  g.pbox(3, [3.75, 4.375], [7.5, 8.125], 'blued');
  // The stock: koa, its top straight on, its underside stepping down to a steel butt plate.
  g.prof([[-3.0, 4.35], [-9.75, 4.35], [-9.8, -0.25], [-8.4, -0.3], [-3.0, 1.95]], 3, (i, j, k) => (k === -16 ? 'darksteel' : j === 6 ? 'koaLight' : 'koa'));
  // Trigger, the guard, the magazine catch.
  g.box([0, 2, 3], [1, 3, 4], 'steel');
  g.pbox(1, [0, 0.625], [1.25, 3.75], 'blued');
  g.pbox(1, [0, 1.875], [3.125, 3.75], 'blued');
  g.pbox(1, [1.25, 1.875], [3.75, 4.375], 'steel');
  // Handguards (koa): the lower one bulging, rounded under; the upper one narrower.
  g.pbox(5, [1.9, 4.0], [7.8, 12.4], (i, j) => (j === 3 && Math.abs(i) === 2 ? false : 'koa'));
  g.pbox(3, [4.0, 5.0], [7.95, 11.95], (i, j) => (j === 7 ? 'koaLight' : 'koa'));
  // The retainer, gas tube and block, the barrel, the front sight, the brake.
  g.pbox(3, [1.9, 4.375], [12.5, 13.125], 'steel');
  g.pbox(1, [4.375, 5.0], [11.875, 13.125], 'blued');
  g.pbox(1, [3.75, 5.0], [13.125, 13.75], 'blued');
  g.pbox(1, [3.125, 3.75], [13.125, 16.25], 'bluedDark');
  g.pbox(1, [2.5, 4.375], [15.0, 16.25], 'blued');
  g.pbox(1, [4.375, 5.625], [15.625, 16.25], 'blued');
  g.pbox(1, [3.125, 3.75], [16.25, 18.125], 'darksteel');
  // The holo, yellow, on a mount on the rail.
  g.pbox(5, [5.625, 7.5], [0, 3.75], 'anod');
  const sight = optic(g, { w: 5, h: 3, sill: 8.75, z: 0, frame: 'yellow', body: 2, bodyW: 7, back: 1, len: 6, drop: 1, aheadW: 5 });
  const at = alongPath(magPath, 0.45);
  return g.mark('grip', [0, 0, 0]).mark('grip2', [0, 1.875, 10]).mark('muzzle', [0, 3.4375, 18.125]).mark('sight', sight).mark('mag', [0, at[1], at[0]]);
}

/** Zed's Pump: an 870 in blued steel, a walnut pistol-grip stock, a cherry pump and holo, red shells on the side. */
function shotgun() {
  const g = new Gun('shotgun', "Zed's Pump", { offset: [0, 0, 0] }).colours({
    blued: [0x39424f, 0.35, 0.7], bluedDark: [0x2c323c, 0.4, 0.7], steel: [0xa4a8ae, 0.3, 1], walnut: [0x25272b, 0.6], walnutLight: [0x303338, 0.6],
    cherry: [0x9b8a64, 0.5], cherryDark: [0x7a6a49, 0.55], shell: [0xc81c1c, 0.4], brass: [0xd8aa55, 0.3, 1], rubber: [0x1e1e1e, 0.9], spacer: [0x4a4d52, 0.5], anod: [0x2a2c31, 0.45, 0.4], port: [0x1a1a1a, 0.5, 0.5], polymer: [0x28292d, 0.65],
  });
  const G = rake(25);
  // The stock with its pistol grip, walnut, to a recoil pad behind a white spacer.
  g.prof(
    [[0.75, 4.35], [-9.3, 4.35], [-9.45, -0.3], [-7.0, 0.2], [-3.9, 1.45, 1.2], G(-1.35, -0.6, 0.6), G(-1.45, -2.4, 0.35), G(-1.3, -2.95, 0.25), G(1.25, -2.95, 0.25), G(1.35, -1.2, 0.3), G(1.2, 0.95, 0.2), [0.75, 1.35]],
    4,
    (i, j, k) => (k === -15 ? 'spacer' : j === 6 ? 'walnutLight' : 'walnut'),
  );
  g.pbox(4, [-0.42, 4.375], [-10.0, -9.375], 'rubber');
  // Receiver (its top edges rounded, the loading port underneath), the trigger plate.
  g.pbox(4, [1.25, 4.375], [0.6, 7.6], (i, j, k) => (j === 6 && (i === -2 || i === 1) ? false : j === 2 && k >= 9 && k <= 10 && (i === -1 || i === 0) ? 'port' : 'blued'));
  g.pbox(4, [0.625, 1.25], [1.0, 4.9], 'anod');
  // Trigger and guard.
  g.pbox(2, [-0.625, 0.625], [2.5, 3.125], 'brass');
  g.pbox(2, [-1.25, -0.625], [1.25, 5.0], 'anod');
  g.pbox(2, [-1.25, 0.625], [4.375, 5.0], 'anod');
  // The barrel on the magazine tube, clamped at the front; the tube's cap.
  g.pbox(2, [3.125, 4.375], [7.5, 20.0], 'blued');
  g.pbox(2, [1.25, 2.5], [7.5, 17.5], 'blued');
  g.pbox(2, [1.25, 2.5], [17.5, 18.75], 'bluedDark');
  g.pbox(2, [2.5, 3.125], [16.875, 17.5], 'steel');
  // The cherry pump, round the tube, ribbed like a corn cob.
  g.pbox(4, [0.625, 3.125], [10.0, 15.0], (i, j, k) => ((j === 1 || j === 4) && (i === -2 || i === 1) ? false : k % 2 ? 'cherryDark' : 'cherry'));
  // Shells in the side saddle (the left, +x), brass down.
  g.box([2, 2, 2], [3, 6, 11], (i, j, k) => (k % 2 === 0 ? 'polymer' : j === 2 ? 'brass' : 'shell'));
  // The holo, cherry red like the pump, on a rail and mount on the receiver.
  g.pbox(2, [4.375, 5.0], [1.25, 6.875], 'anod');
  g.pbox(4, [5.0, 6.25], [1.875, 5.625], 'anod');
  const sight = optic(g, { w: 4, h: 3, sill: 7.5, z: 1.875, frame: 'cherry', body: 2, bodyW: 6, back: 1, len: 6, drop: 1, aheadW: 4 });
  return g.mark('grip', [0, 0, 0]).mark('grip2', [0, 0.625, 12.5]).mark('muzzle', [0, 3.75, 20]).mark('sight', sight).mark('mag', [0, 1.25, 6.25]);
}

/** Honey Bunny: a bolt-action rifle in honey maple and blued steel, a big scope with brass trim, its objective glinting red. */
function sniper() {
  const g = new Gun('sniper', 'Honey Bunny', { offset: [0, 0, 0] }).colours({
    blued: [0x39424f, 0.35, 0.7], bluedDark: [0x2c323c, 0.4, 0.7], steel: [0xa4a8ae, 0.3, 1], honey: [0x4f5640, 0.55], honeyLight: [0x626b4f, 0.55],
    scope: [0x1d1e22, 0.35, 0.4], brass: [0x30333a, 0.4, 0.8], lens: [0x10161a, 0.05, 0.3], glint: [0xd01c28, 0.08, 0.2, 0.6], hot: [0xffd6c4, 0.1, 0, 1], rubber: [0x1e1e1e, 0.9], polymer: [0x28292d, 0.65], anod: [0x2a2c31, 0.45, 0.4],
  });
  const G = rake(18);
  // The honey maple stock: the forend (narrowing at its tip), the grip, a butt with a raised comb.
  g.prof(
    [
      [15.3, 3.75], [15.45, 2.1, 0.55], [11.0, 1.58, 2.5], [6.9, 1.1, 2.0], [4.2, 1.0], [1.9, 1.0],
      G(1.3, 0.9, 0.35), G(1.3, -2.35, 0.4), G(1.2, -3.02, 0.3), G(-1.5, -3.02, 0.3), G(-1.62, -2.4, 0.4), G(-1.5, -0.9, 0.7),
      [-3.2, 0.1, 1.6], [-10.2, -1.2, 0.3], [-10.2, 4.75, 0.3], [-7.2, 5.05, 0.8], [-3.9, 5.1, 0.6], [-2.4, 3.95, 0.6], [-1.2, 3.75],
    ],
    4,
    (i, j, k) => (k >= 22 && (i === -2 || i === 1) ? undefined : (j === 5 && k > -5) || j === 7 ? 'honeyLight' : 'honey'),
  );
  g.pbox(4, [-1.4, 4.85], [-10.625, -10.0], 'rubber');
  // The action, its bolt shroud, the bolt handle out on the right; the barrel and its brake.
  g.pbox(2, [3.75, 5.0], [-1.9, 8.125], 'blued');
  g.pbox(2, [3.75, 5.0], [-3.125, -1.875], 'steel');
  g.box([-3, 6, 1], [-1, 7, 2], 'steel');
  g.box([-4, 5, 1], [-3, 6, 2], 'steel');
  g.box([-5, 4, 1], [-4, 6, 2], 'polymer');
  g.pbox(2, [3.75, 5.0], [8.125, 20.625], 'blued');
  g.pbox(2, [3.75, 5.0], [20.625, 21.875], 'bluedDark');
  // Trigger guard and trigger, the magazine and its plate, the bipod folded under the forend.
  g.pbox(2, [-0.625, 0], [1.25, 3.75], 'bluedDark');
  g.pbox(2, [-0.625, 1.25], [3.125, 3.75], 'bluedDark');
  g.pbox(2, [0, 1.25], [1.875, 2.5], 'brass');
  g.pbox(2, [-0.625, 1.25], [4.375, 6.875], 'bluedDark');
  g.pbox(2, [-1.25, -0.625], [4.375, 6.875], 'steel');
  g.pbox(2, [1.25, 1.875], [13.125, 14.375], 'anod');
  g.pbox(2, [1.25, 1.875], [14.375, 20.0], (i, j, k) => (k === 31 ? 'rubber' : 'anod'));
  // The rail, the scope on its rings: a tube, the eyepiece and objective bells rimmed in brass,
  // the rear lens, a red glint ahead; the turrets.
  const SC = 8.125;
  g.pbox(2, [5.0, 5.625], [-1.25, 7.5], 'anod');
  for (const z of [0.625, 5.0]) g.pbox(2, [5.625, 6.875], [z, z + 0.625], 'anod');
  g.disc(0.7, [0, SC], [-1.25, 6.25], 'scope');
  for (const z of [0.625, 5.0]) g.disc(1.25, [0, SC], [z, z + 0.625], 'anod');
  g.disc(1.25, [0, SC], [2.5, 3.75], 'anod');
  g.disc(1.25, [0, SC], [6.25, 8.75], 'scope');
  g.disc(1.25, [0, SC], [-3.125, -1.25], (i, j, k) => (k === -5 ? (Math.hypot(g.c(0, i), g.c(1, j) - SC) < 0.7 ? 'lens' : 'brass') : 'scope'));
  g.disc(1.75, [0, SC], [8.75, 11.25], (i, j, k) => {
    if (k !== 17) return 'scope';
    const r = Math.hypot(g.c(0, i), g.c(1, j) - SC);
    return r > 1.3 ? 'brass' : r > 0.7 ? 'glint' : i === 0 && j === 13 ? 'hot' : 'lens';
  });
  g.pbox(2, [9.375, 10.0], [2.5, 3.75], 'brass');
  g.box([2, 12, 4], [3, 14, 6], 'anod');
  g.box([-3, 12, 4], [-2, 14, 6], 'anod');
  return g.mark('grip', [0, 0, 0]).mark('grip2', [0, 1.25, 10.625]).mark('muzzle', [0, 4.375, 21.875]).mark('sight', [0, SC, -3.125]).mark('mag', [0, 0.3125, 5.625]);
}

/** The Wolf: a Thompson in blued steel and walnut, a fifty-round drum with mint faces round a gold key, a finned barrel, the Cutts compensator, a mint holo. */
function tommy() {
  const g = new Gun('tommy', 'The Wolf', { offset: [0, 0, 0] }).colours({
    blued: [0x39424f, 0.35, 0.7], bluedDark: [0x2c323c, 0.4, 0.7], walnut: [0x6e4329, 0.45], walnutLight: [0x8f6240, 0.45],
    mint: [0x3fd6c0, 0.3], mintDark: [0x1f9f8c, 0.35], gold: [0xf2c055, 0.22, 1], anod: [0x2a2c31, 0.45, 0.4], port: [0x1a1a1a, 0.5, 0.5],
  });
  // The rear pistol grip and the stock, walnut, the stock dropping to a blued butt plate.
  g.grip(4, [-3.125, 1.875], 1.29, 4, 15, 'walnut');
  g.prof([[-2.5, 4.0], [-9.4, 3.75, 0.3], [-9.4, -1.55, 0.3], [-8.2, -1.6], [-3.3, 1.25], [-2.5, 1.9]], 4, (i, j, k) => (g.c(2, k) < -9 ? 'bluedDark' : j === 5 ? 'walnutLight' : 'walnut'));
  // The receiver, its top edges rounded, the gold actuator knob in its slot; the frame under it
  // from the grip to the magazine well.
  g.pbox(4, [1.875, 4.375], [-2.5, 7.5], (i, j, k) => (j === 6 && (i === -2 || i === 1) ? false : j === 6 && k >= 4 && k <= 7 ? 'port' : 'blued'));
  g.box([-1, 7, 6], [1, 8, 7], 'gold');
  g.pbox(4, [1.25, 1.875], [-1.875, 10.0], 'blued');
  // Trigger and guard.
  g.pbox(2, [0, 0.625], [1.25, 4.375], 'blued');
  g.pbox(2, [0, 1.25], [3.75, 4.375], 'blued');
  g.pbox(2, [0.625, 1.25], [1.875, 2.5], 'gold');
  // The drum, six voxels thick: its faces mint, a darker ring, the gold winding key; the rim blued.
  const DY = -0.9375, DZ = 7.5, DR = 3.0;
  g.wheel(DR, [DY, DZ], 6, (i, j, k) => {
    const r = Math.hypot(g.c(1, j) - DY, g.c(2, k) - DZ);
    return (i === -3 || i === 2) && r < DR - 0.55 ? (r < 0.5 ? 'gold' : r > 1.3 && r < 1.9 ? 'mintDark' : 'mint') : 'bluedDark';
  });
  g.box([3, g.cell(1, DY), g.cell(2, DZ) - 1], [4, g.cell(1, DY) + 1, g.cell(2, DZ) + 1], 'gold');
  // The vertical foregrip, walnut, grooved for the fingers in front, rounded at the bottom.
  g.pbox(4, [-3.125, 2.5], [11.25, 13.125], (i, j, k) => ((k === 20 && j % 2 === 0 && j < 3) || (j === -5 && (i === -2 || i === 1)) ? false : 'walnut'));
  // The barrel, finned behind, plain ahead; the Cutts compensator, slotted on top.
  g.pbox(2, [3.125, 4.375], [7.5, 15.0], 'blued');
  g.pbox(4, [2.5, 5.0], [7.5, 12.5], (i, j, k) => (k % 2 === 0 ? ((j === 4 || j === 7) && (i === -2 || i === 1) ? false : 'bluedDark') : undefined));
  g.pbox(4, [2.5, 4.375], [15.0, 17.5], (i, j, k) => ((j === 4 || j === 6) && (i === -2 || i === 1) ? false : j === 6 && k % 2 === 1 && k < 27 ? 'port' : 'blued'));
  // The holo, its hood mint, on a plate on the back of the receiver.
  g.pbox(4, [4.375, 5.0], [-2.5, 1.25], 'anod');
  const sight = optic(g, { w: 4, h: 3, sill: 6.25, z: -1.25, frame: 'mint', body: 2, bodyW: 6, back: 1, len: 5, drop: 1, aheadW: 4 });
  return g.mark('grip', [0, 0, 0]).mark('grip2', [0, -0.625, 12.1875]).mark('muzzle', [0, 3.75, 17.5]).mark('sight', sight).mark('mag', [0, DY, DZ]);
}

/** Marsellus: a belt-fed machine gun, black steel and olive furniture, a hundred brass rounds up from an olive box banded orange, an orange holo. */
function lmg() {
  const g = new Gun('lmg', 'Marsellus', { offset: [0, 0, 0] }).colours({
    parker: [0x3a3c40, 0.6, 0.4], parkerDark: [0x2a2c30, 0.65, 0.4], steel: [0xa4a8ae, 0.3, 1], olive: [0x5d6b35, 0.6], oliveDark: [0x48532a, 0.65], oliveLight: [0x72823f, 0.6],
    orange: [0x3a3d42, 0.4, 0.4], brass: [0xd8aa55, 0.3, 1], copper: [0xc8733a, 0.3, 1], rubber: [0x1e1e1e, 0.9], polymer: [0x28292d, 0.65], anod: [0x2a2c31, 0.45, 0.4], port: [0x1a1a1a, 0.5, 0.5],
  });
  // The stock, olive, long and straight to a rubber pad; the pistol grip.
  g.prof([[-3.125, 4.6], [-10.6, 4.3, 0.3], [-10.6, -1.3, 0.3], [-9.2, -1.4], [-3.8, 1.3], [-3.125, 1.9]], 4, (i, j, k) => (g.c(2, k) < -10 ? 'rubber' : j === 6 ? 'oliveLight' : 'olive'));
  g.grip(4, [-3.125, 1.875], 1.29, 4, 15, 'polymer');
  // The receiver, six voxels across, its top edges rounded; the feed cover on top.
  g.pbox(6, [1.875, 5.0], [-3.125, 8.125], (i, j, k) => (j === 7 && (i === -3 || i === 2) ? false : 'parker'));
  g.pbox(4, [5.0, 5.625], [-0.625, 6.875], (i, j, k) => (k === 10 ? 'steel' : 'parkerDark'));
  // Trigger and guard, the trigger housing.
  g.pbox(4, [1.25, 1.875], [-1.875, 5.0], 'parker');
  g.pbox(2, [0, 0.625], [1.25, 4.375], 'parker');
  g.pbox(2, [0, 1.25], [3.75, 4.375], 'parker');
  g.pbox(2, [0.625, 1.25], [1.875, 2.5], 'steel');
  // The ammo box on the left, olive banded orange, its lid and latch; the belt up from it into the
  // feed tray, a round a row, brass with copper tips, links between.
  g.pbox([3, 6], [-3.125, 1.875], [1.875, 6.875], (i, j, k) => (j === -2 || j === -1 ? 'orange' : j === 2 ? 'oliveDark' : 'olive'));
  g.box([6, 1, 5], [7, 2, 7], 'steel');
  g.box([3, 3, 4], [4, 8, 9], (i, j, k) => (j % 2 === 0 ? (k === 8 ? false : 'parkerDark') : k === 8 ? 'copper' : 'brass'));
  // The handguard round the barrel, olive, ribbed down its sides; the barrel, the gas cylinder
  // under it, the flash hider; the bipod folded under the front.
  g.pbox(6, [1.25, 4.375], [8.125, 14.375], (i, j, k) => (j === 2 && (i === -3 || i === 2) ? false : (i === -3 || i === 2) && k % 2 ? 'oliveDark' : 'olive'));
  g.pbox(2, [3.125, 4.375], [14.375, 21.25], 'parker');
  g.pbox(2, [1.875, 3.125], [14.375, 19.375], 'parker');
  g.pbox(4, [2.5, 4.375], [21.25, 22.5], (i, j, k) => ((j === 4 || j === 6) && (i === -2 || i === 1) ? false : j === 6 && k === 34 ? 'port' : 'parkerDark'));
  g.pbox(4, [1.25, 4.375], [19.375, 20.0], (i, j) => (j === 6 && (i === -2 || i === 1) ? false : 'parkerDark'));
  for (const i of [-2, 1]) g.box([i, 2, 23], [i + 1, 3, 31], (ii, j, k) => (k === 23 ? 'rubber' : 'parkerDark'));
  // The holo, orange, on the feed cover.
  const sight = optic(g, { w: 4, h: 3, sill: 6.875, z: 0, frame: 'orange', body: 2, bodyW: 6, back: 1, len: 5, drop: 1, aheadW: 4 });
  return g.mark('grip', [0, 0, 0]).mark('grip2', [0, 1.25, 11.25]).mark('muzzle', [0, 3.75, 22.5]).mark('sight', sight).mark('mag', [2.8125, -0.625, 4.375]);
}

/** Ezekiel: a semi-automatic marksman rifle, a mahogany stock, blued steel, a cream scope trimmed in gold, its objective glinting teal. */
function marksman() {
  const g = new Gun('marksman', 'Ezekiel', { offset: [0, 0, 0] }).colours({
    blued: [0x39424f, 0.35, 0.7], bluedDark: [0x2c323c, 0.4, 0.7], steel: [0xa4a8ae, 0.3, 1], mahogany: [0x7c3420, 0.4], mahoganyLight: [0x9a4a2c, 0.4],
    cream: [0xece2c8, 0.35], gold: [0xf2c055, 0.22, 1], lens: [0x10161a, 0.05, 0.3], glint: [0x1fc4b0, 0.08, 0.2, 0.6], hot: [0xd8fff6, 0.1, 0, 1], rubber: [0x1e1e1e, 0.9], anod: [0x2a2c31, 0.45, 0.4],
  });
  const G = rake(18);
  // The stock, one piece: the forend, the pistol grip, the butt with its comb; a rubber pad.
  g.prof(
    [
      [13.1, 3.75], [13.25, 2.2, 0.55], [9.0, 1.6, 2.0], [5.8, 1.1, 1.5], [1.9, 1.0],
      G(1.3, 0.9, 0.35), G(1.3, -2.35, 0.4), G(1.2, -3.02, 0.3), G(-1.5, -3.02, 0.3), G(-1.62, -2.4, 0.4), G(-1.5, -0.9, 0.7),
      [-3.2, 0.2, 1.6], [-9.6, -0.9, 0.3], [-9.6, 4.6, 0.3], [-6.8, 4.95, 0.8], [-3.9, 4.95, 0.6], [-2.4, 3.95, 0.6], [-1.2, 3.75],
    ],
    4,
    (i, j, k) => ((j === 7 && g.c(2, k) < -1.5) || (j === 5 && g.c(2, k) > 6) ? 'mahoganyLight' : 'mahogany'),
  );
  g.pbox(4, [-1.0, 4.7], [-10.2, -9.575], 'rubber');
  // The receiver, sunk in the stock; the operating rod's handle out on the right; the upper
  // handguard over the barrel; the barrel, its gas cylinder and band, the flash suppressor.
  g.pbox(4, [3.125, 5.0], [-1.875, 6.875], (i, j) => (j === 7 && (i === -2 || i === 1) ? false : 'blued'));
  g.box([-3, 6, 7], [-2, 7, 9], 'steel');
  g.pbox(4, [4.375, 5.625], [6.875, 12.5], (i, j) => (j === 8 && (i === -2 || i === 1) ? false : 'mahoganyLight'));
  g.pbox(2, [3.75, 5.0], [6.875, 20.0], 'blued');
  g.pbox(2, [2.5, 3.75], [12.5, 15.625], 'blued');
  g.pbox(4, [2.5, 5.0], [13.125, 13.75], (i, j) => ((j === 4 || j === 7) && (i === -2 || i === 1) ? false : 'steel'));
  g.pbox(2, [3.75, 5.0], [20.0, 21.875], (i, j, k) => (k % 2 ? 'bluedDark' : 'blued'));
  // The magazine, a short box; trigger and guard.
  g.pbox(4, [-1.875, 1.25], [3.75, 6.25], (i, j) => (j === -3 ? 'steel' : 'bluedDark'));
  g.pbox(2, [-0.625, 0], [1.25, 3.75], 'bluedDark');
  g.pbox(2, [-0.625, 1.25], [3.125, 3.75], 'bluedDark');
  g.pbox(2, [0, 1.25], [1.875, 2.5], 'gold');
  // The scope, cream, on its base and rings: the tube, the eyepiece and the objective rimmed in
  // gold, the rear lens, the teal glint ahead; the turrets gold.
  const SC = 7.5;
  g.pbox(2, [5.0, 5.625], [-1.25, 6.25], 'anod');
  for (const z of [0, 4.375]) g.pbox(2, [5.625, 6.25], [z, z + 0.625], 'anod');
  g.disc(0.7, [0, SC], [-0.625, 5.625], 'cream');
  for (const z of [0, 4.375]) g.disc(1.25, [0, SC], [z, z + 0.625], 'anod');
  g.disc(1.25, [0, SC], [-2.5, -0.625], (i, j, k) => (k === -4 ? (Math.hypot(g.c(0, i), g.c(1, j) - SC) < 0.7 ? 'lens' : 'gold') : 'cream'));
  g.disc(1.75, [0, SC], [5.625, 8.125], (i, j, k) => {
    if (k !== 12) return 'cream';
    const r = Math.hypot(g.c(0, i), g.c(1, j) - SC);
    return r > 1.3 ? 'gold' : r > 0.7 ? 'glint' : i === 0 && j === 12 ? 'hot' : 'lens';
  });
  g.pbox(2, [8.125, 8.75], [1.875, 3.125], 'gold');
  g.box([1, 11, 3], [2, 13, 5], 'gold');
  return g.mark('grip', [0, 0, 0]).mark('grip2', [0, 1.25, 9.375]).mark('muzzle', [0, 4.375, 21.875]).mark('sight', [0, SC, -2.5]).mark('mag', [0, -0.3125, 5.0]);
}

/** Rock Salt: a sawn-off side-by-side, two hammers, the action case-hardened (blue, violet and straw mottled), walnut, a brass bead, a mini red dot. */
function sawnoff() {
  const g = new Gun('sawnoff', 'Rock Salt', { offset: [0, 0, 0] }).colours({
    blued: [0x39424f, 0.35, 0.7], bluedDark: [0x2c323c, 0.4, 0.7], bore: [0x121212, 0.6, 0.3], walnut: [0x6e4329, 0.45], walnutDark: [0x55331f, 0.5],
    chBlue: [0x3d5a8a, 0.3, 0.9], chViolet: [0x6a4a8c, 0.3, 0.9], chStraw: [0xc9a24a, 0.3, 0.9], chSteel: [0x8e959e, 0.3, 1], brass: [0xd8aa55, 0.3, 1], gold: [0xf2c055, 0.22, 1],
  });
  const G = rake(25);
  // Case hardening: blotches of colour a couple of voxels across.
  const CH = ['chBlue', 'chSteel', 'chViolet', 'chBlue', 'chStraw', 'chSteel'];
  const mottle = (i, j, k) => CH[((((i >> 1) * 73856093) ^ (j * 19349663) ^ ((k >> 1) * 83492791)) >>> 0) % CH.length];
  // The grip, cut from the stock: the wrist behind the action curving down into a flared butt,
  // checkered on its sides, a steel cap.
  g.prof(
    [[0.75, 4.35], [-2.8, 4.1, 1.4], [-3.1, 2.4, 1.0], G(-1.35, -0.6, 0.6), G(-1.45, -2.4, 0.35), G(-1.9, -3.1, 0.3), G(1.25, -2.95, 0.25), G(1.35, -1.2, 0.3), G(1.2, 0.95, 0.2), [0.75, 1.35]],
    4,
    (i, j, k) => (g.c(1, j) < -2.4 ? 'bluedDark' : (i === -2 || i === 1) && j < 2 && (j + k) % 2 ? 'walnutDark' : 'walnut'),
  );
  // The action; the hammers on each side of its back, gold.
  g.pbox(6, [1.25, 4.375], [0.625, 4.375], (i, j, k) => (j === 6 && (i === -3 || i === 2) ? false : mottle(i, j, k)));
  for (const x of [[-3, -2], [2, 3]]) g.prof([[0.6, 3.75], [0.4, 4.6], [-0.4, 5.4], [-1.1, 5.9], [-1.5, 5.6], [-0.9, 5.0], [-0.3, 3.75]], x, 'gold');
  // The barrels side by side, three voxels round each (their outer corners off), dark bores at the
  // muzzle; the rib between them on top, the brass bead on its end.
  for (const [a, b] of [[-3, 0], [0, 3]])
    g.box([a, 4, 7], [b, 7, 21], (i, j, k) => ((a < 0 ? i === -3 : i === 2) && (j === 4 || j === 6) ? false : k === 20 && i === a + 1 && j === 5 ? 'bore' : 'blued'));
  g.box([-1, 7, 7], [1, 8, 21], 'bluedDark');
  g.box([-1, 8, 20], [1, 9, 21], 'brass');
  // The forend under the barrels, walnut; the triggers, gold, in their guard.
  g.pbox(4, [1.25, 2.5], [4.375, 10.0], (i, j, k) => (j === 2 && (i === -2 || i === 1) ? false : k === 15 ? 'walnutDark' : 'walnut'));
  g.pbox(2, [0, 0.625], [1.25, 4.375], 'bluedDark');
  g.pbox(2, [0, 1.25], [3.75, 4.375], 'bluedDark');
  g.pbox(2, [0.625, 1.25], [1.875, 2.5], 'gold');
  g.pbox(2, [0.625, 1.25], [3.125, 3.75], 'gold');
  // The mini red dot on a plate on the action, its frame brass, looking down the rib.
  g.pbox(4, [4.375, 5.0], [1.25, 4.375], 'bluedDark');
  const sight = optic(g, { w: 4, h: 2, sill: 6.25, z: 3.125, frame: 'brass', body: 2, bodyW: 6, back: 1, len: 3, drop: 1, aheadW: 4, colour: 'bluedDark' });
  return g.mark('grip', [0, 0, 0]).mark('grip2', [0, 1.25, 7.1875]).mark('muzzle', [0, 3.4375, 13.125]).mark('sight', sight).mark('mag', [0, 3.4375, 4.375]);
}

/** Bad Mother: a .44 magnum in mirror chrome, a fluted cylinder, a vent rib, ebony grips with gold medallions, a gold hammer and trigger, a mini red dot hooded orange. */
function revolver() {
  const g = new Gun('revolver', 'Bad Mother', { offset: [-0.5, 0, 0] }).colours({
    chrome: [0xeceef0, 0.12, 1], chromeDark: [0xb4b8be, 0.2, 1], flute: [0x6a6e76, 0.25, 1], ebony: [0x1e1b1b, 0.35], gold: [0xf2c055, 0.22, 1], orange: [0xff6a1a, 0.3], bore: [0x141414, 0.5, 0.3],
  });
  // The grip: ebony panels between chrome straps, a gold medallion on each side, a round chrome butt.
  const medal = [g.cell(2, -0.9), g.cell(1, -1.2)];
  g.grip(3, [-3.125, 1.25], 1.35, 5, 18, (i, j, k, back) =>
    j === -5 ? (k === back ? false : 'chrome') : k === back || k === back + 4 ? 'chrome' : i !== 0 && k === medal[0] && j === medal[1] ? 'gold' : 'ebony',
  );
  // The frame: the recoil shield, the strap over the cylinder and the frame under it, the front
  // round the barrel's breech; the cylinder latch on the left.
  g.pbox(3, [1.25, 5.0], [-1.25, 0.625], 'chrome');
  g.pbox(3, [4.375, 5.0], [-1.25, 5.0], 'chrome');
  g.pbox(3, [1.25, 1.875], [-1.25, 5.0], 'chrome');
  g.pbox(3, [1.875, 5.0], [3.75, 5.0], 'chrome');
  g.box([2, 5, -1], [3, 6, 0], 'chromeDark');
  // The cylinder, five voxels round, fluted between its ends.
  const CY = 2.8125;
  g.disc(1.6, [0, CY], [0.625, 3.75], (i, j, k) => {
    const x = g.c(0, i), y = g.c(1, j) - CY;
    return Math.hypot(x, y) > 0.9 && k > 1 && k < 5 && Math.round(Math.atan2(y, x) / (Math.PI / 6)) % 2 !== 0 ? 'flute' : 'chrome';
  });
  // The barrel with its full lug under, the vent rib on top; the bore.
  g.pbox(3, [2.5, 4.375], [5.0, 13.125], (i, j, k) => (k === 20 && i === 0 && j === 5 ? 'bore' : 'chrome'));
  g.pbox(3, [1.875, 2.5], [5.0, 11.875], (i, j, k) => (k === 18 && i !== 0 ? false : 'chromeDark'));
  g.pbox(1, [4.375, 5.0], [5.0, 13.125], (i, j, k) => (k % 2 ? 'flute' : 'chrome'));
  // The mini red dot on the strap over the cylinder, its hood orange.
  const sight = optic(g, { w: 3, h: 2, sill: 6.25, z: -0.625, frame: 'orange', body: 2, bodyW: 5, back: 1, len: 4, drop: 1, aheadW: 3, colour: 'flute' });
  // The hammer, cocked, and the trigger, gold; the guard.
  g.prof([[-0.9, 4.4], [-1.2, 5.2], [-1.8, 5.8], [-2.5, 6.0], [-2.65, 5.6], [-2.0, 5.2], [-1.6, 4.4]], 1, 'gold');
  g.pbox(1, [0, 0.625], [0.625, 3.75], 'chrome');
  g.pbox(1, [0, 1.25], [3.125, 3.75], 'chrome');
  g.pbox(1, [0.625, 1.25], [1.25, 1.875], 'gold');
  return g.mark('grip', [0, 0, 0]).mark('grip2', [0, -2, 2]).mark('muzzle', [0, 3.4375, 13.125]).mark('sight', sight).mark('mag', [0, CY, 2.1875]);
}

/** Hattori Hanzo: a katana, a mirror blade with its hamon, a gold-rimmed iron tsuba, a yellow and black silk wrap. */
function katana() {
  const g = new Gun('katana', 'Katana', { offset: [-0.5, -0.5, 0] }).colours({
    ito: [0xffc81f, 0.7], itoDark: [0x181717, 0.7], lacquer: [0x161517, 0.15], gold: [0xf2c055, 0.22, 1], iron: [0x34343a, 0.45, 0.8],
    blade: [0xc8ced4, 0.12, 1], hamon: [0xf4f7fa, 0.14, 1],
  });
  const round3 = (i, j) => Math.abs(i) === 1 && Math.abs(j) === 1;
  // The kashira (pommel), the handle wrapped in yellow silk crossed black, the fuchi collar.
  g.box([-1, -1, -5], [2, 2, -4], (i, j) => (round3(i, j) ? false : 'lacquer'));
  g.box([-1, -1, -4], [2, 2, 7], (i, j, k) => (round3(i, j) ? false : (j === 0) === (k % 2 === 0) ? 'itoDark' : 'ito'));
  g.box([-1, -1, 7], [2, 2, 8], 'lacquer');
  // The tsuba: an iron disc rimmed in gold; the habaki.
  const inTsuba = (i, j) => (g.c(0, i) / 2.1) ** 2 + (g.c(1, j) / 2.25) ** 2 <= 1;
  g.box([-3, -3, 8], [4, 4, 9], (i, j) => (!inTsuba(i, j) ? false : [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => !inTsuba(i + a, j + b)) ? 'gold' : 'iron'));
  g.box([0, -1, 9], [1, 2, 11], 'gold');
  // The blade, a voxel thick and two tall: its spine (-y) and edge (+y, the hamon), curving down
  // toward the point, where the edge sweeps up into the spine.
  const drop = (k) => Math.round(((g.c(2, k) - 5.4) ** 2 / 300) / V);
  const TIP = 42;
  for (let k = 11; k <= TIP; k++) {
    const y = -1 - drop(k);
    g.box([0, y, k], [1, y + 1, k + 1], k === TIP ? 'hamon' : 'blade');
    if (k < TIP) g.box([0, y + 1, k], [1, y + 2, k + 1], 'hamon');
  }
  return g.mark('grip', [0, 0, 0]).mark('grip2', [0, 0, 3]).mark('muzzle', [0, g.c(1, -1 - drop(TIP)), g.b(2, TIP + 1)]);
}

/** The briefcase: black leather, brass corners and latches, the lid leaning open and gold light spilling from it. */
function briefcase() {
  const g = new Gun('briefcase', 'The Briefcase', { offset: [0, 0, 0] }).colours({ leather: [0x26211f, 0.55], leatherDark: [0x1a1717, 0.6], brass: [0xd8aa55, 0.3, 1], glow: [0xffcc55, 0.3, 0.4, 1] });
  // The back half; the lid in front leaning open from its bottom edge (a voxel every few rows), the glow between.
  g.box([-8, 1, -2], [8, 12, 0], (i, j, k) => ((i === -8 || i === 7) && (j === 1 || j === 11) && k === -2 ? 'brass' : 'leather'));
  const lean = (j) => Math.floor((j + 0.5) / 3.3);
  for (let j = 1; j < 12; j++) {
    const s = lean(j);
    g.box([-8, j, s], [8, j + 1, s + 2], (i, jj, k) => ((i === -8 || i === 7) && (j === 1 || j === 11) && k === s + 1 ? 'brass' : 'leather'));
    if (s > 0) g.box([-7, j, 0], [7, j + 1, s], 'glow');
  }
  // Latches and the combination lock on the lid's face.
  const s10 = lean(10);
  g.paint([-6, 10, s10 + 1], [6, 11, s10 + 2], (i) => (i <= -5 || i >= 4 || (i >= -2 && i <= 1) ? 'brass' : undefined));
  // The handle on top, brass mounts; brass feet.
  for (const i of [-4, 3]) g.box([i, 12, -1], [i + 1, 14, 0], (ii, j) => (j === 12 ? 'brass' : 'leather'));
  g.box([-4, 14, -1], [4, 15, 0], 'leather');
  for (const i of [-7, 6]) for (const k of [-2, 1]) g.box([i, 0, k], [i + 1, 1, k + 1], 'brass');
  return g;
}

/**
 * Ammo (a pickup, dropped by the fallen): an olive ammo can banded orange, its handle folded on the
 * lid, a belt of brass rounds hanging out of it. It stands up along +z (the platform stands a
 * model up that way to drop it), its front toward -y; no markers.
 */
function ammo() {
  const g = new Gun('ammo', 'Ammo', { offset: [0, 0, 0] }).colours({
    olive: [0x5d6b35, 0.6], oliveDark: [0x48532a, 0.65], orange: [0xff7a1a, 0.3, 0, 0.35], steel: [0xa4a8ae, 0.3, 1], brass: [0xd8aa55, 0.3, 1, 0.15], copper: [0xc8733a, 0.3, 1],
    link: [0x2a2c30, 0.6, 0.4], polymer: [0x28292d, 0.65], yellow: [0xf2d046, 0.5],
  });
  // The can (x across, y front to back, z up), the orange band round it, the stencil on its back;
  // the lid, the handle folded on it, the latch on its side.
  g.box([-5, -3, 0], [5, 3, 7], (i, j, k) => (k === 2 ? 'orange' : j === 2 && k === 4 && i > -4 && i < 3 && i !== -1 ? 'yellow' : 'olive'));
  g.box([-5, -3, 7], [5, 3, 8], 'oliveDark');
  g.box([-2, -1, 8], [2, 1, 9], 'polymer');
  g.box([5, -1, 4], [6, 1, 8], 'steel');
  // The belt out from under the lid down its front: rounds across, copper tips, links between.
  g.box([-4, -4, 3], [1, -3, 7], (i, j, k) => (k % 2 === 0 ? (i === -4 ? 'copper' : 'brass') : i > -4 ? 'link' : false));
  return g;
}

/** The Pineapple: a frag, olive segments, a yellow band, the fuse, the spoon down its right, the ring in front. */
function frag() {
  const g = new Gun('frag', 'The Pineapple', { offset: [0, 0, 0] }).colours({ olive: [0x5a6830, 0.35], oliveDark: [0x414b24, 0.4], yellow: [0xd8b520, 0.35], fuse: [0x4e504c, 0.5, 0.6], steel: [0xa8acb2, 0.3, 1] });
  // The body: an egg, widest a little below its middle, in rows of segments; the yellow shoulder.
  const R0 = 1.78, YC = -0.12;
  const rOf = (y) => {
    const s = clamp((y - YC) / (y < YC ? 2.3 : 2.45), -1, 1);
    return R0 * Math.pow(Math.max(0, Math.cos(Math.asin(s))), 0.8);
  };
  for (let j = -4; j < 4; j++) {
    const r = rOf(g.c(1, j));
    for (let k = -3; k < 3; k++)
      for (let i = -3; i < 3; i++) {
        const x = g.c(0, i), z = g.c(2, k);
        if (Math.hypot(x, z) > r + 1e-6) continue;
        const col = Math.floor(((Math.atan2(z, x) / (2 * Math.PI)) * 8 + 8.5) % 8);
        g.box([i, j, k], [i + 1, j + 1, k + 1], j === -4 ? 'fuse' : j === 2 ? 'yellow' : j === 3 ? 'olive' : (j + col) % 2 ? 'oliveDark' : 'olive');
      }
  }
  // The fuse head, the striker housing on its left; the spoon over the top and down the right.
  g.box([-1, 4, -1], [1, 5, 1], 'fuse');
  g.box([1, 4, -1], [2, 5, 1], 'fuse');
  g.box([-2, 5, -1], [2, 6, 1], 'steel');
  g.box([-2, 3, -1], [-1, 5, 1], 'steel');
  g.box([-3, 2, -1], [-2, 3, 1], 'steel');
  g.box([-4, -1, -1], [-3, 2, 1], 'steel');
  // The pull ring hanging in front.
  g.box([-1, 3, 1], [0, 6, 4], (i, j, k) => (j === 4 && k === 2 ? false : 'steel'));
  return g.mark('grip', [0, 0, 0]);
}

/** The Mia: a red soda bottle, a paper label round its waist, a napkin stuffed in its neck, burning. */
function molotov() {
  const g = new Gun('molotov', 'The Mia', { offset: [0, 0, 0] }).colours({
    glass: [0xc01830, 0.08], glassDark: [0x8e1024, 0.1], label: [0xf4f1ea, 0.7], labelRed: [0xd21e3c, 0.7], napkin: [0xf6f3ec, 0.9], check: [0xd8283c, 0.9],
    flame: [0xff8a1f, 0.9, 0, 1], flameTip: [0xffd24a, 0.9, 0, 1],
  });
  // The bottle, its contour (r, y) from the base to the lip: the fuel dark in it up to its shoulder.
  const outline = [[1.3, -3.75], [1.74, -3.42], [1.9, -2.5], [1.68, -1.05], [1.68, -0.3], [1.94, 0.95], [1.82, 1.8], [1.1, 2.95], [0.72, 3.7], [0.69, 4.95], [0.84, 5.05], [0.86, 5.6]];
  const rAt = (y) => {
    for (let n = 1; n < outline.length; n++) {
      const [r0, a] = outline[n - 1], [r1, b] = outline[n];
      if (y >= a && y <= b) return r0 + ((r1 - r0) * (y - a)) / (b - a);
    }
    return 0;
  };
  for (let j = -6; j < 9; j++) {
    const y = g.c(1, j);
    g.ring(Math.max(0.5, rAt(y)), [0, 0], [g.b(1, j), g.b(1, j + 1)], (i, jj, k) => {
      if (j === -2 || j === -1) return j === -1 && k === 2 && (i === -1 || i === 0) ? 'labelRed' : 'label';
      return y < 2.0 ? 'glassDark' : 'glass';
    });
  }
  // The napkin: stuffed in the neck, up out of it and flopped over toward +x, a flap down the side.
  const check = (i, j, k) => ((i + j + k) % 2 ? 'check' : 'napkin');
  g.box([-1, 9, -1], [1, 10, 1], check);
  g.box([0, 10, -1], [2, 11, 1], check);
  g.box([1, 11, -1], [2, 12, 1], 'napkin');
  g.box([1, 7, 0], [2, 9, 1], check);
  // The flame on its end.
  g.box([1, 12, -1], [2, 13, 1], 'flame');
  g.box([1, 13, 0], [2, 14, 1], 'flameTip');
  return g.mark('grip', [0, -1.5, 0]);
}

/**
 * A C4 charge: a slab of plastic explosive in olive wrap with the putty showing at its ends, taped
 * bands round it, a black detonator on top with a blinking red light and wires taped away over
 * the edge. Lies flat (x across, y up, z long); no markers.
 */
function c4() {
  const g = new Gun('c4', 'C4', { offset: [0, 0, 0] }).colours({
    putty: [0xcfc7a4, 0.8], wrap: [0x5d6b35, 0.7], wrapDark: [0x48532a, 0.7], tape: [0x2a2c30, 0.6], steel: [0xa4a8ae, 0.3, 1],
    led: [0xff2a1a, 0.2, 0, 1], wire: [0xd8aa55, 0.5, 0.8], wireRed: [0xc01830, 0.6],
  });
  g.box([-9, 0, -5], [9, 4, 5], (i, j, k) => (Math.abs(i) >= 8 && j >= 1 && j <= 2 ? 'putty' : i === -5 || i === 4 ? 'tape' : (i + k) % 5 === 0 ? 'wrapDark' : 'wrap'));
  g.box([-3, 4, -2], [2, 6, 3], 'tape'); // the detonator
  g.box([-2, 6, -1], [1, 7, 2], 'steel');
  g.box([0, 7, 0], [1, 8, 1], 'led'); // its blinking light
  g.box([2, 5, 0], [8, 6, 1], 'wire'); // wires, taped away over the edge
  g.box([8, 4, 0], [9, 5, 1], 'wireRed');
  g.box([2, 5, 1], [7, 6, 2], (i) => (i % 2 ? 'wireRed' : false));
  return g;
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
    generator: 'Call of Blocky src/games/callofblocky/tools/guns/build.mjs',
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

/** Each model's size (px, x y z) as the hard-surface models these replaced drew it, to keep the holds tuned. */
const SIZES = { pistol: [3.68, 12.38, 12.25], smg: [4.86, 20.33, 16.92], rifle: [5.96, 19.71, 28.06], shotgun: [5.96, 15.15, 30.05], sniper: [5.06, 13.22, 32.95], tommy: [4.4, 12.8, 27], lmg: [5.6, 13, 33], marksman: [3.75, 12.3, 32], sawnoff: [3.75, 11.25, 16.25], revolver: [3.13, 11.25, 15.63], katana: [3.9, 4.6, 29.8], briefcase: [10.3, 9.15, 4.63], ammo: [6.88, 4.38, 5.63], frag: [4.06, 6.1, 3.93], molotov: [3.84, 12.16, 3.84], c4: [11.25, 5, 6.25] };

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
 * (on the sight line, each of EYE_BACKS behind the frame's rear face), beyond its front or between the eye
 * and its rear. The window is its cells less the chamfered corners, a hair inside their edges.
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
  const rects = [
    [X0 + V + e, Y0 + e, X1 - V - e, Y1 - e],
    [X0 + e, Y0 + e, X1 - e, Y1 - V - e],
  ].map(([a, b, c, d]) => [[a, b], [c, b], [c, d], [a, d]]);
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

function validate(buf, g) {
  const fail = (m) => {
    throw new Error(`${g.id}.glb: ${m}`);
  };
  const { json, read } = readGlb(buf);
  if (json.nodes[json.scenes[0].nodes[0]].name !== g.id) fail('root not named after the model');
  if (json.meshes.length !== 1 || json.meshes[0].primitives.length !== 1 || json.materials.length !== 1) fail('not one mesh, one primitive, one material');
  for (const [name, p] of Object.entries(g.markers)) {
    const n = json.nodes.find((x) => x.name === name);
    if (!n || n.mesh !== undefined || n.children || n.translation.some((v, a) => Math.abs(v * 16 - p[a]) > 1e-4)) fail(`marker ${name}`);
  }
  if (g.markers.grip && g.markers.grip.some((v) => v !== 0) && g.id !== 'molotov') fail('grip not at the origin');
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
  // The optic: its window open, its frame whole round it (sides and top, one voxel deep).
  const w = g.window;
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
  return { tris: I.length / 3 };
}

/** The model's voxels in letters: side on from +x, from behind (-z, the aiming view) and from above. */
function show(g) {
  const names = [...g.P.colours.keys()];
  const ch = (c) => (c ? 'abcdefghijklmnopqrstuvwxyz'[names.indexOf(c)] : '.');
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

const MODELS = { pistol, smg, rifle, shotgun, sniper, tommy, lmg, marksman, sawnoff, revolver, katana, briefcase, ammo, frag, molotov, c4 };
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
  const was = SIZES[id];
  const fmt = (p) => `(${p.map((x) => +x.toFixed(2)).join(', ')})`;
  console.log(`${g.id}.glb  ${g.name}: ${stats.voxels} voxels, ${stats.faces} faces as ${stats.quads} quads, ${v.tris} tris, ${stats.tiles} tiles in ${stats.atlas}, ${(bytes.length / 1024).toFixed(1)} KB`);
  console.log(`  size (px) x ${size[0]}  y ${size[1]}  z ${size[2]}  (${size.map((x, k) => `${x >= was[k] ? '+' : ''}${Math.round((x / was[k] - 1) * 100)}%`).join(' ')})   z ${fmt([lo[2], hi[2]])}  y ${fmt([lo[1], hi[1]])}`);
  console.log(`  markers ${Object.entries(g.markers).map(([k, p]) => `${k} ${fmt(p)}`).join('  ')}${g.window ? `   window ${fmt([g.b(0, g.window.x1) - g.b(0, g.window.x0), g.b(1, g.window.y1) - g.b(1, g.window.y0)])} px, clear` : ''}`);
}
