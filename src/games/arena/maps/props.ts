import { math, type GameContext, type Prop, type PropModel, type Vec3 } from '@platform';
import type { Model } from './models';

/** Each model meshed once a game (`props.model`), however many copies stand about. */
const meshed = new Map<Model, PropModel>();

/** A fresh game: nothing meshed yet. */
export const resetModels = () => meshed.clear();

export function propModel(game: GameContext, m: Model): PropModel {
  let pm = meshed.get(m);
  if (!pm) {
    pm = game.props.model(m.bp, { scale: m.scale, pivot: m.pivot });
    meshed.set(m, pm);
  }
  return pm;
}

/** A prop of `m` at `at`, its front (+z) turned to `face` (radians: 0 toward +z, a quarter turn toward +x). */
export function place(game: GameContext, m: Model, at: Vec3, face: number, opts: { solid?: boolean } = {}): Prop {
  const p = game.props.spawn(propModel(game, m), { position: at, solid: opts.solid });
  turn(p, face);
  return p;
}

const euler = new math.Euler();

/** Turn a prop to `face` about the vertical, then tip it `tilt` about its own x (and `roll` about its own z). */
export function turn(p: Prop, face: number, tilt = 0, roll = 0) {
  euler.set(tilt, face, roll, 'YXZ');
  p.quaternion.setFromEuler(euler);
}
