import type { Client, ClientKit, Figure } from '@platform/client';
import { Color, Euler, Quat } from '@platform/client/math';
import type { ClientPart } from './part';

/**
 * The bestiary on each screen: what the server tells it once and it draws itself (so nothing's
 * streamed): warning rings on the sand, elites' auras, the wraith's draining tether, a cultist's
 * blessing, fire left burning; and the poses its monsters need (the knight's shield held up before
 * it, lowered after it swings; the wraith floating).
 */

type RGB = [number, number, number];
const rgb = (css: string, k = 1): RGB => {
  const c = new Color(css);
  return [c.r * k, c.g * k, c.b * k];
};

interface Ring {
  x: number;
  y: number;
  z: number;
  radius: number;
  time: number;
  color: RGB;
  age: number;
  tick: number;
}
interface Fire {
  x: number;
  y: number;
  z: number;
  left: number;
  tick: number;
}
interface Aura {
  affix: string;
  color: RGB;
  tick: number;
  ring: number;
  /** When it was last drawn (its figure can come a moment after the word of it). */
  seen: number;
}

/** Each affix's aura: particles about the figure, how often, and how (besides the ring at every elite's feet). */
const AURAS: Record<string, { every: number; draw(c: Client, f: Figure, color: RGB, h: number): void }> = {
  fiery: { every: 0.04, draw: (c, f, color, h) => c.fx.particles(about(f, 0.5, h * 0.45), color, { count: 3, speed: 0.7, size: 0.17, glow: 2.6, gravity: -5, life: 0.55, spread: 0.3, up: 1.2 }) },
  frozen: { every: 0.06, draw: (c, f, color, h) => c.fx.particles(about(f, 0.55, h * 0.6), color, { count: 3, speed: 0.5, size: 0.11, glow: 2.4, gravity: 2, life: 0.9, spread: 0.4, up: 0.3 }) },
  vampiric: { every: 0.06, draw: (c, f, color, h) => c.fx.particles(about(f, 0.45, h * 0.55), color, { count: 2, speed: 0.4, size: 0.13, glow: 2, gravity: -1, life: 0.8, spread: 0.35, drag: 1 }) },
  shielded: { every: 0.08, draw: (c, f, color, h) => c.fx.particles(about(f, 0.85, h * 0.5, true), color, { count: 2, speed: 0.1, size: 0.1, glow: 2.4, gravity: 0, life: 0.5, spread: 0.05 }) },
  hasted: { every: 0.04, draw: (c, f, color, h) => c.fx.particles(about(f, 0.35, h * 0.45), color, { count: 2, speed: 0.1, size: 0.09, glow: 2.4, gravity: 0, life: 0.4, spread: 0.4, drag: 3 }) },
  explosive: { every: 0.05, draw: (c, f, color, h) => c.fx.particles(about(f, 0.3, h * 0.85), color, { count: 2, speed: 1.6, size: 0.09, glow: 3, gravity: 6, life: 0.4, spread: 0.15, up: 1.5 }) },
  splitting: { every: 0.08, draw: (c, f, color, h) => c.fx.particles(about(f, 0.5, h * 0.3), color, { count: 2, speed: 0.6, size: 0.13, glow: 1.6, gravity: 3, life: 0.6, spread: 0.3, up: 0.6 }) },
  juggernaut: { every: 0.06, draw: (c, f, color, h) => c.fx.particles(about(f, 0.75, h * 0.05), color, { count: 3, speed: 0.6, size: 0.15, glow: 2, gravity: -1.5, life: 0.7, spread: 0.2, up: 0.4 }) },
};

/** The ring at an elite's feet, in its affix's colour, turning. */
function footRing(c: Client, f: Figure, color: RGB, t: number) {
  const p = f.root.position;
  const r = 0.75 * f.root.scale.x;
  for (let m = 0; m < 10; m++) {
    const a = t * 1.8 + (m / 10) * Math.PI * 2;
    c.fx.particles({ x: p.x + Math.cos(a) * r, y: p.y + 0.08, z: p.z + Math.sin(a) * r }, color, { count: 1, speed: 0, size: 0.1, glow: 2.4, gravity: 0, life: 0.12, spread: 0 });
  }
}

