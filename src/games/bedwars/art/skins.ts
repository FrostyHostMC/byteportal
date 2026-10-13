/**
 * Bed Wars skins (standard 64x64 humanoid layout): the four team players and the shopkeeper.
 *
 * Players share one outfit so the team reads at a glance: a dyed leather cap, a team tunic with
 * dark trim, laced collar and belt, team sleeves, dark trousers and boots. Faces, hair and skin
 * tones differ between the four.
 */
import { type Canvas, glyph, paintBox, part, px, type Px, type S, within } from '@platform/art';
import { cloth, EYE_WHITE, flesh, GOLD, hair, leather, LEATHER } from './shared';

const HEAD = part(0, 0, 8, 8, 8);
const BODY = part(16, 16, 8, 12, 4);
const ARM = part(40, 16, 4, 12, 4);
const LEG = part(0, 16, 4, 12, 4);

// ============================================================================
// Palettes
// ============================================================================

export const TEAM = {
  red: [0x2b0707, 0x4a0c0c, 0x6b1212, 0x8e1a17, 0xb0241e, 0xcc3428, 0xe0503c, 0xf07a5e],
  blue: [0x08102e, 0x0f1c4c, 0x172b70, 0x203d94, 0x2b52b6, 0x3b69d0, 0x5486e2, 0x7aa6f0],
  green: [0x071d09, 0x0d3211, 0x154a19, 0x1e6423, 0x297f2d, 0x379a38, 0x4bb548, 0x70cc66],
  yellow: [0x3d2c02, 0x6a4e05, 0x957108, 0xbf940c, 0xdcb416, 0xeecb22, 0xf8e040, 0xfff27a],
} as const;

const SKIN_FAIR = [0x4a2a1c, 0x6e4030, 0x915a44, 0xb07458, 0xc98e6c, 0xdca682, 0xebbd9a, 0xf5d3b4];
const SKIN_TAN = [0x3a2014, 0x583222, 0x784632, 0x965c42, 0xb07352, 0xc68a64, 0xd6a07a, 0xe4b894];
const SKIN_DARK = [0x1e120c, 0x2e1c13, 0x42291b, 0x573725, 0x6b4530, 0x80563c, 0x96694b, 0xab7d5c];

const HAIR_BROWN = [0x1c110a, 0x2c1b10, 0x3e2717, 0x51341f, 0x654228, 0x7a5233];
const HAIR_BLOND = [0x5a4214, 0x7d5d1f, 0xa07a2c, 0xc29a3e, 0xdcb95a, 0xecd27e];
const HAIR_BLACK = [0x0c0a0a, 0x151212, 0x1f1a19, 0x2a2422, 0x36302d, 0x443c38];
const HAIR_GINGER = [0x4a1c08, 0x6b2a0c, 0x8e3a12, 0xae4c18, 0xc9622a, 0xdc7c40];

const IRIS_BLUE = [0x14285a, 0x2c56a8];
const IRIS_BROWN = [0x2a170a, 0x5a3718];
const IRIS_GREEN = [0x173f1c, 0x3a7a34];
const IRIS_GREY = [0x2a3440, 0x5a6c80];

const PANTS = [0x101016, 0x17171f, 0x1f1f29, 0x282834, 0x323240, 0x3d3d4c, 0x4a4a5a];
const LACE = [0x6e6451, 0x8f846d, 0xafa48a, 0xcac0a5, 0xe0d8bf];

// ============================================================================
// Team players
// ============================================================================

interface Look {
  team: readonly number[];
  skin: readonly number[];
  hair: readonly number[];
  iris: readonly number[];
  /** Front of the head below the cap (rows 0-1 are the cap). See `playerHead` for the glyphs. */
  face: readonly string[];
  seed: number;
}

/**
 * Face glyphs: h hair, b brow, W eye white, I iris, n nose, m mouth, w teeth, p mouth corner,
 * d beard, f freckle, '.' skin.
 */
