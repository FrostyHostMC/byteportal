import * as THREE from 'three';
import type { BlockDef } from '../world/registry';
import { DEFAULT_TINT } from '../world/registry';
import { itemFaces } from './blockmodel';
import { surfaceUniforms } from '../client/gltf';

/**
 * How the first-person layer draws (see `ViewLayer`, `client/api/view.ts`): its own scene and
 * lens over the world, and its materials. Everything in it is lit by one light, the probe at the
 * player's eyes, with a key light from the upper right; its depth is squeezed into the nearest
 * hundredth of the depth buffer, so it's never inside a wall.
 *
 * - Blocks: a cube's faces from the block texture array by face (or a block model's own faces),
 *   tinted as the world tints them.
 * - Everything else (items, models, arms): a texture, and how it shines (glTF's metallic-roughness).
 * - Sprites (a muzzle flash): unlit, over the rest.
 */

const DEPTH = 'gl_Position.z = (gl_Position.z + gl_Position.w) * 0.01 - gl_Position.w;';

const blockVert = /* glsl */ `
precision highp float;
in vec3 position;
in vec3 normal;
in vec2 uv;
in float face;
in float layer;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform mat3 normalMatrix;
out vec2 vUv;
out float vShade;
flat out int vFace;
flat out float vLayer;
void main() {
  vUv = uv;
  vFace = int(face + 0.5);
  vLayer = layer;
  vec3 n = normalize(normalMatrix * normal);
  vShade = 0.55 + 0.45 * clamp(dot(n, normalize(vec3(0.35, 0.9, 0.45))), 0.0, 1.0);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  ${DEPTH}
}`;

const blockFrag = /* glsl */ `
precision highp float;
precision highp sampler2DArray;
uniform sampler2DArray uAlbedo;
uniform sampler2DArray uMaterial;
uniform float uLayers[6];
uniform vec3 uTint;
uniform float uTintMode;   // 0 none, 1 alpha mask (grass block), 2 full (foliage)
uniform float uCutout;
uniform vec3 uLight;
in vec2 vUv;
in float vShade;
flat in int vFace;
flat in float vLayer;
layout(location = 0) out vec4 fragColor;
void main() {
  // A block model's faces carry their own texture; a cube's come from uLayers by face.
  float layer = vLayer >= 0.0 ? vLayer : uLayers[vFace];
  // A model's faces show part of one tile, which needn't tile: keep off its far edge.
  vec2 uv = vLayer >= 0.0 ? clamp(vec2(vUv.x, 1.0 - vUv.y), 1.0 / 64.0, 1.0 - 1.0 / 64.0) : vec2(vUv.x, 1.0 - vUv.y);
  vec4 a = texture(uAlbedo, vec3(uv, layer));
  if (uCutout > 0.5 && a.a < 0.5) discard;
  vec3 base = a.rgb;
  if (uTintMode > 1.5) base *= uTint;
  else if (uTintMode > 0.5) base = mix(base, base * uTint, 1.0 - a.a);
  float emissive = texture(uMaterial, vec3(uv, layer)).a;
  vec3 c = base * uLight * vShade + base * emissive * 3.0;
  fragColor = vec4(c, 1.0);
}`;

const spriteVert = /* glsl */ `
precision highp float;
in vec3 position;
in vec3 normal;
in vec2 uv;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform mat3 normalMatrix;
out vec2 vUv;
out float vShade;
out vec3 vView;
out vec3 vN;
void main() {
  vUv = uv;
  vec3 n = normalize(normalMatrix * normal);
  // Key light from the upper right, soft fill from the camera.
  float key = clamp(dot(n, normalize(vec3(0.45, 0.85, 0.35))), 0.0, 1.0);
  float fill = clamp(n.z, 0.0, 1.0);
  vShade = 0.42 + 0.45 * key + 0.18 * fill;
  vec4 viewPos = modelViewMatrix * vec4(position, 1.0);
  vView = viewPos.xyz;
  vN = n;
  gl_Position = projectionMatrix * viewPos;
  ${DEPTH}
}`;

