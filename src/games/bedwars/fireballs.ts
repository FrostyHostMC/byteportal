import { math, type Entity, type Player, type Prop, type Vec3 } from '@platform';
import type { Match, Team } from './state';

interface Ball {
  pos: math.Vector3;
  vel: math.Vector3;
  prop: Prop;
  age: number;
  owner: Team;
  by: Entity | Player;
}

const FORWARD = new math.Vector3(0, 0, -1);
const _d = new math.Vector3();
const SPEED = 20;
const BLAST = 4.5;

/**
 * Fire charges: a slow glowing ball that blows up what it hits. Explosions only take wool and
 * wood (the game's block rules), hurt enemies and throw everyone back, the thrower included
 * (fireball jumps).
 */
export class Fireballs {
  private balls: Ball[] = [];

  constructor(private m: Match) {}

  launch(from: Vec3, dir: Vec3, owner: Team, by: Entity | Player) {
    const g = this.m.game;
    const prop = g.props.bolt({ color: '#ff7a1a', length: 0.8, width: 0.8, intensity: 4 });
    const vel = new math.Vector3(dir.x, dir.y, dir.z).normalize().multiplyScalar(SPEED);
    const pos = new math.Vector3(from.x, from.y, from.z).addScaledVector(vel, 0.04);
    prop.position.copy(pos);
    prop.quaternion.setFromUnitVectors(FORWARD, _d.copy(vel).normalize());
    this.balls.push({ pos, vel, prop, age: 0, owner, by });
    g.audio.play('fireball', { at: from });
  }

  update(dt: number) {
    const g = this.m.game;
    for (const b of [...this.balls]) {
      b.age += dt;
      const step = SPEED * dt;
      _d.copy(b.vel).normalize();
      let boom: Vec3 | null = null;
      const hit = g.world.raycast(b.pos, _d, step + 0.35);
      if (hit) boom = { x: hit.x + 0.5 + hit.normal.x * 0.7, y: hit.y + 0.5 + hit.normal.y * 0.7, z: hit.z + 0.5 + hit.normal.z * 0.7 };
      if (!boom) {
        for (const e of g.entities.near(b.pos, 1.4)) {
          if (e.alive && e.data.team && e.data.team !== b.owner.color) boom = { x: b.pos.x, y: b.pos.y, z: b.pos.z };
        }
      }
      if (!boom) {
        // It bursts on anyone from another team.
        for (const p of g.players) {
          if (!p.alive || p.spectating || this.m.memberOf(p)?.team === b.owner) continue;
          const pe = p.position;
          if (Math.hypot(pe.x - b.pos.x, pe.y + 0.9 - b.pos.y, pe.z - b.pos.z) < 1.3) boom = { x: b.pos.x, y: b.pos.y, z: b.pos.z };
        }
      }
      b.pos.addScaledVector(b.vel, dt);
      if (boom || b.age > 5 || b.pos.y < this.m.map.voidY) {
        this.balls.splice(this.balls.indexOf(b), 1);
        b.prop.remove();
        if (boom) this.explode(boom, b);
        continue;
      }
      b.prop.position.copy(b.pos);
      b.prop.scale = 0.9 + Math.sin(b.age * 30) * 0.15;
      g.fx.burst(b.pos, { color: '#ffb347', count: 2, speed: 0.6, size: 0.12, glow: 2, life: 0.4, gravity: -1 });
    }
  }

  private explode(at: Vec3, b: Ball) {
    const g = this.m.game;
    // Only wool and wood placed this match go (Bed Wars' rules for explosions).
    g.world.explode(at, 2.6, { filter: (p, block) => this.m.canBreak(p, block, 'world'), by: b.by });
    for (const e of g.entities.near(at, BLAST)) {
      if (!e.alive || !e.data.team) continue;
      const p = e.position;
      const d = Math.hypot(p.x - at.x, p.y + 0.9 - at.y, p.z - at.z);
      const f = Math.max(0, 1 - d / BLAST);
      if (e.data.team !== b.owner.color) e.damage(1 + 6 * f, { source: b.by, from: at, knockback: 0.6 + 1.4 * f });
      else push(e, at, f);
    }
    for (const pl of g.players) {
      if (!pl.alive || pl.spectating) continue;
      const p = pl.position;
      const d = Math.hypot(p.x - at.x, p.y + 0.9 - at.y, p.z - at.z);
      if (d >= BLAST) continue;
      const f = 1 - d / BLAST;
      const dx = p.x - at.x;
      const dz = p.z - at.z;
      const l = Math.hypot(dx, dz) || 1;
      if (this.m.memberOf(pl)?.team !== b.owner) pl.damage(1 + 6 * f, { source: b.by, from: at, knockback: 0.6 + 1.2 * f });
      else pl.damage(1 * f, { source: 'world', knockback: 0 });
      // Everybody flies: the thrower too (fireball jumping).
      pl.impulse((dx / l) * 9 * f, 6 + 7 * f, (dz / l) * 9 * f);
    }
  }

  clear() {
    for (const b of this.balls) b.prop.remove();
    this.balls = [];
  }
}

function push(e: Entity, at: Vec3, f: number) {
  const p = e.position;
  const dx = p.x - at.x;
  const dz = p.z - at.z;
  const l = Math.hypot(dx, dz) || 1;
  e.impulse((dx / l) * 8 * f, 4 + 5 * f, (dz / l) * 8 * f);
}
