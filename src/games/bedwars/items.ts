import type { GameContext } from '@platform';
import type { ConsumableItem } from '@platform/items';
import type { Fireballs } from './fireballs';
import { CURRENCIES, CURRENCY_NAME, SWORD, TEAM_STYLE, type Match } from './state';

const CURRENCY_PITCH = { iron: 1, gold: 1.15, diamond: 1.3, emerald: 1.45 };

/**
 * Everything players carry: what each does. Currency never takes a slot: it goes straight to their
 * wallet. (How they look, their icons and the swords' models, is each screen's:
 * `client/looks.ts`.)
 */
export function defineItems(game: GameContext, m: Match, fireballs: Fireballs) {
  const it = game.items;
  for (const c of CURRENCIES) {
    it.define(c, {
      kind: 'misc',
      name: CURRENCY_NAME[c][0],
      onPickup(_g, n, player) {
        const me = m.memberOf(player);
        // Someone watching can't collect it.
        if (!me) return false;
        me.wallet[c] += n;
        player.audio.play('pickup', { volume: 0.45, pitch: CURRENCY_PITCH[c] });
        return true;
      },
    });
  }
  defineSwords(game);
  it.define('wooden_pickaxe', { kind: 'melee', name: 'Wooden Pickaxe', damage: 2, cooldown: 0.7, rank: 0 });
  it.define('iron_pickaxe', { kind: 'melee', name: 'Iron Pickaxe', damage: 3, cooldown: 0.7, rank: 0 });
  it.define('diamond_pickaxe', { kind: 'melee', name: 'Diamond Pickaxe', damage: 4, cooldown: 0.7, rank: 0 });
  it.define('shears', { kind: 'misc', name: 'Shears', stack: 1 });
  // What it shoots is drawn by the server, as an arrow (the bow's own look is each screen's).
  it.define('bow', { kind: 'bow', name: 'Bow', ammo: 'arrow', projectile: 'arrow', damage: [1.5, 7], drawTime: 1, speed: 44, rank: 0 });
  it.define('arrow', { kind: 'misc', name: 'Arrow', stack: 64 });
  // Blocks, which the building kit places (`BLOCK_ITEMS`: each the block it places). Each team has its wool.
  for (const color of Object.keys(TEAM_STYLE)) it.define(`wool_${color}`, { kind: 'misc', name: 'Wool' });
  it.define('planks', { kind: 'misc', name: 'Oak Planks' });
  it.define('end_stone', { kind: 'misc', name: 'End Stone' });
  it.define('obsidian', { kind: 'misc', name: 'Obsidian' });
  it.define('golden_apple', {
    kind: 'consumable',
    name: 'Golden Apple',
    stack: 16,
    // Eaten over Minecraft's 1.6 s (slowed, the hand at the mouth), then it mends 4 hearts over 5 s: no healing mid-fight at a click.
    useTime: 1.6,
    canUse: (_g, player) => player.health < player.maxHealth,
    use(g, player) {
      if (!player.alive) return false;
      player.heal(8, { over: 5 });
      g.fx.burst(player.eye, { color: '#ffd84a', count: 14, speed: 2, gravity: -3, glow: 1 });
      return true;
    },
  } satisfies ConsumableItem);
  it.define('fire_charge', {
    kind: 'consumable',
    name: 'Fireball',
    stack: 16,
    use(_g, player) {
      const me = m.memberOf(player);
      if (!me) return false;
      const e = player.eye;
      const d = player.look;
      fireballs.launch({ x: e.x + d.x * 0.9, y: e.y + d.y * 0.9, z: e.z + d.z * 0.9 }, d, me.team, player);
      player.viewModel.play('swing');
      return true;
    },
  } satisfies ConsumableItem);
}

/** Swords, plain and sharpened (a team with Sharpened Swords gets the `_sharp` kind: +1 damage). */
export function defineSwords(game: GameContext) {
  const it = game.items;
  const kinds = [
    ['wooden_sword', 'Wooden Sword', 3.2],
    ['stone_sword', 'Stone Sword', 3.2],
    ['iron_sword', 'Iron Sword', 3.3],
    ['diamond_sword', 'Diamond Sword', 3.3],
  ] as const;
  kinds.forEach(([id, name, reach], tier) => {
    it.define(id, { kind: 'melee', name, damage: SWORD[tier], cooldown: 0.5, reach, rank: tier + 1 });
    it.define(`${id}_sharp`, { kind: 'melee', name: `Sharpened ${name}`, damage: SWORD[tier] + 1, cooldown: 0.5, reach, rank: tier + 1 });
  });
}
