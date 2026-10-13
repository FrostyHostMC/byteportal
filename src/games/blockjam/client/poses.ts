import type { ClientKit, FigureRig } from '@platform/client';
import { Euler, Quat } from '@platform/client/math';
import { SHOT_APEX } from '../moves';
import type { JamView } from './state';

/**
 * The ballers' poses, over the figures kit's running and jumping (this kit runs after it): a big
 * head on everyone; the dribble (the right hand pumping in time with the ball, the left arm out to
 * keep the man off); a jump shot (the ball up over the head, then the flick); a leap's arms up
 * high; seven dunks (a tomahawk, a two-hander, a 360, a windmill, a front flip, a reverse, a
 * superman) and an alley-oop's catch; hanging on the rim; knocked flat and getting up.
 */

/** How big the heads are (arcade). */
export const HEAD = 1.75;

const smooth = (t: number) => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};
const e1 = new Euler(0, 0, 0, 'YXZ');
const q1 = new Quat();
const rot = (x: number, y = 0, z = 0) => q1.setFromEuler(e1.set(x, y, z, 'YXZ'));

type Joints = FigureRig['joints'];
type Rest = FigureRig['rest'];

/** An arm set from rest: the shoulder turned (x forward-and-up when negative, z out), the elbow bent. */
function arm(j: Joints, rest: Rest, side: 'L' | 'R', x: number, z: number, bend: number, y = 0) {
  const s = side === 'L' ? -1 : 1;
  j[`upperArm${side}`].quaternion.copy(rest[`upperArm${side}`].quaternion).multiply(rot(x, y * s, z * s));
  j[`lowerArm${side}`].quaternion.copy(rest[`lowerArm${side}`].quaternion).multiply(rot(-bend, 0, 0));
}

/** Legs tucked up (a flip), or dangling (hanging on the rim). */
function legs(j: Joints, rest: Rest, hip: number, knee: number) {
  for (const side of ['L', 'R'] as const) {
    j[`upperLeg${side}`].quaternion.copy(rest[`upperLeg${side}`].quaternion).multiply(rot(-hip, 0, side === 'L' ? 0.08 : -0.08));
    j[`lowerLeg${side}`].quaternion.copy(rest[`lowerLeg${side}`].quaternion).multiply(rot(knee, 0, 0));
  }
}

export function posesKit(view: JamView): ClientKit {
  /** Each figure's dribble, and how long it's been down (for getting up). */
  const phase = new Map<string, number>();
  /** Who shoved or swiped lately (this screen's clock): a push with both hands, a swipe with one. */
  const shoved = new Map<string, number>();
  const swiped = new Map<string, number>();
  return {
    name: 'jam.poses',
    frame(client, dt) {
      for (const m of view.moments) {
        if (m.k === 'shove') shoved.set(m.by, client.time);
        else if (m.k === 'steal') swiped.set(m.by, client.time);
      }
      for (const fig of client.figures.all) {
        const rig = fig.rig;
        const id = fig.player;
        if (!rig || !id) continue;
        const j = rig.joints;
        const rest = rig.rest;
        j.head.scale.setScalar(HEAD);
        const b = view.ballers.get(id);
        if (!b) continue;
        const holding = view.holder === id;
        // Knocked down: flat on their back, arms out; up again as it wears off.
        if (b.stun > 0) {
          const t = b.stun > 0.35 ? 1 : b.stun / 0.35;
          const r = rest.hips.position;
          j.hips.position.set(r.x, r.y - (r.y - 0.2) * t, r.z - 0.4 * t);
          j.hips.quaternion.copy(rest.hips.quaternion).multiply(rot(1.45 * t));
          arm(j, rest, 'R', -1.4 * t, 1.1 * t, 0.4 * t);
          arm(j, rest, 'L', -1.4 * t, 1.1 * t, 0.4 * t);
          legs(j, rest, 0.2 * t, 0.5 * t);
          continue;
        }
        switch (b.air) {
          case 1: {
            // A jump shot: up over the head, then the flick as it goes.
            const gone = !holding || b.t > SHOT_APEX + 0.08;
            if (!gone) {
              const up = smooth(b.t / 0.18);
              arm(j, rest, 'R', -0.6 - 2.1 * up, 0.1, 0.4 + 1.2 * up);
              arm(j, rest, 'L', -0.6 - 1.9 * up, 0.25, 0.4 + 1.1 * up);
            } else {
              arm(j, rest, 'R', -2.85, -0.05, 0.05);
              arm(j, rest, 'L', -2.2, 0.35, 0.5);
            }
            continue;
          }
          case 2:
            // A leap: both hands up as high as they go.
            arm(j, rest, 'R', -2.95, 0.22, 0.05);
            arm(j, rest, 'L', -2.95, 0.22, 0.05);
            continue;
          case 3:
            dunkPose(j, rest, b.style, b.t / Math.max(0.3, b.dur));
            continue;
          case 4:
            // Hanging on the rim: arms up to it, legs dangling, a little swing.
            arm(j, rest, 'R', -2.75, 0.12, 0.35);
            arm(j, rest, 'L', -2.75, 0.12, 0.35);
            legs(j, rest, 0.35 + Math.sin(b.t * 18) * 0.15, 0.6);
            continue;
          case 5:
            arm(j, rest, 'R', -1.1, 0.3, 0.6);
            arm(j, rest, 'L', -1.1, 0.3, 0.6);
            continue;
        }
        // A shove: both hands thrust out ahead; a swipe: one hand slapping across.
        const sh = client.time - (shoved.get(id) ?? -9);
        if (sh < 0.35) {
          const k = Math.sin((sh / 0.35) * Math.PI);
          arm(j, rest, 'R', -1.5 * k, 0.15, 0.2);
          arm(j, rest, 'L', -1.5 * k, 0.15, 0.2);
          j.chest.quaternion.multiply(rot(0.35 * k));
          continue;
        }
        const sw = client.time - (swiped.get(id) ?? -9);
        if (sw < 0.3) {
          const k = sw / 0.3;
          arm(j, rest, 'R', -1.3, 0.2 - 1.2 * k, 0.2, -0.8 + 1.6 * k);
          continue;
        }
        if (holding) {
          // The dribble: the ball goes down and comes back up to the hand, faster at a run.
          const speed = fig.state.speed ?? 0;
          const p = (phase.get(id) ?? 0) + dt * (8.5 + speed * 0.6);
          phase.set(id, p);
          view.dribble.set(id, p);
          const h = Math.abs(Math.cos(p / 2));
          arm(j, rest, 'R', -0.55 - 0.25 * h, 0.18, 0.35 + 0.7 * h);
          // The other arm out, keeping the man off.
          arm(j, rest, 'L', -0.85, 0.45, 0.9);
        }
      }
    },
  };
}

