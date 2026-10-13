import type { WidgetDefinition } from '@platform';
import hudCss from './hud.css?raw';
import { TEAMS } from './teams';

/**
 * Blockfront's HUD: its theme (`hud.css`, over the platform's pieces) and its widgets (filled in
 * by `server.ts` every tick; only what changed goes out). The look: white type at a few
 * strengths over the world, condensed capitals with wide tracking, hairlines and slim bars, each
 * side's colour kept to a thin line or a glow, the crawl's yellow only for what matters.
 *
 * - `conquest` (everyone's, top middle): each side's reinforcements (the number, and a thin line
 *   draining toward the middle; red once they're low), and the command posts between them: each
 *   a ring that fills in the colour of the side it leans to as it's taken, round a disc in its
 *   holder's colour; glowing in the taker's colour while it moves, pulsing white while it's
 *   contested. The clock under them.
 * - `status` (each player's, top right): what they fight as, their battle points, and how near a
 *   hero is (a line toward the cheapest), or HERO READY (H).
 */

/** Reinforcements at or under this share of a full side's are running low: they turn red (server.ts warns the side at the same, `LOW_TICKETS`). */
const LOW = 0.2;

/** The scoreboard's columns after the name (the theme lays the two sides out by them: `boardCss`). */
export const BOARD_COLUMNS = ['Score', 'Kills', 'Deaths', 'Posts'] as const;

const [REB, IMP] = TEAMS;

/** One side's end of the conquest bar: its name, its tickets, the line draining toward the middle. */
const side = (k: 'a' | 'b') => `
      <div class="side ${k}" style="--c: {{${k}.color}}; --fill: {{${k}.pct}}">
        <div class="name">{{${k}.short}}<span class="low" data-if="${k}.pct <= ${LOW}">LOW</span></div>
        <div class="n" data-if="${k}.pct > ${LOW}">{{${k}.tickets}}</div><div class="n short" data-if="${k}.pct <= ${LOW}">{{${k}.tickets}}</div>
        <div class="drain"><i></i></div>
      </div>`;

