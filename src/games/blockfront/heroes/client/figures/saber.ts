import type { HeroId } from '../../defs';
import { SABER } from '../../tuning';
import type { HeroScene } from '../state';

/**
 * How a hero holds and swings their saber, and gestures with the Force: poses for the figures kit
 * (`humanoid.ts`), worked out each frame from what the hero is doing (`HeroScene`).
 *
 * A saber pose is where the right fist holds the hilt and which way the blade points, in the
 * figure's frame at the middle of its shoulders (x its left, y up, z ahead; turned with half its
 * look up or down): `p` the fist, `tip` the blade's tip up (negative) or down, `turn` to its left
 * (positive) or right, as the figures kit's poses have them. `two` is how much the left hand is on
 * the hilt too (1) or free (0); `twist` turns the body (to its left) and `lean` bends it forward.
 */

export type V3 = [number, number, number];

export interface SaberKey {
  p: V3;
  tip: number;
  turn: number;
  two: number;
  twist: number;
  lean: number;
}

/** A hand's gesture: where it reaches (from the shoulders' middle, in the frame of where they look), and how much (0..1). */
export interface Gesture {
  at: V3;
  w: number;
  /** An open hand, palm out (push, lightning), or a fist (choke). */
  open: boolean;
}

export interface SaberPose {
  key: SaberKey;
  /** Hips down (a landing's crouch). */
  drop: number;
  /** The saber's not in hand (thrown, put away for lightning). */
  hide: boolean;
  left: Gesture | null;
  right: Gesture | null;
  /** A tremble in the hands (lightning, a choke). */
  shake: number;
}

const K = (p: V3, tip: number, turn: number, two: number, twist = 0, lean = 0): SaberKey => ({ p, tip, turn, two, twist, lean });

/**
 * Each hero's ready stance: Luke two-handed at his right hip, blade up; Ben's out to his right,
 * pointed at them; the Sith's low at their side. All out to the right, where the camera over the
 * shoulder sees them.
 */
const GUARD: Partial<Record<HeroId, SaberKey>> = {
  luke: K([-0.3, -0.33, 0.18], -1.28, -0.62, 1, -0.22),
  ben: K([-0.3, -0.24, 0.28], -0.58, -0.42, 0, -0.18),
  vader: K([-0.3, -0.44, 0.2], 0.55, -0.22, 0, -0.05, -0.02),
  emperor: K([-0.28, -0.46, 0.18], 0.85, -0.3, 0, -0.1, 0.14),
};
/** Where the free hand rests (from the shoulders' middle, in the chest's frame). */
const LOOSE: Partial<Record<HeroId, V3>> = {
  luke: [0.26, -0.45, 0.1],
  ben: [0.3, -0.3, 0.24],
  vader: [0.24, -0.52, 0.06],
  emperor: [0.18, -0.46, 0.14],
};
/** Running: the blade trails low behind, one hand. */
const RUN = K([-0.3, -0.44, 0.02], 0.35, -2.7, 0, -0.1);
/** The guard up: the blade across the body, up to the left. */
const BLOCK = K([-0.08, -0.12, 0.33], -0.62, 1.3, 1, -0.1, -0.03);
/** Soresu: the blade high over the head, pointed at them; the free hand out toward them. */
const SORESU = K([-0.08, 0.14, 0.16], -0.32, 0.15, 0, -0.25);
/** Parried, or the guard broken: the blade knocked back, leaning away. */
const STAGGER = K([-0.32, 0.02, 0.02], -2.3, -0.9, 0, -0.35, -0.28);
/** A rush: low and leaning in, the blade trailing. */
const RUSH = K([-0.3, -0.36, -0.06], 0.2, -2.5, 0, -0.15, 0.35);
/** A leap: raised overhead in both hands. */
const LEAP = K([-0.05, 0.3, 0.06], -2.4, 0, 1, 0, -0.1);
/** Coming down from it: slammed into the ground. */
const LAND = K([0, -0.5, 0.48], 1.25, 0.05, 1, 0, 0.45);

/**
 * The combo's three swings: from the stance up into a wind-up, through the strike (the hit, at
 * `SABER.strike`), on to where it ends, and back. A forehand from high right to low left (both
 * hands), a backhand level from left to right (one hand), an overhead chop to finish (both).
 */
