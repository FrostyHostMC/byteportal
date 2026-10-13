import type { GameContext, Player } from '@platform';
import type { ArenaPart } from '../part';
import { BLESSING_COLOR, BLESSINGS, blessingsOf, level, type BlessingId } from '../blessings';
import { bossKind } from '../bosses';
import { monsterKind } from '../monsters';
import { bus, type RunResult, type Unlock } from '../run/bus';
import { finalWave, monstersAlive, TWISTS, waveName, waveSpec, type Twist } from '../run/director';
import { counts } from '../run/downed';
import { addGold, gold } from '../run/gold';
import { map, state } from '../run/state';
import { className, END, endActions, endScreen, LEVEL_UP_AT, type EndExtras, type EndRun } from './end';
import { MSG, type CallMsg, type CrowdMsg, type FighterState, type FoeMsg, type GoreMsg, type HitMsg, type MeMsg, type PartyMsg, type RunMsg, type WaveCard } from './messages';
import { Tallies } from './tally';

/**
 * The HUD's server part: it listens to the bus and the damage events and tells each screen what
 * its HUD shows (`messages.ts`; the screens draw it, `client/hud/`), only what's changed and no
 * more often than it needs: the fight (the wave, its twist or boss, the enemies left, the time to
 * the next), the crowd's hype, the party (each friend's health, down or out, class), each
 * fighter's own (gold, blessings), and the moments: callouts (the announcer), hits landed (hit
 * markers, hit-stop), deaths (gore, the crowd), a wave's card, a level reached, and the end-of-run
 * screen (`end.ts`), whose buttons play again, keep fighting or leave. It keeps each fighter's
 * tallies for those (`tally.ts`).
 */

const tallies = new Tallies();
/** What each screen was last sent, by message and screen (`all` or a player's id): only changes go. */
const sent = new Map<string, string>();
/** The fight's moments: when this wave began, the most monsters it's had at once, who's ready for the next. */
let waveAt = 0;
let waveTotal = 0;
let ready: RunMsg['ready'] = null;
/** The kinds of monster seen this run, and the first sightings waiting to be told (one at a time). */
const seen = new Set<string>();
let foes: FoeMsg[] = [];
let nextFoe = 0;
/** The crowd's hype as the run's part last told it (during the Favour: how much of it is left). */
let hype = { value: 0, favour: false };
/** Who's down, and when they bleed out (game clock). */
const downs = new Map<string, number>();
/** Each fighter's class (by player id), and the levels' unlocks they've reached this run. */
const classes = new Map<string, string>();
const unlocks = new Map<string, Unlock[]>();
/** When the next periodic sends are due, and when the crowd last cheered a boss hit. */
let partyAt = 0;
let meAt = 0;
let bossCheer = 0;
/** Deaths whose gore has gone out this second (a blast can fell a dozen). */
let goreBudget = { at: 0, n: 0 };
/** The run's over: how it went and what the run's part said of it, for the end screen (and anyone who arrives to see it). */
let ended: { run: EndRun; extras: EndExtras } | null = null;
/** Each kind of monster's name, blood and height (`MonsterKind`/`BossKind` definitions), looked up once. */
const kinds = new Map<string, { name: string; blood: string; height: number }>();

/** How long the Crowd's Favour lasts (the run's `hype.ts`): its meter counts it down. */
const FAVOUR = 10;
/** At most this many deaths' gore a second (the rest are quiet: the platform's own burst still shows). */
const GORE_PER_SECOND = 10;
/** Feats the crowd roars at (the rest it cheers). */
const ROARS = new Set(['rampage', 'multi_kill', 'kaboom', 'goblin', 'last_stand', 'boss_stagger']);
/** Feats drawn elsewhere: a boss's new phase (the bosses' own card), a revive (the HUD's revive callouts). */
const UNSAID = new Set(['boss_phase', 'revive']);
/** A first sighting's tip stays up this long before the next (seconds). */
const FOE_EVERY = 5;
/** A fighter's light hits (a burn, a spell's chain) are told at most this often (seconds); kills and heavy hits always. */
const LIGHT_EVERY = 0.1;
/** When each fighter's screen was last told of a hit. */
const lastHit = new Map<string, number>();

function send(game: GameContext, to: Player | 'all', name: string, data: unknown, force = false) {
  const key = `${name}@${to === 'all' ? 'all' : to.id}`;
  const json = JSON.stringify(data);
  if (!force && sent.get(key) === json) return;
  sent.set(key, json);
  game.clients.send(to, name, data);
}

