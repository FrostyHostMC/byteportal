import type { IconRef } from '@platform';
import type { Client, ClientKit } from '@platform/client';

/**
 * XP on each player's screen, drawn from what the server sends (`progression.ts`: it alone
 * decides who earned what; this only shows it). Client code rather than a widget: it animates
 * (the bar filling, gains popping in one after another, the level-up bursting in), shows the
 * unlocks' own pictures (`hud.icon`), and none of it needs to reach anyone else's screen.
 *
 * - `xp`: their level and XP (the bar and badge, bottom left over the health), with `gains` just
 *   earned for the ticker by the crosshair ("+100 KILL", "+50 HEADSHOT"), in the comic call-outs'
 *   ink and gold.
 * - `xp.level`: a level-up, and what it unlocked, across the top.
 * - `xp.match`: at the end of a match, the XP it earned by what for, and the bar from where they
 *   started, under the final scores.
 */

type Gain = [amount: number, label: string];
interface XpState {
  level: number;
  into: number;
  need: number;
  total: number;
  guest: boolean;
  gains?: Gain[];
}
interface LevelUp {
  level: number;
  unlocks: { kind: string; id: string; name: string; icon?: IconRef }[];
}
interface MatchXp extends XpState {
  from: number;
  lines: [label: string, count: number, amount: number][];
  earned: number;
}

const KIND: Record<string, string> = { primary: 'Primary', sidearm: 'Sidearm', melee: 'Blade', lethal: 'Lethal', outfit: 'Outfit' };

/** An element: `tag.class.class`, then children (text or elements). */
function el(spec: string, ...children: (Node | string | null)[]): HTMLElement {
  const [tag, ...classes] = spec.split('.');
  const e = document.createElement(tag || 'div');
  if (classes.length) e.className = classes.join(' ');
  for (const c of children) if (c !== null) e.append(c);
  return e;
}
const num = (n: number) => Math.round(n).toLocaleString('en-US');
const obj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

