import type { GameMeta } from '@platform';
import type { ClientGame, GameEntry } from '@platform/client';
import callofblocky from './callofblocky/meta';
import blockfront from './blockfront/meta';
import blockjam from './blockjam/meta';
import blockice from './blockice/meta';
import arena from './arena/meta';
import starfighter from './starfighter/meta';
import skyship from './skyship/meta';
import bedwars from './bedwars/meta';
import obby from './obby/meta';
import sandbox from './sandbox/meta';
import heartHunt from './heart-hunt/meta';
import golf from './golf/meta';

/** A game in the catalog: its meta now, its client code (and shared code) when picked, a chunk of its own. */
const entry = (meta: GameMeta, load: () => Promise<{ default: ClientGame }>): GameEntry => ({ meta, load: () => load().then((m) => m.default) });

/** The browser's catalog: the games the launcher lists, in order (the first is the default). Each loads its client code when picked. */
export const games: GameEntry[] = [
  entry(callofblocky, () => import('./callofblocky/client')),
  entry(blockfront, () => import('./blockfront/client')),
  entry(blockjam, () => import('./blockjam/client')),
  entry(blockice, () => import('./blockice/client')),
  entry(arena, () => import('./arena/client')),
  entry(starfighter, () => import('./starfighter/client')),
  entry(skyship, () => import('./skyship/client')),
  entry(bedwars, () => import('./bedwars/client')),
  entry(golf, () => import('./golf/client')),
  entry(obby, () => import('./obby/client')),
  entry(sandbox, () => import('./sandbox/client')),
  entry(heartHunt, () => import('./heart-hunt/client')),
];

/** Development-only games (open by id, `?game=gallery`; not listed, not in production builds). */
export async function devGames(): Promise<GameEntry[]> {
  if (!import.meta.env.DEV) return [];
  const metas = await Promise.all([
    import('./starfighter/previews/shipyard.meta'),
    import('./starfighter/previews/drydock.meta'),
    import('./bedwars/previews/map.meta'),
    import('./bedwars/previews/art.meta'),
    import('./gallery/meta'),
    import('./callofblocky/previews/map.meta'),
    import('./callofblocky/previews/guns.meta'),
    import('./blockfront/previews/arsenal.meta'),
    import('./blockfront/previews/map.meta'),
    import('./moves/meta'),
    import('./highnoon/meta'),
    import('./lasertag/meta'),
    import('./siege/meta'),
  ]);
  const clients = [
    () => import('./starfighter/previews/shipyard.client'),
    () => import('./starfighter/previews/drydock.client'),
    () => import('./bedwars/previews/map.client'),
    () => import('./bedwars/previews/art.client'),
    () => import('./gallery/client'),
    () => import('./callofblocky/previews/map.client'),
    () => import('./callofblocky/previews/guns.client'),
    () => import('./blockfront/previews/arsenal.client'),
    () => import('./blockfront/previews/map.client'),
    () => import('./moves/client'),
    () => import('./highnoon/client'),
    () => import('./lasertag/client'),
    () => import('./siege/client'),
  ];
  return metas.map((m, i) => entry(m.default, clients[i]));
}
