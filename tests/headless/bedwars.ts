import { check, launch, lastScreen } from './_harness';

/**
 * The bots play a Bed Wars match on their own: they gather, bridge across, break beds and fight.
 * The human player stands idle at home, so the match should end with their team eliminated.
 */
export default function bedwars() {
  const t0 = performance.now();
  // The whole map loaded (the public room's first match is on the second map, Sunscar Canyon,
  // whose far islands are 115 blocks from red's spawn).
  const h = launch('bedwars', { seed: 5, radius: 9 });
  const simulated = h.run(900, { pilot: () => ({}), until: () => lastScreen(h) !== undefined });
  const beds = h.find('hud', 'banner').filter((c) => c.args[0] === 'BED DESTRUCTION' || c.args[0] === 'BED DESTROYED!').length;
  const kills = h.find('hud', 'feed').filter((c) => / (was|were) slain by /.test(String(c.args[0]))).length;
  const wall = (performance.now() - t0) / 1000;
  console.log(`  ${lastScreen(h) ?? 'no result'} after ${simulated.toFixed(0)} s of game time, ${wall.toFixed(1)} s wall clock · ${beds} beds broken · ${kills} kills`);
  check(beds >= 1, 'no bed was broken');
  check(lastScreen(h) === 'GAME OVER', `expected GAME OVER for the idle player, got ${lastScreen(h) ?? 'nothing'}`);
  // The bots' kills and beds are nobody's achievements; the idle player earned none.
  check(!h.find('hud', 'achievement').length, `achievements for an idle player: ${h.find('hud', 'achievement').map((c) => (c.args[0] as { title: string }).title).join(', ')}`);
}
