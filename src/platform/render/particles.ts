import * as THREE from 'three';

const MAX = 4096;

const vert = /* glsl */ `
precision highp float;
in vec3 position;
in vec4 color;
in float size;
in float glow;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform float uScale;
out vec4 vColor;
out float vGlow;
void main() {
  vGlow = glow;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = size * uScale / max(-mv.z, 0.05);
  vColor = color;
}`;

const frag = /* glsl */ `
precision highp float;
in vec4 vColor;
in float vGlow;
uniform vec3 uLight;
layout(location = 0) out vec4 fragColor;
void main() {
  if (vColor.a <= 0.0) discard;
  fragColor = vec4(vColor.rgb * (uLight + vGlow * 5.0), 1.0);
}`;

const srgbToLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

/** Block-break debris: small lit squares with simple physics against the voxel world. */
export class Particles {
  readonly points: THREE.Points;
  private pos = new Float32Array(MAX * 3);
  private col = new Float32Array(MAX * 4);
  private size = new Float32Array(MAX);
  private glow = new Float32Array(MAX);
  private drag = new Float32Array(MAX);
  private grav = new Float32Array(MAX);
  private collide = new Uint8Array(MAX);
  private vel = new Float32Array(MAX * 3);
  private life = new Float32Array(MAX);
  private origin = new THREE.Vector3();
  private next = 0;
  private material: THREE.RawShaderMaterial;

