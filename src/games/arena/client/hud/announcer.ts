import type { Client, ClientKit } from '@platform/client';
import { MSG, type CallMsg } from '../../hud/messages';
import css from './announcer.css?raw';
import { el, hidden, hud, replay } from './store';

/** How long each kind of callout holds the screen (seconds), and its sting. */
const KINDS: Record<CallMsg['k'], { time: number; sting: string; big: boolean }> = {
  wave: { time: 2.5, sting: 'ar_sting_wave', big: true },
  final: { time: 3.2, sting: 'ar_sting_final', big: true },
  boss: { time: 2.6, sting: 'ar_sting_boss', big: true },
  endless: { time: 3, sting: 'ar_sting_final', big: true },
  // (A blessing's own chime is the armory's, played by the server.)
  blessing: { time: 2.4, sting: '', big: true },
  twist: { time: 2.6, sting: 'ar_sting_twist', big: true },
  favour: { time: 2.8, sting: 'ar_sting_favour', big: true },
  out: { time: 3.2, sting: 'ar_sting_out', big: true },
  back: { time: 1.8, sting: 'ar_sting_back', big: true },
  victory: { time: 3.2, sting: 'ar_sting_victory', big: true },
  defeat: { time: 2.2, sting: 'ar_sting_defeat', big: true },
  feat: { time: 2, sting: 'ar_sting_feat', big: false },
  ally: { time: 2.2, sting: 'ar_sting_ally', big: false },
};

/** A callout still waiting this long (ms) has missed its moment. */
const STALE = 4000;

/** How big each feat is, 0..3 (louder, higher, bigger): the multikills climb; the rest by how rare a thing it is. */
const TIER: Record<string, number> = {
  double_kill: 0,
  triple_kill: 1,
  multi_kill: 2,
  rampage: 3,
  kaboom: 2,
  goblin: 2,
  boss_stagger: 2,
  boss_crash: 2,
  last_stand: 2,
  forge: 0,
  boss_egg: 0,
  trap: 0,
};
/** Feats with words past this many letters come smaller. */
const LONG = 16;
/** The multikills: one climbing callout (a double kill becomes a triple in place). */
const MULTI = new Set(['double_kill', 'triple_kill', 'multi_kill', 'rampage']);
/** At most this many small callouts at once; in a burst (all of them younger than `BUSY` seconds) the lesser feats are let go. */
const MAX_SMALL = 2;
const BUSY = 0.8;
/** Feats' stings come at most this often (seconds), but for the big ones. */
const STING_EVERY = 0.25;

/**
 * The announcer, on each screen: big callouts in the middle of the screen for the run's moments (a
 * wave begins, a boss's, the final one, the endless ones, its twist, the Crowd's Favour, a
 * blessing taken, their own fall and return, victory and defeat), each with its sting
 * (`client/sounds/hud.ts`); smaller ones under the crosshair for their feats (a double kill, a
 * parry: bigger and higher the bigger the feat) and their friends' fortunes; and the last seconds
 * before a wave counted down, a drum a second. Big callouts wait their turn (victory and defeat
 * don't), and wait while something else has the screen. In a busy fight the small ones don't pile
 * up: a feat of a kind already showing takes its place (a double kill climbing to a triple), no
 * more than two are up, the lesser ones are let go in a burst, and their stings are spaced out.
 */
