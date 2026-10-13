/**
 * What the maps' server side tells each screen (`game.clients.send`), and the screens' code
 * (`client/maps/`) hears: kept here so both sides agree without either importing the other.
 */

/** The opening fly-over: the map's id, and whether it's a fight's start (else a joiner's, shorter and skippable). */
export const INTRO_MSG = 'arena.intro';
export interface IntroMessage {
  map: string;
  full: boolean;
}
/** How long it runs (seconds): a fight's start, a joiner's, and the ease back into their own view (the run waits it out before the class pick). */
export const INTRO_TIME = { full: 6, short: 3.4, ease: 1.2 };
/** A screen's fly-over is over (played out, or skipped): from the screen, no data. */
export const INTRO_DONE_MSG = 'arena.introDone';

/** The crowd cheering (the Crowd's Favour, `big`, or a feat): the stands throw petals into the pit. */
export const CHEER_MSG = 'arena.cheer';
export interface CheerMessage {
  big: boolean;
}

/** A trap's gone off: its id, and for how long (seconds) it's going. */
export const TRAP_MSG = 'arena.trap';
export interface TrapMessage {
  id: string;
  time: number;
}
