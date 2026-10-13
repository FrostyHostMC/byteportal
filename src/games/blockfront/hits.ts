import type { GameContext } from '@platform';
import { FORCE } from './heroes/powers';

/**
 * What hurts in a stream, a little every tick for as long as it's held (lightning, a flamethrower
 * and the burning it leaves, a choke): its confirms come summed, a few a second, not one a tick.
 */
const STREAMS: ReadonlySet<string> = new Set([FORCE.lightning, FORCE.chain, FORCE.flame, FORCE.choke]);
/** A stream's confirms come at most this often (seconds). */
const EVERY = 0.3;

/**
 * Hit confirms: every time someone's hurt by a person (a bolt, a saber, a power, a detonator),
 * their screen hears of it (`bf.hit`: how much it took, a head hit, a kill, part of a stream), and
 * draws its hit marker from that (`client/hits.ts`). Bots have no screen.
 */
export function setupHits(game: GameContext) {
  /** Each attacker's stream: its harm not yet confirmed, and when it last was. */
  const streams = new Map<string, { owed: number; at: number }>();
  game.events.on('playerDamage', ({ player, amount, source, headshot, weapon }) => {
    if (!source || source === 'world' || source.kind !== 'player' || source === player || source.bot) return;
    const kill = player.health <= 0;
    if (weapon && STREAMS.has(weapon)) {
      let s = streams.get(source.id);
      if (!s) streams.set(source.id, (s = { owed: 0, at: -Infinity }));
      s.owed += amount;
      if (!kill && game.clock.now - s.at < EVERY) return;
      s.at = game.clock.now;
      game.clients.send(source, 'bf.hit', { n: Math.round(s.owed), h: false, k: kill, s: true });
      s.owed = 0;
      return;
    }
    game.clients.send(source, 'bf.hit', { n: Math.round(amount), h: !!headshot, k: kill });
  });
  game.events.on('playerLeave', ({ player }) => streams.delete(player.id));
}
