import type { WidgetDefinition } from '@platform';

/**
 * Each fighter's corner of the screen (top right), a HUD widget of the game's own: in a
 * free-for-all their kills, their place and the leader; in a team mode their side, their kills
 * and score (and the case, while they carry it); always their streak toward the killstreaks
 * they've picked (each one's card marked), how long a UAV, a Counter-UAV or an Adrenaline Shot
 * has left, whether the other side has their radar jammed, and which streak's ready to call in
 * (5). The markup and styles are here;
 * `personalHud` fills it in every tick with `player.hud.widget('dossier', data)`, and only what
 * changed goes to their screen. It's inked on paper like the rest of the HUD, from the theme's
 * colours.
 */
export const DOSSIER: WidgetDefinition = {
  at: 'top-right',
  html: `
    <div class="group" data-if="ffa">
      <div class="chip"><span class="label">Kills</span><span class="value">{{kills}} / {{limit}}</span></div>
      <div class="chip"><span class="label">Place</span><span class="value">{{place}} of {{fighters}}</span></div>
      <div class="chip" data-if="leading"><span class="label">Leading by</span><span class="value">{{margin}}</span></div>
      <div class="chip" data-if="!leading"><span class="label">Leader</span><span class="value">{{leader}} · {{leaderKills}}</span></div>
    </div>
    <div class="group" data-if="!ffa">
      <div class="chip side" style="--c: {{teamColor}}"><span class="label">{{role}}</span><span class="value">{{teamName}}</span></div>
      <div class="chip"><span class="label">Kills</span><span class="value">{{kills}}</span><span class="label">Score</span><span class="value">{{score}}</span></div>
    </div>
    <div class="perk case" data-if="carrier"><span class="perk-name">The case</span><span class="perk-time">{{carrier}}</span></div>
    <div class="chip streak">
      <span class="label">Streak</span>
      <span class="pips {{pipsClass}}"><i data-each="pips" class="pip {{.}}"></i></span>
      <span class="value more" data-if="extra > 0">+{{extra}}</span>
    </div>
    <div class="perk ready" data-if="ready"><span class="perk-key">5</span><span class="perk-name">{{ready}}</span><span class="perk-time">Ready</span></div>
    <div class="perk uav" data-if="uav > 0" style="--left: {{uav}}; --of: {{uavFor}}">
      <span class="perk-name">UAV</span><span class="perk-bar"><span></span></span><span class="perk-time">{{uav}}s</span>
    </div>
    <div class="perk counter" data-if="counter > 0" style="--left: {{counter}}; --of: {{counterFor}}">
      <span class="perk-name">Counter-UAV</span><span class="perk-bar"><span></span></span><span class="perk-time">{{counter}}s</span>
    </div>
    <div class="perk rush" data-if="rush > 0" style="--left: {{rush}}; --of: {{rushFor}}">
      <span class="perk-name">Adrenaline</span><span class="perk-bar"><span></span></span><span class="perk-time">{{rush}}s</span>
    </div>
    <div class="perk jammed" data-if="jammed"><span class="perk-name">Radar jammed</span></div>`,
  css: `
    /* Where the platform's stat chips were: under the frame counter. */
    :scope {
      margin: 16px -6px 0 0;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 6px;
    }
    .group {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 6px;
    }
    .chip {
      display: flex;
      gap: 10px;
      align-items: baseline;
      padding: 6px 12px;
      background: var(--hud-paper, #fdf1d6);
      color: var(--hud-fg, #111);
      border: 3px solid var(--hud-ink, #111);
      border-radius: 4px;
      box-shadow: 6px 6px 0 var(--hud-ink, #111);
    }
    /* Their side: a stripe of its colour down the left. */
    .chip.side {
      border-left: 12px solid var(--c);
    }
    .label {
      font: 600 10px var(--sans);
      text-transform: uppercase;
      letter-spacing: 0.1em;
      opacity: 0.7;
    }
    .value {
      font: 700 20px var(--pixel);
      font-variant-numeric: tabular-nums;
    }
    /* The streak: a card a kill, each killstreak's card striped in its colour. */
    .streak {
      align-items: center;
    }
    .pips {
      display: flex;
      gap: 5px;
    }
    .pip {
      width: 13px;
      height: 16px;
      border: 2px solid var(--hud-ink, #111);
      transform: skewX(-10deg);
      background: rgba(0, 0, 0, 0.08);
    }
    .pip.uav:not(.on) {
      background: repeating-linear-gradient(45deg, #ff5c8a 0 2px, transparent 2px 5px);
    }
    .pip.rush:not(.on) {
      background: repeating-linear-gradient(45deg, var(--hud-danger, #e63946) 0 2px, transparent 2px 5px);
    }
    .pip.counter:not(.on) {
      background: repeating-linear-gradient(45deg, #1fa3a0 0 2px, transparent 2px 5px);
    }
    .pip.mortar:not(.on) {
      background: repeating-linear-gradient(-45deg, var(--hud-danger, #e63946) 0 2px, #111 2px 5px);
    }
    .pip.hellstorm:not(.on) {
      background: repeating-linear-gradient(45deg, #ff8c1a 0 2px, transparent 2px 5px);
    }
    .pip.chopper:not(.on) {
      background: repeating-linear-gradient(-45deg, #111 0 2px, var(--hud-accent, #ffcc00) 2px 5px);
    }
    /* A long streak's cards are a little smaller (ten in a row fit). */
    .pips.long .pip {
      width: 10px;
    }
    .pip.on {
      background: var(--hud-accent, #ffcc00);
      animation: pip-in 260ms cubic-bezier(0.3, 1.8, 0.5, 1);
    }
    .more {
      font-size: 16px;
    }
    /* A streak reward running: a black tag, its colour, the time draining. */
    .perk {
      --c: var(--hud-accent, #ffcc00);
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 5px 10px;
      background: var(--hud-ink, #111);
      color: #fff;
      border-radius: 4px;
      box-shadow: 4px 4px 0 rgba(0, 0, 0, 0.35);
      animation: perk-in 320ms cubic-bezier(0.3, 1.8, 0.5, 1);
    }
    .perk.uav {
      --c: #ff5c8a;
    }
    .perk.counter {
      --c: #2ec4b6;
    }
    /* The other side's Counter-UAV: red, flickering like static. */
    .perk.jammed {
      --c: var(--hud-danger, #e63946);
      animation: perk-in 320ms cubic-bezier(0.3, 1.8, 0.5, 1), ready-blink 0.5s steps(2, jump-none) infinite;
    }
    /* A streak to call in: its key, its name, blinking READY. */
    .perk.ready {
      --c: var(--hud-accent, #ffcc00);
    }
    .perk-key {
      display: grid;
      place-items: center;
      min-width: 20px;
      height: 20px;
      padding: 0 4px;
      background: var(--hud-accent, #ffcc00);
      color: #111;
      font: 700 15px var(--pixel);
      border-radius: 3px;
    }
    .perk.ready .perk-time {
      font: 600 11px var(--sans);
      text-transform: uppercase;
      letter-spacing: 0.1em;
      animation: ready-blink 1s steps(2, jump-none) infinite;
    }
    @keyframes ready-blink {
      50% { opacity: 0.35; }
    }
    /* Carrying the case: it glows. */
    .perk.case {
      animation: perk-in 320ms cubic-bezier(0.3, 1.8, 0.5, 1), case-glow 0.9s ease-in-out infinite alternate;
    }
    .perk-name {
      font: 700 17px var(--pixel);
      letter-spacing: 0.04em;
      color: var(--c);
    }
    .perk-bar {
      width: 84px;
      height: 8px;
      background: rgba(255, 255, 255, 0.18);
      overflow: hidden;
    }
    .perk-bar > span {
      display: block;
      height: 100%;
      width: calc(var(--left) / var(--of) * 100%);
      background: var(--c);
      transition: width 1s linear;
    }
    .perk-time {
      font: 700 15px var(--pixel);
      min-width: 28px;
      text-align: right;
      font-variant-numeric: tabular-nums;
    }
    .perk.case .perk-time {
      font: 600 12px var(--sans);
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }
    @keyframes pip-in {
      from { transform: skewX(-10deg) scale(1.6); }
    }
    @keyframes perk-in {
      from { transform: scale(1.35); opacity: 0; }
    }
    @keyframes case-glow {
      from { box-shadow: 4px 4px 0 rgba(0, 0, 0, 0.35); }
      to { box-shadow: 0 0 18px rgba(255, 204, 0, 0.9); }
    }`,
};

