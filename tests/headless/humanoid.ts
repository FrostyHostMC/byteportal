import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { defineGame, HumanoidJoints, Models, type HumanoidPoses } from '../../src/platform';
import { DEFAULT_POSES, humanoid as humanoidKit, resolvePoses } from '../../src/platform/client-kits/figures';
import { partsOf, ShownFigure } from '../../src/platform/client/figures';
import { GltfFigure, GltfLibrary } from '../../src/platform/client/gltf';
import { HumanoidRig } from '../../src/platform/client/humanoid';
import { GameHost } from '../../src/platform/host/game';
import type { SharedUniforms } from '../../src/platform/render/pipeline';
import { clientOf, posed, still, type Posed, type TestItem } from './_figures';
import { check } from './_harness';

const MODELS = 'src/games/gallery/models/';
const load = (file: string): Promise<GLTF> => {
  const b = readFileSync(MODELS + file);
  return new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '');
};

const JOINTS = ['hips', 'chest', 'head', 'lowerArmL', 'handL', 'lowerArmR', 'handR', 'lowerLegL', 'footL', 'lowerLegR', 'footR'] as const;
const apart = (a: Posed, b: Posed) => Math.max(...JOINTS.map((j) => a.at(j).distanceTo(b.at(j))));

/**
 * Humanoid animation under a game's control: the figures kit's poses over its defaults; a clip
 * asked for in the simulation reaching every screen's frames (players' and entities'), and
 * stopping; the kit posing a Mixamo-style skeleton (a T-pose, bones turned their own way, named its
 * own way, under a scaled armature) just as it poses the rig's own (the engine maps the rig's
 * joints onto each); clips blended over the kit's poses (a layer leaves the legs to the gait) the
 * same on both skeletons; a gun held as a rifle or a pistol by its length, the figure's
 * `pistolUnder` or the item's `stance`; skinned meshes drawn with skinned materials; first-person
 * arms cut from a skin; and clips on a figure that isn't a humanoid.
 */
