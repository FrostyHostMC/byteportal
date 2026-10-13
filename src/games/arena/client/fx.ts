import type { Client, ClientKit, Figure } from '@platform/client';
import { Color } from '@platform/client/math';
import { SHOWS } from '../items/moves';

/**
 * The arsenal's lasting effects, drawn by each screen from one word of the server's (so nothing's
 * streamed): flames on a burning monster, blood dripping from a bleeding one, stars round a
 * staggered one's head (`armory.status`, as they start and stop); the trails behind fireballs, frost
 * shards and the Sunderer's wave (`armory.trail` as one's loosed, flown here as the server flies it,
 * `armory.land` as it stops); a sweep's arc of sparks (`armory.sweep`); Emberheart's burning ground
 * (`armory.pool`).
 */

type RGB = [number, number, number];
const rgb = (css: string, k = 1): RGB => {
  const c = new Color(css);
  return [c.r * k, c.g * k, c.b * k];
};

const FLAME = rgb('#ff8a2a', 1.6);
const EMBER = rgb('#ffcf5a', 2);
const BLOOD = rgb('#8a1010');
const STAR = rgb('#fff1a0', 2.2);
const POOL = rgb('#ff6a12', 1.8);

interface Trail {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  left: number;
  every: number;
  tick: number;
  color: RGB;
  size: number;
  /** A puff where it stops, if it makes one. */
  end: RGB | null;
}

/** How tall a figure stands (its humanoid head's height, else a beast's), blocks. */
function heightOf(f: Figure): number {
  const s = f.root.scale.x;
  return f.rig ? (f.rig.straight.head.y + 0.35) * s : 0.9 * s;
}

/** A point about a figure: round it at `r` (blocks), `y` up. */
function about(f: Figure, r: number, y: number) {
  const p = f.root.position;
  const a = Math.random() * Math.PI * 2;
  const d = Math.sqrt(Math.random()) * r;
  return { x: p.x + Math.cos(a) * d, y: p.y + y, z: p.z + Math.sin(a) * d };
}

export function armoryFx(): ClientKit {
  /** What each monster shows (by id: `SHOWS` flags), and its next flame, drop and star. */
  const shows = new Map<number, { f: number; flame: number; drop: number; star: number }>();
  const trails = new Map<number, Trail>();
  const pools: { x: number; y: number; z: number; radius: number; left: number; tick: number }[] = [];
  let clock = 0;

  return {
    name: 'arena.armory.fx',
    setup(client) {
      client.on('armory.status', (d) => {
        const { id, f } = d as { id: number; f: number };
        const was = shows.get(id);
        if (!f) shows.delete(id);
        else if (was) was.f = f;
        else shows.set(id, { f, flame: 0, drop: 0, star: 0 });
      });
      client.on('armory.trail', (d) => {
        const t = d as { n: number; x: number; y: number; z: number; vx: number; vy: number; vz: number; life: number; color: string; every: number; size: number; end: string | null };
        trails.set(t.n, { x: t.x, y: t.y, z: t.z, vx: t.vx, vy: t.vy, vz: t.vz, left: t.life, every: t.every, tick: 0, color: rgb(t.color, 1.4), size: t.size, end: t.end ? rgb(t.end, 1.2) : null });
      });
      client.on('armory.land', (d) => {
        const l = d as { n: number; x: number; y: number; z: number };
        const t = trails.get(l.n);
        trails.delete(l.n);
        if (t?.end) client.fx.particles({ x: l.x, y: l.y, z: l.z }, t.end, { count: 8, speed: 2.2, size: 0.08, gravity: 6, life: 0.4, spread: 0.05 });
      });
      client.on('armory.sweep', (d) => sweep(client, d as { x: number; y: number; z: number; yaw: number; reach: number; arc: number; color: string }));
      client.on('armory.pool', (d) => {
        const p = d as { x: number; y: number; z: number; radius: number; time: number };
        pools.push({ x: p.x, y: p.y, z: p.z, radius: p.radius, left: p.time, tick: 0 });
      });
    },
    frame(client, dt) {
      clock += dt;
      const fx = client.fx;
      if (shows.size) {
        for (const f of client.figures.all) {
          const s = shows.get(f.id);
          if (!s) continue;
          const h = heightOf(f);
          if (s.f & SHOWS.burn && (s.flame -= dt) <= 0) {
            s.flame = 0.05;
            fx.particles(about(f, 0.4 * f.root.scale.x, h * (0.15 + 0.7 * Math.random())), Math.random() < 0.3 ? EMBER : FLAME, { count: 3, speed: 0.7, size: 0.19, glow: 2.6, gravity: -4.5, life: 0.55, spread: 0.2, up: 1.2 });
          }
          if (s.f & SHOWS.bleed && (s.drop -= dt) <= 0) {
            s.drop = 0.2;
            fx.particles(about(f, 0.25 * f.root.scale.x, h * 0.55), BLOOD, { count: 1, speed: 0.3, size: 0.08, gravity: 10, life: 0.6, spread: 0.1 });
          }
          if (s.f & SHOWS.stun && (s.star -= dt) <= 0) {
            s.star = 0.06;
            const p = f.root.position;
            const a = clock * 6;
            const r = 0.35 * f.root.scale.x;
            fx.particles({ x: p.x + Math.cos(a) * r, y: p.y + h + 0.15, z: p.z + Math.sin(a) * r }, STAR, { count: 1, speed: 0, size: 0.1, glow: 2.6, gravity: 0, life: 0.3, spread: 0 });
          }
        }
      }
      for (const [n, t] of trails) {
        t.left -= dt;
        if (t.left <= 0) {
          trails.delete(n);
          continue;
        }
        t.x += t.vx * dt;
        t.y += t.vy * dt;
        t.z += t.vz * dt;
        if ((t.tick -= dt) > 0) continue;
        t.tick = t.every;
        fx.particles({ x: t.x, y: t.y, z: t.z }, t.color, { count: 2, speed: 0.5, size: t.size, glow: 1.8, gravity: -0.5, life: 0.35, spread: 0.05 });
      }
      for (let i = pools.length - 1; i >= 0; i--) {
        const p = pools[i];
        p.left -= dt;
        if (p.left <= 0) {
          pools.splice(i, 1);
          continue;
        }
        if ((p.tick -= dt) > 0) continue;
        p.tick = 0.05;
        const a = Math.random() * Math.PI * 2;
        const d = Math.sqrt(Math.random()) * p.radius;
        fx.particles({ x: p.x + Math.cos(a) * d, y: p.y + 0.1, z: p.z + Math.sin(a) * d }, POOL, { count: 2, speed: 0.6, size: 0.17, glow: 2.4, gravity: -3.5, life: 0.6, spread: 0.1, up: 0.8 });
      }
    },
  };
}

/** A swing's arc in the air: a fan of sparks along its edge, `arc` radians either side of `yaw`. */
function sweep(client: Client, s: { x: number; y: number; z: number; yaw: number; reach: number; arc: number; color: string }) {
  const n = Math.max(5, Math.round((s.arc * 180) / Math.PI / 10));
  const color = rgb(s.color, 1.2);
  for (let i = 0; i <= n; i++) {
    const a = s.yaw + (i / n - 0.5) * 2 * s.arc;
    client.fx.particles({ x: s.x - Math.sin(a) * s.reach, y: s.y + (i / n - 0.5) * 0.2, z: s.z - Math.cos(a) * s.reach }, color, { count: 2, speed: 0.4, size: 0.1, glow: 1.2, gravity: 0, life: 0.22, spread: 0.05, drag: 4 });
  }
}
