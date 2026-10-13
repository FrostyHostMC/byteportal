import { math, type Behavior, type Entity, type GameContext, type Player, type Prop, type PropModel, type Vec3 } from '@platform';
import { bus } from '../run/bus';
import { MARK_MSG, PHASE_MSG, type Mark, type PhaseMessage } from './messages';

/**
 * What every boss fights with: who's in the fight and how tough that makes it, telegraphs on the
 * ground, blows that land on an area (and miss whoever rolled or jumped), chills and roots, lasting
 * hazards, and the brain (`brain`): a boss is a list of moves, each with its tell (`windup`), its
 * blow (`act`) and its recovery, and phases it goes into as it's hurt.
 */

// ---------------------------------------------------------------------------------------------
// The party

/** Everyone fighting: alive and playing. */
export const fighters = (game: GameContext): Player[] => game.players.filter((p) => p.alive && !p.spectating);

/** How much tougher a boss is for a party (its damage taken is divided by it): 70% more for each extra fighter. */
export const toughness = (game: GameContext) => 1 + 0.7 * Math.max(0, game.players.length - 1);

/** `base` adds, and `per` more for each extra fighter. */
export const adds = (game: GameContext, base: number, per = 1) => base + Math.round(per * Math.max(0, fighters(game).length - 1));

const flat = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.z - b.z);

/** The fighter furthest from `from` (the one hanging back), or null. */
export function furthest(game: GameContext, from: Vec3): Player | null {
  let best: Player | null = null;
  for (const p of fighters(game)) if (!best || flat(p.position, from) > flat(best.position, from)) best = p;
  return best;
}

/** Where to throw at a fighter: their middle (not their eyes: a lob that's high misses), where they'll be when it gets there (`lead`, 0..1). */
export function chest(self: Entity, p: Player, speed: number, lead = 0.6): Vec3 {
  const q = p.position;
  const t = self.distanceTo(p) / speed;
  return { x: q.x + p.velocity.x * t * lead, y: q.y + 0.9, z: q.z + p.velocity.z * t * lead };
}

/**
 * Where a body would stand in `p`'s column: on the floor under it (up to `down` blocks down: a
 * sunken floor, a channel), or atop a step it's in (one block up at most). Null where there's no
 * such floor, or no room on it, or it's under water or lava.
 */
export function standAt(game: GameContext, p: Vec3, down = 4): Vec3 | null {
  const w = game.world;
  const x = Math.floor(p.x);
  const z = Math.floor(p.z);
  let y = Math.floor(p.y + 0.01);
  if (w.collisionHeight(x, y, z) >= 1 && w.collisionHeight(x, ++y, z) > 0) return null;
  for (let k = 0; k <= down + 1; k++, y--) {
    const h = w.collisionHeight(x, y, z);
    if (h <= 0) {
      if (w.blockInfo(w.getBlock(x, y, z))?.liquid) return null;
      continue;
    }
    const q = { x: p.x, y: y + Math.min(1, h), z: p.z };
    return w.fits({ x: q.x, y: q.y + 0.05, z: q.z }) ? q : null;
  }
  return null;
}

/** A spot on the floor near `at` (within `r`, on the floor there: `standAt`), kept inside the map's fighting floor. */
export function near(game: GameContext, at: Vec3, r: number, center: Vec3, radius: number): Vec3 {
  for (let i = 0; i < 10; i++) {
    const a = game.rng.range(0, Math.PI * 2);
    const d = Math.sqrt(game.rng.next()) * r;
    const p = { x: at.x + Math.cos(a) * d, y: at.y, z: at.z + Math.sin(a) * d };
    if (flat(p, center) >= radius - 1.5) continue;
    const q = standAt(game, p);
    if (q) return q;
  }
  return standAt(game, at) ?? { ...at };
}

// ---------------------------------------------------------------------------------------------
// Leaps and lobs

/** How quickly a creature in the air loses its speed across (the platform's walkers: a quarter of their grip on the ground). */
const AIR = 2.5;
/** Gravity on creatures (blocks a second, a second). */
const GRAVITY = 30;

/** The speed across a creature needs, leaving now, to cover `d` blocks in `t` seconds of flight. */
const airSpeed = (d: number, t: number) => (d * AIR) / (1 - Math.exp(-AIR * t));

