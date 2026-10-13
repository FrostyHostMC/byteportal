import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { BONES, JOINTS, JOINT_PARENT, buildCharacter, type CharacterJoint, type CharacterMesh } from '../character/build';
import { characterLook, type CharacterLook } from '../character/look';

/**
 * A character's model (`Models.character`, a player's avatar), built on this screen from its look
 * as if it were a glTF file of Call of Blocky's fighters: the rig's joints as nodes under a root,
 * one mesh skinned rigidly on them, one material (its palette atlas, metallic-roughness and
 * emissive maps). Null for an address that isn't a character's.
 */
export function characterModel(url: string): GLTF | null {
  const look = characterLook(url);
  return look ? characterScene(buildCharacter(look)).gltf : null;
}

/** A look built into a scene (the locker's preview): the root, its mesh, its joints by name. */
export function characterScene(m: CharacterMesh): { gltf: GLTF; root: THREE.Group; mesh: THREE.SkinnedMesh; nodes: Record<CharacterJoint, THREE.Object3D> } {
  const root = new THREE.Group();
  root.name = 'character';
  // Where it wears things, as built (the rig reads it: `HumanoidRig.wearFrame`).
  root.userData.wear = m.wear;
  const nodes = {} as Record<CharacterJoint, THREE.Object3D>;
  for (const j of JOINTS) {
    const parent = JOINT_PARENT[j];
    const node = j === 'gripL' || j === 'gripR' ? new THREE.Object3D() : new THREE.Bone();
    node.name = j;
    const at = m.joints[j];
    const from = parent ? m.joints[parent] : [0, 0, 0];
    node.position.set(at[0] - from[0], at[1] - from[1], at[2] - from[2]);
    (parent ? nodes[parent] : root).add(node);
    nodes[j] = node;
  }
  const geometry = new THREE.BufferGeometry();
  const count = m.position.length / 3;
  const index = new Uint16Array(count * 4);
  const weight = new Float32Array(count * 4);
  for (let v = 0; v < count; v++) {
    index[v * 4] = m.bone[v];
    weight[v * 4] = 1;
  }
  geometry.setAttribute('position', new THREE.BufferAttribute(m.position, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(m.normal, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(m.uv, 2));
  geometry.setAttribute('skinIndex', new THREE.BufferAttribute(index, 4));
  geometry.setAttribute('skinWeight', new THREE.BufferAttribute(weight, 4));
  geometry.setIndex(new THREE.BufferAttribute(count < 65536 ? new Uint16Array(m.index) : m.index, 1));
  geometry.computeBoundingSphere();
  const { width, height } = m.atlas;
  const texture = (data: Uint8Array, srgb: boolean) => {
    const t = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.UnsignedByteType);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.flipY = false;
    t.needsUpdate = true;
    return t;
  };
  const mr = texture(m.atlas.mr, false);
  const material = new THREE.MeshStandardMaterial({ map: texture(m.atlas.albedo, true), roughnessMap: mr, metalnessMap: mr, roughness: 1, metalness: 1, emissiveMap: m.glows ? texture(m.atlas.glow, true) : null });
  const mesh = new THREE.SkinnedMesh(geometry, material);
  mesh.name = 'body';
  root.add(mesh);
  root.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(BONES.map((b) => nodes[b] as THREE.Bone)));
  const gltf = { scene: root, scenes: [root], animations: [], cameras: [], asset: { version: '2.0', generator: 'Blockyard characters' }, parser: null, userData: {} } as unknown as GLTF;
  return { gltf, root, mesh, nodes };
}

export type { CharacterLook };
