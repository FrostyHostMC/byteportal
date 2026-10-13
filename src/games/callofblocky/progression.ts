import type { GameContext, IconRef, MenuEntry, Player } from '@platform';
import { ATLAS, OUTFITS, skinOrigin } from './art';
import { FIGHTERS as FIGHTER_MODELS } from './models/fighters';
import { COLORS, fighterModel } from './shared';
import { LETHALS, WEAPONS } from './weapons';

/**
 * XP, levels and unlocks: everything a person earns on Jackrabbit Lane, kept for their account
 * (`player.store`, `xp`), so it follows them across matches, rooms and restarts. Only the server awards XP, only while a match is on, and only to people: bots are
 * never limited and never earn anything (a bot killing a bot is worth nothing to anyone).
 *
 * Own rooms (`instances`) count too: they share the game's store with the public room, and a game
 * can't tell them apart. So what can be farmed there is kept small: the time bonus only counts
 * minutes someone fired in, the placing bonus needs a minute in the match and a shot fired, and
 * kills on the same person past the fifth in a match are worth half.
 *
 * Guests (no name typed: "Player", "Player 2"…) share one name, so they earn XP for the session
 * only and start again at level 1 next time; so does any brand-new name.
 *
 * The rules' hooks (server.ts): `setupProgression(game)` in `setup` (before the game's own
 * `playerDeath` listener, so the kill that ends a match still counts), `matchStart()` in `start`,
 * `matchOver(results)` when a match ends, `gate` and `outfits` in the loadout menu, `outfitFor` when
 * someone joins. Everything else it hears for itself (`playerDeath`, `playerDamage`, `pickup`,
 * `shot`). Each screen draws it (`client/progression.ts`): the bar and badge, the ticker of gains,
 * the level-up, the match's XP; this sends them what to show, and nothing else.
 */

// -------------------------------------------------------------------------------------------------
// The curve and the unlocks
// -------------------------------------------------------------------------------------------------

export const MAX_LEVEL = 30;

/** XP from level `l` to the next: 800 to reach level 2, then 200 more each level (6,400 for 29 → 30). */
export const xpToNext = (l: number) => (l >= MAX_LEVEL ? 0 : 800 + 200 * (l - 1));

/** Total XP at the start of level `l` (level 2: 800; level 10: 14,400; level 30: 104,400). */
export const xpForLevel = (l: number) => 800 * (l - 1) + 100 * (l - 1) * (l - 2);

export function levelOf(xp: number): number {
  let l = 1;
  while (l < MAX_LEVEL && xp >= xpForLevel(l + 1)) l++;
  return l;
}

export type UnlockKind = 'primary' | 'sidearm' | 'melee' | 'lethal' | 'outfit';

export interface Unlock {
  level: number;
  kind: UnlockKind;
  /** An item id, or an outfit's (`outfit_bowler`). */
  id: string;
  name: string;
}

/**
 * An outfit's id (after its fighter: `outfit_bowler`). Each is named like an item (`defineOutfits`),
 * so the server can show one by name (`{ item: 'outfit_bowler' }` in a menu, a level-up) and each
 * screen draws it as it has it: its fighter's picture (`client/progression.ts` gives the look).
 */
export const outfitId = (i: number) => `outfit_${FIGHTER_MODELS[i % FIGHTER_MODELS.length].id}`;

const item = (level: number, kind: UnlockKind, id: string): Unlock => ({ level, kind, id, name: WEAPONS[id]?.name ?? LETHALS[id]?.name ?? id });
const outfit = (level: number, id: string): Unlock => {
  const i = FIGHTER_MODELS.findIndex((m) => m.id === id);
  return { level, kind: 'outfit', id: `outfit_${id}`, name: OUTFITS[i]?.name ?? id };
};

/**
 * What unlocks when. At level 1: the Big Kahuna, the Lucky 45, the katana and the Pineapple, and
 * five outfits (plenty for a street of six: people get one nobody else has on).
 */
