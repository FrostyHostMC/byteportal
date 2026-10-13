import type { Entity, GameContext, Player, Vec3 } from '@platform';
import { bus } from './bus';

/** A kind's own business when one of it comes in or dies (monsters' and bosses' hooks, by type). */
export interface KindHooks {
  spawned?(game: GameContext, e: Entity): void;
  slain?(game: GameContext, e: Entity, by: Player | null): void;
}

const hooks = new Map<string, KindHooks>();

/** Note a kind's hooks (`defineMonsters`, `defineBosses`). */
export function registerKind(type: string, h: KindHooks) {
  hooks.set(type, h);
}

export const kindHooks = (type: string): KindHooks | undefined => hooks.get(type);

/**
 * Bring a monster (or a boss) into the arena: spawned, its own `spawned` hook run, and the bus told
 * (`spawned`), so twists, elites, the HUD and the crowd hear of it. Everything that brings one in
 * (the director, a boss's summons, a necromancer) goes through here.
 */
export function spawnMonster(game: GameContext, type: string, at: Vec3, opts: { yaw?: number; data?: Record<string, unknown> } = {}): Entity {
  const e = game.entities.spawn(type, at, opts);
  hooks.get(type)?.spawned?.(game, e);
  bus.emit('spawned', { entity: e, type });
  return e;
}
