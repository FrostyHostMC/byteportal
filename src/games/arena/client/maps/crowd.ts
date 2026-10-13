import type { ClientKit } from '@platform/client';
import { MAPS, mapNear } from '../../maps';
import { CHEER_MSG, type CheerMessage } from '../../maps/messages';

function linear(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return [c((n >> 16) & 255), c((n >> 8) & 255), c(n & 255)];
}

/** Rose petals, white blossom, gilt flakes. */
const PETALS = ['#c8102e', '#e0284a', '#a50e26', '#f4ecdc', '#ffd36b', '#d4223f'].map(linear);
const rand = (a: number, b: number) => a + Math.random() * (b - a);

/**
 * The crowd cheering on this screen (the server's `CHEER_MSG`, on a map with a crowd): handfuls of
 * petals thrown from all round the stands (about its `crowd.at` points), arcing out over the pit
 * and fluttering down onto the sand: a shower for the Crowd's Favour, a flurry for a feat.
 */
export function crowd(): ClientKit {
  let until = 0;
  let rate = 0;
  let owed = 0;
  return {
    name: 'arena.crowd',
    setup(client) {
      client.on(CHEER_MSG, (data) => {
        const big = !!(data as CheerMessage)?.big;
        until = client.time + (big ? 7 : 2.2);
        rate = big ? 380 : 150;
      });
    },
    frame(client, dt) {
      if (client.time >= until || client.replay.playing) return;
      const map = mapNear(MAPS, client.camera.position);
      const seats = map?.crowd ? map.crowd.at : null;
      if (!map || !seats?.length) return;
      const c = map.center;
      owed += dt * rate * Math.min(1, (until - client.time) / 1.5);
      while (owed >= 1) {
        owed -= 1;
        // From somewhere in the stands near one of its spectators, thrown out over the pit.
        const seat = seats[Math.floor(Math.random() * seats.length)];
        const at = { x: seat.x + rand(-3, 3), y: seat.y + rand(-0.5, 1.5), z: seat.z + rand(-3, 3) };
        const a = Math.atan2(at.z - c.z, at.x - c.x);
        const out = rand(5, 11);
        client.fx.particles(at, PETALS[Math.floor(Math.random() * PETALS.length)], {
          count: 1,
          speed: 0.8,
          size: rand(0.12, 0.2),
          gravity: 2,
          glow: 0.08,
          life: rand(4, 6),
          spread: 0.6,
          up: rand(2, 4),
          drag: 0.7,
          velocity: { x: -Math.cos(a) * out, y: 0, z: -Math.sin(a) * out },
          collide: true,
        });
      }
    },
  };
}
