import type { ClientKit } from '@platform/client';
import { el, hud } from './store';

/** Below this much of their health a fighter's screen bleeds at the edges, and below `BEAT` their heart pounds. */
const LOW = 0.4;
const BEAT = 0.25;

/**
 * Hurt, on the fighter's own screen: the edges bleeding red as their health runs low (deeper the
 * lower it goes, pulsing with the heart), and near the end their heartbeat, a little quicker the
 * nearer they are; it eases off as their health comes back. Out for the wave, a quiet grey veil
 * while they watch from the stands. (Down and bleeding out is the run's own screen: `client/run.ts`.)
 */
export function vitals(): ClientKit {
  let unstyle: (() => void) | null = null;
  let edge: HTMLElement;
  let veil: HTMLElement;
  let beat = 0;
  let shown = -1;
  let out = false;

  return {
    name: 'arena.hud.vitals',
    setup(client) {
      unstyle = client.hud.style(CSS);
      edge = el('div.ar-hurt');
      veil = el('div.ar-veil', el('div.ar-veil-msg', el('div.ar-veil-t', 'Out of the fight'), el('div.ar-veil-s', 'Back when this wave is cleared')));
      client.hud.layer('arena.vitals', 'lens').append(edge, veil);
    },
    frame(client) {
      const me = client.me;
      const quiet = client.replay.playing || !me.id;
      const hp = me.maxHealth > 0 ? me.health / me.maxHealth : 1;
      const low = !me.dead && !quiet && hud.me?.state !== 'down' && hp < LOW ? 1 - hp / LOW : 0;
      const k = Math.round(low * 20) / 20;
      if (k !== shown) {
        shown = k;
        edge.style.setProperty('--low', String(k));
        edge.classList.toggle('on', k > 0);
      }
      const down = hud.me?.state === 'down';
      const pound = !me.dead && !quiet && !down && hp < BEAT ? 1 - hp / BEAT : 0;
      if (pound > 0 && client.time >= beat) {
        beat = client.time + 1.1 - pound * 0.4;
        client.audio.play('ar_heartbeat', { volume: 0.3 + pound * 0.4 });
        edge.classList.remove('beat');
        void edge.offsetWidth;
        edge.classList.add('beat');
      }
      // Out for the wave: the veil, as the server says.
      const now = !quiet && !hud.ended && hud.me?.state === 'out';
      if (now !== out) {
        out = now;
        veil.classList.toggle('on', out);
      }
    },
    dispose() {
      unstyle?.();
    },
  };
}

const CSS = `
.ar-hurt {
  position: absolute; inset: 0; pointer-events: none; --low: 0; opacity: 0; transition: opacity 400ms ease;
  background:
    radial-gradient(ellipse 72% 68% at center, transparent calc(52% - var(--low) * 14%), rgba(150, 6, 12, calc(0.3 + var(--low) * 0.35)) 82%, rgba(70, 0, 4, calc(0.62 + var(--low) * 0.33)) 100%);
}
.ar-hurt.on { opacity: 1; }
.ar-hurt.beat { animation: ar-hurt-beat 600ms ease-out; }
@keyframes ar-hurt-beat { 0% { opacity: 1; filter: brightness(1.5) saturate(1.3); } 30% { opacity: 0.75; } 100% { opacity: 1; } }
.ar-veil { position: absolute; inset: 0; pointer-events: none; opacity: 0; transition: opacity 700ms ease, backdrop-filter 700ms ease; }
.ar-veil.on { opacity: 1; backdrop-filter: grayscale(0.85) brightness(0.8); background: radial-gradient(ellipse at center, transparent 40%, rgba(8, 6, 6, 0.55)); }
.ar-veil-msg { position: absolute; left: 50%; bottom: 22%; transform: translateX(-50%); display: flex; flex-direction: column; align-items: center; gap: 8px; text-align: center; white-space: nowrap; }
.ar-veil-t { font: 700 30px/1 var(--ar-title, Georgia, serif); letter-spacing: 0.2em; margin-right: -0.2em; text-transform: uppercase; color: var(--ar-fg, #f5efe4); text-shadow: 0 0 20px rgba(0, 0, 0, 0.7); }
.ar-veil-s { font: 500 13px/1 var(--ar-label, sans-serif); letter-spacing: 0.26em; text-transform: uppercase; color: var(--ar-fg2, rgba(245, 239, 228, 0.7)); text-shadow: 0 1px 4px rgba(0, 0, 0, 0.8); }
`;
