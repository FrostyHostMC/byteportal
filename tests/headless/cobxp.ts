import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Player } from '../../src/platform/api/types';
import { GameHost } from '../../src/platform/host/game';
import { SqliteStore } from '../../src/platform/host/sqlite';
import { IDLE_INPUT, type PresentCall } from '../../src/platform/net/protocol';
import { levelOf, xpForLevel, type LevelUp, type MatchXp, type XpState } from '../../src/games/callofblocky/progression';
import { check, games } from './_harness';

const wasm = readFileSync('engine/pkg/voxel_engine_bg.wasm');
const cob = games.find((g) => g.id === 'callofblocky')!;

/**
 * Call of Blocky's XP, levels and unlocks (`progression.ts`), on a server's database as a real
 * room keeps it: XP for kills and what made them special, assists, the briefcase, streaks, time
 * played and placing; nothing for bots; levels kept by name across a match restart, a new
 * connection and a new room; the loadout refusing a locked pick sent through the menu's callback
 * anyway; the level-up going to the right screen; guests not kept.
 */
export default function cobxp() {
  // The bots pick with Math.random too: seeded, a failure plays out the same way again.
  let seed = 0x5bd1e995;
  Math.random = () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const dir = mkdtempSync(join(tmpdir(), 'cob-xp-'));
  try {
    const path = join(dir, 'callofblocky.sqlite');
    const ann = firstRoom(path);
    secondRoom(path, ann);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** A room on a server's database, and what each connection's screen was sent. */
class Room {
  readonly host: GameHost;
  readonly db: SqliteStore;
  /** The calls each connection got since `clear`, by connection id; and all of them. */
  readonly got = new Map<string, PresentCall[]>();
  readonly all = new Map<string, PresentCall[]>();
  private n = 100;

  constructor(path: string) {
    this.db = SqliteStore.open(path, 'callofblocky');
    this.host = new GameHost(cob, { engine: wasm, seed: 3, remote: true, radius: 4, budget: Infinity, cheats: true, store: this.db });
  }

  /** Someone joining: signed in (their XP kept for their account), or, as "Player", a guest. */
  join(name: string): { id: string; player: Player } {
    const c = this.host.connect(name, name === 'Player' ? undefined : { account: { id: name.toLowerCase(), name, avatar: null } });
    this.got.set(c.id, []);
    this.all.set(c.id, []);
    this.keep(c.id, c.batch.events);
    this.host.command(c.id, { t: 'start' });
    return { id: c.id, player: this.player(name) };
  }

  player(name: string): Player {
    const p = this.host.sim.ctx.players.find((q) => q.name === name);
    check(p, `no player ${name}`);
    return p;
  }

  private keep(id: string, events: { t: string }[]) {
    for (const e of events) {
      if (e.t === 'call') {
        const call = (e as unknown as { call: PresentCall }).call;
        this.got.get(id)?.push(call);
        this.all.get(id)?.push(call);
      }
      if (e.t === 'error') throw new Error(`the game threw: ${(e as unknown as { text: string }).text}`);
    }
  }

  step(seconds: number) {
    for (let t = 0; t < seconds - 1e-9; t += 1 / 30) {
      for (const [id, b] of this.host.step(1 / 30)) this.keep(id, b.events);
    }
  }

  /** Run a typed command as this connection's player. */
  exec(id: string, line: string) {
    this.host.command(id, { t: 'exec', id: this.n++, line });
    this.step(1 / 30);
  }

  /** The game's messages to this connection's screen named `name`, oldest first. */
  messages<T>(id: string, name: string): T[] {
    return (this.got.get(id) ?? []).filter((c) => c.target === 'message' && c.method === name).map((c) => c.args[0] as T);
  }

  last<T>(id: string, name: string): T | undefined {
    return this.messages<T>(id, name).at(-1);
  }

  /** Forget what's been sent so far (to look at what comes next). */
  clear() {
    for (const list of this.got.values()) list.length = 0;
  }

  close() {
    this.host.persist();
    this.host.dispose();
    this.db.close();
  }
}

const gains = (s: XpState | undefined) => (s?.gains ?? []).map(([n, l]) => `${n} ${l}`);

function firstRoom(path: string): number {
  const room = new Room(path);
  const a = room.join('Ann');
  const ann = a.player;
  room.step(0.5);
  const first = room.last<XpState>(a.id, 'xp');
  check(first?.level === 1 && first.total === 0 && !first.guest, `Ann starts at level 1: ${JSON.stringify(first)}`);
  const g = room.host.sim.ctx;
  const bots = () => g.players.filter((p) => p.bot && p.alive);
  check(bots().length >= 4, `bots fill the street: ${g.players.length}`);
  // Past everyone's spawn protection (Ann keeps hers: the bots are out there).
  room.step(2);
  ann.protect(120);

  // A kill up close, a headshot through a wall: KILL, HEADSHOT, WALLBANG.
  const kill = (victim: Player, opts: { weapon: string; headshot?: boolean; through?: number; away?: number; by?: Player }) => {
    const by = opts.by ?? ann;
    const at = by.position;
    if (!victim.alive) victim.revive();
    victim.teleport({ x: at.x + (opts.away ?? 4), y: at.y, z: at.z });
    victim.protect(0);
    const ok = victim.damage(1000, { source: by, weapon: opts.weapon, headshot: opts.headshot, through: opts.through, cause: opts.weapon === 'frag' ? 'explosion' : 'gun', knockback: 0 });
    check(ok && !victim.alive, `${victim.name} killed by ${by.name} (${opts.weapon})`);
    // (What it sent goes out with the next step.)
    room.step(1 / 30);
  };
  room.clear();
  const firstBloodTaken = room.host.sim.ctx.players.some((p) => p.bot && !p.alive);
  let v = bots()[0];
  kill(v, { weapon: 'rifle', headshot: true, through: 1 });
  let s = room.last<XpState>(a.id, 'xp');
  const got = gains(s);
  check(got.includes('100 KILL') && got.includes('50 HEADSHOT') && got.includes('50 WALLBANG') && !got.some((x) => x.includes('LONG SHOT')), `a close headshot through a wall: ${got}`);
  let total = s!.total;
  check(total === s!.gains!.reduce((n, [x]) => n + x, 0), `the total is what was earned: ${total}`);
  console.log(`  kill: ${got.join(', ')}${firstBloodTaken ? ' (first blood went to a bot)' : ''}`);

  // A long shot, then (right after) a frag: LONG SHOT; BLOWN UP and DOUBLE KILL; and the third
  // kill in a row is a streak.
  room.step(5);
  v = bots()[0];
  kill(v, { weapon: 'sniper', away: 40 });
  s = room.last<XpState>(a.id, 'xp');
  check(gains(s).includes('50 LONG SHOT'), `a long shot: ${gains(s)}`);
  v = bots()[0];
  kill(v, { weapon: 'frag' });
  s = room.last<XpState>(a.id, 'xp');
  check(gains(s).includes('50 BLOWN UP') && gains(s).includes('50 DOUBLE KILL') && gains(s).includes('100 STREAK ×3'), `a frag, a double kill, three in a row: ${gains(s)}`);
  total = s!.total;

  // An assist: Ann hurts one, a bot finishes them (once the dead are back).
  room.step(3.5);
  const [hurt, other] = bots();
  check(hurt && other, 'two bots about');
  hurt.revive();
  hurt.health = hurt.maxHealth;
  hurt.protect(0);
  hurt.damage(30, { source: ann, weapon: 'pistol', cause: 'gun', knockback: 0 });
  room.step(1 / 30);
  room.clear();
  kill(hurt, { weapon: 'rifle', by: other });
  s = room.last<XpState>(a.id, 'xp');
  check(gains(s).join() === '50 ASSIST' && s!.total === total + 50, `an assist: ${gains(s)} (${s?.total})`);
  total = s!.total;

  // Bots killing bots: nothing for anyone, and bots are never kept.
  room.clear();
  const [b1, b2] = bots();
  check(b1 && b2, 'two bots about');
  kill(b1, { weapon: 'rifle', by: b2 });
  check(room.messages(a.id, 'xp').length === 0, `a bot killing a bot is nothing to Ann: ${JSON.stringify(room.messages(a.id, 'xp'))}`);

  // The briefcase.
  room.clear();
  g.items.spawnPickup('briefcase', ann.position, { despawn: 40 });
  room.step(1.2);
  s = room.last<XpState>(a.id, 'xp');
  check(gains(s).join() === '300 THE BRIEFCASE', `the briefcase: ${gains(s)}`);
  total = s!.total;
  check((room.db.data().get('$player:ann:xp') as { xp: number } | undefined)?.xp === total, 'Ann kept for her account');

  // A second person: the loadout is theirs, at their level.
  const b = room.join('Bob');
  const bob = b.player;
  room.step(0.5);
  const menu = (id: string) => {
    const call = (room.all.get(id) ?? []).filter((c) => c.target === 'hud' && c.method === 'menu').at(-1);
    check(call, 'a loadout menu');
    const opts = call.args[1] as { title: string; sections: { title: string; entries: { label: string; disabled?: boolean; detail?: string; onSelect?: { $cb: number } }[] }[] };
    return { id: call.args[0] as number, entries: opts.sections.flatMap((x) => x.entries), sections: opts.sections.map((x) => x.title) };
  };
  let m = menu(b.id);
  check(m.sections.join() === 'Primary,Sidearm,Lethal (G),Perk 1,Perk 2,Perk 3,Killstreaks (pick 3),Outfit', `the loadout's sections: ${m.sections}`);
  const locked = m.entries.filter((e) => e.disabled).map((e) => `${e.label} ${e.detail}`);
  const later = ['Mac-10 LV 2', "Zed's Pump LV 4", 'The Wolf LV 5', 'Rock Salt LV 7', 'Honey Bunny LV 8', 'Bad Mother LV 9', 'Marsellus LV 11', 'Ezekiel LV 13', 'The Mia LV 6', 'The Bowler LV 3', 'The Boss LV 30'];
  check(later.every((x) => locked.includes(x)), `level 1's locked picks: ${locked}`);
  check(['Big Kahuna', 'Lucky 45', 'The Pineapple'].every((l) => !m.entries.find((e) => e.label === l)?.disabled), 'the rifle, the Lucky 45 and the frag are there from level 1');
  // Bob sends the sniper's pick anyway (a forged click, or a stale menu): refused.
  const sniper = m.entries.find((e) => e.label === 'Honey Bunny')!;
  check(sniper.onSelect, 'the locked entry is still a callback (checked when picked)');
  room.clear();
  room.host.command(b.id, { t: 'message', msg: { t: 'callback', player: '', id: sniper.onSelect.$cb } });
  room.step(0.1);
  const toasts = (id: string) => (room.got.get(id) ?? []).filter((c) => c.target === 'hud' && c.method === 'toast').map((c) => String(c.args[0]));
  check(toasts(b.id).some((t) => t.includes('Honey Bunny unlocks at level 8')), `Bob is told no: ${toasts(b.id)}`);
  // … and it isn't what he carries, now or next life.
  bob.protect(0);
  bob.damage(1000, { source: 'world', knockback: 0 });
  room.step(3.5);
  check(bob.alive && bob.inventory.count('sniper') === 0 && bob.inventory.count('rifle') === 1, `Bob still carries the rifle: sniper ${bob.inventory.count('sniper')}, rifle ${bob.inventory.count('rifle')}`);
  check(bob.inventory.count('pistol') === 1 && bob.inventory.count('revolver') === 0, 'and the Lucky 45 at his side');

  // Ann's level-up reaches Ann's screen, not Bob's; at level 8 the sniper is hers to pick.
  room.clear();
  room.exec(a.id, `xp ${xpForLevel(8) - total}`);
  const up = room.messages<LevelUp>(a.id, 'xp.level');
  check(up.length === 1 && up[0].level === 8, `Ann's level-up: ${JSON.stringify(up)}`);
  // (The briefcase took her to level 2 already.)
  const names = (room.all.get(a.id) ?? []).filter((c) => c.target === 'message' && c.method === 'xp.level').flatMap((c) => (c.args[0] as LevelUp).unlocks.map((u) => u.name));
  check(['Mac-10', "Zed's Pump", 'The Mia', 'Honey Bunny', 'The Bowler'].every((x) => names.includes(x)), `levels 2 to 8 unlocked: ${names}`);
  check(room.messages(b.id, 'xp.level').length === 0 && room.messages(b.id, 'xp').length === 0, "Bob's screen hears nothing of it");
  const feed = (room.got.get(b.id) ?? []).filter((c) => c.target === 'hud' && c.method === 'feed').map((c) => JSON.stringify(c.args[0]));
  check(feed.some((f) => f.includes('made level 8')), `everyone sees it in the feed: ${feed}`);
  // Her menu, again (L): the sniper's there, and picking it works.
  const open = menu(a.id);
  room.host.command(a.id, { t: 'message', msg: { t: 'menuClosed', player: '', menu: open.id } });
  room.host.command(a.id, { t: 'input', input: { ...IDLE_INPUT, active: true, pressed: ['KeyL'], down: ['KeyL'] } });
  room.step(0.1);
  m = menu(a.id);
  check(m.id !== open.id, 'a new menu');
  const hers = m.entries.find((e) => e.label === 'Honey Bunny')!;
  check(!hers.disabled && hers.onSelect, 'the sniper is unlocked for Ann');
  room.host.command(a.id, { t: 'message', msg: { t: 'callback', player: '', id: hers.onSelect.$cb } });
  ann.protect(0);
  ann.damage(1000, { source: 'world', knockback: 0 });
  room.step(3.5);
  check(ann.alive && ann.inventory.count('sniper') === 1, `Ann carries the Honey Bunny: ${ann.inventory.count('sniper')}`);

  // Time played (a minute she fired in) and placing: she fires (at the sky), a minute passes, she wins.
  ann.protect(120);
  const view = room.host.sim.players.find((p) => p.name === 'Ann')!.viewSeq;
  room.host.command(a.id, { t: 'input', input: { ...IDLE_INPUT, active: true, buttons: 1, clicked: 1, pitch: 1.45, viewSeq: view } });
  room.step(0.2);
  room.host.command(a.id, { t: 'input', input: { ...IDLE_INPUT, active: true, pitch: 1.45, viewSeq: view } });
  room.clear();
  room.step(Math.max(0, 61 - g.clock.now));
  check(room.messages<XpState>(a.id, 'xp').some((x) => !x.gains), 'time played shows on the bar, not the ticker');
  const before = room.last<XpState>(a.id, 'xp')?.total ?? xpForLevel(8);
  room.clear();
  room.exec(a.id, 'win');
  const end = room.last<MatchXp>(a.id, 'xp.match');
  check(end && end.lines.some(([l]) => l === 'WIN') && end.lines.some(([l]) => l.endsWith('PLACE') || l.startsWith('FINISHED')), `Ann's match XP: ${JSON.stringify(end?.lines)}`);
  check((end.lines.find(([l]) => l === 'KILL')?.[1] ?? 0) >= 3, `three kills: ${JSON.stringify(end.lines)}`);
  check(end.lines.some(([l]) => l === 'TIME PLAYED'), `a minute played: ${JSON.stringify(end.lines)}`);
  check(end.earned === end.lines.reduce((n, l) => n + l[2], 0), 'the match total adds up');
  const bobEnd = room.last<MatchXp>(b.id, 'xp.match');
  check(bobEnd && !bobEnd.lines.some(([l]) => l === 'WIN'), `Bob gets his own summary, no win (he joined late and never fired): ${JSON.stringify(bobEnd?.lines)}`);
  const kept = end.total;
  check(kept > before, `the win and the place count: ${before} → ${kept}`);
  console.log(`  match: ${end.lines.map(([l, c, n]) => `${l}${c > 1 ? ` ×${c}` : ''} +${n}`).join(', ')}; level ${end.from} → ${end.level}`);

  // The next match (a restart): the same level, and XP counting again.
  room.step(13);
  const again = room.last<XpState>(a.id, 'xp');
  check(again?.total === kept && again.level === levelOf(kept), `after the restart Ann is still level ${levelOf(kept)}: ${JSON.stringify(again)}`);

  // A new connection with the same name: the same level.
  room.host.disconnect(a.id);
  room.step(0.2);
  const a2 = room.join('Ann');
  room.step(0.2);
  const back = room.last<XpState>(a2.id, 'xp');
  check(back?.total === kept, `Ann again, same XP: ${JSON.stringify(back)}`);

  // A guest: counted for the session only.
  const guest = room.join('Player');
  room.exec(guest.id, 'xp 1000');
  const gs = room.last<XpState>(guest.id, 'xp');
  check(gs?.guest && gs.level === 2, `a guest levels up for the session: ${JSON.stringify(gs)}`);
  const keys = [...room.db.data().keys()].filter((k) => k.endsWith(':xp'));
  check(keys.includes('$player:ann:xp') && keys.every((k) => k === '$player:ann:xp' || k === '$player:bob:xp'), `only signed-in people are kept, a guest never: ${keys}`);
  room.close();
  console.log(`  Ann: level ${levelOf(kept)}, ${kept} XP; kept across a restart and a new connection; Bob refused the sniper; guests not kept`);
  return kept;
}

/** A new room on the same database (the server restarted): Ann is who she was. */
function secondRoom(path: string, kept: number) {
  const room = new Room(path);
  const a = room.join('Ann');
  room.step(0.5);
  const s = room.last<XpState>(a.id, 'xp');
  check(s?.total === kept && s.level === levelOf(kept), `Ann in a new room: ${JSON.stringify(s)} (had ${kept})`);
  const c = room.join('Cleo');
  room.step(0.2);
  check(room.last<XpState>(c.id, 'xp')?.level === 1, 'a new name starts at level 1');
  room.close();
  console.log(`  a new room: Ann still level ${s.level}, Cleo (new) level 1`);
}