const CSS = `
/* The bar and badge: bottom left, over the health bar. */
.xp-bar {
  position: absolute;
  left: 22px;
  bottom: 60px;
  display: flex;
  align-items: center;
  gap: 10px;
  pointer-events: none;
}
/* On a touch screen: drawn to fit it, like the platform's HUD. */
body.touch-mode .xp-bar {
  zoom: var(--hud-zoom, 1);
}
.xp-badge {
  position: relative;
  min-width: 42px;
  height: 34px;
  padding: 0 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 3px;
  background: var(--hud-accent, #ffcc00);
  color: var(--hud-ink, #111);
  border: 3px solid var(--hud-ink, #111);
  border-radius: 3px;
  box-shadow: 4px 4px 0 var(--hud-ink, #111);
  transform: skewX(-8deg);
}
.xp-badge-lv {
  font: 800 9px var(--sans);
  letter-spacing: 0.08em;
  align-self: flex-start;
  margin-top: 5px;
}
.xp-badge-num {
  font: 400 24px/1 var(--pixel);
}
.xp-badge.max {
  background: linear-gradient(135deg, #fff3a8, var(--hud-accent, #ffcc00) 45%, #ff9d2e);
}
.xp-badge.bump {
  animation: xp-badge-bump 700ms cubic-bezier(0.3, 1.8, 0.5, 1);
}
.xp-body {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.xp-track {
  position: relative;
  width: 200px;
  height: 10px;
  /* The empty part in paper, so the whole bar reads on a dark street too. */
  background: rgba(253, 241, 214, 0.3);
  border: 2px solid var(--hud-ink, #111);
  box-shadow: 3px 3px 0 var(--hud-ink, #111);
  overflow: hidden;
}
.xp-fill,
.xp-new {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
}
.xp-new {
  background: #fff;
  transition: width 120ms ease-out;
}
.xp-fill {
  /* Teal: not the health bar's gold. */
  background: linear-gradient(180deg, #4fd6d2, #1fa3a0);
  transition: width 700ms cubic-bezier(0.2, 0.8, 0.3, 1) 150ms;
}
.xp-text {
  font: 700 10px var(--sans);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: #fff;
  text-shadow: 1px 1px 0 var(--hud-ink, #111), -1px 1px 0 var(--hud-ink, #111), 1px -1px 0 var(--hud-ink, #111), -1px -1px 0 var(--hud-ink, #111);
  white-space: nowrap;
}

/* The ticker: what they just earned, by the crosshair, a line at a time (above the big call-outs, which pop under it). */
.xp-ticker {
  position: absolute;
  left: calc(50% + 64px);
  bottom: calc(50% - 30px);
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 1px;
  pointer-events: none;
}
.xp-sum,
.xp-line {
  font-family: var(--pixel);
  white-space: nowrap;
  -webkit-text-stroke: 2px var(--hud-ink, #111);
  paint-order: stroke fill;
  text-shadow: 3px 3px 0 var(--hud-ink, #111);
  letter-spacing: 0.03em;
}
.xp-sum {
  font-size: 34px;
  line-height: 1;
  color: var(--hud-accent, #ffcc00);
  margin-bottom: 2px;
  transform-origin: 0 50%;
}
.xp-sum.bump {
  animation: xp-pop 260ms cubic-bezier(0.3, 1.8, 0.5, 1);
}
.xp-line {
  font-size: 21px;
  line-height: 1.05;
  color: #fff;
  animation: xp-in 300ms cubic-bezier(0.3, 1.8, 0.5, 1) both;
}
.xp-line b {
  font-weight: 400;
  color: var(--hud-accent, #ffcc00);
  margin-right: 6px;
}
.xp-ticker.fade {
  opacity: 0;
  transform: translateY(-10px);
  transition: opacity 450ms ease, transform 450ms ease;
}

/* A level-up: bottom middle, over the hotbar (clear of the banners in the middle and the call-outs under the crosshair). */
.xp-levelup {
  position: absolute;
  left: 50%;
  bottom: 104px;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  pointer-events: none;
  animation: xp-drop 520ms cubic-bezier(0.3, 1.6, 0.5, 1) both;
}
.xp-levelup.out {
  opacity: 0;
  transform: translate(-50%, 24px);
  transition: opacity 500ms ease, transform 500ms ease;
}
.xp-lu-head {
  display: flex;
  align-items: center;
  gap: 14px;
  transform: rotate(-3deg);
}
.xp-lu-title {
  font: 400 54px/1 var(--pixel);
  color: var(--hud-accent, #ffcc00);
  -webkit-text-stroke: 3px var(--hud-ink, #111);
  paint-order: stroke fill;
  text-shadow: 5px 5px 0 var(--hud-ink, #111);
  letter-spacing: 0.03em;
}
/* The new level in a burst of ink. */
.xp-lu-burst {
  position: relative;
  width: 86px;
  height: 86px;
  display: grid;
  place-items: center;
}
.xp-lu-burst::before,
.xp-lu-burst::after {
  content: '';
  position: absolute;
  inset: 0;
  clip-path: polygon(50% 0%, 61% 18%, 82% 8%, 80% 30%, 100% 38%, 84% 54%, 96% 74%, 74% 76%, 70% 98%, 52% 84%, 34% 100%, 28% 78%, 6% 80%, 16% 60%, 0% 42%, 20% 32%, 14% 10%, 36% 18%);
}
.xp-lu-burst::before {
  background: var(--hud-ink, #111);
  transform: translate(5px, 5px) scale(1.04);
}
.xp-lu-burst::after {
  background: var(--hud-danger, #e63946);
  transform: scale(0.9);
  animation: xp-spin 4s linear infinite;
}
.xp-lu-num {
  position: relative;
  z-index: 1;
  font: 400 40px/1 var(--pixel);
  color: #fff;
  -webkit-text-stroke: 2px var(--hud-ink, #111);
  paint-order: stroke fill;
  text-shadow: 3px 3px 0 var(--hud-ink, #111);
}
.xp-lu-unlocks {
  display: flex;
  gap: 12px;
}
.xp-lu-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 12px 6px 8px;
  background: var(--hud-paper, #fdf1d6);
  color: var(--hud-fg, #111);
  border: 3px solid var(--hud-ink, #111);
  border-radius: 4px;
  box-shadow: 5px 5px 0 var(--hud-ink, #111);
  animation: xp-in 360ms cubic-bezier(0.3, 1.8, 0.5, 1) both;
}
.xp-lu-card img {
  width: 64px;
  height: 36px;
  object-fit: contain;
}
.xp-lu-card.outfit img {
  width: 40px;
  height: 48px;
}
.xp-lu-text {
  display: flex;
  flex-direction: column;
}
.xp-lu-kind {
  font: 800 9px var(--sans);
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--hud-danger, #e63946);
}
.xp-lu-name {
  font: 400 22px/1 var(--pixel);
  letter-spacing: 0.03em;
}
.xp-lu-new {
  font: 800 11px var(--sans);
  letter-spacing: 0.2em;
  color: #fff;
  background: var(--hud-ink, #111);
  padding: 3px 10px;
  transform: rotate(-2deg);
}

/* The match's XP: under the final scores, over the hotbar (nothing to hold till the next). */
.xp-match {
  position: absolute;
  left: 50%;
  bottom: 16px;
  /* Clear of the health bar and the rounds either side, where there's room. */
  width: clamp(min(420px, calc(100vw - 32px)), calc(100vw - 640px), 720px);
  transform: translateX(-50%);
  padding: 12px 16px 14px;
  background: var(--hud-paper, #fdf1d6);
  color: var(--hud-fg, #111);
  border: 3px solid var(--hud-ink, #111);
  border-radius: 4px;
  box-shadow: 6px 6px 0 var(--hud-ink, #111);
  pointer-events: none;
  animation: xp-rise 420ms cubic-bezier(0.3, 1.5, 0.5, 1) both;
}
.xp-m-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 8px;
}
.xp-m-title {
  font: 400 24px var(--pixel);
  letter-spacing: 0.04em;
}
.xp-m-total {
  font: 400 34px/1 var(--pixel);
  color: var(--hud-accent, #ffcc00);
  -webkit-text-stroke: 2px var(--hud-ink, #111);
  paint-order: stroke fill;
  text-shadow: 3px 3px 0 var(--hud-ink, #111);
}
.xp-m-lines {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 12px;
}
.xp-m-line {
  display: flex;
  align-items: baseline;
  gap: 6px;
  padding: 3px 8px;
  border: 2px solid var(--hud-ink, #111);
  border-radius: 3px;
  background: rgba(0, 0, 0, 0.06);
  font: 700 11px var(--sans);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  animation: xp-in 300ms cubic-bezier(0.3, 1.8, 0.5, 1) both;
}
.xp-m-line b {
  font: 400 16px var(--pixel);
  letter-spacing: 0.02em;
}
.xp-m-none {
  font: 600 12px var(--sans);
  opacity: 0.7;
}
.xp-m-level {
  display: flex;
  align-items: center;
  gap: 12px;
}
.xp-m-level .xp-badge {
  box-shadow: 3px 3px 0 var(--hud-ink, #111);
}
.xp-m-level .xp-track {
  flex: 1;
  width: auto;
  height: 14px;
  background: rgba(0, 0, 0, 0.12);
  box-shadow: none;
}
.xp-m-level .xp-fill {
  transition-duration: 1400ms;
  transition-delay: 500ms;
}
.xp-m-level .xp-was {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  background: rgba(17, 17, 17, 0.35);
  z-index: 1;
}
.xp-m-up {
  font: 400 18px var(--pixel);
  color: var(--hud-danger, #e63946);
  letter-spacing: 0.04em;
  white-space: nowrap;
}
.xp-m-unlocks {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
}
.xp-m-unlocks .xp-lu-card {
  padding: 3px 10px 3px 6px;
  box-shadow: 3px 3px 0 var(--hud-ink, #111);
}
.xp-m-unlocks .xp-lu-card img {
  width: 48px;
  height: 26px;
}
.xp-m-unlocks .xp-lu-card.outfit img {
  width: 28px;
  height: 34px;
}
.xp-m-unlocks .xp-lu-name {
  font-size: 17px;
}
.xp-m-note {
  margin-top: 6px;
  font: 600 11px var(--sans);
  opacity: 0.75;
}

@keyframes xp-in {
  from { transform: translateX(-14px) scale(1.4); opacity: 0; }
}
@keyframes xp-pop {
  from { transform: scale(1.35); }
}
@keyframes xp-badge-bump {
  0% { transform: skewX(-8deg) scale(1); }
  30% { transform: skewX(-8deg) scale(1.45); background: #fff; }
}
@keyframes xp-drop {
  from { transform: translate(-50%, 40px) scale(1.5); opacity: 0; }
}
@keyframes xp-rise {
  from { transform: translate(-50%, 30px); opacity: 0; }
}
@keyframes xp-spin {
  to { transform: scale(0.9) rotate(360deg); }
}
`;

