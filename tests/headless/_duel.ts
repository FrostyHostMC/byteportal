import type { Bot } from '../../src/platform';
import { launch } from './_harness';

/**
 * A probe, not a test (`node scripts/headless.mjs tests/headless/_duel.ts`): how long a Call of
 * Blocky bot takes to kill someone standing still in the open, by distance and skill. A person
 * does it in about 0.8 s with the rifle (react, aim, four shots); bots should be slower.
 */
export default function duel() {
  for (const dist of [8, 18, 30]) {
    const times: number[] = [];
    for (let run = 0; run < 12; run++) {
      const h = launch('callofblocky', { seed: 100 + run, radius: 5 });
      const g = h.ctx;
      h.run(1, { pilot: () => null });
      const bots = [...g.bots.all];
      const shooter = bots[0] as Bot;
      for (const b of bots.slice(1)) g.bots.remove(b);
      const me = g.player;
      // Out of its sight first (it forgets who it was after), then out in the street in front of it.
      me.teleport({ x: -30.5, y: 90, z: 60.5 }, 0, 0);
      shooter.teleport({ x: -30.5 + dist, y: 64, z: 0.5 }, Math.PI / 2, 0);
      shooter.inventory.clear();
      shooter.inventory.give('rifle');
      h.run(1.5, { pilot: () => null });
      me.teleport({ x: -30.5, y: 64, z: 0.5 }, 0, 0);
      me.health = me.maxHealth;
      const t0 = h.time;
      h.run(8, { pilot: () => null, until: () => !me.alive });
      times.push(me.alive ? 8 : h.time - t0);
    }
    times.sort((a, b) => a - b);
    const mean = times.reduce((a, b) => a + b, 0) / times.length;
    console.log(`  ${String(dist).padStart(2)} blocks: kills in ${mean.toFixed(2)} s on average (median ${times[times.length >> 1].toFixed(2)}, fastest ${times[0].toFixed(2)}, slowest ${times.at(-1)!.toFixed(2)})`);
  }
}
