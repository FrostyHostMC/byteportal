import type { GameContext, WidgetData } from '@platform';
import { CLASSES } from './classes';
import { END_SCREEN, INTRO_MSG, INTRO_TIME, type EndCard, type IntroMessage } from './framing';
import { HEROES } from './heroes/defs';
import type { MapSpec } from './map';
import { match, type Fighter } from './match';
import { TEAMS, type Team } from './teams';

/**
 * The match's framing on the server (`server.ts` calls these at its marked places):
 *
 * - **The opening fly-over.** At a match's start everyone's held still, weapons locked, while every
 *   screen flies over the map (`client/intro.ts`, on `INTRO_MSG`) and comes down to its player;
 *   then they're let go (and the clock starts). Someone arriving mid-match gets a shorter one on
 *   their screen as they go in (once they close the deploy menu), skippable, and isn't held. Bots
 *   have no screen: they're only held with everyone.
 * - **The end screen** (`framing.ts`'s `END_SCREEN`): each player's own, filled in when the match
 *   ends, its countdown ticked each second until the next.
 */

/** How long everyone's held at a match's start (the sweep, and the ease down to their own view). */
export const INTRO_HOLD = INTRO_TIME.full + INTRO_TIME.ease;

/** Until when the opening fly-over holds everyone (0: it's not on). */
let introUntil = 0;
/** Joiners whose own fly-over waits for them to close the deploy menu (by player id). */
const joining = new Set<string>();
/** Each player's end screen as it is (its countdown's ticked). */
const ends = new Map<string, WidgetData>();

export function setupCinema(game: GameContext) {
  game.hud.define('end', END_SCREEN);
  introUntil = 0;
  joining.clear();
  ends.clear();
}

type Key = IntroMessage['keys'][number];
const p3 = (v: { x: number; y: number; z: number }): [number, number, number] => [Math.round(v.x * 10) / 10, Math.round(v.y * 10) / 10, Math.round(v.z * 10) / 10];

/**
 * The fly-over's keyframes for a side: the map's (from the Rebels' end to the Empire's), or, for a
 * map without its own, one over each post in turn from high over its side; turned round for the
 * Rebels, so everyone's ends over their own end of the map.
 */
function keysFor(map: MapSpec, team: Team): Key[] {
  const own = map.intro?.map((k) => ({ at: p3(k.at), look: p3(k.look) }));
  const keys: Key[] =
    own ??
    map.posts.map((p) => ({
      at: p3({ x: p.at.x, y: p.at.y + 26, z: p.at.z + 34 }),
      look: p3(p.at),
    }));
  return team === 0 ? [...keys].reverse() : keys;
}

function intro(f: Fighter, full: boolean): IntroMessage {
  const t = TEAMS[f.team];
  return {
    keys: keysFor(match.map, f.team),
    time: full ? INTRO_TIME.full : INTRO_TIME.short,
    full,
    title: match.map.name.toUpperCase(),
    mode: match.mode.name.toUpperCase(),
    line: match.mode.posts ? match.map.blurb : match.mode.goal,
    side: `For the ${t.name}`,
    color: t.color,
  };
}

/** A match starts (after everyone's spawned): hold them all, and fly every screen over the map. */
export function startIntro(game: GameContext) {
  introUntil = game.clock.now + INTRO_HOLD;
  joining.clear();
  ends.clear();
  for (const f of match.fighters.values()) {
    f.player.freeze(true, { weapons: true });
    if (!f.player.bot) game.clients.send(f.player, INTRO_MSG, intro(f, true));
  }
}

/**
 * Every tick: whether the opening fly-over is on (once it's over, everyone's let go, and it
 * isn't); and a joiner who's closed the deploy menu, in the fight, gets their own.
 */
export function introOn(game: GameContext): boolean {
  for (const id of joining) {
    const f = match.fighters.get(id);
    if (!f || match.phase !== 'playing') joining.delete(id);
    else if (!f.menu?.open && f.player.alive) {
      joining.delete(id);
      game.clients.send(f.player, INTRO_MSG, intro(f, false));
    }
  }
  if (!introUntil) return false;
  if (game.clock.now < introUntil) return true;
  introUntil = 0;
  for (const f of match.fighters.values()) if (f.player.alive) f.player.freeze(false);
  return false;
}

/**
 * Someone's screen is ready mid-match: their own shorter fly-over once they've closed the deploy
 * menu (it opens as they arrive); during the opening one, held with everyone and shown it whole.
 */
export function joinIntro(game: GameContext, f: Fighter) {
  if (f.player.bot) return;
  if (introUntil) {
    f.player.freeze(true, { weapons: true });
    game.clients.send(f.player, INTRO_MSG, intro(f, true));
  } else joining.add(f.player.id);
}

/**
 * The match is over (`winner`'s): everyone's end screen. `next` is the next match's mode and map,
 * `left` the seconds until it, and `alltime` each player's record line (by player id).
 */
export function showEnd(winner: Team, next: { mode: string; map: string }, left: number, alltime: Map<string, string>) {
  const all = [...match.fighters.values()];
  const ranked = [...all].sort((a, b) => b.score - a.score || b.kills - a.kills || a.deaths - b.deaths);
  const role = (f: Fighter) => (f.hero ? HEROES[f.hero].name : CLASSES[f.cls].name);
  const [a, b] = TEAMS;
  for (const f of all) {
    if (f.player.bot) continue;
    const won = f.team === winner;
    const top: EndCard[] = ranked.slice(0, 3).map((o, i) => ({
      rank: i + 1,
      name: o.player.name,
      side: TEAMS[o.team].short,
      color: TEAMS[o.team].color,
      role: role(o),
      kills: o.kills,
      captures: o.captures,
      score: o.score,
      you: o === f,
    }));
    const data: WidgetData = {
      result: won ? 'victory' : 'defeat',
      resultText: won ? 'VICTORY' : 'DEFEAT',
      color: TEAMS[winner].color,
      mode: match.mode.name,
      map: match.map.name,
      headline: `The ${TEAMS[winner].name} take ${match.map.name}`,
      a: { name: a.short, color: a.color, tickets: match.tickets[0] },
      b: { name: b.short, color: b.color, tickets: match.tickets[1] },
      top,
      me: {
        color: TEAMS[f.team].color,
        place: ranked.indexOf(f) + 1,
        of: ranked.length,
        kills: f.kills,
        deaths: f.deaths,
        captures: f.captures,
        earned: f.earned,
        heroes: f.heroesPlayed.length ? f.heroesPlayed.map((id) => HEROES[id].name).join(', ') : 'None',
        alltime: alltime.get(f.player.id) ?? '',
      },
      next: { ...next, in: Math.max(0, Math.ceil(left)) },
    };
    ends.set(f.player.id, data);
    f.player.hud.widget('end', data);
  }
}

/** The countdown to the next match on everyone's end screen. */
export function tickEnd(left: number) {
  for (const f of match.fighters.values()) {
    const data = ends.get(f.player.id);
    if (!data || f.player.bot) continue;
    const next = { ...(data.next as Record<string, unknown>), in: Math.max(0, Math.ceil(left)) };
    const now = { ...data, next };
    ends.set(f.player.id, now);
    f.player.hud.widget('end', now);
  }
}
