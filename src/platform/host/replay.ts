import type { Player, ReplayClip, ReplayHandle, ReplayOptions, Vec3 } from '../api/types';
import { decode, encode } from '../net/codec';
import { applyPatch } from '../net/delta';
import type { HostEvent, PresentCall, ReplayEvent, ReplayStep, ReplayWire } from '../net/protocol';
import type { ReplayBackend, SimFrame } from '../sim/sim';
import { plainData } from '../ui/markup';

/** Seconds a room keeps unless its game says otherwise (`replay.keep`), and the most it may. */
export const REPLAY_KEEP = 8;
const MAX_KEEP = 30;
/** The longest freeze-frame a replay may start with (`hold`). */
const MAX_HOLD = 10;

/**
 * One step kept: when it was (host time, and the game's clock), its frame as a patch on the step
 * before's (the oldest step's is its frame whole, `base`), and what was shown in it, both as the
 * JSON a socket carries (compact, and its length is what it costs).
 */
interface Kept {
  t: number;
  clock: number;
  f: string;
  e: string | null;
}

/**
 * The room's last few seconds: every step's frame (rounded as frames go out, and each a patch on
 * the one before: `net/delta`) and what its screens were shown (see `replayable`), up to `keep`
 * seconds and `maxBytes`, the oldest dropped first. What a replay is made from.
 */
export class ReplayHistory {
  /** Seconds kept (0: none). */
  keep = REPLAY_KEEP;
  /** The most the kept steps may take (their patches and events as JSON); past it the oldest go. */
  maxBytes = 4 * 1024 * 1024;
  private steps: Kept[] = [];
  /** The oldest step's frame, whole: each later step's patch goes on the one before. */
  private base: SimFrame | null = null;
  private used = 0;

  /** Bytes the kept steps take (their patches and events, as JSON), the oldest's frame aside. */
  get bytes(): number {
    return this.used;
  }

  /** Steps kept. */
  get length(): number {
    return this.steps.length;
  }

  /** How many seconds back it reaches. */
  get seconds(): number {
    return this.steps.length ? this.steps[this.steps.length - 1].t - this.steps[0].t : 0;
  }

  /** The newest step's host time (-Infinity: none kept). */
  get newest(): number {
    return this.steps.length ? this.steps[this.steps.length - 1].t : -Infinity;
  }

  /**
   * A step: its host time, the game's clock, its frame rounded (`FrameWriter.current`) and its
   * patch on the step before's (`FrameWriter.patch`), and what was shown in it.
   */
  record(t: number, clock: number, frame: SimFrame, patch: unknown, events: ReplayEvent[]) {
    if (this.keep <= 0) return this.clear();
    const first = !this.steps.length;
    if (first) this.base = frame;
    const kept: Kept = { t, clock, f: first ? '' : encode(patch), e: events.length ? encode(events) : null };
    this.steps.push(kept);
    this.used += size(kept);
    // Older than `keep`, or too much kept: the oldest go (the next's frame becomes the base).
    while (this.steps.length > 1 && (this.steps[0].t < t - this.keep - 1e-6 || this.used > this.maxBytes)) this.drop();
  }

  /** Forget everything (a restart). */
  clear() {
    this.steps = [];
    this.base = null;
    this.used = 0;
  }

  /** The kept steps from host time `from` to `to`, for a screen: the first frame whole, the rest patches. Null: none kept in it. */
  window(from: number, to: number): ReplayStep[] | null {
    const s = this.steps;
    const a = s.findIndex((k) => k.t >= from - 1e-6);
    if (a < 0 || !this.base) return null;
    let b = a;
    while (b + 1 < s.length && s[b + 1].t <= to + 1e-6) b++;
    // The window's first frame: the base, brought up to it.
    let frame = this.base;
    for (let i = 1; i <= a; i++) frame = applyPatch(frame, decode(s[i].f));
    const events = (k: Kept) => (k.e ? decode<ReplayEvent[]>(k.e) : undefined);
    const out: ReplayStep[] = [{ t: s[a].t, f: trim({ ...frame }), e: events(s[a]) }];
    for (let i = a + 1; i <= b; i++) out.push({ t: s[i].t, f: trim(decode(s[i].f)), e: events(s[i]) });
    for (const st of out) if (!st.e) delete st.e;
    return out;
  }

  /** The host time of the first step at or after the game's clock `clock` (the oldest kept, if it's older than that). */
  timeAt(clock: number): number {
    const k = this.steps.find((x) => x.clock >= clock - 1e-6);
    return k ? k.t : this.newest;
  }

