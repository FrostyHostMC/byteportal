import type { ClientKit, Client } from '@platform/client';
import { INTRO_MSG, INTRO_TIME, type IntroMessage } from '../framing';

type V3 = [number, number, number];

/** The fly-over's field of view (degrees): a little narrower than play's, for the long views. */
const FOV = 60;
/** Keys that end a joiner's fly-over early (moving on). */
const SKIP_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];

/**
 * The opening fly-over on this screen (the server's `cinema.ts` sends it, `INTRO_MSG`): the camera
 * taken (`client.camera.take`) and flown along the map's keyframes past the command posts, a
 * title card over it (the map, the mode, a line, the side), then down to a point behind and above
 * the player, where it's given back and eases into their own view (`release`). At a match's start
 * it's letterboxed, the HUD hidden, the player held still by the server meanwhile; a joiner's is
 * shorter and ends early if they move. (Its stylesheet also clears the rest of the HUD from under
 * the end screen, the server's `end` widget: widgets' styles are kept to themselves.)
 */
export function intro(): ClientKit {
  let unstyle: (() => void) | null = null;
  let el: HTMLElement;
  let msg: IntroMessage | null = null;
  let t = 0;

  const stop = (client: Client, ease: number) => {
    msg = null;
    client.camera.release(ease);
    el.classList.remove('on', 'full', 'card');
  };

  return {
    name: 'blockfront.intro',
    setup(client) {
      unstyle = client.hud.style(CSS);
      el = document.createElement('div');
      el.className = 'bf-cine';
      el.innerHTML = `
        <div class="bar top"></div><div class="bar bottom"></div>
        <div class="card"><div class="mode"></div><div class="title"></div><div class="rule"></div><div class="line"></div><div class="side"></div></div>
        <div class="skip">MOVE TO SKIP</div>`;
      client.hud.layer('bf.intro', 'panels').append(el);
      client.on(INTRO_MSG, (data) => {
        const m = data as IntroMessage;
        if (!m?.keys?.length) return;
        msg = m;
        t = 0;
        const q = (s: string) => el.querySelector(s) as HTMLElement;
        q('.mode').textContent = m.mode;
        q('.title').textContent = m.title;
        q('.line').textContent = m.line;
        q('.side').textContent = m.side;
        q('.side').style.color = m.color;
        el.classList.add('on');
        el.classList.toggle('full', m.full);
        el.classList.remove('card');
      });
    },
    frame(client, dt) {
      if (!msg) return;
      t += dt;
      // A joiner's: they move, it's over.
      if (!msg.full && t > 0.4 && SKIP_KEYS.some((k) => client.input.isDown(k))) {
        stop(client, 0.6);
        return;
      }
      const T = msg.time;
      el.classList.toggle('card', t > 0.45 && t < T - 0.5);
      const pose = poseAt(msg, Math.min(1, t / T), client);
      client.camera.take({ position: pose.at, target: pose.look, fov: FOV });
      if (t >= T) stop(client, INTRO_TIME.ease);
    },
    dispose() {
      unstyle?.();
    },
  };
}

/**
 * How far from `from` along `dir` (not of length 1) the camera can go, up to its length, before
 * a block (kept `margin` off it): the fly-over's last keys come down into streets and alleys.
 */
function clear(client: Client, from: V3, dir: V3, margin: number): V3 {
  const len = Math.hypot(dir[0], dir[1], dir[2]);
  const n = { x: dir[0] / len, y: dir[1] / len, z: dir[2] / len };
  const hit = client.world.raycast({ x: from[0], y: from[1], z: from[2] }, n, len + margin);
  const d = hit ? Math.max(0.4, hit.distance - margin) : len;
  return [from[0] + n.x * d, from[1] + n.y * d, from[2] + n.z * d];
}

/**
 * Where the camera is `u` (0..1) of the way through: along a curve through the keyframes' places
 * (and one through the points they look at), each stretch timed by its length, eased in and out.
 * It ends coming down on the player: high over them (as high as the sky over them is clear),
 * then behind and above their shoulder (pulled in before a wall), looking where they look.
 */
