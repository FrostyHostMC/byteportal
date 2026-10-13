import type { Client, ClientKit } from '@platform/client';
import { HERO_ABILITY, activeOf, coolOf, type HeroMove } from '../abilities';
import { HEROES, heroByNumber, usesSaber, type HeroId, type PowerId } from '../defs';
import { GUARD } from '../tuning';
import type { HeroScene } from './state';

/** A mark for each power (plain text: the HUD's font draws it). */
const GLYPH: Record<PowerId, string> = {
  push: '⟫',
  rush: '➤',
  leap: '⤒',
  pull: '⟪',
  soresu: '◈',
  throw: '↻',
  choke: '✊',
  rage: '✹',
  lightning: 'ϟ',
  chain: '⌁',
  aura: '◉',
  scatter: '⋔',
  charge: '⏵',
  roar: '✺',
  rocket: '➹',
  flame: '♨',
  jetpack: '⇡',
};

const CSS = `
/* While a hero's panel is up it stands in for the hotbar (a saber alone) and the small health bar. */
body.bfh-on .hotbar, body.bfh-on .healthbar { visibility: hidden; }
.bfh-hero { position: absolute; left: 50%; bottom: 20px; transform: translateX(-50%); display: flex; flex-direction: column; align-items: stretch; gap: 7px; width: min(520px, 92vw); pointer-events: none; font-family: var(--sans, system-ui); color: #f3f5f7; --blade: #5dff6a; text-shadow: 0 1px 6px rgba(0, 0, 0, 0.55); animation: bfh-in 360ms cubic-bezier(0.2, 0.7, 0.2, 1); }
.bfh-hero.off { display: none; }
.bfh-hero { z-index: 0; filter: drop-shadow(0 0 1px rgba(0, 0, 0, 0.6)) drop-shadow(0 1px 4px rgba(0, 0, 0, 0.35)); }
/* (No panel behind it: a tight dark halo round each mark, its filter, keeps it readable over snow and sky.) */
.bfh-top { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
.bfh-name { font: 500 22px/1 var(--pixel, sans-serif); letter-spacing: 0.14em; text-transform: uppercase; color: #f3f5f7; }
.bfh-title { font: 600 10px var(--pixel); letter-spacing: 0.32em; text-transform: uppercase; color: color-mix(in srgb, var(--blade) 70%, white); margin-left: 12px; }
.bfh-hp-n { font: 500 20px/1 var(--pixel); font-variant-numeric: tabular-nums; }
.bfh-hp-n small { font-size: 12px; opacity: 0.5; letter-spacing: 0.06em; }
.bfh-bar { position: relative; height: 5px; background: rgba(255, 255, 255, 0.14); }
.bfh-bar > i { position: absolute; left: 0; top: 0; bottom: 0; width: calc(var(--fill, 1) * 100%); transition: width 0.12s linear; }
/* Health: twenty segments, white, what was lost fading after it. */
.bfh-hp { -webkit-mask: repeating-linear-gradient(90deg, #000 0 calc(5% - 2px), transparent calc(5% - 2px) 5%); mask: repeating-linear-gradient(90deg, #000 0 calc(5% - 2px), transparent calc(5% - 2px) 5%); }
.bfh-hp > i { background: #f3f5f7; }
.bfh-hp.low > i { background: #ff5a4f; animation: bfh-pulse 1s ease-in-out infinite; }
.bfh-hp > b { position: absolute; left: 0; top: 0; bottom: 0; width: calc(var(--lost, 1) * 100%); background: rgba(255, 90, 79, 0.7); transition: width 0.6s ease-out 0.25s; }
.bfh-guard-row { display: flex; align-items: center; gap: 10px; }
.bfh-hero.gun .bfh-guard-row { display: none; }
.bfh-guard-l { font: 600 9px var(--pixel); letter-spacing: 0.3em; color: rgba(243, 245, 247, 0.78); min-width: 46px; }
.bfh-guard { flex: 1; height: 2px; }
.bfh-guard > i { background: #bfe6ff; box-shadow: 0 0 6px rgba(159, 216, 255, 0.8); }
.bfh-guard-row.up .bfh-guard-l { color: #9fd8ff; }
.bfh-guard-row.broken .bfh-guard-l { color: #ff5a4f; animation: bfh-pulse 0.5s ease-in-out infinite; }
.bfh-guard-row.broken .bfh-guard > i { background: #ff5a4f; box-shadow: 0 0 6px #ff5a4f; }
/* The powers: a round icon each, its cooldown sweeping round it, its key on a small tag. */
.bfh-powers { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-top: 6px; }
.bfh-p { position: relative; display: flex; flex-direction: column; align-items: center; gap: 6px; text-align: center; }
.bfh-p .ic { position: relative; flex: none; width: 48px; height: 48px; border-radius: 50%; display: grid; place-items: center; font: 500 21px var(--sans); color: #f3f5f7; background: radial-gradient(circle at 50% 35%, rgba(255, 255, 255, 0.1), rgba(9, 13, 19, 0.7) 70%); box-shadow: inset 0 0 0 1.5px rgba(255, 255, 255, 0.28), 0 4px 14px rgba(0, 0, 0, 0.35); transition: box-shadow 200ms ease, color 200ms ease; backdrop-filter: blur(6px); }
.bfh-p .cd { position: absolute; inset: 0; border-radius: 50%; background: conic-gradient(rgba(5, 8, 12, 0.72) calc(var(--cd, 0) * 360deg), transparent 0); }
.bfh-p .key { position: absolute; left: 50%; bottom: -6px; transform: translateX(-50%); min-width: 16px; padding: 0 4px; border-radius: 3px; font: 600 10px/15px var(--pixel); letter-spacing: 0.04em; text-shadow: none; background: #f3f5f7; color: #0b0f14; }
.bfh-p .nm { margin-top: 4px; font: 600 11px/1.1 var(--pixel); letter-spacing: 0.2em; text-transform: uppercase; color: rgba(243, 245, 247, 0.9); }
.bfh-p .st { font: 500 11px var(--pixel); letter-spacing: 0.12em; color: rgba(243, 245, 247, 0.5); font-variant-numeric: tabular-nums; }
.bfh-p.cooling .ic { color: rgba(243, 245, 247, 0.45); }
.bfh-p.cooling .nm { opacity: 0.55; }
.bfh-p.ready .ic { color: #fff; box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--blade) 80%, white), 0 0 14px color-mix(in srgb, var(--blade) 35%, transparent); }
.bfh-p.ready .key { background: var(--hud-accent, #ffe81f); }
.bfh-p.ready .st { color: color-mix(in srgb, var(--blade) 70%, white); }
.bfh-p.just .ic { animation: bfh-ready 0.6s ease-out; }
.bfh-p.on .ic { box-shadow: inset 0 0 0 2px var(--blade), 0 0 22px color-mix(in srgb, var(--blade) 55%, transparent); color: #fff; }
.bfh-p .left { position: absolute; left: 50%; top: 0; width: 48px; height: 48px; margin-left: -24px; border-radius: 50%; background: conic-gradient(var(--blade) calc(var(--on, 0) * 360deg), transparent 0); -webkit-mask: radial-gradient(closest-side, transparent calc(100% - 2.5px), #000 calc(100% - 2px)); mask: radial-gradient(closest-side, transparent calc(100% - 2.5px), #000 calc(100% - 2px)); }
@keyframes bfh-pulse { 50% { opacity: 0.5; } }
@keyframes bfh-ready { 0% { transform: scale(1.12); box-shadow: inset 0 0 0 2px #fff, 0 0 26px var(--blade); } }
@keyframes bfh-in { from { opacity: 0; transform: translate(-50%, 10px); } }
@media (max-width: 700px) { .bfh-p .nm { font-size: 9px; letter-spacing: 0.1em; } .bfh-p .st { display: none; } }
`;

