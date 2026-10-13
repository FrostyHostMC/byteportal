import type { Client } from '@platform/client';
import type { SkateState } from '../moves';
import { MSG, type CallMsg, type FlightKind, type MomentMsg, type PuckMsg, type SkatersMsg, type TeamsMsg } from '../protocol';
import { advance, launch, type PuckEvent, type PuckState } from '../puck';

/**
 * What this screen knows of the game, for its kits: the puck (who has it, or its flight played out
 * here from its launch), what each skater is doing (the server's word a few times a second, ours
 * predicted), and this frame's moments and the puck's bounces.
 */
export interface SkaterView {
  /** A shot winding up (0..1) and its follow-through (seconds, 0 none). */
  wind: number;
  shot: number;
  stun: number;
  fire: boolean;
  team: number;
  stop: boolean;
  /** A goalie, its save's kind (0 none) and seconds since. */
  goalie: boolean;
  save: number;
  saveT: number;
}

export class IceView {
  holder: string | null = null;
  flight: PuckState | null = null;
  kind: FlightKind = 'loose';
  flightBy: string | null = null;
  flightFire = false;
  /** When the flight started, on this screen's clock. */
  flightAt = 0;
  skaters = new Map<string, SkaterView>();
  /** This frame's: the puck's bounces, the server's moments and calls. */
  events: PuckEvent[] = [];
  moments: MomentMsg[] = [];
  calls: CallMsg[] = [];
  /** When the puck last changed hands (this screen's clock). */
  caughtAt = 0;
  /** The teams playing (their ids: the home side's, the visitors'), for their helmets. */
  teams: [string, string] = ['', ''];

  constructor(client: Client) {
    client.on(MSG.puck, (data) => {
      const m = data as PuckMsg;
      if ('h' in m) {
        if (this.holder !== m.h) this.caughtAt = client.time;
        this.holder = m.h;
        this.flight = null;
      } else {
        const [x, y, z, vx, vy, vz] = m.f;
        this.holder = null;
        this.flight = y < 0 ? null : launch(x, y, z, vx, vy, vz);
        this.kind = m.k;
        this.flightBy = m.by ?? null;
        this.flightFire = !!m.fire;
        this.flightAt = client.time;
      }
    });
    client.on(MSG.skaters, (data) => {
      for (const [id, wind, shot, stun, fire, team, stop, save, saveT, goalie] of data as SkatersMsg) {
        const v = { wind, shot, stun, fire: !!fire, team, stop: !!stop, goalie: !!goalie, save, saveT };
        // (Ours is our own screen's, but for the team and the save.)
        const b = this.skaters.get(id);
        if (id === client.me.id && b) {
          b.team = team;
          continue;
        }
        if (b) Object.assign(b, v);
        else this.skaters.set(id, v);
      }
    });
    client.on(MSG.teams, (data) => {
      this.teams = data as TeamsMsg;
    });
    client.on(MSG.moment, (data) => this.moments.push(data as MomentMsg));
    client.on(MSG.call, (data) => this.calls.push(data as CallMsg));
  }

  /** Each frame, before the kits: the flight played on, the clocks run on, ours as predicted. */
  frame(client: Client, dt: number) {
    this.events = [];
    if (this.flight) advance(this.flight, client.time - this.flightAt, this.events);
    for (const b of this.skaters.values()) {
      if (b.shot > 0) b.shot += dt;
      b.saveT += dt;
    }
    const me = client.me.id;
    const s = client.me.abilities?.skate as unknown as SkateState | undefined;
    if (me && s) {
      const b = this.skaters.get(me);
      const ours = { wind: s.wind, shot: s.shot, stun: s.stun, fire: !!s.fire, team: b?.team ?? 0, stop: s.stop > 0, goalie: false, save: 0, saveT: 9 };
      if (b) Object.assign(b, ours);
      else this.skaters.set(me, ours);
    }
  }

  /** After the kits: this frame's moments are done with. */
  late() {
    this.moments = [];
    this.calls = [];
  }
}
