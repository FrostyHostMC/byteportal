import { math, type GameContext, type LoopHandle, type Player, type Vec3, type Vehicle } from '@platform';
import { Craft, aimError, forwardOf, type ShipType } from './craft';
import { BOOST, BRAKE, freshShip, fromBody, toBody, type ShipState } from './flight';
import type { Target, Weapons } from './weapons';

const _v = new math.Vector3();
const _w = new math.Vector3();

/**
 * A player in the battle: their Vox-wing (a vehicle, so it flies at once on their own screen), and
 * what the host does with it: wing cannons (left mouse), a proton torpedo at whatever they've
 * locked (right mouse), lasers glancing off a barrel roll, shields that recharge, a hull that
 * doesn't, and scraping into things.
 */
export class Pilot implements Target {
  readonly team = 'rebel' as const;
  craft: Craft;
  vehicle: Vehicle<ShipState>;
  shields = 100;
  hull = 100;
  torpedoes = 6;
  kills = 0;
  /** Shot down: watching, back at `backAt` (game clock) if the fight's still on. */
  down = false;
  backAt = 0;
  /** Heading for the battle's edge: when they were last told. */
  warned = 0;
  readonly vel = new math.Vector3();
  lock: Target | null = null;
  private lockCandidate: Target | null = null;
  private lockTime = 0;
  private gunIndex = 0;
  private gunTimer = 0;
  private sinceHit = 99;
  private bump = 0;
  private tube = 1;
  private rolled = 0;
  private engine: LoopHandle;

  constructor(
    private game: GameContext,
    readonly player: Player,
    private type: ShipType,
    private weapons: Weapons,
    readonly callsign: string,
    at: Vec3,
    yaw: number,
  ) {
    this.craft = new Craft(game, type, 100, '#ff7a3a');
    this.vehicle = player.drive('voxwing', freshShip(at, yaw), { prop: this.craft.prop });
    this.syncBody();
    this.engine = player.audio.loop('engine', { volume: 0.5, pitch: 1 });
  }

  get id(): string {
    return this.player.id;
  }
  get pos(): Vec3 {
    return this.craft.pos;
  }
  get radius(): number {
    return this.craft.radius * 0.8;
  }
  get alive(): boolean {
    return !this.down && this.craft.alive && this.hull > 0;
  }
  /** Laser deflection window of a barrel roll. */
  get rolling(): boolean {
    return this.vehicle.state.rollDir !== 0;
  }
  get boost(): number {
    return this.vehicle.state.boost;
  }
  /** The target being acquired (not yet locked), for the HUD. */
  get locking(): Target | null {
    return this.lockCandidate && this.lockCandidate !== this.lock && this.lockTime > 0.1 ? this.lockCandidate : null;
  }

  /** Enemy fire: a barrel roll shrugs it off. */
  hit(damage: number) {
    if (!this.rolling) this.damage(damage);
  }

  /** Damage: shields first, then the hull. */
  damage(amount: number) {
    if (!this.alive) return;
    this.sinceHit = 0;
    const p = this.player;
    const soak = Math.min(this.shields, amount);
    this.shields -= soak;
    this.hull = Math.max(0, this.hull - (amount - soak));
    p.fx.shake(0.12 + amount * 0.01, 0.25);
    p.fx.flash(soak >= amount ? 'rgba(80, 170, 255, 1)' : 'rgba(255, 60, 30, 1)', 0.22, 0.35);
    p.audio.play(soak >= amount ? 'hit' : 'hurt', { volume: 0.8 });
    this.craft.prop.flash(soak >= amount ? '#7fc4ff' : '#ff5030', 0.15);
    if (this.hull <= 25 && this.hull + amount > 25) p.audio.play('alarm');
  }

  /** The craft (hit tests, guns, the AI's aim) to where the vehicle is. */
  syncBody() {
    toBody(this.vehicle.state, this.craft);
    forwardOf(this.craft, this.vel).multiplyScalar(this.craft.speed).add(this.craft.knock);
  }

  /** The vehicle to where the craft was pushed (ramming). */
  writeBack() {
    fromBody(this.craft, this.vehicle.state);
  }

