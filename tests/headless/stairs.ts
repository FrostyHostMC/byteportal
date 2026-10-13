import * as THREE from 'three';
import { Blueprint, defineGame } from '../../src/platform';
import { PlayerCamera } from '../../src/platform/client/camera';
import type { PlayerFrame } from '../../src/platform/sim/player';
import { check, launch } from './_harness';

const FLOOR = 64;
const EYE = 1.62;
const DT = 1 / 60;

/**
 * Going up stairs: the body steps up half a block at a time (the engine's step-up), but the eyes
 * climb smoothly after it, walking and sprinting, and settle at eye height at the top. A jump on
 * flat ground is no step: the eyes go with it.
 */
export default function stairs() {
  // A floor in the void and a flight of eight stairs going north (-z), three wide, on stone.
  const bp = new Blueprint({ x: -4, y: FLOOR - 1, z: -16 }, { x: 9, y: 12, z: 22 });
  bp.fill({ x: -4, y: FLOOR - 1, z: -16 }, { x: 4, y: FLOOR - 1, z: 5 }, 'stone');
  for (let i = 0; i < 8; i++) {
    if (i > 0) bp.fill({ x: -1, y: FLOOR, z: -1 - i }, { x: 1, y: FLOOR + i - 1, z: -1 - i }, 'stone');
    for (let x = -1; x <= 1; x++) bp.set(x, FLOOR + i, -1 - i, 'oak_stairs[facing=north]');
  }
  bp.fill({ x: -1, y: FLOOR, z: -16 }, { x: 1, y: FLOOR + 7, z: -9 }, 'stone');
  const def = defineGame({
    id: 'stairtest',
    title: 'Stairs',
    world: { terrain: 'void', structures: [bp], spawn: { x: 0.5, y: FLOOR, z: 2.5 } },
    player: { health: false },
  });

  const climb = (keys: string[]) => {
    const h = launch(def, { seed: 1 });
    h.run(0.5); // settle on the floor
    const view = new PlayerCamera(new THREE.PerspectiveCamera());
    view.viewBobbing = false;
    let feet = 0;
    let eyes = 0;
    let below = 0;
    let lastFeet = h.me.frame().y;
    let lastEye: number | null = null;
    for (let t = 0; t < 3; t += DT) {
      h.step(DT, { down: keys, yaw: 0, pitch: 0 });
      const f: PlayerFrame = h.me.frame();
      view.follow(DT, f);
      const eye = view.camera.position.y;
      feet = Math.max(feet, f.y - lastFeet);
      if (lastEye !== null) eyes = Math.max(eyes, eye - lastEye);
      below = Math.max(below, f.y + EYE - eye);
      check(eye <= f.y + EYE + 1e-6, `the eyes never go above eye height (${(eye - f.y - EYE).toFixed(3)})`);
      lastFeet = f.y;
      lastEye = eye;
    }
    // At the top, standing: settled at eye height.
    for (let t = 0; t < 0.5; t += DT) {
      h.step(DT, { down: [], yaw: 0, pitch: 0 });
      view.follow(DT, h.me.frame());
    }
    const top = h.me.frame();
    return { feet, eyes, below, height: top.y - FLOOR, settled: view.camera.position.y - (top.y + EYE) };
  };

  const walk = climb(['KeyW']);
  const sprint = climb(['KeyW', 'ControlLeft']);
  for (const [name, r] of [['walking', walk], ['sprinting', sprint]] as const) {
    check(r.height > 7.9, `${name}: up the eight stairs (${r.height.toFixed(2)} blocks up)`);
    check(r.feet > 0.4, `${name}: the body steps up (${r.feet.toFixed(2)} in a frame)`);
    // A smooth climb at this speed up a 45° slope rises speed/60 a frame: the eyes stay near that.
    check(r.eyes < 0.13, `${name}: the eyes rise at most ${r.eyes.toFixed(3)} a frame (the body: ${r.feet.toFixed(2)})`);
    check(r.below < 0.8, `${name}: the eyes trail by at most ${r.below.toFixed(2)}`);
    check(Math.abs(r.settled) < 0.01, `${name}: settled at eye height at the top (${r.settled.toFixed(3)})`);
  }

  // A jump on flat ground: the eyes go with the body.
  const h = launch(def, { seed: 1 });
  h.run(0.5);
  const view = new PlayerCamera(new THREE.PerspectiveCamera());
  view.viewBobbing = false;
  let off = 0;
  for (let t = 0; t < 1; t += DT) {
    h.step(DT, { down: t < 0.1 ? ['Space'] : [], yaw: Math.PI, pitch: 0 });
    const f = h.me.frame();
    view.follow(DT, f);
    off = Math.max(off, Math.abs(view.camera.position.y - (f.y + EYE)));
  }
  check(off < 1e-6, `a jump isn't a step: the eyes stay at eye height (${off.toFixed(4)} off)`);
  console.log(
    `  walking: body ${walk.feet.toFixed(2)} / eyes ${walk.eyes.toFixed(3)} a frame, trailing ≤ ${walk.below.toFixed(2)} · sprinting: body ${sprint.feet.toFixed(2)} / eyes ${sprint.eyes.toFixed(3)}, trailing ≤ ${sprint.below.toFixed(2)}`,
  );
}
