import type { ViewAnimation, ViewKey } from '@platform';
import { Mat4, Quat, Vec3 } from '@platform/client/math';
import { _item, armChain, DEG, Pose, X, Y, Z, type V3 } from './poses';

/**
 * The hand's animations: a use, a swing, a throw, a gun's action of the game's own. Each turns
 * the hand about a pivot, shifts it and turns the item in the fist, over normalised time.
 */

/** What an animation does this frame: turn the hand by `rot` about `pivot`, shift it, turn the item. */
export interface Motion {
  pivot: Vec3;
  rot: Quat;
  offset: Vec3;
  wrist: Quat;
}

export interface SampleContext {
  side: number;
  power: number;
  /** The fist, how far the hand is lowered (equip / attack recharge), and where the item points. */
  grip: Vec3;
  drop: number;
  axis: Vec3;
}

type Sampler = (t: number, m: Motion, c: SampleContext) => void;
export interface Anim {
  duration: number;
  sample: Sampler;
}

const _q = new Quat();
const _s = new Vec3();
const _m = new Mat4();
const _mi = new Mat4();

/** Pitch about x, then yaw about y, then roll about z (all in the parent's axes). */
export function pyr(p: number, y: number, r: number, out: Quat): Quat {
  out.setFromAxisAngle(Z, r);
  _q.setFromAxisAngle(Y, y);
  out.multiply(_q);
  _q.setFromAxisAngle(X, p);
  return out.multiply(_q);
}

export function ease(k: ViewKey['ease'], x: number): number {
  switch (k) {
    case 'in':
      return x * x * x;
    case 'out':
      return 1 - (1 - x) ** 3;
    case 'inOut':
      return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
    default:
      return x;
  }
}

type Channels = Pick<ViewKey, 'move' | 'hand' | 'wrist'>;

/** Keyframes or a `sample` function (both authored for the right hand), turning about the fist. */
export function compile(anim: ViewAnimation): Anim {
  const out: Channels = {};
  const lerpKeys = (keys: ViewKey[], t: number) => {
    let i = 1;
    while (i < keys.length - 1 && keys[i].t < t) i++;
    const a = keys[i - 1] ?? keys[0];
    const b = keys[i] ?? a;
    const span = b.t - a.t;
    const x = ease(b.ease, span > 0 ? Math.min(1, Math.max(0, (t - a.t) / span)) : 1);
    const mix = (u?: V3, v?: V3): V3 => {
      const p = u ?? [0, 0, 0];
      const q = v ?? [0, 0, 0];
      return [p[0] + (q[0] - p[0]) * x, p[1] + (q[1] - p[1]) * x, p[2] + (q[2] - p[2]) * x];
    };
    out.move = mix(a.move, b.move);
    out.hand = mix(a.hand, b.hand);
    out.wrist = mix(a.wrist, b.wrist);
    return out;
  };
  return {
    duration: anim.duration,
    sample: (t, m, c) => {
      const k = 'keys' in anim ? lerpKeys(anim.keys, t) : anim.sample(t);
      const [mx, my, mz] = k.move ?? [0, 0, 0];
      const [hp, hy, hr] = k.hand ?? [0, 0, 0];
      const [wp, wy, wr] = k.wrist ?? [0, 0, 0];
      const p = c.power;
      const l = c.side;
      m.pivot.copy(c.grip);
      m.offset.set(l * mx * p, my * p, mz * p);
      pyr(hp * p, l * hy * p, l * hr * p, m.rot);
      pyr(wp * p, l * wy * p, l * wr * p, m.wrist);
    },
  };
}

const _c0 = new Pose();
const _c1 = new Pose();

/** How Minecraft's first-person arm has moved at swing progress `s`, as a rigid motion. */
function armDelta(s: number, m: Motion, c: SampleContext) {
  armChain(_c0, c.side, 0, c.drop);
  armChain(_c1, c.side, Math.min(1, s), c.drop);
  _m.copy(_c1.m).multiply(_mi.copy(_c0.m).invert());
  _m.decompose(m.offset, m.rot, _s);
  m.pivot.set(0, 0, 0);
}

/** The built-in animations (a game's `hold.use`, `play` and `define` name them too). */
/**
 * Minecraft's eating pose (`applyEatTransform`), held while they eat: the item at the mouth,
 * bobbing a bite every fifth of a second. `time`: seconds they've been eating.
 */
export function eatPose(time: number, m: Motion, c: SampleContext) {
  const l = c.side;
  const bob = time > 0.2 ? Math.abs(Math.cos(time * 5 * Math.PI)) * 0.1 : 0;
  _item.reset().translate(l * 0.6, -0.5 + bob, 0).rotY(l * 90).rotX(10).rotZ(l * 30);
  m.pivot.set(0, 0, 0);
  _item.m.decompose(m.offset, m.rot, _s);
  m.wrist.identity();
}

