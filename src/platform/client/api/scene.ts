import * as THREE from 'three';
import type { ClientScene, Node } from '../../api/client/core';
import type { ItemDefinition } from '../../api/types';
import type { EntityGraphics } from '../../render/entities';
import { bladeOn } from '../../render/blade';

/** `client.scene`: things this screen puts in the world itself (in the figures' scene, lit and shadowed as they are). */
export class SceneService implements ClientScene {
  /** One material per item texture. */
  private materials = new Map<THREE.Texture, THREE.RawShaderMaterial>();

  constructor(
    private scene: THREE.Scene,
    private graphics: EntityGraphics,
    private items: Map<string, ItemDefinition>,
  ) {}

  node(): Node {
    return new THREE.Group();
  }

  add(node: Node) {
    this.scene.add(node as THREE.Object3D);
  }

  remove(node: Node) {
    this.scene.remove(node as THREE.Object3D);
  }

  item(id: string): { node: Node; center: { x: number; y: number; z: number }; form: 'model' | 'sprite' } | null {
    const def = this.items.get(id);
    if (!def) return null;
    const look = this.graphics.itemLook(def);
    if (!look) return null;
    let m = this.materials.get(look.albedo);
    if (!m) {
      m = this.graphics.materialFor(look.albedo, look.emissive, look.surface);
      this.materials.set(look.albedo, m);
    }
    const mesh = new THREE.Mesh(look.geometry, m);
    mesh.customDepthMaterial = this.graphics.gltf.shadow(look.albedo);
    // (Its blade goes with it: when the node's taken out of the scene, the blade's drawn no more.)
    bladeOn(mesh, def.hold?.blade, look.points);
    look.geometry.computeBoundingSphere();
    const c = look.geometry.boundingSphere!.center;
    return { node: mesh, center: { x: c.x, y: c.y, z: c.z }, form: look.model ? 'model' : 'sprite' };
  }
}
