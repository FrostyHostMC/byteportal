import { math, type GameContext, type Player, type Vec3 } from '@platform';
import { Craft, aimError, angleDiff, headingTo, type ShipType } from './craft';
import type { Target, Weapons } from './weapons';

export interface EnemyKind {
  type: ShipType;
  hp: number;
  speed: number;
  /** Turn rate, rad/s. */
  agility: number;
  /** Seconds between shots in a burst. */
  fireRate: number;
  score: number;
}

type Mode = 'attack' | 'break' | 'extend' | 'return';

/** A pilot as the Empire sees one: something to chase and shoot at. */
export interface Quarry {
  pos: Vec3;
  vel: Vec3;
  alive: boolean;
}

const _v = new math.Vector3();

/** An Imperial fighter: pursues with lead, fires in bursts, breaks off when hit or too close. */
export class Enemy implements Target {
  readonly craft: Craft;
  team = 'empire' as const;
  private mode: Mode = 'attack';
  private modeTime = 0;
  private breakYaw = 0;
  private breakPitch = 0;
  private fireTimer = 1 + Math.random() * 1.5;
  private burst = 0;
  private flybyTimer = 0;
  private jink = Math.random() * 10;
  /** Who it's after, and for how much longer before it looks again. */
  private quarry: Quarry | null = null;
  private retarget = 0;
  onDeath: ((e: Enemy, by?: Player, kind?: 'laser' | 'torpedo') => void) | null = null;

  constructor(
    private game: GameContext,
    readonly kind: EnemyKind,
    private weapons: Weapons,
    at: Vec3,
    yaw: number,
  ) {
    this.craft = new Craft(game, kind.type, kind.hp, '#ffd08a');
    this.craft.pos.set(at.x, at.y, at.z);
    this.craft.yaw = yaw;
    this.craft.speed = kind.speed;
  }

  get pos(): Vec3 {
    return this.craft.pos;
  }
  get radius(): number {
    return this.craft.radius;
  }
  get vel(): Vec3 {
    return this.craft.forward(new math.Vector3()).multiplyScalar(this.craft.speed);
  }
  get alive(): boolean {
    return this.craft.alive;
  }

  hit(damage: number, at: Vec3, kind?: 'laser' | 'torpedo', shooter?: Player) {
    const c = this.craft;
    if (!c.alive) return;
    c.hp -= damage;
    c.hurt = 1;
    c.prop.flash('#ffffff', 0.1);
    this.game.fx.burst(at, { color: '#ffb070', count: 8, speed: 4, size: 0.14, gravity: 3 });
    if (c.hp <= 0) {
      this.game.fx.explosion(c.pos, { size: 1.3 });
      c.remove();
      this.onDeath?.(this, shooter, kind);
      return;
    }
    // Hit: break away.
    if (this.mode === 'attack' && Math.random() < 0.6) this.setBreak();
  }

  private setBreak() {
    this.mode = 'break';
    this.modeTime = 1.2 + Math.random() * 1.2;
    this.breakYaw = this.craft.yaw + (Math.random() < 0.5 ? 1 : -1) * (1.2 + Math.random());
    this.breakPitch = (Math.random() - 0.3) * 0.9;
  }

