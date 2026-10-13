/**
 * The Arena's mob skins, ported from the engine's `entitytex.rs`. Each skin is a 64x64 region;
 * box origins are listed in the `*_HEAD`, `*_BODY`, ... constants (relative to the region).
 *
 * The warden's crown (10x4x10) is an open ring: points on the side faces are cut out of the
 * top two rows and the top/bottom faces are transparent inside a thin gold rim, so the head
 * shows through whether the crown sits on or around the head.
 */
import { type Canvas, f32, glyph, hash3, paintBox, part, px, type Px, remEuclid, type S, unit, within } from '@platform/art';
import { GOLD, iron, IRON, IVORY, LEATHER, VOID } from './shared';

// ============================================================================
// Layout
// ============================================================================

export const ZOMBIE = [0, 0] as const;
export const BRUTE = [64, 0] as const;
export const WARDEN = [128, 0] as const;
export const SKELETON = [0, 64] as const;
export const SPIDER = [64, 64] as const;

export const ZOMBIE_HEAD = part(0, 0, 8, 8, 8);
export const ZOMBIE_BODY = part(16, 16, 8, 12, 4);
export const ZOMBIE_ARM = part(40, 16, 4, 12, 4);
export const ZOMBIE_LEG = part(0, 16, 4, 12, 4);

/** Shared by the brute and the warden. */
export const BIG_HEAD = part(0, 0, 10, 10, 10);
export const BIG_BODY = part(0, 20, 14, 14, 8);
export const BIG_ARM = part(44, 20, 5, 15, 5);
export const BIG_LEG = part(0, 42, 6, 12, 6);
export const CROWN = part(24, 42, 10, 4, 10);

export const SKELETON_HEAD = part(0, 0, 8, 8, 8);
export const SKELETON_BODY = part(16, 16, 8, 12, 4);
export const SKELETON_ARM = part(40, 16, 2, 12, 2);
export const SKELETON_LEG = part(0, 16, 2, 12, 2);

export const SPIDER_HEAD = part(32, 4, 8, 8, 8);
export const SPIDER_THORAX = part(0, 0, 6, 6, 6);
export const SPIDER_ABDOMEN = part(0, 12, 10, 8, 12);
export const SPIDER_LEG = part(18, 0, 16, 2, 2);

// ============================================================================
// Zombie
// ============================================================================

const Z_SKIN = [0x14281d, 0x1d3827, 0x274a32, 0x325d3e, 0x3f714a, 0x4f8557, 0x639966, 0x7cad7b];
const Z_GREY = [0x1e2622, 0x2a342f, 0x37433d, 0x46524b, 0x56625a, 0x68746b, 0x7c887e];
const Z_SHIRT = [0x13243a, 0x192f49, 0x213c5a, 0x2a4b6b, 0x365b7c, 0x456d8d, 0x59819d, 0x7196ad];
const Z_PANTS = [0x100e24, 0x171432, 0x1f1b42, 0x282351, 0x312b60, 0x3b346f, 0x48407e];
const Z_HAIR = [0x111812, 0x19241b, 0x223024, 0x2c3d2e, 0x384a38];
const MAW = [0x060707, 0x100a0a, 0x251010, 0x401a17, 0x5c2621];
const Z_TEETH = [0x6e6a4e, 0x979172, 0xbdb693];
const Z_EYE = [0xa8c860, 0xdcf08c];

export function zombie(cv: Canvas, ox: number, oy: number) {
  paintBox(cv, ox, oy, ZOMBIE_HEAD, zombieHead);
  paintBox(cv, ox, oy, ZOMBIE_BODY, zombieBody);
  paintBox(cv, ox, oy, ZOMBIE_ARM, zombieArm);
  paintBox(cv, ox, oy, ZOMBIE_LEG, zombieLeg);
}

/** Mottled, rotting skin. */
function zSkin(s: S, seed: number): Px {
  const m = s.fbm(2.5, seed);
  const blot = s.n1(1.4, seed + 7);
  let l = 4.3 + 2.4 * (m - 0.5) + 0.9 * (s.rnd(seed + 3) - 0.5);
  if (blot < 0.25) {
    l -= 1.3;
  } else if (blot > 0.8) {
    l += 0.8;
  }
  return px(Z_SKIN, l);
}

const ZOMBIE_FACE = [
  '........',
  '........',
  '.bb..bb.',
  '.oo..oo.',
  '.og..go.',
  '...nN.w.',
  '.mtmmtw.',
  '..mMMm..',
];

function zombieHead(s: S): Px {
  const p = zSkin(s, 11);
  p.l += 0.5 - 1.0 * s.y / 8.0;
  // Thin, patchy hair: a cap that reaches lower at the back.
  const hl = 0.9 + 2.6 * s.z / 8.0 + 1.4 * (s.n1(1.2, 13) - 0.5);
  const hair = s.f === 'top' ? s.n1(1.6, 14) > 0.28 : s.f === 'bottom' ? false : s.y < hl;
  if (hair) {
    const l = 2.0 + 2.4 * (s.fbm(1.5, 15) - 0.5) + 1.2 * (s.rnd(16) - 0.5);
    return px(Z_HAIR, l).h(0.6);
  }
  switch (s.f) {
    case 'front':
      switch (glyph(ZOMBIE_FACE, s.c, s.r)) {
        case 'b':
          return p.dl(-0.7).h(0.4);
        case 'o':
          return px(MAW, 0.0).h(-1.0);
        case 'g':
          return px(Z_EYE, 0.0).glow(40);
        case 'n':
          return px(MAW, 1.0).h(-1.0);
        case 'N':
          return p.dl(-1.4);
        case 'm':
          return px(MAW, 0.5).h(-1.0);
        case 'M':
          return px(MAW, 2.4).h(-1.0);
        case 't':
          return px(Z_TEETH, 2.0).h(-0.4);
        case 'w':
          return px(MAW, 3.2).h(-0.6);
        default:
          return p;
      }
    case 'right':
    case 'left':
      // a sunken ear
      if (within(s.iz, 3, 4) && within(s.iy, 3, 5)) {
        const rim = s.iz === 3 || s.iy === 3;
        return p.dl(rim ? 0.4 : -1.3).h(rim ? 0.5 : -0.5);
      }
      return p;
    case 'bottom':
      return p.dl(-1.0);
    default:
      return p;
  }
}