const LOOKS: Record<keyof typeof TEAM, Omit<Look, 'team'>> = {
  red: {
    skin: SKIN_FAIR,
    hair: HAIR_BROWN,
    iris: IRIS_BLUE,
    face: ['........', '........', 'hhh..hhh', '.bb..bb.', '.WI..IW.', '...nn...', '..mmmm..', '........'],
    seed: 1000,
  },
  blue: {
    skin: SKIN_TAN,
    hair: HAIR_BLOND,
    iris: IRIS_GREY,
    face: ['........', '........', 'hhhhh.hh', '.bb..bb.', '.WI..IW.', '...nn...', '.pmwwmp.', '........'],
    seed: 2000,
  },
  green: {
    skin: SKIN_DARK,
    hair: HAIR_BLACK,
    iris: IRIS_BROWN,
    face: ['........', '........', 'h......h', '.bb..bb.', '.WI..IW.', 'd..nn..d', 'dd.mm.dd', '.dddddd.'],
    seed: 3000,
  },
  yellow: {
    skin: SKIN_FAIR,
    hair: HAIR_GINGER,
    iris: IRIS_GREEN,
    face: ['........', '........', 'hh.hh.hh', '.bb..bb.', '.WI..IW.', '.f.nn.f.', '.m....m.', '..mmmm..'],
    seed: 4000,
  },
};

export function player(cv: Canvas, ox: number, oy: number, team: keyof typeof TEAM) {
  const look: Look = { team: TEAM[team], ...LOOKS[team] };
  paintBox(cv, ox, oy, HEAD, (s) => playerHead(s, look));
  paintBox(cv, ox, oy, BODY, (s) => playerBody(s, look));
  paintBox(cv, ox, oy, ARM, (s) => playerArm(s, look));
  paintBox(cv, ox, oy, LEG, (s) => playerLeg(s, look));
}

/** Dyed leather in the team colour. */
function dyed(s: S, look: Look, seed: number, l0: number): Px {
  return cloth(s, look.team, look.seed + seed, l0);
}

function playerHead(s: S, look: Look): Px {
  const sk = flesh(s, look.skin, look.seed + 1, 5.1 - 0.7 * s.y / 8.0);
  // Leather cap: two rows at the brow, three at the back, a darker band at its edge.
  if (s.f === 'top') {
    const p = dyed(s, look, 3, 4.9);
    if (s.ix === 4 || s.iz === 4) {
      p.l -= 1.1; // panel seams
      p.height = 0.1;
    }
    if (within(s.ix, 3, 4) && within(s.iz, 3, 4)) {
      return dyed(s, look, 5, 5.8).h(1.0); // button
    }
    return p;
  }
  const capBottom = 2.0 + 1.5 * s.z / 8.0;
  if (s.side() && s.y < capBottom) {
    if (s.y >= capBottom - 1.0) {
      const band = dyed(s, look, 7, 2.3).h(1.2);
      if (s.per % 2 === 0) {
        band.l += 0.7; // stitching
      }
      return band;
    }
    return dyed(s, look, 3, 4.6 - 0.3 * s.y).h(0.8);
  }
  const hairPx = () => hair(s, look.hair, look.seed + 9, 3.2);
  switch (s.f) {
    case 'front':
      switch (glyph(look.face, s.c, s.r)) {
        case 'h':
          return hairPx().dl(-0.4);
        case 'b':
          return px(look.hair, 1.2).h(0.5);
        case 'W':
          return px(EYE_WHITE, 2.6).h(0.2);
        case 'I':
          return px(look.iris, 0.0).h(-0.3);
        case 'n':
          return sk.dl(0.4).h(0.9);
        case 'm':
          return px(look.skin, 2.0).h(-0.3);
        case 'w':
          return px(EYE_WHITE, 2.0).h(-0.2);
        case 'p':
          return sk.dl(-0.9);
        case 'd':
          return hair(s, look.hair, look.seed + 11, 2.4).h(0.4);
        case 'f':
          return sk.dl(-1.1);
        default:
          return s.r === 7 ? sk.dl(-0.4) : sk;
      }
    case 'right':
    case 'left': {
      // ear
      if (within(s.iz, 3, 4) && within(s.iy, 3, 5)) {
        const inner = s.iz === 4 && s.iy === 4;
        return inner ? sk.dl(-1.6).h(-0.3) : sk.dl(0.2).h(0.7);
      }
      const hairBottom = 3.0 + 4.0 * Math.min(Math.max((s.z - 1.5) / 6.5, 0.0), 1.0);
      if (s.y < hairBottom) {
        return hairPx();
      }
      return s.iy === 7 ? sk.dl(-0.6) : sk;
    }
    case 'back':
      if (s.iy <= 6 && !(s.iy === 6 && (s.ix === 0 || s.ix === 7))) {
        return hairPx().dl(-0.2);
      }
      return sk.dl(-0.8);
    default:
      return sk.dl(-1.8);
  }
}