interface Card {
  root: HTMLElement;
  cd: HTMLElement;
  st: HTMLElement;
  was: string;
}

/**
 * The hero HUD, bottom middle (it reads well over the shoulder, under the figure): the hero's
 * name and a slim segmented health bar (what was lost fading after it), the guard's meter (lit
 * while it's up, red when it's broken), and their three powers as round icons with their keys,
 * each darkened by a sweep as it cools down, ringed while one that lasts is on, flaring as it's
 * ready again. It reads this screen's own state:
 * their health, and their movement ability's (`client.me.abilities.hero`: the cooldowns and the
 * meter, counting down here as the server has them).
 */
export function heroHud(scene: HeroScene): ClientKit {
  let el: HTMLElement | null = null;
  let hero: HeroId | null = null;
  let name: HTMLElement;
  let title: HTMLElement;
  let hpBar: HTMLElement;
  let hpN: HTMLElement;
  let guardRow: HTMLElement;
  let guardBar: HTMLElement;
  let cards: Card[] = [];
  const set = (e: HTMLElement, k: string, v: string) => {
    if (e.style.getPropertyValue(k) !== v) e.style.setProperty(k, v);
  };
  const text = (e: HTMLElement, v: string) => {
    if (e.textContent !== v) e.textContent = v;
  };
  const cls = (e: HTMLElement, c: string, on: boolean) => {
    if (e.classList.contains(c) !== on) e.classList.toggle(c, on);
  };

  const build = (client: Client) => {
    client.hud.style(CSS);
    const layer = client.hud.layer('bfh-hero', 'panels');
    el = document.createElement('div');
    el.className = 'bfh-hero off';
    el.innerHTML = `
      <div class="bfh-top"><div><span class="bfh-name"></span><span class="bfh-title"></span></div><div class="bfh-hp-n"></div></div>
      <div class="bfh-bar bfh-hp"><b></b><i></i></div>
      <div class="bfh-guard-row"><span class="bfh-guard-l">GUARD</span><div class="bfh-bar bfh-guard"><i></i></div></div>
      <div class="bfh-powers"></div>`;
    layer.appendChild(el);
    name = el.querySelector('.bfh-name')!;
    title = el.querySelector('.bfh-title')!;
    hpBar = el.querySelector('.bfh-hp')!;
    hpN = el.querySelector('.bfh-hp-n')!;
    guardRow = el.querySelector('.bfh-guard-row')!;
    guardBar = el.querySelector('.bfh-guard')!;
  };

  const become = (id: HeroId) => {
    hero = id;
    const h = HEROES[id];
    set(el!, '--blade', h.blade);
    text(name, h.name);
    text(title, h.title);
    const box = el!.querySelector('.bfh-powers')!;
    box.innerHTML = '';
    cards = h.powers.map((p) => {
      const root = document.createElement('div');
      root.className = 'bfh-p';
      root.innerHTML = `<div class="ic">${GLYPH[p.id]}<div class="cd"></div><span class="key">${p.key.slice(3)}</span></div><div><div class="nm"></div><div class="st"></div></div><div class="left"></div>`;
      root.querySelector('.nm')!.textContent = p.name;
      box.appendChild(root);
      return { root, cd: root.querySelector('.cd')!, st: root.querySelector('.st')!, was: '' };
    });
  };

  return {
    name: 'blockfront.heroes.hud',
    frame(client) {
      if (!el) build(client);
      const me = client.me;
      const m = me.abilities[HERO_ABILITY] as unknown as HeroMove | undefined;
      const id = m ? heroByNumber(m.h) : null;
      const show = !!id && !me.dead && !client.replay.playing;
      cls(el!, 'off', !show);
      cls(document.body, 'bfh-on', show);
      if (!show || !id || !m) {
        hero = null;
        return;
      }
      if (id !== hero) become(id);
      const h = HEROES[id];
      // A hero with a blaster has no guard to show.
      cls(el!, 'gun', !usesSaber(id));
      // Health: the bar, and what was lost fading after it (its own, slower transition).
      const fill = Math.max(0, Math.min(1, me.health / (me.maxHealth || h.health)));
      set(hpBar, '--fill', fill.toFixed(3));
      set(hpBar, '--lost', fill.toFixed(3));
      cls(hpBar, 'low', fill < 0.25);
      hpN.innerHTML = `${Math.ceil(me.health)} <small>/ ${me.maxHealth || h.health}</small>`;
      // The guard: up, broken, or at rest.
      const meter = Math.max(0, Math.min(1, m.m / GUARD.meter));
      set(guardBar, '--fill', meter.toFixed(3));
      const broken = !m.g && m.m < 8;
      cls(guardRow, 'broken', broken);
      cls(guardRow, 'up', !broken && !!m.g && client.input.button(2));
      // Each power: cooling (darkened, seconds left), on (lit, what's left of it), or ready.
      h.powers.forEach((p, i) => {
        const c = cards[i];
        if (!c) return;
        const cool = coolOf(m, i);
        const on = activeOf(m, i);
        const state = on > 0 ? 'on' : cool > 0 ? 'cooling' : 'ready';
        cls(c.root, 'on', state === 'on');
        cls(c.root, 'cooling', state === 'cooling');
        cls(c.root, 'ready', state === 'ready');
        if (c.was === 'cooling' && state === 'ready') {
          c.root.classList.remove('just');
          void c.root.offsetWidth;
          c.root.classList.add('just');
        }
        c.was = state;
        set(c.cd, '--cd', state === 'cooling' ? Math.min(1, cool / p.cooldown).toFixed(3) : '0');
        set(c.root, '--on', on > 0 && p.lasts ? Math.min(1, on / p.lasts).toFixed(3) : '0');
        text(c.st, state === 'cooling' ? `${cool.toFixed(cool < 3 ? 1 : 0)} s` : state === 'on' ? (p.hold ? 'HOLDING' : 'ACTIVE') : p.hold ? 'HOLD ' + p.key.slice(3) : 'READY');
      });
      void scene;
    },
    dispose() {
      document.body.classList.remove('bfh-on');
    },
  };
}
