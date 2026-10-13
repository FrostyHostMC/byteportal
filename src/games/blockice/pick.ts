import type { GameContext as Game, Player } from '@platform';
import { LEVEL_ORDER, LEVELS, type LevelId } from './levels';
import { hasPeople, type Match, type Team } from './match';
import { TEAMS, type TeamDef } from './teams';

/**
 * The team screen (M, and as a person comes in): the four teams as sweaters, who's on the two
 * playing now (people, bots, you), and the bots' level. Picking a team in the game joins it (a bot
 * gives way); picking one that isn't takes over a side nobody else plays on, in its colours. The
 * first person in starts a new game for their team. "Just watch" leaves the ice to the bots.
 */

export const PICK = 'ice-pick';

export function definePick(game: Game, on: { team(p: Player, id: string): void; level(p: Player, id: string): void; watch(p: Player): void; close(p: Player): void }) {
  game.hud.define(PICK, {
    at: 'center',
    modal: true,
    html: `
      <div class="pick">
        <div class="hd">
          <span class="title">CHOOSE YOUR TEAM</span>
          <span class="live">{{live}}</span>
        </div>
        <div class="teams">
          <button data-each="teams" data-action="team" data-value="{{id}}" class="card {{state}}" style="--c: {{color}}; --k: {{trim}}; --s: {{pants}}">
            <span class="tag">{{tag}}</span>
            <span class="jersey"><b>{{abbr}}</b></span>
            <span class="city">{{city}}</span>
            <span class="name">{{name}}</span>
            <span class="roster"><i data-each="roster" class="who {{kind}}">{{name}}</i></span>
            <span class="go">{{go}}</span>
          </button>
        </div>
        <div class="levels">
          <span class="lbl">BOTS</span>
          <button data-each="levels" data-action="level" data-value="{{id}}" class="lvl {{on}}"><b>{{name}}</b><small>{{blurb}}</small></button>
        </div>
        <div class="foot">
          <span class="hint">{{hint}}</span>
          <button data-action="watch" class="watch {{watching}}">Just watch</button>
        </div>
      </div>`,
    css: `
      .pick { width: min(760px, 94vw); padding: 18px 22px 16px; background: linear-gradient(180deg, #161a2a, #0b0d14); color: #fff;
        border: 3px solid #ffffff22; border-radius: 16px; box-shadow: 0 16px 0 #0008, 0 0 60px #3fa9f533; font-family: var(--sans) }
      .hd { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 14px }
      .title { font-family: var(--pixel); font-size: 30px; font-style: italic; letter-spacing: 0.02em; color: #ffd23f;
        text-shadow: 0 4px 0 #0b0d14, 0 0 24px #3fa9f588; transform: skewX(-8deg) }
      .live { font-weight: 700; font-size: 14px; letter-spacing: 0.1em; text-transform: uppercase; color: #9aa4b5 }
      .teams { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px }
      .card { position: relative; display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 10px 8px 10px;
        background: #ffffff0d; border: 2px solid #ffffff1f; border-radius: 12px; color: #fff; font: inherit; cursor: pointer;
        transition: transform 0.08s, background 0.08s }
      .card:hover, .card:focus-visible { background: #ffffff1c; transform: translateY(-3px); outline: none; border-color: var(--c) }
      .card.mine { border-color: #ffd23f; background: #ffd23f1a; box-shadow: 0 0 0 2px #ffd23f55, 0 0 22px #ffd23f33 }
      .card.full, .card.locked { opacity: 0.45 }
      .tag { position: absolute; top: 6px; left: 8px; font-weight: 700; font-size: 11px; letter-spacing: 0.14em; color: #9aa4b5 }
      .card.mine .tag, .card.in .tag, .card.full .tag { color: #fff }
      .jersey { display: grid; place-items: center; width: 84px; height: 74px; margin: 8px 0 4px;
        background: linear-gradient(180deg, var(--c) 0 68%, var(--k) 68% 76%, var(--c) 76% 84%, var(--k) 84% 90%, var(--c) 90%);
        clip-path: polygon(36% 0, 64% 0, 82% 6%, 100% 26%, 100% 50%, 84% 50%, 84% 100%, 16% 100%, 16% 50%, 0 50%, 0 26%, 18% 6%) }
      .jersey b { margin-top: -6px; font-family: var(--pixel); font-size: 17px; color: var(--k); text-shadow: 0 2px 0 #0005 }
      .city { font-weight: 500; font-size: 13px; letter-spacing: 0.08em; text-transform: uppercase; color: #c9d0dc }
      .name { font-family: var(--pixel); font-size: 19px; line-height: 1.1; font-style: italic }
      .roster { display: flex; flex-direction: column; align-items: center; min-height: 36px; margin-top: 4px }
      .who { font-style: normal; font-size: 13px; line-height: 18px; white-space: nowrap; max-width: 150px; overflow: hidden; text-overflow: ellipsis }
      .who.bot { color: #8a93a6 }
      .who.person { color: #fff; font-weight: 700 }
      .who.me { color: #ffd23f; font-weight: 700 }
      .who.none { color: #5d6578 }
      .go { margin-top: 6px; padding: 3px 12px; border-radius: 6px; background: var(--c); font-family: var(--pixel); font-size: 13px;
        letter-spacing: 0.04em; transform: skewX(-8deg); box-shadow: 0 3px 0 #0b0d14 }
      .card.mine .go { background: #ffd23f; color: #0b0d14 }
      .card.full .go, .card.locked .go { background: #3a3f50 }
      .levels { display: flex; align-items: stretch; gap: 8px; margin-top: 14px }
      .lbl { align-self: center; width: 52px; font-family: var(--pixel); font-size: 15px; color: #9aa4b5 }
      .lvl { flex: 1; display: flex; flex-direction: column; align-items: center; padding: 6px 8px; background: #ffffff0d; color: #fff;
        border: 2px solid #ffffff1f; border-radius: 10px; font: inherit; cursor: pointer }
      .lvl b { font-family: var(--pixel); font-size: 15px; font-weight: 400 }
      .lvl small { font-size: 12px; color: #9aa4b5 }
      .lvl:hover, .lvl:focus-visible { background: #ffffff1c; outline: none }
      .lvl.on { border-color: #3fa9f5; background: #3fa9f526 }
      .lvl.on small { color: #bfe6ff }
      .foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 12px }
      .hint { font-size: 13px; color: #9aa4b5 }
      .watch { padding: 5px 14px; background: transparent; color: #c9d0dc; border: 2px solid #ffffff2a; border-radius: 8px; font: 700 13px var(--sans);
        letter-spacing: 0.06em; text-transform: uppercase; cursor: pointer }
      .watch:hover, .watch:focus-visible { background: #ffffff14; outline: none }
      .watch.on { border-color: #ffd23f; color: #ffd23f }`,
    actions: {
      team: (p, v) => on.team(p, String(v)),
      level: (p, v) => on.level(p, String(v)),
      watch: (p) => on.watch(p),
    },
    onClose: (p) => on.close(p),
  });
}

