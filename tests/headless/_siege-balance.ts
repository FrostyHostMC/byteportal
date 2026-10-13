import { goldOf, vipHealth } from '../../src/games/siege/server';
import { launch, lastScreen } from './_harness';

/** Bots only (the one person idles, standing in the open): how far does the team get? Prints a timeline. */
export default function balance() {
  for (const seed of [1, 2, 3]) {
    const h = launch('siege-night', { seed });
    const g = h.ctx;
    let deaths = 0;
    let kills = 0;
    g.events.on('playerDeath', () => deaths++);
    g.events.on('entityDeath', ({ entity }) => ['rifleman', 'assaulter', 'heavy', 'demo'].includes(entity.type) && kills++);
    const line: string[] = [];
    let last = '';
    while (h.time < 800 && !lastScreen(h)) {
      h.run(5);
      const banner = h.find('hud', 'banner').at(-1)?.args[0] as string | undefined;
      if (banner && banner !== last) {
        last = banner;
        const alive = g.players.filter((p) => p.alive).length;
        const armour = g.players.filter((p) => p.bot).reduce((n, p) => n + p.armor / 5, 0);
        line.push(`${banner} @${h.time.toFixed(0)}s vip ${Math.ceil(vipHealth())} alive ${alive}/6 kills ${kills} deaths ${deaths} bot-armour-levels ${armour} gold(bots) ${g.players.filter((p) => p.bot).map((p) => goldOf(p)).join('/')}`);
      }
    }
    console.log(`seed ${seed}: ${lastScreen(h) ?? 'still going at 800 s'} at ${h.time.toFixed(0)}s, kills ${kills}, deaths ${deaths}, vip ${Math.ceil(vipHealth())}`);
    for (const l of line) console.log('   ', l);
  }
}
