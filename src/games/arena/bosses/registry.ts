import type { Entity, EntityDefinition, GameContext, Player } from '@platform';

/**
 * A boss: a wave's star (`run/director.ts` names one per boss wave). Its definition has
 * `boss: true` (the boss bar); `name` and `title` go on its entrance card, in `color`. Add one: a
 * file in `bosses/` exporting a `BossKind`, listed in `bosses/index.ts`.
 *
 * The bosses' part (`part.ts`) gives every boss the same frame: an entrance (the camera on it, its
 * card, `roar`), health that grows with the party, and a death (its throes, the camera on it, a
 * last blast and a shower of loot). Its brain (`fight.ts`: phases, moves) is its own.
 */
export interface BossKind {
  id: string;
  /** "The Warden", and a line under it: "Keeper of the Pit". */
  name: string;
  title: string;
  /** Its colour: the entrance card, the banners. */
  color: string;
  define(game: GameContext): EntityDefinition;
  /** What comes in with it besides its wave's roster (types and counts, before party size). */
  escort?: Record<string, number>;
  /** How tall it stands (blocks): the cameras frame it by this. */
  height: number;
  /** The gold its death showers (the run's coins), before the party's size. */
  bounty: number;
  /** Its roar as the entrance's camera finds it: a clip, a cry, and whatever else it does. */
  roar(game: GameContext, e: Entity): void;
  /** Its death throes begin (a clip, a cry): it's beaten and falls over the next seconds. */
  throes(game: GameContext, e: Entity): void;
  /** A fighter's blast (a bomb, a keg) staggers it for this long (seconds); without it, blasts don't. */
  stagger?: number;
  /** What its shots do to a fighter they hit, besides the damage (by the shot's `weapon`): a chill, a slow. */
  hits?: Record<string, (game: GameContext, p: Player) => void>;
  spawned?(game: GameContext, e: Entity): void;
  slain?(game: GameContext, e: Entity, by: Player | null): void;
}
