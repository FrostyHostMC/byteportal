import type { BlockDefinition } from '@platform';

/**
 * The arena's own blocks, painted in code: the maple floor and its darker stain past the lines,
 * the stands' seats and the crowd in them (fans in every colour, some on their feet with their arms
 * up), the padded walls round the floor, the glowing ad boards along them, the rafters' lights.
 */

/** A steady pseudo-random number in [0, 1) for a pixel (and a seed). */
function rnd(x: number, y: number, k = 0): number {
  let h = Math.imul(x + 31, 374761393) + Math.imul(y + 17, 668265263) + Math.imul(k + 7, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const pick = <T>(list: readonly T[], r: number): T => list[Math.floor(r * list.length) % list.length];

/** Planks running across the block, 4 pixels wide, their ends staggered, a seam between rows. */
function planks(woods: readonly string[], seam: string, k: number) {
  return (x: number, y: number): string => {
    const row = y >> 2;
    const shift = Math.floor(rnd(row, 0, k) * 16);
    const along = (x + shift) % 16;
    if ((y & 3) === 3) return seam;
    if (along === 0 && rnd(row, 1, k) < 0.7) return seam;
    // Each plank its own shade; a little grain along it.
    const plank = pick(woods, rnd(row, Math.floor((x + shift) / 16), k + 2));
    return rnd(x, y, k + 5) < 0.08 ? woods[0] : plank;
  };
}

const MAPLE = ['#e2b47b', '#d9a86c', '#dcab70', '#e6bb84', '#d4a265'];
const STAIN = ['#9a5530', '#8f4c2a', '#a35d36', '#86462a'];

const SKIN = ['#f1c9a5', '#e0a882', '#c68c62', '#9b6a46', '#6e4a30', '#4a3020'];
const HAIR = ['#2a1c14', '#3b2619', '#6b4423', '#c9a46a', '#1a1a1a', '#8a8a8a', '#a33a1c'];
/** The fans' shirts: the home side's orange and the visitors' blue loudest, every colour besides. */
const SHIRTS = ['#ff6b1a', '#ff6b1a', '#2f6fe0', '#2f6fe0', '#f2f2f2', '#ffd23f', '#e0303a', '#2bb673', '#8a4fd8', '#1c1c22', '#ff7bc0'];
const SEAT = '#25283a';

/**
 * Two fans side by side, seen from the front at their seats: hair, a face, a shirt, arms; in a
 * `cheering` block one is up with both arms raised.
 */
function fansFront(k: number, cheering: boolean) {
  return (x: number, y: number): string => {
    const side = x < 8 ? 0 : 1;
    const lx = x - side * 8;
    const seed = k * 2 + side;
    const skin = pick(SKIN, rnd(seed, 1, 41));
    const hair = pick(HAIR, rnd(seed, 2, 42));
    const shirt = pick(SHIRTS, rnd(seed, 3, 43));
    const up = cheering && side === k % 2;
    const lift = up ? -1 : 0;
    // Arms up: fists over the head.
    if (up && (lx === 0 || lx === 7) && y >= 0 && y <= 7) return y <= 1 ? skin : shirt;
    const hy = y - lift;
    if (hy >= 2 && hy <= 3 && lx >= 2 && lx <= 5) return hair;
    if (hy >= 4 && hy <= 6 && lx >= 2 && lx <= 5) return hy === 5 && (lx === 3 || lx === 4) ? '#1a1410' : skin;
    if (hy === 7 && lx >= 3 && lx <= 4) return skin;
    if (hy >= 8 && hy <= 12 && lx >= 1 && lx <= 6) return shirt;
    if (!up && hy >= 9 && hy <= 13 && (lx === 0 || lx === 7)) return hy >= 12 ? skin : shirt;
    // The seat behind them.
    return y >= 13 ? '#181a26' : SEAT;
  };
}

/** The fans from above: the tops of their heads over their shoulders. */
function fansTop(k: number) {
  return (x: number, y: number): string => {
    const side = x < 8 ? 0 : 1;
    const lx = x - side * 8;
    const seed = k * 2 + side;
    const hair = pick(HAIR, rnd(seed, 2, 42));
    const shirt = pick(SHIRTS, rnd(seed, 3, 43));
    if (lx >= 2 && lx <= 5 && y >= 5 && y <= 9) return hair;
    if (lx >= 1 && lx <= 6 && y >= 3 && y <= 11) return shirt;
    return SEAT;
  };
}

const fans = (k: number, cheering = false): BlockDefinition => ({
  label: 'Fans',
  texture: { top: { paint: fansTop(k) }, bottom: { color: SEAT }, side: { paint: fansFront(k, cheering) } },
  breakable: false,
  picker: false,
});

/** An ad board's glowing message: blocky letters and a stripe, in a colour of its own. */
function adBoard(color: string, k: number) {
  return (x: number, y: number): string | null => {
    if (y <= 1 || y >= 14) return '#0b0d14';
    if (y === 2 || y === 13) return color;
    // Blocky "letters": columns of lit pixels in a band, each column on or off by the seed.
    const col = x >> 1;
    const on = rnd(col, 0, k) < 0.62 && (x & 1) === 0;
    if (y >= 5 && y <= 10 && on && !(y === 7 && rnd(col, 1, k) < 0.5)) return '#ffffff';
    return '#12151f';
  };
}

/** The arena's blocks, by name (the shared definition's `blocks`). */
export const BLOCKS: Record<string, BlockDefinition> = {
  jam_maple: { label: 'Maple Floor', texture: { top: { paint: planks(MAPLE, '#b98a52', 1) }, all: { color: '#b98a52' } }, breakable: false },
  jam_stain: { label: 'Stained Floor', texture: { top: { paint: planks(STAIN, '#6d3820', 3) }, all: { color: '#6d3820' } }, breakable: false },
  jam_seat: { label: 'Seat', texture: { top: { color: '#2a2e44', noise: 0.08 }, all: { color: SEAT, noise: 0.06 } }, breakable: false, picker: false },
  jam_concrete: { label: 'Arena Concrete', texture: { color: ['#3a3d4c', '#363948', '#3e4150'], noise: 0.1, scale: 3 }, breakable: false, picker: false },
  jam_pad: {
    label: 'Padding',
    texture: { side: { paint: (_x, y) => (y >= 6 && y <= 7 ? '#ff6b1a' : '#1b2238') }, top: { color: '#151b2d' }, bottom: { color: '#151b2d' } },
    breakable: false,
    picker: false,
  },
  jam_ad_orange: { label: 'Ad Board', texture: { side: { paint: adBoard('#ff6b1a', 1) }, top: { color: '#0b0d14' }, bottom: { color: '#0b0d14' } }, light: 7, glow: 0.9, breakable: false, picker: false },
  jam_ad_blue: { label: 'Ad Board', texture: { side: { paint: adBoard('#3d8bff', 2) }, top: { color: '#0b0d14' }, bottom: { color: '#0b0d14' } }, light: 7, glow: 0.9, breakable: false, picker: false },
  jam_ad_gold: { label: 'Ad Board', texture: { side: { paint: adBoard('#ffd23f', 3) }, top: { color: '#0b0d14' }, bottom: { color: '#0b0d14' } }, light: 7, glow: 0.9, breakable: false, picker: false },
  jam_light: { label: 'Arena Light', texture: { color: ['#fffbe8', '#fff6d6'], noise: 0.05 }, light: 15, glow: 1, breakable: false, picker: false },
  /** An invisible wall over the boards: everyone stays on the floor, the ball too (it has its own walls). */
  jam_barrier: { label: 'Barrier', texture: { paint: () => null }, transparency: 'cutout', breakable: false, picker: false },
  jam_steel: { label: 'Rafter', texture: { color: ['#4b4f5e', '#565a6b'], noise: 0.12, scale: 2 }, breakable: false, picker: false },
  jam_fans_a: fans(0),
  jam_fans_b: fans(1),
  jam_fans_c: fans(2),
  jam_fans_d: fans(3),
  jam_fans_e: fans(4, true),
  jam_fans_f: fans(5, true),
};

/** The fan blocks, to scatter through the stands (the cheering ones a little rarer). */
export const FAN_BLOCKS = ['jam_fans_a', 'jam_fans_b', 'jam_fans_c', 'jam_fans_d', 'jam_fans_e', 'jam_fans_f'];
