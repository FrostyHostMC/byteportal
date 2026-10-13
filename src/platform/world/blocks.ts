import type { BlockDefinition, BlockFaces, BlockTexture, GameDefinition } from '../api/types';
import { engine } from '../engine/wasm';

/**
 * A game's own blocks (`GameDefinition.blocks`), made ready for the engine and the renderer.
 *
 * Each block becomes one variant (a cube, a plant) or several (a slab's two halves, stairs' eight
 * turns), given ids after the built-in blocks in the order they're defined, so the host and every
 * player's screen, all running the same definitions, agree on them. The engine takes them as JSON
 * (`set_game_blocks`) in every instance that needs them: the host's, the page's, each terrain
 * worker's. Their textures are layers after the built-in ones, painted on the client
 * (`render/blocktextures`).
 *
 * Ids are kept by name where they outlive a session: a save holds the keys of the ids it used
 * (`keys`), and loading it with other definitions (reordered, some gone) translates them
 * (`remapEdits`); a server tells joining players its keys, and their screens take the same ids.
 */

/** Faces in the engine's order (+X -X +Y -Y +Z -Z) and the name each goes by in `BlockFaces`. */
const FACES = ['east', 'west', 'top', 'bottom', 'south', 'north'] as const;
const SIDES = new Set(['east', 'west', 'south', 'north']);

const FACINGS = ['north', 'east', 'south', 'west'];

/** Built-in texture to paint from: a layer of the generated array. */
export interface BuiltinTexture {
  layer: number;
}

/** One texture layer a game's blocks add after the built-in ones: what to paint in it. */
export interface TextureLayer {
  source: BlockTexture | BuiltinTexture;
  /** Multiply by this colour (sRGB, 0..1). */
  tint: [number, number, number] | null;
  /** How much it glows, 0..1 (the material's emissive); null keeps a built-in texture's own. */
  glow: number | null;
  /** Drawn with the alpha test (cutout, transparent, plants): clear pixels stay clear. */
  clear: boolean;
  /** Tinted by the grass colour all over (an opaque texture says so with alpha 0). */
  grass: boolean;
}

/** A game's blocks, ready for the engine and the renderer. */
export interface GameBlocks {
  /** Each variant's key (`crate`, `marble_slab[type=top]`) in id order, from `firstGameBlock()`. */
  keys: string[];
  /** The engine's description of them (`set_game_blocks`). */
  json: string;
  /** The texture layers they add after the built-in ones, in order. */
  textures: TextureLayer[];
  /** Their names for texture layers (the registry's `textures`), in the same order. */
  textureNames: string[];
  /** The definitions by name, for what only the host needs (hardness, sounds). */
  defs: Map<string, BlockDefinition>;
  /** Tells textures apart for reuse: equal keys, equal pixels ('' for none). */
  textureKey: string;
}

/** A built-in block as the engine describes it (the fields a game block can start from). */
interface EngineBlock {
  id: number;
  name: string;
  state: string;
  shape: string;
  model: string;
  layer: number;
  tex: number[];
  uvt: number[];
  tint: boolean;
  emit: number;
  solid: boolean;
  replaceable: boolean;
  placeable: boolean;
  opacity: number;
  cull_self: boolean;
  anim: number;
}

interface Builtin {
  first: number;
  blocks: EngineBlock[];
  byName: Map<string, EngineBlock>;
  textures: Map<string, number>;
}

let builtinCache: Builtin | null = null;

/** The built-in blocks and textures (read once: they never change). */
function builtin(): Builtin {
  if (builtinCache) return builtinCache;
  const first = engine.game_block_first();
  const json = JSON.parse(engine.block_registry_json()) as { blocks: EngineBlock[]; textures: string[] };
  const blocks = json.blocks.filter((b) => b.id < first);
  const byName = new Map<string, EngineBlock>();
  for (const b of blocks) if (!byName.has(b.name) || (b.placeable && !byName.get(b.name)!.placeable)) byName.set(b.name, b);
  builtinCache = { first, blocks, byName, textures: new Map(json.textures.map((n, i) => [n, i])) };
  return builtinCache;
}

/** The first id a game's own blocks get (they go up to 254). */
export function firstGameBlock(): number {
  return builtin().first;
}

