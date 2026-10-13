import * as THREE from 'three';
import { Shaders } from './shaders';
import type { Environment } from './environment';
import { engine } from '../engine/wasm';

export interface RenderSettings {
  msaa: number;
  shadowRes: number;
  shadowDistance: number;
  bloom: boolean;
  godrays: boolean;
  ssr: boolean;
  renderScale: number;
  clouds: boolean;
}

export const LAYER_CHUNKS = 1;

export interface FrameHooks {
  /** Set draw ranges for the shadow pass given the light's view-projection matrix. */
  shadowCull(vp: THREE.Matrix4): void;
  /** Set draw ranges for the main camera; whether any water is on screen. */
  mainCull(): boolean;
}

type Uniform<T> = { value: T };

export interface SharedUniforms {
  [key: string]: Uniform<unknown>;
  uTime: Uniform<number>;
  uWind: Uniform<THREE.Vector4>;
  uSunDir: Uniform<THREE.Vector3>;
  uLightDir: Uniform<THREE.Vector3>;
  uLightColor: Uniform<THREE.Vector3>;
  uAmbientSky: Uniform<THREE.Vector3>;
  uAmbientGround: Uniform<THREE.Vector3>;
  uBlockLight: Uniform<THREE.Vector3>;
  uMinLight: Uniform<THREE.Vector3>;
  uFog: Uniform<THREE.Vector4>;
  uVoid: Uniform<number>;
  uShadowParams: Uniform<THREE.Vector4>;
  uShadowFromView: Uniform<THREE.Matrix4>;
  uShadowMap: Uniform<THREE.Texture | null>;
  uSkyLut: Uniform<THREE.Texture | null>;
  uNoise: Uniform<THREE.Texture>;
  uCloud: Uniform<THREE.Vector4>;
  uAlbedo: Uniform<THREE.Texture>;
  uMaterial: Uniform<THREE.Texture>;
  uBiome: Uniform<THREE.Texture>;
}

const BIAS = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
const SHADOW_DEPTH = 400;

function fullscreenGeometry(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  return g;
}

function passMaterial(frag: { vertex: string; fragment: string }, uniforms: Record<string, Uniform<unknown>>, extra: Partial<THREE.ShaderMaterialParameters> = {}) {
  return new THREE.RawShaderMaterial({
    vertexShader: frag.vertex,
    fragmentShader: frag.fragment,
    uniforms,
    glslVersion: THREE.GLSL3,
    depthTest: false,
    depthWrite: false,
    ...extra,
  });
}

export class Renderer {
  readonly gl: THREE.WebGLRenderer;
  readonly uniforms: SharedUniforms;
  readonly opaqueScene = new THREE.Scene();
  readonly waterScene = new THREE.Scene();
  /** Lit dynamic objects (mobs, items, projectiles); cast shadows via `customDepthMaterial`. */
  readonly entityScene = new THREE.Scene();
  /** Additive effects drawn after water (beams, shockwaves, halos). */
  readonly fxScene = new THREE.Scene();
  readonly materials: {
    opaque: THREE.RawShaderMaterial;
    cutout: THREE.RawShaderMaterial;
    water: THREE.RawShaderMaterial;
    shadow: THREE.RawShaderMaterial;
  };
  readonly shadowCamera = new THREE.OrthographicCamera();
  settings: RenderSettings;
  width = 1;
  height = 1;
  stats = { calls: 0, triangles: 0, shadowCalls: 0 };
  /** Drawn last into the HDR target without depth testing (first-person held item). */
  overlay: { scene: THREE.Scene; camera: THREE.Camera } | null = null;
  /** Distance (blocks) at which terrain is fully faded into the sky; set from render distance. */
  fogEnd = 190;

  private sceneRT!: THREE.WebGLRenderTarget;
  private copyRT!: THREE.WebGLRenderTarget;
  private raysRT!: THREE.WebGLRenderTarget;
  private bloomRTs: THREE.WebGLRenderTarget[] = [];
  private shadowRT: THREE.WebGLRenderTarget | null = null;
  private lutRT: THREE.WebGLRenderTarget;
  private fsScene = new THREE.Scene();
  private fsCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private fsMesh: THREE.Mesh;
  private skyMesh: THREE.Mesh;
  private mats: Record<string, THREE.RawShaderMaterial> = {};
  private lastLutSun = new THREE.Vector3(9, 9, 9);
  private lutFrames = 0;
  private tmpM = new THREE.Matrix4();
  private tmpV = new THREE.Vector3();
  private vp = new THREE.Matrix4();

