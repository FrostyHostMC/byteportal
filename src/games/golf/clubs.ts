import { Surf } from './course/types';
import { S, clamp } from './scale';

/**
 * The bag, and how a swing becomes a launch. Each club's full swing is a tour player's numbers
 * (ball speed, launch, spin, as a launch monitor reads them), so a flushed driver carries about 275
 * yards and a sand wedge 100. The swing meter (on the player's screen) says how hard (`power`) and
 * how square (`accuracy`: 0 dead on, negative early, positive late); the strike point says where
 * the face met the ball (`spin`: below the middle for backspin, above for a runner; `curve`: left
 * of it for a draw, right for a fade). The lie changes the rest.
 */

export interface Club {
  id: string;
  name: string;
  /** Hotbar label (two or three characters). */
  short: string;
  /** Full swing: ball speed (m/s), launch (degrees), backspin (rpm). */
  speed: number;
  launch: number;
  spin: number;
  /** A wood (it doesn't like a bad lie) or a wedge (it does fine from sand). */
  wood?: boolean;
  wedge?: boolean;
  putter?: boolean;
  /** How forgiving it is of a mistimed strike (1: normal; longer clubs less). */
  forgive: number;
}

export const CLUBS: Club[] = [
  { id: 'driver', name: 'Driver', short: 'Dr', speed: 74, launch: 11, spin: 2650, wood: true, forgive: 0.8 },
  { id: 'wood3', name: '3 Wood', short: '3W', speed: 69, launch: 10.5, spin: 3600, wood: true, forgive: 0.85 },
  { id: 'hybrid4', name: '4 Hybrid', short: '4H', speed: 64, launch: 12, spin: 4400, forgive: 0.95 },
  { id: 'iron5', name: '5 Iron', short: '5i', speed: 59, launch: 12.5, spin: 5300, forgive: 0.95 },
  { id: 'iron7', name: '7 Iron', short: '7i', speed: 52.5, launch: 16, spin: 7000, forgive: 1 },
  { id: 'iron9', name: '9 Iron', short: '9i', speed: 47, launch: 20.5, spin: 8600, forgive: 1.05 },
  { id: 'pw', name: 'Pitching Wedge', short: 'PW', speed: 43.5, launch: 24, spin: 9200, wedge: true, forgive: 1.1 },
  { id: 'sw', name: 'Sand Wedge', short: 'SW', speed: 36.5, launch: 31, spin: 10000, wedge: true, forgive: 1.15 },
  { id: 'putter', name: 'Putter', short: 'Pt', speed: 0, launch: 0, spin: 0, putter: true, forgive: 1.3 },
];

export const clubOf = (id: string | null | undefined) => CLUBS.find((c) => c.id === id) ?? null;

/** What the player's screen sends when the ball is struck. */
export interface Swing {
  club: string;
  /** How hard: 0..1, a little over (to 1.1) for an overswing. */
  power: number;
  /** How square: 0 perfect; |1| the edge of a good strike; beyond, a mishit. Negative: early (pulls, hooks). */
  accuracy: number;
  /** The strike point: `spin` -1 (low on the ball: backspin) .. 1 (high: a runner); `curve` -1 draw .. 1 fade. */
  spin: number;
  curve: number;
  /** Where they aimed (yaw). */
  yaw: number;
  /** A putt: the meter's full length (blocks on a flat green). */
  scale?: number;
}

/** How each lie plays: ball speed, spin and how much it spoils the timing. */
export interface LieEffect {
  speed: number;
  spin: number;
  launch: number;
  /** Timing: how much a mistimed swing hurts (more in a bad lie). */
  shaky: number;
  /** Woods from here lose this much more. */
  woods: number;
  label: string;
}

