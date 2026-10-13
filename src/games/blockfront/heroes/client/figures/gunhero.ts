import type { HeroId } from '../../defs';
import type { HeroScene } from '../state';
import type { Gesture } from './saber';

/**
 * A hero with a blaster (Chewblocca, Boba Fetch) holds it as a trooper does (the figures kit's gun
 * poses); their powers add to that: a lean, the gun carried low as at a run, the free (left) hand
 * reaching out for a gesture, the head thrown back.
 */
export interface GunHeroPose {
  lean: number;
  /** Carried low across the chest (0..1), as sprinting. */
  carry: number;
  /** The left hand off the gun to a gesture (its `w` how far). */
  left: Gesture | null;
  /** The head thrown back (radians). */
  headBack: number;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
/** A gesture's weight over its act: in over `rise`, held, out over the last `fall` (seconds). */
const env = (t: number, len: number, rise: number, fall: number) => clamp01(Math.min(t / rise, (len - t) / fall));

export function gunHeroPose(scene: HeroScene, id: string, _hero: HeroId): GunHeroPose | null {
  const pose: GunHeroPose = { lean: 0, carry: 0, left: null, headBack: 0 };
  // Fire from the wrist, held: the arm out, the gun in the other hand.
  if (scene.on(id, 'flame')) {
    pose.left = { at: [0.1, -0.06, 0.6], w: 1, open: true };
    pose.lean = 0.06;
  }
  // Flying on the jetpack: leaning into it a little.
  if (scene.on(id, 'jetpack')) pose.lean += 0.12;
  const dbg = scene.debug?.act;
  const act = dbg ? { k: dbg[0], at: scene.now - dbg[1], t: dbg[1] + 1 } : scene.act(id);
  if (!act) return pose.left || pose.lean ? pose : null;
  const t = scene.now - act.at;
  switch (act.k) {
    case 'charge': {
      // Head down, the bowcaster carried low: a bull rush.
      const w = env(t, act.t, 0.08, 0.25);
      pose.lean += 0.42 * w;
      pose.carry = w;
      break;
    }
    case 'roar': {
      // Chest out, head back, an arm flung up and out.
      const w = env(t, act.t, 0.1, 0.35);
      pose.lean -= 0.28 * w;
      pose.headBack = 0.7 * w;
      pose.left = { at: [0.45, 0.28, 0.2], w, open: true };
      break;
    }
    case 'scatter': {
      // The kick of five quarrels at once.
      const w = env(t, act.t, 0.03, 0.3);
      pose.lean -= 0.14 * w;
      break;
    }
    case 'rocket': {
      // The wrist punched out at them.
      const w = env(t, act.t, 0.05, 0.22);
      pose.left = { at: [0.1, 0.02, 0.62], w, open: false };
      break;
    }
    case 'flame':
      break;
  }
  return pose;
}
