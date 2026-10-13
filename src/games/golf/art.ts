import type { AtlasPixels } from '@platform';

/**
 * The bag's sprites, painted in code into the 'golf' atlas: each club a 16 × 16 sprite lying on
 * the diagonal (grip at the bottom left, head at the top right, as held items are drawn), with a
 * dark outline. Row 0 of the atlas holds the clubs in the bag's order, then the ball.
 */
export const ATLAS_NAME = 'golf';
const SIZE = 256;

type RGB = [number, number, number];
const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

class Sprite {
  px: (RGB | null)[] = new Array(256).fill(null);
  set(x: number, y: number, c: string | RGB) {
    const xi = Math.round(x);
    const yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi > 15 || yi > 15) return;
    this.px[yi * 16 + xi] = typeof c === 'string' ? hex(c) : c;
  }
  line(x0: number, y0: number, x1: number, y1: number, c: (t: number) => string) {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    for (let i = 0; i <= n; i++) this.set(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, c(i / n));
  }
  blob(cx: number, cy: number, rx: number, ry: number, c: (x: number, y: number) => string) {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1.05) this.set(x, y, c(x, y));
  }
  /** A dark outline round everything drawn. */
  outline() {
    const out = [...this.px];
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        if (this.px[y * 16 + x]) continue;
        const near = [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ].some(([dx, dy]) => {
          const nx = x + dx;
          const ny = y + dy;
          return nx >= 0 && ny >= 0 && nx < 16 && ny < 16 && this.px[ny * 16 + nx];
        });
        if (near) out[y * 16 + x] = hex('#15171b');
      }
    this.px = out;
  }
}

/** The shaft: grip at the bottom left, steel up to the head. */
function shaft(s: Sprite, to: [number, number]) {
  s.line(2, 14, to[0], to[1], (t) => (t < 0.28 ? '#26272b' : t < 0.3 ? '#6b6f78' : t < 0.65 ? '#c8cdd5' : '#aab0ba'));
}

function wood(crown: string, r: number): Sprite {
  const s = new Sprite();
  shaft(s, [10, 6]);
  s.blob(12, 3.5, r, r * 0.85, (x, y) => (x + y < 13 ? crown : x > 12 + r * 0.5 ? '#c4c9d1' : '#1b1f2a'));
  s.outline();
  return s;
}

function iron(accent: string, loft: number): Sprite {
  const s = new Sprite();
  shaft(s, [11, 5]);
  // The blade: a slanted plate, a line of colour in its back.
  for (let i = 0; i < 5; i++)
    for (let j = 0; j < 3 + loft; j++) {
      const x = 10 + i + Math.floor(j * 0.5);
      const y = 1 + j - Math.floor(i * 0.3);
      s.set(x, y + 2, j === 1 ? accent : j === 0 ? '#f1f3f6' : '#cfd4dc');
    }
  s.outline();
  return s;
}

function putter(): Sprite {
  const s = new Sprite();
  shaft(s, [11, 5]);
  for (let x = 9; x <= 15; x++) {
    s.set(x, 3, '#3a3d45');
    s.set(x, 4, x > 10 && x < 14 ? '#e8c35a' : '#2a2c33');
  }
  s.set(11, 5, '#2a2c33');
  s.outline();
  return s;
}

function ball(): Sprite {
  const s = new Sprite();
  s.blob(7.5, 7.5, 5.5, 5.5, (x, y) => ((x * 3 + y * 5) % 7 === 0 ? '#e2e4e6' : x + y < 13 ? '#ffffff' : '#f0f2f4'));
  s.outline();
  return s;
}

export function paintAtlas(): AtlasPixels {
  const sprites: [string, Sprite][] = [
    ['driver', wood('#3c6fd6', 3.2)],
    ['wood3', wood('#39a254', 2.7)],
    ['hybrid4', wood('#c94545', 2.3)],
    ['iron5', iron('#3c6fd6', 0)],
    ['iron7', iron('#39a254', 1)],
    ['iron9', iron('#e08a2c', 1)],
    ['pw', iron('#e8c35a', 2)],
    ['sw', iron('#8c5a34', 2)],
    ['putter', putter()],
    ['ball', ball()],
  ];
  const pixels = new Uint8Array(SIZE * SIZE * 4);
  sprites.forEach(([id, s], i) => {
    const ox = i * 16;
    void id;
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const c = s.px[y * 16 + x];
        if (!c) continue;
        const k = (y * SIZE + ox + x) * 4;
        pixels[k] = c[0];
        pixels[k + 1] = c[1];
        pixels[k + 2] = c[2];
        pixels[k + 3] = 255;
      }
  });
  return { width: SIZE, height: SIZE, pixels };
}

/** A club's (or the ball's) sprite in the atlas. */
export function spriteOf(id: string): { atlas: string; x: number; y: number } {
  const order = ['driver', 'wood3', 'hybrid4', 'iron5', 'iron7', 'iron9', 'pw', 'sw', 'putter', 'ball'];
  return { atlas: ATLAS_NAME, x: Math.max(0, order.indexOf(id)) * 16, y: 0 };
}
