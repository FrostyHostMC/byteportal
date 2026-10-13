import type { Client, ClientKit, ClientLoop } from '@platform/client';
import { SHOT_APEX, type JamState } from '../moves';
import type { JamView } from './state';

/**
 * The screen's own HUD and the crowd: the announcer's callouts slammed across the screen ("HE'S ON
 * FIRE!", "FROM DOWNTOWN!"), a marker over our own baller, the timing meter over their head on a
 * jump shot (full at the top of the jump: let go then), and the crowd: a murmur that never stops,
 * a roar for the big moments, the buzzer.
 */

const CSS = `
.jam-calls { position: absolute; left: 0; right: 0; top: 24%; display: flex; flex-direction: column; align-items: center; pointer-events: none }
.jam-call { display: flex; flex-direction: column; align-items: center; animation: jam-slam 1.9s cubic-bezier(.2,.9,.25,1.2) forwards }
.jam-call-text { font-family: var(--pixel); font-size: clamp(34px, 7vw, 84px); font-style: italic; letter-spacing: 0.02em; color: #fff;
  -webkit-text-stroke: 3px #0b0d14; paint-order: stroke fill; text-shadow: 0 6px 0 #0b0d14, 0 0 30px var(--c); transform: skewX(-10deg) }
.jam-call-sub { margin-top: 2px; padding: 3px 14px; font-family: var(--sans); font-weight: 700; font-size: clamp(14px, 1.8vw, 20px); letter-spacing: 0.14em;
  text-transform: uppercase; color: #fff; background: var(--c); border-radius: 4px; transform: skewX(-10deg); box-shadow: 0 4px 0 #0b0d14 }
@keyframes jam-slam {
  0% { opacity: 0; transform: scale(2.6) rotate(-4deg) }
  12% { opacity: 1; transform: scale(0.94) rotate(1deg) }
  20% { transform: scale(1.04) rotate(0) }
  80% { opacity: 1; transform: scale(1) }
  100% { opacity: 0; transform: scale(1.08) translateY(-20px) }
}
`;

export function hudKit(view: JamView): ClientKit {
  let layer: HTMLElement | null = null;
  let crowd: ClientLoop | null = null;
  let roar = 0;
  let unstyle: (() => void) | null = null;
  let hud: Client['hud'] | null = null;
  return {
    name: 'jam.hud',
    setup(client) {
      unstyle = client.hud.style(CSS);
      hud = client.hud;
    },
    frame(client, dt) {
      if (!layer) {
        const l = client.hud.layer('jam.calls');
        layer = document.createElement('div');
        layer.className = 'jam-calls';
        l.append(layer);
      }
      // The crowd: always there, swelling with the moments.
      if (!crowd) crowd = client.audio.loop('jam_crowd', { volume: 0.25 });
      for (const c of view.calls) {
        show(layer, c.text, c.sub, c.color ?? '#ff6b1a');
        if (c.roar) {
          roar = Math.max(roar, c.roar);
          client.audio.play('jam_cheer', { volume: 0.35 + c.roar * 0.6 });
        }
      }
      for (const m of view.moments) {
        if (m.k === 'buzzer') client.audio.play('jam_buzzer', { volume: m.what === 'shotclock' ? 0.6 : 1 });
        else if (m.k === 'score') {
          roar = Math.max(roar, m.pts === 3 ? 0.8 : 0.5);
          client.audio.play('jam_cheer', { volume: 0.4 + (m.pts === 3 ? 0.3 : 0) });
        } else if (m.k === 'steal') client.audio.play('jam_steal');
        else if (m.k === 'shove') client.audio.play('jam_shove');
        else if (m.k === 'fire' && m.on) client.audio.play('jam_flame', { volume: 1 });
        else if (m.k === 'tip') client.audio.play('jam_whistle');
      }
      roar = Math.max(0, roar - dt * 0.35);
      crowd.set({ volume: 0.22 + roar * 0.5, pitch: 1 + roar * 0.12 });
      markers(client);
    },
    dispose() {
      crowd?.stop();
      unstyle?.();
      layer?.remove();
      layer = null;
      hud?.marker('jam.me', null);
      hud?.marker('jam.meter', null);
    },
  };
}

function show(layer: HTMLElement, text: string, sub: string | undefined, color: string) {
  layer.replaceChildren();
  const el = document.createElement('div');
  el.className = 'jam-call';
  el.style.setProperty('--c', color);
  const t = document.createElement('div');
  t.className = 'jam-call-text';
  t.textContent = text;
  el.append(t);
  if (sub) {
    const s = document.createElement('div');
    s.className = 'jam-call-sub';
    s.textContent = sub;
    el.append(s);
  }
  layer.append(el);
}

/** Over our own head: who we are, and the jump shot's timing. */
function markers(client: Client) {
  const s = client.me.abilities?.jam as unknown as JamState | undefined;
  const p = client.me.position;
  if (!s || !client.me.id || client.me.dead) {
    client.hud.marker('jam.me', null);
    client.hud.marker('jam.meter', null);
    return;
  }
  client.hud.marker('jam.me', { x: p.x, y: p.y + 2.75, z: p.z }, { shape: 'diamond', color: s.fire ? '#ff6b1a' : '#ffd23f', size: 12, label: 'YOU', edge: true });
  if (s.air === 1 && !s.released) {
    const fill = Math.min(1, s.t / SHOT_APEX);
    client.hud.marker('jam.meter', { x: p.x, y: p.y + 3.25, z: p.z }, { shape: 'dot', color: fill > 0.85 ? '#2bd673' : '#ffd23f', size: 6, label: fill > 0.85 ? 'RELEASE!' : 'SHOOT', bar: fill });
  } else client.hud.marker('jam.meter', null);
}
