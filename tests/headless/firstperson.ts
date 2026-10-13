import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Client, ClientEvent, HeldItem, HumanoidViewArms, Me, Node, ViewArm, ViewArms, ViewLayer } from '../../src/platform/api/client';
import type { ItemDefinition, ViewAnimation } from '../../src/platform/api/types';
import type { GunAction } from '../../src/platform/items';
import { firstPerson } from '../../src/platform/client-kits';
import { elbowFor, fitArms, upperFor } from '../../src/platform/client-kits/firstperson/arms';
import { FirstPersonLayer } from '../../src/platform/client/api/view';
import { GltfLibrary } from '../../src/platform/client/gltf';
import type { EntityGraphics } from '../../src/platform/render/entities';
import type { SharedUniforms } from '../../src/platform/render/pipeline';
import { check } from './_harness';

const load = (file: string): Promise<GLTF> => {
  const b = readFileSync(file);
  return new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '');
};
const near = (a: number, b: number, e = 1e-6) => Math.abs(a - b) < e;
const v3 = (a: number[]) => a.map((v) => v.toFixed(3)).join(', ');

// ---------------------------------------------------------------------------------------------
// A view layer of the test's own: the kit gets nothing but the public API (`ViewLayer`).
// ---------------------------------------------------------------------------------------------

/** Everything the fake layer made, to check the kit only placed what the layer gave it. */
const made = new Set<THREE.Object3D>();
const mk = <T extends THREE.Object3D>(o: T): T => (made.add(o), o);

class FakeHeld implements HeldItem {
  readonly node: THREE.Mesh;
  readonly bounds: THREE.Box3;
  readonly look: object;
  alt = false;
  constructor(
    readonly item: string,
    readonly def: ItemDefinition,
    readonly form: HeldItem['form'],
    geometry: THREE.BufferGeometry,
    readonly points: Record<string, THREE.Vector3> = {},
    readonly model: HeldItem['model'] = null,
  ) {
    this.node = mk(new THREE.Mesh(geometry));
    this.look = geometry;
    this.bounds = new THREE.Box3().setFromBufferAttribute(geometry.getAttribute('position') as THREE.BufferAttribute);
  }
  halfWidthAt(z: number) {
    const pos = this.node.geometry.getAttribute('position') as THREE.BufferAttribute;
    let w = 0;
    for (let i = 0; i < pos.count; i++) if (Math.abs(pos.getZ(i) - z) < 1.5 / 16) w = Math.max(w, Math.abs(pos.getX(i)));
    return w > 0 ? w : 1.2 / 16;
  }
  pixel(x: number, y: number, out = new THREE.Vector3()) {
    return out.set(x / 16 - 0.5, 0.5 - y / 16, 0);
  }
  alternate(on: boolean) {
    this.alt = on;
  }
  toWorld(p: THREE.Vector3, out = new THREE.Vector3()) {
    this.node.updateWorldMatrix(true, false);
    return out.copy(p).applyMatrix4(this.node.matrixWorld);
  }
}

class FakeArms implements ViewArms {
  version = 0;
  skin: ViewArms['skin'] = { uv: [0, 0], atlas: 'builtin' };
  model = false;
  humanoid: HumanoidViewArms | null = null;
  setSkin(skin: [number, number] | null, atlas = 'builtin') {
    this.skin = skin && { uv: skin, atlas };
    this.version++;
  }
  arm(o: { length?: number; mirror?: boolean } = {}) {
    return this.skin ? mk(new THREE.Mesh(new THREE.BoxGeometry(4 / 16, (o.length ?? 12) / 16, 4 / 16))) : null;
  }
  box(size: [number, number, number]) {
    return this.skin ? mk(new THREE.Mesh(new THREE.BoxGeometry(size[0] / 16, size[1] / 16, size[2] / 16))) : null;
  }
}

class FakeView implements ViewLayer {
  readonly root = mk(new THREE.Group());
  readonly camera = { fov: 70, aspect: 16 / 9 };
  visible = true;
  held: FakeHeld | null = null;
  arms = new FakeArms();
  animations = new Map<string, ViewAnimation>();
  freed = 0;
  node() {
    return mk(new THREE.Group());
  }
  sprite() {
    const m = mk(new THREE.Mesh(new THREE.PlaneGeometry(1, 1)));
    m.visible = false;
    return m;
  }
  item() {
    return null;
  }
  free(n: Node) {
    this.freed++;
    (n as THREE.Object3D).removeFromParent();
  }
  worldPoint(name: string, out = new THREE.Vector3()) {
    const p = this.held?.points[name];
    return p && this.held!.node.parent ? this.held!.toWorld(p, out) : null;
  }
}