/** Brass up an octave, for a level-up. */
function fanfare(client: Client) {
  client.audio.define('level_up', (s) => {
    const notes: [number, number, number][] = [
      [311, 0, 0.1],
      [392, 0.1, 0.1],
      [466, 0.2, 0.1],
      [622, 0.3, 0.7],
      [784, 0.3, 0.7],
      [932, 0.3, 0.7],
    ];
    for (const [f, delay, duration] of notes) {
      s.tone({ wave: 'sawtooth', from: f, to: f * 1.004, duration, volume: 0.09, delay, lowpass: 2600, attack: 0.012, vibrato: duration > 0.3 ? { rate: 6, depth: 5 } : undefined });
    }
    s.noise({ duration: 0.6, delay: 0.3, filter: 'highpass', from: 6000, to: 3000, volume: 0.05 });
  });
}

/** The XP HUD, as a kit of the game's own (`client.ts` lists it). */
export function progressionHud(): ClientKit {
  let unstyle: (() => void) | null = null;
  let frame: ((dt: number) => void) | null = null;
  return {
    name: 'callofblocky.progression',
    setup(client) {
      unstyle = client.hud.style(CSS);
      fanfare(client);
      frame = draw(client);
    },
    frame(_client, dt) {
      frame?.(dt);
    },
    dispose() {
      unstyle?.();
    },
  };
}

