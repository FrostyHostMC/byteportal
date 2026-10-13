import type { WidgetDefinition } from '@platform';

/**
 * The match's framing, as plain data both sides read: the opening fly-over's message (the server's
 * `cinema.ts` sends it, each screen's `client/intro.ts` flies it) and the end screen (a widget the
 * server fills in at the end of a match, `cinema.ts`).
 */

/** The fly-over's message to a screen: fly it now. */
export const INTRO_MSG = 'bf.intro';

/** The fly-over, as a screen gets it. Points are `[x, y, z]`. */
export interface IntroMessage {
  /** The camera's keyframes, in the order it flies them (the map's, turned to end at the player's side). */
  keys: { at: [number, number, number]; look: [number, number, number] }[];
  /** Seconds it sweeps over them, before it comes down to the player. */
  time: number;
  /** The whole thing at a match's start (everyone held still meanwhile), or a joiner's shorter one (skippable). */
  full: boolean;
  /** The title card: the map, the mode, a line under them, and the side the player fights for. */
  title: string;
  mode: string;
  line: string;
  side: string;
  color: string;
}

/** The fly-over's lengths (seconds): the sweep at a match's start, a joiner's, and the ease down to the player's own view after either. */
export const INTRO_TIME = { full: 5.5, short: 3.2, ease: 1.3 };

/**
 * The end screen: VICTORY or DEFEAT over the final tickets, the top three players as cards (name,
 * side, what they fought as, kills, captures, score), the player's own line (kills, deaths,
 * captures, the battle points they earned, the heroes they played, all time) and the countdown to
 * the next match (its mode and map). Everyone's own (`player.hud.widget('end', …)`): filled in by
 * `cinema.ts`, the countdown ticked each second.
 *
 * Its look is the HUD's (`hud.css`'s `--bf-*` tokens, read through the theme): white type at a few
 * strengths in the display face with wide tracking, blurred glass only where a panel's needed,
 * hairlines, the sides' colours as thin accents, the crawl's yellow for the victory, the best
 * score and the player's own line.
 */
