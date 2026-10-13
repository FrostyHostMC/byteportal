import type { Client, ClientKit, Figure } from '@platform/client';
import { MSG, type GoreMsg, type HitMsg } from '../../hud/messages';
import { CHAIN } from '../../hud/tally';
import { el, hidden, linear, replay } from './store';

/** A hit this heavy (0..1, against the monster's health) stops time on it a moment; a kill a little less. */
const STOP = 0.45;
const STOP_KILL = 0.25;
/** Gore further off than this (blocks) is left to the platform's own burst. */
const GORE_RANGE = 70;

type Pose = { p: { x: number; y: number; z: number }; joints: [Figure['root'], { x: number; y: number; z: number }, { x: number; y: number; z: number; w: number }][] };

/**
 * The feel of a hit, on the fighter's own screen, from the server's word on every hit of theirs
 * that lands (`hit`: bow, blade, bomb or blessing alike):
 *
 * - a hit marker round the crosshair (the platform's steps aside), bigger for a heavier hit, gold
 *   for a heavy one, a kill's in blood with a ring breaking out, each with its own short sound
 *   over the weapon's own (a dry knock, a crunch, the kill's crunch and confirm);
 * - hit-stop: a heavy hit (or a kill) holds the monster still for a few hundredths of a second
 *   (its figure's pose and place kept), the view punching in a touch and shaking;
 * - the chain: kills coming quick (within `CHAIN` seconds of each other) counted by the crosshair,
 *   the time to keep it going running out under the count;
 *
 * and, on everyone's screen, gore: a monster's death bursts into chunks in its own colour that
 * fall and land (a boss's into a great many), with a wet splat.
 */
