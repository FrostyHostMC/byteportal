import { math, type GameContext, type Player, type Prop, type Vec3 } from '@platform';

/** Anything shots can hit: ships, turrets, shield generators, the bridge. */
export interface Target {
  pos: Vec3;
  radius: number;
  alive: boolean;
  team: 'rebel' | 'empire';
  /** Velocity, for leading shots (moving targets). */
  vel?: Vec3;
  /** Hit by a laser or torpedo, fired by a player (`shooter`) or not. */
  hit(damage: number, at: Vec3, by: 'laser' | 'torpedo', shooter?: Player): void;
}

interface Shot {
  prop: Prop;
  pos: math.Vector3;
  vel: math.Vector3;
  life: number;
  damage: number;
  team: 'rebel' | 'empire';
  kind: 'laser' | 'torpedo';
  /** Torpedoes home on this. */
  target: Target | null;
  turn: number;
  /** A second, wider glow around torpedoes, and their HUD marker id. */
  halo?: Prop;
  marker?: string;
  age?: number;
  /** The player who fired it (or turned it back with a barrel roll). */
  shooter?: Player;
  /** An enemy laser turned back by a barrel roll. */
  deflected?: boolean;
}

const _a = new math.Vector3();
const _d = new math.Vector3();
const _q = new math.Quaternion();
const FWD = new math.Vector3(0, 0, -1);

/** Lasers and torpedoes: flight, homing, hits on targets and on the world. */
export class Weapons {
  private shots: Shot[] = [];
  targets: Target[] = [];
  /** Called when a shot hits the world (for scorch marks, hull damage). */
  onWorldHit: ((at: Vec3, kind: 'laser' | 'torpedo', team: 'rebel' | 'empire') => void) | null = null;

  constructor(private game: GameContext) {}

  /**
   * A laser bolt: it flies on its own on every screen (nothing more is sent while it does), and
   * from the shooter's (predicted) guns on their own screen.
   */
  laser(from: Vec3, dir: Vec3, team: 'rebel' | 'empire', opts: { speed?: number; damage?: number; inherit?: Vec3; by?: Player } = {}) {
    const color = team === 'rebel' ? '#ff3b2f' : '#3dff5a';
    const prop = this.game.props.bolt({ color, length: 5.5, width: 0.7, intensity: 4, far: 35 });
    const speed = opts.speed ?? (team === 'rebel' ? 170 : 125);
    const vel = new math.Vector3(dir.x, dir.y, dir.z).normalize().multiplyScalar(speed);
    if (opts.inherit) vel.add(_a.set(opts.inherit.x, opts.inherit.y, opts.inherit.z));
    prop.quaternion.setFromUnitVectors(FWD, _d.copy(vel).normalize());
    prop.launch(from, vel, { by: opts.by });
    this.shots.push({ prop, pos: new math.Vector3(from.x, from.y, from.z), vel, life: 1.8, damage: opts.damage ?? (team === 'rebel' ? 12 : 6), team, kind: 'laser', target: null, turn: 0, shooter: opts.by });
    this.game.audio.play(team === 'rebel' ? 'laser' : 'laser_enemy', { at: from, volume: team === 'rebel' ? 0.5 : 0.7, pitch: 0.92 + Math.random() * 0.16 });
  }

  /**
   * A proton torpedo: a bright blue-white core in a wide glow, a sparkling trail, a flash at
   * launch and a HUD marker that follows it (and says what it's locked onto).
   */
  torpedo(from: Vec3, dir: Vec3, team: 'rebel' | 'empire', target: Target | null, launchSpeed = 0, by?: Player) {
    const g = this.game;
    const prop = g.props.bolt({ color: '#bfe2ff', length: 2.6, width: 1.1, intensity: 9, far: 35 });
    // The glow rides on the torpedo.
    const halo = g.props.bolt({ color: '#4f9dff', length: 4.5, width: 3.2, intensity: 3, flicker: 0.25 });
    halo.attach(prop);
    const vel = new math.Vector3(dir.x, dir.y, dir.z).normalize().multiplyScalar(launchSpeed + 35);
    const marker = `torp${this.torpId++}`;
    this.shots.push({ prop, halo, marker, pos: new math.Vector3(from.x, from.y, from.z), vel, life: 4.5, damage: 60, team, kind: 'torpedo', target, turn: 2.6, age: 0, shooter: by });
    g.audio.play('torpedo', { at: from, volume: 1 });
    g.fx.burst(from, { color: '#9fd0ff', count: 24, speed: 5, size: 0.3, gravity: 0, glow: 1.5, life: 0.35, drag: 5 });
    g.fx.flash('rgba(120, 190, 255, 1)', 0.12, 0.25);
  }

  private torpId = 0;