export const END_SCREEN: WidgetDefinition = {
  at: 'center',
  html: `
    <div class="es-veil"></div>
    <div class="es-screen es-result-{{result}}" style="--win: {{color}}">
      <div class="es-kicker"><span>{{mode}}</span><span class="es-dot">·</span><span>{{map}}</span></div>
      <div class="es-result">{{resultText}}</div>
      <div class="es-headline">{{headline}}</div>
      <div class="es-tickets">
        <div class="es-side es-a" style="--c: {{a.color}}"><span class="es-name">{{a.name}}</span><span class="es-n">{{a.tickets}}</span></div>
        <div class="es-vs">TICKETS</div>
        <div class="es-side es-b" style="--c: {{b.color}}"><span class="es-n">{{b.tickets}}</span><span class="es-name">{{b.name}}</span></div>
      </div>
      <div class="es-rule"><span>TOP OF THE FIELD</span></div>
      <div class="es-podium">
        <div data-each="top" class="es-card es-rank-{{rank}} es-you-{{you}}" style="--c: {{color}}">
          <div class="es-rank">{{rank}}</div>
          <div class="es-who">
            <div class="es-pname">{{name}}</div>
            <div class="es-role"><span class="es-mark"></span>{{side}} · {{role}}</div>
          </div>
          <div class="es-stats">
            <div><span class="es-v">{{kills}}</span><span class="es-k">KILLS</span></div>
            <div><span class="es-v">{{captures}}</span><span class="es-k">CAPTURES</span></div>
            <div class="es-score"><span class="es-v">{{score}}</span><span class="es-k">SCORE</span></div>
          </div>
        </div>
      </div>
      <div class="es-rule"><span>YOUR MATCH</span></div>
      <div class="es-mine" style="--c: {{me.color}}">
        <div class="es-cell es-place"><span class="es-v">#{{me.place}}</span><span class="es-k">OF {{me.of}}</span></div>
        <div class="es-cell"><span class="es-v">{{me.kills}}</span><span class="es-k">KILLS</span></div>
        <div class="es-cell"><span class="es-v">{{me.deaths}}</span><span class="es-k">DEATHS</span></div>
        <div class="es-cell"><span class="es-v">{{me.captures}}</span><span class="es-k">CAPTURES</span></div>
        <div class="es-cell es-bp"><span class="es-v">{{me.earned}}</span><span class="es-k">BATTLE POINTS</span></div>
        <div class="es-cell es-heroes"><span class="es-v es-small">{{me.heroes}}</span><span class="es-k">HEROES PLAYED</span></div>
      </div>
      <div class="es-alltime">{{me.alltime}}</div>
      <div class="es-next">
        <span class="es-label">NEXT</span>
        <span class="es-what">{{next.mode}} · {{next.map}}</span>
        <span class="es-in"><span class="es-sec">{{next.in}}</span></span>
      </div>
    </div>`,
  css: `
    :scope {
      /* The HUD's palette (hud.css's --bf-* tokens), with its values should they be missing. */
      --fg: var(--bf-fg, #f3f5f7); --fg2: var(--bf-fg2, rgba(243, 245, 247, 0.66)); --fg3: var(--bf-fg3, rgba(243, 245, 247, 0.42));
      --line: var(--bf-line, rgba(255, 255, 255, 0.12)); --line2: var(--bf-line2, rgba(255, 255, 255, 0.24));
      --glass: var(--bf-glass, rgba(9, 13, 19, 0.58)); --glass2: var(--bf-glass2, rgba(9, 13, 19, 0.78)); --y: var(--bf-y, var(--hud-accent, #ffe81f));
      --shadow: 0 1px 6px rgba(0, 0, 0, 0.5);
      /* The whole screen, from the middle of it (where its place is). */
      position: absolute; left: -50vw; top: -50vh; width: 100vw; height: 100vh; display: grid; place-items: center; pointer-events: none; color: var(--fg);
    }
    .es-veil { position: absolute; inset: 0; background: radial-gradient(ellipse at 50% 40%, rgba(4, 6, 9, 0.35), rgba(4, 6, 9, 0.82) 78%); backdrop-filter: blur(3px) saturate(0.8); animation: fade 700ms ease both; }
    .es-screen { position: relative; width: min(940px, 94vw); display: flex; flex-direction: column; align-items: center; animation: rise 800ms cubic-bezier(0.2, 0.8, 0.2, 1) both 120ms; }
    .es-kicker { display: flex; gap: 12px; font: 600 12px/1 var(--pixel); letter-spacing: 0.34em; margin-right: -0.34em; color: var(--fg2); text-transform: uppercase; }
    .es-dot { color: var(--fg3); }
    .es-result { margin-top: 10px; font: 500 84px/0.95 var(--pixel); letter-spacing: 0.3em; margin-right: -0.3em; color: var(--y); text-shadow: 0 0 30px color-mix(in srgb, var(--y) 30%, transparent), var(--shadow); animation: slam 800ms cubic-bezier(0.2, 0.8, 0.2, 1) both 220ms; }
    .es-result-defeat .es-result { color: var(--fg); text-shadow: 0 0 26px rgba(255, 90, 79, 0.28), var(--shadow); }
    .es-headline { margin-top: 12px; font: 500 15px/1.3 var(--sans); letter-spacing: 0.04em; color: var(--fg2); }
    .es-tickets { margin-top: 18px; display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 22px; width: 100%; max-width: 560px; padding: 10px 24px; }
    .es-side { display: flex; align-items: center; gap: 14px; }
    .es-side.es-a { justify-content: flex-end; }
    .es-side .es-name { font: 600 11px/1 var(--pixel); letter-spacing: 0.3em; color: color-mix(in srgb, var(--c) 72%, white); text-transform: uppercase; }
    .es-side .es-n { font: 500 40px/1 var(--pixel); color: var(--fg); font-variant-numeric: tabular-nums; text-shadow: var(--shadow); }
    .es-side.es-a .es-n { border-right: 2px solid var(--c); padding-right: 14px; }
    .es-side.es-b .es-n { border-left: 2px solid var(--c); padding-left: 14px; }
    .es-vs { font: 600 9px/1 var(--pixel); letter-spacing: 0.3em; color: var(--fg3); }
    .es-rule { margin-top: 20px; width: 100%; display: flex; align-items: center; gap: 16px; font: 600 10px/1 var(--pixel); letter-spacing: 0.34em; color: var(--fg3); }
    .es-rule::before, .es-rule::after { content: ''; flex: 1; height: 1px; background: var(--line); }
    .es-podium { margin-top: 12px; display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; width: 100%; }
    .es-card {
      position: relative; display: flex; flex-direction: column; gap: 12px; padding: 14px 16px 12px; border-radius: 3px;
      background: var(--glass); backdrop-filter: blur(10px); box-shadow: inset 0 1px 0 color-mix(in srgb, var(--c) 70%, transparent), inset 0 0 0 1px var(--line);
      animation: rise 700ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
    }
    .es-card.es-rank-1 { animation-delay: 480ms; } .es-card.es-rank-2 { animation-delay: 580ms; } .es-card.es-rank-3 { animation-delay: 680ms; }
    .es-card.es-you-true { box-shadow: inset 0 1px 0 var(--y), inset 0 0 0 1px color-mix(in srgb, var(--y) 45%, transparent); }
    .es-rank { position: absolute; right: 14px; top: 10px; font: 500 32px/1 var(--pixel); color: var(--fg3); opacity: 0.5; }
    .es-card.es-rank-1 .es-rank { color: var(--y); opacity: 0.85; }
    .es-pname { font: 600 19px/1.1 var(--pixel); letter-spacing: 0.06em; color: var(--fg); text-transform: uppercase; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding-right: 36px; }
    .es-role { margin-top: 4px; font: 600 10px/1 var(--pixel); letter-spacing: 0.24em; color: var(--fg2); text-transform: uppercase; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .es-mark { display: inline-block; width: 5px; height: 5px; margin: 0 8px 1px 0; background: var(--c); transform: rotate(45deg); box-shadow: 0 0 6px var(--c); }
    .es-stats { display: grid; grid-template-columns: repeat(3, 1fr); border-top: 1px solid var(--line); padding-top: 10px; }
    .es-stats > div, .es-cell { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; }
    .es-v { font: 500 22px/1 var(--pixel); color: var(--fg); font-variant-numeric: tabular-nums; }
    .es-v.es-small { font: 500 14px/1.2 var(--sans); letter-spacing: 0.01em; }
    .es-k { font: 600 9px/1 var(--pixel); letter-spacing: 0.26em; color: var(--fg3); white-space: nowrap; }
    .es-score .es-v { color: var(--fg); }
    .es-card.es-rank-1 .es-score .es-v { color: var(--y); }
    .es-mine {
      margin-top: 12px; width: 100%; display: grid; grid-template-columns: 0.8fr repeat(4, 1fr) 1.9fr; padding: 13px 4px; border-radius: 3px;
      background: var(--glass2); backdrop-filter: blur(10px); box-shadow: inset 2px 0 0 var(--y), inset 0 0 0 1px var(--line);
      animation: rise 700ms cubic-bezier(0.2, 0.8, 0.2, 1) both 800ms;
    }
    .es-cell { padding: 0 16px; border-left: 1px solid var(--line); }
    .es-cell:first-child { border-left: 0; }
    .es-cell.es-place .es-v { color: var(--y); }
    .es-alltime { margin-top: 10px; font: 600 10px/1 var(--pixel); letter-spacing: 0.26em; color: var(--fg3); text-transform: uppercase; }
    .es-next { margin-top: 22px; display: flex; align-items: center; gap: 16px; padding: 7px 8px 7px 16px; border-radius: 3px; background: var(--glass); backdrop-filter: blur(10px); box-shadow: inset 0 0 0 1px var(--line); animation: fade 600ms ease both 950ms; }
    .es-next .es-label { font: 600 10px/1 var(--pixel); letter-spacing: 0.34em; color: var(--fg3); }
    .es-next .es-what { font: 600 14px/1 var(--pixel); letter-spacing: 0.2em; text-transform: uppercase; color: var(--fg); }
    .es-next .es-in { display: grid; place-items: center; min-width: 34px; height: 26px; border-radius: 2px; background: color-mix(in srgb, var(--y) 16%, transparent); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--y) 55%, transparent); }
    .es-sec { font: 600 15px/1 var(--pixel); color: var(--y); font-variant-numeric: tabular-nums; }
    @media (max-width: 820px) { .es-result { font-size: 56px; } .es-podium { grid-template-columns: 1fr; } .es-mine { grid-template-columns: repeat(3, 1fr); row-gap: 12px; } .es-cell:nth-child(4) { border-left: 0; } }
    @media (max-height: 760px) { .es-result { font-size: 60px; } .es-rule { margin-top: 14px; } .es-tickets { margin-top: 10px; } .es-next { margin-top: 12px; } }
    @keyframes fade { from { opacity: 0; } }
    @keyframes rise { from { opacity: 0; transform: translateY(12px); } }
    @keyframes slam { from { opacity: 0; transform: scale(1.12); letter-spacing: 0.5em; } }`,
};

/** A card on the end screen. */
export interface EndCard {
  rank: number;
  name: string;
  side: string;
  color: string;
  role: string;
  kills: number;
  captures: number;
  score: number;
  /** It's the player looking at it. */
  you: boolean;
}
