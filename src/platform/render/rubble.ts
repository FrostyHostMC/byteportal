import * as THREE from 'three';

/** How many bits of rubble at most (the oldest go first to make room). */
const MAX = 900;
/** Seconds a piece lies where it settled, and fades (sinks and shrinks) at the end of that. */
const LIE = 9;
const FADE = 1.2;

const vert = /* glsl */ `
precision highp float;
in vec3 position;
in vec3 normal;
in vec4 iPos;
in vec4 iRot;
in vec3 iColor;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform vec3 uLight;
uniform vec3 uSunDir;
out vec3 vColor;
vec3 turn(vec4 q, vec3 v) { return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v); }
void main() {
  vec3 p = turn(iRot, position * iPos.w) + iPos.xyz;
  vec3 n = turn(iRot, normal);
  // Lit like the particles (the light where the camera is), with the sun's side and the top a little brighter.
  float shade = 0.62 + 0.28 * n.y + 0.35 * max(dot(n, uSunDir), 0.0);
  vColor = iColor * uLight * shade;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;

const frag = /* glsl */ `
precision highp float;
in vec3 vColor;
layout(location = 0) out vec4 fragColor;
void main() {
  fragColor = vec4(vColor, 1.0);
}`;

const srgbToLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

/**
 * Rubble: chips and chunks knocked out of blocks (bullets' pits, a blast's crater, a block
 * broken) that fall, tumble, bounce and settle on the ground as little cubes, lie there a while
 * and sink away. Drawn in one go (instanced), coloured from the block's own texture; it lives only
 * on this screen (each works it out from the same damage), and costs nothing once it's settled.
 */
export class Rubble {
  readonly mesh: THREE.Mesh;
  private geo: THREE.InstancedBufferGeometry;
  private iPos = new Float32Array(MAX * 4);
  private iRot = new Float32Array(MAX * 4);
  private iColor = new Float32Array(MAX * 3);
  private vel = new Float32Array(MAX * 3);
  private spin = new Float32Array(MAX * 3);
  private life = new Float32Array(MAX);
  /** 0 flying, 1 settled. */
  private rest = new Uint8Array(MAX);
  private size = new Float32Array(MAX);
  private used = 0;
  private next = 0;
  private origin = new THREE.Vector3();
  private material: THREE.RawShaderMaterial;
  private q = new THREE.Quaternion();
  private dq = new THREE.Quaternion();
  private axis = new THREE.Vector3();

  constructor(
    /** Whether a point is inside solid material (what's been shot out of a block isn't). */
    private solid: (x: number, y: number, z: number) => boolean,
    sunDir: { value: THREE.Vector3 },
  ) {
    const box = new THREE.BoxGeometry(1, 1, 1);
    const geo = (this.geo = new THREE.InstancedBufferGeometry());
    geo.setIndex(box.getIndex());
    geo.setAttribute('position', box.getAttribute('position'));
    geo.setAttribute('normal', box.getAttribute('normal'));
    geo.setAttribute('iPos', new THREE.InstancedBufferAttribute(this.iPos, 4).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('iRot', new THREE.InstancedBufferAttribute(this.iRot, 4).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('iColor', new THREE.InstancedBufferAttribute(this.iColor, 3).setUsage(THREE.DynamicDrawUsage));
    geo.instanceCount = 0;
    this.material = new THREE.RawShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      glslVersion: THREE.GLSL3,
      uniforms: { uLight: { value: new THREE.Vector3(1, 1, 1) }, uSunDir: sunDir },
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
  }

  setLight(c: THREE.Vector3) {
    (this.material.uniforms.uLight as { value: THREE.Vector3 }).value.copy(c);
  }

  /** How many pieces there are now. */
  get count(): number {
    return this.used;
  }

  /**
   * A piece at (x, y, z), `size` blocks across, flying off at `v`, coloured from a random pixel of
   * `pixels` (a block face's 16 x 16 sRGB, `tint` multiplying it).
   */
  add(x: number, y: number, z: number, size: number, v: Vec3Like, pixels: Uint8Array, tint: [number, number, number] | null) {
    if (this.origin.distanceToSquared(new THREE.Vector3(x, y, z)) > 200 * 200) {
      // Far from the last: start again round here (keeps positions small in float32).
      this.origin.set(Math.floor(x), Math.floor(y), Math.floor(z));
      this.used = 0;
      this.next = 0;
    }
    const i = this.next;
    this.next = (this.next + 1) % MAX;
    this.used = Math.max(this.used, this.next === 0 ? MAX : this.next);
    let r = 0.5, g = 0.5, b = 0.5;
    for (let tries = 0; tries < 8; tries++) {
      const px = (Math.random() * 256) | 0;
      if (pixels[px * 4 + 3] < 128 && tries < 7) continue;
      r = pixels[px * 4] / 255;
      g = pixels[px * 4 + 1] / 255;
      b = pixels[px * 4 + 2] / 255;
      break;
    }
    if (tint) {
      r *= tint[0];
      g *= tint[1];
      b *= tint[2];
    }
    // Broken faces are a little darker than the one we see.
    const k = 0.72 + Math.random() * 0.22;
    this.iColor.set([srgbToLinear(r) * k, srgbToLinear(g) * k, srgbToLinear(b) * k], i * 3);
    this.iPos.set([x - this.origin.x, y - this.origin.y, z - this.origin.z, size], i * 4);
    this.q.setFromAxisAngle(this.axis.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize(), Math.random() * Math.PI);
    this.iRot.set([this.q.x, this.q.y, this.q.z, this.q.w], i * 4);
    this.vel.set([v.x, v.y, v.z], i * 3);
    this.spin.set([(Math.random() - 0.5) * 18, (Math.random() - 0.5) * 18, (Math.random() - 0.5) * 18], i * 3);
    this.life[i] = LIE + FADE + Math.random() * 3;
    this.rest[i] = 0;
    this.size[i] = size;
  }

  update(dt: number) {
    if (!this.used) return;
    const o = this.origin;
    const P = this.iPos;
    const V = this.vel;
    for (let i = 0; i < this.used; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const s = this.size[i];
      if (this.life[i] <= 0) {
        P[i * 4 + 3] = 0;
        continue;
      }
      // Fading: sinks into the ground and shrinks away.
      if (this.life[i] < FADE) {
        P[i * 4 + 3] = s * (this.life[i] / FADE);
        P[i * 4 + 1] -= dt * s * 0.4;
      }
      if (this.rest[i]) continue;
      V[i * 3 + 1] -= 24 * dt;
      const x = P[i * 4] + o.x;
      const y = P[i * 4 + 1] + o.y;
      const z = P[i * 4 + 2] + o.z;
      const h = s * 0.5;
      // Axis by axis against what's solid (to the little voxel), bouncing off it.
      let landed = false;
      const nx = x + V[i * 3] * dt;
      if (this.solid(nx + Math.sign(V[i * 3]) * h, y, z)) V[i * 3] *= -0.3;
      else P[i * 4] = nx - o.x;
      const nz = z + V[i * 3 + 2] * dt;
      if (this.solid(P[i * 4] + o.x, y, nz + Math.sign(V[i * 3 + 2]) * h)) V[i * 3 + 2] *= -0.3;
      else P[i * 4 + 2] = nz - o.z;
      const ny = y + V[i * 3 + 1] * dt;
      if (this.solid(P[i * 4] + o.x, ny - h, P[i * 4 + 2] + o.z) && V[i * 3 + 1] < 0) {
        landed = true;
        V[i * 3 + 1] *= -0.25;
        V[i * 3] *= 0.55;
        V[i * 3 + 2] *= 0.55;
      } else if (this.solid(P[i * 4] + o.x, ny + h, P[i * 4 + 2] + o.z) && V[i * 3 + 1] > 0) V[i * 3 + 1] = 0;
      else P[i * 4 + 1] = ny - o.y;
      // Tumbling, slowing as it scrapes along.
      const sp = this.spin;
      if (landed) for (let a = 0; a < 3; a++) sp[i * 3 + a] *= 0.5;
      const w = Math.hypot(sp[i * 3], sp[i * 3 + 1], sp[i * 3 + 2]);
      if (w > 1e-3) {
        this.dq.setFromAxisAngle(this.axis.set(sp[i * 3] / w, sp[i * 3 + 1] / w, sp[i * 3 + 2] / w), w * dt);
        this.q.set(this.iRot[i * 4], this.iRot[i * 4 + 1], this.iRot[i * 4 + 2], this.iRot[i * 4 + 3]).premultiply(this.dq);
        this.iRot.set([this.q.x, this.q.y, this.q.z, this.q.w], i * 4);
      }
      // Settled: it lies still from now on (nothing to work out).
      if (landed && Math.abs(V[i * 3 + 1]) < 0.6 && Math.hypot(V[i * 3], V[i * 3 + 2]) < 0.4) {
        this.rest[i] = 1;
        this.life[i] = Math.min(this.life[i], LIE + FADE + Math.random() * 2);
      }
      // Fallen out of the world.
      if (y < -10) this.life[i] = 0;
    }
    this.mesh.position.copy(o);
    this.mesh.updateMatrix();
    this.mesh.matrixWorld.copy(this.mesh.matrix);
    this.geo.instanceCount = this.used;
    for (const name of ['iPos', 'iRot', 'iColor']) (this.geo.getAttribute(name) as THREE.InstancedBufferAttribute).needsUpdate = true;
  }

  clear() {
    this.used = 0;
    this.next = 0;
    this.life.fill(0);
    this.geo.instanceCount = 0;
  }
}

interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/**
 * What a damage change took from each block (the encoding `VoxelWorld.carve` writes, see
 * `engine/src/damage.rs`): per cell, where it is, how many little voxels went and a few of them
 * (their middles, in world coordinates) to throw rubble from.
 */
export function damageTaken(data: Uint8Array, samples = 6): { x: number; y: number; z: number; taken: number; at: [number, number, number][] }[] {
  const out: { x: number; y: number; z: number; taken: number; at: [number, number, number][] }[] = [];
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let o = 0;
  const varint = (): number => {
    let r = 0;
    for (let shift = 0; shift < 35; shift += 7) {
      if (o >= data.length) return -1;
      const b = data[o++];
      r |= (b & 0x7f) << shift;
      if (!(b & 0x80)) return r >>> 0;
    }
    return -1;
  };
  while (o + 9 <= data.length) {
    const x = v.getInt32(o, true);
    const z = v.getInt32(o + 4, true);
    const y = data[o + 8];
    o += 9;
    // Runs of kept and taken bits, kept first (index y * 256 + z * 16 + x).
    const runs: [number, number][] = [];
    let i = 0;
    let taking = false;
    let taken = 0;
    while (i < 4096) {
      const n = varint();
      if (n < 0 || n > 4096 - i) return out;
      if (taking && n > 0) {
        runs.push([i, n]);
        taken += n;
      }
      i += n;
      taking = !taking;
    }
    const at: [number, number, number][] = [];
    for (let k = 0; k < samples && runs.length; k++) {
      // A random bit taken (runs weighted by length).
      let pick = Math.floor(Math.random() * taken);
      let bit = 0;
      for (const [start, len] of runs) {
        if (pick < len) {
          bit = start + pick;
          break;
        }
        pick -= len;
      }
      at.push([x + ((bit & 15) + 0.5) / 16, y + ((bit >> 8) + 0.5) / 16, z + (((bit >> 4) & 15) + 0.5) / 16]);
    }
    out.push({ x, y, z, taken, at });
  }
  return out;
}
