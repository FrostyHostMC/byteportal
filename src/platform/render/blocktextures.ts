import { parseColor, type BuiltinTexture, type TextureLayer } from '../world/blocks';

/**
 * The texture layers a game's own blocks add (`world/blocks`), painted into the same two arrays
 * as the built-in ones (`engine/src/texgen.rs` has the contract): albedo in sRGB RGBA, and the
 * material (R, G: the tangent-space normal's x and y as n * 0.5 + 0.5, B: smoothness, A:
 * emissive). Images are fetched and scaled to 16 x 16; colours, pixel art and painters are drawn
 * here. The normal map comes from each texture's brightness (or its noise), so custom blocks
 * catch the light like the built-in ones.
 */

const S = 16;
const P = S * S;

/**
 * Every layer's pixels, in order: albedo and material, `layers.length` * 16 * 16 * 4 bytes each.
 * `textureNames` name them in warnings (`GameBlocks.textureNames`).
 */
export async function paintGameTextures(layers: TextureLayer[], builtin: { albedo: Uint8Array; material: Uint8Array }, textureNames: string[] = []): Promise<{ albedo: Uint8Array; material: Uint8Array }> {
  const albedo = new Uint8Array(layers.length * P * 4);
  const material = new Uint8Array(layers.length * P * 4);
  const images = new Map<string, Promise<Uint8Array | null>>();
  await Promise.all(
    layers.map(async (layer, i) => {
      const at = i * P * 4;
      const src = layer.source;
      if (typeof src === 'object' && 'layer' in src) {
        paintBuiltin(layer, src, builtin, albedo.subarray(at, at + P * 4), material.subarray(at, at + P * 4));
        return;
      }
      let pixels: Uint8Array | null = null;
      let height: Float32Array | null = null;
      let relief = 0.6;
      try {
        if (typeof src === 'string') {
          let image = images.get(src);
          if (!image) images.set(src, (image = loadImage(src)));
          pixels = await image;
        } else if ('color' in src) {
          ({ pixels, height, relief } = mottled(src));
        } else if ('pixels' in src) {
          pixels = pixelArt(src);
        } else {
          pixels = painted(src);
        }
      } catch (err) {
        // A painter that throws: the block shows the missing texture, and the game carries on.
        console.warn(`block texture ${textureNames[i] ?? i}: ${String(err)}; showing the missing texture`);
      }
      finish(layer, pixels ?? missing(), height, relief, albedo.subarray(at, at + P * 4), material.subarray(at, at + P * 4));
    }),
  );
  return { albedo, material };
}

/** A built-in texture tinted, made to glow, or tinted by the grass colour all over. */
function paintBuiltin(layer: TextureLayer, src: BuiltinTexture, builtin: { albedo: Uint8Array; material: Uint8Array }, alb: Uint8Array, mat: Uint8Array) {
  const from = src.layer * P * 4;
  alb.set(builtin.albedo.subarray(from, from + P * 4));
  mat.set(builtin.material.subarray(from, from + P * 4));
  for (let i = 0; i < P; i++) {
    const o = i * 4;
    if (layer.tint) for (let k = 0; k < 3; k++) alb[o + k] = Math.round(alb[o + k] * layer.tint[k]);
    if (layer.grass && !layer.clear) alb[o + 3] = 0;
    if (layer.glow !== null) mat[o + 3] = alb[o + 3] > 0 || !layer.clear ? Math.round(layer.glow * 255) : 0;
  }
}