/** Throw a creature to land on `to`: up at `vy`, across as fast as it needs. The flight's time. */
export function lob(e: Entity, to: Vec3, vy: number): number {
  const p = e.position;
  const disc = vy * vy - 2 * GRAVITY * (to.y - p.y);
  const t = disc > 0 ? (vy + Math.sqrt(disc)) / GRAVITY : (2 * vy) / GRAVITY;
  const dx = to.x - p.x;
  const dz = to.z - p.z;
  const d = Math.hypot(dx, dz) || 1;
  const v = airSpeed(d, t);
  e.impulse((dx / d) * v - e.velocity.x, vy, (dz / d) * v - e.velocity.z);
  return t;
}

/** Keep a creature in the air on course for `to`, `left` seconds before it lands. */
export function steer(e: Entity, to: Vec3, left: number) {
  if (left < 0.06) return;
  const p = e.position;
  const dx = to.x - p.x;
  const dz = to.z - p.z;
  const d = Math.hypot(dx, dz);
  const v = d < 0.05 ? 0 : airSpeed(d, left);
  e.impulse((d ? dx / d : 0) * v - e.velocity.x, 0, (d ? dz / d : 0) * v - e.velocity.z);
}

// ---------------------------------------------------------------------------------------------
// Telegraphs: drawn on every screen (`client/bosses.ts`)

const r2 = (v: number) => Math.round(v * 100) / 100;
export const v3 = (p: Vec3): [number, number, number] => [r2(p.x), r2(p.y), r2(p.z)];

export function mark(game: GameContext, m: Mark) {
  game.clients.send('all', MARK_MSG, m);
}

/** A ring on the ground that fills over `t` seconds, then the blow lands. */
export const ring = (game: GameContext, at: Vec3, r: number, t: number, c: string) => mark(game, { k: 'ring', at: v3(at), r, t, c });

/** A sweep: `r` round `at`, `half` either side of `facing` (an angle round y from +x toward +z). */
export const sweep = (game: GameContext, at: Vec3, r: number, facing: number, half: number, t: number, c: string) =>
  mark(game, { k: 'sweep', at: v3(at), r, a0: facing - half, a1: facing + half, t, c });

/** A lane from `at` to `to`, `w` wide. */
export const lane = (game: GameContext, at: Vec3, to: Vec3, w: number, t: number, c: string) => mark(game, { k: 'lane', at: v3(at), to: v3(to), w, t, c });

/** A stream of light between two figures (an entity, a fighter) for `t` seconds (or until cleared by `id`). */
export const tether = (game: GameContext, a: Entity | Player, b: Entity | Player, t: number, c: string, id?: string) =>
  mark(game, { k: 'tether', id, a: a.id, b: b.id, t, c });

/** The angle (round y, from +x toward +z) from `a` to `b`. */
export const angle = (a: Vec3, b: Vec3) => Math.atan2(b.z - a.z, b.x - a.x);

/** A line under the boss bar on every screen (a phase, an enrage), and a callout for the announcer. */
export function announce(game: GameContext, text: string, sub: string | undefined, color: string) {
  game.clients.send('all', PHASE_MSG, { text, sub, color } satisfies PhaseMessage);
  bus.emit('feat', { player: null, name: 'boss_phase', text });
}

// ---------------------------------------------------------------------------------------------
// Blows on an area

export interface Strike {
  source: Entity;
  at: Vec3;
  r: number;
  /** Its damage: the same throughout, or [at the middle, at the edge]. */
  damage: number | [number, number];
  /** Only those on the ground feel it (a shockwave: jump it). */
  grounded?: boolean;
  /** Only within this arc (angles round y from +x toward +z), as `sweep` draws it. */
  arc?: [number, number];
  /** A wall between `at` and them shelters them (a shockwave breaks on a pillar). */
  cover?: boolean;
  /** How hard it throws them back from `at`, and up. */
  knockback?: number;
  lift?: number;
  /**
   * What it is (default `melee`: a blow a shield can take, and a well-timed one parry). A
   * shockwave, a falling weight, a charge or a spell isn't stopped by a shield: `shockwave`,
   * `impact`, `magic`.
   */
  cause?: string;
  weapon?: string;
}

