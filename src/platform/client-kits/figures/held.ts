import type { HoldSpec, ItemPoses } from '@platform';
import type { FigureHeld } from '@platform/client';
import { Vec3 } from '@platform/client/math';
import { isGun, isThrowable } from '@platform/items';

/** What a humanoid holds, as it holds it (worked out from the item: its kind, its hold, its model's points). */
export interface HeldInfo {
  /** `gun`: both hands on it, aimed where they look; `melee`: both hands, blade up, swung; `other`: in the right fist. */
  kind: 'gun' | 'melee' | 'other';
  /** Points on the model, in its own space (before `scale`): where each hand holds, the magazine. */
  grip: Vec3;
  grip2?: Vec3;
  mag?: Vec3;
  /** Its length along z (a pistol is short). */
  length: number;
  /** Its size in the hands (world units per model unit); default the figure's `heldScale` (0.5 in the fist). */
  scale?: number;
  /** A gun held as a rifle or a pistol (the item's `hold.stance`); default by its length. */
  stance?: 'rifle' | 'pistol';
  /** Hands on a gun (`hold.gun.hands`): with one, the free hand takes the stance's `offHand` pose, and comes to the gun to reload. Default 2. */
  hands?: 1 | 2;
  /** The item's own poses (`hold.poses`), over the figure's while it's held. */
  poses?: ItemPoses;
  /** A gun's action (`GunItem.action`): a `lever` or `hammer` is worked after each shot. */
  action?: string;
  /** A throwable (`kind: 'throwable'`): its attack is a throw, overarm, not a swing. */
  throws?: boolean;
}

/**
 * A gun's points: what its model marks (or its spec gives), else guessed from its size: the
 * support hand halfway along it, the magazine just ahead of the grip underneath (as first person
 * guesses them).
 */
export function gunPoints(held: FigureHeld): { grip: Vec3; grip2: Vec3; mag: Vec3 } {
  const at = (n: 'grip' | 'grip2' | 'mag') => held.points[n]?.clone();
  const box = held.bounds;
  const grip = at('grip') ?? new Vec3();
  return {
    grip,
    grip2: at('grip2') ?? new Vec3(grip.x, grip.y + 0.5 / 16, (grip.z + box.max.z) / 2),
    mag: at('mag') ?? new Vec3(grip.x, box.min.y + 1 / 16, grip.z + 3 / 16),
  };
}

/** Hands on a gun: two (the support hand on `grip2`) unless its hold says one. */
export const gunHands = (hold: HoldSpec | undefined): 1 | 2 => (hold?.gun?.hands === 1 ? 1 : 2);

/**
 * How a humanoid holds a model in its hand: a gun in both hands (or one), a blade (a model with a
 * second grip) in both, anything else in the fist; by the points its spec gives or its file marks.
 * Null for a sprite (it hangs in the fist at the end of the hand: `inFist`).
 */
export function heldInfo(held: FigureHeld): HeldInfo | null {
  if (held.form !== 'model') return null;
  const def = held.def;
  const gun = isGun(def) ? gunPoints(held) : null;
  const grip2 = gun ? gun.grip2 : held.points.grip2?.clone();
  return {
    kind: gun ? 'gun' : grip2 ? 'melee' : 'other',
    grip: gun?.grip ?? held.points.grip?.clone() ?? new Vec3(),
    grip2,
    mag: gun?.mag ?? held.points.mag?.clone(),
    length: held.length,
    stance: def?.hold?.stance,
    hands: gun ? gunHands(def?.hold) : undefined,
    poses: def?.hold?.poses,
    action: isGun(def) && typeof def.action === 'string' ? def.action : undefined,
    throws: isThrowable(def),
  };
}

/**
 * Something in the fist at the end of a hanging arm (a figure that isn't on the rig, or a sprite
 * in a humanoid's hand; the figure faces +z). A held model runs along +z already: tilted up a
 * little, its grip in the fist. A sprite stands on edge, turned so its handle-to-tip diagonal
 * points forward and up, the handle (lower left) in the fist. A gun runs along the arm (raised to
 * aim, it points where the figure looks).
 */
export function inFist(held: FigureHeld) {
  const mesh = held.node;
  const model = held.form === 'model';
  const long = isGun(held.def);
  const scale = long ? 0.7 : model ? 0.5 : 0.62;
  mesh.scale.setScalar(scale);
  if (long) mesh.rotation.set(Math.PI / 2, 0, 0);
  else if (model) mesh.rotation.set(-0.3, 0, 0);
  else mesh.rotation.set(0, -Math.PI / 2, 0);
  const grip = model ? (held.points.grip?.clone() ?? new Vec3()) : new Vec3(-0.28, -0.28, 0);
  grip.multiplyScalar(scale).applyEuler(mesh.rotation);
  mesh.position.set(0, -0.66, 0).sub(grip);
}
