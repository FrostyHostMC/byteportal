import type { Entity, GameContext, Player } from '@platform';
import { share } from './coins';
import { monsterKind } from '../monsters';
import { bossKind } from '../bosses';
import { bus, type Gain, type RunResult, type Unlock, type XpState } from './bus';
import { map, runs, state } from './state';

/**
 * XP, levels 1 to 30 and what they unlock, kept for each account (`player.store`, `arena`): the
 * classes and the Arena's cosmetics come with levels; each fighter's best wave on each map is kept
 * there too, and the game's record for each map in `game.store`. XP comes from kills (a monster's
 * cost to the director, more for a champion, most for a boss), feats, revives, waves won (more for
 * a boss's), and winning the run. Only people earn it. Guests keep it for the visit.
 *
 * What each screen is told: `xp` on the bus (and `arena.xp` to their screen) with every gain, and
 * `levelUp` with what a level unlocked; the end of a run (`results`) gives each fighter's whole
 * run for the end screen (`RunResult`).
 */
export const MAX_LEVEL = 30;

/** XP from level `l` to the next: 800 to reach level 2, then 200 more each level (a run won is about seven levels' worth, at first). */
export const xpToNext = (l: number) => (l >= MAX_LEVEL ? 0 : 800 + 200 * (l - 1));
/** Total XP at the start of level `l` (level 2: 800; level 10: 14,400; level 30: 104,400). */
export const xpForLevel = (l: number) => 800 * (l - 1) + 100 * (l - 1) * (l - 2);

export function levelOf(xp: number): number {
  let l = 1;
  while (l < MAX_LEVEL && xp >= xpForLevel(l + 1)) l++;
  return l;
}

/** What unlocks when (the classes' own levels are theirs: `classes.ts`). */
export const UNLOCKS: (Unlock & { level: number })[] = [
  { level: 1, kind: 'class', id: 'gladiator', name: 'Gladiator' },
  { level: 1, kind: 'class', id: 'hunter', name: 'Hunter' },
  { level: 3, kind: 'cosmetic', id: 'bronze_helm', name: 'Bronze Helm' },
  { level: 4, kind: 'class', id: 'berserker', name: 'Berserker' },
  { level: 6, kind: 'cosmetic', id: 'crimson_cape', name: 'Crimson Cape' },
  { level: 8, kind: 'class', id: 'pyromancer', name: 'Pyromancer' },
  { level: 10, kind: 'cosmetic', id: 'pit_fighter', name: 'Pit Fighter' },
  { level: 15, kind: 'cosmetic', id: 'plumed_helm', name: 'Plumed Helm' },
  { level: 20, kind: 'cosmetic', id: 'phoenix_wings', name: 'Phoenix Wings' },
  { level: 25, kind: 'cosmetic', id: 'blood_gold', name: 'Blood and Gold' },
  { level: 30, kind: 'cosmetic', id: 'emperors_laurels', name: 'The Emperor’s Laurels' },
];

export const XP = {
  /** Each point of a monster's cost (a zombie's 1, a brute's 6); a champion's twice that. */
  kill: 6,
  boss: 400,
  /** Each fighter, for each wave won: this and this much more a wave; a boss's wave more again. */
  wave: 40,
  perWave: 8,
  bossWave: 250,
  win: 1500,
  revive: 75,
  feats: { double_kill: 20, triple_kill: 40, multi_kill: 60, rampage: 100, kaboom: 50, clutch: 40, goblin: 100, untouched: 50, last_stand: 150, trap: 15 } as Record<string, number>,
};

/** What's kept for each account. */
interface Saved {
  xp: number;
  /** Their best wave on each map (by id). */
  best: Record<string, number>;
  wins: number;
}

const read = (p: Player): Saved => {
  const s = p.store.get<Partial<Saved>>('arena');
  return { xp: Math.max(0, Number(s?.xp) || 0), best: { ...(s?.best ?? {}) }, wins: Math.max(0, Number(s?.wins) || 0) };
};
const keep = (p: Player, s: Partial<Saved>) => p.store.set('arena', { ...read(p), ...s });

/** A fighter's XP, all time. */
export const savedXp = (p: Player) => read(p).xp;

/** Where they stand, as the screens show it. */
export function progressOf(p: Player): XpState {
  const xp = savedXp(p);
  const level = levelOf(xp);
  return { level, into: xp - xpForLevel(level), need: xpToNext(level), total: xp, guest: !p.account };
}

/** This run's XP for each fighter: the level they began it at, and what for (label: how many, how much). */
const tallies = new Map<string, { from: number; lines: Map<string, [number, number]> }>();

function tally(p: Player) {
  let t = tallies.get(p.id);
  if (!t) tallies.set(p.id, (t = { from: levelOf(savedXp(p)), lines: new Map() }));
  return t;
}

/** Add XP (people only) and tell their screen; a level reached unlocks what it unlocks. */
export function award(game: GameContext, p: Player, gains: Gain[], opts: { quiet?: boolean } = {}) {
  if (p.bot) return;
  gains = gains.filter(([n]) => n > 0).map(([n, label]) => [Math.round(n), label]);
  if (!gains.length) return;
  const t = tally(p);
  const before = savedXp(p);
  const sum = gains.reduce((a, [n]) => a + n, 0);
  keep(p, { xp: before + sum });
  for (const [n, label] of gains) {
    const e = t.lines.get(label) ?? [0, 0];
    t.lines.set(label, [e[0] + 1, e[1] + n]);
  }
  const now = progressOf(p);
  bus.emit('xp', { player: p, gains, ...now });
  game.clients.send(p, 'arena.xp', { ...now, gains: opts.quiet ? [] : gains });
  const was = levelOf(before);
  if (now.level > was) levelUp(p, was, now.level);
}

