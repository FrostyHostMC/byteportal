import { px, type Px, type S } from '@platform/art';

// ============================================================================
// Shared palettes
// ============================================================================

export const IRON = [0x1c1e22, 0x2a2d32, 0x3a3e44, 0x4c5158, 0x60656d, 0x767c83, 0x8f959b, 0xb0b5ba];
export const LEATHER = [0x20130b, 0x2e1c10, 0x3d2616, 0x4d311c, 0x5e3d23, 0x704a2b, 0x845a35];
export const IVORY = [0x7a6f55, 0xa3977a, 0xc6ba98, 0xdfd5b6, 0xf2ecd8];
export const VOID = [0x050506, 0x0b0a0c, 0x131115, 0x1c191d];
export const GOLD = [0x4a2c07, 0x6b420b, 0x8e5c12, 0xb27a1b, 0xd09a28, 0xe8bb40, 0xf8da74, 0xfff2bd];

export function iron(s: S, seed: number, l0: number): Px {
  let l = l0 + 1.1 * (s.fbm(2.5, seed) - 0.5) + 0.6 * (s.rnd(seed + 1) - 0.5);
  if (s.rnd(seed + 2) < 0.05) {
    l += 1.5; // scratch glints
  }
  return px(IRON, l);
}
