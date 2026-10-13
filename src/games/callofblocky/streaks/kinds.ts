/**
 * The killstreaks you call in (free-for-all and Team Deathmatch): what each is called and how many
 * kills in a row earn it. Earned ones wait until called in (5), latest first, and last until the
 * match ends. (The rest come at once: `KILLSTREAKS`, below, and `server.ts`.)
 */
export type StreakId = 'hellstorm' | 'chopper';

export interface StreakInfo {
  name: string;
  kills: number;
  /** What it does, in a line. */
  blurb: string;
}

export const STREAKS: Record<StreakId, StreakInfo> = {
  hellstorm: { name: 'Hellstorm', kills: 7, blurb: 'Steer a missile down onto them from the sky' },
  chopper: { name: 'Attack Chopper', kills: 10, blurb: 'Fly a gunship over the map and work its cannon' },
};

export const STREAK_IDS = Object.keys(STREAKS) as StreakId[];

export const isStreak = (id: string | undefined): id is StreakId => !!id && id in STREAKS;

/**
 * Every killstreak there is, cheapest first: each fighter picks `PICKS` of them (the loadout, L),
 * and earns each at its count of kills in a row. The UAV, the Counter-UAV and the Adrenaline Shot
 * come at once and work in every mode; the Mortar Team (at once too) and the two you call in hurt
 * people, so they're for the free-for-all and Team Deathmatch only (`lethal`): in The Briefcase
 * they're not on the dossier's cards and never come.
 */
export type KillstreakId = 'uav' | 'counter' | 'rush' | 'mortar' | StreakId;

export interface KillstreakInfo extends StreakInfo {
  /** It hurts people: not in The Briefcase. */
  lethal?: boolean;
}

export const KILLSTREAKS: Record<KillstreakId, KillstreakInfo> = {
  uav: { name: 'UAV', kills: 3, blurb: 'Everyone on your radar for 25 seconds' },
  counter: { name: 'Counter-UAV', kills: 4, blurb: "Jams the other side's radar for 25 seconds" },
  rush: { name: 'Adrenaline Shot', kills: 5, blurb: 'Faster and patched up, for 15 seconds' },
  mortar: { name: 'Mortar Team', kills: 6, blurb: 'Three shells on where your enemies stand', lethal: true },
  hellstorm: { ...STREAKS.hellstorm, lethal: true },
  chopper: { ...STREAKS.chopper, lethal: true },
};

export const KILLSTREAK_IDS = Object.keys(KILLSTREAKS) as KillstreakId[];

/** How many killstreaks a fighter takes into a match. */
export const PICKS = 3;

/** What a fighter takes until they pick their own. */
export const DEFAULT_KILLSTREAKS: KillstreakId[] = ['uav', 'hellstorm', 'chopper'];

export const isKillstreak = (id: string | undefined): id is KillstreakId => !!id && id in KILLSTREAKS;

/** A weapon that's a killstreak's (its kills are the streak's, not a gun's). */
export const isStreakWeapon = (id: string | undefined) => id === 'mortar' || isStreak(id);