/** Faded, grimy shirt fabric. */
function zShirt(s: S, seed: number): Px {
  const fold = s.n(1.6, 5.0, 1.6, seed);
  let l = 4.1 + 2.3 * (fold - 0.5) + 0.8 * (s.rnd(seed + 1) - 0.5) - 1.0 * s.y / s.h;
  const blot = s.n1(2.2, seed + 2);
  if (blot > 0.72) {
    l += 0.9; // sun-bleached
  } else if (blot < 0.2) {
    l -= 1.2; // grime
  }
  return px(Z_SHIRT, l).h(0.5);
}

function zPants(s: S, seed: number): Px {
  const fold = s.n(1.4, 3.0, 1.4, seed);
  const l = 3.2 + 2.0 * (fold - 0.5) + 0.8 * (s.rnd(seed + 1) - 0.5);
  return px(Z_PANTS, l);
}

/** Rips in the shirt: centre (part space) and radius. */
const Z_RIPS: readonly (readonly [readonly [number, number, number], number])[] = [
  [[5.7, 4.3, 0.0], 1.25],
  [[8.0, 6.8, 2.3], 1.15],
  [[2.3, 3.5, 4.0], 1.3],
  [[5.9, 8.2, 4.0], 0.85],
  [[0.0, 2.4, 1.4], 0.9],
];

function zombieBody(s: S): Px {
  switch (s.f) {
    case 'bottom':
      return zPants(s, 31);
    case 'top':
      if (within(s.ix, 2, 5) && s.iz <= 1) {
        return zSkin(s, 33).dl(-0.8);
      }
      return zShirt(s, 35).dl(0.6);
  }
  // Trousers from the waist, under a ragged shirt hem.
  const hem = 9.3 + 2.2 * s.pn(1.7, 37) - (s.pr(38) < 0.18 ? 1.0 : 0.0);
  if (s.y > hem) {
    const p = zPants(s, 31);
    if (s.iy === 10) {
      p.l -= 0.6;
    }
    return p;
  }
  // V-neck collar
  if (s.f === 'front' && ((s.r === 0 && within(s.c, 2, 5)) || (s.r === 1 && within(s.c, 3, 4)))) {
    return zSkin(s, 33).dl(-0.3);
  }
  for (const [k, [ctr, rad]] of Z_RIPS.entries()) {
    const dd = s.dist(ctr, 0.8) + 0.7 * (s.n1(0.9, 40 + k) - 0.5);
    if (dd < rad) {
      return zSkin(s, 33).dl(-0.4);
    }
    if (dd < rad + 0.55) {
      return zShirt(s, 35).dl(1.2).h(0.7); // frayed threads
    }
  }
  const p = zShirt(s, 35);
  if (s.f === 'right' || s.f === 'left') {
    p.l -= 0.4; // under the arms
  }
  if (s.f === 'front' && s.r >= 2) {
    if (s.c === 3) {
      p.l -= 1.0; // placket seam
    } else if (s.c === 4 && (s.r === 3 || s.r === 6)) {
      return px(Z_TEETH, 0.6).h(0.9); // bone buttons
    }
  }
  return p;
}

function zHand(s: S): Px {
  let l = 3.8 + 1.6 * (s.fbm(1.5, 51) - 0.5) + 0.8 * (s.rnd(52) - 0.5) - 0.45 * Math.max(s.y - 9.0, 0.0);
  if (s.f === 'bottom') {
    l -= 0.6;
    if (s.c % 2 === 1) {
      l -= 1.0; // fingertips
    }
  } else if (s.iy >= 10 && s.c % 2 === 1) {
    l -= 1.2; // finger gaps
  }
  return px(Z_GREY, l);
}

function zombieArm(s: S): Px {
  switch (s.f) {
    case 'top':
      return zShirt(s, 43).dl(0.5);
    case 'bottom':
      return zHand(s);
  }
  const cuff = 3.4 + 1.8 * s.pn(1.3, 41);
  if (s.y < cuff) {
    return zShirt(s, 43);
  }
  if (s.iy >= 9) {
    return zHand(s);
  }
  const p = zSkin(s, 45);
  p.l += 0.2 - 0.6 * (s.y - 4.0) / 5.0;
  // a festering gash on the forearm
  if (s.f === 'front' && ((s.r === 6 && within(s.c, 1, 2)) || (s.r === 7 && s.c === 2))) {
    return px(MAW, s.c === 1 ? 2.6 : 3.4).h(-0.8);
  }
  return p;
}

function zombieLeg(s: S): Px {
  switch (s.f) {
    case 'top':
      return zPants(s, 61);
    case 'bottom':
      return px(Z_GREY, 1.5 + 0.9 * (s.rnd(62) - 0.5));
  }
  if (s.iy >= 10) {
    // bare, grey feet
    let l = 3.0 + 1.2 * (s.fbm(1.5, 63) - 0.5) + 0.7 * (s.rnd(64) - 0.5) - 0.6 * (s.iy - 10);
    if (s.f === 'front' && s.iy === 11 && s.c % 2 === 1) {
      l -= 1.0; // toes
    }
    return px(Z_GREY, l);
  }
  const hem = 8.2 + 1.8 * s.pn(1.2, 65);
  if (s.y > hem) {
    return zSkin(s, 67).dl(-0.8);
  }
  // torn knees
  if (s.f === 'front' && s.iy === 6 && within(s.c, 1, 2)) {
    return zSkin(s, 67).dl(-0.6);
  }
  const p = zPants(s, 61);
  p.height = 0.5;
  if (s.z < 0.5 && within(s.iy, 5, 6)) {
    p.l += 0.9; // worn knees
  }
  if ((s.f === 'right' || s.f === 'left') && s.iz === 2) {
    p.l -= 0.9; // outer seam
  }
  return p;
}

