import type { Client, ClientKit, Figure } from '@platform/client';
import { Color, Vec3 } from '@platform/client/math';
import { CAM_MSG, FALL_MSG, INTRO_MSG, MARK_MSG, PHASE_MSG, type CamMessage, type FallMessage, type IntroMessage, type Mark, type PhaseMessage } from '../bosses/messages';
import type { ClientPart } from './part';

type V3 = [number, number, number];
type RGB = [number, number, number];

/** How often the marks are drawn anew (a second), and how long each speck lives. */
const MARK_RATE = 30;
const SPECK = 0.1;

/** A mark as drawn: what the server sent, when it came (this screen's clock), its colour. */
interface Live {
  m: Exclude<Mark, { k: 'clear' }>;
  t0: number;
  rgb: RGB;
  /** Seconds it's been without one of its figures (a tether), to let it go. */
  lost: number;
}

/** A cinematic playing: the entrance, or a fall. */
interface Cine {
  kind: 'intro' | 'fall';
  t: number;
  time: number;
  id: number;
  at: V3;
  height: number;
  yaw: number;
  color: string;
  /** The roar (an entrance), the last blast (a fall): seconds in, and whether it's come. */
  beat: number;
  struck: boolean;
  /** Where the fall's orbit starts (radians round the boss) and which way it turns; which side the entrance's hero shots are on. */
  from: number;
  turn: number;
  side: number;
}

const rgbOf = (css: string): RGB => {
  const c = new Color(css);
  return [c.r, c.g, c.b];
};

const smooth = (u: number) => u * u * (3 - 2 * u);

/**
 * The bosses on each screen (the server's `bosses/part.ts` and `fight.ts` send them): the marks
 * on the ground before a blow lands (rings, sweeps, lanes that fill as the moment comes; pools that
 * bubble; tethers of light between figures), drawn as glowing specks; each boss's entrance (the
 * camera flies in to it, its name card, its roar) and its fall (the camera circling it as it dies,
 * the card, the last blast); a line under the boss bar at each phase; and the bosses' own embers,
 * frost and venom about them.
 */
