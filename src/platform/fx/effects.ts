import * as THREE from 'three';
import type { FxApi, Vec3 } from '../api/types';
import type { Particles } from '../render/particles';
import type { GameHud } from '../ui/hudkit';
import type { Sfx } from '../audio/sfx';
import { Shaders } from '../render/shaders';

/** Parse a CSS colour into linear RGB. */
export function linearColor(css: string): [number, number, number] {
  const c = new THREE.Color(css);
  return [c.r, c.g, c.b];
}

interface Ring {
  mesh: THREE.Mesh;
  age: number;
  life: number;
  radius: number;
}

interface Rocket {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  fuse: number;
  color: [number, number, number];
}

/** A glowing streak racing from one point to another (a shot's path). */
interface Tracer {
  mesh: THREE.Group;
  material: THREE.RawShaderMaterial;
  from: THREE.Vector3;
  dir: THREE.Vector3;
  length: number;
  travelled: number;
  /** Blocks a second, and the streak's own length. */
  speed: number;
  streak: number;
}

/** A hole on a wall, fading after a while. */
interface Decal {
  mesh: THREE.Mesh;
  age: number;
}

/** A flare in the world: a hot glow for a moment. */
interface Glow {
  mesh: THREE.Mesh;
  age: number;
}

const TRACER_SPEED = 360;
const TRACER_LENGTH = 5;

