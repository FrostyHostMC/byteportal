import { px, type Px, type S } from '@platform/art';

// ============================================================================
// Shared palettes (darkest first)
// ============================================================================

export const IRON = [0x1c1e22, 0x2a2d32, 0x3a3e44, 0x4c5158, 0x60656d, 0x767c83, 0x8f959b, 0xb0b5ba];
export const STEEL = [0x2a2e33, 0x474d55, 0x6a717a, 0x8f969e, 0xb2b8bf, 0xd3d8dd, 0xf0f3f5];
export const LEATHER = [0x20130b, 0x2e1c10, 0x3d2616, 0x4d311c, 0x5e3d23, 0x704a2b, 0x845a35];
export const GOLD = [0x4a2c07, 0x6b420b, 0x8e5c12, 0xb27a1b, 0xd09a28, 0xe8bb40, 0xf8da74, 0xfff2bd];
export const EYE_WHITE = [0x8c9096, 0xb9bdc2, 0xe4e6e8, 0xfbfbfb];

/** Worn leather (belts, boots, bracers). */
export function leather(s: S, seed: number, l0: number): Px {
  const l = l0 + 1.1 * (s.fbm(1.8, seed) - 0.5) + 0.6 * (s.rnd(seed + 1) - 0.5);
  return px(LEATHER, l).h(0.8);
}

/** Soft cloth or dyed leather: broad folds and a little grain. */
export function cloth(s: S, pal: readonly number[], seed: number, l0: number): Px {
  const fold = s.n(1.8, 3.2, 1.8, seed);
  const l = l0 + 1.3 * (fold - 0.5) + 0.55 * (s.rnd(seed + 1) - 0.5);
  return px(pal, l).h(0.5);
}

/** Skin: smooth, barely any grain. */
export function flesh(s: S, pal: readonly number[], seed: number, l0: number): Px {
  const l = l0 + 0.7 * (s.fbm(2.2, seed) - 0.5) + 0.35 * (s.rnd(seed + 1) - 0.5);
  return px(pal, l);
}

/** Hair: vertical strands. */
export function hair(s: S, pal: readonly number[], seed: number, l0: number): Px {
  const strand = s.n(0.7, 2.6, 0.7, seed);
  const l = l0 + 1.6 * (strand - 0.5) + 0.5 * (s.rnd(seed + 1) - 0.5);
  return px(pal, l).h(0.6);
}
