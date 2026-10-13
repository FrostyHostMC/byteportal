import { readFileSync, statSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { Models } from '../../src/platform';
import { humanoid } from '../../src/platform/client-kits/figures';
import { partsOf, ShownFigure } from '../../src/platform/client/figures';
import { GltfFigure, GltfLibrary } from '../../src/platform/client/gltf';
import { HumanoidRig } from '../../src/platform/client/humanoid';
import type { AnimState } from '../../src/platform/render/entities';
import type { SharedUniforms } from '../../src/platform/render/pipeline';
import { clientOf } from './_figures';
import { check } from './_harness';

const DIR = 'src/games/callofblocky/models/';
const FIGHTERS = ['hitman', 'partner', 'bride', 'wife', 'bowler', 'crooner', 'boxer', 'kahuna', 'waitress', 'boss'];
const GUNS: Record<string, string[]> = {
  pistol: ['grip', 'grip2', 'muzzle', 'sight', 'mag'],
  smg: ['grip', 'grip2', 'muzzle', 'sight', 'mag'],
  rifle: ['grip', 'grip2', 'muzzle', 'sight', 'mag'],
  famas: ['grip', 'grip2', 'muzzle', 'sight', 'mag'],
  shotgun: ['grip', 'grip2', 'muzzle', 'sight', 'mag'],
  sniper: ['grip', 'grip2', 'muzzle', 'sight', 'mag'],
  tommy: ['grip', 'grip2', 'muzzle', 'sight', 'mag'],
  lmg: ['grip', 'grip2', 'muzzle', 'sight', 'mag'],
  marksman: ['grip', 'grip2', 'muzzle', 'sight', 'mag'],
  sawnoff: ['grip', 'grip2', 'muzzle', 'sight', 'mag'],
  revolver: ['grip', 'grip2', 'muzzle', 'sight', 'mag'],
  katana: ['grip', 'grip2', 'muzzle'],
  briefcase: [],
  ammo: [],
  frag: ['grip'],
  molotov: ['grip'],
};

/** A GLB as the platform's loader reads it (meshopt decoded), its images left out (Node can't decode them). */
async function load(file: string): Promise<GLTF> {
  const b = readFileSync(file);
  const jlen = b.readUInt32LE(12);
  const json = JSON.parse(b.subarray(20, 20 + jlen).toString());
  for (const m of json.materials ?? []) for (const k of ['baseColorTexture', 'metallicRoughnessTexture']) delete m.pbrMetallicRoughness?.[k];
  for (const m of json.materials ?? []) delete m.emissiveTexture;
  delete json.textures;
  delete json.images;
  delete json.samplers;
  let j = Buffer.from(JSON.stringify(json));
  j = Buffer.concat([j, Buffer.alloc((4 - (j.length % 4)) % 4, 0x20)]);
  const rest = b.subarray(20 + jlen);
  const head = Buffer.alloc(20);
  head.writeUInt32LE(0x46546c67, 0);
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(20 + j.length + rest.length, 8);
  head.writeUInt32LE(j.length, 12);
  head.writeUInt32LE(0x4e4f534a, 16);
  const out = Buffer.concat([head, j, rest]);
  return new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength), '');
}

const still = (): AnimState => ({ walkPhase: 0, walkAmount: 0, pace: 0, attackT: 9, raised: false, casting: false, headYaw: 0, headPitch: 0, dying: 0, time: 0, aim: 0, posture: 0, speed: 0, moveX: 0, moveZ: 1, sights: 0, shotT: 9 });

/**
 * Call of Blocky's voxel models load through the platform: each fighter one skinned mesh (voxel
 * coordinates in bytes, meshopt compressed) drawn with one skinned material, culled by where its
 * bones put it, a humanoid the rig moves, its first-person arms cut from the skin; each weapon one
 * mesh with its markers, held as the platform holds a model.
 */
