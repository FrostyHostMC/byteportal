/**
 * Pixel-art toolkit for painting a game's own atlas in code (mob skins, item sprites, held
 * models), the same way the engine paints its built-in art. Import it from `@platform/art`:
 *
 *   const cv = new Canvas();                        // a 256x256 atlas
 *   paintBox(cv, 0, 0, part(0, 0, 8, 8, 8), (s) => px(MY_PALETTE, 3 + s.rnd(1)));
 *   const { albedo, emissive } = cv.finish();
 *   game.items.atlas('mine', { width: ATLAS, height: ATLAS, pixels: albedo, emissive });
 *
 * Technique: every model part is a box with Minecraft skin UVs. Each face texel is mapped back
 * to a point on the box surface, so painters work in 3D (part-local x, y, z) and patterns such
 * as noise, hems, straps and seams continue around corners. Painters return a palette level
 * and a small height value; a per-face pass turns the heights into crisp top-left bevel light
 * (lit upper/left rims, shaded lower/right rims, cast shadows) before posterising to the
 * palette. Held items are 16x16 hand-authored or procedurally rasterised sprites with an
 * automatic dark outline.
 *
 * Box UV convention (Minecraft skin layout), for a part of `w` x `h` x `d` texels at (u, v):
 * top (u+d, v, w, d), bottom (u+d+w, v, w, d), right (u, v+d, d, h), front (u+d, v+d, w, h),
 * left (u+d+w, v+d, d, h), back (u+2d+w, v+d, w, h). Faces are oriented as on a standard skin
 * (classic `ModelBox`): the front face's left column is the creature's right side; side faces
 * are upright and share their vertical edges with the neighbouring faces in the strip
 * right | front | left | back (wrapping); the top face's bottom row borders the front face;
 * the bottom face uses the same orientation (its last row is the front edge).
 *
 * Precision: the engine painted in f32; this port uses doubles, which give the same texels
 * except where a value lands exactly on a threshold. The one place that happens (the spider's
 * chevrons) rounds through `f32` explicitly.
 */

export const ATLAS = 256;
const AW = ATLAS;
const N = ATLAS * ATLAS;

/** An RGB colour, 0..255 per channel. */
export type Col = [number, number, number];

/** Rounds to the nearest f32, to reproduce the engine's single-precision arithmetic. */
export const f32 = Math.fround;

const TAU = 2 * Math.PI;

export const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi);

/** `lo <= v && v <= hi`, Rust's `(lo..=hi).contains(&v)`. */
export const within = (v: number, lo: number, hi: number): boolean => lo <= v && v <= hi;

/** Rust's `rem_euclid`: the remainder, never negative. */
export function remEuclid(a: number, n: number): number {
  const r = a % n;
  return r < 0 ? r + Math.abs(n) : r;
}

/** Rust's `round`: halves go away from zero (`Math.round` sends them up). */
export const round = (v: number): number => (v < 0 ? -Math.round(-v) : Math.round(v));

// ============================================================================
// Layout
// ============================================================================

export type Face = 'top' | 'bottom' | 'right' | 'front' | 'left' | 'back';

export const FACES: readonly Face[] = ['top', 'bottom', 'right', 'front', 'left', 'back'];

/** A model box: UV origin (relative to its region) and size in texels. */
export class Part {
  constructor(
    readonly u: number,
    readonly v: number,
    readonly w: number,
    readonly h: number,
    readonly d: number,
  ) {}

  /** Atlas rectangle `[x, y, width, height]` of a face, relative to the region origin. */
  rect(f: Face): [number, number, number, number] {
    const { u, v, w, h, d } = this;
    switch (f) {
      case 'top':
        return [u + d, v, w, d];
      case 'bottom':
        return [u + d + w, v, w, d];
      case 'right':
        return [u, v + d, d, h];
      case 'front':
        return [u + d, v + d, w, h];
      case 'left':
        return [u + d + w, v + d, d, h];
      case 'back':
        return [u + 2 * d + w, v + d, w, h];
    }
  }
}

export const part = (u: number, v: number, w: number, h: number, d: number): Part => new Part(u, v, w, h, d);

// ============================================================================
// Randomness and noise
// ============================================================================

export function mix32(x: number): number {
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb_352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846c_a68b);
  x ^= x >>> 16;
  return x >>> 0;
}

export function hash3(x: number, y: number, z: number, seed: number): number {
  let h = mix32(Math.imul(seed, 0x9e37_79b9) ^ 0x2545_f491);
  h = mix32(h ^ Math.imul(x, 0x85eb_ca77));
  h = mix32(h ^ Math.imul(y, 0xc2b2_ae3d));
  return mix32(h ^ Math.imul(z, 0x27d4_eb2f));
}

