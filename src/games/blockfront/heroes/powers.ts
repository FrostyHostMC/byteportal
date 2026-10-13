import type { GameContext, Player, Vec3 } from '@platform';
import { match } from '../match';
import { HERO_ABILITY, coolOf, type HeroMove } from './abilities';
import { HEROES, type HeroId, type PowerId } from './defs';
import { POWERS, QUARREL } from './tuning';
import { MSG, p3, type Burn, type Power, type Rocket, type Zap } from './wire';

/** What the powers need of the heroes' rules. */
export interface PowerRules {
  hostile(a: Player, b: Player): boolean;
  /** The hero they are now, if any. */
  heroOf(p: Player): HeroId | null;
  /** Heal a hero (past the cap on a hero's own healing, `rules.ts`). */
  heal(p: Player, amount: number): void;
}

/** Names the powers' hits go by (the kill feed shows them as they are). */
export const FORCE = {
  push: 'Force Push',
  rush: 'Saber Rush',
  leap: 'Force Leap',
  pull: 'Force Pull',
  throw: 'Saber Throw',
  choke: 'Force Choke',
  lightning: 'Force Lightning',
  chain: 'Chain Lightning',
  aura: 'Dark Aura',
  charge: 'Wookiee Charge',
  roar: 'Wookiee Roar',
  rocket: 'Wrist Rocket',
  flame: 'Flamethrower',
} as const;

/** The bowcaster (its quarrels, a scatter shot's too, burst where they hit). */
const BOWCASTER = 'hero_bowcaster';

/** The powers that are movement abilities (`abilities.ts`): their keys aren't the server's to read. */
const MOVES = new Set<PowerId>(['rush', 'leap', 'charge', 'jetpack']);

/**
 * Someone a power has hold of: dragged in and stunned (a pull), lifted by the throat (a choke),
 * knocked flat (a charge: thrown first, frozen once down), or staggered (a roar).
 */
interface Held {
  by: Player;
  kind: 'pull' | 'choke' | 'down' | 'stun';
  /** Host time it took hold, and when it lets go. */
  from: number;
  until: number;
  /** Where they were taken from, and where they're taken to (a pull's end, a choke's height). */
  a: Vec3;
  b: Vec3;
  /** Seconds the move takes (the pull, the lift); after that they're held there. */
  move: number;
  /** A choke's harm not dealt yet (it's dealt in pulses). */
  owed: number;
  /** Knocked flat: when they're frozen where they fell (host time; they fly first). */
  freezeAt?: number;
}

/** A rocket in flight: where, which way, whom it seeks, how long it's flown, when every screen last heard. */
interface Flying {
  n: number;
  by: Player;
  at: Vec3;
  dir: Vec3;
  target: Player | null;
  age: number;
  told: number;
}

/** Ground on fire (the flamethrower's): burning until, and its next bite. */
interface Patch {
  at: Vec3;
  by: Player;
  until: number;
  next: number;
}

/** A saber thrown: out along `dir` to `dist`, and back to the hand. */
interface Thrown {
  from: Vec3;
  dir: Vec3;
  dist: number;
  start: number;
  /** Where it was last step, and who each leg has cut. */
  last: Vec3;
  cut: [Set<string>, Set<string>];
}

/** What a hero has going: powers that last, a thrown saber, a rush's cuts, lightning. */
interface Going {
  soresu: number;
  rage: number;
  aura: number;
  auraNext: number;
  /** Lightning: on until (host time), and its next zap. */
  lightning: number;
  zapNext: number;
  zapped: string;
  /** Whom they're choking (their id). */
  choking: string | null;
  thrown: Thrown | null;
  /** A rush (Luke's) or a charge (Chewblocca's) under way: who it's met, where it was, until when. */
  rush: { charge: boolean; cut: Set<string>; last: Vec3; until: number } | null;
  /** The flamethrower: on until (host time), and its next patch of burning ground. */
  flame: number;
  flameNext: number;
  /** Enraged (the roar) until. */
  enraged: number;
}

export interface Powers {
  /** Each step: keys pressed, powers under way, those held let go. */
  update(dt: number): void;
  /** Use a hero's power now (the one in `slot`: 0 Q, 1 E, 2 F), if it's ready; whether it was used. */
  use(p: Player, slot: number): boolean;
  /** Their powers stop, and whoever they held goes (they died, they're no hero now). */
  end(p: Player): void;
  /** Everything stops (a restart). */
  clear(): void;
  /** Deflecting from every side (Soresu). */
  soresu(p: Player): boolean;
  /** Their hands are busy: no swinging (the saber thrown, a choke, lightning, a stance). */
  busy(p: Player): boolean;
  /** The guard can't go up (the saber thrown, a choke, lightning). */
  unguarded(p: Player): boolean;
  /** Times their speed now (a rage, a stance, choking, lightning). */
  speed(p: Player): number;
  /** Times a swing's damage and length (a rage). */
  rage(p: Player): boolean;
  /** Held by a power (pulled in, choked): no powers of their own. */
  held(p: Player): boolean;
  /** A saber in flight: where it is now, if theirs is. */
  thrown(p: Player): Vec3 | null;
  /** Enraged (Chewblocca's roar): he takes less, and mends fast. */
  enraged(p: Player): boolean;
  /**
   * A bowcaster quarrel from `from` along `dir`: where it bursts (the first body or block), the
   * burst's blast; with `direct`, its hit on whoever it met too (a scatter shot's: the gun kit's
   * own shots hit by themselves). Returns where it burst.
   */
  quarrel(by: Player, from: Vec3, dir: Vec3, direct: number): Vec3;
  /** Rockets in flight now (for tests). */
  rockets(): readonly { at: Vec3; by: Player }[];
}

