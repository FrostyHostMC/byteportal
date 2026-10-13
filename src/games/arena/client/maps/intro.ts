import type { Client, ClientKit } from '@platform/client';
import { mapById, type ArenaMap } from '../../maps';
import { INTRO_DONE_MSG, INTRO_MSG, INTRO_TIME as TIME, type IntroMessage } from '../../maps/messages';

type V3 = [number, number, number];

/** Its field of view (degrees): a little narrower than play's, for the long views. */
const FOV = 58;
/** What ends it early: walking, jumping, a click. */
const SKIP_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];

/**
 * The opening fly-over on this screen (the server sends `INTRO_MSG` as a fight begins, and to a
 * joiner): the camera taken (`client.camera.take`) and flown along the map's keyframes, its name
 * on a card over it (and a sting), then down over the fighter and in behind them, where it's
 * given back and eases into their own view. At a fight's start it's letterboxed and the HUD steps
 * aside; either way, moving or clicking ends it.
 */
export function intro(): ClientKit {
  let unstyle: (() => void) | null = null;
  let el: HTMLElement;
  let on: { map: ArenaMap; full: boolean; time: number } | null = null;
  let t = 0;
  let stung = false;

  const stop = (client: Client, ease: number) => {
    on = null;
    client.camera.release(ease);
    el.classList.remove('on', 'full', 'card');
    // (The run puts the class pick up once it's over.)
    client.send(INTRO_DONE_MSG, {});
  };

  return {
    name: 'arena.intro',
    setup(client) {
      unstyle = client.hud.style(CSS);
      el = document.createElement('div');
      el.className = 'ar-cine';
      el.innerHTML = `
        <div class="bar top"></div><div class="bar bottom"></div>
        <div class="card"><div class="kicker">The Arena</div><div class="title"></div><div class="rule"></div><div class="line"></div></div>
        <div class="skip">Move to skip</div>`;
      client.hud.layer('arena.intro', 'panels').append(el);
      client.on(INTRO_MSG, (data) => {
        const m = data as IntroMessage;
        const map = mapById(m?.map);
        if (!map?.intro.length) return;
        on = { map, full: !!m.full, time: m.full ? TIME.full : TIME.short };
        t = 0;
        stung = false;
        (el.querySelector('.title') as HTMLElement).textContent = map.name;
        (el.querySelector('.line') as HTMLElement).textContent = map.line;
        el.style.setProperty('--map', map.color);
        el.classList.add('on');
        el.classList.toggle('full', on.full);
        el.classList.remove('card');
      });
    },
    frame(client, dt) {
      if (!on) return;
      if (client.replay.playing) return stop(client, 0);
      t += dt;
      if (t > 0.5 && (SKIP_KEYS.some((k) => client.input.isDown(k)) || client.input.button(0))) return stop(client, 0.6);
      const T = on.time;
      el.classList.toggle('card', t > 0.5 && t < T - 0.6);
      if (!stung && t > 0.5) {
        stung = true;
        client.audio.play('intro_sting');
      }
      const pose = poseAt(on.map, on.full, Math.min(1, t / T), client);
      client.camera.take({ position: pose.at, target: pose.look, fov: FOV });
      if (t >= T) stop(client, TIME.ease);
    },
    dispose() {
      unstyle?.();
    },
  };
}

/** How far from `from` along `dir` (not of length 1) the camera can go, up to its length, before a block (kept `margin` off it). */
function clear(client: Client, from: V3, dir: V3, margin: number): V3 {
  const len = Math.hypot(dir[0], dir[1], dir[2]);
  const n = { x: dir[0] / len, y: dir[1] / len, z: dir[2] / len };
  const hit = client.world.raycast({ x: from[0], y: from[1], z: from[2] }, n, len + margin);
  const d = hit ? Math.max(0.4, hit.distance - margin) : len;
  return [from[0] + n.x * d, from[1] + n.y * d, from[2] + n.z * d];
}

/**
 * Where the camera is `u` (0..1) of the way through: along a curve through the keyframes (a
 * joiner's starts at the last two), each stretch timed by its length, eased in and out; then high
 * over the fighter, then behind and above them looking where they look.
 */
