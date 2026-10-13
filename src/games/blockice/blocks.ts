import type { BlockDefinition } from '@platform';

/**
 * The arena's own blocks, painted in code: the ice and the rubber walkway round the boards, the
 * stands' seats and the crowd in them (fans in sweaters of every team, some on their feet with
 * their arms up, toques and all), the glowing ad boards, the rafters' lights.
 */

/** A steady pseudo-random number in [0, 1) for a pixel (and a seed). */
function rnd(x: number, y: number, k = 0): number {
  let h = Math.imul(x + 31, 374761393) + Math.imul(y + 17, 668265263) + Math.imul(k + 7, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const pick = <T>(list: readonly T[], r: number): T => list[Math.floor(r * list.length) % list.length];

/** Ice: white with a blue cast, skate scratches across it. */
function ice(k: number) {
  return (x: number, y: number): string => {
    const r = rnd(x, y, k);
    // A scratch: a short run along a diagonal.
    const d = (x + y * 2 + Math.floor(rnd(Math.floor((x - y) / 5), 0, k + 1) * 9)) % 11;
    if (d === 0 && rnd(x >> 2, y >> 2, k + 2) < 0.5) return '#d6e4ee';
    return r < 0.12 ? '#e9f2f8' : r < 0.2 ? '#f6fbfe' : '#eef5fa';
  };
}

const SKIN = ['#f1c9a5', '#e0a882', '#c68c62', '#9b6a46', '#6e4a30', '#4a3020'];
const HAIR = ['#2a1c14', '#3b2619', '#6b4423', '#c9a46a', '#1a1a1a', '#8a8a8a', '#a33a1c'];
/** The fans' sweaters: the home side's ice blue and the visitors' orange loudest, every team's besides. */
const SHIRTS = ['#3fa9f5', '#3fa9f5', '#ff7a1a', '#ff7a1a', '#f2f2f2', '#d8262e', '#1f8a4c', '#1d3f73', '#ffd23f', '#16181f', '#ffffff'];
/** Toques (winter hats) some wear. */
const TOQUES = ['#d8262e', '#3fa9f5', '#ffd23f', '#1f8a4c', '#ff7a1a', '#f2f2f2'];
const SEAT = '#25283a';

/**
 * Two fans side by side, seen from the front at their seats: hair (or a toque), a face, a sweater,
 * arms; in a `cheering` block one is up with both arms raised.
 */
function fansFront(k: number, cheering: boolean) {
  return (x: number, y: number): string => {
    const side = x < 8 ? 0 : 1;
    const lx = x - side * 8;
    const seed = k * 2 + side;
    const skin = pick(SKIN, rnd(seed, 1, 41));
    const toque = rnd(seed, 5, 44) < 0.35;
    const hair = toque ? pick(TOQUES, rnd(seed, 6, 45)) : pick(HAIR, rnd(seed, 2, 42));
    const shirt = pick(SHIRTS, rnd(seed, 3, 43));
    const up = cheering && side === k % 2;
    const lift = up ? -1 : 0;
    if (up && (lx === 0 || lx === 7) && y >= 0 && y <= 7) return y <= 1 ? skin : shirt;
    const hy = y - lift;
    if (toque && hy === 1 && lx >= 3 && lx <= 4) return '#ffffff';
    if (hy >= 2 && hy <= 3 && lx >= 2 && lx <= 5) return hair;
    if (hy >= 4 && hy <= 6 && lx >= 2 && lx <= 5) return hy === 5 && (lx === 3 || lx === 4) ? '#1a1410' : skin;
    if (hy === 7 && lx >= 3 && lx <= 4) return skin;
    if (hy >= 8 && hy <= 12 && lx >= 1 && lx <= 6) return hy === 10 ? '#ffffff' : shirt;
    if (!up && hy >= 9 && hy <= 13 && (lx === 0 || lx === 7)) return hy >= 12 ? skin : shirt;
    return y >= 13 ? '#181a26' : SEAT;
  };
}

/** The fans from above: the tops of their heads over their shoulders. */
function fansTop(k: number) {
  return (x: number, y: number): string => {
    const side = x < 8 ? 0 : 1;
    const lx = x - side * 8;
    const seed = k * 2 + side;
    const toque = rnd(seed, 5, 44) < 0.35;
    const hair = toque ? pick(TOQUES, rnd(seed, 6, 45)) : pick(HAIR, rnd(seed, 2, 42));
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
    const col = x >> 1;
    const on = rnd(col, 0, k) < 0.62 && (x & 1) === 0;
    if (y >= 5 && y <= 10 && on && !(y === 7 && rnd(col, 1, k) < 0.5)) return '#ffffff';
    return '#12151f';
  };
}

/** The arena's blocks, by name (the shared definition's `blocks`). */
export const BLOCKS: Record<string, BlockDefinition> = {
  ice_sheet: { label: 'Ice', texture: { top: { paint: ice(1) }, all: { color: '#cfe2ee' } }, breakable: false },
  ice_mat: { label: 'Rubber Mat', texture: { top: { color: ['#23262f', '#262a33', '#20232b'], noise: 0.12, scale: 2 }, all: { color: '#1c1f27' } }, breakable: false, picker: false },
  ice_seat: { label: 'Seat', texture: { top: { color: '#2a2e44', noise: 0.08 }, all: { color: SEAT, noise: 0.06 } }, breakable: false, picker: false },
  ice_concrete: { label: 'Arena Concrete', texture: { color: ['#3a3d4c', '#363948', '#3e4150'], noise: 0.1, scale: 3 }, breakable: false, picker: false },
  ice_wall: {
    label: 'Arena Wall',
    texture: { side: { paint: (_x, y) => (y >= 6 && y <= 7 ? '#3fa9f5' : '#1b2238') }, top: { color: '#151b2d' }, bottom: { color: '#151b2d' } },
    breakable: false,
    picker: false,
  },
  ice_ad_blue: { label: 'Ad Board', texture: { side: { paint: adBoard('#3fa9f5', 1) }, top: { color: '#0b0d14' }, bottom: { color: '#0b0d14' } }, light: 7, glow: 0.9, breakable: false, picker: false },
  ice_ad_red: { label: 'Ad Board', texture: { side: { paint: adBoard('#ff4a3d', 2) }, top: { color: '#0b0d14' }, bottom: { color: '#0b0d14' } }, light: 7, glow: 0.9, breakable: false, picker: false },
  ice_ad_gold: { label: 'Ad Board', texture: { side: { paint: adBoard('#ffd23f', 3) }, top: { color: '#0b0d14' }, bottom: { color: '#0b0d14' } }, light: 7, glow: 0.9, breakable: false, picker: false },
  /** An invisible wall round the boards: everyone stays in (the skating keeps them off the boards; this is behind it). */
  ice_barrier: { label: 'Barrier', texture: { paint: () => null }, transparency: 'cutout', breakable: false, picker: false },
  ice_fans_a: fans(0),
  ice_fans_b: fans(1),
  ice_fans_c: fans(2),
  ice_fans_d: fans(3),
  ice_fans_e: fans(4, true),
  ice_fans_f: fans(5, true),
};

/** The fan blocks, to scatter through the stands (the cheering ones a little rarer). */
export const FAN_BLOCKS = ['ice_fans_a', 'ice_fans_b', 'ice_fans_c', 'ice_fans_d', 'ice_fans_e', 'ice_fans_f'];
