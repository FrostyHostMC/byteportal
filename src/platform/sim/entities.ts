import type { VoxelWorld } from '@engine/voxel_engine.js';
import type {
  AudioApi,
  ClipOptions,
  DamageOptions,
  Entity,
  EntityApi,
  EntityDefinition,
  FxApi,
  GameContext,
  GameEvents,
  HudApi,
  Player,
  ProjectileSpec,
  Prop,
  SpriteRef,
  Vec3,
} from '../api/types';
import type { Content } from '../content';
import { wasmMemory } from '../engine/wasm';
import { vetDamage } from './health';

// Mirrors engine/src/entities.rs.
const B = {
  X: 0, Y: 1, Z: 2, VX: 3, VY: 4, VZ: 5, HALF_W: 6, HEIGHT: 7, SPEED: 8, ACCEL: 9, JUMP_VEL: 10, GRAVITY: 11,
  WISH_X: 12, WISH_Z: 13, MODE: 14, WANT_JUMP: 15, FLAGS: 16, IMP_X: 17, IMP_Y: 18, IMP_Z: 19,
  TX: 20, TY: 21, TZ: 22, TARGET_KIND: 23, ON_GROUND: 24, IN_WATER: 25, LOS: 26, PATH_DIST: 27, DIST: 28,
  HEADING: 29, BLOCKED: 30, LANDED_SPEED: 31, PLAYER: 32, RIDE: 33,
} as const;
const P = { X: 0, Y: 1, Z: 2, VX: 3, VY: 4, VZ: 5, GRAVITY: 6, DRAG: 7, RADIUS: 8, FLAGS: 9, OWNER: 10, AGE: 11, HIT_KIND: 12, HIT_INDEX: 13 } as const;
const FLAG_ACTIVE = 1;
const FLAG_SOLID = 2;
const FLAG_SWIM = 4;
const FLAG_GHOST = 8;
const PF_ACTIVE = 1;
const PF_HITS_PLAYER = 2;
const PF_HITS_BODIES = 4;
const PF_STUCK = 8;

export interface EntityServices {
  world: VoxelWorld;
  /** Entity types go here too, for the client to build their models. */
  content: Content;
  /** Everyone's effects, sound and HUD (presentation calls). */
  fx: FxApi;
  audio: AudioApi;
  hud: HudApi;
  ctx(): GameContext;
  emit<K extends keyof GameEvents>(event: K, e: GameEvents[K]): void;
  dropItem(item: string, at: Vec3, count: number): void;
  players(): readonly Player[];
  /** A player's body in the engine (its path-finding, line of sight and projectile hits), or -1. */
  slotOf(p: Player): number;
  bySlot(slot: number): Player | undefined;
  /** Players' shots hit other players (`player.pvp`). */
  pvp: boolean;
  /** Run game code (AI) so a throw is reported rather than stopping every entity. */
  guard(fn: () => void): void;
  /** Props by id (what entities ride). */
  prop(id: number): Prop | null;
  /** Host time (`SimFrame.t`). */
  now(): number;
}

/** A model animation clip a figure plays (`animate`), as its frames carry it to every screen. */
export interface ClipFrame {
  /** Counts up with each request: a screen starts the clip when it changes. */
  seq: number;
  name: string;
  loop: boolean;
  fade: number;
  layer: 'full' | 'upper' | string[];
  speed: number;
  /** When it began (host time, `SimFrame.t`): a screen that sees it late starts it part way through. */
  at: number;
}

/** A clip request (`player.animate`, `entity.animate`) as frames carry it, its options filled in. */
export function clipFrame(seq: number, name: string, opts: ClipOptions | undefined, at: number): ClipFrame {
  const layer = opts?.layer;
  return { seq, name, loop: opts?.loop ?? false, fade: Math.max(0, opts?.fade ?? 0.2), layer: Array.isArray(layer) ? [...layer] : (layer ?? 'full'), speed: opts?.speed ?? 1, at };
}