/** Hurt the fighters in a strike's area: those it hit (a roll or a jump at the right moment misses it), and those who got out of it in time. */
export function strike(game: GameContext, s: Strike): { hit: Player[]; dodged: Player[] } {
  const hit: Player[] = [];
  const dodged: Player[] = [];
  const eye = { x: s.at.x, y: s.at.y + 1.2, z: s.at.z };
  for (const p of fighters(game)) {
    const q = p.position;
    const d = flat(q, s.at);
    if (d > s.r + 0.3 || Math.abs(q.y - s.at.y) > 3.5) continue;
    if (s.arc) {
      let a = angle(s.at, q) - s.arc[0];
      a = ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      if (a > s.arc[1] - s.arc[0] && d > 1.2) continue;
    }
    if (s.cover && !game.world.lineOfSight(eye, p.eye)) continue;
    if (s.grounded && !p.onGround) {
      dodged.push(p);
      continue;
    }
    const amount = typeof s.damage === 'number' ? s.damage : s.damage[0] + (s.damage[1] - s.damage[0]) * Math.min(1, d / s.r);
    if (!p.damage(Math.round(amount * 2) / 2, { source: s.source, from: s.at, knockback: 0, cause: s.cause ?? 'melee', weapon: s.weapon })) {
      dodged.push(p);
      continue;
    }
    hit.push(p);
    const l = d || 1;
    const k = s.knockback ?? 0;
    if (k || s.lift) p.impulse(((q.x - s.at.x) / l) * k, s.lift ?? 0, ((q.z - s.at.z) / l) * k);
  }
  return { hit, dodged };
}

// ---------------------------------------------------------------------------------------------
// What the bosses have done to the fight that wears off: kept per game (a room runs one, a test
// several in turn, and one game's fighters and props are never another's)

interface Hazard {
  id: string;
  source: Entity;
  at: Vec3;
  r: number;
  until: number;
  next: number;
  every: number;
  damage: number;
  chill?: [factor: number, seconds: number];
  weapon: string;
}

interface Holds {
  /** Each fighter's chill (slowed: their speed times `factor` until `until`), by id. */
  chills: Map<string, { p: Player; factor: number; until: number }>;
  /** Each fighter held in place by a boss (rooted, caged, the entrance), until when. */
  roots: Map<string, { p: Player; until: number }>;
  /** Each fighter's venom: damage a tick until it's spent. */
  venoms: Map<string, { p: Player; ticks: number; per: number; next: number; source: Entity }>;
  /** Fighters being dragged (a chain): toward where, until when. */
  pulls: Map<string, { p: Player; to: () => Vec3 | null; until: number }>;
  /** Pools on the floor. */
  hazards: Hazard[];
  /** Props the bosses put in the arena (falling bones and souls, cages, ice spikes): gone with the fight. */
  props: Set<Prop>;
}

const holdsOf = new WeakMap<GameContext, Holds>();

function holds(game: GameContext): Holds {
  let h = holdsOf.get(game);
  if (!h) holdsOf.set(game, (h = { chills: new Map(), roots: new Map(), venoms: new Map(), pulls: new Map(), hazards: [], props: new Set() }));
  return h;
}

// ---------------------------------------------------------------------------------------------
// Chills, roots, venom, drags

/** Slow a fighter to `factor` of their speed for `seconds` (the strongest chill on them counts). */
export function chill(game: GameContext, p: Player, factor: number, seconds: number) {
  const { chills } = holds(game);
  const until = game.clock.now + seconds;
  const c = chills.get(p.id);
  if (!c) {
    p.speed *= factor;
    chills.set(p.id, { p, factor, until });
    return;
  }
  if (factor < c.factor) {
    p.speed *= factor / c.factor;
    c.factor = factor;
  }
  c.until = Math.max(c.until, until);
}

/** Hold a fighter where they stand for `seconds` (with their weapons too: `weapons`). False if they're held already, or down. */
export function root(game: GameContext, p: Player, seconds: number, weapons = false): boolean {
  if (!p.alive || p.frozen) return false;
  p.freeze(true, { weapons });
  holds(game).roots.set(p.id, { p, until: game.clock.now + seconds });
  return true;
}

const VENOM_TICK = 0.5;

/** Poison a fighter: `damage` all told, a little every half second over `seconds` (a fresh dose replaces what's left). */
export function venom(game: GameContext, p: Player, damage: number, seconds: number, source: Entity) {
  const ticks = Math.max(1, Math.round(seconds / VENOM_TICK));
  holds(game).venoms.set(p.id, { p, ticks, per: damage / ticks, next: game.clock.now + VENOM_TICK, source });
}

