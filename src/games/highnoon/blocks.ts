import type { BlockDefinition, BlockTexture } from '@platform';
import wantedPoster from './blocks/wanted_poster.png?url';

/**
 * Dry Gulch's own blocks (`defineGame({ blocks })`): sun-baked adobe, weathered boards, shingles,
 * the saloon's painted sign, saguaros and tumbleweeds, barrels, hay, lanterns, mesa rock and a
 * wanted poster. Painted in code (a colour with noise, pixel art, or a `paint` function), except the
 * poster, which is a PNG the game's tool writes.
 */

/** A small hash: the same speckle every time. */
const h = (x: number, y: number, s = 0) => {
  let v = Math.imul(x * 374761393 + y * 668265263 + s * 2147483647, 1274126177);
  v = (v ^ (v >>> 13)) >>> 0;
  return (v % 1000) / 1000;
};
const shade = (hex: string, k: number) => {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v * k)))
      .toString(16)
      .padStart(2, '0');
  return `#${c((n >> 16) & 255)}${c((n >> 8) & 255)}${c(n & 255)}`;
};

/** Boards running up and down (`vertical`) or across, each its own shade, dark seams between, a nail or two. */
const boards = (base: string, vertical: boolean, seed: number): BlockTexture => ({
  paint: (x, y) => {
    const [u, v] = vertical ? [x, y] : [y, x];
    const board = Math.floor(u / 4);
    if (u % 4 === 3) return shade(base, 0.55);
    const grain = 0.86 + h(board, 0, seed) * 0.18 + (h(u, v >> 2, seed + 1) - 0.5) * 0.12;
    if ((v === 2 || v === 13) && u % 4 === 1) return '#3a3430';
    return shade(base, grain);
  },
});

/** Shingles: staggered rows of little boards with shadowed lower edges. */
const SHINGLES: BlockTexture = {
  paint: (x, y) => {
    const row = Math.floor(y / 4);
    const off = row % 2 ? 2 : 0;
    const col = Math.floor((x + off) / 4);
    if (y % 4 === 3) return '#3b2a22';
    if ((x + off) % 4 === 0) return '#4d372b';
    return shade('#7a5440', 0.85 + h(col, row, 9) * 0.25);
  },
};