/** One entity as the client needs to draw it. */
export interface EntityFrame {
  id: number;
  type: string;
  x: number;
  y: number;
  z: number;
  vx: number;
  vz: number;
  /** Facing when spawned. */
  yaw: number;
  /** Where it's looking (null: it faces where it walks). */
  look: Vec3 | null;
  /** Attack swings so far (a change starts the swing animation). */
  attacks: number;
  raised: boolean;
  casting: boolean;
  glow: string | null;
  /** Hurt flash, 1 when just hit, fading to 0. */
  hurt: number;
  /** Seconds since it died, or -1 while alive. */
  dying: number;
  /** An item in its right hand (players' figures, and an entity's `held`): its id. */
  held?: string | null;
  /** How big it is (`Entity.size`), when it isn't 1. */
  size?: number;
  /** Health, 0..1 (health bars over heads). */
  hp?: number;
  /** A model animation clip it's playing (`animate`). */
  clip?: ClipFrame;
}

/** One projectile in flight (or stuck in a wall). */
export interface ProjectileFrame {
  id: number;
  sprite?: SpriteRef;
  glow?: string;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  stuck: boolean;
}

type Target = Player | Entity | Vec3;
const isPlayer = (t: unknown): t is Player => typeof t === 'object' && t !== null && (t as { kind?: string }).kind === 'player';
const isEntity = (t: unknown): t is Entity => typeof t === 'object' && t !== null && (t as { kind?: string }).kind === 'entity';

/** A projectile as fired: a charged shot's crit, and the item that fired it (a bow's id). */
type Internal = ProjectileSpec & { crit?: boolean; weapon?: string };

interface Projectile {
  id: number;
  slot: number;
  spec: Internal;
  owner: EntityImpl | Player | null;
  stuckAt: number;
}

class EntityImpl implements Entity {
  readonly kind = 'entity' as const;
  readonly data: Record<string, unknown> = {};
  health: number;
  readonly maxHealth: number;
  armor = 0;
  alive = true;
  dyingTime = -1;
  age = 0;
  removed = false;
  lookTarget: Target | null = null;
  yaw = 0;
  hurt = 0;
  /** Presentation state the client animates from. */
  attacks = 0;
  raised = false;
  casting = false;
  glowColor: string | null = null;
  /** An item in its right hand (by id), or null. */
  held: string | null;
  /** A clip it's playing (`animate`), and how many it's been asked to play. */
  clip: ClipFrame | null = null;
  clipSeq = 0;
  ambientTimer = 2 + Math.random() * 6;
  speedMul = 1;
  private grown = 1;

  constructor(
    private m: EntitySim,
    readonly id: number,
    readonly type: string,
    readonly def: EntityDefinition,
    readonly slot: number,
  ) {
    this.health = def.health;
    this.maxHealth = def.health;
    this.held = def.held ?? null;
  }

  private get o(): number {
    return this.slot * this.m.bodyStride;
  }

  get position(): Vec3 {
    const b = this.m.bodies;
    const o = this.o;
    return { x: b[o + B.X], y: b[o + B.Y], z: b[o + B.Z] };
  }

  get velocity(): Vec3 {
    const b = this.m.bodies;
    const o = this.o;
    return { x: b[o + B.VX], y: b[o + B.VY], z: b[o + B.VZ] };
  }

  get onGround(): boolean {
    return this.m.bodies[this.o + B.ON_GROUND] > 0.5;
  }

  get riding(): Prop | null {
    const id = this.m.bodies[this.o + B.RIDE];
    return id ? this.m.s.prop(id) : null;
  }

  get height(): number {
    return this.def.hitbox.height * this.grown;
  }

  get size(): number {
    return this.grown;
  }

  set size(f: number) {
    this.grown = Math.max(0.1, Math.min(10, f));
    const b = this.m.bodies;
    const o = this.o;
    b[o + B.HALF_W] = (this.def.hitbox.width / 2) * this.grown;
    b[o + B.HEIGHT] = this.def.hitbox.height * this.grown;
  }

