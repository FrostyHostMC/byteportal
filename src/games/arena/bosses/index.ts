import type { GameContext } from '@platform';
import { registerKind } from '../run/spawn';
import { BOSS_IDS } from './ids';
import type { BossKind } from './registry';
import { colossus } from './colossus';
import { warden } from './warden';
import { broodmother } from './broodmother';
import { lich } from './lich';
import { MINIONS } from './minions';

export type { BossKind } from './registry';

/** Every boss, in the order the run meets them (waves 5, 10, 15 and 20). */
export const BOSSES: readonly BossKind[] = [colossus, warden, broodmother, lich];

const byId = new Map(BOSSES.map((b) => [b.id, b]));
// (`ids.ts` lists them for code that mustn't reach this module: it has to agree.)
if (BOSSES.length !== BOSS_IDS.size || BOSSES.some((b) => !BOSS_IDS.has(b.id))) throw new Error(`bosses/ids.ts is out of date: ${BOSSES.map((b) => b.id).join(', ')}`);
export const bossKind = (id: string): BossKind | undefined => byId.get(id);

/** Each boss's girth (its hitbox's width, blocks), as defined. */
const widths = new Map<string, number>();
export const bossWidth = (id: string): number => widths.get(id) ?? 1;

/** Every boss's platform definition and hooks, and their minions' (in `setup`). */
export function defineBosses(game: GameContext) {
  for (const b of [...BOSSES, ...MINIONS]) {
    const def = b.define(game);
    game.entities.define(b.id, def);
    registerKind(b.id, b);
    widths.set(b.id, def.hitbox.width);
  }
}
