#!/usr/bin/env node
/**
 * The Arena's arsenal as micro-voxel models, in Call of Blocky's and Blockfront's style, written as
 * binary glTF 2.0 to `src/games/arena/models/weapons/`, each weapon in each of its four rarities.
 * Dependency-free (Node 22+): `node src/games/arena/tools/weapons/build.mjs [ids...] [--show]`
 * (`--show` prints each model's voxels side on, from behind and from above). Each file is parsed back
 * and checked after it's written (chunks, accessors, winding, markers).
 *
 * Conventions (the platform's held models', which the first-person view and the figures rely on):
 *
 * - Units: 1 glTF unit = 1 block = 16 px; voxels 0.625 px on a side (as the other games' arsenals).
 * - Orientation: the weapon runs along +z (the blade's tip, a staff's head, a crossbow's prod at
 *   the +z end), +y is up. A blade is broad across x and thin in y, so held in the sword or axe
 *   pose its flat faces you; a crossbow is built like a gun (its stock along z, the prod across x).
 * - Origin (0,0,0): the centre of the hand on the grip (`grip`). Two-handed ones mark `grip2` (the
 *   other hand), all mark `muzzle` (a blade's tip, a staff's orb, a crossbow's bolt tip); the
 *   crossbow `sight` (its rear sight) and `mag` (the nut, where the string is caught: spanning sends
 *   the hand there).
 * - Rarity: each weapon's fittings, gems and runes take its rarity's colours: common plain bronze
 *   and iron, rare polished steel and blue light, epic blackened steel, silver and violet, legendary
 *   gold and amber, its runes and edges alight. What glows is coloured deep (the bloom brings it up).
 * - Look (`tools/voxel.mjs`): flat, clean voxels with soft occlusion in the corners; one material
 *   (base colour, metal-roughness, emission), the mesh through EXT_meshopt_compression (its
 *   positions stay floats: the platform's held models take them as they are). Files: `<id>.glb`
 *   (common), `<id>_<rarity>.glb`.
 */
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Palette, Voxels, faces, atlas, quadCorners, png, writeGlb, readGlb, cellOf, DIRS } from '../voxel.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '../../models/weapons');
/** A voxel, in px. */
const V = 0.625;
const MAX_BYTES = 200 * 1024;
const clamp = (v, lo = 0, hi = 1) => (v < lo ? lo : v > hi ? hi : v);

// ---------------------------------------------------------------------------------------------
// A model: one part of voxels, colours, markers. Cell (i, j, k) is the voxel from (i, j, k) +
// offset to (i+1, j+1, k+1) + offset voxels from the origin; shapes are given in px and fill the
// cells whose centres they hold.

class Model {
  constructor(id, name, { offset = [-0.5, -0.5, 0] } = {}) {
    this.id = id;
    this.name = name;
    this.vox = new Voxels();
    this.P = new Palette();
    this.markers = {};
    this.offset = offset;
  }
  /** Colours: name -> [hex, rough, metal, glow]. */
  colours(list) {
    for (const [name, [rgb, rough = 0.8, metal = 0, glow = 0]] of Object.entries(list)) this.P.add(name, rgb, { rough, metal, glow, vary: 0 });
    return this;
  }
  /** The cells along axis `a` whose centres are in [lo, hi) px. */
  span(a, lo, hi) {
    const o = this.offset[a];
    const f = (v) => Math.ceil(v / V - 0.5 - o - 1e-9);
    return [f(lo), f(hi)];
  }
  /** A cell's centre along axis `a`, in px. */
  c(a, i) {
    return (i + 0.5 + this.offset[a]) * V;
  }
  /** A cell boundary (the lower face of cell i) along axis `a`, in px. */
  b(a, i) {
    return (i + this.offset[a]) * V;
  }
  /** The cell along axis `a` that holds `v` px. */
  cell(a, v) {
    return Math.floor(v / V - this.offset[a]);
  }
  set(i, j, k, c) {
    if (c === false) this.vox.del('body', i, j, k);
    else if (c) this.vox.set('body', i, j, k, c);
    return this;
  }
  has(i, j, k) {
    return this.vox.filled(i, j, k);
  }
  get(i, j, k) {
    return this.vox.get('body', i, j, k);
  }
  /** Fill cells [lo, hi); `c` a colour or `(i, j, k) => colour | false | undefined`. */
  box(lo, hi, c) {
    const f = typeof c === 'function' ? c : () => c;
    this.vox.paint('body', lo, hi, f);
    return this;
  }
  /** A box in px on all three axes. */
  pbox([x0, x1], [y0, y1], [z0, z1], c) {
    const [i0, i1] = this.span(0, x0, x1), [j0, j1] = this.span(1, y0, y1), [k0, k1] = this.span(2, z0, z1);
    return this.box([i0, j0, k0], [i1, j1, k1], c);
  }
  /** A round section along z: the cells within `r` px of (x, y), from z0 to z1 px; `c(i, j, k, rim)` (rim: an outer cell). */
  disc(r, [x, y], [z0, z1], c) {
    const f = typeof c === 'function' ? c : () => c;
    const [i0, i1] = this.span(0, x - r, x + r + 1e-6), [j0, j1] = this.span(1, y - r, y + r + 1e-6), [k0, k1] = this.span(2, z0, z1);
    const inside = (i, j) => Math.hypot(this.c(0, i) - x, this.c(1, j) - y) <= r + 1e-6;
    for (let k = k0; k < k1; k++)
      for (let j = j0; j < j1; j++)
        for (let i = i0; i < i1; i++) if (inside(i, j)) this.set(i, j, k, f(i, j, k, !inside(i + 1, j) || !inside(i - 1, j) || !inside(i, j + 1) || !inside(i, j - 1)));
    return this;
  }
  /** A ball: the cells within `r` px of a point. */
  ball(r, [x, y, z], c, squash = [1, 1, 1]) {
    const f = typeof c === 'function' ? c : () => c;
    const [i0, i1] = this.span(0, x - r * squash[0], x + r * squash[0] + 1e-6), [j0, j1] = this.span(1, y - r * squash[1], y + r * squash[1] + 1e-6), [k0, k1] = this.span(2, z - r * squash[2], z + r * squash[2] + 1e-6);
    for (let k = k0; k < k1; k++)
      for (let j = j0; j < j1; j++)
        for (let i = i0; i < i1; i++) {
          const d = Math.hypot((this.c(0, i) - x) / squash[0], (this.c(1, j) - y) / squash[1], (this.c(2, k) - z) / squash[2]);
          if (d <= r + 1e-6) this.set(i, j, k, f(i, j, k, d / r));
        }
    return this;
  }
  /** A rod a cell thick from one point to another (px), `w` cells round (1 or 3: a cross). */
  rod(a, b, c, w = 1) {
    const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / V) * 2 + 1;
    for (let s = 0; s <= n; s++) {
      const t = s / n;
      const [i, j, k] = [0, 1, 2].map((ax) => this.cell(ax, a[ax] + (b[ax] - a[ax]) * t));
      this.set(i, j, k, c);
      if (w > 1) for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) this.set(i + di, j + dj, k, c);
    }
    return this;
  }
  /** Recolour filled cells in [lo, hi) that `pick(i, j, k, c)` names a colour for (or `false`: clear). */
  paint(lo, hi, pick) {
    this.vox.recolour('body', (i, j, k, c) => (i >= lo[0] && i < hi[0] && j >= lo[1] && j < hi[1] && k >= lo[2] && k < hi[2] ? pick(i, j, k, c) : undefined));
    return this;
  }
  /** Every filled cell: [i, j, k, colour]. */
  cells() {
    return [...this.vox.parts.get('body')].map(([key, c]) => [...cellOf(key), c]);
  }
  mark(name, p) {
    this.markers[name] = p.map((v) => Math.round(v * 1e4) / 1e4);
    return this;
  }
}

