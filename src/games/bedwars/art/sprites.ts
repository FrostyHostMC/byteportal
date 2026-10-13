/**
 * Bed Wars item sprites (16x16, Minecraft conventions: dark outline, light from the top left,
 * tools on the diagonal with the head at the top right).
 */
import { type Canvas, clamp, type Ink, rnd, SpriteCanvas, vnoise3 } from '@platform/art';

// ============================================================================
// Helpers
// ============================================================================

/** ASCII art with an automatic outline; `inks` maps a character to [colour, outline]. */
function draw(rows: readonly string[], inks: Record<string, readonly [number, number]>): SpriteCanvas {
  const s = new SpriteCanvas();
  const ink: Ink[] = Object.entries(inks).map(([ch, [c, ol]]) => [ch, c, ol, 0]);
  s.art(rows, ink);
  s.outline();
  return s;
}

/** Material ramp for sprites: outline, dark, mid, light, highlight. */
interface Ramp {
  o: number;
  d: number;
  m: number;
  l: number;
  w: number;
}

const IRON: Ramp = { o: 0x2c2f33, d: 0x6c7178, m: 0x9da3a9, l: 0xcbcfd3, w: 0xf5f6f7 };
const GOLDEN: Ramp = { o: 0x4f3204, d: 0xb07410, m: 0xdca021, l: 0xf7cf45, w: 0xfff5b0 };
const DIAMOND: Ramp = { o: 0x0b3a3d, d: 0x14878a, m: 0x28bdb6, l: 0x5fe8dc, w: 0xd2fff8 };
const EMERALD: Ramp = { o: 0x07331a, d: 0x0f7a37, m: 0x19a84b, l: 0x3fd672, w: 0xb9ffd0 };
const WOOD: Ramp = { o: 0x3a2610, d: 0x7a5530, m: 0x9c7443, l: 0xbd9559, w: 0xd6b378 };
const HIDE: Ramp = { o: 0x3a1f0e, d: 0x72421f, m: 0x93582b, l: 0xb3733c, w: 0xcf9258 };
const STICK = { l: 0x8a6436, d: 0x5e4020, o: 0x26180a };

/** The ramp as ASCII inks (d dark, m mid, l light, w highlight), outlined in its darkest shade. */
function inks(r: Ramp): Record<string, readonly [number, number]> {
  return { d: [r.d, r.o], m: [r.m, r.o], l: [r.l, r.o], w: [r.w, r.o] };
}

// ============================================================================
// Sprites
// ============================================================================

export const SPRITES = [
  'iron_ingot',
  'gold_ingot',
  'diamond',
  'emerald',
  'shears',
  'wooden_pickaxe',
  'iron_pickaxe',
  'diamond_pickaxe',
  'golden_apple',
  'fire_charge',
  'leather_armor',
  'iron_armor',
  'diamond_armor',
  'bed',
] as const;

export type SpriteName = (typeof SPRITES)[number];

function paintSprite(name: SpriteName): SpriteCanvas {
  switch (name) {
    case 'iron_ingot':
      return ingot(IRON);
    case 'gold_ingot':
      return ingot(GOLDEN);
    case 'diamond':
      return draw(DIAMOND_ART, inks(DIAMOND));
    case 'emerald':
      return draw(EMERALD_ART, inks(EMERALD));
    case 'shears':
      return shears();
    case 'wooden_pickaxe':
      return pickaxe(WOOD);
    case 'iron_pickaxe':
      return pickaxe(IRON);
    case 'diamond_pickaxe':
      return pickaxe(DIAMOND);
    case 'golden_apple':
      return goldenApple();
    case 'fire_charge':
      return fireCharge();
    case 'leather_armor':
      return chestplate(HIDE, 'leather');
    case 'iron_armor':
      return chestplate(IRON, 'iron');
    case 'diamond_armor':
      return chestplate(DIAMOND, 'diamond');
    case 'bed':
      return bed();
  }
}

export function sprites(cv: Canvas, cellOf: (name: SpriteName) => { x: number; y: number }) {
  for (const name of SPRITES) {
    const { x, y } = cellOf(name);
    paintSprite(name).blit(cv, x, y);
  }
}

// ----------------------------------------------------------------------------
// Resources
// ----------------------------------------------------------------------------

/** An ingot lying on the diagonal: bright top face, a darker long side and a shaded end. */
const INGOT_ART = [
  '................',
  '................',
  '................',
  '................',
  '.........wwll...',
  '.......wwllllll.',
  '.....wwlllllllm.',
  '...wwllllllmmdd.',
  '.wwllllllmmdd...',
  '.mmllllmmdd.....',
  '.mmmmmddd.......',
  '...mmdd.........',
  '................',
  '................',
  '................',
  '................',
];

function ingot(r: Ramp): SpriteCanvas {
  return draw(INGOT_ART, inks(r));
}

