import type { Entity, Player, Vec3 } from '@platform';
import type { ArenaMap } from '../maps';

/** XP just earned: how much, and what for ("KILL", "WAVE 7"). */
export type Gain = [amount: number, label: string];

/** Where a fighter stands in the Arena's levels (`run/progression.ts`), as the screens show it. */
export interface XpState {
  level: number;
  /** XP into this level, and how much the next takes (0 at the top level). */
  into: number;
  need: number;
  total: number;
  /** Not signed in: what they earn lasts the visit. */
  guest: boolean;
}

/** What reaching a level unlocked: a class, or a cosmetic (`meta.cosmetics`). */
export interface Unlock {
  kind: 'class' | 'cosmetic';
  id: string;
  name: string;
}

/** One fighter's run, for the end screen (`runEnd`). */
export interface RunResult {
  player: Player;
  /** Their class (`run/classes.ts`). */
  cls: string;
  kills: number;
  gold: number;
  damage: number;
  revives: number;
  /** Times they went down (downed, or fell). */
  downs: number;
  /** Their best wave on this map, all time (this run's counted), and whether this run set it. */
  best: number;
  newBest: boolean;
  /** This run's XP: the level they began at, where they are now, and what for (label, how many, how much). */
  xp: XpState & { from: number; earned: number; lines: [label: string, count: number, amount: number][] };
}

/**
 * The Arena's own events, between its parts: the director says a wave's begun, a monster says
 * it's slain, and whoever cares (gold, the crowd, the HUD, achievements) listens, so no part has to
 * call into another. Listeners are added in `setup` (`bus.clear()` first: one game per module).
 */
export interface ArenaEvents {
  /** A fight begins on `map` (after `start`, or a restart). */
  runStart: { map: ArenaMap };
  /** A wave begins: its number, name, twist and boss (ids), whether it's the last of the run, and whether it's past it (endless). */
  waveStart: { wave: number; name: string; twist: string | null; boss: string | null; final: boolean; endless: boolean };
  /** Every monster of the wave is down: the gold each fighter got for it. */
  waveCleared: { wave: number; final: boolean; endless: boolean; bonus: number };
  /** A monster (or a boss) came into the arena. */
  spawned: { entity: Entity; type: string };
  /** A monster died: who did it (a fighter, or nobody: a trap, another monster), with what, where. */
  slain: { entity: Entity; type: string; by: Player | null; weapon?: string; at: Vec3 };
  /** A fighter is on the ground bleeding out (`bleed` seconds), and back up (`by` a friend, or null: a feather, the wave won). */
  downed: { player: Player; bleed: number };
  revived: { player: Player; by: Player | null };
  /** A fighter is out of the wave (bled out, or fell with nobody to revive them), and back in it. */
  fell: { player: Player };
  rejoined: { player: Player };
  /** The fight is over: won (the last wave of the run cleared) or lost, how far it got, and each fighter's run. */
  runEnd: { won: boolean; wave: number; endless: boolean; map: ArenaMap; time: number; results: RunResult[] };
  /** Gold coins worth `value` scattered at `at` (a boss's loot shower), for the run to drop as it drops monsters' coins. */
  coins: { at: Vec3; value: number; by: Player | null };
  /** A fighter's gold changed (`delta` this time, `total` now), from `at` if it was picked up somewhere, and why. */
  gold: { player: Player; delta: number; total: number; at?: Vec3; why?: 'coin' | 'wave' | 'goblin' | 'boss' | 'gift' | 'start' | 'spend' | 'sold' };
  /** The crowd's hype (0..1); while the Crowd's Favour is on (`favour`), its seconds counting down as a fraction. */
  hype: { value: number; favour: boolean };
  /** Something worth a callout (the announcer, the crowd): a multikill, a parry, a trap kill… */
  feat: { player: Player | null; name: string; text: string };
  /** XP earned (people only): what for, and where it leaves them. */
  xp: { player: Player; gains: Gain[] } & XpState;
  /** A fighter reached a new level, and what it unlocked. */
  levelUp: { player: Player; level: number; unlocks: Unlock[] };
  /** A fighter took up a class (`run/classes.ts`). */
  classPicked: { player: Player; cls: string };
  /** A fighter's done with the class menu: chosen, kept what they had (closed it), or out of time. */
  classSet: { player: Player };
  /** Something bought at the shop (a ware's item id, `forge:<item>` at the forge), and what it cost. */
  bought: { player: Player; item: string; price: number };
  /** The mystery chest gave a fighter a weapon (or, `item` null, flew off). */
  chest: { player: Player; item: string | null };
  /** Between waves, a fighter's ready for the next (`ready` of the `of` people fighting are): all ready, it comes sooner. */
  ready: { player: Player; ready: number; of: number };
  /** A fighter chose to keep fighting past a victory, into the endless waves (the end screen's button). */
  keepFighting: { player: Player };
  /** A fighter took a blessing (`id`; `name` with its level: Berserker II), chosen or (`chosen` false) given them as the wave began. */
  blessed: { player: Player; id: string; name: string; text: string; chosen: boolean };
}

type Listener<K extends keyof ArenaEvents> = (e: ArenaEvents[K]) => void;

const listeners = new Map<keyof ArenaEvents, Listener<keyof ArenaEvents>[]>();

export const bus = {
  on<K extends keyof ArenaEvents>(name: K, fn: Listener<K>) {
    const list = listeners.get(name) ?? [];
    list.push(fn as Listener<keyof ArenaEvents>);
    listeners.set(name, list);
  },
  emit<K extends keyof ArenaEvents>(name: K, e: ArenaEvents[K]) {
    for (const fn of listeners.get(name) ?? []) fn(e);
  },
  clear() {
    listeners.clear();
  },
};