function playerBody(s: S, look: Look): Px {
  const r = s.iy;
  const trim = () => dyed(s, look, 21, 2.2).h(0.9);
  switch (s.f) {
    case 'top':
      if (within(s.ix, 2, 5) && within(s.iz, 1, 2)) {
        return flesh(s, look.skin, look.seed + 1, 3.0);
      }
      return dyed(s, look, 23, 5.0);
    case 'bottom':
      return px(PANTS, 1.6 + 0.6 * (s.rnd(look.seed + 25) - 0.5));
  }
  // belt with a brass buckle
  if (r === 8 || r === 9) {
    if (s.f === 'front' && within(s.c, 3, 4)) {
      const hi = s.c === 3 && r === 8;
      return px(GOLD, hi ? 6.5 : s.c === 4 && r === 9 ? 3.4 : 5.0).h(1.6);
    }
    return leather(s, look.seed + 27, r === 8 ? 2.8 : 2.0).h(1.1);
  }
  // skirt below the belt: pleats, darker hem
  if (r >= 10) {
    if (r === 11) {
      return trim();
    }
    const p = dyed(s, look, 29, 3.8);
    if (s.side() && s.per % 3 === 0) {
      p.l -= 0.9;
    }
    return p;
  }
  const p = dyed(s, look, 31, 4.5 - 0.12 * r);
  switch (s.f) {
    case 'front': {
      // collar: an open neck with crossed laces
      if (r === 0) {
        return within(s.c, 3, 4) ? flesh(s, look.skin, look.seed + 1, 3.2) : trim();
      }
      if (r <= 3 && within(s.c, 3, 4)) {
        if (r % 2 === 1) {
          return px(LACE, s.c === 3 ? 3.2 : 2.2).h(0.8);
        }
        return flesh(s, look.skin, look.seed + 1, 2.6).h(-0.3);
      }
      // side panels a shade darker, with a stitched seam
      if (s.c === 0 || s.c === 7) {
        p.l -= 0.7;
      } else if ((s.c === 1 || s.c === 6) && r % 2 === 0) {
        p.l += 0.6;
      }
      return p;
    }
    case 'back':
      // shoulder yoke and a centre seam
      if (r === 2) {
        return dyed(s, look, 33, 3.0).h(0.6);
      }
      if ((s.c === 3 || s.c === 4) && r > 2) {
        p.l -= s.c === 3 ? 0.5 : 0.9;
      }
      return p;
    default:
      p.l -= 0.6; // under the arms
      return p;
  }
}