export function unit(h: number): number {
  return (h >>> 8) * (1.0 / 16_777_216.0);
}

/** Per-texel white noise in [0, 1). */
export function rnd(x: number, y: number, seed: number): number {
  return unit(hash3(x, y, 0, seed));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** 3D value noise in [0, 1] on a unit lattice. */
export function vnoise3(x: number, y: number, z: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const z0 = Math.floor(z);
  const s = (t: number) => t * t * (3.0 - 2.0 * t);
  const tx = s(x - x0);
  const ty = s(y - y0);
  const tz = s(z - z0);
  const g = (a: number, b: number, c: number) => unit(hash3(x0 + a, y0 + b, z0 + c, seed));
  const a = lerp(lerp(g(0, 0, 0), g(1, 0, 0), tx), lerp(g(0, 1, 0), g(1, 1, 0), tx), ty);
  const b = lerp(lerp(g(0, 0, 1), g(1, 0, 1), tx), lerp(g(0, 1, 1), g(1, 1, 1), tx), ty);
  return lerp(a, b, tz);
}

export function hexc(v: number): Col {
  return [(v >>> 16) & 255, (v >>> 8) & 255, v & 255];
}

export function pick(p: readonly number[], i: number): Col {
  return hexc(p[clamp(i, 0, p.length - 1)]);
}

// ============================================================================
// Canvas
// ============================================================================

export class Canvas {
  private readonly c = new Float32Array(N * 3);
  private readonly a = new Uint8Array(N);
  /** Texel has a meaningful colour (opaque, or a deliberately coloured hole). */
  private readonly known = new Uint8Array(N);
  private readonly e = new Uint8Array(N);

  private static at(x: number, y: number): number | undefined {
    return x >= 0 && x < AW && y >= 0 && y < AW ? y * AW + x : undefined;
  }

  set(x: number, y: number, c: Col, e: number) {
    const i = Canvas.at(x, y);
    if (i === undefined) return;
    this.c.set(c, i * 3);
    this.a[i] = 1;
    this.known[i] = 1;
    this.e[i] = e;
  }

  /** A transparent texel that still carries a colour for texture filtering. */
  hole(x: number, y: number, c: Col) {
    const i = Canvas.at(x, y);
    if (i === undefined) return;
    this.c.set(c, i * 3);
    this.a[i] = 0;
    this.known[i] = 1;
    this.e[i] = 0;
  }

  /**
   * Returns `{ albedo, emissive }`: `ATLAS * ATLAS * 4` bytes of sRGB RGBA (row 0 at the top,
   * alpha strictly 0 or 255, transparent texels next to painted ones carrying a nearby colour)
   * and `ATLAS * ATLAS` bytes of glow intensity (a glowing texel's albedo is its glow colour).
   */
  finish(): { albedo: Uint8Array; emissive: Uint8Array } {
    // One dilation pass: unpainted texels bordering painted ones take their average colour.
    const prev = this.c.slice();
    for (let y = 0; y < AW; y++) {
      for (let x = 0; x < AW; x++) {
        const i = y * AW + x;
        if (this.known[i]) continue;
        const sum = [0, 0, 0];
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const j = Canvas.at(x + dx, y + dy);
            if (j !== undefined && this.known[j]) {
              for (let k = 0; k < 3; k++) sum[k] += prev[j * 3 + k];
              n += 1;
            }
          }
        }
        if (n > 0) this.c.set([sum[0] / n, sum[1] / n, sum[2] / n], i * 3);
      }
    }
    const albedo = new Uint8Array(N * 4);
    for (let i = 0; i < N; i++) {
      for (let k = 0; k < 3; k++) albedo[i * 4 + k] = clamp(round(this.c[i * 3 + k]), 0, 255);
      albedo[i * 4 + 3] = this.a[i] ? 255 : 0;
      if (!this.a[i]) this.e[i] = 0;
    }
    return { albedo, emissive: this.e };
  }
}

// ============================================================================
// Box painting
// ============================================================================

/** A face texel seen from the painter: where it is on the face and on the 3D box. */
export class S {
  readonly f: Face;
  /** Face-local column and row, and face width. */
  readonly c: number;
  readonly r: number;
  readonly fw: number;
  /**
   * Surface point (texel centre) in part space: x from the creature's right side (0) to its
   * left (w), y from the top (0) down (h), z from the front (0) to the back (d).
   */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** The voxel cell under the texel. */
  readonly ix: number;
  readonly iy: number;
  readonly iz: number;
  readonly w: number;
  readonly h: number;
  readonly d: number;
  /** Atlas texel (per-texel white noise). */
  readonly ax: number;
  readonly ay: number;
  /**
   * Column in the side strip right | front | left | back (continuous around the box);
   * -1 on the top and bottom faces.
   */
  readonly per: number;

