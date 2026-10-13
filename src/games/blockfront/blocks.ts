import type { BlockDefinition } from '@platform';

/**
 * Blockfront's own blocks, for Mos Blockley: sun-bleached plaster and adobe (with slabs and stairs
 * for the domes and the steps up to the roofs), painted round windows and dark doorways, sandstone
 * paving and packed sand; the Empire's durasteel panels, floor grates and strip lights; the
 * Rebels' olive hangar panels, amber lamps and hazard stripes; cloth awnings, crates, fuel drums
 * and moisture vaporators; ship hulls and engine glow; the canyon's banded rock; and for the ice
 * planet, snow slabs, packed snow, glacier ice, frost rock and the Rebels' base panels. Painted in
 * code; every screen and the server know them (shared.ts). The budget is 68 variants.
 */

/** A steady pseudo-random number in [0, 1) for a pixel (grain, specks, rivets). */
function grain(x: number, y: number, k = 0): number {
  let h = Math.imul(x + 17, 374761393) + Math.imul(y + 31, 668265263) + Math.imul(k + 7, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Pick from a palette by a pixel's grain. */
const pick = (colors: string[], x: number, y: number, k = 0) => colors[Math.floor(grain(x, y, k) * colors.length)];

// ---------------------------------------------------------------------------------------------
// The town: plaster, adobe, windows, doorways, paving
// ---------------------------------------------------------------------------------------------

/** '#rrggbb' scaled by k, as a colour. */
function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.max(0, Math.min(255, Math.round(v * k))));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Smooth render: a colour barely varying in broad swirls (tiling across the block), a fine grain,
 * a hairline crack here and there. Painted rather than mottled so it catches the light flat, the
 * way sun-baked plaster does.
 */
const render = (hex: string, k: number, grit = 0.03) => ({
  paint: (x: number, y: number) => {
    const swirl = Math.sin(((x + 3 * k) / 16) * Math.PI * 2) * Math.cos(((y + 5 * k) / 16) * Math.PI * 2 + x / 5);
    const crack = grain(x >> 1, y, 60 + k) < 0.018 || (grain(x, y >> 2, 61 + k) < 0.015 && x > 2);
    return shade(hex, crack ? 0.9 : 1 + 0.035 * swirl + grit * (grain(x, y, 62 + k) - 0.5));
  },
});

const PLASTER = render('#e9d8b6', 1);
const PLASTER_SAND = render('#dcc095', 2);
const ADOBE = render('#c99e6b', 3, 0.05);
/** The dust kicked up the bottom of every wall: darker toward the ground. */
const GRIME = { paint: (x: number, y: number) => shade('#c8ab82', 0.9 + (0.1 * (15 - y)) / 15 - 0.06 * grain(x, y, 64)) };

/** A round window set in plaster: a dark pane, a thin shadowed frame, a glint. */
const windowOf = (wall: string) => ({
  paint: (x: number, y: number) => {
    const d = Math.hypot(x - 7.5, y - 7.5);
    if (d < 4.6) return (x === 5 || x === 6) && y === 5 ? '#51606b' : d < 3.6 ? '#1b1a1e' : '#232126';
    if (d < 5.8) return '#8e7b5f';
    if (d < 6.6) return '#b8a27f';
    return grain(x, y, 11) < 0.12 ? '#e0cca7' : wall;
  },
});

/** Sandstone flags, a pale grout between them, the odd chip. */
const PAVING = {
  paint: (x: number, y: number) => {
    const row = y >> 3;
    const gx = (x + (row & 1 ? 4 : 0)) & 7;
    if ((y & 7) === 0 || gx === 0) return '#a89070';
    const flag = pick(['#d8c196', '#d2b98c', '#dcc69d', '#cfb487'], (x + (row & 1 ? 4 : 0)) >> 3, row, 4);
    return grain(x, y, 5) < 0.08 ? '#c4aa7e' : flag;
  },
};

/** Packed sand: the streets, trodden hard. */
const PACKED = { paint: (x: number, y: number) => shade('#cfb286', 0.95 + 0.07 * grain(x >> 1, y >> 1, 13) + 0.03 * grain(x, y, 14)) };

/** Big dressed sandstone blocks, for the docking bay's walls and the stairs' footings. */
const ASHLAR = {
  paint: (x: number, y: number) => {
    const course = y >> 3;
    const jx = (x + (course & 1 ? 8 : 0)) & 15;
    if ((y & 7) === 7 || jx === 15) return '#9c8360';
    if ((y & 7) === 0 || jx === 0) return '#dcc49a';
    return pick(['#cbb083', '#c6aa7d', '#d0b588'], x >> 2, y >> 2, 6);
  },
};

// ---------------------------------------------------------------------------------------------
// The Empire
// ---------------------------------------------------------------------------------------------

/** White-grey panels, a seam round each, a bevel catching the light along the top. */
const DURASTEEL = {
  paint: (x: number, y: number) => {
    if (x === 0 || y === 0) return '#9aa0a8';
    if (y === 1 || x === 1) return '#eef0f2';
    if (y === 8 && x > 2 && x < 14) return '#c4c8ce';
    return grain(x, y, 21) < 0.06 ? '#cdd1d6' : '#dadde1';
  },
};
const DURASTEEL_DARK = {
  paint: (x: number, y: number) => {
    if (x === 0 || y === 0) return '#2f3338';
    if (y === 1 || x === 1) return '#6b727b';
    if ((x === 3 || x === 12) && (y === 3 || y === 12)) return '#8a9099';
    return grain(x, y, 23) < 0.08 ? '#50565e' : '#575d65';
  },
};
/** A floor grate: slots over the dark. */
const GRATE = {
  paint: (x: number, y: number) => {
    if (x === 0 || y === 0 || x === 15 || y === 15) return '#6d737b';
    if ((y & 3) === 2 || (y & 3) === 3) return x === 1 || x === 14 ? '#5a6068' : '#17191c';
    return '#4b5158';
  },
};
/** A strip light behind a frame. */
const lightPanel = (glow: string, hot: string) => ({
  paint: (x: number, y: number) => {
    if (x < 2 || x > 13 || y < 2 || y > 13) return x === 0 || y === 0 || x === 15 || y === 15 ? '#3a3f45' : '#8b929a';
    return (x + y) % 5 === 0 ? hot : glow;
  },
});

// ---------------------------------------------------------------------------------------------
// The Rebels
// ---------------------------------------------------------------------------------------------

/** Olive-drab plating, rivets at the corners. */
const REBEL_PANEL = {
  paint: (x: number, y: number) => {
    if (x === 0 || y === 0) return '#4c4e37';
    if ((x === 2 || x === 13) && (y === 2 || y === 13)) return '#a3a57e';
    return grain(x, y, 31) < 0.1 ? '#6d704f' : pick(['#787b58', '#7c7f5b', '#747754'], x >> 2, y >> 2, 32);
  },
};
const HANGAR_FLOOR = { paint: (x: number, y: number) => (x === 0 || y === 0 ? '#8a867e' : shade('#a8a49b', 0.97 + 0.06 * grain(x >> 2, y >> 2, 33))) };
/** Hazard stripes on the slant: Rebel orange on dark grey, worn. */
const HAZARD = { paint: (x: number, y: number) => (((x + y) >> 2) & 1 ? (grain(x, y, 34) < 0.1 ? '#4a4a44' : '#3a3a36') : grain(x, y, 35) < 0.1 ? '#b85a22' : '#d9661f') };

// ---------------------------------------------------------------------------------------------
// The market, the bay and the desert
// ---------------------------------------------------------------------------------------------

/** Awning cloth in stripes, faded toward the edges. */
const cloth = (a: string, b: string) => ({ paint: (x: number, y: number) => ((x >> 2) & 1 ? (grain(x, y, 41) < 0.06 ? b : a) : b) });

const CRATE = {
  paint: (x: number, y: number) => {
    if (x < 2 || x > 13 || y < 2 || y > 13) return x === 0 || y === 0 || x === 15 || y === 15 ? '#5a3d22' : '#7a5530';
    if (x - y === 0 || x - y === 1) return '#7a5530';
    return (y & 3) === 0 ? '#95693d' : pick(['#a87a48', '#a37444', '#ae804d'], x, y >> 2, 42);
  },
};
const CRATE_METAL = {
  paint: (x: number, y: number) => {
    if (x === 0 || y === 0 || x === 15 || y === 15) return '#3e4750';
    if (y >= 6 && y <= 8) return '#e0b030';
    if ((x === 2 || x === 13) && (y === 2 || y === 13)) return '#9aa7b2';
    return grain(x, y, 43) < 0.1 ? '#5f6e7a' : '#687885';
  },
};
/** A fuel drum: rusty orange, two dark hoops. */
const DRUM_SIDE = { paint: (x: number, y: number) => (y === 3 || y === 12 ? '#5a2f16' : grain(x, y, 44) < 0.12 ? '#8e4a22' : x % 5 === 0 ? '#a95a2b' : '#b8652f') };
const DRUM_TOP = { paint: (x: number, y: number) => (Math.hypot(x - 7.5, y - 7.5) < 2 ? '#3a2412' : Math.hypot(x - 7.5, y - 7.5) > 6.5 ? '#6b3a1c' : '#9a5328') };

const VAPOR = { paint: (x: number, y: number) => ((y & 7) === 0 ? '#6e747c' : x % 4 === 1 ? '#e2e5e8' : grain(x, y, 51) < 0.1 ? '#9ea4ab' : '#bfc4ca') };
const VAPOR_DARK = { paint: (x: number, y: number) => ((y & 3) === 0 ? '#3c4046' : x % 4 === 1 ? '#8f959c' : '#6c7178') };

/** Ship plating: pale grey panels, a darker seam, greebles here and there. */
const HULL = {
  paint: (x: number, y: number) => {
    if (x === 0 || y === 0) return '#8d8e8c';
    if (grain(x >> 2, y >> 2, 61) < 0.18 && (x & 3) !== 0 && (y & 3) !== 0) return '#a9aaa5';
    return grain(x, y, 62) < 0.07 ? '#b7b8b2' : '#cbccc5';
  },
};
const HULL_DARK = { paint: (x: number, y: number) => (x === 0 || y === 0 ? '#4b4d50' : grain(x >> 1, y >> 1, 63) < 0.2 ? '#6a6d71' : '#777a7e') };
const COCKPIT = { paint: (x: number, y: number) => (x === 0 || y === 0 || x === 15 || y === 15 ? '#55585c' : x - y > 3 && x - y < 7 ? '#5f7e96' : '#1c2733') };
const GLOW_BLUE = { paint: (x: number, y: number) => (Math.hypot(x - 7.5, y - 7.5) < 4 ? '#e8fbff' : '#8fdcff') };

/** The canyon's rock in bands: rust, tan, a dark seam. */
const strata = (bands: string[]) => ({
  paint: (x: number, y: number) => {
    const wobble = Math.floor(grain(x >> 2, 0, 71) * 2);
    const b = bands[((y + wobble) >> 2) % bands.length];
    return grain(x, y, 72) < 0.12 ? '#8a5a34' : b;
  },
});

const LADDER = {
  paint: (x: number, y: number) => {
    if (x === 2 || x === 3 || x === 12 || x === 13) return '#5c636b';
    return (y & 3) === 1 ? '#8b939c' : null;
  },
};

/** Banners: vertical bands, the Rebels' orange and white, the Empire's red, black and grey. */
const BANNER_REBEL = { paint: (x: number) => (x < 3 || x > 12 ? '#f1ece2' : x === 7 || x === 8 ? '#f1ece2' : '#d9642a') };
const BANNER_IMPERIAL = { paint: (x: number, y: number) => (x < 2 || x > 13 ? '#1a1b1e' : (y & 7) === 3 && x > 4 && x < 11 ? '#c9ccd1' : '#a3201b') };

const SHADOW = { color: ['#2b221a', '#261e17', '#30271e'], noise: 0.3, scale: 3, seed: 81 };

// ---------------------------------------------------------------------------------------------
// The ice planet
// ---------------------------------------------------------------------------------------------

/** Trodden snow: the paths between the posts, grey-blue with boot prints. */
const PACKED_SNOW = { paint: (x: number, y: number) => shade(grain(x >> 1, y >> 2, 90) < 0.12 ? '#b9c6d2' : '#d3dde6', 0.97 + 0.05 * grain(x, y, 91)) };
/** Glacier ice in bands: blue-white, a darker streak, a crack. */
const GLACIER = {
  paint: (x: number, y: number) => {
    const band = ((y + Math.floor(grain(x >> 3, 0, 92) * 3)) >> 2) % 3;
    if (grain(x, y >> 1, 93) < 0.03) return '#7fa7c4';
    return shade(band === 0 ? '#cfe6f5' : band === 1 ? '#b3d4ec' : '#c2def2', 0.97 + 0.05 * grain(x, y, 94));
  },
};
/** Blue-grey rock, flecked. */
const FROST_ROCK = { paint: (x: number, y: number) => shade(grain(x >> 1, y >> 1, 95) < 0.18 ? '#4d5663' : '#66707d', 0.94 + 0.12 * grain(x, y, 96)) };
/** The Rebels' insulated base panels: off-white, ribbed, a bolt at each corner. */
const BASE_PANEL = {
  paint: (x: number, y: number) => {
    if (x === 0 || y === 0) return '#8e979f';
    if ((x === 2 || x === 13) && (y === 2 || y === 13)) return '#9aa3ab';
    return (x & 3) === 3 ? '#c9cfd4' : shade('#dde2e6', 0.98 + 0.03 * grain(x, y, 97));
  },
};

export const BLOCKS: Record<string, BlockDefinition> = {
  // The town.
  plaster: { texture: PLASTER, hardness: 1 },
  plaster_slab: { label: 'Plaster Slab', texture: PLASTER, shape: 'slab', full: 'plaster', hardness: 1 },
  plaster_stairs: { label: 'Plaster Stairs', texture: PLASTER, shape: 'stairs', hardness: 1 },
  plaster_sand: { label: 'Sand Plaster', texture: PLASTER_SAND, hardness: 1 },
  adobe: { texture: ADOBE, hardness: 1 },
  plaster_grime: { label: 'Dusty Plaster', texture: GRIME, hardness: 1 },
  plaster_window: { label: 'Round Window', texture: { side: windowOf('#e9d8b6'), top: PLASTER, bottom: PLASTER }, hardness: 1 },
  sand_window: { label: 'Sand Plaster Window', texture: { side: windowOf('#dcc095'), top: PLASTER_SAND, bottom: PLASTER_SAND }, hardness: 1 },
  adobe_window: { label: 'Adobe Window', texture: { side: windowOf('#c99e6b'), top: ADOBE, bottom: ADOBE }, hardness: 1 },
  doorway: { label: 'Dark Doorway', texture: SHADOW, hardness: 1 },
  paving: { texture: PAVING, hardness: 1.5 },
  packed_sand: { label: 'Packed Sand', texture: PACKED, hardness: 0.8 },
  ashlar: { label: 'Dressed Sandstone', texture: ASHLAR, hardness: 1.5 },
  // The Empire.
  durasteel: { texture: DURASTEEL, hardness: 2 },
  durasteel_dark: { label: 'Dark Durasteel', texture: DURASTEEL_DARK, hardness: 2 },
  floor_grate: { texture: GRATE, hardness: 2 },
  imperial_light: { texture: lightPanel('#e9f4ff', '#ffffff'), light: 13, glow: 0.9, hardness: 1 },
  imperial_red: { label: 'Imperial Red Light', texture: lightPanel('#e0261c', '#ff4a3a'), light: 9, glow: 0.75, hardness: 1 },
  // The Rebels.
  rebel_panel: { texture: REBEL_PANEL, hardness: 2 },
  hangar_floor: { texture: HANGAR_FLOOR, hardness: 2 },
  rebel_light: { texture: lightPanel('#ffb347', '#ffe0a0'), light: 13, glow: 0.9, hardness: 1 },
  hazard: { label: 'Hazard Stripes', texture: HAZARD, hardness: 2 },
  // The market and the bay.
  awning_red: { label: 'Red Awning', texture: cloth('#b5392c', '#ecdfc4'), boxes: [[0, 13, 0, 16, 15, 16]], solid: false, hardness: 0.3 },
  awning_blue: { label: 'Blue Awning', texture: cloth('#2d6d8c', '#e3d9c2'), boxes: [[0, 13, 0, 16, 15, 16]], solid: false, hardness: 0.3 },
  awning_ochre: { label: 'Ochre Awning', texture: cloth('#c4772d', '#8c4b20'), boxes: [[0, 13, 0, 16, 15, 16]], solid: false, hardness: 0.3 },
  crate: { texture: CRATE, hardness: 1 },
  crate_metal: { label: 'Cargo Crate', texture: CRATE_METAL, hardness: 1.5 },
  fuel_drum: { texture: { side: DRUM_SIDE, top: DRUM_TOP, bottom: DRUM_TOP }, boxes: [[2, 0, 2, 14, 16, 14], [1, 2, 1, 15, 4, 15], [1, 11, 1, 15, 13, 15]], hardness: 1 },
  vaporator_base: { texture: VAPOR_DARK, boxes: [[2, 0, 2, 14, 16, 14]], hardness: 1.5 },
  vaporator_pipe: { texture: VAPOR, shape: 'post', hardness: 1.5 },
  vaporator_ring: { texture: VAPOR, boxes: [[1, 6, 1, 15, 9, 15], [6, 0, 6, 10, 16, 10]], hardness: 1.5 },
  pad_blue: { label: 'Blue Pad Light', texture: GLOW_BLUE, light: 10, glow: 1, hardness: 1 },
  pad_amber: { label: 'Amber Pad Light', texture: { paint: (x, y) => (Math.hypot(x - 7.5, y - 7.5) < 4 ? '#fff1c9' : '#ffb347') }, light: 10, glow: 1, hardness: 1 },
  // Ships.
  hull: { label: 'Hull Plating', texture: HULL, hardness: 2 },
  hull_dark: { label: 'Dark Hull Plating', texture: HULL_DARK, hardness: 2 },
  hull_slab: { label: 'Hull Plating Slab', texture: HULL, shape: 'slab', full: 'hull', hardness: 2 },
  cockpit: { label: 'Cockpit Glass', texture: COCKPIT, hardness: 1 },
  engine_glow: { texture: GLOW_BLUE, light: 12, glow: 1, hardness: 1 },
  thruster: { texture: { top: GLOW_BLUE, bottom: GLOW_BLUE, all: HULL_DARK }, boxes: [[3, 0, 3, 13, 16, 13]], facing: 'axis', light: 7, glow: 0.6, hardness: 1 },
  // The canyon.
  canyon_rock: { texture: strata(['#c4854f', '#b87844', '#cf9660', '#a86a3a']), hardness: 3 },
  canyon_rock_pale: { label: 'Pale Canyon Rock', texture: strata(['#d9b07c', '#cfa26d', '#e0bb8a', '#c49565']), hardness: 3 },
  // The ice planet.
  snow_slab: { label: 'Snow Slab', texture: 'snow', shape: 'slab', full: 'snow_block', hardness: 0.4 },
  packed_snow: { label: 'Packed Snow', texture: PACKED_SNOW, hardness: 0.6 },
  glacier: { label: 'Glacier Ice', texture: GLACIER, hardness: 3 },
  frost_rock: { label: 'Frost Rock', texture: FROST_ROCK, hardness: 3 },
  base_panel: { label: 'Base Panel', texture: BASE_PANEL, hardness: 2 },
  // Poles, rails, getting up.
  pole: { label: 'Wooden Pole', texture: { top: 'spruce_log_top', bottom: 'spruce_log_top', side: 'spruce_log' }, shape: 'post', hardness: 1 },
  railing: { texture: VAPOR, shape: 'fence', hardness: 1.5 },
  ladder: { texture: LADDER, boxes: [[0, 0, 14, 16, 16, 16]], facing: true, climbable: true, transparency: 'cutout', solid: false, hardness: 0.5 },
  banner_rebel: { label: 'Rebel Banner', texture: BANNER_REBEL, shape: 'pane', hardness: 0.3 },
  banner_imperial: { label: 'Imperial Banner', texture: BANNER_IMPERIAL, shape: 'pane', hardness: 0.3 },
};
