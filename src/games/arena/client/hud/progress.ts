import type { Client, ClientKit } from '@platform/client';
import { MSG, type LevelMsg } from '../../hud/messages';
import { el, hidden, hud, num, replay } from './store';

/** Where a fighter stands, as the run's part tells their screen (`run/progression.ts`: `arena.xp`), with what they just earned. */
interface XpMsg {
  level: number;
  into: number;
  need: number;
  total: number;
  guest: boolean;
  gains: [amount: number, label: string][];
}

/** The run's part's message of a fighter's XP (`run/progression.ts`). */
const XP_MSG = 'arena.xp';
/** Gains this close together add up in the one "+XP". */
const SUM_FOR = 2.2;

/**
 * Experience on the fighter's screen, from the run's part's word (`arena.xp`, and the HUD part's
 * `level`): a slim strip under the hotbar, their level at its end, filling as they earn, and the XP
 * just earned adding up beside it ("+48 XP"); a level reached rises over the hotbar in gold with
 * what it unlocked, to the brass.
 */
export function progress(): ClientKit {
  let unstyle: (() => void) | null = null;
  let layer: HTMLElement;
  let strip: HTMLElement;
  let badge: HTMLElement;
  let fill: HTMLElement;
  let gain: HTMLElement;
  let sum = { n: 0, until: 0 };
  let levelUp: { el: HTMLElement; until: number } | null = null;
  let shown: XpMsg | null = null;

  const showXp = (client: Client, x: XpMsg) => {
    const up = shown !== null && x.level > shown.level;
    shown = x;
    strip.classList.add('on');
    badge.textContent = `Lv ${x.level}`;
    if (up) {
      // A new level: the strip starts again from empty.
      fill.style.transition = 'none';
      fill.style.width = '0%';
      void fill.offsetWidth;
      fill.style.transition = '';
    }
    fill.style.width = `${x.need > 0 ? Math.min(100, (x.into / x.need) * 100) : 100}%`;
    const earned = x.gains.reduce((a, [n]) => a + n, 0);
    if (earned > 0) {
      sum = client.time < sum.until ? { n: sum.n + earned, until: client.time + SUM_FOR } : { n: earned, until: client.time + SUM_FOR };
      gain.textContent = `+${num(sum.n)} XP`;
      gain.classList.add('on');
      replay(gain, 'bump');
    }
  };

  const showLevel = (client: Client, l: LevelMsg) => {
    levelUp?.el.remove();
    const cards = l.unlocks.map((u, i) => {
      const c = el('div.ar-lv-card', el('small', `${u.kind === 'class' ? 'Class' : u.kind === 'cosmetic' ? 'Cosmetic' : u.kind} unlocked`), el('b', u.name));
      c.style.animationDelay = `${450 + i * 140}ms`;
      return c;
    });
    const e = el('div.ar-lv', el('div.ar-lv-k', 'Level up'), el('div.ar-lv-n', String(l.level)), cards.length ? el('div.ar-lv-cards', ...cards) : null);
    layer.append(e);
    levelUp = { el: e, until: client.time + 4.2 + cards.length * 0.4 };
    client.audio.play('ar_level_up', { volume: 0.9 });
  };

  return {
    name: 'arena.hud.progress',
    setup(client) {
      unstyle = client.hud.style(CSS);
      layer = client.hud.layer('arena.progress', 'panels');
      badge = el('span.ar-xp-lv');
      fill = el('i');
      gain = el('span.ar-xp-gain');
      strip = el('div.ar-xp', badge, el('div.ar-xp-track', fill), gain);
      layer.append(strip);
      client.on(XP_MSG, (d) => {
        const x = d as XpMsg;
        if (x && typeof x.level === 'number' && typeof x.need === 'number') showXp(client, { ...x, gains: Array.isArray(x.gains) ? x.gains : [] });
      });
      client.on(MSG.level, (d) => {
        const l = d as LevelMsg;
        if (!l || typeof l.level !== 'number' || !Array.isArray(l.unlocks)) return;
        // (On the end screen, it shows the level: only its brass here.)
        if (l.end) client.audio.play('ar_level_up', { volume: 0.9 });
        else showLevel(client, l);
      });
    },
    frame(client) {
      const ended = !!hud.ended || hud.run?.phase === 'victory' || hud.run?.phase === 'defeat';
      layer.style.visibility = hidden(client) || ended ? 'hidden' : '';
      if (sum.n > 0 && client.time > sum.until) {
        sum = { n: 0, until: 0 };
        gain.classList.remove('on');
      }
      if (levelUp && client.time > levelUp.until) {
        const going = levelUp.el;
        levelUp = null;
        going.classList.add('out');
        window.setTimeout(() => going.remove(), 500);
      }
    },
    dispose() {
      unstyle?.();
    },
  };
}

