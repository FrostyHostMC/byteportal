import type { Vec3 } from '@platform';
import type { GunItem } from '@platform/items';
import type { Client, ClientKit, ClientLoop, Node } from '@platform/client';
import { Color, Quat, Vec3 as V3 } from '@platform/client/math';
import { HEROES, saberOf, type HeroId } from '../defs';
import { fxItem, type FxBeam } from '../fxitems';
import { drawBolt } from '../../client/bolts';
import { STYLE } from '../../style';
import { POWERS } from '../tuning';
import { BEAM, type Blade, type HeroScene } from './state';
import { humOf } from './sounds';

/** A beam drawn for a while: thinning away as it goes. */
interface Lit {
  node: Node;
  beam: FxBeam;
  born: number;
  life: number;
  w: number;
}

const Z = new V3(0, 0, 1);
/** A blade's hum is heard within this far (blocks): its loop starts nearer, and stops further. */
const HUM_NEAR = 26;
const HUM_FAR = 32;

/** How big a saber is in the hand (the figures' `heldScale`): a thrown one is drawn as big. */
const HELD_SCALE = STYLE.poses?.heldScale ?? 0.52;
const tq = new Quat();
const tv = new V3();

/**
 * Glowing beams from the effect models (`fxitems.ts`, `client.scene.item`), pooled: a segment
 * from one point to another, some thickness, for a moment, thinning away. What lightning, blade
 * trails and glowing cores are drawn with.
 */
class Beams {
  private free = new Map<FxBeam, Node[]>();
  private lit: Lit[] = [];
  /** Beams kept up frame to frame by name (a blade's core): placed each frame, hidden when not. */
  private kept = new Map<string, { node: Node; beam: FxBeam; seen: boolean }>();

  constructor(private client: Client) {}

  private take(beam: FxBeam): Node | null {
    const pool = this.free.get(beam);
    const n = pool?.pop();
    if (n) {
      n.visible = true;
      return n;
    }
    const made = this.client.scene.item(fxItem(beam));
    if (!made) return null;
    this.client.scene.add(made.node);
    return made.node;
  }

  private give(beam: FxBeam, node: Node) {
    node.visible = false;
    let pool = this.free.get(beam);
    if (!pool) this.free.set(beam, (pool = []));
    pool.push(node);
  }

  private static place(node: Node, a: Vec3, b: Vec3, w: number) {
    tv.set(b.x - a.x, b.y - a.y, b.z - a.z);
    const len = tv.length();
    if (len < 1e-4) {
      node.visible = false;
      return;
    }
    node.position.set(a.x, a.y, a.z);
    node.quaternion.copy(tq.setFromUnitVectors(Z, tv.divideScalar(len)));
    node.scale.set(w, w, len);
  }

  /** A segment from `a` to `b`, `w` thick, for `life` seconds (thinning away). */
  line(beam: FxBeam, a: Vec3, b: Vec3, w: number, life: number, now: number) {
    const node = this.take(beam);
    if (!node) return;
    Beams.place(node, a, b, w);
    this.lit.push({ node, beam, born: now, life, w });
  }

  /** A beam kept up by name: placed this frame (it hides on a frame it isn't). */
  keep(name: string, beam: FxBeam, a: Vec3, b: Vec3, w: number) {
    let k = this.kept.get(name);
    if (!k || k.beam !== beam) {
      if (k) this.give(k.beam, k.node);
      const node = this.take(beam);
      if (!node) return;
      this.kept.set(name, (k = { node, beam, seen: true }));
    }
    k.seen = true;
    k.node.visible = true;
    Beams.place(k.node, a, b, w);
  }

  /** Each frame, after the kits have drawn: thin the passing ones, hide kept ones not placed. */
  update(now: number) {
    for (let i = this.lit.length - 1; i >= 0; i--) {
      const l = this.lit[i];
      const k = 1 - (now - l.born) / l.life;
      if (k <= 0) {
        this.give(l.beam, l.node);
        this.lit.splice(i, 1);
        continue;
      }
      const w = l.w * (0.35 + 0.65 * k);
      l.node.scale.x = l.node.scale.y = w;
    }
    for (const [name, k] of this.kept) {
      if (!k.seen) {
        this.give(k.beam, k.node);
        this.kept.delete(name);
      } else k.seen = false;
    }
  }

  clear() {
    for (const l of this.lit) this.give(l.beam, l.node);
    this.lit = [];
    for (const k of this.kept.values()) this.give(k.beam, k.node);
    this.kept.clear();
  }
}

const lin = (css: string): [number, number, number] => {
  const c = new Color(css);
  return [c.r, c.g, c.b];
};
const add = (a: Vec3, b: Vec3, k = 1): Vec3 => ({ x: a.x + b.x * k, y: a.y + b.y * k, z: a.z + b.z * k });
const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const len = (a: Vec3) => Math.hypot(a.x, a.y, a.z);
const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });
const dist = (a: Vec3, b: Vec3) => len(sub(a, b));
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const mid = (b: Blade): Vec3 => lerp3(b.base, b.tip, 0.55);

/** A jagged bolt from `a` to `b`: its points, kinked sideways (worked out afresh each time, so it crackles). */
function jag(a: Vec3, b: Vec3, rough = 0.1): Vec3[] {
  const d = sub(b, a);
  const l = len(d) || 1;
  const n = Math.max(3, Math.min(22, Math.round(l / 0.38)));
  // Two directions across it.
  const f = { x: d.x / l, y: d.y / l, z: d.z / l };
  const u = Math.abs(f.y) < 0.9 ? { x: -f.z, y: 0, z: f.x } : { x: 1, y: 0, z: 0 };
  const ul = len(u) || 1;
  const s = { x: u.x / ul, y: u.y / ul, z: u.z / ul };
  const v = { x: f.y * s.z - f.z * s.y, y: f.z * s.x - f.x * s.z, z: f.x * s.y - f.y * s.x };
  const amp = Math.min(0.55, l * rough);
  const pts = [a];
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const k = Math.sin(t * Math.PI) * amp;
    pts.push(add(add(lerp3(a, b, t), s, rnd(-1, 1) * k), v, rnd(-1, 1) * k));
  }
  pts.push(b);
  return pts;
}

