import type { Headless } from '../../src/platform/host/headless';
import { check, launch, lastScreen } from './_harness';

/**
 * Heart Hunt: walk into all ten hearts and it's won. Its achievements: the first heart, all ten,
 * and all ten in under two minutes (a slow hunt doesn't earn that one).
 */
export default function heartHunt() {
  const quick = hunt(0);
  check(quick.achieved('first_heart') && quick.achieved('all_hearts') && quick.achieved('speedy'), 'a quick hunt earns all three');
  const slow = hunt(121);
  check(slow.achieved('all_hearts') && !slow.achieved('speedy'), 'a slow hunt: all ten, but not quickly');
  console.log('  ten hearts found, the victory screen; first heart, all ten, and the quick hunt (not the slow one)');
}

/** Wait this long, then go to each heart in turn. */
function hunt(wait: number) {
  const h = launch('heart-hunt', { seed: 2 });
  const me = h.ctx.player;
  h.run(1 + wait);
  const hearts = h.step(1 / 60).frame!.pickups.filter((p) => p.item === 'heart');
  check(hearts.length === 10, `ten hearts: ${hearts.length}`);
  hearts.forEach((p, i) => {
    me.teleport({ x: p.x, y: p.y - 0.5, z: p.z });
    h.run(0.5);
    if (i === 0) check(me.achieved('first_heart') && !me.achieved('all_hearts'), 'the first heart');
  });
  h.run(1);
  check(lastScreen(h) === 'You found them all!', `won: ${lastScreen(h)}`);
  check(pops(h).includes('Sweetheart') && pops(h).includes('Heart of Gold'), `they popped up: ${pops(h)}`);
  return me;
}

const pops = (h: Headless) => h.find('hud', 'achievement').map((c) => (c.args[0] as { title: string }).title);
