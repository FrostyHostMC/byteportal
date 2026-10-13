import type { GameContext } from '@platform';

/**
 * The pulp wardrobe: player skins painted in code, in the classic 64x32 Minecraft layout (the
 * one the platform's humanoid uses: head, body, one arm and one leg, mirrored for the other
 * side). Black suits and skinny ties, a yellow tracksuit, a bowling shirt, a powder-blue tux,
 * a leather jacket, a Hawaiian shirt and shades, a diner uniform, a pinstripe mobster.
 *
 * Every skin's arm is sleeve at the top, a cuff, then the hand in the bottom three rows: that's
 * what the first-person view shows round a gun.
 */

export const ATLAS = 'cob';
const SIZE = 256;

type RGB = [number, number, number];
const hex = (v: number): RGB => [(v >> 16) & 255, (v >> 8) & 255, v & 255];

export interface Outfit {
  name: string;
  skin: number;
  hair: number;
  hairStyle: 'slick' | 'bob' | 'pony' | 'pomp' | 'buzz' | 'fedora' | 'short';
  /** Jacket (open over the shirt), or null for shirt sleeves. */
  jacket: number | null;
  shirt: number;
  tie: number | null;
  pants: number;
  shoes: number;
  /** Short sleeves (the forearm is bare). */
  shortSleeves?: boolean;
  /** Shades over the eyes. */
  shades?: boolean;
  lips?: number;
  /** A stripe down the sides (tracksuit), pinstripes (suit), flowers (Hawaiian), a dress. */
  pattern?: 'stripe' | 'pinstripe' | 'flowers' | 'dress' | 'panel' | 'ruffle';
  accent?: number;
}

export const OUTFITS: Outfit[] = [
  { name: 'The Hitman', skin: 0xe2b38e, hair: 0x1a1512, hairStyle: 'slick', jacket: 0x17171b, shirt: 0xf4f1ea, tie: 0x0c0c0e, pants: 0x17171b, shoes: 0x0a0a0a },
  { name: 'The Partner', skin: 0x6b4630, hair: 0x121010, hairStyle: 'buzz', jacket: 0x17171b, shirt: 0xf4f1ea, tie: 0xb3202a, pants: 0x17171b, shoes: 0x0a0a0a },
  { name: 'The Bride', skin: 0xf0c9a4, hair: 0xe8c65a, hairStyle: 'pony', jacket: null, shirt: 0xf2c418, tie: null, pants: 0xf2c418, shoes: 0xf2c418, pattern: 'stripe', accent: 0x121212 },
  { name: 'The Wife', skin: 0xf3d5bd, hair: 0x0d0b0b, hairStyle: 'bob', jacket: null, shirt: 0xf7f5f0, tie: null, pants: 0x121214, shoes: 0x121214, lips: 0xc2182b },
  { name: 'The Bowler', skin: 0xd7a179, hair: 0x5a3a1e, hairStyle: 'pomp', jacket: null, shirt: 0xd63a2f, tie: null, pants: 0x2d4e86, shoes: 0x2a1a10, shortSleeves: true, pattern: 'panel', accent: 0xf4efe2 },
  { name: 'The Crooner', skin: 0xc48a62, hair: 0x241810, hairStyle: 'slick', jacket: 0x8fc2ea, shirt: 0xffffff, tie: 0x111111, pants: 0x8fc2ea, shoes: 0x1a1a1a, pattern: 'ruffle' },
  { name: 'The Boxer', skin: 0xe8b894, hair: 0xd9b25a, hairStyle: 'short', jacket: 0x6b3a1f, shirt: 0xf1eee6, tie: null, pants: 0x3a5a8c, shoes: 0x2a1a10 },
  { name: 'The Kahuna', skin: 0xb8784e, hair: 0x2a1c12, hairStyle: 'short', jacket: null, shirt: 0x1fa3a0, tie: null, pants: 0xcbb68a, shoes: 0x7a4a26, shortSleeves: true, shades: true, pattern: 'flowers', accent: 0xff5c8a },
  { name: 'The Waitress', skin: 0xf0c8a8, hair: 0xb8421e, hairStyle: 'pony', jacket: null, shirt: 0xf49ac1, tie: null, pants: 0xf0c8a8, shoes: 0xf7f5f0, pattern: 'dress', accent: 0xffffff, lips: 0xd01c3a },
  { name: 'The Boss', skin: 0x8a5a3c, hair: 0x2b2b30, hairStyle: 'fedora', jacket: 0x3a3a44, shirt: 0x1c1c22, tie: 0xd9b030, pants: 0x3a3a44, shoes: 0x0a0a0a, pattern: 'pinstripe', accent: 0x8a8a96, shades: true },
];