export function announcer(): ClientKit {
  let unstyle: (() => void) | null = null;
  let layer: HTMLElement;
  let stage: HTMLElement;
  let feats: HTMLElement;
  let count: HTMLElement;
  /** Big callouts waiting their turn, and when each came (wall-clock ms: one held up while the tab was away is stale). */
  let queue: { c: CallMsg; at: number }[] = [];
  let showing: { el: HTMLElement; until: number } | null = null;
  let lastCount = '';
  /** The small callouts up: each one's element, its family (its feat's kind; the multikills are one), its size, when it came and when it goes. */
  let small: { el: HTMLElement; family: string; tier: number; born: number; until: number }[] = [];
  let lastSting = -1;

  const show = (client: Client, c: CallMsg) => {
    const k = KINDS[c.k];
    showing?.el.remove();
    const e = el(`div.ar-call.k-${c.k}`, c.q ? el('div.ar-call-q', c.q) : null, el('div.ar-call-t', c.t), el('div.ar-call-rule'), c.s ? el('div.ar-call-s', c.s) : null);
    if (c.c) e.style.setProperty('--c', c.c);
    stage.append(e);
    showing = { el: e, until: client.time + k.time };
    if (k.sting) client.audio.play(k.sting, { volume: 0.9 });
  };

  const feat = (client: Client, c: CallMsg) => {
    const k = KINDS[c.k];
    const tier = c.name ? (TIER[c.name] ?? 1) : 0;
    const family = c.k === 'feat' ? (MULTI.has(c.name ?? '') ? 'multi' : (c.name ?? c.t)) : `${c.k}:${c.t}`;
    const now = client.time;
    const same = small.find((s) => s.family === family);
    // A burst: the lesser feats are let go rather than piling up.
    if (!same && tier < 2 && small.length >= MAX_SMALL && small.every((s) => now - s.born < BUSY)) return;
    const e = same?.el ?? el('div.ar-feat');
    e.className = `ar-feat t${tier} k-${c.k}${c.t.length > LONG ? ' long' : ''}`;
    e.replaceChildren(el('div.ar-feat-t', c.t), ...(c.s ? [el('div.ar-feat-s', c.s)] : []));
    if (c.c) e.style.setProperty('--c', c.c);
    else e.style.removeProperty('--c');
    if (same) {
      // The one of its kind takes the news, bumped and timed again.
      replay(e, 'bump');
      Object.assign(same, { tier, born: now, until: now + k.time });
    } else {
      feats.prepend(e);
      small.unshift({ el: e, family, tier, born: now, until: now + k.time });
      // Too many: the least of them goes (the oldest of the least).
      while (small.length > MAX_SMALL) {
        const least = small.reduce((a, b) => (b.tier < a.tier || (b.tier === a.tier && b.born <= a.born) ? b : a));
        least.el.remove();
        small = small.filter((s) => s !== least);
      }
    }
    if (tier < 2 && now - lastSting < STING_EVERY) return;
    lastSting = now;
    client.audio.play(k.sting, { volume: 0.8 + tier * 0.1, pitch: c.k === 'feat' ? 1 + tier * 0.12 : 1 });
  };

  return {
    name: 'arena.hud.announcer',
    setup(client) {
      unstyle = client.hud.style(css);
      layer = client.hud.layer('arena.announcer', 'panels');
      stage = el('div.ar-stage');
      feats = el('div.ar-feats');
      count = el('div.ar-count');
      layer.append(count, stage, feats);
      client.on(MSG.call, (d) => {
        const c = d as CallMsg;
        if (!c || typeof c.t !== 'string' || !(c.k in KINDS)) return;
        if (!KINDS[c.k].big) return feat(client, c);
        // The run's end takes the stage at once; the rest wait their turn.
        if (c.k === 'victory' || c.k === 'defeat') {
          queue = [];
          show(client, c);
        } else queue.push({ c, at: performance.now() });
      });
    },
    frame(client, dt) {
      const off = hidden(client);
      layer.style.visibility = off ? 'hidden' : '';
      if (client.events.some((e) => e.t === 'reset')) {
        queue = [];
        showing?.el.remove();
        showing = null;
        feats.replaceChildren();
        small = [];
      }
      // The small ones whose time is up go.
      for (const s of small.filter((x) => client.time >= x.until)) {
        s.el.classList.add('out');
        window.setTimeout(() => s.el.remove(), 420);
      }
      small = small.filter((x) => client.time < x.until);
      // Someone else has the screen (a boss's entrance, its fall: they fade the HUD out): the callouts wait.
      if (!off && (showing || queue.length) && !layer.checkVisibility({ opacityProperty: true })) {
        if (showing) showing.until += dt;
        for (const q of queue) q.at += dt * 1000;
        return;
      }
      if (showing && client.time >= showing.until) {
        const going = showing.el;
        going.classList.add('out');
        window.setTimeout(() => going.remove(), 450);
        showing = null;
      }
      queue = queue.filter((q) => performance.now() - q.at < STALE);
      if (!showing && queue.length) show(client, queue.shift()!.c);

      // The last three seconds before a wave, a drum each.
      const r = hud.run;
      const n = r && (r.phase === 'countdown' || r.phase === 'intermission') && r.next > 0 && r.next <= 3 ? r.next : 0;
      const key = n ? `${r!.phase}${r!.wave}:${n}` : '';
      if (key !== lastCount) {
        lastCount = key;
        if (n) {
          count.replaceChildren(el('span', String(n)));
          client.audio.play('ar_count', { volume: 0.8, pitch: 1 + (3 - n) * 0.06 });
        }
      }
    },
    dispose() {
      unstyle?.();
    },
  };
}
