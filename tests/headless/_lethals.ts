import { throwables } from '../../src/platform/kits';
import { launch } from './_harness';

/** Probe: Call of Blocky's bots' lethals over three 2-minute matches: thrown, kills, and bots killed by their own. */
export default function lethals() {
  let self = 0;
  let kills = 0;
  let thrown = 0;
  for (const seed of [3, 4, 5]) {
    const h = launch('callofblocky', { seed, radius: 5 });
    h.ctx.events.on('playerDeath', (e) => {
      if (e.weapon !== 'frag' && e.weapon !== 'molotov') return;
      if (e.source === e.player) self++;
      else kills++;
    });
    let flying = 0;
    h.run(120, {
      pilot: () => null,
      until: (hh) => {
        const n = throwables.of(hh.ctx)!.thrown().length;
        if (n > flying) thrown += n - flying;
        flying = n;
        return false;
      },
    });
  }
  console.log(`  360 s: ${thrown} lethals thrown (at least), ${kills} kills with them, ${self} bots killed by their own`);
}