function poseAt(m: IntroMessage, u: number, client: Client): { at: { x: number; y: number; z: number }; look: { x: number; y: number; z: number } } {
  const me = client.me.position;
  const yaw = client.me.look.yaw;
  const fwd: V3 = [-Math.sin(yaw), 0, -Math.cos(yaw)];
  const eye: V3 = [me.x, me.y + 1.6, me.z];
  const ahead = (d: number, dy = 0): V3 => [eye[0] + fwd[0] * d, eye[1] + dy, eye[2] + fwd[2] * d];
  const over = { at: clear(client, eye, [-fwd[0] * 3, 18, -fwd[2] * 3], 1.5), look: ahead(8, -1) };
  const last = { at: clear(client, eye, [-fwd[0] * 6.5, 2.8, -fwd[2] * 6.5], 0.8), look: ahead(12, -0.6) };
  const keys = [...m.keys, over, last];
  const ats = keys.map((k) => k.at);
  const looks = keys.map((k) => k.look);
  // Time along each stretch by its length.
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
  const p0 = ps[Math.max(0, i - 1)], p1 = ps[i], p2 = ps[Math.min(ps.length - 1, i + 1)], p3 = ps[Math.min(ps.length - 1, i + 2)];
  const s2 = s * s, s3 = s2 * s;
  return [0, 1, 2].map((a) => 0.5 * (2 * p1[a] + (-p0[a] + p2[a]) * s + (2 * p0[a] - 5 * p1[a] + 4 * p2[a] - p3[a]) * s2 + (-p0[a] + 3 * p1[a] - 3 * p2[a] + p3[a]) * s3)) as V3;
}

const CSS = `
.bf-cine { position: absolute; inset: 0; pointer-events: none; opacity: 0; transition: opacity 500ms ease; }
.bf-cine.on { opacity: 1; }
/* The match's start: the HUD out of the way while it plays. */
body:has(.bf-cine.on.full) :is(.hud, .gamehud) > :not([data-layer="bf.intro"], .water-tint) { opacity: 0 !important; transition: opacity 400ms ease; }
/* The end screen (framing.ts) has the screen to itself: the rest of the HUD out of the way under it (the scoreboard still on Tab). */
body:has(.gw-end) :is(.hud, .gamehud) > :not(.gw-layer, .scoreboard, .water-tint),
body:has(.gw-end) .gw-layer > .gw-slot:not(:has(.gw-end)) { opacity: 0 !important; transition: opacity 400ms ease; }
.bf-cine .bar { position: absolute; left: 0; right: 0; height: 0; background: #000; transition: height 700ms cubic-bezier(0.2, 0.8, 0.2, 1); }
.bf-cine .bar.top { top: 0; }
.bf-cine .bar.bottom { bottom: 0; }
.bf-cine.full .bar { height: 9vh; }
.bf-cine .card {
  position: absolute; left: 50%; top: 15%; transform: translate(-50%, 10px); display: flex; flex-direction: column; align-items: center;
  padding: 18px 80px 20px; background: radial-gradient(ellipse at center, rgba(4, 6, 9, 0.55), rgba(4, 6, 9, 0) 70%);
  opacity: 0; transition: opacity 600ms ease, transform 900ms cubic-bezier(0.2, 0.8, 0.2, 1); text-align: center; white-space: nowrap;
}
.bf-cine.card .card { opacity: 1; transform: translate(-50%, 0); }
.bf-cine .mode { font: 600 13px/1 var(--pixel, 'Orbitron', sans-serif); letter-spacing: 0.34em; margin-right: -0.34em; color: var(--bf-y, var(--hud-accent, #ffe81f)); text-shadow: 0 1px 6px rgba(0, 0, 0, 0.5); }
.bf-cine .title {
  margin-top: 10px; font: 500 54px/1 var(--pixel, 'Orbitron', sans-serif); letter-spacing: 0.3em; margin-right: -0.3em; color: var(--bf-fg, #f3f5f7);
  text-shadow: 0 1px 6px rgba(0, 0, 0, 0.5), 0 0 30px rgba(0, 0, 0, 0.45);
}
.bf-cine .rule { margin-top: 16px; width: 0; height: 1px; background: linear-gradient(90deg, transparent, var(--bf-line2, rgba(255, 255, 255, 0.24)) 20%, var(--bf-line2, rgba(255, 255, 255, 0.24)) 80%, transparent); transition: width 900ms cubic-bezier(0.2, 0.8, 0.2, 1) 200ms; }
.bf-cine.card .rule { width: 560px; }
.bf-cine .line { margin-top: 14px; font: 500 15px/1.3 var(--sans, 'Titillium Web', sans-serif); letter-spacing: 0.02em; color: var(--bf-fg2, rgba(243, 245, 247, 0.8)); text-shadow: 0 1px 4px rgba(0, 0, 0, 0.8); }
.bf-cine .side { margin-top: 12px; font: 600 11px/1 var(--pixel, 'Orbitron', sans-serif); letter-spacing: 0.3em; margin-right: -0.3em; text-transform: uppercase; text-shadow: 0 1px 4px rgba(0, 0, 0, 0.8); }
.bf-cine .skip { position: absolute; right: 28px; bottom: 26px; font: 600 10px/1 var(--pixel, 'Orbitron', sans-serif); letter-spacing: 0.3em; color: var(--bf-fg3, rgba(243, 245, 247, 0.42)); }
.bf-cine.full .skip { display: none; }
@media (max-width: 900px) { .bf-cine .title { font-size: 32px; } .bf-cine.card .rule { width: 320px; } }
`;