  update(dt: number) {
    const w = this.game.world;
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const s = this.shots[i];
      s.life -= dt;
      // Torpedoes accelerate out of the tube and, after a moment, steer toward their target.
      if (s.age !== undefined) {
        s.age += dt;
        const speed = Math.min(130, s.vel.length() + 70 * dt);
        s.vel.setLength(speed);
      }
      if (s.target?.alive && s.turn > 0 && (s.age ?? 1) > 0.25) {
        const speed = s.vel.length();
        _d.set(s.target.pos.x - s.pos.x, s.target.pos.y - s.pos.y, s.target.pos.z - s.pos.z).normalize();
        _a.copy(s.vel).normalize();
        const t = Math.min(1, s.turn * dt);
        _a.lerp(_d, t).normalize();
        s.vel.copy(_a).multiplyScalar(speed);
      }
      if (s.kind === 'torpedo') {
        // A glowing trail that lingers, and a little exhaust smoke.
        this.game.fx.burst(s.pos, { color: '#8fc8ff', count: 3, speed: 0.6, size: 0.7, gravity: 0, glow: 1.4, life: 0.8, drag: 2 });
        if (Math.random() < 0.5) this.game.fx.burst(s.pos, { color: '#c9d3dd', count: 1, speed: 0.4, size: 0.6, gravity: -1, life: 1.2, drag: 1 });
      }
      const step = s.vel.length() * dt;
      const dir = _d.copy(s.vel).normalize();
      // Targets along this step (segment vs sphere).
      let hit: Target | null = null;
      let hitT = step;
      for (const t of this.targets) {
        if (!t.alive || t.team === s.team) continue;
        // Where the segment enters the target's sphere (so a dome's sphere is hit before its blocks).
        const ox = t.pos.x - s.pos.x;
        const oy = t.pos.y - s.pos.y;
        const oz = t.pos.z - s.pos.z;
        const along = ox * dir.x + oy * dir.y + oz * dir.z;
        const d2 = ox * ox + oy * oy + oz * oz - along * along;
        const r = t.radius + (s.kind === 'torpedo' ? 1 : 0.2);
        if (d2 >= r * r) continue;
        const half = Math.sqrt(r * r - d2);
        const enter = Math.max(0, along - half);
        if (along + half < 0 || enter > step) continue;
        if (enter < hitT || (enter === hitT && !hit)) {
          hit = t;
          hitT = enter;
        }
      }
      // The world (terrain, the capital ship's hull).
      const ray = w.raycast(s.pos, dir, hitT);
      if (ray) {
        const at = { x: ray.x + 0.5 - dir.x * 0.6, y: ray.y + 0.5 - dir.y * 0.6, z: ray.z + 0.5 - dir.z * 0.6 };
        this.impact(s, at);
        this.onWorldHit?.(at, s.kind, s.team);
        this.drop(i);
        continue;
      }
      if (hit) {
        const at = { x: s.pos.x + dir.x * hitT, y: s.pos.y + dir.y * hitT, z: s.pos.z + dir.z * hitT };
        hit.hit(s.damage, at, s.kind, s.shooter);
        if (s.deflected && !hit.alive) s.shooter?.achieve('return_to_sender');
        this.impact(s, at);
        this.drop(i);
        continue;
      }
      s.pos.addScaledVector(s.vel, dt);
      if (s.life <= 0) {
        this.drop(i);
        continue;
      }
      // Lasers fly on their own (launched); torpedoes turn, so they're moved.
      if (s.kind === 'torpedo') {
        s.prop.position.copy(s.pos);
        s.prop.quaternion.setFromUnitVectors(FWD, dir);
      }
      if (s.marker && s.shooter) {
        const locked = s.target?.alive;
        s.shooter.hud.marker(s.marker, s.prop, { shape: 'ring', color: '#8fd0ff', size: 18, edge: true, label: locked ? 'TORPEDO · LOCKED' : 'TORPEDO' });
      }
    }
  }

  private impact(s: Shot, at: Vec3) {
    if (s.kind === 'torpedo') {
      this.game.fx.explosion(at, { size: 2.2, color: '#8fc6ff' });
      this.game.fx.burst(at, { color: '#bfe2ff', count: 30, speed: 12, size: 0.35, gravity: 0, glow: 2, life: 0.5, drag: 3 });
    } else {
      this.game.fx.burst(at, { color: s.team === 'rebel' ? '#ff7a5a' : '#8dff8a', count: 6, speed: 3, size: 0.12, gravity: 4 });
    }
  }

  private drop(i: number) {
    const s = this.shots[i];
    s.prop.remove();
    s.halo?.remove();
    if (s.marker) s.shooter?.hud.marker(s.marker, null);
    this.shots.splice(i, 1);
  }

  /** Enemy lasers near a point (barrel rolls deflect them), turned back as `by`'s: how many. */
  deflect(center: Vec3, radius: number, team: 'rebel' | 'empire', by?: Player): number {
    let n = 0;
    for (const s of this.shots) {
      if (s.team === team || s.kind !== 'laser') continue;
      if (_a.set(s.pos.x - center.x, s.pos.y - center.y, s.pos.z - center.z).lengthSq() < radius * radius) {
        s.vel.multiplyScalar(-1).applyQuaternion(_q.setFromAxisAngle(_a.normalize(), (Math.random() - 0.5) * 1.2));
        s.team = team;
        s.shooter = by;
        s.deflected = true;
        n++;
        s.prop.quaternion.setFromUnitVectors(FWD, _d.copy(s.vel).normalize());
        s.prop.launch(s.pos, s.vel);
        this.game.fx.burst(s.pos, { color: '#bfffd0', count: 5, speed: 2, size: 0.1, gravity: 0 });
      }
    }
    return n;
  }

  clear() {
    for (let i = this.shots.length - 1; i >= 0; i--) this.drop(i);
    this.targets = [];
  }
}
