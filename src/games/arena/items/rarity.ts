/**
 * Rarities: every weapon of the arsenal comes common, rare, epic or legendary, each a separate
 * item (items stack by id): `variant('gladius', 'epic')` is `'gladius_epic'`, and the common one
 * is the base id itself (`'gladius'`). A rarer one hits harder and swings sooner, glows its
 * colour in the hand and on the ground, and a legendary does something of its own (`arms.ts`).
 * The shop, the mystery chest and the forge (`forge.ts`) go through these.
 */
export const RARITIES = ['common', 'rare', 'epic', 'legendary'] as const;
export type Rarity = (typeof RARITIES)[number];

export interface RarityDef {
  name: string;
  /** Its colour: names, beams on the ground, the glow on the weapon. */
  color: string;
  /** Times the common one's damage, and its time between attacks. */
  damage: number;
  pace: number;
  /** Added to the common one's `rank` (a rarer one is taken in hand over a commoner one). */
  rank: number;
  /** How often the mystery chest rolls it (weights). */
  weight: number;
}

export const RARITY: Record<Rarity, RarityDef> = {
  common: { name: 'Common', color: '#c9ced6', damage: 1, pace: 1, rank: 0, weight: 50 },
  rare: { name: 'Rare', color: '#4aa8ff', damage: 1.25, pace: 0.95, rank: 1.5, weight: 32 },
  epic: { name: 'Epic', color: '#b46bff', damage: 1.55, pace: 0.9, rank: 3, weight: 14 },
  legendary: { name: 'Legendary', color: '#ffb12e', damage: 1.9, pace: 0.85, rank: 4.5, weight: 4 },
};

/** The bases that come in every rarity (`arms.ts` defines them); the starter swords are only ever common. */
export const RARE_BASES = ['gladius', 'warhammer', 'spear', 'crossbow', 'daggers', 'greatsword', 'fire_staff', 'frost_staff', 'storm_wand', 'battle_axe', 'pike', 'diamond_sword', 'bow'] as const;
export type RareBase = (typeof RARE_BASES)[number];
const BASES = new Set<string>(RARE_BASES);

/** A weapon of a rarity: its item id. */
export const variant = (base: string, rarity: Rarity): string => (rarity === 'common' ? base : `${base}_${rarity}`);

/** An item's rarity (anything that isn't a rarer variant is common). */
export function rarityOf(id: string): Rarity {
  for (const r of RARITIES) if (r !== 'common' && id.endsWith(`_${r}`) && BASES.has(id.slice(0, -r.length - 1))) return r;
  return 'common';
}

/** An item's base weapon (`'gladius_epic'` is a `'gladius'`): what achievements and blessings count. */
export function baseOf(id: string): string {
  const r = rarityOf(id);
  return r === 'common' ? id : id.slice(0, -r.length - 1);
}

/** Whether an item comes in rarities (and so can be forged, rolled from the chest). */
export const hasRarities = (id: string): boolean => BASES.has(baseOf(id));

export const rarityColor = (id: string): string => RARITY[rarityOf(id)].color;

/** The next rarity up, or null for a legendary. */
export function nextRarity(r: Rarity): Rarity | null {
  const i = RARITIES.indexOf(r);
  return i < RARITIES.length - 1 ? RARITIES[i + 1] : null;
}

/** The gladius's shield in a rarity (an item only so the screens can show it: the first-person view holds it). */
export const shieldOf = (r: Rarity): string => variant('gladius_shield', r);

/** Every variant of every base: the item ids the arsenal defines. */
export const ALL_VARIANTS: readonly string[] = RARE_BASES.flatMap((b) => RARITIES.map((r) => variant(b, r)));

/**
 * A random rarity, by the weights (`luck` 0..1 shifts them toward the rare end: a later wave, the
 * crowd's favour). `rnd` is a number 0..1 (`game.rng.next()`).
 */
export function rollRarity(rnd: number, luck = 0): Rarity {
  const w = RARITIES.map((r, i) => RARITY[r].weight * (1 + luck * i * 1.5));
  let t = rnd * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < RARITIES.length; i++) if ((t -= w[i]) <= 0) return RARITIES[i];
  return 'common';
}
