import * as THREE from 'three';
import type { ClientEvent, Node } from '../../api/client/core';
import type { HeldItem, HumanoidViewArms, ViewArm, ViewArms, ViewCamera, ViewLayer, ViewSpriteOptions } from '../../api/client/view';
import type { FirstPersonArms, HeldModelSpec, ItemDefinition, ViewAnimation } from '../../api/types';
import type { BlockDef } from '../../world/registry';
import { boxGeometry, type EntityGraphics } from '../../render/entities';
import { flashTexture, ViewScene } from '../../render/viewmodel';
import { setSurface, type HumanoidArm, type HumanoidArms, type ItemMesh, type ItemPoint } from '../gltf';
import { heldPoint } from '../held';
import { HELD_SCALE } from '../humanoid';
import { bladeOn, type Blade } from '../../render/blade';

/** The points a held model's spec or file can mark. */
const POINTS: ItemPoint[] = ['grip', 'grip2', 'muzzle', 'sight', 'mag'];
const PX = 1 / 16;

/** What the layer made for a node, to free with it. */
interface Owned {
  geometry: boolean;
  material: boolean;
}

/** What's in hand, loaded: its mesh draws with one of the layer's shared materials, binding its own textures as it's drawn. */
class LoadedItem implements HeldItem {
  readonly node: THREE.Mesh;
  readonly look: object;
  readonly points: Record<string, THREE.Vector3> = {};
  readonly bounds: THREE.Box3;
  /** Its energy blade (`hold.blade`), if it has one. */
  blade: Blade | null = null;
  private alt = false;

  constructor(
    private layer: FirstPersonLayer,
    readonly item: string | null,
    readonly def: ItemDefinition | undefined,
    readonly form: HeldItem['form'],
    readonly model: HeldModelSpec | null,
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    bind: () => void,
    /** The block it is (blocks), to tell the same one held again. */
    readonly block: BlockDef | null = null,
  ) {
    this.node = new THREE.Mesh(geometry, material);
    this.node.frustumCulled = false;
    this.node.onBeforeRender = bind;
    this.look = geometry;
    this.bounds = new THREE.Box3().setFromBufferAttribute(geometry.getAttribute('position') as THREE.BufferAttribute);
  }

  halfWidthAt(z: number): number {
    const pos = this.node.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
    let w = 0;
    if (pos) for (let i = 0; i < pos.count; i++) if (Math.abs(pos.getZ(i) - z) < 1.5 / 16) w = Math.max(w, Math.abs(pos.getX(i)));
    return w > 0 ? w : 1.2 / 16;
  }

  pixel(x: number, y: number, out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(x / 16 - 0.5, 0.5 - y / 16, 0);
  }

  alternate(on: boolean) {
    if (on === this.alt || !this.def) return;
    const look = this.layer.graphics.itemLook(this.def, on);
    if (!look) return;
    this.alt = on;
    this.node.geometry = look.geometry;
  }

  toWorld(p: THREE.Vector3, out = new THREE.Vector3()): THREE.Vector3 {
    return this.layer.inView(this, p, out).applyMatrix4(this.layer.worldCamera.matrixWorld);
  }
}

/** The player's arms: built from their skin, their model's own arm, or a humanoid model's pieces. */
class LayerArms implements ViewArms {
  version = 0;
  skin: { uv: [number, number]; atlas: string } | null = { uv: [0, 0], atlas: 'builtin' };
  humanoid: HumanoidViewArms | null = null;
  /** The player model's own arm (a part of it), in place of the skin's. */
  private look: ItemMesh | null = null;

  constructor(
    private scene: ViewScene,
    private graphics: EntityGraphics,
    private own: (node: THREE.Object3D, what: Owned) => THREE.Object3D,
  ) {}

  get model(): boolean {
    return this.look !== null;
  }

  setSkin(skin: [number, number] | null, atlas = 'builtin') {
    this.skin = skin ? { uv: skin, atlas } : null;
    this.version++;
  }

  /** The player model's own arm (standing along y), or null for the skin's. */
  setModelArm(look: ItemMesh | null) {
    this.look = look;
    this.version++;
  }

  /** A humanoid model's arms (their pieces as meshes, each with materials of its own), or null. */
  setHumanoid(arms: HumanoidArms | null, fit: FirstPersonArms | undefined) {
    if (this.humanoid) {
      for (const side of [this.humanoid.R, this.humanoid.L]) {
        for (const g of [side.upper, side.forearm, side.fist] as THREE.Object3D[]) {
          g.removeFromParent();
          for (const c of g.children) ((c as THREE.Mesh).material as THREE.Material).dispose();
        }
      }
      this.humanoid = null;
    }
    if (arms) {
      const group = (parts: ItemMesh[]) => {
        const g = new THREE.Group();
        for (const part of parts) {
          const mat = this.scene.litMaterial(THREE.FrontSide);
          mat.uniforms.uAtlas.value = part.albedo;
          mat.uniforms.uEmissive.value = part.emissive;
          setSurface(mat.uniforms, part.surface);
          const m = new THREE.Mesh(part.geometry, mat);
          m.frustumCulled = false;
          g.add(m);
        }
        return g;
      };
      const side = (a: HumanoidArm): ViewArm => ({ upper: group(a.upper), forearm: group(a.forearm), fist: group(a.fist), elbow: a.elbow, wrist: a.wrist, grip: a.grip, gripQ: a.gripQ });
      this.humanoid = { R: side(arms.R), L: side(arms.L), fit: fit ?? null, heldScale: HELD_SCALE };
    }
    this.version++;
  }

