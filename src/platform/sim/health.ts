import type { VoxelWorld } from '@engine/voxel_engine.js';
import type { AudioApi, DamageEvent, DamageOptions, Entity, FxApi, GameEvents, Player, PlayerOptions, Vec3 } from '../api/types';

type Emit = <K extends keyof GameEvents>(event: K, e: GameEvents[K]) => void;

/**
 * Damage about to land on `target`: the game's `damage` listeners hear of it first and may change
 * it or cancel it (see `DamageEvent`). What lands (before armour) and its knockback, or null if
 * nothing does.
 */
export function vetDamage(emit: Emit, target: Player | Entity, amount: number, opts: DamageOptions): { amount: number; knockback: number } | null {
  const source = opts.source;
  const actor = typeof source === 'object' ? source : null;
  let cancelled = false;
  const e: DamageEvent = {
    target,
    amount,
    knockback: opts.knockback ?? 1,
    source,
    cause: opts.cause ?? (actor ? 'melee' : 'world'),
    part: opts.part,
    from: opts.from ?? actor?.position,
    crit: !!opts.crit,
    weapon: opts.weapon,
    headshot: opts.headshot,
    through: opts.through,
    get cancelled() {
      return cancelled;
    },
    cancel() {
      cancelled = true;
    },
  };
  emit('damage', e);
  return cancelled || !(e.amount > 0) ? null : { amount: e.amount, knockback: e.knockback };
}

/**
 * A player's health, damage, knockback, regeneration, fall damage and death. The hearts are
 * shown from the player frame; the hurt sound, red flash and shake go to that player's client.
 */
export class PlayerHealth {
  enabled = true;
  health = 20;
  max = 20;
  dead = false;
  deathTime = 0;
  private invuln = 0;
  private sinceHurt = 99;
  private regen: { delay: number; perSecond: number } | null = null;
  /** Healing still to come (`heal` with `over`): how much, and how much a second. */
  private mending = { left: 0, rate: 0 };
  private fallDamage = false;
  /** Seconds of invulnerability after a hit (`player.hurtCooldown`). */
  private hurtCooldown = 0.45;
  private prevVy = 0;
  private prevGround = true;
  /** Armour points (0..20), each blocking 4% of damage. */
  armor = 0;

  constructor(
    private world: VoxelWorld,
    /** The player's physics body in the world. */
    private slot: number,
    /** This player's own sound and screen effects. */
    private audio: AudioApi,
    private fx: FxApi,
    private emit: Emit,
    private playerPos: () => Vec3,
    /** The player this health belongs to (named in the events). */
    private player: () => Player,
    /** Hit (from where, if anywhere): the first-person view flinches, the HUD points to it. */
    private onHurt: (from: Vec3 | null) => void,
  ) {}

  configure(opts: PlayerOptions) {
    this.enabled = opts.health !== false;
    this.max = typeof opts.health === 'number' ? opts.health : 20;
    this.health = this.max;
    this.regen = opts.regen ?? null;
    this.fallDamage = opts.fallDamage ?? false;
    this.hurtCooldown = opts.hurtCooldown ?? 0.45;
    this.refresh();
  }

  /** Kept for callers that change health directly (shown from the frame, so nothing to do). */
  refresh() {}

  /** Spectating: nothing hurts them. */
  ghost = false;

  damage(amount: number, opts: DamageOptions = {}): boolean {
    if (!this.enabled || this.dead || this.ghost || this.invuln > 0 || amount <= 0) return false;
    // The game may change or cancel it first.
    const hit = vetDamage(this.emit, this.player(), amount, opts);
    if (!hit) return false;
    amount = hit.amount * (1 - Math.min(20, Math.max(0, this.armor)) * 0.04);
    this.health = Math.max(0, this.health - amount);
    this.invuln = this.hurtCooldown;
    this.sinceHurt = 0;
    const p = this.playerPos();
    const from = opts.from ?? (typeof opts.source === 'object' ? opts.source.position : null);
    const kb = hit.knockback;
    if (from && kb > 0) {
      const dx = p.x - from.x;
      const dz = p.z - from.z;
      const l = Math.hypot(dx, dz) || 1;
      this.world.player_impulse(this.slot, (dx / l) * 7 * kb, 5.5 * kb, (dz / l) * 7 * kb);
    }
    this.audio.play('hurt');
    this.onHurt(from);
    this.fx.flash('rgba(180, 10, 10, 1)', Math.min(0.5, 0.15 + amount * 0.04), 0.45);
    this.fx.shake(0.06 + amount * 0.012, 0.3);
    const how = { weapon: opts.weapon, headshot: opts.headshot, ...(opts.through && { through: opts.through }) };
    this.emit('playerDamage', { player: this.player(), amount, source: opts.source, ...how });
    if (this.health <= 0) {
      this.dead = true;
      this.deathTime = 0;
      this.world.set_frozen(this.slot, true);
      this.emit('playerDeath', { player: this.player(), source: opts.source, ...how });
    }
    this.refresh();
    return true;
  }

  /** Ignore damage for this long (spawn protection); 0 ends it. */
  protect(seconds: number) {
    this.invuln = Math.max(0, seconds);
  }

  heal(amount: number, opts: { over?: number } = {}) {
    if (this.dead || !(amount > 0)) return;
    const over = opts.over ?? 0;
    if (over > 0) {
      // Mended bit by bit: on top of what's still to come, at the faster of the two rates.
      this.mending.left += amount;
      this.mending.rate = Math.max(this.mending.rate, amount / over);
      return;
    }
    this.health = Math.min(this.max, this.health + amount);
    this.refresh();
  }

  revive() {
    this.dead = false;
    this.mending = { left: 0, rate: 0 };
    this.health = this.max;
    this.invuln = 1;
    this.prevGround = true;
    this.prevVy = 0;
    this.world.set_frozen(this.slot, false);
    this.refresh();
  }

  update(dt: number, onGround: boolean, vy: number) {
    this.invuln = Math.max(0, this.invuln - dt);
    this.sinceHurt += dt;
    if (this.dead) {
      this.deathTime += dt;
      this.mending = { left: 0, rate: 0 };
      return;
    }
    if (this.mending.left > 0) {
      const n = Math.min(this.mending.left, this.mending.rate * dt);
      this.mending.left -= n;
      if (this.enabled) this.health = Math.min(this.max, this.health + n);
      if (this.mending.left <= 1e-6) this.mending = { left: 0, rate: 0 };
    }
    if (this.regen && this.enabled && this.health < this.max && this.sinceHurt > this.regen.delay) {
      this.health = Math.min(this.max, this.health + this.regen.perSecond * dt);
      this.refresh();
    }
    if (this.fallDamage && onGround && !this.prevGround && this.prevVy < -15) {
      this.damage(Math.round((-this.prevVy - 13) * 0.8), { source: 'world', knockback: 0, cause: 'world' });
    }
    this.prevGround = onGround;
    this.prevVy = vy;
  }
}