/** The kit's own state, as the tests read it. */
interface Inside {
  hold: { gun?: { hands?: number } };
  pending: unknown;
  gunPose: { hands: 1 | 2 };
  supportShown: number;
  rest: { grip: THREE.Vector3; grip2: THREE.Vector3; itemRot: THREE.Quaternion };
  playing: unknown;
  arm: THREE.Mesh | null;
  arm2: THREE.Mesh | null;
  gunHands: THREE.Group;
  gunHand2: THREE.Group;
  hand: THREE.Group;
  root: THREE.Group;
  flash: THREE.Mesh;
  humanoid: HumanoidViewArms | null;
  cycleT: number;
  dipVel: number;
  kickVel: number;
  height: number;
  queued: string | null;
  held: { kind: string; item?: HeldItem };
  fire(power?: number): void;
}

interface Rig {
  kit: ReturnType<typeof firstPerson.standard>[number];
  inside: Inside;
  view: FakeView;
  client: Client & { events: ClientEvent[]; me: Me };
}

const gunState = (o: Record<string, unknown> = {}) => ({ aim: 0, sprint: 0, slide: 0, reload: -1, shells: 0, sight: 'iron', zoom: 1.5, ...o });

/** A kit on a fake layer, standing still. */
function rig(): Rig {
  const view = new FakeView();
  const me: Me = {
    id: 'p',
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    look: { yaw: 0, pitch: 0 },
    onGround: true,
    flying: false,
    crouching: false,
    sprinting: false,
    sliding: false,
    dead: false,
    inVehicle: false,
    health: 20,
    maxHealth: 20,
    bob: { phase: 0, amount: 0 },
    thirdPerson: false,
    walkSpeed: 4.3,
    hotbar: null,
    hand: { item: null, count: 0, state: null },
    held: null,
    abilities: {},
    items: { melee: { strength: 1 }, bow: { drawing: false, charge: 0 } },
  };
  const client = { view, me, events: [] as ClientEvent[], camera: { zoom: 1, fov: 75 }, time: 0 } as unknown as Rig['client'];
  const [kit] = firstPerson.standard();
  kit.setup?.(client);
  return { kit, inside: kit as unknown as Inside, view, client };
}

/** Run the kit for `seconds` (60 steps a second): the gun's state as given (none: no gun), events on the first step. */
function run(r: Rig, seconds: number, gun: Record<string, unknown> | null = null, events: ClientEvent[] = []) {
  const me = r.client.me as { -readonly [K in keyof Me]: Me[K] };
  me.held = gun ? { item: 'gun', def: undefined, state: gunState(gun) } : null;
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    r.client.events = i === 0 ? events : [];
    r.kit.frame?.(r.client, 1 / 60);
  }
}

/** A gun a metre long along +z, its grip at the origin, and the points its file marks. */
function gunGeometry(): { geometry: THREE.BufferGeometry; points: () => Record<string, THREE.Vector3> } {
  const geometry = new THREE.BoxGeometry(0.2, 0.3, 1).translate(0, 0.1, 0.4);
  return { geometry, points: () => ({ grip: new THREE.Vector3(), grip2: new THREE.Vector3(0, 0.1, 0.55), muzzle: new THREE.Vector3(0, 0.15, 0.9), sight: new THREE.Vector3(0, 0.3, 0), mag: new THREE.Vector3(0, -0.1, 0.25) }) };
}
const gunDef = (hold: Record<string, unknown> = {}, action?: GunAction) => ({ kind: 'gun', name: 'Gun', icon: 'stick', hold: { style: 'gun', ...hold }, action }) as unknown as ItemDefinition;

/**
 * The first-person kit (`firstPerson.standard()`), driven in Node against a view layer of the
 * test's own (nothing but the public client API), and against the engine's own layer: what's in
 * hand comes up after the hand's lowered (two items on one model each held their own way); a
 * one-handed gun's support hand out of sight but to reload; a gun's action (a lever, a hammer, one
 * of the game's own) worked after each shot; the arms fitted per gun and bent to a shoulder that
 * stays put; the events it plays (uses, throws, the server's calls, landings); a bow's drawn look;
 * the world's zoom from the gun's state; the gun's points marked for tracers.
 */