// ============================================================================
// Brute
// ============================================================================

const B_SKIN = [0x1f2117, 0x2c2f20, 0x3a3e2a, 0x4a4f35, 0x5b6141, 0x6d744e, 0x81885d, 0x979e70];
const CLOTH = [0x1a1816, 0x24211e, 0x2f2b27, 0x3a3530, 0x46403a, 0x534c45];
const BOOT = [0x120d0a, 0x1a130f, 0x241a14, 0x2f221a, 0x3b2b21, 0x483529];
const AMBER = [0x8a4a0a, 0xffb428, 0xffe890];

export function brute(cv: Canvas, ox: number, oy: number) {
  paintBox(cv, ox, oy, BIG_HEAD, bruteHead);
  paintBox(cv, ox, oy, BIG_BODY, bruteBody);
  paintBox(cv, ox, oy, BIG_ARM, bruteArm);
  paintBox(cv, ox, oy, BIG_LEG, bruteLeg);
}

function bSkin(s: S, seed: number): Px {
  const l = 4.0 + 1.8 * (s.fbm(2.2, seed) - 0.5) + 0.8 * (s.rnd(seed + 1) - 0.5);
  return px(B_SKIN, l);
}

const BRUTE_FACE = [
  '..........',
  '..........',
  '..........',
  '.bbbggbbb.',
  '..oe..eo..',
  '....NN....',
  '..T.nn.T..',
  '..tmiimt..',
  '..jjjjjj..',
  '.cccccccc.',
];

/** Pointed orc ear sweeping up and back (z from the front, y down from row 4). */
const BRUTE_EAR = [
  '......e',
  '....eee',
  '..eeiie',
  '..eiie.',
  '..eee..',
];

const BRUTE_DENTS: readonly (readonly [number, number, number])[] = [
  [2.3, 1.2, 0.0],
  [7.4, 0.0, 3.2],
  [10.0, 2.3, 6.4],
  [2.6, 0.0, 7.6],
];

function bruteHead(s: S): Px {
  const helmBottom = 3.0 + 2.0 * s.z / 10.0;
  if (s.f === 'top' || (s.side() && s.y < helmBottom)) {
    return bruteHelm(s, helmBottom);
  }
  const p = bSkin(s, 71);
  p.l += 0.5 - 1.1 * s.y / 10.0;
  switch (s.f) {
    case 'front':
      switch (glyph(BRUTE_FACE, s.c, s.r)) {
        case 'b':
          return p.dl(0.8).h(0.8);
        case 'g':
          return iron(s, 73, 4.6).h(1.6); // nasal guard
        case 'o':
          return px(VOID, 1.0).h(-0.8);
        case 'e':
          return px(AMBER, 1.0).glow(200);
        case '.':
          return s.r === 4 ? p.dl(-0.8) : p;
        case 'N':
          return p.dl(0.9).h(0.6);
        case 'n':
          return px(B_SKIN, 0.6).h(-0.3);
        case 'T':
          return px(IVORY, 4.0).h(1.0);
        case 't':
          return px(IVORY, 2.6).h(1.0);
        case 'i':
          return px(IVORY, 1.6).h(0.4);
        case 'm':
          return px(VOID, 2.0).h(-0.8);
        case 'j':
          return p.dl(0.9).h(1.0);
        case 'c':
          return p.dl(-0.7).h(0.3);
        default:
          return p;
      }
    case 'right':
    case 'left':
      // pointed orc ear sweeping up and back (z from the front, y down)
      switch (glyph(BRUTE_EAR, s.iz, s.iy - 4)) {
        case 'e':
          return p.dl(1.1).h(1.0);
        case 'i':
          return p.dl(-1.9).h(0.2);
      }
      return p;
    case 'back':
      if ((s.iy === 7 || s.iy === 9) && s.n1(1.5, 75) > 0.35) {
        p.l -= 1.0; // neck folds
      }
      return p;
    default:
      return p.dl(-1.0);
  }
}

function bruteHelm(s: S, bottom: number): Px {
  const p = iron(s, 77, 4.0 + 1.4 * (1.0 - s.y / bottom)).h(1.0);
  if (s.f === 'top') {
    p.l = 5.0 + 1.0 * (s.fbm(2.5, 77) - 0.5) + 0.6 * (s.rnd(78) - 0.5);
  }
  // crest ridge front to back
  if ((s.ix === 4 || s.ix === 5) && (s.f === 'top' || s.f === 'front' || s.f === 'back')) {
    p.height = 1.8;
    p.l += s.ix === 4 ? 0.9 : 0.2;
  }
  // brim band with rivets
  if (s.side() && s.y > bottom - 1.0) {
    p.height = 1.6;
    p.l -= 0.5;
    if (s.per % 3 === 1) {
      p.l += 2.2;
      p.height = 2.2;
    }
  }
  for (const dent of BRUTE_DENTS) {
    if (s.dist(dent, 1.0) < 0.95) {
      p.height -= 1.0;
      p.l -= 1.0;
    }
  }
  return p;
}

