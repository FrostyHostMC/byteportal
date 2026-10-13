import type { Vec3 } from '@platform';
import { isGun, type GunItem } from '@platform/items';
import type { Client, ClientEvent, ClientKit } from '@platform/client';
import type { ClientBullet } from '../items/gun';

/** A shot's bullets (the `bullets` event). */
type Bullets = Extract<ClientEvent, { t: 'bullets' }>;

/** A tracer's colour when the gun doesn't say (`GunItem.tracer`). */
const TRACER = '#ffd27a';
/** Someone's shot that lands this close to our eye isn't shown landing (we'd see the puff from inside our own body). */
const OWN_BODY = 2.2;

/**
 * Gunfire in the world, from the `bullets` events (someone else's in `frame`; ours in `late`, once
 * the hand is placed): tracers (every bullet of a single shot, every
 * third of a shotgun's) from the muzzle to where each bullet landed, chips and a hole where it hit
 * a block (the pit is the mark where it carved), a puff of blood on someone, holes both sides of a
 * wall it went through with chips out of the far side, and someone else's muzzle flaring. And the
 * gun's sounds on this screen: the shot, the reload, the click of an empty gun (the item's own
 * `sounds`, else the standard voices).
 */
export function gunfire(): ClientKit {
  return {
    name: 'effects.gunfire',
    frame(client) {
      // Someone else's shots (they happened before this frame: they move on with it), and the gun's sounds.
      for (const e of client.events) {
        if (e.t === 'bullets' && !e.mine) shot(client, e);
        else if (e.t === 'reload') client.audio.play(gunOf(client, e.item)?.sounds?.reload ?? 'gun_reload', { volume: 0.8 });
        else if (e.t === 'empty') client.audio.play(gunOf(client, e.item)?.sounds?.empty ?? 'gun_empty', { volume: 0.8 });
      }
    },
    late(client) {
      // Ours, fired this frame: from the muzzle as the hand's drawn.
      for (const e of client.events) if (e.t === 'bullets' && e.mine) shot(client, e);
    },
  };
}

const gunOf = (client: Client, item: string): GunItem | null => {
  const def = client.item(item);
  return isGun(def) ? def : null;
};

function shot(client: Client, e: Bullets) {
  const def = gunOf(client, e.item);
  const tracer = def && def.tracer !== false ? (def.tracer ?? TRACER) : null;
  const fx = client.fx;
  if (e.mine) {
    // Ours: heard at once, the tracers leaving the muzzle as the hand's drawn this frame.
    client.audio.play(def?.sounds?.use ?? 'gunshot', { volume: 0.9, pitch: 0.97 + Math.random() * 0.06 });
    const from = client.view.worldPoint('muzzle') ?? client.camera.position;
    e.bullets.forEach((b, i) => {
      const traced = tracer !== null && (i === 0 || i % 3 === 0);
      if (traced) fx.tracer(from, b.end, tracer);
      // Through a wall: a hole going in, and out the far side (chips flying, a tracer on from there).
      for (const w of b.walls) wallBang(client, w, traced ? b.end : null, def);
      if (b.hit === 'block') fx.impact(b.end, b.normal, b.color!, false, !b.carved);
    });
    return;
  }
  // Someone else's: a flash at their gun's muzzle, tracers from it.
  const from = e.from!;
  fx.flare(from, 0.55);
  const cam = client.camera.position;
  e.bullets.forEach((b, i) => {
    const traced = !!tracer && (i === 0 || i % 3 === 0);
    if (traced) fx.tracer(from, b.end, tracer);
    for (const w of b.walls) wallBang(client, w, traced ? b.end : null, def);
    // Not on our own body (we'd see the puff from inside it): the HUD says we were hit.
    if (Math.hypot(b.end.x - cam.x, b.end.y - cam.y, b.end.z - cam.z) < OWN_BODY) return;
    if (b.hit === 'block') fx.impact(b.end, b.normal, b.color!, false, !b.carved);
    else if (b.hit === 'body') fx.impact(b.end, null, [0.75, 0.05, 0.08], true);
  });
}

/** A bullet through a wall: the hole where it went in and where it came out, chips out of the far side, and its tracer on from there to `end`. */
function wallBang(client: Client, w: ClientBullet['walls'][number], end: Vec3 | null, def: GunItem | null) {
  const fx = client.fx;
  fx.impact(w.entry, w.normal, w.color, false, !w.carvedIn);
  fx.impact(w.exit, w.out, w.color, false, !w.carvedOut);
  fx.particles({ x: w.exit.x + w.out.x * 0.05, y: w.exit.y + w.out.y * 0.05, z: w.exit.z + w.out.z * 0.05 }, w.color, { count: 8, speed: 4, size: 0.07, gravity: 18, life: 0.6, spread: 0.15, up: 0.6 });
  if (end) fx.tracer(w.exit, end, def?.tracer || TRACER);
}