  damage(amount: number, opts: DamageOptions = {}): boolean {
    if (!this.alive || amount <= 0 || this.def.invulnerable) return false;
    // The game may change or cancel it first.
    const hit = vetDamage(this.m.s.emit, this, amount, opts);
    if (!hit) return false;
    amount = hit.amount * (1 - Math.min(20, Math.max(0, this.armor)) * 0.04);
    this.health = Math.max(0, this.health - amount);
    this.hurt = 1;
    const pos = this.position;
    const from = opts.from ?? (typeof opts.source === 'object' ? opts.source.position : null);
    const kb = hit.knockback * (1 - (this.def.knockbackResistance ?? 0));
    if (from && kb > 0) {
      const dx = pos.x - from.x;
      const dz = pos.z - from.z;
      const l = Math.hypot(dx, dz) || 1;
      this.impulse((dx / l) * 6.5 * kb, 4.5 * kb, (dz / l) * 6.5 * kb);
    }
    const top = { x: pos.x, y: pos.y + this.height * this.def.model.scale * 0.55 + 0.4, z: pos.z };
    this.m.s.fx.damageNumber({ x: top.x, y: top.y + 0.4, z: top.z }, amount, { crit: opts.crit });
    this.m.s.fx.burst({ x: pos.x, y: pos.y + this.height * 0.6, z: pos.z }, { color: this.def.bloodColor ?? '#b3261e', count: opts.crit ? 22 : 12, speed: 3.5, size: 0.08 });
    this.m.s.audio.play(this.def.sounds?.hurt ?? 'mob_hurt', { at: pos, pitch: 0.9 + Math.random() * 0.2 });
    const how = { weapon: opts.weapon, headshot: opts.headshot, ...(opts.through && { through: opts.through }) };
    this.m.s.emit('entityDamage', { entity: this, amount, source: opts.source, ...how });
    if (this.health <= 0) this.die(opts.source, how);
    return true;
  }

  heal(amount: number) {
    if (this.alive) this.health = Math.min(this.maxHealth, this.health + amount);
  }

  kill() {
    if (this.alive) {
      this.health = 0;
      this.die('world');
    }
  }

  private die(killer: DamageOptions['source'], how: { weapon?: string; headshot?: boolean } = {}) {
    this.alive = false;
    this.dyingTime = 0;
    const b = this.m.bodies;
    const o = this.o;
    b[o + B.FLAGS] = FLAG_ACTIVE | FLAG_GHOST;
    b[o + B.MODE] = 3;
    this.raised = false;
    this.casting = false;
    const pos = this.position;
    this.m.s.audio.play(this.def.sounds?.death ?? 'mob_death', { at: pos });
    const ctx = this.m.s.ctx();
    for (const d of this.def.drops ?? []) {
      if (ctx.rng.chance(d.chance)) this.m.s.dropItem(d.item, { x: pos.x, y: pos.y + 0.6, z: pos.z }, d.count ?? 1);
    }
    this.m.s.emit('entityDeath', { entity: this, killer, ...how });
  }

  remove() {
    if (this.removed) return;
    this.removed = true;
    this.alive = false;
    this.m.release(this);
  }

  impulse(x: number, y: number, z: number) {
    const b = this.m.bodies;
    const o = this.o;
    b[o + B.IMP_X] += x;
    b[o + B.IMP_Y] += y;
    b[o + B.IMP_Z] += z;
  }

  moveTo(target: Player | Vec3) {
    const b = this.m.bodies;
    const o = this.o;
    b[o + B.MODE] = 1;
    const slot = isPlayer(target) ? this.m.s.slotOf(target) : -1;
    if (slot >= 0) {
      // The engine path-finds to players (a flow field toward each one being chased).
      b[o + B.TARGET_KIND] = 2;
      b[o + B.TX] = slot;
    } else {
      const p = isPlayer(target) ? target.position : target;
      b[o + B.TARGET_KIND] = 1;
      b[o + B.TX] = p.x;
      b[o + B.TY] = p.y;
      b[o + B.TZ] = p.z;
    }
  }