/** Alpha, tint, glow and the material for 16 x 16 RGBA `px` (sRGB). */
function finish(layer: TextureLayer, px: Uint8Array, height: Float32Array | null, relief: number, alb: Uint8Array, mat: Uint8Array) {
  const seen = Uint8Array.from({ length: P }, (_, i) => (px[i * 4 + 3] >= 128 ? 255 : 0));
  const rgb = new Float32Array(P * 3);
  for (let i = 0; i < P; i++) {
    for (let k = 0; k < 3; k++) rgb[i * 3 + k] = px[i * 4 + k] * (layer.tint ? layer.tint[k] : 1);
  }
  // Clear pixels take their neighbours' colour: an opaque block shows that rather than black, and
  // a cutout's mipmaps don't darken its edges.
  dilate(rgb, seen);
  const a = layer.clear ? seen : new Uint8Array(P).fill(255);
  const h = height ?? Float32Array.from({ length: P }, (_, i) => (0.2126 * rgb[i * 3] + 0.7152 * rgb[i * 3 + 1] + 0.0722 * rgb[i * 3 + 2]) / 255);
  const glow = Math.round((layer.glow ?? 0) * 255);
  for (let i = 0; i < P; i++) {
    const o = i * 4;
    const x = i % S;
    const y = (i / S) | 0;
    for (let k = 0; k < 3; k++) alb[o + k] = Math.max(0, Math.min(255, Math.round(rgb[i * 3 + k])));
    // An opaque texture tinted by the grass colour says so with alpha 0 (the shader's tint mask).
    alb[o + 3] = layer.grass && !layer.clear ? 0 : a[i];
    let nx = 0;
    let ny = 0;
    if (a[i] > 0) {
      const s = (dx: number, dy: number) => h[((y + dy + S) % S) * S + ((x + dx + S) % S)];
      const gx = (s(1, -1) + 2 * s(1, 0) + s(1, 1) - s(-1, -1) - 2 * s(-1, 0) - s(-1, 1)) / 8;
      const gy = (s(-1, 1) + 2 * s(0, 1) + s(1, 1) - s(-1, -1) - 2 * s(0, -1) - s(1, -1)) / 8;
      nx = -gx * relief;
      ny = gy * relief;
    }
    const l = Math.sqrt(nx * nx + ny * ny + 1);
    const enc = (n: number) => Math.max(0, Math.min(255, Math.floor(n * 127.5 + 128)));
    mat[o] = enc(nx / l);
    mat[o + 1] = enc(ny / l);
    mat[o + 2] = 60;
    mat[o + 3] = a[i] > 0 ? glow : 0;
  }
}

/** Spread the colours of opaque pixels into clear ones, a ring at a time. */
function dilate(rgb: Float32Array, a: Uint8Array) {
  const known = Array.from(a, (v) => v > 0);
  if (!known.some(Boolean)) return;
  for (let pass = 0; pass < S; pass++) {
    const was = known.slice();
    const prev = rgb.slice();
    let changed = false;
    for (let i = 0; i < P; i++) {
      if (was[i]) continue;
      const x = i % S;
      const y = (i / S) | 0;
      const sum = [0, 0, 0];
      let n = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= S || ny >= S || !was[ny * S + nx]) continue;
          for (let k = 0; k < 3; k++) sum[k] += prev[(ny * S + nx) * 3 + k];
          n++;
        }
      if (!n) continue;
      for (let k = 0; k < 3; k++) rgb[i * 3 + k] = sum[k] / n;
      known[i] = true;
      changed = true;
    }
    if (!changed) break;
  }
}

/** An image's top square (a strip of animation frames shows its first), scaled to 16 x 16. */
async function loadImage(url: string): Promise<Uint8Array | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const bmp = await createImageBitmap(await res.blob());
    const side = Math.min(bmp.width, bmp.height);
    const canvas = new OffscreenCanvas(S, S);
    const ctx = canvas.getContext('2d')!;
    // Shrink smoothly, grow in crisp blocks.
    ctx.imageSmoothingEnabled = side > S;
    ctx.drawImage(bmp, 0, 0, side, side, 0, 0, S, S);
    bmp.close();
    return new Uint8Array(ctx.getImageData(0, 0, S, S).data.buffer);
  } catch (err) {
    console.warn(`block texture ${url.slice(0, 80)}: couldn't load it (${String(err)}), showing the missing texture`);
    return null;
  }
}

/** Magenta and black squares: a texture that couldn't be made. */
function missing(): Uint8Array {
  const px = new Uint8Array(P * 4);
  for (let i = 0; i < P; i++) {
    const on = (((i % S) >> 2) + ((i / S) >> 2)) & 1;
    px.set(on ? [255, 0, 255, 255] : [17, 17, 17, 255], i * 4);
  }
  return px;
}

const colorCache = new Map<string, [number, number, number, number] | null>();

/** Any CSS colour as RGBA (named ones need a browser); null: clear. */
function cssColor(css: string | null | undefined): [number, number, number, number] | null {
  if (css === null || css === undefined) return null;
  let c = colorCache.get(css);
  if (c !== undefined) return c;
  c = parseColor(css);
  if (!c && typeof OffscreenCanvas !== 'undefined') {
    // Names and other forms: the canvas reads them (and writes back #rrggbb or rgba()).
    const ctx = new OffscreenCanvas(1, 1).getContext('2d')!;
    ctx.fillStyle = '#01020300';
    ctx.fillStyle = css;
    c = ctx.fillStyle === '#01020300' ? null : parseColor(String(ctx.fillStyle));
  }
  if (!c) console.warn(`block texture: can't read the colour "${css}"`);
  colorCache.set(css, c);
  return c;
}

