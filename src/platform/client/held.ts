import * as THREE from 'three';
import type { HeldModelSpec, HoldSpec } from '../api/types';
import type { ItemPoint } from './gltf';

/**
 * How a held item is held, worked out the same way in first person (the view model) and on a
 * figure (someone else's screen): where its points are, and how many hands are on a gun.
 */

/** A gun's marked points, in its own space (blocks): where the hands go, the muzzle, the sight, the magazine. */
export interface GunPoints {
  grip: THREE.Vector3;
  grip2: THREE.Vector3;
  muzzle: THREE.Vector3;
  sight: THREE.Vector3;
  mag: THREE.Vector3;
}

const px = (p?: [number, number, number]) => p && new THREE.Vector3(p[0] / 16, p[1] / 16, p[2] / 16);

/** One of a held model's points: its spec's (`HeldModels.gltf(url, { grip2 })`, pixels) over the one its file marks. */
export function heldPoint(model: HeldModelSpec | undefined, points: Partial<Record<ItemPoint, THREE.Vector3>> | undefined, name: ItemPoint): THREE.Vector3 | undefined {
  return px(model?.[name]) ?? points?.[name]?.clone();
}

/**
 * A gun's points: its spec's, else what its file marks, else guessed from its size (`box`, its
 * geometry's bounds): the support hand halfway along it, the muzzle at its tip, the sight over
 * the grip, the magazine just ahead of the grip underneath.
 */
export function gunPoints(model: HeldModelSpec | undefined, points: Partial<Record<ItemPoint, THREE.Vector3>> | undefined, box: THREE.Box3): GunPoints {
  const at = (n: ItemPoint) => heldPoint(model, points, n);
  const grip = at('grip') ?? new THREE.Vector3();
  return {
    grip,
    grip2: at('grip2') ?? new THREE.Vector3(grip.x, grip.y + 0.5 / 16, (grip.z + box.max.z) / 2),
    muzzle: at('muzzle') ?? new THREE.Vector3(grip.x, box.max.y - 1 / 16, box.max.z),
    sight: at('sight') ?? new THREE.Vector3(grip.x, box.max.y + 0.5 / 16, grip.z),
    mag: at('mag') ?? new THREE.Vector3(grip.x, box.min.y + 1 / 16, grip.z + 3 / 16),
  };
}

/** Hands on a gun: two (the support hand on `grip2`) unless its hold says one. */
export const gunHands = (hold: HoldSpec | undefined): 1 | 2 => (hold?.gun?.hands === 1 ? 1 : 2);

/**
 * Two specs the same, value for value (arrays and plain objects compared inside, anything else,
 * functions and models' textures, by identity).
 */
export function sameSpec(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;
  const proto = Object.getPrototypeOf(a);
  if (proto !== Object.prototype && proto !== Array.prototype) return false;
  const ka = Object.keys(a).filter((k) => (a as Record<string, unknown>)[k] !== undefined);
  const kb = Object.keys(b).filter((k) => (b as Record<string, unknown>)[k] !== undefined);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => sameSpec((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}
