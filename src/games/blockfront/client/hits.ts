import type { ClientKit } from '@platform/client';

/** A hit's word from the server (`hits.ts`): how much it took, a head hit, a kill, part of a stream (lightning, flame, a choke: summed, a few a second). */
interface Hit {
  n: number;
  h: boolean;
  k: boolean;
  s: boolean;
}

/** Damage at which a marker is at its biggest. */
const BIG = 70;

/**
 * Hit confirms, on the shooter's screen: a clean X round the crosshair for every hit of theirs
 * that lands (from the server's `bf.hit`: bolts, sabers, powers, detonators alike), bigger for a
 * bigger hit, yellow for a head, and a kill's red X with a ring breaking out round it; each with its
 * own short sound (a tick, a brighter one, and the kill's two-note confirm). It stands in for the
 * platform's hit marker (hidden by the theme, its sounds silenced here), which only guns and
 * blades have.
 */
export function hits(): ClientKit {
  let unstyle: (() => void) | null = null;
  let layer: HTMLElement;
  let lastSound = 0;

  const show = (hit: Hit) => {
    const el = document.createElement('div');
    el.className = `bf-hit${hit.k ? ' kill' : hit.h ? ' head' : ''}`;
    const size = hit.k ? 1.25 : 0.72 + 0.5 * Math.min(1, hit.n / BIG);
    el.style.setProperty('--s', size.toFixed(2));
    el.append(...['a', 'b', 'c', 'd'].map((k) => Object.assign(document.createElement('i'), { className: k })));
    if (hit.k) el.append(Object.assign(document.createElement('b'), { className: 'ring' }));
    // A new marker takes the old one's place, unless it's a kill's (that one plays out).
    for (const old of layer.querySelectorAll('.bf-hit:not(.kill)')) old.remove();
    layer.append(el);
    window.setTimeout(() => el.remove(), hit.k ? 700 : 360);
  };

  return {
    name: 'blockfront.hits',
    setup(client) {
      unstyle = client.hud.style(CSS);
      layer = client.hud.layer('bf.hits', 'middle');
      const a = client.audio;
      // The platform's own marker sounds go quiet: ours play for every hit, whatever landed it.
      a.define('hitmarker', () => {});
      a.define('kill', () => {});
      // (Dry, all three: the HUD's own, they take no echo.)
      a.define(
        'bf_hit',
        (s) => {
          // A dry, bright tick.
          s.tone({ wave: 'sine', from: 2350 * s.pitch, to: 1900 * s.pitch, duration: 0.045, attack: 0.001, volume: 0.16 });
          s.noise({ duration: 0.02, filter: 'highpass', from: 6000, volume: 0.07 });
        },
        { reverb: 0 },
      );
      a.define(
        'bf_hit_head',
        (s) => {
          // Brighter, with a glassy ring over it.
          s.tone({ wave: 'sine', from: 3100 * s.pitch, to: 2700 * s.pitch, duration: 0.07, attack: 0.001, volume: 0.17, fm: { ratio: 2.41, depth: 0.4, to: 0.05 } });
          s.noise({ duration: 0.025, filter: 'highpass', from: 7000, volume: 0.08 });
        },
        { reverb: 0 },
      );
      a.define(
        'bf_kill',
        (s) => {
          // The kill confirm: a low thud under two quick notes, a fifth apart, clean and short.
          s.tone({ wave: 'sine', from: 160, to: 70, duration: 0.12, attack: 0.002, volume: 0.456 });
          s.tone({ wave: 'triangle', from: 1320, duration: 0.07, attack: 0.002, volume: 0.19 });
          s.tone({ wave: 'triangle', from: 1980, duration: 0.14, delay: 0.06, attack: 0.002, volume: 0.19, fm: { ratio: 2, depth: 0.2, to: 0 } });
        },
        { reverb: 0 },
      );
      client.on('bf.hit', (data) => {
        const d = data as Partial<Hit> | null;
        if (!d || typeof d.n !== 'number') return;
        const hit: Hit = { n: d.n, h: !!d.h, k: !!d.k, s: !!d.s };
        show(hit);
        // One sound for a burst of hits in the same moment (a saber's sweep, a blast), a kill's always.
        const t = client.time;
        if (t - lastSound <= 0.04 && !hit.k) return;
        lastSound = t;
        // A stream's pulse: softer and lower, under whatever else is landing.
        if (hit.s && !hit.k) client.audio.play('bf_hit', { volume: 0.4, pitch: 0.8 });
        else client.audio.play(hit.k ? 'bf_kill' : hit.h ? 'bf_hit_head' : 'bf_hit', { volume: 0.9 });
      });
    },
    frame(client) {
      if (client.events.some((e) => e.t === 'reset')) layer?.replaceChildren();
    },
    dispose() {
      unstyle?.();
    },
  };
}

const CSS = `
/* The platform's hit marker steps aside for ours. */
.hitmarker { display: none !important; }
.bf-hit {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 0;
  height: 0;
  --s: 1;
  --c: #ffffff;
  animation: bf-hit 300ms cubic-bezier(0.2, 0.7, 0.3, 1) forwards;
  filter: drop-shadow(0 0 1px rgba(0, 0, 0, 0.9)) drop-shadow(0 0 3px rgba(0, 0, 0, 0.4));
}
/* Four short strokes on the diagonals, a gap in the middle for the crosshair. */
.bf-hit > i {
  position: absolute;
  left: -1px;
  top: calc(-1 * (7px + 9px * var(--s)));
  width: 2px;
  height: calc(4px + 7px * var(--s));
  background: var(--c);
  transform-origin: 1px calc(7px + 9px * var(--s));
}
.bf-hit > .a { transform: rotate(45deg); }
.bf-hit > .b { transform: rotate(135deg); }
.bf-hit > .c { transform: rotate(225deg); }
.bf-hit > .d { transform: rotate(315deg); }
.bf-hit.head { --c: var(--hud-accent, #ffe81f); }
.bf-hit.kill { --c: #ff4a3d; animation-duration: 650ms; }
.bf-hit.kill > i { width: 2.5px; left: -1.25px; }
.bf-hit.kill > .ring {
  position: absolute;
  left: -22px;
  top: -22px;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  border: 1.5px solid var(--c);
  animation: bf-kill-ring 650ms cubic-bezier(0.2, 0.7, 0.3, 1) forwards;
}
@keyframes bf-hit {
  0% { opacity: 1; transform: scale(1.3); }
  45% { opacity: 1; transform: scale(1); }
  100% { opacity: 0; transform: scale(0.96); }
}
@keyframes bf-kill-ring {
  0% { opacity: 0.9; transform: scale(0.5); }
  100% { opacity: 0; transform: scale(1.5); }
}
`;