function bruteBody(s: S): Px {
  const leather = (s: S, l0: number): Px => {
    const fold = s.n(2.0, 3.5, 2.0, 81);
    return px(LEATHER, l0 + 1.6 * (fold - 0.5) + 0.8 * (s.rnd(82) - 0.5) - 0.6 * s.y / 14.0);
  };
  const strap = [2, 3, 10, 11].includes(s.ix);
  switch (s.f) {
    case 'bottom':
      return px(CLOTH, 1.6 + 0.8 * (s.rnd(83) - 0.5));
    case 'top':
      if (strap) {
        return leather(s, 2.2).h(0.8);
      }
      if (within(s.ix, 4, 9) && within(s.iz, 2, 5)) {
        return bSkin(s, 84).dl(-0.8);
      }
      return leather(s, 4.0);
  }
  const r = s.iy;
  // belt with an iron buckle
  if (r === 9 || r === 10) {
    if (s.f === 'front' && within(s.c, 6, 7)) {
      const l = s.c === 6 && r === 9 ? 6.5 : s.c === 7 && r === 10 ? 3.0 : 4.8;
      return px(IRON, l).h(1.8);
    }
    let p = px(LEATHER, 1.6 + 0.7 * (s.rnd(85) - 0.5)).h(1.0);
    if (s.side() && s.per % 4 === 0 && r === 9) {
      p = px(IRON, 5.5).h(1.6); // studs
    }
    return p;
  }
  // leather kilt flaps
  if (r >= 11) {
    const k = remEuclid(s.per - 2, 5);
    if (k === 0) {
      return px(LEATHER, 0.3).h(-0.5);
    }
    let p = leather(s, 3.6).h(0.3);
    if (r === 13) {
      p.l -= 1.0;
    }
    if (r === 12 && k === 2) {
      p = px(IRON, 5.2).h(1.2);
    }
    return p;
  }
  switch (s.f) {
    case 'front': {
      if (r === 0 && within(s.c, 5, 8)) {
        return bSkin(s, 84).dl(-0.6).h(-0.3);
      }
      const corner = (s.c === 2 || s.c === 11) && (r === 1 || r === 8);
      const plate = within(s.c, 2, 11) && within(r, 1, 8) && !corner;
      if (plate) {
        const p = iron(s, 87, 4.7 - 0.25 * (r - 1.0)).h(1.0);
        if ((s.c === 6 || s.c === 7) && r >= 2) {
          p.height = 1.5;
          p.l += s.c === 6 ? 0.8 : -0.2;
        }
        if ((s.c === 3 || s.c === 10) && (r === 2 || r === 7)) {
          p.l += 2.0;
          p.height = 1.9;
        }
        if (s.dist([8.6, 5.6, 0.0], 1.0) < 0.8) {
          p.l -= 1.0;
          p.height = 0.2;
        }
        return p;
      }
      if (strap && r <= 1) {
        return leather(s, 2.0).h(0.8);
      }
      return leather(s, 3.8);
    }
    case 'back': {
      // crossed harness from the shoulders to the belt, iron ring where they meet
      const x = s.ix;
      const on = (x0: number) => x === x0 || x === x0 + 1;
      if (within(r, 4, 5) && within(x, 6, 7)) {
        return px(IRON, x === 6 && r === 4 ? 6.5 : 4.6).h(1.8);
      }
      if (on(2 + r) || on(10 - r)) {
        return leather(s, 1.8).h(0.8);
      }
      return leather(s, 3.8);
    }
    default:
      // side lacing
      if (within(s.iz, 3, 4) && within(r, 1, 8)) {
        if (r % 2 === 1) {
          return px(LEATHER, 6.0).h(0.8);
        }
        return px(VOID, 2.0).h(-0.5);
      }
      return leather(s, 3.4);
  }
}

function bruteArm(s: S): Px {
  // iron pauldron: two lames with rivets
  if (s.f === 'top' || (s.side() && s.iy <= 3)) {
    if (s.f === 'top') {
      const edge = s.c === 0 || s.r === 0 || s.c === 4 || s.r === 4;
      return iron(s, 91, edge ? 4.4 : 5.4).h(2.0);
    }
    const upper = s.iy <= 1;
    const p = iron(s, 91, upper ? 5.0 : 4.3).h(upper ? 2.0 : 1.4);
    if ((s.iy === 1 || s.iy === 3) && s.per % 3 === 1) {
      p.l += 2.0;
      p.height += 0.6;
    }
    return p;
  }
  if (s.f === 'bottom') {
    return bSkin(s, 93).dl(-1.3);
  }
  const r = s.iy;
  if (within(r, 9, 12)) {
    // bracer: leather with iron bands
    if (r === 9 || r === 12) {
      const p = iron(s, 95, 4.4).h(1.4);
      if (s.per % 3 === 0) {
        p.l += 1.8;
        p.height = 1.9;
      }
      return p;
    }
    const p = px(LEATHER, 3.0 + 0.8 * (s.rnd(96) - 0.5)).h(0.9);
    if (s.f === 'front' && s.c === 2) {
      p.l = 5.5; // lacing
    }
    return p;
  }
  const p = bSkin(s, 93);
  if (r >= 13) {
    // fist: knuckles, then finger creases
    if (s.f === 'front') {
      if (r === 13) {
        p.l += s.c % 2 === 0 ? 1.0 : 0.0;
        p.height = 0.5;
      } else if (s.c % 2 === 1) {
        p.l -= 1.3;
      }
    }
    return p;
  }
  // bare upper arm: bulging muscle, a tribal band
  p.l += 0.9 - 0.35 * (r - 4);
  if (r === 6 || (r === 5 && s.per % 3 === 1)) {
    p.l -= 1.9;
  }
  return p;
}

function bruteLeg(s: S): Px {
  switch (s.f) {
    case 'top':
      return px(CLOTH, 2.0);
    case 'bottom':
      return px(BOOT, s.r % 2 === 0 ? 0.4 : 1.2);
  }
  const r = s.iy;
  if (r <= 5) {
    const fold = s.n(1.5, 2.5, 1.5, 101);
    const p = px(CLOTH, 3.0 + 1.8 * (fold - 0.5) + 0.7 * (s.rnd(102) - 0.5) - 0.2 * r);
    if (r === 0) {
      p.l -= 0.8;
    }
    return p;
  }
  if (r === 6) {
    return px(LEATHER, 4.4 + 0.7 * (s.rnd(103) - 0.5)).h(1.2); // folded cuff
  }
  if (r === 11) {
    return px(BOOT, 0.6).h(0.4);
  }
  // toe cap
  if (s.f === 'front' && within(r, 9, 10) && within(s.c, 1, 4)) {
    return iron(s, 105, 4.6).h(1.2);
  }
  let p = px(BOOT, 3.0 + 0.9 * (s.fbm(1.5, 104) - 0.5) + 0.6 * (s.rnd(106) - 0.5)).h(0.8);
  if (r === 8) {
    p = px(LEATHER, 2.4).h(1.0);
    if ((s.f === 'right' || s.f === 'left') && s.c === 2) {
      p = px(IRON, 5.6).h(1.4);
    }
  }
  return p;
}

