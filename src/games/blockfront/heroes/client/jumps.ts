import type { Vec3 } from '@platform';
import type { Client, ClientKit } from '@platform/client';
import { Vec3 as V3 } from '@platform/client/math';
import { HEROES, heroByNumber, type HeroId } from '../defs';
import { JUMP } from '../tuning';
import { HeroScene } from './state';

/**
 * The heroes' jumps on each screen (`abilities.ts` moves them, `JUMP`): a soft ring of what they
 * stand on thrown up as they take off and as they land (dust off sand and paving, a puff of snow on
 * Frostline, grit off metal), a whoosh up and a thud down (heavier for Darth Voxel and
 * Chewblocca, louder the harder they come down), and on a second jump in the air a faint shimmer
 * of the Force round them (Boba Fetch's: a kick of flame from his jetpack).
 *
 * All of it is this screen's own, from how it draws them: our own hero as our movement has it
 * (run ahead, so it answers at once), everyone else's figure as it's drawn; their second jumps
 * from the scene (`flips`: ours from our movement, theirs from the server's word). Its voices are
 * its own (`defineJumpVoices`).
 */
export function heroJumps(scene: HeroScene): ClientKit {
  /** Each hero seen: in the air, how fast they rise (as drawn), their fastest fall this jump, their last second jump. */
  const tracks = new Map<string, { air: boolean; y: number; vy: number; fall: number; airT: number; flip: number | undefined }>();
  /** Rings of dust or snow spreading over the ground. */
  const rings: { at: Vec3; born: number; r0: number; r1: number; kind: Ground; n: number }[] = [];
  return {
    name: 'blockfront.heroes.jumps',
    setup(client: Client) {
      defineJumpVoices(client);
    },
    frame(client: Client, dt: number) {
      const now = scene.now;
      const seen = new Set<string>();
      const bodies: { id: string; hero: HeroId; at: Vec3; air: boolean; vy?: number }[] = [];
      // Our own hero, as our movement has it.
      const me = client.me;
      const mine = scene.localId && !me.dead ? heroByNumber(Number(me.abilities.hero?.h ?? 0)) : null;
      if (mine && scene.localId) bodies.push({ id: scene.localId, hero: mine, at: me.position, air: !me.onGround && !me.flying, vy: me.velocity.y });
      // Everyone else's, as drawn.
      for (const fig of client.figures.all) {
        if (!fig.player || fig.player === scene.localId || fig.state.dying > 0) continue;
        const hero = HeroScene.heroByWeapon(fig.held?.item);
        if (!hero) continue;
        const p = fig.root.getWorldPosition(new V3());
        bodies.push({ id: fig.player, hero, at: { x: p.x, y: p.y, z: p.z }, air: !!fig.state.air });
      }

      for (const b of bodies) {
        seen.add(b.id);
        const t = tracks.get(b.id);
        if (!t) {
          tracks.set(b.id, { air: b.air, y: b.at.y, vy: 0, fall: 0, airT: 0, flip: scene.flips.get(b.id) });
          continue;
        }
        const rise = dt > 0 ? (b.at.y - t.y) / dt : 0;
        t.vy = b.vy ?? t.vy + (Math.max(-20, Math.min(20, rise)) - t.vy) * Math.min(1, dt * 14);
        t.y = b.at.y;
        const heavy = b.hero === 'vader' || b.hero === 'chewie';
        // Off the ground, going up: a jump (not a step off a ledge).
        if (b.air && !t.air && (b.vy !== undefined ? b.vy > 2 : rise > 1)) {
          const kind = ground(client, b.at);
          rings.push({ at: { ...b.at }, born: now, r0: 0.2, r1: 0.7, kind, n: 26 });
          client.audio.play('bfh_jump', { at: b.at, volume: 0.7, pitch: heavy ? 0.8 : 1 });
        }
        if (b.air) {
          t.airT = t.air ? t.airT + dt : 0;
          if (!t.air) t.fall = 0;
          t.fall = Math.min(t.fall, t.vy);
        } else if (t.air && (t.airT > 0.3 || t.fall < -3)) {
          // Down: harder, bigger (a heavy hero's more).
          const hard = Math.min(1, Math.max(0, (-t.fall - 2) / 7));
          const kind = ground(client, b.at);
          rings.push({ at: { ...b.at }, born: now, r0: 0.25, r1: 0.9 + 0.7 * hard + (heavy ? 0.3 : 0), kind, n: 34 + Math.round(hard * 30) });
          client.audio.play('bfh_land', { at: b.at, volume: 0.45 + 0.55 * hard, pitch: heavy ? 0.78 : 1 });
          if (heavy && hard > 0.3 && b.id === scene.localId) client.fx.shake(0.08 * hard, 0.25);
        }
        t.air = b.air;
        // A second jump: the Force's shimmer round them, or a kick of Boba Fetch's jetpack.
        const flip = scene.flips.get(b.id);
        if (flip !== undefined && flip !== t.flip && now - flip < 0.5) {
          const chest = { x: b.at.x, y: b.at.y + 1.1, z: b.at.z };
          if (JUMP[b.hero].flip === 'jet') kick(client, b.at);
          else shimmer(client, chest, b.hero);
          client.audio.play(JUMP[b.hero].flip === 'jet' ? 'bfh_jet' : 'bfh_jump2', { at: chest, volume: JUMP[b.hero].flip === 'jet' ? 0.6 : 0.8, pitch: heavy ? 0.85 : 1 });
        }
        t.flip = flip;
      }
      for (const id of tracks.keys()) if (!seen.has(id)) tracks.delete(id);

      // The rings: thrown out over a moment, a few motes a frame round a growing circle.
      for (let i = rings.length - 1; i >= 0; i--) {
        const r = rings[i];
        const u = (now - r.born) / 0.14;
        if (u > 1) {
          rings.splice(i, 1);
          continue;
        }
        const rad = r.r0 + (r.r1 - r.r0) * u;
        // (`n` motes in all, spread over its moment.)
        const n = Math.max(1, Math.round((r.n * Math.min(dt, 0.05)) / 0.14));
        const look = LOOK[r.kind];
        for (let k = 0; k < n; k++) {
          const a = Math.random() * Math.PI * 2;
          fx(client, { x: r.at.x + Math.cos(a) * rad, y: r.at.y + 0.08, z: r.at.z + Math.sin(a) * rad }, look);
        }
      }
    },
  };
}

