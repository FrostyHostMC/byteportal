/**
 * 3D math for games (vectors, quaternions, matrices), re-exported from three.js so games don't
 * need their own: `import { math } from '@platform'; const q = new math.Quaternion();`.
 */
export { Vector2, Vector3, Quaternion, Euler, Matrix4, Box3, MathUtils } from 'three';
/** Where a ray (from `o`, unit direction `d`) first enters an axis-aligned box (its min / max corners): how far along, or null if it misses. */
export { rayBox } from '../sim/hitboxes';
