import type { BlockDefinition } from '@platform';

/**
 * Call of Blocky's own blocks: for Big Kahuna Burger's Hawaiian kitsch, thatch (and its slabs and
 * stairs, for roofs), bamboo (walls, and poles lying any way), carved tiki heads, chain-link, and
 * the drive-thru's menu board; for Hijacked's yacht, teak decking (and its slabs and stairs),
 * window glass, stainless rails, portholes, sofas, sun loungers and lifebuoys; for Nukeblock,
 * clapboard siding in mint and butter yellow, white pickets and the test town's mannequins. Painted in code; every screen and the server know them (shared.ts).
 */

const STRAW = ['#caa14c', '#b78c3c', '#d9b560', '#a67c30', '#c09545'];
/** Straw laid in overlapping courses, the strands running down and a little across. */
const thatch = { paint: (x: number, y: number) => STRAW[(x * 3 + ((y >> 2) & 1) * 2 + ((x * 7 + y) % 3 === 0 ? 1 : 0)) % STRAW.length] };

const CANE = ['#7c6a2a', '#a8923e', '#c8b25a', '#d6c26c', '#c8b25a', '#a8923e', '#7c6a2a'];
/** Bamboo canes side by side, a knot every eight pixels. */
const bambooSide = {
  paint: (x: number, y: number) => {
    const knot = y % 8 === 0;
    const across = x % 4;
    if (knot) return across === 0 ? '#5d4f1c' : '#8f7b33';
    return CANE[across === 0 ? 0 : across === 1 ? 2 : across === 2 ? 3 : 5];
  },
};
const bambooEnd = { paint: (x: number, y: number) => ((x % 4 === 0 || y % 4 === 0) ? '#6e5e24' : (x + y) % 4 < 2 ? '#d6c26c' : '#c1ab55') };

const WOOD = { color: ['#6e4222', '#7a4a24', '#86542b', '#734524'], noise: 0.35, scale: 2 };

/** A carved tiki face: heavy brows, round eyes, a big grin of teeth. */
const TIKI_FACE = {
  pixels: [
    'BBBBBBBBBBBBBBBB',
    'BddddddddddddddB',
    'BdBBBBBddBBBBBdB',
    'BdBYYYBddBYYYBdB',
    'BdBYKYBddBYKYBdB',
    'BdBYYYBddBYYYBdB',
    'BdBBBBBddBBBBBdB',
    'BddddddBBddddddB',
    'BdddddBddBdddddB',
    'BddddBBddBBddddB',
    'BdBBBBBBBBBBBBdB',
    'BdBWKWKWKWKWKBdB',
    'BdBKWKWKWKWKWBdB',
    'BdBBBBBBBBBBBBdB',
    'BddddddddddddddB',
    'BBBBBBBBBBBBBBBB',
  ],
  palette: { B: '#3b2412', d: '#7a4a24', Y: '#f2c418', K: '#111111', W: '#f4efe2' },
};

/** The drive-thru menu: a black board, BIG KAHUNA across the top, burgers and prices. */
const MENU = {
  pixels: [
    'iiiiiiiiiiiiiiii',
    'iYYYYYYYYYYYYYYi',
    'iYRRRYRRYRRRRRYi',
    'iYYYYYYYYYYYYYYi',
    'ikkkkkkkkkkkkkki',
    'ikOOkwwwwwwkggki',
    'ikBBkkkkkkkkkkki',
    'ikOOkwwwwkkkggki',
    'ikkkkkkkkkkkkkki',
    'ikOOkwwwwwkkggki',
    'ikBBkkkkkkkkkkki',
    'ikOOkwwwkkkkggki',
    'ikkkkkkkkkkkkkki',
    'ikpkwwwwwwwwkkki',
    'ikkkkkkkkkkkkkki',
    'iiiiiiiiiiiiiiii',
  ],
  palette: { i: '#9aa0a6', Y: '#ffcc00', R: '#e63946', k: '#141414', O: '#f08a24', B: '#6b3a1f', w: '#f4efe2', g: '#7bd389', p: '#ff5c8a' },
};