export function hits(): ClientKit {
  let unstyle: (() => void) | null = null;
  let layer: HTMLElement;
  let chainEl: HTMLElement;
  let chainN: HTMLElement;
  let chainBar: HTMLElement;
  let lastSound = 0;
  /** The figures held still (by entity id): until when, and as they were. */
  const stopped = new Map<number, { until: number; pose: Pose | null }>();
  /** Holds asked for since the last frame (taken when the figure's next posed). */
  const asked = new Map<number, number>();
  let chain = { n: 0, at: -Infinity };
  /** The view's punch (zoom), easing back, and what of the zoom is ours. */
  let punch = 0;
  let applied = 1;

  const marker = (h: HitMsg) => {
    const kill = !!h.k;
    const heavy = h.h >= 0.5;
    const e = el(`div.ar-hit${kill ? '.kill' : heavy ? '.heavy' : ''}`);
    e.style.setProperty('--s', (kill ? 1.25 : 0.7 + 0.55 * Math.min(1, h.h * 1.4)).toFixed(2));
    e.append(...['a', 'b', 'c', 'd'].map((k) => el(`i.${k}`)));
    if (kill) e.append(el('b.ring'), el('b.ring.r2'));
    for (const old of layer.querySelectorAll('.ar-hit:not(.kill)')) old.remove();
    layer.append(e);
    window.setTimeout(() => e.remove(), kill ? 750 : 380);
  };

  const onHit = (client: Client, h: HitMsg) => {
    marker(h);
    const t = client.time;
    if (h.k) {
      client.audio.play(h.b ? 'ar_kill_boss' : 'ar_kill', { volume: 0.85 });
      client.fx.shake(h.b ? 0.5 : 0.045 + h.h * 0.04, h.b ? 0.9 : 0.16);
      chain = t - chain.at <= CHAIN ? { n: chain.n + 1, at: t } : { n: 1, at: t };
      if (chain.n >= 2) {
        chainN.textContent = `×${chain.n}`;
        chainEl.classList.add('on');
        replay(chainEl, 'bump');
      }
    } else if (t - lastSound > 0.04) {
      lastSound = t;
      client.audio.play(h.h >= 0.5 ? 'ar_hit_heavy' : 'ar_hit', { volume: 0.7, pitch: 1 + h.h * 0.25 });
      if (h.h >= 0.5) client.fx.shake(0.02 + h.h * 0.03, 0.12);
    }
    // Hit-stop.
    if (h.h >= STOP || (h.k && h.h >= STOP_KILL)) {
      asked.set(h.e, 0.04 + 0.07 * Math.min(1, h.h) + (h.k ? 0.03 : 0));
      punch = Math.max(punch, 0.012 + 0.025 * Math.min(1, h.h));
    }
  };

  const gore = (client: Client, g: GoreMsg) => {
    const at = { x: g.at[0], y: g.at[1] + Math.min(1.4, g.s * 0.5), z: g.at[2] };
    const cam = client.camera.position;
    if (Math.hypot(at.x - cam.x, at.y - cam.y, at.z - cam.z) > GORE_RANGE) return;
    const c = linear(g.c);
    const dark: [number, number, number] = [c[0] * 0.35, c[1] * 0.35, c[2] * 0.35];
    const big = g.b ? 3 : 1;
    const size = Math.max(0.8, Math.min(2.4, g.s / 1.9));
    // Chunks: tumbling up and out, falling and landing.
    client.fx.particles(at, c, { count: Math.round(20 * big * size), speed: 4.6 * Math.sqrt(size), size: 0.2 * size, gravity: 18, life: 2.4, spread: 0.4 * size, up: 3.4, drag: 0.35, collide: true });
    client.fx.particles(at, dark, { count: Math.round(10 * big * size), speed: 3.4 * Math.sqrt(size), size: 0.28 * size, gravity: 20, life: 2.8, spread: 0.3 * size, up: 2.6, drag: 0.35, collide: true });
    // A spray of mist, quickly gone.
    client.fx.particles(at, c, { count: Math.round(18 * big), speed: 2.6, size: 0.06, gravity: 4, life: 0.5, spread: 0.25 * size, drag: 2.5 });
    client.audio.play('ar_gore', { at, volume: 0.9, pitch: 1.15 - Math.min(0.5, size * 0.15) });
    if (g.b) client.fx.shockwave({ x: g.at[0], y: g.at[1] + 0.1, z: g.at[2] }, 9, g.c);
  };

  /** Each figure in hit-stop: where it was and how it stood when it was hit, put back each frame till it's over. */
  const hold = (client: Client) => {
    const now = client.time;
    if (!stopped.size && !asked.size) return;
    for (const f of client.figures.all) {
      const want = asked.get(f.id);
      if (want !== undefined) {
        asked.delete(f.id);
        const p = f.root.position;
        const joints: Pose['joints'] = f.rig ? Object.values(f.rig.joints).map((j) => [j, { x: j.position.x, y: j.position.y, z: j.position.z }, { x: j.quaternion.x, y: j.quaternion.y, z: j.quaternion.z, w: j.quaternion.w }]) : [];
        stopped.set(f.id, { until: now + want, pose: { p: { x: p.x, y: p.y, z: p.z }, joints } });
        continue;
      }
      const s = stopped.get(f.id);
      if (!s) continue;
      if (now >= s.until || !s.pose) {
        stopped.delete(f.id);
        continue;
      }
      f.root.position.set(s.pose.p.x, s.pose.p.y, s.pose.p.z);
      f.posed = true;
      for (const [j, p, q] of s.pose.joints) {
        j.position.set(p.x, p.y, p.z);
        j.quaternion.set(q.x, q.y, q.z, q.w);
      }
    }
    asked.clear();
    for (const [id, s] of stopped) if (now >= s.until + 0.5) stopped.delete(id);
  };

  return {
    name: 'arena.hud.hits',
    setup(client) {
      unstyle = client.hud.style(CSS);
      layer = client.hud.layer('arena.hits', 'middle');
      chainN = el('span.n');
      chainBar = el('i');
      chainEl = el('div.ar-chain', chainN, el('span.k', 'Chain'), el('div.bar', chainBar));
      layer.append(chainEl);
      client.on(MSG.hit, (d) => {
        const h = d as HitMsg;
        if (h && typeof h.e === 'number' && typeof h.h === 'number') onHit(client, h);
      });
      client.on(MSG.gore, (d) => {
        const g = d as GoreMsg;
        if (g && Array.isArray(g.at) && typeof g.c === 'string') gore(client, g);
      });
    },
    frame(client, dt) {
      if (client.events.some((e) => e.t === 'reset')) {
        layer.querySelectorAll('.ar-hit').forEach((e) => e.remove());
        chain = { n: 0, at: -Infinity };
        stopped.clear();
        asked.clear();
      }
      layer.style.visibility = hidden(client) ? 'hidden' : '';
      hold(client);
      // The chain's time running out.
      const left = 1 - (client.time - chain.at) / CHAIN;
      if (chain.n >= 2 && left > 0) chainBar.style.width = `${left * 100}%`;
      else if (chainEl.classList.contains('on')) chainEl.classList.remove('on');
      // The punch, easing back.
      const base = client.camera.zoom / applied;
      punch = Math.max(0, punch - dt * 0.25);
      applied = 1 + punch;
      client.camera.zoom = base * applied;
    },
    dispose() {
      unstyle?.();
    },
  };
}