export const UNLOCKS: Unlock[] = [
  item(1, 'primary', 'rifle'),
  item(1, 'sidearm', 'pistol'),
  item(1, 'melee', 'katana'),
  item(1, 'lethal', 'frag'),
  outfit(1, 'hitman'),
  outfit(1, 'partner'),
  outfit(1, 'bride'),
  outfit(1, 'wife'),
  outfit(1, 'boxer'),
  item(2, 'primary', 'smg'),
  outfit(3, 'bowler'),
  item(4, 'primary', 'shotgun'),
  item(5, 'primary', 'tommy'),
  item(6, 'lethal', 'molotov'),
  item(7, 'primary', 'sawnoff'),
  item(8, 'primary', 'sniper'),
  item(9, 'sidearm', 'revolver'),
  outfit(10, 'crooner'),
  item(11, 'primary', 'lmg'),
  item(12, 'primary', 'famas'),
  item(13, 'primary', 'marksman'),
  outfit(15, 'kahuna'),
  outfit(20, 'waitress'),
  outfit(30, 'boss'),
];

const UNLOCK_AT = new Map(UNLOCKS.map((u) => [u.id, u]));

/** The level something unlocks at (1 for anything not in the table). */
export const unlockLevel = (id: string) => UNLOCK_AT.get(id)?.level ?? 1;

// -------------------------------------------------------------------------------------------------
// What's worth what
// -------------------------------------------------------------------------------------------------

export const XP = {
  kill: 100,
  headshot: 50,
  wallbang: 50,
  longshot: 50,
  /** A kill with a frag or a molotov. */
  lethal: 50,
  katana: 25,
  firstBlood: 50,
  /** Each kill of a double, triple…: 50 for a double, 100 a triple, 150 a massacre. */
  multi: 50,
  /** Someone else finished off a person you'd hurt (20 or more in the last 10 seconds). */
  assist: 50,
  briefcase: 300,
  /** At 3 and 5 kills without dying, then every 5 more. */
  streak: { 3: 100, 5: 200, more: 250 } as const,
  win: 300,
  /** By place: 1st, 2nd, 3rd, the rest. */
  place: [200, 150, 100, 50] as const,
  /** Each minute of a match someone played (fired in). */
  minute: 10,
};
/** A long shot: a gun kill from this far (blocks). */
export const LONG_SHOT = 30;
const ASSIST_DAMAGE = 20;
const ASSIST_WINDOW = 10;
const MULTI_WINDOW = 4;
/** Kills on the same person in a match past this many are worth half. */
const SAME_VICTIM = 5;

/** A gain: how much, and what for ("KILL", "HEADSHOT"). */
export type Gain = [amount: number, label: string];

/** What each screen is told (`client/progression.ts` draws it). */
export interface XpState {
  level: number;
  /** XP into this level, and how much it takes (0 at the top level). */
  into: number;
  need: number;
  total: number;
  guest: boolean;
  /** What was just earned, for the ticker (none: it's just the bar). */
  gains?: Gain[];
}

export interface LevelUp {
  level: number;
  unlocks: { kind: UnlockKind; id: string; name: string; icon?: IconRef }[];
}

export interface MatchXp extends XpState {
  /** The level they started the match at. */
  from: number;
  /** This match's XP, by what for: label, how many times, how much. */
  lines: [label: string, count: number, amount: number][];
  earned: number;
}

/** A player's place when a match ends: 1 is first; `won` if they (or their side) took it. */
export interface MatchResult {
  player: Player;
  place: number;
  won: boolean;
}

