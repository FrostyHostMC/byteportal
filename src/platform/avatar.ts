import { STYLES, type CharacterLook, type Uniform } from './character/look';

/**
 * A player's avatar: the person they are in every game that doesn't dress its players itself, one
 * of the platform's characters (`Models.character`) made of choices: their build, skin, hair and
 * face, and what they wear. It travels as a short code (`avatarCode`), and every screen builds the
 * same figure from it. A game can put them in its colours (`player.setUniform`: a team's) without
 * changing who they are.
 */
export interface Avatar {
  build: number;
  curvy: number;
  tone: number;
  hair: number;
  hairColor: number;
  facialHair: number;
  face: number;
  eyes: number;
  top: number;
  topColor: number;
  accent: number;
  bottom: number;
  bottomColor: number;
  shoes: number;
  shoeColor: number;
}

/** The choices, in the order the code keeps them. */
export const AVATAR_FIELDS = ['build', 'curvy', 'tone', 'hair', 'hairColor', 'facialHair', 'face', 'eyes', 'top', 'topColor', 'accent', 'bottom', 'bottomColor', 'shoes', 'shoeColor'] as const;

const CLOTH = ['Teal', 'Red', 'Orange', 'Yellow', 'Green', 'Forest', 'Sky', 'Navy', 'Purple', 'Pink', 'White', 'Grey', 'Charcoal', 'Black', 'Denim', 'Tan'];

/** What each choice can be: names (for the locker) by index. The styles are `STYLES`' in order. */
export const AVATAR_OPTIONS: Record<keyof Avatar, readonly string[]> = {
  build: ['Slim', 'Broad', 'Heavy'],
  curvy: ['Straight', 'Curvy'],
  tone: ['Porcelain', 'Fair', 'Light', 'Tan', 'Olive', 'Brown', 'Deep', 'Ebony'],
  hair: ['Short', 'Crew cut', 'Buzzed', 'Slicked back', 'Swept', 'Long', 'Pompadour', 'Bob', 'Ponytail', 'Bun', 'Afro', 'Mohawk', 'Bald'],
  hairColor: ['Black', 'Dark brown', 'Brown', 'Auburn', 'Ginger', 'Blond', 'Platinum', 'Grey', 'Pink', 'Blue'],
  facialHair: ['None', 'Stubble', 'Moustache', 'Goatee', 'Beard'],
  face: ['Plain', 'Lashes', 'Lipstick', 'Freckles', 'Shades', 'Specs'],
  eyes: ['Brown', 'Hazel', 'Green', 'Blue', 'Grey', 'Violet'],
  top: ['T-shirt', 'Shirt', 'Hoodie', 'Sweater', 'Suit', 'Jacket', 'Track top', 'Bowling shirt', 'Aloha shirt', 'Tank top', 'Tunic', 'Apron'],
  topColor: CLOTH,
  accent: CLOTH,
  bottom: ['Trousers', 'Jeans', 'Shorts', 'Skirt', 'Joggers'],
  bottomColor: CLOTH,
  shoes: ['Sneakers', 'Shoes', 'Boots', 'Flats'],
  shoeColor: ['Black', 'White', 'Brown', 'Red', 'Blue', 'Green'],
};

/** Colours (hex) for the choices that are colours. */
export const AVATAR_COLORS = {
  tone: [0xf6d7c3, 0xeec1a0, 0xe0a882, 0xc98d64, 0xb07a52, 0x8c5a3a, 0x6b4128, 0x4a2c1b],
  hairColor: [0x1c1714, 0x3b2619, 0x6a4424, 0x8e3b1f, 0xc2622a, 0xd9b45e, 0xe8e2cf, 0x8d8d8d, 0xe0709e, 0x3f6fd1],
  eyes: [0x4a2e1a, 0x7a5a2a, 0x3f7a3a, 0x3a6fb8, 0x6f7f8a, 0x7a4ab0],
  cloth: [0x2a8f8a, 0xc0392b, 0xe07b28, 0xe8c33a, 0x4caf50, 0x2e6b3a, 0x5aa9e6, 0x24346b, 0x7a4bb0, 0xe57fa8, 0xeeeeea, 0x8c9096, 0x3c4048, 0x1e1f24, 0x3d5f8f, 0xb99a6b],
  shoes: [0x222226, 0xe8e8e4, 0x6b4a2e, 0xb8322c, 0x2f5fb0, 0x3b7a3a],
};

