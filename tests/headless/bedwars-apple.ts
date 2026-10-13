import { check, launch } from './_harness';

type Bw = { match: { lobby: boolean } };

/**
 * A golden apple is eaten, not clicked: held 1.6 s (slowed), no health back till then, none if let
 * go sooner, and then its 4 hearts come back over 5 s.
 */
export default function bedwarsApple() {
  const h = launch('bedwars', { seed: 5, radius: 5 });
  const bw = (globalThis as unknown as { __bw: Bw }).__bw;
  h.run(120, { pilot: () => ({}), until: () => !bw.match.lobby && h.me.api.alive });
  const g = h.ctx;
  for (const b of [...g.bots.all]) b.freeze(true, { weapons: true });
  const me = h.me.api;
  me.inventory.clear();
  me.inventory.give('golden_apple', 2);
  me.inventory.select(0);
  me.protect?.(0);
  const hurt = () => {
    me.damage(10, { source: 'world', knockback: 0 });
    h.run(1, { pilot: () => ({}) });
  };
  hurt();
  const low = me.health;
  check(low < me.maxHealth, `not hurt (${low})`);
  const eat = { buttons: 4 };
  // Let go after 1 s: nothing eaten.
  h.run(1, { pilot: () => eat });
  check(me.health === low, `healed while eating (${low} -> ${me.health})`);
  h.run(0.5, { pilot: () => ({}) });
  check(me.inventory.count('golden_apple') === 2 && me.health === low, `let go early and it was eaten anyway (${me.inventory.count('golden_apple')} left, ${me.health} health)`);
  // Held the whole 1.6 s: eaten, then mended bit by bit.
  h.run(1.7, { pilot: () => eat });
  check(me.inventory.count('golden_apple') === 1, `not eaten after 1.7 s (${me.inventory.count('golden_apple')} left)`);
  const after = me.health;
  check(after - low < 2, `healed all at once (${low} -> ${after})`);
  h.run(2.5, { pilot: () => ({}) });
  const mid = me.health;
  check(mid > after + 2 && mid < low + 8, `not mending over time (${after} -> ${mid})`);
  h.run(3, { pilot: () => ({}) });
  // (Natural regeneration adds its bit too.)
  check(me.health >= Math.min(me.maxHealth, low + 8) - 0.2, `4 hearts not all back (${low} -> ${me.health})`);
  console.log(`  eaten in 1.6 s: ${low} → ${after.toFixed(1)} at once → ${mid.toFixed(1)} 2.5 s on → ${me.health.toFixed(1)}`);
}
