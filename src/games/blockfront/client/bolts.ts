import type { Vec3 } from '@platform';
import { isGun, type GunItem } from '@platform/items';
import type { Client, ClientEvent, ClientKit } from '@platform/client';
import type { items } from '@platform/client/kits';

type ClientBullet = items.ClientBullet;

/** A shot's bullets (the `bullets` event). */
type Bullets = Extract<ClientEvent, { t: 'bullets' }>;

/** How a blaster's bolt flies: blocks a second, its length and width (blocks). */
interface BoltStyle {
  speed: number;
  length: number;
  width: number;
}

/** Each kind of blaster's bolt (by the end of its id: `rebel_rifle`, `imp_sniper`). */
const STYLES: Record<string, BoltStyle> = {
  rifle: { speed: 150, length: 2.2, width: 0.2 },
  heavy: { speed: 135, length: 1.6, width: 0.17 },
  sniper: { speed: 230, length: 3.8, width: 0.24 },
  pistol: { speed: 140, length: 1.7, width: 0.21 },
};
const STYLE = STYLES.rifle;
const styleOf = (item: string) => STYLES[item.slice(item.lastIndexOf('_') + 1)] ?? STYLE;

/** A bolt's colour when its blaster doesn't say (`tracer`). */
const BOLT = '#ff3b2e';
/** Someone's bolt that lands this close to our eye isn't shown landing (in first person we'd see it from inside our own body). */
const OWN_BODY = 2.2;
/** A bolt passing this close to our head (and not into us) whizzes by. */
const NEAR_MISS = 2.6;
/** Bolts landing further off than this show only their sparks and scorch (a big fight stays cheap). */
const FAR = 45;

/** A CSS hex colour as linear RGB, times `k` (over 1 glows). */
function linear(hex: string, k = 1): [number, number, number] {
  const n = parseInt(hex.replace('#', '').slice(0, 6), 16);
  const c = (v: number) => {
    const s = v / 255;
    return (s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)) * k;
  };
  return [c((n >> 16) & 255), c((n >> 8) & 255), c(n & 255)];
}

/** A colour mixed toward white by `t` (0..1): a bolt's hot core. */
function whiter(hex: string, t: number): string {
  const n = parseInt(hex.replace('#', '').slice(0, 6), 16);
  const m = (v: number) => Math.round(v + (255 - v) * t);
  return `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => m(v).toString(16).padStart(2, '0')).join('')}`;
}

const dist = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const along = (a: Vec3, b: Vec3, t: number): Vec3 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });

/**
 * Blaster fire in the world, from the `bullets` events (someone else's in `frame`; ours in `late`,
 * once the hand and figures are placed): each shot a bolt you can watch fly (short, thick, a hot
 * core in its side's colour: the blaster's `tracer`), leaving the right muzzle (ours: over the
 * shoulder, our own figure's blaster; through the eyes, the hand's; someone else's: their figure's),
 * and landing when it gets there: on a block a burst of sparks, a scorch and a curl of smoke (the
 * blaster carves the pit), on someone sparks and a burn (no blood). A flash at the muzzle, a zap
 * where a bolt lands, a whizz as one goes by our head; and the blaster's own sounds (the shot,
 * venting, overheating).
 */