export default async function humanoid() {
  // Pose options: the kit's own unless given, part by part.
  check(JSON.stringify(resolvePoses()) === JSON.stringify(DEFAULT_POSES), 'no options: the kit\'s poses');
  check(DEFAULT_POSES.heldScale === 0.52 && DEFAULT_POSES.pistolUnder === 0.45 && DEFAULT_POSES.death.backward === 0.65 && DEFAULT_POSES.rifle.hip.join() === '-0.13,-0.19,0.27', 'the defaults are the rig\'s old constants');
  const p = resolvePoses({ heldScale: 0.6, pistolUnder: undefined, rifle: { hip: [0, -0.1, 0.3] }, gait: { width: 0.14 }, sword: { swing: { chop: { turn: [2, 0, 0] } } } });
  check(p.heldScale === 0.6 && p.pistolUnder === 0.45, 'numbers given replace the defaults (undefined keeps them)');
  check(p.rifle.hip.join() === '0,-0.1,0.3' && p.rifle.ads.join() === '-0.05,-0.05,0.24' && p.rifle.twist === -0.18 && JSON.stringify(p.pistol) === JSON.stringify(DEFAULT_POSES.pistol), `a stance's given part replaced, the rest kept: ${JSON.stringify(p.rifle)}`);
  check(p.gait.width === 0.14 && p.gait.stride.join() === '1.15,2.4', 'gait: one value changed, the rest kept');
  check(p.sword.swing.chop.turn[0] === 2 && p.sword.swing.chop.offset.join() === '0,-0.1,0.2' && p.sword.swing.raise.turn[0] === -1.1 && p.sword.swing.time === 0.4 && p.sword.offset.join() === '-0.06,-0.3,0.3', 'nested sword options merge at every level');

  // Clips asked for in the simulation go to every screen in the frames: players' and entities'.
  const model = Models.gltf('/m.glb', { rig: 'humanoid' });
  const game = defineGame({
    id: 'humanoid-test',
    title: 'Humanoid',
    world: { terrain: 'flat' },
    player: { model },
    setup(g) {
      g.entities.define('dancer', { name: 'Dancer', model, hitbox: { width: 0.6, height: 1.8 }, health: 10, speed: 2 });
    },
    start(g) {
      g.entities.spawn('dancer', { x: 2, y: 70, z: 2 });
    },
  });
  const host = new GameHost(game, { engine: readFileSync('engine/pkg/voxel_engine_bg.wasm'), seed: 1, remote: true, radius: 4, budget: Infinity, player: { id: 'p1', name: 'Player' } });
  const ann = host.connect('Ann');
  const bob = host.connect('Bob');
  host.command(ann.id, { t: 'start' });
  host.step(1 / 30);
  const annSim = host.sim.players.find((x) => x.name === 'Ann')!;
  const dancer = host.sim.ctx.entities.all('dancer')[0];
  annSim.api.animate('wave', { layer: 'upper', loop: true });
  dancer.animate('cheer', { loop: true, fade: 0.5, speed: 1.5 });
  let batch = host.step(1 / 30);
  const bobSees = batch.get(bob.id)!.frame!;
  const wave = bobSees.players.find((x) => x.name === 'Ann')!.clip;
  check(wave?.name === 'wave' && wave.layer === 'upper' && wave.loop && wave.fade === 0.2 && wave.speed === 1 && wave.seq === 1 && Math.abs(wave.at - bobSees.t) < 0.05, `another screen's frame carries the player's clip: ${JSON.stringify(wave)} at ${bobSees.t}`);
  const cheer = bobSees.entities.find((e) => e.type === 'dancer')!.clip;
  check(cheer?.name === 'cheer' && cheer.loop && cheer.fade === 0.5 && cheer.speed === 1.5 && cheer.layer === 'full', `and the entity's: ${JSON.stringify(cheer)}`);
  const attacks = bobSees.entities.find((e) => e.type === 'dancer')!.attacks;
  dancer.animate('attack');
  annSim.api.animate('wave', { layer: ['upperArmR', 'head'] });
  batch = host.step(1 / 30);
  let f = batch.get(ann.id)!.frame!;
  const again = f.players.find((x) => x.name === 'Ann')!.clip;
  check(again?.seq === 2 && Array.isArray(again.layer) && again.layer.join() === 'upperArmR,head' && !again.loop, `asked again: a new request (it restarts): ${JSON.stringify(again)}`);
  const d = f.entities.find((e) => e.type === 'dancer')!;
  check(d.attacks === attacks + 1 && d.clip?.name === 'cheer', 'a swing still swings, and leaves the clip playing');
  annSim.api.animate(null);
  dancer.animate('none');
  f = host.step(1 / 30).get(bob.id)!.frame!;
  check(!f.players.find((x) => x.name === 'Ann')!.clip && !f.entities.find((e) => e.type === 'dancer')!.clip, 'stopped: gone from the frames');
  host.dispose();

  // The kit on a Mixamo-style skeleton (T-pose, turned bones, 0.01 armature, its own names, no
  // grips) moves it exactly as the rig's own skeleton (the same body, skinned), and both as the
  // rigid mannequin's joints: the kit poses the rig's joints, the engine maps them onto each.
  const [rigid, skinned, mixamo] = await Promise.all([load('mannequin.glb'), load('mannequin_skinned.glb'), load('mannequin_mixamo.glb')]);
  const joints = HumanoidJoints.mixamo();
  check(HumanoidRig.fits(mixamo.scene, joints) && !HumanoidRig.fits(mixamo.scene), 'a Mixamo skeleton fits the rig through its joint map (not without)');
  const rifle: TestItem = { kind: 'gun', grip: new THREE.Vector3(0, -0.05, 0), grip2: new THREE.Vector3(0, 0, 0.6), length: 1.4 };
  const states: [string, Parameters<typeof posed>[3], boolean][] = [
    ['standing', {}, false],
    ['walking', { walkAmount: 1, speed: 4 }, false],
    ['running, strafing', { walkAmount: 1, speed: 7, moveX: 1, moveZ: 0.3 }, false],
    ['crouched, looking up', { posture: 1, headPitch: -0.5, headYaw: 0.4 }, false],
    ['sliding', { posture: 2, walkAmount: 1, speed: 9 }, false],
    ['a rifle, walking', { walkAmount: 1, speed: 3.5 }, true],
    ['a rifle, sprinting', { walkAmount: 1, speed: 8, sprint: true }, true],
    ['a rifle, aimed down the sights', { sights: 1, headPitch: 0.3 }, true],
    ['a rifle, reloading', { reloading: true }, true],
    ['a rifle, leaning out to peek', { lean: 0.4 }, true],
  ];
  const standing = posed(skinned, {}, 0.8, {});
  const turned = posed(mixamo, { joints }, 0.8, {});
  const arm = turned.rig.joint('upperArmL');
  check(arm.name === 'mixamorigLeftArm' && Math.abs(arm.quaternion.w) < 0.99, `the Mixamo arm bone is its own, turned its own way (${arm.quaternion.toArray().map((v) => v.toFixed(2))})`);
  for (const [what, state, armed] of states) {
    const item = armed ? rifle : undefined;
    const a = posed(skinned, {}, 0.8, state, { item });
    if (what !== 'standing') check(apart(a, standing) > 0.05, `${what}: a pose of its own (${apart(a, standing).toFixed(2)} m from standing)`);
    const b = posed(mixamo, { joints }, 0.8, state, { item });
    const c = posed(rigid, {}, 0.8, state, { item });
    check(apart(a, b) < 1e-4, `${what}: the Mixamo skeleton's joints are where the rig's own are (${apart(a, b).toExponential(1)} m apart)`);
    check(apart(a, c) < 1e-4, `${what}: and the rigid mannequin's (${apart(a, c).toExponential(1)} m)`);
  }
  // Leaning out to peek (a movement ability's `lean`, blocks to its right): tipped over at the
  // waist toward its right (-x: it faces +z), the head out about as far as its hitbox goes, the hips put.
  const upright = posed(skinned, {}, 0.8, {}, { item: rifle });
  const leaning = posed(skinned, {}, 0.8, { lean: 0.4 }, { item: rifle });
  const out = upright.at('head').x - leaning.at('head').x;
  const hips = Math.abs(leaning.at('hips').x - upright.at('hips').x);
  // The head's joint is the neck, a little below the eyes that go the whole 0.4.
  check(out > 0.32 && out < 0.42 && hips < 0.02, `leaning right: the head goes ${out.toFixed(2)} to its right (its hitbox 0.4), the hips ${hips.toFixed(3)}`);
  const left = posed(skinned, {}, 0.8, { lean: -0.4 }, { item: rifle });
  check(left.at('head').x - upright.at('head').x > 0.32, 'leaning left: the head goes to its left');

  // Grips from the model, or a point in the fist: the rigid mannequin's grips are where the default puts them.
  const armed = posed(rigid, {}, 0.3, {}, { item: rifle });
  const armedMixamo = posed(mixamo, { joints }, 0.3, {}, { item: rifle });
  check(apart(armed, armedMixamo) < 1e-4, 'holding a gun, the Mixamo figure (no grips of its own) has its hands where the mannequin has them');

  // A gun's stance: by its length, the figure's `pistolUnder`, or the item's own say; its size in the hands.
  const holding = (o: { poses?: HumanoidPoses; kit?: { poses?: HumanoidPoses } }, info: Partial<TestItem>) => posed(skinned, o, 0.3, {}, { item: { ...rifle, ...info } });
  const asRifle = holding({}, {});
  const asPistol = holding({}, { length: 0.5 });
  check(apart(asRifle, asPistol) > 0.05, 'a short gun is held out as a pistol');
  check(apart(holding({}, { stance: 'pistol' }), asPistol) < 1e-6 && apart(holding({}, { length: 0.5, stance: 'rifle' }), asRifle) < 1e-6, 'an item that says how it\'s held is held so, whatever its length');
  check(apart(holding({ poses: { pistolUnder: 1 } }, {}), asPistol) < 1e-6, 'a figure whose pistols are longer holds this rifle as one');
  check(apart(holding({ poses: { pistol: { hip: [0, -0.3, 0.3] } } }, { stance: 'pistol' }), asPistol) > 0.05, 'the pistol stance is the figure\'s');
  const big = holding({ poses: { heldScale: 0.8 } }, {});
  check(Math.abs(big.node!.scale.x - 0.8) < 1e-9 && Math.abs(asRifle.node!.scale.x - 0.52) < 1e-9, 'a held gun is the figure\'s `heldScale` (0.52 by default)');
  // The kit's own options: under every model's `poses`.
  check(apart(holding({ kit: { poses: { pistolUnder: 1 } } }, {}), asPistol) < 1e-6, 'the kit\'s options: every figure holds this rifle as a pistol');
  check(apart(holding({ kit: { poses: { pistolUnder: 1 } }, poses: { pistolUnder: 0.45 } }, {}), asRifle) < 1e-6, 'and a model\'s own `poses` over the kit\'s');

  // Clips over the kit's poses: the wave (the upper body) raises the right hand while the legs
  // walk as they would; the same on both skeletons; stopped, it fades back out.
  type Setup = Parameters<typeof posed>[4];
  const playing = (clip: Parameters<HumanoidRig['play']>[0], more: Setup = {}): Setup => ({ ...more, before: (f) => f.rig.play(clip) });
  const waving = (gltf: GLTF, o: { joints?: typeof joints }) => posed(gltf, o, 1, { walkAmount: 1, speed: 4 }, playing({ name: 'wave', loop: true, fade: 0.2, layer: 'upper', speed: 1, elapsed: 0 }));
  const walking = posed(skinned, {}, 1, { walkAmount: 1, speed: 4 });
  const w1 = waving(skinned, {});
  const w2 = waving(mixamo, { joints });
  check(w1.at('handR').y > 1.8 && walking.at('handR').y < 1.1, `waving: the right hand up (${w1.at('handR').y.toFixed(2)} m; walking, ${walking.at('handR').y.toFixed(2)})`);
  check(w1.at('footL').distanceTo(walking.at('footL')) < 1e-6 && w1.at('handL').distanceTo(walking.at('handL')) < 1e-6, 'the legs (and the other arm) as they walk');
  check(w1.at('handR').distanceTo(w2.at('handR')) < 1e-3 && w1.at('lowerArmR').distanceTo(w2.at('lowerArmR')) < 1e-3, `the clip made for each skeleton puts the Mixamo figure's hand in the same place (${w1.at('handR').distanceTo(w2.at('handR')).toExponential(1)} m)`);
  const partWay = posed(skinned, {}, 0.1, {}, playing({ name: 'wave', loop: true, fade: 0.4, layer: 'upper', speed: 1, elapsed: 0 }));
  const late = posed(skinned, {}, 0.1, {}, playing({ name: 'wave', loop: true, fade: 0.4, layer: 'upper', speed: 1, elapsed: 5 }));
  check(partWay.at('handR').y < late.at('handR').y - 0.2, 'it fades in; a screen that sees it late starts it faded in');
  const stopped = posed(skinned, {}, 1.5, {}, {
    before: (f) => {
      f.rig.play({ name: 'wave', loop: true, fade: 0.2, layer: 'upper', speed: 1, elapsed: 5 });
      for (let i = 1; i <= 30; i++) f.step({ ...still(), time: -1 + i / 60 });
      f.rig.play(null);
    },
  });
  check(stopped.at('handR').y < 1.1, `stopped, it fades out (the hand at ${stopped.at('handR').y.toFixed(2)} m)`);
  const once = posed(skinned, {}, 2, {}, playing({ name: 'wave', loop: false, fade: 0.2, layer: 'full', speed: 1, elapsed: 0 }));
  check(once.at('handR').y < 1.1, 'played once, it ends by itself');
  const cheering = posed(mixamo, { joints }, 0.25, {}, playing({ name: 'cheer', loop: true, fade: 0, layer: 'full', speed: 1, elapsed: 0 }));
  check(cheering.at('handL').y > 1.9 && cheering.at('handR').y > 1.9 && cheering.at('footL').y > 0.1, `a full-body clip: both hands up, a hop (hands ${cheering.at('handL').y.toFixed(2)}, feet ${cheering.at('footL').y.toFixed(2)})`);
  const rifleWave = posed(skinned, {}, 1, {}, playing({ name: 'wave', loop: true, fade: 0.2, layer: ['upperArmR'], speed: 1, elapsed: 0 }, { item: rifle }));
  const held = rifleWave.node!.getWorldPosition(new THREE.Vector3());
  check(held.distanceTo(rifleWave.at('handR')) < 0.2 && held.y > 1.6, `a gun goes with the hand a clip moves (${held.y.toFixed(2)} m up)`);

  // Skinned meshes get skinned materials (and shadows); the kit's pose drives their bones.
  const lib = new GltfLibrary({} as SharedUniforms);
  const fig = new GltfFigure(skinned, { url: '/skinned.glb', rig: 'humanoid' }, 1, lib);
  const meshes: THREE.SkinnedMesh[] = [];
  fig.root.traverse((o) => (o as THREE.SkinnedMesh).isSkinnedMesh && meshes.push(o as THREE.SkinnedMesh));
  check(meshes.length === 4 && meshes.every((m) => (m.material as THREE.RawShaderMaterial).defines?.SKINNED === 1 && (m.customDepthMaterial as THREE.RawShaderMaterial).defines?.SKINNED === 1), 'a skin is drawn with skinned materials and shadows');
  check(meshes.every((m) => m.skeleton.bones[0] !== (skinned.scene.getObjectByName('hips') as THREE.Bone)), 'each figure has its own skeleton');
  const s = still();
  const shown = new ShownFigure(1, null, 'test', Models.gltf('/skinned.glb', { rig: 'humanoid' }), partsOf(fig), s);
  const kit = humanoidKit();
  s.headYaw = 0.8;
  fig.animate(s);
  check(Math.abs(meshes[0].skeleton.bones.find((b) => b.name === 'head')!.quaternion.y) < 1e-9, 'no kit, no pose: the engine leaves a figure on the rig standing straight');
  kit.frame!(clientOf([shown]), 1 / 60);
  check(shown.posed, 'the kit says it posed it');
  fig.animate(s);
  check(meshes[0].skeleton.bones.find((b) => b.name === 'head')!.quaternion.y > 0.2, 'the kit\'s pose turns the skin\'s bones');
  fig.play({ name: 'cheer', loop: true, fade: 0, layer: 'full', speed: 1, elapsed: 0.25 });
  s.time = 0.1;
  kit.frame!(clientOf([shown]), 1 / 60);
  fig.animate(s);
  fig.root.updateMatrixWorld(true);
  check(fig.pivots.get('handL')!.getWorldPosition(new THREE.Vector3()).y > 1.9, 'a figure plays a clip it\'s told to (`play`)');
  fig.dispose();

  // First-person arms from a skin: rigid pieces in the rig's joint spaces (the arm hanging).
  lib.adopt('/skinned.glb', skinned);
  lib.adopt('/mixamo.glb', mixamo);
  lib.adopt('/rigid.glb', rigid);
  const size = (parts: { geometry: THREE.BufferGeometry }[]) => {
    const box = new THREE.Box3();
    for (const p of parts) {
      p.geometry.computeBoundingBox();
      box.union(p.geometry.boundingBox!);
    }
    return box;
  };
  const armsOf = (spec: Parameters<GltfLibrary['humanoidArms']>[0]) => lib.humanoidArms(spec)!;
  const nat = armsOf('/skinned.glb');
  const mix = armsOf({ url: '/mixamo.glb', joints });
  const rig = armsOf('/rigid.glb');
  for (const [what, a] of [['skinned', nat], ['Mixamo', mix], ['rigid', rig]] as const) {
    const fore = size(a.R.forearm);
    check(a.R.upper.length && a.R.forearm.length && a.R.fist.length && a.L.fist.length, `${what}: an upper arm, forearm and fist each side`);
    check(Math.abs(a.R.elbow.y + 0.28) < 1e-4 && Math.abs(a.R.wrist.y + 0.25) < 1e-4 && Math.abs(a.R.elbow.x) < 1e-4, `${what}: the elbow and wrist below the shoulder and elbow (${a.R.elbow.toArray().map((v) => v.toFixed(3))})`);
    check(fore.min.y > -0.3 && fore.max.y < 0.06 && Math.abs(fore.getCenter(new THREE.Vector3()).x) < 0.03, `${what}: the forearm hangs from the elbow in its space (${fore.min.y.toFixed(2)}..${fore.max.y.toFixed(2)})`);
    check(Math.abs(a.R.grip.y + 0.085) < 1e-3 && Math.abs(a.R.grip.z - 0.015) < 1e-3, `${what}: the fist holds at its grip (${a.R.grip.toArray().map((v) => v.toFixed(3))})`);
  }
  const mf = size(mix.R.fist);
  const nf = size(nat.R.fist);
  check(mf.min.distanceTo(nf.min) < 2e-3 && mf.max.distanceTo(nf.max) < 2e-3, 'the Mixamo fist (a finger bone of its own) comes out as the skinned one does');
  const smaller = lib.humanoidArms({ url: '/skinned.glb', poses: { heldScale: 1.04 } })!;
  check(Math.abs(smaller.R.elbow.y + 0.14) < 1e-4, 'arms for guns held twice as big are drawn half as big beside first person\'s');
  lib.dispose();

  // A figure that isn't a humanoid plays a clip over its idle (by name), and stops.
  const scene = new THREE.Group();
  const body = new THREE.Group();
  body.name = 'body';
  body.add(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), new THREE.MeshStandardMaterial()));
  scene.add(body);
  const q = (a: number) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), a).toArray();
  const clips = [new THREE.AnimationClip('idle', 1, [new THREE.QuaternionKeyframeTrack('body.quaternion', [0, 1], [...q(0), ...q(0)])]), new THREE.AnimationClip('spin', 1, [new THREE.QuaternionKeyframeTrack('body.quaternion', [0, 1], [...q(1.2), ...q(1.2)])])];
  const lib2 = new GltfLibrary({} as SharedUniforms);
  const plain = new GltfFigure({ scene, animations: clips } as unknown as GLTF, { url: 'x', clips: { idle: 'idle' } }, 1, lib2);
  const t = still();
  const step = (n: number) => {
    for (let i = 0; i < n; i++) {
      t.time += 1 / 60;
      plain.animate(t);
    }
  };
  const turn = () => new THREE.Euler().setFromQuaternion(plain.pivots.get('body')!.quaternion, 'YXZ').y;
  step(5);
  plain.play({ name: 'spin', loop: true, fade: 0.1, layer: 'full', speed: 1, elapsed: 0 });
  step(20);
  check(Math.abs(turn() - 1.2) < 1e-3, `a clip over a figure's idle (${turn().toFixed(3)})`);
  plain.play(null);
  step(20);
  check(Math.abs(turn()) < 1e-3, `and off again (${turn().toFixed(3)})`);
  plain.dispose();
  lib2.dispose();
  console.log('  the kit\'s poses over its defaults (its options, a model\'s, an item\'s) · clips in every screen\'s frames, restarted, stopped · the kit poses a Mixamo T-pose skeleton as the rig\'s own (10 states) · clips over the kit\'s poses (layers, fades, late joiners, once, a gun in the hand) · skinned materials · no kit, no pose · arms cut from a skin · clips on other figures');
}