  arm(opts: { length?: number; mirror?: boolean } = {}): Node | null {
    const u = this.scene.armMaterial.uniforms;
    const look = this.look;
    if (look) {
      // The model's own arm (shared: never ours to free).
      u.uAtlas.value = look.albedo;
      u.uEmissive.value = look.emissive;
      return this.own(new THREE.Mesh(look.geometry, this.scene.armMaterial), { geometry: false, material: false });
    }
    if (!this.skin) return null;
    const a = this.graphics.atlas(this.skin.atlas);
    const [x, y] = this.skin.uv;
    const g = boxGeometry({ name: 'arm', size: [4, opts.length ?? 12, 4], uv: [x + 40, y + 16], pivot: [0, 0, 0], offset: [0, 0, 0], mirror: !!opts.mirror }, a.width, a.height);
    u.uAtlas.value = a.albedo;
    u.uEmissive.value = a.emissive;
    return this.own(new THREE.Mesh(g, this.scene.armMaterial), { geometry: true, material: false });
  }

  box(size: [number, number, number]): Node | null {
    if (!this.skin) return null;
    const a = this.graphics.atlas(this.skin.atlas);
    const [x, y] = this.skin.uv;
    // One texel of the hand (the right arm's front, near the bottom).
    const tu = (x + 45.5) / a.width;
    const tv = (y + 30.5) / a.height;
    const g = new THREE.BoxGeometry(size[0] * PX, size[1] * PX, size[2] * PX);
    const uv = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, tu, tv);
    return this.own(new THREE.Mesh(g, this.scene.armMaterial), { geometry: true, material: false });
  }
}

/**
 * The first-person layer (`client.view`): the engine's part. It loads what's in hand as the
 * runtime says (`holdItem`, `holdBlock`, `holdNothing`), builds the player's arms, draws the layer
 * over the world with its own lens and the light at the player's eyes. Where anything goes is a
 * kit's to say (`firstPerson.standard()`).
 */
export class FirstPersonLayer implements ViewLayer {
  readonly view: ViewScene;
  readonly root: Node;
  readonly camera: ViewCamera;
  readonly arms: LayerArms;
  held: LoadedItem | null = null;
  /** What was in hand lately, newest first (the one on show may be older than `held`, while a kit swaps them). */
  private recent: LoadedItem[] = [];
  private owned = new WeakMap<THREE.Object3D, Owned>();

  constructor(
    albedo: THREE.Texture,
    material: THREE.Texture,
    readonly graphics: EntityGraphics,
    /** The world's camera: the layer's space is its eye's. */
    readonly worldCamera: THREE.Camera,
    readonly animations: ReadonlyMap<string, ViewAnimation>,
    /** Tells the game's client code (`equip`). */
    private emit: (e: ClientEvent) => void,
    /** The items as this screen has them (their looks over the server's definitions), for `item`. */
    private items: ReadonlyMap<string, ItemDefinition>,
  ) {
    this.view = new ViewScene(albedo, material);
    const root = new THREE.Group();
    this.view.scene.add(root);
    this.root = root;
    const cam = this.view.camera;
    this.camera = {
      get fov() {
        return cam.fov;
      },
      set fov(v: number) {
        cam.fov = v;
        cam.updateProjectionMatrix();
      },
      get aspect() {
        return cam.aspect;
      },
    };
    this.arms = new LayerArms(this.view, graphics, (n, what) => {
      this.owned.set(n, what);
      n.frustumCulled = false;
      return n;
    });
  }

  // --- the API ---------------------------------------------------------------------------------

  get visible(): boolean {
    return this.view.scene.visible;
  }

  /** (The runtime's: drawn or not this frame.) */
  set visible(v: boolean) {
    this.view.scene.visible = v;
  }

  node(): Node {
    return new THREE.Group();
  }

