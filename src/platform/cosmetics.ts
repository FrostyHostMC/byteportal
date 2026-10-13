import type { CosmeticDef, CosmeticSlot, GameMeta } from './api/types';

/**
 * Cosmetics across the platform: the platform's own (anyone signed in can wear them) and every
 * game's (`GameMeta.cosmetics`, given in play), by their ids everywhere: `blockyard:cap`,
 * `callofblocky:gold_fedora`. The server checks what's worn against it; every screen draws from it.
 */
export interface Cosmetic extends CosmeticDef {
  id: string;
  /** Whose it is: a game's id, or null (the platform's). */
  game: string | null;
  /** Anyone signed in has it. */
  free: boolean;
}

/** The platform's own: free for everyone signed in. */
export const PLATFORM_COSMETICS: Record<string, CosmeticDef> = {
  cap: {
    name: 'Red Cap',
    slot: 'hat',
    how: 'Yours to wear',
    model: {
      boxes: [
        { from: [-4.4, -2.2, -4.4], to: [4.4, 1, 4.4], color: '#c9352e' },
        { from: [-4.4, -2.2, 4.4], to: [4.4, -1.6, 8.2], color: '#9c231e' },
        { from: [-0.6, 1, -0.6], to: [0.6, 1.5, 0.6], color: '#9c231e' },
      ],
    },
  },
  beanie: {
    name: 'Beanie',
    slot: 'hat',
    how: 'Yours to wear',
    model: {
      boxes: [
        { from: [-4.4, -3, -4.4], to: [4.4, 1.4, 4.4], color: '#2f5fb0' },
        { from: [-4.7, -3.2, -4.7], to: [4.7, -1.8, 4.7], color: '#4b7fd6' },
        { from: [-1.2, 1.4, -1.2], to: [1.2, 3.4, 1.2], color: '#f1f1ec' },
      ],
    },
  },
  headphones: {
    name: 'Headphones',
    slot: 'hat',
    how: 'Yours to wear',
    model: {
      boxes: [
        { from: [-4.8, 0, -1], to: [4.8, 1, 1], color: '#26272c' },
        { from: [-5.2, -5, -1.8], to: [-4.2, 0, 1.8], color: '#26272c' },
        { from: [4.2, -5, -1.8], to: [5.2, 0, 1.8], color: '#26272c' },
        { from: [-5.6, -4.4, -1.4], to: [-5.2, -1.2, 1.4], color: '#e04f7a', glow: true },
        { from: [5.2, -4.4, -1.4], to: [5.6, -1.2, 1.4], color: '#e04f7a', glow: true },
      ],
    },
  },
  backpack: {
    name: 'Backpack',
    slot: 'back',
    how: 'Yours to wear',
    model: {
      boxes: [
        { from: [-3, -8, 0], to: [3, 0, 3], color: '#8a5a32' },
        { from: [-3.2, -3, 0], to: [3.2, 0.4, 3.3], color: '#6e4526' },
        { from: [-2, -7, 3], to: [2, -4, 3.6], color: '#6e4526' },
      ],
    },
  },
  tag_sky: { name: 'Sky Name Tag', slot: 'tag', color: '#7cc8ff', how: 'Yours to wear' },
  tag_mint: { name: 'Mint Name Tag', slot: 'tag', color: '#7ff0b8', how: 'Yours to wear' },
  tag_rose: { name: 'Rose Name Tag', slot: 'tag', color: '#ff8fb8', how: 'Yours to wear' },
  tag_sun: { name: 'Sunshine Name Tag', slot: 'tag', color: '#ffd76a', how: 'Yours to wear' },
};

/** Every cosmetic on the platform, by id: the platform's and each game's. */
export function cosmeticCatalog(games: readonly Pick<GameMeta, 'id' | 'cosmetics'>[]): Map<string, Cosmetic> {
  const out = new Map<string, Cosmetic>();
  for (const [id, def] of Object.entries(PLATFORM_COSMETICS)) out.set(`blockyard:${id}`, { ...def, id: `blockyard:${id}`, game: null, free: true });
  for (const g of games) {
    for (const [id, def] of Object.entries(g.cosmetics ?? {})) out.set(`${g.id}:${id}`, { ...def, id: `${g.id}:${id}`, game: g.id, free: false });
  }
  return out;
}

/** The slots a game shows (`GameMeta.cosmeticSlots`; all by default). */
export function shownSlots(meta: Pick<GameMeta, 'cosmeticSlots'>): Set<CosmeticSlot> {
  return new Set(meta.cosmeticSlots ?? ['hat', 'back', 'title', 'tag']);
}

/**
 * What someone may wear of `wear`: things they own (or free ones) that exist, one per slot (the
 * last of each wins).
 */
export function wearable(wear: readonly string[], owned: ReadonlySet<string>, catalog: ReadonlyMap<string, Cosmetic>): string[] {
  const bySlot = new Map<CosmeticSlot, string>();
  for (const id of wear) {
    const c = catalog.get(id);
    if (c && (c.free || owned.has(id))) bySlot.set(c.slot, id);
  }
  return [...bySlot.values()];
}