// ---------------------------------------------------------------------------------------------
// Rarities: the colours each one's fittings, gems and runes take

const RARITIES = ['common', 'rare', 'epic', 'legendary'];
const ACCENTS = {
  common: {
    fit: [0x9a6a32, 0.38, 0.85], fitDark: [0x5e3e1c, 0.45, 0.8], trim: [0x8f959b, 0.32, 1], gem: [0x7a2420, 0.25, 0.2], rune: [0x3e4249, 0.5, 0.7],
    steel: [0x7e858e, 0.34, 1], steelDark: [0x4a5058, 0.4, 1], edge: [0xb8bec6, 0.22, 1],
  },
  rare: {
    fit: [0xb9c0c8, 0.22, 1], fitDark: [0x6e757e, 0.3, 1], trim: [0x2e64c8, 0.3, 0.7], gem: [0x0a3ad0, 0.25, 0, 1], rune: [0x0c44d8, 0.35, 0, 0.75],
    steel: [0x8e97a2, 0.28, 1], steelDark: [0x525a66, 0.34, 1], edge: [0xc8d0da, 0.18, 1],
  },
  epic: {
    fit: [0x2c2833, 0.3, 0.75], fitDark: [0x1a171e, 0.38, 0.6], trim: [0xc8c2d6, 0.2, 1], gem: [0x6a10c8, 0.25, 0, 1], rune: [0x7414d4, 0.35, 0, 0.85],
    steel: [0x6c687c, 0.28, 1], steelDark: [0x3a3646, 0.34, 1], edge: [0xc0bcd0, 0.2, 1],
  },
  legendary: {
    fit: [0xd8a22c, 0.2, 1], fitDark: [0x8e5c12, 0.28, 1], trim: [0xfde39a, 0.16, 1], gem: [0xd06a00, 0.2, 0, 1], rune: [0xe08a10, 0.3, 0, 1],
    steel: [0xa8adb6, 0.22, 1], steelDark: [0x6e7480, 0.28, 1], edge: [0xe8b84a, 0.18, 1, 0.35],
  },
};
const glowing = (rarity) => rarity !== 'common';

/** A model for `base` in `rarity`, its colours: the rarity's accents and the weapon's own. */
function model(base, name, rarity, own, opts) {
  const id = rarity === 'common' ? base : `${base}_${rarity}`;
  return new Model(id, name, opts).colours({ ...ACCENTS[rarity], ...own });
}

/** Leather wrapped round a grip, crossing every other voxel. */
const wrap = (k, i, j) => ((k + (i > 0 ? 1 : 0) + (j > 0 ? 1 : 0)) % 2 === 0 ? 'leather' : 'leatherDark');

/**
 * A blade along z from `z0` px, `len` long, broad across x (`hw(t)`: its half width in px at `t`,
 * 0 at the hilt to 1 at the tip) and `thick` cells in y at its spine (one at the edges): honed
 * edges, a darker fuller down the middle (`fuller` of its length), runes in the fuller every so
 * often (alight, past common).
 */
function blade(g, z0, len, hw, { thick = 3, fuller = 0.7, runes = false, rarity }) {
  const [k0, k1] = g.span(2, z0, z0 + len);
  let tip = k0;
  for (let k = k0; k < k1; k++) {
    const t = (g.c(2, k) - z0) / len;
    const w = hw(t);
    if (w < V * 0.45) continue;
    tip = k;
    const n = Math.max(0, Math.round(w / V - 0.5));
    for (let i = -n; i <= n; i++) {
      const out = Math.abs(i) === n && n > 0;
      const spine = Math.abs(i) <= Math.max(0, n - 2) && thick > 1;
      const inFuller = t < fuller && Math.abs(i) <= 0 && n >= 2;
      const rune = runes && inFuller && t > 0.08 && k % 3 === 0;
      for (let j = spine ? -1 : 0; j <= (spine ? 1 : 0); j++) {
        const face = j !== 0 || !spine;
        g.set(i, j, k, out ? 'edge' : rune && face ? 'rune' : inFuller && face ? 'steelDark' : 'steel');
      }
    }
  }
  return g.b(2, tip + 1);
}

/** A round pommel, or a gem set in one (alight past common). */
function pommel(g, z, r, rarity) {
  g.ball(r, [0, 0, z], (i, j, k, d) => (d < 0.55 && glowing(rarity) ? 'gem' : 'fit'));
}

// ---------------------------------------------------------------------------------------------
// The weapons

/** The gladius: a short leaf-shaped blade, a bronze-capped hilt with a round pommel. */
function gladius(rarity) {
  const g = model('gladius', 'Gladius', rarity, { leather: [0x5a3a22, 0.75], leatherDark: [0x3e2614, 0.8], wood: [0x6a4626, 0.7] });
  pommel(g, -2.9, 1.5, rarity);
  // The grip: wood ribbed with leather, a collar each end.
  g.disc(0.95, [0, 0], [-1.9, 2.4], (i, j, k) => wrap(k, i, j));
  g.disc(1.15, [0, 0], [-1.9, -1.25], 'fitDark');
  g.disc(1.15, [0, 0], [1.9, 2.5], 'fitDark');
  // The guard: broad across the blade, a gem at its heart.
  g.pbox([-2.6, 2.6], [-1.0, 1.0], [2.5, 3.75], (i) => (Math.abs(g.c(0, i)) > 1.9 ? 'fitDark' : 'fit'));
  for (const j of [-2, 2]) g.set(0, j, g.cell(2, 3.1), 'gem');
  // The blade: a waist, swelling toward the point, then the long point.
  const tip = blade(g, 3.75, 18.4, (t) => (t < 0.62 ? 1.75 - 0.35 * Math.sin((t / 0.62) * Math.PI) + 0.2 * (t / 0.62) : 1.95 * Math.sqrt(Math.max(0, 1 - ((t - 0.62) / 0.38) ** 1.4))), { rarity, runes: glowing(rarity), fuller: 0.6 });
  // (A second grip just behind the hand: a fighter's figure holds it blade up, ready, as a sword.)
  return g.mark('grip', [0, 0, 0]).mark('grip2', [0, 0, -1.6]).mark('muzzle', [0, 0, tip]);
}