export interface Progression {
  /** A match is on: XP counts from now (`start`). */
  matchStart(): void;
  /** The match is over: placing XP, and each person's match summary (call once, when it ends). */
  matchOver(results: readonly MatchResult[]): void;
  /**
   * XP for something a mode counts that this doesn't hear for itself (a bomb planted, defused):
   * `earn(player, 200, 'PLANTED')`. Only people, only while a match is on; it pops on their ticker.
   */
  earn(player: Player, amount: number, label: string): void;
  /** Whether they may carry or wear it (`rifle`, `outfit_boss`): bots always. */
  has(player: Player, id: string): boolean;
  /** Their level (bots: the top). */
  level(player: Player): number;
  /**
   * A loadout menu entry for `id`, as the player may have it: locked, it's greyed out with the
   * level it unlocks at on a tag ("LV 8"), and choosing it anyway (a stale menu, a forged pick) is
   * refused with a word of why.
   */
  gate(player: Player, id: string, entry: MenuEntry): MenuEntry;
  /** The loadout menu's outfits: `current` highlighted, the locked greyed out; `picked(i)` once they're wearing it. */
  outfits(player: Player, current: number, picked: (outfit: number) => void): { title: string; entries: MenuEntry[] };
  /** The outfit someone joins in: their last pick if they still have it, else one they've unlocked nobody's wearing. */
  outfitFor(player: Player, taken: ReadonlySet<number>): number;
}

// -------------------------------------------------------------------------------------------------
// Keeping it
// -------------------------------------------------------------------------------------------------

/** Kept for each person (`player.store`, `xp`). */
interface Saved {
  xp: number;
  /** The outfit they last picked. */
  outfit?: number;
}

/** A person in this room, this match. */
interface Tally {
  player: Player;
  /** Not signed in: what they earn lasts the visit (`player.store` keeps it that long). */
  guest: boolean;
  /** The level at the start of the match (or when they came in). */
  from: number;
  joinedAt: number;
  fired: boolean;
  /** They fired since the last minute's tick. */
  busy: boolean;
  streak: number;
  multi: number;
  lastKillAt: number;
  /** This match's XP by label: how many, how much. */
  earned: Map<string, [number, number]>;
  /** Kills on each person (by name) this match. */
  victims: Map<string, number>;
}

