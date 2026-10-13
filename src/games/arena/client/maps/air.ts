import type { Vec3 } from '@platform';
import type { Client, ClientKit, ClientLoop } from '@platform/client';
import { FLOOR, MAPS, mapNear, type ArenaMap, type Fire } from '../../maps';

/**
 * Each map's air on this screen (nothing's sent for it), round the camera:
 *
 * - **The Colosseum**: dust drifting gold in the sunlight, sand blown low over the floor in a gust.
 * - **The Necropolis**: mist creeping along the ground, soul-lights wandering up out of the graves.
 * - **The Forge**: embers rising off the lava, ash coming down.
 * - **The Sanctum**: snow falling, driven sideways in a gust, and an aurora rippling overhead.
 *
 * And on every map its fires burning (braziers, torches' flames, soul fires: `ArenaMap.fires`),
 * crackling where they're near; its wind (a loop of its own, rising and falling with the gusts);
 * and now and then something heard far off (a hawk, a crow, a hammer). Which map it is: the one
 * the camera's over. It keeps to a budget out of the platform's particles, and starts nothing
 * right in front of the camera.
 */

/** Linear RGB for a CSS hex colour. */
function linear(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return [c((n >> 16) & 255), c((n >> 8) & 255), c(n & 255)];
}
const palette = (hexes: string[]) => hexes.map(linear);

const FLAMES = {
  fire: palette(['#ffe19a', '#ffb347', '#ff8a1e', '#ff5e14']),
  soul: palette(['#d6ffe4', '#86ffba', '#3fe08a', '#22a866']),
  frost: palette(['#f0fcff', '#a8eaff', '#5ac8f0', '#3a8fd8']),
};
const SMOKE = linear('#3d3833');
const EMBER = palette(['#ffb347', '#ff8a1e', '#ffd27a']);
const MOTE = palette(['#fff0c8', '#ffe2a0', '#f6d9a8']);
const SAND = palette(['#efe0b6', '#e6d29f', '#f5e9c8']);
const MIST = palette(['#8f9c97', '#a3aea9', '#7f8c88', '#b0b9b4']);
const WISP = palette(['#9dffc4', '#c6ffe0', '#6cf0a6']);
const ASH = palette(['#6f6862', '#5a5450', '#827a73']);
const SNOW = linear('#f4f8ff');
const AURORA = palette(['#5dffb0', '#3af0c8', '#4ad8ff', '#8f7bff', '#c06bff']);

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)];

/** How far round the camera the air is drawn (blocks), how near it may start, and the cone kept clear ahead. */
const REACH = 24;
const NEAR = 3.5;
const CLEAR_AHEAD = 7;
/** Fires further than this aren't drawn. */
const FIRE_REACH = 46;

