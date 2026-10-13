import type { GameContext, ItemKit } from '@platform';
import { bows, consumables, throwables } from '@platform/kits';
import type { ConsumableItem, ThrowableItem } from '@platform/items';
import { ARENA_ATLAS, paintArenaAtlas } from '../art';
import { defineArms } from './arms';
import { RARITIES, shieldOf } from './rarity';
import { crossbows } from './crossbow';
import { melee } from './melee';
import { ARMOR, wearArmor, type ArmorId } from './armor';
import { downed } from './moves';
import { POTION } from './potions';
import { staffs } from './staff';

export { ARMS, armName, type Arm } from './arms';
export { ARMOR, ARMOR_CAP, addArmor, armorOf, shedArmor, wearArmor, type ArmorId } from './armor';
export { ALL_VARIANTS, RARE_BASES, RARITIES, RARITY, baseOf, hasRarities, nextRarity, rarityColor, rarityOf, rollRarity, variant, type Rarity, type RareBase } from './rarity';

/**
 * The Arena's kinds of item, in the order they run (the server's `items`): bombs, bows, the
 * arsenal's own melee weapons (and the bare fist), crossbows, staffs and wands, potions.
 */
export const ARMORY_KITS: ItemKit[] = [throwables(), bows(), melee(), crossbows(), staffs(), consumables()];

/**
 * The Arena's own art: mob skins, item sprites and the held weapons' textures painted into the
 * `arena` atlas, which goes to every screen (the monsters are drawn from it, and the screens'
 * item looks name its sprites: `client/looks.ts`).
 */
export function defineArt(game: GameContext) {
  const a = paintArenaAtlas();
  game.items.atlas(ARENA_ATLAS, { width: a.width, height: a.height, pixels: a.albedo, emissive: a.emissive });
}

/** The weapons and what's picked up: what each does. (How they look is each screen's: `client/looks.ts`.) */
export function defineItems(game: GameContext) {
  const it = game.items;
  it.define('wooden_sword', { kind: 'melee', name: 'Wooden Sword', damage: 4, cooldown: 0.45, reach: 3.3, rank: 1, heft: 'blade' });
  it.define('stone_sword', { kind: 'melee', name: 'Stone Sword', damage: 5, cooldown: 0.45, reach: 3.4, rank: 2, heft: 'blade' });
  it.define('iron_sword', { kind: 'melee', name: 'Iron Sword', damage: 6.5, cooldown: 0.42, reach: 3.5, knockback: 1.1, rank: 3, heft: 'blade' });
  // The arsenal, each in every rarity (`arms.ts`): the gladius to the bow.
  defineArms(game);
  it.define('arrow', { kind: 'misc', name: 'Arrow', stack: 64 });
  // Thrown with G (or the attack button in hand): it bounces about for a moment, then goes off,
  // throwing monsters across the pit. It never hurts a fighter (the server's no-friendly-fire).
  it.define('bomb', {
    kind: 'throwable',
    name: 'Bomb',
    key: 'KeyG',
    fuse: 1.6,
    cook: false,
    speed: 19,
    lift: 9,
    physics: { gravity: 24, bounce: 0.35, friction: 0.5, radius: 0.18 },
    blast: { radius: 4.2, damage: [22, 6], knockback: 2.4, size: 1.6, color: '#ff9a3a' },
    cooldown: 0.5,
    stack: 8,
    rank: -1,
  } satisfies ThrowableItem);
  // Drunk with R wherever it's carried (`potions.ts`), or the right button with it in hand.
  it.define('health_potion', {
    kind: 'consumable',
    name: 'Health Potion',
    stack: 4,
    use(g, player) {
      // Not while down (their health is then the time they have left), nor at full health.
      if (downed(player) || player.health >= player.maxHealth) return false;
      player.heal(POTION.heal);
      g.audio.play('heal', { at: player.position });
      g.fx.burst(player.eye, { color: '#ff4f6d', count: 16, speed: 2, gravity: -3 });
      return true;
    },
  } satisfies ConsumableItem);
  it.define('heart', {
    kind: 'misc',
    name: 'Heart',
    onPickup(g, count, player) {
      player.heal(4 * count);
      g.audio.play('heal', { at: player.position, volume: 0.8 });
      return true;
    },
  });
  it.define('bomb_bundle', {
    kind: 'misc',
    name: 'Bombs',
    onPickup(g, count, player) {
      player.inventory.give('bomb', count);
      player.hud.toast(`+${count} ${count === 1 ? 'Bomb' : 'Bombs'}`);
      g.audio.play('pickup', { at: player.position });
      return true;
    },
  });
  it.define('arrow_bundle', {
    kind: 'misc',
    name: 'Arrows',
    onPickup(g, count, player) {
      player.inventory.give('arrow', 6 * count);
      player.hud.toast(`+${6 * count} Arrows`);
      g.audio.play('pickup', { at: player.position });
      return true;
    },
  });
  // The gladius's shield and the crossbow's spanned bolt, never carried: items so each screen can
  // show them (in the off hand, in the groove).
  for (const r of RARITIES) it.define(shieldOf(r), { kind: 'misc', name: 'Shield' });
  it.define('crossbow_bolt', { kind: 'misc', name: 'Bolt' });
  // Armour, put on when it's walked over (or bought).
  for (const id of Object.keys(ARMOR) as ArmorId[]) {
    it.define(id, { kind: 'misc', name: ARMOR[id].name, onPickup: (g, _count, player) => (wearArmor(g, player, id), true) });
  }
}
