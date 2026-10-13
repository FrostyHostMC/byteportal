import type { Entity, GameContext, Pickup, Player, Vec3 } from '@platform';
import { monsterKind } from '../monsters';
import { bossKind } from '../bosses';
import { bus } from './bus';
import { addGold } from './gold';
import { favoured } from './hype';
import { state } from './state';
import { DIFFICULTY } from './difficulty';

/**
 * Coins: every monster slain spills its worth in gold where it fell (a coin, or a scatter of piles
 * for a big one), pulled to whoever comes near and counted into their purse (`gold.ts`). A monster's
 * worth is its cost to the director times `GOLD_PER_COST`, more for a champion (`data.worth` times,
 * the bestiary's elites say; else three); a
 * Treasure Goblin bursts into a shower, and a boss's bounty is its own to scatter (`coins` on the
 * bus). Gold Rush and the Crowd's Favour each double it all. Whatever's left lying when a wave's won is raked up and shared out, and each
 * fighter gets the wave's bonus.
 */
export const GOLD_PER_COST = DIFFICULTY.goldPerCost;
const ELITE = 3;
const GOBLIN_GOLD = 100;
/** A wave's bonus, for each fighter: this, and this much more each wave. */
export const waveBonus = (n: number) => 10 + 3 * n;
/** Up to this much is one coin; more is piles. */
const ONE_COIN = 40;

/** The coins lying about (to rake up at the end of a wave). */
const lying = new Set<Pickup>();

export function defineCoins(game: GameContext) {
  // (Their looks are each screen's: `client/run.ts`.)
  for (const [id, name] of [
    ['coin', 'Gold'],
    ['coin_pile', 'Gold'],
  ] as const) {
    game.items.define(id, {
      kind: 'misc',
      name,
      onPickup(g, count, player) {
        addGold(g, player, count, player.position, 'coin');
        player.audio.play('coin', { pitch: 0.9 + Math.min(0.5, count / 200) });
        return true;
      },
    });
  }
}

/**
 * How much of its kind's worth a monster brings: nothing for one something else brought into the
 * fight (raised by a necromancer, split off a slime, a boss's minion: `data.master`), a quarter
 * for one of a flock (`data.flock`), all of it otherwise. (XP goes by it too.)
 */
export const share = (e: Entity): number => (e.data.master !== undefined ? 0 : e.data.flock ? 0.25 : 1);

/** What a monster's worth in gold (before Gold Rush and the Favour). */
export function worth(e: Entity): number {
  if (bossKind(e.type)) return 0;
  if (e.type === 'goblin') return GOBLIN_GOLD;
  const base = (monsterKind(e.type)?.cost ?? 1) * GOLD_PER_COST;
  const elite = typeof e.data.worth === 'number' ? e.data.worth : e.data.elite ? ELITE : 1;
  return Math.round(base * elite * share(e));
}

/** Spill `value` gold at `at`: a coin, or piles flung about. */
export function spill(game: GameContext, at: Vec3, value: number) {
  const piles = value <= ONE_COIN ? 1 : Math.min(10, Math.ceil(value / ONE_COIN));
  const each = Math.round(value / piles);
  for (let i = 0; i < piles; i++) {
    const a = game.rng.range(0, Math.PI * 2);
    const s = piles > 1 ? game.rng.range(1.5, 4) : 0.5;
    const velocity = { x: Math.cos(a) * s, y: piles > 1 ? game.rng.range(5, 8) : 4, z: Math.sin(a) * s };
    lying.add(game.items.spawnPickup(piles > 1 || each > 20 ? 'coin_pile' : 'coin', { x: at.x, y: at.y + 0.8, z: at.z }, { count: each, velocity, despawn: 60 }));
  }
}

/** Gold Rush and the Crowd's Favour, each doubling what's spilled. */
const boosted = (game: GameContext, value: number) => value * (state.twist === 'gold_rush' ? 2 : 1) * (favoured(game) ? 2 : 1);

export function coinsListen(game: GameContext) {
  bus.on('slain', ({ entity, at }) => {
    const value = boosted(game, worth(entity));
    if (value > 0) spill(game, at, value);
    if (entity.type === 'goblin') game.audio.play('coins', { at, volume: 1.2 });
  });
  bus.on('coins', ({ at, value }) => {
    spill(game, at, boosted(game, value));
    game.audio.play('coins', { at, volume: 1.4 });
  });
}

/**
 * The wave's won: the coins still lying are raked up and shared among those standing, and each
 * fighter gets the wave's bonus (told on the bus as `why: 'wave'`). Returns the bonus.
 */
export function payWave(game: GameContext, n: number): number {
  const standing = game.players.filter((p) => p.alive);
  let left = 0;
  for (const c of lying) {
    if (c.alive) {
      left += c.count;
      c.remove();
    }
  }
  lying.clear();
  const share = standing.length ? Math.floor(left / standing.length) : 0;
  const bonus = waveBonus(n);
  for (const p of game.players) addGold(game, p, bonus + (p.alive ? share : 0), undefined, 'wave');
  return bonus;
}

/** A fresh fight: nothing lying about (the restart took the pickups). */
export function resetCoins() {
  lying.clear();
}

/** Gold for someone arriving late, so they can shop like the rest: a share of what the waves so far paid. */
export function catchUp(game: GameContext, p: Player, cleared: number) {
  if (cleared > 0) addGold(game, p, cleared * 35, undefined, 'start');
}