  moveDirection(x: number, z: number) {
    const b = this.m.bodies;
    const o = this.o;
    const l = Math.hypot(x, z);
    b[o + B.MODE] = 0;
    b[o + B.WISH_X] = l > 1 ? x / l : x;
    b[o + B.WISH_Z] = l > 1 ? z / l : z;
  }

  stop() {
    this.m.bodies[this.o + B.MODE] = 3;
  }

  fly(x: number, y: number, z: number) {
    const b = this.m.bodies;
    const o = this.o;
    const l = Math.hypot(x, y, z);
    const k = l > 1 ? 1 / l : 1;
    b[o + B.MODE] = 2;
    b[o + B.WISH_X] = x * k;
    b[o + B.WISH_Z] = z * k;
    // Up or down: most of the way to the speed it asks for, each step (flying damps the rest).
    b[o + B.IMP_Y] += (y * k * b[o + B.SPEED] - b[o + B.VY]) * 0.5;
  }

  teleport(at: Vec3) {
    const b = this.m.bodies;
    const o = this.o;
    b[o + B.X] = at.x;
    b[o + B.Y] = at.y;
    b[o + B.Z] = at.z;
    b[o + B.VX] = b[o + B.VY] = b[o + B.VZ] = 0;
    b[o + B.RIDE] = 0;
  }

  jump() {
    this.m.bodies[this.o + B.WANT_JUMP] = 1;
  }

  lookAt(target: Target | null) {
    this.lookTarget = target;
  }

  nearestPlayer(): Player | null {
    let best: Player | null = null;
    let bd = Infinity;
    for (const p of this.m.s.players()) {
      if (!p.alive || p.spectating) continue;
      const d = this.distanceTo(p);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  }

  canSee(target: Target): boolean {
    // The engine keeps line of sight to one player for every body: its target, or the nearest.
    if (this.measures(target)) return this.m.bodies[this.o + B.LOS] > 0.5;
    const p = this.position;
    const eye = { x: p.x, y: p.y + this.height * 0.85, z: p.z };
    const t = this.m.aimPoint(target);
    return this.m.s.world.line_clear(eye.x, eye.y, eye.z, t.x, t.y, t.z);
  }

  distanceTo(target: Target): number {
    if (this.measures(target)) return this.m.bodies[this.o + B.DIST];
    const p = this.position;
    const t = isPlayer(target) || isEntity(target) ? target.position : target;
    return Math.hypot(t.x - p.x, t.y - p.y, t.z - p.z);
  }

  /** The engine measured distance and line of sight to this player last step. */
  private measures(target: Target): boolean {
    return isPlayer(target) && this.m.bodies[this.o + B.PLAYER] === this.m.s.slotOf(target);
  }

  animate(name: string, opts?: ClipOptions) {
    if (name === 'attack' || name === 'raise' || name === 'cast' || name === 'none') {
      this.raised = name === 'raise';
      this.casting = name === 'cast';
      if (name === 'attack') this.attacks++;
      if (name === 'none') this.clip = null;
      return;
    }
    this.clip = clipFrame(++this.clipSeq, name, opts, this.m.s.now());
  }

  setSpeed(multiplier: number) {
    this.speedMul = multiplier;
    this.m.bodies[this.o + B.SPEED] = this.def.speed * multiplier;
  }

  glow(color: string | null) {
    this.glowColor = color;
  }

  shoot(spec: ProjectileSpec, target: Target, opts: { spread?: number; lead?: boolean | number } = {}) {
    const p = this.position;
    const from = { x: p.x, y: p.y + this.height * 0.82 * Math.min(1.4, this.def.model.scale), z: p.z };
    let tp = { ...this.m.aimPoint(target) };
    if (isPlayer(target)) tp.y -= 0.35;
    const dist = Math.hypot(tp.x - from.x, tp.y - from.y, tp.z - from.z);
    const t = dist / spec.speed;
    const lead = opts.lead === true ? 0.8 : opts.lead || 0;
    if (lead && (isPlayer(target) || isEntity(target))) {
      const v = target.velocity;
      tp = { x: tp.x + v.x * t * lead, y: tp.y, z: tp.z + v.z * t * lead };
    }
    const g = spec.gravity ?? 20;
    tp.y += 0.5 * g * t * t;
    let dx = tp.x - from.x;
    let dy = tp.y - from.y;
    let dz = tp.z - from.z;
    const l = Math.hypot(dx, dy, dz) || 1;
    const sp = opts.spread ?? 0;
    dx = dx / l + (Math.random() - 0.5) * sp * 2;
    dy = dy / l + (Math.random() - 0.5) * sp * 2;
    dz = dz / l + (Math.random() - 0.5) * sp * 2;
    // Start slightly in front of the shooter so it doesn't hit itself.
    const fl = Math.hypot(dx, dz) || 1;
    from.x += (dx / fl) * (this.def.hitbox.width * 0.6 + 0.2);
    from.z += (dz / fl) * (this.def.hitbox.width * 0.6 + 0.2);
    this.m.spawnProjectile(spec, from, { x: dx, y: dy, z: dz }, this);
  }
}

/**
 * Entities on the simulation side: types, bodies (physics and path-finding in WebAssembly), AI,
 * projectiles, damage and death. The client draws them from `frame()`.
 */
export class EntitySim implements EntityApi {
  readonly s: EntityServices;
  private _bodies: Float64Array = new Float64Array(0);
  private _projectiles: Float64Array = new Float64Array(0);
  readonly bodyStride: number;
  private readonly projStride: number;
  private readonly bodyCap: number;
  private readonly projCap: number;
  private types = new Map<string, EntityDefinition>();
  private list: EntityImpl[] = [];
  private bySlot: (EntityImpl | null)[];
  private freeBodies: number[] = [];
  private shots: (Projectile | null)[];
  private freeShots: number[] = [];
  private nextId = 1;
  private nextShot = 1;
  /** The boss bar as last sent (only changes go out). */
  private bossShown = '';
  private time = 0;

