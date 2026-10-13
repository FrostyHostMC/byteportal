import { kept } from './client/storage';
import { sanitize, type KeyBindings } from './player/keys';
import type { RenderSettings } from './render/pipeline';

export type ShadowQuality = 'off' | 'low' | 'medium' | 'high' | 'ultra';

export interface Settings {
  renderDistance: number;
  shadows: ShadowQuality;
  msaa: boolean;
  bloom: boolean;
  godrays: boolean;
  ssr: boolean;
  clouds: boolean;
  renderScale: number;
  fov: number;
  sensitivity: number;
  /** Controllers: how fast the right stick turns (1 = the platform's), pulling it down looks down (false) or up, rumble, aim assist with guns. */
  stickSensitivity: number;
  invertY: boolean;
  /** The touch controls: how fast a finger turns the view (1 = the platform's). */
  touchSensitivity: number;
  vibration: boolean;
  aimAssist: boolean;
  viewBobbing: boolean;
  dayMinutes: number;
  occlusion: boolean;
  /** Controls moved off their default keys (see `player/keys.ts`). */
  keys: KeyBindings;
  /** Graphics lowered a notch at a time while frames are slow (these settings are the most it shows). */
  autoQuality: boolean;
  /** How loud everything is, and a game's music (`client.audio.music`), 0..1. */
  volume: number;
  music: number;
}

const KEY = 'voxel.settings.v1';

/**
 * A phone or tablet: no mouse to hover with, a finger to point. Its graphics chip is a laptop's at
 * best and its battery runs down, so its graphics start lower (auto quality goes down from there,
 * and back up while there's room).
 */
export function isHandheld(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(hover: none) and (pointer: coarse)').matches;
}

export function defaultSettings(): Settings {
  const dpr = window.devicePixelRatio || 1;
  const handheld = isHandheld();
  return {
    renderDistance: handheld ? 8 : 12,
    shadows: handheld ? 'off' : 'high',
    msaa: !handheld,
    bloom: true,
    godrays: !handheld,
    ssr: !handheld,
    clouds: true,
    renderScale: handheld ? 0.7 : dpr > 1.5 ? 0.75 : 1,
    fov: 75,
    sensitivity: 1,
    stickSensitivity: 1,
    invertY: false,
    touchSensitivity: 1,
    vibration: true,
    aimAssist: true,
    viewBobbing: true,
    dayMinutes: 20,
    occlusion: true,
    keys: {},
    autoQuality: true,
    volume: 1,
    music: 0.7,
  };
}

export function loadSettings(): Settings {
  const d = defaultSettings();
  try {
    const raw = kept.get(KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      return { ...d, ...saved, keys: sanitize(saved?.keys) };
    }
  } catch {
    // Storage unavailable: use defaults.
  }
  return d;
}

/** The settings auto quality works within: a change to any of them starts it again from the top. */
export const GRAPHICS: (keyof Settings)[] = ['shadows', 'msaa', 'bloom', 'godrays', 'ssr', 'clouds', 'renderScale', 'autoQuality'];

export function saveSettings(s: Settings) {
  kept.set(KEY, JSON.stringify(s));
}

const SHADOW: Record<ShadowQuality, [number, number]> = {
  off: [0, 64],
  low: [1024, 48],
  medium: [2048, 72],
  high: [3072, 96],
  ultra: [4096, 128],
};

export function toRenderSettings(s: Settings): RenderSettings {
  const [res, dist] = SHADOW[s.shadows];
  return {
    msaa: s.msaa ? 4 : 0,
    shadowRes: res,
    shadowDistance: dist,
    bloom: s.bloom,
    godrays: s.godrays,
    ssr: s.ssr,
    renderScale: s.renderScale,
    clouds: s.clouds,
  };
}