function playerArm(s: S, look: Look): Px {
  const r = s.iy;
  const sk = () => flesh(s, look.skin, look.seed + 41, 4.8 - 0.15 * (r - 5));
  switch (s.f) {
    case 'top':
      return dyed(s, look, 43, 5.2).h(1.0);
    case 'bottom':
      return flesh(s, look.skin, look.seed + 41, s.c % 2 === 1 ? 2.6 : 3.6);
  }
  // sleeve to the elbow with a dark cuff
  if (r <= 4) {
    if (r === 4) {
      return dyed(s, look, 45, 2.2).h(1.2);
    }
    const p = dyed(s, look, 47, 4.8 - 0.25 * r).h(0.9);
    if (r === 0) {
      p.l += 0.5;
    }
    return p;
  }
  // leather bracer
  if (r === 8 || r === 9) {
    const p = leather(s, look.seed + 49, r === 8 ? 3.4 : 2.4).h(1.0);
    if (s.f === 'right' && s.c === 1 && r === 8) {
      p.l = 5.8; // strap buckle
    }
    return p;
  }
  // hand
  if (r >= 10) {
    const p = sk();
    if (s.f === 'front') {
      if (r === 10) {
        p.l += s.c % 2 === 0 ? 0.6 : 0.0; // knuckles
      } else if (s.c % 2 === 1) {
        p.l -= 1.2; // finger gaps
      }
    }
    return p;
  }
  return sk();
}

function playerLeg(s: S, look: Look): Px {
  const r = s.iy;
  switch (s.f) {
    case 'top':
      return px(PANTS, 2.6);
    case 'bottom':
      return px(LEATHER, s.r % 2 === 0 ? 0.3 : 0.9);
  }
  // boots
  if (r >= 8) {
    if (r === 8) {
      return leather(s, look.seed + 61, 4.4).h(1.3); // folded cuff
    }
    if (r === 11) {
      return px(LEATHER, 0.5).h(0.4); // sole
    }
    const p = leather(s, look.seed + 63, 2.8);
    if (s.f === 'front' && r === 10) {
      p.l += 0.9; // toe cap
    }
    if (s.f === 'right' && r === 9 && s.c === 2) {
      p.l = 5.6; // buckle
    }
    return p;
  }
  // trousers
  const fold = s.n(1.4, 2.6, 1.4, look.seed + 65);
  const p = px(PANTS, 3.4 + 1.7 * (fold - 0.5) + 0.6 * (s.rnd(look.seed + 66) - 0.5) - 0.1 * r).h(0.4);
  if (r === 0) {
    p.l -= 0.7;
  }
  if (s.f === 'front' && within(r, 4, 5)) {
    p.l += 0.8; // knees
  }
  if (s.f === 'right' && s.c === 2) {
    // a team-coloured stripe down the outer seam
    return dyed(s, look, 67, 3.6).h(0.6);
  }
  return p;
}

// ============================================================================
// Shopkeeper
// ============================================================================

const ROBE = [0x1f130b, 0x2e1c10, 0x3f2716, 0x52331d, 0x654026, 0x7a4e2f, 0x8f5e39, 0xa47045];
const APRON = [0x1b2210, 0x283218, 0x364221, 0x45532b, 0x566636, 0x687a42, 0x7c8e50, 0x93a462];
const FELT = [0x1a120c, 0x261a11, 0x342417, 0x442f1e, 0x553b26, 0x684830, 0x7c573a];
const OLD_SKIN = [0x4f3326, 0x6d4634, 0x8c5b43, 0xa87052, 0xbe8462, 0xd09873, 0xdfad88, 0xebc29f];
const GREY_HAIR = [0x3a3632, 0x55504a, 0x716b63, 0x8d877e, 0xa8a298, 0xc2bdb3];
const IRIS_KEEPER = [0x1d4a22, 0x3f8a3a];
const CHEEK = [0xb8705a, 0xcc7f68, 0xdc907a];
const NOSE = [0x8e5240, 0xae6650, 0xc77c63, 0xdb947a, 0xeaae94];

/**
 * A villager's face: g grey hair, B brow, W eye white, I iris, n the big nose, N its tip, S the
 * shadow it casts, c cheek, p smile line.
 */
