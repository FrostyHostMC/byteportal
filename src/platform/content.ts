import type { AtlasPixels, EntityDefinition, ItemDefinition, ItemLook, Vec3, ViewAnimation } from './api/types';
import { Blueprint } from './api/blueprint';
import { lookOver } from './looks';
import type { ContentDef } from './net/protocol';
import type { WidgetWire } from './ui/markup';

type Listener<T> = (name: string, value: T) => void;
type AtlasSource = HTMLCanvasElement | OffscreenCanvas | AtlasPixels;

/**
 * What a game defines for its look and sound in `setup`: synthesised voices, texture atlases,
 * first-person animations, entity and item types, prop models. These don't travel with the
 * per-frame presentation calls: calls refer to them by name. The simulation's copy has
 * everything (functions too); a host forwards each definition as data (`forward`) and the
 * client's copy takes it in with `apply`.
 */
export class Content {
  readonly atlases = new Map<string, AtlasSource>();
  readonly animations = new Map<string, ViewAnimation>();
  /** Entity types: their models, for the client to draw. */
  readonly entities = new Map<string, EntityDefinition>();
  /**
   * Items as this side has them: the server's definitions, with their looks over them on a screen
   * (`lookItem`: their icons, how they're held, their sounds), and an icon always (a placeholder
   * when neither gives one).
   */
  readonly items = new Map<string, ItemDefinition>();
  /** The server's own item definitions, and the looks the game's client code gave (`client.items.look`). */
  private served = new Map<string, ItemDefinition>();
  private looks = new Map<string, ItemLook>();
  /** HUD widgets of the game's own (`hud.define`): markup and styles, for each screen to check and build. */
  readonly widgets = new Map<string, WidgetWire>();
  /** Prop models: a blueprint to mesh (`props.model`), or a glTF file (`props.gltf`). */
  readonly models = new Map<number, { blueprint: Blueprint; opts: { scale?: number; pivot?: Vec3 } } | { url: string; opts: { scale?: number; animation?: string } }>();
  /** Set by a host: each definition, as data for its clients. */
  forward: ((def: ContentDef) => void) | null = null;
  private atlasListeners: Listener<AtlasSource>[] = [];
  private animationListeners: Listener<ViewAnimation>[] = [];
  private modelFileListeners: Listener<string>[] = [];
  private widgetListeners: Listener<WidgetWire>[] = [];
  private inline = 0;

  defineAtlas(name: string, source: AtlasSource) {
    this.atlases.set(name, source);
    for (const l of this.atlasListeners) l(name, source);
    this.forward?.({ kind: 'atlas', name, source: pixelsOf(source) });
  }

  defineModel(id: number, blueprint: Blueprint, opts: { scale?: number; pivot?: Vec3 }) {
    this.models.set(id, { blueprint, opts });
    this.forward?.({ kind: 'model', id, blueprint: blueprint.toData(), opts: wire(opts) });
  }

  defineGltfModel(id: number, url: string, opts: { scale?: number; animation?: string }) {
    this.models.set(id, { url, opts });
    for (const l of this.modelFileListeners) l(url, url);
    this.forward?.({ kind: 'gltf', id, url, opts: wire(opts) });
  }

  defineItem(id: string, def: ItemDefinition) {
    this.served.set(id, def);
    this.items.set(id, lookOver(def, this.looks.get(id)));
    this.forward?.({ kind: 'item', name: id, def: wire(def) });
  }

  /**
   * An item's look on this screen (`client.items.look`): over the server's definition, now and
   * whenever the server defines the item (again).
   */
  lookItem(id: string, look: ItemLook) {
    this.looks.set(id, look);
    const def = this.served.get(id);
    if (def) this.items.set(id, lookOver(def, look));
  }

  defineEntity(type: string, def: EntityDefinition) {
    this.entities.set(type, def);
    const file = def.model.gltf?.url;
    if (file) for (const l of this.modelFileListeners) l(file, file);
    this.forward?.({ kind: 'entity', name: type, def: wire(def) });
  }

  defineAnimation(name: string, anim: ViewAnimation) {
    this.animations.set(name, anim);
    for (const l of this.animationListeners) l(name, anim);
    this.forward?.({ kind: 'animation', name, anim: 'sample' in anim ? bake(anim) : wire(anim) });
  }