/** A ring of beams round `at`, square to `dir`, `r` across: a Force wave's front. */
function ring(B: Beams, at: Vec3, dir: Vec3, r: number, w: number, now: number, beam: FxBeam = 'white', life = 0.035) {
  const up = Math.abs(dir.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  // Two directions across `dir`.
  let sx = dir.y * up.z - dir.z * up.y;
  let sy = dir.z * up.x - dir.x * up.z;
  let sz = dir.x * up.y - dir.y * up.x;
  const sl = Math.hypot(sx, sy, sz) || 1;
  sx /= sl;
  sy /= sl;
  sz /= sl;
  const ux = dir.y * sz - dir.z * sy;
  const uy = dir.z * sx - dir.x * sz;
  const uz = dir.x * sy - dir.y * sx;
  const n = 18;
  const point = (i: number) => {
    const a = (i / n) * Math.PI * 2;
    const c = Math.cos(a) * r;
    const s = Math.sin(a) * r * 0.8;
    return { x: at.x + sx * c + ux * s, y: at.y + sy * c + uy * s, z: at.z + sz * c + uz * s };
  };
  let prev = point(0);
  for (let i = 1; i <= n; i++) {
    const p = point(i);
    if (i % 3 !== 0) B.line(beam, prev, p, w, life, now);
    prev = p;
  }
}

/**
 * The heroes' effects on each screen, from the scene (`state.ts`) and where the figures kit drew
 * each blade and hand this frame:
 *
 * - each blade humming nearby (its glow and the arc it leaves as it swings are the platform's:
 *   its look's `hold.blade`);
 * - bolts turned by a blade: sparks, and the bolt flying off (or back at whoever fired it);
 *   blades meeting: a burst; a cut: embers;
 * - Force Push's wave, a pull's stream, a choke's grip on the throat, lightning crackling from the
 *   Emperor's hands (and leaping from one to the next), the Dark Aura drawing in, a rage's embers,
 *   Soresu's shimmer;
 * - the thrown saber spinning out and back; a rush's streak; a leap's landing shockwave.
 */
export function heroFx(scene: HeroScene): ClientKit {
  let beams: Beams | null = null;
  /** Each blade as it was last frame (for trails). */
  const last = new Map<string, { base: Vec3; tip: Vec3; at?: Vec3 }>();
  /** When each hero's lightning (or a chain) was last redrawn. */
  const zapped = new Map<string, number>();
  const chains: { p: string; path: string[]; until: number; next: number }[] = [];
  /** Each blade's hum near by: its loop, and how fast its tip's been moving (smoothed). */
  const hums = new Map<string, { loop: ClientLoop; speed: number }>();
  /** Thrown sabers' whirling hum, by hero. */
  const whirls = new Map<string, ClientLoop>();
  const hush = (id: string) => {
    hums.get(id)?.loop.stop();
    hums.delete(id);
  };
  /** Flamethrowers and jetpacks burning (`f:<id>`, `j:<id>`): their loops, and (a jet's) how high it was a frame ago. */
  const burning = new Map<string, { loop: ClientLoop; y: number }>();
  /** Keep `key`'s loop (`voice`) going at `at` this frame; the frame stops the ones it didn't keep. */
  const kept = new Set<string>();
  const burn = (client: Client, key: string, voice: string, at: Vec3) => {
    kept.add(key);
    let b = burning.get(key);
    if (!b) burning.set(key, (b = { loop: client.audio.loop(voice, { at, volume: 0 }), y: at.y }));
    return b;
  };
  /** Rockets as drawn here: where, which way (eased toward the server's word). */
  const rocketsDrawn = new Map<number, { at: V3; dir: V3 }>();
  /** Rings spreading over the ground from a hero (a stance, a rage, an aura taking hold). */
  const spreads: { at: Vec3; born: number; r: number; beam: FxBeam }[] = [];
  /** Force waves rolling out (a push) or in (a pull): a ring of air, travelling. */
  const waves: { from: Vec3; dir: Vec3; born: number; len: number; out: boolean }[] = [];
  /** Thrown sabers' meshes, by hero. */
  const thrown = new Map<string, { node: Node; center: Vec3; spin: number }>();
  let tick = 0;

  return {
    name: 'blockfront.heroes.fx',
    frame(client, dt) {
      beams ??= new Beams(client);
      const B = beams;
      const now = scene.now;
      const fx = client.fx;
      tick++;
      // Where everyone is (their chest), by player id: figures, and ourselves.
      const chests = new Map<string, Vec3>();
      for (const f of client.figures.all) {
        if (!f.player) continue;
        const p = f.root.getWorldPosition(new V3());
        chests.set(f.player, { x: p.x, y: p.y + 1.25, z: p.z });
      }
      if (client.me.id && !chests.has(client.me.id)) chests.set(client.me.id, add(client.me.position, { x: 0, y: 1.25, z: 0 }));
      const figs = new Map(client.figures.all.filter((f) => f.player).map((f) => [f.player!, f]));
      /** Where a player's figure faces (level, unit), and how far it looks up or down. */
      const facing = (id: string): { fwd: V3; pitch: number } | null => {
        const f = figs.get(id);
        if (f) return { fwd: new V3(0, 0, 1).applyQuaternion(f.root.getWorldQuaternion(new Quat())).setY(0).normalize(), pitch: -f.state.headPitch };
        if (id === client.me.id) return { fwd: new V3(-Math.sin(client.me.look.yaw), 0, -Math.cos(client.me.look.yaw)), pitch: client.me.look.pitch };
        return null;
      };
      const cam = client.camera.position;
      const blade = (id: string) => {
        const b = scene.blades.get(id);
        return b && now - b.t < 0.2 ? b : null;
      };
      const heroOf = (id: string): HeroId | null => blade(id)?.hero ?? null;

      // ---- The blades: humming.
      for (const [id, b] of scene.blades) {
        if (b.t !== now) {
          if (now - b.t > 0.2) hush(id);
          if (now - b.t > 0.5) {
            scene.blades.delete(id);
            last.delete(id);
          }
          continue;
        }
        // (It glows, and its swings leave arcs, on its own: its look's `hold.blade`.)
        const was = last.get(id);
        const rage = scene.on(id, 'rage');
        // Its hum, near by: rising and swelling as the blade's swung (a swing's the hum swept past).
        const d = dist(cam, b.tip);
        let h = hums.get(id);
        if (!h && d < HUM_NEAR) hums.set(id, (h = { loop: client.audio.loop(humOf(b.hero, 0).voice, { at: mid(b), volume: 0 }), speed: 0 }));
        if (h && d > HUM_FAR) hush(id);
        else if (h) {
          const moved = was && dt > 0 ? dist(was.tip, b.tip) / dt : 0;
          h.speed += (Math.min(40, moved) - h.speed) * Math.min(1, dt * 14);
          const tone = humOf(b.hero, h.speed);
          h.loop.set({ at: mid(b), pitch: tone.pitch, volume: tone.volume });
        }
        last.set(id, { base: { ...b.base }, tip: { ...b.tip }, at: { ...b.at } });
        if (rage && tick % 3 === 0) fx.particles(lerp3(b.base, b.tip, Math.random()), lin('#ff3a1a'), { count: 1, speed: 0.6, size: 0.06, gravity: -3, glow: 2, life: 0.4, spread: 0.05, collide: false });
      }
      // (Blades gone all at once, a restart: their hums too.)
      for (const id of hums.keys()) if (!scene.blades.has(id)) hush(id);

      // ---- This frame's news.
      for (const n of scene.news) {
        switch (n.t) {
          case 'deflect': {
            const m = n.m;
            const b = blade(m.p);
            const at = b ? mid(b) : (chests.get(m.p) ?? null);
            if (!at) break;
            const def = client.item(m.w) as GunItem | undefined;
            const color = (def && typeof def.tracer === 'string' && def.tracer) || '#ff5a1f';
            fx.particles(at, [1, 0.92, 0.75], { count: 9, speed: 7, size: 0.028, gravity: 12, glow: 4, life: 0.22, spread: 0.04, collide: false });
            fx.particles(at, lin(color), { count: 4, speed: 5, size: 0.03, gravity: 10, glow: 4, life: 0.18, collide: false });
            fx.flare(at, 0.5);
            drawBolt(client, at, { x: m.to[0], y: m.to[1], z: m.to[2] }, color, m.w || undefined);
            break;
          }
          case 'clash': {
            const at = { x: n.m.at[0], y: n.m.at[1], z: n.m.at[2] };
            fx.particles(at, [1, 0.95, 0.75], { count: 26, speed: 8, size: 0.05, gravity: 12, glow: 3, life: 0.35, spread: 0.08, collide: false });
            fx.flare(at, 1.4);
            if (dist(cam, at) < 6) fx.shake(0.06, 0.18);
            break;
          }
          case 'cut': {
            const at = { x: n.m.at[0], y: n.m.at[1], z: n.m.at[2] };
            const hero = heroOf(n.m.p);
            const c = lin(hero ? HEROES[hero].blade : '#ffffff');
            fx.particles(at, c, { count: 12, speed: 4.5, size: 0.05, gravity: 6, glow: 2.5, life: 0.35, spread: 0.12, collide: false });
            fx.particles(at, [1, 0.6, 0.2], { count: 8, speed: 2.5, size: 0.04, gravity: -1, glow: 2, life: 0.6, spread: 0.2, collide: false });
            fx.particles(at, [0.12, 0.11, 0.1], { count: 4, speed: 0.6, size: 0.12, gravity: -1.5, life: 0.7, spread: 0.1, collide: false });
            break;
          }
          case 'guard':
            if (n.m.broke) {
              const b = blade(n.m.p);
              const at = b ? mid(b) : chests.get(n.m.p);
              if (at) {
                fx.particles(at, [1, 0.85, 0.5], { count: 30, speed: 7, size: 0.05, gravity: 10, glow: 3, life: 0.4, spread: 0.1, collide: false });
                fx.flare(at, 1.2);
              }
              if (n.m.p === client.me.id) fx.shake(0.12, 0.3);
            }
            break;
          case 'power':
            power(client, n.m);
            break;
          case 'burst':
            quarrelBurst(client, n.at);
            break;
          case 'swing':
          case 'zap':
            break;
        }
      }

      // ---- Chewblocca and Boba Fetch: what goes on while their powers do.
      kept.clear();
      for (const [id, until] of scene.lasting) {
        const who = chests.get(id);
        const face = facing(id);
        if (!who || !face) continue;
        // Enraged: embers of fury rising off him.
        if ((until.get('roar') ?? 0) > now && tick % 2 === 0) {
          const a = Math.random() * Math.PI * 2;
          fx.particles({ x: who.x + Math.cos(a) * 0.55, y: who.y - 1.1 + Math.random() * 0.6, z: who.z + Math.sin(a) * 0.55 }, lin('#ff9a2a'), { count: 1, speed: 0.4, size: 0.06, gravity: -3, glow: 2, life: 0.7, collide: false });
        }
        // The flamethrower: fire rolling out of his left wrist where he looks.
        if ((until.get('flame') ?? 0) > now) {
          const hand = scene.hands.get(id)?.l ?? who;
          const dir = new V3(face.fwd.x * Math.cos(face.pitch), Math.sin(face.pitch), face.fwd.z * Math.cos(face.pitch)).normalize();
          const from = add(hand, dir, 0.25);
          for (let i = 0; i < 5; i++) {
            const d = add(dir, { x: rnd(-0.18, 0.18), y: rnd(-0.1, 0.14), z: rnd(-0.18, 0.18) });
            const at = add(from, d, rnd(0, POWERS.flame.range * 0.7));
            const hot = Math.random();
            fx.particles(at, hot < 0.3 ? [1, 0.85, 0.4] : hot < 0.75 ? [1, 0.42, 0.08] : [0.85, 0.16, 0.03], { count: 1, speed: 1.5, size: rnd(0.08, 0.2), gravity: -3, glow: 2.5, life: rnd(0.12, 0.3), drag: 2, collide: false });
          }
          if (tick % 3 === 0) fx.particles(add(from, dir, POWERS.flame.range * 0.8), [0.12, 0.1, 0.09], { count: 1, speed: 0.6, size: 0.22, gravity: -1.5, life: 0.9, spread: 0.4, collide: false });
          fx.flare(from, 0.35);
          // Its roar, flickering, and the fuel spitting in it.
          burn(client, `f:${id}`, 'bfh_flame', from).loop.set({ at: from, volume: rnd(0.8, 1), pitch: rnd(0.93, 1.07) });
          if (Math.random() < dt * 7) client.audio.play('bfh_flame_crackle', { at: from, pitch: rnd(0.8, 1.3), volume: 0.8 });
        }
        // The jetpack: twin jets of fire from his back, driving down.
        if ((until.get('jetpack') ?? 0) > now) {
          const right = new V3(-face.fwd.z, 0, face.fwd.x);
          const mine = id === client.me.id;
          for (const side of [-1, 1]) {
            const nozzle = { x: who.x - face.fwd.x * 0.28 + right.x * 0.13 * side, y: who.y - 0.05, z: who.z - face.fwd.z * 0.28 + right.z * 0.13 * side };
            fx.particles(nozzle, [1, 0.8, 0.35], { count: 1, speed: 0.8, size: 0.1, gravity: 26, glow: 3, life: 0.14, collide: false });
            fx.particles({ x: nozzle.x, y: nozzle.y - 0.2, z: nozzle.z }, [1, 0.4, 0.08], { count: 1, speed: 1.2, size: 0.13, gravity: 22, glow: 2.2, life: 0.2, collide: false });
            // Smoke under him (thinner under your own: it'd cloud your view).
            if (tick % (mine ? 6 : 3) === 0) fx.particles({ x: nozzle.x, y: nozzle.y - 0.6, z: nozzle.z }, [0.55, 0.52, 0.5], { count: 1, speed: 0.8, size: mine ? 0.12 : 0.2, gravity: 2, life: mine ? 0.5 : 0.8, spread: 0.1, collide: false });
            fx.flare(nozzle, 0.3);
          }
          // Its roar: higher as he climbs, lower as he drops, flickering.
          const jet = burn(client, `j:${id}`, 'bfh_jet_burn', who);
          const climb = dt > 0 ? Math.max(-1, Math.min(1, (who.y - jet.y) / dt / 7)) : 0;
          jet.y = who.y;
          jet.loop.set({ at: who, volume: rnd(0.85, 1), pitch: 1 + 0.2 * climb + rnd(-0.03, 0.03) });
        }
      }
      // (Flames and jets out: their roars too.)
      for (const [key, b] of burning)
        if (!kept.has(key)) {
          b.loop.stop();
          burning.delete(key);
        }
      // A charge: dust thrown up at his heels.
      for (const [id, a] of scene.acts) {
        if (a.k !== 'charge' || now - a.at > a.t) continue;
        const c = chests.get(id);
        if (c) fx.particles({ x: c.x, y: c.y - 1.2, z: c.z }, [0.62, 0.55, 0.42], { count: 2, speed: 2, size: 0.16, gravity: -0.4, life: 0.6, spread: 0.3, collide: false });
      }
      // Rockets: drawn where the server has them, eased along between its words; smoke behind.
      for (const [n, r] of scene.rockets) {
        let d = rocketsDrawn.get(n);
        if (!d) rocketsDrawn.set(n, (d = { at: new V3(r.at.x, r.at.y, r.at.z), dir: new V3(r.dir.x, r.dir.y, r.dir.z) }));
        // On along its way, and eased toward where the server last said (and that moved on since).
        const since = now - r.heard;
        const there = new V3(r.at.x + r.dir.x * POWERS.rocket.speed * since, r.at.y + r.dir.y * POWERS.rocket.speed * since, r.at.z + r.dir.z * POWERS.rocket.speed * since);
        d.dir.lerp(new V3(r.dir.x, r.dir.y, r.dir.z), Math.min(1, dt * 12)).normalize();
        d.at.addScaledVector(d.dir, POWERS.rocket.speed * dt).lerp(there, Math.min(1, dt * 8));
        const tail = add(d.at, d.dir, -0.45);
        B.line('white', tail, d.at, 0.07, 0.03, now);
        B.line('red', add(d.at, d.dir, -0.9), d.at, 0.12, 0.05, now);
        fx.particles(tail, [1, 0.6, 0.15], { count: 1, speed: 0.5, size: 0.1, gravity: 0, glow: 3, life: 0.12, collide: false });
        fx.particles(tail, [0.6, 0.58, 0.55], { count: 1, speed: 0.3, size: 0.18, gravity: -0.6, life: 1.1, spread: 0.05, drag: 1, collide: false });
      }
      for (const n of [...rocketsDrawn.keys()]) if (!scene.rockets.has(n)) rocketsDrawn.delete(n);
      // Burning ground.
      scene.burns = scene.burns.filter((b) => b.until > now);
      for (const b of scene.burns) {
        if (Math.random() < 0.6) fx.particles({ x: b.at.x + rnd(-0.5, 0.5), y: b.at.y + 0.1, z: b.at.z + rnd(-0.5, 0.5) }, Math.random() < 0.5 ? [1, 0.55, 0.1] : [1, 0.3, 0.05], { count: 1, speed: 0.5, size: rnd(0.08, 0.16), gravity: -2.5, glow: 2.2, life: rnd(0.3, 0.6), collide: false });
        if (tick % 6 === 0) fx.particles({ x: b.at.x, y: b.at.y + 0.5, z: b.at.z }, [0.14, 0.12, 0.11], { count: 1, speed: 0.4, size: 0.25, gravity: -1.2, life: 1.2, spread: 0.3, collide: false });
      }

      // ---- Lasting powers.
      for (const [id, until] of scene.lasting) {
        const who = chests.get(id);
        if (!who) continue;
        if ((until.get('lightning') ?? 0) > now) lightning(client, id, who, now);
        if ((until.get('aura') ?? 0) > now) aura(client, id, who, now);
        if ((until.get('soresu') ?? 0) > now && tick % 2 === 0) {
          const a = Math.random() * Math.PI * 2;
          const h = Math.random() * 1.9;
          fx.particles({ x: who.x + Math.cos(a) * 0.75, y: who.y - 1.25 + h, z: who.z + Math.sin(a) * 0.75 }, lin('#9fd8ff'), { count: 1, speed: 0.3, size: 0.05, gravity: -1.2, glow: 2.5, life: 0.5, collide: false });
        }
        if ((until.get('rage') ?? 0) > now && tick % 2 === 0) {
          const a = Math.random() * Math.PI * 2;
          fx.particles({ x: who.x + Math.cos(a) * 0.5, y: who.y - 1.2 + Math.random() * 0.5, z: who.z + Math.sin(a) * 0.5 }, lin('#ff2a10'), { count: 1, speed: 0.5, size: 0.07, gravity: -3.5, glow: 2, life: 0.7, collide: false });
        }
      }
      // Choked: something gripping the throat, and the one choked (us?) feels it.
      for (const [id, v] of scene.victims) {
        if (v.kind !== 'choke' || now > v.until) continue;
        const c = chests.get(id);
        if (c && tick % 3 === 0) fx.particles({ x: c.x, y: c.y + 0.38, z: c.z }, [0.25, 0.02, 0.04], { count: 2, speed: 0.4, size: 0.05, gravity: 0, glow: 0.8, life: 0.35, spread: 0.12, collide: false });
        const hand = scene.hands.get(v.by);
        if (c && hand && tick % 2 === 0) {
          const t = Math.random();
          fx.particles(lerp3(hand.l, { x: c.x, y: c.y + 0.38, z: c.z }, t), [0.35, 0.05, 0.08], { count: 1, speed: 0.2, size: 0.035, gravity: 0, glow: 1.5, life: 0.2, collide: false });
        }
        if (id === client.me.id && tick % 20 === 0) {
          fx.shake(0.05, 0.3);
          fx.flash('#400010', 0.25, 0.3);
        }
      }
      // Chain lightning, leaping.
      for (let i = chains.length - 1; i >= 0; i--) {
        const c = chains[i];
        if (now > c.until) {
          chains.splice(i, 1);
          continue;
        }
        if (now < c.next) continue;
        c.next = now + 0.05;
        const hands = scene.hands.get(c.p);
        let from = hands ? hands.l : chests.get(c.p);
        for (const id of c.path) {
          const to = chests.get(id);
          if (!from || !to) break;
          bolt(client, from, to, 0.09, 0.07);
          fx.particles(to, lin('#c9b8ff'), { count: 4, speed: 3, size: 0.04, gravity: 2, glow: 3, life: 0.2, spread: 0.2, collide: false });
          from = to;
        }
      }
      // Sabers in flight.
      for (const [id, f] of scene.flights) {
        const hands = scene.hands.get(id);
        const fl = scene.flight(id, hands ? hands.r : null);
        let t = thrown.get(id);
        // (Saber Throw is Darth Voxel's.)
        const heroId: HeroId = 'vader';
        if (!fl) {
          if (t) {
            client.scene.remove(t.node);
            thrown.delete(id);
          }
          whirls.get(id)?.stop();
          whirls.delete(id);
          continue;
        }
        if (!t) {
          const made = client.scene.item(f.item || saberOf(heroId));
          if (!made) continue;
          client.scene.add(made.node);
          thrown.set(id, (t = { node: made.node, center: made.center, spin: Math.random() * 6 }));
        }
        // Spinning flat (tipped a little), about its middle, as it flies: the size it is in the hand.
        t.spin += dt * Math.PI * 2 * 3.2;
        const q = new Quat().setFromAxisAngle(new V3(0, 1, 0), t.spin).multiply(new Quat().setFromAxisAngle(new V3(1, 0, 0), 0.22));
        const size = HELD_SCALE;
        const c = new V3(t.center.x, t.center.y, t.center.z).multiplyScalar(size).applyQuaternion(q);
        t.node.quaternion.copy(q);
        t.node.scale.setScalar(size);
        t.node.position.set(fl.at.x - c.x, fl.at.y - c.y, fl.at.z - c.z);
        // (Its blade glows, and its spin leaves a disc of light that reads from far off, on its own:
        // its look's `hold.blade`.)
        // Its hum whirling: the blade sweeping toward us and away each turn.
        let whirl = whirls.get(id);
        if (!whirl) whirls.set(id, (whirl = client.audio.loop(humOf(heroId, 0).voice, { at: fl.at, volume: 0 })));
        const turn = Math.sin(t.spin);
        whirl.set({ at: fl.at, pitch: 1.12 + 0.2 * turn, volume: 0.12 + 0.05 * turn });
      }
      for (const [id, t] of thrown)
        if (!scene.flights.has(id)) {
          client.scene.remove(t.node);
          thrown.delete(id);
        }
      for (const [id, w] of whirls)
        if (!scene.flights.has(id)) {
          w.stop();
          whirls.delete(id);
        }
      // Force waves: a ring of disturbed air, growing as it rolls out (or shrinking as it's drawn in).
      for (let i = waves.length - 1; i >= 0; i--) {
        const w = waves[i];
        const age = (now - w.born) / 0.38;
        if (age >= 1) {
          waves.splice(i, 1);
          continue;
        }
        const k = w.out ? age : 1 - age;
        const at = add(w.from, w.dir, w.len * k);
        const r = 0.35 + 2.4 * k;
        ring(B, at, w.dir, r, 0.05 * (1 - age * 0.6), now);
        if (age < 0.6) ring(B, add(at, w.dir, -0.45), w.dir, r * 0.8, 0.03, now);
      }
      for (let i = spreads.length - 1; i >= 0; i--) {
        const g = spreads[i];
        const age = (now - g.born) / 0.5;
        if (age < 0) continue;
        if (age >= 1) {
          spreads.splice(i, 1);
          continue;
        }
        const k = 1 - (1 - age) * (1 - age);
        ring(B, g.at, { x: 0, y: 1, z: 0 }, 0.4 + g.r * k, 0.045 * (1 - age), now, g.beam, 0.04);
      }
      // A rush: a streak behind.
      for (const [id, a] of scene.acts) {
        if (a.k !== 'rush' || now - a.at > a.t) continue;
        const c = chests.get(id);
        const hero = heroOf(id) ?? 'luke';
        const was = last.get(`rush:${id}`);
        if (c && was) {
          B.line(BEAM[hero], was.tip, c, 0.14, 0.3, now);
          B.line('white', was.tip, c, 0.05, 0.22, now);
        }
        if (c) last.set(`rush:${id}`, { base: c, tip: c });
        if (c) fx.particles({ x: c.x, y: c.y - 1.2, z: c.z }, [0.62, 0.55, 0.42], { count: 2, speed: 1.5, size: 0.14, gravity: -0.5, life: 0.5, spread: 0.2, collide: false });
      }
    },
    late() {
      beams?.update(scene.now);
    },
    dispose() {
      beams?.clear();
      for (const id of [...hums.keys()]) hush(id);
      for (const w of whirls.values()) w.stop();
      whirls.clear();
      for (const b of burning.values()) b.loop.stop();
      burning.clear();
    },
  };

  /** A bowcaster quarrel bursting: a green-white flash, sparks and a ring of it over what it hit. */
  function quarrelBurst(client: Client, at: Vec3) {
    const fx = client.fx;
    fx.flare(at, 1.3);
    fx.particles(at, [0.7, 1, 0.6], { count: 14, speed: 6, size: 0.05, gravity: 8, glow: 3.5, life: 0.3, spread: 0.08, collide: false });
    fx.particles(at, lin('#5dff6a'), { count: 10, speed: 3.5, size: 0.08, gravity: 2, glow: 2.5, life: 0.35, spread: 0.15, collide: false });
    fx.particles(at, [0.3, 0.28, 0.26], { count: 5, speed: 1.2, size: 0.18, gravity: -1, life: 0.7, spread: 0.2, collide: false });
    spreads.push({ at, born: scene.now, r: 1.6, beam: 'green' });
    client.audio.play('bfh_quarrel', { at, pitch: 0.9 + Math.random() * 0.2 });
  }

  /** A bolt of lightning from `a` to `b`: a crackling core and its glow, and a fork now and then. */
  function bolt(client: Client, a: Vec3, b: Vec3, rough: number, life: number) {
    const B = beams!;
    const now = scene.now;
    const pts = jag(a, b, rough);
    for (let i = 1; i < pts.length; i++) {
      B.line('white', pts[i - 1], pts[i], 0.016, life, now);
      B.line('lightning', pts[i - 1], pts[i], 0.05, life, now);
    }
    // A fork or two off it.
    for (let f = 0; f < 2; f++) {
      if (pts.length < 5 || Math.random() > 0.65) continue;
      const from = pts[1 + Math.floor(Math.random() * (pts.length - 3))];
      const d = sub(b, a);
      const end = add(from, { x: d.x * 0.2 + rnd(-0.6, 0.6), y: d.y * 0.2 + rnd(-0.5, 0.6), z: d.z * 0.2 + rnd(-0.6, 0.6) });
      const fork = jag(from, end, 0.25);
      for (let i = 1; i < fork.length; i++) B.line('lightning', fork[i - 1], fork[i], 0.02, life, now);
    }
    void client;
  }

  /** Force Lightning: from both hands to everyone it strikes (or into the air ahead), crackling. */
  function lightning(client: Client, id: string, who: Vec3, now: number) {
    if (now < (zapped.get(id) ?? 0)) return;
    zapped.set(id, now + 0.045);
    const hands = scene.hands.get(id);
    const hits = scene.zaps.get(id) ?? [];
    const fig = client.figures.all.find((f) => f.player === id);
    const fwd = fig ? new V3(0, 0, 1).applyQuaternion(fig.root.getWorldQuaternion(new Quat())) : new V3(0, 0, -1);
    const from = [hands?.l ?? who, hands?.r ?? who];
    const targets: Vec3[] = [];
    for (const h of hits) {
      const f = client.figures.all.find((g) => g.player === h);
      const p = f ? f.root.getWorldPosition(new V3()) : h === client.me.id ? new V3(client.me.position.x, client.me.position.y, client.me.position.z) : null;
      if (p) targets.push({ x: p.x + rnd(-0.2, 0.2), y: p.y + rnd(0.7, 1.6), z: p.z + rnd(-0.2, 0.2) });
    }
    // Nobody in it: into the air ahead, spread.
    if (!targets.length) {
      const range = POWERS.lightning.range * rnd(0.45, 0.8);
      for (let i = 0; i < 2; i++) {
        const a = rnd(-0.45, 0.45);
        const cos = Math.cos(a);
        const sin = Math.sin(a);
        targets.push({ x: who.x + (fwd.x * cos - fwd.z * sin) * range, y: who.y + rnd(-0.8, 0.8), z: who.z + (fwd.z * cos + fwd.x * sin) * range });
      }
    }
    for (const [i, t] of targets.entries()) {
      bolt(client, from[i % 2], t, 0.1, 0.06);
      if (Math.random() < 0.5) bolt(client, from[(i + 1) % 2], t, 0.12, 0.05);
      client.fx.particles(t, lin('#d6ccff'), { count: 3, speed: 3, size: 0.04, gravity: 2, glow: 3, life: 0.18, spread: 0.2, collide: false });
    }
    for (const h of from) client.fx.flare(h, 0.35);
    if (Math.random() < 0.35) client.audio.play('bfh_crackle', { at: who, pitch: rnd(0.85, 1.2), volume: 0.8 });
  }

  /** The Dark Aura: shadows drawn in round him from everyone near. */
  function aura(client: Client, id: string, who: Vec3, now: number) {
    void now;
    const R = POWERS.aura.radius;
    const B = beams!;
    // A dark haze on the ground round him, rising.
    for (let i = 0; i < 2; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = rnd(0.6, R);
      const at = { x: who.x + Math.cos(a) * r, y: who.y - 1.2 + Math.random() * 0.2, z: who.z + Math.sin(a) * r };
      client.fx.particles(at, [0.08, 0.0, 0.13], { count: 1, speed: 0.15, size: 0.045, gravity: -1.4, glow: 0.5, life: 0.7, collide: false });
    }
    // Round him, a slow ring of dark sparks.
    const t = now * 2.2;
    for (let i = 0; i < 3; i++) {
      const a = t + (i / 3) * Math.PI * 2;
      client.fx.particles({ x: who.x + Math.cos(a) * 0.8, y: who.y - 0.4 + Math.sin(t * 1.7 + i) * 0.4, z: who.z + Math.sin(a) * 0.8 }, [0.35, 0.05, 0.7], { count: 1, speed: 0.05, size: 0.03, gravity: 0, glow: 2.5, life: 0.3, collide: false });
    }
    // Life drawn out of everyone near: a dark thread from them to him, now and then.
    for (const f of client.figures.all) {
      if (!f.player || f.player === id) continue;
      const p = f.root.getWorldPosition(new V3());
      if (Math.hypot(p.x - who.x, p.z - who.z) > R || Math.random() > 0.3) continue;
      const from = { x: p.x + rnd(-0.2, 0.2), y: p.y + rnd(0.8, 1.5), z: p.z + rnd(-0.2, 0.2) };
      const pts = jag(from, { x: who.x, y: who.y - 0.1, z: who.z }, 0.12);
      for (let i = 1; i < pts.length; i++) B.line('dark', pts[i - 1], pts[i], 0.018, 0.1, now);
      client.fx.particles(from, [0.4, 0.05, 0.6], { count: 2, speed: 0.6, size: 0.028, gravity: 0, glow: 2, life: 0.25, collide: false });
    }
  }

  /** A power's moment: its wave, its pull, its landing. */
  function power(client: Client, m: import('../wire').Power) {
    const fx = client.fx;
    const fig = client.figures.all.find((f) => f.player === m.p);
    const at = fig ? fig.root.getWorldPosition(new V3()) : m.p === client.me.id ? new V3(client.me.position.x, client.me.position.y, client.me.position.z) : null;
    const hands = scene.hands.get(m.p);
    switch (m.k) {
      case 'push':
      case 'pull': {
        if (!at) break;
        const dir = m.dir ? { x: m.dir[0], y: 0, z: m.dir[2] } : fig ? new V3(0, 0, 1).applyQuaternion(fig.root.getWorldQuaternion(new Quat())) : { x: 0, y: 0, z: -1 };
        const from = hands?.l ?? { x: at.x, y: at.y + 1.3, z: at.z };
        if (m.k === 'push') {
          // A wave of air rolling out ahead, and dust thrown up under it.
          waves.push({ from: add(from, dir, 0.3), dir, born: scene.now, len: POWERS.push.range * 0.8, out: true });
          for (let i = 0; i < 14; i++) {
            const a = rnd(-0.8, 0.8);
            const d = { x: dir.x * Math.cos(a) - dir.z * Math.sin(a), y: 0, z: dir.z * Math.cos(a) + dir.x * Math.sin(a) };
            fx.particles({ x: at.x + d.x * 1.2, y: at.y + 0.1, z: at.z + d.z * 1.2 }, [0.62, 0.55, 0.42], { count: 1, speed: rnd(5, 9), size: 0.07, gravity: 1, life: 0.5, drag: 2.5, collide: false });
          }
          spreads.push({ at: { x: at.x + dir.x * 0.8, y: at.y + 0.08, z: at.z + dir.z * 0.8 }, born: scene.now, r: 2.4, beam: 'white' });
          fx.flare(from, 0.9);
          for (const h of m.hits ?? []) {
            const f = client.figures.all.find((g) => g.player === h);
            const p = f?.root.getWorldPosition(new V3());
            if (p) fx.particles({ x: p.x, y: p.y + 0.2, z: p.z }, [0.62, 0.55, 0.42], { count: 8, speed: 2, size: 0.15, gravity: -0.3, life: 0.6, spread: 0.4, collide: false });
          }
          if (at && dist(client.camera.position, at) < 10) fx.shake(0.05, 0.2);
        } else {
          const target = m.target ? client.figures.all.find((g) => g.player === m.target)?.root.getWorldPosition(new V3()) : m.target === client.me.id ? new V3(client.me.position.x, client.me.position.y, client.me.position.z) : null;
          if (target) {
            const t = { x: target.x, y: target.y + 1.2, z: target.z };
            const span = sub(from, t);
            const l = len(span) || 1;
            waves.push({ from: t, dir: { x: span.x / l, y: span.y / l, z: span.z / l }, born: scene.now, len: l, out: false });
          }
          fx.flare(from, 0.7);
        }
        break;
      }
      case 'chain':
        chains.push({ p: m.p, path: m.path ?? [], until: scene.now + 0.4, next: 0 });
        break;
      case 'land': {
        const where = m.at ? { x: m.at[0], y: m.at[1], z: m.at[2] } : at;
        if (!where) break;
        const hero = scene.blades.get(m.p)?.hero ?? 'luke';
        spreads.push({ at: { x: where.x, y: where.y + 0.08, z: where.z }, born: scene.now, r: POWERS.leap.radius, beam: BEAM[hero] });
        spreads.push({ at: { x: where.x, y: where.y + 0.08, z: where.z }, born: scene.now + 0.08, r: POWERS.leap.radius * 0.7, beam: 'white' });
        fx.particles({ x: where.x, y: where.y + 0.2, z: where.z }, [0.62, 0.55, 0.42], { count: 30, speed: 5, size: 0.16, gravity: 2, life: 0.8, spread: 0.6, up: 1, collide: false });
        fx.flare({ x: where.x, y: where.y + 0.5, z: where.z }, 2);
        if (dist(client.camera.position, where) < 12) fx.shake(0.15, 0.35);
        break;
      }
      case 'leap':
        if (at) fx.particles({ x: at.x, y: at.y + 0.1, z: at.z }, [0.62, 0.55, 0.42], { count: 14, speed: 3, size: 0.14, gravity: 1, life: 0.6, spread: 0.4, collide: false });
        break;
      case 'scatter': {
        // Five quarrels from his bowcaster, fanned (they burst where they land: the `burst` news).
        const from = hands?.r ? add(hands.r, { x: 0, y: 0.12, z: 0 }) : at ? { x: at.x, y: at.y + 1.3, z: at.z } : null;
        if (!from) break;
        for (const e of m.path ?? []) {
          const [x, y, z] = e.split(',').map(Number);
          drawBolt(client, from, { x, y, z }, '#5dff6a', 'hero_bowcaster');
        }
        fx.flare(from, 1);
        break;
      }
      case 'knock': {
        const f = m.target ? client.figures.all.find((g) => g.player === m.target) : null;
        const p = f?.root.getWorldPosition(new V3());
        if (p) fx.particles({ x: p.x, y: p.y + 0.2, z: p.z }, [0.62, 0.55, 0.42], { count: 14, speed: 3, size: 0.16, gravity: 1, life: 0.7, spread: 0.4, up: 0.8, collide: false });
        break;
      }
      case 'roar': {
        if (!at || m.on === false) break;
        // The roar rolling out: rings from his head, and one over the ground as wide as it reaches.
        const face = fig ? new V3(0, 0, 1).applyQuaternion(fig.root.getWorldQuaternion(new Quat())).setY(0).normalize() : new V3(0, 0, -1);
        const head = { x: at.x + face.x * 0.3, y: at.y + 1.75, z: at.z + face.z * 0.3 };
        waves.push({ from: head, dir: { x: face.x, y: 0, z: face.z }, born: scene.now, len: POWERS.roar.radius, out: true });
        waves.push({ from: head, dir: { x: face.x, y: 0, z: face.z }, born: scene.now + 0.12, len: POWERS.roar.radius * 0.8, out: true });
        spreads.push({ at: { x: at.x, y: at.y + 0.08, z: at.z }, born: scene.now, r: POWERS.roar.radius, beam: 'white' });
        if (dist(client.camera.position, at) < 9) fx.shake(0.1, 0.4);
        break;
      }
      case 'aura':
      case 'rage':
      case 'soresu':
        if (at && m.on !== false) spreads.push({ at: { x: at.x, y: at.y + 0.08, z: at.z }, born: scene.now, r: m.k === 'aura' ? POWERS.aura.radius : 2.2, beam: m.k === 'aura' ? 'dark' : m.k === 'rage' ? 'red' : 'blue' });
        break;
    }
  }
}
