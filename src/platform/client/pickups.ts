import * as THREE from 'three';
import type { Content } from '../content';
import type { EntityGraphics } from '../render/entities';
import type { Surface } from './gltf';
import { Shaders } from '../render/shaders';
import type { PickupFrame } from '../sim/items';

function fxMaterial(color: string, mode: number, intensity: number) {
  return new THREE.RawShaderMaterial({
    vertexShader: Shaders.fx.vertex,
    fragmentShader: Shaders.fx.fragment,
    glslVersion: THREE.GLSL3,
    uniforms: { uColor: { value: new THREE.Color(color) }, uIntensity: { value: intensity }, uTime: { value: 0 }, uMode: { value: mode } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

interface Shown {
  group: THREE.Object3D;
  fx: THREE.Object3D[];
  dispose: (() => void) | null;
}

export interface PickupViewParts {
  graphics: EntityGraphics;
  scene: THREE.Scene;
  fxScene: THREE.Scene;
  content: Content;
  /** A small lit cube of a block, placed in the scene (items that look like blocks). */
  blockModel(block: string, size: number): { object: THREE.Object3D; remove(): void };
}

/** Draws the simulation's pickups: spinning, bobbing items with a glow on the ground (and a beam if asked). */
export class PickupView {
  private shown = new Map<number, Shown>();
  private materials = new Map<THREE.Texture, THREE.RawShaderMaterial>();
  private beamGeo = new THREE.PlaneGeometry(0.9, 7).translate(0, 3.5, 0);
  private haloGeo = new THREE.PlaneGeometry(1.6, 1.6).rotateX(-Math.PI / 2);
  private time = 0;

  constructor(private p: PickupViewParts) {}

  private materialFor(albedo: THREE.Texture, emissive: THREE.Texture, surface?: Surface): THREE.RawShaderMaterial {
    let m = this.materials.get(albedo);
    if (!m) {
      m = this.p.graphics.materialFor(albedo, emissive, surface);
      this.materials.set(albedo, m);
    }
    return m;
  }

  private make(f: PickupFrame): Shown | null {
    const def = this.p.content.items.get(f.item);
    if (!def) return null;
    let group: THREE.Object3D;
    let dispose: (() => void) | null = null;
    const icon = def.icon;
    if (typeof icon === 'object' && 'block' in icon) {
      // Items that look like a block drop as little cubes of it.
      const cube = this.p.blockModel(icon.block, 0.3);
      group = cube.object;
      dispose = cube.remove;
    } else {
      // Its model or its sprite, as in the hand (a model whose file is still coming: later).
      const look = this.p.graphics.itemLook(def);
      if (!look) return null;
      const mesh = new THREE.Mesh(look.geometry, this.materialFor(look.albedo, look.emissive, look.surface));
      mesh.customDepthMaterial = this.p.graphics.gltf.shadow(look.albedo);
      if (look.model) {
        // A held model lies along +z: stood up, centred, about a sprite's size.
        look.geometry.computeBoundingSphere();
        const r = look.geometry.boundingSphere!;
        mesh.scale.setScalar(0.45 / Math.max(0.2, r.radius));
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.copy(r.center).multiplyScalar(-mesh.scale.x).applyEuler(mesh.rotation);
      } else mesh.scale.setScalar(0.62);
      group = new THREE.Group();
      group.add(mesh);
      this.p.scene.add(group);
    }
    const fx: THREE.Object3D[] = [];
    const halo = new THREE.Mesh(this.haloGeo, fxMaterial(f.beam ?? '#fff3c4', 2, f.beam ? 1.6 : 0.6));
    halo.frustumCulled = false;
    this.p.fxScene.add(halo);
    fx.push(halo);
    if (f.beam) {
      for (let k = 0; k < 2; k++) {
        const beam = new THREE.Mesh(this.beamGeo, fxMaterial(f.beam, 0, 1.3));
        beam.rotation.y = k * Math.PI * 0.5;
        beam.frustumCulled = false;
        this.p.fxScene.add(beam);
        fx.push(beam);
      }
    }
    return { group, fx, dispose };
  }

  private drop(v: Shown) {
    if (v.dispose) v.dispose();
    else v.group.removeFromParent();
    for (const f of v.fx) {
      f.removeFromParent();
      ((f as THREE.Mesh).material as THREE.Material).dispose();
    }
  }

  sync(frames: PickupFrame[], dt: number) {
    this.time += dt;
    const seen = new Set<number>();
    for (const f of frames) {
      seen.add(f.id);
      let v = this.shown.get(f.id);
      if (!v) {
        const made = this.make(f);
        if (!made) continue;
        v = made;
        this.shown.set(f.id, v);
      }
      const bob = f.settled ? Math.sin(this.time * 2.5 + f.id) * 0.1 : 0;
      v.group.position.set(f.x, f.y + bob, f.z);
      v.group.rotation.y = this.time * 1.8 + f.id;
      for (const o of v.fx) {
        o.position.set(f.x, f.y - 0.28, f.z);
        ((o as THREE.Mesh).material as THREE.RawShaderMaterial).uniforms.uTime.value = this.time;
      }
    }
    for (const [id, v] of this.shown) {
      if (seen.has(id)) continue;
      this.drop(v);
      this.shown.delete(id);
    }
  }

  clear() {
    for (const v of this.shown.values()) this.drop(v);
    this.shown.clear();
  }
}
