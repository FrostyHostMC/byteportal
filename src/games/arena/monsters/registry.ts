import type { Entity, EntityDefinition, GameContext, Player } from '@platform';

/**
 * A kind of monster, as the director sees it: its platform definition (made at setup), and what it
 * costs, from when it turns up and what it does, so waves can be composed from whatever kinds
 * there are (`run/director.ts`). Add a monster: a file in `monsters/` exporting a `MonsterKind`,
 * listed in `monsters/index.ts`. Its looks are the entity's model (a voxel GLB from
 * `tools/monsters/build.mjs`, or a character); its voices are each screen's (`client/sounds/`, by
 * the names in `sounds`); what its screens draw for it, `client/bestiary.ts`.
 */
export interface MonsterKind {
  id: string;
  /** Its definition (the platform's `EntityDefinition`), made once when the game sets up. */
  define(game: GameContext): EntityDefinition;
  /** What one costs of a wave's budget (a zombie is 1, a brute 6). */
  cost: number;
  /** The first wave the director may bring it in to fill a wave (a scripted roster can bring it sooner). */
  from: number;
  /** How likely, among those that may come, it's picked to fill a wave (default 1). */
  weight?: number;
  /** Not more than this many in one wave (a goblin, a necromancer). */
  max?: number;
  /** What it is in a fight, for the director's mix (and the HUD's names). */
  role: 'melee' | 'ranged' | 'swarm' | 'support' | 'heavy' | 'special';
  /** One is one, however many fight (not multiplied by party size): a brute, a goblin. */
  single?: boolean;
  /** How to fight it, shown the first time one comes in each run (the HUD's "new foe" card). */
  tip?: string;
  /** Its name's colour on that tip. */
  color?: string;
  /** Its own business once it's killed (a Sapper's keg, a goblin's loot), after the platform's drops. */
  slain?(game: GameContext, e: Entity, by: Player | null): void;
  /** Its own business when it comes in (a goblin's marker). */
  spawned?(game: GameContext, e: Entity): void;
}