/** Drag a fighter toward a moving point (`to`, null: let go) over `seconds`, to within a couple of blocks of it. */
export function pull(game: GameContext, p: Player, to: () => Vec3 | null, seconds: number) {
  holds(game).pulls.set(p.id, { p, to, until: game.clock.now + seconds });
  p.impulse(0, 6, 0);
}

/**
 * Chills, roots, venom and drags wear off (the drags steered, each tick, to arrive as they end).
 * A fighter who's left is let go of without being touched.
 */
export function updateHolds(game: GameContext) {
  const { chills, roots, venoms, pulls } = holds(game);
  const now = game.clock.now;
  const here = (p: Player) => game.players.includes(p);
  for (const [id, d] of pulls) {
    if (!here(d.p)) {
      pulls.delete(id);
      continue;
    }
    const at = d.to();
    const q = d.p.position;
    const dist = at ? Math.hypot(at.x - q.x, at.z - q.z) : 0;
    if (!at || now >= d.until || !d.p.alive || dist < 2.2) {
      pulls.delete(id);
      continue;
    }
    const speed = Math.min(34, (dist - 2) / Math.max(0.08, d.until - now));
    // (Whatever's solid in the way stops them: a pillar between is shelter.)
    const v = d.p.velocity;
    d.p.impulse(((at.x - q.x) / dist) * speed - v.x, 0, ((at.z - q.z) / dist) * speed - v.z);
  }
  for (const [id, v] of venoms) {
    if (now < v.next) continue;
    if (!here(v.p) || !v.p.alive || v.ticks <= 0) {
      venoms.delete(id);
      continue;
    }
    v.ticks--;
    v.next += VENOM_TICK;
    v.p.damage(v.per, { source: v.source.alive ? v.source : 'world', knockback: 0, cause: 'poison', weapon: 'venom' });
    v.p.fx.flash('#7fd23a', 0.12, 0.3);
  }
  for (const [id, c] of chills) {
    if (now < c.until && here(c.p)) continue;
    if (here(c.p)) c.p.speed /= c.factor;
    chills.delete(id);
  }
  for (const [id, r] of roots) {
    if (now < r.until && here(r.p)) continue;
    // (One who fell meanwhile is the fight's to hold: they watch from the stands.)
    if (here(r.p) && r.p.alive) r.p.freeze(false);
    roots.delete(id);
  }
}

/** A fresh fight: every chill, root, venom and drag off. */
export function resetHolds(game: GameContext) {
  const { chills, roots, venoms, pulls } = holds(game);
  const here = (p: Player) => game.players.includes(p);
  for (const c of chills.values()) if (here(c.p)) c.p.speed /= c.factor;
  for (const r of roots.values()) if (here(r.p) && r.p.alive) r.p.freeze(false);
  chills.clear();
  roots.clear();
  venoms.clear();
  pulls.clear();
}

// ---------------------------------------------------------------------------------------------
// Hazards: pools that hurt whoever stands in them

let hazardSeq = 0;

/** A pool on the floor for `seconds`: every `every` seconds, whoever stands in it takes `damage` (and a chill). */
export function pool(
  game: GameContext,
  source: Entity,
  at: Vec3,
  r: number,
  seconds: number,
  color: string,
  o: { damage: number; every: number; chill?: [number, number]; weapon: string },
) {
  const id = `hz${++hazardSeq}`;
  const now = game.clock.now;
  holds(game).hazards.push({ id, source, at: { ...at }, r, until: now + seconds, next: now + o.every, every: o.every, damage: o.damage, chill: o.chill, weapon: o.weapon });
  mark(game, { k: 'pool', id, at: v3(at), r, t: seconds, c: color });
}

export function updateHazards(game: GameContext) {
  const h = holds(game);
  const now = game.clock.now;
  h.hazards = h.hazards.filter((z) => {
    if (now >= z.until) return false;
    if (now < z.next) return true;
    z.next += z.every;
    for (const p of fighters(game)) {
      const q = p.position;
      if (flat(q, z.at) > z.r || Math.abs(q.y - z.at.y) > 1.5) continue;
      if (z.damage > 0) p.damage(z.damage, { source: z.source.alive ? z.source : 'world', knockback: 0, cause: 'poison', weapon: z.weapon });
      if (z.chill) chill(game, p, z.chill[0], z.chill[1]);
    }
    return true;
  });
}

/** Take away a boss's hazards (all of them, without one). */
export function clearHazards(game: GameContext, source?: Entity) {
  const h = holds(game);
  h.hazards = h.hazards.filter((z) => {
    if (source && z.source !== source) return true;
    mark(game, { k: 'clear', id: z.id });
    return false;
  });
}