export default async function firstperson() {
  // Two items sharing a model, held their own ways.
  const { geometry, points } = gunGeometry();
  const r = rig();
  r.view.held = new FakeHeld('rifle', gunDef(), 'sprite', geometry, points());
  run(r, 1, {});
  const i = r.inside;
  // (Read through functions: the kit changes these as it runs.)
  const hands = (): number => i.gunPose.hands;
  const shown = (): number => i.supportShown;
  check(i.pending === null && hands() === 2 && shown() === 1 && i.arm2?.visible, 'a two-handed gun: the support arm on it');
  check(r.view.held.node.parent === i.hand && i.flash.parent === r.view.held.node && i.gunHands.parent === r.view.held.node, 'the held node in the hand, the flash and the hands on the gun');
  const muzzle = r.view.worldPoint('muzzle');
  check(!!muzzle && r.view.held.points.muzzle.z === 0.9, `the gun's points marked on the held item (the muzzle in the world at ${muzzle && v3(muzzle.toArray())})`);
  check(r.client.camera.zoom === 1, 'hip: no zoom');
  run(r, 0.1, { aim: 1 });
  check(near(r.client.camera.zoom, 1.5) && near(r.view.camera.fov, 66), `aimed: the world zoomed by the gun's state (${r.client.camera.zoom}), the layer's lens narrowed (${r.view.camera.fov})`);
  const unguessed = new FakeHeld('rifle', gunDef(), 'sprite', geometry.clone(), {});
  r.view.held = unguessed;
  run(r, 1, {});
  check(unguessed.points.muzzle !== undefined && near(unguessed.points.muzzle.z, 0.9), 'a gun marking no points: the kit guesses them from its size, and marks them');
  r.view.held = new FakeHeld('rifle2', gunDef({ gun: { hands: 1 } }), 'sprite', geometry, points());
  run(r, 1 / 60, {});
  check(i.pending !== null, 'the same model with another hold is taken up');
  run(r, 1, {});
  check(i.pending === null && i.hold.gun?.hands === 1 && hands() === 1, 'switching to it, its own hold');
  r.view.held = new FakeHeld('rifle3', gunDef({ gun: { hands: 1 } }), 'sprite', geometry, points());
  run(r, 1 / 60, {});
  check(i.pending === null, 'the same hold again (a new object, the same values): nothing to change');

  // One hand: the support hand out of sight, and in to reload.
  run(r, 0.2, {});
  check(shown() === 0 && !i.arm2?.visible && !i.gunHand2.visible, 'one-handed: the support hand and arm hidden');
  run(r, 0.1, { reload: 0.4 });
  check(shown() === 1 && i.arm2?.visible && i.gunHand2.visible, 'one-handed, reloading: the support hand comes in');
  const inHand = i.gunHand2.position.clone();
  run(r, 0.1, { reload: 0.02 });
  check(i.gunHand2.position.distanceTo(inHand) > 0.2, `it comes from out of sight (${v3(i.gunHand2.position.toArray())} from ${v3(inHand.toArray())})`);

  // Actions: a lever rocks the gun on the support hand; a hammer cants it; the game's own plays.
  const action = (a: GunAction | undefined, after: number) => {
    const g = rig();
    g.view.held = new FakeHeld('gun', gunDef({}, a), 'sprite', geometry, points());
    run(g, 1, { action: a });
    const grip = g.inside.rest.grip.clone();
    const support = g.inside.rest.grip.clone().add(g.inside.rest.grip2);
    const rot = g.inside.rest.itemRot.clone();
    // A shot (the recoil springs move the hand, not the rest pose the action moves).
    run(g, after, { action: a }, [{ t: 'shot', item: 'gun', power: 1 }]);
    return { grip, support, rot, i: g.inside };
  };
  const lever = action('lever', 0.25);
  check(lever.i.rest.grip.y < lever.grip.y - 0.02, `a lever: the grip and the hand on it drop (${lever.grip.y.toFixed(3)} to ${lever.i.rest.grip.y.toFixed(3)})`);
  check(lever.i.rest.grip.clone().add(lever.i.rest.grip2).distanceTo(lever.support) < 1e-6, 'a lever: the support hand stays put');
  const hammer = action('hammer', 0.2);
  check(hammer.i.rest.itemRot.angleTo(hammer.rot) > 0.15 && hammer.i.rest.grip.distanceTo(hammer.grip) < 1e-6, 'a hammer: the gun cants in the fist');
  const none = action(undefined, 0.25);
  check(none.i.rest.itemRot.angleTo(none.rot) < 1e-6 && none.i.cycleT === -1, 'no action: nothing worked');
  check(action('lever', 1).i.rest.itemRot.angleTo(lever.rot) < 1e-6, 'a lever: back where it was after');
  const custom: ViewAnimation = { duration: 0.3, keys: [{ t: 0 }, { t: 0.5, move: [0, 0.1, 0] }, { t: 1 }] };
  const own = action(custom, 0.12);
  check(own.i.playing !== null, "an action of the game's own plays on the hand a beat after the shot");
  const shot = action(undefined, 1 / 60);
  check(shot.i.flash.visible && shot.i.flash.scale.x > 0, 'a shot: the flash shows');

  // First-person arms: fitted per gun over the model's, and bent.
  const fit = fitArms({ scale: 0.9, bend: 0.6 }, { reach: [0.5, 0.6], bend: [0.5, 0.7] });
  check(fit.scale === 0.9 && fit.reach.join() === '0.5,0.6' && fit.bend.join() === '0.5,0.7' && fit.support.join() === '0.01,-0.012,0', `a gun's arm over the model's over the platform's: ${JSON.stringify(fit)}`);
  check(fitArms().bend.join() === '0,0' && fitArms({ bend: 0.4 }).bend.join() === '0.4,0.4', 'straight by default; one bend for both arms');
  check(fitArms().hands === 1 && fitArms({ hands: 0.7 }, { scale: 0.8 }).hands === 0.7, "fists the arms' size by default; `hands` over it");
  check(near(upperFor(0.55, 0.25, 0.2, 0), 0.3) && near(upperFor(0.55, 0.25, 0.4, 0), 0.4), 'straight: the upper arm drawn out to the reach (never shorter than its own)');
  const b = upperFor(0.5, 0.25, 0.1, 0.8);
  const w = new THREE.Vector3(0, 0, 0);
  const sh = new THREE.Vector3(0, 0, 0.5);
  const e = elbowFor(sh, w, b, 0.25, new THREE.Vector3(0, -1, 0), new THREE.Vector3());
  const bend = Math.PI - e.clone().sub(w).angleTo(sh.clone().sub(e));
  check(near(e.distanceTo(w), 0.25, 1e-6) && near(e.distanceTo(sh), b, 1e-6) && near(Math.PI - bend, 0.8, 1e-6) && e.y < 0, `bent: the bones their lengths, the elbow bent as asked, toward the pole (${(Math.PI - bend).toFixed(3)} rad)`);
  const far = elbowFor(sh, new THREE.Vector3(0, 0, -1), b, 0.25, new THREE.Vector3(0, -1, 0), new THREE.Vector3());
  check(near(far.x, 0) && near(far.y, 0) && near(far.z, -0.75), 'out of reach: straight at the shoulder');

  // A humanoid's own arms: bent at the elbow, the shoulder staying put.
  const lib = new GltfLibrary({} as SharedUniforms);
  lib.adopt('/m.glb', await load('src/games/gallery/models/mannequin.glb'));
  const arms = lib.humanoidArms('/m.glb')!;
  const side = (a: typeof arms.R): ViewArm => ({ upper: mk(new THREE.Group()), forearm: mk(new THREE.Group()), fist: mk(new THREE.Group()), elbow: a.elbow, wrist: a.wrist, grip: a.grip, gripQ: a.gripQ });
  const arm = (bendBy: number, hands?: number) => {
    const g = rig();
    g.view.arms.humanoid = { R: side(arms.R), L: side(arms.L), fit: { bend: bendBy, hands }, heldScale: 0.52 };
    g.view.arms.version++;
    g.view.held = new FakeHeld('gun', gunDef(), 'sprite', geometry, points());
    run(g, 1, {});
    const R = g.inside.humanoid!.R;
    const elbow = R.forearm.position;
    const angle = R.fist.position.clone().sub(elbow).angleTo(R.upper.position.clone().sub(elbow));
    return { g, i: g.inside, angle };
  };
  const straight = arm(0);
  check(!straight.i.arm?.visible && straight.i.humanoid!.R.fist.parent === straight.i.hand, "a humanoid's pieces in the hand, the skin's arm hidden");
  check(near(straight.angle, Math.PI, 1e-4), `bend 0: one straight line from the wrist (${straight.angle.toFixed(4)} rad at the elbow)`);
  const bent = arm(0.6);
  check(near(Math.PI - bent.angle, 0.6, 0.01), `bend 0.6: the elbow bent that much at rest (${(Math.PI - bent.angle).toFixed(3)})`);
  // Smaller fists (`hands`): the fist that much smaller than the forearm, still closed on the grip.
  const small = arm(0, 0.6);
  const Rs = small.i.humanoid!.R;
  const Rn = straight.i.humanoid!.R;
  const grip = (R: ViewArm) => arms.R.grip.clone().multiplyScalar(R.fist.scale.x).applyQuaternion(R.fist.quaternion).add(R.fist.position);
  check(near(Rs.fist.scale.x / Rs.forearm.scale.x, 0.6, 1e-6) && near(Rn.fist.scale.x, Rn.forearm.scale.x, 1e-9), `hands 0.6: the fist 0.6 of the arm (${(Rs.fist.scale.x / Rs.forearm.scale.x).toFixed(3)})`);
  check(grip(Rs).distanceTo(grip(Rn)) < 1e-6, 'and still holding the same grip');
  const shoulder = () => bent.i.humanoid!.R.upper.position.clone().applyQuaternion(bent.i.hand.quaternion).add(bent.i.hand.position);
  const before = shoulder();
  run(bent.g, 0.03, {}, [{ t: 'shot', item: 'gun', power: 2 }]);
  const Rb = bent.i.humanoid!.R;
  const kicked = Math.PI - Rb.forearm.position.clone().sub(Rb.fist.position).angleTo(Rb.upper.position.clone().sub(Rb.forearm.position));
  check(shoulder().distanceTo(before) < 1e-6 && Math.abs(kicked - 0.6) > 0.01, `kicked, the shoulder stays put and the elbow gives (${kicked.toFixed(3)} rad)`);
  lib.dispose();

  // Events: uses, swings, throws, the server's calls, landings.
  const sword = rig();
  const plain = new THREE.BoxGeometry(1, 1, 1 / 16);
  sword.view.held = new FakeHeld('sword', { kind: 'melee', name: 'Sword', icon: 'stick' } as unknown as ItemDefinition, 'sprite', plain);
  run(sword, 1);
  const s = sword.inside;
  run(sword, 1 / 60, null, [{ t: 'use', power: 1 }]);
  check(s.playing !== null, 'a use: the swing plays');
  run(sword, 1, null, [{ t: 'view.visible', visible: false }]);
  check(!s.root.visible && s.playing === null, "the server's `visible`: hidden (and the swing done)");
  run(sword, 1 / 60, null, [{ t: 'view.visible', visible: true }, { t: 'view.play', anim: 'chop', power: 1, speed: 1 }]);
  check(s.root.visible && s.playing !== null, "shown again, and the server's animation plays");
  sword.view.animations.set('wave', { duration: 0.5, keys: [{ t: 0 }, { t: 0.5, move: [0, 0.1, 0] }, { t: 1 }] });
  run(sword, 1);
  run(sword, 1 / 60, null, [{ t: 'view.play', anim: 'wave', power: 1, speed: 1 }]);
  check(s.playing !== null, "one of the game's own (`viewModel.define`), by name");
  run(sword, 1 / 60, null, [{ t: 'kick', strength: 1 }, { t: 'land', vy: -12 }]);
  check(s.kickVel > 0 && s.dipVel < 0, 'a kick and a hard landing jolt the view');
  const armsWere = s.arm;
  run(sword, 1 / 60, null, [{ t: 'view.setSkin', skin: [16, 0], atlas: 'mine' }]);
  check(sword.view.arms.skin?.atlas === 'mine' && s.arm !== armsWere && s.arm?.parent === s.hand, "the server's `setSkin`: the arms made again in it");
  run(sword, 1 / 60, null, [{ t: 'view.setSkin', skin: null }]);
  check(!s.arm?.visible, 'no skin: no arm');
  // A throw as the throwable comes up waits for it.
  sword.view.held = new FakeHeld('frag', { kind: 'throwable', name: 'Frag', icon: 'stick' } as unknown as ItemDefinition, 'sprite', plain);
  run(sword, 1 / 60, null, [{ t: 'toss' }]);
  run(sword, 1 / 60);
  check(s.pending !== null && s.height < 1, 'something new in hand: the hand lowers for it');
  sword.view.held = new FakeHeld('frag2', { kind: 'throwable', name: 'Frag', icon: 'stick' } as unknown as ItemDefinition, 'sprite', new THREE.BoxGeometry(1, 1, 1 / 16));
  run(sword, 1 / 60, null, [{ t: 'toss' }]);
  check(s.queued === 'toss', 'thrown as it came up: the throw waits');
  run(sword, 0.5);
  check(s.pending === null && s.held.item === sword.view.held && s.queued === null, 'up, and thrown');
  // A bow shows its drawn look once it's drawn far enough.
  const bowRig = rig();
  const bow = (bowRig.view.held = new FakeHeld('bow', { kind: 'bow', name: 'Bow', icon: 'bow' } as unknown as ItemDefinition, 'sprite', plain));
  run(bowRig, 1);
  (bowRig.client.me.items.bow as { drawing: boolean; charge: number }).drawing = true;
  (bowRig.client.me.items.bow as { drawing: boolean; charge: number }).charge = 0.6;
  run(bowRig, 1 / 60);
  check(bow.alt, 'a bow drawn: its drawn look');
  (bowRig.client.me.items.bow as { drawing: boolean }).drawing = false;
  run(bowRig, 1 / 60);
  check(!bow.alt, 'loosed: its own again');

  // Only what the layer gave it: every node under the layer's root was made by the layer.
  for (const g of [r, sword, bowRig, straight.g]) {
    g.view.root.traverse((o) => check(made.has(o), `the kit placed a node the layer didn't make (${o.type})`));
  }
  check(r.view.freed > 0, 'and gave back what it made again (the arms, for a gun)');

  // The engine's own layer, with the kit: what's in hand loaded, `equip` said, the muzzle in the world.
  const tex = new THREE.DataTexture(new Uint8Array(4), 1, 1);
  const atlas = { name: 'builtin', width: 64, height: 64, pixels: new Uint8Array(64 * 64 * 4), albedo: tex, emissive: tex };
  const model = { parts: [], muzzle: [0, 2, 14] as [number, number, number] };
  const graphics = { atlas: () => atlas, itemLook: () => ({ geometry, albedo: tex, emissive: tex, points: points(), model }) } as unknown as EntityGraphics;
  const worldCamera = new THREE.PerspectiveCamera();
  worldCamera.position.set(10, 20, 30);
  worldCamera.updateMatrixWorld();
  const said: ClientEvent[] = [];
  const layer = new FirstPersonLayer(tex, tex, graphics, worldCamera, new Map(), (ev) => said.push(ev), new Map());
  const client = { view: layer, me: rig().client.me, events: [] as ClientEvent[], camera: { zoom: 1, fov: 75 } } as unknown as Rig['client'];
  const [kit] = firstPerson.standard();
  kit.setup?.(client);
  check(layer.holdItem('rifle', gunDef({ model })) && said.at(-1)?.t === 'equip', "an item loaded, and `equip` said");
  check(layer.held!.form === 'model' && near(layer.held!.points.muzzle.y, 2 / 16) && near(layer.held!.points.grip2.z, 0.55), "its points: the spec's over the file's");
  const me = client.me as { held: Me['held'] };
  me.held = { item: 'rifle', def: undefined, state: gunState() };
  for (let n = 0; n < 60; n++) kit.frame?.(client, 1 / 60);
  const at = layer.worldPoint('muzzle')!;
  const inView = new THREE.Vector3();
  check(layer.muzzle(inView) && at.distanceTo(inView.clone().applyMatrix4(worldCamera.matrixWorld)) < 1e-9 && at.distanceTo(worldCamera.position) < 2, `the muzzle in the world, where it's drawn (${v3(at.toArray())})`);
  check(layer.worldPoint('nothing') === null, 'a point it has none of: null');
  layer.holdNothing();
  check(said.at(-1)?.t === 'equip' && layer.held === null && layer.worldPoint('muzzle') !== null, 'emptied: `equip` said, the gun still on show while the hand lowers');
  layer.holdNothing();
  check(said.filter((ev) => ev.t === 'equip').length === 2, 'nothing again: nothing said');
  for (let n = 0; n < 60; n++) kit.frame?.(client, 1 / 60);
  check(layer.worldPoint('muzzle') === null, 'and gone once the hand is down');
  kit.dispose?.();

  console.log("  two items on one model held their own ways · one hand (hidden, in to reload) · lever, hammer, the game's own action · arms fitted per gun, bent to a shoulder that stays put · uses, the server's calls, kicks, landings, throws waiting · a bow's drawn look · the world's zoom · only the layer's nodes · the engine's layer: equip, points, the muzzle in the world");
}