/** A point about a figure: round it at `r` (blocks, its size's), `y` up, on its rim if `rim`. */
function about(f: Figure, r: number, y: number, rim = false) {
  const p = f.root.position;
  const s = f.root.scale.x;
  const a = Math.random() * Math.PI * 2;
  const d = (rim ? 1 : Math.sqrt(Math.random())) * r * s;
  return { x: p.x + Math.cos(a) * d, y: p.y + y * s + (Math.random() - 0.5) * y * s, z: p.z + Math.sin(a) * d };
}

/** How tall each kind stands (for auras and tethers), blocks. */
const HEIGHT: Record<string, number> = { minotaur: 2.4, knight: 1.95, wraith: 2, imp: 1.15, golem: 2.8, cultist: 1.95, bat: 0.6, slime: 0.95, slime_small: 0.55, slime_tiny: 0.32, spider: 0.9, brute: 2.5 };
const heightOf = (f: Figure) => (HEIGHT[f.type] ?? 1.9) * f.root.scale.x;

// The knight's shield arm: up before it (the forearm level, the shield square ahead), or lowered.
const e1 = new Euler(0, 0, 0, 'YXZ');
const q1 = new Quat();
const ARM = { up: { upper: [-0.5, 0.12, 0.08], lower: [-1.07, 0, 0] }, down: { upper: [-0.35, 1.0, 0.3], lower: [-1.0, 0, 0] } };

