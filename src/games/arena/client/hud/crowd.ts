import type { Client, ClientKit, ClientLoop } from '@platform/client';
import { mapById, type ArenaMap } from '../../maps';
import { MSG, type CrowdMsg } from '../../hud/messages';
import { hud } from './store';

/** How fast the crowd's excitement dies down (a second). */
const COOL = 0.22;
/** Cheers come at most this often (seconds): a burst of kills is one swell, not a babble. */
const CHEER_EVERY = 0.35;

type Point = { x: number; y: number; z: number };

/**
 * Where a map's crowd sits (`ArenaMap.crowd`, the maps part's: points in its stands), or false for
 * a map with nobody watching; a map that doesn't say is ringed by stands round its floor.
 */
function standsOf(m: ArenaMap): Point[] | 'ring' | false {
  const c = (m as ArenaMap & { crowd?: { at: Point[] } | false }).crowd;
  if (c === false) return false;
  return c?.at.length ? c.at : 'ring';
}

/**
 * The crowd in the stands, on each screen, while a fight's on: a murmur of thousands (`ar_crowd`)
 * and a roar over it (`ar_roar`) that swells with their excitement, which kills raise a little and
 * the server's word (`crowd`: a boss felled, a multikill, the Crowd's Favour, a wave won) a lot;
 * cheers, gasps and groans from all round the stands; and before a wave, the stands stamping and
 * clapping, quicker as it nears. On a map with nobody watching (`ArenaMap.crowd: false`), silence.
 */
export function crowd(): ClientKit {
  let murmur: ClientLoop | null = null;
  let roar: ClientLoop | null = null;
  /** Their excitement, 0..1, and what it's heading for. */
  let hype = 0;
  let clapAt = 0;
  let clapStep = 0;
  let chatter = 0;
  let lastCheer = -1;
  /** A cheer, unless one's just gone up (roars always). */
  const cheer = (client: Client, o: { at?: { x: number; y: number; z: number }; volume: number; pitch: number }, roar = false) => {
    if (!roar && client.time - lastCheer < CHEER_EVERY) return;
    lastCheer = client.time;
    client.audio.play('ar_cheer', o);
  };

  const quiet = () => {
    murmur?.stop();
    roar?.stop();
    murmur = roar = null;
  };

  /** Somewhere in this map's stands (everywhere, if it doesn't say where they are). */
  const stands = (): Point | undefined => {
    const m = hud.run && mapById(hud.run.map);
    const s = m && standsOf(m);
    if (!m || !s) return undefined;
    if (s !== 'ring') return s[Math.floor(Math.random() * s.length)];
    const a = Math.random() * Math.PI * 2;
    const r = m.radius + 6 + Math.random() * 8;
    return { x: m.center.x + Math.cos(a) * r, y: m.center.y + 6 + Math.random() * 6, z: m.center.z + Math.sin(a) * r };
  };

  const react = (client: Client, c: CrowdMsg) => {
    hype = Math.min(1, hype + c.v * (c.r === 'roar' ? 1 : 0.55));
    if (c.r === 'cheer' || c.r === 'roar') {
      cheer(client, { volume: 0.5 + c.v * 0.7, pitch: 0.95 + Math.random() * 0.1 }, c.r === 'roar');
      if (c.r === 'roar') window.setTimeout(() => client.audio.play('ar_cheer', { at: stands(), volume: 1.6, pitch: 1.05 }), 180);
    } else client.audio.play(c.r === 'gasp' ? 'ar_gasp' : 'ar_groan', { volume: 0.5 + c.v * 0.6 });
  };

  return {
    name: 'arena.hud.crowd',
    setup(client) {
      client.on(MSG.crowd, (d) => {
        const c = d as CrowdMsg;
        if (c && typeof c.v === 'number' && typeof c.r === 'string' && murmur) react(client, c);
      });
      // Every death stirs them a little; now and then someone shouts.
      client.on(MSG.gore, () => {
        if (!murmur) return;
        hype = Math.min(1, hype + 0.07);
        if (Math.random() < 0.3) cheer(client, { at: stands(), volume: 0.9, pitch: 1.1 + Math.random() * 0.15 });
      });
    },
    frame(client, dt) {
      const r = hud.run;
      const m = r && mapById(r.map);
      const on = !!r && client.running && !!client.me.id && r.phase !== 'intro' && r.phase !== 'waiting' && !client.replay.playing && !!m && standsOf(m) !== false;
      if (!on) return quiet();
      murmur ??= client.audio.loop('ar_crowd', { volume: 0 });
      roar ??= client.audio.loop('ar_roar', { volume: 0 });
      // The Crowd's Favour keeps them on their feet.
      const favour = hud.hype.f > 0;
      hype = Math.max(favour ? 0.7 : 0, hype - dt * COOL);
      const through = r.total > 0 ? 1 - r.left / r.total : 0;
      const base = r.phase === 'fighting' ? 0.11 + through * 0.05 + (r.boss ? 0.04 : 0) : 0.08;
      murmur.set({ volume: base + hype * 0.06, pitch: 0.95 + hype * 0.18 });
      roar.set({ volume: hype * hype * 0.32 + hud.hype.v * 0.03, pitch: 0.9 + hype * 0.25 });

      // Voices from the stands, now and then, more when they're worked up.
      const t = client.time;
      if (t >= chatter) {
        chatter = t + 1.2 + Math.random() * (4 - hype * 3);
        if (r.phase === 'fighting' || hype > 0.3) client.audio.play('ar_cheer', { at: stands(), volume: 0.35 + hype * 0.6, pitch: 1 + Math.random() * 0.25 });
      }

      // Before a wave: stamp, stamp, clap, quicker as it nears.
      const before = (r.phase === 'intermission' || r.phase === 'countdown') && r.next > 0 && r.next <= 8;
      if (before && t >= clapAt) {
        const step = Math.max(0.17, 0.28 - (8 - r.next) * 0.014);
        const beat = clapStep++ % 3;
        client.audio.play(beat === 2 ? 'ar_clap' : 'ar_stomp', { volume: 0.5 + (8 - r.next) * 0.08 });
        clapAt = t + (beat === 2 ? step * 2 : step);
      } else if (!before) clapStep = 0;
    },
    dispose: quiet,
  };
}