/** Puts the XP HUD on this screen and listens for the server's word; returns what runs each frame. */
function draw(client: Client): (dt: number) => void {
  const layer = client.hud.layer('xp');
  // (A replay on screen, the kill cam: the XP HUD steps aside with the rest of the live HUD.)
  let hiddenForReplay = false;

  // The bar and badge.
  const badgeNum = el('span.xp-badge-num', '1');
  const badge = el('div.xp-badge', el('span.xp-badge-lv', 'LV'), badgeNum);
  const fill = el('div.xp-fill');
  const fresh = el('div.xp-new');
  const text = el('div.xp-text');
  const bar = el('div.xp-bar', badge, el('div.xp-body', el('div.xp-track', fresh, fill), text));
  bar.style.display = 'none';
  layer.append(bar);
  let shown: XpState | null = null;

  const pct = (s: XpState) => (s.need > 0 ? Math.max(0, Math.min(1, s.into / s.need)) : 1);
  const showBar = (s: XpState) => {
    const up = shown !== null && s.level > shown.level;
    bar.style.display = '';
    badgeNum.textContent = String(s.level);
    badge.classList.toggle('max', s.need === 0);
    if (up) {
      badge.classList.remove('bump');
      void badge.offsetWidth;
      badge.classList.add('bump');
      // A new level: the bar starts again from empty.
      fill.style.transition = fresh.style.transition = 'none';
      fill.style.width = fresh.style.width = '0%';
      void fill.offsetWidth;
      fill.style.transition = fresh.style.transition = '';
    }
    // What's new shows white at once, then the gold catches up.
    fresh.style.width = `${pct(s) * 100}%`;
    fill.style.width = `${pct(s) * 100}%`;
    text.textContent = s.need > 0 ? `${num(s.into)} / ${num(s.need)} XP${s.guest ? ' · guest, not kept' : ''}` : `Top level · ${num(s.total)} XP`;
    shown = s;
  };

  // The ticker.
  const ticker = el('div.xp-ticker');
  layer.append(ticker);
  let sum = 0;
  let sumEl: HTMLElement | null = null;
  let fadeAt = 0;
  let queue: Gain[] = [];
  let nextLine = 0;
  let fadeTimer = 0;
  const clearTicker = () => {
    window.clearTimeout(fadeTimer);
    ticker.replaceChildren();
    ticker.classList.remove('fade');
    sum = 0;
    sumEl = null;
    queue = [];
  };
  const tick = (gains: Gain[]) => {
    if (ticker.classList.contains('fade')) clearTicker();
    queue.push(...gains);
    fadeAt = client.time + 2.4 + queue.length * 0.09;
  };

  // A level-up. (It's shown next frame: one that came with the match's end goes on its card instead.)
  let levelUp: HTMLElement | null = null;
  let levelUpUntil = 0;
  let pending: LevelUp | null = null;
  const unlockCard = (u: LevelUp['unlocks'][number], i: number) => {
    const card = el(`div.xp-lu-card.${u.kind}`, u.icon ? client.hud.icon(u.icon) : null, el('div.xp-lu-text', el('span.xp-lu-kind', `${KIND[u.kind] ?? u.kind} unlocked`), el('span.xp-lu-name', u.name)));
    card.style.animationDelay = `${350 + i * 140}ms`;
    return card;
  };
  const showLevelUp = (d: LevelUp) => {
    levelUp?.remove();
    const cards = d.unlocks.map(unlockCard);
    levelUp = el(
      'div.xp-levelup',
      el('div.xp-lu-head', el('div.xp-lu-title', 'LEVEL UP!'), el('div.xp-lu-burst', el('span.xp-lu-num', String(d.level)))),
      cards.length ? el('div.xp-lu-unlocks', ...cards) : el('div.xp-lu-new', 'KEEP GOING'),
    );
    layer.append(levelUp);
    levelUpUntil = client.time + 4.5 + cards.length * 0.3;
    client.audio.play('level_up');
  };

  // The match's XP.
  let card: HTMLElement | null = null;
  let matchIn = false;
  const showMatch = (m: MatchXp) => {
    card?.remove();
    clearTicker();
    // (A level-up still showing gives way to the card, where the match's own go.)
    levelUp?.remove();
    levelUp = null;
    matchIn = true;
    const lines = m.lines.map(([label, count, amount], i) => {
      const e = el('div.xp-m-line', `${label}${count > 1 ? ` ×${count}` : ''}`, el('b', `+${num(amount)}`));
      e.style.animationDelay = `${300 + i * 70}ms`;
      return e;
    });
    const was = el('div.xp-was');
    const mfill = el('div.xp-fill');
    const up = m.level - m.from;
    // From where the match started (when it's the same level), to where they are now.
    const start = up > 0 ? 0 : Math.max(0, m.into - m.earned);
    mfill.style.width = m.need > 0 ? `${(start / m.need) * 100}%` : '100%';
    was.style.width = m.need > 0 ? `${(start / m.need) * 100}%` : '0%';
    card = el(
      'div.xp-match',
      el('div.xp-m-head', el('span.xp-m-title', 'THIS MATCH'), el('span.xp-m-total', `+${num(m.earned)} XP`)),
      lines.length ? el('div.xp-m-lines', ...lines) : el('div.xp-m-lines', el('span.xp-m-none', 'Nothing this time. Get in there.')),
      el(
        'div.xp-m-level',
        el(`div.xp-badge${m.need === 0 ? '.max' : ''}`, el('span.xp-badge-lv', 'LV'), el('span.xp-badge-num', String(m.level))),
        el('div.xp-track', mfill, was),
        up > 0 ? el('span.xp-m-up', up > 1 ? `+${up} LEVELS` : 'LEVEL UP') : el('span.xp-m-up', m.need > 0 ? `${num(m.need - m.into)} to go` : 'TOP LEVEL'),
      ),
      m.guest ? el('div.xp-m-note', 'Playing as a guest: sign in with Discord on the home page to keep your XP.') : null,
    );
    layer.append(card);
    void mfill.offsetWidth;
    mfill.style.width = `${pct(m) * 100}%`;
  };

  client.on('xp', (d) => {
    if (!obj(d) || typeof d.level !== 'number') return;
    const s = d as unknown as XpState;
    showBar(s);
    if (Array.isArray(s.gains) && s.gains.length) tick(s.gains);
  });
  client.on('xp.level', (d) => {
    if (!obj(d) || typeof d.level !== 'number' || !Array.isArray(d.unlocks)) return;
    // Several at once (a big win): all their unlocks, the newest level.
    const l = d as unknown as LevelUp;
    pending = pending ? { level: l.level, unlocks: [...pending.unlocks, ...l.unlocks] } : l;
  });
  client.on('xp.match', (d) => {
    if (obj(d) && typeof d.level === 'number' && Array.isArray(d.lines)) showMatch(d as unknown as MatchXp);
  });

  return (dt: number) => {
    const replaying = client.replay.playing;
    if (replaying !== hiddenForReplay) {
      hiddenForReplay = replaying;
      layer.style.visibility = replaying ? 'hidden' : '';
    }
    const now = client.time;
    // A level-up: on its own, or (at the end of a match) on the match's card.
    if (pending) {
      const l = pending;
      pending = null;
      if (matchIn && card) {
        if (l.unlocks.length) card.append(el('div.xp-m-unlocks', ...l.unlocks.map(unlockCard)));
      } else showLevelUp(l);
    }
    matchIn = false;
    // A new match (a restart): what was up for the last one goes.
    if (client.events.some((e) => e.t === 'reset')) {
      clearTicker();
      card?.remove();
      card = null;
    }
    bar.style.visibility = client.me.id ? '' : 'hidden';
    // The ticker's lines, one after another.
    nextLine -= dt;
    while (queue.length && nextLine <= 0) {
      const [n, label] = queue.shift()!;
      sum += n;
      if (!sumEl) {
        sumEl = el('div.xp-sum');
        ticker.prepend(sumEl);
      }
      sumEl.textContent = `+${num(sum)}`;
      sumEl.classList.remove('bump');
      void sumEl.offsetWidth;
      sumEl.classList.add('bump');
      const line = el('div.xp-line', el('b', `+${num(n)}`), label);
      ticker.append(line);
      // No more than a handful at once: the oldest go.
      while (ticker.children.length > 7) ticker.children[1].remove();
      nextLine = 0.09;
    }
    if (sumEl && !queue.length && now > fadeAt && !ticker.classList.contains('fade')) {
      ticker.classList.add('fade');
      fadeTimer = window.setTimeout(clearTicker, 500);
    }
    if (levelUp && now > levelUpUntil) {
      const going = levelUp;
      levelUp = null;
      going.classList.add('out');
      window.setTimeout(() => going.remove(), 520);
    }
  };
}
