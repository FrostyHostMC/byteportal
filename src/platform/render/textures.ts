import * as THREE from 'three';
import { engine } from '../engine/wasm';

export const BIOME_MAP_SIZE = 1024;

export interface TextureSet {
  albedo: THREE.DataArrayTexture;
  material: THREE.DataArrayTexture;
  /** Raw sRGB albedo bytes (layer-major, 16x16 RGBA) for UI icons and particles. */
  albedoData: Uint8Array;
  layers: number;
  /** Which game's own textures follow the built-in ones (`GameBlocks.textureKey`; '' for none). */
  key: string;
}

let builtinLayers: { albedo: Uint8Array; material: Uint8Array } | null = null;

/** The built-in block textures' pixels (painted once per page). */
export function builtinTextures(): { albedo: Uint8Array; material: Uint8Array } {
  if (builtinLayers) return builtinLayers;
  const n = engine.texture_layer_count() * 16 * 16 * 4;
  const all = engine.generate_textures();
  return (builtinLayers = { albedo: all.slice(0, n), material: all.slice(n, 2 * n) });
}

/**
 * The block texture arrays: the built-in layers, then a game's own (`extra`, painted by
 * `paintGameTextures`) after them.
 */
export function createBlockTextures(renderer: THREE.WebGLRenderer, extra?: { albedo: Uint8Array; material: Uint8Array; key: string }): TextureSet {
  const base = builtinTextures();
  const join = (a: Uint8Array, b?: Uint8Array) => {
    if (!b?.length) return a.slice();
    const out = new Uint8Array(a.length + b.length);
    out.set(a);
    out.set(b, a.length);
    return out;
  };
  const albedoData = join(base.albedo, extra?.albedo);
  const materialData = join(base.material, extra?.material);
  const layers = albedoData.length / (16 * 16 * 4);
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  const albedo = new THREE.DataArrayTexture(albedoData, 16, 16, layers);
  albedo.format = THREE.RGBAFormat;
  albedo.type = THREE.UnsignedByteType;
  albedo.colorSpace = THREE.SRGBColorSpace;
  albedo.magFilter = THREE.NearestFilter;
  albedo.minFilter = THREE.LinearMipmapLinearFilter;
  albedo.wrapS = albedo.wrapT = THREE.RepeatWrapping;
  albedo.generateMipmaps = true;
  albedo.anisotropy = aniso;
  albedo.needsUpdate = true;

  const material = new THREE.DataArrayTexture(materialData, 16, 16, layers);
  material.format = THREE.RGBAFormat;
  material.type = THREE.UnsignedByteType;
  material.colorSpace = THREE.NoColorSpace;
  material.magFilter = THREE.NearestFilter;
  material.minFilter = THREE.LinearMipmapLinearFilter;
  material.wrapS = material.wrapT = THREE.RepeatWrapping;
  material.generateMipmaps = true;
  material.anisotropy = aniso;
  material.needsUpdate = true;

  return { albedo, material, albedoData, layers, key: extra?.key ?? '' };
}

export function createNoiseTexture(): THREE.DataTexture {
  const size = 256;
  const data = engine.noise_texture(size);
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Toroidal biome colour map: texel (x mod 1024, z mod 1024) holds the grass tint of world column
 * (x, z). Chunks upload their 16x16 tile when they are generated.
 */
export class BiomeMap {
  readonly texture: THREE.DataTexture;
  private tile: THREE.DataTexture;
  private tileData = new Uint8Array(16 * 16 * 4);
  private pos = new THREE.Vector2();

  constructor(private renderer: THREE.WebGLRenderer) {
    const data = new Uint8Array(BIOME_MAP_SIZE * BIOME_MAP_SIZE * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 120;
      data[i + 1] = 185;
      data[i + 2] = 80;
      data[i + 3] = 255;
    }
    this.texture = new THREE.DataTexture(data, BIOME_MAP_SIZE, BIOME_MAP_SIZE, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.wrapS = this.texture.wrapT = THREE.RepeatWrapping;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;
    this.texture.needsUpdate = true;
    this.tile = new THREE.DataTexture(this.tileData, 16, 16, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.tile.colorSpace = THREE.SRGBColorSpace;
  }

  /** `rgb` is 16x16x3 sRGB, index (z * 16 + x) * 3. */
  upload(cx: number, cz: number, rgb: Uint8Array) {
    const d = this.tileData;
    for (let i = 0, j = 0; i < 256; i++, j += 3) {
      d[i * 4] = rgb[j];
      d[i * 4 + 1] = rgb[j + 1];
      d[i * 4 + 2] = rgb[j + 2];
      d[i * 4 + 3] = 255;
    }
    const x = ((cx * 16) % BIOME_MAP_SIZE + BIOME_MAP_SIZE) % BIOME_MAP_SIZE;
    const z = ((cz * 16) % BIOME_MAP_SIZE + BIOME_MAP_SIZE) % BIOME_MAP_SIZE;
    this.pos.set(x, z);
    this.renderer.copyTextureToTexture(this.tile, this.texture, null, this.pos);
  }
}