// ============================================================================
// Warden (final boss)
// ============================================================================

const OBS = [0x0b0910, 0x120e19, 0x1a1424, 0x231b31, 0x2d2340, 0x3a2d52, 0x4c3c6a, 0x655289];
const BLACK_IRON = [0x0e0e12, 0x16161c, 0x1f1f27, 0x292933, 0x35353f, 0x43434e, 0x575764];
const CAPE = [0x21030a, 0x33060f, 0x480a15, 0x5f0f1b, 0x781622, 0x911f28, 0xaa2c30];
const RUNE = [0x0b3d48, 0x10687a, 0x19a7ba, 0x44e2f2, 0xb0fcff];
const SKULL = [0x27222c, 0x453f4a, 0x686169, 0x8c8589, 0xaea7a4, 0xcac3b9, 0xe1dbce];
const RUBY = [0x4a0610, 0x8e0f1e, 0xd8283a, 0xff8c96];

export function warden(cv: Canvas, ox: number, oy: number) {
  paintBox(cv, ox, oy, BIG_HEAD, wardenHead);
  paintBox(cv, ox, oy, BIG_BODY, wardenBody);
  paintBox(cv, ox, oy, BIG_ARM, wardenArm);
  paintBox(cv, ox, oy, BIG_LEG, wardenLeg);
  paintBox(cv, ox, oy, CROWN, wardenCrown);
}

/** Faceted obsidian plate. */
function obs(s: S, seed: number, l0: number): Px {
  const facet = s.n1(1.7, seed);
  let l = l0 + 2.0 * (facet - 0.5) + 0.6 * (s.rnd(seed + 1) - 0.5);
  if (s.rnd(seed + 2) < 0.035) {
    l += 2.5; // glassy glints
  }
  return px(OBS, l).h(1.0);
}

function gold(s: S, seed: number, l0: number): Px {
  return px(GOLD, l0 + 0.8 * (s.rnd(seed) - 0.5)).h(1.4);
}

function rune(bright: boolean): Px {
  return bright ? px(RUNE, 3.4).glow(220) : px(RUNE, 2.6).glow(150);
}

const WARDEN_FACE = [
  '..........',
  '.GGGGGGGG.',
  '.ssssssss.',
  '.sOOssOOs.',
  '.seEssEes.',
  '.kkshhskk.',
  '.dssssssd.',
  '.dTuTTuTd.',
  '.dhhhhhhd.',
  '..juTTuj..',
];

function wardenHead(s: S): Px {
  const p = obs(s, 111, 3.2 - 0.6 * s.y / 10.0);
  switch (s.f) {
    case 'top':
      if (s.ix === 4 || s.ix === 5) {
        return gold(s, 113, s.ix === 4 ? 5.0 : 4.0).h(1.8);
      }
      p.l += 0.6;
      return p;
    case 'back':
      if (s.ix === 4 || s.ix === 5) {
        return gold(s, 113, s.ix === 4 ? 4.6 : 3.6).h(1.8);
      }
      return p;
    case 'right':
    case 'left':
      // gold trim along the front edge of the helm
      if (s.iz === 0) {
        return gold(s, 115, 4.6 - 0.15 * s.iy);
      }
      if (s.iz === 1) {
        p.l -= 0.8;
      }
      return p;
    case 'bottom':
      return p.dl(-1.2);
    case 'front': {
      const bone = (l: number) => px(SKULL, l + 0.7 * (s.rnd(117) - 0.5) - 0.25 * s.y);
      switch (glyph(WARDEN_FACE, s.c, s.r)) {
        case 'G':
          return gold(s, 115, 4.8);
        case 's':
          return bone(6.2).h(0.4);
        case 'O':
          return px(VOID, 0.0).h(-1.0);
        case 'E':
          return px(RUNE, 4.0).glow(255);
        case 'e':
          return px(RUNE, 3.0).glow(255);
        case 'k':
          return bone(7.6).h(0.9);
        case 'h':
          return px(VOID, 0.5).h(-1.0);
        case 'd':
          return bone(4.2).h(-0.4);
        case 'T':
          return bone(7.8).h(0.3);
        case 'u':
          return bone(6.4).h(0.3);
        case 'j':
          return bone(5.4).h(0.5);
        default:
          return p;
      }
    }
  }
}

/** Front chest plate: gold trim (G), obsidian (o), bright (R) and dim (r) runes. */
const WARDEN_CHEST = [
  'GGGGGGGGGGGGGG',
  'GooooooooooooG',
  'GoooooRRoooooG',
  'GooooRooRooooG',
  'GrrrRoRRoRrrrG',
  'GooooRooRooooG',
  'GoooooRRoooooG',
  'GooooorroooooG',
  'GooooorroooooG',
  'bbbbbbGGbbbbbb',
  'bbbbbbGGbbbbbb',
  'oooooooooooooo',
  'oooooooooooooo',
  'GGGGGGGGGGGGGG',
];