export function bolts(): ClientKit {
  /** Landings still on their way (bolts in flight): at `time` on the client's clock. */
  let pending: { time: number; run: () => void }[] = [];
  const later = (client: Client, delay: number, run: () => void) => {
    if (delay <= 0.004) run();
    else pending.push({ time: client.time + delay, run });
  };

  function shot(client: Client, e: Bullets) {
    const def = gunOf(client, e.item);
    const color = def && def.tracer !== false ? (def.tracer ?? BOLT) : BOLT;
    const style = styleOf(e.item);
    const fx = client.fx;
    let from: Vec3;
    if (e.mine) {
      // Ours: heard at once, the bolt leaving the muzzle as it's drawn this frame.
      client.audio.play(def?.sounds?.use ?? 'gunshot', { volume: 0.9, pitch: 0.97 + Math.random() * 0.06 });
      const figure = client.me.thirdPerson && !client.replay.playing ? ownMuzzle(client) : null;
      from = figure ?? client.view.worldPoint('muzzle') ?? client.camera.position;
      // Over the shoulder the flash is ours to show (through the eyes, the hand's own flash is).
      if (figure) muzzleFlash(client, from, color, 1);
    } else {
      from = e.from!;
      muzzleFlash(client, from, color, 0.9);
    }
    const cam = client.camera.position;
    const head = client.me.dead ? null : { x: client.me.position.x, y: client.me.position.y + 1.5, z: client.me.position.z };
    for (const b of e.bullets) {
      bolt(client, from, b.end, color, style);
      // Through a wall (the cycler): the holes going in and coming out, as the bolt gets there.
      for (const w of b.walls) {
        later(client, dist(from, w.entry) / style.speed, () => land(client, w.entry, w.normal, w.color, color, false));
        later(client, dist(from, w.exit) / style.speed, () => {
          land(client, w.exit, w.out, w.color, color, false);
          fx.particles({ x: w.exit.x + w.out.x * 0.05, y: w.exit.y + w.out.y * 0.05, z: w.exit.z + w.out.z * 0.05 }, w.color, { count: 8, speed: 4, size: 0.07, gravity: 18, life: 0.6, spread: 0.15, up: 0.6 });
        });
      }
      const flight = dist(from, b.end) / style.speed;
      // Someone else's: not on our own body seen from inside it (the HUD says we were hit).
      const onMe = !e.mine && dist(b.end, cam) < OWN_BODY;
      if (!onMe) later(client, flight, () => landBullet(client, b, color));
      // Past our head: a whizz as it goes by.
      if (!e.mine && head && !onMe) nearMiss(client, from, b.end, head, style, later);
    }
  }

  return {
    name: 'blockfront.bolts',
    frame(client) {
      // Someone else's shots (they happened before this frame: they move on with it), and the blaster's sounds.
      for (const e of client.events) {
        if (e.t === 'bullets' && !e.mine) shot(client, e);
        else if (e.t === 'reload') client.audio.play(gunOf(client, e.item)?.sounds?.reload ?? 'gun_reload', { volume: 0.8 });
        else if (e.t === 'empty') client.audio.play(gunOf(client, e.item)?.sounds?.empty ?? 'gun_empty', { volume: 0.8 });
        else if (e.t === 'reset') pending = [];
      }
      // Bolts arriving.
      if (pending.length) {
        const now = client.time;
        const due = pending.filter((p) => p.time <= now);
        if (due.length) {
          pending = pending.filter((p) => p.time > now);
          for (const p of due) p.run();
        }
      }
    },
    late(client) {
      // Ours, fired this frame: from the muzzle as it's drawn.
      for (const e of client.events) if (e.t === 'bullets' && e.mine) shot(client, e);
    },
    dispose() {
      pending = [];
    },
  };
}

const gunOf = (client: Client, item: string): GunItem | null => {
  const def = client.item(item);
  return isGun(def) ? def : null;
};

/** Our own figure's blaster's muzzle as it's drawn (over the shoulder), or null. */
function ownMuzzle(client: Client): Vec3 | null {
  const me = client.me.id;
  const figure = client.figures.all.find((f) => f.player === me);
  const held = figure?.held;
  if (!held) return null;
  const tip = held.points.muzzle?.clone() ?? held.bounds.getCenter(held.bounds.min.clone()).setZ(held.bounds.max.z);
  held.node.updateWorldMatrix(true, false);
  const p = tip.applyMatrix4(held.node.matrixWorld);
  return { x: p.x, y: p.y, z: p.z };
}

/**
 * A blaster bolt flying from `from` to `to` in `color`, as the kit draws them, for other client
 * code (a saber sending one back): `item` picks its kind by its id's end (`rifle`, `heavy`,
 * `sniper`, `pistol`).
 */
export function drawBolt(client: Client, from: Vec3, to: Vec3, color: string, item = 'rifle') {
  bolt(client, from, to, color, styleOf(item));
}

/** A bolt: a wide glow deep in its colour round a thin white-hot core, flying together. */
function bolt(client: Client, from: Vec3, to: Vec3, color: string, style: BoltStyle) {
  client.fx.tracer(from, to, color, { speed: style.speed, length: style.length, width: style.width, glow: 2.4 });
  client.fx.tracer(from, to, whiter(color, 0.8), { speed: style.speed, length: style.length * 0.9, width: style.width * 0.32, glow: 7 });
}

/** A blaster's flash: a hot glow at the muzzle and a spit of its colour. */
function muzzleFlash(client: Client, at: Vec3, color: string, size: number) {
  client.fx.flare(at, 0.5 * size);
  client.fx.particles(at, linear(color, 1.2), { count: 4, speed: 2.2, size: 0.07 * size, glow: 3, gravity: 0, life: 0.08, drag: 6, spread: 0.06, up: 0, collide: false });
}