export const CONQUEST: WidgetDefinition = {
  at: 'top',
  html: `
    <div class="bar">${side('a')}
      <div class="mid">
        <div class="posts">
          <div data-each="posts" class="post own-{{own}} lean-{{lean}} by-{{by}} {{state}}" style="--fill: {{fill}}">
            <span class="core"></span><span class="ring"></span><span class="letter">{{id}}</span>
          </div>
        </div>
        <div class="clock">{{clock}}</div>
      </div>${side('b')}
    </div>`,
  css: `
    :scope { margin-top: -8px; --fg: #f3f5f7; --fg2: rgba(243, 245, 247, 0.62); --y: var(--hud-accent, #ffe81f); --bad: #ff5a4f; }
    .bar { position: relative; z-index: 0; display: flex; align-items: flex-start; gap: 18px; padding: 10px 34px 14px; filter: drop-shadow(0 0 1px rgba(0, 0, 0, 0.6)) drop-shadow(0 1px 4px rgba(0, 0, 0, 0.35)); }
    /* (No panel behind it: a tight dark halo round each mark, the filter above, keeps it readable over snow and sky.) */
    .side { display: flex; flex-direction: column; gap: 1px; width: 132px; padding-top: 1px; }
    .side.a { align-items: flex-end; text-align: right; }
    .side.b { align-items: flex-start; }
    .name { font: 600 10px/1 var(--pixel); letter-spacing: 0.3em; color: color-mix(in srgb, var(--c) 72%, white); display: flex; gap: 6px; align-items: center; }
    .side.a .name { flex-direction: row-reverse; margin-right: -0.3em; }
    .low { font: 700 8px/1 var(--pixel); letter-spacing: 0.22em; color: var(--bad); animation: breathe 1.4s ease-in-out infinite; }
    .n { font: 500 26px/1.05 var(--pixel); letter-spacing: 0.02em; color: var(--fg); font-variant-numeric: tabular-nums; text-shadow: 0 1px 6px rgba(0, 0, 0, 0.45); }
    .n.short { color: var(--bad); }
    .drain { position: relative; width: 100%; height: 2px; margin-top: 3px; background: rgba(255, 255, 255, 0.14); }
    .drain > i { position: absolute; top: 0; bottom: 0; width: calc(var(--fill) * 100%); background: color-mix(in srgb, var(--c) 80%, white); box-shadow: 0 0 6px var(--c); transition: width 600ms ease; }
    .a .drain > i { right: 0; }
    .b .drain > i { left: 0; }
    .mid { display: flex; flex-direction: column; align-items: center; gap: 5px; }
    .posts { display: flex; gap: 8px; }
    .post { position: relative; width: 28px; height: 28px; display: grid; place-items: center;
      --own: rgba(243, 245, 247, 0.5); --lean: rgba(243, 245, 247, 0.7); --by: var(--y); }
    .post.own-rebels { --own: ${REB.color}; }
    .post.own-empire { --own: ${IMP.color}; }
    .post.lean-rebels { --lean: ${REB.color}; }
    .post.lean-empire { --lean: ${IMP.color}; }
    .post.by-rebels { --by: ${REB.color}; }
    .post.by-empire { --by: ${IMP.color}; }
    .core { position: absolute; inset: 4px; border-radius: 50%; background: color-mix(in srgb, var(--own) 30%, rgba(6, 9, 13, 0.7)); transition: background-color 450ms ease; }
    .post.own-none .core { background: rgba(6, 9, 13, 0.55); }
    .ring { position: absolute; inset: 0; border-radius: 50%;
      background: conic-gradient(var(--lean) calc(var(--fill) * 360deg), rgba(255, 255, 255, 0.16) 0);
      -webkit-mask: radial-gradient(closest-side, transparent calc(100% - 2.5px), #000 calc(100% - 2px));
      mask: radial-gradient(closest-side, transparent calc(100% - 2.5px), #000 calc(100% - 2px));
      transition: filter 300ms ease; }
    .letter { position: relative; font: 600 12px/1 var(--pixel); letter-spacing: 0.04em; color: var(--fg); }
    .post.own-none .letter { color: var(--fg2); }
    .post.moving .ring { filter: drop-shadow(0 0 3px var(--by)) drop-shadow(0 0 6px var(--by)); animation: breathe 1.2s ease-in-out infinite; }
    .post.contested .ring { background: rgba(255, 255, 255, 0.95); animation: breathe 0.8s ease-in-out infinite; }
    .clock { font: 500 12px/1 var(--pixel); letter-spacing: 0.16em; color: var(--fg2); font-variant-numeric: tabular-nums; }
    @media (max-width: 1240px) { .side { width: 100px; } .n { font-size: 22px; } .bar { gap: 12px; padding: 10px 24px 14px; } }
    @media (max-width: 980px) { .side { width: 70px; } .name { letter-spacing: 0.16em; } .low { display: none; } .posts { gap: 5px; } }
    @keyframes breathe { 50% { opacity: 0.45; } }`,
};