  constructor(services: EntityServices) {
    this.s = services;
    const w = services.world;
    this.bodyStride = w.body_stride();
    this.projStride = w.projectile_stride();
    this.bodyCap = w.body_capacity();
    this.projCap = w.projectile_capacity();
    this.bySlot = new Array(this.bodyCap).fill(null);
    this.shots = new Array(this.projCap).fill(null);
    for (let i = this.bodyCap - 1; i >= 0; i--) this.freeBodies.push(i);
    for (let i = this.projCap - 1; i >= 0; i--) this.freeShots.push(i);
    this.refreshViews();
  }

  /**
   * Views over the wasm body / projectile buffers. Any wasm allocation (chunk streaming, meshing
   * requests) can grow memory and detach old views, so every access re-validates.
   */
  get bodies(): Float64Array {
    this.refreshViews();
    return this._bodies;
  }

  get projectiles(): Float64Array {
    this.refreshViews();
    return this._projectiles;
  }

  private refreshViews() {
    const buf = wasmMemory().buffer;
    if (this._bodies.buffer !== buf || this._bodies.length === 0) {
      this._bodies = new Float64Array(buf, this.s.world.bodies_ptr(), this.bodyCap * this.bodyStride);
      this._projectiles = new Float64Array(buf, this.s.world.projectiles_ptr(), this.projCap * this.projStride);
    }
  }

  /** Names of the defined entity types. */
  typeNames(): string[] {
    return [...this.types.keys()];
  }

  define(type: string, def: EntityDefinition) {
    this.types.set(type, def);
    this.s.content.defineEntity(type, def);
  }

