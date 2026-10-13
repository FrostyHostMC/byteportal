import type { ClientKit, FigureRig } from '@platform/client';
import { Euler, Quat } from '@platform/client/math';
import type { IceView } from './state';

/**
 * The skaters' poses, over the figures kit (this kit runs after it): a big head on everyone (the
 * helmet's on it, so it's big too); skating (a crouch, leaning into it, the legs pushing out to the
 * sides in turn, gliding when they coast); both hands on the stick; a slap shot's wind-up and its
 * follow-through; a check's shoulder, a poke's reach; flattened and getting up; arms up after a
 * goal. The goalies: a wide crouch, the glove out, the blocker down; the butterfly, a glove save, a
 * blocker save, a sprawl.
 */

/** How big the heads are (arcade). */
export const HEAD = 1.6;

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

/** A leg set from rest: the hip turned forward (`hip`), out to the side (`out`), the knee bent, the toes turned out (`toe`). */
function leg(j: Joints, rest: Rest, side: 'L' | 'R', hip: number, out: number, knee: number, toe = 0) {
  j[`upperLeg${side}`].quaternion.copy(rest[`upperLeg${side}`].quaternion).multiply(rot(-hip, side === 'L' ? toe : -toe, side === 'L' ? out : -out));
  j[`lowerLeg${side}`].quaternion.copy(rest[`lowerLeg${side}`].quaternion).multiply(rot(knee, 0, 0));
}

/** A leg's pose: the hip turned forward (`h`), out to the side (`a`), the knee bent (`k`), the toes turned out (`t`). */
interface LegPose {
  h: number;
  a: number;
  k: number;
  t: number;
}
const lerpLeg = (x: LegPose, y: LegPose, f: number): LegPose => ({ h: x.h + (y.h - x.h) * f, a: x.a + (y.a - x.a) * f, k: x.k + (y.k - x.k) * f, t: x.t + (y.t - x.t) * f });

/** Gliding on it, under the body, the knee well bent; pushed out and back, nearly straight, toes out; lifted on the way back in. */
const GLIDE: LegPose = { h: 0.85, a: 0.04, k: 1.45, t: 0.05 };
const PUSHED: LegPose = { h: -0.28, a: 0.78, k: 0.1, t: 0.7 };
const LIFTED: LegPose = { h: 1.1, a: 0.2, k: 1.95, t: 0.2 };
/** Coasting: both feet under them, knees bent. */
const COAST: LegPose = { h: 0.62, a: 0.1, k: 1.08, t: 0.08 };

/**
 * A leg through a stride, `u` 0..1 of it: gliding with the weight on it (the first half), then
 * pushing out and back, then lifted and brought back in under the body.
 */
function strideLeg(u: number): LegPose {
  if (u < 0.5) return lerpLeg({ ...GLIDE, h: GLIDE.h + 0.08 }, { ...GLIDE, h: GLIDE.h - 0.1 }, u / 0.5);
  if (u < 0.82) return lerpLeg({ ...GLIDE, h: GLIDE.h - 0.1 }, PUSHED, smooth((u - 0.5) / 0.32));
  const t = (u - 0.82) / 0.18;
  return t < 0.5 ? lerpLeg(PUSHED, LIFTED, smooth(t / 0.5)) : lerpLeg(LIFTED, { ...GLIDE, h: GLIDE.h + 0.08 }, smooth((t - 0.5) / 0.5));
}

/** How high a leg holds the hips (from the hip's pivot to the sole), its lengths the rig's. */
function legHeight(rig: FigureRig, l: LegPose): number {
  const st = rig.straight;
  const thigh = st.upperLegL.y - st.lowerLegL.y;
  const shin = st.lowerLegL.y - st.footL.y;
  return Math.cos(l.a) * (thigh * Math.cos(l.h) + shin * Math.cos(l.h - l.k)) + st.footL.y;
}

/** A leg set, its skate kept flat on the ice. */
function legFlat(j: Joints, rest: Rest, side: 'L' | 'R', l: LegPose) {
  leg(j, rest, side, l.h, l.a, l.k, l.t);
  j[`foot${side}`].quaternion.copy(rest[`foot${side}`].quaternion).multiply(rot(l.h - l.k, 0, side === 'L' ? -l.a : l.a));
}

/** The body: the hips dropped (blocks) and turned, the back leaning forward, the head up to look ahead. */
function body(j: Joints, rest: Rest, drop: number, lean: number, twist = 0, tilt = 0, shift = 0, turn = 0) {
  const r = rest.hips.position;
  j.hips.position.set(r.x + shift, r.y - drop, r.z);
  j.hips.quaternion.copy(rest.hips.quaternion).multiply(rot(0, turn, tilt));
  j.spine.quaternion.copy(rest.spine.quaternion).multiply(rot(lean * 0.6, twist * 0.5, 0));
  j.chest.quaternion.copy(rest.chest.quaternion).multiply(rot(lean * 0.4, twist * 0.5, 0));
  j.neck.quaternion.copy(rest.neck.quaternion).multiply(rot(-lean * 0.7, 0, 0));
}