export default async function cobmodels() {
  await MeshoptDecoder.ready;
  const lib = new GltfLibrary({} as SharedUniforms);
  for (const id of FIGHTERS) {
    const file = `${DIR}fighters/${id}.glb`;
    const gltf = await load(file);
    const skins: THREE.SkinnedMesh[] = [];
    gltf.scene.traverse((o) => (o as THREE.Mesh).isMesh && skins.push(o as THREE.SkinnedMesh));
    const sm = skins[0];
    check(skins.length === 1 && sm.isSkinnedMesh && sm.skeleton.bones.length === 17, `${id}: one skinned mesh on the rig's 17 bones`);
    const tris = (sm.geometry.index?.count ?? 0) / 3;
    check(tris > 3000 && tris <= 25000 && statSync(file).size <= 300 * 1024, `${id}: ${tris} triangles, ${(statSync(file).size / 1024).toFixed(0)} KB`);
    check(HumanoidRig.fits(gltf.scene), `${id}: a humanoid`);
    // As the game draws it: one skinned material, culled round the figure where it stands.
    lib.adopt(`/${id}.glb`, gltf);
    const fig = new GltfFigure(gltf, { url: `/${id}.glb`, rig: 'humanoid' }, 1, lib);
    const meshes: THREE.SkinnedMesh[] = [];
    fig.root.traverse((o) => (o as THREE.Mesh).isMesh && meshes.push(o as THREE.SkinnedMesh));
    const mat = meshes[0].material as THREE.RawShaderMaterial;
    const sphere = meshes[0].boundingSphere!;
    check(meshes.length === 1 && mat.defines?.SKINNED === 1, `${id}: drawn with one skinned material`);
    check(sphere.center.y > 0.7 && sphere.center.y < 1.2 && sphere.radius > 1.7, `${id}: culled by its bounds at rest (${sphere.center.y.toFixed(2)} up, ${sphere.radius.toFixed(2)} round)`);
    meshes[0].computeBoundingBox();
    const box = meshes[0].boundingBox!;
    check(box.min.y > -0.01 && box.min.y < 0.01 && box.max.y > 1.8 && box.max.y < 2.05, `${id}: standing on the ground, ${box.max.y.toFixed(2)} m tall`);
    // The figures kit poses it: crouched, the head comes down.
    const s = still();
    const kit = humanoid();
    const client = clientOf([new ShownFigure(1, null, id, Models.gltf(`/${id}.glb`, { rig: 'humanoid' }), partsOf(fig), s)]);
    const step = () => {
      kit.frame!(client, 1 / 60);
      fig.animate(s);
    };
    step();
    fig.root.updateMatrixWorld(true);
    const head = fig.pivots.get('head')!.getWorldPosition(new THREE.Vector3()).y;
    for (let i = 1; i <= 30; i++) {
      Object.assign(s, { posture: 1, time: i / 60 });
      step();
    }
    fig.root.updateMatrixWorld(true);
    check(fig.pivots.get('head')!.getWorldPosition(new THREE.Vector3()).y < head - 0.2, `${id}: crouches`);
    fig.dispose();
    // First-person arms, cut from the skin: an upper arm, forearm and fist each side, the grip in the fist.
    const arms = lib.humanoidArms(`/${id}.glb`)!;
    for (const side of ['R', 'L'] as const) {
      const a = arms[side];
      const fist = new THREE.Box3();
      for (const p of a.fist) {
        p.geometry.computeBoundingBox();
        fist.union(p.geometry.boundingBox!);
      }
      check(a.upper.length === 1 && a.forearm.length === 1 && a.fist.length === 1, `${id}: ${side} arm in three pieces, one material each`);
      check(fist.containsPoint(a.grip), `${id}: ${side} fist round its grip`);
    }
  }
  for (const [id, markers] of Object.entries(GUNS)) {
    const gltf = await load(`${DIR}${id}.glb`);
    let meshes = 0;
    gltf.scene.traverse((o) => (meshes += (o as THREE.Mesh).isMesh ? 1 : 0));
    const names = new Set<string>();
    gltf.scene.traverse((o) => names.add(o.name));
    check(meshes === 1 && markers.every((m) => names.has(m)), `${id}: one mesh, markers ${markers.join(', ') || '(none)'}`);
    lib.adopt(`/${id}.glb`, gltf);
    const look = lib.item({ parts: [], gltf: { url: `/${id}.glb` } })!;
    check(look.geometry.getAttribute('position').count > 0 && markers.every((m) => m === 'grip' || !!look.points?.[m as 'grip2']), `${id}: held as a model, its points found`);
    if (markers[0] === 'grip' && id !== 'molotov') check(gltf.scene.getObjectByName('grip')!.position.length() === 0, `${id}: the grip at the origin`);
  }
  lib.dispose();
  console.log('  ten skinned voxel fighters (one mesh, one material, the rig, first-person arms) · nine voxel weapons with their markers');
}