/** What `engine.set_game_blocks` takes for one variant. */
interface Variant {
  name: string;
  label: string;
  state: string;
  shape: 'cube' | 'cross' | 'slab' | 'stairs' | 'fence' | 'pane' | 'post' | 'boxes';
  facing: number;
  top: boolean;
  /** A `boxes` shape's boxes (1/16, written facing north). */
  boxes?: number[][];
  /** Turned from the way it's written: tipped (1 brings its north face to the top, -1 to the bottom), then quarter turns clockwise from above. */
  tilt?: number;
  turn?: number;
  climbable?: boolean;
  layer: number;
  tex: number[];
  uvt: number[];
  solid: boolean;
  opacity?: number;
  emit: number;
  tint: boolean;
  cull_self: boolean;
  anim?: number;
  replaceable: boolean;
  placeable: boolean;
  breakable: boolean;
  double: number;
  /** Its full block's name (slabs), resolved to `double` once ids are known. */
  full?: string;
}

const keyOf = (v: { name: string; state: string }) => (v.state ? `${v.name}[${v.state}]` : v.name);

/** `neon_sign` → `Neon Sign`. */
const words = (name: string) => name.replace(/_+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/** A block texture given as an object (a colour, pixel art, a painter) rather than faces. */
const isTexture = (t: BlockTexture | BlockFaces): t is BlockTexture => typeof t === 'string' || 'color' in t || 'pixels' in t || 'paint' in t;

/** The "missing" look: a block a server has that this screen's game doesn't (an older version). */
const MISSING: BlockTexture = { paint: (x, y) => (((x >> 2) + (y >> 2)) & 1 ? '#f0f' : '#111') };

/**
 * A game's blocks as the engine and renderer take them. `palette`: keys whose ids are fixed
 * already (a server's), in id order; a key this game doesn't define keeps its id as a "missing"
 * block, and blocks not in it follow. Throws with what's wrong in a definition.
 */
export function gameBlocks(def: Pick<GameDefinition, 'id' | 'blocks'>, palette?: readonly string[]): GameBlocks {
  const b = builtin();
  const defs = new Map(Object.entries(def.blocks ?? {}));
  const textures: TextureLayer[] = [];
  const textureNames: string[] = [];
  const layerOf = new Map<string, number>();
  const objectIds = new WeakMap<object, number>();
  let nextObject = 1;
  const sourceKey = (s: BlockTexture | BuiltinTexture): string => {
    if (typeof s === 'string') return `s:${s}`;
    if ('layer' in s) return `b:${s.layer}`;
    let id = objectIds.get(s);
    if (id === undefined) objectIds.set(s, (id = nextObject++));
    return `o:${id}`;
  };
  /** The texture layer for a face, painting a new one only when nothing the same exists. */
  const layer = (source: BlockTexture | BuiltinTexture, look: Omit<TextureLayer, 'source'>, name: string): number => {
    // A built-in texture as it is: its own layer.
    if (typeof source === 'object' && 'layer' in source && !look.tint && look.glow === null && !look.grass) return source.layer;
    const key = `${sourceKey(source)}|${look.tint?.join(',') ?? ''}|${look.glow}|${look.clear}|${look.grass}`;
    let i = layerOf.get(key);
    if (i === undefined) {
      i = b.textures.size + textures.length;
      if (i >= 1024) throw new Error(`blocks: too many textures (at most ${1024 - b.textures.size} of the game's own)`);
      layerOf.set(key, i);
      textures.push({ source, ...look });
      textureNames.push(name);
    }
    return i;
  };

  const variants: Variant[] = [];
  for (const [name, d] of defs) variants.push(...expand(name, d, b, layer));

  // A server's ids first (keeping the ones this game lacks as "missing"), then the rest.
  let ordered = variants;
  if (palette?.length) {
    const byKey = new Map(variants.map((v) => [keyOf(v), v]));
    ordered = palette.map((k) => byKey.get(k) ?? missing(k, layer(MISSING, { tint: null, glow: null, clear: false, grass: false }, 'missing')));
    const taken = new Set(palette);
    // This copy's own variants the server hasn't got can never be in its world: after the server's,
    // while there's room (a page older than the server, its game since changed, still starts).
    const extra = variants.filter((v) => !taken.has(keyOf(v)));
    ordered.push(...extra.slice(0, Math.max(0, 255 - b.first - ordered.length)));
  }
  const room = 255 - b.first;
  if (ordered.length > room) throw new Error(`blocks: ${ordered.length} variants is too many (a game can have ${room}; a slab is 2, stairs are 8)`);

  // Slabs join into their full block: the game's own (its default variant) or a built-in one.
  const ids = new Map<string, number>();
  ordered.forEach((v, i) => {
    if (!ids.has(v.name) || v.placeable) ids.set(v.name, b.first + i);
  });
  for (const v of ordered) {
    if (!v.full) continue;
    const id = ids.get(v.full) ?? b.byName.get(v.full)?.id;
    if (id === undefined) throw new Error(`block "${v.name}": its full block "${v.full}" isn't a block`);
    v.double = id;
    delete v.full;
  }
  const json = JSON.stringify(ordered);
  return {
    keys: ordered.map(keyOf),
    json,
    textures,
    textureNames,
    defs,
    textureKey: textures.length ? `${def.id}:${json}` : '',
  };
}

/** A key this game doesn't define (a server's newer block): a solid cube in the "missing" look. */
function missing(key: string, tex: number): Variant {
  const open = key.indexOf('[');
  const name = open < 0 ? key : key.slice(0, open);
  const state = open < 0 ? '' : key.slice(open + 1, key.lastIndexOf(']'));
  return { name, label: words(name), state, shape: 'cube', facing: 0, top: false, layer: 0, tex: Array(6).fill(tex), uvt: [0, 0, 0, 0, 0, 0], solid: true, emit: 0, tint: false, cull_self: false, replaceable: false, placeable: false, breakable: true, double: 0 };
}

/** One definition as its variants. */
function expand(name: string, d: BlockDefinition, b: Builtin, layer: (s: BlockTexture | BuiltinTexture, look: Omit<TextureLayer, 'source'>, name: string) => number): Variant[] {
  const where = `block "${name}"`;
  if (!/^[a-z0-9_]+$/.test(name)) throw new Error(`${where}: names are lower case letters, digits and _`);
  if (b.byName.has(name)) throw new Error(`${where}: that's a built-in block's name`);
  const like = d.like === undefined ? undefined : b.byName.get(d.like);
  if (d.like !== undefined && (!like || (like.shape !== 'cube' && like.shape !== 'cross'))) throw new Error(`${where}: like "${d.like}" isn't a built-in full block or plant`);
  if (d.texture === undefined && !like) throw new Error(`${where}: give it a texture (or a built-in block it's like)`);
  if (d.boxes !== undefined && d.shape !== undefined) throw new Error(`${where}: give a shape or boxes, not both`);
  const shape = d.boxes !== undefined ? 'boxes' : (d.shape ?? (like?.shape === 'cross' ? 'cross' : 'cube'));
  if (!['cube', 'cross', 'slab', 'stairs', 'fence', 'pane', 'post', 'boxes'].includes(shape)) throw new Error(`${where}: unknown shape "${shape}"`);
  const boxes = d.boxes === undefined ? undefined : checkBoxes(d.boxes, where);
  const facing = d.facing === true ? 'horizontal' : d.facing || null;
  if (facing && !['horizontal', 'all', 'axis'].includes(facing)) throw new Error(`${where}: facing is 'horizontal', 'all' or 'axis'`);
  if (facing && !['cube', 'post', 'boxes'].includes(shape)) throw new Error(`${where}: a ${shape} can't be given a facing (only a cube, a post or boxes)`);
  const cross = shape === 'cross';

  // How light and sight go through it.
  const transparency = d.transparency ?? (like ? (like.layer === 0 ? 'opaque' : like.cull_self ? 'transparent' : 'cutout') : 'opaque');
  if (!['opaque', 'cutout', 'transparent'].includes(transparency)) throw new Error(`${where}: unknown transparency "${transparency}"`);
  const clear = cross || transparency !== 'opaque';
  const emit = Math.max(0, Math.min(15, Math.round(d.light ?? like?.emit ?? 0)));
  const grass = d.tint === 'grass' || (d.tint === undefined && !!like?.tint);
  const tint = d.tint && d.tint !== 'grass' ? rgb(d.tint, where) : null;
  const glowOwn = d.glow !== undefined ? Math.max(0, Math.min(1, d.glow)) : null;

  // A face's texture: given for it, or the block it's like has one there.
  const faceTexture = (f: number): number => {
    const face = FACES[f];
    let t: BlockTexture | undefined;
    const tx = d.texture;
    if (tx !== undefined) {
      if (isTexture(tx)) t = tx;
      else {
        // Written facing north: its front is the north face, its back the south.
        const named = face === 'north' ? (tx.front ?? tx.north) : face === 'south' ? (tx.back ?? tx.south) : tx[face];
        t = named ?? (SIDES.has(face) ? tx.side : undefined) ?? tx.all;
      }
    }
    if (t === undefined && like) {
      return layer({ layer: like.tex[f] }, { tint, glow: glowOwn, clear, grass: grass && !like.tint }, `${name}_${face}`);
    }
    if (t === undefined) throw new Error(`${where}: no texture for its ${face} face (give \`all\` or \`side\`)`);
    if (typeof t === 'string' && /^[a-z0-9_]+$/.test(t)) {
      const builtinLayer = b.textures.get(t);
      if (builtinLayer === undefined) throw new Error(`${where}: "${t}" isn't a built-in texture (an image needs its URL: import it with ?url)`);
      return layer({ layer: builtinLayer }, { tint, glow: glowOwn, clear, grass }, `${name}_${face}`);
    }
    return layer(t, { tint, glow: glowOwn ?? emit / 15, clear, grass }, `${name}_${face}`);
  };
  const tex = FACES.map((_, f) => faceTexture(f));
  const uvt = like && d.texture === undefined ? [...like.uvt] : [0, 0, 0, 0, 0, 0];

  const base: Variant = {
    name,
    label: (d.label ?? words(name)).replace(/[\n\r]/g, ' '),
    state: '',
    shape,
    facing: 0,
    top: false,
    layer: clear ? 1 : 0,
    tex,
    uvt,
    solid: d.solid ?? (like && d.shape === undefined ? like.solid : !cross),
    emit,
    tint: grass,
    cull_self: transparency === 'transparent',
    replaceable: d.replaceable ?? (like && d.shape === undefined ? like.replaceable : cross),
    placeable: d.picker ?? true,
    breakable: d.breakable ?? true,
    double: 0,
  };
  if (boxes) base.boxes = boxes;
  if (d.climbable) base.climbable = true;
  // A cube or plant it's like keeps that one's light and sway.
  if (like && d.shape === undefined && d.boxes === undefined) {
    if (d.transparency === undefined) base.opacity = like.opacity;
    base.anim = like.anim;
  }
  if (d.full !== undefined && shape !== 'slab') throw new Error(`${where}: only a slab has a full block`);
  // Facing: a variant per way, turned from the way it's written (the first is the picker's).
  if (facing) return TURNS[facing].map(([state, tilt, turn], i) => ({ ...base, state, tilt, turn, placeable: base.placeable && i === 0 }));
  switch (shape) {
    case 'slab':
      return [false, true].map((top) => ({ ...base, state: `type=${top ? 'top' : 'bottom'}`, top, placeable: base.placeable && !top, full: d.full }));
    case 'stairs':
      return FACINGS.flatMap((facing, f) => [false, true].map((top) => ({ ...base, state: `facing=${facing},half=${top ? 'top' : 'bottom'}`, facing: f, top, placeable: base.placeable && f === 0 && !top })));
    default:
      return [base];
  }
}

/**
 * A facing block's variants: its state, and how it's turned from the way it's written (facing
 * north, or upright for an axis): tipped (1 brings the north face to the top and the top to the
 * south), then quarter turns clockwise seen from above.
 */
const TURNS: Record<'horizontal' | 'all' | 'axis', [string, number, number][]> = {
  horizontal: FACINGS.map((f, i) => [`facing=${f}`, 0, i]),
  all: [...FACINGS.map((f, i): [string, number, number] => [`facing=${f}`, 0, i]), ['facing=up', 1, 0], ['facing=down', -1, 0]],
  axis: [['axis=y', 0, 0], ['axis=x', 1, 1], ['axis=z', 1, 0]],
};

/** `boxes` checked: whole sixteenths inside the block, each with some size, at most 16 of them. */
function checkBoxes(boxes: number[][], where: string): number[][] {
  if (!Array.isArray(boxes) || boxes.length < 1 || boxes.length > 16) throw new Error(`${where}: boxes are 1 to 16 boxes`);
  return boxes.map((b) => {
    if (!Array.isArray(b) || b.length !== 6 || b.some((v) => !Number.isInteger(v) || v < 0 || v > 16)) throw new Error(`${where}: a box is [x0, y0, z0, x1, y1, z1] in whole sixteenths, 0 to 16 (${JSON.stringify(b)})`);
    if (b[0] >= b[3] || b[1] >= b[4] || b[2] >= b[5]) throw new Error(`${where}: a box's far corner must be past its near one (${JSON.stringify(b)})`);
    return [...b];
  });
}

/** A CSS colour as sRGB 0..1: `#rgb`, `#rrggbb`, `rgb(r, g, b)`. */
export function rgb(css: string, where = 'colour'): [number, number, number] {
  const c = parseColor(css);
  if (!c) throw new Error(`${where}: can't read the colour "${css}" (use #rrggbb or rgb(r, g, b))`);
  return [c[0] / 255, c[1] / 255, c[2] / 255];
}

/** A CSS colour as [r, g, b, a], each 0..255: hex (3, 4, 6 or 8 digits), `rgb()` / `rgba()`; null if unreadable. */
export function parseColor(css: string): [number, number, number, number] | null {
  const s = css.trim().toLowerCase();
  if (s === 'transparent') return [0, 0, 0, 0];
  const hex = /^#([0-9a-f]{3,8})$/.exec(s)?.[1];
  if (hex && [3, 4, 6, 8].includes(hex.length)) {
    const d = hex.length <= 4 ? [...hex].map((h) => h + h) : hex.match(/../g)!;
    const [r, g, b, a = 'ff'] = d;
    return [parseInt(r, 16), parseInt(g, 16), parseInt(b, 16), parseInt(a, 16)];
  }
  const fn = /^rgba?\(([^)]*)\)$/.exec(s)?.[1];
  if (fn) {
    const parts = fn.split(/[\s,/]+/).filter(Boolean);
    if (parts.length < 3) return null;
    const channel = (p: string) => (p.endsWith('%') ? (parseFloat(p) * 255) / 100 : parseFloat(p));
    const alpha = parts[3] === undefined ? 255 : parts[3].endsWith('%') ? (parseFloat(parts[3]) * 255) / 100 : parseFloat(parts[3]) * 255;
    const out = [channel(parts[0]), channel(parts[1]), channel(parts[2]), alpha].map((v) => Math.round(Math.max(0, Math.min(255, v))));
    return out.some((v) => Number.isNaN(v)) ? null : (out as [number, number, number, number]);
  }
  return null;
}