/** A moment, not a state: sent every time. */
function tell(game: GameContext, to: Player | 'all', name: string, data: unknown) {
  if (to !== 'all' && to.bot) return;
  game.clients.send(to, name, data);
}

const call = (game: GameContext, to: Player | 'all', c: CallMsg) => tell(game, to, MSG.call, c);
const crowd = (game: GameContext, c: CrowdMsg) => tell(game, 'all', MSG.crowd, c);

function kindOf(game: GameContext, type: string) {
  let k = kinds.get(type);
  if (!k) {
    const def = (monsterKind(type) ?? bossKind(type))?.define(game);
    k = { name: def?.name ?? type, blood: def?.bloodColor ?? '#b3261e', height: def?.hitbox.height ?? 1.9 };
    kinds.set(type, k);
  }
  return k;
}

/** Monsters still to beat this wave: those in the arena and those still to come. */
const leftNow = (game: GameContext) => (state.phase === 'fighting' ? monstersAlive(game) + state.queue.length : 0);

function runMsg(game: GameContext): RunMsg {
  const n = state.wave;
  const twist = state.twist ? TWISTS[state.twist as Twist] : null;
  const boss = state.boss ? bossKind(state.boss) : undefined;
  const left = leftNow(game);
  waveTotal = Math.max(waveTotal, left);
  const now = game.clock.now;
  // The countdown to the first wave (the class pick's), or the break between waves.
  const next = state.phase === 'intermission' || state.phase === 'countdown' ? Math.max(0, Math.ceil(state.nextWaveAt - now)) : 0;
  const running = state.phase !== 'intro' && state.phase !== 'waiting';
  return {
    phase: state.phase,
    wave: n,
    of: finalWave(),
    name: n > 0 ? waveName(n) : '',
    left,
    total: Math.max(waveTotal, left),
    next,
    twist: twist ? { name: twist.name, text: twist.text, color: twist.color } : null,
    boss: boss ? { name: boss.name, title: boss.title, color: boss.color } : null,
    upcoming: upcoming(),
    ready: state.phase === 'intermission' ? ready : null,
    endless: state.endless,
    time: running ? Math.max(0, Math.floor(now - state.startedAt)) : 0,
    kills: state.kills,
    map: map().id,
    mapName: map().name,
  };
}

/** The wave coming next, between waves and in the countdown to the first. */
function upcoming(): RunMsg['upcoming'] {
  if (state.phase !== 'intermission' && state.phase !== 'countdown') return null;
  const n = state.phase === 'countdown' ? 1 : state.wave + 1;
  return { wave: n, name: waveName(n), boss: !!waveSpec(n).boss };
}

/** A blessing's colour, by its rarity: its icon's frame, its callout. */
const blessingColor = (id: string) => (id in BLESSINGS ? BLESSING_COLOR[BLESSINGS[id as BlessingId].rarity] : BLESSING_COLOR.common);

const fighterState = (p: Player): FighterState => (downs.has(p.id) ? 'down' : p.alive ? 'up' : 'out');
const bleedOf = (game: GameContext, p: Player) => Math.max(0, Math.ceil((downs.get(p.id) ?? 0) - game.clock.now));

function meMsg(game: GameContext, p: Player): MeMsg {
  return {
    gold: gold(p),
    bless: blessingsOf(p).map((id) => {
      const b = BLESSINGS[id];
      return { name: b.name, text: b.text, icon: b.icon, color: blessingColor(id), n: level(p, id) };
    }),
    state: fighterState(p),
    bleed: bleedOf(game, p),
  };
}

function partyMsg(game: GameContext): PartyMsg {
  return {
    list: game.players.map((p) => ({
      id: p.id,
      name: p.name,
      hp: p.maxHealth > 0 ? Math.round((Math.max(0, p.health) / p.maxHealth) * 40) / 40 : 0,
      max: p.maxHealth,
      state: fighterState(p),
      bleed: bleedOf(game, p),
      cls: className(classes.get(p.id) ?? ''),
      gold: gold(p),
    })),
  };
}

const hypeMsg = () => ({ v: hype.favour ? 1 : Math.round(hype.value * 100) / 100, f: hype.favour ? Math.max(0, Math.ceil(hype.value * FAVOUR)) : 0 });