/** The default avatar: the platform's plain person (`PLAIN_LOOK`: a teal tee, jeans, dark hair). */
export const DEFAULT_AVATAR: Avatar = { build: 1, curvy: 0, tone: 2, hair: 0, hairColor: 1, facialHair: 0, face: 0, eyes: 0, top: 0, topColor: 0, accent: 10, bottom: 1, bottomColor: 14, shoes: 0, shoeColor: 0 };

/**
 * Ready-made people to pick instead of building one (the locker's first row), each a whole outfit
 * that goes together; a guest's first look is one of them. Indices are `AVATAR_OPTIONS`'.
 */
export const AVATAR_PRESETS: { name: string; avatar: Avatar }[] = [
  { name: 'Classic', avatar: DEFAULT_AVATAR },
  // An afro, a red hoodie with white strings, charcoal joggers, white sneakers.
  { name: 'Hoodie', avatar: { build: 0, curvy: 0, tone: 5, hair: 10, hairColor: 0, facialHair: 0, face: 0, eyes: 0, top: 2, topColor: 1, accent: 10, bottom: 4, bottomColor: 12, shoes: 0, shoeColor: 1 } },
  // A blond ponytail and freckles, a yellow tee, denim shorts, red sneakers.
  { name: 'Skater', avatar: { build: 0, curvy: 1, tone: 1, hair: 8, hairColor: 5, facialHair: 0, face: 3, eyes: 3, top: 0, topColor: 3, accent: 13, bottom: 2, bottomColor: 14, shoes: 0, shoeColor: 3 } },
  // A crew cut and goatee, a navy suit, black shoes.
  { name: 'Sharp', avatar: { build: 1, curvy: 0, tone: 6, hair: 1, hairColor: 0, facialHair: 3, face: 0, eyes: 0, top: 4, topColor: 7, accent: 10, bottom: 0, bottomColor: 7, shoes: 1, shoeColor: 0 } },
  // Swept brown hair and stubble, a tan jacket over green, forest trousers, brown boots.
  { name: 'Explorer', avatar: { build: 1, curvy: 0, tone: 3, hair: 4, hairColor: 2, facialHair: 1, face: 0, eyes: 1, top: 5, topColor: 15, accent: 5, bottom: 0, bottomColor: 5, shoes: 2, shoeColor: 2 } },
  // A pink mohawk and shades, a black tank top, charcoal jeans, black boots.
  { name: 'Punk', avatar: { build: 0, curvy: 0, tone: 0, hair: 11, hairColor: 8, facialHair: 0, face: 4, eyes: 2, top: 9, topColor: 13, accent: 1, bottom: 1, bottomColor: 12, shoes: 2, shoeColor: 0 } },
  // A dark bob and specs, a purple sweater, a charcoal skirt, black flats.
  { name: 'Scholar', avatar: { build: 0, curvy: 1, tone: 4, hair: 7, hairColor: 1, facialHair: 0, face: 5, eyes: 4, top: 3, topColor: 8, accent: 10, bottom: 3, bottomColor: 12, shoes: 3, shoeColor: 0 } },
  // Grey hair and a beard, an orange aloha shirt, tan shorts, white sneakers.
  { name: 'Vacation', avatar: { build: 2, curvy: 0, tone: 2, hair: 0, hairColor: 7, facialHair: 4, face: 0, eyes: 3, top: 8, topColor: 2, accent: 0, bottom: 2, bottomColor: 15, shoes: 0, shoeColor: 1 } },
];

/** One of the ready-made people, at random (a copy, theirs to change). */
export function presetAvatar(rnd: () => number = Math.random): Avatar {
  return { ...AVATAR_PRESETS[Math.floor(rnd() * AVATAR_PRESETS.length)].avatar };
}

const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz';

/** An avatar as its code: `b` and a digit per choice. */
export function avatarCode(a: Avatar): string {
  return `b${AVATAR_FIELDS.map((f) => DIGITS[clampChoice(f, a[f])]).join('')}`;
}

/**
 * An avatar from its code, or null if it isn't one (unknown choices come back as the first). The
 * first avatars' codes (`a`, a painted skin's choices) come back as the nearest person.
 */