  update(dt: number, enemies: Target[]) {
    const p = this.player;
    const s = this.vehicle.state;
    const c = this.craft;
    this.syncBody();
    this.sinceHit += dt;
    if (this.sinceHit > 3) this.shields = Math.min(100, this.shields + 9 * dt);

    // A barrel roll: the whoosh, and enemy lasers near the ship glance off.
    if (s.rollDir !== 0) {
      if (this.rolled === 0) p.audio.play('whoosh', { volume: 0.7, pitch: 1.3 });
      if (this.weapons.deflect(c.pos, c.radius * 1.4, 'rebel', p)) p.achieve('barrel_roll');
    }
    this.rolled = s.rollDir;
    // What the ship hit since the last tick.
    this.bump -= dt;
    if (s.hit > 0) {
      this.crash(new math.Vector3(s.hx, s.hy, s.hz), s.hit, s.water);
      s.hit = 0;
    }

    // Guns: alternate pairs of wing cannons.
    const inp = p.input;
    this.gunTimer -= dt;
    if (inp.button(0) && this.gunTimer <= 0) {
      this.gunTimer = 0.13;
      const guns = c.type.guns;
      const aim = c.forward(_w).clone();
      // Converge on the far reticle, or (gentle aim assist) on where a fighter near the reticle will be.
      let conv = _v.copy(aim).multiplyScalar(90).add(c.pos);
      const assist = this.assistTarget(enemies);
      if (assist) {
        const d = c.pos.distanceTo(new math.Vector3(assist.pos.x, assist.pos.y, assist.pos.z));
        const t = d / (170 + c.speed);
        const v = assist.vel ?? { x: 0, y: 0, z: 0 };
        conv = new math.Vector3(assist.pos.x + v.x * t, assist.pos.y + v.y * t, assist.pos.z + v.z * t);
      }
      // Four guns fire in diagonal pairs (like a Vox-wing's staggered bolts); fewer fire together.
      const pairs = guns.length >= 4 ? [[0, 3], [1, 2]] : [guns.map((_, i) => i)];
      for (const gi of pairs[this.gunIndex % pairs.length]) {
        const from = c.toWorld(guns[gi], new math.Vector3());
        const dir = conv.clone().sub(from).normalize();
        this.weapons.laser(from, dir, 'rebel', { inherit: c.forward(new math.Vector3()).multiplyScalar(c.speed), by: p });
      }
      this.gunIndex++;
    }

    // Lock-on: keep a target near the reticle.
    let best: Target | null = null;
    let bestErr = 0.16;
    for (const e of enemies) {
      if (!e.alive) continue;
      const d = c.pos.distanceTo(_v.set(e.pos.x, e.pos.y, e.pos.z));
      if (d > 420) continue;
      const err = aimError(c, e.pos);
      if (err < bestErr) {
        bestErr = err;
        best = e;
      }
    }
    if (this.lock && !this.lock.alive) this.lock = null;
    if (best && best === this.lockCandidate) {
      this.lockTime += dt;
      if (this.lockTime > 0.55 && this.lock !== best) {
        this.lock = best;
        p.audio.play('lock', { volume: 0.6 });
      }
    } else {
      this.lockCandidate = best;
      this.lockTime = 0;
    }
    if (inp.buttonPressed(2) && this.torpedoes > 0) {
      // Alternate tubes under the nose; they kick out and down, then curve onto the target, so
      // you can watch them go instead of losing them behind your own ship.
      this.torpedoes--;
      this.tube = -this.tube;
      const q = c.orientation(new math.Quaternion());
      const from = c.toWorld(new math.Vector3(this.tube * 1.2, -0.9, -2.5), new math.Vector3());
      const dir = new math.Vector3(this.tube * 0.22, -0.16, -1).normalize().applyQuaternion(q);
      this.weapons.torpedo(from, dir, 'rebel', this.lock, c.speed, p);
      if (!this.lock) p.hud.toast('No lock: torpedo fired straight');
    }

    const throttle = (c.speed - BRAKE) / (BOOST - BRAKE);
    c.sync(0.3 + throttle * 0.9, false);
    // In steps, so a steady engine sends nothing.
    this.engine.set({ volume: Math.round((0.35 + throttle * 0.3) * 20) / 20, pitch: Math.round((0.75 + throttle * 0.7) * 20) / 20 });
  }

  /**
   * Scraping or slamming into something: sparks (or spray), a jolt, and damage that grows with
   * how head-on it was (at most once every 0.4 s, so a scrape isn't a death sentence).
   */
  crash(at: Vec3, force: number, water = false) {
    const g = this.game;
    if (water) g.fx.burst(at, { color: '#d8f1ff', count: 26, speed: 6, size: 0.22, gravity: 14 });
    else g.fx.burst(at, { color: '#ffc27a', count: 14 + Math.round(force * 20), speed: 7, size: 0.12, gravity: 9 });
    this.player.fx.shake(0.12 + force * 0.4, 0.3);
    if (this.bump > 0) return;
    this.bump = 0.4;
    g.audio.play(force > 0.5 ? 'explosion' : 'hit', { at, volume: 0.5 + force * 0.5, pitch: force > 0.5 ? 1.6 : 0.7 });
    this.damage(4 + 36 * force * force);
  }

  /** A target within a few degrees of the reticle (closest to it), in range. */
  private assistTarget(enemies: Target[]): Target | null {
    const c = this.craft;
    let best: Target | null = null;
    let bestErr = 0.09;
    for (const e of enemies) {
      if (!e.alive || !e.vel) continue;
      if (c.pos.distanceTo(_v.set(e.pos.x, e.pos.y, e.pos.z)) > 260) continue;
      const err = aimError(c, e.pos);
      if (err < bestErr) {
        bestErr = err;
        best = e;
      }
    }
    return best;
  }

  /** Shot down: a fireball, and out of the ship. */
  explode() {
    this.game.fx.explosion(this.craft.pos, { size: 2.5 });
    this.engine.set({ volume: 0 });
    this.craft.remove();
    this.player.leaveVehicle();
    this.down = true;
    this.lock = this.lockCandidate = null;
  }

  /** Back in the fight: a new ship, shields and hull full. */
  respawn(at: Vec3, yaw: number) {
    this.craft = new Craft(this.game, this.type, 100, '#ff7a3a');
    this.vehicle = this.player.drive('voxwing', freshShip(at, yaw), { prop: this.craft.prop });
    this.syncBody();
    this.down = false;
    this.shields = this.hull = 100;
    this.torpedoes = Math.max(this.torpedoes, 2);
    this.sinceHit = 99;
  }

  dispose() {
    this.engine.stop();
    if (this.craft.alive) this.craft.remove();
    this.player.leaveVehicle();
  }
}
