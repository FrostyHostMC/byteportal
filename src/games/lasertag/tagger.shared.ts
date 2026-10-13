import type { ItemBase, ItemMove, Vec3 } from '@platform';

/**
 * The tagger, a kind of item of Laser Tag's own (`kind: 'tagger'`): what its host half
 * (`tagger.server.ts`) and its screen half (`client/tagger.ts`) both run, so they agree. A shot
 * costs energy, which comes back over time; a tagger fires no faster than its `rate`.
 */
export interface TaggerItem extends ItemBase {
  kind: 'tagger';
  /** Shots a second, at most. */
  rate: number;
  /** Energy a shot costs (a full tagger holds 1). */
  cost: number;
  /** Energy back a second. */
  recharge: number;
  /** How far its beam reaches (blocks). */
  range: number;
  /** What a tag takes off them. */
  damage: number;
  /** Its beam's colour. */
  color: string;
  /** Carrying it: times walking speed (a heavy one slows you). Default 1. */
  weight?: number;
}

export const isTagger = (d: { kind: string } | undefined): d is TaggerItem => d?.kind === 'tagger';

/** A tagger's state, per player (the host's, and each screen's own as it predicts it). */
export interface TaggerState {
  energy: number;
  /** Shots so far: each screen numbers its own; the host takes each once. */
  serial: number;
  /** Seconds until it can fire again. */
  cooldown: number;
}

export const freshTagger = (): TaggerState => ({ energy: 1, serial: 0, cooldown: 0 });

/** Time goes by: energy comes back, the cooldown runs down. */
export function stepTagger(def: TaggerItem, st: TaggerState, dt: number) {
  st.energy = Math.min(1, st.energy + def.recharge * dt);
  st.cooldown = Math.max(0, st.cooldown - dt);
}

/** It can fire now (with `slack`: the host allows a screen's clock a little). */
export const canFire = (def: TaggerItem, st: TaggerState, slack = 0) => st.cooldown <= slack && st.energy >= def.cost * (1 - slack * 2);

/** A shot: its energy, and the wait for the next. */
export function spend(def: TaggerItem, st: TaggerState) {
  st.energy = Math.max(0, st.energy - def.cost);
  st.cooldown = 1 / Math.max(0.1, def.rate);
}

/** What holding one does to walking: its weight (the same on the host and each screen: movement is predicted). */
export const taggerMove = (def: TaggerItem): ItemMove => ({ speed: def.weight ?? 1 });

/** A unit vector along a view (yaw 0 looks toward -z). */
export function lookDir(yaw: number, pitch: number): Vec3 {
  const cp = Math.cos(pitch);
  return { x: -Math.sin(yaw) * cp, y: Math.sin(pitch), z: -Math.cos(yaw) * cp };
}

/** What everyone's screen gets of a held tagger (`hand.state`): its energy. */
export interface TaggerShown {
  energy: number;
  serial: number;
}

/** A beam as other screens draw it (the `tagger.beam` message): who, from where to where, what colour. */
export type BeamWire = [by: string, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, color: string];
