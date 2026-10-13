import type { GameContext, ItemDefinition, Player } from '@platform';
import { isDowned, FEATHER, FEATHER_PRICE } from './downed';
import { addGold } from './gold';
import { ALL_VARIANTS, baseOf, hasRarities, RARITIES, RARITY, rarityOf, worth } from './loot';

/**
 * What a fighter carries (the nine hotbar slots), managed: X drops the stack in hand, thrown out
 * in front for anyone to take (not back to them till they've stepped away); the merchant buys
 * what they carry (`sellPrice`: a share of what it's worth); and a weapon arriving of a kind they
 * carry already (picked up, the chest's) takes the worse one's slot, the worse sold on the spot,
 * or comes as gold if it's no better. Something to fight with is always kept.
 */

export const DROP_KEY = 'KeyX';
/** The merchant pays this share of what a weapon's worth, and of supplies. */
const SELL_WEAPON = 0.4;
const SELL_SUPPLY = 0.5;
/** Kinds of item that aren't weapons. */
const NOT_WEAPONS = new Set(['misc', 'consumable', 'throwable']);
/** Kinds that fight with no ammo: a blade, an axe, a hammer, a staff. */
const FIGHTS = new Set(['melee', 'staff']);

const kindOf = (game: GameContext, item: string) => game.items.get(item)?.kind;
export const isWeapon = (game: GameContext, item: string) => {
  const k = kindOf(game, item);
  return !!k && !NOT_WEAPONS.has(k);
};
const nameOf = (game: GameContext, item: string) => game.items.get(item)?.name ?? item;
/** A name with its article: a Spear, an Epic Spear. */
const aName = (game: GameContext, item: string) => `${/^[aeiou]/i.test(nameOf(game, item)) ? 'an' : 'a'} ${nameOf(game, item)}`;

/** What the merchant pays for `count` of `item` (at least a coin). */
export function sellPrice(game: GameContext, item: string, count = 1): number {
  const value = item === FEATHER ? FEATHER_PRICE * count : worth(item, count);
  return Math.max(1, Math.round(value * (isWeapon(game, item) ? SELL_WEAPON : SELL_SUPPLY)));
}

/** Whether they may part with what's in `slot` and still have something to fight with. */
export function canPart(game: GameContext, p: Player, slot: number): boolean {
  const s = p.inventory.slots[slot];
  if (!s || !FIGHTS.has(kindOf(game, s.item) ?? '')) return true;
  return p.inventory.slots.some((x, i) => i !== slot && !!x && FIGHTS.has(kindOf(game, x.item) ?? ''));
}

/** The most of `item` their hotbar holds. */
function stackOf(game: GameContext, item: string): number {
  const def = game.items.get(item);
  return def?.stack ?? (def && isWeapon(game, item) ? 1 : 64);
}

/** Room for `count` of `item`: stacks of it with room, empty slots, or (a weapon) a worse one of its kind it would take the place of. */
export function fits(game: GameContext, p: Player, item: string, count = 1): boolean {
  const slots = p.inventory.slots;
  if (better(p, item) >= 0) return true;
  const max = stackOf(game, item);
  let room = 0;
  for (const s of slots) room += !s ? max : s.item === item ? Math.max(0, max - s.count) : 0;
  return room >= count;
}

/** The slot of a weapon of `item`'s kind they carry that it's better than (-1: none). */
function better(p: Player, item: string): number {
  if (!hasRarities(item)) return -1;
  const r = RARITIES.indexOf(rarityOf(item));
  return p.inventory.slots.findIndex((s) => !!s && hasRarities(s.item) && baseOf(s.item) === baseOf(item) && RARITIES.indexOf(rarityOf(s.item)) < r);
}

/** They carry a weapon of `item`'s kind as good or better. */
export const carriesAsGood = (p: Player, item: string) =>
  hasRarities(item) && p.inventory.slots.some((s) => !!s && hasRarities(s.item) && baseOf(s.item) === baseOf(item) && RARITIES.indexOf(rarityOf(s.item)) >= RARITIES.indexOf(rarityOf(item)));

