/**
 * Frames over a socket, small: numbers rounded to what the eye (and prediction) can use, and
 * after the first frame only what changed since the one before. A frame is mostly the same as the
 * last (names, skins, hotbars, pickups lying still, a ship's flames), so a client gets the changes
 * alone: fields that differ, records that came or went.
 *
 * A patch mirrors the frame's shape. Objects patch key by key (`{ $x: 1 }` deletes one); lists of
 * records with an `id` patch by id (`{ $k: 1, r, c, n, o }`: removed ids, changed records' patches,
 * new records, and the order when it isn't the old one's with the new ones after); anything else
 * that changed arrives whole. A socket is reliable and ordered, so each patch is against the frame
 * the client got just before; the first is the whole frame.
 */

const NONE: unique symbol = Symbol('unchanged');
type Diff = unknown | typeof NONE;

type Id = string | number;
type Rec = Record<string, unknown>;
interface Keyed {
  $k: 1;
  r?: Id[];
  c?: [Id, unknown][];
  n?: Rec[];
  o?: Id[];
}

const isRecord = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v) && !ArrayBuffer.isView(v);
const hasId = (v: unknown): v is Rec & { id: Id } => isRecord(v) && (typeof v.id === 'string' || typeof v.id === 'number');
const keyedList = (a: unknown[]) => a.length > 0 && a.every(hasId);

/** Rounded to 4 decimals (a tenth of a millimetre, a ten-thousandth of a radian): plenty to draw and predict from. */
export function quantize<T>(v: T): T {
  if (typeof v === 'number') return (Number.isInteger(v) || !Number.isFinite(v) ? v : Math.round(v * 1e4) / 1e4) as T;
  if (Array.isArray(v)) return v.map(quantize) as T;
  if (isRecord(v)) {
    const out: Rec = {};
    for (const k in v) if (v[k] !== undefined) out[k] = quantize(v[k]);
    return out as T;
  }
  return v;
}

function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!equal(a[i], b[i])) return false;
    return true;
  }
  if (isRecord(a) && isRecord(b)) {
    const ka = Object.keys(a);
    if (ka.length !== Object.keys(b).length) return false;
    for (const k of ka) if (!(k in b) || !equal(a[k], b[k])) return false;
    return true;
  }
  return false;
}

function diff(prev: unknown, next: unknown): Diff {
  if (prev === undefined) return next;
  if (Array.isArray(prev) && Array.isArray(next) && keyedList(prev) && keyedList(next)) return diffKeyed(prev as Rec[], next as Rec[]);
  if (isRecord(prev) && isRecord(next)) {
    const out: Rec = {};
    let any = false;
    for (const k in next) {
      const d = diff(prev[k], next[k]);
      if (d !== NONE) {
        out[k] = d;
        any = true;
      }
    }
    for (const k in prev) {
      if (!(k in next)) {
        out[k] = { $x: 1 };
        any = true;
      }
    }
    return any ? out : NONE;
  }
  return equal(prev, next) ? NONE : next;
}

function diffKeyed(prev: Rec[], next: Rec[]): Diff {
  const before = new Map(prev.map((x) => [x.id as Id, x]));
  const now = new Set(next.map((x) => x.id as Id));
  const out: Keyed = { $k: 1 };
  const removed = prev.filter((x) => !now.has(x.id as Id)).map((x) => x.id as Id);
  if (removed.length) out.r = removed;
  const changed: [Id, unknown][] = [];
  const added: Rec[] = [];
  for (const x of next) {
    const was = before.get(x.id as Id);
    if (!was) {
      added.push(x);
      continue;
    }
    const d = diff(was, x);
    if (d !== NONE) changed.push([x.id as Id, d]);
  }
  if (changed.length) out.c = changed;
  if (added.length) out.n = added;
  // The order, when it isn't the old one (less what went) followed by the new ones.
  const expected = [...prev.filter((x) => now.has(x.id as Id)).map((x) => x.id), ...added.map((x) => x.id)];
  if (expected.some((id, i) => id !== next[i].id)) out.o = next.map((x) => x.id as Id);
  return out.r || out.c || out.n || out.o ? out : NONE;
}

/** Apply a patch without touching `prev` (earlier frames are still being drawn from). */
function apply(prev: unknown, patch: unknown): unknown {
  if (isRecord(patch) && patch.$k === 1 && Array.isArray(prev)) return applyKeyed(prev as Rec[], patch as unknown as Keyed);
  if (isRecord(patch) && isRecord(prev) && patch.$x === undefined) {
    const out: Rec = { ...prev };
    for (const k in patch) {
      const p = patch[k];
      if (isRecord(p) && p.$x === 1) delete out[k];
      else out[k] = apply(prev[k], p);
    }
    return out;
  }
  return patch;
}

function applyKeyed(prev: Rec[], p: Keyed): Rec[] {
  const gone = new Set(p.r ?? []);
  const changes = new Map(p.c ?? []);
  const list = prev.filter((x) => !gone.has(x.id as Id)).map((x) => (changes.has(x.id as Id) ? (apply(x, changes.get(x.id as Id)) as Rec) : x));
  list.push(...(p.n ?? []));
  if (!p.o) return list;
  const byId = new Map(list.map((x) => [x.id as Id, x]));
  return p.o.map((id) => byId.get(id)!).filter(Boolean);
}

/**
 * The server's side, for one game: each step's frame rounded once, and the patch from the step
 * before worked out once for everyone who had that one (a client who just joined gets it whole).
 */
export class FrameWriter<F> {
  private last: F | undefined;
  private previous: F | undefined;
  private shared: Diff = NONE;

  /** This step's frame. */
  next(frame: F) {
    this.previous = this.last;
    this.last = quantize(frame);
    this.shared = this.previous === undefined ? NONE : diff(this.previous, this.last);
  }

  /** The newest frame, rounded: what a client has once it applies `patchFor`. */
  get current(): F | undefined {
    return this.last;
  }

  /** What takes the step before's frame to this one (`{}`: nothing changed; the first step: the frame whole). */
  get patch(): unknown {
    if (this.previous === undefined) return this.last;
    return this.shared === NONE ? {} : this.shared;
  }

  /** What takes a client from the frame it has (none: it just came) to the newest. */
  patchFor(had: F | undefined): unknown {
    if (had === undefined) return this.last;
    const d = had === this.last ? NONE : had === this.previous ? this.shared : diff(had, this.last);
    return d === NONE ? {} : d;
  }
}

/** The client's side: the frame so far, and each patch applied to it. */
export class FrameReader<F> {
  private frame: F | undefined;

  read(patch: unknown): F {
    this.frame = (this.frame === undefined ? patch : apply(this.frame, patch)) as F;
    return this.frame;
  }
}

/** A patch applied to a frame (`FrameWriter.patch`, `patchFor`), `prev` untouched. */
export function applyPatch<F>(prev: F, patch: unknown): F {
  return apply(prev, patch) as F;
}

/** Exposed for tests. */
export const _internal = { diff, apply, NONE };
