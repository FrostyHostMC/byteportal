/**
 * Development: glTF models side by side in a product shot's light (a soft room's reflections, a
 * soft key light, a grey backdrop), as three.js draws them (MeshStandardMaterial).
 * `/tools/models.html?models=<url>,<url>&view=34|side|front|back|top&size=<metres>&markers=1&labels=1`
 * - `size`: each model scaled so its longest side is this (default: as it comes, 1 unit = 1 m).
 * - `markers=1`: the models' empty nodes (a gun's `grip`, `grip2`, `muzzle`, `sight`, `mag`) as dots.
 * - `yaw=<radians>` turns every model; `gap=<metres>` between them.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

const q = new URLSearchParams(location.search);
const URLS = (q.get('models') ?? '').split(',').filter(Boolean);
const VIEW = q.get('view') ?? '34';
const SIZE = q.has('size') ? Number(q.get('size')) : null;
const GAP = Number(q.get('gap') ?? 0.25);
const YAW = q.has('yaw') ? Number(q.get('yaw')) : VIEW === 'side' ? -Math.PI / 2 : VIEW === 'back' ? Math.PI : VIEW === '34' ? -0.6 : 0;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.body.append(renderer.domElement);
const grey = 0x8b8d93;
const scene = new THREE.Scene();
scene.background = new THREE.Color(grey);
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.75;
scene.add(new THREE.HemisphereLight(0xcfe3ff, 0x4a3b30, 0.35));
const sun = new THREE.DirectionalLight(0xfff1dc, 1.6);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
sun.shadow.radius = 6;
scene.add(sun, sun.target);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: 0x9a9ca2, roughness: 0.75 }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);
const camera = new THREE.PerspectiveCamera(24, innerWidth / innerHeight, 0.01, 500);

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);

async function main() {
  const models = await Promise.all(URLS.map((u) => loader.loadAsync(u)));
  let x = 0;
  const all = new THREE.Box3();
  const placed: { root: THREE.Object3D; url: string }[] = [];
  for (const [i, g] of models.entries()) {
    const root = new THREE.Group();
    const m = g.scene;
    m.rotation.y = YAW;
    root.add(m);
    m.updateMatrixWorld(true);
    let box = new THREE.Box3().setFromObject(m);
    if (SIZE) {
      const s = box.getSize(new THREE.Vector3());
      m.scale.setScalar(SIZE / Math.max(s.x, s.y, s.z));
      m.updateMatrixWorld(true);
      box = new THREE.Box3().setFromObject(m);
    }
    // Stand it on the floor, next along.
    m.position.x += x - box.min.x;
    m.position.y -= box.min.y;
    m.position.z -= (box.min.z + box.max.z) / 2;
    x += box.max.x - box.min.x + GAP;
    m.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.frustumCulled = false;
        if (!mesh.geometry.getAttribute('normal')) mesh.geometry.computeVertexNormals();
      } else if (q.get('markers') === '1' && !o.children.length && o !== m && o.parent) {
        const dot = new THREE.Mesh(new THREE.SphereGeometry(0.012 * (SIZE ?? 1)), new THREE.MeshBasicMaterial({ color: o.name === 'sight' ? 0x00ff66 : o.name === 'muzzle' ? 0xff3322 : 0x33aaff, depthTest: false }));
        dot.renderOrder = 10;
        o.add(dot);
      }
    });
    scene.add(root);
    root.updateMatrixWorld(true);
    all.union(new THREE.Box3().setFromObject(root));
    placed.push({ root, url: URLS[i] });
  }
  const centre = all.getCenter(new THREE.Vector3());
  const size = all.getSize(new THREE.Vector3());
  const r = Math.max(size.x / camera.aspect, size.y) * 0.62 + 0.02;
  const dist = r / Math.tan((12 * Math.PI) / 180);
  const dir = VIEW === 'top' ? new THREE.Vector3(0, 1, 0.02) : new THREE.Vector3(0, 0.22, 1);
  camera.position.copy(centre).addScaledVector(dir.normalize(), dist);
  camera.lookAt(centre);
  camera.far = dist * 4;
  camera.updateProjectionMatrix();
  sun.position.copy(centre).add(new THREE.Vector3(-0.4, 1, 0.6).multiplyScalar(dist));
  sun.target.position.copy(centre);
  const sc = sun.shadow.camera as THREE.OrthographicCamera;
  const half = Math.max(size.x, size.y, size.z) * 0.8 + 0.2;
  Object.assign(sc, { left: -half, right: half, top: half, bottom: -half, near: 0.1, far: dist * 3 });
  sc.updateProjectionMatrix();
  renderer.render(scene, camera);
  if (q.get('labels') === '1')
    for (const p of placed) {
      const b = new THREE.Box3().setFromObject(p.root);
      const at = new THREE.Vector3((b.min.x + b.max.x) / 2, b.max.y, (b.min.z + b.max.z) / 2).project(camera);
      const label = document.createElement('span');
      label.textContent = p.url.split('/').pop()!.replace('.glb', '');
      label.style.left = `${((at.x + 1) / 2) * innerWidth}px`;
      label.style.top = `${((1 - at.y) / 2) * innerHeight - 22}px`;
      document.getElementById('labels')!.append(label);
    }
  (window as unknown as { __ready: boolean }).__ready = true;
}
main();