export function posesKit(view: IceView): ClientKit {
  /** Each figure's stride (0..1 a cycle of both legs), its speed last frame and how it's changing, how far into a hockey stop. */
  const phase = new Map<string, number>();
  const lastSpeed = new Map<string, number>();
  const accel = new Map<string, number>();
  const stopping = new Map<string, number>();
  /** Who checked, poked or scored lately (this screen's clock). */
  const checked = new Map<string, number>();
  const poked = new Map<string, number>();
  const scored = new Map<string, number>();
  return {
    name: 'ice.poses',
    frame(client, dt) {
      for (const m of view.moments) {
        if (m.k === 'hit') checked.set(m.by, client.time);
        else if (m.k === 'poke') poked.set(m.by, client.time);
        else if (m.k === 'goal' && m.by) scored.set(m.by, client.time);
      }
      for (const fig of client.figures.all) {
        const rig = fig.rig;
        const id = fig.player;
        if (!rig || !id) continue;
        const j = rig.joints;
        const rest = rig.rest;
        j.head.scale.setScalar(HEAD);
        const s = view.skaters.get(id);
        if (!s) continue;

        // Flattened: sprawled on the ice, arms out; up again as it wears off.
        if (s.stun > 0) {
          const t = s.stun > 0.35 ? 1 : s.stun / 0.35;
          const r = rest.hips.position;
          j.hips.position.set(r.x, r.y - (r.y - 0.2) * t, r.z - 0.4 * t);
          j.hips.quaternion.copy(rest.hips.quaternion).multiply(rot(1.45 * t));
          arm(j, rest, 'R', -1.4 * t, 1.1 * t, 0.4 * t);
          arm(j, rest, 'L', -1.4 * t, 1.1 * t, 0.4 * t);
          leg(j, rest, 'L', 0.2 * t, 0.15 * t, 0.5 * t);
          leg(j, rest, 'R', 0.2 * t, 0.15 * t, 0.5 * t);
          continue;
        }

        if (s.goalie) {
          goalie(j, rest, s.save, s.saveT, client.time);
          continue;
        }

        // Skating: a deep crouch, leaning into it. One leg glides with the weight on it while the
        // other pushes out and back, then comes back in lifted, and they swap: quicker and longer
        // strides the faster they go; both feet under them coasting (slowing with no push).
        const speed = fig.state.speed ?? 0;
        const was = lastSpeed.get(id) ?? speed;
        lastSpeed.set(id, speed);
        const acc = (accel.get(id) ?? 0) + ((speed - was) / Math.max(dt, 1e-3) - (accel.get(id) ?? 0)) * Math.min(1, dt * 6);
        accel.set(id, acc);
        const coasting = acc < -2.2 && speed > 2 ? 0.25 : 1;
        const amount = Math.min(1, Math.max(0, (speed - 0.8) / 4.5)) * coasting;
        const p = ((phase.get(id) ?? Math.random()) + dt * (0.6 + speed * 0.07) * (amount > 0.02 ? 1 : 0)) % 1;
        phase.set(id, p);
        const stop = (stopping.get(id) ?? 0) + ((s.stop ? 1 : 0) - (stopping.get(id) ?? 0)) * Math.min(1, dt * 14);
        stopping.set(id, stop);
        const legL = lerpLeg(COAST, strideLeg(p), amount);
        const legR = lerpLeg(COAST, strideLeg((p + 0.5) % 1), amount);
        // The weight over the gliding leg (the left glides the first half), the hips turning with the push.
        const over = Math.sin(p * Math.PI * 2) * amount;
        const shift = over * 0.09;
        legL.a -= shift / 0.6;
        legR.a += shift / 0.6;
        // A hockey stop: turned side on, both knees deep, sitting back into it.
        const stopL = { h: 0.7, a: 0.38, k: 1.45, t: 0.1 };
        const stopR = { h: 0.55, a: 0.3, k: 1.2, t: 0.1 };
        const L = lerpLeg(legL, stopL, stop);
        const R = lerpLeg(legR, stopR, stop);
        const legRoom = rig.straight.upperLegL.y;
        const drop = legRoom - Math.max(legHeight(rig, L), legHeight(rig, R));
        body(j, rest, drop, (0.5 + 0.35 * amount) * (1 - stop) - 0.05 * stop, -over * 0.35, -over * 0.06, shift * (1 - stop), over * 0.16 + 1.1 * stop);
        legFlat(j, rest, 'L', L);
        legFlat(j, rest, 'R', R);

        // The arms: both hands on the stick, low and ahead (the top hand, the left, across the body).
        const sinceGoal = client.time - (scored.get(id) ?? -9);
        if (sinceGoal < 2.6) {
          const k = smooth(sinceGoal / 0.3);
          arm(j, rest, 'L', -0.7 - 1.9 * k, 0.2, 0.3);
          arm(j, rest, 'R', -0.8 - 2.0 * k, 0.15, 0.2);
          continue;
        }
        const ch = client.time - (checked.get(id) ?? -9);
        if (ch < 0.4) {
          // A check: the shoulder dropped into them, the arms in.
          const k = Math.sin((ch / 0.4) * Math.PI);
          body(j, rest, 0.12, 0.55 + 0.3 * k, -0.5 * k);
          arm(j, rest, 'L', -0.5, -0.1, 1.4);
          arm(j, rest, 'R', -0.5, 0.1, 1.4);
          continue;
        }
        const po = client.time - (poked.get(id) ?? -9);
        if (s.wind > 0.02) {
          // A wind-up: the stick back over the right shoulder, the shoulders turned away, the weight
          // sinking onto the back leg.
          const k = smooth(s.wind * 1.4);
          body(j, rest, 0.1 + 0.06 * k, 0.3 + 0.1 * k, -0.7 * k);
          leg(j, rest, 'L', 0.55 + 0.15 * k, 0.07 + 0.2 * k, 1.0 + 0.15 * k);
          leg(j, rest, 'R', 0.55 - 0.15 * k, 0.07 + 0.25 * k, 1.0 - 0.3 * k);
          arm(j, rest, 'L', -0.75 - 1.4 * k, -0.2 + 0.2 * k, 0.6 + 0.4 * k);
          arm(j, rest, 'R', -0.9 - 1.7 * k, 0.15 + 0.35 * k, 0.4 + 0.6 * k);
        } else if (s.shot > 0 && s.shot < 0.45) {
          // The follow-through: swept through, the stick up ahead, the shoulders round.
          const k = Math.sin((s.shot / 0.45) * Math.PI);
          body(j, rest, 0.1, 0.35, 0.6 * k);
          arm(j, rest, 'L', -0.9 - 0.7 * k, -0.3, 0.4);
          arm(j, rest, 'R', -1.0 - 0.9 * k, -0.1, 0.2);
        } else if (po < 0.3) {
          // A poke: both hands thrust ahead.
          const k = Math.sin((po / 0.3) * Math.PI);
          arm(j, rest, 'L', -0.9 - 0.5 * k, -0.25, 0.6 - 0.5 * k);
          arm(j, rest, 'R', -1.0 - 0.5 * k, 0.1, 0.3 - 0.2 * k);
        } else if (view.holder === id) {
          // Stickhandling: both hands on it, the puck worked side to side (as the puck's drawn).
          const sway = Math.sin(client.time * 7.5);
          arm(j, rest, 'L', -0.8, -0.3 + 0.14 * sway, 0.7);
          arm(j, rest, 'R', -0.95, 0.1 + 0.2 * sway, 0.4 - 0.1 * sway);
        } else {
          // The stick in the top hand, low and ahead; the other arm pumping with the stride.
          const pump = Math.sin(p * Math.PI * 2) * amount;
          arm(j, rest, 'L', -0.72, -0.2, 0.55);
          arm(j, rest, 'R', -0.7 + 0.8 * pump - 0.25 * amount, 0.2 + 0.45 * Math.max(0, -pump), 0.45 + 0.35 * amount);
        }
      }
    },
  };
}