/**
 * A weapon of the arsenal reaches them (a pickup: the chest's, a drop): better than one of its
 * kind they carry, it takes that one's slot and the worse is sold; no better, it comes as gold.
 * `'take'` if it's for the hotbar as usual (they carry none of its kind).
 */
export function arrive(game: GameContext, p: Player, item: string): 'take' | 'replaced' | 'sold' {
  if (carriesAsGood(p, item)) {
    const old = p.inventory.slots.find((s) => !!s && hasRarities(s.item) && baseOf(s.item) === baseOf(item))!.item;
    const g = sellPrice(game, item);
    addGold(game, p, g, p.position, 'sold');
    p.audio.play('coin');
    p.hud.toast(`+${g} gold for ${aName(game, item)}: you carry ${aName(game, old)}`);
    return 'sold';
  }
  const slot = better(p, item);
  if (slot < 0) return 'take';
  const old = p.inventory.slots[slot]!.item;
  p.inventory.set(slot, { item, count: 1 });
  const g = sellPrice(game, old);
  addGold(game, p, g, p.position, 'sold');
  p.audio.play('pickup');
  p.hud.toast(`${nameOf(game, item)} · +${g} gold for your ${nameOf(game, old)}`);
  return 'replaced';
}

/** Sell the stack in `slot` (if it's still `item`): gold for it, the slot emptied. The gold, or 0 if not. */
export function sellSlot(game: GameContext, p: Player, slot: number, item?: string): number {
  const s = p.inventory.slots[slot];
  if (!s || (item && s.item !== item)) return 0;
  if (!canPart(game, p, slot)) {
    p.hud.toast('Keep something to fight with');
    return 0;
  }
  const g = sellPrice(game, s.item, s.count);
  p.inventory.set(slot, null);
  addGold(game, p, g, undefined, 'sold');
  p.audio.play('buy');
  p.hud.toast(`Sold ${s.count > 1 ? `${s.count} × ` : ''}${nameOf(game, s.item)} · +${g} gold`);
  return g;
}

/** X: the stack in hand thrown out in front of them, for anyone (they can come back for it). */
export function drop(game: GameContext, p: Player): boolean {
  const inv = p.inventory;
  const s = inv.held;
  if (!s) return false;
  if (!canPart(game, p, inv.selected)) {
    p.hud.toast('Keep something to fight with');
    return false;
  }
  inv.set(inv.selected, null);
  const eye = p.eye;
  const look = p.look;
  const flat = Math.hypot(look.x, look.z) || 1;
  const fx = look.x / flat;
  const fz = look.z / flat;
  const r = hasRarities(s.item) ? rarityOf(s.item) : 'common';
  game.items.spawnPickup(s.item, { x: eye.x + fx * 0.6, y: eye.y - 0.4, z: eye.z + fz * 0.6 }, {
    count: s.count,
    velocity: { x: fx * 4.5, y: 2.5, z: fz * 4.5 },
    delay: 1,
    from: p,
    despawn: 60,
    beam: r !== 'common' ? RARITY[r].color : undefined,
  });
  game.audio.play('item_drop', { at: eye });
  p.hud.toast(`Dropped ${s.count > 1 ? `${s.count} × ` : ''}${nameOf(game, s.item)}`);
  return true;
}

/** The arsenal's weapons go through `arrive` when picked up (in `setup`, once they're defined). */
export function packSetup(game: GameContext) {
  for (const id of ALL_VARIANTS) {
    const def = game.items.get(id) as (ItemDefinition & { onPickup?: ItemDefinition['onPickup'] }) | undefined;
    if (!def || def.onPickup) continue;
    def.onPickup = (g, _count, player) => arrive(g, player, id) !== 'take';
  }
}

/** X pressed: a drop (people on their feet; a bot never). */
export function packUpdate(game: GameContext) {
  for (const p of game.players) if (!p.bot && p.alive && !isDowned(p) && p.input.pressed(DROP_KEY)) drop(game, p);
}
