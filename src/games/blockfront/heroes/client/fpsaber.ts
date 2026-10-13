import type { ViewAnimation } from '@platform';
import { Euler, Quat, Vec3 } from '@platform/client/math';
import { SABER, swingLength } from '../tuning';

/**
 * The saber in first person: the combo's three swings and the guard as our own arm has them, the
 * same cuts the figures make over the shoulder (`figures/saber.ts`): a forehand from high right
 * to low left, a backhand level from left to right, an overhead chop to finish; the guard up
 * across the body, to the left. Each swing is timed as the server's (`tuning.ts`): up into the
 * wind-up, through the middle of the screen at the strike, on to where it ends, and back.
 *
 * A key says where the fist is and which way the blade points, in the view's space (x right, y
 * up, z back, the eye at 0), as the figures' keys do; between keys the fist moves straight and the
 * blade sweeps round. They're turned into the first-person kit's turn of the hand about the fist
 * from where the sword style holds it at rest (`MODEL_GRIPS.sword`): the forearm takes a share of
 * the turn (`ARM`) and the wrist the rest, so it stays low and out of the way, as a real wrist
 * bends rather than the whole arm swinging up into view.
 */

type V3 = [number, number, number];
interface Key {
  fist: V3;
  blade: V3;
}

/** Where the sword style holds a model at rest: the fist, and the blade's way (the kit's `MODEL_GRIPS.sword`). */
const REST: Key = { fist: [0.36, -0.44, -0.78], blade: [-0.28, 0.8, -0.53] };
/** The share of the blade's turn the forearm takes (the wrist the rest). */
const ARM = 0.35;
/** The parts of a swing its keys come at: the wind-up, the strike (the hit), the end (as the figures'). */
const WIND = 0.2;
const END = 0.64;

const K = (fist: V3, blade: V3): Key => ({ fist, blade });
const easeIn = (t: number) => t * t;
const easeOut = (t: number) => 1 - (1 - t) * (1 - t);
const smooth = (t: number) => t * t * (3 - 2 * t);

const restBlade = new Vec3(...REST.blade).normalize();
const _d = new Vec3();
const _q = new Quat();
const _h = new Quat();
const _e = new Euler(0, 0, 0, 'ZYX');
const euler = (q: Quat): V3 => (_e.setFromQuaternion(q, 'ZYX'), [_e.x, _e.y, _e.z]);

/** The kit's channels for a key between `a` and `b` (`t` of the way): the fist's move, the hand's and the wrist's turns. */
function channels(a: Key, b: Key, t: number) {
  const lerp = (i: number, v: 'fist' | 'blade') => a[v][i] + (b[v][i] - a[v][i]) * t;
  _d.set(lerp(0, 'blade'), lerp(1, 'blade'), lerp(2, 'blade')).normalize();
  // The whole turn, the forearm's share of it, and the wrist's (what's left, after the forearm's).
  _q.setFromUnitVectors(restBlade, _d);
  _h.identity().slerp(_q, ARM);
  const hand = euler(_h);
  const wrist = euler(_h.invert().multiply(_q));
  return {
    move: [lerp(0, 'fist') - REST.fist[0], lerp(1, 'fist') - REST.fist[1], lerp(2, 'fist') - REST.fist[2]] as V3,
    hand,
    wrist,
  };
}

/** A swing: from rest up into `wind`, through `strike` at the hit, on to `end`, and back to rest. */
const swing = (n: number, wind: Key, strike: Key, end: Key): ViewAnimation => ({
  duration: swingLength(n, 1),
  sample: (u) => {
    const hit = SABER.strike;
    if (u < WIND) return channels(REST, wind, easeOut(u / WIND));
    if (u < hit) return channels(wind, strike, easeIn((u - WIND) / (hit - WIND)));
    if (u < END) return channels(strike, end, easeOut((u - hit) / (END - hit)));
    return channels(end, REST, smooth((u - END) / (1 - END)));
  },
});

export const FP_SWINGS: ViewAnimation[] = [
  // Forehand: cocked back over the right shoulder, down across the middle, out low to the left.
  swing(0, K([0.42, -0.24, -0.74], [0.45, 0.8, 0.15]), K([0.1, -0.32, -0.84], [-0.75, 0.35, -0.55]), K([-0.1, -0.4, -0.8], [-0.82, -0.22, -0.53])),
  // Backhand: drawn across to the left, blade out that way; swept level through the middle; out to the right.
  swing(1, K([-0.06, -0.36, -0.76], [-0.88, 0.18, -0.45]), K([0.14, -0.34, -0.88], [0.4, 0.4, -0.82]), K([0.46, -0.38, -0.74], [0.9, 0.12, -0.42])),
  // Overhead: raised high, tip back over the head; brought down through the middle; low in front.
  swing(2, K([0.16, -0.08, -0.62], [0.1, 0.75, 0.65]), K([0.1, -0.28, -0.86], [-0.05, 0.62, -0.78]), K([0.06, -0.38, -0.84], [-0.4, -0.18, -0.9])),
];

/** The guard up: the blade across in front of us, tip up to the left (held with the kit's `pose`). */
const GUARD = channels(K([0.22, -0.3, -0.76], [-0.8, 0.5, -0.3]), K([0.22, -0.3, -0.76], [-0.8, 0.5, -0.3]), 0);
export const FP_GUARD: ViewAnimation = { duration: 1, keys: [{ t: 0, ...GUARD }] };

export const fpSwing = (n: number) => `bfh_fp_swing${n}`;
export const FP_GUARD_NAME = 'bfh_fp_guard';