// ---------------------------------------------------------------------------------------------
// Props the bosses put in the arena (falling bones and souls, cages, ice spikes)

const models = new WeakMap<GameContext, Map<string, PropModel>>();

/** A glTF prop's model, made once per game. */
export function propModel(game: GameContext, url: string, radius = 1): PropModel {
  let m = models.get(game);
  if (!m) models.set(game, (m = new Map()));
  let pm = m.get(url);
  if (!pm) m.set(url, (pm = game.props.gltf(url, { radius })));
  return pm;
}

/** Keep track of a prop of a boss's (and give it back), so a fresh fight clears what's left. */
export function own<P extends Prop>(game: GameContext, p: P): P {
  holds(game).props.add(p);
  return p;
}

export function drop(game: GameContext, p: Prop) {
  if (!holds(game).props.delete(p)) return;
  p.remove();
}

/** A prop (a glTF model's) dropped out of the sky onto `at`, landing in `t` seconds: then it's gone, and `land` runs. */
export function fromSky(game: GameContext, url: string, at: Vec3, t: number, land: () => void, o: { height?: number; scale?: number } = {}) {
  const h = o.height ?? 26;
  const from = { x: at.x, y: at.y + h, z: at.z };
  const p = own(game, game.props.spawn(propModel(game, url), { position: from, scale: o.scale }));
  p.quaternion.setFromEuler(new math.Euler(game.rng.range(-0.6, 0.6), game.rng.range(0, Math.PI * 2), game.rng.range(-0.6, 0.6)));
  p.launch(from, { x: 0, y: -h / t, z: 0 });
  game.clock.after(t, () => {
    drop(game, p);
    land();
  });
}

export function resetProps(game: GameContext) {
  const h = holds(game);
  for (const p of h.props) p.remove();
  h.props.clear();
}

// ---------------------------------------------------------------------------------------------
// The brain

/** Its beaten state: who dealt the blow, with what; `final` once the last blow is being dealt. */
export interface Dying {
  by: Player | null;
  weapon?: string;
  final?: boolean;
}

/** A boss's state (in its `data`). */
export interface BossState {
  /** 1, then 2… as it's hurt (`Brain.phases`). */
  phase: number;
  /** The move it's making, and where in it: its tell, its blow, its recovery (seconds left). */
  move: Move | null;
  step: 'windup' | 'act' | 'recover' | null;
  t: number;
  /** Seconds until each move may come again (by name). */
  cds: Record<string, number>;
  /** Whom the move is aimed at (their id), and where it'll land. */
  focus: string | null;
  aim: Vec3 | null;
  /** Its entrance: it stands still and nothing touches it. */
  held: boolean;
  /** Come in under a roof (a gate's tunnel): it strides out this way (a yaw) during its entrance, until it's clear of it (its back `back` blocks behind it too). */
  emerge: { yaw: number; height: number; back: number } | null;
  dying: Dying | null;
  /** Seconds left of a stagger (it reels: open), and until it can be staggered again. */
  stagger: number;
  staggerCd: number;
  /** Seconds of a phase change left: it stands and roars, and nothing touches it. */
  transition: number;
  /** It turns every blow away (the Lich behind its phylacteries). */
  shield: boolean;
  /** Seconds it takes more damage (stunned, channelling). */
  vulnerable: number;
  enraged: boolean;
  /** Free memory for its moves. */
  mem: Record<string, unknown>;
}

export function bossState(e: Entity): BossState {
  let s = e.data.boss as BossState | undefined;
  if (!s) {
    s = { phase: 1, move: null, step: null, t: 0, cds: {}, focus: null, aim: null, held: false, emerge: null, dying: null, stagger: 0, staggerCd: 0, transition: 0, shield: false, vulnerable: 0, enraged: false, mem: {} };
    e.data.boss = s;
  }
  return s;
}

/** What a move sees each tick. */
export interface Ctx {
  self: Entity;
  game: GameContext;
  s: BossState;
  dt: number;
  /** Whom it's after (the move's focus, else the nearest), how far, and its health (0..1). */
  target: Player;
  d: number;
  hp: number;
  /** Its pace: 1, less when it's quicker (enraged). Wind-ups, recoveries and cooldowns are times this. */
  tempo: number;
}