export const STATUS: WidgetDefinition = {
  at: 'top-right',
  html: `
    <div class="card" style="--c: {{color}}; --p: calc({{bp}} / {{heroCost}})">
      <div class="side">{{side}}</div>
      <div class="role">{{role}}</div>
      <div class="bp"><span class="label">Battle points</span><span class="value">{{bp}}</span></div>
      <div class="hero ready" data-if="heroReady"><span class="key">H</span>Hero ready</div>
      <div class="hero" data-if="!heroReady">
        <span class="as" data-if="hero">Hero in play</span>
        <span class="toward" data-if="!hero"><span class="bar"><i></i></span><span class="at">Hero {{heroCost}}</span></span>
      </div>
    </div>`,
  css: `
    :scope { margin: 16px -4px 0 0; align-self: flex-end; width: 232px; --fg: #f3f5f7; --fg2: rgba(243, 245, 247, 0.62); --fg3: rgba(243, 245, 247, 0.42); --y: var(--hud-accent, #ffe81f); }
    .card {
      position: relative; z-index: 0; display: flex; flex-direction: column; align-items: flex-end; gap: 2px; padding: 10px 16px 12px 24px; text-align: right; color: var(--fg);
      border-right: 2px solid color-mix(in srgb, var(--c) 70%, transparent); filter: drop-shadow(0 0 1px rgba(0, 0, 0, 0.6)) drop-shadow(0 1px 4px rgba(0, 0, 0, 0.35));
    }
    /* (No panel behind it: a tight dark halo round each mark, the filter above, keeps it readable over snow and sky.) */
    .side { font: 600 10px/1.2 var(--pixel); letter-spacing: 0.3em; margin-right: -0.3em; color: color-mix(in srgb, var(--c) 72%, white); }
    .role { max-width: 100%; font: 500 20px/1.1 var(--pixel); letter-spacing: 0.06em; text-transform: uppercase; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-shadow: 0 1px 6px rgba(0, 0, 0, 0.45); }
    .bp { display: flex; align-items: baseline; gap: 8px; margin-top: 6px; }
    .label { font: 600 9px var(--pixel); letter-spacing: 0.26em; text-transform: uppercase; color: rgba(243, 245, 247, 0.8); }
    .value { font: 500 18px/1 var(--pixel); color: var(--fg); font-variant-numeric: tabular-nums; }
    .hero { display: flex; align-items: center; justify-content: flex-end; gap: 8px; margin-top: 6px; width: 100%; font: 600 10px/1 var(--pixel); letter-spacing: 0.24em; text-transform: uppercase; }
    .hero.ready { color: var(--y); text-shadow: 0 0 10px color-mix(in srgb, var(--y) 55%, transparent); animation: arrive 400ms ease-out, glow 2.2s ease-in-out 400ms infinite; }
    .key { display: inline-grid; place-items: center; min-width: 16px; height: 16px; border: 1px solid var(--y); border-radius: 3px; font: 600 10px var(--pixel); letter-spacing: 0; }
    .toward { display: flex; align-items: center; gap: 8px; width: 100%; }
    .bar { position: relative; flex: 1; height: 2px; background: rgba(255, 255, 255, 0.14); }
    .bar > i { position: absolute; left: 0; top: 0; bottom: 0; width: calc(min(1, var(--p)) * 100%); background: var(--fg); transition: width 400ms ease; }
    .at { color: rgba(243, 245, 247, 0.8); white-space: nowrap; }
    .as { color: color-mix(in srgb, var(--c) 72%, white); }
    @keyframes arrive { from { opacity: 0; transform: translateX(8px); } }
    @keyframes glow { 50% { text-shadow: 0 0 16px var(--y); } }`,
};

/**
 * The vote to skip (the platform's `skipVote` kit, server.ts), up on everyone's screen while any
 * votes are in, at the left: the match on now, a tick for each vote it takes (lit for those in)
 * and the count. Everyone's copy says whether they've voted themselves (`voted`) and how to change it.
 */