/** Where a bolt landed: on a block, on someone, or nowhere (it flew out of range). */
function landBullet(client: Client, b: ClientBullet, color: string) {
  if (b.hit === 'block') land(client, b.end, b.normal, b.color!, color, true);
  else if (b.hit === 'body' && !withSaber(client, b.end)) burn(client, b.end, color);
}

/**
 * Whether the one a bolt landed on holds a saber: a hero shows their own sparks where they catch
 * it (the heroes' deflection), and no burn on the chest under them.
 */
function withSaber(client: Client, at: Vec3): boolean {
  for (const f of client.figures.all) {
    if (!f.held?.item.startsWith('saber_')) continue;
    const r = f.root.position;
    if (Math.hypot(at.x - r.x, at.z - r.z) < 1.3 && at.y > r.y - 0.3 && at.y < r.y + 2.6) return true;
  }
  return false;
}

/** A bolt on a block: sparks of its colour and white-hot ones, a scorch, chips, a curl of smoke, a zap. */
function land(client: Client, at: Vec3, normal: Vec3 | null, block: [number, number, number], color: string, sound: boolean) {
  const fx = client.fx;
  const n = normal ?? { x: 0, y: 1, z: 0 };
  const p = { x: at.x + n.x * 0.06, y: at.y + n.y * 0.06, z: at.z + n.z * 0.06 };
  if (sound) client.audio.play('bolt_hit', { at, volume: 0.8, pitch: 0.9 + Math.random() * 0.2 });
  // The chips, a spark, a puff and the scorched spot (the pit the blaster carves is under it).
  fx.impact(at, normal, block, false, true);
  fx.flare(p, 0.7);
  fx.particles(p, linear(color, 1.4), { count: 9, speed: 5.5, size: 0.045, glow: 2.6, gravity: 14, life: 0.32, drag: 1.5, spread: 0.08, up: 1.2, collide: false });
  if (dist(at, client.camera.position) > FAR) return;
  fx.particles(p, [1, 0.86, 0.6], { count: 5, speed: 7, size: 0.028, glow: 3, gravity: 18, life: 0.22, spread: 0.05, up: 1, collide: true });
  // Embers glowing in the scorch a moment.
  fx.particles({ x: at.x + n.x * 0.02, y: at.y + n.y * 0.02, z: at.z + n.z * 0.02 }, linear(color, 0.9), { count: 3, speed: 0.08, size: 0.05, glow: 1.4, gravity: 0, life: 0.45, spread: 0.07, up: 0, collide: false });
  // A curl of smoke.
  fx.particles(p, [0.16, 0.15, 0.14], { count: 3, speed: 0.5, size: 0.13, gravity: -1.4, life: 1.1, drag: 2.2, spread: 0.1, up: 0.5, collide: false });
}

/** A bolt on someone: sparks and a burn, no blood. */
function burn(client: Client, at: Vec3, color: string) {
  const fx = client.fx;
  fx.flare(at, 0.55);
  fx.particles(at, linear(color, 1.3), { count: 10, speed: 4.5, size: 0.05, glow: 2.4, gravity: 10, life: 0.3, drag: 1.5, spread: 0.12, up: 0.8, collide: false });
  fx.particles(at, [1, 0.9, 0.7], { count: 4, speed: 6, size: 0.03, glow: 3, gravity: 14, life: 0.2, spread: 0.08, up: 0.6, collide: false });
  fx.particles(at, [0.1, 0.09, 0.08], { count: 3, speed: 0.7, size: 0.07, gravity: -1.6, life: 0.5, drag: 2.5, spread: 0.12, up: 0.4, collide: false });
  client.audio.play('bolt_burn', { at, volume: 0.75, pitch: 0.9 + Math.random() * 0.2 });
}

/** Someone else's bolt passing our head: a whizz from where it goes by, as it does. */
function nearMiss(client: Client, from: Vec3, to: Vec3, head: Vec3, style: BoltStyle, later: (client: Client, delay: number, run: () => void) => void) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const len2 = dx * dx + dy * dy + dz * dz;
  if (len2 < 1) return;
  const t = Math.max(0, Math.min(1, ((head.x - from.x) * dx + (head.y - from.y) * dy + (head.z - from.z) * dz) / len2));
  // It ends at us (a hit) or before it reaches us: no whizz.
  if (t >= 0.999 || t <= 0.001) return;
  const by = along(from, to, t);
  const d = dist(by, head);
  if (d > NEAR_MISS) return;
  later(client, (Math.sqrt(len2) * t) / style.speed, () => client.audio.play('bolt_whizz', { at: by, volume: 1.1 - d * 0.25, pitch: 0.9 + Math.random() * 0.25 }));
}
