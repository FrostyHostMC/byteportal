import type { Client, ClientKit } from '@platform/client';
import { course } from '../course';
import { MSG, type AddressMsg, type BallMsg, type RoundMsg, type ShotMsg } from '../protocol';
import { BALL_SIZE } from '../scale';

/** A shot being flown on this screen: its path, how far in, which of its events have happened. */
export interface Flight {
  msg: ShotMsg;
  t: number;
  /** The next event to play. */
  next: number;
  /** Seconds it lasts. */
  length: number;
}

type Listener<T> = (v: T) => void;

/**
 * What this screen knows of the golf: its own round and address (from the server), every ball on
 * the course, and the shots in the air. One place hears the server's messages; the kits (balls,
 * the swing, the panel, the greens) read it and subscribe to what they need.
 */
export class GolfState {
  round: RoundMsg | null = null;
  address: AddressMsg | null = null;
  readonly balls = new Map<string, BallMsg>();
  readonly flights = new Map<string, Flight>();
  private on = { address: [] as Listener<AddressMsg>[], release: [] as Listener<void>[], shot: [] as Listener<ShotMsg>[], round: [] as Listener<RoundMsg>[] };
  me: string | null = null;

  onAddress(fn: Listener<AddressMsg>) {
    this.on.address.push(fn);
  }
  onRelease(fn: Listener<void>) {
    this.on.release.push(fn);
  }
  onShot(fn: Listener<ShotMsg>) {
    this.on.shot.push(fn);
  }
  onRound(fn: Listener<RoundMsg>) {
    this.on.round.push(fn);
  }

  /** The kit that hears the server (listed first). */
  kit(): ClientKit {
    return {
      name: 'golf.state',
      setup: (client) => {
        client.on(MSG.round, (d) => {
          this.round = d as RoundMsg;
          for (const f of this.on.round) f(this.round);
        });
        client.on(MSG.address, (d) => {
          this.address = d as AddressMsg;
          for (const f of this.on.address) f(this.address);
        });
        client.on(MSG.release, () => {
          this.address = null;
          for (const f of this.on.release) f();
        });
        client.on(MSG.ball, (d) => {
          const b = d as BallMsg;
          this.balls.set(b.id, b);
        });
        client.on(MSG.shot, (d) => {
          const s = d as ShotMsg;
          const length = (s.path.length / 3 - 1) / s.hz;
          this.flights.set(s.id, { msg: s, t: 0, next: 0, length });
          for (const f of this.on.shot) f(s);
        });
      },
      frame: (client) => {
        this.me = client.me.id;
      },
      dispose: () => {
        this.balls.clear();
        this.flights.clear();
      },
    };
  }
}

/** Where a flight's ball is `t` seconds in (its middle), and where it's heading. */
export function flightAt(f: Flight, t: number) {
  const p = f.msg.path;
  const n = p.length / 3;
  const u = Math.max(0, Math.min(n - 1, t * f.msg.hz));
  const i = Math.min(n - 2, Math.floor(u));
  const k = u - i;
  const j = Math.max(0, i);
  const at = (a: number, c: number) => p[a * 3 + c] + (p[(a + 1) * 3 + c] - p[a * 3 + c]) * k;
  const x = n > 1 ? at(j, 0) : p[0];
  const y = n > 1 ? at(j, 1) : p[1];
  const z = n > 1 ? at(j, 2) : p[2];
  const b = Math.max(0, j - 2);
  return { x, y: y + BALL_SIZE / 2, z, dx: x - p[b * 3], dy: y - p[b * 3 + 1], dz: z - p[b * 3 + 2] };
}

/** A ball at rest, as drawn: on the ground (or down in the cup). */
export function restAt(at: { x: number; y: number; z: number }) {
  return { x: at.x, y: Math.max(course.height(at.x, at.z), at.y - 0.3) + BALL_SIZE / 2, z: at.z };
}

export type { Client };
