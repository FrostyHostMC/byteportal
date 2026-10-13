/**
 * The bots' iron sword: a 1x10x3 box (atlas region `SWORD`). The sword's profile is painted on
 * the two broad faces and cut out of all six, so it reads as a flat blade from any side.
 * Part space: y runs from the tip (0) to the pommel (10), z across the blade.
 */
import { type Canvas, glyph, paintBox, part, px, Px, type S } from '@platform/art';
import { IRON, LEATHER, STEEL } from './shared';

export const SWORD = [128, 64] as const;
export const SWORD_BOX = part(0, 0, 1, 10, 3);

/** Profile, tip first: t tip, e edge, B fuller, G crossguard, h grip, p pommel. */
const PROFILE = ['.t.', '.Be', '.Be', '.Be', '.Be', '.Be', '.Be', 'GGG', '.h.', '.p.'];

export function sword(cv: Canvas, ox: number, oy: number) {
  paintBox(cv, ox, oy, SWORD_BOX, swordTexel);
}

function swordTexel(s: S): Px {
  const ch = glyph(PROFILE, s.iz, s.iy);
  const broad = s.f === 'right' || s.f === 'left';
  switch (ch) {
    case 't':
      return px(STEEL, 6.0);
    case 'e':
      // the honed edge, brighter toward the tip
      return px(STEEL, (broad ? 5.4 : 5.8) + 0.6 * (1.0 - s.iy / 7.0));
    case 'B':
      return px(STEEL, 4.2 + 0.5 * (s.rnd(701) - 0.5) + 0.4 * (1.0 - s.iy / 7.0));
    case 'G':
      return px(IRON, s.iz === 1 ? 4.2 : 2.6);
    case 'h':
      return px(LEATHER, 4.0);
    case 'p':
      return px(IRON, 5.2);
    default:
      return new Px(STEEL, 3.0, 0.0, 0, false); // cut out, without the bevel's rim light
  }
}
