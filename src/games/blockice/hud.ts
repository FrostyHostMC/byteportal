import type { GameContext as Game } from '@platform';
import { everyone, type Match } from './match';

/**
 * The HUD (server side): the scoreboard across the top (the teams, the score, the period, the
 * clock, who has the puck), each player's turbo meter and shot meter (bound to their own screen's
 * state, so they move the moment they do), and the box score on Tab (kept up at the final horn).
 */

export function defineHud(game: Game) {
  game.hud.define('ice-board', {
    at: 'top',
    html: `
      <div class="board">
        <div class="team left" style="--c: {{a.color}}">
          <span class="poss" data-if="poss == 0">◀</span>
          <span class="abbr">{{a.abbr}}</span><span class="score">{{a.score}}</span>
        </div>
        <div class="mid">
          <div class="q">{{period}}</div>
          <div class="clock">{{clock}}</div>
          <div class="sog">SOG {{a.shots}}–{{b.shots}}</div>
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
      .score { font-size: 34px; min-width: 46px; text-align: center; background: #0b0d14cc; border-radius: 6px; padding: 0 6px;
        font-variant-numeric: tabular-nums }
      .poss { font-size: 14px; color: #ffd23f; text-shadow: 0 0 8px #ffd23f }
      .mid { display: flex; flex-direction: column; align-items: center; justify-content: center; min-width: 96px; padding: 3px 12px;
        background: #0b0d14; color: #fff; font-family: var(--sans); font-weight: 700 }
      .q { font-size: 11px; letter-spacing: 0.18em; color: #7fd0ff }
      .clock { font-family: var(--pixel); font-size: 22px; line-height: 1; font-variant-numeric: tabular-nums }
      .sog { font-size: 11px; color: #9aa4b5; letter-spacing: 0.08em; font-variant-numeric: tabular-nums }`,
  });
  game.hud.define('ice-turbo', {
    at: 'bottom-left',
    html: `
      <div class="meters">
        <div class="turbo {{fire}}">
          <div class="label">TURBO</div>
          <div class="track"><div class="fill" style="--t: {{$ability.skate.turbo}}"></div></div>
        </div>
        <div class="power" data-if="$ability.skate.wind > 0">
          <div class="label">SHOT</div>
          <div class="track"><div class="fill" style="--t: {{$ability.skate.wind}}"></div></div>
        </div>
      </div>`,
    css: `
      .meters { display: flex; flex-direction: column; gap: 6px }
      .turbo, .power { display: flex; align-items: center; gap: 10px; padding: 6px 12px; background: #0b0d14b8; border-radius: 10px;
        transform: skewX(-8deg) }
      .label { width: 64px; font-family: var(--pixel); font-size: 14px; color: #fff; letter-spacing: 0.06em }
      .track { width: 180px; height: 14px; border-radius: 7px; background: #ffffff1f; overflow: hidden }
      .fill { height: 100%; width: calc(var(--t) * 100%); background: linear-gradient(90deg, #7fd0ff, #3fa9f5); border-radius: 7px }
      .power .fill { background: linear-gradient(90deg, #ffd23f, #ff7a1a, #ff3b30) }
      .turbo.on .fill { background: linear-gradient(90deg, #ff3b30, #ffd23f, #ff3b30); background-size: 200% 100%;
        animation: burn 0.6s linear infinite }
      .turbo.on .label { color: #ff7a1a; text-shadow: 0 0 10px #ff7a1a }
      @keyframes burn { to { background-position: 200% 0 } }`,
  });
}

const fmt = (s: number) => {
  const t = Math.ceil(s);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

export function showHud(game: Game, m: Match) {
  const [a, b] = m.teams;
  const holder = m.puck.mode === 'held' ? m.puck.holder : null;
  const poss = holder && !holder.goalie ? holder.team.index : -1;
  game.hud.widget('ice-board', {
    a: { abbr: a.def.abbr, color: a.def.color, score: a.score, shots: a.shots },
    b: { abbr: b.def.abbr, color: b.def.color, score: b.score, shots: b.shots },
    period: m.period <= 3 ? ['', '1ST', '2ND', '3RD'][m.period] : 'OT',
    clock: m.period <= 3 ? fmt(m.clock) : 'SUDDEN DEATH',
    poss,
  });
  for (const x of everyone(m)) {
    if (x.player.bot) continue;
    const fire = x.fireMakes > 0 || x.streak >= 3 ? 'on' : '';
    if (x.turboShown !== fire) {
      x.player.hud.widget('ice-turbo', { fire });
      x.turboShown = fire;
    }
  }
  // The box score (Tab; kept up once the game's over).
  if (m.phase === 'over' || game.clock.now % 1 < 0.04) {
    const rows = everyone(m).map((x) => ({
      player: x.player,
      name: x.goalie ? `${x.player.name} (G)` : x.player.name,
      color: x.team.def.color,
      values: [x.team.def.abbr, x.g, x.a, x.g + x.a, x.sog, x.hits, x.stl, x.goalie ? x.saves : '–'],
    }));
    game.hud.scoreboard({
      title: `${a.def.city} ${a.def.name} ${a.score} · ${b.score} ${b.def.city} ${b.def.name}`,
      columns: ['Team', 'G', 'A', 'PTS', 'SOG', 'HITS', 'STL', 'SV'],
      rows,
      show: m.phase === 'over',
    });
  }
}