/** A cut gem: a flat table on a lit crown, the pavilion tapering to a point. */
const DIAMOND_ART = [
  '................',
  '................',
  '................',
  '.....wwllll.....',
  '....wwwllllm....',
  '...wwlllllmmm...',
  '..wllllllmmmmd..',
  '..mlllllmmmddd..',
  '...mllllmmmdd...',
  '....mlllmmdd....',
  '.....mllmdd.....',
  '......mlmd......',
  '.......md.......',
  '................',
  '................',
  '................',
];

const EMERALD_ART = [
  '................',
  '................',
  '......wwll......',
  '.....wllllm.....',
  '....wlmmmmmd....',
  '....llwmmmmd....',
  '....llmmmmmd....',
  '....llmmmmmd....',
  '....llmmmmmd....',
  '....llmmmmmd....',
  '....lmmmmmdd....',
  '.....mddddd.....',
  '......dddd......',
  '................',
  '................',
  '................',
];

// ----------------------------------------------------------------------------
// Tools
// ----------------------------------------------------------------------------

/**
 * A pickaxe on the tool diagonal: an arched head, symmetric about the handle (w/l/m/d head
 * shades, s/S the stick's lit and shaded sides).
 */
const PICKAXE_ART = [
  '................',
  '................',
  '.....wwwwwwww...',
  '...lllllllllll..',
  '..mm...mmmmmlm..',
  '..........slmd..',
  '.........sSlmd..',
  '........sS.lmd..',
  '.......sS..lmd..',
  '......sS....md..',
  '.....sS.....md..',
  '....sS......m...',
  '...sS......dd...',
  '..sS.......d....',
  '.sS.............',
  '................',
];

function pickaxe(head: Ramp): SpriteCanvas {
  return draw(PICKAXE_ART, { ...inks(head), s: [STICK.l, STICK.o], S: [STICK.d, STICK.o] });
}

/** Open iron blades crossing at a rivet (r), with looped handles (H lit, h shaded). */
const SHEARS_ART = [
  '................',
  '.............w..',
  '............wl..',
  '...........wl...',
  '..........wl..m.',
  '.........wl.mmd.',
  '..HH....wlmmd...',
  '.H..hhhrmd......',
  '.H..h..h........',
  '..hh...h........',
  '......HH........',
  '.....H..h.......',
  '.....H..h.......',
  '......hh........',
  '................',
  '................',
];

/** The finger holes stay open (the outline pass would fill them). */
const SHEARS_HOLES = [[2, 7], [3, 7], [2, 8], [3, 8], [6, 11], [7, 11], [6, 12], [7, 12]] as const;

function shears(): SpriteCanvas {
  const s = draw(SHEARS_ART, { ...inks(IRON), h: [0x5a6068, IRON.o], H: [0x8a9098, IRON.o], r: [0x3a3e44, IRON.o] });
  for (const [x, y] of SHEARS_HOLES) s.a[y * 16 + x] = 0;
  return s;
}

// ----------------------------------------------------------------------------
// Consumables
// ----------------------------------------------------------------------------

const APPLE = [0x5a3104, 0x9a5a08, 0xcf8a12, 0xeeb52a, 0xfbd54e, 0xffee96, 0xfffbe0];
const APPLE_LEAF = [0x3a4a08, 0x8aa018, 0xc8dc3a];

function goldenApple(): SpriteCanvas {
  const s = new SpriteCanvas();
  const [cx, cy] = [7.6, 9.3];
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const nx = (x + 0.5 - cx) / 6.1;
      const ny = (y + 0.5 - cy) / 5.7;
      // a dimple at the top where the stem sits
      const dip = ny < 0.0 ? 0.22 * Math.exp(-((nx * 3.2) ** 2)) : 0.0;
      const r2 = nx * nx + ny * ny;
      if (Math.sqrt(r2) > 1.0 - dip) continue;
      const nz = Math.sqrt(Math.max(1.0 - r2, 0.0));
      const lit = -0.55 * nx - 0.6 * ny + 0.58 * nz;
      let l = clamp(Math.floor(1.0 + 4.2 * lit + 0.6 * rnd(x, y, 801)), 0, 5);
      if (Math.hypot(nx + 0.42, ny + 0.38) < 0.2) l = 6; // highlight
      s.put(x, y, APPLE[l], APPLE[0]);
    }
  }
  // stem and leaf
  for (const [x, y] of [[7, 3], [7, 2], [8, 1]] as const) s.put(x, y, 0x6b4a22, 0x2a1a08);
  for (const [x, y, l] of [[9, 2, 2], [10, 2, 2], [9, 3, 1], [10, 3, 2], [11, 3, 1], [11, 2, 1]] as const) {
    s.put(x, y, APPLE_LEAF[l], APPLE_LEAF[0]);
  }
  s.outline();
  return s;
}

