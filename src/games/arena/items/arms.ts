import type { GameContext, ItemDefinition } from '@platform';
import type { BowItem } from '@platform/items';
import type { CrossbowItem } from './crossbow';
import type { ArmsMelee } from './melee';
import { RARE_BASES, RARITIES, RARITY, variant, type RareBase, type Rarity, type RarityDef } from './rarity';
import type { StaffItem } from './staff';

/**
 * The arsenal: every weapon, what it does in each rarity, its legendary, what it costs and what the
 * shop says of it. A rarer one hits harder and is ready sooner (`RARITY`), a guard blocks more and
 * parries for longer, a legendary has a name and a trick of its own (`combat.ts`, `spear.ts`,
 * `staff.ts`, `crossbow.ts`). What each looks and sounds like is each screen's (`client/looks.ts`).
 */
export interface Arm {
  name: string;
  /** What it is, in a line (the shop, the chest's reveal). */
  text: string;
  /** The legendary's own name, and what it does besides. */
  legend: { id: string; name: string; text: string };
  /** Gold for a common one at the shop (the forge's prices follow it), and the first wave after which it's for sale. */
  price: number;
  from: number;
  def(r: RarityDef, rarity: Rarity): Omit<ItemDefinition, 'name'>;
}

/** Scales by rarity: a 0..1 step up the four (common 0, legendary 1). */
const step = (rarity: Rarity) => RARITIES.indexOf(rarity) / 3;

function melee(o: Omit<ArmsMelee, 'kind' | 'name' | 'rank'> & { rank: number }, legend: string, extra?: (rarity: Rarity) => Partial<ArmsMelee>) {
  return (r: RarityDef, rarity: Rarity): Omit<ArmsMelee, 'name'> => ({
    kind: 'melee',
    ...o,
    damage: o.damage * r.damage,
    cooldown: o.cooldown * r.pace,
    rank: o.rank + r.rank,
    ...(rarity === 'legendary' && { legend }),
    ...extra?.(rarity),
  });
}