const CSS = `
.ar-hit {
  position: absolute; left: 50%; top: 50%; width: 0; height: 0; --s: 1; --c: #f5efe4;
  animation: ar-hit 320ms cubic-bezier(0.2, 0.7, 0.3, 1) forwards;
  filter: drop-shadow(0 0 1px rgba(0, 0, 0, 0.9)) drop-shadow(0 0 3px rgba(0, 0, 0, 0.45));
}
/* Four short strokes on the diagonals, tapering in, a gap in the middle for the crosshair. */
.ar-hit > i {
  position: absolute; left: -1.5px; top: calc(-1 * (8px + 10px * var(--s))); width: 3px; height: calc(5px + 8px * var(--s));
  background: linear-gradient(180deg, var(--c), color-mix(in srgb, var(--c) 60%, transparent));
  clip-path: polygon(0 0, 100% 0, 66% 100%, 33% 100%);
  transform-origin: 1.5px calc(8px + 10px * var(--s));
}
.ar-hit > .a { transform: rotate(45deg); }
.ar-hit > .b { transform: rotate(135deg); }
.ar-hit > .c { transform: rotate(225deg); }
.ar-hit > .d { transform: rotate(315deg); }
.ar-hit.heavy { --c: var(--ar-gold-hi, #ffe3a1); }
.ar-hit.heavy > i { width: 4px; left: -2px; transform-origin: 2px calc(8px + 10px * var(--s)); }
.ar-hit.kill { --c: #ff4a3d; animation-duration: 700ms; }
.ar-hit.kill > i { width: 4px; left: -2px; transform-origin: 2px calc(8px + 10px * var(--s)); }
.ar-hit.kill > .ring {
  position: absolute; left: -24px; top: -24px; width: 48px; height: 48px; border-radius: 50%;
  border: 2px solid var(--c); animation: ar-kill-ring 700ms cubic-bezier(0.2, 0.7, 0.3, 1) forwards;
}
.ar-hit.kill > .ring.r2 { border-width: 1px; animation-delay: 70ms; animation-duration: 800ms; }
@keyframes ar-hit {
  0% { opacity: 1; transform: scale(1.35) rotate(-8deg); }
  40% { opacity: 1; transform: scale(1) rotate(0); }
  100% { opacity: 0; transform: scale(0.95); }
}
@keyframes ar-kill-ring {
  0% { opacity: 0.95; transform: scale(0.45); }
  100% { opacity: 0; transform: scale(1.7); }
}
/* The chain: by the crosshair, on the right. */
.ar-chain {
  position: absolute; left: calc(50% + 46px); top: calc(50% - 26px); display: grid; grid-template-columns: auto auto; align-items: baseline; column-gap: 7px;
  opacity: 0; transform: translateX(-6px); transition: opacity 260ms ease, transform 260ms ease;
  filter: drop-shadow(0 0 1px rgba(0, 0, 0, 0.75)) drop-shadow(0 1px 4px rgba(0, 0, 0, 0.45));
}
.ar-chain.on { opacity: 1; transform: none; }
.ar-chain .n { font: 800 34px/1 var(--ar-title, Georgia, serif); color: var(--ar-gold-hi, #ffe3a1); text-shadow: 0 0 16px rgba(240, 192, 96, 0.55); }
.ar-chain .k { font: 500 10px/1 var(--ar-label, sans-serif); letter-spacing: 0.32em; text-transform: uppercase; color: var(--ar-fg2, rgba(245, 239, 228, 0.7)); }
.ar-chain .bar { grid-column: 1 / -1; position: relative; height: 2px; margin-top: 5px; background: rgba(255, 255, 255, 0.16); }
.ar-chain .bar > i { position: absolute; left: 0; top: 0; bottom: 0; background: var(--ar-gold, #f0c060); box-shadow: 0 0 6px rgba(240, 192, 96, 0.8); }
.ar-chain.bump .n { animation: ar-chain-bump 320ms cubic-bezier(0.3, 1.8, 0.5, 1); }
@keyframes ar-chain-bump { from { transform: scale(1.6); } }
`;