/**
 * The streak cards, `length` of them lit up to the streak, each killstreak's marked with its
 * class (`marks`: by card, from 0).
 */
export function streakPips(streak: number, marks: Record<number, string>, length: number): string[] {
  return Array.from({ length }, (_, i) => `${i < streak ? 'on' : 'off'}${marks[i] ? ` ${marks[i]}` : ''}`);
}

/**
 * The team modes' bar across the top (a widget up on everyone's screen, `game.hud.widget`): each
 * side's name, colour and score (Team Deathmatch: kills toward the limit; The Briefcase: rounds
 * won, a card each, who's attacking, and who's still up), and between them the clock and what's
 * happening. Everyone's copy says which side is theirs (`mine`, a player's own field), so theirs
 * is marked YOU. During The Briefcase's fuse the clock goes red and pulses.
 */
export const MATCHBAR: WidgetDefinition = {
  at: 'top',
  html: `
    <div class="bar {{mode}}">
      <div class="team left {{a.role}}" style="--c: {{a.color}}">
        <div class="head"><span class="you" data-if="mine == 0">You</span><span class="name">{{a.short}}</span><span class="role" data-if="a.role">{{a.role}}</span></div>
        <div class="line">
          <span class="score" data-if="!rounds">{{a.score}}</span>
          <span class="cards" data-if="rounds"><i data-each="a.cards" class="card {{.}}"></i></span>
          <span class="up" data-if="rounds"><i data-each="a.up" class="man {{.}}"></i></span>
        </div>
      </div>
      <div class="mid {{state}}">
        <span class="clock">{{clock}}</span>
        <span class="note">{{note}}</span>
      </div>
      <div class="team right {{b.role}}" style="--c: {{b.color}}">
        <div class="head"><span class="role" data-if="b.role">{{b.role}}</span><span class="name">{{b.short}}</span><span class="you" data-if="mine == 1">You</span></div>
        <div class="line">
          <span class="up" data-if="rounds"><i data-each="b.up" class="man {{.}}"></i></span>
          <span class="cards" data-if="rounds"><i data-each="b.cards" class="card {{.}}"></i></span>
          <span class="score" data-if="!rounds">{{b.score}}</span>
        </div>
      </div>
    </div>`,
  css: `
    :scope {
      margin-top: 10px;
    }
    .bar {
      display: flex;
      align-items: stretch;
      gap: 0;
      filter: drop-shadow(6px 6px 0 var(--hud-ink, #111));
    }
    .team {
      display: flex;
      flex-direction: column;
      justify-content: center;
      gap: 2px;
      min-width: 150px;
      padding: 5px 12px;
      background: var(--hud-paper, #fdf1d6);
      color: var(--hud-fg, #111);
      border: 3px solid var(--hud-ink, #111);
    }
    .team.left {
      border-right: 0;
      border-left: 14px solid var(--c);
      border-radius: 4px 0 0 4px;
      align-items: flex-start;
    }
    .team.right {
      border-left: 0;
      border-right: 14px solid var(--c);
      border-radius: 0 4px 4px 0;
      align-items: flex-end;
    }
    .head {
      display: flex;
      align-items: baseline;
      gap: 7px;
    }
    .name {
      font: 700 19px var(--pixel);
      letter-spacing: 0.05em;
      color: var(--hud-fg, #111);
    }
    .role {
      font: 700 10px var(--sans);
      text-transform: uppercase;
      letter-spacing: 0.12em;
      padding: 1px 5px;
      background: var(--hud-ink, #111);
      color: var(--c);
      border-radius: 2px;
    }
    .you {
      font: 700 10px var(--sans);
      text-transform: uppercase;
      letter-spacing: 0.12em;
      padding: 1px 5px;
      background: var(--hud-accent, #ffcc00);
      color: var(--hud-ink, #111);
      border: 2px solid var(--hud-ink, #111);
      border-radius: 2px;
    }
    .line {
      display: flex;
      align-items: center;
      gap: 10px;
      min-height: 26px;
    }
    .score {
      font: 700 30px var(--pixel);
      line-height: 1;
      font-variant-numeric: tabular-nums;
      color: var(--c);
      -webkit-text-stroke: 1.5px var(--hud-ink, #111);
      paint-order: stroke fill;
    }
    /* Rounds won: a card each, filled in the side's colour. */
    .cards {
      display: flex;
      gap: 4px;
    }
    .card {
      width: 14px;
      height: 20px;
      border: 2px solid var(--hud-ink, #111);
      transform: skewX(-10deg);
      background: rgba(0, 0, 0, 0.08);
    }
    .card.won {
      background: var(--c);
      animation: card-in 300ms cubic-bezier(0.3, 1.8, 0.5, 1);
    }
    /* Who's still up: a little figure each, crossed out when they're down. */
    .up {
      display: flex;
      gap: 3px;
    }
    .man {
      width: 8px;
      height: 14px;
      border-radius: 4px 4px 1px 1px;
      background: var(--hud-ink, #111);
    }
    .man.down {
      opacity: 0.22;
    }
    .mid {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-width: 118px;
      padding: 4px 12px;
      background: var(--hud-ink, #111);
      color: #fff;
      border-top: 3px solid var(--hud-ink, #111);
      border-bottom: 3px solid var(--hud-ink, #111);
    }
    .clock {
      font: 700 28px var(--pixel);
      line-height: 1;
      font-variant-numeric: tabular-nums;
      color: var(--hud-accent, #ffcc00);
    }
    .note {
      font: 600 10px var(--sans);
      text-transform: uppercase;
      letter-spacing: 0.1em;
      opacity: 0.85;
      white-space: nowrap;
    }
    /* The case is down: the fuse, red, pulsing. */
    .mid.planted .clock {
      color: var(--hud-danger, #e63946);
      animation: fuse 0.5s ease-in-out infinite alternate;
    }
    .mid.planted {
      background: #2a0306;
    }
    @keyframes fuse {
      to { transform: scale(1.12); text-shadow: 0 0 12px rgba(230, 57, 70, 0.9); }
    }
    @keyframes card-in {
      from { transform: skewX(-10deg) scale(1.7); }
    }`,
};

