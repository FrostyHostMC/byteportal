/**
 * The golf ball's model: a smooth white sphere of radius 0.5 (a node scaled to the ball's size
 * draws it), a little glossy, a dark stripe round it (so it's seen to roll). Written to
 * `models/ball.glb`.
 *
 *   node src/games/golf/tools/ball.mjs
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { png, writeGlb } from './voxel.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

// An icosphere, subdivided twice.
const t = (1 + Math.sqrt(5)) / 2;
let verts = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map(norm);
let faces = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
function norm(v) {
  const l = Math.hypot(...v);
  return v.map((c) => c / l);
}
for (let s = 0; s < 3; s++) {
  const mid = new Map();
  const m = (a, b) => {
    const k = a < b ? `${a},${b}` : `${b},${a}`;
    if (!mid.has(k)) {
      verts.push(norm(verts[a].map((c, i) => (c + verts[b][i]) / 2)));
      mid.set(k, verts.length - 1);
    }
    return mid.get(k);
  };
  faces = faces.flatMap(([a, b, c]) => {
    const ab = m(a, b), bc = m(b, c), ca = m(c, a);
    return [[a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]];
  });
}

// A clean stripe round its middle: each corner's texture row is its height, and the texture is
// white but for a dark band across its middle rows (so a rolling ball is seen to roll).
const pos = verts.flatMap((v) => v.map((q) => q * 0.5));
const nor = verts.flat();
const uv = verts.flatMap((v) => [32768, Math.round((0.5 - v[1] * 0.5) * 65535)]);
const idx = faces.flat();
const H = 64;
const white = { w: 2, h: H, px: new Uint8Array(2 * H * 4).map((_, i) => (Math.abs(Math.floor(i / 8) - (H / 2 - 0.5)) < 1.6 ? 36 : 246)) };
const mr = { w: 2, h: 2, px: new Uint8Array(2 * 2 * 4).map((_, i) => (i % 4 === 1 ? 92 : 0)) };
const bytes = writeGlb({
  generator: 'Blockyard Links src/games/golf/tools/ball.mjs',
  nodes: [{ name: 'golf_ball', children: [1] }, { name: 'golf_ball_body' }],
  sceneName: 'golf_ball',
  meshName: 'golf_ball_body',
  meshNode: 1,
  attributes: {
    POSITION: { values: pos, componentType: 5126, type: 'VEC3', minmax: true },
    NORMAL: { values: nor, componentType: 5126, type: 'VEC3' },
    TEXCOORD_0: { values: uv, componentType: 5123, type: 'VEC2', normalized: true },
  },
  indices: idx,
  material: { name: 'golf_ball', albedo: png(white), mr: png(mr) },
});
writeFileSync(join(HERE, '../models/ball.glb'), bytes);
console.log(`ball.glb ${bytes.length} bytes, ${faces.length} triangles`);