function poseAt(map: ArenaMap, full: boolean, u: number, client: Client): { at: { x: number; y: number; z: number }; look: { x: number; y: number; z: number } } {
  const me = client.me.position;
  const yaw = client.me.look.yaw;
  const fwd: V3 = [-Math.sin(yaw), 0, -Math.cos(yaw)];
  const eye: V3 = [me.x, me.y + 1.6, me.z];
  const ahead = (d: number, dy = 0): V3 => [eye[0] + fwd[0] * d, eye[1] + dy, eye[2] + fwd[2] * d];
  const over = { at: clear(client, eye, [-fwd[0] * 4, 14, -fwd[2] * 4], 1.5), look: ahead(8, -1) };
  const last = { at: clear(client, eye, [-fwd[0] * 3.5, 1.4, -fwd[2] * 3.5], 0.6), look: ahead(10, -0.4) };
  const own = map.intro.map((k) => ({ at: [k.at.x, k.at.y, k.at.z] as V3, look: [k.look.x, k.look.y, k.look.z] as V3 }));
  const keys = [...(full ? own : own.slice(-2)), over, last];
  const ats = keys.map((k) => k.at);
  const looks = keys.map((k) => k.look);
  const lens = ats.slice(1).map((p, i) => Math.hypot(p[0] - ats[i][0], p[1] - ats[i][1], p[2] - ats[i][2]) + 1);
  const total = lens.reduce((a, b) => a + b, 0);
  const e = u < 0.5 ? 2 * u * u : 1 - 2 * (1 - u) * (1 - u);
  let d = e * total;
  let i = 0;
  while (i < lens.length - 1 && d > lens[i]) d -= lens[i++];
  const s = Math.min(1, d / lens[i]);
  const at = catmull(ats, i, s);
  const look = catmull(looks, i, s);
  return { at: { x: at[0], y: at[1], z: at[2] }, look: { x: look[0], y: look[1], z: look[2] } };
}

/** A Catmull-Rom curve through `ps`: `s` (0..1) of the way from point i to point i + 1 (the ends held). */
function catmull(ps: V3[], i: number, s: number): V3 {
  const p0 = ps[Math.max(0, i - 1)];
  const p1 = ps[i];
  const p2 = ps[Math.min(ps.length - 1, i + 1)];
  const p3 = ps[Math.min(ps.length - 1, i + 2)];
  const s2 = s * s;
  const s3 = s2 * s;
  return [0, 1, 2].map((a) => 0.5 * (2 * p1[a] + (-p0[a] + p2[a]) * s + (2 * p0[a] - 5 * p1[a] + 4 * p2[a] - p3[a]) * s2 + (-p0[a] + 3 * p1[a] - 3 * p2[a] + p3[a]) * s3)) as V3;
}

const CSS = `
.ar-cine { position: absolute; inset: 0; pointer-events: none; opacity: 0; transition: opacity 500ms ease; --map: #ffb36b; }
.ar-cine.on { opacity: 1; }
/* A fight's start: the rest of the HUD out of the way while it plays. */
body:has(.ar-cine.on.full) :is(.hud, .gamehud) > :not([data-layer="arena.intro"], .water-tint) { opacity: 0 !important; transition: opacity 400ms ease; }
.ar-cine .bar { position: absolute; left: 0; right: 0; height: 0; background: #000; transition: height 700ms cubic-bezier(0.2, 0.8, 0.2, 1); }
.ar-cine .bar.top { top: 0; }
.ar-cine .bar.bottom { bottom: 0; }
.ar-cine.full .bar { height: 10vh; }
.ar-cine .card {
  position: absolute; left: 50%; top: 17%; transform: translate(-50%, 12px); display: flex; flex-direction: column; align-items: center;
  padding: 22px 90px 24px; background: radial-gradient(ellipse at center, rgba(12, 6, 2, 0.6), rgba(12, 6, 2, 0) 70%);
  opacity: 0; transition: opacity 600ms ease, transform 900ms cubic-bezier(0.2, 0.8, 0.2, 1); text-align: center; white-space: nowrap;
}
.ar-cine.card .card { opacity: 1; transform: translate(-50%, 0); }
.ar-cine .kicker { font: 600 12px/1 var(--sans, system-ui, sans-serif); letter-spacing: 0.42em; margin-right: -0.42em; text-transform: uppercase; color: var(--map); text-shadow: 0 1px 6px rgba(0, 0, 0, 0.7); }
.ar-cine .title {
  margin-top: 12px; font: 400 60px/1 var(--pixel, Georgia, serif); letter-spacing: 0.1em; margin-right: -0.1em; text-transform: uppercase; color: #fff4e2;
  text-shadow: 0 2px 0 rgba(0, 0, 0, 0.45), 0 0 34px rgba(0, 0, 0, 0.55), 0 0 60px color-mix(in srgb, var(--map) 35%, transparent);
}
.ar-cine .rule { margin-top: 16px; width: 0; height: 2px; background: linear-gradient(90deg, transparent, var(--map) 20%, var(--map) 80%, transparent); transition: width 900ms cubic-bezier(0.2, 0.8, 0.2, 1) 200ms; }
.ar-cine.card .rule { width: 520px; }
.ar-cine .line { margin-top: 14px; font: 500 16px/1.3 var(--sans, system-ui, sans-serif); letter-spacing: 0.04em; color: rgba(255, 244, 226, 0.85); text-shadow: 0 1px 4px rgba(0, 0, 0, 0.9); font-style: italic; }
.ar-cine .skip { position: absolute; right: 28px; bottom: calc(10vh + 16px); font: 600 10px/1 var(--sans, system-ui, sans-serif); letter-spacing: 0.3em; text-transform: uppercase; color: rgba(255, 244, 226, 0.5); }
.ar-cine:not(.full) .skip { bottom: 26px; }
@media (max-width: 900px) { .ar-cine .title { font-size: 34px; } .ar-cine.card .rule { width: 300px; } }
`;
