/**
 * Development: a humanoid model (docs/HUMANOID.md) in a row of poses, posed by the figures kit
 * (`figures.humanoid()`) on the platform's rig as a game's are, lit simply.
 * `/tools/rig.html?model=<glb url>&t=<seconds>&view=front|side|34`
 * `&poses=<names>` (`t` freezes time for a screenshot, the same every time; guns come from Call of
 * Blocky's models; `cycling` is a moment after a shot, while a lever or hammer is worked).
 * `joints=mixamo` (or a JSON joint map) for a skeleton named its own way; `style=<JSON>` for
 * `HumanoidPoses`; the poses ending in a clip's name (`wave`, `cheer`) play the model's clip.
 * `flat=0` shades every mesh by the file's normals (as the game does), `flat=1` faceted.
 * `studio=1`: a product shot's light (a soft room's reflections, a soft key light, a grey backdrop).
 *
 * Any item and any clip:
 * - `item=<glb url>` puts that model in the hand wherever a pose holds a gun (High Noon's
 *   revolver: `item=/src/games/highnoon/models/revolver.glb`); `kind=melee` holds it as a blade,
 *   `kind=throw` in the fist as a throwable (the `throw` poses).
 * - `hold=<JSON>`: how the item holds a gun, as its `hold` and `hold.gun` say (`hands`, `stance`,
 *   `poses`) and its `action`: `hold={"hands":1,"action":"hammer","poses":{"reload":{"cycle":0.42}}}`.
 * - `clips=<names>` (or `clips=all`: every clip in the model) adds a figure playing each clip,
 *   looping, holding the item if one's given; `layer=upper` plays them over the legs' own motion.
 *   With `clips` and no `poses`, only the clips are shown.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { HumanoidJoints } from '../src/platform/api/models';
import type { Client } from '../src/platform/api/client';
import type { ClipOptions, HumanoidJoint, HumanoidPoses, ItemDefinition, ItemPoses } from '../src/platform/api/types';
import { humanoid } from '../src/platform/client-kits/figures';
import { ShownFigure } from '../src/platform/client/figures';
import { HumanoidRig } from '../src/platform/client/humanoid';
import type { AnimState } from '../src/platform/render/entities';

const q = new URLSearchParams(location.search);
const MODEL = q.get('model') ?? '/src/games/gallery/models/mannequin.glb';
const FREEZE = q.has('t') ? Number(q.get('t')) : null;
const VIEW = q.get('view') ?? '34';
const GUNS = '/src/games/callofblocky/models/';
/** How the item holds a gun (its `hold`: hands, stance, poses; its action). */
const HOLD: { hands?: 1 | 2; stance?: 'rifle' | 'pistol'; action?: string; poses?: ItemPoses } = q.has('hold') ? JSON.parse(q.get('hold')!) : {};
const JOINTS: Partial<Record<HumanoidJoint, string>> | undefined = q.get('joints') === 'mixamo' ? HumanoidJoints.mixamo() : q.has('joints') ? JSON.parse(q.get('joints')!) : undefined;
const STYLE: HumanoidPoses | undefined = q.has('style') ? JSON.parse(q.get('style')!) : undefined;
const FLAT = q.get('flat');
const STUDIO = q.has('studio');
// Frozen for a screenshot, the same every time (a fall's direction is random).
if (FREEZE !== null) {
  let seed = 1;
  Math.random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
}
/** An item of any game's to hold instead of Call of Blocky's guns, and how it's held. */
const ITEM = q.get('item');
const KIND = q.get('kind') === 'melee' ? 'melee' : q.get('kind') === 'throw' ? 'throwable' : null;
/** The held model for a pose's gun: the item given, else Call of Blocky's. */
const gunUrl = (id: string) => ITEM ?? `${GUNS}${id}.glb`;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
document.body.append(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x2a2f3a);
scene.add(new THREE.HemisphereLight(0xcfe3ff, 0x4a3b30, 1.4));
const sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
sun.position.set(4, 8, 6);
sun.castShadow = true;
sun.shadow.camera.left = -14;
sun.shadow.camera.right = 14;
sun.shadow.camera.top = 6;
sun.shadow.camera.bottom = -3;
scene.add(sun);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 12), new THREE.MeshStandardMaterial({ color: 0x555a63, roughness: 0.9 }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);
if (STUDIO) {
  // Soft: a room's light all round, a gentle key from the front left, a grey backdrop the floor fades into.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
    const grey = 0x8b8d93;
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.75;
  scene.background = new THREE.Color(grey);
  scene.fog = new THREE.Fog(grey, 9, 26);
  (floor.material as THREE.MeshStandardMaterial).color.set(0x9a9ca2);
  (floor.material as THREE.MeshStandardMaterial).roughness = 0.75;
  floor.scale.set(3, 4, 1);
  sun.intensity = 1.6;
  sun.position.set(-3, 7, 6);
  sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.radius = 6;
  for (const l of scene.children) if ((l as THREE.HemisphereLight).isHemisphereLight) (l as THREE.HemisphereLight).intensity = 0.35;
}