const spriteFrag = /* glsl */ `
precision highp float;
uniform sampler2D uAtlas;
uniform sampler2D uEmissive;
uniform sampler2D uMaterialMap; // glTF metallic-roughness: G roughness, B metalness
uniform vec2 uMaterial;         // metalness and roughness factors
uniform vec3 uLight;
in vec2 vUv;
in float vShade;
in vec3 vView;
in vec3 vN;
layout(location = 0) out vec4 fragColor;
const float PI = 3.14159265;
void main() {
  vec4 a = texture(uAtlas, vUv);
  if (a.a < 0.5) discard;
  vec4 mr = texture(uMaterialMap, vUv);
  float metal = clamp(uMaterial.x * mr.b, 0.0, 1.0);
  float rough = clamp(uMaterial.y * mr.g, 0.06, 1.0);
  vec3 c = a.rgb * (1.0 - metal) * uLight * vShade;
  if (metal > 0.001 || rough < 0.97) {
    // The same key light shining off it, and a studio's bright top and dark floor in it.
    vec3 N = normalize(gl_FrontFacing ? vN : -vN);
    vec3 V = normalize(-vView);
    vec3 L = normalize(vec3(0.45, 0.85, 0.35));
    vec3 H = normalize(L + V);
    float NoV = max(dot(N, V), 1e-3);
    float NoL = max(dot(N, L), 0.0);
    float NoH = max(dot(N, H), 0.0);
    float al = rough * rough;
    float a2 = al * al;
    float d = (NoH * a2 - NoH) * NoH + 1.0;
    float D = a2 / (PI * d * d + 1e-7);
    float Vis = 0.5 / (NoL * sqrt(NoV * NoV * (1.0 - a2) + a2) + NoV * sqrt(NoL * NoL * (1.0 - a2) + a2) + 1e-5);
    vec3 F0 = mix(vec3(0.04), a.rgb, metal);
    vec3 F = F0 + (1.0 - F0) * pow(1.0 - max(dot(V, H), 0.0), 5.0);
    c += uLight * 1.4 * D * Vis * F * NoL;
    vec3 R = reflect(-V, N);
    float up = smoothstep(-0.35, 0.65, R.y);
    vec3 env = uLight * mix(mix(0.12, 1.25, up), 0.55, rough);
    vec3 Fv = F0 + (max(vec3(1.0 - rough), F0) - F0) * pow(1.0 - NoV, 5.0);
    c += env * Fv * mix(1.0, 0.4, rough);
  }
  fragColor = vec4(c + a.rgb * texture(uEmissive, vUv).r * 3.0, 1.0);
}`;

const srgb = (c: number) => Math.pow(c, 2.2);

/**
 * The first-person layer's scene, lens, light and materials. The materials are made once, in a
 * fixed order (three.js draws opaque things material by material, in the order they were made),
 * and shared: what's drawn with one sets its textures as it's drawn (`bindSprite`, `bindBlock`).
 */
