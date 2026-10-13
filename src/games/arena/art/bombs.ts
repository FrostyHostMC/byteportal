/**
 * The bomb: a round iron shell with a lit fuse, as a held 3D model and its hotbar icon.
 * Part-space z = 0 is the top end of each box (where the fuse is).
 */
import { type Canvas, clamp, paintBox, part, px, type Px, type S, SpriteCanvas } from '@platform/art';
import type { HeldModelSpec } from '@platform';
import { IRON } from './shared';

export const BOMBS = [128, 64] as const;
const SHELL = part(0, 0, 5, 5, 5);
const FUSE = part(24, 0, 1, 1, 3);

const SHELL_PAL = [0x0c0d10, 0x16181c, 0x22252b, 0x30343b, 0x444952, 0x626873, 0x8a919c];
const ROPE = [0x3a2a16, 0x5a4424, 0x7a5f36, 0x9a7a4a];
const EMBER = [0xffe08a, 0xffb03a, 0xff6a1a];

/** A rounded iron shell: darker toward its edges, a glint up top. */
function shell(s: S): Px {
  const cx = s.x - s.w / 2;
  const cy = s.y - s.h / 2;
  const cz = s.z - s.d / 2;
  const r = Math.hypot(cx, cy, cz) / 3.2;
  const lit = s.f === 'top' ? 0.8 : s.f === 'bottom' ? -0.8 : 0;
  const glint = s.f === 'top' && Math.abs(cx + 1) < 1 && Math.abs(cz + 1) < 1 ? 1.4 : 0;
  return px(SHELL_PAL, clamp(3.4 - 2.2 * r + lit + glint + 0.5 * (s.rnd(901) - 0.5), 0, 6)).h(0.3);
}

/** A fuse: twisted cord, burning at its end (z = 0). */
function fuse(s: S): Px {
  if (s.z < 1) return px(EMBER, s.rnd(903) * 2).glow(230);
  return px(ROPE, 1.5 + ((Math.trunc(s.z) % 2) === 0 ? 1 : 0));
}

export function bombs(cv: Canvas, ox: number, oy: number) {
  paintBox(cv, ox, oy, SHELL, shell);
  paintBox(cv, ox, oy, FUSE, fuse);
}

const uv = (p: { u: number; v: number }): [number, number] => [BOMBS[0] + p.u, BOMBS[1] + p.v];

/** The bomb in the hand (`hold: { style: 'throw', model: BOMB_MODEL }`), and as it flies. */
export const BOMB_MODEL: HeldModelSpec = {
  atlas: 'arena',
  parts: [
    { size: [5, 5, 5], uv: uv(SHELL), offset: [-2.5, -2.5, 0] },
    { size: [1, 1, 3], uv: uv(FUSE), offset: [-0.5, -0.5, 5] },
  ],
  grip: [0, 0, 2.5],
};

/** Hotbar icon: a round black bomb, its fuse lit. */
export function bombIcon(): SpriteCanvas {
  const s = new SpriteCanvas();
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const dx = x - 7;
      const dy = y - 9.5;
      const r = Math.hypot(dx, dy);
      if (r > 5.4) continue;
      const glint = Math.hypot(dx + 2, dy + 2) < 1.3;
      const l = glint ? 6 : clamp(4 - r * 0.6 - (dx + dy) * 0.12, 0, 5);
      s.put(x, y, SHELL_PAL[Math.round(l)], SHELL_PAL[0]);
    }
  }
  // The neck, the fuse and its spark.
  s.put(7, 3, IRON[5], SHELL_PAL[0]);
  s.put(8, 3, IRON[4], SHELL_PAL[0]);
  s.put(9, 2, ROPE[3], SHELL_PAL[0]);
  s.put(10, 1, ROPE[2], SHELL_PAL[0]);
  s.outline();
  s.put(11, 0, EMBER[0], 0);
  s.glow(11, 0, 255);
  s.put(12, 1, EMBER[1], 0);
  s.glow(12, 1, 255);
  s.put(10, 0, EMBER[2], 0);
  s.glow(10, 0, 200);
  return s;
}

