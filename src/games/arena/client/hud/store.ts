import type { Client, ClientKit } from '@platform/client';
import { MSG, type EndMsg, type HypeMsg, type MeMsg, type PartyMsg, type RunMsg } from '../../hud/messages';

/**
 * What the HUD's server part last said (`hud/messages.ts`), kept for the HUD's kits to read each
 * frame: the fight, the crowd's hype, the party, this fighter's own, and how the run ended. It's a
 * kit (listed first) so it hears the messages before the others draw, and forgets it all at a
 * restart.
 */
export const hud = {
  run: null as RunMsg | null,
  hype: { v: 0, f: 0 } as HypeMsg,
  party: null as PartyMsg | null,
  me: null as MeMsg | null,
  ended: null as EndMsg | null,
};

const obj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

export function hudState(): ClientKit {
  return {
    name: 'arena.hud.state',
    setup(client) {
      client.on(MSG.run, (d) => {
        if (obj(d) && typeof d.phase === 'string') {
          hud.run = d as unknown as RunMsg;
          // A fight under way again (a restart, or the next one): it hasn't ended.
          if (d.phase === 'countdown' || d.phase === 'fighting') hud.ended = null;
        }
      });
      client.on(MSG.hype, (d) => {
        if (obj(d) && typeof d.v === 'number') hud.hype = d as unknown as HypeMsg;
      });
      client.on(MSG.party, (d) => {
        if (obj(d) && Array.isArray(d.list)) hud.party = d as unknown as PartyMsg;
      });
      client.on(MSG.me, (d) => {
        if (obj(d) && typeof d.gold === 'number') hud.me = d as unknown as MeMsg;
      });
      client.on(MSG.end, (d) => {
        if (obj(d) && typeof d.won === 'boolean') hud.ended = d as unknown as EndMsg;
      });
    },
    frame(client) {
      if (client.events.some((e) => e.t === 'reset')) {
        hud.party = null;
        hud.ended = null;
        hud.hype = { v: 0, f: 0 };
      }
    },
  };
}

/** The HUD steps aside: a replay plays, or nobody's playing on this screen (the home page behind). */
export const hidden = (client: Client) => client.replay.playing || !client.me.id || !client.running;

/** An element: `tag.class.class`, then children (text or elements). */
export function el(spec: string, ...children: (Node | string | null)[]): HTMLElement {
  const [tag, ...classes] = spec.split('.');
  const e = document.createElement(tag || 'div');
  if (classes.length) e.className = classes.join(' ');
  for (const c of children) if (c !== null) e.append(c);
  return e;
}

/** Restart an element's CSS animation (a class taken off and put back). */
export function replay(e: HTMLElement, cls: string) {
  e.classList.remove(cls);
  void e.offsetWidth;
  e.classList.add(cls);
}

export const num = (n: number) => Math.round(n).toLocaleString('en-US');
export const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.max(0, Math.floor(s % 60))).padStart(2, '0')}`;

/**
 * Where a point in the world is on the screen, as fractions of it (0..1 across and down), and
 * whether it's in front of the camera: from the camera's place and turn (`toWorld`) and its field
 * of view.
 */
export function project(client: Client, p: { x: number; y: number; z: number }): { x: number; y: number; ahead: boolean } {
  const c = client.camera.position;
  const r = client.camera.toWorld({ x: 1, y: 0, z: 0 });
  const u = client.camera.toWorld({ x: 0, y: 1, z: 0 });
  const f = client.camera.toWorld({ x: 0, y: 0, z: -1 });
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  const dz = p.z - c.z;
  const x = dx * (r.x - c.x) + dy * (r.y - c.y) + dz * (r.z - c.z);
  const y = dx * (u.x - c.x) + dy * (u.y - c.y) + dz * (u.z - c.z);
  const z = dx * (f.x - c.x) + dy * (f.y - c.y) + dz * (f.z - c.z);
  const t = Math.tan(((client.camera.fov / 2) * Math.PI) / 180);
  const aspect = window.innerWidth / Math.max(1, window.innerHeight);
  const zz = Math.max(0.05, z);
  return { x: 0.5 + x / (zz * t * aspect) / 2, y: 0.5 - y / (zz * t) / 2, ahead: z > 0.05 };
}

/** An sRGB colour (`#rrggbb`) in linear light, for particles. */
export function linear(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', '').slice(0, 6), 16) || 0;
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return [f((n >> 16) & 255), f((n >> 8) & 255), f(n & 255)];
}