export class ViewScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(70, 1, 0.02, 10);
  /** The light at the player's eyes (every material's `uLight`). */
  readonly light = new THREE.Vector3(1, 1, 1);
  /** Blocks (a cube's faces), blocks drawn flat (plants: both sides), items and models, arms. */
  readonly blockMaterial: THREE.RawShaderMaterial;
  readonly crossMaterial: THREE.RawShaderMaterial;
  readonly itemMaterial: THREE.RawShaderMaterial;
  readonly armMaterial: THREE.RawShaderMaterial;
  /** A held block's cube (its faces' texture layers by face) and a plant's square. */
  readonly cubeGeometry: THREE.BufferGeometry;
  readonly crossGeometry: THREE.BufferGeometry;
  /** Block models' geometry (slabs, stairs, beds), by block id. */
  private models = new Map<number, THREE.BufferGeometry>();

  constructor(albedo: THREE.Texture, material: THREE.Texture) {
    const blockUniforms = {
      uAlbedo: { value: albedo },
      uMaterial: { value: material },
      uLayers: { value: [0, 0, 0, 0, 0, 0] },
      uTint: { value: new THREE.Vector3(...DEFAULT_TINT.map(srgb)) },
      uTintMode: { value: 0 },
      uCutout: { value: 0 },
      uLight: { value: this.light },
    };
    const blockMaterial = (side: THREE.Side) =>
      new THREE.RawShaderMaterial({ vertexShader: blockVert, fragmentShader: blockFrag, glslVersion: THREE.GLSL3, side, uniforms: blockUniforms });
    this.blockMaterial = blockMaterial(THREE.FrontSide);
    const box = (this.cubeGeometry = new THREE.BoxGeometry(1, 1, 1));
    box.setAttribute('face', new THREE.BufferAttribute(new Float32Array(Array.from({ length: 24 }, (_, i) => Math.floor(i / 4))), 1));
    box.setAttribute('layer', new THREE.BufferAttribute(new Float32Array(24).fill(-1), 1));
    const plane = (this.crossGeometry = new THREE.PlaneGeometry(1, 1));
    plane.setAttribute('face', new THREE.BufferAttribute(new Float32Array(4), 1));
    plane.setAttribute('layer', new THREE.BufferAttribute(new Float32Array(4).fill(-1), 1));
    this.crossMaterial = blockMaterial(THREE.DoubleSide);
    this.itemMaterial = this.litMaterial(THREE.DoubleSide);
    this.armMaterial = this.litMaterial(THREE.FrontSide);
  }

  /** A textured material lit by the probe (items both sides, arms front only). */
  litMaterial(side: THREE.Side): THREE.RawShaderMaterial {
    return new THREE.RawShaderMaterial({
      vertexShader: spriteVert,
      fragmentShader: spriteFrag,
      glslVersion: THREE.GLSL3,
      side,
      uniforms: { uAtlas: { value: null }, uEmissive: { value: null }, ...surfaceUniforms(), uLight: { value: this.light } },
    });
  }

  /** The block material's uniforms for a block (its faces' layers, how it's tinted, cut out). */
  bindBlock(def: BlockDef) {
    const u = this.blockMaterial.uniforms;
    (u.uLayers.value as number[]).splice(0, 6, ...def.tex);
    u.uTintMode.value = def.tint ? (def.layer === 0 ? 1 : 2) : 0;
    u.uCutout.value = def.layer === 1 ? 1 : 0;
  }

  /** The light drifts toward the probe's. */
  setLight(c: THREE.Vector3) {
    this.light.lerp(c, 0.2);
  }

  /** A block model (slab, stairs, a whole bed) as geometry the size a held cube is, centred like it. */
  blockGeometry(def: BlockDef, partner?: BlockDef): THREE.BufferGeometry {
    const cached = this.models.get(def.id);
    if (cached) return cached;
    const faces = itemFaces(def, partner);
    const pos: number[] = [];
    const nrm: number[] = [];
    const uv: number[] = [];
    const layer: number[] = [];
    const index: number[] = [];
    // A bed is two blocks long: shrink it to a block's length.
    const zs = faces.flatMap((f) => f.corners.map((c) => c[2]));
    const [z0, z1] = [Math.min(...zs), Math.max(...zs)];
    const k = 1 / Math.max(1, z1 - z0);
    const zc = (z0 + z1) / 2;
    for (const f of faces) {
      const base = pos.length / 3;
      f.corners.forEach((c, i) => {
        pos.push((c[0] - 0.5) * k, (c[1] - 0.5) * k, (c[2] - zc) * k);
        nrm.push(...f.normal);
        uv.push(...f.uv[i]);
        layer.push(f.layer);
      });
      index.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('face', new THREE.Float32BufferAttribute(new Float32Array(layer.length), 1));
    g.setAttribute('layer', new THREE.Float32BufferAttribute(layer, 1));
    g.setIndex(index);
    this.models.set(def.id, g);
    return g;
  }
}

let flashTex: THREE.Texture | null = null;

/** A muzzle flash: a hot core with spikes, white to orange (drawn additively). */
export function flashTexture(): THREE.Texture {
  if (flashTex) return flashTex;
  const n = 64;
  const px = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const dx = (x + 0.5) / n - 0.5;
      const dy = (y + 0.5) / n - 0.5;
      const r = Math.hypot(dx, dy) * 2;
      const a = Math.atan2(dy, dx);
      const spikes = Math.pow(Math.max(0, Math.cos(a * 4)), 18) * Math.max(0, 1 - r) * 1.2 + Math.pow(Math.max(0, Math.cos(a * 4 + Math.PI / 4)), 30) * Math.max(0, 1 - r * 1.3);
      const core = Math.pow(Math.max(0, 1 - r * 1.9), 1.6);
      const v = Math.min(1, core + spikes);
      const i = (y * n + x) * 4;
      px[i] = 255 * Math.min(1, v * 1.2);
      px[i + 1] = 255 * Math.min(1, v * (0.55 + core * 0.45));
      px[i + 2] = 255 * Math.min(1, v * core * 0.9);
      px[i + 3] = 255 * v;
    }
  const t = new THREE.DataTexture(px, n, n, THREE.RGBAFormat);
  t.needsUpdate = true;
  flashTex = t;
  return t;
}
