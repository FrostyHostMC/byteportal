import type { GameContext, Player } from '@platform';

/**
 * A part of the Arena on the server: maps and their traps, the bestiary, the bosses, the armory,
 * the run (gold, the crowd, revives, progression), the HUD. Each is one object in its own folder,
 * listed in `parts.ts`, and the server calls them in that order, so a part never needs the server
 * edited to hook in. Parts talk through `run/bus.ts`, not by calling each other.
 */
export interface ArenaPart {
  name: string;
  /** Once per game, after the content's defined: listeners (`game.events`, the bus), commands. */
  setup?(game: GameContext): void;
  /** Each fight's beginning, after the state's reset (and before the fighters are armed). */
  start?(game: GameContext): void;
  /** Every tick. */
  update?(game: GameContext, dt: number): void;
  /** A fighter armed for this fight: at its start, or arriving late. */
  arm?(game: GameContext, p: Player): void;
}