  constructor(p: Part, f: Face, c: number, r: number, ax: number, ay: number) {
    const { w, h, d } = p;
    this.f = f;
    this.c = c;
    this.r = r;
    this.fw = f === 'right' || f === 'left' ? d : w;
    const cell = (): [number, number, number] => {
      switch (f) {
        case 'front':
          return [c, r, 0];
        case 'back':
          return [w - 1 - c, r, d - 1];
        case 'right':
          return [0, r, d - 1 - c];
        case 'left':
          return [w - 1, r, c];
        case 'top':
          return [c, 0, d - 1 - r];
        case 'bottom':
          return [c, h - 1, d - 1 - r];
      }
    };
    const [ix, iy, iz] = cell();
    let [x, y, z] = [ix + 0.5, iy + 0.5, iz + 0.5];
    switch (f) {
      case 'front':
        z = 0.0;
        break;
      case 'back':
        z = d;
        break;
      case 'right':
        x = 0.0;
        break;
      case 'left':
        x = w;
        break;
      case 'top':
        y = 0.0;
        break;
      case 'bottom':
        y = h;
        break;
    }
    this.x = x;
    this.y = y;
    this.z = z;
    this.ix = ix;
    this.iy = iy;
    this.iz = iz;
    this.w = w;
    this.h = h;
    this.d = d;
    this.ax = ax;
    this.ay = ay;
    this.per = f === 'right' ? c : f === 'front' ? d + c : f === 'left' ? d + w + c : f === 'back' ? 2 * d + w + c : -1;
  }

  side(): boolean {
    return this.f !== 'top' && this.f !== 'bottom';
  }

  rnd(seed: number): number {
    return rnd(this.ax, this.ay, seed);
  }

  /** Smooth noise with feature sizes (in texels) per axis. */
  n(sx: number, sy: number, sz: number, seed: number): number {
    return vnoise3(this.x / sx, this.y / sy, this.z / sz, seed);
  }

  n1(s: number, seed: number): number {
    return this.n(s, s, s, seed);
  }

  /** Two-octave noise. */
  fbm(s: number, seed: number): number {
    return 0.65 * this.n1(s, seed) + 0.35 * this.n1(s * 0.5, seed + 17);
  }

  /**
   * Smooth noise around the side strip (ragged hems and similar), periodic so it also
   * joins up where the back face meets the right face. `s` is the feature size in texels.
   */
  pn(s: number, seed: number): number {
    const len = 2 * (this.w + this.d);
    const a = ((this.per + 0.5) / len) * TAU;
    const r = len / (TAU * s);
    return vnoise3(r * Math.cos(a) + 64.0, r * Math.sin(a) + 64.0, 0.5, seed);
  }

  /** Per-column white noise around the side strip. */
  pr(seed: number): number {
    return rnd(this.per, 7, seed);
  }

  /** Distance to a point in part space, with y stretched by `ky`. */
  dist(p: readonly [number, number, number], ky: number): number {
    const [dx, dy, dz] = [this.x - p[0], (this.y - p[1]) * ky, this.z - p[2]];
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  /** Horizontal distance from the vertical centre line of the part (for symmetric designs). */
  cx(): number {
    return Math.abs(this.x - this.w * 0.5);
  }
}

/** What a painter returns for a texel. */
export class Px {
  constructor(
    readonly pal: readonly number[],
    /** Palette level before lighting. */
    public l: number,
    /** Height for the bevel pass (texels; small values). */
    public height = 0.0,
    /** Emissive intensity. */
    public e = 0,
    public a = true,
    /** How strongly the bevel light moves the level (0 for glowing texels). */
    public k = 1.0,
  ) {}

  /** With height `h`. */
  h(h: number): Px {
    return new Px(this.pal, this.l, h, this.e, this.a, this.k);
  }

  dl(dl: number): Px {
    return new Px(this.pal, this.l + dl, this.height, this.e, this.a, this.k);
  }

  glow(e: number): Px {
    return new Px(this.pal, this.l, this.height, e, this.a, 0.0);
  }

