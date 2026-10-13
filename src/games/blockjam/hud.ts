import type { GameContext as Game } from '@platform';
import { allBallers, type Match } from './match';

/**
 * The HUD (server side): the scoreboard across the top (the teams, the score, the quarter, the
 * clock, the shot clock, who has the ball), each player's turbo meter (bound to their own screen's
 * state, so it drains the moment they boost), and the box score on Tab (kept up at the final
 * buzzer).
 */

export function defineHud(game: Game) {
  game.hud.define('jam-board', {
    at: 'top',
    html: `
      <div class="board">
        <div class="team left" style="--c: {{a.color}}">
          <span class="poss" data-if="poss == 0">◀</span>
          <span class="abbr">{{a.abbr}}</span><span class="score">{{a.score}}</span>
        </div>
        <div class="mid">
          <div class="q">{{quarter}}</div>
          <div class="clock">{{clock}}</div>
          <div class="shot {{shotWarn}}">{{shot}}</div>
        </div>
        <div class="team right" style="--c: {{b.color}}">
          <span class="score">{{b.score}}</span><span class="abbr">{{b.abbr}}</span>
          <span class="poss" data-if="poss == 1">▶</span>
        </div>
      </div>`,
    css: `
      :scope { margin-top: 4px }
      .board { display: flex; align-items: stretch; filter: drop-shadow(0 6px 0 #0008); transform: skewX(-8deg) }
      .team { display: flex; align-items: center; gap: 10px; padding: 6px 16px; background: var(--c); color: #fff;
        font-family: var(--pixel); text-shadow: 0 2px 0 #0007 }
      .team.left { border-radius: 10px 0 0 10px }
      .team.right { border-radius: 0 10px 10px 0 }
      .abbr { font-size: 18px; letter-spacing: 0.04em }
      .score { font-size: 34px; min-width: 52px; text-align: center; background: #0b0d14cc; border-radius: 6px; padding: 0 6px;
        font-variant-numeric: tabular-nums }
      .poss { font-size: 14px; color: #ffd23f; text-shadow: 0 0 8px #ffd23f }
      .mid { display: flex; flex-direction: column; align-items: center; justify-content: center; min-width: 96px; padding: 3px 12px;
        background: #0b0d14; color: #fff; font-family: var(--sans); font-weight: 700 }
      .q { font-size: 11px; letter-spacing: 0.18em; color: #ffd23f }
      .clock { font-family: var(--pixel); font-size: 22px; line-height: 1; font-variant-numeric: tabular-nums }
      .shot { font-size: 12px; color: #9aa4b5; font-variant-numeric: tabular-nums }
      .shot.warn { color: #ff3b30; animation: blink 0.5s steps(2) infinite }
      @keyframes blink { 50% { opacity: 0.35 } }`,
  });
  game.hud.define('jam-turbo', {
    at: 'bottom-left',
    html: `
      <div class="turbo {{fire}}">
        <div class="label">TURBO</div>
        <div class="track"><div class="fill" style="--t: {{$ability.jam.turbo}}"></div></div>
      </div>`,
    css: `
      .turbo { display: flex; align-items: center; gap: 10px; padding: 6px 12px; background: #0b0d14b8; border-radius: 10px;
        transform: skewX(-8deg) }
      .label { font-family: var(--pixel); font-size: 14px; color: #fff; letter-spacing: 0.06em }
      .track { width: 180px; height: 14px; border-radius: 7px; background: #ffffff1f; overflow: hidden }
      .fill { height: 100%; width: calc(var(--t) * 100%); background: linear-gradient(90deg, #ffd23f, #ff6b1a); border-radius: 7px }
      .turbo.on .fill { background: linear-gradient(90deg, #ff3b30, #ffd23f, #ff3b30); background-size: 200% 100%;
        animation: burn 0.6s linear infinite }
      .turbo.on .label { color: #ff6b1a; text-shadow: 0 0 10px #ff6b1a }
      @keyframes burn { to { background-position: 200% 0 } }`,
  });
}

const fmt = (s: number) => {
  const t = Math.ceil(s);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};


export function showHud(game: Game, m: Match) {
  const [a, b] = m.teams;
  const holder = m.ball.mode === 'held' ? m.ball.holder : null;
  const poss = holder ? holder.team.index : -1;
  game.hud.widget('jam-board', {
    a: { abbr: a.def.abbr, color: a.def.color, score: a.score },
    b: { abbr: b.def.abbr, color: b.def.color, score: b.score },
    quarter: m.quarter <= 4 ? ['', '1ST', '2ND', '3RD', '4TH'][m.quarter] : 'OT',
    clock: fmt(m.clock),
    shot: Math.ceil(m.shotClock),
    shotWarn: m.shotClock <= 5 && m.phase === 'live' ? 'warn' : '',
    poss,
  });
  for (const x of allBallers(m)) {
    if (x.player.bot) continue;
    // (Kept per baller, not per player: the first player's place is the same player for whoever
    // takes it next, and a new person needs the meter sent.)
    const fire = x.fireMakes > 0 || x.streak >= 3 ? 'on' : '';
    if (x.turboShown !== fire) {
      x.player.hud.widget('jam-turbo', { fire });
      x.turboShown = fire;
    }
  }
  // The box score (Tab; kept up once the game's over).
  const rows = allBallers(m).map((x) => ({
    player: x.player,
    name: x.player.name,
    color: x.team.def.color,
    values: [x.team.def.abbr, x.pts, x.reb, x.ast, x.stl, x.blk, x.dunks],
  }));
  if (m.phase === 'over' || game.clock.now % 1 < 0.04) {
    game.hud.scoreboard({
      title: `${a.def.city} ${a.def.name} ${a.score} · ${b.score} ${b.def.city} ${b.def.name}`,
      columns: ['Team', 'PTS', 'REB', 'AST', 'STL', 'BLK', 'DNK'],
      rows,
      show: m.phase === 'over',
    });
  }
}

/** A new game: (each baller is new, so the turbo meters go up afresh). */
export function resetHud() {}