/** Everything a screen shows now, sent whole (a screen that's just come in, a fresh fight). */
function catchUp(game: GameContext, p: Player) {
  if (p.bot) return;
  for (const key of [...sent.keys()]) if (key.endsWith(`@${p.id}`)) sent.delete(key);
  game.clients.send(p, MSG.run, runMsg(game));
  game.clients.send(p, MSG.hype, hypeMsg());
  if (game.players.length > 1) game.clients.send(p, MSG.party, partyMsg(game));
  send(game, p, MSG.me, meMsg(game, p), true);
  if (ended) endScreen(p, ended.run, tallies, ended.extras);
}

/** A wave won: each fighter's card (their part in it, the party's best, the bonus, what's next). */
function waveCards(game: GameContext, wave: number, bonus: number) {
  const best = game.players.length > 1 ? tallies.waveBest() : null;
  // (After the run's last wave, nothing's next unless they fight on.)
  const next = wave < finalWave() || state.endless ? { wave: wave + 1, name: waveName(wave + 1), boss: !!waveSpec(wave + 1).boss } : null;
  for (const p of game.players) {
    const t = tallies.waveOf(p.id);
    const card: WaveCard = {
      wave,
      name: waveName(wave),
      time: Math.round(game.clock.now - waveAt),
      kills: t.kills,
      gold: t.gold,
      damage: Math.round(t.damage),
      mvp: best ? { name: tallies.names.get(best.id) ?? '', kills: best.kills, you: best.id === p.id } : null,
      bonus,
      next,
    };
    tell(game, p, MSG.wave, card);
  }
}

/** A wave begins: the announcer says so (an endless one, the final one, a boss's), and its twist after. */
function announceWave(game: GameContext, e: { wave: number; name: string; twist: string | null; boss: string | null; final: boolean; endless: boolean }) {
  const boss = e.boss ? bossKind(e.boss) : undefined;
  const twist = e.twist ? TWISTS[e.twist as Twist] : null;
  if (e.endless) call(game, 'all', { k: boss ? 'boss' : 'wave', q: boss ? 'Endless · a boss returns' : 'Endless', t: `Wave ${e.wave}`, s: e.name, c: boss?.color });
  else if (e.final) call(game, 'all', { k: 'final', q: 'Final wave', t: `Wave ${e.wave}`, s: e.name, c: boss?.color ?? '#c9a2ff' });
  else if (boss) call(game, 'all', { k: 'boss', q: 'Boss wave', t: `Wave ${e.wave}`, s: e.name, c: boss.color });
  else call(game, 'all', { k: 'wave', q: `Wave ${e.wave} of ${finalWave()}`, t: `Wave ${e.wave}`, s: e.name });
  if (twist) {
    const n = e.wave;
    game.clock.after(2.7, () => {
      if (state.wave === n && state.phase === 'fighting') call(game, 'all', { k: 'twist', q: 'Twist', t: twist.name, s: twist.text, c: twist.color });
    });
  }
}

/** A fight begins afresh: nothing ended, nobody down, no waves named, no monster seen. */
function fresh() {
  ended = null;
  lastHit.clear();
  waveTotal = 0;
  ready = null;
  downs.clear();
  unlocks.clear();
  seen.clear();
  foes = [];
  nextFoe = 0;
}

/** The run's over: each fighter's end screen, after the moment's had its due. */
function endRun(game: GameContext, run: EndRun, results: RunResult[]) {
  const done = { run, extras: { results, unlocks, classes } };
  ended = done;
  game.clock.after(run.won ? 3.4 : 2.2, () => {
    if (ended !== done) return;
    for (const p of game.players) endScreen(p, run, tallies, done.extras);
    // The brass as a level gained lands on the screen.
    game.clock.after(LEVEL_UP_AT, () => {
      if (ended !== done) return;
      for (const r of results) if (r.xp.level > r.xp.from) tell(game, r.player, MSG.level, { level: r.xp.level, unlocks: [], end: true });
    });
  });
}

/** On from a victory into the endless waves (the end screen's button): the screens come down and the run goes on. */
function keepFighting(game: GameContext, p: Player) {
  if (!ended?.run.won || ended.run.endless) return;
  ended = null;
  for (const q of game.players) q.hud.widget(END.name).remove();
  bus.emit('keepFighting', { player: p });
  call(game, 'all', { k: 'endless', q: `${p.name} chose to fight on`, t: 'Endless', s: 'How far can you go?' });
  crowd(game, { v: 1, r: 'roar' });
}