  spawn(type: string, at: Vec3, opts: { yaw?: number; data?: Record<string, unknown> } = {}): Entity {
    const def = this.types.get(type);
    if (!def) throw new Error(`entities.spawn: unknown type "${type}"`);
    const slot = this.freeBodies.pop();
    if (slot === undefined) throw new Error('entities.spawn: entity limit reached');
    this.refreshViews();
    const e = new EntityImpl(this, this.nextId++, type, def, slot);
    const b = this.bodies;
    const o = slot * this.bodyStride;
    b.fill(0, o, o + this.bodyStride);
    b[o + B.X] = at.x;
    b[o + B.Y] = at.y;
    b[o + B.Z] = at.z;
    b[o + B.HALF_W] = def.hitbox.width / 2;
    b[o + B.HEIGHT] = def.hitbox.height;
    b[o + B.SPEED] = def.speed;
    b[o + B.ACCEL] = 10;
    b[o + B.JUMP_VEL] = def.jump ?? 8.6;
    b[o + B.GRAVITY] = 1;
    b[o + B.MODE] = 3;
    b[o + B.FLAGS] = FLAG_ACTIVE | FLAG_SOLID | FLAG_SWIM;
    b[o + B.DIST] = 999;
    e.yaw = opts.yaw ?? 0;
    if (opts.data) Object.assign(e.data, opts.data);
    this.bySlot[slot] = e;
    this.list.push(e);
    return e;
  }

  release(e: EntityImpl) {
    const o = e.slot * this.bodyStride;
    this.bodies[o + B.FLAGS] = 0;
    this.bySlot[e.slot] = null;
    this.freeBodies.push(e.slot);
    this.list.splice(this.list.indexOf(e), 1);
  }

  all(type?: string): Entity[] {
    return this.list.filter((e) => e.alive && (!type || e.type === type));
  }

  count(type?: string): number {
    let n = 0;
    for (const e of this.list) if (e.alive && (!type || e.type === type)) n++;
    return n;
  }

  near(center: Vec3, radius: number): Entity[] {
    const r2 = radius * radius;
    return this.list.filter((e) => {
      if (!e.alive) return false;
      const p = e.position;
      return (p.x - center.x) ** 2 + (p.y - center.y) ** 2 + (p.z - center.z) ** 2 <= r2;
    });
  }

  raycast(origin: Vec3, dir: Vec3, maxDistance: number, opts: { margin?: number } = {}): { entity: Entity; distance: number } | null {
    const l = Math.hypot(dir.x, dir.y, dir.z) || 1;
    const hit = this.s.world.pick_body(origin.x, origin.y, origin.z, dir.x / l, dir.y / l, dir.z / l, maxDistance, opts.margin ?? 0.1);
    if (hit[0] < 0) return null;
    const e = this.byBody(hit[0]);
    return e && e.alive ? { entity: e, distance: hit[1] } : null;
  }

  /** An entity's hitbox (from its definition). */
  hitbox(e: Entity): { width: number; height: number } {
    const { def, size } = e as EntityImpl;
    return size === 1 ? def.hitbox : { width: def.hitbox.width * size, height: def.hitbox.height * size };
  }

  /** Its hitbox for bullets: a humanoid's top quarter is its head. */
  shape(e: Entity): { width: number; height: number; head: boolean } {
    const d = (e as EntityImpl).def;
    const { width, height } = this.hitbox(e);
    return { width, height, head: d.model.rig === 'humanoid' || !!d.model.gltf?.head };
  }

  byBody(slot: number): EntityImpl | null {
    return this.bySlot[slot] ?? null;
  }

  clear() {
    for (const e of [...this.list]) e.remove();
    for (const p of this.shots) if (p) this.removeProjectile(p);
    if (this.bossShown) {
      this.s.hud.hideBossBar();
      this.bossShown = '';
    }
  }

  projectile(spec: ProjectileSpec, from: Vec3, dir: Vec3, owner: Entity | Player | null = this.s.players()[0] ?? null) {
    this.spawnProjectile(spec, from, dir, owner === null || isPlayer(owner) ? owner : (owner as EntityImpl));
  }

  /** Where to aim at something: a player's eyes, an entity's middle, or the point itself. */
  aimPoint(t: Target): Vec3 {
    if (isPlayer(t)) return t.eye;
    if (isEntity(t)) {
      const p = t.position;
      return { x: p.x, y: p.y + this.hitbox(t).height * 0.6, z: p.z };
    }
    return t;
  }

