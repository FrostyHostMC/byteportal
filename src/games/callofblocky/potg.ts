import type { GameContext, IconRef, Player, ReplayClip } from '@platform';
import { feedIcon, LETHALS, weaponName } from './weapons';

/**
 * Play of the Game: once a match is played out, everyone in it watches its best play again,
 * through the eyes of whoever made it, after a title sequence (`client/potg.ts`: a freeze-frame on
 * them, their name slammed across it, a chapter card).
 *
 * A play is a run of kills by one fighter, each within `GAP` seconds of the last (a double, a
 * triple, or one good kill on its own). Each is judged once it's over (`AFTER` seconds past its last
 * kill): its score, and if it's the best of the match so far, it's clipped from the room's history
 * there and then (`game.replay.clip`), from `BEFORE` seconds ahead of its first kill (or from
 * their spawn, if that's later: it opens on them standing), so it's there to show at the end
 * however long ago it was. Kills by a killstreak (the Hellstorm, the chopper)
 * don't count: nobody's eyes to see them through.
 *
 * The score: 100 a kill, more for a headshot, through a wall, from far off, with the katana or a
 * lethal, or ending someone's streak; the sum grows by half again for each kill past the first.
 * A bot's play counts for less, so a person's makes it when it's close. A later play beats an equal.
 */

/** Seconds of a play before its first kill, after its last, and between kills that are one play. */
const BEFORE = 3;
const AFTER = 1.5;
const GAP = 4;
/** The longest a play's clip may be (a long run is cut from the front). */
const MAX_CLIP = 12;
/** What the room's history must keep for that (and the kill cams'). */
export const POTG_KEEP = MAX_CLIP + 4;
/** Seconds after the match ends that it starts, and how long the title holds its first frame. */
export const POTG_DELAY = 2.5;
export const POTG_HOLD = 3.6;
/** From this far off (blocks), a kill is a long shot. */
const LONG = 35;

/** The play's title card (`client/potg.ts`, the replay's `data`). */
export interface PotgData {
  name: string;
  color: string;
  bot: boolean;
  /** "CHAPTER THREE", and the play's name: "TRIPLE FEATURE". */
  chapter: string;
  title: string;
  weapon: string | null;
  icon: IconRef | null;
  /** Where it happened (the map's name). */
  where: string;
  /** Each kill: seconds into the play (after the title's hold), and how. */
  kills: { t: number; headshot: boolean; through: boolean; victim: string }[];
  /** Seconds the title holds the first frame. */
  hold: number;
}

interface Kill {
  at: number;
  victim: string;
  weapon: string | undefined;
  headshot: boolean;
  through: boolean;
  far: boolean;
  /** The streak it ended. */
  stopped: number;
}

interface Play {
  killer: Player;
  color: string;
  kills: Kill[];
  /** When the killer last spawned (the game's clock): it starts no earlier. */
  spawned: number;
}

interface Best {
  score: number;
  play: Play;
  clip: ReplayClip;
}

