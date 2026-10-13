import type { ClientKit, ClientLoop } from '@platform/client';
import { climateAt } from './weather';

/** Blaster voices a far-off fight is made of (`client/sounds.ts`): each side's. */
const SIDES = [
  ['blaster_rifle_rebels', 'blaster_rifle_rebels', 'blaster_heavy_rebels', 'blaster_pistol_rebels'],
  ['blaster_rifle_empire', 'blaster_rifle_empire', 'blaster_heavy_empire', 'blaster_pistol_empire'],
];

/**
 * The air on each screen, while a match is on: the desert wind over the spaceport (a loop,
 * gusting and dying down; Frostline has its own: `weather.ts`), and on either map a fight
 * somewhere off across the flats: bursts of real blaster fire from one side,
 * the other answering, far enough off to be muffled and mostly their echo; now and then a blast.
 * The voices are `client/sounds.ts`'s. (The starfighters overhead are the server's: `skies.ts`.)
 */
export function ambience(): ClientKit {
  let wind: ClientLoop | null = null;
  /** The gust: how strong it is now, and what it's heading for (0..1), until when. */
  let gust = 0.3;
  let aim = 0.3;
  let turn = 0;
  let fight = 4;
  let boom = 14;
  /** Shots of a far-off burst still to come: when (the client's clock), which voice, where. */
  let shots: { at: number; voice: string; x: number; y: number; z: number }[] = [];
  const rand = (a: number, b: number) => a + Math.random() * (b - a);

  const quiet = () => {
    wind?.stop();
    wind = null;
    shots = [];
  };

  return {
    name: 'blockfront.ambience',
    frame(client, dt) {
      if (!client.running) return quiet();
      const t = client.time;
      const me = client.me.position;
      /** A point `d` blocks off in a random direction, `up` above us. */
      const around = (d: number, up: number) => {
        const a = Math.random() * Math.PI * 2;
        return { x: me.x + Math.cos(a) * d, y: me.y + up, z: me.z + Math.sin(a) * d };
      };

      // The wind (the desert's: over the spaceport), easing toward a new strength every few seconds, now a lull, now a gust.
      if (climateAt(client.camera.position) !== 'sand') {
        wind?.stop();
        wind = null;
      } else wind ??= client.audio.loop('amb_wind', { volume: 0 });
      if (t >= turn) {
        turn = t + rand(1.5, 4.5);
        aim = Math.random() < 0.25 ? rand(0.7, 1) : rand(0.1, 0.5);
      }
      gust += (aim - gust) * Math.min(1, dt * 0.8);
      wind?.set({ volume: 0.065 + gust * 0.15, pitch: 0.75 + gust * 0.55 });

      // A fight far off: a burst from one side, the other side's answer a moment later.
      if (t >= fight) {
        fight = t + rand(2.5, 7);
        const d = rand(55, 110);
        const from = around(d, 3);
        const side = Math.floor(Math.random() * 2);
        const answer = { x: from.x + rand(-14, 14), y: from.y, z: from.z + rand(-14, 14) };
        let at = t;
        for (const [who, where] of [
          [side, from],
          [1 - side, answer],
        ] as const) {
          const voice = SIDES[who][Math.floor(Math.random() * SIDES[who].length)];
          const n = 2 + Math.floor(Math.random() * 5);
          for (let i = 0; i < n; i++) {
            shots.push({ at, voice, ...where });
            at += voice.includes('heavy') ? rand(0.09, 0.13) : rand(0.16, 0.34);
          }
          at += rand(0.2, 0.9);
        }
      }
      if (shots.length) {
        const due = shots.filter((s) => s.at <= t);
        if (due.length) {
          shots = shots.filter((s) => s.at > t);
          for (const s of due) client.audio.play(s.voice, { at: { x: s.x, y: s.y, z: s.z }, volume: 0.35, pitch: rand(0.94, 1.04) });
        }
      }
      if (t >= boom) {
        boom = t + rand(12, 30);
        client.audio.play('amb_boom', { at: around(rand(70, 110), 0), volume: 3.5, pitch: rand(0.8, 1.1) });
      }
    },
    dispose: quiet,
  };
}