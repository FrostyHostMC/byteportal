/**
 * A character's look: the platform's people (players' avatars, a game's townsfolk and monsters),
 * built as Call of Blocky's and Blockfront's micro-voxel figures from it (`build.ts`). Styles by
 * name, colours as CSS hex. Everything is optional (the platform's own fills in).
 */
export interface CharacterLook {
  /** The body: `slim`, `broad` or `heavy`; `curvy` gives it a bust and a narrower waist. */
  build?: CharacterBuild;
  curvy?: boolean;
  /** Skin, and the pupils'. */
  skin?: string;
  eyes?: string;
  hair?: HairStyle;
  hairColor?: string;
  facialHair?: FacialHair;
  /**
   * Something about the face: long lashes, lipstick (and blush), freckles, sunglasses, specs;
   * glowing eyes (a monster's: `eyes` is their colour), or a skull's (glowing in their sockets).
   */
  face?: FaceDetail;
  top?: TopStyle;
  topColor?: string;
  /** A second colour for the top: a tie, stripes, panels, drawstrings, a print. */
  accent?: string;
  bottom?: BottomStyle;
  bottomColor?: string;
  shoes?: ShoeStyle;
  shoeColor?: string;
  /** Something on the head: a crown, a fedora or a cap (the fedora's and cap's colour the `accent`). */
  hat?: HeadWear;
  /** Worn thin: holes and frayed hems in the clothes (a zombie's). */
  ragged?: boolean;
  /** Its hair cut close under a hat (set by the platform while a hat's worn). */
  hatHair?: boolean;
}

/**
 * What a game dresses players' avatars in (`player.setUniform`): a team's colours, its kit, over what
 * they chose; `hatHair` cuts their hair close, under a helmet or hat the game puts on them itself.
 */
export type Uniform = Pick<CharacterLook, 'top' | 'topColor' | 'accent' | 'bottom' | 'bottomColor' | 'shoes' | 'shoeColor' | 'hatHair'>;

export type CharacterBuild = 'slim' | 'broad' | 'heavy';
export type HairStyle = 'short' | 'crew' | 'buzz' | 'slick' | 'swept' | 'long' | 'pomp' | 'bob' | 'pony' | 'bun' | 'afro' | 'mohawk' | 'bald';
export type FacialHair = 'none' | 'stubble' | 'moustache' | 'goatee' | 'beard';
export type FaceDetail = 'plain' | 'lashes' | 'lipstick' | 'freckles' | 'shades' | 'specs' | 'glow' | 'skull';
export type TopStyle = 'tee' | 'shirt' | 'hoodie' | 'sweater' | 'suit' | 'jacket' | 'track' | 'camp' | 'aloha' | 'tank' | 'tunic' | 'apron' | 'ribs';
export type BottomStyle = 'trousers' | 'jeans' | 'shorts' | 'skirt' | 'joggers';
export type ShoeStyle = 'sneakers' | 'shoes' | 'boots' | 'flats';
export type HeadWear = 'none' | 'crown' | 'fedora' | 'cap';

/** The styles, in the order the locker lists them. */
export const STYLES = {
  build: ['slim', 'broad', 'heavy'] as CharacterBuild[],
  hair: ['short', 'crew', 'buzz', 'slick', 'swept', 'long', 'pomp', 'bob', 'pony', 'bun', 'afro', 'mohawk', 'bald'] as HairStyle[],
  facialHair: ['none', 'stubble', 'moustache', 'goatee', 'beard'] as FacialHair[],
  face: ['plain', 'lashes', 'lipstick', 'freckles', 'shades', 'specs', 'glow', 'skull'] as FaceDetail[],
  top: ['tee', 'shirt', 'hoodie', 'sweater', 'suit', 'jacket', 'track', 'camp', 'aloha', 'tank', 'tunic', 'apron', 'ribs'] as TopStyle[],
  bottom: ['trousers', 'jeans', 'shorts', 'skirt', 'joggers'] as BottomStyle[],
  shoes: ['sneakers', 'shoes', 'boots', 'flats'] as ShoeStyle[],
  hat: ['none', 'crown', 'fedora', 'cap'] as HeadWear[],
};

/** The platform's own person: what's left out of a look. */
export const PLAIN_LOOK: Required<CharacterLook> = {
  build: 'broad',
  curvy: false,
  skin: '#e0a882',
  eyes: '#4a2e1a',
  hair: 'short',
  hairColor: '#3b2619',
  facialHair: 'none',
  face: 'plain',
  top: 'tee',
  topColor: '#2a8f8a',
  accent: '#eeeeea',
  bottom: 'jeans',
  bottomColor: '#3d5f8f',
  shoes: 'sneakers',
  shoeColor: '#222226',
  hat: 'none',
  ragged: false,
  hatHair: false,
};

/** The fields, in the order a look's address keeps them. */
const KEYS = Object.keys(PLAIN_LOOK) as (keyof CharacterLook)[];
const COLOURS = new Set<keyof CharacterLook>(['skin', 'eyes', 'hairColor', 'topColor', 'accent', 'bottomColor', 'shoeColor']);
const FLAGS = new Set<keyof CharacterLook>(['curvy', 'ragged', 'hatHair']);
const CHOICES: Partial<Record<keyof CharacterLook, readonly string[]>> = STYLES;

/** The address a character's model goes by (`character:` and what differs from the plain look). */
export const CHARACTER_SCHEME = 'character:';

const hex = (c: string) => /^#?[0-9a-f]{6}$/i.test(c) ? c.replace('#', '').toLowerCase() : null;

/** A look's model address: the same look, the same address. */
export function characterUrl(look: CharacterLook): string {
  const out: string[] = [];
  for (const k of KEYS) {
    const v = look[k];
    if (v === undefined || v === PLAIN_LOOK[k]) continue;
    if (FLAGS.has(k)) {
      if (v) out.push(k);
    } else if (COLOURS.has(k)) {
      const h = hex(String(v));
      if (h && `#${h}` !== PLAIN_LOOK[k]) out.push(`${k}=${h}`);
    } else if (CHOICES[k]?.includes(v as string)) out.push(`${k}=${v}`);
  }
  return CHARACTER_SCHEME + out.join('&');
}

/** A model address's look (the plain look's where it's silent), or null if it isn't a character's. */
export function characterLook(url: string): Required<CharacterLook> | null {
  if (!url.startsWith(CHARACTER_SCHEME)) return null;
  const out = { ...PLAIN_LOOK } as Record<keyof CharacterLook, unknown>;
  const body = url.slice(CHARACTER_SCHEME.length);
  for (const part of body ? body.split('&') : []) {
    const [k, v] = part.split('=') as [keyof CharacterLook, string | undefined];
    if (!KEYS.includes(k)) continue;
    if (FLAGS.has(k)) out[k] = true;
    else if (COLOURS.has(k)) {
      const h = v && hex(v);
      if (h) out[k] = `#${h}`;
    } else if (v && CHOICES[k]?.includes(v)) out[k] = v;
  }
  return out as Required<CharacterLook>;
}