  constructor(canvas: HTMLCanvasElement, settings: RenderSettings, noise: THREE.Texture, torchLayer: number) {
    this.settings = { ...settings };
    this.gl = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      depth: true,
      stencil: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
    });
    this.gl.autoClear = false;
    this.gl.info.autoReset = false;
    this.gl.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.gl.toneMapping = THREE.NoToneMapping;
    this.gl.sortObjects = true;

    this.lutRT = new THREE.WebGLRenderTarget(256, 128, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      depthBuffer: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.RepeatWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      generateMipmaps: false,
    });

    this.uniforms = {
      uTime: { value: 0 },
      uWind: { value: new THREE.Vector4() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uLightDir: { value: new THREE.Vector3(0, 1, 0) },
      uLightColor: { value: new THREE.Vector3(1, 1, 1) },
      uAmbientSky: { value: new THREE.Vector3(0.3, 0.4, 0.6) },
      uAmbientGround: { value: new THREE.Vector3(0.1, 0.1, 0.1) },
      uBlockLight: { value: new THREE.Vector3(1.0, 0.6, 0.28).multiplyScalar(0.95) },
      uMinLight: { value: new THREE.Vector3(0.006, 0.007, 0.011) },
      uFog: { value: new THREE.Vector4(0.0015, 150, 190, 0) },
      uVoid: { value: 0 },
      uShadowParams: { value: new THREE.Vector4(1 / 2048, 96, 0.08, 0) },
      uShadowFromView: { value: new THREE.Matrix4() },
      uShadowMap: { value: null },
      uSkyLut: { value: this.lutRT.texture },
      uNoise: { value: noise },
      uCloud: { value: new THREE.Vector4() },
      uAlbedo: { value: new THREE.Texture() },
      uMaterial: { value: new THREE.Texture() },
      uBiome: { value: new THREE.Texture() },
    };
    const U = this.uniforms;

    const chunkMat = (cutout: boolean) =>
      new THREE.RawShaderMaterial({
        vertexShader: Shaders.chunk.vertex,
        fragmentShader: Shaders.chunk.fragment,
        uniforms: { ...U },
        glslVersion: THREE.GLSL3,
        defines: cutout ? { CUTOUT: 1, TORCH_LAYER: torchLayer } : { TORCH_LAYER: torchLayer },
        side: cutout ? THREE.DoubleSide : THREE.FrontSide,
        alphaToCoverage: cutout,
      });
    this.materials = {
      opaque: chunkMat(false),
      cutout: chunkMat(true),
      water: new THREE.RawShaderMaterial({
        vertexShader: Shaders.water.vertex,
        fragmentShader: Shaders.water.fragment,
        uniforms: {
          ...U,
          uSceneCopy: { value: null },
          uResolution: { value: new THREE.Vector2(1, 1) },
          uFar: { value: 1000 },
          uSSR: { value: 1 },
        },
        glslVersion: THREE.GLSL3,
        defines: { TORCH_LAYER: torchLayer },
        side: THREE.DoubleSide,
      }),
      shadow: new THREE.RawShaderMaterial({
        vertexShader: Shaders.shadow.vertex,
        fragmentShader: Shaders.shadow.fragment,
        uniforms: { uTime: U.uTime, uWind: U.uWind, uAlbedo: U.uAlbedo },
        glslVersion: THREE.GLSL3,
        defines: { TORCH_LAYER: torchLayer },
        side: THREE.DoubleSide,
        colorWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: 1.1,
        polygonOffsetUnits: 2.0,
      }),
    };

    const fsGeo = fullscreenGeometry();
    this.fsMesh = new THREE.Mesh(fsGeo);
    this.fsMesh.frustumCulled = false;
    this.fsScene.add(this.fsMesh);
    this.fsScene.matrixWorldAutoUpdate = false;

    this.mats.skyLut = passMaterial(Shaders.skyLut, {
      uSunDir: U.uSunDir,
      uMoonDir: { value: new THREE.Vector3() },
      uSunIntensity: { value: 22 },
      uMoonIntensity: { value: 0.9 },
    });
    this.mats.sky = new THREE.RawShaderMaterial({
      vertexShader: Shaders.sky.vertex,
      fragmentShader: Shaders.sky.fragment,
      uniforms: {
        ...U,
        uInvViewProj: { value: new THREE.Matrix4() },
        uMoonDir: { value: new THREE.Vector3() },
        uSunDisk: { value: new THREE.Vector3() },
        uMoonDisk: { value: new THREE.Vector3() },
        uNight: { value: 0 },
        uStarRot: { value: new THREE.Matrix3() },
        uCameraPos: { value: new THREE.Vector3() },
      },
      glslVersion: THREE.GLSL3,
      depthTest: true,
      depthWrite: false,
    });
    this.skyMesh = new THREE.Mesh(fsGeo, this.mats.sky);
    this.skyMesh.frustumCulled = false;
    this.skyMesh.renderOrder = 1e6;
    this.opaqueScene.add(this.skyMesh);
    this.opaqueScene.matrixWorldAutoUpdate = false;
    this.waterScene.matrixWorldAutoUpdate = false;

    this.mats.copy = passMaterial(Shaders.copy, {
      uColor: { value: null },
      uDepth: { value: null },
      uNear: { value: 0.1 },
      uFar: { value: 1000 },
    });
    this.mats.bloomDown = passMaterial(Shaders.bloomDown, {
      uSrc: { value: null },
      uTexel: { value: new THREE.Vector2() },
      uPrefilter: { value: 0 },
      uThreshold: { value: new THREE.Vector4(1.1, 0.6, 0, 0) },
    });
    this.mats.bloomUp = passMaterial(
      Shaders.bloomUp,
      { uSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uRadius: { value: 1.0 } },
      { blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendEquation: THREE.AddEquation },
    );
    this.mats.godrays = passMaterial(Shaders.godrays, {
      uDepth: { value: null },
      uSunUV: { value: new THREE.Vector2() },
      uAspect: { value: 1 },
      uIntensity: { value: 1 },
    });
    this.mats.composite = passMaterial(Shaders.composite, {
      uScene: { value: null },
      uDepth: { value: null },
      uBloom: { value: null },
      uRays: { value: null },
      uBloomStrength: { value: 0.06 },
      uRayColor: { value: new THREE.Vector3() },
      uExposure: { value: 1 },
      uUnderwater: { value: 0 },
      uWaterFog: { value: new THREE.Vector3() },
      uNear: { value: 0.1 },
      uFar: { value: 1000 },
      uTime: U.uTime,
      uSaturation: { value: 1.03 },
      uVignette: { value: 0.28 },
      uResolution: { value: new THREE.Vector2() },
    });

    this.shadowCamera.matrixAutoUpdate = false;
    this.shadowCamera.matrixWorldAutoUpdate = false;
    this.shadowCamera.layers.set(LAYER_CHUNKS);

    this.createTargets(1, 1);
    this.applySettings(settings);
  }

  setTextures(albedo: THREE.Texture, material: THREE.Texture, biome: THREE.Texture) {
    this.uniforms.uAlbedo.value = albedo;
    this.uniforms.uMaterial.value = material;
    this.uniforms.uBiome.value = biome;
  }

  /** Compile every program up front so the first frames don't stall. */
  warmup(camera: THREE.Camera) {
    this.gl.compile(this.opaqueScene, camera);
  }

  applySettings(s: RenderSettings) {
    const prev = this.settings;
    this.settings = { ...s };
    if (!this.sceneRT || prev.msaa !== s.msaa || prev.renderScale !== s.renderScale) {
      this.createTargets(this.width, this.height);
    }
    // Shadows off keeps a 1x1 map, never drawn into: the shaders' shadow sampler must always have
    // a depth texture that compares (with none, three.js binds one that doesn't, and every draw
    // that samples it fails: the terrain vanished).
    const res = Math.max(1, s.shadowRes);
    if (res !== (this.shadowRT?.width ?? 0)) {
      this.shadowRT?.dispose();
      const depth = new THREE.DepthTexture(res, res, THREE.UnsignedIntType);
      depth.compareFunction = THREE.LessEqualCompare;
      depth.minFilter = THREE.LinearFilter;
      depth.magFilter = THREE.LinearFilter;
      this.shadowRT = new THREE.WebGLRenderTarget(res, res, {
        format: THREE.RedFormat,
        type: THREE.UnsignedByteType,
        depthBuffer: true,
        depthTexture: depth,
        generateMipmaps: false,
      });
      // Made on the GPU now (cleared to the far plane), not at its first shadow pass.
      const was = this.gl.getRenderTarget();
      this.gl.setRenderTarget(this.shadowRT);
      this.gl.clear(false, true, false);
      this.gl.setRenderTarget(was);
    }
    this.uniforms.uShadowMap.value = this.shadowRT!.depthTexture;
    const radius = s.shadowDistance;
    this.uniforms.uShadowParams.value.set(1 / Math.max(1, s.shadowRes), radius, ((2 * radius) / Math.max(1, s.shadowRes)) * 1.8, s.shadowRes > 0 ? 1 : 0);
    (this.materials.water.uniforms.uSSR as Uniform<number>).value = s.ssr ? 1 : 0;
  }

  setSize(cssWidth: number, cssHeight: number, dpr: number) {
    this.gl.setPixelRatio(dpr);
    this.gl.setSize(cssWidth, cssHeight, false);
    const w = Math.max(1, Math.floor(cssWidth * dpr));
    const h = Math.max(1, Math.floor(cssHeight * dpr));
    this.width = w;
    this.height = h;
    this.createTargets(w, h);
  }

  private createTargets(w: number, h: number) {
    const s = this.settings;
    const sw = Math.max(1, Math.floor(w * (s?.renderScale ?? 1)));
    const sh = Math.max(1, Math.floor(h * (s?.renderScale ?? 1)));
    this.sceneRT?.dispose();
    this.copyRT?.dispose();
    this.raysRT?.dispose();
    for (const rt of this.bloomRTs) rt.dispose();
    this.bloomRTs = [];

    const depth = new THREE.DepthTexture(sw, sh, THREE.UnsignedIntType);
    this.sceneRT = new THREE.WebGLRenderTarget(sw, sh, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      samples: s?.msaa ?? 0,
      depthBuffer: true,
      stencilBuffer: false,
      depthTexture: depth,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: false,
    });
    this.copyRT = new THREE.WebGLRenderTarget(sw, sh, {
      // Full floats where they can be drawn to (most screens); half floats where not (some phones).
      type: this.gl.extensions.has('EXT_color_buffer_float') ? THREE.FloatType : THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      depthBuffer: false,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      generateMipmaps: false,
    });
    const half = { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false } as const;
    this.raysRT = new THREE.WebGLRenderTarget(Math.max(1, sw >> 1), Math.max(1, sh >> 1), half);
    let bw = Math.max(1, sw >> 1);
    let bh = Math.max(1, sh >> 1);
    for (let i = 0; i < 6; i++) {
      this.bloomRTs.push(new THREE.WebGLRenderTarget(bw, bh, half));
      bw = Math.max(1, bw >> 1);
      bh = Math.max(1, bh >> 1);
    }
    const water = this.materials?.water;
    if (water) {
      (water.uniforms.uSceneCopy as Uniform<THREE.Texture>).value = this.copyRT.texture;
      (water.uniforms.uResolution as Uniform<THREE.Vector2>).value.set(sw, sh);
    }
  }

  private swapped: { mesh: THREE.Mesh; material: THREE.Material }[] = [];

  /** Entities use their `customDepthMaterial` (alpha-tested, per atlas) in the shadow pass. */
  private renderEntityShadows(sc: THREE.Camera) {
    const list = this.swapped;
    list.length = 0;
    this.entityScene.traverseVisible((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.customDepthMaterial) {
        list.push({ mesh: m, material: m.material as THREE.Material });
        m.material = m.customDepthMaterial;
      }
    });
    if (list.length === 0) return;
    const mask = sc.layers.mask;
    sc.layers.enableAll();
    this.gl.render(this.entityScene, sc);
    sc.layers.mask = mask;
    for (const s of list) s.mesh.material = s.material;
  }

  private pass(material: THREE.Material, target: THREE.WebGLRenderTarget | null) {
    this.fsMesh.material = material;
    this.gl.setRenderTarget(target);
    this.gl.render(this.fsScene, this.fsCamera);
  }

  private updateUniforms(env: Environment, camera: THREE.PerspectiveCamera) {
    const U = this.uniforms;
    U.uTime.value = env.elapsed;
    U.uWind.value.copy(env.wind);
    U.uSunDir.value.copy(env.sunDir);
    U.uLightDir.value.copy(env.lightDir);
    U.uLightColor.value.copy(env.lightColor);
    U.uAmbientSky.value.copy(env.ambientSky);
    U.uAmbientGround.value.copy(env.ambientGround);
    U.uCloud.value.copy(env.cloud);
    if (!this.settings.clouds) U.uCloud.value.x = -1;
    U.uFog.value.set(env.hazeDensity, this.fogEnd * 0.62, this.fogEnd, 0);
    const sky = this.mats.sky.uniforms;
    (sky.uMoonDir as Uniform<THREE.Vector3>).value.copy(env.moonDir);
    (sky.uSunDisk as Uniform<THREE.Vector3>).value.copy(env.sunDisk);
    (sky.uMoonDisk as Uniform<THREE.Vector3>).value.copy(env.moonDisk);
    (sky.uNight as Uniform<number>).value = env.nightFactor;
    (sky.uStarRot as Uniform<THREE.Matrix3>).value.copy(env.starRot);
    (sky.uCameraPos as Uniform<THREE.Vector3>).value.copy(camera.position);
    // Inverse of (projection * rotation-only view) for per-pixel view rays.
    this.tmpM.copy(camera.matrixWorldInverse).setPosition(0, 0, 0);
    this.tmpM.premultiply(camera.projectionMatrix).invert();
    (sky.uInvViewProj as Uniform<THREE.Matrix4>).value.copy(this.tmpM);
    const lut = this.mats.skyLut.uniforms;
    (lut.uMoonDir as Uniform<THREE.Vector3>).value.copy(env.moonDir);
    (lut.uSunIntensity as Uniform<number>).value = env.sunIntensity;
    (lut.uMoonIntensity as Uniform<number>).value = env.moonIntensity;
  }

  render(camera: THREE.PerspectiveCamera, env: Environment, hooks: FrameHooks, underwater: number) {
    const gl = this.gl;
    gl.info.reset();
    this.updateUniforms(env, camera);

    // 1. Sky LUT (only when the sun moved noticeably).
    this.lutFrames++;
    if (this.lastLutSun.distanceToSquared(env.sunDir) > 1e-7 || this.lutFrames > 30) {
      this.pass(this.mats.skyLut, this.lutRT);
      this.lastLutSun.copy(env.sunDir);
      this.lutFrames = 0;
    }

    // 2. Shadow map.
    const s = this.settings;
    if (this.shadowRT && s.shadowRes > 0 && env.lightDir.y > 0.02) {
      const m = engine.shadow_camera(
        new Float64Array([env.lightDir.x, env.lightDir.y, env.lightDir.z]),
        new Float64Array([camera.position.x, camera.position.y, camera.position.z]),
        s.shadowDistance,
        SHADOW_DEPTH,
        s.shadowRes,
      );
      const sc = this.shadowCamera;
      sc.matrixWorldInverse.fromArray(m, 0);
      sc.matrixWorld.copy(sc.matrixWorldInverse).invert();
      sc.projectionMatrix.fromArray(m, 16);
      sc.projectionMatrixInverse.copy(sc.projectionMatrix).invert();
      this.vp.multiplyMatrices(sc.projectionMatrix, sc.matrixWorldInverse);
      hooks.shadowCull(this.vp);
      gl.setRenderTarget(this.shadowRT);
      gl.clear(false, true, false);
      this.opaqueScene.overrideMaterial = this.materials.shadow;
      gl.render(this.opaqueScene, sc);
      this.opaqueScene.overrideMaterial = null;
      this.renderEntityShadows(sc);
      this.stats.shadowCalls = gl.info.render.calls;
      this.uniforms.uShadowFromView.value.multiplyMatrices(BIAS, this.vp).multiply(camera.matrixWorld);
      this.uniforms.uShadowParams.value.w = 1;
    } else {
      this.uniforms.uShadowParams.value.w = 0;
      this.stats.shadowCalls = 0;
    }

    // 3. Opaque + cutout + sky into the HDR target.
    const water = hooks.mainCull();
    gl.setRenderTarget(this.sceneRT);
    gl.setClearColor(0x000000, 1);
    gl.clear(true, true, false);
    gl.render(this.opaqueScene, camera);
    gl.render(this.entityScene, camera);

    // 4. Copy colour + linear depth for water refraction / reflections (a full-screen float
    // target: only when there's water on screen to read it).
    if (water) {
      const copy = this.mats.copy.uniforms;
      (copy.uColor as Uniform<THREE.Texture>).value = this.sceneRT.texture;
      (copy.uDepth as Uniform<THREE.Texture | null>).value = this.sceneRT.depthTexture;
      (copy.uNear as Uniform<number>).value = camera.near;
      (copy.uFar as Uniform<number>).value = camera.far;
      this.pass(this.mats.copy, this.copyRT);
    }

    // 5. Water.
    (this.materials.water.uniforms.uFar as Uniform<number>).value = camera.far;
    gl.setRenderTarget(this.sceneRT);
    gl.render(this.waterScene, camera);
    gl.render(this.fxScene, camera);
    if (this.overlay) gl.render(this.overlay.scene, this.overlay.camera);

    // 6. God rays.
    let rays = 0;
    if (s.godrays && env.sunDir.y > -0.05) {
      this.tmpV.copy(env.sunDir).multiplyScalar(1000).add(camera.position).project(camera);
      const facing = this.tmpV.z < 1;
      const onScreen = Math.max(Math.abs(this.tmpV.x), Math.abs(this.tmpV.y));
      rays = facing ? Math.max(0, 1 - Math.max(0, onScreen - 1) * 0.8) : 0;
      if (rays > 0.001) {
        const g = this.mats.godrays.uniforms;
        (g.uDepth as Uniform<THREE.Texture | null>).value = this.sceneRT.depthTexture;
        (g.uSunUV as Uniform<THREE.Vector2>).value.set(this.tmpV.x * 0.5 + 0.5, this.tmpV.y * 0.5 + 0.5);
        (g.uAspect as Uniform<number>).value = this.sceneRT.width / this.sceneRT.height;
        (g.uIntensity as Uniform<number>).value = rays * (underwater > 0 ? 0.3 : 1);
        this.pass(this.mats.godrays, this.raysRT);
      }
    }

    // 7. Bloom.
    if (s.bloom) {
      const d = this.mats.bloomDown.uniforms;
      let src: THREE.Texture = this.sceneRT.texture;
      let sw = this.sceneRT.width;
      let sh = this.sceneRT.height;
      for (let i = 0; i < this.bloomRTs.length; i++) {
        (d.uSrc as Uniform<THREE.Texture>).value = src;
        (d.uTexel as Uniform<THREE.Vector2>).value.set(1 / sw, 1 / sh);
        (d.uPrefilter as Uniform<number>).value = i === 0 ? 1 : 0;
        this.pass(this.mats.bloomDown, this.bloomRTs[i]);
        src = this.bloomRTs[i].texture;
        sw = this.bloomRTs[i].width;
        sh = this.bloomRTs[i].height;
      }
      const u = this.mats.bloomUp.uniforms;
      for (let i = this.bloomRTs.length - 1; i > 0; i--) {
        const from = this.bloomRTs[i];
        (u.uSrc as Uniform<THREE.Texture>).value = from.texture;
        (u.uTexel as Uniform<THREE.Vector2>).value.set(1 / from.width, 1 / from.height);
        this.pass(this.mats.bloomUp, this.bloomRTs[i - 1]);
      }
    }

    // 8. Composite to the screen.
    const c = this.mats.composite.uniforms;
    (c.uScene as Uniform<THREE.Texture>).value = this.sceneRT.texture;
    (c.uDepth as Uniform<THREE.Texture | null>).value = this.sceneRT.depthTexture;
    (c.uBloom as Uniform<THREE.Texture>).value = this.bloomRTs[0].texture;
    (c.uBloomStrength as Uniform<number>).value = s.bloom ? 0.055 : 0;
    (c.uRays as Uniform<THREE.Texture>).value = this.raysRT.texture;
    (c.uRayColor as Uniform<THREE.Vector3>).value.copy(env.rayColor).multiplyScalar(rays > 0.001 ? 0.9 : 0);
    (c.uExposure as Uniform<number>).value = env.exposure;
    (c.uUnderwater as Uniform<number>).value = underwater;
    (c.uWaterFog as Uniform<THREE.Vector3>).value.copy(underwater > 1.5 ? new THREE.Vector3(1.6, 0.35, 0.05) : env.waterFog);
    (c.uNear as Uniform<number>).value = camera.near;
    (c.uFar as Uniform<number>).value = camera.far;
    (c.uResolution as Uniform<THREE.Vector2>).value.set(this.width, this.height);
    this.pass(this.mats.composite, null);

    this.stats.calls = gl.info.render.calls;
    this.stats.triangles = gl.info.render.triangles;
  }
}