  defineWidget(name: string, def: WidgetWire) {
    this.widgets.set(name, def);
    for (const l of this.widgetListeners) l(name, def);
    this.forward?.({ kind: 'widget', name, def });
  }

  /** An animation passed inline to `viewModel.play`: stored under a generated name. */
  inlineAnimation(anim: ViewAnimation): string {
    const name = `inline:${++this.inline}`;
    this.defineAnimation(name, anim);
    return name;
  }

  /** A definition forwarded by the host. */
  apply(d: ContentDef) {
    switch (d.kind) {
      case 'atlas':
        return this.defineAtlas(d.name, d.source);
      case 'animation':
        return this.defineAnimation(d.name, d.anim);
      case 'entity':
        return this.defineEntity(d.name, d.def);
      case 'item':
        return this.defineItem(d.name, d.def);
      case 'model':
        return this.defineModel(d.id, Blueprint.fromData(d.blueprint), d.opts);
      case 'gltf':
        return this.defineGltfModel(d.id, d.url, d.opts);
      case 'widget':
        return this.defineWidget(d.name, d.def);
    }
  }

  /** Get everything defined so far, then each new definition as it comes. */
  onAtlas(fn: Listener<AtlasSource>) {
    for (const [n, v] of this.atlases) fn(n, v);
    this.atlasListeners.push(fn);
  }

  /** Every model file content names (glTF props and figures), so a client can fetch them early. */
  onModelFile(fn: Listener<string>) {
    for (const m of this.models.values()) if ('url' in m) fn(m.url, m.url);
    for (const e of this.entities.values()) if (e.model.gltf) fn(e.model.gltf.url, e.model.gltf.url);
    this.modelFileListeners.push(fn);
  }

  onAnimation(fn: Listener<ViewAnimation>) {
    for (const [n, v] of this.animations) fn(n, v);
    this.animationListeners.push(fn);
  }

  onWidget(fn: Listener<WidgetWire>) {
    for (const [n, v] of this.widgets) fn(n, v);
    this.widgetListeners.push(fn);
  }
}

/** A procedural animation (`sample(t)`, code) as keyframes, closely enough to look the same. */
function bake(anim: Extract<ViewAnimation, { sample(t: number): unknown }>): ViewAnimation {
  const steps = 24;
  const keys = Array.from({ length: steps + 1 }, (_, i) => ({ ...wire(anim.sample(i / steps)), t: i / steps, ease: 'linear' as const }));
  return { duration: anim.duration, keys };
}

/** A canvas atlas read back to pixels (a worker or a server can't send a canvas). */
function pixelsOf(source: AtlasSource): AtlasPixels {
  if ('pixels' in source) return source;
  const ctx = (source as OffscreenCanvas).getContext('2d') as OffscreenCanvasRenderingContext2D;
  const img = ctx.getImageData(0, 0, source.width, source.height);
  return { width: source.width, height: source.height, pixels: new Uint8Array(img.data.buffer) };
}

/**
 * A deep copy of a definition with only what can cross to a client: functions (behaviours,
 * callbacks) are left out, class instances become plain objects, typed arrays are copied.
 */
export function wire<T>(v: T): T {
  return copy(v, new Map()) as T;
}

function copy(v: unknown, seen: Map<object, unknown>): unknown {
  if (v === null || typeof v !== 'object') return typeof v === 'function' || typeof v === 'symbol' ? undefined : v;
  if (seen.has(v)) return seen.get(v);
  if (ArrayBuffer.isView(v)) return (v as unknown as { slice(): unknown }).slice();
  if (v instanceof Blueprint) return v.toData();
  if (Array.isArray(v)) {
    const out: unknown[] = [];
    seen.set(v, out);
    for (const x of v) out.push(copy(x, seen));
    return out;
  }
  if (v instanceof Map) {
    const out = new Map();
    seen.set(v, out);
    for (const [k, x] of v) if (typeof x !== 'function') out.set(k, copy(x, seen));
    return out;
  }
  const out: Record<string, unknown> = {};
  seen.set(v, out);
  for (const [k, x] of Object.entries(v)) {
    if (typeof x === 'function') continue;
    out[k] = copy(x, seen);
  }
  return out;
}