  spawnProjectile(spec: Internal, from: Vec3, dir: Vec3, owner: EntityImpl | Player | null) {
    const slot = this.freeShots.pop();
    if (slot === undefined) return;
    this.refreshViews();
    const p = this.projectiles;
    const o = slot * this.projStride;
    p.fill(0, o, o + this.projStride);
    const l = Math.hypot(dir.x, dir.y, dir.z) || 1;
    p[o + P.X] = from.x;
    p[o + P.Y] = from.y;
    p[o + P.Z] = from.z;
    p[o + P.VX] = (dir.x / l) * spec.speed;
    p[o + P.VY] = (dir.y / l) * spec.speed;
    p[o + P.VZ] = (dir.z / l) * spec.speed;
    p[o + P.GRAVITY] = spec.gravity ?? 20;
    p[o + P.DRAG] = 0.05;
    p[o + P.RADIUS] = 0.12;
    // Owner: a body index, -1 - slot for a player (never hit by their own shot), or nobody.
    p[o + P.OWNER] = owner === null ? -1e6 : isPlayer(owner) ? -1 - this.s.slotOf(owner) : owner.slot;
    // A player's shots hit monsters (and other players, with pvp); a monster's hit players.
    p[o + P.FLAGS] = PF_ACTIVE | (isPlayer(owner) ? PF_HITS_BODIES | (this.s.pvp ? PF_HITS_PLAYER : 0) : PF_HITS_PLAYER);
    this.shots[slot] = { id: this.nextShot++, slot, spec, owner, stuckAt: -1 };
  }

  private removeProjectile(p: Projectile) {
    this.projectiles[p.slot * this.projStride + P.FLAGS] = 0;
    this.shots[p.slot] = null;
    this.freeShots.push(p.slot);
  }

  /** AI, then physics in wasm, then hits, hurt flashes, deaths and the boss bar. */
  update(dt: number, running: boolean) {
    this.refreshViews();
    this.time += dt;
    const ctx = this.s.ctx();
    if (running) {
      // Copy: AI may spawn or remove entities.
      for (const e of [...this.list]) {
        if (e.removed) continue;
        e.age += dt;
        if (!e.alive) continue;
        if (e.def.ai) this.s.guard(() => e.def.ai!(e, ctx, dt));
        e.ambientTimer -= dt;
        if (e.ambientTimer <= 0 && e.def.sounds?.ambient) {
          e.ambientTimer = 4 + Math.random() * 6;
          this.s.audio.play(e.def.sounds.ambient, { at: e.position, volume: 0.6, pitch: 0.9 + Math.random() * 0.2 });
        }
      }
      this.s.world.step_entities(dt);
      this.refreshViews();
      this.processProjectiles();
      this.afterStep(dt);
    }
  }

  private processProjectiles() {
    const p = this.projectiles;
    const S = this.projStride;
    for (const shot of this.shots) {
      if (!shot) continue;
      const o = shot.slot * S;
      const kind = p[o + P.HIT_KIND];
      const pos = { x: p[o + P.X], y: p[o + P.Y], z: p[o + P.Z] };
      if (kind !== 0) {
        p[o + P.HIT_KIND] = 0;
        const src = shot.owner ?? 'world';
        if (kind === 1) {
          this.s.audio.play('arrow_hit', { at: pos, volume: 0.6 });
          if (shot.spec.sticky) {
            shot.stuckAt = this.time;
            p[o + P.FLAGS] = PF_ACTIVE | PF_STUCK;
          } else {
            this.s.fx.burst(pos, { color: shot.spec.glow ?? '#cccccc', count: 10, speed: 2 });
            this.removeProjectile(shot);
            continue;
          }
        } else if (kind === 2) {
          const hit = this.s.bySlot(p[o + P.HIT_INDEX]);
          if (hit?.alive) hit.damage(shot.spec.damage, { source: src, from: pos, knockback: shot.spec.knockback ?? 0.5, weapon: shot.spec.weapon, cause: 'projectile' });
          this.removeProjectile(shot);
          continue;
        } else if (kind === 3) {
          const target = this.byBody(p[o + P.HIT_INDEX]);
          if (target && target.alive) {
            target.damage(shot.spec.damage, { source: src, from: { x: pos.x - p[o + P.VX] * 0.05, y: pos.y, z: pos.z - p[o + P.VZ] * 0.05 }, knockback: shot.spec.knockback ?? 0.4, crit: shot.spec.crit, weapon: shot.spec.weapon, cause: 'projectile' });
            this.s.audio.play('hit', { at: pos, pitch: 1.2 });
          }
          this.removeProjectile(shot);
          continue;
        }
      }
      if (p[o + P.AGE] > 12 || (shot.stuckAt >= 0 && this.time - shot.stuckAt > 6)) {
        this.removeProjectile(shot);
        continue;
      }
    }
  }