/** Hash of a lattice point to [0, 1). */
function rnd(x: number, y: number, seed: number): number {
  let h = Math.imul(seed ^ 0x2545f491, 0x9e3779b9) ^ Math.imul(x & 0xffff, 0x85ebca77) ^ Math.imul(y & 0xffff, 0xc2b2ae3d);
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 8) / 16777216;
}

/** Value noise that tiles over the 16 px texture: `cells` lattice cells across it. */
function vnoise(x: number, y: number, cells: number, seed: number): number {
  const fx = (x * cells) / S;
  const fy = (y * cells) / S;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const sx = fx - x0;
  const sy = fy - y0;
  const tx = sx * sx * (3 - 2 * sx);
  const ty = sy * sy * (3 - 2 * sy);
  const g = (i: number, j: number) => rnd(((i % cells) + cells) % cells, ((j % cells) + cells) % cells, seed);
  const top = g(x0, y0) + (g(x0 + 1, y0) - g(x0, y0)) * tx;
  const bottom = g(x0, y0 + 1) + (g(x0 + 1, y0 + 1) - g(x0, y0 + 1)) * tx;
  return top + (bottom - top) * ty;
}

/**
 * A colour mottled with noise that tiles (blotches `scale` pixels across, plus a little per-pixel
 * grain), ranked so exactly half the pixels are lighter; or, given several colours, the noise
 * picks between them. Also its height, for the normal map.
 */
export function mottled(t: { color: string | string[]; noise?: number; scale?: number; seed?: number }): { pixels: Uint8Array; height: Float32Array; relief: number } {
  const colors = (Array.isArray(t.color) ? t.color : [t.color]).map((c) => cssColor(c) ?? [255, 0, 255, 255]);
  const amount = Math.max(0, Math.min(1, t.noise ?? 0.12));
  const cells = Math.max(1, Math.min(S, Math.round(S / Math.max(1, t.scale ?? 2))));
  const seed = (t.seed ?? 1) * 7919 + 17;
  const f = Array.from({ length: P }, (_, i) => {
    const x = (i % S) + 0.5;
    const y = ((i / S) | 0) + 0.5;
    return 0.45 * vnoise(x, y, cells, seed) + 0.25 * vnoise(x, y, Math.min(S, cells * 2), seed + 1) + 0.3 * rnd(i % S, (i / S) | 0, seed + 2);
  });
  // Rank-equalised: the palette's colours come out in equal shares.
  const order = f.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const e = new Float32Array(P);
  order.forEach(([, i], r) => (e[i] = (r + 0.5) / P));
  const pixels = new Uint8Array(P * 4);
  for (let i = 0; i < P; i++) {
    let c: number[];
    if (colors.length > 1) c = colors[Math.min(colors.length - 1, Math.floor(e[i] * colors.length))];
    else {
      const k = 1 + (e[i] - 0.5) * 2 * amount;
      // (Clamped: a byte array would wrap 260 round to 4.)
      c = colors[0].map((v, j) => (j < 3 ? Math.min(255, Math.round(v * k)) : v));
    }
    pixels.set([c[0], c[1], c[2], c[3]], i * 4);
  }
  return { pixels, height: e, relief: colors.length > 1 ? 0.9 : 0.25 + amount };
}

/** Rows of characters, each a palette colour; scaled to 16 x 16 if it's another size. */
export function pixelArt(t: { pixels: string[]; palette: Record<string, string> }): Uint8Array {
  const rows = t.pixels.length || 1;
  const cols = Math.max(1, ...t.pixels.map((r) => r.length));
  const out = new Uint8Array(P * 4);
  for (let i = 0; i < P; i++) {
    const row = t.pixels[Math.floor((((i / S) | 0) * rows) / S)] ?? '';
    const ch = row[Math.floor(((i % S) * cols) / S)] ?? '.';
    const c = ch === '.' || ch === ' ' ? null : cssColor(t.palette[ch]);
    if (c) out.set(c, i * 4);
  }
  return out;
}

/** A painter's colour for every pixel (row 0 at the top). */
export function painted(t: { paint(x: number, y: number): string | null }): Uint8Array {
  const out = new Uint8Array(P * 4);
  for (let i = 0; i < P; i++) {
    const c = cssColor(t.paint(i % S, (i / S) | 0));
    if (c) out.set(c, i * 4);
  }
  return out;
}