function wardenBody(s: S): Px {
  const cape = (s: S): Px => {
    const fold = (Math.sin(s.x * 1.9) * 0.5 + 0.5) * 2.2;
    return px(CAPE, 2.2 + fold + 0.8 * (s.rnd(121) - 0.5) - 0.8 * s.y / 14.0).h(1.2);
  };
  const r = s.iy;
  switch (s.f) {
    case 'top': {
      // cape strip draped over the back of the shoulders, gold clasps
      if (s.iz >= 6 && within(s.ix, 2, 11)) {
        if (s.ix === 2 || s.ix === 11) {
          return gold(s, 123, 5.5).h(2.0);
        }
        return cape(s).dl(1.0);
      }
      const edge = s.ix === 0 || s.ix === 13 || s.iz === 0;
      if (edge) {
        return gold(s, 125, 4.8);
      }
      return obs(s, 127, 3.8);
    }
    case 'bottom':
      return px(BLACK_IRON, 1.0);
    case 'back': {
      const hem = 11.0 + 3.0 * s.pn(1.2, 129) - (s.pr(130) < 0.25 ? 1.5 : 0.0);
      if (within(s.c, 2, 11) && s.y < hem) {
        if (r === 0 && (s.c === 2 || s.c === 11)) {
          return gold(s, 123, 5.5).h(2.0);
        }
        // moth-eaten holes near the hem
        if (s.y > 8.0 && s.n1(0.9, 131) > 0.78) {
          return obs(s, 133, 2.0).h(0.0);
        }
        return cape(s);
      }
      break;
    }
  }
  // gold corner trim, collar and hem
  const corner = (s.ix === 0 || s.ix === 13) && (s.iz === 0 || s.iz === 7);
  if (r === 0 || r === 13 || (corner && r <= 8)) {
    return gold(s, 135, 4.6 - 0.12 * r);
  }
  if (r === 9 || r === 10) {
    if (s.f === 'front' && within(s.c, 6, 7)) {
      return gold(s, 137, s.c === 6 && r === 9 ? 6.0 : 4.5).h(2.0);
    }
    let p = px(BLACK_IRON, 2.4 + 0.6 * (s.rnd(139) - 0.5)).h(1.2);
    if (s.side() && s.per % 3 === 0) {
      p = gold(s, 141, 4.0).h(1.6);
    }
    return p;
  }
  if (r >= 11) {
    // tasset lames
    const p = obs(s, 143, r === 11 ? 3.8 : 2.8).h(r === 11 ? 1.2 : 0.8);
    if (s.side() && s.per % 4 === 0) {
      p.l -= 1.5;
    }
    return p;
  }
  if (s.f === 'front') {
    switch (glyph(WARDEN_CHEST, s.c, s.r)) {
      case 'G':
        return gold(s, 135, 4.6 - 0.12 * r);
      case 'R':
        return rune(true);
      case 'r':
        return rune(false);
    }
    const p = obs(s, 145, 3.6 - 0.12 * r);
    // pectoral ridge
    if (r === 1) {
      p.l += 1.0;
    }
    return p;
  }
  // sides and back: layered plates
  const p = obs(s, 147, 3.2 - 0.1 * r);
  if (r === 4 || r === 7) {
    p.height = 0.6;
    p.l -= 0.6;
  }
  return p;
}

function wardenArm(s: S): Px {
  const r = s.iy;
  if (s.f === 'top') {
    const edge = s.c === 0 || s.r === 0 || s.c === 4 || s.r === 4;
    if (edge) {
      return gold(s, 151, 5.0);
    }
    if (s.c === 2 && s.r === 2) {
      return px(OBS, 7.0).h(2.4); // spike
    }
    return obs(s, 153, 4.4).h(2.0);
  }
  if (s.f === 'bottom') {
    return px(BLACK_IRON, 1.2);
  }
  if (r <= 4) {
    // pauldron
    if (r === 4) {
      return gold(s, 151, 4.2).h(2.0);
    }
    const p = obs(s, 155, r <= 1 ? 4.2 : 3.4).h(r <= 1 ? 2.2 : 1.8);
    if (r === 2) {
      p.l -= 0.8;
    }
    return p;
  }
  if (r <= 8) {
    // blackened mail
    const ring = (s.per + r) % 2 === 0;
    return px(BLACK_IRON, (ring ? 3.6 : 1.8) + 0.5 * (s.rnd(157) - 0.5) - 0.2 * (r - 5)).h(0.6);
  }
  if (r <= 12) {
    // bracer with runes
    if (r === 9 || r === 12) {
      return gold(s, 159, r === 9 ? 4.8 : 3.8);
    }
    // a band of angular rune glyphs around the wrist
    const k = remEuclid(s.per, 3);
    if ((r === 10 && k !== 2) || (r === 11 && k === 0)) {
      return rune(k === 0);
    }
    return obs(s, 161, 2.8).h(1.1);
  }
  // gauntlet with gold knuckle studs
  let p = px(BLACK_IRON, 3.2 + 0.6 * (s.rnd(163) - 0.5)).h(0.8);
  if (r === 13 && s.f === 'front' && s.c % 2 === 0) {
    p = gold(s, 165, 5.0).h(1.4);
  }
  if (r === 14) {
    p.l -= 1.0;
  }
  return p;
}

function wardenLeg(s: S): Px {
  const r = s.iy;
  switch (s.f) {
    case 'top':
      return px(BLACK_IRON, 2.0);
    case 'bottom':
      return px(BLACK_IRON, 0.6);
  }
  if (r <= 3) {
    const ring = (s.per + r) % 2 === 0;
    return px(BLACK_IRON, (ring ? 3.4 : 1.8) + 0.5 * (s.rnd(171) - 0.5)).h(0.5);
  }
  if (r <= 6) {
    // knee cop
    if (r === 4) {
      return gold(s, 173, 4.8).h(1.6);
    }
    if (r === 6) {
      return obs(s, 175, 2.2).h(0.8);
    }
    if (s.f === 'front' && within(s.c, 2, 3)) {
      return rune(s.c === 2);
    }
    return obs(s, 175, 3.8).h(1.4);
  }
  if (r === 11) {
    let p = px(BLACK_IRON, 2.6).h(0.8);
    if (s.f === 'front') {
      p = gold(s, 177, 4.2).h(1.2);
    }
    return p;
  }
  // greave with a centre ridge
  const p = obs(s, 179, 3.2 - 0.15 * (r - 7)).h(1.0);
  if (s.f === 'front' && within(s.c, 2, 3)) {
    p.height = 1.6;
    p.l += s.c === 2 ? 1.2 : 0.3;
  }
  return p;
}

/** Crown points repeat every 5 texels around the ring, tips at 2 mod 5. */
function crownPoint(per: number, row: number): boolean {
  const k = remEuclid(per, 5);
  switch (row) {
    case 0:
      return k === 2;
    case 1:
      return within(k, 1, 3);
    default:
      return true;
  }
}