const base = (): AnimState => ({ walkPhase: 0, walkAmount: 0, pace: 0, attackT: 9, raised: false, casting: false, headYaw: 0, headPitch: 0, dying: 0, time: 0, aim: 1, posture: 0, speed: 0, moveX: 0, moveZ: 1, sights: 0, shotT: 9 });
interface Pose { name: string; gun: string | null; state: (t: number) => Partial<AnimState>; clip?: { name: string } & ClipOptions }
const POSES: Pose[] = [
  { name: 'stand', gun: null, state: () => ({ aim: 0 }) },
  { name: 'idle rifle', gun: 'rifle', state: () => ({}) },
  { name: 'look up', gun: 'rifle', state: () => ({ headPitch: -0.6 }) },
  { name: 'aim (ADS)', gun: 'rifle', state: () => ({ sights: 1 }) },
  { name: 'firing', gun: 'rifle', state: (t) => ({ shotT: t % 0.1 }) },
  { name: 'cycling', gun: 'rifle', state: () => ({ shotT: 0.3 }) },
  { name: 'throw', gun: 'rifle', state: (t) => ({ attackT: t % 0.8, aim: 0 }) },
  { name: 'throw cocked', gun: 'rifle', state: () => ({ attackT: 0.12, aim: 0 }) },
  { name: 'throw whipped', gun: 'rifle', state: () => ({ attackT: 0.3, aim: 0 }) },
  { name: 'walk', gun: 'rifle', state: () => ({ walkAmount: 1, speed: 4 }) },
  { name: 'run', gun: 'rifle', state: () => ({ walkAmount: 1, speed: 6 }) },
  { name: 'strafe left', gun: 'rifle', state: () => ({ walkAmount: 1, speed: 5, moveX: 1, moveZ: 0 }) },
  { name: 'backpedal', gun: 'rifle', state: () => ({ walkAmount: 1, speed: 4, moveX: 0, moveZ: -1 }) },
  { name: 'sprint', gun: 'rifle', state: () => ({ walkAmount: 1, speed: 8.4, sprint: true }) },
  { name: 'crouch', gun: 'rifle', state: () => ({ posture: 1 }) },
  { name: 'crouch walk', gun: 'rifle', state: () => ({ posture: 1, walkAmount: 1, speed: 2.5 }) },
  { name: 'slide', gun: 'rifle', state: () => ({ posture: 2, walkAmount: 1, speed: 10 }) },
  { name: 'jump', gun: 'rifle', state: () => ({ air: true }) },
  { name: 'reload', gun: 'rifle', state: () => ({ reloading: true }) },
  { name: 'pistol', gun: 'pistol', state: () => ({}) },
  { name: 'pistol walk', gun: 'pistol', state: () => ({ walkAmount: 1, speed: 5 }) },
  { name: 'shotgun', gun: 'shotgun', state: () => ({}) },
  { name: 'sniper ADS', gun: 'sniper', state: () => ({ sights: 1 }) },
  { name: 'katana', gun: 'katana', state: () => ({}) },
  { name: 'katana swing', gun: 'katana', state: (t) => ({ attackT: (t % 0.8) * 0.5 }) },
  { name: 'unarmed walk', gun: null, state: () => ({ walkAmount: 1, speed: 4, aim: 0 }) },
  { name: 'dying', gun: 'rifle', state: (t) => ({ dying: 1, time: t }) },
  { name: 'wave', gun: null, state: () => ({ aim: 0 }), clip: { name: 'wave', layer: 'upper', loop: true } },
  { name: 'walk wave', gun: null, state: () => ({ walkAmount: 1, speed: 4, aim: 0 }), clip: { name: 'wave', layer: 'upper', loop: true } },
  { name: 'rifle wave', gun: 'rifle', state: () => ({}), clip: { name: 'wave', layer: ['upperArmR'], loop: true } },
  { name: 'cheer', gun: null, state: () => ({ aim: 0 }), clip: { name: 'cheer', loop: true } },
  { name: 'crouch cheer', gun: null, state: () => ({ posture: 1, aim: 0 }), clip: { name: 'cheer', layer: 'upper', loop: true } },
];

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const load = (url: string) => loader.loadAsync(url);
const figures: { rig: HumanoidRig; fig: ShownFigure; mount: THREE.Object3D | null; root: THREE.Object3D; pose: Pose; state: AnimState; label: HTMLElement }[] = [];
/** The kit that poses them, as a game's client runs it (it sees only `client.figures`). */
const kit = humanoid();
const client = { figures: { all: [] as ShownFigure[] } };