function bossesKit(): ClientKit {
  let marks: Live[] = [];
  let cine: Cine | null = null;
  let el: HTMLElement;
  let phaseEl: HTMLElement;
  let phaseTimer: ReturnType<typeof setTimeout> | null = null;
  let unstyle: (() => void) | null = null;
  /** Each walking boss's last footfall (half walk cycles), by figure. */
  const strides = new Map<number, number>();
  /** The `/bosscam` cheat's view, while it's on. */
  let cam: CamMessage | null = null;
  const fwd = new Vec3();
  let tick = 0;
  let ambient = 0;
  const tmp = new Vec3();

  const q = (s: string) => el.querySelector(s) as HTMLElement;

  /** Where a figure stands (its feet), by an entity's id or a player's (this screen's own: its own place). */
  const where = (client: Client, who: number | string): V3 | null => {
    if (typeof who === 'string' && who === client.me.id) {
      const p = client.me.position;
      return [p.x, p.y, p.z];
    }
    const f = client.figures.all.find((x) => (typeof who === 'number' ? x.id === who && !x.player : x.player === who));
    if (!f) return null;
    f.root.getWorldPosition(tmp);
    return [tmp.x, tmp.y, tmp.z];
  };

  const stop = (client: Client, ease: number) => {
    cine = null;
    client.camera.release(ease);
    el.classList.remove('on', 'card', 'roar', 'fall', 'blast');
  };

  return {
    name: 'arena.bosses',
    setup(client) {
      unstyle = client.hud.style(CSS);
      const root = client.hud.layer('arena.bosses', 'panels');
      el = document.createElement('div');
      el.className = 'ab-cine';
      el.innerHTML = `
        <div class="ab-vig"></div>
        <div class="ab-bar top"></div><div class="ab-bar bottom"></div>
        <div class="ab-card">
          <div class="ab-kicker"><i></i><span></span><i></i></div>
          <div class="ab-name"></div>
          <div class="ab-rule"></div>
          <div class="ab-title"></div>
        </div>`;
      phaseEl = document.createElement('div');
      phaseEl.className = 'ab-phase';
      phaseEl.innerHTML = '<div class="ab-phase-text"></div><div class="ab-phase-sub"></div>';
      root.append(el, phaseEl);

      client.on(MARK_MSG, (data) => {
        const m = data as Mark;
        if (m.k === 'clear') {
          marks = marks.filter((x) => x.m.id !== m.id);
          return;
        }
        marks.push({ m, t0: client.time, rgb: rgbOf(m.c), lost: 0 });
      });
      client.on(INTRO_MSG, (data) => {
        const m = data as IntroMessage;
        cine = { kind: 'intro', t: 0, time: m.time, id: m.id, at: m.at, height: m.height, yaw: m.yaw, color: m.color, beat: m.roar, struck: false, from: 0, turn: 0, side: 1 };
        // The hero shots from whichever side sees more of it (a pillar can stand in the way).
        const [hx, hz] = [-Math.sin(m.yaw), -Math.cos(m.yaw)];
        const shot = (side: number): V3 => [m.at[0] + hx * (m.height * 1.65 + 2.2) - hz * side * (m.height * 0.55 + 0.8), m.at[1] + m.height * 0.2 + 0.5, m.at[2] + hz * (m.height * 1.65 + 2.2) + hx * side * (m.height * 0.55 + 0.8)];
        cine.side = blocked(client, shot(-1), m.at, m.height) < blocked(client, shot(1), m.at, m.height) ? -1 : 1;
        q('.ab-kicker span').textContent = 'A champion of the pit';
        q('.ab-name').textContent = m.name;
        q('.ab-title').textContent = m.title;
        el.style.setProperty('--boss', m.color);
        el.classList.remove('card', 'roar', 'fall', 'blast');
        el.classList.add('on');
        client.audio.play('boss_sting', { volume: 1 });
      });
      client.on(FALL_MSG, (data) => {
        const m = data as FallMessage;
        const me = client.camera.position;
        cine = { kind: 'fall', t: 0, time: m.time + m.hold, id: m.id, at: m.at, height: m.height, yaw: 0, color: m.color, beat: m.time, struck: false, ...orbit(client, m.at, m.height, Math.atan2(me.z - m.at[2], me.x - m.at[0])), side: 1 };
        q('.ab-kicker span').textContent = m.name;
        q('.ab-name').textContent = 'Vanquished';
        q('.ab-title').textContent = m.by ? `Felled by ${m.by}` : 'The arena roars';
        el.style.setProperty('--boss', m.color);
        el.classList.remove('card', 'roar', 'blast');
        el.classList.add('on', 'fall');
      });
      client.on(CAM_MSG, (data) => {
        cam = data as CamMessage | null;
        if (!cam) client.camera.release(0.5);
      });
      client.on(PHASE_MSG, (data) => {
        const m = data as PhaseMessage;
        (phaseEl.querySelector('.ab-phase-text') as HTMLElement).textContent = m.text;
        (phaseEl.querySelector('.ab-phase-sub') as HTMLElement).textContent = m.sub ?? '';
        phaseEl.style.setProperty('--boss', m.color);
        phaseEl.classList.remove('on');
        void phaseEl.offsetWidth;
        phaseEl.classList.add('on');
        if (phaseTimer) clearTimeout(phaseTimer);
        phaseTimer = setTimeout(() => phaseEl.classList.remove('on'), 3400);
        client.audio.play('boss_phase', { volume: 0.9 });
      });
    },

    frame(client, dt) {
      if (client.events.some((e) => e.t === 'reset')) {
        marks = [];
        strides.clear();
        if (cine) stop(client, 0);
      }
      if (cine) playCine(client, dt);
      else if (cam) viewBoss(client, cam);
      // The marks, a few dozen times a second (each speck outlives a frame or two).
      tick += dt;
      if (tick >= 1 / MARK_RATE) {
        tick %= 1 / MARK_RATE;
        marks = marks.filter((x) => drawMark(client, x));
      }
      ambient += dt;
      if (ambient >= 0.05) {
        for (const f of client.figures.all) if (!f.player && f.state.dying === 0) aura(client, f, ambient);
        ambient = 0;
      }
      for (const f of client.figures.all) if (!f.player && STEPS[f.type]) footfall(client, f);
    },

    dispose() {
      if (phaseTimer) clearTimeout(phaseTimer);
      unstyle?.();
    },
  };

  /** A tether's ends, or a mark of the ground: drawn this once; false once it's done. */
  function drawMark(client: Client, x: Live): boolean {
    const { m, rgb } = x;
    const age = client.time - x.t0;
    const u = Math.min(1, age / Math.max(0.05, m.t));
    if (age >= m.t) return false;
    const fx = client.fx;
    const speck = (p: V3, o: { size?: number; glow?: number; up?: number; life?: number; color?: RGB; spread?: number } = {}) =>
      fx.particles({ x: p[0], y: p[1], z: p[2] }, o.color ?? rgb, { count: 1, speed: 0, size: o.size ?? 0.15, gravity: 0, glow: o.glow ?? 0.8, life: o.life ?? SPECK, up: o.up ?? 0, spread: o.spread ?? 0, drag: 0 });
    const hot: RGB = [Math.min(1, rgb[0] * 1.25 + 0.1), Math.min(1, rgb[1] * 1.25 + 0.1), Math.min(1, rgb[2] * 1.25 + 0.1)];
    const pulse = 0.85 + 0.15 * Math.sin(age * 14);

    if (m.k === 'ring' || m.k === 'sweep') {
      const [cx, cy, cz] = m.at;
      const y = cy + 0.1;
      const [a0, a1] = m.k === 'sweep' ? [m.a0, m.a1] : [0, Math.PI * 2];
      const arc = (r: number, n: number, o: Parameters<typeof speck>[1]) => {
        for (let i = 0; i <= n; i++) {
          const a = a0 + ((a1 - a0) * (i + (m.k === 'ring' ? age * 0.6 : 0))) / n;
          speck([cx + Math.cos(a) * r, y, cz + Math.sin(a) * r], o);
        }
      };
      const span = (a1 - a0) * m.r;
      arc(m.r, Math.max(10, Math.min(110, Math.round(span * 2.6))), { size: 0.12 * pulse, glow: 0.8 });
      // The fill: a bright edge sweeping out from the middle as the moment comes.
      if (u > 0.02) arc(m.r * u, Math.max(6, Math.min(90, Math.round(span * u * 2.2))), { size: 0.16, glow: 1.3, color: hot });
      if (m.k === 'sweep')
        for (const a of [a0, a1]) for (let d = 0.6; d < m.r; d += 0.45) speck([cx + Math.cos(a) * d, y, cz + Math.sin(a) * d], { size: 0.13 });
      // Embers rising off the ground inside it.
      const n = Math.min(14, Math.ceil((span * m.r) / 12));
      for (let i = 0; i < n; i++) {
        const a = a0 + Math.random() * (a1 - a0);
        const d = Math.sqrt(Math.random()) * m.r;
        speck([cx + Math.cos(a) * d, y, cz + Math.sin(a) * d], { size: 0.09, glow: 1, up: 0.8 + u * 1.5, life: 0.45 });
      }
      return true;
    }
    if (m.k === 'lane') {
      const [ax, ay, az] = m.at;
      const [bx, , bz] = m.to;
      const len = Math.hypot(bx - ax, bz - az) || 1;
      const dx = (bx - ax) / len, dz = (bz - az) / len;
      const hw = m.w / 2;
      const y = ay + 0.1;
      const at = (along: number, side: number): V3 => [ax + dx * along - dz * side, y, az + dz * along + dx * side];
      for (let d = 0; d <= len; d += 0.5) for (const s of [-hw, hw]) speck(at(d, s), { size: 0.13 * pulse });
      for (let s = -hw; s <= hw; s += 0.45) speck(at(len, s), { size: 0.13 });
      // The fill races down it.
      for (let s = -hw; s <= hw; s += 0.35) speck(at(len * u, s), { size: 0.16, glow: 1.3, color: hot });
      for (let i = 0; i < 6; i++) speck(at(Math.random() * len, (Math.random() * 2 - 1) * hw), { size: 0.1, up: 1.2, life: 0.45 });
      return true;
    }
    if (m.k === 'pool') {
      const [cx, cy, cz] = m.at;
      const y = cy + 0.08;
      const fade = Math.min(1, (m.t - age) / 0.6);
      const n = Math.round(m.r * 7);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + age * 0.3;
        speck([cx + Math.cos(a) * m.r, y, cz + Math.sin(a) * m.r], { size: 0.13 * fade, glow: 0.9 });
      }
      // Bubbling: a surface of specks, some rising and popping.
      for (let i = 0; i < Math.round(m.r * m.r * 1.6); i++) {
        const a = Math.random() * Math.PI * 2;
        const d = Math.sqrt(Math.random()) * m.r;
        speck([cx + Math.cos(a) * d, y, cz + Math.sin(a) * d], { size: (0.12 + Math.random() * 0.14) * fade, glow: 0.7, life: 0.25 });
      }
      for (let i = 0; i < Math.ceil(m.r); i++) {
        const a = Math.random() * Math.PI * 2;
        const d = Math.sqrt(Math.random()) * m.r;
        speck([cx + Math.cos(a) * d, y, cz + Math.sin(a) * d], { size: 0.09, glow: 1.2, up: 1, life: 0.6 });
      }
      return true;
    }
    // A tether: specks along it and now and then a streak racing from one end to the other.
    const a = where(client, m.a);
    const b = where(client, m.b);
    if (!a || !b) {
      x.lost += 1 / MARK_RATE;
      return x.lost < 0.6;
    }
    x.lost = 0;
    const ha = typeof m.a === 'number' ? 1.4 : 1.1;
    const hb = typeof m.b === 'number' ? 2.6 : 1.1;
    const from: V3 = [a[0], a[1] + ha, a[2]];
    const to: V3 = [b[0], b[1] + hb, b[2]];
    const len = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
    const n = Math.min(60, Math.ceil(len / 0.55));
    const wob = age * 9;
    for (let i = 0; i <= n; i++) {
      const s = i / n;
      const w = Math.sin(s * Math.PI) * 0.18;
      speck([from[0] + (to[0] - from[0]) * s + Math.sin(wob + i) * w, from[1] + (to[1] - from[1]) * s + Math.cos(wob * 1.3 + i) * w, from[2] + (to[2] - from[2]) * s], { size: 0.13, glow: 2 });
    }
    if (Math.random() < 0.25) fx.tracer({ x: from[0], y: from[1], z: from[2] }, { x: to[0], y: to[1], z: to[2] }, m.c, { speed: 38, length: 2.4, width: 0.14, glow: 3 });
    return true;
  }

  /** The cinematic's frame: the camera on the boss, the card, the beat. */
  function playCine(client: Client, dt: number) {
    const c = cine!;
    c.t += dt;
    const live = where(client, c.id);
    const [px, py, pz] = live ?? c.at;
    const h = c.height;
    if (c.kind === 'intro') {
      el.classList.toggle('card', c.t > 0.9 && c.t < c.time - 0.55);
      if (!c.struck && c.t >= c.beat) {
        c.struck = true;
        el.classList.add('roar');
        client.fx.shake(0.55, 1.3);
        client.input.rumble(0.8, 0.5, 600);
      }
      // From high and wide behind its line of sight, down to a low hero's angle in front of it, then a slow push in.
      const fx = -Math.sin(c.yaw), fz = -Math.cos(c.yaw);
      const rx = -fz, rz = fx;
      const key = (fwd: number, side: number, up: number): V3 => [px + fx * fwd + rx * side, py + up, pz + fz * fwd + rz * side];
      const keys: { t: number; at: V3; look: V3 }[] = [
        { t: 0, at: key(h * 3.4 + 7, h * 1.5 + 3, h * 1.7 + 5), look: [px, py + h * 0.45, pz] },
        { t: c.beat - 0.15, at: key(h * 1.65 + 2.2, c.side * (h * 0.55 + 0.8), h * 0.18 + 0.5), look: [px, py + h * 0.62, pz] },
        { t: c.time, at: key(h * 1.35 + 1.6, -c.side * (h * 0.25 + 0.4), h * 0.26 + 0.6), look: [px, py + h * 0.6, pz] },
      ];
      const i = c.t < keys[1].t ? 0 : 1;
      const s = smooth(Math.min(1, (c.t - keys[i].t) / (keys[i + 1].t - keys[i].t)));
      const lerp3 = (A: V3, B: V3): V3 => [A[0] + (B[0] - A[0]) * s, A[1] + (B[1] - A[1]) * s, A[2] + (B[2] - A[2]) * s];
      const look = lerp3(keys[i].look, keys[i + 1].look);
      const at = clearOf(client, look, lerp3(keys[i].at, keys[i + 1].at));
      client.camera.take({ position: { x: at[0], y: at[1], z: at[2] }, target: { x: look[0], y: look[1], z: look[2] }, fov: 56 - 10 * Math.min(1, c.t / c.time) });
      if (c.t >= c.time) stop(client, 0.9);
      return;
    }
    // A fall: circling it as it dies, coming down lower; the last blast; a moment's hold.
    el.classList.toggle('card', c.t > 0.5 && c.t < c.time - 0.3);
    if (!c.struck && c.t >= c.beat) {
      c.struck = true;
      el.classList.add('blast');
      client.fx.flash('#ffffff', 0.55, 0.7);
      client.fx.shake(0.7, 1.2);
      client.input.rumble(1, 0.8, 900);
      client.audio.play('boss_vanquished', { volume: 1 });
    }
    const u = Math.min(1, c.t / c.time);
    const a = c.from + c.turn * 0.9 * smooth(u);
    const d = FALL_REACH(h);
    const look: V3 = [px, py + h * (0.5 - 0.15 * u), pz];
    const at = clearOf(client, look, [px + Math.cos(a) * d, py + h * (0.75 - 0.35 * u) + 1.5, pz + Math.sin(a) * d]);
    client.camera.take({ position: { x: at[0], y: at[1], z: at[2] }, target: { x: look[0], y: look[1], z: look[2] }, fov: 58 });
    if (c.t >= c.time) stop(client, 1);
  }

  /** The `/bosscam` view: round the boss from in front of it (its figure's facing), looking at it. */
  function viewBoss(client: Client, c: CamMessage) {
    const f = client.figures.all.find((x) => x.id === c.id && !x.player);
    if (!f) {
      // It's gone: the view's the player's again.
      cam = null;
      client.camera.release(0.5);
      return;
    }
    f.root.getWorldPosition(tmp);
    fwd.set(0, 0, 1).applyQuaternion(f.root.quaternion);
    const a = Math.atan2(fwd.x, fwd.z) + c.angle;
    client.camera.take({ position: { x: tmp.x + Math.sin(a) * c.dist, y: tmp.y + c.up, z: tmp.z + Math.cos(a) * c.dist }, target: { x: tmp.x, y: tmp.y + c.height * c.look, z: tmp.z }, fov: 50 });
  }

  /** How many of the lines from `at` to a boss standing at `p`, `h` tall (its feet, its middle, its head), something solid cuts. */
  function blocked(client: Client, at: V3, p: V3, h: number): number {
    let n = 0;
    for (const f of [0.2, 0.5, 0.85]) if (!client.world.lineOfSight({ x: at[0], y: at[1], z: at[2] }, { x: p[0], y: p[1] + h * f, z: p[2] })) n++;
    return n;
  }

  /** The fall's orbit: the clearest start near `from` (radians round the boss), and the clearer way to turn. */
  function orbit(client: Client, p: V3, h: number, from: number): { from: number; turn: number } {
    const d = FALL_REACH(h);
    const cam = (a: number): V3 => [p[0] + Math.cos(a) * d, p[1] + h * 0.6 + 1.5, p[2] + Math.sin(a) * d];
    let best = { from, turn: 1, cost: Infinity };
    for (let k = 0; k < 18; k++) {
      const a = from + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.35;
      for (const turn of [1, -1]) {
        const cost = blocked(client, cam(a), p, h) * 10 + blocked(client, cam(a + turn * 0.9), p, h) * 6 + Math.ceil(k / 2) * 0.4;
        if (cost < best.cost) best = { from: a, turn, cost };
      }
    }
    return best;
  }

  /** The camera at `at`, or pulled in toward `look` before anything solid between them. */
  function clearOf(client: Client, look: V3, at: V3): V3 {
    const d: V3 = [at[0] - look[0], at[1] - look[1], at[2] - look[2]];
    const len = Math.hypot(d[0], d[1], d[2]) || 1;
    const n = { x: d[0] / len, y: d[1] / len, z: d[2] / len };
    const hit = client.world.raycast({ x: look[0], y: look[1], z: look[2] }, n, len + 0.6);
    const k = hit ? Math.max(2, hit.distance - 0.6) : len;
    return [look[0] + n.x * k, look[1] + n.y * k, look[2] + n.z * k];
  }

  /** A walking boss's feet coming down (each half of its walk cycle): a thud, dust, the ground shaking under whoever's near. */
  function footfall(client: Client, f: Figure) {
    const step = STEPS[f.type];
    const n = Math.floor(f.state.walkPhase / Math.PI);
    const last = strides.get(f.id);
    strides.set(f.id, n);
    if (last === undefined || n === last || f.state.walkAmount < 0.4 || f.state.air) return;
    f.root.getWorldPosition(tmp);
    const at = { x: tmp.x, y: tmp.y + 0.1, z: tmp.z };
    client.audio.play(step.sound, { at, volume: step.volume, pitch: 0.9 + Math.random() * 0.2 });
    client.fx.particles(at, DUST, { count: step.dust, speed: 1.6, size: 0.16, gravity: -0.4, life: 0.9, spread: step.spread, up: 0.4, drag: 2 });
    const me = client.me.position;
    const d = Math.hypot(me.x - at.x, me.z - at.z);
    if (step.shake && d < 14) client.fx.shake(step.shake * (1 - d / 14), 0.25);
  }

  /** A boss's own air about it: the Colossus's embers, the Warden's soul fire, the Broodmother's venom, the Lich King's frost. */
  function aura(client: Client, f: Figure, dt: number) {
    const look = AURA[f.type];
    if (!look) return;
    f.root.getWorldPosition(tmp);
    const p = { x: tmp.x, y: tmp.y + look.y, z: tmp.z };
    const n = look.rate * dt;
    const count = Math.floor(n) + (Math.random() < n % 1 ? 1 : 0);
    if (count) client.fx.particles(p, look.rgb, { count, speed: look.speed, size: look.size, gravity: look.gravity, glow: look.glow, life: look.life, spread: look.spread, up: look.up, drag: 1 });
  }
}

