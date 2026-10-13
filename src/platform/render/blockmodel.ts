import type { BlockDef } from '../world/registry';

export type V3 = [number, number, number];

/** One face of a block model, ready to draw: its corners, their texture coordinates, its texture. */
export interface ModelFace {
  /** +X -X +Y -Y +Z -Z. */
  face: number;
  normal: V3;
  /** Corners in blocks, counter-clockwise seen from outside. */
  corners: [V3, V3, V3, V3];
  /** Texture coordinates of the corners, 0..1, v up (as the chunk shader maps them). */
  uv: [number, number][];
  layer: number;
}

const NORMALS: V3[] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];
/** How the chunk shader maps each face's texture from world position (`vertex_unpack.glsl`). */
const FACE_U: V3[] = [
  [0, 0, -1],
  [0, 0, 1],
  [1, 0, 0],
  [1, 0, 0],
  [1, 0, 0],
  [-1, 0, 0],
];
const FACE_V: V3[] = [
  [0, 1, 0],
  [0, 1, 0],
  [0, 0, 1],
  [0, 0, -1],
  [0, 1, 0],
  [0, 1, 0],
];

const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const neg = (a: V3): V3 => [-a[0], -a[1], -a[2]];

/**
 * A block's faces as the world draws them, in a block-sized cell from (0, 0, 0) moved by
 * `offset`: a model's boxes, or a whole cube.
 */
export function modelFaces(def: BlockDef, offset: V3 = [0, 0, 0]): ModelFace[] {
  const out: ModelFace[] = [];
  const parts = def.parts ?? [[0, 0, 0, 16, 16, 16, ...def.tex, ...(def.uvt ?? [0, 0, 0, 0, 0, 0])]];
  for (const p of parts) {
    const lo: V3 = [p[0] / 16, p[1] / 16, p[2] / 16];
    const hi: V3 = [p[3] / 16, p[4] / 16, p[5] / 16];
    for (let f = 0; f < 6; f++) {
      const layer = p[6 + f];
      if (layer < 0) continue;
      const n = NORMALS[f];
      const axis = n[0] ? 0 : n[1] ? 1 : 2;
      // Two axes along the face, ordered so the corners wind counter-clockwise from outside.
      let [a, b] = [0, 1, 2].filter((k) => k !== axis);
      if ((n[axis] > 0) !== ((axis + 1) % 3 === a)) [a, b] = [b, a];
      const plane = n[axis] > 0 ? hi[axis] : lo[axis];
      const corner = (ia: number, ib: number): V3 => {
        const c: V3 = [0, 0, 0];
        c[axis] = plane;
        c[a] = ia ? hi[a] : lo[a];
        c[b] = ib ? hi[b] : lo[b];
        return c;
      };
      const corners: [V3, V3, V3, V3] = [corner(0, 0), corner(1, 0), corner(1, 1), corner(0, 1)];
      // The texture axes, turned by the face's transform (1 swap, 2 flip u, 4 flip v).
      const t = p[12 + f] ?? 0;
      let tu = FACE_U[f];
      let tv = FACE_V[f];
      if (t & 1) [tu, tv] = [tv, tu];
      if (t & 2) tu = neg(tu);
      if (t & 4) tv = neg(tv);
      const us = corners.map((c) => dot(c, tu));
      const vs = corners.map((c) => dot(c, tv));
      // Into this block's own tile of the texture.
      const u0 = Math.floor(Math.min(...us) + 1e-6);
      const v0 = Math.floor(Math.min(...vs) + 1e-6);
      out.push({
        face: f,
        normal: n,
        corners: corners.map((c) => [c[0] + offset[0], c[1] + offset[1], c[2] + offset[2]]) as [V3, V3, V3, V3],
        uv: corners.map((_, k) => [us[k] - u0, vs[k] - v0]),
        layer,
      });
    }
  }
  return out;
}

/**
 * What a block looks like as an item: its own faces, and for a bed, both halves (the head beyond
 * the foot). `partner` is the head half's definition.
 */
export function itemFaces(def: BlockDef, partner?: BlockDef): ModelFace[] {
  const faces = modelFaces(def);
  if (def.model === 'bed' && partner) faces.push(...modelFaces(partner, [0, 0, -1]));
  return faces;
}
