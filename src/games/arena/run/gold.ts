import type { GameContext, Player, Vec3 } from '@platform';
import { bus, type ArenaEvents } from './bus';
import { runs } from './state';

/**
 * Each fighter's gold for this fight (by player id): earned from kills and pickups, spent at the
 * shop, on traps, the mystery chest. Every change is told on the bus (`gold`), for the HUD.
 */
const purses = new Map<string, number>();

export const gold = (p: Player): number => purses.get(p.id) ?? 0;

type Why = ArenaEvents['gold']['why'];

export function addGold(_game: GameContext, p: Player, n: number, at?: Vec3, why?: Why) {
  n = Math.round(n);
  if (n === 0) return;
  const total = Math.max(0, gold(p) + n);
  purses.set(p.id, total);
  // (What they earned this run, for the end screen: not what they came in with.)
  const r = runs.get(p.id);
  if (r && n > 0 && why !== 'start') r.gold += n;
  if (r && n < 0) r.spent -= n;
  bus.emit('gold', { player: p, delta: n, total, at, why });
}

/** Take `n` gold if they have it (true), or nothing (false). */
export function spend(game: GameContext, p: Player, n: number): boolean {
  if (gold(p) < n) return false;
  addGold(game, p, -n, undefined, 'spend');
  return true;
}

/** A fresh fight: everyone's purse empty. */
export function resetGold() {
  purses.clear();
}

/** Someone left: their purse goes with them (coming back, they're armed afresh). */
export function dropPurse(p: Player) {
  purses.delete(p.id);
}