const KEEPER_FACE = ['........', '........', 'g......g', '.BBBBBB.', '.WInnIW.', '.cSnnSc.', '..SnnS..', '.p.NN.p.'];

export function shopkeeper(cv: Canvas, ox: number, oy: number) {
  paintBox(cv, ox, oy, HEAD, keeperHead);
  paintBox(cv, ox, oy, BODY, keeperBody);
  paintBox(cv, ox, oy, ARM, keeperArm);
  paintBox(cv, ox, oy, LEG, keeperLeg);
}

function keeperHead(s: S): Px {
  const sk = flesh(s, OLD_SKIN, 501, 5.0 - 0.7 * s.y / 8.0);
  // felt cap with an olive band
  if (s.f === 'top') {
    const p = cloth(s, FELT, 503, 4.4);
    const edge = s.c === 0 || s.c === 7 || s.r === 0 || s.r === 7;
    return edge ? p.dl(-0.5) : p.h(0.9);
  }
  const capBottom = 2.0 + 1.0 * s.z / 8.0;
  if (s.side() && s.y < capBottom) {
    if (s.y >= capBottom - 1.0) {
      return cloth(s, APRON, 505, 3.4).h(1.1);
    }
    return cloth(s, FELT, 503, 4.0).h(0.8);
  }
  const grey = () => hair(s, GREY_HAIR, 507, 3.2);
  switch (s.f) {
    case 'front':
      switch (glyph(KEEPER_FACE, s.c, s.r)) {
        case 'g':
          return grey();
        case 'B':
          return px(GREY_HAIR, s.c === 1 || s.c === 6 ? 1.6 : 1.0).h(0.8);
        case 'W':
          return px(EYE_WHITE, 2.6).h(0.2);
        case 'I':
          return px(IRIS_KEEPER, 0.0).h(-0.3);
        case 'n':
          // the big nose: lit on its left, shaded on its right
          return px(NOSE, (s.c === 3 ? 3.6 : 2.6) - 0.2 * (s.r - 4)).h(1.4);
        case 'N':
          return px(NOSE, s.c === 3 ? 1.6 : 0.8).h(1.2);
        case 'S':
          return sk.dl(-1.2).h(0.0);
        case 'c':
          return px(CHEEK, 1.0 + 0.4 * (s.rnd(509) - 0.5));
        case 'p':
          return sk.dl(-1.0);
        default:
          return sk;
      }
    case 'right':
    case 'left': {
      if (within(s.iz, 3, 4) && within(s.iy, 3, 5)) {
        const inner = s.iz === 4 && s.iy === 4;
        return inner ? sk.dl(-1.6).h(-0.3) : sk.dl(0.3).h(0.7);
      }
      const hairBottom = 3.0 + 3.0 * Math.min(Math.max((s.z - 1.5) / 6.5, 0.0), 1.0);
      if (s.y < hairBottom) {
        return grey();
      }
      return sk;
    }
    case 'back':
      if (s.iy <= 5) {
        return grey().dl(-0.3);
      }
      return sk.dl(-0.8);
    default:
      return sk.dl(-1.8);
  }
}

/** Heavy wool: long vertical folds, little grain. */
function robe(s: S, seed: number, l0: number): Px {
  const fold = s.n(1.6, 6.0, 1.6, seed);
  return px(ROBE, l0 + 1.1 * (fold - 0.5) + 0.35 * (s.rnd(seed + 1) - 0.5)).h(0.5);
}

function apron(s: S, l0: number): Px {
  return cloth(s, APRON, 521, l0).h(0.9);
}

