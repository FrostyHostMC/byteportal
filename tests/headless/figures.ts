import { readdirSync, readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Models, type HumanoidJoint, type ItemDefinition, type ItemPoses } from '../../src/platform';
import type { Figure, FigureBone, FigureHeld, FigureRig, FigureState } from '../../src/platform/api/client';
import { DEFAULT_POSES, humanoid, resolvePoses } from '../../src/platform/client-kits/figures';
import { HumanoidRig } from '../../src/platform/client/humanoid';
import { clientOf, figureOn, give, posed, still, type TestItem } from './_figures';
import { check } from './_harness';

const load = (file: string): Promise<GLTF> => {
  const b = readFileSync(file);
  return new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '');
};
const v3 = (a: number[]) => a.map((v) => v.toFixed(3)).join(', ');

const BONES: FigureBone[] = ['hips', 'spine', 'chest', 'neck', 'head', 'upperArmL', 'lowerArmL', 'handL', 'upperArmR', 'lowerArmR', 'handR', 'upperLegL', 'lowerLegL', 'footL', 'upperLegR', 'lowerLegR', 'footR'];
const PARENT: Record<HumanoidJoint, HumanoidJoint | null> = {
  hips: null, spine: 'hips', chest: 'spine', neck: 'chest', head: 'neck',
  upperArmL: 'chest', lowerArmL: 'upperArmL', handL: 'lowerArmL', gripL: 'handL',
  upperArmR: 'chest', lowerArmR: 'upperArmR', handR: 'lowerArmR', gripR: 'handR',
  upperLegL: 'hips', lowerLegL: 'upperLegL', footL: 'lowerLegL',
  upperLegR: 'hips', lowerLegR: 'upperLegR', footR: 'lowerLegR',
};

/**
 * A figure made of plain nodes, as the client API describes one (no engine in it): the rig's
 * joints with these rest places and turns, and where each bone is standing straight.
 */
function fakeFigure(rest: Record<HumanoidJoint, { position: THREE.Vector3; quaternion: THREE.Quaternion }>, straight: Record<FigureBone, THREE.Vector3>): Figure & { state: FigureState; held: FigureHeld | null } {
  const root = new THREE.Group();
  const body = new THREE.Group();
  const skeleton = new THREE.Group();
  root.add(body);
  body.add(skeleton);
  const joints = {} as Record<HumanoidJoint, THREE.Object3D>;
  for (const name of Object.keys(PARENT) as HumanoidJoint[]) {
    const o = (joints[name] = new THREE.Object3D());
    o.position.copy(rest[name].position);
    o.quaternion.copy(rest[name].quaternion);
  }
  for (const [name, p] of Object.entries(PARENT) as [HumanoidJoint, HumanoidJoint | null][]) (p ? joints[p] : skeleton).add(joints[name]);
  const rig: FigureRig = { body, root: skeleton, joints, rest, straight };
  const hand = new THREE.Object3D();
  joints.handR.add(hand);
  return { id: 1, player: null, type: 'fake', spec: Models.gltf('/fake.glb', { rig: 'humanoid' }), root, hand, rig, state: still(), held: null, posed: false, used: () => {}, point: () => null };
}

/** The spec's rest pose (docs/HUMANOID.md) as rest places and standing-straight heights. */
function specRig() {
  const at: Record<HumanoidJoint, [number, number, number]> = {
    hips: [0, 0.95, 0], spine: [0, 0.1, 0], chest: [0, 0.22, 0], neck: [0, 0.24, 0], head: [0, 0.07, 0],
    upperArmL: [0.19, 0.19, 0], lowerArmL: [0, -0.28, 0], handL: [0, -0.25, 0], gripL: [0, -0.085, 0.015],
    upperArmR: [-0.19, 0.19, 0], lowerArmR: [0, -0.28, 0], handR: [0, -0.25, 0], gripR: [0, -0.085, 0.015],
    upperLegL: [0.1, -0.04, 0], lowerLegL: [0, -0.43, 0], footL: [0, -0.41, 0],
    upperLegR: [-0.1, -0.04, 0], lowerLegR: [0, -0.43, 0], footR: [0, -0.41, 0],
  };
  const rest = {} as Record<HumanoidJoint, { position: THREE.Vector3; quaternion: THREE.Quaternion }>;
  for (const [n, p] of Object.entries(at) as [HumanoidJoint, [number, number, number]][]) rest[n] = { position: new THREE.Vector3(...p), quaternion: new THREE.Quaternion() };
  const straight = {} as Record<FigureBone, THREE.Vector3>;
  for (const b of BONES) straight[b] = PARENT[b] ? rest[b].position.clone().add(straight[PARENT[b] as FigureBone]) : rest[b].position.clone();
  return { rest, straight };
}