/** Where outfit `i` is in the atlas (its 64x32 skin's origin). */
export const skinOrigin = (i: number): [number, number] => [(i % 4) * 64, Math.floor(i / 4) * 32];

class Paint {
  readonly px = new Uint8Array(SIZE * SIZE * 4);
  constructor(private seed: number) {}

  set(x: number, y: number, c: RGB, shade = 0) {
    const n = ((Math.sin(x * 12.9898 + y * 78.233 + this.seed) * 43758.5453) % 1 + 1) % 1;
    const k = 1 + shade + (n - 0.5) * 0.06;
    const i = (y * SIZE + x) * 4;
    this.px[i] = Math.max(0, Math.min(255, c[0] * k));
    this.px[i + 1] = Math.max(0, Math.min(255, c[1] * k));
    this.px[i + 2] = Math.max(0, Math.min(255, c[2] * k));
    this.px[i + 3] = 255;
  }

  rect(x: number, y: number, w: number, h: number, f: (i: number, j: number) => [RGB, number] | RGB) {
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++) {
        const r = f(i, j);
        if (Array.isArray(r[0])) this.set(x + i, y + j, r[0] as RGB, r[1] as number);
        else this.set(x + i, y + j, r as RGB);
      }
  }
}

/** Box faces (classic layout) for a part of size w x h x d at (u, v). */
function faces(u: number, v: number, w: number, h: number, d: number) {
  return {
    top: [u + d, v, w, d],
    bottom: [u + d + w, v, w, d],
    right: [u, v + d, d, h],
    front: [u + d, v + d, w, h],
    left: [u + d + w, v + d, d, h],
    back: [u + 2 * d + w, v + d, w, h],
  } as Record<'top' | 'bottom' | 'right' | 'front' | 'left' | 'back', [number, number, number, number]>;
}