/**
 * The vote to skip (the platform's `skipVote` kit, server.ts), up on everyone's screen while any votes are in: a panel at the
 * left with the match on now, a card for each vote it takes (lit for those in) and the count.
 * Everyone's copy says whether they've voted themselves (`voted`, a player's own field), and how
 * to change that.
 */
export const SKIPVOTE: WidgetDefinition = {
  at: 'left',
  html: `
    <div class="vote">
      <div class="head"><span class="tag">Vote</span><span class="title">Skip it?</span></div>
      <div class="what">{{what}}</div>
      <div class="line">
        <span class="pips"><i data-each="pips" class="pip {{.}}"></i></span>
        <span class="count">{{votes}} / {{need}}</span>
      </div>
      <div class="hint" data-if="!voted">V to vote</div>
      <div class="hint mine" data-if="voted">You voted · V takes it back</div>
    </div>`,
  css: `
    .vote {
      display: flex;
      flex-direction: column;
      gap: 4px;
      min-width: 170px;
      padding: 7px 12px 8px;
      background: var(--hud-paper, #fdf1d6);
      color: var(--hud-fg, #111);
      border: 3px solid var(--hud-ink, #111);
      border-left: 12px solid var(--hud-accent, #ffcc00);
      border-radius: 4px;
      box-shadow: 6px 6px 0 var(--hud-ink, #111);
      animation: vote-in 320ms cubic-bezier(0.3, 1.8, 0.5, 1);
    }
    .head {
      display: flex;
      align-items: baseline;
      gap: 7px;
    }
    .tag {
      font: 700 10px var(--sans);
      text-transform: uppercase;
      letter-spacing: 0.12em;
      padding: 1px 5px;
      background: var(--hud-ink, #111);
      color: var(--hud-accent, #ffcc00);
      border-radius: 2px;
    }
    .title {
      font: 700 22px var(--pixel);
      letter-spacing: 0.04em;
    }
    .what {
      font: 600 11px var(--sans);
      text-transform: uppercase;
      letter-spacing: 0.08em;
      opacity: 0.75;
    }
    .line {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    /* A card for each vote it takes, like the streak's. */
    .pips {
      display: flex;
      gap: 5px;
    }
    .pip {
      width: 13px;
      height: 16px;
      border: 2px solid var(--hud-ink, #111);
      transform: skewX(-10deg);
      background: rgba(0, 0, 0, 0.08);
    }
    .pip.on {
      background: var(--hud-accent, #ffcc00);
      animation: pip-in 260ms cubic-bezier(0.3, 1.8, 0.5, 1);
    }
    .count {
      font: 700 20px var(--pixel);
      font-variant-numeric: tabular-nums;
    }
    .hint {
      font: 600 10px var(--sans);
      text-transform: uppercase;
      letter-spacing: 0.1em;
      opacity: 0.7;
    }
    .hint.mine {
      opacity: 1;
    }
    @keyframes vote-in {
      from { transform: scale(1.35); opacity: 0; }
    }
    @keyframes pip-in {
      from { transform: skewX(-10deg) scale(1.6); }
    }`,
};
