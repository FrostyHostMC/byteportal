import { kept } from './client/storage';
import type { Settings, ShadowQuality } from './settings';

/** Graphics as drawn: the settings, and the pixel ratio the canvas is drawn at. */
export interface Look {
  settings: Settings;
  dpr: number;
}

const SHADOWS: ShadowQuality[] = ['off', 'low', 'medium', 'high', 'ultra'];
const atMost = (q: ShadowQuality, max: ShadowQuality) => SHADOWS[Math.min(SHADOWS.indexOf(q), SHADOWS.indexOf(max))];

/**
 * The notches auto quality steps down through, each on top of the ones before, what's missed
 * least first: on a slow graphics chip the full-screen passes (anti-aliasing, the shadow map,
 * reflections, bloom) and the number of pixels are most of a frame.
 */
const NOTCHES: ((l: Look) => void)[] = [
  (l) => (l.settings.renderScale = Math.min(l.settings.renderScale, 0.85)),
  (l) => (l.settings.msaa = false),
  (l) => (l.settings.godrays = false),
  (l) => (l.settings.shadows = atMost(l.settings.shadows, 'low')),
  (l) => (l.settings.renderScale = Math.min(l.settings.renderScale, 0.7)),
  (l) => (l.settings.ssr = false),
  (l) => (l.settings.bloom = false),
  (l) => {
    l.settings.shadows = 'off';
    l.settings.clouds = false;
  },
  // A high-density screen drawn at one pixel per point: the final pass (and everything sized by
  // the canvas) a quarter of the work. The scene keeps about the detail it had.
  (l) => {
    if (l.dpr <= 1) return;
    l.settings.renderScale = Math.min(1, l.settings.renderScale * l.dpr);
    l.dpr = 1;
  },
  (l) => (l.settings.renderScale = Math.min(l.settings.renderScale, 0.75)),
  (l) => (l.settings.renderScale = Math.min(l.settings.renderScale, 0.6)),
];

/** Seconds of frames judged at a time. */
const WINDOW = 1.5;
/** Frames slower than this on average (ms, about 45 fps) are too slow... */
const SLOW = 22;
/** ...and faster than this (about 57 fps) have room to spare. */
const FAST = 17.5;
/** Seconds of room to spare before a notch back up is tried (doubling each time one fails). */
const UP_WAIT = 12;
const UP_WAIT_MAX = 240;
/** Notches in a row that bought nothing: frames aren't held up by the graphics (a browser capped at 30, a busy processor). */
const FUTILE = 3;

/**
 * Automatic quality: the player's graphics settings are the most it shows. While frames are too
 * slow it goes down a notch at a time (letting each settle, then judging the next second and a
 * half), and when they've had room to spare for a while it tries one back up, waiting twice as
 * long next time if that was too much. Notches that make no difference are undone: a frame rate
 * the graphics aren't holding back isn't worth a worse picture.
 */
export class AutoQuality {
  level = 0;
  enabled = true;
  private samples: number[] = [];
  private span = 0;
  /** Seconds still to wait after a change (new targets, shaders, the scene settling). */
  private settle = 3;
  private roomFor = 0;
  private upWait = UP_WAIT;
  /** A notch up was just tried: if the next window is slow, go back and wait longer. */
  private trying = false;
  /** The last notch down: the average frame time before it, and the level it went from. */
  private before: { mean: number; from: number } | null = null;
  /** Notches down in a row that bought nothing, and the level before the first of them. */
  private futile = 0;
  private futileFrom = 0;
  /** Stopped (notches made no difference) at this frame time: starts again only if frames get much slower. */
  private stalled: number | null = null;

  /** How many notches there are. */
  static get notches(): number {
    return NOTCHES.length;
  }

  /** The player's settings as drawn at this level. */
  apply(s: Settings, dpr: number): Look {
    const look: Look = { settings: { ...s }, dpr };
    if (this.enabled) for (let i = 0; i < this.level; i++) NOTCHES[i](look);
    return look;
  }

  /**
   * From `level` (the one this machine settled on last time, or 0 when the player has just changed
   * their settings), measured afresh.
   */
  reset(level = 0) {
    this.level = Math.max(0, Math.min(NOTCHES.length, Math.floor(level) || 0));
    this.samples = [];
    this.span = 0;
    this.settle = 3;
    this.roomFor = 0;
    this.upWait = UP_WAIT;
    this.trying = false;
    this.before = null;
    this.futile = 0;
    this.stalled = null;
  }

  /**
   * One frame, `ms` after the last, while playing. Returns true when the level changed (the
   * caller applies it). Frames over a quarter second (a hitch, a hidden tab) don't count.
   */
  frame(ms: number): boolean {
    if (!this.enabled || ms > 250) return false;
    this.samples.push(ms);
    this.span += ms / 1000;
    if (this.span < WINDOW) return false;
    const mean = trimmedMean(this.samples);
    const span = this.span;
    this.samples = [];
    this.span = 0;
    if (this.settle > 0) {
      this.settle -= span;
      return false;
    }
    if (mean > SLOW) return this.slow(mean);
    this.trying = false;
    this.before = null;
    this.futile = 0;
    if (mean < FAST) {
      this.roomFor += span;
      if (this.level > 0 && this.roomFor >= this.upWait) return this.change(-1);
    } else this.roomFor = 0;
    return false;
  }

  private slow(mean: number): boolean {
    this.roomFor = 0;
    if (this.trying) {
      // The notch up was too much: back down, and wait longer before trying again.
      this.trying = false;
      this.upWait = Math.min(UP_WAIT_MAX, this.upWait * 2);
      this.before = null;
      return this.change(1);
    }
    if (this.stalled !== null) {
      if (mean < this.stalled * 1.25) return false;
      this.stalled = null;
    }
    if (this.before !== null && mean > this.before.mean * 0.96) {
      if (this.futile++ === 0) this.futileFrom = this.before.from;
    } else this.futile = 0;
    if (this.futile >= FUTILE) {
      // The last few notches bought nothing: undo them and stop here.
      this.stalled = mean;
      this.futile = 0;
      this.before = null;
      return this.change(this.futileFrom - this.level);
    }
    if (this.level >= NOTCHES.length) return false;
    this.before = { mean, from: this.level };
    // Far too slow (under about 23 fps): two notches at once.
    return this.change(mean > SLOW * 2 ? 2 : 1);
  }

  private change(by: number): boolean {
    const was = this.level;
    this.level = Math.max(0, Math.min(NOTCHES.length, this.level + by));
    if (by < 0 && this.stalled === null) this.trying = true;
    this.roomFor = 0;
    this.settle = 1;
    return this.level !== was;
  }
}

const KEY = 'voxel.quality.v1';

/** The level auto quality settled on last time on this machine (0 if none). */
export function savedQuality(): number {
  return Number(kept.get(KEY)) || 0;
}

export function saveQuality(level: number) {
  kept.set(KEY, String(level));
}

/** The mean with the slowest tenth left out (hitches: loading a chunk, a garbage collection). */
function trimmedMean(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const kept = s.slice(0, Math.max(1, Math.ceil(s.length * 0.9)));
  return kept.reduce((a, b) => a + b, 0) / kept.length;
}