const NUMBERS = ['ZERO', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN'];

/** A play's name, from how many it got and how. */
function titleOf(kills: Kill[]): string {
  const n = kills.length;
  if (n >= 5) return 'THE MASSACRE';
  if (n === 4) return 'FOUR OF A KIND';
  if (n === 3) return 'TRIPLE FEATURE';
  if (n === 2) return 'DOUBLE FEATURE';
  const k = kills[0];
  if (k.headshot && k.through) return 'KNOCK KNOCK';
  if (k.through) return 'THROUGH THE WALL';
  if (k.far && k.headshot) return 'THE LONG GOODBYE';
  if (k.far) return 'THE LONG SHOT';
  if (k.headshot) return 'BETWEEN THE EYES';
  if (k.weapon === 'katana') return 'SHARP DRESSED';
  if (k.weapon && LETHALS[k.weapon]) return 'SPECIAL DELIVERY';
  if (k.stopped >= 3) return 'THE CLOSER';
  return 'THE HIT';
}

function scoreOf(p: Play): number {
  let sum = 0;
  for (const k of p.kills) {
    sum += 100;
    if (k.headshot) sum += 40;
    if (k.through) sum += 60;
    if (k.far) sum += 40;
    if (k.weapon === 'katana') sum += 50;
    else if (k.weapon && LETHALS[k.weapon]) sum += 30;
    if (k.stopped >= 3) sum += 30;
  }
  const multi = sum * (1 + 0.5 * (p.kills.length - 1));
  return p.killer.bot ? multi * 0.6 : multi;
}

export class PlayOfTheGame {
  /** Plays going on now, by the killer's id. */
  private open = new Map<string, Play>();
  private best: Best | null = null;

  constructor(private game: GameContext) {}

  /** A new match: nothing yet. */
  reset() {
    this.open.clear();
    this.best = null;
  }

  /** There's a play to show, or one going on that will be. */
  get any(): boolean {
    return !!this.best || this.open.size > 0;
  }

  /** A kill (by someone, not by a killstreak): it starts a play, or adds to theirs. */
  kill(killer: Player, victim: Player, o: { weapon: string | undefined; headshot: boolean; through: boolean; stopped: number; color: string; spawned: number }) {
    const now = this.game.clock.now;
    const a = killer.position;
    const b = victim.position;
    const kill: Kill = { at: now, victim: victim.name, weapon: o.weapon, headshot: o.headshot, through: o.through, far: Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) >= LONG, stopped: o.stopped };
    const play = this.open.get(killer.id);
    if (play && now - play.kills[play.kills.length - 1].at <= GAP) {
      play.kills.push(kill);
      play.color = o.color;
      return;
    }
    // (A play of theirs that's over but not judged yet: judged now, before the new one.)
    if (play) this.judge(play);
    this.open.set(killer.id, { killer, color: o.color, kills: [kill], spawned: o.spawned });
  }

  /** Each step: plays that are over are judged. */
  update() {
    const now = this.game.clock.now;
    for (const play of [...this.open.values()]) if (now - play.kills[play.kills.length - 1].at >= Math.max(AFTER, GAP)) this.judge(play);
  }

  /** Roughly how long it will play for (the title and the clip), for the countdown before it's clipped. */
  estimate(): number {
    const len = (p: Play) => Math.min(MAX_CLIP, p.kills[p.kills.length - 1].at + AFTER - Math.max(p.kills[0].at - BEFORE, p.spawned + 0.2));
    const plays = [...this.open.values()];
    const all = [...(this.best ? [this.best.clip.seconds] : []), ...plays.map(len)];
    return all.length ? POTG_HOLD + Math.max(...all) : 0;
  }

  /**
   * The match is over: plays still open are judged (it's `AFTER` seconds on, at least), and the
   * best is shown to `people`. Seconds it plays for (0: there's none, or none of them could see it).
   */
  show(people: Player[], where: string): number {
    for (const play of [...this.open.values()]) this.judge(play);
    const best = this.best;
    if (!best) return 0;
    const { play, clip } = best;
    const data: PotgData = {
      name: play.killer.name,
      color: play.color,
      bot: play.killer.bot,
      chapter: `CHAPTER ${NUMBERS[Math.min(10, play.kills.length)]}`,
      title: titleOf(play.kills),
      weapon: weaponOf(play) ? weaponName(weaponOf(play)!) : null,
      icon: weaponOf(play) ? feedIcon(weaponOf(play)!) : null,
      where: where.toUpperCase(),
      kills: play.kills.map((k) => ({ t: Math.max(0, k.at - clip.from), headshot: k.headshot, through: k.through, victim: k.victim })),
      hold: POTG_HOLD,
    };
    let duration = 0;
    for (const p of people) {
      const shown = this.game.replay.show(p, { clip, follow: play.killer, hold: POTG_HOLD, label: 'potg', data });
      if (shown) duration = Math.max(duration, shown.duration);
    }
    return duration;
  }

  /** A play is over: if it's the best yet, it's clipped now, while the history still has it. */
  private judge(play: Play) {
    this.open.delete(play.killer.id);
    // (Nobody here to see it: no clip.)
    if (!this.game.players.some((p) => !p.bot)) return;
    const score = scoreOf(play);
    if (this.best && score < this.best.score) return;
    const first = play.kills[0].at;
    const last = play.kills[play.kills.length - 1].at;
    const now = this.game.clock.now;
    const to = Math.min(now, last + AFTER);
    const from = Math.max(first - BEFORE, play.spawned + 0.2, to - MAX_CLIP);
    const clip = this.game.replay.clip({ from: { at: from }, seconds: to - from });
    if (clip) this.best = { score, play, clip };
  }
}

/** The weapon a play was made with: its last kill's. */
function weaponOf(p: Play): string | undefined {
  return p.kills[p.kills.length - 1].weapon;
}