export const BUILTIN: Record<string, Anim> = {
  // Minecraft's arm swing (`renderPlayerArm`), with the blade chopping forward in the fist.
  swing: {
    duration: 0.3,
    sample: (s, m, c) => {
      armDelta(s, m, c);
      m.wrist.setFromAxisAngle(X, -55 * DEG * Math.sin(Math.sqrt(s) * Math.PI) * c.power);
    },
  },
  // The bare-hand version: just the arm.
  punch: {
    duration: 0.3,
    sample: (s, m, c) => {
      armDelta(s, m, c);
      m.wrist.identity();
    },
  },
  // Minecraft's eat / drink pose (`applyEatTransform`): up to the mouth, a few gulps, back down.
  drink: {
    duration: 0.9,
    sample: (t, m, c) => {
      const l = c.side;
      const up = t < 0.12 ? ease('out', t / 0.12) : t > 0.85 ? ease('inOut', (1 - t) / 0.15) : 1;
      const bob = t > 0.15 && t < 0.85 ? Math.abs(Math.cos(t * 0.9 * 20 * 0.25 * Math.PI)) * 0.1 : 0;
      _item.reset().translate(l * 0.6 * up, -0.5 * up + bob * up, 0).rotY(l * 90 * up).rotX(10 * up).rotZ(l * 30 * up);
      m.pivot.set(0, 0, 0);
      _item.m.decompose(m.offset, m.rot, _s);
      m.wrist.identity();
    },
  },
  // A diagonal cut for 3D blades: cock it back over the right shoulder, sweep it across the
  // middle of the screen to the left (mostly a roll, so the blade stays in view), recover.
  slash: compile({
    duration: 0.34,
    keys: [
      { t: 0 },
      { t: 0.2, hand: [0.25, -0.1, -0.6], move: [0.06, 0.1, 0.05], ease: 'out' },
      { t: 0.45, hand: [-0.1, 0.25, 0.85], move: [-0.18, 0.12, -0.12], ease: 'in' },
      { t: 0.62, hand: [-0.25, 0.3, 1.3], move: [-0.28, -0.02, -0.08], ease: 'out' },
      { t: 1, ease: 'inOut' },
    ],
  }),
  // Drinking from a held bottle: up toward your mouth, neck tipped to you, a few gulps.
  sip: compile({
    duration: 0.9,
    keys: [
      { t: 0 },
      { t: 0.18, hand: [0.75, 0.15, 0.3], move: [-0.22, 0.17, 0.08], ease: 'out' },
      { t: 0.34, hand: [0.9, 0.15, 0.3], move: [-0.22, 0.2, 0.09], ease: 'inOut' },
      { t: 0.5, hand: [0.75, 0.15, 0.3], move: [-0.22, 0.17, 0.08], ease: 'inOut' },
      { t: 0.66, hand: [0.9, 0.15, 0.3], move: [-0.22, 0.2, 0.09], ease: 'inOut' },
      { t: 0.8, hand: [0.75, 0.15, 0.3], move: [-0.22, 0.17, 0.08], ease: 'inOut' },
      { t: 1, ease: 'inOut' },
    ],
  }),
  // An overhead hew for axes and hammers: heave it back, bring it down in front of you.
  hew: compile({
    duration: 0.44,
    keys: [
      { t: 0 },
      { t: 0.36, hand: [0.4, -0.05, -0.15], move: [0.02, 0.1, 0.05], ease: 'out' },
      { t: 0.56, hand: [-0.85, 0.15, 0.2], move: [-0.06, -0.06, -0.16], ease: 'in' },
      { t: 1, ease: 'inOut' },
    ],
  }),
  // Two-handed thrust along the shaft: out fast, back steady.
  jab: {
    duration: 0.34,
    sample: (t, m, c) => {
      const k = t < 0.3 ? ease('out', t / 0.3) : 1 - ease('inOut', (t - 0.3) / 0.7);
      m.pivot.copy(c.grip);
      m.rot.identity();
      m.wrist.identity();
      m.offset.copy(c.axis).multiplyScalar(0.45 * k * c.power);
      m.offset.y += 0.03 * k;
    },
  },
  // Bow recoil after a shot.
  release: compile({
    duration: 0.25,
    keys: [{ t: 0 }, { t: 0.2, hand: [0.2, 0, 0], move: [0, 0.03, 0.06], ease: 'out' }, { t: 1, ease: 'inOut' }],
  }),
  // Stylised alternatives a game can pick with `hold.use`.
  chop: compile({
    duration: 0.45,
    keys: [
      { t: 0 },
      { t: 0.4, hand: [0.5, 0.1, -0.1], wrist: [0.4, 0, 0], move: [-0.02, 0.08, 0.04], ease: 'out' },
      { t: 0.6, hand: [-0.6, 0.3, 0.2], wrist: [-0.9, 0, 0], move: [-0.12, -0.06, -0.1], ease: 'in' },
      { t: 1, ease: 'inOut' },
    ],
  }),
  stab: compile({
    duration: 0.3,
    keys: [{ t: 0 }, { t: 0.3, wrist: [-1.1, 0, 0], move: [-0.12, 0.08, -0.3], ease: 'out' }, { t: 1, ease: 'inOut' }],
  }),
  // A throw from the `throw` pose: a last cock back, then the arm whips forward and across and
  // follows through down out of sight (the throwable's gone from the hand by then).
  toss: compile({
    duration: 0.34,
    keys: [
      { t: 0 },
      { t: 0.14, hand: [-0.35, 0.1, 0.1], move: [0.03, 0.05, 0.08], ease: 'out' },
      { t: 0.38, hand: [1.1, 0.25, -0.2], move: [-0.2, -0.02, -0.42], ease: 'in' },
      { t: 1, hand: [1.5, 0.3, -0.3], move: [-0.22, -0.75, -0.25], ease: 'out' },
    ],
  }),
};