/** A goalie: the ready crouch, or a save (by kind) for a moment after it's made. */
function goalie(j: Joints, rest: Rest, save: number, t: number, now: number) {
  const k = save ? smooth(t / 0.12) * (1 - smooth((t - 0.7) / 0.4)) : 0;
  const breathe = Math.sin(now * 2.2) * 0.01;
  if (save === 1 && k > 0) {
    // The butterfly: down on the knees, the pads flared out along the ice.
    body(j, rest, 0.18 + 0.2 * k, 0.25);
    leg(j, rest, 'L', 0.7 + 0.5 * k, 0.45 + 0.7 * k, 1.3 + 0.9 * k);
    leg(j, rest, 'R', 0.7 + 0.5 * k, 0.45 + 0.7 * k, 1.3 + 0.9 * k);
    arm(j, rest, 'L', -1.1, 0.9, 0.8);
    arm(j, rest, 'R', -0.7, 0.5, 0.4);
    return;
  }
  body(j, rest, 0.18 + breathe, 0.3, 0, save === 4 ? 0.7 * k : 0);
  leg(j, rest, 'L', 0.7, 0.45, 1.3);
  leg(j, rest, 'R', 0.7, 0.45, 1.3);
  if (save === 4) leg(j, rest, 'R', 0.3, 1.0 * k + 0.45, 0.4);
  // The glove out and up (higher for a glove save), the blocker down by the stick (out for a blocker save).
  arm(j, rest, 'L', -0.95 - 1.4 * (save === 2 ? k : 0), 0.75 + 0.3 * (save === 2 ? k : 0), 0.9 - 0.5 * (save === 2 ? k : 0));
  arm(j, rest, 'R', -0.6 - 0.9 * (save === 3 ? k : 0), 0.35 + 0.7 * (save === 3 ? k : 0), 0.5);
}