function wardenCrown(s: S): Px {
  // open ring: nothing on the top or bottom planes, the head shows through
  if (!s.side()) {
    return px(GOLD, 3.0).clear();
  }
  const r = s.iy;
  if (!crownPoint(s.per, r)) {
    return px(GOLD, 3.0).clear();
  }
  const k = remEuclid(s.per, 5);
  const local = s.c; // 0..9 on every side
  // a 2x2 ruby in the middle of each side, small soul gems under the points
  if (r >= 2 && (local === 4 || local === 5)) {
    const l = local === 4 && r === 2 ? 3.0 : local === 5 && r === 3 ? 1.0 : 2.0;
    return px(RUBY, l).glow(120);
  }
  if (r === 2 && k === 2) {
    return px(RUNE, 3.4).glow(120);
  }
  const p = px(GOLD, 4.6 + 0.6 * (s.rnd(181) - 0.5)).h(1.0);
  if (r === 0) {
    p.l = 6.5;
  }
  if (r === 1) {
    p.l = k === 1 ? 5.8 : k === 3 ? 3.8 : 5.0;
  }
  if (r === 3) {
    p.l -= 1.2;
    p.height = 0.6;
  }
  return p;
}

// ============================================================================
// Skeleton
// ============================================================================

const BONE = [0x3f3a33, 0x5e584e, 0x7d766a, 0x9b9486, 0xb6b0a2, 0xcdc8bb, 0xe0dcd1, 0xefece4];
const EMBER = [0xc0200f, 0xff5a3c];

export function skeleton(cv: Canvas, ox: number, oy: number) {
  paintBox(cv, ox, oy, SKELETON_HEAD, skeletonHead);
  paintBox(cv, ox, oy, SKELETON_BODY, skeletonBody);
  paintBox(cv, ox, oy, SKELETON_ARM, (s) => skeletonLimb(s, false));
  paintBox(cv, ox, oy, SKELETON_LEG, (s) => skeletonLimb(s, true));
}

function bone(s: S, seed: number, l0: number): Px {
  const l = l0 + 1.0 * (s.fbm(2.0, seed) - 0.5) + 0.5 * (s.rnd(seed + 1) - 0.5);
  return px(BONE, l).h(0.5);
}

const SKULL_FACE = [
  '........',
  '........',
  '.bb..bb.',
  '.oo..oo.',
  '.oe..eo.',
  '.c.nn.c.',
  '.tgtgtg.',
  '..jjjj..',
];

function skeletonHead(s: S): Px {
  const p = bone(s, 201, 5.6 - 1.0 * s.y / 8.0);
  switch (s.f) {
    case 'top':
      // cranial suture
      if (s.c === 4 - (s.r % 3 === 1 ? 1 : 0)) {
        p.l -= 1.4;
        p.height = 0.2;
      }
      return p;
    case 'front':
      switch (glyph(SKULL_FACE, s.c, s.r)) {
        case 'b':
          return p.dl(0.5).h(0.8);
        case 'o':
          return px(VOID, 1.0).h(-1.0);
        case 'e':
          return px(EMBER, 1.0).glow(90);
        case 'n':
          return px(VOID, 1.5).h(-1.0);
        case 't':
          return px(BONE, 6.4).h(0.3);
        case 'g':
          return px(VOID, 2.0).h(-0.8);
        case 'j':
          return p.dl(-0.8);
        case 'c':
          return p.dl(-1.2);
        default:
          return p;
      }
    case 'right':
    case 'left':
      // temple hollow and jaw hinge
      if (within(s.iz, 2, 3) && within(s.iy, 3, 4)) {
        return p.dl(-1.4).h(-0.3);
      }
      if (s.iy === 6 && s.iz <= 2) {
        return p.dl(-1.2);
      }
      return p;
    case 'bottom':
      return p.dl(-1.6);
    case 'back':
      return p.dl(-0.4);
  }
}

/** Rib cage: `#` bone, `.` open. */
const RIBS_FRONT = [
  '########',
  '##.##.##',
  '########',
  '#..##..#',
  '########',
  '#..##..#',
  '########',
  '#..##..#',
  '...##...',
  '...##...',
  '########',
  '.##..##.',
];
const RIBS_BACK = [
  '########',
  '########',
  '########',
  '#.####.#',
  '########',
  '#..##..#',
  '########',
  '#..##..#',
  '...##...',
  '...##...',
  '########',
  '.######.',
];
const RIBS_SIDE = [
  '####',
  '####',
  '####',
  '#..#',
  '####',
  '#..#',
  '####',
  '#..#',
  '#...',
  '#...',
  '####',
  '#..#',
];

function skeletonBody(s: S): Px {
  const r = s.iy;
  const base = bone(s, 211, 5.0 - 0.12 * r);
  let art: readonly string[];
  switch (s.f) {
    case 'top':
      // shoulders with the top vertebra
      if (within(s.ix, 3, 4) && s.iz >= 2) {
        return base.dl(-1.2);
      }
      return base.dl(0.6);
    case 'bottom':
      return base.dl(-1.4);
    case 'front':
      art = RIBS_FRONT;
      break;
    case 'back':
      // back rows read right to left so the pattern stays centred
      art = RIBS_BACK;
      break;
    case 'right':
      art = RIBS_SIDE;
      break;
    case 'left': {
      // mirror so the spine column sits at the back edge on both sides
      const c = s.fw - 1 - s.c;
      if (glyph(RIBS_SIDE, c, s.r) === '.') {
        return base.clear();
      }
      return ribShade(s, base);
    }
  }
  if (glyph(art, s.c, s.r) === '.') {
    return base.clear();
  }
  return ribShade(s, base);
}

function ribShade(s: S, p: Px): Px {
  const r = s.iy;
  // rib bars are rounded: brighter on their upper texel row
  if (within(r, 2, 7)) {
    p.l += r % 2 === 0 ? 0.5 : -0.6;
  }
  // sternum and spine columns
  if (s.side() && (s.ix === 3 || s.ix === 4) && (s.f === 'front' || s.f === 'back')) {
    p.l += (r % 2 === 0) === (s.ix === 3) ? 0.6 : -0.4;
    p.height = 0.8;
  }
  return p;
}