const TEAK = ['#b67d47', '#ab7442', '#bd8650', '#a66f3d'];
/** Teak decking: long planks four pixels wide, a thin dark seam of caulking between, grain streaks along them. */
const teak = {
  paint: (x: number, y: number) => {
    if ((y & 3) === 3) return '#43301f';
    const plank = y >> 2;
    if ((x * 7 + plank * 13 + (y & 3) * 5) % 17 === 0) return '#96612f';
    return TEAK[(plank * 3 + ((x * 5 + (y & 3)) % 9 === 0 ? 1 : 0)) % TEAK.length];
  },
};

/** Window glass: clear, a thin frame along its foot, a glint in a corner. */
const yachtGlass = {
  paint: (x: number, y: number) => {
    if (y === 15) return '#cfd6db';
    if ((x === 12 && y === 2) || (x === 13 && y === 3) || (x === 13 && y === 2)) return '#f4fbff';
    return null;
  },
};

/** Brushed stainless steel: rails, stanchions, a highlight down each. */
const steel = { paint: (x: number, y: number) => (x % 4 === 1 ? '#f3f5f6' : x % 4 === 3 ? '#b7bfc5' : (x * 3 + y) % 11 === 0 ? '#cdd3d7' : '#dde1e4') };

/** Gleaming white paint: a yacht's decks seen from below, and their edges. */
const PAINT = { color: ['#f3f2ee', '#efeee9', '#f5f4f1'], noise: 0.04 };
/** A painted deck: its top in `top`, white under it and round its edges. */
const painted = (top: { color: string | string[]; noise?: number } | { paint(x: number, y: number): string | null }) => ({ top, bottom: PAINT, side: PAINT });

/** Gold leaf, brushed. */
const GILT = { color: ['#d4b25a', '#c7a24a', '#e0c36e', '#bb953f'], noise: 0.18, scale: 2 };

/** A porthole in a white hull: a steel ring round dark glass, a glint in it. */
const PORTHOLE = {
  pixels: [
    'WWWWWWWWWWWWWWWW',
    'WWWWWWWWWWWWWWWW',
    'WWWWWSSSSSSWWWWW',
    'WWWSSSssssSSSWWW',
    'WWWSSsGGGGsSSWWW',
    'WWSSsGGgGGGsSSWW',
    'WWSsGGgGGGGGsSWW',
    'WWSsGgGGGGGGsSWW',
    'WWSsGGGGGGGGsSWW',
    'WWSsGGGGGGGGsSWW',
    'WWSSsGGGGGGsSSWW',
    'WWWSSsGGGGsSSWWW',
    'WWWSSSssssSSSWWW',
    'WWWWWSSSSSSWWWWW',
    'WWWWWWWWWWWWWWWW',
    'WWWWWWWWWWWWWWWW',
  ],
  palette: { W: '#f2f1ec', S: '#c9d0d5', s: '#8e979d', G: '#1c2a38', g: '#7fa6c4' },
};
const HULL = { color: ['#f2f1ec', '#efeee8', '#f4f3ef'], noise: 0.06 };

/** Cream leather. */
const LEATHER = { color: ['#efe6d6', '#e8dcc8', '#f3ecdf', '#e4d6c0'], noise: 0.14, scale: 2 };

/** A lifebuoy: red and white quarters round a hole, rope looped round it. */
const lifebuoy = {
  paint: (x: number, y: number) => {
    const dx = x - 7.5;
    const dy = y - 7.5;
    const r = Math.hypot(dx, dy);
    if (r > 7.6 || r < 3.6) return null;
    if (Math.abs(r - 5.6) < 0.55 && (x + y) % 3 === 0) return '#e9dcb8';
    const quarter = (dx > 0 ? 1 : 0) + (dy > 0 ? 1 : 0);
    return quarter === 1 ? '#f4f1ea' : '#e04a2f';
  },
};

/** Clapboard siding: boards four pixels tall, a shadow under each one's lip, a little grain. */
const siding = (boards: string[], shadow: string) => ({
  paint: (x: number, y: number) => ((y & 3) === 3 ? shadow : boards[((y >> 2) * 3 + ((x * 5 + y) % 11 === 0 ? 1 : 0)) % boards.length]),
});
const MINT = siding(['#a6d8b8', '#9fd2b1', '#acdcbd'], '#76a98a');
const BUTTER = siding(['#f2de8c', '#eed886', '#f5e394'], '#c4ac5e');

/** A test-town mannequin's painted plaster. */
const PLASTER = { color: ['#ead9bd', '#e4d2b4', '#efe0c6'], noise: 0.08 };

