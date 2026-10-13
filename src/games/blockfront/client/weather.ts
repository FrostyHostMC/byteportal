import type { Vec3 } from '@platform';
import type { Client, ClientKit, ClientLoop } from '@platform/client';
import { Vec3 as V3 } from '@platform/client/math';
import { MAPS, type MapSpec } from '../map';

/**
 * The air on each map, round the camera (each screen its own, nothing sent):
 *
 * - **Mos Blockley**: sand on the wind, low over the streets, thicker in the open and in the gusts
 *   that come every so often; and dust kicked up by running feet.
 * - **Frostline**: snow falling, driven sideways when it gusts, blown off the tops of the ridges
 *   and rocks; and everyone's breath, a little white puff every couple of seconds.
 *
 * And on Frostline its own wind (`bf_frost_wind`): a thinner, colder rush than the desert's, a
 * whistle through the rocks over it, rising and falling with the same gusts that drive the snow.
 *
 * Which map it is: the camera's place against each map's bounds. Nothing while a replay plays, and
 * it thins out under a roof (the sky straight up is blocked) and while looking down the sights. It
 * runs on a fixed budget out of the platform's particles (a few hundred of its 4096 at most), and
 * never starts any just in front of the camera, so nothing comes between the crosshair and a target.
 */

export type Climate = 'sand' | 'snow';

/** How each map's air behaves: its wind (where it blows toward, blocks a second, and in a gust), and its budget. */
interface Air {
  climate: Climate;
  /** Where the wind blows toward (a heading in radians: 0 toward +x, turning toward +z). */
  heading: number;
  wind: number;
  gust: number;
  /** Particles a second at most (in the open, in a gust). */
  rate: number;
}

const AIRS: Record<string, Air> = {
  // Off the dunes to the west-south-west, down the main streets.
  spaceport: { climate: 'sand', heading: 0.35, wind: 3.5, gust: 9, rate: 700 },
  // Down off the mountains to the north-east.
  frostline: { climate: 'snow', heading: 2.3, wind: 1.6, gust: 7, rate: 230 },
};

/** How far round the camera the air is drawn (blocks), and how near it may start. */
const REACH = 26;
const NEAR = 4;
/** Nothing starts in the cone this far in front of the camera. */
const CLEAR_AHEAD = 9;
/** Directions round the camera it keeps a clear distance for. */
const RAYS = 24;
/** Nothing's sent on a path that comes nearer the camera than this. */
const LENS = 3;

/** Linear RGB for a CSS hex colour. */
function linear(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return [c((n >> 16) & 255), c((n >> 8) & 255), c(n & 255)];
}

/** Grains catching the sun: paler than the sand they blow over. */
const SANDS = ['#f2dfb8', '#ead3a5', '#f7e8c8', '#e3c796'].map(linear);
const DUST = linear('#c9ab80');
const SNOW = linear('#f4f8ff');
const BREATH = linear('#eef3f8');

const rand = (a: number, b: number) => a + Math.random() * (b - a);

/** The map the camera's over (within a good way of its bounds), or null between them. */
function mapAt(p: Vec3): MapSpec | null {
  for (const m of MAPS) {
    const { min, max } = m.bounds;
    if (p.x > min.x - 160 && p.x < max.x + 160 && p.z > min.z - 160 && p.z < max.z + 160) return m;
  }
  return null;
}

/** The climate where `p` is (the map it's over's), or null between the maps. */
export function climateAt(p: Vec3): Climate | null {
  const map = mapAt(p);
  return (map && AIRS[map.id]?.climate) ?? null;
}

/**
 * Frostline's wind, a loop: a thin low rush, blown snow hissing over it, a whistle and a higher
 * one through the rocks. The gusts are its loudness and pitch (`frame`), as the desert wind's are.
 */
export function defineFrostWind(client: Client) {
  client.audio.defineLoop('bf_frost_wind', (l) => {
    l.noise({ freq: 240, filter: 'lowpass', q: 0.7, volume: 0.42 });
    l.noise({ freq: 1150, filter: 'bandpass', q: 0.9, volume: 0.4 });
    l.noise({ freq: 640, filter: 'bandpass', q: 9, volume: 0.1 });
    l.noise({ freq: 1500, filter: 'bandpass', q: 11, volume: 0.045 });
  });
}