  private drop() {
    const [gone, next] = this.steps;
    this.base = applyPatch(this.base!, decode(next.f));
    this.used -= size(gone) + next.f.length;
    next.f = '';
    this.steps.shift();
  }
}

const size = (k: Kept) => k.f.length + (k.e?.length ?? 0);

/** What of a player's frame a replay never uses: prediction's memory of their movement, and the last input applied. */
const UNSHOWN = ['move', 'ack'];

/**
 * A frame, or a patch on one, less what a replay never uses (`UNSHOWN`): taken out of the first
 * frame and every patch alike, the frames read back consistently without it (a quarter smaller).
 */
function trim(f: unknown): unknown {
  const players = (f as { players?: unknown }).players;
  const strip = (p: unknown) => {
    if (!p || typeof p !== 'object') return p;
    const out = { ...(p as Record<string, unknown>) };
    for (const k of UNSHOWN) delete out[k];
    return out;
  };
  if (Array.isArray(players)) return { ...(f as object), players: players.map(strip) };
  if (players && typeof players === 'object') {
    const k = players as { c?: [unknown, unknown][]; n?: unknown[] };
    return { ...(f as object), players: { ...k, ...(k.c && { c: k.c.map(([id, p]) => [id, strip(p)]) }), ...(k.n && { n: k.n.map(strip) }) } };
  }
  return f;
}

/**
 * What of a step's events a replay shows: presentation calls to everyone (effects, sounds, the
 * messages that draw in the world: the platform's, debris, and the item kinds', shots, throws,
 * fires) and effects, sounds and view calls to one player (a replay through their eyes shows what
 * their screen did), and the blocks shot into. Never HUD calls, the game's own messages, sound
 * loops or state.
 */
export function replayable(events: readonly HostEvent[]): ReplayEvent[] {
  const out: ReplayEvent[] = [];
  for (const e of events) {
    if (e.t === 'damage') out.push({ t: 'damage', data: e.data });
    else if (e.t === 'call' && shown(e.call)) out.push({ t: 'call', call: e.call });
  }
  return out;
}

function shown(c: PresentCall): boolean {
  switch (c.target) {
    case 'message':
      return c.to === null && (c.kit === true || c.method.startsWith('$')) && c.method !== '$reset';
    case 'fx':
      return true;
    case 'audio':
      return c.method === 'play';
    case 'view':
      return c.to !== null && c.method !== 'visible' && c.method !== 'setSkin';
    default:
      return false;
  }
}

interface Active {
  id: number;
  viewer: Player;
  /** Host time it ends at. */
  ends: number;
  skippable: boolean;
  onEnd?: ReplayOptions['onEnd'];
  handle: ReplayHandle;
  done: boolean;
}

/**
 * Replays in a room: the history (recorded each step by the host), and the replays playing on
 * players' screens, each ended on the host's clock (its time up, skipped, stopped, replaced),
 * when its `onEnd` runs.
 */
export class Replays implements ReplayBackend {
  readonly history = new ReplayHistory();
  private active = new Map<string, Active>();
  private nextId = 1;
  /** Each clip's steps (`game.replay.clip`), this room's only: the clip is what the game holds, and its steps go when it lets go of it. */
  private clips = new WeakMap<ReplayClip, ReplayStep[]>();

  constructor(
    private host: {
      /** Host time now. */
      now(): number;
      /** An event for the clients (a `replay` goes to its viewer only). */
      push(e: HostEvent): void;
      /** Run game code (an `onEnd`): a throw is reported, and the host carries on. */
      guard(fn: () => void): void;
    },
  ) {}

  get seconds(): number {
    return this.history.seconds;
  }

  keep(seconds: number) {
    const s = Number(seconds);
    this.history.keep = Number.isFinite(s) ? Math.max(0, Math.min(MAX_KEEP, s)) : REPLAY_KEEP;
    if (this.history.keep <= 0) this.history.clear();
  }

  /** The kept steps over a stretch of the history (`from` and `seconds` as `show` has them); null: fewer than two. */
  private stretch(o: { from?: number | { at: number }; seconds?: number }): ReplayStep[] | null {
    const h = this.history;
    const newest = h.newest;
    if (!Number.isFinite(newest)) return null;
    const start = typeof o.from === 'number' ? newest - Math.max(0, o.from) : o.from && typeof o.from === 'object' ? h.timeAt(o.from.at) : newest - h.seconds;
    const end = Math.min(newest, o.seconds !== undefined ? start + Math.max(0, o.seconds) : newest);
    const steps = h.window(start, end);
    return steps && steps.length >= 2 ? steps : null;
  }

