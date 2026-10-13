import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { CosmeticModel } from '../api/types';

/** A cosmetic's look, built once: its boxes as one geometry, coloured from a small palette texture. */
export interface CosmeticLook {
  geometry: THREE.BufferGeometry;
  albedo: THREE.Texture;
  emissive: THREE.Texture;
}

/** The palette texture's size: a colour per texel, up to 256. */
const P = 16;

/**
 * A cosmetic's model (`CosmeticModel`: coloured boxes in texels) as a mesh's geometry and textures:
 * each box's faces take their colour from a texel of a little palette (glowing ones from the
 * emissive map too), so it draws with the entities' shader, lit like the figure wearing it.
 */
export function cosmeticLook(model: CosmeticModel): CosmeticLook {
  const colors: string[] = [];
  const index = (c: string) => {
    let i = colors.indexOf(c);
    if (i < 0) {
      i = colors.length;
      colors.push(c);
    }
    return Math.min(i, P * P - 1);
  };
  const pixels = new Uint8Array(P * P * 4);
  const glow = new Uint8Array(P * P * 4);
  const parts: THREE.BufferGeometry[] = [];
  const tmp = new THREE.Color();
  for (const b of model.boxes) {
    const [x0, y0, z0] = b.from;
    const [x1, y1, z1] = b.to;
    const g = new THREE.BoxGeometry(Math.abs(x1 - x0) / 16, Math.abs(y1 - y0) / 16, Math.abs(z1 - z0) / 16);
    g.translate((x0 + x1) / 32, (y0 + y1) / 32, (z0 + z1) / 32);
    const i = index(b.color);
    tmp.set(b.color);
    tmp.convertLinearToSRGB();
    pixels.set([Math.round(tmp.r * 255), Math.round(tmp.g * 255), Math.round(tmp.b * 255), 255], i * 4);
    if (b.glow) glow[i * 4] = 255;
    // Every corner at the middle of its colour's texel.
    const uv = g.getAttribute('uv') as THREE.BufferAttribute;
    const u = ((i % P) + 0.5) / P;
    const v = (Math.floor(i / P) + 0.5) / P;
    for (let k = 0; k < uv.count; k++) uv.setXY(k, u, v);
    parts.push(g);
  }
  const geometry = mergeGeometries(parts) ?? new THREE.BufferGeometry();
  for (const g of parts) g.dispose();
  geometry.computeBoundingSphere();
  const texture = (data: Uint8Array, srgb: boolean) => {
    const t = new THREE.DataTexture(data, P, P, THREE.RGBAFormat, THREE.UnsignedByteType);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    t.flipY = false;
    t.needsUpdate = true;
    return t;
  };
  return { geometry, albedo: texture(pixels, true), emissive: texture(glow, false) };
}