/** Dust kicked up by a boss's feet. */
const DUST = rgbOf('#c9b48a');
/** The bosses that walk: each footfall's sound, how loud, how much dust over how wide, how much it shakes the ground. */
const STEPS: Record<string, { sound: string; volume: number; dust: number; spread: number; shake: number }> = {
  colossus: { sound: 'colossus_step', volume: 1, dust: 10, spread: 1.6, shake: 0.12 },
  warden: { sound: 'warden_step', volume: 0.7, dust: 5, spread: 0.8, shake: 0.04 },
  broodmother: { sound: 'brood_step', volume: 0.6, dust: 4, spread: 2, shake: 0 },
};

/** How far from a falling boss `h` tall the camera circles. */
const FALL_REACH = (h: number) => h * 1.6 + 3.5;

/** Each boss's air: where (height over its feet), how much (specks a second), and how they move. */
const AURA: Record<string, { y: number; rate: number; rgb: RGB; speed: number; size: number; gravity: number; glow: number; life: number; spread: number; up: number }> = {
  colossus: { y: 3.9, rate: 28, rgb: rgbOf('#ff9a3a'), speed: 0.4, size: 0.12, gravity: -1.6, glow: 1.6, life: 1.2, spread: 1.1, up: 0.5 },
  warden: { y: 3, rate: 24, rgb: rgbOf('#b76bff'), speed: 0.4, size: 0.11, gravity: -1.6, glow: 1.5, life: 1, spread: 1, up: 0.4 },
  broodmother: { y: 1.4, rate: 10, rgb: rgbOf('#7fd23a'), speed: 0.2, size: 0.1, gravity: 9, glow: 0.8, life: 0.9, spread: 1.6, up: 0 },
  lich: { y: 0.7, rate: 30, rgb: rgbOf('#cdf6ff'), speed: 0.6, size: 0.16, gravity: 0.4, glow: 0.7, life: 1.4, spread: 1.4, up: 0.1 },
  phylactery: { y: 1.6, rate: 8, rgb: rgbOf('#9fe8ff'), speed: 0.3, size: 0.09, gravity: -1.5, glow: 1.6, life: 0.9, spread: 0.3, up: 0.3 },
};