export interface Move {
  name: string;
  /** May it start now? */
  can(c: Ctx): boolean;
  /** Seconds before it comes again (a range: random within). */
  cooldown: number | [number, number];
  /** How likely it's chosen among those that may start (default 1). */
  weight?: number;
  /** Its tell: seconds of wind-up, and what's shown as it begins (a glow, a ring, a raised arm). */
  windup: number;
  start?(c: Ctx): void;
  /** The blow. */
  act(c: Ctx): void;
  /** A move that goes on (a charge, a channel): each tick after `act`, until it says it's done. */
  during?(c: Ctx): boolean;
  /** Seconds it stands spent after (open to punishment). */
  recover: number;
  /** Its end (or being cut short by a stagger or a phase change): clean up glows and clips. */
  end?(c: Ctx): void;
}

export interface Phase {
  /** Below this much of its health (0..1). */
  at: number;
  /** Seconds it stands roaring, untouchable (default 1.8). */
  pause?: number;
  enter(c: Ctx): void;
}

export interface Brain {
  moves: Move[];
  /** Its phases after the first, in order. */
  phases?: Phase[];
  /** Its pace (default: 1, 0.75 enraged). */
  tempo?(s: BossState): number;
  /** How it closes in between moves (default: straight at its target). */
  chase?(c: Ctx): void;
  /** Every tick it's in the fight, whatever it's doing (auras, tethers). */
  always?(c: Ctx): void;
  /** How it stands still through a tell or a recovery (default: it stops; the Lich King hovers). */
  still?(self: Entity, game: GameContext): void;
}

const cooldownOf = (game: GameContext, m: Move) => (typeof m.cooldown === 'number' ? m.cooldown : game.rng.range(m.cooldown[0], m.cooldown[1]));

/** Cut its move short (a stagger, a phase change): the move ends, and may come again soon. */
export function interrupt(c: Ctx) {
  const { s } = c;
  if (s.move) {
    s.move.end?.(c);
    s.cds[s.move.name] = Math.min(s.cds[s.move.name] ?? 0, 2);
  }
  s.move = null;
  s.step = null;
  s.focus = null;
  c.self.glow(null);
}

/** Its speed from now on (times its type's): an enrage. Kept in `data.speed`, which the arsenal's slows go on top of (`items/status.ts`). */
export function quicken(self: Entity, f: number) {
  self.data.speed = f;
  self.setSpeed(f);
}

/** Its speed as it stands (an enrage's, before any slow). */
export const pace = (self: Entity) => (self.data.speed as number | undefined) ?? 1;

/**
 * A boss's AI from its moves: it walks at its target; when a move may start (its cooldown done,
 * its `can`), it starts one (by weight), standing through its tell, the blow, the recovery; it
 * goes into its next phase as its health falls past the mark, standing and roaring a moment. It
 * does nothing while its entrance plays or it's beaten (`part.ts`), and reels while staggered,
 * by a blast of its own (`stagger`) or by the arsenal's (a parry, a slam: `data.stunned`).
 */
