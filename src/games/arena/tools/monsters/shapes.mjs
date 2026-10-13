/**
 * Shapes to paint monsters with, in voxels (a cell's centre is (i + 0.5, j + 0.5, k + 0.5)):
 * balls, capsules along a segment, boxes, each filling the cells whose centres are inside with a
 * colour (or a function of the cell giving one).
 */

const C = (i) => i + 0.5;
const paintOf = (colour) => (typeof colour === 'function' ? colour : () => colour);

/** An ellipsoid about `c` with radii `r` ([x, y, z], or one number). */
export function ball(vox, part, c, r, colour, keep = null) {
  const [rx, ry, rz] = typeof r === 'number' ? [r, r, r] : r;
  const f = paintOf(colour);
  vox.paint(part, [Math.floor(c[0] - rx), Math.floor(c[1] - ry), Math.floor(c[2] - rz)], [Math.ceil(c[0] + rx), Math.ceil(c[1] + ry), Math.ceil(c[2] + rz)], (i, j, k) => {
    const d = ((C(i) - c[0]) / rx) ** 2 + ((C(j) - c[1]) / ry) ** 2 + ((C(k) - c[2]) / rz) ** 2;
    if (d > 1 || (keep && !keep(C(i), C(j), C(k)))) return;
    return f(i, j, k, d);
  });
}

/** A capsule from `a` to `b`, its radius `r0` at `a` going to `r1` at `b`. */
export function capsule(vox, part, a, b, r0, r1 = r0, colour, keep = null) {
  const f = paintOf(colour);
  const r = Math.max(r0, r1);
  const lo = [0, 1, 2].map((x) => Math.floor(Math.min(a[x], b[x]) - r));
  const hi = [0, 1, 2].map((x) => Math.ceil(Math.max(a[x], b[x]) + r));
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const l2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2 || 1;
  vox.paint(part, lo, hi, (i, j, k) => {
    const p = [C(i), C(j), C(k)];
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1] + (p[2] - a[2]) * ab[2]) / l2));
    const q = [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t];
    const rr = r0 + (r1 - r0) * t;
    if ((p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2 > rr * rr) return;
    if (keep && !keep(p[0], p[1], p[2])) return;
    return f(i, j, k, t);
  });
}

/** A box of cells, lo inclusive, hi exclusive (cell indices). */
export function box(vox, part, lo, hi, colour) {
  const f = paintOf(colour);
  vox.paint(part, lo, hi, (i, j, k) => f(i, j, k));
}

/** A deterministic hash of a cell, 0..1 (for speckles, fur and cracks). */
export function hash(i, j, k, salt = 0) {
  let h = Math.imul((i * 73856093) ^ (j * 19349663) ^ (k * 83492791) ^ Math.imul(salt, 2654435761), 0x9e3779b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

/** Mirror a part's cells across x (a left limb from a right one), into `to`. */
export function mirror(vox, from, to) {
  const src = vox.parts.get(from);
  if (!src) return;
  for (const [key, c] of src) {
    const i = (key % 1024) - 512;
    const j = (Math.floor(key / 1024) % 1024) - 512;
    const k = Math.floor(key / 1048576) - 512;
    vox.set(to, -1 - i, j, k, c);
  }
}

/**
 * Drop a part's cells buried in another's (the cell and its six neighbours all the other's): a
 * limb's root inside a body shows nothing, and its faces there would only be hidden ones.
 */
export function bury(vox, part, into) {
  const p = vox.parts.get(part);
  const q = vox.parts.get(into);
  if (!p || !q) return;
  for (const key of [...p.keys()]) {
    const i = (key % 1024) - 512;
    const j = (Math.floor(key / 1024) % 1024) - 512;
    const k = Math.floor(key / 1048576) - 512;
    if ([[0, 0, 0], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].every(([a, b, c]) => vox.filled(i + a, j + b, k + c, into))) p.delete(key);
  }
}