function bestiaryKit(): ClientKit {
  const rings: Ring[] = [];
  const fires: Fire[] = [];
  const auras = new Map<number, Aura>();
  /** Knights' guards (by id): down after a swing; how far up each shows (eased). */
  const guards = new Map<number, boolean>();
  const raised = new Map<number, number>();
  const tethers = new Map<number, { player: string; color: RGB; tick: number }>();
  const blessed = new Map<number, { until: number; tick: number }>();
  const links: { from: number; to: number; left: number }[] = [];
  /** Lines on the ground where a charge will run. */
  const lines: { x: number; y: number; z: number; dir: number; length: number; width: number; time: number; age: number; tick: number; color: RGB }[] = [];
  /** Monsters reeling (a minotaur into a wall): till when. */
  const dazed = new Map<number, number>();
  /** Cultists at their rite (by id): how long it's been, and how long it takes. */
  const rites = new Map<number, { age: number; time: number }>();
  let clock = 0;

  return {
    name: 'arena.bestiary',
    setup(client) {
      client.on('bestiary.ring', (d) => {
        const r = d as { x: number; y: number; z: number; radius: number; time: number; color: string };
        rings.push({ ...r, color: rgb(r.color, 1.4), age: 0, tick: 0 });
      });
      client.on('bestiary.fire', (d) => {
        const f = d as { x: number; y: number; z: number; time: number };
        fires.push({ x: f.x, y: f.y, z: f.z, left: f.time, tick: 0 });
      });
      client.on('bestiary.elite', (d) => {
        const e = d as { id: number; affix: string; color: string };
        auras.set(e.id, { affix: e.affix, color: rgb(e.color, 1.6), tick: Math.random() * 0.1, ring: 0, seen: clock });
      });
      client.on('bestiary.guard', (d) => {
        const g = d as { id: number; up: boolean };
        guards.set(g.id, g.up);
      });
      client.on('bestiary.tether', (d) => {
        const t = d as { id: number; player: string | null; color?: string };
        if (t.player) tethers.set(t.id, { player: t.player, color: rgb(t.color ?? '#6affc8', 1.6), tick: 0 });
        else tethers.delete(t.id);
      });
      client.on('bestiary.line', (d) => {
        const l = d as { x: number; y: number; z: number; dir: number; length: number; width: number; time: number; color: string };
        lines.push({ ...l, age: 0, tick: 0, color: rgb(l.color, 1.4) });
      });
      client.on('bestiary.dazed', (d) => {
        const z = d as { id: number; time: number };
        dazed.set(z.id, clock + z.time);
      });
      client.on('bestiary.rite', (d) => {
        const r = d as { id: number; time: number };
        rites.set(r.id, { age: 0, time: r.time });
      });
      client.on('bestiary.empower', (d) => {
        const b = d as { from: number; ids: number[]; time: number };
        for (const id of b.ids) {
          blessed.set(id, { until: clock + b.time, tick: 0 });
          links.push({ from: b.from, to: id, left: 0.6 });
        }
      });
    },
    frame(client, dt) {
      clock += dt;
      const fx = client.fx;
      const shown = new Map(client.figures.all.map((f) => [f.id, f]));
      for (const f of client.figures.all) {
        if (f.player !== null) continue;
        // Knights hold their shields up before them, lowered for a moment after a swing.
        if (f.type === 'knight' && f.rig) {
          const want = guards.get(f.id) === false ? 0 : 1;
          const g = (raised.get(f.id) ?? 1) + (want - (raised.get(f.id) ?? 1)) * Math.min(1, dt * 7);
          raised.set(f.id, g);
          const j = f.rig.joints;
          const rest = f.rig.rest;
          for (const [joint, key] of [['upperArmL', 'upper'], ['lowerArmL', 'lower']] as const) {
            const u = ARM.up[key];
            const d = ARM.down[key];
            q1.setFromEuler(e1.set(d[0] + (u[0] - d[0]) * g, d[1] + (u[1] - d[1]) * g, d[2] + (u[2] - d[2]) * g, 'YXZ'));
            j[joint].quaternion.copy(rest[joint].quaternion).multiply(q1);
          }
        }
        // Wraiths float, rising and falling, wisps trailing off their rags.
        if (f.type === 'wraith' && f.state.dying === 0) {
          f.root.position.y += 0.22 + Math.sin(clock * 2.2 + f.id) * 0.12;
          if (Math.random() < dt * 14) fx.particles(about(f, 0.45, 0.35), [0.25, 1.2, 0.85], { count: 1, speed: 0.3, size: 0.07, glow: 1.6, gravity: -1.2, life: 0.9, spread: 0.1, drag: 1.5 });
        }
        // A cultist at its rite: down on its knees in its robe, blood rising round it.
        const rite = rites.get(f.id);
        if (rite) {
          rite.age += dt;
          if (rite.age > rite.time + 0.2 || f.state.dying > 0) rites.delete(f.id);
          else {
            f.root.position.y -= 0.42 * Math.min(1, rite.age / 0.3);
            if (Math.random() < dt * 30) fx.particles(about(f, 0.9, 0.2), [1.6, 0.06, 0.1], { count: 1, speed: 0.3, size: 0.1, glow: 2, gravity: -2.5, life: 0.8, spread: 0.1 });
          }
        }
        // Reeling: swaying on its feet, stars round its head.
        const until = dazed.get(f.id);
        if (until !== undefined) {
          if (until < clock || f.state.dying > 0) {
            dazed.delete(f.id);
            f.root.rotation.z = 0;
          } else {
            f.root.rotation.z = Math.sin(clock * 5) * 0.12;
            const h = heightOf(f);
            const a = clock * 4;
            if (Math.random() < dt * 20) fx.particles({ x: f.root.position.x + Math.cos(a) * 0.6, y: f.root.position.y + h + 0.15, z: f.root.position.z + Math.sin(a) * 0.6 }, [2, 1.7, 0.4], { count: 1, speed: 0, size: 0.12, glow: 2.6, gravity: 0, life: 0.35, spread: 0 });
          }
        }
        // Elites' auras.
        const a = auras.get(f.id);
        if (a) a.seen = clock;
        if (a && f.state.dying === 0) {
          const spec = AURAS[a.affix];
          a.tick -= dt;
          if (spec && a.tick <= 0) {
            a.tick = spec.every;
            spec.draw(client, f, a.color, heightOf(f));
          }
          a.ring -= dt;
          if (a.ring <= 0) {
            a.ring = 0.1;
            footRing(client, f, a.color, clock);
          }
        }
        // Blessed by a cultist: a red haze rising off them.
        const b = blessed.get(f.id);
        if (b) {
          if (b.until < clock) blessed.delete(f.id);
          else if ((b.tick -= dt) <= 0) {
            b.tick = 0.1;
            fx.particles(about(f, 0.35, heightOf(f) * 0.5), [1.4, 0.08, 0.12], { count: 1, speed: 0.4, size: 0.08, glow: 1.6, gravity: -2, life: 0.6, spread: 0.3 });
          }
        }
      }
      // Forget what's gone.
      for (const [id, a] of auras) if (clock - a.seen > 3) auras.delete(id);
      for (const id of raised.keys()) if (!shown.has(id)) (raised.delete(id), guards.delete(id));
      for (const id of rites.keys()) if (!shown.has(id)) rites.delete(id);
      for (const id of dazed.keys()) if (!shown.has(id)) dazed.delete(id);
      // The wraith's tether: a stream of ghost-light from its claws to whoever it drains.
      for (const [id, t] of tethers) {
        const w = shown.get(id);
        if (!w) {
          tethers.delete(id);
          continue;
        }
        const p = client.figures.all.find((f) => f.player === t.player);
        const to = p ? { x: p.root.position.x, y: p.root.position.y + 1.2, z: p.root.position.z } : t.player === client.me.id ? meChest(client) : null;
        if (!to || (t.tick -= dt) > 0) continue;
        t.tick = 0.03;
        const from = { x: w.root.position.x, y: w.root.position.y + 1.4, z: w.root.position.z };
        for (let n = 0; n < 3; n++) {
          const k = Math.random();
          const at = { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k + Math.sin(k * Math.PI) * 0.4, z: from.z + (to.z - from.z) * k };
          // Drawn toward the wraith: the life flowing into it.
          const v = { x: (from.x - to.x) * 1.2, y: (from.y - to.y) * 1.2, z: (from.z - to.z) * 1.2 };
          fx.particles(at, t.color, { count: 1, speed: 0.2, size: 0.08, glow: 2.4, gravity: 0, life: 0.25, spread: 0.05, velocity: v });
        }
      }
      // A cultist's blessing reaching out to each it empowers.
      for (let i = links.length - 1; i >= 0; i--) {
        const l = links[i];
        l.left -= dt;
        const a = shown.get(l.from);
        const b = shown.get(l.to);
        if (l.left <= 0 || !a || !b) {
          links.splice(i, 1);
          continue;
        }
        const from = { x: a.root.position.x, y: a.root.position.y + 2.4, z: a.root.position.z };
        const to = { x: b.root.position.x, y: b.root.position.y + heightOf(b) * 0.6, z: b.root.position.z };
        const k = 1 - l.left / 0.6;
        const at = { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k + Math.sin(k * Math.PI) * 0.8, z: from.z + (to.z - from.z) * k };
        fx.particles(at, [1.6, 0.1, 0.15], { count: 3, speed: 0.4, size: 0.1, glow: 2.4, gravity: 0, life: 0.35, spread: 0.08 });
      }
      // Warning rings: the rim traced, filling in toward it as the moment comes.
      for (let i = rings.length - 1; i >= 0; i--) {
        const r = rings[i];
        r.age += dt;
        if (r.age >= r.time) {
          rings.splice(i, 1);
          continue;
        }
        if ((r.tick -= dt) > 0) continue;
        r.tick = 0.05;
        const k = r.age / r.time;
        // The rim, turning slowly; and a second ring spreading out to meet it as the moment comes.
        const spin = r.age * 1.5;
        for (const [radius, size, glow] of [[r.radius, 0.16, 3], [r.radius * k, 0.12, 2]] as const) {
          const n = Math.max(6, Math.ceil(radius * 7));
          for (let m = 0; m < n; m++) {
            const a = spin + (m / n) * Math.PI * 2;
            fx.particles({ x: r.x + Math.cos(a) * radius, y: r.y + 0.12, z: r.z + Math.sin(a) * radius }, r.color, { count: 1, speed: 0, size, glow, gravity: 0, life: 0.1, spread: 0 });
          }
        }
        for (let m = 0; m < Math.ceil(r.radius * 2); m++) {
          const a = Math.random() * Math.PI * 2;
          const d = Math.sqrt(Math.random()) * r.radius * k;
          fx.particles({ x: r.x + Math.cos(a) * d, y: r.y + 0.1, z: r.z + Math.sin(a) * d }, r.color, { count: 1, speed: 0.3, size: 0.08, glow: 1.5, gravity: -2, life: 0.3, spread: 0.05 });
        }
      }
      // A charge's line: from the beast along the way it will run, the far end creeping out.
      for (let i = lines.length - 1; i >= 0; i--) {
        const l = lines[i];
        l.age += dt;
        if (l.age >= l.time) {
          lines.splice(i, 1);
          continue;
        }
        if ((l.tick -= dt) > 0) continue;
        l.tick = 0.05;
        const reach = l.length * Math.min(1, 0.35 + l.age / l.time);
        const sx = Math.sin(l.dir), sz = Math.cos(l.dir);
        for (let d = 1; d < reach; d += 0.45)
          for (const side of [-1, 1]) {
            const w = (l.width / 2) * side;
            fx.particles({ x: l.x + sx * d + sz * w, y: l.y + 0.12, z: l.z + sz * d - sx * w }, l.color, { count: 1, speed: 0, size: 0.15, glow: 2.8, gravity: 0, life: 0.1, spread: 0 });
          }
        // Chevrons down the middle, pointing the way it will come.
        const step = 1.6;
        for (let d = 1.5 + ((l.age * 4) % step); d < reach; d += step)
          for (const side of [-1, 1])
            for (const t of [0.25, 0.5]) {
              const w = (l.width / 2) * side * t;
              const back = t * 0.6;
              fx.particles({ x: l.x + sx * (d - back) + sz * w, y: l.y + 0.12, z: l.z + sz * (d - back) - sx * w }, l.color, { count: 1, speed: 0, size: 0.13, glow: 2.2, gravity: 0, life: 0.1, spread: 0 });
            }
      }
      // Fire left burning on the sand.
      for (let i = fires.length - 1; i >= 0; i--) {
        const f = fires[i];
        f.left -= dt;
        if (f.left <= 0) {
          fires.splice(i, 1);
          continue;
        }
        if ((f.tick -= dt) > 0) continue;
        f.tick = 0.05;
        const fade = Math.min(1, f.left / 1.2);
        fx.particles({ x: f.x, y: f.y + 0.1, z: f.z }, [1.8 * fade, 0.5 * fade, 0.08 * fade], { count: 3, speed: 0.5, size: 0.18, glow: 2.6, gravity: -5, life: 0.5, spread: 0.6, up: 1.2 });
      }
    },
  };
}

/** Where our own chest is (we don't see our figure in first person). */
function meChest(client: Client) {
  const p = client.me.position;
  return { x: p.x, y: p.y + 1.2, z: p.z };
}

/** The bestiary on screen: elite auras, telegraphs, its monsters' poses (its voices are `sounds/bestiary.ts`). */
export const bestiaryClient: ClientPart = { name: 'bestiaryClient', kits: [bestiaryKit()] };