/** A tiny 5 x 7 font for the painted signs. */
const FONT: Record<string, string[]> = {
  S: ['.###.', '#....', '#....', '.###.', '....#', '....#', '###..'],
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  N: ['#...#', '##..#', '#.#.#', '#.#.#', '#..##', '#...#', '#...#'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  J: ['..###', '...#.', '...#.', '...#.', '...#.', '#..#.', '.##..'],
  I: ['.###.', '..#..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  ' ': ['.....', '.....', '.....', '.....', '.....', '.....', '.....'],
};

/**
 * A sign board with two letters painted on it (a word runs across several blocks), front and back
 * (north and south: a game's cube can't be turned, so a sign across the street is laid out the
 * other way round), plain boards on its ends.
 */
const sign = (letters: string): BlockDefinition => {
  const face: BlockTexture = {
    paint: (x, y) => {
      // Cream letters on dark red boards, a painted border top and bottom.
      if (y === 1 || y === 14) return '#e9d7a8';
      if (y === 0 || y === 15) return '#3a2216';
      const k = x < 8 ? 0 : 1;
      const ch = FONT[letters[k] ?? ' '] ?? FONT[' '];
      const gx = x - (k === 0 ? 2 : 9);
      const gy = y - 4;
      if (gx >= 0 && gx < 5 && gy >= 0 && gy < 7 && ch[gy][gx] === '#') return '#f1e2b8';
      return shade('#6e2419', 0.9 + h(x >> 2, y, 3) * 0.18);
    },
  };
  return { label: 'Painted sign', picker: false, hardness: 1, texture: { north: face, south: face, all: boards('#6b4a2e', false, 4) } };
};

export const BLOCKS: Record<string, BlockDefinition> = {
  dust: { label: 'Street dust', texture: { color: ['#c8a06a', '#bd955f', '#d1ab77', '#c29a64'], noise: 0.35, scale: 2 }, hardness: 0.6 },
  adobe: { texture: { color: ['#c78c5a', '#bf8352', '#cd9563', '#c48857'], noise: 0.25, scale: 3, seed: 2 }, hardness: 1.5 },
  adobe_trim: { label: 'Adobe trim', texture: { color: ['#8f5a34', '#99613a', '#875330'], noise: 0.2, scale: 2 }, hardness: 1.5 },
  weathered_planks: { texture: boards('#8d7a64', true, 1), hardness: 1 },
  barn_planks: { texture: boards('#8e3a2a', true, 2), hardness: 1 },
  floorboards: { texture: boards('#6e4b30', false, 3), hardness: 1 },
  boardwalk: { texture: boards('#7b5a3c', false, 5), shape: 'slab', full: 'floorboards', hardness: 1 },
  shingles: { texture: SHINGLES, shape: 'stairs', hardness: 1 },
  shingle_slab: { label: 'Shingle slab', texture: SHINGLES, shape: 'slab', hardness: 1 },
  saguaro: {
    label: 'Saguaro',
    hardness: 0.4,
    texture: {
      side: {
        pixels: [
          'g.GgGg.GgG.gGgG.',
          'gGgGgGgGgGgGgGgG',
          'gGgG.GgGgGgG.gGg',
          'gGgGgGgGgGgGgGgG',
          'gGgGgG.GgGgGgGgG',
          'gGgGgGgGgGgGgGgG',
          'g.GgGgGgG.gGgGgG',
          'gGgGgGgGgGgGgGgG',
          'gGgGgGgGgGgG.GgG',
          'gGgGgGgGgGgGgGgG',
          'gGg.GgGgGgGgGgGg',
          'gGgGgGgGgGgGgGgG',
          'gGgGgGgG.gGgGgGg',
          'gGgGgGgGgGgGgGgG',
          'g.GgGgGgGgGgG.gG',
          'gGgGgGgGgGgGgGgG',
        ],
        palette: { g: '#3d6b35', G: '#4f8243' },
      },
      top: { color: ['#4f8243', '#5b9150'], noise: 0.2 },
      bottom: { color: '#3d6b35' },
    },
  },
  tumbleweed: {
    shape: 'cross',
    solid: false,
    replaceable: true,
    texture: {
      paint: (x, y) => {
        const dx = x - 7.5;
        const dy = y - 9;
        const r = Math.hypot(dx, dy * 1.15);
        if (r > 6.8) return null;
        // A tangle of thin dry stems: rings and spokes.
        const ring = Math.abs(Math.sin(r * 1.7 + Math.atan2(dy, dx) * 2)) < 0.28;
        const spoke = Math.abs(Math.sin(Math.atan2(dy, dx) * 5 + r * 0.6)) < 0.18;
        return ring || spoke ? (h(x, y, 7) > 0.5 ? '#a98752' : '#8a6a3d') : null;
      },
    },
  },
  sign_sa: sign('SA'),
  sign_lo: sign('LO'),
  sign_on: sign('ON'),
  sign_ba: sign('BA'),
  sign_nk: sign('NK'),
  sign_ja: sign('JA'),
  sign_il: sign('IL'),
  sign_st: sign('ST'),
  sign_or: sign('OR'),
  sign_e: sign('E '),
  wanted_poster: { label: 'Wanted poster', texture: { side: wantedPoster, all: boards('#5a3a1e', true, 6) }, hardness: 0.8 },
  lantern: {
    light: 14,
    glow: 0.9,
    transparency: 'cutout',
    hardness: 0.3,
    texture: {
      paint: (x, y) => {
        if (x < 3 || x > 12 || y < 2) return null;
        if (y < 4) return x > 5 && x < 10 ? '#2a2522' : null;
        if (x === 3 || x === 12 || y === 4 || y === 14 || y === 15) return '#2a2522';
        return h(x, y, 11) > 0.3 ? '#ffd37a' : '#ffb347';
      },
    },
  },
  hay_bale: {
    hardness: 0.5,
    texture: {
      top: { color: ['#d9b35c', '#c9a24c', '#e2c06d'], noise: 0.45, scale: 1 },
      bottom: { color: ['#d9b35c', '#c9a24c'], noise: 0.45, scale: 1 },
      side: {
        paint: (x, y) => (y === 4 || y === 11 ? '#7a5a2a' : shade('#d4ae58', 0.85 + h(x, y >> 1, 12) * 0.3)),
      },
    },
  },
  barrel: {
    hardness: 0.8,
    texture: {
      top: {
        paint: (x, y) => {
          const r = Math.hypot(x - 7.5, y - 7.5);
          return r > 7.2 ? '#4a4038' : r > 6.2 ? '#6a4b30' : shade('#8a6440', 0.9 + h(x >> 2, 0, 13) * 0.15);
        },
      },
      bottom: { color: '#6a4b30' },
      side: {
        paint: (x, y) => (y === 2 || y === 3 || y === 12 || y === 13 ? '#4a4038' : x % 4 === 3 ? '#5a3f28' : shade('#8a6440', 0.88 + h(x >> 2, 0, 14) * 0.2)),
      },
    },
  },
  crate: {
    hardness: 0.8,
    texture: {
      paint: (x, y) => {
        if (x < 2 || x > 13 || y < 2 || y > 13) return '#5c4128';
        if (Math.abs(x - y) < 1.5 || Math.abs(x + y - 15) < 1.5) return '#6e4f31';
        return shade('#a07a4a', 0.88 + h(x, y >> 2, 15) * 0.18);
      },
    },
  },
  iron_bars: {
    label: 'Iron bars',
    transparency: 'cutout',
    hardness: 5,
    texture: { paint: (x, y) => (x % 5 === 2 || y === 1 || y === 14 ? (h(x, y, 16) > 0.5 ? '#3a3d42' : '#4a4e55') : null) },
  },
  mesa_rock: {
    label: 'Mesa rock',
    hardness: 2,
    texture: {
      paint: (x, y) => {
        const band = ['#a0522d', '#b5653a', '#8b4726', '#c07a4a', '#a45a33'][Math.floor((y + Math.floor(h(x >> 2, 0, 17) * 2)) / 3) % 5];
        return shade(band, 0.9 + h(x, y, 18) * 0.18);
      },
    },
  },
};
