import { Blueprint, math, type GameContext, type Player, type Prop, type PropModel, type Vec3 } from '@platform';
import type { Destroyer } from './destroyer';
import { headingTo } from './craft';
import type { Target, Weapons } from './weapons';
import type { Quarry } from './enemies';

const _v = new math.Vector3();
const _e = new math.Euler();

/** A turbolaser turret: a small block build that tracks the player and fires heavy bolts. */
function turretBuild(): Blueprint {
  const bp = new Blueprint({ x: -3, y: 0, z: -7 }, { x: 7, y: 5, z: 11 });
  bp.fill({ x: -2, y: 0, z: -2 }, { x: 2, y: 0, z: 2 }, 'gray_concrete');
  bp.fill({ x: -2, y: 1, z: -2 }, { x: 2, y: 3, z: 2 }, 'light_gray_concrete');
  bp.fill({ x: -1, y: 4, z: -1 }, { x: 1, y: 4, z: 1 }, 'iron_block');
  bp.fill({ x: -1, y: 2, z: -6 }, { x: -1, y: 2, z: -3 }, 'gray_concrete');
  bp.fill({ x: 1, y: 2, z: -6 }, { x: 1, y: 2, z: -3 }, 'gray_concrete');
  bp.set(-1, 2, -7, 'black_concrete').set(1, 2, -7, 'black_concrete');
  bp.fill({ x: -1, y: 1, z: 2 }, { x: 1, y: 1, z: 2 }, 'glowstone');
  return bp;
}

class Turret implements Target {
  team = 'empire' as const;
  alive = true;
  hp = 45;
  readonly radius = 2.4;
  private timer = 3 + Math.random() * 5;
  readonly prop: Prop;
  readonly pos: math.Vector3;

  constructor(
    private game: GameContext,
    model: PropModel,
    mount: Vec3,
    private weapons: Weapons,
  ) {
    this.pos = new math.Vector3(mount.x + 0.5, mount.y + 1.8, mount.z + 0.5);
    this.prop = game.props.spawn(model, { position: { x: mount.x + 0.5, y: mount.y + 1, z: mount.z + 0.5 } });
  }

  hit(damage: number, at: Vec3) {
    if (!this.alive) return;
    this.hp -= damage;
    this.prop.flash('#ffffff', 0.08);
    this.game.fx.burst(at, { color: '#ffb070', count: 6, speed: 3, size: 0.14 });
    if (this.hp <= 0) {
      this.alive = false;
      this.prop.remove();
      this.game.world.explode(this.pos, 2.5, { effect: false });
      this.game.fx.explosion(this.pos, { size: 1.6 });
    }
  }

  update(dt: number, pilots: Quarry[], active: boolean) {
    if (!this.alive || !active) return;
    // The nearest pilot still flying.
    let player: Quarry | null = null;
    let d = Infinity;
    for (const p of pilots) {
      if (!p.alive) continue;
      const pd = _v.set(p.pos.x - this.pos.x, p.pos.y - this.pos.y, p.pos.z - this.pos.z).length();
      if (pd < d) {
        d = pd;
        player = p;
      }
    }
    if (!player || d > 260) return;
    const h = headingTo(this.pos, player.pos);
    _e.set(Math.max(-0.2, Math.min(0.9, h.pitch)) * 0.5, h.yaw, 0, 'YXZ');
    this.prop.quaternion.slerp(new math.Quaternion().setFromEuler(_e), Math.min(1, dt * 3));
    this.timer -= dt;
    if (d > 170 || this.timer > 0) return;
    this.timer = 3 + Math.random() * 3.5;
    if (!this.game.world.lineOfSight(this.pos, player.pos)) return;
    // Lead the shot a little, with some spread.
    const t = d / 170;
    const aim = new math.Vector3(player.pos.x + player.vel.x * t, player.pos.y + player.vel.y * t, player.pos.z + player.vel.z * t);
    aim.x += (Math.random() - 0.5) * 10;
    aim.y += (Math.random() - 0.5) * 10;
    const dir = aim.sub(this.pos).normalize();
    this.weapons.laser(this.pos, dir, 'empire', { speed: 150, damage: 7 });
  }
}

/** A weak point made of world blocks: shots near it count as hits; it blows out of the hull. */
class WeakPoint implements Target {
  team = 'empire' as const;
  alive = true;
  hp: number;
  readonly maxHp: number;
  shielded = false;
  readonly pos: math.Vector3;