async function main() {
  const model = await load(MODEL);
  // A figure for each clip asked for (`clips=all`: every one the model has), looping.
  const asked = q.get('clips');
  const clipNames = asked === 'all' ? model.animations.map((a) => a.name) : (asked?.split(',').map((n) => n.trim()).filter(Boolean) ?? []);
  const layer = q.get('layer') === 'upper' ? 'upper' : 'full';
  const clipPoses: Pose[] = clipNames.map((name) => ({ name, gun: ITEM ? 'item' : null, state: () => ({ aim: ITEM ? 1 : 0 }), clip: { name, loop: true, layer } }));
  const all = [...POSES, ...clipPoses];
  const pick = q.get('poses')?.split(',').map((n) => n.trim().toLowerCase());
  const shown = pick ? all.filter((p) => pick.includes(p.name.toLowerCase())) : clipPoses.length ? clipPoses : POSES.slice(0, 8);
  const guns = new Map<string, THREE.Object3D>();
  for (const id of new Set(shown.map((p) => p.gun).filter((g): g is string => !!g))) guns.set(id, (await load(gunUrl(id))).scene);
  const cols = shown.length;
  frameCamera(cols);
  shown.forEach((pose, i) => {
    const root = new THREE.Group();
    const copy = cloneSkinned(model.scene);
    copy.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = true;
        m.frustumCulled = false;
        const mat = m.material as THREE.MeshStandardMaterial;
        m.material = mat.clone();
        // Rigid parts faceted; a skin smooth (`flat=0`: every mesh by the file's normals, as the game shades it; `flat=1`: every mesh faceted).
        (m.material as THREE.MeshStandardMaterial).flatShading = FLAT === null ? !(m as THREE.SkinnedMesh).isSkinnedMesh : FLAT === '1';
      }
    });
    root.add(copy);
    root.position.set((i - (cols - 1) / 2) * 1.35, 0, 0);
    // Turned to show the side (its right, the gun side), or three-quarters.
    root.rotation.y = VIEW === 'side' ? -Math.PI / 2 : VIEW === 'back' ? Math.PI : VIEW === '34' ? -0.6 : 0;
    scene.add(root);
    const rig = new HumanoidRig(copy, { joints: JOINTS, clips: model.animations });
    if (pose.clip) rig.play({ loop: false, fade: 0.2, layer: 'full', speed: 1, ...pose.clip, elapsed: 0 });
    const state = base();
    const hand = rig.joint('handR');
    const fig = new ShownFigure(i, null, 'figure', { rig: 'gltf', parts: [], atlas: 'builtin', scale: 1, gltf: { url: MODEL, rig: 'humanoid', joints: JOINTS, poses: STYLE } }, { root, hand, rig }, state);
    // What a held model hangs from, on the hand as the engine puts it there: the kit takes it from
    // there. (Every figure has one, empty-handed or not, as it had a holder before the kit: the
    // frozen random numbers, a fall's direction, come out as they always have.)
    const mount = new THREE.Object3D();
    hand.add(mount);
    if (pose.gun) {
      const g = guns.get(pose.gun)!.clone(true);
      g.traverse((o) => ((o as THREE.Mesh).isMesh ? ((o as THREE.Mesh).castShadow = true) : null));
      const points = Object.fromEntries((['grip', 'grip2', 'muzzle', 'sight', 'mag'] as const).flatMap((n) => (g.getObjectByName(n) ? [[n, g.getObjectByName(n)!.position.clone()]] : [])));
      const bounds = new THREE.Box3().setFromObject(g);
      const kind = KIND ?? (pose.gun === 'katana' && !ITEM ? 'melee' : 'gun');
      const def = { kind, name: pose.gun, ...(kind === 'gun' ? { hold: { stance: HOLD.stance, gun: { hands: HOLD.hands }, poses: HOLD.poses }, action: HOLD.action } : {}) } as ItemDefinition;
      mount.add(g);
      fig.held = { item: pose.gun, def, node: g, mount, form: 'model', points, bounds, length: bounds.max.z - bounds.min.z };
    }
    const label = document.createElement('span');
    label.textContent = pose.name;
    document.getElementById('labels')!.append(label);
    figures.push({ rig, fig, mount, root, pose, state, label });
  });
  client.figures.all = figures.map((f) => f.fig);
  requestAnimationFrame(frame);
}

