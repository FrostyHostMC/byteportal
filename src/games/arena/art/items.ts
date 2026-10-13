/**
 * The Arena's item sprites (16x16, with an automatic dark outline), ported from the engine's
 * `entitytex.rs`. They sit in a row at y = `ITEM_Y`, in the same cells as in the engine's
 * built-in atlas.
 */
import { type Canvas, rnd, remEuclid, SpriteCanvas } from '@platform/art';
import { bombIcon } from './bombs';

export const ITEM_Y = 128;

/** Item sprite cells: x at y = `ITEM_Y` (16 * the item's index in the engine's `ITEMS`). */
export const ITEM_X = { arrow_bundle: 160, golden_trophy: 176, soul_fireball: 192, bomb: 224 } as const;

export function items(cv: Canvas, ox: number, oy: number) {
  arrowBundle().blit(cv, ox + ITEM_X.arrow_bundle, oy);
  trophy().blit(cv, ox + ITEM_X.golden_trophy, oy);
  soulFireball().blit(cv, ox + ITEM_X.soul_fireball, oy);
  bombIcon().blit(cv, ox + ITEM_X.bomb, oy);
}

const FLINT = [0xd6d9dc, 0xa3a8ad, 0x6d7278, 0x1f2124];
const SHAFT = [0x9a7446, 0x72522c, 0x24170a];
const FEATHER = [0xf4f2ec, 0xc9c5ba, 0x3a3833];

/** Rasterises one arrow of a fanned bundle from `tail` to `tip` (pixel coordinates). */
function fanArrow(s: SpriteCanvas, tail: [number, number], tip: [number, number], twineAt: number) {
  const [dx, dy] = [tip[0] - tail[0], tip[1] - tail[1]];
  const len = Math.sqrt(dx * dx + dy * dy);
  const [ux, uy] = [dx / len, dy / len];
  const [vx, vy] = [-uy, ux];
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const [cx, cy] = [x + 0.5 - tail[0], y + 0.5 - tail[1]];
      const along = cx * ux + cy * uy;
      const across = cx * vx + cy * vy;
      const fromTip = len - along;
      if (-0.3 <= fromTip && fromTip < 3.0 && Math.abs(across) < 0.3 + fromTip * 0.45) {
        const c = across < -0.2 ? FLINT[0] : across > 0.6 ? FLINT[2] : FLINT[1];
        s.put(x, y, c, FLINT[3]);
      } else if (along >= 0.0 && fromTip >= 3.0 && Math.abs(across) < 0.55) {
        if (Math.abs(along - twineAt) < 1.0) {
          s.put(x, y, along < twineAt ? 0xd8bc88 : 0xa4834f, 0x2a1d0c);
        } else {
          s.put(x, y, (x + y) % 2 === 0 ? SHAFT[0] : SHAFT[1], SHAFT[2]);
        }
      } else if (0.4 <= along && along < 2.9 && 0.55 <= Math.abs(across) && Math.abs(across) < 1.35) {
        const c = across < 0.0 ? FEATHER[0] : FEATHER[1];
        s.put(x, y, c, FEATHER[2]);
      }
    }
  }
}

function arrowBundle(): SpriteCanvas {
  const s = new SpriteCanvas();
  // three arrows crossing at a twine binding, splayed at both ends, drawn back to front
  const tie = [6.0, 9.6];
  const arrows = [
    [19.0, 5.6, 9.9],
    [71.0, 5.4, 9.7],
    [45.0, 5.8, 10.2],
  ];
  for (const [deg, back, fwd] of arrows) {
    const rad = (deg * Math.PI) / 180.0;
    const [ux, uy] = [Math.cos(rad), -Math.sin(rad)];
    const tail: [number, number] = [tie[0] - ux * back, tie[1] - uy * back];
    const tip: [number, number] = [tie[0] + ux * fwd, tie[1] + uy * fwd];
    fanArrow(s, tail, tip, back);
  }
  s.outline();
  return s;
}

const TROPHY_ART = [
  '................',
  '..oooooooooooo..',
  '..oYYYYYYYYYYo..',
  'ooowyyyyyyyyDooo',
  'o.owyyyyyyyyDo.o',
  'o.owyyyyyyyyDo.o',
  'oo.owyyyyyyDo.oo',
  '.oooowyyyyDoooo.',
  '....oowyyDoo....',
  '......oyDo......',
  '......oyDo......',
  '.....owyyDo.....',
  '....oooooooo....',
  '....owyyyyDo....',
  '...oYYYYYYYYo...',
  '...oooooooooo...',
];

function trophy(): SpriteCanvas {
  const s = new SpriteCanvas();
  s.art(TROPHY_ART, [
    ['o', 0x3d2604, 0, 0],
    ['w', 0xfff2bd, 0, 0],
    ['Y', 0xf8da74, 0, 0],
    ['y', 0xe8bb40, 0, 0],
    ['D', 0xb27a1b, 0, 0],
  ]);
  return s;
}

/** Deep violet to white-hot, outside in. */
const SOUL = [0x240b4f, 0x3f168a, 0x6a2bd0, 0x7d6bff, 0x4fc8ff, 0x5ff0f6, 0xc4fdff, 0xffffff];

function soulFireball(): SpriteCanvas {
  const s = new SpriteCanvas();
  const [cx, cy] = [7.5, 8.3];
  const tau = 2 * Math.PI;
  // pointed flame tongues around a round core, the upward ones longest
  const tongues = [0, 1, 2, 3, 4, 5, 6].map((k) => {
    const ang = ((k + 0.35 * (rnd(k, 1, 505) - 0.5)) / 7.0) * tau - tau / 4.0;
    const up = Math.max(-Math.sin(ang), 0.0);
    return [ang, (0.45 + 0.55 * rnd(k, 2, 505)) * (0.55 + 0.6 * up)];
  });
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const [dx, dy] = [x + 0.5 - cx, y + 0.5 - cy];
      const r = Math.sqrt(dx * dx + dy * dy);
      const ang = Math.atan2(dy, dx);
      let flame = 0.0;
      for (const [ta, amp] of tongues) {
        const dth = remEuclid(ang - ta + tau * 1.5, tau) - tau * 0.5;
        flame = Math.max(flame, amp * Math.max(1.0 - Math.abs(dth) / 0.62, 0.0) ** 1.4);
      }
      const rc = 3.7 + 3.5 * flame;
      if (r > rc || (r > rc - 0.8 && rnd(x, y, 502) < 0.25)) {
        continue;
      }
      let [lvl, e] = [3, 190];
      if (r < 1.0) {
        [lvl, e] = [7, 255];
      } else if (r < 1.8) {
        [lvl, e] = [6, 255];
      } else if (r < 2.6) {
        [lvl, e] = [5, 255];
      } else if (r < 3.3) {
        [lvl, e] = [4, 210];
      } else if (r > rc - 1.0) {
        [lvl, e] = [rnd(x, y, 503) < 0.4 ? 1 : 0, 150];
      } else if (r > rc - 1.9) {
        [lvl, e] = [2, 170];
      }
      s.put(x, y, SOUL[lvl], 0);
      s.glow(x, y, e);
    }
  }
  return s;
}