export const ARMS: Record<RareBase, Arm> = {
  gladius: {
    name: 'Gladius',
    text: 'Sword and shield: right mouse blocks, and raised just in time it parries',
    legend: { id: 'aegis', name: 'Aegis', text: 'A parry lets loose a burst that staggers everything about you' },
    price: 150,
    from: 1,
    def: melee({ damage: 6, cooldown: 0.42, reach: 3.4, knockback: 1, rank: 3.2, heft: 'blade' }, 'aegis', (rarity) => ({
      guard: { take: 0.25 - 0.2 * step(rarity), slow: 0.55, parry: 0.26 + 0.1 * step(rarity), stagger: 1.6, bash: { damage: 3, knockback: 2.2, cooldown: 0.9 } },
    })),
  },
  warhammer: {
    name: 'Warhammer',
    text: 'Hold to raise it, let go to slam the ground: everything around is thrown and staggered',
    legend: { id: 'earthshaker', name: 'Earthshaker', text: 'The ground shakes again a moment after each slam, further out' },
    price: 260,
    from: 3,
    def: melee({ damage: 8, cooldown: 0.9, reach: 3.3, knockback: 1.8, rank: 4, heft: 'heavy', weight: 0.92 }, 'earthshaker', (rarity) => {
      const k = RARITY[rarity].damage;
      return { slam: { charge: 0.8, min: 0.25, damage: [10 * k, 24 * k], radius: [2.6, 4.4 + 0.6 * step(rarity)], knockback: 1.8, stagger: 1.4 } };
    }),
  },
  spear: {
    name: 'Spear',
    text: 'A long thrust through two; right mouse throws it, and again calls it back',
    legend: { id: 'skypiercer', name: 'Skypiercer', text: 'Thrown, it goes through everything and calls lightning where it lands' },
    price: 180,
    from: 2,
    def: melee({ damage: 6.5, cooldown: 0.55, reach: 4.6, knockback: 1.2, pierce: 2, rank: 3.5, heft: 'blade' }, 'skypiercer', (rarity) => ({
      throw: { damage: 13 * RARITY[rarity].damage, speed: 32, pierce: 3, back: 3 },
    })),
  },
  crossbow: {
    name: 'Crossbow',
    text: 'Heavy bolts that go through three in a line; slow to span again. Uses arrows',
    legend: { id: 'hailstorm', name: 'Hailstorm', text: 'Looses three bolts at once' },
    price: 200,
    from: 2,
    def: (r, rarity) =>
      ({ kind: 'gun', ammo: 'arrow', damage: 14 * r.damage, reload: 1.2 * r.pace, speed: 60, pierce: 3, zoom: 1.6, rank: 3 + r.rank, ...(rarity === 'legendary' && { bolts: 3 }) }) satisfies Omit<CrossbowItem, 'name'>,
  },
  daggers: {
    name: 'Twin Daggers',
    text: 'Quick cuts; from behind, on a staggered or frozen foe, or straight after a roll, they strike two and a half times as hard',
    legend: { id: 'nightfang', name: 'Nightfang', text: 'Their crits bleed, and a crit that kills mends a heart' },
    price: 150,
    from: 1,
    def: melee({ damage: 3.2, cooldown: 0.22, reach: 2.9, knockback: 0.4, backstab: 2.5, weight: 1.08, rank: 3, heft: 'light' }, 'nightfang'),
  },
  greatsword: {
    name: 'Greatsword',
    text: 'Slow, wide sweeps that cut through everything in front of you',
    legend: { id: 'sunderer', name: 'Sunderer', text: 'Each swing sends a wave of steel rolling on ahead' },
    price: 280,
    from: 4,
    def: melee({ damage: 11, cooldown: 0.95, reach: 4, knockback: 1.9, arc: 70, weight: 0.9, rank: 4.5, heft: 'heavy' }, 'sunderer'),
  },
  fire_staff: {
    name: 'Fire Staff',
    text: 'Fireballs that burst and set everything round them burning',
    legend: { id: 'emberheart', name: 'Emberheart', text: 'Where a fireball bursts, the ground burns on' },
    price: 220,
    from: 2,
    def: (r, rarity) =>
      ({ kind: 'staff', spell: 'fire', damage: 4.4 * r.damage, cooldown: 0.95 * r.pace, radius: 2.4, burn: [1.85 * r.damage, 3], rank: 3.5 + r.rank, ...(rarity === 'legendary' && { legend: 'emberheart' }) }) satisfies Omit<StaffItem, 'name'>,
  },
  frost_staff: {
    name: 'Frost Staff',
    text: 'A stream of ice shards: each slows what it hits, and four freeze it solid',
    legend: { id: 'winters_heart', name: "Winter's Heart", text: 'The frozen shatter when slain, freezing those about them' },
    price: 220,
    from: 2,
    def: (r, rarity) => ({ kind: 'staff', spell: 'frost', damage: 2.6 * r.damage, cooldown: 0.24 * r.pace, rank: 3.5 + r.rank, ...(rarity === 'legendary' && { legend: 'winters_heart' }) }) satisfies Omit<StaffItem, 'name'>,
  },
  storm_wand: {
    name: 'Storm Wand',
    text: 'Lightning that leaps from one monster to the next',
    legend: { id: 'tempest', name: 'Tempest', text: 'Its lightning leaps to twice as many' },
    price: 240,
    from: 3,
    def: (r, rarity) =>
      ({ kind: 'staff', spell: 'storm', damage: 7 * r.damage, cooldown: 0.7 * r.pace, chain: 3, radius: 6, rank: 3.8 + r.rank, ...(rarity === 'legendary' && { legend: 'tempest' }) }) satisfies Omit<StaffItem, 'name'>,
  },
  battle_axe: {
    name: 'Battle Axe',
    text: 'A heavy cleave through everything close in front',
    legend: { id: 'headsman', name: 'Headsman', text: 'Cleaves straight through anything but a boss under a quarter of its health' },
    price: 220,
    from: 4,
    def: melee({ damage: 10, cooldown: 0.85, reach: 3.3, knockback: 1.8, arc: 45, rank: 4, heft: 'heavy' }, 'headsman'),
  },
  pike: {
    name: 'Pike',
    text: 'Long reach and a heavy shove, through two in a line',
    legend: { id: 'impaler', name: 'Impaler', text: 'Its thrusts go through four, and stagger' },
    price: 150,
    from: 3,
    def: melee({ damage: 7.5, cooldown: 0.7, reach: 5, knockback: 2.2, pierce: 2, rank: 3.5, heft: 'blade' }, 'impaler', (rarity) => (rarity === 'legendary' ? { pierce: 4 } : {})),
  },
  diamond_sword: {
    name: 'Diamond Sword',
    text: 'Quick and keen, its sweep catching those beside',
    legend: { id: 'starfall', name: 'Starfall', text: 'A jump attack calls a falling star down on what it hits' },
    price: 400,
    from: 6,
    def: melee({ damage: 8, cooldown: 0.4, reach: 3.7, knockback: 1.2, sweep: true, rank: 5, heft: 'blade' }, 'starfall'),
  },
  bow: {
    name: 'Bow',
    text: 'Hold to draw, let go to loose: a full draw is a critical hit. Uses arrows',
    legend: { id: 'sunbow', name: 'Sunbow', text: 'Its arrows set monsters burning' },
    price: 60,
    from: 0,
    // What it shoots is drawn by the server, as an arrow (the bow's own look is each screen's).
    def: (r) => ({ kind: 'bow', ammo: 'arrow', projectile: 'arrow', damage: [3 * r.damage, 11 * r.damage], drawTime: 0.9 * r.pace, speed: 42, rank: r.rank * 0.5 }) satisfies Omit<BowItem, 'name'>,
  },
};

/** A weapon's name in a rarity: the rarer ones say so, a legendary has its own. */
export function armName(base: RareBase, rarity: Rarity): string {
  const a = ARMS[base];
  if (rarity === 'legendary') return a.legend.name;
  return rarity === 'common' ? a.name : `${RARITY[rarity].name} ${a.name}`;
}

/** Every weapon of the arsenal in every rarity (in `setup`). */
export function defineArms(game: GameContext) {
  for (const base of RARE_BASES)
    for (const rarity of RARITIES) {
      const def = ARMS[base].def(RARITY[rarity], rarity);
      game.items.define(variant(base, rarity), { ...def, name: armName(base, rarity) } as ItemDefinition);
    }
}