/** A dunk's flight, by its style, `u` 0..1 of the way to the rim. */
function dunkPose(j: Joints, rest: Rest, style: number, u: number) {
  const slam = smooth((u - 0.78) / 0.22);
  const hips = j.hips;
  switch (style) {
    case 0: {
      // The tomahawk: the ball cocked back behind the head in one hand, then hammered down.
      arm(j, rest, 'R', -3.0 + slam * 0.9, 0.05, 1.5 - slam * 1.3);
      arm(j, rest, 'L', -1.4, 0.4, 0.4);
      legs(j, rest, 0.5, 0.9);
      break;
    }
    case 1: {
      // The two-handed power slam: both back over the head, then down together.
      arm(j, rest, 'R', -3.05 + slam * 0.8, 0.12, 1.4 - slam * 1.2);
      arm(j, rest, 'L', -3.05 + slam * 0.8, 0.12, 1.4 - slam * 1.2);
      legs(j, rest, 0.7, 1.4);
      break;
    }
    case 2: {
      // The 360: once all the way round, the ball tucked in, then up and in.
      hips.quaternion.multiply(rot(0, smooth(u / 0.85) * Math.PI * 2));
      arm(j, rest, 'R', -1.2 - slam * 1.7, 0.2, 1.4 - slam);
      arm(j, rest, 'L', -1.2 - slam * 1.6, 0.2, 1.4 - slam);
      legs(j, rest, 0.6, 1.1);
      break;
    }
    case 3: {
      // The windmill: the ball swung round in a full circle, down past the hip and over.
      const a = smooth(u / 0.9) * Math.PI * 2;
      arm(j, rest, 'R', -0.3 - a + slam * 0.6, 0.15, 0.15);
      arm(j, rest, 'L', -1.6, 0.5, 0.5);
      legs(j, rest, 0.5, 1.0);
      break;
    }
    case 4: {
      // A front flip on the way up, tucked, then a slam.
      const f = smooth(u / 0.8);
      hips.quaternion.multiply(rot(-f * Math.PI * 2));
      arm(j, rest, 'R', -1.6 - slam * 1.3, 0.3, 1.6 - slam);
      arm(j, rest, 'L', -1.6 - slam * 1.3, 0.3, 1.6 - slam);
      legs(j, rest, 1.6 * (1 - slam), 2.0 * (1 - slam) + 0.3);
      break;
    }
    case 5: {
      // The reverse: a half turn, back to the rim, both hands over the head.
      hips.quaternion.multiply(rot(0, smooth(u / 0.6) * Math.PI));
      arm(j, rest, 'R', -2.9, 0.1, 1.2 - slam);
      arm(j, rest, 'L', -2.9, 0.1, 1.2 - slam);
      legs(j, rest, 0.4, 0.8);
      break;
    }
    case 6: {
      // The superman: laid out flat, the ball out in front, flying at the rim.
      const lay = smooth(u / 0.4) * (1 - slam * 0.7);
      hips.quaternion.multiply(rot(-1.2 * lay));
      arm(j, rest, 'R', -2.9, -0.1, 0.1);
      arm(j, rest, 'L', -2.4, 0.4, 0.3);
      legs(j, rest, -0.3 * lay, 0.2);
      break;
    }
    default: {
      // An alley-oop's catch: both hands up for the lob, then down through.
      arm(j, rest, 'R', -2.95 + slam * 0.7, 0.15, 0.2 + slam);
      arm(j, rest, 'L', -2.95 + slam * 0.7, 0.15, 0.2 + slam);
      legs(j, rest, 0.6, 1.1);
    }
  }
}