export function parseAvatar(code: string | null | undefined): Avatar | null {
  if (typeof code !== 'string') return null;
  if (code.length === 10 && code[0] === 'a') return fromFirst(code);
  if (code.length !== AVATAR_FIELDS.length + 1 || code[0] !== 'b') return null;
  const out = { ...DEFAULT_AVATAR };
  for (let i = 0; i < AVATAR_FIELDS.length; i++) {
    const v = DIGITS.indexOf(code[i + 1]);
    if (v < 0) return null;
    out[AVATAR_FIELDS[i]] = clampChoice(AVATAR_FIELDS[i], v);
  }
  return out;
}

/** A code as it's kept now (an old one brought up to date), or null if it isn't one. */
export function normalAvatar(code: string | null | undefined): string | null {
  const a = parseAvatar(code);
  return a ? avatarCode(a) : null;
}

/** The first avatars (tone, hair, hair colour, eyes, top, its colour, bottoms, their colour, shoes) as today's. */
function fromFirst(code: string): Avatar | null {
  const d = [...code.slice(1)].map((c) => DIGITS.indexOf(c));
  if (d.some((v) => v < 0)) return null;
  const [tone, hair, hairColor, eyes, top, topColor, bottom, bottomColor, shoes] = d;
  // Short, long, buzzed, bun, spiky, bald, curly, side part; t-shirt, hoodie, jacket, tank top,
  // tunic, sweater; jeans, shorts, cargo pants, joggers.
  const HAIR = [0, 5, 2, 9, 1, 12, 10, 4];
  const TOP = [0, 2, 5, 9, 10, 3];
  const BOTTOM = [1, 2, 0, 4];
  const a: Avatar = { ...DEFAULT_AVATAR, tone, hair: HAIR[hair] ?? 0, hairColor, eyes, top: TOP[top] ?? 0, topColor, bottom: BOTTOM[bottom] ?? 1, bottomColor, shoeColor: shoes };
  for (const f of AVATAR_FIELDS) a[f] = clampChoice(f, a[f]);
  return a;
}

function clampChoice(f: keyof Avatar, v: number): number {
  const n = AVATAR_OPTIONS[f].length;
  return Number.isInteger(v) && v >= 0 && v < n ? v : 0;
}

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

/** An avatar (or its code; the default for none) as a character's look, in a game's uniform. */
export function avatarLook(avatar: Avatar | string | null | undefined, uniform?: Uniform | null): CharacterLook {
  const a = (typeof avatar === 'string' ? parseAvatar(avatar) : avatar) ?? DEFAULT_AVATAR;
  const look: CharacterLook = {
    build: STYLES.build[a.build],
    curvy: a.curvy === 1,
    skin: hex(AVATAR_COLORS.tone[a.tone]),
    hair: STYLES.hair[a.hair],
    hairColor: hex(AVATAR_COLORS.hairColor[a.hairColor]),
    facialHair: STYLES.facialHair[a.facialHair],
    face: STYLES.face[a.face],
    eyes: hex(AVATAR_COLORS.eyes[a.eyes]),
    top: STYLES.top[a.top],
    topColor: hex(AVATAR_COLORS.cloth[a.topColor]),
    accent: hex(AVATAR_COLORS.cloth[a.accent]),
    bottom: STYLES.bottom[a.bottom],
    bottomColor: hex(AVATAR_COLORS.cloth[a.bottomColor]),
    shoes: STYLES.shoes[a.shoes],
    shoeColor: hex(AVATAR_COLORS.shoes[a.shoeColor]),
  };
  if (uniform) for (const [k, v] of Object.entries(uniform)) if (v !== undefined && v !== null) (look as Record<string, unknown>)[k] = v;
  return look;
}

export type { Uniform };

/** A random avatar (a guest's first), from `rnd` (0..1). */
export function randomAvatar(rnd: () => number = Math.random): Avatar {
  const out = { ...DEFAULT_AVATAR };
  for (const f of AVATAR_FIELDS) out[f] = Math.floor(rnd() * AVATAR_OPTIONS[f].length);
  // (Mostly hair, and mostly a plain face: bald, beards and make-up are choices, not rolls of the dice.)
  if (out.hair === 12 && rnd() < 0.8) out.hair = 0;
  if (rnd() < 0.55) out.facialHair = 0;
  if (rnd() < 0.5) out.face = 0;
  return out;
}