export function brain(b: Brain): Behavior {
  return (self, game, dt) => {
    const s = bossState(self);
    const halt = () => (b.still ? b.still(self, game) : self.stop());
    if (s.dying) {
      self.stop();
      return;
    }
    if (s.held) {
      const out = s.emerge && { x: -Math.sin(s.emerge.yaw), z: -Math.cos(s.emerge.yaw) };
      if (s.emerge && out && (roofed(game, self.position, s.emerge.height) || roofed(game, { x: self.position.x - out.x * s.emerge.back, y: self.position.y, z: self.position.z - out.z * s.emerge.back }, s.emerge.height)))
        self.moveDirection(out.x, out.z);
      else halt();
      return;
    }
    for (const k in s.cds) s.cds[k] -= dt;
    s.stagger = Math.max(0, s.stagger - dt);
    s.staggerCd = Math.max(0, s.staggerCd - dt);
    s.vulnerable = Math.max(0, s.vulnerable - dt);
    s.transition = Math.max(0, s.transition - dt);
    const focused = s.focus ? game.players.find((p) => p.id === s.focus && p.alive && !p.spectating) : undefined;
    const target = focused ?? self.nearestPlayer();
    if (!target) {
      self.stop();
      return;
    }
    const tempo = b.tempo ? b.tempo(s) : s.enraged ? 0.75 : 1;
    const c: Ctx = { self, game, s, dt, target, d: self.distanceTo(target), hp: self.health / self.maxHealth, tempo };
    b.always?.(c);

    const next = b.phases?.[s.phase - 1];
    if (next && c.hp < next.at && s.step !== 'act') {
      interrupt(c);
      s.phase++;
      s.transition = next.pause ?? 1.8;
      halt();
      next.enter(c);
      return;
    }
    // Reeling from the arsenal (a parry, a slam): its move cut short, the reel shown once.
    const stunned = ((self.data.stunned as number | undefined) ?? 0) > 0;
    if (stunned && !s.mem.reeling) {
      s.mem.reeling = true;
      if (s.move) interrupt(c);
      self.animate('stagger', { fade: 0.1 });
    } else if (!stunned) s.mem.reeling = false;
    if (s.transition > 0 || s.stagger > 0 || stunned) {
      halt();
      if (s.transition > 0) self.lookAt(target);
      return;
    }

    const m = s.move;
    if (m && s.step) {
      if (s.step === 'windup') {
        s.t -= dt;
        halt();
        if (s.t > 0) return;
        s.step = 'act';
        m.act(c);
        if (m.during || s.move !== m) return;
        s.step = 'recover';
        s.t = m.recover * tempo;
      } else if (s.step === 'act') {
        // (A move may be cut short from within: a charge that ends in a wall staggers it.)
        if (!m.during?.(c) || s.move !== m) return;
        s.step = 'recover';
        s.t = m.recover * tempo;
      } else {
        halt();
        s.t -= dt;
        if (s.t > 0) return;
        m.end?.(c);
        s.move = null;
        s.step = null;
        s.focus = null;
      }
      return;
    }

    // Choose a move, or close in.
    const ready = b.moves.filter((mv) => (s.cds[mv.name] ?? 0) <= 0 && mv.can(c));
    if (ready.length) {
      const total = ready.reduce((a, mv) => a + (mv.weight ?? 1), 0);
      let r = game.rng.next() * total;
      const mv = ready.find((x) => (r -= x.weight ?? 1) <= 0) ?? ready[ready.length - 1];
      s.move = mv;
      s.step = 'windup';
      s.t = mv.windup * tempo;
      s.cds[mv.name] = cooldownOf(game, mv) * tempo + mv.windup * tempo;
      mv.start?.(c);
      halt();
      return;
    }
    if (b.chase) b.chase(c);
    else chase(c);
  };
}

/**
 * Walk at its target; a big body wedged on a pillar or a corner (going nowhere for a second with
 * its target still away) hops and sidesteps round it for a moment.
 */
function chase(c: Ctx) {
  const { self, s, target, dt } = c;
  const m = s.mem as { stuckT?: number; last?: Vec3; side?: number; sideT?: number };
  const p = self.position;
  const moved = m.last ? Math.hypot(p.x - m.last.x, p.z - m.last.z) : 1;
  m.last = { ...p };
  m.stuckT = moved < 0.4 * dt && c.d > 4 ? (m.stuckT ?? 0) + dt : 0;
  if (m.stuckT > 1) {
    m.stuckT = 0;
    m.side = c.game.rng.chance(0.5) ? 1 : -1;
    m.sideT = 0.8;
    self.jump();
  }
  self.lookAt(target);
  if ((m.sideT ?? 0) > 0) {
    m.sideT! -= dt;
    const q = target.position;
    const l = Math.hypot(q.x - p.x, q.z - p.z) || 1;
    const fx = (q.x - p.x) / l, fz = (q.z - p.z) / l;
    self.moveDirection(fx * 0.4 - fz * m.side!, fz * 0.4 + fx * m.side!);
    return;
  }
  self.moveTo(target);
}

/** Something solid over a spot, lower than a head `height` up (a gate's tunnel). */
export function roofed(game: GameContext, p: Vec3, height: number): boolean {
  return !!game.world.raycast({ x: p.x, y: p.y + 1.2, z: p.z }, { x: 0, y: 1, z: 0 }, height + 0.5);
}

/** Staggered: it reels for `seconds`, its move cut short, taking more damage meanwhile (`part.ts`). */
export function stagger(self: Entity, game: GameContext, seconds: number) {
  const s = bossState(self);
  const target = self.nearestPlayer();
  if (target) interrupt({ self, game, s, dt: 0, target, d: 0, hp: self.health / self.maxHealth, tempo: 1 });
  s.stagger = seconds;
  self.stop();
  self.animate('stagger', { fade: 0.15 });
}