/** An item in a fake figure's hand, as the engine would hand it over: its model on a mount on the hand. */
function heldIn(fig: Figure, def: Partial<ItemDefinition>, points: FigureHeld['points'], length: number, form: 'model' | 'sprite' = 'model'): FigureHeld {
  const node = new THREE.Object3D();
  const mount = new THREE.Object3D();
  (fig.hand as THREE.Object3D).add(mount);
  mount.add(node);
  return { item: 'thing', def: { name: 'Thing', ...def } as ItemDefinition, node, mount, form, points, bounds: new THREE.Box3(new THREE.Vector3(-0.05, -0.1, 0), new THREE.Vector3(0.05, 0.1, length)), length };
}

/**
 * The figures kit (`figures.humanoid()`), which poses players' and creatures' figures: it uses
 * only the public client API (its imports; driving figures made of plain nodes, in Node, with no
 * engine behind them, it poses them just as it poses the engine's); how it holds things per item
 * (an item's poses over its figure's, a free hand, a reload's cycle, an action worked, a throw).
 */
export default async function figures() {
  // Only the public API: the kit's files import '@platform', '@platform/client', its math, the item kits' shared parts (a gun's type), and each other.
  const dir = 'src/platform/client-kits/figures';
  const allowed = new Set(['@platform', '@platform/client', '@platform/client/math', '@platform/items']);
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.ts'))) {
    const src = readFileSync(`${dir}/${f}`, 'utf8');
    const specs = [...src.matchAll(/(?:import|export)[^'"]*?from\s+'([^']+)'/g)].map((m) => m[1]);
    const bad = specs.filter((s) => !allowed.has(s) && !s.startsWith('./'));
    check(specs.length > 0 && bad.length === 0, `${f}: imports only the public client API (${bad.join(', ') || specs.join(', ')})`);
  }

  // Figures made of plain nodes (the spec's mannequin), posed by the kit.
  const spec = specRig();
  const kit = humanoid();
  const fake = fakeFigure(spec.rest, spec.straight);
  const run = (figs: Figure[], seconds: number, state: Partial<FigureState>) => {
    for (let i = 1; i <= Math.round(seconds * 60); i++) {
      for (const f of figs) Object.assign(f.state, still(), state, { time: i / 60 });
      kit.frame!(clientOf(figs as never), 1 / 60);
    }
  };
  const world = (f: Figure, j: HumanoidJoint) => {
    (f.root as THREE.Object3D).updateMatrixWorld(true);
    return f.rig!.joints[j].getWorldPosition(new THREE.Vector3());
  };
  const standing = world(fake, 'hips').y;
  run([fake], 0.5, { posture: 1 });
  check(fake.posed && world(fake, 'hips').y < standing - 0.25, `a fake figure crouches (hips ${standing.toFixed(2)} to ${world(fake, 'hips').y.toFixed(2)} m), and the kit says it posed it`);
  run([fake], 0.5, { walkAmount: 1, speed: 4 });
  const feet = world(fake, 'footL').z - world(fake, 'footR').z;
  check(Math.abs(feet) > 0.1, `walking, one foot ahead of the other (${feet.toFixed(2)} m)`);
  // A gun in both hands: the mount taken from the hand to the chest, the hands on its grips.
  const rifle = heldIn(fake, { kind: 'gun' }, { grip: new THREE.Vector3(), grip2: new THREE.Vector3(0, 0.05, 0.4), mag: new THREE.Vector3(0, -0.1, 0.2) }, 1.4);
  fake.held = rifle;
  run([fake], 0.5, {});
  const gripR = world(fake, 'gripR');
  const gripL = world(fake, 'gripL');
  const at = (p: THREE.Vector3) => rifle.node.localToWorld(p.clone());
  check(rifle.mount.parent === fake.rig!.joints.chest, 'the gun hangs from the chest');
  check(gripR.distanceTo(at(new THREE.Vector3())) < 0.02 && gripL.distanceTo(at(rifle.points.grip2!)) < 0.02, `both fists on its grips (${gripR.distanceTo(at(new THREE.Vector3())).toFixed(3)}, ${gripL.distanceTo(at(rifle.points.grip2!)).toFixed(3)} m)`);
  check(Math.abs(rifle.node.scale.x - DEFAULT_POSES.heldScale) < 1e-9, 'held at the kit\'s size');
  // A sprite in the hand: in the fist, the mount back on the hand.
  const sprite = heldIn(fake, { kind: 'misc' }, {}, 0.5, 'sprite');
  fake.held = sprite;
  run([fake], 0.1, {});
  check(sprite.mount.parent === fake.hand && Math.abs(sprite.node.scale.x - 0.62) < 1e-9 && sprite.node.position.y < -0.3, 'a sprite in the fist at the end of the hand');
  // A figure off the rig: what it holds goes in its fist; the kit leaves its animation to it.
  const box: Figure & { held: FigureHeld | null } = { id: 2, player: 'p', type: 'box', spec: Models.humanoid({ skin: [0, 0] }), root: new THREE.Group(), hand: new THREE.Object3D(), rig: null, state: still(), held: null, posed: false, used: () => {}, point: () => null };
  box.held = heldIn(box, { kind: 'gun' }, { grip: new THREE.Vector3(0, 0, 0.1) }, 1);
  run([box], 0.1, {});
  check(!box.posed && Math.abs(box.held.node.scale.x - 0.7) < 1e-9 && Math.abs(box.held.node.rotation.x - Math.PI / 2) < 1e-9, 'off the rig: a gun along the arm, the figure left to animate itself');

  // The kit on a fake figure built from the engine's rig numbers poses exactly as on the engine's own.
  const gltf = await load('src/games/gallery/models/mannequin_skinned.glb');
  const real = figureOn(gltf);
  const r = real.rig;
  const twin = fakeFigure(r.rest, r.straight);
  const states: Partial<FigureState>[] = [{}, { walkAmount: 1, speed: 6, moveX: 0.5 }, { posture: 2, walkAmount: 1, speed: 9 }, { sights: 1, headPitch: -0.3, headYaw: 0.2 }, { reloading: true }, { sprint: true, walkAmount: 1, speed: 8 }];
  const item: TestItem = { kind: 'gun', grip: new THREE.Vector3(), grip2: new THREE.Vector3(0, 0.05, 0.6), mag: new THREE.Vector3(0, -0.1, 0.2), length: 1.4 };
  give(real.fig, item);
  twin.held = heldIn(twin, { kind: 'gun' }, { grip: item.grip, grip2: item.grip2, mag: item.mag }, 1.4);
  let worst = 0;
  for (const st of states) {
    for (let i = 1; i <= 30; i++) {
      real.step({ ...still(), ...st, time: real.state.time + 1 / 60 });
      Object.assign(twin.state, still(), st, { time: real.state.time });
      kit.frame!(clientOf([twin] as never), 1 / 60);
    }
    for (const j of Object.keys(PARENT) as HumanoidJoint[]) {
      const a = [...r.joints[j].position.toArray(), ...r.joints[j].quaternion.toArray()];
      const b = [...twin.rig!.joints[j].position.toArray(), ...twin.rig!.joints[j].quaternion.toArray()];
      worst = Math.max(worst, ...a.map((x, k) => Math.abs(x - b[k])));
    }
  }
  check(worst < 1e-12, `a figure of plain nodes, posed the same as the engine's (${worst.toExponential(1)} apart): the kit needs nothing but the API`);
  check(HumanoidRig.fits(gltf.scene), 'the mannequin is a humanoid');

  // Poses per item: what the item gives over the figure's, part by part.
  const figure = resolvePoses({ reload: { cycle: 0.8 }, pistol: { twist: -0.4 } });
  const itemPoses: ItemPoses = { reload: { cycle: 0.42, turn: [-0.75, 0.35, 0.9] }, pistol: { offHand: { offset: [0.2, -0.48, 0.1] } }, lever: { time: 0.6 } };
  const over = resolvePoses(itemPoses, figure);
  check(over.reload.cycle === 0.42 && over.reload.turn.join() === '-0.75,0.35,0.9' && over.reload.offset.join() === DEFAULT_POSES.reload.offset.join() && over.reload.belt.join() === DEFAULT_POSES.reload.belt.join(), `an item's reload over its figure's, the rest kept: ${JSON.stringify(over.reload)}`);
  check(over.pistol.twist === -0.4 && over.pistol.hip.join() === DEFAULT_POSES.pistol.hip.join(), 'the figure\'s own stance kept where the item says nothing');
  check(over.pistol.offHand.offset.join() === '0.2,-0.48,0.1' && over.pistol.offHand.turn.join() === '0,0,0', `the free hand's pose merges part by part: ${JSON.stringify(over.pistol.offHand)}`);
  check(over.lever.time === 0.6 && over.lever.turn.join() === DEFAULT_POSES.lever.turn.join() && over.hammer.time === DEFAULT_POSES.hammer.time, 'an action\'s pose over the default');
  check(figure.reload.cycle === 0.8 && JSON.stringify(resolvePoses(undefined, figure)) === JSON.stringify(figure), 'the figure\'s own untouched, and no item poses are the figure\'s');

  // A figure: one hand free in its stance's pose, the reload's cycle the item's, the action worked.
  const model = await load('src/games/gallery/models/mannequin.glb');
  const holding = (info: Partial<TestItem>, seconds: number, state: Partial<FigureState>) => {
    const gun = new THREE.Group();
    gun.add(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.2, 0.8)));
    const p = posed(model, {}, seconds, state, { item: { kind: 'gun', grip: new THREE.Vector3(), grip2: new THREE.Vector3(0, 0.05, 0.5), mag: new THREE.Vector3(0, -0.1, 0.2), length: 0.8, stance: 'pistol', ...info, node: gun } });
    const held = (q: THREE.Vector3) => gun.localToWorld(q.clone());
    return { ...p, held, gunQ: gun.getWorldQuaternion(new THREE.Quaternion()) };
  };
  const two = holding({}, 0.5, {});
  check(two.at('handL').distanceTo(two.held(new THREE.Vector3(0, 0.05, 0.5))) < 0.2, 'two hands: the left on the gun\'s grip2');
  const one = holding({ hands: 1 }, 0.5, {});
  const hl = one.at('handL');
  check(hl.distanceTo(one.held(new THREE.Vector3(0, 0.05, 0.5))) > 0.3 && hl.y > 0.85 && hl.y < 1.2 && hl.x > 0.12, `one hand: the left hangs at its side (${v3(hl.toArray())})`);
  const up = holding({ hands: 1, poses: { pistol: { offHand: { offset: [0.15, -0.25, 0.25] } } } }, 0.5, {});
  check(up.at('handL').y > hl.y + 0.15, 'the item\'s own free-hand pose');
  const reloading = holding({ hands: 1 }, 1, { reloading: true });
  check(reloading.at('handL').distanceTo(hl) > 0.15, 'one hand, reloading: the free hand comes to the gun');
  const cycle = (poses?: ItemPoses) => holding({ poses }, 0.8, { reloading: true }).at('handL');
  check(cycle({ reload: { cycle: 0.5 } }).distanceTo(cycle()) > 0.05 && cycle({ reload: { cycle: 1.1 } }).distanceTo(cycle()) < 1e-6, 'the reload\'s cycle is the item\'s (the figure\'s when it doesn\'t say)');
  const worked = (a?: string, shotT = 0.3) => holding({ action: a }, 0.2, { shotT }).gunQ;
  check(worked('lever').angleTo(worked('lever', 9)) > 0.1 && worked('hammer').angleTo(worked('hammer', 9)) > 0.1, 'a lever and a hammer worked a beat after the shot');
  check(worked(undefined).angleTo(worked(undefined, 9)) < 1e-6 && worked('pump').angleTo(worked('pump', 9)) < 1e-6, 'no action, or a pump: the figure\'s gun as it was');

  // A throwable is thrown overarm: cocked back over the shoulder, then whipped forward.
  const thrown = (throws: boolean, attackT: number) => posed(model, {}, 0.2, { attackT }, { item: { kind: throws ? 'throwable' : 'misc', grip: new THREE.Vector3(), length: 0.3 } });
  const cocked = thrown(true, 0.12);
  const whipped = thrown(true, 0.3);
  const swung = thrown(false, 0.12);
  check(cocked.at('handR').y > cocked.at('head').y && cocked.at('handR').z < cocked.at('head').z + 0.05, `cocked: the hand up behind the head (${v3(cocked.at('handR').toArray())})`);
  check(whipped.at('handR').z > cocked.at('handR').z + 0.3, 'whipped: the hand out ahead');
  check(swung.at('handR').y < swung.at('head').y && thrown(true, 9).at('handR').distanceTo(thrown(false, 9).at('handR')) < 1e-6, 'anything else swings as before, and at rest a throwable hangs the same');

  // Dying: the fall, the gun dropped from the hands (a thing in the fist kept).
  const dead = holding({}, 1, { dying: 1 });
  check(dead.at('hips').y < 0.5 && !dead.fig.held!.mount.visible, `dying: down (hips at ${dead.at('hips').y.toFixed(2)} m), the gun dropped`);

  console.log('  only the public API (its imports; plain-node figures posed as the engine\'s, a gun on the chest, a sprite and a box figure\'s gun in the fist) · item poses over the figure\'s · a free hand, its reload cycle, a lever and a hammer · a throw · a fall');
}