const CRUST = [0x0e0706, 0x1e0f0b, 0x341710, 0x4e1f12];
const MOLTEN = [0x8a1e08, 0xc8400c, 0xf2761a, 0xffb52e, 0xffe98a];

/** A smouldering ball: dark crust split by a web of glowing, molten cracks. */
function fireCharge(): SpriteCanvas {
  const s = new SpriteCanvas();
  const [cx, cy, R] = [7.5, 7.5, 6.4];
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const [dx, dy] = [x + 0.5 - cx, y + 0.5 - cy];
      const r = Math.hypot(dx, dy) / R;
      if (r > 1.0) continue;
      const nz = Math.sqrt(Math.max(1.0 - r * r, 0.0));
      const lit = (-0.55 * dx - 0.6 * dy) / R + 0.5 * nz;
      // cracks where either of two noise fields crosses its midpoint
      const n1 = vnoise3(x / 3.1, y / 3.1, 1.5, 811);
      const n2 = vnoise3(x / 2.2, y / 2.2, 7.5, 812);
      const crack = Math.min(Math.abs(n1 - 0.5), Math.abs(n2 - 0.5) * 1.3);
      // the glow is strongest in the core
      const heat = 1.0 - 0.6 * r;
      if (crack < 0.045 * (0.6 + heat)) {
        const l = clamp(Math.round(1.0 + 3.6 * heat - 12.0 * crack), 0, 4);
        s.put(x, y, MOLTEN[l], CRUST[0]);
        s.glow(x, y, 150 + 26 * l);
      } else {
        const l = clamp(Math.round(1.0 + 2.2 * lit + 0.6 * (rnd(x, y, 813) - 0.5)), 0, 3);
        s.put(x, y, CRUST[l], CRUST[0]);
      }
    }
  }
  s.outline();
  return s;
}

// ----------------------------------------------------------------------------
// Armour
// ----------------------------------------------------------------------------

/** A chestplate: shoulder guards over a rounded torso, a V neck and a hem band. */
const CHEST_ART = [
  '................',
  '.wllm......dlmd.',
  '.wlllm....dlmmd.',
  '.wllllm..dllmmd.',
  '.wlllllmmllllmd.',
  '.wlllllmdlllmmd.',
  '...wlllmdllmmd..',
  '...wlllmdllmmd..',
  '...wlllmdllmmd..',
  '...wlllmdllmmd..',
  '...wllmmdlmmmd..',
  '...wllmmdmmmdd..',
  '...mmmmmmmmmmm..',
  '...dddddddddd...',
  '................',
  '................',
];

/** Per-material details: stitches on leather, rivets on iron, glints on diamond. */
const CHEST_DETAIL: Record<'leather' | 'iron' | 'diamond', readonly (readonly [number, number, string])[]> = {
  leather: [[4, 12, 'l'], [6, 12, 'l'], [9, 12, 'l'], [11, 12, 'l'], [2, 4, 'd'], [13, 4, 'd'], [2, 5, 'm'], [13, 5, 'd']],
  iron: [[2, 2, 'w'], [13, 2, 'l'], [4, 7, 'w'], [11, 7, 'l'], [4, 11, 'w'], [11, 11, 'l']],
  diamond: [[3, 3, 'w'], [4, 7, 'w'], [5, 8, 'w'], [10, 5, 'w']],
};

function chestplate(r: Ramp, kind: 'leather' | 'iron' | 'diamond'): SpriteCanvas {
  const rows = CHEST_ART.map((row) => row.split(''));
  for (const [x, y, ch] of CHEST_DETAIL[kind]) rows[y][x] = ch;
  return draw(rows.map((row) => row.join('')), inks(r));
}

// ----------------------------------------------------------------------------
// Bed
// ----------------------------------------------------------------------------

/** A red bed from the side and a little above: white pillow, folded blanket, oak frame. */
const BED_ART = [
  '................',
  '................',
  '................',
  '................',
  '................',
  '..wwww..........',
  '.wwwwwwFRRRRRRR.',
  '.pWWWWpFRRRRRRR.',
  '.ppppppfrrrrrrr.',
  '.oooooooooooooo.',
  '.OOOOOOOOOOOOOO.',
  '.L............L.',
  '................',
  '................',
  '................',
  '................',
];

function bed(): SpriteCanvas {
  return draw(BED_ART, {
    w: [0xf4f4f0, 0x3a3a38],
    W: [0xe2e2dc, 0x3a3a38],
    p: [0xbcbcb4, 0x3a3a38],
    F: [0xf0685a, 0x3d0b08],
    f: [0xc8372c, 0x3d0b08],
    R: [0xd8352c, 0x3d0b08],
    r: [0xa0221c, 0x3d0b08],
    o: [0xb08650, 0x3a2610],
    O: [0x7a5530, 0x3a2610],
    L: [0x5e4020, 0x26180a],
  });
}
