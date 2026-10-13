import type { BlockDef } from '../world/registry';
import { DEFAULT_TINT } from '../world/registry';
import { itemFaces, type V3 } from '../render/blockmodel';

const SIZE = 64;

function faceCanvas(albedo: Uint8Array, layer: number, tint: [number, number, number] | null, shade: number, tintMask: boolean): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(16, 16);
  const src = albedo.subarray(layer * 1024, layer * 1024 + 1024);
  for (let i = 0; i < 256; i++) {
    let r = src[i * 4];
    let g = src[i * 4 + 1];
    let b = src[i * 4 + 2];
    let a = src[i * 4 + 3];
    if (tint) {
      // Opaque textures use alpha as the tint mask; cutout textures are tinted everywhere.
      const amount = tintMask ? 1 - a / 255 : 1;
      r = r * (1 - amount + amount * tint[0]);
      g = g * (1 - amount + amount * tint[1]);
      b = b * (1 - amount + amount * tint[2]);
      if (tintMask) a = 255;
    }
    img.data[i * 4] = r * shade;
    img.data[i * 4 + 1] = g * shade;
    img.data[i * 4 + 2] = b * shade;
    img.data[i * 4 + 3] = a;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Where a point of a block (in blocks, the cell from 0 to 1) lands in the isometric icon. */
const iso = (p: V3): [number, number] => [32 + 28 * p[0] - 28 * p[2], 32 + 14 * p[0] + 14 * p[2] - 28 * p[1]];

/** An icon drawn from a block model's boxes (and both halves of a bed), shrunk to fit if it must be. */
function modelIcon(ctx: CanvasRenderingContext2D, def: BlockDef, albedo: Uint8Array, partner?: BlockDef) {
  const tint = def.tint ? DEFAULT_TINT : null;
  // Faces toward the viewer (+X, +Y, +Z), far ones first.
  const shade = [0.6, 0, 1, 0, 0.78, 0];
  const faces = itemFaces(def, partner)
    .filter((f) => shade[f.face] > 0)
    .map((f) => ({ f, depth: f.corners.reduce((s, c) => s + c[0] + c[1] + c[2], 0) }))
    .sort((a, b) => a.depth - b.depth);
  const pts = faces.flatMap(({ f }) => f.corners.map(iso));
  const [x0, x1] = [Math.min(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[0]))];
  const [y0, y1] = [Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[1]))];
  const k = Math.min(1, 60 / (x1 - x0), 60 / (y1 - y0));
  const place = ([x, y]: [number, number]): [number, number] => (k < 1 ? [32 + (x - (x0 + x1) / 2) * k, 32 + (y - (y0 + y1) / 2) * k] : [x, y]);
  for (const { f } of faces) {
    const s = f.corners.map((c) => place(iso(c)));
    // Texture pixel of each corner, and the affine map from texture pixels to the icon.
    const t = f.uv.map(([u, v]) => [u * 16, (1 - v) * 16]);
    const [a1, b1, a3, b3] = [t[1][0] - t[0][0], t[1][1] - t[0][1], t[3][0] - t[0][0], t[3][1] - t[0][1]];
    const det = a1 * b3 - a3 * b1;
    if (Math.abs(det) < 1e-9) continue;
    const [sx1, sy1, sx3, sy3] = [s[1][0] - s[0][0], s[1][1] - s[0][1], s[3][0] - s[0][0], s[3][1] - s[0][1]];
    const a = (sx1 * b3 - sx3 * b1) / det;
    const c = (sx3 * a1 - sx1 * a3) / det;
    const b = (sy1 * b3 - sy3 * b1) / det;
    const d = (sy3 * a1 - sy1 * a3) / det;
    ctx.save();
    ctx.beginPath();
    s.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.clip();
    ctx.setTransform(a, b, c, d, s[0][0] - a * t[0][0] - c * t[0][1], s[0][1] - b * t[0][0] - d * t[0][1]);
    ctx.drawImage(faceCanvas(albedo, f.layer, tint, shade[f.face], def.layer === 0), 0, 0);
    ctx.restore();
  }
}

/**
 * Isometric icon of a block, drawn from its generated textures (plants and torches flat, like
 * items; a bed whole, with `partner` its head). Returns a data URL.
 */
export function blockIcon(def: BlockDef, albedo: Uint8Array, partner?: BlockDef): string {
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  const tint = def.tint ? DEFAULT_TINT : null;
  const opaqueMask = def.layer === 0;
  if (def.small) {
    const f = faceCanvas(albedo, def.tex[0], tint, 1, false);
    ctx.drawImage(f, 8, 8, 48, 48);
    return c.toDataURL();
  }
  if (def.parts) {
    modelIcon(ctx, def, albedo, partner);
    return c.toDataURL();
  }
  const top = faceCanvas(albedo, def.tex[2], tint, 1.0, opaqueMask);
  const left = faceCanvas(albedo, def.tex[4], tint, 0.78, opaqueMask);
  const right = faceCanvas(albedo, def.tex[0], tint, 0.6, opaqueMask);
  const k = 1 / 16;
  // Top rhombus: (4,18) -> (32,4) -> (60,18) -> (32,32)
  ctx.setTransform(28 * k, -14 * k, 28 * k, 14 * k, 4, 18);
  ctx.drawImage(top, 0, 0);
  // Left face: (4,18) -> (32,32) down to (32,60), (4,46)
  ctx.setTransform(28 * k, 14 * k, 0, 28 * k, 4, 18);
  ctx.drawImage(left, 0, 0);
  // Right face: (32,32) -> (60,18) down to (60,46), (32,60)
  ctx.setTransform(28 * k, -14 * k, 0, 28 * k, 32, 32);
  ctx.drawImage(right, 0, 0);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return c.toDataURL();
}