  /** Transparent, keeping the colour for filtering. */
  clear(): Px {
    return new Px(this.pal, this.l, -1.5, this.e, false, this.k);
  }
}

export function px(pal: readonly number[], l: number): Px {
  return new Px(pal, l);
}

/** Paints all six faces of `p` (region origin `ox`, `oy`) with `f`, then applies bevel light. */
export function paintBox(cv: Canvas, ox: number, oy: number, p: Part, f: (s: S) => Px) {
  const buf: Px[] = [];
  for (const face of FACES) {
    const [fx, fy, fw, fh] = p.rect(face);
    buf.length = 0;
    for (let r = 0; r < fh; r++) {
      for (let c = 0; c < fw; c++) buf.push(f(new S(p, face, c, r, ox + fx + c, oy + fy + r)));
    }
    const hat = (c: number, r: number) => buf[clamp(r, 0, fh - 1) * fw + clamp(c, 0, fw - 1)].height;
    for (let r = 0; r < fh; r++) {
      for (let c = 0; c < fw; c++) {
        const q = buf[r * fw + c];
        const [x, y] = [ox + fx + c, oy + fy + r];
        if (!q.a) {
          cv.hole(x, y, pick(q.pal, round(q.l)));
          continue;
        }
        const d = (o: number) => clamp(q.height - o, -1.0, 1.0);
        const [up, lf, dn, rt] = [d(hat(c, r - 1)), d(hat(c - 1, r)), d(hat(c, r + 1)), d(hat(c + 1, r))];
        // Key light from the top left: upper/left rims of raised shapes catch light,
        // lower/right rims turn away, and raised shapes cast shadow down and right.
        const light =
          0.9 * Math.max(up, 0.0) +
          0.6 * Math.max(lf, 0.0) -
          0.9 * Math.max(-up, 0.0) -
          0.55 * Math.max(-lf, 0.0) -
          0.7 * Math.max(dn, 0.0) -
          0.45 * Math.max(rt, 0.0);
        const lvl = round(q.l + q.k * light);
        cv.set(x, y, pick(q.pal, lvl), q.e);
      }
    }
  }
}

/** Applies a hand-drawn face overlay: `art` rows use '.' for "no change". */
export function glyph(art: readonly string[], c: number, r: number): string {
  if (r < 0 || r >= art.length) return '.';
  const row = art[r];
  return c < 0 || c >= row.length ? '.' : row[c];
}

// ============================================================================
// Sprites
// ============================================================================

/** An ink for `SpriteCanvas.art`: character, colour, outline colour, emissive. */
export type Ink = readonly [ch: string, c: number, ol: number, e: number];

/** A 16x16 item sprite. */
export class SpriteCanvas {
  readonly c = new Uint32Array(256);
  readonly a = new Uint8Array(256);
  readonly e = new Uint8Array(256);
  /** Outline colour this texel asks for on transparent 4-neighbours (0 = none). */
  readonly ol = new Uint32Array(256);

  put(x: number, y: number, c: number, ol: number) {
    if (within(x, 0, 15) && within(y, 0, 15)) {
      const i = y * 16 + x;
      this.c[i] = c;
      this.a[i] = 1;
      this.ol[i] = ol;
    }
  }

  glow(x: number, y: number, e: number) {
    if (within(x, 0, 15) && within(y, 0, 15)) this.e[y * 16 + x] = e;
  }

  opaque(x: number, y: number): boolean {
    return within(x, 0, 15) && within(y, 0, 15) && this.a[y * 16 + x] === 1;
  }

  /** Paints ASCII art; each ink is (char, colour, outline colour, emissive). */
  art(rows: readonly string[], ink: readonly Ink[]) {
    rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        const k = ink.find((k) => k[0] === row[x]);
        if (k) {
          const [, c, ol, e] = k;
          this.put(x, y, c, ol);
          this.glow(x, y, e);
        }
      }
    });
  }

  /** Dark outline around everything that asks for one. */
  outline() {
    const prevA = this.a.slice();
    const prevOl = this.ol.slice();
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const i = y * 16 + x;
        if (prevA[i]) continue;
        for (const [dx, dy] of [[0, -1], [-1, 0], [1, 0], [0, 1]]) {
          const [nx, ny] = [x + dx, y + dy];
          if (within(nx, 0, 15) && within(ny, 0, 15)) {
            const j = ny * 16 + nx;
            if (prevA[j] && prevOl[j] !== 0) {
              this.c[i] = prevOl[j];
              this.a[i] = 1;
              this.ol[i] = 0;
              break;
            }
          }
        }
      }
    }
  }

  blit(cv: Canvas, ox: number, oy: number) {
    for (let i = 0; i < 256; i++) {
      const [x, y] = [i % 16, Math.floor(i / 16)];
      if (this.a[i]) cv.set(ox + x, oy + y, hexc(this.c[i]), this.e[i]);
    }
  }
}

/** A one-texel line from `a` to `b` (Bresenham), drawn only over transparent texels. */
export function line(s: SpriteCanvas, a: [number, number], b: [number, number], c: number) {
  let [x, y] = a;
  const [dx, dy] = [Math.abs(b[0] - a[0]), -Math.abs(b[1] - a[1])];
  const [sx, sy] = [a[0] < b[0] ? 1 : -1, a[1] < b[1] ? 1 : -1];
  let err = dx + dy;
  for (;;) {
    if (!s.opaque(x, y)) s.put(x, y, c, 0);
    if (x === b[0] && y === b[1]) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}