/** What the screen shows a player: the teams as they stand, the level, where they are. */
export function pickData(m: Match, me: Player, opts: { watching: boolean; perTeam: number }) {
  const mine = m.teams.find((t) => t.skaters.some((b) => b.player === me));
  const people = (t: Team) => t.skaters.filter((b) => !b.player.bot && b.player !== me).length;
  /** A side someone else's not playing on (a team not in the game can take it over). */
  const free = m.teams.some((t) => !hasPeople(t) || (t === mine && people(t) === 0));
  // Nobody else playing: any pick starts a new game, each team with its own bench.
  const playing = m.teams.some((t) => t.skaters.some((b) => !b.player.bot && b.player !== me));
  const card = (def: TeamDef) => {
    if (!playing && !mine) {
      const roster = def.bench.slice(0, 2).map((x) => ({ name: x.name, kind: 'bot' }));
      return { id: def.id, city: def.city, name: def.name, abbr: def.abbr, color: def.color, trim: def.trim, pants: def.pants, tag: '', roster, state: 'in', go: 'PLAY' };
    }
    const t = m.teams.find((x) => x.def === def);
    const roster = t
      ? t.skaters.map((b) => ({ name: b.player === me ? 'You' : b.player.name, kind: b.player === me ? 'me' : b.player.bot ? 'bot' : 'person' }))
      : [{ name: 'On the bench', kind: 'none' }];
    let state: string;
    let go: string;
    if (t && t === mine) [state, go] = ['mine', 'YOUR TEAM'];
    else if (t && people(t) >= opts.perTeam) [state, go] = ['full', 'FULL'];
    else if (t) [state, go] = ['in', 'JOIN'];
    else if (free) [state, go] = ['bench', 'PLAY AS'];
    else [state, go] = ['locked', 'TAKEN'];
    return { id: def.id, city: def.city, name: def.name, abbr: def.abbr, color: def.color, trim: def.trim, pants: def.pants, tag: t ? (t.index === 0 ? 'HOME' : 'AWAY') : '', roster, state, go };
  };
  const [a, b] = m.teams;
  const q = m.period <= 3 ? `P${m.period}` : 'OT';
  return {
    live: playing || mine ? `${a.def.abbr} ${a.score} – ${b.score} ${b.def.abbr} · ${q}` : 'Pick a team: a new game drops the puck',
    teams: TEAMS.map(card),
    levels: LEVEL_ORDER.map((id: LevelId) => ({ id, name: LEVELS[id].name, blurb: LEVELS[id].blurb, on: id === m.level ? 'on' : '' })),
    hint: mine ? 'M brings this back · Esc to play' : opts.watching ? 'Watching · pick a team to play' : 'Esc: wherever there’s room',
    watching: opts.watching ? 'on' : '',
  };
}
