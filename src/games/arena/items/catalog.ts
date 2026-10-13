import type { GameContext, Player } from '@platform';
import { ARMS } from './arms';
import { ARMOR, wearArmor, type ArmorId } from './armor';
import { POTION } from './potions';
import { RARE_BASES } from './rarity';

/**
 * What can be bought (the shop, `run/`), and what it costs: the armory's to say (it owns the
 * items), the run's to sell. `from`: the first wave after which it's on sale. The forge's prices
 * are `forge.ts`'s.
 */
export interface Ware {
  item: string;
  /** Gold. */
  price: number;
  kind: 'weapon' | 'armor' | 'consumable' | 'ammo' | 'upgrade';
  /** How many come for the price (arrows, bombs). */
  count?: number;
  /** On sale once this many waves are cleared (default 0: from the start). */
  from?: number;
  /** What it does, in a line (a menu entry's note). */
  note?: string;
}

/** The arsenal's weapons, each common, at its price, cheapest first (the rarer ones come from the forge and the chest). */
const ARSENAL: Ware[] = RARE_BASES.map((b): Ware => ({ item: b, price: ARMS[b].price, kind: 'weapon', from: ARMS[b].from, note: ARMS[b].text })).sort((a, b) => a.price - b.price);

export const WARES: Ware[] = [
  {
    item: 'health_potion',
    price: 40,
    kind: 'consumable',
    // (Read as the shop shows it: the run's difficulty may change what a potion mends.)
    get note() {
      return `Mends ${POTION.heal / 2} hearts. R drinks one`;
    },
  },
  { item: 'bomb', price: 30, kind: 'consumable', count: 2, note: 'G throws one' },
  { item: 'arrow', price: 15, kind: 'ammo', count: 12, note: 'For the bow and the crossbow' },
  { item: 'stone_sword', price: 50, kind: 'weapon', note: 'A little better than wood' },
  { item: 'iron_sword', price: 110, kind: 'weapon', from: 1, note: 'A sound blade' },
  ...ARSENAL,
  { item: 'leather_armor', price: 80, kind: 'armor', from: 1, note: `Take ${ARMOR.leather_armor.points * 4}% less damage` },
  { item: 'mail_armor', price: 180, kind: 'armor', from: 3, note: `Take ${ARMOR.mail_armor.points * 4}% less damage` },
  { item: 'plate_armor', price: 350, kind: 'armor', from: 6, note: `Take ${ARMOR.plate_armor.points * 4}% less damage` },
];

/**
 * Hand over what was bought (paid for already): a weapon into the hotbar and in hand, armour put on,
 * potions, bombs or arrows into the pack. False if it couldn't be (no room, armour no better than
 * what they wear): don't take the gold then.
 */
export function deliver(game: GameContext, p: Player, w: Ware): boolean {
  const inv = p.inventory;
  if (w.kind === 'armor') return wearArmor(game, p, w.item as ArmorId);
  if (w.kind === 'weapon') {
    if (!inv.slots.includes(null)) return false;
    inv.give(w.item);
    const at = inv.slots.findIndex((s) => s?.item === w.item);
    if (at >= 0) inv.select(at);
    return true;
  }
  return inv.give(w.item, w.count ?? 1) === 0;
}