/** Screen and world effects. The camera shake offset is read by the runtime each frame. */
export class Effects implements FxApi {
  readonly shakeOffset = new THREE.Vector3();
  private shakeStrength = 0;
  private shakeTime = 0;
  private shakeDuration = 1;
  private rings: Ring[] = [];
  private rockets: Rocket[] = [];
  private time = 0;
  private ringGeo = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
  private tracers: Tracer[] = [];
  private decals: Decal[] = [];
  private glows: Glow[] = [];
  /** Two crossed quads along +z, 1 long, with the bolt shader's UVs (v along the length). */
  private tracerGeo = (() => {
    const a = new THREE.PlaneGeometry(0.06, 1).rotateX(Math.PI / 2).translate(0, 0, 0.5);
    const b = a.clone().rotateZ(Math.PI / 2);
    return [a, b];
  })();
  private decalGeo = new THREE.PlaneGeometry(0.11, 0.11);
  private decalMat = new THREE.MeshBasicMaterial({ color: 0x0b0b0d, transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  private glowGeo = new THREE.PlaneGeometry(1, 1);

  /** Heard of each explosion shown (rubble thrown by it). */
  onBlast: ((at: Vec3, size: number) => void) | null = null;

  constructor(
    private dots: Particles,
    private hud: GameHud,
    private fxScene: THREE.Scene,
    private sfx?: Sfx,
    private cameraPos?: () => Vec3,
  ) {}

  explosion(at: Vec3, opts: { size?: number; color?: string } = {}) {
    const k = Math.max(0.2, opts.size ?? 1);
    this.onBlast?.(at, k);
    const fire = linearColor(opts.color ?? '#ff9a3c');
    const p = this.dots;
    // White-hot core, a fireball, rising smoke and flying sparks. A bigger blast throws more
    // puffs, not bigger ones (past 1.2 or so, a square the size of a block reads as cardboard).
    const n = k > 1 ? k * k : k;
    const big = (most: number) => Math.min(k, most);
    p.burstColor(at.x, at.y, at.z, [1, 0.95, 0.8], { count: Math.round(10 * n), speed: 2.5 * k, size: 0.5 * big(1.2), glow: 2, life: 0.25, drag: 4, gravity: 0, spread: 0.4 * k, up: 0, collide: false });
    p.burstColor(at.x, at.y, at.z, fire, { count: Math.round(28 * n), speed: 6 * k, size: 0.35 * big(1.3), glow: 1.4, life: 0.55, drag: 3.5, gravity: -1, spread: 0.8 * k, up: 0.5, collide: false });
    const smoke = Math.round(18 * n);
    const pale = k > 1 ? Math.round(smoke * 0.4) : 0;
    p.burstColor(at.x, at.y, at.z, [0.13, 0.12, 0.11], { count: smoke - pale, speed: 2.6 * k, size: 0.5 * big(1.1), glow: 0, life: 1.8, drag: 1.8, gravity: -1.5, spread: 1.2 * k, up: 1, collide: false });
    if (pale) p.burstColor(at.x, at.y, at.z, [0.3, 0.28, 0.25], { count: pale, speed: 3 * k, size: 0.4 * big(1.1), glow: 0, life: 1.4, drag: 2, gravity: -1.2, spread: 1.4 * k, up: 0.8, collide: false });
    p.burstColor(at.x, at.y, at.z, [1, 0.7, 0.3], { count: Math.round(14 * k), speed: 14 * k, size: 0.07, glow: 1.5, life: 1.1, drag: 0.6, gravity: 12, spread: 0.5, up: 2, collide: true });
    if (k >= 2) this.shockwave(at, 2.5 * k, opts.color ?? '#ffb347');
    const cam = this.cameraPos?.();
    const d = cam ? Math.hypot(cam.x - at.x, cam.y - at.y, cam.z - at.z) : 20;
    const shake = (0.35 * k) / (1 + d * 0.06);
    if (shake > 0.015) this.shake(Math.min(0.9, shake), 0.3 + 0.08 * k);
    this.sfx?.play(k >= 2.5 ? 'explosion_big' : 'explosion', { at, volume: Math.min(1.2, 0.55 + 0.25 * k), pitch: 1.15 - Math.min(0.5, 0.08 * k) });
  }

  burst(at: Vec3, opts: { color?: string; count?: number; speed?: number; size?: number; gravity?: number; glow?: number; life?: number; drag?: number } = {}) {
    this.dots.burstColor(at.x, at.y, at.z, linearColor(opts.color ?? '#ffffff'), {
      count: opts.count ?? 18,
      speed: opts.speed ?? 3,
      size: opts.size ?? 0.09,
      gravity: opts.gravity ?? 18,
      glow: opts.glow,
      life: opts.life,
      drag: opts.drag,
      collide: opts.glow ? false : undefined,
    });
  }

  /** Particles with every knob (see `ClientFx.particles`): a linear colour, `spread` round the point, a push `up`. */
  particles(at: Vec3, color: [number, number, number], opts: Parameters<Particles['burstColor']>[4] = {}) {
    this.dots.burstColor(at.x, at.y, at.z, color, opts);
  }

  shake(strength: number, duration = 0.35) {
    if (strength >= this.shakeStrength * Math.max(0, 1 - this.shakeTime / this.shakeDuration)) {
      this.shakeStrength = strength;
      this.shakeDuration = duration;
      this.shakeTime = 0;
    }
  }

  flash(color: string, strength = 0.35, duration = 0.4) {
    this.hud.flash(color, strength, duration);
  }

  shockwave(at: Vec3, radius: number, color = '#ffb347') {
    const mat = new THREE.RawShaderMaterial({
      vertexShader: Shaders.fx.vertex,
      fragmentShader: Shaders.fx.fragment,
      glslVersion: THREE.GLSL3,
      uniforms: {
        uColor: { value: new THREE.Color(color) },
        uIntensity: { value: 3 },
        uTime: { value: 0 },
        uMode: { value: 1 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(this.ringGeo, mat);
    mesh.position.set(at.x, at.y + 0.15, at.z);
    mesh.frustumCulled = false;
    this.fxScene.add(mesh);
    this.rings.push({ mesh, age: 0, life: 0.55, radius });
    const c = linearColor(color);
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * Math.PI * 2;
      this.dots.burstColor(at.x + Math.cos(a) * 0.8, at.y + 0.2, at.z + Math.sin(a) * 0.8, c, { count: 1, speed: 0.5, up: 3, size: 0.12, gravity: 10 });
    }
  }

  /**
   * A bullet's tracer, from a muzzle to where it landed: a streak `length` blocks long and `width`
   * across racing there at `speed` blocks a second, `glow` bright (see `ClientFx.tracer`).
   */
  tracer(from: Vec3, to: Vec3, color = '#ffd27a', opts: { speed?: number; length?: number; width?: number; glow?: number } = {}) {
    const f = new THREE.Vector3(from.x, from.y, from.z);
    const dir = new THREE.Vector3(to.x - from.x, to.y - from.y, to.z - from.z);
    const length = dir.length();
    if (length < 1.5) return;
    dir.divideScalar(length);
    const material = new THREE.RawShaderMaterial({
      vertexShader: Shaders.fx.vertex,
      fragmentShader: Shaders.fx.fragment,
      glslVersion: THREE.GLSL3,
      uniforms: { uColor: { value: new THREE.Color(color) }, uIntensity: { value: opts.glow ?? 6 }, uTime: { value: 0 }, uMode: { value: 3 } },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const group = new THREE.Group();
    for (const g of this.tracerGeo) {
      const m = new THREE.Mesh(g, material);
      m.frustumCulled = false;
      group.add(m);
    }
    group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
    group.position.copy(f);
    // The quads are 0.06 across.
    const across = (opts.width ?? 0.06) / 0.06;
    group.scale.set(across, across, 0.001);
    this.fxScene.add(group);
    this.tracers.push({ mesh: group, material, from: f, dir, length, travelled: 0, speed: opts.speed ?? TRACER_SPEED, streak: opts.length ?? TRACER_LENGTH });
  }

  /**
   * Where a bullet landed: on a block, chips of its colour, a spark and a hole (unless `mark` is
   * false: a block the bullet carved shows its own); on someone, a puff of `body` colour.
   */
  impact(at: Vec3, normal: Vec3 | null, color: [number, number, number], body = false, mark = true) {
    const n = normal ?? { x: 0, y: 1, z: 0 };
    const x = at.x + n.x * 0.04;
    const y = at.y + n.y * 0.04;
    const z = at.z + n.z * 0.04;
    if (body) {
      this.dots.burstColor(x, y, z, color, { count: 10, speed: 3.2, size: 0.09, gravity: 14, life: 0.45, spread: 0.3, up: 1 });
      return;
    }
    this.dots.burstColor(x, y, z, color, { count: 6, speed: 3.5, size: 0.07, gravity: 20, life: 0.6, spread: 0.2, up: 1.2 });
    this.dots.burstColor(x, y, z, [1, 0.85, 0.5], { count: 3, speed: 6, size: 0.035, glow: 2, gravity: 16, life: 0.18, collide: false, up: 1 });
    this.dots.burstColor(x, y, z, [0.55, 0.52, 0.48], { count: 2, speed: 0.8, size: 0.08, gravity: -1, life: 0.6, drag: 2, collide: false, up: 0.4 });
    // A bullet hole (not in a block that's carved: the pit it left is the mark).
    if (!normal || !mark) return;
    const mesh = new THREE.Mesh(this.decalGeo, this.decalMat);
    mesh.position.set(at.x + n.x * 0.003, at.y + n.y * 0.003, at.z + n.z * 0.003);
    mesh.lookAt(mesh.position.x + n.x, mesh.position.y + n.y, mesh.position.z + n.z);
    mesh.rotateZ(Math.random() * Math.PI);
    this.fxScene.add(mesh);
    this.decals.push({ mesh, age: 0 });
    while (this.decals.length > 80) this.fxScene.remove(this.decals.shift()!.mesh);
  }

  /** A hot glow facing the camera for a moment (a shot's flash in the world). */
  flare(at: Vec3, size = 0.5) {
    const material = new THREE.RawShaderMaterial({
      vertexShader: Shaders.fx.vertex,
      fragmentShader: Shaders.fx.fragment,
      glslVersion: THREE.GLSL3,
      uniforms: { uColor: { value: new THREE.Color('#ffc46b') }, uIntensity: { value: 7 }, uTime: { value: 0 }, uMode: { value: 2 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.Mesh(this.glowGeo, material);
    mesh.position.set(at.x, at.y, at.z);
    mesh.scale.setScalar(size);
    mesh.frustumCulled = false;
    this.fxScene.add(mesh);
    this.glows.push({ mesh, age: 0 });
  }

  damageNumber(at: Vec3, amount: number, opts: { crit?: boolean; color?: string } = {}) {
    this.hud.damageNumber(new THREE.Vector3(at.x, at.y, at.z), amount, opts.crit ?? false, opts.color);
  }

  fireworks(at: Vec3, count = 5) {
    const palette: [number, number, number][] = [
      [1, 0.3, 0.2],
      [0.3, 0.8, 1],
      [1, 0.85, 0.2],
      [0.5, 1, 0.4],
      [1, 0.4, 0.9],
    ];
    for (let i = 0; i < count; i++) {
      this.rockets.push({
        pos: new THREE.Vector3(at.x + (Math.random() - 0.5) * 6, at.y, at.z + (Math.random() - 0.5) * 6),
        vel: new THREE.Vector3((Math.random() - 0.5) * 3, 16 + Math.random() * 6, (Math.random() - 0.5) * 3),
        fuse: 0.9 + Math.random() * 0.6 + i * 0.25,
        color: palette[i % palette.length],
      });
    }
  }

  update(dt: number) {
    this.time += dt;
    // Shake: decaying noise offset.
    this.shakeTime += dt;
    const k = Math.max(0, 1 - this.shakeTime / this.shakeDuration);
    const s = this.shakeStrength * k * k;
    this.shakeOffset.set(Math.sin(this.time * 71) * s, Math.sin(this.time * 83 + 1.3) * s, Math.sin(this.time * 67 + 2.1) * s * 0.6);

    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.age += dt;
      const t = r.age / r.life;
      if (t >= 1) {
        this.fxScene.remove(r.mesh);
        (r.mesh.material as THREE.Material).dispose();
        this.rings.splice(i, 1);
        continue;
      }
      const e = 1 - Math.pow(1 - t, 3);
      r.mesh.scale.setScalar(Math.max(0.1, e * r.radius));
      ((r.mesh.material as THREE.RawShaderMaterial).uniforms.uIntensity as { value: number }).value = 3 * (1 - t);
    }

    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.travelled += t.speed * dt;
      const head = Math.min(t.length, t.travelled);
      const tail = Math.max(0, t.travelled - t.streak);
      if (tail >= t.length) {
        this.fxScene.remove(t.mesh);
        t.material.dispose();
        this.tracers.splice(i, 1);
        continue;
      }
      t.mesh.position.copy(t.from).addScaledVector(t.dir, tail);
      t.mesh.scale.z = Math.max(0.001, head - tail);
    }
    for (let i = this.decals.length - 1; i >= 0; i--) {
      const d = this.decals[i];
      d.age += dt;
      if (d.age > 8) {
        this.fxScene.remove(d.mesh);
        this.decals.splice(i, 1);
      } else if (d.age > 6) d.mesh.scale.setScalar(Math.max(0.01, (8 - d.age) / 2));
    }
    for (let i = this.glows.length - 1; i >= 0; i--) {
      const g = this.glows[i];
      g.age += dt;
      const cam = this.cameraPos?.();
      if (cam) g.mesh.lookAt(cam.x, cam.y, cam.z);
      if (g.age > 0.06) {
        this.fxScene.remove(g.mesh);
        (g.mesh.material as THREE.Material).dispose();
        this.glows.splice(i, 1);
      }
    }

    for (let i = this.rockets.length - 1; i >= 0; i--) {
      const r = this.rockets[i];
      r.fuse -= dt;
      r.vel.y -= 9 * dt;
      r.pos.addScaledVector(r.vel, dt);
      this.dots.burstColor(r.pos.x, r.pos.y, r.pos.z, [1, 0.7, 0.4], { count: 1, speed: 0.3, up: 0, size: 0.06, glow: 1, life: 0.4, gravity: 2, collide: false });
      if (r.fuse <= 0) {
        this.dots.burstColor(r.pos.x, r.pos.y, r.pos.z, r.color, { count: 90, speed: 9, up: 0, size: 0.13, glow: 1.2, life: 1.3, gravity: 4, drag: 1.6, collide: false, spread: 0 });
        this.rockets.splice(i, 1);
      }
    }
  }

  clear() {
    for (const r of this.rings) this.fxScene.remove(r.mesh);
    this.rings = [];
    for (const t of this.tracers) this.fxScene.remove(t.mesh);
    this.tracers = [];
    for (const d of this.decals) this.fxScene.remove(d.mesh);
    this.decals = [];
    for (const g of this.glows) this.fxScene.remove(g.mesh);
    this.glows = [];
    this.rockets = [];
    this.shakeStrength = 0;
  }
}
