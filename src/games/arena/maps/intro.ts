import type { GameContext, Player } from '@platform';
import { map } from '../run/state';
import { INTRO_MSG, type IntroMessage } from './messages';

/**
 * The fly-over each fighter's shown (`client/maps/intro.ts` flies it, and tells the server when
 * it's over: the run waits for that to put up the class pick): the whole of it as a fight begins
 * (`runStart`), a shorter one as someone joins a fight under way, never twice for one arrival.
 */

/** Which map's fly-over each fighter was last shown, and when (the all-time clock). */
const shown = new Map<string, { map: string; at: number }>();

export function setupIntro() {
  shown.clear();
}

/** A fight's beginning (a restart too): everyone's shown it afresh. */
export function startIntro() {
  shown.clear();
}

/** Show a fighter the fly-over (`full` at a fight's start), unless they're a bot or were just shown this map's. */
export function introduce(game: GameContext, p: Player, full: boolean) {
  const last = shown.get(p.id);
  if (p.bot || (last && last.map === map().id && last.at > game.clock.total - 3)) return;
  shown.set(p.id, { map: map().id, at: game.clock.total });
  game.clients.send(p, INTRO_MSG, { map: map().id, full } satisfies IntroMessage);
}