  /** Hurt flashes fade, the dead fall and fade out, and the boss bar follows the weakest boss. */
  private afterStep(dt: number) {
    let boss: EntityImpl | null = null;
    for (const e of [...this.list]) {
      e.hurt = Math.max(0, e.hurt - dt * 4);
      if (!e.alive) {
        e.dyingTime += dt;
        if (e.dyingTime > 1.05) {
          const pos = e.position;
          this.s.fx.burst({ x: pos.x, y: pos.y + 0.5, z: pos.z }, { color: '#dddddd', count: 20, speed: 1.6, size: 0.14, gravity: -2 });
          e.remove();
        }
      } else if (e.def.boss && (!boss || e.health / e.maxHealth < boss.health / boss.maxHealth)) {
        boss = e;
      }
    }
    const bar = boss ? `${boss.def.name}|${(boss.health / boss.maxHealth).toFixed(3)}` : '';
    if (bar === this.bossShown) return;
    this.bossShown = bar;
    if (boss) this.s.hud.bossBar(boss.def.name, boss.health / boss.maxHealth, 'linear-gradient(90deg, #7a1fd6, #d21f5c)');
    else this.s.hud.hideBossBar();
  }

  /** What the client needs to draw every entity and projectile this frame. */
  frame(): { entities: EntityFrame[]; projectiles: ProjectileFrame[] } {
    const b = this.bodies;
    const S = this.bodyStride;
    const entities: EntityFrame[] = [];
    for (const e of this.list) {
      const o = e.slot * S;
      const look = e.alive && e.lookTarget ? this.aimPoint(e.lookTarget) : null;
      entities.push({
        id: e.id,
        type: e.type,
        x: b[o + B.X],
        y: b[o + B.Y],
        z: b[o + B.Z],
        vx: b[o + B.VX],
        vz: b[o + B.VZ],
        yaw: e.yaw,
        look: look && { x: look.x, y: look.y, z: look.z },
        attacks: e.attacks,
        raised: e.raised,
        casting: e.casting,
        glow: e.glowColor,
        hurt: e.hurt,
        dying: e.alive ? -1 : e.dyingTime,
        hp: e.health / e.maxHealth,
        clip: e.clip ?? undefined,
        ...(e.held ? { held: e.held } : {}),
        ...(e.size !== 1 ? { size: e.size } : {}),
      });
    }
    const p = this.projectiles;
    const PS = this.projStride;
    const projectiles: ProjectileFrame[] = [];
    for (const shot of this.shots) {
      if (!shot) continue;
      const o = shot.slot * PS;
      projectiles.push({
        id: shot.id,
        sprite: shot.spec.sprite,
        glow: shot.spec.glow,
        x: p[o + P.X],
        y: p[o + P.Y],
        z: p[o + P.Z],
        vx: p[o + P.VX],
        vy: p[o + P.VY],
        vz: p[o + P.VZ],
        stuck: shot.stuckAt >= 0,
      });
    }
    return { entities, projectiles };
  }
}
