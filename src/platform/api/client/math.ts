/**
 * The platform's math for client code: vectors, quaternions, matrices and turns (three.js's
 * classes, under the platform's names, so kits compute exactly what the engine does: `Color` reads
 * a CSS colour as the engine's linear RGB), and helpers.
 */
export { Vector3 as Vec3, Quaternion as Quat, Matrix4 as Mat4, Euler, Box3, MathUtils, Color } from 'three';
