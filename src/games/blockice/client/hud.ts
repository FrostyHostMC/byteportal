import type { Client, ClientKit, ClientLoop } from '@platform/client';
import type { SkateState } from '../moves';
import type { IceView } from './state';

/**
 * The screen's own HUD and the arena's noise: the announcer's callouts slammed across the screen
 * ("GOAL!", "INTO THE GLASS!", "HE'S ON FIRE!"), a marker over our own skater (and the shot's
 * wind-up over their head), and the arena: the crowd's murmur that never stops, its roar for the
 * big moments, the goal horn, the organ's stings, the period's horn.
 */

const CSS = `
.ice-calls { position: absolute; left: 0; right: 0; top: 24%; display: flex; flex-direction: column; align-items: center; pointer-events: none }
.ice-call { display: flex; flex-direction: column; align-items: center; animation: ice-slam 1.9s cubic-bezier(.2,.9,.25,1.2) forwards }
.ice-call-text { font-family: var(--pixel); font-size: clamp(34px, 7vw, 84px); font-style: italic; letter-spacing: 0.02em; color: #fff;
  -webkit-text-stroke: 3px #0b0d14; paint-order: stroke fill; text-shadow: 0 6px 0 #0b0d14, 0 0 30px var(--c); transform: skewX(-10deg) }
.ice-call-sub { margin-top: 2px; padding: 3px 14px; font-family: var(--sans); font-weight: 700; font-size: clamp(14px, 1.8vw, 20px); letter-spacing: 0.14em;
  text-transform: uppercase; color: #fff; background: var(--c); border-radius: 4px; transform: skewX(-10deg); box-shadow: 0 4px 0 #0b0d14 }
@keyframes ice-slam {
  0% { opacity: 0; transform: scale(2.6) rotate(-4deg) }
  12% { opacity: 1; transform: scale(0.94) rotate(1deg) }
  20% { transform: scale(1.04) rotate(0) }
  80% { opacity: 1; transform: scale(1) }
  100% { opacity: 0; transform: scale(1.08) translateY(-20px) }
}
`;

export function hudKit(view: IceView): ClientKit {
  let layer: HTMLElement | null = null;
  let crowd: ClientLoop | null = null;
  let roar = 0;
  let unstyle: (() => void) | null = null;
  let hud: Client['hud'] | null = null;
  return {
    name: 'ice.hud',
    setup(client) {
      unstyle = client.hud.style(CSS);
      hud = client.hud;
    },
    frame(client, dt) {
      if (!layer) {
        const l = client.hud.layer('ice.calls');
        layer = document.createElement('div');
        layer.className = 'ice-calls';
        l.append(layer);
      }
      if (!crowd) crowd = client.audio.loop('ice_crowd', { volume: 0.25 });
      for (const c of view.calls) {
        show(layer, c.text, c.sub, c.color ?? '#3fa9f5');
        if (c.roar) {
          roar = Math.max(roar, c.roar);
          client.audio.play('ice_cheer', { volume: 0.3 + c.roar * 0.6 });
        }
      }
      for (const m of view.moments) {
        if (m.k === 'goal') {
          roar = 1;
          client.audio.play('ice_horn', { volume: 1 });
          client.audio.play('ice_organ_goal', { volume: 0.55 });
        } else if (m.k === 'horn') client.audio.play('ice_buzzer', { volume: m.what === 'game' ? 1 : 0.8 });
        else if (m.k === 'shot') client.audio.play(m.slap ? 'ice_slap' : 'ice_wrist');
        else if (m.k === 'save') client.audio.play(m.kind === 2 ? 'ice_glove' : 'ice_pad', { at: { x: m.at[0], y: m.at[1], z: m.at[2] } });
        else if (m.k === 'hit') {
          client.audio.play(m.boards ? 'ice_crunch' : 'ice_hit', { at: { x: m.at[0], y: m.at[1], z: m.at[2] } });
          if (m.boards) {
            client.audio.play('ice_glass', { at: { x: m.at[0], y: m.at[1], z: m.at[2] }, volume: 1 });
            roar = Math.max(roar, 0.7);
          }
        } else if (m.k === 'poke' || m.k === 'block') client.audio.play('ice_poke');
        else if (m.k === 'fire' && m.on) client.audio.play('ice_flame', { volume: 1 });
        else if (m.k === 'drop') client.audio.play('ice_whistle');
      }
      roar = Math.max(0, roar - dt * 0.3);
      crowd.set({ volume: 0.22 + roar * 0.5, pitch: 1 + roar * 0.12 });
      markers(client);
    },
    dispose() {
      crowd?.stop();
      unstyle?.();
      layer?.remove();
      layer = null;
      hud?.marker('ice.me', null);
      hud?.marker('ice.meter', null);
    },
  };
}

function show(layer: HTMLElement, text: string, sub: string | undefined, color: string) {
  layer.replaceChildren();
  const el = document.createElement('div');
  el.className = 'ice-call';
  el.style.setProperty('--c', color);
  const t = document.createElement('div');
  t.className = 'ice-call-text';
  t.textContent = text;
  el.append(t);
  if (sub) {
    const s = document.createElement('div');
    s.className = 'ice-call-sub';
    s.textContent = sub;
    el.append(s);
  }
  layer.append(el);
}

/** Over our own head: who we are, and a shot winding up. */
function markers(client: Client) {
  const s = client.me.abilities?.skate as unknown as SkateState | undefined;
  const p = client.me.position;
  if (!s || !client.me.id || client.me.dead || client.me.flying) {
    client.hud.marker('ice.me', null);
    client.hud.marker('ice.meter', null);
    return;
  }
  client.hud.marker('ice.me', { x: p.x, y: p.y + 2.75, z: p.z }, { shape: 'diamond', color: s.fire ? '#ff7a1a' : '#ffd23f', size: 12, label: 'YOU', edge: true });
  if (s.wind > 0) {
    const slap = s.wind >= 0.55;
    client.hud.marker('ice.meter', { x: p.x, y: p.y + 3.25, z: p.z }, { shape: 'dot', color: slap ? '#ff7a1a' : '#ffd23f', size: 6, label: slap ? (s.wind >= 0.98 ? 'CANNON!' : 'SLAP SHOT') : 'WRIST SHOT', bar: s.wind });
  } else client.hud.marker('ice.meter', null);
}