function skeletonLimb(s: S, leg: boolean): Px {
  const r = s.iy;
  const p = bone(s, leg ? 221 : 223, 5.0 - 0.1 * r);
  switch (s.f) {
    case 'top':
      return p.dl(0.8);
    case 'bottom':
      return p.dl(-1.5);
  }
  // round shaft: first column lit, second in shade
  p.l += s.c === 0 ? 0.5 : -0.6;
  const joint = leg ? 6 : 5;
  if (r === 0 || r === joint) {
    p.l += 0.9; // knobbly joint heads
    p.height = 1.0;
  } else if (r === joint - 1 || r === joint + 1) {
    p.l -= 1.0;
  }
  if (!leg && r >= 10) {
    // finger bones
    if (r === 11 && s.c === 1) {
      return px(BONE, 1.0).h(-0.5);
    }
    p.l -= 0.4;
  }
  if (leg && r === 11) {
    p.l -= 0.8;
  }
  return p;
}

// ============================================================================
// Spider
// ============================================================================

const SP = [0x0d0908, 0x150f0d, 0x1e1612, 0x281d17, 0x33261d, 0x3f3024, 0x4d3b2d, 0x604c3a];
const SP_RED = [0x3a0707, 0x570c0c, 0x761311, 0x951d17, 0xb22a1f];
const SP_EYE = [0x5a0606, 0xa3120e, 0xe6281c, 0xff6a4a, 0xffc2a8];
const FANG = [0x1a1210, 0x3a2a22, 0x6b5a4a, 0xa89480];

export function spider(cv: Canvas, ox: number, oy: number) {
  paintBox(cv, ox, oy, SPIDER_HEAD, spiderHead);
  paintBox(cv, ox, oy, SPIDER_THORAX, (s) => hairy(s, 301, 3.2).dl(s.f === 'top' ? 0.6 : 0.0));
  paintBox(cv, ox, oy, SPIDER_ABDOMEN, spiderAbdomen);
  paintBox(cv, ox, oy, SPIDER_LEG, spiderLeg);
}

function hairy(s: S, seed: number, l0: number): Px {
  let l = l0 + 1.5 * (s.fbm(1.8, seed) - 0.5) + 0.7 * (s.rnd(seed + 1) - 0.5);
  // short pale hairs: two-texel streaks running down the sides and back along the top
  const streak = s.side() ? hash3(s.per, s.iy >> 1, 0, seed + 2) : hash3(s.ix, s.iz >> 1, 1, seed + 2);
  if (unit(streak) < 0.07) {
    l += 2.0;
  }
  return px(SP, l);
}

const SPIDER_FACE = [
  '........',
  '.s....s.',
  '...ss...',
  '.AB..BA.',
  '.BC..CB.',
  's......s',
  '..fmmf..',
  '..F..F..',
];

function spiderHead(s: S): Px {
  const p = hairy(s, 311, 3.0 + (s.f === 'top' ? 0.6 : 0.0));
  if (s.f !== 'front') {
    return p;
  }
  switch (glyph(SPIDER_FACE, s.c, s.r)) {
    case 's':
      return px(SP_EYE, 3.0).glow(230);
    case 'A':
      return px(SP_EYE, 4.0).glow(230);
    case 'B':
      return px(SP_EYE, 2.6).glow(230);
    case 'C':
      return px(SP_EYE, 1.4).glow(230);
    case 'f':
      return px(FANG, 1.0).h(0.8);
    case 'F':
      return px(FANG, 2.6).h(0.8);
    case 'm':
      return px(VOID, 1.0).h(-0.6);
    default:
      return p;
  }
}

function spiderAbdomen(s: S): Px {
  const p = hairy(s, 321, 3.3);
  switch (s.f) {
    case 'top': {
      // chevrons pointing toward the head (row fh-1 borders the front)
      const dx = s.cx();
      const z = s.z;
      for (const zk of [1.5, 5.0, 8.5]) {
        // in f32 as in the engine: some texels sit exactly on a chevron's edge
        const t = f32(f32(z - zk) - f32(f32(dx - 0.5) * f32(0.9)));
        if (dx < 4.2 && 0.0 <= t && t < f32(1.3)) {
          return px(SP_RED, 2.6 - 0.35 * (z - 1.5) / 3.5 + 0.6 * (s.rnd(323) - 0.5)).h(0.3);
        }
        if (dx < 4.6 && f32(-0.8) <= t && t < 0.0) {
          return px(SP, 0.4).h(0.0);
        }
      }
      p.l += 0.4;
      return p;
    }
    case 'bottom': {
      // red hourglass
      const dz = Math.abs(s.z - 6.0);
      const dx = s.cx();
      if (dz < 3.2 && dx < 0.6 + dz * 0.75) {
        return px(SP_RED, 3.5 - 0.3 * dz + 0.5 * (s.rnd(325) - 0.5)).h(0.3);
      }
      return p.dl(-0.8);
    }
    case 'back':
      // spinnerets
      if (s.cx() < 1.0 && within(s.iy, 5, 6)) {
        return px(SP, 5.5 + (s.iy === 5 ? 1 : 0)).h(0.8);
      }
      return p;
    default:
      // long pale hairs combed backward
      if (s.side() && s.n(1.0, 4.0, 0.6, 327) > 0.82) {
        p.l += 2.0;
      }
      return p;
  }
}

function spiderLeg(s: S): Px {
  const p = hairy(s, 331, 3.4);
  const x = s.ix;
  if (x === 5 || x === 10) {
    p.l += 1.2;
    p.height = 0.6;
  } else if (x === 4 || x === 11) {
    p.l -= 0.9;
  }
  if (x === 0 || x === 15) {
    p.l -= 1.4;
  }
  if (s.f === 'top') {
    p.l += 0.6;
  }
  return p;
}
