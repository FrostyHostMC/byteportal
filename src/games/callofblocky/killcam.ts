import type { GameContext, Player, Vec3 } from '@platform';
import { COLORS } from './shared';
import { feedIcon, weaponName } from './weapons';

/**
 * The kill cam: shot by someone, you see it again through their eyes (the platform's replays,
 * `game.replay`): the last few seconds up to the shot that got you and a moment after, with their
 * hands and their gun, then you respawn. Your own death is never shown from your side of it.
 *
 * The timing, from the moment you die:
 * - 0 to 0.5 s: you fall (the death tilt) and KILLED BY comes up;
 * - 0.5 s: the kill cam starts, 4 s long (from 3.5 s before the death to 0.5 s after), at full speed;
 * - 4.5 s: it's over and you respawn (the respawn delay was 3 s: it stretches by 1.5 s).
 *
 * Killed by a killstreak (the Hellstorm, the chopper), it's seen from a camera standing near
 * where you fell instead (`Streaks.killcamView`).
 *
 * Skipping it (click or Space, `client/killcam.ts`) respawns you at once if the old 3 s are up,
 * else when they are (watching whoever did it meanwhile). Bots get no kill cam, and respawn as before.
 */

/** Seconds after the death that the kill cam starts, and how much of the past it shows before the death. */
export const KILLCAM_DELAY = 0.5;
export const KILLCAM_BEFORE = 3.5;

/** What the kill cam's client code shows (its `data`). */
export interface KillcamData {
  killer: string;
  color: string;
  weapon: string | null;
  icon: ReturnType<typeof feedIcon>;
  headshot: boolean;
  through: boolean;
}

interface Watch {
  /** The kill cam is over (played, skipped, or it couldn't be shown): the respawn needn't wait. */
  done: boolean;
  /** By the game's clock: past this, the respawn waits no longer, whatever happened. */
  limit: number;
}

const watching = new Map<string, Watch>();

/** Watch whoever did it, from behind them (while waiting to respawn with no kill cam playing). */
function orbit(victim: Player, killer: Player) {
  if (victim.alive || !killer.alive) return;
  victim.camera.orbit(killer, { distance: 4.5, min: 4.5, max: 4.5 });
}

/**
 * A person was killed by someone: their kill cam starts in a moment (bots get none). The respawn
 * waits for it (`killcamHolds`).
 */
export function killcam(game: GameContext, victim: Player, killer: Player, weapon: string | undefined, headshot: boolean, through: number, camera?: { at: Vec3; look: Vec3 } | null) {
  if (victim.bot) return;
  const w: Watch = { done: false, limit: game.clock.now + KILLCAM_DELAY + KILLCAM_BEFORE + KILLCAM_DELAY + 1.5 };
  watching.set(victim.id, w);
  const data: KillcamData = {
    killer: killer.name,
    color: killer.bot ? '#ffe7a3' : COLORS.gold,
    weapon: weapon ? weaponName(weapon) : null,
    icon: weapon ? feedIcon(weapon) : null,
    headshot,
    through: through > 0,
  };
  game.clock.after(KILLCAM_DELAY, () => {
    if (watching.get(victim.id) !== w || w.done || victim.alive) return;
    const shown = game.replay.show(victim, {
      from: KILLCAM_BEFORE + KILLCAM_DELAY,
      seconds: KILLCAM_BEFORE + KILLCAM_DELAY,
      // A killstreak's kill: from a camera of its own (the killer's eyes are on the ground).
      ...(camera ? { camera } : { follow: killer }),
      label: 'killcam',
      data,
      onEnd: ({ skipped }) => {
        w.done = true;
        // Skipped before the respawn's due: watch them meanwhile, as before there was a kill cam.
        if (skipped) orbit(victim, killer);
      },
    });
    if (!shown) {
      w.done = true;
      orbit(victim, killer);
    }
  });
}

/** The match is over, and the Play of the Game is coming: kill cams not started yet never do. */
export function killcamsOff() {
  for (const w of watching.values()) w.done = true;
}

/** Whether this player's respawn waits for their kill cam (it's coming, or playing). */
export function killcamHolds(game: GameContext, player: Player): boolean {
  const w = watching.get(player.id);
  if (!w) return false;
  // (A limit far ahead is from before a restart put the clock back.)
  if (w.done || game.clock.now > w.limit || w.limit - game.clock.now > 30) {
    watching.delete(player.id);
    return false;
  }
  return true;
}