/** The scutum-style round shield that goes with the gladius: bronze rim, painted boards, a boss. */
function shield(rarity) {
  const g = model('gladius_shield', 'Shield', rarity, { board: [0x8c1c18, 0.7], boardDark: [0x6a1410, 0.75], paint: [0xd8b25a, 0.6, 0.3], back: [0x5a3a22, 0.8] }, { offset: [-0.5, -0.5, -0.5] });
  // Face toward +z (it's held facing out), 1.5 px thick, 15 across.
  const R = 7.6;
  for (let j = -14; j <= 14; j++)
    for (let i = -14; i <= 14; i++) {
      const x = g.c(0, i), y = g.c(1, j), r = Math.hypot(x, y);
      if (r > R) continue;
      const rim = r > R - V * 1.4;
      const ring = Math.abs(r - 4.4) < V * 0.6;
      const spokes = !rim && r > 2.2 && (Math.abs(x) < V * 0.6 || Math.abs(y) < V * 0.6);
      g.set(i, j, 0, rim ? 'fit' : ring ? (glowing(rarity) ? 'rune' : 'paint') : spokes ? 'paint' : (i + j) % 5 === 0 ? 'boardDark' : 'board');
      g.set(i, j, -1, rim ? 'fit' : 'back');
      if (rim) g.set(i, j, 1, 'fit');
    }
  // The boss, and its gem.
  g.ball(2.1, [0, 0, 0.6], (i, j, k, d) => (d < 0.45 && glowing(rarity) ? 'gem' : 'fit'), [1, 1, 0.7]);
  // The grip behind, across the middle.
  g.pbox([-1.6, 1.6], [-0.6, 0.6], [-2.2, -0.9], 'back');
  return g.mark('grip', [0, 0, -1.5]).mark('muzzle', [0, 0, 1.5]);
}

/** The warhammer: a long iron-shod haft, a heavy head: a flat face one side, a beak the other. */
function warhammer(rarity) {
  const g = model('warhammer', 'Warhammer', rarity, { wood: [0x5a3a1e, 0.72], woodDark: [0x40280f, 0.78], leather: [0x3a2414, 0.8], leatherDark: [0x24160b, 0.85], iron: [0x4a4e56, 0.35, 0.9], ironDark: [0x2e3138, 0.4, 0.85] });
  // The butt cap, the haft (wrapped where the hands go), the langets up to the head.
  g.disc(1.2, [0, 0], [-3.75, -2.5], 'fitDark');
  g.disc(0.95, [0, 0], [-2.5, 21.25], (i, j, k) => (g.c(2, k) < 3.2 || (g.c(2, k) > 8.5 && g.c(2, k) < 12.5) ? wrap(k, i, j) : (i + k) % 7 === 0 ? 'woodDark' : 'wood'));
  g.disc(1.2, [0, 0], [3.1, 3.75], 'fit');
  g.pbox([-1.3, 1.3], [-1.3, 1.3], [15.6, 21.25], (i, j) => (Math.abs(i) === 2 && Math.abs(j) === 2 ? false : 'iron'));
  // The head: a block across x, its striking face (+x) broad and flat, the beak (-x) tapering.
  const z0 = 19.4, z1 = 25.6;
  g.pbox([-2.5, 5.6], [-2.5, 2.5], [z0, z1], (i, j, k) => {
    const x = g.c(0, i), y = g.c(1, j), z = g.c(2, k);
    const corner = Math.abs(y) > 1.9 && (z < z0 + 0.6 || z > z1 - 0.6);
    if (corner) return false;
    if (x > 4.9) return 'ironDark';
    const band = Math.abs(x - 1.25) < 0.4;
    if (band) return 'fit';
    if (glowing(rarity) && Math.abs(y) > 2.1 && Math.abs(x - 3.2) < 0.9 && Math.abs(z - (z0 + z1) / 2) < 1.6) return 'rune';
    return 'iron';
  });
  // The face's rim, the beak, the top spike.
  for (let k = 0; k < 9; k++) {
    const half = 2.2 * (1 - k / 9);
    g.pbox([-2.5 - (k + 1) * V, -2.5 - k * V], [-half * 0.6, half * 0.6 + 0.01], [22.5 - half * 0.8, 22.5 + half * 0.8], k > 6 ? 'trim' : 'ironDark');
  }
  g.disc(0.95, [0, 0], [z1, z1 + 1.9], 'ironDark');
  g.disc(0.5, [0, 0], [z1 + 1.9, z1 + 3.1], 'trim');
  // The rarity's gem on the head's flank.
  g.box([g.cell(0, 1.25), 4, g.cell(2, 22.5)], [g.cell(0, 1.25) + 1, 5, g.cell(2, 22.5) + 1], 'gem');
  g.box([g.cell(0, 1.25), -5, g.cell(2, 22.5)], [g.cell(0, 1.25) + 1, -4, g.cell(2, 22.5) + 1], 'gem');
  return g.mark('grip', [0, 0, 0]).mark('grip2', [0, 0, 10.6]).mark('muzzle', [5.6, 0, 22.5]);
}

/** The spear: an ash shaft, bronze bands, a long leaf-shaped head on a socket, a butt spike. */
function spear(rarity) {
  const g = model('spear', 'Spear', rarity, { wood: [0x8a6236, 0.68], woodDark: [0x6a4626, 0.72], leather: [0x4a2e18, 0.8], leatherDark: [0x2e1c0e, 0.85] });
  g.disc(0.5, [0, 0], [-7.5, -6.25], 'trim');
  g.disc(0.8, [0, 0], [-6.25, -4.4], 'fitDark');
  g.disc(0.7, [0, 0], [-4.4, 36.25], (i, j, k) => {
    const z = g.c(2, k);
    if ((z > -1.6 && z < 1.6) || (z > 12.4 && z < 15.6)) return wrap(k, i, j);
    if (Math.abs(z - 6.9) < 0.35 || Math.abs(z - 24.4) < 0.35) return 'fit';
    return (k + i * 3) % 9 === 0 ? 'woodDark' : 'wood';
  });
  // The socket, its ring, the head.
  g.disc(0.95, [0, 0], [34.4, 37.5], (i, j, k, rim) => (rim && k % 2 === 0 ? 'fitDark' : 'fit'));
  const tip = blade(g, 37.5, 15.6, (t) => (t < 0.08 ? 0.9 + t * 10 : 2.5 * Math.sin(Math.PI * clamp((t - 0.02) / 0.98) ** 0.75)), { rarity, runes: glowing(rarity), fuller: 0.75 });
  for (const j of [-2, 2]) g.set(0, j, g.cell(2, 36), 'gem');
  return g.mark('grip', [0, 0, 0]).mark('grip2', [0, 0, 14]).mark('muzzle', [0, 0, tip]);
}

/** The twin daggers (one of them: the other hand has its twin): a short broad blade, a ring pommel. */
function daggers(rarity) {
  const g = model('daggers', 'Twin Daggers', rarity, { leather: [0x2a1a10, 0.8], leatherDark: [0x161009, 0.85] });
  g.ball(1.0, [0, 0, -2.3], (i, j, k, d) => (d < 0.6 && glowing(rarity) ? 'gem' : 'fit'));
  g.disc(0.75, [0, 0], [-1.6, 1.9], (i, j, k) => wrap(k, i, j));
  // A small swept guard, its quillons curling forward.
  g.pbox([-1.9, 1.9], [-0.7, 0.7], [1.9, 2.6], (i) => (Math.abs(i) >= 3 ? 'fitDark' : 'fit'));
  g.pbox([-2.5, -1.85], [-0.4, 0.4], [2.5, 3.2], 'fitDark');
  g.pbox([1.85, 2.5], [-0.4, 0.4], [2.5, 3.2], 'fitDark');
  const tip = blade(g, 2.6, 9.4, (t) => 1.3 * Math.sqrt(Math.max(0, 1 - t ** 2.2)) + 0.15, { rarity, runes: glowing(rarity), fuller: 0.55 });
  return g.mark('grip', [0, 0, 0]).mark('muzzle', [0, 0, tip]);
}