const CSS = `
/* The strip: under the hotbar, its level at the left end, what's just earned at the right. */
.ar-xp {
  position: absolute; left: 50%; bottom: 7px; transform: translateX(-50%); width: 420px; display: flex; align-items: center; gap: 8px;
  opacity: 0; transition: opacity 400ms ease; filter: drop-shadow(0 0 1px rgba(0, 0, 0, 0.7)) drop-shadow(0 1px 3px rgba(0, 0, 0, 0.4));
}
.ar-xp.on { opacity: 1; }
.ar-xp-lv { font: 500 10px/1 var(--ar-label, sans-serif); letter-spacing: 0.2em; text-transform: uppercase; color: var(--ar-gold, #f0c060); white-space: nowrap; }
.ar-xp-track { position: relative; flex: 1; height: 3px; background: rgba(20, 12, 8, 0.6); box-shadow: inset 0 0 0 1px rgba(255, 236, 200, 0.12); }
.ar-xp-track > i { position: absolute; left: 0; top: 0; bottom: 0; background: linear-gradient(90deg, var(--ar-bronze, #c0773a), var(--ar-gold-hi, #ffe3a1)); box-shadow: 0 0 6px rgba(240, 192, 96, 0.6); transition: width 700ms cubic-bezier(0.2, 0.8, 0.3, 1) 120ms; }
.ar-xp-gain { min-width: 64px; font: 600 11px/1 var(--ar-label, sans-serif); letter-spacing: 0.1em; color: var(--ar-gold-hi, #ffe3a1); text-align: right; opacity: 0; transition: opacity 400ms ease; white-space: nowrap; }
.ar-xp-gain.on { opacity: 1; }
.ar-xp-gain.bump { animation: ar-xp-bump 260ms cubic-bezier(0.3, 1.8, 0.5, 1); }
@keyframes ar-xp-bump { from { transform: scale(1.35); } }
/* A level reached: rising over the hotbar. */
.ar-lv {
  position: absolute; left: 50%; bottom: 112px; transform: translateX(-50%); display: flex; flex-direction: column; align-items: center; gap: 2px;
  filter: drop-shadow(0 0 1px rgba(0, 0, 0, 0.8)) drop-shadow(0 2px 6px rgba(0, 0, 0, 0.5));
  animation: ar-lv-in 600ms cubic-bezier(0.3, 1.5, 0.5, 1) both; transition: opacity 500ms ease, transform 500ms ease;
}
.ar-lv.out { opacity: 0; transform: translate(-50%, 16px); }
.ar-lv-k { font: 600 13px/1 var(--ar-label, sans-serif); letter-spacing: 0.5em; margin-right: -0.5em; text-transform: uppercase; color: var(--ar-gold, #f0c060); }
.ar-lv-n {
  font: 800 64px/1 var(--ar-title, Georgia, serif);
  background: linear-gradient(180deg, #fff8e6 15%, var(--ar-gold, #f0c060) 65%, #b9802c); -webkit-background-clip: text; background-clip: text; color: transparent;
  filter: drop-shadow(0 0 22px rgba(240, 192, 96, 0.55));
}
.ar-lv-cards { display: flex; gap: 8px; margin-top: 6px; }
.ar-lv-card {
  display: flex; flex-direction: column; gap: 4px; padding: 7px 14px; border-radius: 2px; background: var(--ar-glass2, rgba(14, 10, 8, 0.82));
  box-shadow: inset 0 1px 0 rgba(240, 192, 96, 0.7), inset 0 0 0 1px var(--ar-line2, rgba(224, 168, 96, 0.42));
  animation: ar-lv-card 500ms cubic-bezier(0.3, 1.6, 0.5, 1) both;
}
.ar-lv-card small { font: 500 9px/1 var(--ar-label, sans-serif); letter-spacing: 0.26em; text-transform: uppercase; color: var(--ar-gold, #f0c060); }
.ar-lv-card b { font: 700 17px/1 var(--ar-title, Georgia, serif); letter-spacing: 0.06em; color: var(--ar-fg, #f5efe4); }
@keyframes ar-lv-in { from { opacity: 0; transform: translate(-50%, 30px) scale(1.3); } }
@keyframes ar-lv-card { from { opacity: 0; transform: translateY(8px) scale(1.2); } }
`;