  /** The nearest pilot still flying, kept for a few seconds (null: none). */
  private pick(pilots: Quarry[], dt: number): Quarry | null {
    this.retarget -= dt;
    if (this.quarry?.alive && this.retarget > 0) return this.quarry;
    let best: Quarry | null = null;
    let bd = Infinity;
    for (const p of pilots) {
      if (!p.alive) continue;
      const d = this.craft.pos.distanceToSquared(_v.set(p.pos.x, p.pos.y, p.pos.z));
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    this.quarry = best;
    this.retarget = 3 + Math.random() * 3;
    return best;
  }

  update(dt: number, pilots: Quarry[], arena: { center: Vec3; radius: number; ceiling: number }, others: Enemy[]) {
    const c = this.craft;
    if (!c.alive) return;
    // Nobody to fight: circle where the last one was.
    const player = this.pick(pilots, dt) ?? this.quarry ?? { pos: arena.center, vel: { x: 0, y: 0, z: 0 }, alive: false };
    const k = this.kind;
    c.hurt = Math.max(0, c.hurt - dt);
    this.modeTime -= dt;
    this.jink += dt;
    const toPlayer = _v.set(player.pos.x - c.pos.x, player.pos.y - c.pos.y, player.pos.z - c.pos.z);
    const dist = toPlayer.length();

    // Choose where to steer.
    let want: { yaw: number; pitch: number };
    const fromCenter = Math.hypot(c.pos.x - arena.center.x, c.pos.z - arena.center.z);
    if (fromCenter > arena.radius && this.mode !== 'return') {
      this.mode = 'return';
      this.modeTime = 4;
    }
    switch (this.mode) {
      case 'return':
        want = headingTo(c.pos, { x: arena.center.x, y: arena.center.y, z: arena.center.z });
        if (this.modeTime <= 0 || fromCenter < arena.radius * 0.6) this.mode = 'attack';
        break;
      case 'break':
        want = { yaw: this.breakYaw, pitch: this.breakPitch };
        if (this.modeTime <= 0) {
          this.mode = 'extend';
          this.modeTime = 1 + Math.random();
        }
        break;
      case 'extend':
        // Fly on, then swing back around.
        want = { yaw: c.yaw, pitch: c.pitch * 0.9 };
        if (this.modeTime <= 0) this.mode = 'attack';
        break;
      default: {
        // Lead the target, with a lazy weave so they're not trivial to track.
        const lead = dist / 125;
        const aim = { x: player.pos.x + player.vel.x * lead, y: player.pos.y + player.vel.y * lead, z: player.pos.z + player.vel.z * lead };
        want = headingTo(c.pos, aim);
        want.yaw += Math.sin(this.jink * 1.3) * 0.12;
        want.pitch += Math.sin(this.jink * 1.7) * 0.08;
        if (dist < 26) this.setBreak();
      }
    }

    // Keep off the ground and away from each other.
    const ground = this.game.world.surfaceY(c.pos.x + Math.sin(-c.yaw) * 30, c.pos.z - Math.cos(c.yaw) * 30);
    if (ground >= 0 && c.pos.y < ground + 22) want.pitch = Math.max(want.pitch, 0.45);
    if (c.pos.y > arena.ceiling) want.pitch = Math.min(want.pitch, -0.35);
    for (const o of others) {
      if (o === this || !o.alive) continue;
      const d = c.pos.distanceTo(o.craft.pos);
      if (d < 14) want.yaw += angleDiff(headingTo(c.pos, o.craft.pos).yaw, c.yaw) > 0 ? 0.6 : -0.6;
    }

    const dy = angleDiff(c.yaw, want.yaw);
    const dp = want.pitch - c.pitch;
    const yawRate = math.MathUtils.clamp(dy * 2.5, -k.agility, k.agility);
    const pitchRate = math.MathUtils.clamp(dp * 2.5, -k.agility, k.agility);
    c.speed += ((this.mode === 'attack' && dist > 160 ? k.speed * 1.35 : k.speed) - c.speed) * Math.min(1, dt);
    c.steer(dt, yawRate, pitchRate, math.MathUtils.clamp(-yawRate * 0.6, -1.1, 1.1));
    const crash = c.move(dt);
    if (crash) {
      // Hard hits wreck a fighter; glancing ones just knock it about.
      this.game.fx.burst(crash.at, { color: crash.water ? '#d8f1ff' : '#ffc27a', count: 10, speed: 6, size: 0.14, gravity: 9 });
      if (crash.force > 0.25) this.hit(6 + 50 * crash.force * crash.force, crash.at);
      if (!c.alive) return;
      this.setBreak();
    }
    c.sync(0.8);

    // Fire in bursts when the nose is on target.
    this.fireTimer -= dt;
    if (player.alive && this.mode === 'attack' && dist < 240 && this.fireTimer <= 0 && aimError(c, player.pos) < 0.12) {
      const guns = k.type.guns;
      const dir = c.forward(new math.Vector3());
      for (const gpt of guns) this.weapons.laser(c.toWorld(gpt, new math.Vector3()), dir, 'empire');
      this.burst++;
      if (this.burst >= 3) {
        this.burst = 0;
        this.fireTimer = 1.4 + Math.random() * 1.4;
      } else {
        this.fireTimer = k.fireRate;
      }
    }

    // The howl as they scream past.
    this.flybyTimer -= dt;
    if (dist < 30 && this.flybyTimer <= 0) {
      this.flybyTimer = 3;
      this.game.audio.play('flyby', { at: c.pos, volume: 1 });
    }
  }
}