export function weather(): ClientKit {
  let gust = 0;
  let gustAt = 6;
  let gustEnd = 0;
  let sway = 0;
  /** 0 under a roof, 1 under the sky (eased); how open the camera's surroundings are (eased). */
  let sky = 1;
  let open = 1;
  let checkAt = 0;
  /** Particles owed (fractions carry over frames). */
  let owed = 0;
  let plumes = 0;
  let ribbons = 0;
  /** When each figure next breathes or kicks up dust. */
  const next = new Map<number, number>();
  /** How far the camera can see along the ground each way (RAYS directions round it). */
  const free = new Float32Array(RAYS).fill(REACH);
  let ray = 0;
  const head = new V3();
  const ahead = new V3();
  const feet = new V3();

  /** The first solid block straight up from `p` within `max`. */
  const roofed = (client: Client, p: Vec3, max: number) => client.world.raycast(p, { x: 0, y: 1, z: 0 }, max) !== null;

  /**
   * A random point round the camera, where it can see: most of them in the half it looks into (the
   * rest keep the air full when it turns), out along a clear line (never inside or behind a wall),
   * not too near, not just ahead of it (null if it drew one there); `lo`..`hi` above the camera.
   */
  function around(cam: Vec3, fwd: Vec3, lo: number, hi: number): Vec3 | null {
    const look = Math.atan2(fwd.z, fwd.x);
    const a = Math.random() < 0.75 ? look + (Math.random() - 0.5) * 2.6 : Math.random() * Math.PI * 2;
    const bucket = ((Math.round((a / (Math.PI * 2)) * RAYS) % RAYS) + RAYS) % RAYS;
    const far = Math.min(REACH, free[bucket]);
    if (far <= NEAR + 0.5) return null;
    const r = NEAR + Math.sqrt(Math.random()) * (far - NEAR - 0.5);
    const p = { x: cam.x + Math.cos(a) * r, y: cam.y + rand(lo, hi), z: cam.z + Math.sin(a) * r };
    const dx = p.x - cam.x;
    const dy = p.y - cam.y;
    const dz = p.z - cam.z;
    const d = Math.hypot(dx, dy, dz);
    if (d < CLEAR_AHEAD && (dx * fwd.x + dy * fwd.y + dz * fwd.z) / d > 0.55) return null;
    return p;
  }

  /** Whether something starting at `p` moving at `v` for `life` seconds passes near the camera (it would fill the lens). */
  function nears(cam: Vec3, p: Vec3, v: Vec3, life: number): boolean {
    const vv = v.x * v.x + v.y * v.y + v.z * v.z;
    const t = vv > 0 ? Math.max(0, Math.min(life, -((p.x - cam.x) * v.x + (p.y - cam.y) * v.y + (p.z - cam.z) * v.z) / vv)) : 0;
    return Math.hypot(p.x + v.x * t - cam.x, p.y + v.y * t - cam.y, p.z + v.z * t - cam.z) < LENS;
  }

  /** Keep the clear distances round the camera up to date, a few rays a frame. */
  function look(client: Client, cam: Vec3) {
    for (let k = 0; k < 4; k++) {
      ray = (ray + 1) % RAYS;
      const a = (ray / RAYS) * Math.PI * 2;
      const hit = client.world.raycast(cam, { x: Math.cos(a), y: 0, z: Math.sin(a) }, REACH);
      free[ray] = hit ? hit.distance : REACH;
    }
  }

  let windLoop: ClientLoop | null = null;
  const hush = () => {
    windLoop?.stop();
    windLoop = null;
  };

  return {
    name: 'blockfront.weather',
    setup(client) {
      defineFrostWind(client);
    },
    frame(client, dt) {
      const cam = client.camera.position;
      const map = mapAt(cam);
      const air = map ? AIRS[map.id] : undefined;
      if (!client.running || !map || !air || air.climate !== 'snow') hush();
      if (client.replay.playing || dt <= 0) return;
      if (!map || !air) return;
      const t = client.time;

      // The wind: its heading wandering a little, a gust now and then (up in a second, a few seconds, easing off).
      if (t >= gustAt) {
        gustEnd = t + rand(2, 4.5);
        gustAt = gustEnd + rand(5, 14);
      }
      gust += ((t < gustEnd ? 1 : 0) - gust) * Math.min(1, dt * (t < gustEnd ? 1.6 : 0.7));
      sway = 0.25 * Math.sin(t * 0.07) + 0.12 * Math.sin(t * 0.23 + 1);
      const heading = air.heading + sway;
      const speed = air.wind + (air.gust - air.wind) * gust;
      const wind = { x: Math.cos(heading) * speed, y: 0, z: Math.sin(heading) * speed };
      if (air.climate === 'snow' && client.running) {
        // Heard as the desert wind is (ambience.ts): quiet in a lull, up and higher in a gust; muffled under a roof.
        windLoop ??= client.audio.loop('bf_frost_wind', { volume: 0 });
        windLoop.set({ volume: (0.06 + gust * 0.15) * (0.45 + 0.55 * sky), pitch: 0.8 + gust * 0.45 + sway * 0.2 });
      }

      // Under a roof or out; how open it is round about (how far it sees along the ground).
      look(client, cam);
      if (t >= checkAt) {
        checkAt = t + 0.25;
        const covered = roofed(client, cam, 28);
        let seen = 0;
        for (let i = 0; i < RAYS; i++) seen += free[i] / REACH;
        sky = sky + ((covered ? 0 : 1) - sky) * 0.5;
        open = open + (seen / RAYS - open) * 0.5;
      }

      const fwdPoint = client.camera.toWorld({ x: 0, y: 0, z: -1 });
      const fwd = { x: fwdPoint.x - cam.x, y: fwdPoint.y - cam.y, z: fwdPoint.z - cam.z };
      // Looking down a scope, a speck near the lens would be huge: thin it right out.
      const zoom = Math.max(1, client.camera.zoom);
      const thin = 1 / (zoom * zoom);

      if (air.climate === 'snow') snow(client, dt, cam, fwd, wind, air, thin, map);
      else sand(client, dt, cam, fwd, wind, air, thin);
      breathAndDust(client, air, wind, cam);
    },
    dispose: hush,
  };

  /** Snow: falling round the camera, carried on the wind; blown off the tops of things in plumes. */
  function snow(client: Client, dt: number, cam: Vec3, fwd: Vec3, wind: Vec3, air: Air, thin: number, map: MapSpec) {
    const fall = 1.1 + gust * 0.5;
    owed += dt * air.rate * (0.8 + 0.4 * gust) * thin * sky;
    while (owed >= 1) {
      owed -= 1;
      const p = around(cam, fwd, -3, 12);
      if (!p || client.world.blockAt(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)) !== 'air') continue;
      const life = rand(3.2, 5);
      const velocity = { x: wind.x * rand(0.8, 1.2), y: -fall, z: wind.z * rand(0.8, 1.2) };
      if (nears(cam, p, velocity, life)) continue;
      client.fx.particles(p, SNOW, { count: 1, speed: 0.25, size: rand(0.04, 0.07), gravity: 0.35, life, spread: 0, up: 0, velocity, collide: true });
    }
    // Plumes blown off the ridges' and rocks' tops upwind of us, more in a gust.
    plumes += dt * (1.2 + gust * 4) * thin;
    while (plumes >= 1) {
      plumes -= 1;
      const a = Math.random() * Math.PI * 2;
      const r = rand(10, 40);
      const x = Math.floor(cam.x + Math.cos(a) * r);
      const z = Math.floor(cam.z + Math.sin(a) * r);
      // The top of that column, from a little over the camera down.
      let top = -1;
      for (let y = Math.floor(cam.y) + 14; y >= map.floorY - 2; y--) {
        const b = client.world.blockAt(x, y, z);
        if (b !== 'air') {
          top = b.startsWith('snow') ? y : -1;
          break;
        }
      }
      if (top < map.floorY + 2) continue;
      client.fx.particles({ x: x + 0.5, y: top + 1.1, z: z + 0.5 }, SNOW, {
        count: 14,
        speed: 0.6,
        size: rand(0.055, 0.09),
        gravity: 0.5,
        life: rand(1.3, 2.2),
        spread: 1.6,
        up: 0.6,
        velocity: { x: wind.x * 1.5, y: 0, z: wind.z * 1.5 },
        collide: false,
      });
    }
  }

  /**
   * Sand: low over the ground, streaming on the wind (it never settles: grains that reach a wall
   * go on through it out of sight), thicker in the open and in a gust, when ribbons of it race
   * along the ground.
   */
  function sand(client: Client, dt: number, cam: Vec3, fwd: Vec3, wind: Vec3, air: Air, thin: number) {
    const ground = client.me.position.y;
    const strength = (0.15 + 0.85 * open) * (0.3 + 0.7 * gust) * sky;
    const grain = (p: Vec3, size: number, k: number) => {
      const life = rand(1.3, 2.4);
      const velocity = { x: wind.x * k, y: 0, z: wind.z * k };
      if (nears(cam, p, velocity, life)) return;
      client.fx.particles(p, SANDS[Math.floor(Math.random() * SANDS.length)], {
        count: 1,
        speed: 0.35,
        size,
        gravity: 0,
        glow: 0.06,
        life,
        spread: 0,
        up: rand(-0.1, 0.35),
        velocity,
        collide: false,
      });
    };
    owed += dt * air.rate * strength * thin;
    while (owed >= 1) {
      owed -= 1;
      const p = around(cam, fwd, 0, 0);
      if (!p) continue;
      p.y = ground + rand(0.1, 0.8 + 1.6 * gust);
      if (client.world.blockAt(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)) !== 'air') continue;
      // Mostly grains; now and then a bigger mote of dust.
      grain(p, Math.random() < 0.12 ? rand(0.07, 0.1) : rand(0.035, 0.06), rand(0.8, 1.25));
    }
    // In a gust, ribbons: a line of grains along the wind, racing together over the ground.
    ribbons += dt * gust * open * 5 * sky * thin;
    while (ribbons >= 1) {
      ribbons -= 1;
      const p = around(cam, fwd, 0, 0);
      if (!p) continue;
      const len = Math.hypot(wind.x, wind.z) || 1;
      const k = rand(1.1, 1.4);
      const y = ground + rand(0.05, 0.5);
      for (let i = 0; i < 10; i++) {
        const q = { x: p.x - (wind.x / len) * i * 0.35 + rand(-0.15, 0.15), y: y + rand(-0.08, 0.08), z: p.z - (wind.z / len) * i * 0.35 + rand(-0.15, 0.15) };
        grain(q, rand(0.03, 0.05), k);
      }
    }
  }

  /** Each figure near the camera: a puff of breath from its head (snow), dust from running feet (sand). */
  function breathAndDust(client: Client, air: Air, wind: Vec3, cam: Vec3) {
    const t = client.time;
    for (const f of client.figures.all) {
      if (!f.player || f.state.dying > 0) continue;
      const root = f.root.getWorldPosition(feet);
      if (Math.hypot(root.x - cam.x, root.z - cam.z) > 32) continue;
      const due = next.get(f.id) ?? t + Math.random() * 2;
      if (!next.has(f.id)) next.set(f.id, due);
      if (t < due) continue;
      if (air.climate === 'snow') {
        next.set(f.id, t + rand(1.8, 2.6));
        const neck = f.rig?.joints.head;
        if (neck) neck.getWorldPosition(head);
        else head.set(root.x, root.y + 1.55, root.z);
        // Our own, through the eyes, would be on the lens.
        if (Math.hypot(head.x - cam.x, head.y - cam.y, head.z - cam.z) < 1.2) continue;
        // Out in front of the face: the way the body faces (its model looks down +z), turned with the head.
        ahead.set(0, 0, 1).applyQuaternion(f.root.quaternion);
        const yaw = f.state.headYaw;
        const fx = ahead.x * Math.cos(yaw) + ahead.z * Math.sin(yaw);
        const fz = ahead.z * Math.cos(yaw) - ahead.x * Math.sin(yaw);
        client.fx.particles({ x: head.x + fx * 0.35, y: head.y + 0.05, z: head.z + fz * 0.35 }, BREATH, {
          count: 8,
          speed: 0.3,
          size: rand(0.08, 0.12),
          gravity: -0.25,
          life: rand(0.8, 1.1),
          spread: 0.1,
          up: 0.15,
          drag: 1.4,
          velocity: { x: fx * 0.9 + wind.x * 0.25, y: 0, z: fz * 0.9 + wind.z * 0.25 },
          collide: false,
        });
      } else {
        // Dust only from feet running on the ground.
        next.set(f.id, t + 0.28);
        if ((f.state.speed ?? 0) < 4 || f.state.air) continue;
        client.fx.particles({ x: root.x, y: root.y + 0.1, z: root.z }, DUST, {
          count: 3,
          speed: 0.7,
          size: rand(0.06, 0.1),
          gravity: 1.2,
          life: 0.6,
          spread: 0.3,
          up: 0.5,
          drag: 2.5,
          velocity: { x: wind.x * 0.3, y: 0, z: wind.z * 0.3 },
          collide: false,
        });
      }
    }
    // Forget figures gone a while.
    if (next.size > 64) for (const [id, due] of next) if (due < t - 10) next.delete(id);
  }
}