function paintOutfit(p: Paint, o: Outfit, ox: number, oy: number) {
  const skin = hex(o.skin);
  const skinDark = hex(o.skin).map((c) => c * 0.8) as RGB;
  const hair = hex(o.hair);
  const shirt = hex(o.shirt);
  const pants = hex(o.pants);
  const shoes = hex(o.shoes);
  const jacket = o.jacket === null ? null : hex(o.jacket);
  const tie = o.tie === null ? null : hex(o.tie);
  const accent = o.accent === undefined ? null : hex(o.accent);
  const top = (j: number, h: number) => 0.07 - (j / Math.max(1, h - 1)) * 0.16;

  // ---------------------------------------------------------------- head
  const head = faces(ox, oy, 8, 8, 8);
  const hairRows = { slick: 2, bob: 3, pony: 2, pomp: 2, buzz: 1, fedora: 3, short: 2 }[o.hairStyle];
  for (const [name, [x, y, w, h]] of Object.entries(head)) {
    p.rect(x, y, w, h, (i, j) => {
      if (name === 'top') return o.hairStyle === 'fedora' ? [hex(o.hair), (i + j) % 7 === 0 ? 0.1 : 0] : [hair, 0.05];
      if (name === 'bottom') return [skinDark, -0.1];
      if (name === 'back') {
        const long = o.hairStyle === 'bob' ? 7 : o.hairStyle === 'pony' ? 6 : o.hairStyle === 'fedora' ? 3 : hairRows + 2;
        if (o.hairStyle === 'pony' && j >= 5 && i >= 3 && i <= 4) return [hair, 0.05];
        return j < long ? [hair, top(j, 8)] : [skin, -0.05];
      }
      if (name === 'right' || name === 'left') {
        const side = o.hairStyle === 'bob' ? (j < 6 ? 1 : 0) : j < hairRows + (name === 'right' ? (i > 4 ? 1 : 0) : i < 3 ? 1 : 0) ? 1 : 0;
        if (o.hairStyle === 'fedora' && j === 2) return [accent ?? hex(0x111111), 0];
        return side ? [hair, top(j, 8)] : [skin, 0];
      }
      // Front: hair line, brows, eyes, nose, mouth.
      if (o.hairStyle === 'fedora') {
        if (j < 2) return [hair, 0.05];
        if (j === 2) return [accent ?? hex(0x111111), 0];
      }
      if (j < hairRows - (o.hairStyle === 'bob' ? 0 : 1)) return [hair, 0.08];
      if (o.hairStyle === 'bob' && (i === 0 || i === 7) && j < 6) return [hair, 0];
      if (o.hairStyle === 'pomp' && j === 1 && i > 1 && i < 7) return [hair, 0.15];
      if (j === 3 && ((i >= 1 && i <= 2) || (i >= 5 && i <= 6))) return [hair, -0.1];
      if (j === 4) {
        if (o.shades) return i >= 1 && i <= 6 ? [hex(0x0a0a0c), i === 2 || i === 5 ? 0.6 : 0] : [skin, 0];
        if (i === 1 || i === 6) return [hex(0xf4f4f0), 0];
        if (i === 2 || i === 5) return [hex(0x2a1c14), 0];
      }
      if (j === 5 && (i === 3 || i === 4)) return [skinDark, 0];
      if (j === 6 && i >= 2 && i <= 5) return [o.lips ? hex(o.lips) : (skin.map((c) => c * 0.62) as RGB), 0];
      return [skin, 0];
    });
  }

  // ---------------------------------------------------------------- body
  const body = faces(ox + 16, oy + 16, 8, 12, 4);
  for (const [name, [x, y, w, h]] of Object.entries(body)) {
    p.rect(x, y, w, h, (i, j) => {
      const sh = top(j, h);
      if (name === 'top') return [jacket ?? shirt, 0.08];
      if (name === 'bottom') return [pants, -0.1];
      if (o.pattern === 'dress') {
        // A pink diner uniform with a white collar and apron.
        if (name === 'front' && j === 0) return [accent!, 0];
        if (name === 'front' && j >= 6 && i >= 2 && i <= 5) return [accent!, -0.02];
        if (j === 6) return [hex(0xb03060), 0];
        return [shirt, sh];
      }
      if (o.pattern === 'stripe' && (name === 'right' || name === 'left') && (i === 1 || i === 2)) return [accent!, 0];
      if (o.pattern === 'stripe' && name === 'front' && j === 0) return [accent!, 0];
      if (name === 'front') {
        // An open jacket: lapels either side, the shirt and tie down the middle.
        if (jacket) {
          const lapel = i <= 2 || i >= 5;
          if (lapel) {
            if (o.pattern === 'pinstripe' && i % 2 === 0) return [accent!, sh];
            if (j < 5 && (i === 2 || i === 5)) return [jacket, 0.12]; // lapel edge
            if (j === 5 && (i === 1 || i === 6)) return [hex(0xdddddd), 0]; // a button
            return [jacket, sh];
          }
          if (tie && j >= 1 && j <= 9 && (i === 3 || i === 4)) return [tie, j === 1 ? 0.1 : sh];
          if (o.pattern === 'ruffle' && j >= 1 && j <= 5) return [shirt, (j % 2) * -0.08];
          if (j === 0 && tie && (i === 3 || i === 4)) return [tie, 0.1];
          return [shirt, j === 0 ? 0.05 : 0];
        }
        if (o.pattern === 'panel' && (i === 2 || i === 5)) return [accent!, sh];
        if (o.pattern === 'flowers' && ((i * 3 + j * 5) % 7 === 0 || (i * 5 + j * 3) % 11 === 0)) return [(i + j) % 2 ? accent! : hex(0xffe066), 0];
        if (j === 0 && (i === 3 || i === 4)) return [skin, 0]; // open collar
        if (j >= 10) return [hex(0x2a1a10), 0]; // belt
        return [shirt, sh];
      }
      if (j >= 10 && !jacket) return [hex(0x2a1a10), 0];
      if (o.pattern === 'flowers' && ((i * 3 + j * 5 + (name === 'back' ? 2 : 0)) % 7 === 0)) return [accent!, 0];
      if (o.pattern === 'pinstripe' && jacket && i % 2 === 0) return [accent!, sh];
      return [jacket ?? shirt, sh];
    });
  }

  // ---------------------------------------------------------------- arm: sleeve, cuff, hand
  const arm = faces(ox + 40, oy + 16, 4, 12, 4);
  const sleeveEnd = o.shortSleeves ? 3 : 8;
  for (const [name, [x, y, w, h]] of Object.entries(arm)) {
    p.rect(x, y, w, h, (i, j) => {
      if (name === 'top') return [jacket ?? shirt, 0.08];
      if (name === 'bottom') return [skinDark, -0.05];
      if (j < sleeveEnd) {
        if (o.pattern === 'stripe' && (name === 'right' || name === 'left') && (i === 1 || i === 2)) return [accent!, 0];
        if (o.pattern === 'pinstripe' && jacket && i % 2 === 0) return [accent!, top(j, 12)];
        if (o.pattern === 'flowers' && (i * 3 + j * 5) % 7 === 0) return [accent!, 0];
        return [jacket ?? shirt, top(j, 12)];
      }
      if (j === sleeveEnd && !o.shortSleeves) return [jacket ? shirt : (shirt.map((c) => c * 0.85) as RGB), 0.05]; // cuff
      // The hand (and a bare forearm): knuckles a shade darker on the last row.
      return [skin, j === 11 ? -0.12 : j === 10 ? -0.04 : 0.02];
    });
  }

  // ---------------------------------------------------------------- leg: trousers, shoes
  const leg = faces(ox, oy + 16, 4, 12, 4);
  for (const [name, [x, y, w, h]] of Object.entries(leg)) {
    p.rect(x, y, w, h, (i, j) => {
      if (name === 'top') return [pants, 0];
      if (name === 'bottom') return [shoes, -0.2];
      if (o.pattern === 'dress') return j < 4 ? [shirt, -0.05] : j >= 10 ? [shoes, 0] : [skin, 0];
      if (o.pattern === 'stripe' && (name === 'right' || name === 'left') && (i === 1 || i === 2) && j < 10) return [accent!, 0];
      if (o.pattern === 'pinstripe' && i % 2 === 0 && j < 10) return [accent!, top(j, 12)];
      if (j >= 10) return [shoes, j === 11 ? -0.15 : 0.05];
      if (o.shortSleeves && o.pattern === 'flowers' && j >= 6) return [skin, 0]; // shorts
      return [pants, top(j, 12) * 0.6];
    });
  }
}

/** The whole wardrobe as one atlas. */
export function paintAtlas(): Uint8Array {
  const p = new Paint(7);
  OUTFITS.forEach((o, i) => {
    const [x, y] = skinOrigin(i);
    paintOutfit(p, o, x, y);
  });
  return p.px;
}

export function defineArt(game: GameContext) {
  game.items.atlas(ATLAS, { width: SIZE, height: SIZE, pixels: paintAtlas() });
}