function keeperBody(s: S): Px {
  const r = s.iy;
  switch (s.f) {
    case 'top':
      if (within(s.ix, 2, 5) && within(s.iz, 1, 2)) {
        return px(LACE, 2.4);
      }
      if ((s.ix === 1 || s.ix === 6) && s.iz <= 1) {
        return apron(s, 3.6); // neck strap
      }
      return robe(s, 523, 4.6);
    case 'bottom':
      return robe(s, 525, 1.6);
  }
  // apron string around the waist
  const waist = r === 6;
  switch (s.f) {
    case 'front': {
      if (r === 0) {
        if (within(s.c, 2, 5)) {
          return px(LACE, within(s.c, 3, 4) ? 3.4 : 2.2).h(0.6); // shirt collar
        }
        return s.c === 1 || s.c === 6 ? apron(s, 3.4) : robe(s, 527, 4.0);
      }
      if (r === 1 && (s.c === 1 || s.c === 6)) {
        return apron(s, 3.2);
      }
      if (r >= 2 && within(s.c, 1, 6)) {
        // apron bib and skirt, with a pocket holding a coin
        if (r === 2) {
          return apron(s, 5.0);
        }
        if (waist) {
          return apron(s, 2.6).h(1.2);
        }
        if (within(r, 8, 10) && within(s.c, 2, 5)) {
          if (r === 8) {
            if (s.c === 4) {
              return px(GOLD, 6.0).h(1.3);
            }
            return apron(s, 2.4).h(1.2);
          }
          return apron(s, 3.8).dl(s.c === 5 ? -0.5 : 0.0);
        }
        const edge = s.c === 1 || s.c === 6;
        return apron(s, 4.4 - 0.1 * r - (edge ? 0.6 : 0.0));
      }
      return robe(s, 527, 3.8 - 0.1 * r);
    }
    case 'back':
      if (within(r, 5, 7) && within(s.c, 3, 4)) {
        return apron(s, r === 6 ? 3.2 : 4.2).h(1.4); // the knot
      }
      if (waist) {
        return apron(s, 3.0).h(1.0);
      }
      if (r === 7 && (s.c === 2 || s.c === 5)) {
        return apron(s, 3.4).h(1.0); // loose ends
      }
      return robe(s, 529, 3.8 - 0.1 * r);
    default:
      if (waist) {
        return apron(s, 3.0).h(1.0);
      }
      return robe(s, 531, 3.2 - 0.1 * r);
  }
}

function keeperArm(s: S): Px {
  const r = s.iy;
  switch (s.f) {
    case 'top':
      return robe(s, 541, 4.8);
    case 'bottom':
      return flesh(s, OLD_SKIN, 543, s.c % 2 === 1 ? 2.4 : 3.4);
  }
  if (r <= 8) {
    const p = robe(s, 545, 4.2 - 0.12 * r);
    if (r === 0) {
      p.l += 0.4;
    }
    return p;
  }
  // wide linen cuff, then the hand
  if (r === 9) {
    return px(LACE, 2.6 + 0.6 * (s.rnd(547) - 0.5)).h(1.2);
  }
  const p = flesh(s, OLD_SKIN, 543, 4.4);
  if (s.f === 'front') {
    if (r === 10) {
      p.l += s.c % 2 === 0 ? 0.5 : 0.0;
    } else if (s.c % 2 === 1) {
      p.l -= 1.2;
    }
  }
  return p;
}

function keeperLeg(s: S): Px {
  const r = s.iy;
  switch (s.f) {
    case 'top':
      return robe(s, 561, 3.0);
    case 'bottom':
      return px(LEATHER, s.r % 2 === 0 ? 0.3 : 0.9);
  }
  if (r <= 7) {
    // the robe's skirt, a hemmed edge
    if (r === 7) {
      return robe(s, 563, 2.4).h(1.0);
    }
    const p = robe(s, 565, 3.4 - 0.1 * r);
    if (s.side() && s.per % 4 === 1) {
      p.l -= 0.8; // folds
    }
    return p;
  }
  // soft shoes
  if (r === 11) {
    return px(LEATHER, 0.6).h(0.4);
  }
  const p = leather(s, 567, r === 8 ? 2.2 : 3.0);
  if (s.f === 'front' && r === 10) {
    p.l += 0.8;
  }
  return p;
}
