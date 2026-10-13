/**
 * The bosses' ids, for code that only needs to know whether a type is a boss without reaching the
 * bosses' own code (the armory's statuses, which the screens' code names types from).
 * `bosses/index.ts` checks this list against `BOSSES` when it loads.
 */
export const BOSS_IDS: ReadonlySet<string> = new Set(['colossus', 'warden', 'broodmother', 'lich']);

export const isBossType = (type: string): boolean => BOSS_IDS.has(type);