/** The greatsword: a long two-handed hilt, a wide guard, a broad blade with a fuller and a ricasso. */
function greatsword(rarity) {
  const g = model('greatsword', 'Greatsword', rarity, { leather: [0x4a1e1a, 0.75], leatherDark: [0x2e100e, 0.8] });
  g.ball(1.6, [0, 0, -6.9], (i, j, k, d) => (d < 0.5 && glowing(rarity) ? 'gem' : 'fit'), [1, 1, 1.15]);
  g.disc(1.0, [0, 0], [-5.6, 5.0], (i, j, k) => wrap(k, i, j));
  g.disc(1.2, [0, 0], [-0.3, 0.3], 'fitDark');
  g.disc(1.2, [0, 0], [4.4, 5.0], 'fitDark');
  // The guard: long, its arms down-swept at the ends, a gem in the middle each side.
  g.pbox([-6.25, 6.25], [-1.0, 1.0], [5.0, 6.25], (i, j, k) => (Math.abs(g.c(0, i)) > 5.3 ? 'fitDark' : 'fit'));
  g.pbox([-6.9, -5.6], [-0.7, 0.7], [3.75, 5.0], 'fitDark');
  g.pbox([5.6, 6.9], [-0.7, 0.7], [3.75, 5.0], 'fitDark');
  for (const j of [-2, 2]) g.set(0, j, g.cell(2, 5.6), 'gem');
  // The ricasso (unsharpened, squared), then the blade.
  g.pbox([-1.6, 1.6], [-0.95, 0.95], [6.25, 8.1], 'steelDark');
  const tip = blade(g, 8.1, 30.6, (t) => (t < 0.82 ? 2.55 - 0.35 * t : 2.26 * Math.sqrt(Math.max(0, 1 - ((t - 0.82) / 0.18) ** 1.5))), { rarity, runes: glowing(rarity), fuller: 0.7 });
  return g.mark('grip', [0, 0, 0]).mark('grip2', [0, 0, 3.2]).mark('muzzle', [0, 0, tip]);
}

/** A staff's haft: gnarled wood (or pale ash), bands, a butt cap. */
function haft(g, z0, z1, wood) {
  g.disc(0.9, [0, 0], [z0, z1], (i, j, k) => {
    const z = g.c(2, k);
    if (z > -1.9 && z < 1.9) return wrap(k, i, j);
    return (k * 5 + i * 3 + j) % 11 === 0 ? `${wood}Dark` : wood;
  });
  g.disc(1.1, [0, 0], [z0 - 1.25, z0], 'fitDark');
  g.disc(1.15, [0, 0], [-2.5, -1.9], 'fit');
  g.disc(1.15, [0, 0], [1.9, 2.5], 'fit');
}