const SWINGS: [SaberKey, SaberKey, SaberKey][] = [
  [K([-0.3, 0.1, 0.08], -2.1, -0.5, 1, -0.45, -0.05), K([-0.02, -0.14, 0.44], 0.05, 0.45, 1, 0.05, 0.12), K([0.24, -0.4, 0.26], 0.85, 1.25, 1, 0.45, 0.15)],
  [K([0.26, -0.1, 0.22], -0.35, 2.0, 0, 0.5), K([-0.02, -0.12, 0.48], -0.1, 0, 0, 0, 0.08), K([-0.45, -0.16, 0.18], -0.25, -2.0, 0, -0.55, 0.05)],
  [K([-0.06, 0.3, 0.02], -2.55, 0.05, 1, -0.05, -0.18), K([-0.02, -0.06, 0.46], 0.15, 0, 1, 0, 0.2), K([0, -0.42, 0.36], 1.05, 0.1, 1, 0.05, 0.32)],
];
/** When each key of a swing comes (a part of it): the wind-up, the strike, the end. */
const WIND = 0.2;
const END = 0.64;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (t: number) => t * t * (3 - 2 * t);
const easeIn = (t: number) => t * t;
const easeOut = (t: number) => 1 - (1 - t) * (1 - t);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function mix(a: SaberKey, b: SaberKey, t: number, out: SaberKey = K([0, 0, 0], 0, 0, 0)): SaberKey {
  out.p = [lerp(a.p[0], b.p[0], t), lerp(a.p[1], b.p[1], t), lerp(a.p[2], b.p[2], t)];
  out.tip = lerp(a.tip, b.tip, t);
  out.turn = lerp(a.turn, b.turn, t);
  out.two = lerp(a.two, b.two, t);
  out.twist = lerp(a.twist, b.twist, t);
  out.lean = lerp(a.lean, b.lean, t);
  return out;
}

/** A swing at `u` (0..1) of the way through, from and back to `stance`. */
function swing(n: number, u: number, stance: SaberKey): SaberKey {
  const [wind, strike, end] = SWINGS[n % 3];
  const hit = SABER.strike;
  if (u < WIND) return mix(stance, wind, easeOut(u / WIND));
  if (u < hit) return mix(wind, strike, easeIn((u - WIND) / (hit - WIND)));
  if (u < END) return mix(strike, end, easeOut((u - hit) / (END - hit)));
  return mix(end, stance, smooth((u - END) / (1 - END)));
}

/** A gesture's weight over its act: in over `rise`, held, out over the last `fall` (seconds). */
const env = (t: number, len: number, rise: number, fall: number) => clamp01(Math.min(t / rise, (len - t) / fall));

/**
 * One hero figure's saber and hands this frame, from the scene: the stance (running, guarding, a
 * stance or a stagger), a swing of the combo, a power's gesture. `smoothed` is the stance as it
 * eased toward the one wanted (kept by the caller between frames).
 */
