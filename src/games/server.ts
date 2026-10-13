import type { GameDefinition } from '@platform';
import callofblocky from './callofblocky/server';
import blockfront from './blockfront/server';
import blockjam from './blockjam/server';
import blockice from './blockice/server';
import arena from './arena/server';
import starfighter from './starfighter/server';
import skyship from './skyship/server';
import bedwars from './bedwars/server';
import obby from './obby/server';
import sandbox from './sandbox/server';
import heartHunt from './heart-hunt/server';
import golf from './golf/server';

/** The games a server hosts, as it runs them (shared definition and rules), in the launcher's order. */
export const games: GameDefinition[] = [callofblocky, blockfront, blockjam, blockice, arena, starfighter, skyship, bedwars, golf, obby, sandbox, heartHunt];

/**
 * Development-only games (a development server hosts them when named; the headless tests use
 * them): the art previews, the model gallery, the movement lab, High Noon and Laser Tag (the item-kit litmus), and the
 * built-in Siege Night (the community's upload, siege-night-ops, is the one played). Whether a server
 * offers them is its own decision.
 */
export async function devGames(): Promise<GameDefinition[]> {
  const loaded = await Promise.all([
    import('./starfighter/previews/shipyard.server'),
    import('./starfighter/previews/drydock.server'),
    import('./bedwars/previews/map.server'),
    import('./bedwars/previews/art.server'),
    import('./gallery/server'),
    import('./callofblocky/previews/map.server'),
    import('./callofblocky/previews/guns.server'),
    import('./blockfront/previews/arsenal.server'),
    import('./blockfront/previews/map.server'),
    import('./moves/server'),
    import('./highnoon/server'),
    import('./lasertag/server'),
    import('./siege/server'),
  ]);
  return loaded.map((m) => m.default);
}
