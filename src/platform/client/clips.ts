import * as THREE from 'three';
import type { ClipFrame } from '../sim/entities';

/** A clip for a figure to play (`player.animate`, `entity.animate`), and how long ago it began. */
export interface ClipPlay extends Omit<ClipFrame, 'seq' | 'at'> {
  /** Seconds since it began: a screen that sees it late (joining mid-emote) starts it part way through. */
  elapsed: number;
}

type Channel = { node: THREE.Object3D; prop: 'quaternion' | 'position' | 'scale'; value: THREE.Interpolant };

interface Running {
  clip: THREE.AnimationClip;
  channels: Channel[];
  /** Where it is in the clip (seconds of the clip), and how long it's been playing (seconds). */
  t: number;
  age: number;
  loop: boolean;
  fade: number;
  speed: number;
  /** How much of it shows now, 0..1. */
  weight: number;
  /** Stopped or replaced: fading out from where it was. */
  stopped: boolean;
}

const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();

/**
 * A model's animation clips played over whatever else animates it (the humanoid rig's poses, a
 * clip figure's idle and walk): each one blended in and out, over the whole figure or only some of
 * its joints (a layer), by setting its nodes part way from the pose they have to the clip's. Nodes
 * a clip moved go back to their rest before the next frame's pose, so nothing is left behind.
 */
export class ClipLayer {
  private clips = new Map<string, THREE.AnimationClip>();
  private rest = new Map<THREE.Object3D, { p: THREE.Vector3; q: THREE.Quaternion; s: THREE.Vector3 }>();
  private running: Running[] = [];
  private moved = new Set<THREE.Object3D>();

  constructor(
    private root: THREE.Object3D,
    clips: THREE.AnimationClip[],
    /** A joint or node by name (for layers): a rig's joint, or the model's own. */
    private find: (name: string) => THREE.Object3D | null,
  ) {
    for (const c of clips) {
      this.clips.set(c.name, c);
      // Every node a clip can move, as it is now (at rest).
      for (const track of c.tracks) {
        const node = this.node(track);
        if (node && !this.rest.has(node)) this.rest.set(node, { p: node.position.clone(), q: node.quaternion.clone(), s: node.scale.clone() });
      }
    }
  }

  /** Something's playing (or fading out). */
  get active(): boolean {
    return this.running.length > 0;
  }

  /** Does the model have this clip? */
  has(name: string): boolean {
    return this.clips.has(name);
  }

  /** Start a clip (what was playing fades out as it fades in), or null: fade out what's playing. */
  play(p: ClipPlay | null) {
    for (const r of this.running) r.stopped = true;
    if (!p) return;
    const clip = this.clips.get(p.name);
    if (!clip) return;
    const speed = p.speed > 0 ? p.speed : 1;
    const age = Math.max(0, p.elapsed);
    const t = age * speed;
    // A clip played once that's already over (seen late): nothing to show.
    if (!p.loop && t >= clip.duration) return;
    this.running.push({ clip, channels: this.bind(clip, p.layer), t, age, loop: p.loop, fade: Math.max(0, p.fade), speed, weight: 0, stopped: false });
  }

  /** Nodes the clips moved back to rest (before the figure's own pose for the frame). */
  reset() {
    for (const n of this.moved) {
      const r = this.rest.get(n)!;
      n.position.copy(r.p);
      n.quaternion.copy(r.q);
      n.scale.copy(r.s);
    }
    this.moved.clear();
  }

  /** Move the clips on by `dt` seconds and blend them over the pose (older first, so the newest wins). */
  apply(dt: number) {
    for (const r of this.running) {
      r.age += dt;
      r.t += dt * r.speed;
      const d = r.clip.duration;
      // In over `fade`; a clip played once, out again over its last `fade`; stopped or replaced, out from where it was.
      const end = r.loop || r.fade <= 0 ? 1 : Math.max(0, Math.min(1, (d - r.t) / r.speed / r.fade));
      if (r.stopped) r.weight = r.fade > 0 ? Math.max(0, Math.min(r.weight - dt / r.fade, end)) : 0;
      else r.weight = Math.min(r.fade > 0 ? Math.min(1, r.age / r.fade) : 1, end);
      if (!r.loop && r.t >= d) r.weight = 0;
      if (r.weight <= 0) continue;
      const time = r.loop ? r.t % d : r.t;
      for (const c of r.channels) {
        const v = c.value.evaluate(time);
        const n = c.node;
        if (c.prop === 'quaternion') n.quaternion.slerp(_q.fromArray(v), r.weight);
        else n[c.prop].lerp(_v.fromArray(v), r.weight);
        this.moved.add(n);
      }
    }
    this.running = this.running.filter((r) => r.weight > 0 || (!r.stopped && (r.loop || r.t < r.clip.duration)));
  }

  /** The node a track moves (quaternion, position and scale tracks only). */
  private node(track: THREE.KeyframeTrack): THREE.Object3D | null {
    const { nodeName, propertyName } = THREE.PropertyBinding.parseTrackName(track.name);
    if (propertyName !== 'quaternion' && propertyName !== 'position' && propertyName !== 'scale') return null;
    return (THREE.PropertyBinding.findNode(this.root, nodeName) as THREE.Object3D | null) ?? null;
  }

  /** A clip's tracks on this model, only those in the layer. */
  private bind(clip: THREE.AnimationClip, layer: ClipPlay['layer']): Channel[] {
    const mask = this.mask(layer);
    const out: Channel[] = [];
    for (const track of clip.tracks) {
      const node = this.node(track);
      if (!node || (mask && !mask.has(node))) continue;
      const prop = THREE.PropertyBinding.parseTrackName(track.name).propertyName as Channel['prop'];
      out.push({ node, prop, value: (track as THREE.KeyframeTrack & { createInterpolant(): THREE.Interpolant }).createInterpolant() });
    }
    return out;
  }

  /** The nodes a layer covers (null: all): each named joint and everything that hangs from it. */
  private mask(layer: ClipPlay['layer']): Set<THREE.Object3D> | null {
    if (layer === 'full') return null;
    const names = layer === 'upper' ? ['spine'] : layer;
    const out = new Set<THREE.Object3D>();
    for (const name of names) this.find(name)?.traverse((o) => out.add(o));
    // A model with no spine to speak of: the whole figure.
    return layer === 'upper' && !out.size ? null : out;
  }
}