export const hudPart: ArenaPart = {
  name: 'hudPart',

  setup(game) {
    // The end screen: its buttons play again, keep fighting or leave; closed, it comes back (there's nothing else to do).
    game.hud.define(END.name, {
      ...END.def,
      actions: endActions(game, (p) => keepFighting(game, p)),
      onClose: (p) => {
        if (ended) endScreen(p, ended.run, tallies, ended.extras);
      },
    });

    bus.on('runStart', () => {
      tallies.reset();
      for (const p of game.players) tallies.join(p);
      fresh();
    });

    bus.on('waveStart', (e) => {
      tallies.newWave();
      waveAt = game.clock.now;
      waveTotal = 0;
      ready = null;
      announceWave(game, e);
    });

    // (The run's feed says who's ready, who's down, revived, fallen or joining: the HUD shows the rest.)
    bus.on('ready', ({ ready: n, of }) => {
      ready = { n, of };
    });

    // The first of each kind of monster this run: what it is and how to beat it, one at a time.
    bus.on('spawned', ({ type }) => {
      const kind = monsterKind(type);
      if (!kind?.tip || seen.has(type)) return;
      seen.add(type);
      foes.push({ name: kindOf(game, type).name, tip: kind.tip, color: kind.color ?? '#e8dcc0', role: kind.role });
    });

    bus.on('waveCleared', ({ wave, bonus }) => {
      crowd(game, { v: 0.8, r: 'cheer' });
      waveCards(game, wave, bonus);
    });

    bus.on('slain', ({ type, by, at }) => {
      const boss = !!bossKind(type);
      if (by) tallies.kill(by, game.clock.now, boss);
      // Gore for everyone (a few a second at most), and the crowd roars at a boss's fall.
      const now = game.clock.now;
      if (now - goreBudget.at >= 1) goreBudget = { at: now, n: 0 };
      if (boss || goreBudget.n++ < GORE_PER_SECOND) {
        const k = kindOf(game, type);
        const gore: GoreMsg = { at: [at.x, at.y, at.z], c: k.blood, s: k.height, ...(boss && { b: 1 as const }) };
        tell(game, 'all', MSG.gore, gore);
      }
      if (boss) crowd(game, { v: 1, r: 'roar' });
    });

    bus.on('gold', ({ player, delta, at, why }) => {
      tallies.gold(player, delta);
      tell(game, player, MSG.gold, { d: delta, ...(at && { at: [at.x, at.y, at.z] }), ...(why && why !== 'coin' && why !== 'spend' && { why }) });
    });

    bus.on('hype', ({ value, favour }) => {
      hype = { value, favour };
    });

    bus.on('feat', ({ player, name, text }) => {
      if (name === 'phoenix' && player) return call(game, player, { k: 'back', q: 'The Phoenix Feather burns away', t: 'Reborn' });
      if (name === 'favour') {
        call(game, 'all', { k: 'favour', q: 'The crowd roars', t: "Crowd's Favour", s: 'Double gold · gifts from the emperor' });
        return crowd(game, { v: 1, r: 'roar' });
      }
      // (A boss's fall has its own card, the bosses' death cam: the crowd roars at it.)
      if (name === 'boss_slain') return crowd(game, { v: 1, r: 'roar' });
      crowd(game, ROARS.has(name) ? { v: 0.9, r: 'roar' } : { v: 0.5, r: 'cheer' });
      if (UNSAID.has(name)) return;
      // Their own feat, to them: "Ann caught the Treasure Goblin" is "You caught…".
      const own = player && text.startsWith(`${player.name} `) ? `You ${text.slice(player.name.length + 1)}` : text;
      call(game, player ?? 'all', { k: 'feat', t: own.replace(/!$/, ''), name });
    });

    bus.on('downed', ({ player, bleed }) => {
      downs.set(player.id, game.clock.now + bleed);
      tallies.down(player);
      for (const p of game.players) if (p !== player) call(game, p, { k: 'ally', t: `${player.name} is down`, s: 'Hold E on them to revive' });
      crowd(game, { v: 0.6, r: 'gasp' });
    });

    bus.on('revived', ({ player, by }) => {
      downs.delete(player.id);
      // (Up by a feather or the wave's end: the feat or the wave's card says so.)
      if (!by) return;
      tallies.revived(by);
      call(game, player, { k: 'back', t: 'Revived', s: `${by.name} pulled you up` });
      call(game, by, { k: 'ally', t: `You revived ${player.name}` });
      crowd(game, { v: 0.6, r: 'cheer' });
    });

    bus.on('fell', ({ player }) => {
      // (Bleeding out after going down is the same fall.)
      if (!downs.delete(player.id)) tallies.down(player);
      call(game, player, { k: 'out', t: 'You fell', s: "You'll be back when this wave is cleared" });
      crowd(game, { v: 0.5, r: 'gasp' });
    });

    bus.on('rejoined', ({ player }) => {
      if (state.phase !== 'victory' && state.phase !== 'defeat') call(game, player, { k: 'back', t: 'Back in the fight' });
    });

    bus.on('classPicked', ({ player, cls }) => void classes.set(player.id, cls));

    bus.on('blessed', ({ player, id, name, text, chosen }) => {
      call(game, player, { k: 'blessing', q: chosen ? 'Blessing' : 'The arena chose for you', t: name, s: text, c: blessingColor(id) });
    });

    bus.on('levelUp', ({ player, level, unlocks: got }) => {
      unlocks.set(player.id, [...(unlocks.get(player.id) ?? []), ...got]);
      game.hud.feed([{ text: player.name, color: '#f0c060' }, ` reached level ${level}`]);
      // (At a run's end its level-ups go on the end screen.)
      if (state.phase !== 'victory' && state.phase !== 'defeat') tell(game, player, MSG.level, { level, unlocks: got.map((u) => ({ kind: u.kind, name: u.name })) });
    });

    bus.on('runEnd', ({ won, wave, endless, map: m, time, results }) => {
      tell(game, 'all', MSG.end, { won, wave });
      crowd(game, { v: 1, r: won ? 'roar' : 'groan' });
      call(game, 'all', won ? { k: 'victory', q: m.name, t: 'Victory', s: 'The arena is yours' } : { k: 'defeat', q: endless ? `Endless wave ${wave}` : `Wave ${wave}`, t: 'Defeated', s: 'The arena claims you' });
      const run: EndRun = { won, wave, endless, time: time > 0 ? time : game.clock.now - state.startedAt, map: m.name, of: finalWave(), name: waveName(Math.max(1, wave)) };
      endRun(game, run, results);
    });

    game.events.on('entityDamage', ({ entity, amount, source }) => {
      if (!source || source === 'world' || source.kind !== 'player') return;
      tallies.damage(source, amount);
      const boss = !!bossKind(entity.type);
      if (!source.bot) {
        const hit: HitMsg = { e: entity.id, n: Math.round(amount * 10) / 10, h: Math.round(Math.min(1, amount / Math.max(6, entity.maxHealth * 0.4)) * 100) / 100 };
        if (!entity.alive || entity.health <= 0) hit.k = 1;
        if (boss) hit.b = 1;
        const now = game.clock.now;
        if (hit.k || hit.h >= 0.3 || now - (lastHit.get(source.id) ?? -1) >= LIGHT_EVERY) {
          lastHit.set(source.id, now);
          tell(game, source, MSG.hit, hit);
        }
      }
      // The crowd cheers the blows on a boss, now and then.
      if (boss && game.clock.now - bossCheer > 2.5) {
        bossCheer = game.clock.now;
        crowd(game, { v: 0.35, r: 'cheer' });
      }
    });

    game.events.on('playerDamage', ({ player, amount }) => {
      // (Not a blow on the ground, nor the bleed-out's end.)
      if (!counts(player)) return;
      tallies.taken(player, amount);
      // A big blow draws a gasp from the stands.
      if (player.maxHealth > 0 && amount >= player.maxHealth * 0.3) crowd(game, { v: 0.5, r: 'gasp' });
    });

    game.events.on('playerJoin', ({ player }) => tallies.join(player));
    // Arriving in the middle of it: where they've come in, told once their fly-over and class pick are done.
    const joining = new Set<string>();
    game.events.on('playerReady', ({ player }) => {
      catchUp(game, player);
      if (!player.bot && (state.phase === 'fighting' || state.phase === 'intermission')) joining.add(player.id);
    });
    bus.on('classSet', ({ player }) => {
      if (!joining.delete(player.id)) return;
      if (state.phase === 'fighting') call(game, player, { k: 'wave', q: 'Joining the fight', t: `Wave ${state.wave}`, s: waveName(state.wave) });
      else if (state.phase === 'intermission') call(game, player, { k: 'wave', q: 'Joining the fight', t: `Wave ${state.wave + 1}`, s: 'Next: rest, shop, choose a blessing' });
    });
    game.events.on('playerLeave', ({ player }) => {
      downs.delete(player.id);
      joining.delete(player.id);
    });

    // For looking at the HUD's pieces (development, or a server with cheats).
    game.commands.register('hud', {
      usage: '<callout|card|end [lose]|gold [n]|favour|feat [name]|level|foe>',
      help: 'Show a piece of the HUD (testing its look)',
      cheat: true,
      complete: () => ['callout', 'card', 'end', 'gold', 'favour', 'feat', 'level', 'foe'],
      run: ([what, arg], g, p) => {
        if (what === 'card') return void waveCards(g, Math.max(1, state.wave), 60);
        if (what === 'end') return void endRun(g, sampleRun(g, arg !== 'lose'), [sampleResult(p, arg !== 'lose')]);
        if (what === 'gold') return void addGold(g, p, Number(arg) || 25, p.position);
        if (what === 'favour') {
          bus.emit('hype', { value: 1, favour: true });
          return void bus.emit('feat', { player: null, name: 'favour', text: "The Crowd's Favour!" });
        }
        if (what === 'feat') return void bus.emit('feat', { player: p, name: arg ?? 'triple_kill', text: `${(arg ?? 'triple_kill').replace(/_/g, ' ')}!` });
        if (what === 'level') return void tell(g, p, MSG.level, { level: 8, unlocks: [{ kind: 'class', name: 'Pyromancer' }] });
        if (what === 'foe') return void tell(g, p, MSG.foe, { name: 'Knight', tip: 'Its shield turns blows from in front: hit it from the side, behind or above, parry it, or bomb it', color: '#d8dee6', role: 'heavy' } satisfies FoeMsg);
        return void call(g, p, { k: 'wave', q: 'Wave 7 of 20', t: 'Wave 7', s: 'The Swarm' });
      },
    });
  },

  start(game) {
    sent.clear();
    hype = { value: 0, favour: false };
    // (The clock may have started again with the fight: the periodic sends go from now.)
    meAt = partyAt = bossCheer = 0;
    goreBudget = { at: 0, n: 0 };
    fresh();
    tallies.reset();
    for (const p of game.players) {
      tallies.join(p);
      catchUp(game, p);
    }
  },

  update(game) {
    const now = game.clock.now;
    send(game, 'all', MSG.run, runMsg(game));
    if (foes.length && now >= nextFoe) {
      tell(game, 'all', MSG.foe, foes.shift()!);
      nextFoe = now + FOE_EVERY;
    }
    if (now >= meAt) {
      meAt = now + 0.2;
      send(game, 'all', MSG.hype, hypeMsg());
      for (const p of game.players) if (!p.bot) send(game, p, MSG.me, meMsg(game, p));
    }
    // The party (none once only one's left: their screen drops the rows).
    if (now >= partyAt) {
      partyAt = now + 0.25;
      send(game, 'all', MSG.party, game.players.length > 1 ? partyMsg(game) : { list: [] });
    }
  },
};

/** The run as it stands, ended (`hud end`, for looking at the end screen). */
function sampleRun(game: GameContext, won: boolean): EndRun {
  const wave = Math.max(1, state.wave);
  return { won, wave, endless: false, time: game.clock.now - state.startedAt, map: map().name, of: finalWave(), name: waveName(Math.max(1, wave)) };
}

/** A fighter's results as the run's part might give them (`hud end`): some XP, a level gained and what it unlocked, a new best. */
function sampleResult(p: Player, won: boolean): RunResult {
  const t = tallies.of(p.id);
  unlocks.set(p.id, won ? [{ kind: 'class', id: 'pyromancer', name: 'Pyromancer' }] : []);
  return {
    player: p,
    cls: classes.get(p.id) ?? 'gladiator',
    kills: t.kills,
    gold: t.gold,
    damage: t.damage,
    revives: 0,
    downs: 0,
    best: Math.max(1, state.wave),
    newBest: won,
    xp: { level: won ? 8 : 7, into: 640, need: 2200, total: 16_000, guest: !p.account, from: 7, earned: 2340, lines: [['VICTORY', 1, 1500], ['KILL', 41, 520], ['WAVES', 7, 280], ['DOUBLE KILL', 2, 40]] },
  };
}
