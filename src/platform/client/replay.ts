import { FrameReader } from '../net/delta';
import type { ReplayEvent, ReplayWire } from '../net/protocol';
import type { SimFrame } from '../sim/sim';
import { blend, caughtUp } from './interp';

interface Step {
  t: number;
  frame: SimFrame;
  events: ReplayEvent[];
}

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

/** From angle `a` toward `b` the short way round, `k` of the way. */
function lerpAngle(a: number, b: number, k: number): number {
  let d = b - a;
  d -= Math.round(d / (Math.PI * 2)) * Math.PI * 2;
  return a + d * k;
}

/**
 * A replay on this screen (`game.replay.show`): its frames read back from the patches they came as
 * (`net/delta`), played on this screen's clock at the replay's speed, after its first frame has
 * stood still for its `hold`. `advance` moves it on and hands over what was shown in the steps it
 * passed; `sample` is the frame to draw now, blended between the two around it as live frames are
 * (and players' looks too: the eyes it follows turn smoothly).
 */
export class ReplayPlayback {
  private steps: Step[] = [];
  /** Host time now, in the replay. */
  private at: number;
  /** The next step whose events are still to come. */
  private next = 0;
  /** Seconds of its `hold` gone by (the first frame standing still). */
  private held = 0;

  constructor(readonly wire: ReplayWire) {
    const reader = new FrameReader<SimFrame>();
    for (const s of wire.steps) this.steps.push({ t: s.t, frame: caughtUp(reader.read(s.f)), events: s.e ?? [] });
    this.at = this.steps[0]?.t ?? 0;
  }

  get start(): number {
    return this.steps[0]?.t ?? 0;
  }

  get end(): number {
    return this.steps[this.steps.length - 1]?.t ?? 0;
  }

  /** Seconds its first frame stands still. */
  get hold(): number {
    return this.wire.hold ?? 0;
  }

  /** Its first frame is standing still (the `hold` isn't over). */
  get holding(): boolean {
    return this.held < this.hold;
  }

  /** Seconds it lasts and seconds played, as played (at its speed, the hold first). */
  get duration(): number {
    return this.hold + (this.end - this.start) / this.wire.speed;
  }

  get time(): number {
    return this.held + (this.at - this.start) / this.wire.speed;
  }

  /** Played to its end. */
  get done(): boolean {
    return this.steps.length < 2 || (!this.holding && this.at >= this.end - 1e-9);
  }

  /** On by `dt` seconds of this screen's time; the events of the steps it reached (the first step's once the hold is over). */
  advance(dt: number): ReplayEvent[] {
    dt = Math.max(0, dt);
    if (this.holding) {
      const h = Math.min(dt, this.hold - this.held);
      this.held += h;
      dt -= h;
      if (this.holding) return [];
    }
    this.at = Math.min(this.end, this.at + dt * this.wire.speed);
    const out: ReplayEvent[] = [];
    while (this.next < this.steps.length && this.steps[this.next].t <= this.at + 1e-9) out.push(...this.steps[this.next++].events);
    return out;
  }

  /** The frame to draw now. */
  sample(): SimFrame {
    const s = this.steps;
    let i = 0;
    while (i + 2 < s.length && s[i + 1].t <= this.at) i++;
    const a = s[i];
    const b = s[i + 1];
    if (!b || this.at <= a.t) return a.frame;
    if (this.at >= b.t) return b.frame;
    const k = (this.at - a.t) / (b.t - a.t);
    const f = blend(a.frame, b.frame, k);
    // Where each looks (and how far their held item's aimed: its state's `aim`), between the two as well.
    const before = new Map(a.frame.players.map((p) => [p.id, p]));
    f.players = f.players.map((p) => {
      const o = before.get(p.id);
      if (!o) return p;
      const now = p.hand.state as { aim?: unknown } | null;
      const was = o.hand.state as { aim?: unknown } | null;
      const aim = typeof now?.aim === 'number' && typeof was?.aim === 'number' ? { ...p.hand, state: { ...now, aim: lerp(was.aim, now.aim, k) } } : p.hand;
      return { ...p, view: { ...p.view, yaw: lerpAngle(o.view.yaw, p.view.yaw, k), pitch: lerp(o.view.pitch, p.view.pitch, k) }, hand: aim };
    });
    return f;
  }
}