type Ground = 'snow' | 'frost' | 'dust' | 'grit';

/** What they stand on, by the block under their feet. */
function ground(client: Client, at: Vec3): Ground {
  const b = client.world.blockAt(Math.floor(at.x), Math.floor(at.y - 0.3), Math.floor(at.z));
  if (/snow|glacier|ice/.test(b)) return 'snow';
  if (/frost/.test(b)) return 'frost';
  if (/sand|paving|adobe|plaster|ashlar|canyon|dirt|gravel|grass/.test(b)) return 'dust';
  return 'grit';
}

/** How each ground's motes look: colour, size, how long they hang, how heavy. */
const LOOK: Record<Ground, { c: [number, number, number]; size: [number, number]; life: number; gravity: number }> = {
  dust: { c: [0.62, 0.54, 0.4], size: [0.1, 0.17], life: 0.55, gravity: 0.6 },
  snow: { c: [0.93, 0.96, 1], size: [0.09, 0.16], life: 0.6, gravity: 0.35 },
  frost: { c: [0.78, 0.83, 0.88], size: [0.1, 0.16], life: 0.55, gravity: 0.7 },
  grit: { c: [0.5, 0.5, 0.53], size: [0.07, 0.11], life: 0.35, gravity: 1.5 },
};

function fx(client: Client, at: Vec3, look: (typeof LOOK)[Ground]) {
  const size = look.size[0] + Math.random() * (look.size[1] - look.size[0]);
  client.fx.particles(at, look.c, { count: 1, speed: 0.9, size, gravity: look.gravity, life: look.life * (0.7 + Math.random() * 0.5), drag: 3, up: 0.35, collide: false });
}

/** The Force round a hero as they jump again: a flash, a ring of faint motes, a few rising. */
function shimmer(client: Client, chest: Vec3, hero: HeroId) {
  const tint = HEROES[hero].blade;
  const n = parseInt(tint.slice(1), 16);
  const c: [number, number, number] = [0.8 + 0.2 * (((n >> 16) & 255) / 255), 0.85 + 0.15 * (((n >> 8) & 255) / 255), 0.9 + 0.1 * ((n & 255) / 255)];
  client.fx.flare(chest, 0.9);
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    client.fx.particles({ x: chest.x + Math.cos(a) * 0.55, y: chest.y - 0.5 + Math.random() * 0.9, z: chest.z + Math.sin(a) * 0.55 }, c, { count: 1, speed: 0.5, size: 0.06, gravity: -1.5, glow: 2.2, life: 0.45, drag: 2, collide: false });
  }
}

/** Boba Fetch's jetpack kicking: flame and smoke down from his back. */
function kick(client: Client, feet: Vec3) {
  const at = { x: feet.x, y: feet.y + 0.9, z: feet.z };
  client.fx.flare(at, 0.8);
  client.fx.particles(at, [1, 0.72, 0.3], { count: 10, speed: 3, size: 0.12, gravity: 18, glow: 3, life: 0.2, spread: 0.1, collide: false });
  client.fx.particles({ x: at.x, y: at.y - 0.5, z: at.z }, [0.6, 0.57, 0.55], { count: 6, speed: 1.2, size: 0.18, gravity: 1.5, life: 0.7, spread: 0.2, collide: false });
}

/**
 * The jumps' voices (levels at `sounds.ts`'s): off the ground, a scuff and a soft rush of air; a
 * second jump, an airy whoosh with a faint shimmer over it; down again, a thud (played louder the
 * harder they land, lower for the heavy ones).
 */
function defineJumpVoices(client: Client) {
  const a = client.audio;
  a.define('bfh_jump', (s) => {
    s.noise({ duration: 0.05, filter: 'lowpass', from: 900, to: 300, volume: 0.112 });
    s.noise({ duration: 0.26, attack: 0.05, filter: 'bandpass', from: 380, to: 1000, q: 1.2, volume: 0.12 });
  });
  a.define('bfh_jump2', (s) => {
    const p = s.pitch;
    s.noise({ duration: 0.3, attack: 0.04, filter: 'bandpass', from: 600, to: 1700, q: 1.4, volume: 0.1 });
    s.tone({ wave: 'sine', from: 880 * p, glide: [[0.3, 1320 * p]], duration: 0.3, attack: 0.05, volume: 0.022, fm: { ratio: 2, depth: 0.3 } });
    s.tone({ wave: 'sine', from: 1320 * p, glide: [[0.25, 1980 * p]], duration: 0.25, delay: 0.05, attack: 0.05, volume: 0.012 });
  });
  a.define('bfh_land', (s) => {
    const p = s.pitch;
    s.noise({ duration: 0.03, filter: 'highpass', from: 2400, to: 1400, volume: 0.05 });
    s.tone({ wave: 'sine', from: 95 * p, to: 40 * p, duration: 0.22, attack: 0.003, volume: 0.22 });
    s.noise({ duration: 0.2, attack: 0.005, filter: 'lowpass', from: 700, to: 90, volume: 0.18 });
  });
}