const DEG = Math.PI / 180;
const chest = (p: Player): Vec3 => ({ x: p.position.x, y: p.position.y + 1.2, z: p.position.z });
const ease = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });
/** Distance from `p` to the segment a-b. */
function toSegment(p: Vec3, a: Vec3, b: Vec3): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const abz = b.z - a.z;
  const l = abx * abx + aby * aby + abz * abz;
  const t = l > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / l)) : 0;
  return Math.hypot(p.x - (a.x + abx * t), p.y - (a.y + aby * t), p.z - (a.z + abz * t));
}

/**
 * The Force powers on the server: Q, E and F read from each hero's controls (people's and bots'
 * alike), each power's cooldown kept in their movement ability's state (`abilities.ts`: their
 * screen counts it down too, and the hero HUD shows it), what each does, and what every screen is
 * told of it (`wire.ts`). Saber Rush, Force Leap, the Wookiee Charge and the jetpack are movement
 * abilities (predicted); what they do to others (cuts, a landing, bowling people over) is here
 * (the `ability` event).
 */
export function setupPowers(game: GameContext, rules: PowerRules): Powers {
  const going = new Map<string, Going>();
  const held = new Map<string, Held>();
  const inFlight: Flying[] = [];
  const patches: Patch[] = [];
  let rocketN = 0;
  /** Quarrels burst this step, told to every screen together. */
  let bursts: Burn['list'] = [];

  const of = (p: Player): Going => {
    let g = going.get(p.id);
    if (!g) going.set(p.id, (g = { soresu: 0, rage: 0, aura: 0, auraNext: 0, lightning: 0, zapNext: 0, zapped: '', choking: null, thrown: null, rush: null, flame: 0, flameNext: 0, enraged: 0 }));
    return g;
  };
  const move = (p: Player): HeroMove => p.abilities[HERO_ABILITY] as HeroMove;
  const send = (m: Power) => game.clients.send('all', MSG.power, m);
  const now = () => game.clock.now;
  const heroScale = (t: Player) => (rules.heroOf(t) ? POWERS.heroes : 1);

  /** Enemies of `p` in sight: within `range` of its eye, and (with `arc`) in a cone that wide about its look. */
  const enemies = (p: Player, range: number, arc?: number): Player[] => {
    const eye = p.eye;
    const look = p.look;
    const cos = arc === undefined ? -2 : Math.cos(arc * DEG);
    return game.players.filter((t) => {
      if (t === p || !t.alive || !rules.hostile(p, t)) return false;
      const c = chest(t);
      const dx = c.x - eye.x;
      const dy = c.y - eye.y;
      const dz = c.z - eye.z;
      const d = Math.hypot(dx, dy, dz);
      if (d > range || (d > 1 && (dx * look.x + dy * look.y + dz * look.z) / d < cos)) return false;
      return game.world.lineOfSight(eye, c) || game.world.lineOfSight(eye, { x: c.x, y: c.y + 0.45, z: c.z });
    });
  };
  /** The enemy nearest the crosshair, within `range` and `POWERS.aim` of it. */
  const aimed = (p: Player, range: number, exclude?: Set<string>): Player | null => {
    const eye = p.eye;
    const look = p.look;
    let best: Player | null = null;
    let bestScore = Infinity;
    for (const t of enemies(p, range, POWERS.aim + 6)) {
      if (exclude?.has(t.id) || held.has(t.id)) continue;
      const c = chest(t);
      const d = Math.hypot(c.x - eye.x, c.y - eye.y, c.z - eye.z) || 1;
      const angle = Math.acos(Math.min(1, ((c.x - eye.x) * look.x + (c.y - eye.y) * look.y + (c.z - eye.z) * look.z) / d)) / DEG;
      // Wider up close (a body fills more of the view), a little for being nearer.
      const allowed = POWERS.aim + Math.atan2(0.6, d) / DEG;
      if (angle > allowed) continue;
      const score = angle + d * 0.15;
      if (score < bestScore) {
        bestScore = score;
        best = t;
      }
    }
    return best;
  };
  const hurt = (t: Player, amount: number, by: Player, weapon: string, knockback = 0, cause: 'melee' | 'fire' | 'gun' = 'melee') => t.damage(amount, { source: by, knockback, weapon, cause, from: by.position });

  /**
   * Along a ray from `from` (unit `dir`), within `range`: the first body (anyone but `by`, as a
   * standing cylinder) or solid block it meets, and where.
   */
  const trace = (by: Player, from: Vec3, dir: Vec3, range: number): { at: Vec3; body: Player | null } => {
    const hit = game.world.raycast(from, dir, range);
    let far = hit ? Math.hypot(hit.point.x - from.x, hit.point.y - from.y, hit.point.z - from.z) : range;
    let body: Player | null = null;
    const flat = dir.x * dir.x + dir.z * dir.z;
    for (const t of game.players) {
      if (t === by || !t.alive) continue;
      // Where the ray comes nearest the body's upright axis (level), and whether that's in it.
      const s = flat > 1e-6 ? ((t.position.x - from.x) * dir.x + (t.position.z - from.z) * dir.z) / flat : Math.max(0, t.position.y - from.y) / Math.max(1e-6, Math.abs(dir.y));
      if (s <= 0 || s >= far) continue;
      const q = { x: from.x + dir.x * s, y: from.y + dir.y * s, z: from.z + dir.z * s };
      if (Math.hypot(q.x - t.position.x, q.z - t.position.z) > 0.45 || q.y < t.position.y - 0.1 || q.y > t.position.y + 1.95) continue;
      far = s;
      body = t;
    }
    return { at: { x: from.x + dir.x * far, y: from.y + dir.y * far, z: from.z + dir.z * far }, body };
  };

  const quarrel = (by: Player, from: Vec3, dir: Vec3, direct: number): Vec3 => {
    const { at, body } = trace(by, from, dir, 150);
    if (body && direct > 0) body.damage(direct, { source: by, cause: 'gun', weapon: BOWCASTER, part: 'body', knockback: 0.5, from: by.position });
    // Burst: a small blast (it breaks no blocks; its look is every screen's own).
    game.world.explode(at, 0.4, { effect: false, filter: () => false, damage: QUARREL.damage, reach: QUARREL.radius, knockback: QUARREL.knockback, by, weapon: BOWCASTER });
    bursts.push(p3(at));
    return at;
  };

  /** Let go of someone held. */
  const release = (id: string) => {
    const h = held.get(id);
    if (!h) return;
    held.delete(id);
    const v = game.players.find((q) => q.id === id);
    if (v && v.alive && match.phase === 'playing') v.freeze(false);
    if (h.kind === 'choke') {
      const g = going.get(h.by.id);
      if (g?.choking === id) {
        g.choking = null;
        send({ p: h.by.id, k: 'choke', on: false, target: id });
      }
    }
  };

  const setCool = (p: Player, slot: number, seconds: number) => {
    const m = move(p);
    if (slot === 0) m.c0 = seconds;
    else if (slot === 1) m.c1 = seconds;
    else m.c2 = seconds;
  };
  const setActive = (p: Player, slot: number, seconds: number) => {
    const m = move(p);
    if (slot === 0) m.a0 = seconds;
    else if (slot === 1) m.a1 = seconds;
    else m.a2 = seconds;
  };

  // ---- Each power: whether it went off.
  const powers: Record<Exclude<PowerId, 'rush' | 'leap' | 'charge' | 'jetpack'>, (p: Player, slot: number) => boolean> = {
    scatter(p) {
      const S = POWERS.scatter;
      const eye = p.eye;
      const look = p.look;
      const ends: [number, number, number][] = [];
      for (let i = 0; i < S.quarrels; i++) {
        // Fanned across the look, level.
        const a = (i / (S.quarrels - 1) - 0.5) * S.fan * DEG;
        const c = Math.cos(a);
        const sn = Math.sin(a);
        const dir = { x: look.x * c + look.z * sn, y: look.y, z: look.z * c - look.x * sn };
        const l = Math.hypot(dir.x, dir.y, dir.z) || 1;
        ends.push(p3(quarrel(p, eye, { x: dir.x / l, y: dir.y / l, z: dir.z / l }, S.damage)));
      }
      send({ p: p.id, k: 'scatter', path: ends.map((e) => e.join(',')) });
      game.audio.play('bfh_bowcaster', { at: eye, pitch: 0.85 });
      return true;
    },
    roar(p, slot) {
      const R = POWERS.roar;
      const g = of(p);
      const t = HEROES.chewie.powers[2].lasts ?? 6;
      g.enraged = now() + t;
      setActive(p, slot, t);
      const hits = enemies(p, R.radius);
      for (const v of hits) {
        hurt(v, R.damage * heroScale(v), p, FORCE.roar);
        const dx = v.position.x - p.position.x;
        const dz = v.position.z - p.position.z;
        const d = Math.hypot(dx, dz) || 1;
        v.impulse((dx / d) * R.out, 3, (dz / d) * R.out);
        if (!held.has(v.id)) held.set(v.id, { by: p, kind: 'stun', from: now(), until: now() + R.stagger, a: { ...v.position }, b: { ...v.position }, move: 0, owed: 0, freezeAt: now() + 0.2 });
      }
      send({ p: p.id, k: 'roar', on: true, t, hits: hits.map((h) => h.id) });
      game.audio.play('bfh_roar', { at: p.eye });
      return true;
    },
    rocket(p) {
      const R = POWERS.rocket;
      const target = aimed(p, R.range);
      const look = p.look;
      // From his left wrist, a little ahead.
      const from = { x: p.eye.x + look.x * 0.6 - look.z * -0.25, y: p.eye.y - 0.35, z: p.eye.z + look.z * 0.6 + look.x * -0.25 };
      const n = ++rocketN;
      inFlight.push({ n, by: p, at: from, dir: { ...look }, target, age: 0, told: now() });
      send({ p: p.id, k: 'rocket', from: p3(from), dir: p3(look), target: target?.id, t: n });
      game.audio.play('bfh_rocket', { at: from });
      return true;
    },
    flame(p, slot) {
      const g = of(p);
      const t = HEROES.boba.powers[1].lasts ?? 3;
      g.flame = now() + t;
      g.flameNext = 0;
      setActive(p, slot, t);
      send({ p: p.id, k: 'flame', on: true, t });
      return true;
    },
    push(p) {
      const P = POWERS.push;
      const hits = enemies(p, P.range, P.arc);
      const fx = -Math.sin(p.yaw);
      const fz = -Math.cos(p.yaw);
      for (const t of hits) {
        hurt(t, P.damage * heroScale(t), p, FORCE.push);
        const dx = t.position.x - p.position.x;
        const dz = t.position.z - p.position.z;
        const d = Math.hypot(dx, dz) || 1;
        // Away from him, mostly the way he faces; less the further off.
        const k = (1.15 - Math.min(1, d / P.range) * 0.5) * (rules.heroOf(t) ? 0.55 : 1);
        const ax = (dx / d) * 0.6 + fx * 0.4;
        const az = (dz / d) * 0.6 + fz * 0.4;
        t.impulse(ax * P.out * k, P.up * k, az * P.out * k);
      }
      send({ p: p.id, k: 'push', hits: hits.map((h) => h.id), dir: [fx, 0, fz] });
      game.audio.play('bfh_force_push', { at: p.eye });
      return true;
    },
    pull(p) {
      const P = POWERS.pull;
      const t = aimed(p, P.range);
      if (!t) return false;
      const fx = -Math.sin(p.yaw);
      const fz = -Math.cos(p.yaw);
      // Where they land: in front of him, or as near that as a body fits (not in a wall); else where they are.
      let to = { ...t.position };
      for (const d of [P.lands, P.lands * 0.6, 1]) {
        const at = { x: p.position.x + fx * d, y: p.position.y, z: p.position.z + fz * d };
        if (game.world.fits(at)) {
          to = at;
          break;
        }
      }
      const stun = rules.heroOf(t) ? P.heroStun : P.stun;
      held.set(t.id, { by: p, kind: 'pull', from: now(), until: now() + P.time + stun, a: { ...t.position }, b: to, move: P.time, owed: 0 });
      t.freeze(true, { weapons: true });
      hurt(t, P.damage * heroScale(t), p, FORCE.pull);
      send({ p: p.id, k: 'pull', target: t.id, t: P.time + stun });
      game.audio.play('bfh_force_pull', { at: p.eye });
      return true;
    },
    soresu(p, slot) {
      const g = of(p);
      const t = HEROES.ben.powers[2].lasts ?? 5;
      g.soresu = now() + t;
      setActive(p, slot, t);
      send({ p: p.id, k: 'soresu', on: true, t });
      game.audio.play('bfh_force_stance', { at: p.eye });
      return true;
    },
    throw(p) {
      const g = of(p);
      if (g.thrown) return false;
      const P = POWERS.throw;
      const from = { x: p.position.x, y: p.position.y + 1.25, z: p.position.z };
      // Along the look, kept fairly level (it skims the ground rather than digging in).
      const look = p.look;
      const pitch = Math.max(-0.25, Math.min(0.35, Math.asin(Math.max(-1, Math.min(1, look.y)))));
      const dir = { x: -Math.sin(p.yaw) * Math.cos(pitch), y: Math.sin(pitch), z: -Math.cos(p.yaw) * Math.cos(pitch) };
      const hit = game.world.raycast(from, dir, P.range);
      const dist = Math.max(2, hit ? Math.hypot(hit.point.x - from.x, hit.point.y - from.y, hit.point.z - from.z) - 0.4 : P.range);
      g.thrown = { from, dir, dist, start: now(), last: { ...from }, cut: [new Set(), new Set()] };
      send({ p: p.id, k: 'throw', from: p3(from), dir: p3(dir), dist: Math.round(dist * 100) / 100, t: P.out + P.back });
      game.audio.play('bfh_saber_throw', { at: from });
      return true;
    },
    choke(p, slot) {
      const P = POWERS.choke;
      const g = of(p);
      if (g.choking) return false;
      const t = aimed(p, P.range);
      if (!t) return false;
      // Lifted as high as there's room for (not into a ceiling).
      const lift = [P.lift, P.lift * 0.5, 0].find((h) => game.world.fits({ x: t.position.x, y: t.position.y + h, z: t.position.z })) ?? 0;
      held.set(t.id, { by: p, kind: 'choke', from: now(), until: now() + P.time, a: { ...t.position }, b: { x: t.position.x, y: t.position.y + lift, z: t.position.z }, move: P.rise, owed: 0 });
      t.freeze(true, { weapons: true });
      g.choking = t.id;
      setActive(p, slot, P.time);
      send({ p: p.id, k: 'choke', on: true, target: t.id, t: P.time });
      game.audio.play('bfh_force_choke', { at: chest(t) });
      return true;
    },
    rage(p, slot) {
      const g = of(p);
      const t = HEROES.vader.powers[2].lasts ?? 7;
      g.rage = now() + t;
      setActive(p, slot, t);
      send({ p: p.id, k: 'rage', on: true, t });
      game.audio.play('bfh_force_rage', { at: p.eye });
      return true;
    },
    lightning(p, slot) {
      const g = of(p);
      const t = HEROES.emperor.powers[0].lasts ?? 3;
      g.lightning = now() + t;
      g.zapNext = 0;
      g.zapped = '';
      setActive(p, slot, t);
      send({ p: p.id, k: 'lightning', on: true, t });
      return true;
    },
    chain(p) {
      const P = POWERS.chain;
      const first = aimed(p, P.range);
      if (!first) return false;
      const path = [first];
      const seen = new Set([first.id]);
      while (path.length < P.jumps) {
        const last = path[path.length - 1];
        const lc = chest(last);
        let next: Player | null = null;
        let nd = P.jump;
        for (const t of game.players) {
          if (seen.has(t.id) || !t.alive || !rules.hostile(p, t)) continue;
          const d = Math.hypot(t.position.x - last.position.x, t.position.y - last.position.y, t.position.z - last.position.z);
          if (d < nd && game.world.lineOfSight(lc, chest(t))) {
            nd = d;
            next = t;
          }
        }
        if (!next) break;
        seen.add(next.id);
        path.push(next);
      }
      path.forEach((t, i) => hurt(t, P.damage * P.falloff ** i * heroScale(t), p, FORCE.chain, 0.2));
      send({ p: p.id, k: 'chain', path: path.map((t) => t.id) });
      game.audio.play('bfh_lightning_chain', { at: p.eye });
      return true;
    },
    aura(p, slot) {
      const g = of(p);
      const t = HEROES.emperor.powers[2].lasts ?? 6;
      g.aura = now() + t;
      g.auraNext = now();
      setActive(p, slot, t);
      send({ p: p.id, k: 'aura', on: true, t });
      game.audio.play('bfh_dark_aura', { at: p.eye });
      return true;
    },
  };

  /** A power used now, if it's ready (and theirs, and they're free to). */
  const use = (p: Player, slot: number): boolean => {
    const id = rules.heroOf(p);
    if (!id || !p.alive || held.has(p.id) || match.phase !== 'playing') return false;
    const info = HEROES[id].powers[slot];
    if (!info || MOVES.has(info.id)) return false;
    const m = move(p);
    if (coolOf(m, slot) > 0) return false;
    const g = of(p);
    // One thing at a time with the hands: no power while the saber's out, choking, or holding lightning or fire.
    if (g.thrown || g.choking || g.lightning > now() || g.flame > now()) return false;
    if (!powers[info.id as keyof typeof powers](p, slot)) return false;
    // A held power's cooldown starts when it's let go.
    if (!info.hold) setCool(p, slot, info.cooldown);
    return true;
  };

  /** Lightning stops: its cooldown starts now. */
  const stopLightning = (p: Player, g: Going) => {
    g.lightning = 0;
    setActive(p, 0, 0);
    setCool(p, 0, HEROES.emperor.powers[0].cooldown);
    send({ p: p.id, k: 'lightning', on: false });
  };
  /** The flamethrower stops: its cooldown starts now. */
  const stopFlame = (p: Player, g: Going) => {
    g.flame = 0;
    setActive(p, 1, 0);
    setCool(p, 1, HEROES.boba.powers[1].cooldown);
    send({ p: p.id, k: 'flame', on: false });
  };

  /** Fire from his wrist: everyone in the cone burning; now and then the ground where it reaches catches. */
  const flaming = (p: Player, g: Going, dt: number) => {
    const F = POWERS.flame;
    for (const t of enemies(p, F.range, F.arc)) hurt(t, F.dps * dt * heroScale(t), p, FORCE.flame, 0, 'fire');
    if (now() < g.flameNext) return;
    g.flameNext = now() + F.patch;
    // Where it reaches: the first block along the look, or the ground under the cone's end.
    const eye = p.eye;
    const look = p.look;
    const hit = game.world.raycast(eye, look, F.range);
    let at = hit ? hit.point : { x: eye.x + look.x * F.range, y: eye.y + look.y * F.range, z: eye.z + look.z * F.range };
    const down = game.world.raycast({ x: at.x, y: at.y + 0.2, z: at.z }, { x: 0, y: -1, z: 0 }, 6);
    if (!down) return;
    at = { x: down.point.x, y: down.point.y + 0.05, z: down.point.z };
    patches.push({ at, by: p, until: now() + F.burns, next: now() + 0.2 });
    game.clients.send('all', MSG.burn, { list: [p3(at)], t: F.burns } satisfies Burn);
  };

  /** Rockets fly, turning toward whom they seek, and go off on the first body or block they meet. */
  const rocketsFly = (dt: number) => {
    const R = POWERS.rocket;
    for (let i = inFlight.length - 1; i >= 0; i--) {
      const r = inFlight[i];
      r.age += dt;
      // Seek: turn toward the target's chest, at most so fast.
      if (r.target?.alive) {
        const c = chest(r.target);
        const to = { x: c.x - r.at.x, y: c.y - r.at.y, z: c.z - r.at.z };
        const l = Math.hypot(to.x, to.y, to.z) || 1;
        const k = Math.min(1, R.turn * dt);
        const d = { x: r.dir.x + (to.x / l - r.dir.x) * k, y: r.dir.y + (to.y / l - r.dir.y) * k, z: r.dir.z + (to.z / l - r.dir.z) * k };
        const dl = Math.hypot(d.x, d.y, d.z) || 1;
        r.dir = { x: d.x / dl, y: d.y / dl, z: d.z / dl };
      }
      const step = R.speed * dt;
      const { at, body } = trace(r.by, r.at, r.dir, step);
      const blocked = !body && Math.hypot(at.x - r.at.x, at.y - r.at.y, at.z - r.at.z) < step - 1e-3;
      // Anyone close by it (it goes off on a near miss too), not its firer.
      const near = game.players.find((t) => t !== r.by && t.alive && toSegment({ x: t.position.x, y: t.position.y + 1, z: t.position.z }, r.at, at) < 0.7);
      r.at = at;
      if (body || blocked || near || r.age >= R.life) {
        inFlight.splice(i, 1);
        game.world.explode(at, R.radius, { damage: R.damage, reach: R.reach, knockback: R.knockback, by: r.by, weapon: FORCE.rocket });
        send({ p: r.by.id, k: 'rocket', on: false, t: r.n, at: p3(at) });
        continue;
      }
      if (now() - r.told >= 0.1) {
        r.told = now();
        game.clients.send('all', MSG.rocket, { n: r.n, at: p3(r.at), dir: p3(r.dir) } satisfies Rocket);
      }
    }
  };

  /** Burning ground: a bite every half second to anyone standing in it. */
  const burning = () => {
    const F = POWERS.flame;
    for (let i = patches.length - 1; i >= 0; i--) {
      const b = patches[i];
      if (now() >= b.until) {
        patches.splice(i, 1);
        continue;
      }
      if (now() < b.next) continue;
      b.next = now() + 0.5;
      for (const t of game.players) {
        if (!t.alive || !rules.hostile(b.by, t)) continue;
        if (Math.hypot(t.position.x - b.at.x, t.position.z - b.at.z) > F.burnRadius || Math.abs(t.position.y - b.at.y) > 1.2) continue;
        hurt(t, F.burn * 0.5 * heroScale(t), b.by, FORCE.flame, 0, 'fire');
      }
    }
  };

  /** A rush under way: everyone in its path is cut (once), and thrown aside. */
  const rushing = (p: Player, g: Going) => {
    const r = g.rush!;
    const R = r.charge ? POWERS.charge : POWERS.rush;
    const a = r.last;
    const b = { ...p.position };
    for (const t of game.players) {
      if (t === p || !t.alive || r.cut.has(t.id) || !rules.hostile(p, t)) continue;
      const mid = { x: t.position.x, y: t.position.y + 0.9, z: t.position.z };
      if (toSegment(mid, { x: a.x, y: a.y + 0.9, z: a.z }, { x: b.x, y: b.y + 0.9, z: b.z }) > R.radius) continue;
      r.cut.add(t.id);
      if (!r.charge) {
        if (!hurt(t, R.damage * heroScale(t), p, FORCE.rush, 0.8)) continue;
        game.clients.send('all', MSG.cut, { p: p.id, at: p3(chest(t)) });
        game.audio.play('bfh_saber_hit', { at: chest(t) });
        continue;
      }
      // A charge: bowled over, flung aside and up, and flat on their back a moment.
      const C = POWERS.charge;
      if (!hurt(t, C.damage * heroScale(t), p, FORCE.charge)) continue;
      const fx = -Math.sin(p.yaw);
      const fz = -Math.cos(p.yaw);
      // Aside: off the side of his path they were on, and on ahead.
      const side = (t.position.x - p.position.x) * -fz + (t.position.z - p.position.z) * fx >= 0 ? 1 : -1;
      const k = rules.heroOf(t) ? 0.5 : 1;
      t.impulse((fx * 0.7 - fz * side * 0.6) * C.out * k, C.up * k, (fz * 0.7 + fx * side * 0.6) * C.out * k);
      const down = rules.heroOf(t) ? C.heroDown : C.down;
      if (!held.has(t.id)) held.set(t.id, { by: p, kind: 'down', from: now(), until: now() + down, a: { ...t.position }, b: { ...t.position }, move: 0, owed: 0, freezeAt: now() + 0.35 });
      send({ p: p.id, k: 'knock', target: t.id, t: down });
      game.audio.play('bfh_knock', { at: chest(t) });
    }
    r.last = b;
    if (now() > r.until) g.rush = null;
  };

  /** The saber in flight: out, then back to his hand, cutting whoever it passes (once each way). */
  const flying = (p: Player, g: Going) => {
    const th = g.thrown!;
    const P = POWERS.throw;
    const t = now() - th.start;
    const out = t < P.out;
    const tip = { x: th.from.x + th.dir.x * th.dist, y: th.from.y + th.dir.y * th.dist, z: th.from.z + th.dir.z * th.dist };
    const hand = { x: p.position.x, y: p.position.y + 1.25, z: p.position.z };
    const at = out ? lerp(th.from, tip, Math.sin((t / P.out) * Math.PI * 0.5)) : lerp(tip, hand, ease((t - P.out) / P.back));
    const cut = th.cut[out ? 0 : 1];
    for (const v of game.players) {
      if (v === p || !v.alive || cut.has(v.id) || !rules.hostile(p, v)) continue;
      const mid = { x: v.position.x, y: v.position.y + 1, z: v.position.z };
      if (toSegment(mid, th.last, at) > P.radius) continue;
      cut.add(v.id);
      if (!hurt(v, P.damage * heroScale(v), p, FORCE.throw, 0.6)) continue;
      game.clients.send('all', MSG.cut, { p: p.id, at: p3(chest(v)) });
      game.audio.play('bfh_saber_hit', { at: chest(v) });
    }
    th.last = at;
    if (t >= P.out + P.back) {
      g.thrown = null;
      game.audio.play('bfh_saber_catch', { at: hand });
    }
  };

  /** Lightning from his hands: everyone in the cone, burning; the guard takes some of it. */
  const zapping = (p: Player, g: Going, dt: number) => {
    const L = POWERS.lightning;
    const hits = enemies(p, L.range, L.arc);
    for (const t of hits) hurt(t, L.dps * dt * heroScale(t), p, FORCE.lightning);
    const key = hits.map((h) => h.id).join(',');
    if (key !== g.zapped || now() >= g.zapNext) {
      g.zapped = key;
      g.zapNext = now() + 0.5;
      game.clients.send('all', MSG.zap, { p: p.id, hits: hits.map((h) => h.id) } satisfies Zap);
    }
  };

  /** Everyone near drained, a little at a time, and he's healed by it. */
  const draining = (p: Player, g: Going) => {
    const A = POWERS.aura;
    if (now() < g.auraNext) return;
    g.auraNext = now() + A.every;
    let took = 0;
    for (const t of enemies(p, A.radius)) {
      const before = t.health;
      hurt(t, A.drain * heroScale(t), p, FORCE.aura);
      took += Math.max(0, before - Math.max(0, t.health));
    }
    if (took > 0) rules.heal(p, took);
  };

  /** Someone held: pulled along to him, or lifted by the throat and choked; let go when it's over. */
  const holding = (id: string, h: Held, dt: number) => {
    const v = game.players.find((q) => q.id === id);
    const by = h.by;
    const gone = !v || !v.alive || !by.alive || rules.heroOf(by) === null;
    const far = v && Math.hypot(v.position.x - by.position.x, v.position.z - by.position.z) > POWERS.choke.range + 6;
    if (gone || now() >= h.until || (h.kind === 'choke' && far)) return release(id);
    // Knocked flat or staggered: frozen once they've come down (they fly first), where they are.
    if (h.kind === 'down' || h.kind === 'stun') {
      if (h.freezeAt !== undefined && now() >= h.freezeAt) {
        v.freeze(true, { weapons: true });
        h.freezeAt = undefined;
      }
      return;
    }
    const t = (now() - h.from) / h.move;
    if (t <= 1.05) {
      // Along an arc: up and over, into place.
      const at = lerp(h.a, h.b, ease(t));
      if (h.kind === 'pull') at.y += Math.sin(Math.min(1, t) * Math.PI) * 0.8;
      v.teleport(at);
    } else if (h.kind === 'choke') v.teleport(h.b);
    // A choke's harm in pulses, four a second.
    if (h.kind === 'choke') {
      h.owed += POWERS.choke.dps * dt * (rules.heroOf(v) ? 0.4 : 1);
      if (h.owed >= POWERS.choke.dps * 0.25 || now() + dt >= h.until) {
        hurt(v, h.owed, by, FORCE.choke);
        h.owed = 0;
      }
    }
  };

  // Someone new on the scene: what's still going (stances, rages, auras, lightning, a choke), so
  // their screen shows it too.
  game.events.on('playerReady', ({ player: to }) => {
    const t = now();
    for (const [id, g] of going) {
      const soon = (until: number) => Math.round((until - t) * 100) / 100;
      const tell = (m: Power) => game.clients.send(to, MSG.power, m);
      if (g.soresu > t) tell({ p: id, k: 'soresu', on: true, t: soon(g.soresu) });
      if (g.rage > t) tell({ p: id, k: 'rage', on: true, t: soon(g.rage) });
      if (g.aura > t) tell({ p: id, k: 'aura', on: true, t: soon(g.aura) });
      if (g.lightning > t) {
        tell({ p: id, k: 'lightning', on: true, t: soon(g.lightning) });
        game.clients.send(to, MSG.zap, { p: id, hits: g.zapped ? g.zapped.split(',') : [] } satisfies Zap);
      }
      if (g.flame > t) tell({ p: id, k: 'flame', on: true, t: soon(g.flame) });
      if (g.enraged > t) tell({ p: id, k: 'roar', on: true, t: soon(g.enraged), hits: [] });
    }
    for (const p of game.players) {
      const f = (p.abilities[HERO_ABILITY] as HeroMove | undefined)?.f ?? 0;
      if (f > 0 && rules.heroOf(p)) game.clients.send(to, MSG.power, { p: p.id, k: 'jetpack', on: true, t: Math.round(f * 100) / 100 } satisfies Power);
    }
    if (patches.length) game.clients.send(to, MSG.burn, { list: patches.map((b) => p3(b.at)), t: Math.max(...patches.map((b) => b.until - t)) } satisfies Burn);
    for (const [victim, h] of held) if (h.kind === 'choke') game.clients.send(to, MSG.power, { p: h.by.id, k: 'choke', on: true, target: victim, t: Math.round((h.until - t) * 100) / 100 } satisfies Power);
  });

  // The movement abilities' powers: Luke's rush (cutting through), his leap and its landing, and
  // every hero's second jump. (Their jumps' dust and voices are each screen's: `client/jumps.ts`.)
  game.events.on('ability', ({ player: p, ability, name }) => {
    if (ability !== HERO_ABILITY || !rules.heroOf(p)) return;
    const g = of(p);
    if (name === 'rush' || name === 'charge') {
      const charge = name === 'charge';
      g.rush = { charge, cut: new Set(), last: { ...p.position }, until: now() + (charge ? POWERS.charge.time : POWERS.rush.time) + 0.12 };
      send({ p: p.id, k: charge ? 'charge' : 'rush' });
      game.audio.play(charge ? 'bfh_charge' : 'bfh_saber_rush', { at: p.eye });
    } else if (name === 'jet') {
      send({ p: p.id, k: 'jetpack', on: true, t: HEROES.boba.powers[2].lasts ?? 4 });
      game.audio.play('bfh_jet', { at: p.position });
    } else if (name === 'jetEnd') {
      send({ p: p.id, k: 'jetpack', on: false });
    } else if (name === 'leap') {
      send({ p: p.id, k: 'leap' });
      game.audio.play('bfh_force_leap', { at: p.eye });
    } else if (name === 'land') {
      const L = POWERS.leap;
      const at = { ...p.position };
      const hits = game.players.filter((t) => t !== p && t.alive && rules.hostile(p, t) && Math.hypot(t.position.x - at.x, t.position.y - at.y, t.position.z - at.z) < L.radius && game.world.lineOfSight({ x: at.x, y: at.y + 0.6, z: at.z }, chest(t)));
      for (const t of hits) {
        hurt(t, L.damage * heroScale(t), p, FORCE.leap);
        const dx = t.position.x - at.x;
        const dz = t.position.z - at.z;
        const d = Math.hypot(dx, dz) || 1;
        const k = 1 - (d / L.radius) * 0.5;
        t.impulse((dx / d) * L.out * k, L.up2 * k, (dz / d) * L.out * k);
      }
      send({ p: p.id, k: 'land', at: p3(at), hits: hits.map((h) => h.id) });
      game.audio.play('bfh_force_land', { at });
    } else if (name === 'djump') {
      // A second jump in the air: every screen but theirs flips their figure (theirs ran ahead).
      send({ p: p.id, k: 'djump' });
    }
  });

  const endAll = (p: Player) => {
    const g = going.get(p.id);
    if (g) {
      if (g.lightning) send({ p: p.id, k: 'lightning', on: false });
      if (g.soresu > now()) send({ p: p.id, k: 'soresu', on: false });
      if (g.rage > now()) send({ p: p.id, k: 'rage', on: false });
      if (g.aura > now()) send({ p: p.id, k: 'aura', on: false });
      if (g.flame) send({ p: p.id, k: 'flame', on: false });
      if (g.enraged > now()) send({ p: p.id, k: 'roar', on: false });
    }
    if (((p.abilities[HERO_ABILITY] as HeroMove | undefined)?.f ?? 0) > 0) send({ p: p.id, k: 'jetpack', on: false });
    going.delete(p.id);
    for (const [id, h] of [...held]) if (h.by === p) release(id);
    release(p.id);
  };

  let lastNow = 0;
  return {
    update(dt) {
      // A restart (the clock back at 0): nothing carries over.
      if (now() < lastNow) {
        going.clear();
        held.clear();
        inFlight.length = 0;
        patches.length = 0;
      }
      lastNow = now();
      for (const [id, h] of [...held]) holding(id, h, dt);
      for (const p of game.players) {
        const id = rules.heroOf(p);
        if (!id) continue;
        const g = going.get(p.id);
        if (p.alive && !held.has(p.id) && match.phase === 'playing') {
          // The keys: pressed (a held one, down), for the powers that aren't movement abilities.
          HEROES[id].powers.forEach((info, slot) => {
            if (info.hold ? p.input.isDown(info.key) && !(g && (g.lightning > now() || g.flame > now())) : p.input.pressed(info.key)) use(p, slot);
          });
        }
        if (!g) continue;
        if (g.lightning) {
          if (!p.alive || held.has(p.id) || now() >= g.lightning || !p.input.isDown(HEROES[id].powers[0].key)) stopLightning(p, g);
          else zapping(p, g, dt);
        }
        if (g.flame) {
          if (!p.alive || held.has(p.id) || now() >= g.flame || !p.input.isDown(HEROES[id].powers[1].key)) stopFlame(p, g);
          else flaming(p, g, dt);
        }
        if (g.enraged > now()) {
          if (p.alive) rules.heal(p, POWERS.roar.mend * dt);
        } else if (g.enraged) {
          g.enraged = 0;
          send({ p: p.id, k: 'roar', on: false });
        }
        if (g.rush) rushing(p, g);
        if (g.thrown) flying(p, g);
        if (g.aura > now()) draining(p, g);
        else if (g.aura) {
          g.aura = 0;
          send({ p: p.id, k: 'aura', on: false });
        }
        if (g.soresu && g.soresu <= now()) {
          g.soresu = 0;
          send({ p: p.id, k: 'soresu', on: false });
        }
        if (g.rage && g.rage <= now()) {
          g.rage = 0;
          send({ p: p.id, k: 'rage', on: false });
        }
      }
      rocketsFly(dt);
      burning();
      if (bursts.length) {
        game.clients.send('all', MSG.burst, { list: bursts, t: 0 } satisfies Burn);
        bursts = [];
      }
    },
    use,
    end: endAll,
    clear() {
      going.clear();
      held.clear();
    },
    soresu: (p) => (going.get(p.id)?.soresu ?? 0) > now(),
    busy: (p) => {
      const g = going.get(p.id);
      return !!g && (!!g.thrown || !!g.choking || g.lightning > 0 || g.soresu > now());
    },
    unguarded: (p) => {
      const g = going.get(p.id);
      return !!g && (!!g.thrown || !!g.choking || g.lightning > 0);
    },
    speed: (p) => {
      const g = going.get(p.id);
      if (!g) return 1;
      const t = now();
      return (g.rage > t ? POWERS.rage.speed : 1) * (g.soresu > t ? POWERS.soresu.speed : 1) * (g.choking ? POWERS.choke.speed : 1) * (g.lightning > 0 ? POWERS.lightning.speed : 1) * (g.flame > 0 ? POWERS.flame.speed : 1);
    },
    rage: (p) => (going.get(p.id)?.rage ?? 0) > now(),
    held: (p) => held.has(p.id),
    thrown: (p) => {
      const th = going.get(p.id)?.thrown;
      return th ? th.last : null;
    },
    enraged: (p) => (going.get(p.id)?.enraged ?? 0) > now(),
    quarrel,
    rockets: () => inFlight,
  };
}
