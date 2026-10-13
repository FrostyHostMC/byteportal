import * as THREE from 'three';
import type { BladeSpec } from '../api/types';

/**
 * An energy blade on a held item (`hold.blade`: a saber's): light, not a solid. Drawn over the
 * item's own blade wherever the item is (in a figure's hand, in first person, thrown):
 *
 * - The blade: a capsule turned to face the camera round its own axis, a white-hot core fading
 *   out through the blade's colour to a soft halo, flickering a little; bright enough to bloom.
 *   Blended so it adds light and still holds its colour against a bright sky.
 * - A trail: where the blade has been over the last moment, a fading sheet of its colour, so a
 *   swing leaves an arc.
 */

const BLADE_VERT = /* glsl */ `
in vec3 position;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform vec3 uBase;
uniform vec3 uTip;
uniform float uRadius;
out vec2 vD;
void main() {
  // position: x across (-1, 1), y along (0 base, 1 tip), z out past an end (-1, 0, 1).
  vec3 a = (modelViewMatrix * vec4(uBase, 1.0)).xyz;
  vec3 b = (modelViewMatrix * vec4(uTip, 1.0)).xyz;
  vec3 p = mix(a, b, position.y);
  vec3 dir = b - a;
  float len = length(dir);
  dir = len > 1e-5 ? dir / len : vec3(0.0, 1.0, 0.0);
  vec3 side = cross(dir, normalize(-p));
  side = length(side) > 1e-4 ? normalize(side) : vec3(1.0, 0.0, 0.0);
  p += side * position.x * uRadius + dir * position.z * uRadius;
  vD = vec2(position.x, position.z);
  gl_Position = projectionMatrix * vec4(p, 1.0);
}`;

const BLADE_FRAG = /* glsl */ `
precision highp float;
uniform vec3 uColor;
uniform float uIntensity;
uniform float uCore;
in vec2 vD;
layout(location = 0) out vec4 fragColor;
void main() {
  float d = length(vD);
  if (d >= 1.0) discard;
  // A white-hot core, the blade's colour close round it, a wide soft haze further out.
  float core = 1.0 - smoothstep(uCore * 0.55, uCore, d);
  float inner = exp(-d * d * 9.0);
  float haze = exp(-d * d * 2.4) * (1.0 - d);
  vec3 c = uColor * (inner * 1.1 + haze * 0.45) * uIntensity + mix(uColor, vec3(1.0), 0.85) * core * uIntensity * 1.8;
  fragColor = vec4(c, clamp(inner * 0.3 + core, 0.0, 1.0));
}`;

const TRAIL_VERT = /* glsl */ `
in vec3 position;
in vec2 uv;
in float strength;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
out vec2 vUv;
out float vStrength;
void main() {
  vUv = uv;
  vStrength = strength;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const TRAIL_FRAG = /* glsl */ `