/** The HUD theme's faces (`hud.theme`): Cinzel for titles, Oswald for labels. */
const DISPLAY = `var(--hud-display, 'Cinzel', 'Trajan Pro', 'Palatino Linotype', Georgia, serif)`;
const LABEL = `var(--ar-label, 'Oswald', 'Arial Narrow', sans-serif)`;

const CSS = /* css */ `
.ab-cine { position: absolute; inset: 0; pointer-events: none; opacity: 0; transition: opacity 400ms ease; --boss: #ffb24a; }
.ab-cine.on { opacity: 1; }
/* While a boss's entrance or fall plays: the rest of the HUD out of the way. */
body:has(.ab-cine.on) :is(.hud, .gamehud) > :not([data-layer="arena.bosses"], .water-tint) { opacity: 0 !important; transition: opacity 300ms ease; }
.ab-vig { position: absolute; inset: 0; background: radial-gradient(ellipse at 50% 55%, transparent 45%, rgba(0, 0, 0, 0.55) 100%); }
.ab-cine.roar .ab-vig { animation: ab-throb 1.3s ease-out; }
@keyframes ab-throb { 0% { background-color: color-mix(in srgb, var(--boss) 22%, transparent); } 100% { background-color: transparent; } }
.ab-bar { position: absolute; left: 0; right: 0; height: 0; background: #050404; transition: height 600ms cubic-bezier(0.2, 0.8, 0.2, 1); }
.ab-bar.top { top: 0; }
.ab-bar.bottom { bottom: 0; }
.ab-cine.on .ab-bar { height: 11vh; }

.ab-card { position: absolute; left: 50%; bottom: 15vh; transform: translateX(-50%); display: flex; flex-direction: column; align-items: center; text-align: center; white-space: nowrap; isolation: isolate; }
/* A soft shade behind the card, so it reads on a bright floor (the Sanctum's ice) as on a dark one. */
.ab-card::before { content: ''; position: absolute; left: 50%; top: 50%; z-index: -1; width: min(1200px, 96vw); height: 230%; transform: translate(-50%, -50%); pointer-events: none;
  background: radial-gradient(closest-side, rgba(5, 4, 4, 0.5), rgba(5, 4, 4, 0.28) 55%, transparent); opacity: 0; transition: opacity 700ms ease; }
.ab-cine.card .ab-card::before { opacity: 1; }
.ab-kicker { display: flex; align-items: center; gap: 14px; font: 500 14px/1 ${LABEL}; letter-spacing: 0.42em; margin-right: -0.42em; text-transform: uppercase; color: rgba(255, 244, 222, 0.78);
  opacity: 0; transform: translateY(8px); transition: opacity 500ms ease, transform 700ms cubic-bezier(0.2, 0.8, 0.2, 1); text-shadow: 0 2px 8px rgba(0, 0, 0, 0.8); }
.ab-kicker i { display: block; width: 7px; height: 7px; background: var(--boss); transform: rotate(45deg); box-shadow: 0 0 10px var(--boss); }
.ab-name { margin-top: 12px; font: 700 clamp(40px, 7.4vh, 84px)/1 ${DISPLAY}; letter-spacing: 0.9em; margin-right: -0.9em; text-transform: uppercase;
  color: #fff7e8; opacity: 0; filter: blur(12px);
  text-shadow: 0 0 18px color-mix(in srgb, var(--boss) 80%, transparent), 0 0 46px color-mix(in srgb, var(--boss) 55%, transparent), 0 3px 0 rgba(0, 0, 0, 0.6), 0 6px 18px rgba(0, 0, 0, 0.7);
  transition: letter-spacing 1600ms cubic-bezier(0.1, 0.8, 0.2, 1), margin-right 1600ms cubic-bezier(0.1, 0.8, 0.2, 1), opacity 700ms ease, filter 900ms ease; }
.ab-rule { margin-top: 16px; width: 0; height: 2px; background: linear-gradient(90deg, transparent, var(--boss) 18%, #fff3d6 50%, var(--boss) 82%, transparent);
  box-shadow: 0 0 12px var(--boss); transition: width 1100ms cubic-bezier(0.2, 0.8, 0.2, 1) 250ms; }
.ab-title { margin-top: 14px; font: italic 500 clamp(16px, 2.4vh, 24px)/1.2 ${DISPLAY}; letter-spacing: 0.12em; color: rgba(255, 240, 214, 0.9);
  opacity: 0; transform: translateY(-6px); text-shadow: 0 2px 10px rgba(0, 0, 0, 0.9); transition: opacity 700ms ease 450ms, transform 900ms cubic-bezier(0.2, 0.8, 0.2, 1) 450ms; }
.ab-cine.card .ab-kicker { opacity: 1; transform: none; }
.ab-cine.card .ab-name { opacity: 1; filter: blur(0); letter-spacing: 0.2em; margin-right: -0.2em; }
.ab-cine.card .ab-rule { width: min(720px, 62vw); }
.ab-cine.card .ab-title { opacity: 1; transform: none; }
/* The roar: the name jolts and burns brighter for a moment. */
.ab-cine.roar .ab-name { animation: ab-roar 900ms cubic-bezier(0.2, 0.8, 0.3, 1); }
@keyframes ab-roar {
  0% { transform: scale(1); }
  8% { transform: scale(1.09) translate(3px, -2px); text-shadow: 0 0 30px var(--boss), 0 0 80px var(--boss), 0 3px 0 rgba(0, 0, 0, 0.6); }
  16% { transform: scale(1.06) translate(-3px, 2px); }
  26% { transform: scale(1.07) translate(2px, 1px); }
  100% { transform: scale(1); }
}
/* A fall: the card higher, "Vanquished" in the HUD's gold, the blast whitening it. */
.ab-cine.fall .ab-card { bottom: auto; top: 22vh; }
.ab-cine.fall .ab-name { color: transparent; text-shadow: none; background: linear-gradient(180deg, #fff8e6 15%, var(--ar-gold, #f0c060) 60%, #b9802c 95%);
  -webkit-background-clip: text; background-clip: text; filter: drop-shadow(0 0 14px color-mix(in srgb, var(--boss) 70%, transparent)) drop-shadow(0 3px 0 rgba(0, 0, 0, 0.6)); }
.ab-cine.blast .ab-name { animation: ab-blast 1100ms ease-out; }
@keyframes ab-blast { 0% { transform: scale(1.18); filter: brightness(2.2); } 100% { transform: scale(1); filter: brightness(1); } }

/* A phase's line, under the boss bar. */
.ab-phase { position: absolute; left: 50%; top: 104px; transform: translateX(-50%); display: flex; flex-direction: column; align-items: center; pointer-events: none; opacity: 0; --boss: #ffb24a; white-space: nowrap; }
.ab-phase.on { animation: ab-phase 3400ms ease forwards; }
@keyframes ab-phase { 0% { opacity: 0; transform: translateX(-50%) scale(1.25); } 7% { opacity: 1; transform: translateX(-50%) scale(1); } 85% { opacity: 1; } 100% { opacity: 0; transform: translateX(-50%) translateY(-6px); } }
.ab-phase-text { font: 700 clamp(22px, 3.6vh, 38px)/1 ${DISPLAY}; letter-spacing: 0.22em; margin-right: -0.22em; text-transform: uppercase; color: #fff4e0;
  text-shadow: 0 0 16px var(--boss), 0 0 36px color-mix(in srgb, var(--boss) 60%, transparent), 0 2px 0 rgba(0, 0, 0, 0.7); }
.ab-phase-sub { margin-top: 8px; font: 500 15px/1 ${LABEL}; letter-spacing: 0.18em; text-transform: uppercase; color: rgba(255, 240, 214, 0.85); text-shadow: 0 2px 6px rgba(0, 0, 0, 0.9); }
.ab-phase-sub:empty { display: none; }
@media (max-width: 900px) { .ab-name { letter-spacing: 0.12em; } .ab-cine.card .ab-rule { width: 80vw; } }
`;

/** The bosses on screen: entrance cinematics, telegraphs, their air. (Their voices are `sounds/bosses.ts`.) */
export const bossesClient: ClientPart = { name: 'bossesClient', kits: [bossesKit()] };
