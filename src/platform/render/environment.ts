import * as THREE from 'three';

const smoothstep = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Sun path tilt: the sun passes south of the zenith so noon shadows have direction. */
const TILT = 0.42;
/** Relative extinction of sunlight per unit airmass (Rayleigh + aerosols + ozone). */
const EXTINCTION = [0.052, 0.12, 0.27];

/**
 * Time of day, sun / moon, light colours, fog, wind and cloud state. All values are in linear
 * HDR units shared by the terrain, water, sky and post-processing shaders.
 */
export class Environment {
  /** Day fraction: 0 = midnight, 0.25 = sunrise, 0.5 = noon, 0.75 = sunset. */
  time = 0.3;
  dayLength = 1200;
  paused = false;
  elapsed = 0;

  readonly sunDir = new THREE.Vector3();
  readonly moonDir = new THREE.Vector3();
  readonly lightDir = new THREE.Vector3();
  readonly lightColor = new THREE.Vector3();
  readonly sunTransmittance = new THREE.Vector3();
  readonly ambientSky = new THREE.Vector3();
  readonly ambientGround = new THREE.Vector3();
  readonly sunDisk = new THREE.Vector3();
  readonly moonDisk = new THREE.Vector3();
  readonly rayColor = new THREE.Vector3();
  readonly waterFog = new THREE.Vector3();
  readonly starRot = new THREE.Matrix3();
  readonly wind = new THREE.Vector4(0.6, 0.25, 1, 0);
  readonly cloud = new THREE.Vector4(0.45, 0, 0, 232);
  sunIntensity = 22;
  moonIntensity = 0.9;
  dayFactor = 1;
  nightFactor = 0;
  exposure = 1;
  hazeDensity = 0.0016;
  private cloudPhase = Math.random() * 1000;

  update(dt: number) {
    this.elapsed += dt;
    if (!this.paused) this.time = (this.time + dt / this.dayLength) % 1;
    const theta = (this.time - 0.25) * Math.PI * 2;
    this.sunDir.set(Math.cos(theta), Math.sin(theta) * Math.cos(TILT), Math.sin(theta) * Math.sin(TILT)).normalize();
    this.moonDir.copy(this.sunDir).negate();
    const sunY = this.sunDir.y;

    // Direct light: sun by day, moon by night, crossfading through twilight.
    const airmass = 1 / (Math.max(sunY, 0) + 0.15 * Math.pow(Math.max(93.885 - (Math.asin(Math.max(-1, Math.min(1, sunY))) * 180) / Math.PI, 0.1), -1.253));
    for (let i = 0; i < 3; i++) this.sunTransmittance.setComponent(i, Math.exp(-EXTINCTION[i] * Math.min(airmass, 40)));
    const sunUp = smoothstep(-0.03, 0.08, sunY);
    const moonUp = smoothstep(-0.03, 0.1, -sunY);
    this.dayFactor = smoothstep(-0.14, 0.12, sunY);
    this.nightFactor = smoothstep(0.02, -0.16, sunY);

    const sunI = 2.4 * sunUp;
    const moonI = 0.2 * moonUp;
    if (sunY > -0.02) {
      this.lightDir.copy(this.sunDir);
      this.lightColor.copy(this.sunTransmittance).multiplyScalar(sunI);
    } else {
      this.lightDir.copy(this.moonDir);
      this.lightColor.set(0.42, 0.55, 0.85).multiplyScalar(moonI);
    }

    // Sky ambient: bright blue by day, warm/purple at twilight, deep blue at night.
    const high = smoothstep(0.05, 0.5, sunY);
    const day = new THREE.Vector3(0.4, 0.54, 0.8).multiplyScalar(lerp(0.7, 1.0, high));
    const dusk = new THREE.Vector3(0.52, 0.44, 0.56).multiplyScalar(0.62);
    const night = new THREE.Vector3(0.03, 0.042, 0.08);
    const dayAmb = new THREE.Vector3().lerpVectors(dusk, day, high);
    this.ambientSky.lerpVectors(night, dayAmb, this.dayFactor);
    this.ambientGround.copy(this.ambientSky).multiply(new THREE.Vector3(0.62, 0.55, 0.44)).multiplyScalar(0.55);
    this.ambientGround.addScaledVector(this.sunTransmittance, 0.07 * sunUp);

    this.sunDisk.copy(this.sunTransmittance).multiplyScalar(70 * sunUp);
    this.moonDisk.set(0.9, 0.95, 1.1).multiplyScalar(1.2 * moonUp);
    this.rayColor.copy(this.sunTransmittance).multiplyScalar(lerp(0.55, 1.4, 1 - high) * sunUp);

    this.exposure = lerp(1.9, 1.0, this.dayFactor);
    const morning = smoothstep(0.2, 0.26, this.time) * smoothstep(0.34, 0.28, this.time);
    this.hazeDensity = 0.0014 + morning * 0.0035;

    this.waterFog.set(0.02, 0.1, 0.13).multiplyScalar(lerp(0.12, 1.0, this.dayFactor));

    // Stars rotate with the sky around the same axis as the sun.
    const axis = new THREE.Vector3(0, -Math.sin(TILT), Math.cos(TILT));
    const m4 = new THREE.Matrix4().makeRotationAxis(axis, -theta);
    this.starRot.setFromMatrix4(m4);

    // Wind and weather drift slowly.
    const t = this.elapsed;
    this.wind.set(Math.cos(t * 0.013) * 0.6, Math.sin(t * 0.017) * 0.4, 0.85 + 0.25 * Math.sin(t * 0.05), t * 0.1);
    this.cloud.x = 0.42 + 0.22 * Math.sin((t + this.cloudPhase) * 0.004) + 0.08 * Math.sin((t + this.cloudPhase) * 0.013);
    this.cloud.y += dt * 0.0000085 * (1 + this.wind.x);
    this.cloud.z += dt * 0.0000055;
  }

  /** Human-readable clock (HH:MM) for the debug overlay. */
  clock(): string {
    const minutes = Math.floor(this.time * 24 * 60);
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
}