export function saberPose(scene: HeroScene, id: string, hero: HeroId, o: { run: number; air: boolean; dt: number; smoothed: SaberKey }): SaberPose {
  const now = scene.now;
  // The stance it's easing toward: ready, running, the guard, Soresu, reeling.
  const st = scene.staggers.get(id);
  const staggered = st && now < st.until;
  const guard = scene.debug?.guard ?? scene.guards.get(id)?.on ?? false;
  const soresu = scene.on(id, 'soresu');
  let want = mix(GUARD[hero] ?? GUARD.luke!, RUN, clamp01((o.run - 0.55) * 2.5));
  if (soresu) want = SORESU;
  if (guard) want = BLOCK;
  if (staggered) want = STAGGER;
  mix(o.smoothed, want, clamp01(o.dt * (staggered ? 22 : 14)), o.smoothed);
  let key: SaberKey = mix(o.smoothed, o.smoothed, 0);
  // A bolt just turned: the blade twitches to it.
  const flick = scene.flicks.get(id);
  if (flick && now - flick.at < 0.16) {
    const k = 1 - (now - flick.at) / 0.16;
    key.p = [key.p[0] + 0.05 * k * Math.sin(flick.at * 97), key.p[1] + 0.05 * k, key.p[2] + 0.03 * k];
    key.tip -= 0.25 * k;
    key.turn += 0.2 * k * Math.cos(flick.at * 53);
  }
  // A swing of the combo.
  const sw = scene.swings.get(id);
  if (scene.debug?.swing) key = swing(scene.debug.swing[0], scene.debug.swing[1], o.smoothed);
  else if (sw && !staggered) {
    const u = (now - sw.at) / sw.d;
    if (u >= 0 && u < 1) key = swing(sw.n, u, o.smoothed);
    else if (u >= 1) scene.swings.delete(id);
  }
  const pose: SaberPose = { key, drop: 0, hide: false, left: null, right: null, shake: 0 };
  if (soresu && !guard) pose.left = { at: [0.22, -0.1, 0.45], w: 1, open: true };
  if (key.two < 0.5 && !pose.left) pose.left = { at: LOOSE[hero] ?? LOOSE.luke!, w: 0, open: false };
  // A power's gesture.
  const dbg = scene.debug?.act;
  const act = dbg ? { k: dbg[0], at: now - dbg[1], t: dbg[1] + 1 } : scene.act(id);
  if (!act) return pose;
  const t = now - act.at;
  const one = (w: number) => (pose.key = mix(pose.key, { ...pose.key, two: 0 }, w));
  switch (act.k) {
    case 'push':
    case 'chain': {
      const w = env(t, act.t, 0.09, 0.25);
      const reach = smooth(clamp01(t / 0.1));
      pose.left = { at: [0.12, lerp(-0.2, 0.02, reach), lerp(0.15, 0.62, reach)], w, open: true };
      one(w);
      pose.key.lean += 0.12 * w;
      break;
    }
    case 'pull': {
      const w = env(t, act.t, 0.08, 0.2);
      const back = smooth(clamp01((t - 0.12) / 0.3));
      pose.left = { at: [lerp(0.12, 0.22, back), lerp(0.02, -0.1, back), lerp(0.6, 0.14, back)], w, open: back < 0.5 };
      one(w);
      pose.key.lean += lerp(0.1, -0.12, back) * w;
      break;
    }
    case 'choke': {
      const w = env(t, act.t, 0.15, 0.2);
      pose.left = { at: [0.1, 0.12, 0.56], w, open: false };
      one(w);
      pose.shake = 0.008 * w;
      break;
    }
    case 'lightning': {
      const w = env(t, act.t, 0.1, 0.15);
      pose.hide = w > 0.3;
      pose.left = { at: [0.15, -0.03, 0.5], w, open: true };
      pose.right = { at: [-0.15, -0.03, 0.5], w, open: true };
      pose.key.lean += 0.1 * w;
      pose.shake = 0.018 * w;
      break;
    }
    case 'aura': {
      const w = env(t, act.t, 0.15, 0.3);
      pose.left = { at: [0.5, -0.18, 0.16], w, open: true };
      pose.key = mix(pose.key, K([-0.46, -0.22, 0.14], 0.4, -1.25, 0, 0, -0.12), w);
      break;
    }
    case 'rage': {
      const w = env(t, act.t, 0.12, 0.3);
      pose.left = { at: [0.38, -0.12, 0.18], w, open: false };
      pose.key = mix(pose.key, K([-0.36, -0.12, 0.12], -0.6, -0.9, 0, 0.05, -0.22), w);
      break;
    }
    case 'throw': {
      // The arm whips out (the saber leaves it), stays out while the saber flies, and catches it.
      const w = env(t, act.t, 0.08, 0.12);
      pose.hide = t > 0.05 && t < act.t - 0.04;
      pose.right = { at: [-0.1, -0.02, 0.56], w, open: true };
      pose.left = { at: [0.28, -0.4, 0.12], w: 0, open: false };
      pose.key.twist += 0.25 * w;
      break;
    }
    case 'rush':
      pose.key = mix(pose.key, RUSH, env(t, act.t, 0.05, 0.12));
      break;
    case 'leap':
      if (o.air) pose.key = mix(pose.key, LEAP, env(t, act.t, 0.15, 0.2));
      break;
    case 'land': {
      const w = env(t, act.t, 0.04, 0.3);
      pose.key = mix(pose.key, LAND, w);
      pose.drop = 0.3 * w;
      break;
    }
    case 'soresu':
      break;
  }
  return pose;
}

/** A fresh stance to ease from. */
export const stanceOf = (hero: HeroId): SaberKey => mix(GUARD[hero] ?? GUARD.luke!, GUARD[hero] ?? GUARD.luke!, 0);
