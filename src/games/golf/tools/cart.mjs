/**
 * The golf cart's models: a low-poly cart (white body, seat, canopy on four posts, round wheels, a
 * bag of clubs on the back), one file per canopy colour. In blocks: 1.5 wide, 2.7 long, 2.1 tall,
 * its origin the middle of its underside, its front toward -z. Written to `models/cart_<colour>.glb`.
 *
 *   node src/games/golf/tools/cart.mjs
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { png, writeGlb } from './voxel.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

export const CANOPIES = {
  green: [52, 150, 72],
  blue: [44, 96, 196],
  red: [200, 52, 44],
  yellow: [232, 190, 48],
  purple: [128, 72, 180],
  orange: [230, 128, 40],
  cyan: [40, 170, 184],
  black: [40, 42, 46],
};

const COLOURS = ['body', 'trim', 'seat', 'tyre', 'hub', 'post', 'canopy', 'bag', 'club', 'dash', 'light'];

function cart(canopy) {
  const palette = {
    body: [236, 236, 230],
    trim: [196, 198, 200],
    seat: [150, 112, 74],
    tyre: [30, 30, 32],
    hub: [170, 172, 176],
    post: [210, 212, 214],
    canopy,
    bag: [180, 40, 36],
    club: [200, 204, 210],
    dash: [60, 62, 66],
    light: [255, 244, 200],
  };
  const pos = [];
  const nor = [];
  const uv = [];
  const idx = [];
  const texU = (name) => (COLOURS.indexOf(name) + 0.5) / COLOURS.length;
  const quad = (a, b, c, d, n, col) => {
    const base = pos.length / 3;
    for (const p of [a, b, c, d]) {
      pos.push(...p);
      nor.push(...n);
      uv.push(Math.round(texU(col) * 65535), 32768);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  const tri = (a, b, c, col) => {
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const l = Math.hypot(...n) || 1;
    const base = pos.length / 3;
    for (const p of [a, b, c]) {
      pos.push(...p);
      nor.push(n[0] / l, n[1] / l, n[2] / l);
      uv.push(Math.round(texU(col) * 65535), 32768);
    }
    idx.push(base, base + 1, base + 2);
  };
  /** A box, its faces outward; `chamfer` bevels its top edges in. */
  const box = (x0, y0, z0, x1, y1, z1, col, chamfer = 0) => {
    const c = chamfer;
    const t = [
      [x0 + c, y1, z0 + c],
      [x1 - c, y1, z0 + c],
      [x1 - c, y1, z1 - c],
      [x0 + c, y1, z1 - c],
    ];
    const m = [
      [x0, y1 - c, z0],
      [x1, y1 - c, z0],
      [x1, y1 - c, z1],
      [x0, y1 - c, z1],
    ];
    const b = [
      [x0, y0, z0],
      [x1, y0, z0],
      [x1, y0, z1],
      [x0, y0, z1],
    ];
    quad(t[0], t[3], t[2], t[1], [0, 1, 0], col);
    quad(b[0], b[1], b[2], b[3], [0, -1, 0], col);
    // Sides: -z, +x, +z, -x.
    const sides = [
      [0, 1, [0, 0, -1]],
      [1, 2, [1, 0, 0]],
      [2, 3, [0, 0, 1]],
      [3, 0, [-1, 0, 0]],
    ];
    for (const [i, j, n] of sides) {
      quad(b[i], m[i], m[j], b[j], n, col);
      if (c > 0) tri(m[i], t[i], t[j], col), tri(m[i], t[j], m[j], col);
    }
  };
  /** A cylinder along x (a wheel), faces outward. */
  const wheel = (cx, cy, cz, r, w, sides = 14) => {
    const ring = (x) => Array.from({ length: sides }, (_, k) => [x, cy + Math.cos((k / sides) * Math.PI * 2) * r, cz + Math.sin((k / sides) * Math.PI * 2) * r]);
    const a = ring(cx - w / 2);
    const b = ring(cx + w / 2);
    for (let k = 0; k < sides; k++) {
      const k1 = (k + 1) % sides;
      const ang = ((k + 0.5) / sides) * Math.PI * 2;
      quad(a[k], a[k1], b[k1], b[k], [0, Math.cos(ang), Math.sin(ang)], 'tyre');
      tri([cx + w / 2, cy, cz], b[k], b[k1], 'hub');
      tri([cx - w / 2, cy, cz], a[k1], a[k], 'hub');
    }
  };
  /** An upright cylinder (the bag), faces outward. */
  const can = (cx, y0, cz, r, h, col, sides = 10) => {
    for (let k = 0; k < sides; k++) {
      const a0 = (k / sides) * Math.PI * 2;
      const a1 = ((k + 1) / sides) * Math.PI * 2;
      const p0 = [cx + Math.cos(a0) * r, y0, cz + Math.sin(a0) * r];
      const p1 = [cx + Math.cos(a1) * r, y0, cz + Math.sin(a1) * r];
      const q0 = [p0[0], y0 + h, p0[2]];
      const q1 = [p1[0], y0 + h, p1[2]];
      const am = (a0 + a1) / 2;
      quad(p0, q0, q1, p1, [Math.cos(am), 0, Math.sin(am)], col);
      tri([cx, y0 + h, cz], q1, q0, col);
    }
  };

  // Wheels.
  for (const x of [-0.64, 0.64]) for (const z of [-0.88, 0.9]) wheel(x, 0.25, z, 0.25, 0.18);
  // Floor, the nose (bevelled), the dash, the rear deck.
  box(-0.6, 0.26, -1.3, 0.6, 0.42, 1.3, 'trim');
  box(-0.66, 0.42, -1.36, 0.66, 0.86, -0.72, 'body', 0.12);
  box(-0.56, 0.86, -0.82, 0.56, 1.02, -0.66, 'dash', 0.04);
  box(-0.66, 0.42, 0.6, 0.66, 0.8, 1.32, 'body', 0.08);
  // Headlights.
  box(-0.52, 0.6, -1.4, -0.3, 0.72, -1.36, 'light');
  box(0.3, 0.6, -1.4, 0.52, 0.72, -1.36, 'light');
  // The seat: its base, cushion and back.
  box(-0.62, 0.42, -0.14, 0.62, 0.66, 0.6, 'body');
  box(-0.58, 0.66, -0.12, 0.58, 0.8, 0.52, 'seat', 0.04);
  box(-0.58, 0.8, 0.46, 0.58, 1.34, 0.6, 'seat', 0.04);
  // Steering column and wheel.
  box(-0.34, 0.9, -0.66, -0.28, 1.2, -0.58, 'dash');
  wheel(-0.31, 1.22, -0.56, 0.16, 0.05, 10);
  // Posts and the canopy.
  for (const x of [-0.6, 0.54]) {
    box(x, 0.86, -0.76, x + 0.06, 2.02, -0.7, 'post');
    box(x, 0.8, 1.06, x + 0.06, 2.02, 1.12, 'post');
  }
  box(-0.76, 2.02, -1.0, 0.76, 2.1, 1.3, 'canopy', 0.03);
  // A bag of clubs on the back, heads showing.
  can(0, 0.8, 1.02, 0.18, 0.78, 'bag');
  for (const [dx, dz] of [
    [-0.07, -0.04],
    [0.06, 0.03],
    [0, 0.08],
  ])
    box(dx - 0.035, 1.58, 1.02 + dz - 0.05, dx + 0.035, 1.72, 1.02 + dz + 0.05, 'club');

  const tex = { w: COLOURS.length, h: 1, px: new Uint8Array(COLOURS.length * 4) };
  COLOURS.forEach((c, i) => tex.px.set([...palette[c], 255], i * 4));
  const mr = { w: COLOURS.length, h: 1, px: new Uint8Array(COLOURS.length * 4) };
  COLOURS.forEach((c, i) => mr.px.set([0, c === 'hub' || c === 'club' || c === 'post' ? 90 : c === 'canopy' || c === 'body' ? 150 : 235, c === 'hub' || c === 'club' ? 200 : 0, 255], i * 4));
  return writeGlb({
    generator: 'Blockyard Links src/games/golf/tools/cart.mjs',
    nodes: [{ name: 'cart', children: [1] }, { name: 'cart_body' }],
    sceneName: 'cart',
    meshName: 'cart_body',
    meshNode: 1,
    attributes: {
      POSITION: { values: pos, componentType: 5126, type: 'VEC3', minmax: true },
      NORMAL: { values: nor, componentType: 5126, type: 'VEC3' },
      TEXCOORD_0: { values: uv, componentType: 5123, type: 'VEC2', normalized: true },
    },
    indices: idx,
    material: { name: 'cart', albedo: png(tex), mr: png(mr) },
  });
}

for (const [name, rgb] of Object.entries(CANOPIES)) {
  const bytes = cart(rgb);
  writeFileSync(join(HERE, `../models/cart_${name}.glb`), bytes);
  console.log(`cart_${name}.glb  ${bytes.length} bytes`);
}
