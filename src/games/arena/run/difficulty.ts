/**
 * How hard the run is, in one place. The monsters' blows and how much it takes to bring one down
 * (as if it had this many times its health: a blow on it is divided, as the elites' and the
 * bosses' own toughness are), for every monster and every boss; the late waves' growth; how many
 * come, how many at once and how fast, and the champions among them; and the cushions: gold,
 * the breather's mending, health coming back, a potion's worth. The director (which puts the
 * blows on each monster as it comes in, and sets the bestiary's elites and the armory's potion
 * from here: `director.ts`), the coins, the flow and the shared rules read their numbers here.
 * Only numbers: the screens' shared rules read it too.
 */
export const DIFFICULTY = {
  /** Every monster (and what a boss or a monster brings in): its blows, times; how tough, times. */
  monster: { hits: 1.2, tough: 1.15 },
  /** Every boss from wave `from`. */
  boss: { hits: 1.15, tough: 1.2, from: 1 },
  /** From wave `from`, the ordinary monsters come tougher and hit harder each wave (on top; not in a boss's wave, whose fight is tuned as it is). */
  grow: { from: 5, tough: 0.05, hits: 0.04 },
  /** A wave's monsters (besides a boss's wave and the ones that come singly), times this from wave `from`. */
  more: { from: 3, by: 1.2 },
  /** At most this many in the arena at once: from each wave on (a Frenzy's four more, up to `most`). */
  alive: [
    [1, 10],
    [4, 11],
    [6, 16],
    [12, 18],
  ] as [number, number][],
  most: 20,
  /** Seconds between monsters coming in. */
  spawnEvery: 0.75,
  /** Gold a monster spills, for each of its cost to the director. */
  goldPerCost: 3,
  /** Hearts (half-hearts) mended for everyone when a wave's won. */
  breakHeal: 3,
  /** Health coming back on its own: after this long unhurt, this much a second (the shared rules'). */
  regen: { delay: 6, perSecond: 0.35 },
  /** What a health potion mends (half-hearts). */
  potionHeal: 10,
  /** Champions (the bestiary's elites): from this wave, the bestiary's chance times `scale`, at most `cap`. */
  elites: { from: 6, scale: 1, cap: 0.6 },
};