export const BLOCKS: Record<string, BlockDefinition> = {
  thatch: { texture: thatch, hardness: 0.6 },
  thatch_slab: { label: 'Thatch Slab', texture: thatch, shape: 'slab', full: 'thatch', hardness: 0.6 },
  thatch_stairs: { label: 'Thatch Stairs', texture: thatch, shape: 'stairs', hardness: 0.6 },
  bamboo: { texture: { top: bambooEnd, bottom: bambooEnd, side: bambooSide }, hardness: 1 },
  bamboo_pole: { texture: { top: bambooEnd, bottom: bambooEnd, side: bambooSide }, shape: 'post', facing: 'axis', hardness: 1 },
  tiki: { texture: { front: TIKI_FACE, all: WOOD }, facing: true, hardness: 1.5 },
  chain_link: { texture: { paint: (x: number, y: number) => ((x + y) % 5 === 0 || (x - y + 20) % 5 === 0 ? '#a3a9b0' : null) }, shape: 'pane', transparency: 'cutout', hardness: 1 },
  menu_board: { texture: { front: MENU, all: { color: '#2b2b2e', noise: 0.1 } }, boxes: [[0, 0, 7, 16, 16, 9]], facing: true, hardness: 1 },
  teak: { texture: teak, hardness: 1 },
  teak_slab: { label: 'Teak Slab', texture: teak, shape: 'slab', full: 'teak', hardness: 1 },
  teak_stairs: { label: 'Teak Stairs', texture: teak, shape: 'stairs', hardness: 1 },
  yacht_glass: { label: 'Window Glass', texture: yachtGlass, transparency: 'transparent', hardness: 0.3 },
  rail: { label: 'Stainless Rail', texture: steel, shape: 'fence', hardness: 1 },
  // Decks: teak on top, white paint under (the ceiling below) and on the edges.
  teak_deck: { label: 'Teak Deck', texture: painted(teak), hardness: 1 },
  helipad: { texture: painted({ color: ['#a9aca8', '#a3a6a2', '#aeb1ad'], noise: 0.08 }), hardness: 1 },
  helipad_line: { label: 'Helipad Line', texture: painted({ color: ['#f0c233', '#e8b92a'], noise: 0.08 }), hardness: 1 },
  helipad_mark: { label: 'Helipad Mark', texture: painted({ color: ['#f4f4f0', '#ecece6'], noise: 0.05 }), hardness: 1 },
  gilt: { texture: GILT, hardness: 1 },
  porthole: { texture: { front: PORTHOLE, all: HULL }, facing: true, hardness: 1.5 },
  // A sofa faces where you sit looking: the back along its far side.
  sofa: { texture: LEATHER, boxes: [[0, 0, 0, 16, 7, 16], [0, 7, 11, 16, 15, 16]], facing: true, hardness: 0.6 },
  lounger: { label: 'Sun Lounger', texture: LEATHER, boxes: [[1, 0, 0, 15, 4, 16], [1, 4, 9, 15, 9, 16]], facing: true, hardness: 0.6 },
  lifebuoy: { texture: { front: lifebuoy, all: lifebuoy }, boxes: [[0, 0, 15, 16, 16, 16]], facing: true, transparency: 'cutout', hardness: 0.3 },
  siding_green: { label: 'Mint Siding', texture: MINT, hardness: 1 },
  siding_yellow: { label: 'Butter Siding', texture: BUTTER, hardness: 1 },
  picket: { label: 'Picket Fence', texture: { color: ['#f4f2ec', '#eeebe3'], noise: 0.05 }, shape: 'fence', hardness: 0.6 },
  // A mannequin is two blocks: its legs (the same whichever way it looks), then its body, arms
  // and head, which face a way (written facing north).
  mannequin_legs: { label: 'Mannequin', texture: PLASTER, boxes: [[5, 0, 6, 7, 14, 10], [9, 0, 6, 11, 14, 10], [5, 14, 5, 11, 16, 11]], hardness: 0.5 },
  mannequin_torso: { label: 'Mannequin', texture: PLASTER, boxes: [[4, 0, 5, 12, 8, 11], [2, 1, 6, 4, 8, 10], [12, 1, 6, 14, 8, 10], [7, 8, 7, 9, 10, 9], [5, 10, 5, 11, 15, 11]], facing: true, hardness: 0.5 },
};
