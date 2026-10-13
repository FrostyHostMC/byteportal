import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { defineGame, Models } from '../../src/platform';
import { GltfFigure, GltfLibrary } from '../../src/platform/client/gltf';
import { GameHost } from '../../src/platform/host/game';
import type { HostEvent } from '../../src/platform/net/protocol';
import type { AnimState } from '../../src/platform/render/entities';
import type { SharedUniforms } from '../../src/platform/render/pipeline';
import { check } from './_harness';

/**
 * glTF models: a host sends their addresses and never opens them (props and figures), props say
 * which animation they loop; and a figure plays idle, walk (in step), run, attack once per swing,
 * turns its head, hides `hitbox` nodes and falls over on death.
 */
export default function gltfModels() {
  // The host side.
  const game = defineGame({
    id: 'gltf-test',
    title: 'glTF',
    world: { terrain: 'flat' },
    setup(g) {
      g.entities.define('dancer', { name: 'Dancer', model: Models.gltf('/models/dancer.glb', { clips: { idle: 'idle', walk: 'walk' }, yaw: Math.PI }), hitbox: { width: 0.6, height: 1.8 }, health: 10, speed: 2 });
    },
    start(g) {
      const slot = g.props.gltf('/models/slot.gltf', { animation: 'spin', radius: 1.5 });
      g.props.spawn(slot, { position: { x: 0, y: 70, z: 0 } });
      const still = g.props.spawn(slot, { position: { x: 3, y: 70, z: 0 } });
      still.play(null);
      g.entities.spawn('dancer', { x: 0, y: 70, z: 3 });
      check(slot.radius === 1.5, 'a glTF prop model takes its radius from the game');
    },
  });
  const host = new GameHost(game, { engine: readFileSync('engine/pkg/voxel_engine_bg.wasm'), seed: 1, remote: true, radius: 4, budget: Infinity, player: { id: 'p1', name: 'Player' } });
  const ann = host.connect('Ann');
  const events: HostEvent[] = [...(ann.batch.events ?? [])];
  host.command(ann.id, { t: 'start' });
  let frame = null as ReturnType<typeof host.step> extends Map<string, infer B> ? B extends { frame: infer F } ? F : never : never;
  for (let i = 0; i < 10; i++) {
    const b = host.step(1 / 30).get(ann.id)!;
    events.push(...b.events);
    frame = b.frame;
  }
  const content = events.flatMap((e) => (e.t === 'content' ? [e.def] : []));
  const prop = content.find((d) => d.kind === 'gltf');
  const dancer = content.find((d) => d.kind === 'entity' && d.name === 'dancer');
  check(prop?.kind === 'gltf' && prop.url === '/models/slot.gltf' && prop.opts.animation === 'spin', `the prop model's address goes to clients: ${JSON.stringify(prop)}`);
  check(dancer?.kind === 'entity' && dancer.def.model.gltf?.url === '/models/dancer.glb' && dancer.def.model.gltf.clips?.walk === 'walk', 'a figure model goes as its address and clips');
  const props = frame!.props;
  check(props.length === 2 && props[0].anim === 'spin' && props[1].anim === undefined, `props loop their model's animation unless told not to: ${props.map((p) => p.anim)}`);
  check(frame!.entities.some((e) => e.type === 'dancer'), 'the figure is in the world (the host never opened its file)');
  host.dispose();

  // The client side: a figure from a model (made here rather than fetched) with a rig and clips.
  const scene = new THREE.Group();
  const node = (name: string, parent: THREE.Object3D, y: number) => {
    const o = new THREE.Group();
    o.name = name;
    o.position.y = y;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), new THREE.MeshStandardMaterial({ color: 0xff8800 }));
    o.add(mesh);
    parent.add(o);
    return o;
  };
  const body = node('body', scene, 1);
  node('head', body, 0.6);
  const leg = node('leg', scene, 0.5);
  const hitbox = node('hitbox', scene, 1);
  const turn = (name: string, axis: 'x' | 'z', angles: number[], times: number[]) => {
    const values: number[] = [];
    for (const a of angles) values.push(...new THREE.Quaternion().setFromEuler(new THREE.Euler(axis === 'x' ? a : 0, 0, axis === 'z' ? a : 0)).toArray());
    return new THREE.QuaternionKeyframeTrack(`${name}.quaternion`, times, values);
  };
  const clips = [
    new THREE.AnimationClip('idle', 2, [turn('body', 'z', [0, 0.1, 0], [0, 1, 2])]),
    new THREE.AnimationClip('walk', 1, [turn('leg', 'x', [-0.8, 0.8, -0.8], [0, 0.5, 1])]),
    new THREE.AnimationClip('run', 1, [turn('leg', 'x', [-1.4, 1.4, -1.4], [0, 0.5, 1])]),
    new THREE.AnimationClip('attack', 0.4, [turn('body', 'x', [0, -1.2, 0], [0, 0.2, 0.4])]),
  ];
  const gltf = { scene, animations: clips } as unknown as GLTF;
  const lib = new GltfLibrary({} as SharedUniforms);
  const fig = new GltfFigure(gltf, { url: 'x', clips: { idle: 'idle', walk: 'walk', run: 'run', attack: 'attack' }, head: 'head' }, 1, lib);
  const figHitbox = fig.pivots.get('hitbox')!;
  check(!figHitbox.visible && hitbox.visible, 'its hitbox node is hidden (the file untouched)');
  check(fig.pivots.get('leg') !== leg && !!fig.pivots.get('head'), 'each figure has its own copy of the nodes');
  const s: AnimState = { walkPhase: 0, walkAmount: 0, pace: 0, attackT: 9, raised: false, casting: false, headYaw: 0, headPitch: 0, dying: 0, time: 0, aim: 0, posture: 0 };
  const angle = (name: string) => new THREE.Euler().setFromQuaternion(fig.pivots.get(name)!.quaternion);
  const run = (seconds: number, change: (s: AnimState) => void = () => {}) => {
    for (let t = 0; t < seconds; t += 1 / 60) {
      s.time += 1 / 60;
      s.attackT += 1 / 60;
      change(s);
      fig.animate(s);
    }
  };
  run(0.5);
  check(Math.abs(angle('body').z) > 0.02 && Math.abs(angle('leg').x) < 1e-6, `standing: idle plays (body ${angle('body').z.toFixed(3)}), legs still`);
  // Walking a quarter stride on: the walk clip a quarter through (in step with the ground).
  s.walkAmount = 1;
  s.pace = 1;
  s.walkPhase = Math.PI / 2;
  run(1 / 60);
  check(Math.abs(angle('leg').x) < 0.05, `walking: the clip follows the stride (leg ${angle('leg').x.toFixed(3)} a quarter through)`);
  s.walkPhase = Math.PI;
  run(1 / 60);
  check(Math.abs(angle('leg').x - 0.8) < 0.05, `half a stride: the leg forward (${angle('leg').x.toFixed(3)})`);
  s.pace = 2;
  run(1 / 60);
  check(Math.abs(angle('leg').x - 1.4) < 0.05, `hurrying: the run clip (${angle('leg').x.toFixed(3)})`);
  s.walkAmount = 0;
  s.pace = 0;
  s.attackT = 0;
  run(0.2);
  check(angle('body').x < -0.9, `a swing: the attack plays (${angle('body').x.toFixed(3)})`);
  run(0.6);
  check(Math.abs(angle('body').x) < 0.05, `and ends (${angle('body').x.toFixed(3)})`);
  s.headYaw = 0.6;
  run(1 / 60);
  const look = new THREE.Euler().setFromQuaternion(fig.pivots.get('head')!.quaternion, 'YXZ');
  check(Math.abs(look.y - 0.6) < 0.01, `the head turns to look (${look.y.toFixed(3)})`);
  run(1 / 60);
  const again = new THREE.Euler().setFromQuaternion(fig.pivots.get('head')!.quaternion, 'YXZ');
  check(Math.abs(again.y - 0.6) < 0.01, `and stays turned without winding further (${again.y.toFixed(3)})`);
  s.dying = 1;
  run(1 / 60);
  check(Math.abs(fig.root.rotation.z - Math.PI / 2 * 0.95) < 1e-6, 'dead: it falls over');
  fig.dispose();

  // Items: the model merged into one mesh (the hitbox left out), turned and scaled as asked;
  // and a part of it standing alone (a player model's arm).
  lib.adopt('/models/dancer.glb', gltf);
  const item = lib.item({ parts: [], gltf: { url: '/models/dancer.glb', rotation: [90, 0, 0], scale: 2 } })!;
  const boxVerts = new THREE.BoxGeometry(0.3, 0.3, 0.3).toNonIndexed().getAttribute('position').count;
  check(item.geometry.getAttribute('position').count === boxVerts * 3, `one mesh of its three visible parts: ${item.geometry.getAttribute('position').count / boxVerts} boxes`);
  item.geometry.computeBoundingBox();
  const size = item.geometry.boundingBox!.getSize(new THREE.Vector3());
  // Standing 1.4 tall and 0.3 wide; laid down along z and doubled.
  check(Math.abs(size.x - 0.6) < 1e-3 && Math.abs(size.y - 0.6) < 1e-3 && Math.abs(size.z - 2.8) < 1e-3, `turned and scaled: ${size.toArray().map((v) => v.toFixed(2))}`);
  check(lib.item({ parts: [], gltf: { url: '/models/dancer.glb', rotation: [90, 0, 0], scale: 2 } }) === item, 'made once');
  const limb = lib.limb('/models/dancer.glb', 'body', 0.75)!;
  limb.geometry.computeBoundingBox();
  const ls = limb.geometry.boundingBox!.getSize(new THREE.Vector3());
  const lc = limb.geometry.boundingBox!.getCenter(new THREE.Vector3());
  check(Math.abs(Math.max(ls.x, ls.y, ls.z) - 0.75) < 1e-3 && lc.length() < 1e-3, `a part alone (the body and head on it), centred, its longest side 0.75: ${ls.toArray().map((v) => v.toFixed(2))}`);
  check(lib.item({ parts: [], gltf: { url: '/models/missing.glb' } }) === null && lib.pending === 1, 'a file not here yet: nothing (and it is fetched)');
  lib.dispose();

  // Players' models go in their frames.
  const withModel = defineGame({ id: 'gltf-players', title: 'glTF players', world: { terrain: 'flat' }, player: { model: Models.gltf('/models/dancer.glb') } });
  const h2 = new GameHost(withModel, { engine: readFileSync('engine/pkg/voxel_engine_bg.wasm'), seed: 1, remote: true, radius: 4, budget: Infinity, player: { id: 'p1', name: 'Player' } });
  const bob = h2.connect('Bob');
  h2.command(bob.id, { t: 'start' });
  h2.step(1 / 30);
  h2.sim.players.find((p) => p.name === 'Bob')!.api.setModel(Models.gltf('/models/other.glb'));
  const fb = h2.step(1 / 30).get(bob.id)!.frame!.players.find((p) => p.name === 'Bob')!;
  check(fb.model?.gltf?.url === '/models/other.glb', `a player's own model is in their frame: ${fb.model?.gltf?.url}`);
  h2.dispose();
  console.log('  host sends model addresses, never opens them · props loop their animation · idle, walk in step, run, attack, head, hitbox hidden, death · items merged, turned, scaled · a limb alone · players\' models in frames');
}