  clip(o: { from?: number | { at: number }; seconds?: number }): ReplayClip | null {
    const steps = this.stretch(o);
    if (!steps) return null;
    const clip: ReplayClip = Object.freeze({ from: clockOf(steps, 0), to: clockOf(steps, steps.length - 1), seconds: steps[steps.length - 1].t - steps[0].t });
    this.clips.set(clip, steps);
    return clip;
  }

  show(player: Player, o: ReplayOptions): ReplayHandle | null {
    // Bots have no screen.
    if (!player || player.kind !== 'player' || player.bot) return null;
    const steps = o.clip ? (this.clips.get(o.clip) ?? null) : this.stretch(o);
    if (!steps) return null;
    const speed = Math.max(0.25, Math.min(4, o.speed ?? 1));
    const hold = Math.max(0, Math.min(MAX_HOLD, Number(o.hold) || 0));
    const duration = hold + (steps[steps.length - 1].t - steps[0].t) / speed;
    const cam = o.camera;
    const v = (p: Vec3): [number, number, number] => [p.x, p.y, p.z];
    const wire: ReplayWire = {
      id: this.nextId++,
      steps,
      follow: o.follow?.id ?? null,
      camera: cam ? { at: v(cam.at), look: v(cam.look), fov: cam.fov ?? null } : null,
      speed,
      hold,
      label: typeof o.label === 'string' ? o.label.slice(0, 64) : '',
      data: o.data === undefined ? null : (plainData(o.data) ?? null),
      skippable: o.skippable ?? true,
    };
    // A replay already playing there gives way to this one.
    const was = this.active.get(player.id);
    if (was) this.end(was, false, false);
    const self = this;
    const a: Active = {
      id: wire.id,
      viewer: player,
      ends: this.host.now() + duration,
      skippable: wire.skippable,
      onEnd: o.onEnd,
      done: false,
      handle: {
        id: wire.id,
        duration,
        from: clockOf(steps, 0),
        to: clockOf(steps, steps.length - 1),
        get playing() {
          return !a.done;
        },
        stop: () => {
          if (!a.done) self.end(a, false, true);
        },
      },
    };
    this.active.set(player.id, a);
    this.host.push({ t: 'replay', player: player.id, replay: wire });
    return a.handle;
  }

  stop(player: string) {
    const a = this.active.get(player);
    if (a) this.end(a, false, true);
  }

  playing(player: string): ReplayHandle | null {
    return this.active.get(player)?.handle ?? null;
  }

  /** The player ended it on their screen (if it may be). */
  skip(player: string, id: number) {
    const a = this.active.get(player);
    if (a && a.id === id && a.skippable) this.end(a, true, false);
  }

  /** The player left: their replay goes, without its `onEnd` (they're not here to go on). */
  left(player: string) {
    const a = this.active.get(player);
    if (!a) return;
    a.done = true;
    this.active.delete(player);
  }

  /** A restart: replays end, and the past before it is forgotten. */
  reset() {
    for (const a of [...this.active.values()]) this.end(a, false, true);
    this.history.clear();
  }

  /** Each step: replays whose time is up end. */
  update(now: number) {
    for (const a of [...this.active.values()]) if (now >= a.ends - 1e-6) this.end(a, false, true);
  }

  /** Replays playing now (for tests). */
  get count(): number {
    return this.active.size;
  }

  private end(a: Active, skipped: boolean, tell: boolean) {
    if (a.done) return;
    a.done = true;
    if (this.active.get(a.viewer.id) === a) this.active.delete(a.viewer.id);
    if (tell) this.host.push({ t: 'replayEnd', player: a.viewer.id, id: a.id });
    const fn = a.onEnd;
    if (fn) this.host.guard(() => fn({ player: a.viewer, skipped }));
  }
}

/** The game's clock at a replay's step (its frame's). */
function clockOf(steps: ReplayStep[], i: number): number {
  if (i === 0) return (steps[0].f as SimFrame).clock;
  // Later steps are patches: the clock is in each (it moves every step while the game runs).
  for (let j = i; j > 0; j--) {
    const c = (steps[j].f as Partial<SimFrame>).clock;
    if (typeof c === 'number') return c;
  }
  return (steps[0].f as SimFrame).clock;
}