const camera = new THREE.PerspectiveCamera(24, innerWidth / innerHeight, 0.1, 100);
function frameCamera(cols: number) {
  const width = cols * 1.35 + 0.6;
  const dist = Math.max(STUDIO ? 5.6 : 4.5, width / 2 / Math.tan(((24 / 2) * Math.PI) / 180) / camera.aspect) * 1.05;
  camera.position.set(0, STUDIO ? 1.25 : 1.35, dist);
  camera.lookAt(0, STUDIO ? 0.98 : 0.95, 0);
}
const start = performance.now();
let time = 0;
function frame() {
  const t = FREEZE ?? (performance.now() - start) / 1000;
  // Step up to `t` in small steps (the rig integrates its stride with the time between frames).
  while (time < t) {
    time = Math.min(t, time + 1 / 60);
    for (const f of figures) {
      Object.assign(f.state, base(), f.pose.state(time), { time });
      if (f.state.dying) f.state.time = time;
    }
    // The kit poses them; the engine's rig puts each pose onto its model, its clips over that.
    kit.frame!(client as unknown as Client, 1 / 60);
    for (const f of figures) f.rig.apply(f.state.time, f.mount);
  }
  renderer.render(scene, camera);
  for (const f of figures) {
    const p = f.root.getWorldPosition(new THREE.Vector3()).setY(2.1).project(camera);
    f.label.style.left = `${((p.x + 1) / 2) * innerWidth}px`;
    f.label.style.top = `${((1 - p.y) / 2) * innerHeight}px`;
  }
  if (FREEZE === null) requestAnimationFrame(frame);
}
main();
