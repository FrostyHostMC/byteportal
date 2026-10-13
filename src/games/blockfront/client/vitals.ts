import type { ClientKit } from '@platform/client';

/** Below this much of their health a trooper's screen reddens at the edges, and below `BEAT` their heart pounds. */
const LOW = 0.35;
const BEAT = 0.25;

/**
 * Hurt, on the player's own screen: the edges darkening red as their health runs low (deeper the
 * lower it goes, pulsing), and near the end their heartbeat, soft, a little quicker the nearer
 * they are. It all eases off as their health comes back (it regenerates after a few seconds out
 * of the fight).
 */
export function vitals(): ClientKit {
  let unstyle: (() => void) | null = null;
  let edge: HTMLElement;
  let beat = 0;
  let shown = -1;

  return {
    name: 'blockfront.vitals',
    setup(client) {
      unstyle = client.hud.style(CSS);
      edge = document.createElement('div');
      edge.className = 'bf-hurt';
      client.hud.layer('bf.hurt', 'lens').append(edge);
    },
    frame(client) {
      const me = client.me;
      const hp = me.maxHealth > 0 ? me.health / me.maxHealth : 1;
      const low = !me.dead && !client.replay.playing && hp < LOW ? 1 - hp / LOW : 0;
      const k = Math.round(low * 20) / 20;
      if (k !== shown) {
        shown = k;
        edge.style.setProperty('--low', String(k));
        edge.classList.toggle('on', k > 0);
      }
      // The heartbeat: only when it's really low, soft, slowing again as health comes back.
      const pound = !me.dead && !client.replay.playing && hp < BEAT ? 1 - hp / BEAT : 0;
      if (pound > 0 && client.time >= beat) {
        beat = client.time + 1.15 - pound * 0.35;
        client.audio.play('ui_heartbeat', { volume: 0.22 + pound * 0.28 });
      }
    },
    dispose() {
      unstyle?.();
    },
  };
}

const CSS = `
.bf-hurt {
  position: absolute;
  inset: 0;
  pointer-events: none;
  --low: 0;
  opacity: 0;
  transition: opacity 400ms ease;
  background: radial-gradient(ellipse at center, transparent 42%, rgba(120, 0, 0, calc(0.25 + var(--low) * 0.35)) 78%, rgba(40, 0, 0, calc(0.45 + var(--low) * 0.4)) 100%);
}
.bf-hurt.on {
  opacity: 1;
  animation: bf-hurt-pulse 1s ease-in-out infinite;
}
@keyframes bf-hurt-pulse {
  50% {
    opacity: 0.7;
  }
}
`;