  constructor(private isSolid: (x: number, y: number, z: number) => boolean) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('glow', new THREE.BufferAttribute(this.glow, 1).setUsage(THREE.DynamicDrawUsage));
    this.material = new THREE.RawShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      glslVersion: THREE.GLSL3,
      uniforms: { uScale: { value: 400 }, uLight: { value: new THREE.Vector3(1, 1, 1) } },
    });
    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false;
    this.points.matrixAutoUpdate = false;
  }

  setViewport(heightPx: number, fovDeg: number) {
    (this.material.uniforms.uScale as { value: number }).value = heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
  }

  setLight(c: THREE.Vector3) {
    (this.material.uniforms.uLight as { value: THREE.Vector3 }).value.copy(c);
  }

  /** Spawn debris for a broken block using colours sampled from its texture. */
  burst(x: number, y: number, z: number, pixels: Uint8Array, tint: [number, number, number] | null) {
    // Keep positions small in float32 by expressing them relative to a moving origin.
    if (this.origin.distanceToSquared(new THREE.Vector3(x, y, z)) > 256 * 256) {
      this.origin.set(Math.floor(x), Math.floor(y), Math.floor(z));
      this.life.fill(0);
    }
    for (let i = 0; i < 28; i++) {
      const p = this.next;
      this.next = (this.next + 1) % MAX;
      let r = 0.5, g = 0.5, b = 0.5;
      for (let tries = 0; tries < 8; tries++) {
        const px = (Math.random() * 256) | 0;
        if (pixels[px * 4 + 3] < 128 && tries < 7) continue;
        r = pixels[px * 4] / 255;
        g = pixels[px * 4 + 1] / 255;
        b = pixels[px * 4 + 2] / 255;
        if (tint) {
          r *= tint[0];
          g *= tint[1];
          b *= tint[2];
        }
        break;
      }
      this.col.set([srgbToLinear(r), srgbToLinear(g), srgbToLinear(b), 1], p * 4);
      this.pos.set([x + 0.15 + Math.random() * 0.7 - this.origin.x, y + 0.15 + Math.random() * 0.7 - this.origin.y, z + 0.15 + Math.random() * 0.7 - this.origin.z], p * 3);
      this.vel.set([(Math.random() - 0.5) * 3.2, Math.random() * 3.5 + 1.0, (Math.random() - 0.5) * 3.2], p * 3);
      this.size[p] = 0.06 + Math.random() * 0.06;
      this.life[p] = 0.7 + Math.random() * 0.6;
      this.glow[p] = 0;
      this.drag[p] = 0;
      this.grav[p] = 22;
      this.collide[p] = 1;
    }
  }

  /** Coloured burst: `color` is linear RGB. `glow` makes particles emissive (fireworks, magic). */
  burstColor(
    x: number,
    y: number,
    z: number,
    color: [number, number, number],
    opts: { count?: number; speed?: number; size?: number; gravity?: number; glow?: number; life?: number; spread?: number; up?: number; velocity?: { x: number; y: number; z: number }; drag?: number; collide?: boolean } = {},
  ) {
    this.rebase(x, y, z);
    const count = opts.count ?? 16;
    const speed = opts.speed ?? 3;
    const v = opts.velocity;
    for (let i = 0; i < count; i++) {
      const p = this.next;
      this.next = (this.next + 1) % MAX;
      // Random direction on a sphere.
      const u = Math.random() * 2 - 1;
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      const sp = speed * (0.4 + Math.random() * 0.6);
      const j = 0.85 + Math.random() * 0.3;
      this.col.set([color[0] * j, color[1] * j, color[2] * j, 1], p * 4);
      const sp0 = opts.spread ?? 0.3;
      this.pos.set([x - this.origin.x + (Math.random() - 0.5) * sp0, y - this.origin.y + (Math.random() - 0.5) * sp0, z - this.origin.z + (Math.random() - 0.5) * sp0], p * 3);
      this.vel.set([r * Math.cos(a) * sp + (v?.x ?? 0), u * sp + (opts.up ?? 1.5) + (v?.y ?? 0), r * Math.sin(a) * sp + (v?.z ?? 0)], p * 3);
      this.size[p] = (opts.size ?? 0.08) * (0.7 + Math.random() * 0.6);
      this.life[p] = (opts.life ?? 0.8) * (0.7 + Math.random() * 0.6);
      this.glow[p] = opts.glow ?? 0;
      this.drag[p] = opts.drag ?? 0;
      this.grav[p] = opts.gravity ?? 18;
      this.collide[p] = opts.collide === false ? 0 : 1;
    }
  }

  private rebase(x: number, y: number, z: number) {
    if (this.origin.distanceToSquared(new THREE.Vector3(x, y, z)) > 256 * 256) {
      this.origin.set(Math.floor(x), Math.floor(y), Math.floor(z));
      this.life.fill(0);
    }
  }

  update(dt: number) {
    const o = this.origin;
    for (let i = 0; i < MAX; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.col[i * 4 + 3] = 0;
        continue;
      }
      this.vel[i * 3 + 1] -= this.grav[i] * dt;
      if (this.drag[i] > 0) {
        const k = Math.exp(-this.drag[i] * dt);
        this.vel[i * 3] *= k;
        this.vel[i * 3 + 1] *= k;
        this.vel[i * 3 + 2] *= k;
      }
      for (let a = 0; a < 3; a++) {
        const np = this.pos[i * 3 + a] + this.vel[i * 3 + a] * dt;
        if (!this.collide[i]) {
          this.pos[i * 3 + a] = np;
          continue;
        }
        const test = [this.pos[i * 3] + o.x, this.pos[i * 3 + 1] + o.y, this.pos[i * 3 + 2] + o.z];
        test[a] = np + o.getComponent(a);
        if (this.isSolid(Math.floor(test[0]), Math.floor(test[1]), Math.floor(test[2]))) {
          this.vel[i * 3 + a] *= a === 1 ? -0.25 : -0.3;
          if (a === 1) {
            this.vel[i * 3] *= 0.6;
            this.vel[i * 3 + 2] *= 0.6;
          }
        } else {
          this.pos[i * 3 + a] = np;
        }
      }
      if (this.life[i] < 0.2) this.size[i] *= 0.9;
    }
    this.points.position.copy(o);
    this.points.updateMatrix();
    this.points.matrixWorld.copy(this.points.matrix);
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
    g.attributes.size.needsUpdate = true;
    g.attributes.glow.needsUpdate = true;
  }
}
