import type { SimFrame } from '../sim/sim';

interface Timed {
  time: number;
  frame: SimFrame;
}

/**
 * Smooth playback of a server's frames. They come a few dozen times a second and unevenly;
 * drawing each as it lands would stutter. This keeps the latest few and draws the moment `delay`
 * seconds behind the newest, blending positions between the two frames around it. Timing uses
 * the host's clock stamped on each frame, so network jitter doesn't show.
 */
export class FrameBuffer {
  private frames: Timed[] = [];
  /** Local seconds minus host seconds for the quickest delivery seen (drifting up slowly). */
  private offset: number | null = null;
  /** Host time last drawn: playback never goes back, even as the offset estimate improves. */
  private shown = -Infinity;

  constructor(private delay: number) {}

  push(frame: SimFrame, hostTime: number, now = performance.now() / 1000) {
    const off = now - hostTime;
    this.offset = this.offset === null ? off : Math.min(off, this.offset + 0.0005);
    this.frames.push({ time: hostTime, frame: caughtUp(frame) });
    if (this.frames.length > 30) this.frames.shift();
  }

  /** The frame to draw now: blended, or the newest if playback has caught up. */
  sample(now = performance.now() / 1000): SimFrame | null {
    const fs = this.frames;
    if (!fs.length || this.offset === null) return null;
    const t = (this.shown = Math.max(this.shown, now - this.offset - this.delay));
    // Frames entirely in the past can go (keep the one just before `t`).
    while (fs.length > 2 && fs[1].time <= t) fs.shift();
    const a = fs[0];
    const b = fs[1];
    if (!b || t <= a.time) return a.frame;
    if (t >= b.time) return b.frame;
    return blend(a.frame, b.frame, (t - a.time) / (b.time - a.time));
  }
}

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

/**
 * Players where they are at the frame's time: a server plays whole inputs, so a player's state
 * trails the step a little (`lead`); drawn from there, they'd move in fits and starts.
 */
export function caughtUp(f: SimFrame): SimFrame {
  if (!f.players.some((p) => p.lead > 0)) return f;
  return { ...f, players: f.players.map((p) => (p.lead > 0 ? { ...p, x: p.x + p.vx * p.lead, y: p.y + p.vy * p.lead, z: p.z + p.vz * p.lead, lead: 0 } : p)) };
}

function byId<T extends { id: number | string }>(list: T[]): Map<number | string, T> {
  return new Map(list.map((x) => [x.id, x]));
}

/** Frame `b`, with everything that moves put `k` of the way from where it was in `a`. */
export function blend(a: SimFrame, b: SimFrame, k: number): SimFrame {
  const pa = byId(a.players);
  const ea = byId(a.entities);
  const qa = byId(a.projectiles);
  const ka = byId(a.pickups);
  const ra = byId(a.props);
  return {
    ...b,
    t: lerp(a.t, b.t, k),
    clock: lerp(a.clock, b.clock, k),
    players: b.players.map((p) => {
      const o = pa.get(p.id);
      if (!o) return p;
      return {
        ...p,
        x: lerp(o.x, p.x, k),
        y: lerp(o.y, p.y, k),
        z: lerp(o.z, p.z, k),
        bob: lerp(o.bob, p.bob, k),
        camera: { ...p.camera, p: [0, 1, 2].map((i) => lerp(o.camera.p[i], p.camera.p[i], k)) as [number, number, number], q: nlerp(o.camera.q, p.camera.q, k), fov: lerp(o.camera.fov, p.camera.fov, k) },
      };
    }),
    entities: b.entities.map((e) => {
      const o = ea.get(e.id);
      return o ? { ...e, x: lerp(o.x, e.x, k), y: lerp(o.y, e.y, k), z: lerp(o.z, e.z, k) } : e;
    }),
    projectiles: b.projectiles.map((e) => {
      const o = qa.get(e.id);
      return o ? { ...e, x: lerp(o.x, e.x, k), y: lerp(o.y, e.y, k), z: lerp(o.z, e.z, k) } : e;
    }),
    pickups: b.pickups.map((e) => {
      const o = ka.get(e.id);
      return o ? { ...e, x: lerp(o.x, e.x, k), y: lerp(o.y, e.y, k), z: lerp(o.z, e.z, k) } : e;
    }),
    props: b.props.map((e) => {
      const o = ra.get(e.id);
      return o ? { ...e, p: [0, 1, 2].map((i) => lerp(o.p[i], e.p[i], k)) as [number, number, number], q: nlerp(o.q, e.q, k) } : e;
    }),
  };
}

/** Quaternion blend (normalised lerp, the short way round). */
function nlerp(a: [number, number, number, number], b: [number, number, number, number], k: number): [number, number, number, number] {
  const s = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3] < 0 ? -1 : 1;
  const q = [0, 1, 2, 3].map((i) => lerp(a[i], b[i] * s, k));
  const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}