const ordinal = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'ST' : n % 10 === 2 && n % 100 !== 12 ? 'ND' : n % 10 === 3 && n % 100 !== 13 ? 'RD' : 'TH'}`;

/** What someone sees for an unlock: its icon as each screen has it (a gun side on; an outfit's figure). */
const unlockIcon = (u: Unlock): IconRef => (WEAPONS[u.id]?.kind === 'gun' ? { item: u.id, view: 'side' } : { item: u.id });

export function setupProgression(game: GameContext): Progression {
  // The outfits, by name (what they look like is each screen's).
  OUTFITS.forEach((o, i) => game.items.define(outfitId(i), { kind: 'misc', name: o.name }));
  const tallies = new Map<string, Tally>();
  /** Who hurt whom lately (victim id → attacker id → damage, when), for assists. */
  const hurt = new Map<string, Map<string, { damage: number; at: number }>>();
  let live = false;
  let firstBlood = false;
  let stopClock: (() => void) | null = null;

  const saved = (p: Player): Saved => {
    const s = p.store.get<Saved>('xp');
    return { xp: Math.max(0, Number(s?.xp) || 0), outfit: typeof s?.outfit === 'number' ? s.outfit : undefined };
  };
  const keep = (p: Player, s: Partial<Saved>) => p.store.set('xp', { ...saved(p), ...s });

  function tally(p: Player): Tally {
    let t = tallies.get(p.id);
    if (!t) {
      t = { player: p, guest: !p.account, from: 1, joinedAt: game.clock.now, fired: false, busy: false, streak: 0, multi: 0, lastKillAt: -99, earned: new Map(), victims: new Map() };
      tallies.set(p.id, t);
      t.from = levelOf(total(t));
    }
    return t;
  }
  const total = (t: Tally) => saved(t.player).xp;

  const state = (t: Tally, gains?: Gain[]): XpState => {
    const xp = total(t);
    const level = levelOf(xp);
    return { level, into: xp - xpForLevel(level), need: xpToNext(level), total: xp, guest: t.guest, ...(gains ? { gains } : {}) };
  };
  const send = (p: Player) => {
    if (!p.bot) game.clients.send(p, 'xp', state(tally(p)));
  };

  /** Add XP (server only: from what happened in the match), tell their screen, and any level it took them to. */
  function award(p: Player, gains: Gain[], opts: { quiet?: boolean; cheat?: boolean } = {}) {
    if (p.bot || (!live && !opts.cheat)) return;
    gains = gains.filter(([n]) => n > 0).map(([n, label]) => [Math.round(n), label]);
    if (!gains.length) return;
    const t = tally(p);
    const sum = gains.reduce((a, [n]) => a + n, 0);
    const before = total(t);
    keep(p, { xp: before + sum });
    // (This match's tally, for its summary: what was played for, not a cheat's.)
    if (!opts.cheat) {
      for (const [n, label] of gains) {
        const e = t.earned.get(label) ?? [0, 0];
        t.earned.set(label, [e[0] + 1, e[1] + n]);
      }
    }
    game.clients.send(p, 'xp', state(t, opts.quiet ? undefined : gains));
    const was = levelOf(before);
    const now = levelOf(before + sum);
    if (now > was) {
      const unlocks = UNLOCKS.filter((u) => u.level > was && u.level <= now).map((u) => ({ kind: u.kind, id: u.id, name: u.name, icon: unlockIcon(u) }));
      game.clients.send(p, 'xp.level', { level: now, unlocks } satisfies LevelUp);
      game.hud.feed([{ text: p.name, color: COLORS.gold }, ` made level ${now}`]);
    }
    // An achievement (meta.ts): level 10, with XP earned in play (not the `xp` command's).
    if (!opts.cheat && now >= 10) p.achieve('made_man');
  }

  const has = (p: Player, id: string) => p.bot || levelOf(total(tally(p))) >= unlockLevel(id);
  const locked = (p: Player, id: string) => {
    const u = UNLOCK_AT.get(id);
    p.hud.toast(`${u?.name ?? id} unlocks at level ${u?.level ?? 1}`);
    p.audio.play('gun_empty');
  };

  // A kill, an assist, a streak.
  game.events.on('playerDamage', ({ player, amount, source }) => {
    if (!live || !source || source === 'world' || source.kind !== 'player' || source === player || (source as Player).bot) return;
    const by = hurt.get(player.id) ?? new Map<string, { damage: number; at: number }>();
    const was = by.get(source.id);
    const fresh = was && game.clock.now - was.at <= ASSIST_WINDOW;
    by.set(source.id, { damage: (fresh ? was.damage : 0) + amount, at: game.clock.now });
    hurt.set(player.id, by);
  });

  game.events.on('playerDeath', ({ player: victim, source, weapon, headshot, through }) => {
    const now = game.clock.now;
    const helpers = hurt.get(victim.id);
    hurt.delete(victim.id);
    if (!live) return;
    const vt = victim.bot ? null : tally(victim);
    if (vt) vt.streak = 0;
    const killer = source && source !== 'world' && source.kind === 'player' && source !== victim ? (source as Player) : null;
    if (!killer) return;
    const blood = !firstBlood;
    firstBlood = true;
    // Whoever else hurt them lately: an assist.
    for (const [id, h] of helpers ?? []) {
      if (id === killer.id || h.damage < ASSIST_DAMAGE || now - h.at > ASSIST_WINDOW) continue;
      const helper = game.players.find((p) => p.id === id);
      if (helper && !helper.bot) award(helper, [[XP.assist, 'ASSIST']]);
    }
    if (killer.bot) return;
    const k = tally(killer);
    const gains: Gain[] = [[XP.kill, 'KILL']];
    if (headshot) gains.push([XP.headshot, 'HEADSHOT']);
    if ((through ?? 0) > 0) gains.push([XP.wallbang, 'WALLBANG']);
    const gun = !!weapon && WEAPONS[weapon]?.kind === 'gun';
    const d = killer.position;
    const v = victim.position;
    if (gun && Math.hypot(d.x - v.x, d.y - v.y, d.z - v.z) >= LONG_SHOT) gains.push([XP.longshot, 'LONG SHOT']);
    if (weapon === 'frag') gains.push([XP.lethal, 'BLOWN UP']);
    if (weapon === 'molotov') gains.push([XP.lethal, 'TOASTED']);
    if (weapon === 'katana') gains.push([XP.katana, 'SLICED']);
    if (blood) gains.push([XP.firstBlood, 'FIRST BLOOD']);
    k.multi = now - k.lastKillAt < MULTI_WINDOW ? k.multi + 1 : 1;
    k.lastKillAt = now;
    if (k.multi >= 2) gains.push([XP.multi * (k.multi - 1), ['', '', 'DOUBLE KILL', 'TRIPLE KILL'][k.multi] ?? 'MASSACRE']);
    k.streak++;
    const streak = k.streak === 3 ? XP.streak[3] : k.streak === 5 ? XP.streak[5] : k.streak > 5 && k.streak % 5 === 0 ? XP.streak.more : 0;
    if (streak) gains.push([streak, `STREAK ×${k.streak}`]);
    // The same person again and again (two friends trading kills in a room of their own): half.
    if (!victim.bot) {
      const n = (k.victims.get(victim.name) ?? 0) + 1;
      k.victims.set(victim.name, n);
      if (n > SAME_VICTIM) for (const g of gains) g[0] /= 2;
    }
    award(killer, gains);
  });

  game.events.on('pickup', ({ player, item }) => {
    if (item === 'briefcase') award(player, [[XP.briefcase, 'THE BRIEFCASE']]);
  });

  game.events.on('shot', ({ player }) => {
    if (player.bot) return;
    const t = tally(player);
    t.fired = true;
    t.busy = true;
  });

  game.events.on('playerJoin', ({ player }) => {
    if (player.bot) return;
    // Signed in for the first time since claiming their name: what was kept by it before accounts is theirs.
    if (player.adopted) {
      const old = game.store.get<Saved>(`xp:${player.adopted}`);
      if (old) keep(player, old);
      game.store.delete(`xp:${player.adopted}`);
    }
    tallies.delete(player.id);
    const t = tally(player);
    t.joinedAt = game.clock.now;
    send(player);
    if (t.guest) player.hud.toast('Playing as a guest: sign in with Discord on the home page to keep your XP');
  });
  // Their screen's in play: the bar again, in case it wasn't there for the first.
  game.events.on('playerReady', ({ player }) => send(player));
  game.events.on('playerLeave', ({ player }) => {
    tallies.delete(player.id);
    hurt.delete(player.id);
  });

  // For trying it out (development, or a server with cheats): XP for yourself, or someone by name.
  game.commands.register('xp', {
    usage: '<amount> [name]',
    help: 'Give XP (try out levelling up)',
    cheat: true,
    run: ([n, ...name], g, me) => {
      const who = name.length ? g.players.find((p) => p.name === name.join(' ')) : me;
      if (!who || who.bot) throw new Error('Nobody by that name');
      const amount = Math.round(Number(n));
      if (!(amount > 0)) throw new Error('How much?');
      award(who, [[amount, 'BONUS']], { cheat: true });
      return `${who.name}: level ${levelOf(total(tally(who)))}, ${total(tally(who))} XP`;
    },
  });
  game.commands.register('xpreset', {
    usage: '[name]',
    help: 'Back to level 1',
    cheat: true,
    run: (name, g, me) => {
      const who = name.length ? g.players.find((p) => p.name === name.join(' ')) : me;
      if (!who || who.bot) throw new Error('Nobody by that name');
      keep(who, { xp: 0 });
      send(who);
      return `${who.name}: level 1`;
    },
  });

  return {
    matchStart() {
      live = true;
      firstBlood = false;
      hurt.clear();
      for (const t of tallies.values()) {
        Object.assign(t, { from: levelOf(total(t)), joinedAt: game.clock.now, fired: false, busy: false, streak: 0, multi: 0, lastKillAt: -99 });
        t.earned = new Map();
        t.victims = new Map();
      }
      // A little for time played: each minute they fired in (the timers go with a restart).
      stopClock?.();
      stopClock = game.clock.every(60, () => {
        for (const t of tallies.values()) {
          if (t.busy) award(t.player, [[XP.minute, 'TIME PLAYED']], { quiet: true });
          t.busy = false;
        }
      });
      for (const p of game.players) send(p);
    },

    matchOver(results) {
      if (!live) return;
      for (const r of results) {
        const p = r.player;
        if (p.bot) continue;
        const t = tally(p);
        // Placing counts for someone who played it: a minute in, and a shot fired.
        if (t.fired && game.clock.now - t.joinedAt >= 60) {
          const gains: Gain[] = [];
          if (r.won) gains.push([XP.win, 'WIN']);
          gains.push([XP.place[Math.min(r.place, XP.place.length) - 1], r.place <= 3 ? `${ordinal(r.place)} PLACE` : `FINISHED ${ordinal(r.place)}`]);
          // (On the match's card, not the ticker: the final scores are up.)
          award(p, gains, { quiet: true });
        }
      }
      live = false;
      stopClock?.();
      stopClock = null;
      for (const r of results) {
        if (r.player.bot) continue;
        const t = tally(r.player);
        const lines = [...t.earned].map(([label, [count, amount]]) => [label, count, amount] as [string, number, number]).sort((a, b) => b[2] - a[2]);
        const summary: MatchXp = { ...state(t), from: t.from, lines, earned: lines.reduce((a, l) => a + l[2], 0) };
        game.clients.send(r.player, 'xp.match', summary);
      }
    },

    earn: (p, amount, label) => award(p, [[amount, label.toUpperCase()]]),

    has,

    level: (p) => (p.bot ? MAX_LEVEL : levelOf(total(tally(p)))),

    gate(p, id, entry) {
      // Checked when it's picked, not only when the menu was made: a screen can send any pick.
      const onSelect = () => (has(p, id) ? entry.onSelect?.() : locked(p, id));
      if (has(p, id)) return { ...entry, onSelect };
      const level = unlockLevel(id);
      return { ...entry, active: false, disabled: true, detail: `LV ${level}`, onSelect };
    },

    outfits(p, current, picked) {
      return {
        title: 'Outfit',
        entries: OUTFITS.map((o, i) => {
          const id = outfitId(i);
          const entry: MenuEntry = {
            icon: { item: id },
            label: o.name,
            active: current === i,
            onSelect: () => {
              if (!has(p, id)) return locked(p, id);
              p.setSkin(skinOrigin(i), ATLAS);
              p.setModel(fighterModel(i));
              keep(p, { outfit: i });
              picked(i);
            },
          };
          if (has(p, id)) return entry;
          const level = unlockLevel(id);
          return { ...entry, active: false, disabled: true, detail: `LV ${level}` };
        }),
      };
    },

    outfitFor(p, taken) {
      const last = saved(p).outfit;
      if (last !== undefined && last >= 0 && last < OUTFITS.length && has(p, outfitId(last))) return last;
      const mine = OUTFITS.map((_, i) => i).filter((i) => has(p, outfitId(i)));
      const free = mine.filter((i) => !taken.has(i));
      const from = free.length ? free : mine;
      return from[Math.floor(game.rng.next() * from.length)] ?? 0;
    },
  };
}