export const SKIPVOTE: WidgetDefinition = {
  at: 'left',
  html: `
    <div class="vote">
      <div class="title">Skip this match?</div>
      <div class="what">{{what}}</div>
      <div class="line">
        <span class="pips"><i data-each="pips" class="pip {{.}}"></i></span>
        <span class="count">{{votes}} / {{need}}</span>
      </div>
      <div class="hint" data-if="!voted"><span class="key">N</span>Vote to skip</div>
      <div class="hint mine" data-if="voted"><span class="key">N</span>You voted · take it back</div>
    </div>`,
  css: `
    :scope { --fg: #f3f5f7; --fg2: rgba(243, 245, 247, 0.62); --y: var(--hud-accent, #ffe81f); }
    .vote {
      display: flex; flex-direction: column; gap: 5px; min-width: 190px; padding: 10px 16px 12px 14px; color: var(--fg);
      border-left: 2px solid color-mix(in srgb, var(--y) 80%, transparent); filter: drop-shadow(0 0 1px rgba(0, 0, 0, 0.6)) drop-shadow(0 1px 4px rgba(0, 0, 0, 0.35));
      animation: arrive 400ms ease-out;
    }
    .title { font: 500 16px/1.1 var(--pixel); letter-spacing: 0.08em; text-transform: uppercase; text-shadow: 0 1px 6px rgba(0, 0, 0, 0.45); }
    .what { font: 600 9px/1.2 var(--pixel); letter-spacing: 0.24em; text-transform: uppercase; color: var(--fg2); }
    .line { display: flex; align-items: center; gap: 10px; margin-top: 2px; }
    .pips { display: flex; gap: 4px; }
    .pip { width: 14px; height: 3px; background: rgba(255, 255, 255, 0.18); transition: background-color 300ms ease, box-shadow 300ms ease; }
    .pip.on { background: var(--y); box-shadow: 0 0 6px color-mix(in srgb, var(--y) 70%, transparent); }
    .count { font: 500 13px/1 var(--pixel); font-variant-numeric: tabular-nums; }
    .hint { display: flex; align-items: center; gap: 7px; margin-top: 3px; font: 600 9px/1 var(--pixel); letter-spacing: 0.22em; text-transform: uppercase; color: rgba(243, 245, 247, 0.8); }
    .hint.mine { color: var(--y); }
    .key { display: inline-grid; place-items: center; min-width: 16px; height: 16px; border: 1px solid currentColor; border-radius: 3px; font: 600 10px var(--pixel); letter-spacing: 0; }
    @keyframes arrive { from { opacity: 0; transform: translateX(-8px); } }`,
};

/**
 * The scoreboard as two sides, the Rebels' on the left and the Empire's on the right: the
 * platform's one table (sorted by side, then score) laid out as a grid, each row put on its side
 * by its name's colour (the side's), numbered on its own side, under its own headings.
 */
function boardCss(): string {
  const rgb = (hex: string) => {
    const n = parseInt(hex.slice(1), 16);
    return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
  };
  const empire = `tr:has(> .sb-name[style*="${rgb(IMP.color)}"])`;
  const cols = (from: number, row: string) => [1, 2, 3, 4, 5, 6].map((i) => `.sb-table ${row} > :nth-child(${i}) { grid-column: ${from + i - 1}; }`).join('\n');
  // The Empire's headings: the table's, the head's and the body's own boxes (6 of them), in the first row.
  const heads = [
    ['.sb-table::before', 8, '#'],
    ['.sb-table thead::before', 9, IMP.name],
    ...BOARD_COLUMNS.map((c, i) => [['.sb-table thead::after', '.sb-table tbody::before', '.sb-table tbody::after', '.sb-table::after'][i], 10 + i, c]),
  ] as [string, number, string][];
  return `
.sb-table {
  display: grid;
  grid-template-columns: 30px minmax(0, 1fr) 58px 50px 60px 50px 28px 30px minmax(0, 1fr) 58px 50px 60px 50px;
  grid-auto-flow: row dense;
  counter-reset: bf-a bf-b;
}
.sb-table thead,
.sb-table tbody,
.sb-table tr {
  display: contents;
}
${cols(1, 'tr')}
${cols(8, empire)}
${heads.map(([sel, col, text]) => `${sel} { content: ${JSON.stringify(text.toUpperCase())}; grid-row: 1; grid-column: ${col}; }`).join('\n')}
.sb-table th.sb-name::after { content: ${JSON.stringify(REB.name.toUpperCase())}; }
.sb-table thead::before { color: ${IMP.color}; }
.sb-table th.sb-name::after { color: ${REB.color}; }
.sb-table td.sb-rank { counter-increment: bf-a; }
.sb-table ${empire} > td.sb-rank { counter-increment: bf-b; }
.sb-table td.sb-rank::before { content: counter(bf-a); }
.sb-table ${empire} > td.sb-rank::before { content: counter(bf-b); }
`;
}

/** The HUD theme's stylesheet (`hud.theme.css`): `hud.css`, and the scoreboard's two sides. */
export const THEME_CSS = hudCss + boardCss();