  sprite(image: 'flash' | string, opts: ViewSpriteOptions = {}): Node {
    let map: THREE.Texture;
    if (image === 'flash') map = flashTexture();
    else {
      map = new THREE.TextureLoader().load(image);
      map.colorSpace = THREE.SRGBColorSpace;
    }
    const c = opts.color ?? [1, 1, 1];
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map, color: new THREE.Color(c[0], c[1], c[2]), blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending, transparent: true, depthTest: opts.depthTest ?? true, depthWrite: false, side: THREE.DoubleSide }),
    );
    m.visible = false;
    m.frustumCulled = false;
    this.owned.set(m, { geometry: true, material: true });
    return m;
  }

  item(id: string): Node | null {
    const def = this.items.get(id);
    const look = def && this.graphics.itemLook(def);
    if (!look) return null;
    // A material of its own (what's in hand binds the shared one as it's drawn, and two drawn
    // one after the other would share its textures too), lit as the layer's items are.
    const material = this.view.litMaterial(THREE.DoubleSide);
    material.uniforms.uAtlas.value = look.albedo;
    material.uniforms.uEmissive.value = look.emissive;
    setSurface(material.uniforms, look.surface);
    const m = new THREE.Mesh(look.geometry, material);
    m.frustumCulled = false;
    // (Its geometry is the look's, shared: freeing it frees only the material.)
    this.owned.set(m, { geometry: false, material: true });
    return m;
  }

  free(node: Node) {
    const o = node as THREE.Object3D;
    o.removeFromParent();
    const what = this.owned.get(o);
    if (!what) return;
    this.owned.delete(o);
    const m = o as THREE.Mesh;
    if (what.geometry) m.geometry?.dispose();
    if (what.material) (m.material as THREE.Material).dispose();
  }

  worldPoint(name: string, out = new THREE.Vector3()): THREE.Vector3 | null {
    const h = this.onShow();
    const p = h?.points[name];
    return h && p ? h.toWorld(p, out) : null;
  }

  // --- the runtime's ---------------------------------------------------------------------------

  /** The light at the player's eyes (every material's). */
  get light(): THREE.Vector3 {
    return this.view.light;
  }

  setLight(c: THREE.Vector3) {
    this.view.setLight(c);
  }

  /** Each frame: the world camera's shape, and whether the layer's drawn. */
  frame(aspect: number, shown: boolean) {
    this.view.camera.aspect = aspect;
    this.view.camera.updateProjectionMatrix();
    this.view.scene.visible = shown;
  }

  /** Hold an item that looks like a sprite or a model; false while its model's file is still coming. */
  holdItem(item: string, def: ItemDefinition): boolean {
    const look = this.graphics.itemLook(def);
    if (!look) return false;
    const u = this.view.itemMaterial.uniforms;
    const h = new LoadedItem(this, item, def, look.model ? 'model' : 'sprite', look.model ?? null, look.geometry, this.view.itemMaterial, () => {
      u.uAtlas.value = look.albedo;
      u.uEmissive.value = look.emissive;
      setSurface(u, look.surface);
    });
    for (const n of POINTS) {
      const p = heldPoint(look.model, look.points, n);
      if (p) h.points[n] = p;
    }
    h.blade = bladeOn(h.node, def.hold?.blade, look.points);
    this.take(h);
    return true;
  }

  /** Hold a block (`partner`: a bed's head half, to show the bed whole), from an item or the block picker. */
  holdBlock(block: BlockDef | undefined, partner?: BlockDef, item: string | null = null, def?: ItemDefinition) {
    if (!block) return;
    if (this.held?.block === block) return;
    const v = this.view;
    const cross = !!block.small;
    const geometry = cross ? v.crossGeometry : block.parts ? v.blockGeometry(block, partner) : v.cubeGeometry;
    this.take(new LoadedItem(this, item, def, cross ? 'cross' : 'block', null, geometry, cross ? v.crossMaterial : v.blockMaterial, () => v.bindBlock(block), block));
  }

  holdNothing() {
    if (this.held) this.take(null);
  }

  /** The player model's own arm, or null for the skin's. */
  setModelArm(look: ItemMesh | null) {
    this.arms.setModelArm(look);
  }

  /** A humanoid model's arms, fitted by its `firstPerson`; or null. */
  setHumanoidArms(arms: HumanoidArms | null, fit?: FirstPersonArms) {
    this.arms.setHumanoid(arms, fit);
  }

  /** The held item's muzzle, in the layer's (the world camera's) space, as drawn this frame; false without one on show. */
  muzzle(out: THREE.Vector3): boolean {
    const h = this.onShow();
    const p = h?.points.muzzle;
    if (!h || !p) return false;
    this.inView(h, p, out);
    return true;
  }

  /** A point of a held item's own space in the layer's, as drawn this frame. */
  inView(h: LoadedItem, p: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    h.node.updateWorldMatrix(true, false);
    return out.copy(p).applyMatrix4(h.node.matrixWorld);
  }

  private take(h: LoadedItem | null) {
    this.held = h;
    if (h) {
      this.recent.unshift(h);
      for (const gone of this.recent.splice(4)) gone.blade?.dispose();
    }
    this.emit({ t: 'equip', item: h?.item ?? null });
  }

  /** The held item a kit has in the layer (the newest, while it swaps them). */
  private onShow(): LoadedItem | null {
    for (const h of this.recent) {
      let o: THREE.Object3D | null = h.node;
      while (o && o !== this.view.scene) o = o.parent;
      if (o) return h;
    }
    return null;
  }
}