/** The fire staff: dark wood, an iron claw cradling a burning orb, embers in its prongs. */
function fireStaff(rarity) {
  const g = model('fire_staff', 'Fire Staff', rarity, {
    wood: [0x3e2414, 0.75], woodDark: [0x26140a, 0.8], leather: [0x5a1e10, 0.75], leatherDark: [0x3a1008, 0.8], iron: [0x2e2a2a, 0.4, 0.8],
    core: [0xfff2c0, 0.4, 0, 1], flame: [0xff7a10, 0.4, 0, 1], flameDeep: [0xc02a04, 0.5, 0, 1],
  });
  haft(g, -3.75, 29.4, 'wood');
  // Rings of the rarity's fittings up the haft, and its gem.
  for (const z of [16.9, 21.9]) g.disc(1.15, [0, 0], [z, z + 0.65], 'fit');
  g.disc(1.4, [0, 0], [27.5, 30.0], (i, j, k, rim) => (rim && (i + j + k) % 3 === 0 ? 'gem' : 'iron'));
  // The claw: four prongs curving up and in round the orb.
  const OZ = 33.4;
  for (const [sx, sy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const pts = [[1.3, 30.0], [2.9, 31.6], [3.1, 33.6], [2.2, 35.6], [1.1, 36.6]];
    for (let n = 1; n < pts.length; n++) g.rod([sx * pts[n - 1][0], sy * pts[n - 1][0], pts[n - 1][1]], [sx * pts[n][0], sy * pts[n][0], pts[n][1]], n === pts.length - 1 ? 'trim' : 'iron');
  }
  // The orb: white-hot at the heart, flame outside, deep red at the skin.
  g.ball(2.35, [0, 0, OZ], (i, j, k, d) => (d < 0.45 ? 'core' : d < 0.8 ? 'flame' : 'flameDeep'));
  return g.mark('grip', [0, 0, 0]).mark('muzzle', [0, 0, OZ]);
}

/** The frost staff: pale ash bound in silver, a cluster of ice crystals at its head. */
function frostStaff(rarity) {
  const g = model('frost_staff', 'Frost Staff', rarity, {
    ash: [0xc8c0b0, 0.65], ashDark: [0x9a9282, 0.7], leather: [0x2a3a4a, 0.75], leatherDark: [0x1a2632, 0.8],
    ice: [0x6ad0ff, 0.15, 0, 0.75], iceDeep: [0x1a7ad8, 0.2, 0, 0.9], iceCore: [0xe8fbff, 0.1, 0, 1],
  });
  haft(g, -3.75, 29.4, 'ash');
  for (const z of [16.9, 21.9]) g.disc(1.15, [0, 0], [z, z + 0.65], 'fit');
  g.disc(1.35, [0, 0], [27.5, 29.4], (i, j, k, rim) => (rim && (i + j + k) % 3 === 0 ? 'gem' : 'trim'));
  // Crystals: a tall one up the middle, four leaning out round it.
  const crystal = (base, dir, len, r) => {
    const n = Math.ceil(len / (V * 0.5));
    for (let s = 0; s <= n; s++) {
      const t = s / n;
      const p = [base[0] + dir[0] * len * t, base[1] + dir[1] * len * t, base[2] + dir[2] * len * t];
      const rr = r * (t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3);
      g.ball(Math.max(V * 0.5, rr), p, (i, j, k, d) => (t > 0.85 ? 'iceCore' : d < 0.5 ? 'ice' : 'iceDeep'));
    }
  };
  crystal([0, 0, 29.4], [0, 0, 1], 8.1, 1.25);
  for (const [x, y] of [[1, 0.3], [-1, -0.3], [0.3, -1], [-0.3, 1]]) {
    const l = Math.hypot(x, y, 2.6);
    crystal([x * 0.6, y * 0.6, 29.6], [x / l, y / l, 2.6 / l], 4.7, 0.8);
  }
  return g.mark('grip', [0, 0, 0]).mark('muzzle', [0, 0, 34.4]);
}

/** The storm wand: a short dark rod wound with copper, a crackling crystal at its tip. */
function stormWand(rarity) {
  const g = model('storm_wand', 'Storm Wand', rarity, {
    rod: [0x26262e, 0.35, 0.6], rodDark: [0x18181e, 0.4, 0.5], copper: [0xb8642a, 0.3, 1], leather: [0x2a2632, 0.8], leatherDark: [0x18161e, 0.85],
    spark: [0xd8c020, 0.2, 0, 1], sparkCore: [0xfffbe0, 0.1, 0, 1],
  });
  g.ball(1.0, [0, 0, -2.5], (i, j, k, d) => (d < 0.6 && glowing(rarity) ? 'gem' : 'fit'));
  g.disc(0.75, [0, 0], [-1.9, 1.9], (i, j, k) => wrap(k, i, j));
  g.disc(1.0, [0, 0], [1.9, 2.5], 'fit');
  // The rod, a copper coil wound up it.
  g.disc(0.6, [0, 0], [2.5, 13.1], (i, j, k) => ((k + (i + 1) * 2 + (j + 1)) % 5 === 0 ? 'rodDark' : 'rod'));
  for (let k = g.cell(2, 4.4); k < g.cell(2, 11.9); k++) {
    const a = (k * Math.PI) / 3;
    g.set(Math.round(Math.cos(a) * 1.4), Math.round(Math.sin(a) * 1.4), k, 'copper');
  }
  // The prongs and the crystal: yellow-white light.
  g.disc(1.15, [0, 0], [13.1, 13.75], 'fit');
  for (const [sx, sy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) g.rod([sx * 0.9, sy * 0.9, 13.75], [sx * 1.3, sy * 1.3, 16.2], 'copper');
  g.ball(1.25, [0, 0, 16.2], (i, j, k, d) => (d < 0.55 ? 'sparkCore' : 'spark'), [1, 1, 1.5]);
  return g.mark('grip', [0, 0, 0]).mark('muzzle', [0, 0, 16.2]);
}

/**
 * The crossbow, built like a gun: a wooden stock (a butt, a pistol grip, the tiller running
 * forward), a steel prod across the front, the string drawn back to the nut, the groove empty (the
 * bolt is shown in it apart, only while it's spanned), a rear sight.
 */
function crossbow(rarity) {
  const g = model('crossbow', 'Crossbow', rarity, {
    wood: [0x6a4426, 0.68], woodDark: [0x4a2e18, 0.72], woodLight: [0x8a5e36, 0.66], iron: [0x3a3e44, 0.35, 0.9],
    string: [0xd8ccb0, 0.8], shaft: [0xb08a5a, 0.7], fletch: [0xe8e2d4, 0.8], head: [0xc8ced6, 0.2, 1],
  }, { offset: [-0.5, 0, 0] });
  // The tiller: the groove along its top, from the butt to the prod.
  g.pbox([-1.25, 1.26], [0.6, 2.5], [-3.1, 15.0], (i, j, k) => (i === 0 && g.c(1, j) > 1.9 && g.c(2, k) > 0.6 ? false : (k % 6 === 0 ? 'woodDark' : 'wood')));
  g.pbox([-0.65, 0.66], [0.6, 1.9], [15.0, 16.25], 'iron');
  // The butt: dropping back to a broad stock, an iron butt plate.
  for (let k = g.cell(2, -12.5); k < g.cell(2, -3.1); k++) {
    const z = g.c(2, k);
    const t = (z + 12.5) / 9.4;
    const top = 2.5 - (1 - t) * 0.6, bottom = -2.5 + t * 2.4;
    const half = 1.6 - t * 0.3;
    g.pbox([-half, half + 0.01], [bottom, top], [g.b(2, k), g.b(2, k + 1)], (i, j) => (z < -11.9 ? 'iron' : j % 4 === 0 ? 'woodDark' : 'woodLight'));
  }
  // The pistol grip, raked back, and the trigger lever under the tiller.
  for (let j = g.cell(1, -3.1); j < g.cell(1, 0.6); j++) {
    const y = g.c(1, j);
    const z = -1.0 + y * 0.35;
    g.pbox([-0.95, 0.96], [g.b(1, j), g.b(1, j + 1)], [z - 1.0, z + 1.0], 'wood');
  }
  g.pbox([-0.3, 0.31], [-1.9, 0.6], [1.6, 2.2], 'iron');
  g.pbox([-0.3, 0.31], [-1.9, -1.3], [2.2, 3.75], 'iron');
  // The fittings: an iron strap round the tiller, the rarity's metal at the nut.
  g.pbox([-1.3, 1.31], [0.55, 2.55], [8.1, 8.75], 'fitDark');
  g.pbox([-1.3, 1.31], [0.55, 2.6], [1.25, 2.5], 'fit');
  g.box([g.cell(0, 1.3), g.cell(1, 1.6), g.cell(2, 5.0)], [g.cell(0, 1.3) + 1, g.cell(1, 1.6) + 1, g.cell(2, 5.0) + 2], 'gem');
  g.box([g.cell(0, -1.3) - 1, g.cell(1, 1.6), g.cell(2, 5.0)], [g.cell(0, -1.3), g.cell(1, 1.6) + 1, g.cell(2, 5.0) + 2], 'gem');
  // The prod: steel limbs sweeping out and back from the front, the tips in the rarity's trim.
  const limb = (side) => {
    for (let n = 0; n <= 28; n++) {
      const t = n / 28;
      const x = side * (1.0 + 9.4 * t);
      const z = 15.0 - 3.3 * t * t;
      g.pbox([x - 0.31, x + 0.32], [1.25, 1.9], [z - 0.31, z + 0.32], t > 0.92 ? 'trim' : 'steel');
      if (t < 0.5) g.pbox([x - 0.31, x + 0.32], [1.9, 2.5], [z - 0.31, z + 0.32], 'steelDark');
    }
    // The string from the tip back to the nut.
    g.rod([side * 10.4, 1.6, 11.7], [side * 0.6, 1.6, 2.0], 'string');
  };
  limb(1);
  limb(-1);
  // (The bolt in the groove is drawn on its own, while it's spanned: `client/armory.ts`.)
  // The rear sight: a notched iron post over the grip.
  g.pbox([-0.95, 0.96], [2.5, 3.75], [-1.9, -1.25], (i, j) => (i === 0 && g.c(1, j) > 3.1 ? false : 'iron'));
  return g.mark('grip', [0, 0, 0]).mark('grip2', [0, 0.3, 9.4]).mark('muzzle', [0, 2.2, 17.5]).mark('sight', [0, 3.4, -1.6]).mark('mag', [0, 2.2, 3.1]);
}

/** The blade materials of the plain swords: wood, stone, iron, diamond. */
const SWORD_BLADES = {
  wooden_sword: { steel: [0x8a6236, 0.75], steelDark: [0x6a4626, 0.78], edge: [0xa47a48, 0.7] },
  stone_sword: { steel: [0x7c7c7a, 0.85], steelDark: [0x5a5a58, 0.88], edge: [0x9c9c98, 0.8] },
  iron_sword: { steel: [0x8e959e, 0.3, 1], steelDark: [0x565c66, 0.36, 1], edge: [0xc6ccd4, 0.2, 1] },
  diamond_sword: { steel: [0x34c6be, 0.15, 0.2, 0.08], steelDark: [0x1a8a86, 0.2, 0.2, 0.05], edge: [0xa4f6ee, 0.1, 0.2, 0.18] },
};

/**
 * A plain broadsword (the starters, and the diamond sword in its rarities): a round pommel, a
 * leather grip, a straight guard, a blade of wood, stone, iron or diamond with a fuller.
 */
function broadsword(id, name, rarity = 'common') {
  const g = model(id, name, rarity, { leather: [0x4a2e18, 0.8], leatherDark: [0x2e1c0e, 0.85], ...SWORD_BLADES[id] });
  const wood = id === 'wooden_sword';
  if (wood) g.colours({ fit: [0x5a3a1e, 0.8], fitDark: [0x40280f, 0.85] });
  g.ball(1.2, [0, 0, -2.5], (i, j, k, d) => (d < 0.5 && glowing(rarity) ? 'gem' : 'fit'));
  g.disc(0.8, [0, 0], [-1.6, 2.2], (i, j, k) => wrap(k, i, j));
  g.pbox([-3.1, 3.1], [-0.95, 0.95], [2.2, 3.4], (i) => (Math.abs(g.c(0, i)) > 2.4 ? 'fitDark' : 'fit'));
  for (const j of [-2, 2]) g.set(0, j, g.cell(2, 2.8), glowing(rarity) ? 'gem' : 'fitDark');
  const tip = blade(g, 3.4, 17.5, (t) => (t < 0.8 ? 1.6 : 1.6 * Math.sqrt(Math.max(0, 1 - ((t - 0.8) / 0.2) ** 1.3))), { rarity, runes: glowing(rarity), fuller: 0.72, thick: wood ? 1 : 3 });
  return g.mark('grip', [0, 0, 0]).mark('grip2', [0, 0, -1.5]).mark('muzzle', [0, 0, tip]);
}

/** The battle axe: an ash haft, a double bit flaring from an iron socket, the rarity's fittings. */
function battleAxe(rarity) {
  const g = model('battle_axe', 'Battle Axe', rarity, { wood: [0x6a4626, 0.72], woodDark: [0x4a2e18, 0.76], leather: [0x3a2414, 0.8], leatherDark: [0x24160b, 0.85], iron: [0x3e424a, 0.35, 0.9] });
  g.disc(1.0, [0, 0], [-3.4, -2.2], 'fitDark');
  g.disc(0.8, [0, 0], [-2.2, 21.0], (i, j, k) => (g.c(2, k) < 3.4 ? wrap(k, i, j) : (i + k * 3) % 8 === 0 ? 'woodDark' : 'wood'));
  g.pbox([-1.3, 1.3], [-1.3, 1.3], [14.4, 21.6], (i, j, k) => (Math.abs(g.c(2, k) - 15.0) < 0.35 || Math.abs(g.c(2, k) - 21.0) < 0.35 ? 'fit' : 'iron'));
  // Each bit: out along x from the socket, flaring from a narrow neck to a broad curved edge.
  for (const side of [1, -1])
    for (let k = g.cell(2, 11.0); k < g.cell(2, 25.0); k++)
      for (let i = 0; i < 16; i++) {
        const u = 1.3 + i * V;
        const t = g.c(2, k) - 18.0;
        const hw = Math.min(5.8, 1.1 + 0.6 * (u - 1.3));
        const edge = 7.4 + 1.3 * Math.sqrt(Math.max(0, 1 - (t / 6.2) ** 2));
        if (Math.abs(t) > hw || u > edge) continue;
        const near = edge - u < 1.2;
        const x = side > 0 ? g.cell(0, u) : g.cell(0, -u);
        for (const j of near ? [0] : [-1, 0, 1]) g.set(x, j, k, near ? 'edge' : u < 2.4 ? 'steelDark' : glowing(rarity) && Math.abs(t) < 0.4 && u > 3 && u < 6 ? 'rune' : 'steel');
      }
  return g.mark('grip', [0, 0, 0]).mark('grip2', [0, 0, 9.0]).mark('muzzle', [8.4, 0, 18.0]);
}

/** The pike: a long ash shaft wrapped for two hands, a long narrow head on a socket, a butt cap. */
function pike(rarity) {
  const g = model('pike', 'Pike', rarity, { wood: [0x8e6a3e, 0.68], woodDark: [0x6e4e2a, 0.72], leather: [0x4a2e18, 0.8], leatherDark: [0x2e1c0e, 0.85] });
  g.disc(0.9, [0, 0], [-6.9, -5.6], 'fitDark');
  g.disc(0.7, [0, 0], [-5.6, 40.0], (i, j, k) => {
    const z = g.c(2, k);
    if ((z > -1.9 && z < 1.9) || (z > 12.1 && z < 15.9)) return wrap(k, i, j);
    return (k + i * 3) % 9 === 0 ? 'woodDark' : 'wood';
  });
  g.disc(0.95, [0, 0], [38.1, 41.2], (i, j, k, rim) => (rim && k % 2 === 0 ? 'fitDark' : 'fit'));
  const tip = blade(g, 41.2, 13.8, (t) => 1.55 * Math.sin(Math.PI * clamp(t) ** 0.6) + 0.2, { rarity, runes: glowing(rarity), fuller: 0.7 });
  for (const j of [-2, 2]) g.set(0, j, g.cell(2, 39.6), 'gem');
  return g.mark('grip', [0, 0, 0]).mark('grip2', [0, 0, 14]).mark('muzzle', [0, 0, tip]);
}

/** The health potion: a round bottle of glowing red brew, a long neck, a cork. Upright along +z. */
function potion() {
  const g = new Model('health_potion', 'Health Potion').colours({
    brew: [0xc8102a, 0.2, 0, 0.55], brewDeep: [0x8a0818, 0.25, 0, 0.4], glass: [0xcfe6f0, 0.08, 0.1], glassDark: [0x9ab8c6, 0.1, 0.1], cork: [0x9a6e3e, 0.8], label: [0xe8dcc0, 0.8], seal: [0x8a1a18, 0.6],
  });
  g.ball(3.1, [0, 0, 2.9], (i, j, k, d) => {
    const z = g.c(2, k);
    if (z > 3.6) return d > 0.82 ? 'glass' : 'glassDark';
    if (Math.abs(z - 2.2) < 0.9 && g.c(0, i) > 1.2 && Math.abs(g.c(1, j)) < 1.4) return 'label';
    return d > 0.85 ? 'brew' : 'brewDeep';
  });
  g.disc(1.0, [0, 0], [5.6, 8.1], (i, j, k, rim) => (rim ? 'glass' : 'glassDark'));
  g.disc(1.3, [0, 0], [7.5, 8.1], 'glass');
  g.disc(0.75, [0, 0], [8.1, 9.6], 'cork');
  g.disc(0.95, [0, 0], [8.1, 8.75], 'seal');
  return g.mark('grip', [0, 0, -1.4]).mark('muzzle', [0, 0, 9.6]);
}

/**
 * The bow, in each rarity, as the bow's sprite is drawn (a 16 px square lying in x-y, centred: the
 * first-person bow pose places a bow by its sprite's pixels): the limb an arc through the tips at
 * (1, 2) and (13, 14) and the grip at (11.5, 4.5), sprite pixels from the top left; the string
 * straight between the tips, or (`drawn`) pulled back to the nock at (4.5, 11.5) with an arrow
 * along it, its head at the top right. Wood and leather, the rarity's fittings at the grip and
 * tips; the Sunbow, the legendary, is gilt and burns.
 */
function bow(rarity, drawn) {
  const legend = rarity === 'legendary';
  const g = model(drawn ? 'bow_drawn' : 'bow', 'Bow', rarity, {
    wood: legend ? [0xc8902a, 0.3, 0.8] : rarity === 'epic' ? [0x2e2630, 0.6] : [0x8a5e30, 0.68],
    woodDark: legend ? [0x8e5c12, 0.32, 0.8] : rarity === 'epic' ? [0x1c171e, 0.65] : [0x5e3e1c, 0.72],
    woodLight: legend ? [0xf2c25a, 0.25, 0.9, 0.25] : rarity === 'epic' ? [0x4a4052, 0.55] : [0xa47a45, 0.65],
    leather: [0x6b3a22, 0.75], leatherDark: [0x4a2616, 0.8], string: [0xe8e2d0, 0.8], shaft: [0x9a7446, 0.7], flint: [0xb8bec6, 0.25, 0.9], fletch: [0xf4f2ec, 0.8],
  }, { offset: [-0.5, -0.5, -0.5] });
  /** Sprite pixels (from the top left) to the model's px (centred, y up). */
  const P = (sx, sy) => [sx - 8, 8 - sy];
  const [cx, cy, R] = [5, 11, 9.19];
  for (let j = -14; j <= 14; j++)
    for (let i = -14; i <= 14; i++) {
      const sx = g.c(0, i) + 8, sy = 8 - g.c(1, j);
      if (sx - sy < -1) continue;
      const along = Math.min(1.2, Math.abs(sx + sy - 16) / 12);
      const off = Math.hypot(sx - cx, sy - cy) - R;
      const thick = 2.0 - 1.0 * along;
      if (off > 0.6 || off < -thick || along > 1.02) continue;
      const grip = along < 0.16;
      const tip = along > 0.9;
      const half = grip ? 2 : along < 0.6 ? 1 : 0;
      for (let k = -half; k <= half; k++) {
        const c = grip ? wrap(j, i, k) : tip ? 'trim' : off > -0.5 ? 'woodLight' : off > -1.2 ? 'wood' : 'woodDark';
        g.set(i, j, k, c);
      }
    }
  // The rarity's gem in the grip, a band each side of it.
  const [gx, gy] = P(11.6, 4.4);
  g.set(g.cell(0, gx), g.cell(1, gy), 2, 'gem');
  g.set(g.cell(0, gx), g.cell(1, gy), -2, 'gem');
  for (const a of [0.2, -0.2]) {
    const ang = Math.atan2(4.5 - cy, 11.5 - cx) + a;
    const [bx, by] = P(cx + Math.cos(ang) * (R - 0.6), cy + Math.sin(ang) * (R - 0.6));
    g.pbox([bx - 0.7, bx + 0.7], [by - 0.7, by + 0.7], [-0.95, 0.95], 'fit');
  }
  // The string: straight between the tips, or back to the nock with an arrow on it.
  const t1 = [...P(1.6, 2.4), 0], t2 = [...P(13.6, 14.4), 0];
  if (!drawn) g.rod(t1, t2, 'string');
  else {
    const nock = [...P(4.5, 11.5), 0];
    g.rod(t1, nock, 'string');
    g.rod(nock, t2, 'string');
    const head = [...P(13.6, 2.4), 0];
    g.rod(nock, head, 'shaft');
    // The flint head, and the fletching by the nock.
    for (let n = 0; n < 4; n++) {
      const t = n / 4;
      const p = [head[0] - t * 1.6, head[1] + t * 1.6];
      g.pbox([p[0] - 0.5 * (1 - t), p[0] + 0.5 * (1 - t) + 0.01], [p[1] - 0.5 * (1 - t), p[1] + 0.5 * (1 - t) + 0.01], [-0.6 * (1 - t), 0.6 * (1 - t) + 0.01], 'flint');
    }
    for (let n = 1; n < 4; n++) {
      const p = [nock[0] + n * 0.7, nock[1] - n * 0.7];
      g.set(g.cell(0, p[0]), g.cell(1, p[1]), 1, 'fletch');
      g.set(g.cell(0, p[0]), g.cell(1, p[1]), -1, 'fletch');
    }
  }
  const [hx, hy] = P(11.5, 4.5);
  return g.mark('grip', [hx, hy, 0]).mark('muzzle', [...P(13.6, 2.4), 0]);
}

/** A crossbow bolt (in flight, and spanned in the crossbow's groove): a short shaft, a steel head, fletching. */
function bolt() {
  const g = new Model('bolt', 'Bolt').colours({ shaft: [0xb08a5a, 0.7], fletch: [0xe8e2d4, 0.8], fletchRed: [0xa8241c, 0.8], head: [0xc8ced6, 0.2, 1] });
  g.pbox([-0.3, 0.31], [-0.3, 0.31], [-7.5, 2.5], 'shaft');
  for (const [x, y] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) g.pbox([x * 0.6 - 0.3, x * 0.6 + 0.31], [y * 0.6 - 0.3, y * 0.6 + 0.31], [-7.5, -5.0], x === 0 && y === 1 ? 'fletchRed' : 'fletch');
  g.pbox([-0.6, 0.61], [-0.6, 0.61], [2.5, 3.75], 'head');
  g.pbox([-0.3, 0.31], [-0.3, 0.31], [3.75, 4.4], 'head');
  return g.mark('grip', [0, 0, 0]).mark('muzzle', [0, 0, 4.4]);
}

/**
 * Armour, a cuirass on its own (for the shop and the ground): leather stitched and buckled, mail in
 * rings, plate with a ridge and gilt edges. It stands up along +y, its front toward +z.
 */
function armor(id, name, look) {
  const own = {
    leather_armor: { a: [0x7a4e2a, 0.7], b: [0x5a3820, 0.75], c: [0x3a2414, 0.8], d: [0xb08850, 0.5, 0.6] },
    mail_armor: { a: [0x8a9098, 0.42, 0.9], b: [0x5e646c, 0.5, 0.85], c: [0x4a3020, 0.8], d: [0xa8adb4, 0.35, 1] },
    plate_armor: { a: [0xc4cad2, 0.2, 1], b: [0x8e959e, 0.26, 1], c: [0x4a3020, 0.8], d: [0xd8a22c, 0.22, 1] },
  }[id];
  const g = new Model(id, name, { offset: [-0.5, 0, -0.5] }).colours(own);
  for (let j = 0; j < 19; j++)
    for (let i = -9; i <= 9; i++)
      for (let k = -5; k <= 5; k++) {
        const x = g.c(0, i), y = g.c(1, j), z = g.c(2, k);
        // The torso: broad at the chest, in at the waist, rounded front and back.
        const half = y > 7.5 ? 5.4 : 4.4 + (y / 7.5) * 1.0;
        const depth = 3.0 - 0.9 * (Math.abs(x) / half) ** 2 + (y > 6 && y < 10.5 && z > 0 ? 0.4 : 0);
        if (Math.abs(x) > half || Math.abs(z) > depth) continue;
        // The neck, cut out at the top.
        if (y > 10.2 && Math.abs(x) < 2.2) continue;
        const shell = Math.abs(z) > depth - V * 1.1 || Math.abs(x) > half - V * 1.1 || y < V || y > 11;
        if (!shell) continue;
        let c = 'a';
        if (look === 'leather') c = Math.abs(x) < V * 0.6 && z > 0 ? 'c' : (Math.abs(y - 5.3) < 0.35 || Math.abs(y - 8.6) < 0.35) ? 'b' : 'a';
        if (look === 'mail') c = (i + j) % 2 === 0 ? 'a' : 'b';
        if (look === 'plate') c = Math.abs(x) < V * 0.6 && z > 0 ? 'd' : y > 10.6 || Math.abs(x) > half - V * 0.9 ? 'd' : z < 0 ? 'b' : 'a';
        if (y < 1.9) c = look === 'plate' ? 'b' : 'c';
        g.set(i, j, k, c);
      }
  // The belt's buckle, the shoulder pieces.
  g.pbox([-0.95, 0.95], [0.3, 1.6], [2.8, 3.4], 'd');
  for (const sx of [-1, 1]) g.pbox(sx > 0 ? [3.1, 6.6] : [-6.6, -3.1], [10.0, 11.9], [-2.6, 2.6], look === 'plate' ? 'a' : 'b');
  return g.mark('grip', [0, 6, 0]).mark('muzzle', [0, 12, 0]);
}

// ---------------------------------------------------------------------------------------------
// Writing and checking

/**
 * A model as a GLB. `with`: another model whose faces share its atlas (the bow drawn and at rest:
 * the first-person view swaps one's geometry for the other's and keeps the first one's textures,
 * so both must read one atlas).
 */
function glb(g, withModel) {
  const { faces: list, before } = faces(g.vox, g.P, { merge: true });
  const other = withModel ? faces(withModel.vox, withModel.P, { merge: true }).faces : [];
  const A = atlas([...list, ...other], g.P);
  const pos = [], nor = [], uv = [], idx = [];
  list.forEach((f, fi) => {
    const base = pos.length / 3;
    const n = DIRS[f.dir].n;
    quadCorners(f).forEach((c, ci) => {
      pos.push(...c.map((v, a) => ((v + g.offset[a]) * V) / 16));
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
    generator: 'Arena src/games/arena/tools/weapons/build.mjs',
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
    compress: true,
  });
  return { bytes, stats: { voxels: g.vox.count, faces: before, quads: list.length, tiles: A.tiles, atlas: `${A.width}x${A.height}` }, pos };
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
  if (!g.markers.grip || !g.markers.muzzle) fail('no grip or muzzle');
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
  return { tris: I.length / 3 };
}

/** The model's voxels in letters: side on from +x, from behind (-z) and from above. */
function show(g) {
  const names = [...g.P.colours.keys()];
  const ch = (c) => (c ? 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'[names.indexOf(c)] : '.');
  const cells = g.cells();
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
      for (let x = lo[u]; x <= hi[u]; x++) row += grid.has(`${x},${y}`) ? ch(grid.get(`${x},${y}`)[3]) : '.';
      console.log(row);
    }
  };
  console.log(`  colours: ${names.map((n) => `${ch(n)} ${n}`).join(', ')}`);
  view(2, 0, 1, true, 'above (z across, x up), from +y');
  view(2, 1, 0, true, 'side (z across, y up), from +x');
  view(0, 1, 2, false, 'behind (x across, y up), from -z');
}

const MODELS = {
  gladius, gladius_shield: shield, warhammer, spear, daggers, greatsword, fire_staff: fireStaff, frost_staff: frostStaff, storm_wand: stormWand, crossbow,
  battle_axe: battleAxe, pike, diamond_sword: (r) => broadsword('diamond_sword', 'Diamond Sword', r),
  bow: (r) => bow(r, false), bow_drawn: (r) => bow(r, true),
};
const args = process.argv.slice(2);
const only = args.filter((a) => !a.startsWith('--'));
mkdirSync(OUT, { recursive: true });
const jobs = [
  ...Object.entries(MODELS).flatMap(([id, make]) => RARITIES.map((r) => [id, () => make(r)])),
  ['bolt', bolt],
  ['leather_armor', () => armor('leather_armor', 'Leather Armour', 'leather')],
  ['mail_armor', () => armor('mail_armor', 'Mail Armour', 'mail')],
  ['plate_armor', () => armor('plate_armor', 'Plate Armour', 'plate')],
  ['wooden_sword', () => broadsword('wooden_sword', 'Wooden Sword')],
  ['stone_sword', () => broadsword('stone_sword', 'Stone Sword')],
  ['iron_sword', () => broadsword('iron_sword', 'Iron Sword')],
  ['health_potion', potion],
];
const SINGLE = new Set(['bolt', 'leather_armor', 'mail_armor', 'plate_armor', 'wooden_sword', 'stone_sword', 'iron_sword', 'health_potion']);
let total = 0;
/** A model's rarity, from its id (`bow_drawn_epic`). */
const rarityOfId = (id) => RARITIES.find((r) => r !== 'common' && id.endsWith(`_${r}`)) ?? 'common';
/** Models drawn as one another's other look (their GLBs share one atlas): the bow and the bow drawn. */
const PAIRED = { bow: 'bow_drawn', bow_drawn: 'bow' };
for (const [id, make] of jobs) {
  if (only.length && !only.includes(id)) continue;
  const g = make();
  const twin = PAIRED[id] && Object.entries(MODELS).find(([k]) => k === PAIRED[id])?.[1](rarityOfId(g.id));
  const { bytes, stats, pos } = glb(g, twin);
  const file = join(OUT, `${g.id}.glb`);
  writeFileSync(file, bytes);
  total += bytes.length;
  if (args.includes('--show') && g.id === id) show(g);
  const v = validate(readFileSync(file), g);
  const lo = [0, 1, 2].map((k) => Math.min(...pos.filter((_, m) => m % 3 === k)) * 16);
  const hi = [0, 1, 2].map((k) => Math.max(...pos.filter((_, m) => m % 3 === k)) * 16);
  const size = hi.map((x, k) => +(x - lo[k]).toFixed(2));
  console.log(`${g.id}.glb  ${g.name}: ${stats.voxels} voxels as ${stats.quads} quads, ${v.tris} tris, ${stats.tiles} tiles, ${(bytes.length / 1024).toFixed(1)} KB; ${size.join(' x ')} px`);
}
console.log(`${(total / 1024).toFixed(0)} KB in all`);

// The models' addresses, for the screens' looks and the server's props (`models/weapons/index.ts`).
if (!only.length) {
  const ids = jobs.map(([id]) => id).filter((id, n, all) => all.indexOf(id) === n).flatMap((id) => (SINGLE.has(id) ? [id] : RARITIES.map((r) => (r === 'common' ? id : `${id}_${r}`))));
  const name = (id) => id.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
  const lines = [
    '// Written by src/games/arena/tools/weapons/build.mjs: the arsenal\'s models, by item id (a rarity\'s own: `gladius_epic`).',
    ...ids.map((id) => `import ${name(id)} from './${id}.glb?url';`),
    '',
    'export const WEAPON_MODELS: Record<string, string> = {',
    ...ids.map((id) => `  ${id}: ${name(id)},`),
    '};',
    '',
  ];
  writeFileSync(join(OUT, 'index.ts'), lines.join('\n'));
}
