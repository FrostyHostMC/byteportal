import * as THREE from 'three';
import type { ItemPoint } from '../../src/platform/client/gltf';
import { gunHands, gunPoints, heldPoint, sameSpec } from '../../src/platform/client/held';
import { check } from './_harness';

const near = (a: number, b: number, e = 1e-6) => Math.abs(a - b) < e;
const v3 = (a: number[]) => a.map((v) => v.toFixed(3)).join(', ');

/** A gun a metre long along +z, its grip at the origin, and the points its file marks. */
function gunGeometry(): { geometry: THREE.BufferGeometry; points: Partial<Record<ItemPoint, THREE.Vector3>> } {
  const geometry = new THREE.BoxGeometry(0.2, 0.3, 1).translate(0, 0.1, 0.4);
  return { geometry, points: { grip: new THREE.Vector3(), grip2: new THREE.Vector3(0, 0.1, 0.55), muzzle: new THREE.Vector3(0, 0.15, 0.9), sight: new THREE.Vector3(0, 0.3, 0), mag: new THREE.Vector3(0, -0.1, 0.25) } };
}

/**
 * A held gun's points and hands, as the engine resolves them for the kits: a spec's points over
 * its file's, else guessed from its size; one hand or two from its hold; holds compared by value.
 * (How it's held: tests/headless/firstperson.ts in first person, tests/headless/figures.ts on figures.)
 */
export default async function gunhold() {
  // A gun's points: its spec's (pixels) over its file's, else guessed from its size; hands.
  const { geometry, points } = gunGeometry();
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  const spec = { parts: [], grip2: [0, -16, 8] as [number, number, number] };
  const pts = gunPoints(spec, points, box);
  check(near(pts.grip2.y, -1) && near(pts.grip2.z, 0.5) && pts.muzzle.equals(points.muzzle!), `a spec's grip2 goes over the file's (${v3(pts.grip2.toArray())}), the file's muzzle kept`);
  const guessed = gunPoints(undefined, { grip: new THREE.Vector3() }, box);
  check(near(guessed.grip2.z, (0 + box.max.z) / 2) && near(guessed.muzzle.z, box.max.z) && near(guessed.mag.y, box.min.y + 1 / 16), `no grip2 anywhere: halfway along (${v3(guessed.grip2.toArray())})`);
  check(heldPoint(spec, points, 'grip2')!.y === -1 && heldPoint(undefined, points, 'mag')!.equals(points.mag!) && heldPoint(undefined, {}, 'grip2') === undefined, 'one point at a time: the spec\'s, the file\'s, or none');
  check(gunHands(undefined) === 2 && gunHands({}) === 2 && gunHands({ gun: { hands: 2 } }) === 2 && gunHands({ gun: { hands: 1 } }) === 1, 'a gun is two-handed unless its hold says one');
  check(sameSpec({ a: [1, 2], b: { c: 1 } }, { b: { c: 1 }, a: [1, 2], d: undefined }) && !sameSpec({ a: [1, 2] }, { a: [1, 3] }) && !sameSpec({ gun: { hands: 1 } }, {}), 'holds compared value for value');

  console.log('  points from a spec over a file\'s, guessed without; hands from the hold; holds compared by value');
}