export function lieEffect(surf: Surf, club: Club): LieEffect {
  switch (surf) {
    case Surf.Tee:
      return { speed: 1, spin: 1, launch: 0, shaky: 1, woods: 1, label: 'Tee' };
    case Surf.Fairway:
    case Surf.Path:
      return { speed: club.id === 'driver' ? 0.93 : 1, spin: 1, launch: club.id === 'driver' ? -2.5 : 0, shaky: club.id === 'driver' ? 1.4 : 1, woods: 1, label: surf === Surf.Path ? 'Cart path' : 'Fairway' };
    case Surf.Fringe:
    case Surf.Green:
      return { speed: 0.98, spin: 0.95, launch: 0, shaky: 1, woods: 0.95, label: surf === Surf.Green ? 'Green' : 'Fringe' };
    case Surf.Rough:
      return { speed: 0.9, spin: 0.6, launch: 1, shaky: 1.25, woods: 0.88, label: 'Rough' };
    case Surf.Sand:
      return club.wedge
        ? { speed: club.id === 'sw' ? 0.82 : 0.72, spin: 0.7, launch: 2, shaky: 1.35, woods: 1, label: 'Bunker' }
        : { speed: 0.62, spin: 0.5, launch: -1, shaky: 1.8, woods: 0.6, label: 'Bunker' };
    default:
      return { speed: 0.74, spin: 0.45, launch: 2, shaky: 1.6, woods: 0.72, label: 'Deep rough' };
  }
}

/** The launch a swing makes: speed (m/s), angle up and spin, and how it's turned off the aim. */
export interface Strike {
  speed: number;
  /** Radians up. */
  angle: number;
  spin: number;
  /** Radians: the spin axis's tilt (curve), and where it starts off the aim. */
  tilt: number;
  face: number;
  /** A putt's forward roll off the face (0..1). */
  roll: number;
  /** How it came off: 'pure', 'good', 'hook', 'slice', 'duff'. */
  quality: 'pure' | 'good' | 'pull' | 'push' | 'hook' | 'slice' | 'duff';
}

export function strike(club: Club, s: Swing, lie: Surf, luck: () => number, puttSpeed: (metres: number, roll0: number) => number): Strike {
  const effect = lieEffect(lie, club);
  const acc = clamp(s.accuracy, -2, 2) * effect.shaky / club.forgive;
  const spinPt = clamp(s.spin, -1, 1);
  const curve = clamp(s.curve, -1, 1);
  const quality: Strike['quality'] =
    Math.abs(acc) < 0.12 ? 'pure' : Math.abs(acc) < 0.55 ? 'good' : Math.abs(acc) < 1 ? (acc < 0 ? 'pull' : 'push') : Math.abs(acc) < 1.6 ? (acc < 0 ? 'hook' : 'slice') : 'duff';

  if (club.putter) {
    // Speed by the meter's scale; a mistimed stroke pushes or pulls it a touch.
    const metres = (clamp(s.scale ?? 10, 1, 60) * clamp(s.power, 0, 1.1)) / S;
    const roll = 0.25 + 0.2 * spinPt;
    return {
      speed: puttSpeed(metres, roll) * (quality === 'duff' ? 0.8 : 1),
      angle: 0,
      spin: 0,
      tilt: 0,
      face: acc * 0.011 + (luck() - 0.5) * 0.002,
      roll,
      quality,
    };
  }

  const power = clamp(s.power, 0.02, 1.1);
  // Ball speed: distance comes out close to in step with the meter; an overswing adds a little.
  let speed = club.speed * Math.pow(Math.min(power, 1), 0.62) * (power > 1 ? 1 + 0.55 * (power - 1) : 1);
  speed *= effect.speed * (club.wood ? effect.woods : 1);
  let spin = club.spin * Math.pow(Math.min(power, 1), 0.3) * effect.spin;
  let launch = club.launch + effect.launch;
  // Where the face met it: low on the ball spins it and lifts it; high flattens it out.
  spin *= spinPt < 0 ? 1 + 0.5 * -spinPt : 1 - 0.35 * spinPt;
  launch += -spinPt * 2.4;
  speed *= 1 - 0.025 * Math.abs(spinPt);
  // The strike: square flies straight; early closes the face (a pull that hooks); late opens it.
  let face = acc * 0.02 - curve * 0.022;
  let tilt = acc * 0.11 + curve * 0.12;
  if (Math.abs(acc) > 1) {
    const miss = Math.min(1, Math.abs(acc) - 1);
    speed *= 1 - 0.3 * miss;
    launch += (luck() - 0.4) * 6 * miss;
    face += Math.sign(acc) * miss * 0.045;
    tilt += Math.sign(acc) * miss * 0.18;
  }
  // A bad lie adds a little of its own.
  if (effect.shaky > 1.2) {
    face += (luck() - 0.5) * 0.03 * (effect.shaky - 1);
    speed *= 1 - luck() * 0.06 * (effect.shaky - 1);
  }
  return { speed, angle: (Math.max(1, launch) * Math.PI) / 180, spin, tilt, face, roll: 0, quality };
}