function levelUp(p: Player, from: number, to: number) {
  const unlocks = UNLOCKS.filter((u) => u.level > from && u.level <= to).map(({ kind, id, name }) => ({ kind, id, name }));
  for (const u of unlocks) if (u.kind === 'cosmetic') p.grant(u.id);
  p.audio.play('levelup');
  if (to >= 10) p.achieve('rising_star');
  if (to >= MAX_LEVEL) p.achieve('arena_legend');
  bus.emit('levelUp', { player: p, level: to, unlocks });
}

/** A kill's worth: its cost to the director, a champion's twice, a boss's its own; a fifth for one brought in by another (a raised zombie, a slime's split, a minion: `coins.ts`'s `share`). */
function killXp(e: Entity): number {
  if (bossKind(e.type)) return XP.boss;
  if (e.type === 'goblin') return XP.feats.goblin;
  return (monsterKind(e.type)?.cost ?? 1) * XP.kill * (e.data.elite ? 2 : 1) * Math.max(0.2, share(e));
}

export function progressionListen(game: GameContext) {
  bus.on('slain', ({ entity, type, by }) => {
    if (by) award(game, by, [[killXp(entity), bossKind(type) ? 'BOSS SLAIN' : entity.data.elite ? 'CHAMPION' : 'KILL']]);
  });
  bus.on('feat', ({ player, name }) => {
    const n = XP.feats[name];
    if (player && n && name !== 'goblin') award(game, player, [[n, name.replace(/_/g, ' ').toUpperCase()]]);
  });
  bus.on('revived', ({ by }) => {
    if (by) award(game, by, [[XP.revive, 'REVIVE']]);
  });
  bus.on('waveCleared', ({ wave, endless }) => {
    const boss = !!state.boss;
    const n = Math.round((XP.wave + XP.perWave * wave) * (endless ? 1.5 : 1));
    for (const p of game.players) {
      const gains: Gain[] = [[n, 'WAVES']];
      if (boss) gains.push([XP.bossWave, 'BOSS WAVES']);
      award(game, p, gains);
    }
  });
  game.events.on('playerJoin', ({ player }) => {
    if (player.bot) return;
    tallies.delete(player.id);
    tally(player);
    game.clients.send(player, 'arena.xp', { ...progressOf(player), gains: [] });
    if (!player.account) player.hud.toast('Playing as a guest: sign in on the home page to keep your levels');
  });
  game.events.on('playerReady', ({ player }) => game.clients.send(player, 'arena.xp', { ...progressOf(player), gains: [] }));
  game.events.on('playerLeave', ({ player }) => tallies.delete(player.id));
  // For trying out levels (development, or a server with cheats).
  game.commands.register('xp', {
    usage: '<amount>',
    help: 'Give yourself Arena XP',
    cheat: true,
    run: ([n], g, me) => {
      const amount = Math.round(Number(n));
      if (!(amount > 0)) throw new Error('How much?');
      award(g, me, [[amount, 'BONUS']]);
      return `Level ${progressOf(me).level}, ${savedXp(me)} XP`;
    },
  });
}

/** A run begins: everyone's tally starts again from where they are. */
export function startProgression(game: GameContext) {
  tallies.clear();
  for (const p of game.players) if (!p.bot) tally(p);
}

/**
 * The run's over (won, or lost on wave `state.wave`): the win's XP, each fighter's best on this
 * map and the map's record, and everyone's run as the end screen shows it.
 */
export function results(game: GameContext, won: boolean): RunResult[] {
  const reached = state.wave;
  const m = map();
  const record = game.store.get<{ wave: number; names: string[] }>(`record:${m.id}`) ?? { wave: 0, names: [] };
  const out: RunResult[] = [];
  for (const p of game.players) {
    const r = runs.get(p.id);
    if (won && !p.bot) {
      award(game, p, [[XP.win, 'VICTORY']], { quiet: true });
      keep(p, { wins: read(p).wins + 1 });
    }
    const s = read(p);
    const was = s.best[m.id] ?? 0;
    const newBest = !p.bot && reached > was;
    if (newBest) keep(p, { best: { ...s.best, [m.id]: reached } });
    if (!p.bot && reached >= record.wave) {
      if (reached > record.wave) record.names = [];
      record.wave = reached;
      if (!record.names.includes(p.name)) record.names.push(p.name);
    }
    const t = tally(p);
    const lines = [...t.lines].map(([label, [count, amount]]) => [label, count, amount] as [string, number, number]).sort((a, b) => b[2] - a[2]);
    out.push({
      player: p,
      cls: r?.cls ?? 'gladiator',
      kills: r?.kills ?? 0,
      gold: r?.gold ?? 0,
      damage: Math.round(r?.damage ?? 0),
      revives: r?.revives ?? 0,
      downs: r?.downs ?? 0,
      best: Math.max(was, reached),
      newBest,
      xp: { ...progressOf(p), from: t.from, earned: lines.reduce((a, l) => a + l[2], 0), lines },
    });
  }
  if (record.wave > 0) game.store.set(`record:${m.id}`, record);
  return out;
}

/** The record on this map: the furthest wave anyone has reached, and who. */
export const record = (game: GameContext) => game.store.get<{ wave: number; names: string[] }>(`record:${map().id}`) ?? null;