export function air(): ClientKit {
  let current: ArenaMap | null = null;
  let wind: ClientLoop | null = null;
  let crackle: ClientLoop | null = null;
  let gust = 0;
  let gustAt = 5;
  let gustEnd = 0;
  let callAt = 8;
  /** Particles owed, by what they are (fractions carry over frames). */
  const owed = { a: 0, b: 0, c: 0, aurora: 0 };
  const fireOwed = new Map<Fire, number>();

  const hush = () => {
    wind?.stop();
    wind = null;
    crackle?.stop();
    crackle = null;
  };

  /** A random point round the camera, most of them in the half it looks into, never just in front of it. */
  function around(cam: Vec3, fwd: Vec3, lo: number, hi: number, reach = REACH): Vec3 | null {
    const look = Math.atan2(fwd.z, fwd.x);
    const a = Math.random() < 0.75 ? look + (Math.random() - 0.5) * 2.6 : Math.random() * Math.PI * 2;
    const r = NEAR + Math.sqrt(Math.random()) * (reach - NEAR);
    const p = { x: cam.x + Math.cos(a) * r, y: cam.y + rand(lo, hi), z: cam.z + Math.sin(a) * r };
    const dx = p.x - cam.x;
    const dy = p.y - cam.y;
    const dz = p.z - cam.z;
    const d = Math.hypot(dx, dy, dz);
    if (d < CLEAR_AHEAD && (dx * fwd.x + dy * fwd.y + dz * fwd.z) / d > 0.6) return null;
    return p;
  }

  const open = (client: Client, p: Vec3) => client.world.blockAt(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)) === 'air';

  return {
    name: 'arena.air',
    frame(client, dt) {
      if (dt <= 0) return;
      const cam = client.camera.position;
      const map = mapNear(MAPS, cam);
      if (map !== current) {
        hush();
        current = map;
      }
      if (!client.running || !map) return hush();
      const t = client.time;
      const a = map.air;

      // The wind: a gust every so often, up in a second, easing off after.
      if (t >= gustAt) {
        gustEnd = t + rand(2, 4.5);
        gustAt = gustEnd + rand(6, 14);
      }
      gust += ((t < gustEnd ? 1 : 0) - gust) * Math.min(1, dt * (t < gustEnd ? 1.5 : 0.6));
      const heading = a.heading + 0.25 * Math.sin(t * 0.07);
      const speed = a.wind + (a.gust - a.wind) * gust;
      const w = { x: Math.cos(heading) * speed, y: 0, z: Math.sin(heading) * speed };
      wind ??= client.audio.loop(a.loop, { volume: 0 });
      wind.set({ volume: 0.05 + gust * 0.12, pitch: 0.85 + gust * 0.3 });

      // Something far off, now and then.
      if (t >= callAt) {
        callAt = t + rand(7, 18);
        const ang = Math.random() * Math.PI * 2;
        const d = rand(35, 60);
        client.audio.play(pick(a.calls), { at: { x: cam.x + Math.cos(ang) * d, y: cam.y + rand(6, 20), z: cam.z + Math.sin(ang) * d }, volume: 1.6, pitch: rand(0.92, 1.08) });
      }

      if (client.replay.playing) return;
      const ahead = client.camera.toWorld({ x: 0, y: 0, z: -1 });
      const fwd = { x: ahead.x - cam.x, y: ahead.y - cam.y, z: ahead.z - cam.z };
      const thin = 1 / Math.max(1, client.camera.zoom) ** 2;
      const ground = FLOOR + 1;

      switch (a.kind) {
        case 'dust': {
          // Motes hanging in the sunlight; in a gust, sand streaming low over the floor.
          owed.a += dt * 22 * thin;
          while (owed.a >= 1) {
            owed.a -= 1;
            const p = around(cam, fwd, -2, 6);
            if (!p || !open(client, p)) continue;
            client.fx.particles(p, pick(MOTE), { count: 1, speed: 0.08, size: rand(0.025, 0.045), gravity: -0.02, glow: 0.5, life: rand(3, 5), spread: 0, up: 0.05, velocity: { x: w.x * 0.25, y: 0.05, z: w.z * 0.25 }, collide: false });
          }
          owed.b += dt * gust * 140 * thin;
          while (owed.b >= 1) {
            owed.b -= 1;
            const p = around(cam, fwd, 0, 0, 20);
            if (!p) continue;
            p.y = ground + rand(0.05, 0.7);
            if (!open(client, p)) continue;
            const k = rand(0.9, 1.3);
            client.fx.particles(p, pick(SAND), { count: 1, speed: 0.3, size: rand(0.03, 0.06), gravity: 0, glow: 0.05, life: rand(1.2, 2), spread: 0, up: rand(0, 0.3), velocity: { x: w.x * k, y: 0, z: w.z * k }, collide: false });
          }
          break;
        }
        case 'mist': {
          // Mist creeping low over the ground: a haze of fine motes drifting on the wind, thickest
          // at the foot; soul-lights rising slowly, wandering.
          owed.a += dt * 130 * thin;
          while (owed.a >= 1) {
            owed.a -= 1;
            const p = around(cam, fwd, 0, 0, 22);
            if (!p) continue;
            p.y = ground + Math.pow(Math.random(), 2) * 1.1;
            if (!open(client, p)) continue;
            client.fx.particles(p, pick(MIST), { count: 1, speed: 0.06, size: rand(0.045, 0.085), gravity: 0, glow: 0.12, life: rand(4, 6.5), spread: 0, up: 0, drag: 0.2, velocity: { x: w.x * 0.3, y: rand(-0.02, 0.05), z: w.z * 0.3 }, collide: false });
          }
          owed.b += dt * 5 * thin;
          while (owed.b >= 1) {
            owed.b -= 1;
            const p = around(cam, fwd, -1, 2, 20);
            if (!p || !open(client, p)) continue;
            client.fx.particles(p, pick(WISP), { count: 1, speed: 0.35, size: rand(0.05, 0.08), gravity: -0.15, glow: 1, life: rand(2.5, 4), spread: 0, up: 0.2, drag: 0.6, velocity: { x: w.x * 0.2, y: 0.25, z: w.z * 0.2 }, collide: false });
          }
          break;
        }
        case 'embers': {
          // Embers going up on the heat, ash coming down.
          owed.a += dt * 36 * thin;
          while (owed.a >= 1) {
            owed.a -= 1;
            const p = around(cam, fwd, -2, 2);
            if (!p || !open(client, p)) continue;
            client.fx.particles(p, pick(EMBER), { count: 1, speed: 0.4, size: rand(0.03, 0.06), gravity: -0.5, glow: 1, life: rand(1.8, 3.2), spread: 0, up: 0.5, drag: 0.3, velocity: { x: w.x * 0.3, y: rand(0.8, 1.8), z: w.z * 0.3 }, collide: false });
          }
          owed.b += dt * 26 * thin;
          while (owed.b >= 1) {
            owed.b -= 1;
            const p = around(cam, fwd, 5, 12);
            if (!p || !open(client, p)) continue;
            client.fx.particles(p, pick(ASH), { count: 1, speed: 0.2, size: rand(0.035, 0.06), gravity: 0.15, glow: 0, life: rand(4, 6), spread: 0, up: 0, drag: 0.3, velocity: { x: w.x * 0.5, y: -0.6, z: w.z * 0.5 }, collide: true });
          }
          break;
        }
        case 'snow': {
          owed.a += dt * 220 * (0.8 + 0.4 * gust) * thin;
          const fall = 1.1 + gust * 0.5;
          while (owed.a >= 1) {
            owed.a -= 1;
            const p = around(cam, fwd, -3, 12);
            if (!p || !open(client, p)) continue;
            client.fx.particles(p, SNOW, { count: 1, speed: 0.25, size: rand(0.04, 0.07), gravity: 0.35, life: rand(3.2, 5), spread: 0, up: 0, velocity: { x: w.x * rand(0.8, 1.2), y: -fall, z: w.z * rand(0.8, 1.2) }, collide: true });
          }
          break;
        }
      }
      if (a.aurora) aurora(client, map, dt);
      fires(client, map, dt, w);
    },
    dispose: hush,
  };

  /**
   * The aurora: three curtains of light high over the map, each a ribbon folding along a
   * wandering line across the sky, its streaks rising from a bright green foot to violet at the top.
   */
  function aurora(client: Client, map: ArenaMap, dt: number) {
    const t = client.time;
    owed.aurora += dt * 320;
    while (owed.aurora >= 1) {
      owed.aurora -= 1;
      const band = Math.floor(Math.random() * 3);
      const u = Math.random();
      // Each band an arc across its own side of the sky, folding and waving slowly.
      const fold = Math.sin(u * 11 + t * 0.35 + band * 2.1) * 0.09 + Math.sin(u * 3.7 - t * 0.17 + band) * 0.06;
      const ang = -2.6 + band * 1.05 + u * 1.9 + fold;
      const r = 58 + band * 7 + 5 * Math.sin(t * 0.11 + u * 6 + band);
      const base = FLOOR + 40 + band * 4 + 3 * Math.sin(u * 7 + t * 0.25 + band);
      // Most of the light at the curtain's foot, thinning upward.
      const k = Math.pow(Math.random(), 1.6);
      const p = { x: map.origin.x + Math.cos(ang) * r, y: base + k * 15, z: map.origin.z + Math.sin(ang) * r };
      const shade = Math.min(AURORA.length - 1, Math.floor(k * AURORA.length));
      client.fx.particles(p, AURORA[shade], { count: 1, speed: 0.05, size: rand(1.8, 2.8) * (1 - k * 0.4), gravity: -0.04, glow: 1, life: rand(2.4, 3.4), spread: 0.25, up: 0.2, drag: 0.3, velocity: { x: 0, y: 0.55, z: 0 }, collide: false });
    }
  }

  /** Flames, embers and smoke off each fire near the camera; the nearest one's crackle. */
  function fires(client: Client, map: ArenaMap, dt: number, w: Vec3) {
    const cam = client.camera.position;
    let nearest: Fire | null = null;
    let nearD = 18;
    for (const f of map.fires ?? []) {
      const d = Math.hypot(f.at.x - cam.x, f.at.y - cam.y, f.at.z - cam.z);
      if (d > FIRE_REACH) continue;
      if (d < nearD) {
        nearD = d;
        nearest = f;
      }
      const s = f.size;
      const colours = FLAMES[f.tint ?? 'fire'];
      // Its heart glowing, flickering.
      if (d < 30) client.fx.flare({ x: f.at.x, y: f.at.y + 0.25 * s, z: f.at.z }, s * rand(0.7, 0.95));
      let n = (fireOwed.get(f) ?? 0) + dt * 85 * s * (d > 28 ? 0.5 : 1);
      while (n >= 1) {
        n -= 1;
        const r = Math.sqrt(Math.random()) * 0.3 * s;
        const ang = Math.random() * Math.PI * 2;
        const at = { x: f.at.x + Math.cos(ang) * r, y: f.at.y + rand(-0.05, 0.1), z: f.at.z + Math.sin(ang) * r };
        client.fx.particles(at, pick(colours), { count: 1, speed: 0.25, size: rand(0.14, 0.3) * s, gravity: -1.6, glow: 1, life: rand(0.35, 0.65), spread: 0.04, up: rand(1.3, 2.3) * s, drag: 1.2, velocity: { x: w.x * 0.12, y: 0, z: w.z * 0.12 }, collide: false });
        if (Math.random() < 0.06) client.fx.particles(at, pick(f.tint === 'fire' || !f.tint ? EMBER : colours), { count: 1, speed: 0.6, size: rand(0.03, 0.05), gravity: -0.6, glow: 1, life: rand(1, 1.8), spread: 0.1, up: 2.2 * s, drag: 0.6, velocity: { x: w.x * 0.3, y: 0, z: w.z * 0.3 }, collide: false });
        if (Math.random() < 0.05 && f.tint !== 'frost') client.fx.particles({ ...at, y: at.y + 0.5 * s }, SMOKE, { count: 1, speed: 0.15, size: rand(0.2, 0.32) * s, gravity: -0.4, glow: 0, life: rand(1.2, 1.8), spread: 0.1, up: 0.8, drag: 0.8, velocity: { x: w.x * 0.35, y: 0, z: w.z * 0.35 }, collide: false });
      }
      fireOwed.set(f, n);
    }
    if (nearest) {
      crackle ??= client.audio.loop('amb_fire', { at: nearest.at, volume: 0 });
      crackle.set({ at: nearest.at, volume: 0.5 });
    } else if (crackle) {
      crackle.stop();
      crackle = null;
    }
  }
}