  constructor(
    private game: GameContext,
    at: Vec3,
    readonly radius: number,
    hp: number,
    readonly label: string,
    private blast: number,
    private onDestroyed: (by?: Player) => void,
  ) {
    this.pos = new math.Vector3(at.x, at.y, at.z);
    this.hp = this.maxHp = hp;
  }

  hit(damage: number, at: Vec3, by: 'laser' | 'torpedo', shooter?: Player) {
    if (!this.alive) return;
    if (this.shielded) {
      this.game.fx.burst(at, { color: '#7ec8ff', count: 10, speed: 4, size: 0.15, gravity: 0 });
      if (by === 'torpedo') this.game.fx.shockwave(at, 4, '#7ec8ff');
      return;
    }
    this.hp -= damage;
    this.game.fx.burst(at, { color: '#ffcf70', count: 10, speed: 5, size: 0.16, gravity: 2 });
    if (this.hp <= 0) {
      this.alive = false;
      this.game.world.explode(this.pos, this.blast);
      this.game.fx.explosion(this.pos, { size: 4 });
      this.game.fx.shake(0.5, 0.8);
      this.onDestroyed(shooter);
    }
  }
}

/** The capital ship battle: turrets, two shield generators, then the bridge. */
export class Capital {
  turrets: Turret[] = [];
  generators: WeakPoint[] = [];
  bridge: WeakPoint;
  active = false;
  destroyed = false;
  private chain: { at: Vec3; t: number }[] = [];

  constructor(
    private game: GameContext,
    readonly ship: Destroyer,
    weapons: Weapons,
    events: { generatorDown(left: number, by?: Player): void; bridgeDown(): void },
  ) {
    const model = game.props.model(turretBuild(), { scale: 0.5 });
    this.turrets = ship.turrets.map((m) => new Turret(game, model, m, weapons));
    this.generators = ship.generators.map(
      (g) =>
        new WeakPoint(game, g, 6, 220, 'SHIELD GEN', 6.5, (by) => {
          const left = this.generators.filter((x) => x.alive).length;
          if (left === 0) this.bridge.shielded = false;
          events.generatorDown(left, by);
        }),
    );
    this.bridge = new WeakPoint(game, ship.bridge, 9, 260, 'BRIDGE', 9, () => {
      this.destroyed = true;
      this.startChain();
      events.bridgeDown();
    });
    this.bridge.shielded = true;
  }

  targets(): Target[] {
    return [...this.turrets, ...this.generators, this.bridge];
  }

  /** Explosions rippling from the bridge down the superstructure and forward along the hull to the nose. */
  private startChain() {
    const b = this.ship.bridge;
    const n = 22;
    for (let i = 0; i < n; i++) {
      const k = i / (n - 1);
      const spread = 8 + k * 30;
      this.chain.push({
        at: {
          x: b.x + (Math.random() - 0.5) * spread,
          y: b.y - 12 - k * 40 + (Math.random() - 0.5) * 6,
          z: b.z - k * 150 + (Math.random() - 0.5) * 16,
        },
        t: 0.3 + i * 0.22 + Math.random() * 0.15,
      });
    }
  }

  update(dt: number, pilots: Quarry[]) {
    for (const t of this.turrets) t.update(dt, pilots, this.active);
    for (const c of this.chain) {
      c.t -= dt;
      if (c.t <= 0 && c.t > -dt) {
        this.game.world.explode(c.at, 5 + Math.random() * 4, { effect: false });
        this.game.fx.explosion(c.at, { size: 6 + Math.random() * 3 });
      }
    }
    this.chain = this.chain.filter((c) => c.t > -1);
  }

  /** Scorch the hull: torpedoes blow holes, lasers chip blocks now and then. */
  worldHit(at: Vec3, kind: 'laser' | 'torpedo') {
    const s = this.ship;
    const near = Math.abs(at.y - s.bridge.y) < 60 && Math.hypot(at.x - s.bridge.x, at.z - s.bridge.z) < 180;
    if (!near) return;
    if (kind === 'torpedo') this.game.world.explode(at, 3.2, { effect: false });
    else if (Math.random() < 0.12) this.game.world.explode(at, 0.9, { effect: false });
  }
}
