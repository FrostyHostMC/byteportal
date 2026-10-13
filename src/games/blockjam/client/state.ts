import type { Client } from '@platform/client';
import { advance, launch, type BallEvent, type BallState } from '../ball';
import type { JamState } from '../moves';
import { MSG, type BallMsg, type BallersMsg, type CallMsg, type FlightKind, type MomentMsg } from '../protocol';

/**
 * What this screen knows of the game, for its kits: the ball (who has it, or its flight played out
 * here from its launch), what each baller is doing (the server's word a few times a second, ours
 * predicted), who's on fire, and this frame's moments and the ball's bounces.
 */
export interface Baller {
  air: number;
  /** Seconds into it: the server's, run on here between its words. */
  t: number;
  style: number;
  stun: number;
  fire: boolean;
  team: number;
  /** A dunk's flight time. */
  dur: number;
}

export class JamView {
  holder: string | null = null;
  dunking = false;
  flight: BallState | null = null;
  kind: FlightKind = 'loose';
  flightBy: string | null = null;
  flightFire = false;
  /** When the flight started, on this screen's clock. */
  flightAt = 0;
  ballers = new Map<string, Baller>();
  /** This frame's: the ball's bounces, the server's moments and calls. */
  events: BallEvent[] = [];
  moments: MomentMsg[] = [];
  calls: CallMsg[] = [];
  /** When the ball last changed hands (this screen's clock): for a catch's snap. */
  caughtAt = 0;
  /** Each holder's dribble (the poses' clock), so the ball and the hand keep time. */
  dribble = new Map<string, number>();

  constructor(client: Client) {
    client.on(MSG.ball, (data) => {
      const m = data as BallMsg;
      if ('h' in m) {
        if (this.holder !== m.h) this.caughtAt = client.time;
        this.holder = m.h;
        this.dunking = !!m.dunk;
        this.flight = null;
      } else {
        const [x, y, z, vx, vy, vz] = m.f;
        this.holder = null;
        this.dunking = false;
        this.flight = launch(x, y, z, vx, vy, vz);
        this.kind = m.k;
        this.flightBy = m.by ?? null;
        this.flightFire = !!m.fire;
        this.flightAt = client.time;
      }
    });
    client.on(MSG.ballers, (data) => {
      for (const [id, air, t, style, stun, fire, team, dur] of data as BallersMsg) {
        // (Ours is our own screen's.)
        if (id === client.me.id) {
          const b = this.ballers.get(id);
          if (b) b.team = team;
          continue;
        }
        const b = this.ballers.get(id);
        if (b) Object.assign(b, { air, t, style, stun, fire: !!fire, team, dur });
        else this.ballers.set(id, { air, t, style, stun, fire: !!fire, team, dur });
      }
    });
    client.on(MSG.moment, (data) => this.moments.push(data as MomentMsg));
    client.on(MSG.call, (data) => this.calls.push(data as CallMsg));
  }

  /** Each frame, before the kits: the flight played on, the ballers' clocks run on. */
  frame(client: Client, dt: number) {
    this.events = [];
    if (this.flight) advance(this.flight, client.time - this.flightAt, this.events);
    for (const b of this.ballers.values()) b.t += dt;
    // Ours, as our screen predicts it (it answers at once).
    const me = client.me.id;
    const s = client.me.abilities?.jam as unknown as JamState | undefined;
    if (me && s) {
      const b = this.ballers.get(me);
      const ours = { air: s.air, t: s.t, style: s.style, stun: s.stun, fire: !!s.fire, team: b?.team ?? 0, dur: s.dur };
      if (b) Object.assign(b, ours);
      else this.ballers.set(me, ours);
    }
  }

  /** After the kits: this frame's moments are done with. */
  late() {
    this.moments = [];
    this.calls = [];
  }

  /** Where the ball is in the air (null if someone has it). */
  ballInAir(): { x: number; y: number; z: number } | null {
    const f = this.flight;
    return f ? { x: f.x, y: f.y, z: f.z } : null;
  }
}