/** The game's blocks in use in this thread's engine, as its JSON (switching costs a call). */
let active = '[]';

/**
 * Use these blocks in this thread's engine from now on (before making the world, generator or
 * mesher that should know them). Hosts sharing a thread (a test server's rooms) call it on the
 * way into each, so each runs with its own.
 */
export function useGameBlocks(t: GameBlocks) {
  if (active === t.json) return;
  engine.set_game_blocks(t.json);
  active = t.json;
}

/**
 * Saved edits (the engine's `export_edits`) made when the game's own blocks had the ids of
 * `saved` (their keys, in id order), translated to the ids of `now`: by name, so a save outlives
 * reordered definitions; blocks no longer defined become air. Unchanged if nothing moved.
 */
export function remapEdits(edits: Uint8Array, saved: readonly string[] | undefined, now: GameBlocks): Uint8Array {
  const map = remapTable(saved, now);
  if (!map) return edits;
  const out = edits.slice();
  const v = new DataView(out.buffer, out.byteOffset, out.byteLength);
  let o = 0;
  while (o + 12 <= out.byteLength) {
    const n = v.getUint32(o + 8, true);
    o += 12;
    for (let i = 0; i < n && o + 5 <= out.byteLength; i++, o += 5) out[o + 4] = map[out[o + 4]];
  }
  return out;
}

/** Old id to new for the game's blocks (null: nothing moved). */
export function remapTable(saved: readonly string[] | undefined, now: GameBlocks): Uint8Array | null {
  if (!saved?.length) return null;
  const first = firstGameBlock();
  const map = Uint8Array.from({ length: 256 }, (_, i) => i);
  let moved = false;
  saved.forEach((key, i) => {
    const at = now.keys.indexOf(key);
    const id = at < 0 ? 0 : first + at;
    if (first + i < 255 && id !== first + i) {
      map[first + i] = id;
      moved = true;
    }
  });
  return moved ? map : null;
}