precision highp float;
uniform vec3 uColor;
uniform float uIntensity;
in vec2 vUv;
in float vStrength;
layout(location = 0) out vec4 fragColor;
void main() {
  // u: 0 newest, 1 oldest; v: 0 at the base, 1 at the tip. Brightest along the tip's edge and
  // where the blade just was, nothing near the hilt; only a fast blade leaves an arc (the turn at
  // the end of a wind-up, where the sheet would fold back on itself, leaves none).
  float fade = vStrength * pow(1.0 - vUv.x, 2.8) * smoothstep(0.15, 1.0, vUv.y) * (0.3 + 0.7 * vUv.y * vUv.y);
  fragColor = vec4(uColor * fade * uIntensity, 0.0);
}`;

/** Light blended in, colour kept: its own colour added, what's behind dimmed by its alpha. */
const GLOW_BLEND: Partial<THREE.ShaderMaterialParameters> = {
  transparent: true,
  depthWrite: false,
  blending: THREE.CustomBlending,
  blendSrc: THREE.OneFactor,
  blendDst: THREE.OneMinusSrcAlphaFactor,
  side: THREE.DoubleSide,
};

/** The capsule: three quads (the base's cap, the blade, the tip's cap) in the blade shader's terms. */
const capsule = (() => {
  const g = new THREE.BufferGeometry();
  const rows = [
    [0, -1],
    [0, 0],
    [1, 0],
    [1, 1],
  ];
  const pos: number[] = [];
  for (const [y, z] of rows) pos.push(-1, y, z, 1, y, z);
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex([0, 1, 2, 1, 3, 2, 2, 3, 4, 3, 5, 4, 4, 5, 6, 5, 7, 6]);
  return g;
})();

/** How long a trail lasts (seconds), and how many of the frames in it are kept at most. */
const TRAIL_TIME = 0.14;
const TRAIL_MAX = 24;

const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const toRoot = new THREE.Matrix4();

/** A blade on an item's node: `base` to `tip` in the node's own space. */
export class Blade {
  readonly mesh: THREE.Mesh;
  private material: THREE.RawShaderMaterial;
  private trail: THREE.Mesh | null = null;
  private trailMaterial: THREE.RawShaderMaterial | null = null;
  private samples: { t: number; a: THREE.Vector3; b: THREE.Vector3; s: number }[] = [];
  private frame = -1;
  private root: THREE.Object3D | null = null;
  private seed = Math.random() * 100;

  constructor(
    node: THREE.Object3D,
    base: THREE.Vector3,
    tip: THREE.Vector3,
    private spec: BladeSpec,
  ) {
    const color = new THREE.Color(spec.color);
    this.material = new THREE.RawShaderMaterial({
      vertexShader: BLADE_VERT,
      fragmentShader: BLADE_FRAG,
      glslVersion: THREE.GLSL3,
      uniforms: {
        uBase: { value: base.clone() },
        uTip: { value: tip.clone() },
        uRadius: { value: spec.width ?? 0.11 },
        uColor: { value: color },
        uIntensity: { value: spec.glow ?? 5 },
        uCore: { value: 0.22 },
      },
      ...GLOW_BLEND,
    });
    this.mesh = new THREE.Mesh(capsule, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
    this.mesh.castShadow = false;
    // Once a frame, as it's drawn: the flicker, and the trail kept where the blade has been.
    this.mesh.onBeforeRender = (renderer, scene) => this.update(renderer, scene);
    node.add(this.mesh);
    if (spec.trail !== false) {
      this.trailMaterial = new THREE.RawShaderMaterial({
        vertexShader: TRAIL_VERT,
        fragmentShader: TRAIL_FRAG,
        glslVersion: THREE.GLSL3,
        uniforms: { uColor: { value: color }, uIntensity: { value: (spec.glow ?? 5) * 0.32 } },
        ...GLOW_BLEND,
        // (Purely added: where the sheet folds over itself it only brightens.)
        blendDst: THREE.OneFactor,
      });
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL_MAX * 2 * 3), 3));
      g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(TRAIL_MAX * 2 * 2), 2));
      g.setAttribute('strength', new THREE.BufferAttribute(new Float32Array(TRAIL_MAX * 2), 1));
      const index: number[] = [];
      for (let i = 0; i < TRAIL_MAX - 1; i++) index.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
      g.setIndex(index);
      g.setDrawRange(0, 0);
      this.trail = new THREE.Mesh(g, this.trailMaterial);
      this.trail.frustumCulled = false;
      // (After the blade, which updates it: a blade not drawn this frame, put away or gone, leaves none.)
      this.trail.renderOrder = 11;
      this.trail.onBeforeRender = (renderer) => {
        if (renderer.info.render.frame !== this.frame) g.setDrawRange(0, 0);
      };
    }
  }

  private update(renderer: THREE.WebGLRenderer, scene: THREE.Object3D) {
    const frame = renderer.info.render.frame;
    if (frame === this.frame) return;
    this.frame = frame;
    const now = performance.now() / 1000;
    const u = this.material.uniforms;
    // A hum you can see: a quick shimmer and a slower swell.
    const f = 1 + 0.05 * Math.sin(now * 41 + this.seed) + 0.04 * Math.sin(now * 13.7 + this.seed * 2);
    u.uIntensity.value = (this.spec.glow ?? 5) * f;
    u.uCore.value = 0.22 * (1 + 0.05 * Math.sin(now * 29 + this.seed));
    if (!this.trail) return;
    // The trail lives in the scene being drawn (the world, or the first-person layer's).
    if (this.root !== scene) {
      this.trail.removeFromParent();
      scene.add(this.trail);
      this.root = scene;
      this.samples = [];
    }
    toRoot.copy(scene.matrixWorld).invert().multiply(this.mesh.matrixWorld);
    const a = tmpA.copy(u.uBase.value as THREE.Vector3).applyMatrix4(toRoot);
    const b = tmpB.copy(u.uTip.value as THREE.Vector3).applyMatrix4(toRoot);
    // A sample a frame (the scene can be drawn more than once in one: the same moment's taken
    // once), and how fast the tip was going (metres a second): an arc from 3 up, full from 11.
    if (this.samples.length && now - this.samples[0].t < 0.004) this.samples.shift();
    const last = this.samples[0];
    const speed = last ? b.distanceTo(last.b) / Math.max(0.004, now - last.t) : 0;
    const k = Math.min(1, Math.max(0, (speed - 3) / 8));
    this.samples.unshift({ t: now, a: a.clone(), b: b.clone(), s: k * k * (3 - 2 * k) });
    while (this.samples.length > TRAIL_MAX || (this.samples.length && now - this.samples[this.samples.length - 1].t > TRAIL_TIME)) this.samples.pop();
    const n = this.samples.length;
    const g = this.trail.geometry;
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    const uv = g.getAttribute('uv') as THREE.BufferAttribute;
    const strength = g.getAttribute('strength') as THREE.BufferAttribute;
    this.samples.forEach((s, i) => {
      const age = Math.min(1, (now - s.t) / TRAIL_TIME);
      pos.setXYZ(i * 2, s.a.x, s.a.y, s.a.z);
      pos.setXYZ(i * 2 + 1, s.b.x, s.b.y, s.b.z);
      uv.setXY(i * 2, age, 0);
      uv.setXY(i * 2 + 1, age, 1);
      strength.setX(i * 2, s.s);
      strength.setX(i * 2 + 1, s.s);
    });
    pos.needsUpdate = true;
    uv.needsUpdate = true;
    strength.needsUpdate = true;
    g.setDrawRange(0, n > 1 ? (n - 1) * 6 : 0);
    this.trail.visible = this.mesh.visible && n > 1;
  }

  dispose() {
    this.mesh.removeFromParent();
    this.material.dispose();
    this.trail?.removeFromParent();
    this.trail?.geometry.dispose();
    this.trailMaterial?.dispose();
  }
}

/**
 * The blade a held item's look has (`hold.blade`), on its node: from where the blade starts along
 * the item (`start`, from the rear hand's grip to the tip: `muzzle`), to the tip. Null without one.
 */
export function bladeOn(node: THREE.Object3D, spec: BladeSpec | undefined, points: Partial<Record<string, THREE.Vector3>> | undefined): Blade | null {
  const grip = points?.grip;
  const tip = points?.muzzle;
  if (!spec || !grip || !tip) return null;
  const base = grip.clone().lerp(tip, spec.start ?? 0.15);
  return new Blade(node, base, tip, spec);
}
