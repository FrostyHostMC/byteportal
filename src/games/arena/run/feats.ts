import type { GameContext, Player } from '@platform';
import { bossKind } from '../bosses';
import { bus } from './bus';
import { feat } from './hype';
import { baseOf } from './loot';
import { runs, state } from './state';

/**
 * What a kill says about the one who made it: the run's tallies, the feats the crowd and the
 * announcer hear (multikills, blasts, traps, clutch kills, champions, goblins, bosses), and the
 * achievements for them.
 */

/** The kinds of weapon Master of Arms asks for, by the item a monster was slain with (its plain self: a rare iron sword is an iron sword). */
const ARMS: Record<string, string> = {
  wooden_sword: 'blade',
  stone_sword: 'blade',
  iron_sword: 'blade',
  diamond_sword: 'blade',
  gladius: 'blade',
  greatsword: 'blade',
  daggers: 'blade',
  battle_axe: 'heavy',
  warhammer: 'heavy',
  pike: 'polearm',
  spear: 'polearm',
  bow: 'bow',
  crossbow: 'bow',
  fire_staff: 'magic',
  frost_staff: 'magic',
  storm_wand: 'magic',
};
/** Master of Arms: this many kinds of weapon in one fight. */
const ARMS_NEEDED = 4;
/** What counts as a blast (Kaboom), and how close together its kills must fall. */
const BLASTS = new Set(['bomb', 'powder_keg', 'volatile', 'lightning', 'fire_staff', 'storm_wand']);
const BLAST_WINDOW = 0.4;
/** Kills this close together are one multikill. */
const MULTI_WINDOW = 1.2;
/** Monsters slain, all time: Arena Veteran, and Slayer. */
const VETERAN_KILLS = 250;
const SLAYER_KILLS = 2500;
/** A kill on this much health or less: a clutch kill. */
const CLUTCH = 2;
/** The bosses' achievements, for everyone in the fight when one falls. */
const BOSS_ACHIEVEMENTS: Record<string, string> = { colossus: 'colossus_slain', warden: 'warden_slain', broodmother: 'broodmother_slain', lich: 'lich_slain' };
/** The bosses' own feats that are achievements: whoever did it (everyone in the fight, if nobody's named). */
const BOSS_FEATS: Record<string, string> = { boss_crash: 'matador', boss_stagger: 'shell_shock' };

const MULTI = ['', '', 'double_kill', 'triple_kill', 'multi_kill'];
const MULTI_TEXT = ['', '', 'Double kill!', 'Triple kill!', 'Multi kill!'];

/** Each fighter's run of kills (when the last was, how many), and of blast kills. */
const multis = new Map<string, { at: number; n: number }>();
const blasts = new Map<string, { at: number; n: number }>();

function streak(map: Map<string, { at: number; n: number }>, p: Player, now: number, window: number): number {
  const b = map.get(p.id);
  const n = b && now - b.at < window ? b.n + 1 : 1;
  map.set(p.id, { at: now, n });
  return n;
}

/** A monster slain by a fighter: their tallies, feats and achievements. */
function slain(game: GameContext, p: Player, type: string, weapon: string | undefined, elite: boolean) {
  const now = game.clock.now;
  p.achieve('first_blood');
  const all = (p.store.get<number>('kills') ?? 0) + 1;
  p.store.set('kills', all);
  if (all >= VETERAN_KILLS) p.achieve('veteran');
  if (all >= SLAYER_KILLS) p.achieve('slayer');
  const r = runs.get(p.id);
  if (r) r.kills++;
  const base = weapon ? baseOf(weapon) : undefined;
  const kind = base && ARMS[base];
  if (r && kind) {
    r.arms.add(kind);
    if (r.arms.size >= ARMS_NEEDED) p.achieve('master_of_arms');
  }
  if (type === 'warden' && base === 'wooden_sword') p.achieve('splinters');

  const n = streak(multis, p, now, MULTI_WINDOW);
  if (n >= 5) {
    // Once at five, and again for each five more.
    if (n % 5 === 0) feat(p, 'rampage', n === 5 ? 'Rampage!' : `Rampage ×${n}!`);
    p.achieve('rampage');
  } else if (n >= 2) feat(p, MULTI[n], MULTI_TEXT[n]);
  if (weapon && BLASTS.has(weapon)) {
    const b = streak(blasts, p, now, BLAST_WINDOW);
    if (b === 3) feat(p, 'kaboom', 'Kaboom!');
    if (b >= 4) p.achieve('kaboom');
  }
  if (p.alive && p.health <= CLUTCH) {
    feat(p, 'clutch', 'Clutch!');
    p.achieve('clutch');
  }
  if (elite && !bossKind(type)) feat(p, 'elite', 'Champion slain!');
}

/** Endless waves reached: Into the Abyss, and Legend of the Arena. */
const DEEP: [number, string][] = [
  [25, 'abyss'],
  [30, 'legend'],
];

export function featsListen(game: GameContext) {
  bus.on('feat', ({ player, name }) => {
    const a = BOSS_FEATS[name];
    if (a) for (const p of player ? [player] : game.players) p.achieve(a);
  });
  bus.on('waveStart', ({ wave }) => {
    for (const [n, id] of DEEP) if (wave >= n) for (const p of game.players) p.achieve(id);
  });
  bus.on('slain', ({ entity, type, by, weapon }) => {
    if (by) {
      state.kills++;
      slain(game, by, type, weapon, !!entity.data.elite);
    }
    if (weapon === 'trap') feat(by, 'trap', 'Trap kill!');
    if (type === 'goblin' && by) {
      feat(by, 'goblin', `${by.name} caught the Treasure Goblin!`);
      by.achieve('pickpocket');
    }
    const boss = bossKind(type);
    if (boss) {
      feat(by, 'boss_slain', `${boss.name} is slain!`);
      const a = BOSS_ACHIEVEMENTS[type];
      if (a) for (const p of game.players) p.achieve(a);
    }
  });
}

/** A fresh fight: nobody on a run of kills. */
export function resetFeats() {
  multis.clear();
  blasts.clear();
}
