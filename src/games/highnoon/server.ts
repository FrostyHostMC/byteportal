import { defineServer, type Bot, type GameContext, type Player, type WidgetHandle } from '@platform';
import { guns, melee, navGrid } from '@platform/kits';
import { makeBots, type Bots } from './bots';
import { CYLINDER, DUEL, OUTFITS, ROUNDBAR, WANTED } from './hud';
import { MAP, type SpawnPoint } from './map';
import { COWBOYS } from './models';
import { COLORS, cowboyModel, GUN_RULES, shared } from './shared';
import { defineWeapons, feedIcon, WEAPONS } from './weapons';

/**
 * High Noon: last gunslinger standing in Dry Gulch. Each round starts as a standoff: everyone at
 * their mark, hands over their holsters, the church bell counting three. At DRAW the guns come
 * out, and the last one standing takes the round; first to three rounds takes the town. There's a
 * price on every head: a kill adds to yours, a headshot more, a round won more still, and whoever
 * kills you collects what yours was worth. The biggest is the Most Wanted, on the poster.
 *
 * House rules (the `damage` event): nothing lands until the DRAW; the first second and a half
 * after it is the quick draw (shots do half again); an aimed Peacemaker headshot from a standstill
 * is a dead-eye (it kills outright); and the Most Wanted takes a little more from everyone.
 */

const TARGET = 3;
const FIGHTERS = 6;
const MAX_FIGHTERS = 8;
/** The standoff: the clock counts 3, 2, 1, then DRAW. */
const COUNT = 3;
const ROUND_TIME = 80;
/** After this long the sun's too high to hide from: everyone standing shows on everyone's screen. */
const REVEAL = 40;
const QUICK_DRAW = 1.5;
const BETWEEN = 5;
const MATCH_END = 11;
const BOUNTY = { kill: 25, headshot: 25, round: 50 };
const BOT_NAMES = ['Doc Hollis', 'Calamity Kate', 'Two-Bit Pete', 'Rattlesnake Ruiz', 'Dusty Boone', 'One-Eyed Jack', 'Belle Sterling', 'Mesa Mae', 'Tex Callahan', 'Lefty Ortega', 'Silver Sam'];

interface Gunslinger {
  player: Player;
  outfit: number;
  /** Rounds won, and this match's tally. */
  wins: number;
  kills: number;
  deaths: number;
  headshots: number;
  /** The price on their head, and the bounties they've collected. */
  bounty: number;
  purse: number;
  /** In this round (dead or joined late: out until the next). */
  standing: boolean;
  diedAt: number;
  picker: WidgetHandle | null;
}

type Phase = 'standoff' | 'fight' | 'roundover' | 'matchover';

let slingers = new Map<string, Gunslinger>();
let phase: Phase = 'standoff';
let running = false;
let round = 0;
let phaseAt = 0;
let drawAt = -99;
let revealed = false;
let lastSecond = -1;
let bots: Bots;
let boardDirty = true;

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const isPlayer = (a: unknown): a is Player => typeof a === 'object' && a !== null && (a as Player).kind === 'player';
const standings = () => [...slingers.values()].sort((a, b) => b.wins - a.wins || b.kills - a.kills || b.purse - a.purse);
/** The Most Wanted: the biggest price on a head (worth at least a kill and a round). */
function mostWanted(): Gunslinger | null {
  let best: Gunslinger | null = null;
  for (const s of slingers.values()) if (s.bounty >= 75 && (!best || s.bounty > best.bounty)) best = s;
  return best;
}

// -------------------------------------------------------------------------------------------------
// Gunslingers: joining, outfits, arming
// -------------------------------------------------------------------------------------------------

function addSlinger(game: GameContext, p: Player): Gunslinger {
  const taken = new Set([...slingers.values()].map((s) => s.outfit));
  const free = COWBOYS.map((_, i) => i).filter((i) => !taken.has(i));
  const outfit = free.length ? free[Math.floor(game.rng.next() * free.length)] : game.rng.int(0, COWBOYS.length - 1);
  const s: Gunslinger = { player: p, outfit, wins: 0, kills: 0, deaths: 0, headshots: 0, bounty: 0, purse: 0, standing: false, diedAt: -1, picker: null };
  p.setModel(cowboyModel(outfit));
  slingers.set(p.id, s);
  boardDirty = true;
  return s;
}

/** The outfit picker on their screen (a modal: it frees the mouse; Esc closes it). */
function showPicker(s: Gunslinger) {
  s.picker = s.player.hud.widget('outfits', {
    outfits: COWBOYS.map((c, i) => ({ id: c.id, name: c.name, on: i === s.outfit ? 'on' : '', ...c.look })),
  });
}

/** Both guns, full, and the hand empty (holstered) until the DRAW. */
function arm(p: Player, holstered: boolean) {
  const inv = p.inventory;
  inv.clear();
  inv.give('revolver');
  inv.give('rifle');
  inv.select(holstered ? 2 : 0);
}

/** Spread the round's fighters over the spawns, far from each other. */
function placements(game: GameContext, n: number): SpawnPoint[] {
  const pool = [...MAP.spawns];
  const out: SpawnPoint[] = [];
  out.push(pool.splice(game.rng.int(0, pool.length - 1), 1)[0]);
  while (out.length < n && pool.length) {
    let bi = 0;
    let bd = -1;
    pool.forEach((sp, i) => {
      const d = Math.min(...out.map((o) => Math.hypot(o.x - sp.x, o.z - sp.z))) + game.rng.next() * 6;
      if (d > bd) {
        bd = d;
        bi = i;
      }
    });
    out.push(pool.splice(bi, 1)[0]);
  }
  return out;
}

function balanceBots(game: GameContext) {
  const humans = game.players.filter((p) => !p.bot).length;
  const want = Math.max(0, Math.min(MAX_FIGHTERS - humans, FIGHTERS - humans));
  const have = game.bots.all;
  if (have.length < want) {
    const used = new Set(game.players.map((p) => p.name));
    for (let i = have.length; i < want; i++) {
      const name = BOT_NAMES.find((n) => !used.has(n)) ?? `Drifter ${i + 1}`;
      used.add(name);
      game.bots.add(name);
    }
  } else if (have.length > want) {
    const out = [...have].sort((a, b) => (slingers.get(a.id)?.wins ?? 0) - (slingers.get(b.id)?.wins ?? 0)).slice(0, have.length - want);
    for (const b of out) game.bots.remove(b);
  }
}

// -------------------------------------------------------------------------------------------------
// Rounds
// -------------------------------------------------------------------------------------------------

function startRound(game: GameContext) {
  round++;
  phase = 'standoff';
  phaseAt = game.clock.now;
  drawAt = -99;
  revealed = false;
  const all = [...slingers.values()];
  const spots = placements(game, all.length);
  all.forEach((s, i) => {
    const p = s.player;
    const sp = spots[i % spots.length];
    p.camera.orbit(null);
    p.revive();
    p.health = p.maxHealth;
    p.teleport({ x: sp.x, y: sp.y + 0.05, z: sp.z }, sp.yaw, 0);
    arm(p, true);
    // Rooted to the mark, hands off the guns: no drawing, no shooting, no loading till the bell.
    p.freeze(true, { weapons: true });
    // Hands over holsters, knees soft (a clip over the rig, on every screen).
    p.animate('standoff', { loop: true, fade: 0.3 });
    s.standing = true;
    s.diedAt = -1;
    if (p.bot) bots.reset(p);
  });
  for (const s of all) game.hud.marker(`reveal-${s.player.id}`, null);
  bots.hunt = [];
  game.audio.play('bell');
  boardDirty = true;
}

function draw(game: GameContext) {
  phase = 'fight';
  phaseAt = drawAt = game.clock.now;
  for (const s of slingers.values()) {
    if (!s.standing) continue;
    const p = s.player;
    p.freeze(false);
    p.animate(null, { fade: 0.12 });
    p.inventory.select(0);
  }
  game.audio.play('draw');
  // Everyone's duel card (it reaches each person's own copy too: the standoff's clock was theirs).
  game.hud.widget('duel', { phase: 'draw', round, target: TARGET, title: 'DRAW!', sub: '', tally: [] });
  game.clock.after(0.9, () => {
    if (phase === 'fight') game.hud.widget('duel', { phase: null });
  });
}

function tally(forPlayer?: Player) {
  const table = standings();
  return table.map((s, i) => ({ name: s.player.name, wins: Array.from({ length: s.wins }, () => ''), cls: `${i === 0 && s.wins > 0 ? 'lead' : ''} ${s.player === forPlayer ? 'me' : ''}` }));
}

function endRound(game: GameContext, winner: Gunslinger | null) {
  if (phase !== 'fight') return;
  phase = 'roundover';
  phaseAt = game.clock.now;
  for (const s of slingers.values()) game.hud.marker(`reveal-${s.player.id}`, null);
  if (winner) {
    winner.wins++;
    winner.bounty += BOUNTY.round;
    const p = winner.player;
    // The gun thrown up to the sky (a clip; what's held goes with the hand).
    p.animate('victory', { fade: 0.2 });
    p.freeze(true);
    game.audio.play('whistle');
    game.hud.feed([{ text: p.name, color: COLORS.brass }, ` takes round ${round}`]);
  } else game.hud.feed(['Nobody walks away from round ' + round]);
  const champion = standings().find((s) => s.wins >= TARGET);
  for (const s of slingers.values()) {
    if (s.player.bot) continue;
    s.player.hud.widget('duel', {
      phase: 'over',
      round,
      target: TARGET,
      title: winner ? (winner === s ? 'You take the round' : `${winner.player.name} takes it`) : 'Nobody left standing',
      sub: champion ? `${champion.player.name} has ${TARGET}: that's the town` : `Round ${round + 1} at high noon`,
      tally: tally(s.player),
    });
  }
  boardDirty = true;
}

function endMatch(game: GameContext) {
  phase = 'matchover';
  phaseAt = game.clock.now;
  const table = standings();
  const champ = table[0];
  for (const s of slingers.values()) {
    const p = s.player;
    p.freeze(true);
    if (p === champ.player) p.animate('tip_hat', { fade: 0.2 });
    if (p.bot) continue;
    p.hud.widget('duel', { phase: null });
    p.hud.banner(p === champ.player ? 'THE TOWN IS YOURS' : 'RIDE ON, STRANGER', `${champ.player.name} took Dry Gulch, ${champ.wins} rounds · $${champ.purse} collected`, {
      color: p === champ.player ? COLORS.brass : COLORS.cream,
      duration: MATCH_END - 1,
    });
    const key = `stats:${p.name}`;
    const st = game.store.get<{ matches: number; towns: number; kills: number; purse: number }>(key) ?? { matches: 0, towns: 0, kills: 0, purse: 0 };
    st.matches++;
    if (p === champ.player) st.towns++;
    st.kills += s.kills;
    st.purse += s.purse;
    game.store.set(key, st);
    p.hud.toast(`All time: ${st.towns} towns taken · ${st.kills} kills · $${st.purse} in bounties`);
  }
  game.audio.play('victory');
  scoreboard(game, true);
}

// -------------------------------------------------------------------------------------------------
// Kills and bounties
// -------------------------------------------------------------------------------------------------

function onDeath(game: GameContext, victim: Player, source: unknown, weapon: string | undefined, headshot: boolean) {
  const v = slingers.get(victim.id);
  if (!v) return;
  v.standing = false;
  v.deaths++;
  v.diedAt = game.clock.now;
  boardDirty = true;
  const killer = isPlayer(source) && source !== victim ? source : null;
  const k = killer ? slingers.get(killer.id) : undefined;
  const icon = weapon ? feedIcon(weapon) : null;
  if (k && killer) {
    const wasWanted = mostWanted() === v;
    k.kills++;
    if (headshot) k.headshots++;
    const collected = v.bounty;
    k.purse += collected;
    k.bounty += BOUNTY.kill + (headshot ? BOUNTY.headshot : 0);
    v.bounty = 0;
    killer.hud.pop(collected > 0 ? `+$${collected}` : headshot ? 'HEADSHOT' : 'DOWN', {
      big: wasWanted,
      color: COLORS.brass,
      sub: wasWanted ? `You got the Most Wanted: ${victim.name}` : victim.name.toUpperCase(),
    });
    if (collected > 0) killer.audio.play('cash');
    game.hud.feed([{ text: killer.name, color: killer.bot ? '#6b4a2e' : COLORS.blood }, ...(icon ? [{ icon }] : [' ✕ ']), ...(headshot ? ['☠'] : []), { text: victim.name, color: COLORS.ink }]);
    if (!victim.bot) {
      victim.hud.banner('SHOT DOWN', `by ${killer.name}${weapon ? ` · ${WEAPONS[weapon]?.name ?? weapon}` : ''}${headshot ? ' · through the hat' : ''}`, { color: COLORS.blood, duration: 3 });
      if (killer.alive) victim.camera.orbit(killer, { distance: 5, min: 3, max: 9 });
    }
  } else {
    game.hud.feed([{ text: victim.name, color: COLORS.ink }, ' bit the dust']);
    if (!victim.bot) victim.hud.banner('BIT THE DUST', undefined, { color: COLORS.blood, duration: 3 });
  }
}

// -------------------------------------------------------------------------------------------------
// HUD
// -------------------------------------------------------------------------------------------------

function scoreboard(game: GameContext, show = false) {
  game.hud.scoreboard({
    title: phase === 'matchover' ? 'DRY GULCH · THE LAST WORD' : `DRY GULCH · ROUND ${round}`,
    columns: ['Rounds', 'Kills', 'Deaths', 'Bounty', 'Collected'],
    rows: standings().map((s, i) => ({
      name: `${s.player.name}${s.player.bot ? ' ·bot' : ''}`,
      values: [s.wins, s.kills, s.deaths, `$${s.bounty}`, `$${s.purse}`],
      color: i === 0 && s.wins > 0 ? COLORS.brass : undefined,
      player: s.player,
    })),
    footer: phase === 'matchover' ? `Next town in ${Math.max(0, Math.ceil(MATCH_END - (game.clock.now - phaseAt)))}` : `First to ${TARGET} rounds takes the town`,
    show,
  });
}

/**
 * The cylinder's layout: the Peacemaker's six chambers (each with how many rounds loaded it takes
 * to fill that one: the drum turns a chamber a shot) and the Yellowboy's tube. What's in them is
 * the gun on each player's own screen (`$gun`), so this is all the game sends, once.
 */
const CHAMBERS = {
  drum: Array.from({ length: WEAPONS.revolver.magazine }, (_, i) => ({ k: WEAPONS.revolver.magazine - i })),
  tube: Array.from({ length: WEAPONS.rifle.magazine }, () => 1),
};

/** Each person's own widgets: their gun's rounds and the Most Wanted's poster (with their own price). */
function personalHud(s: Gunslinger) {
  const p = s.player;
  p.hud.widget('cylinder', CHAMBERS);
  const w = mostWanted();
  const look = w ? COWBOYS[w.outfit % COWBOYS.length].look : null;
  p.hud.widget('wanted', {
    name: w ? w.player.name : '',
    bounty: w?.bounty ?? 0,
    note: w ? (w === s ? "That's you. Watch your back." : `${w.wins} rounds · ${w.kills} kills`) : '',
    hat: look?.hat ?? '#000',
    shirt: look?.shirt ?? '#000',
    skin: look?.skin ?? '#000',
    mine: s.bounty,
  });
}

/** Where the match is (for tests). */
export const matchState = () => ({ phase, round });

// -------------------------------------------------------------------------------------------------
// The game
// -------------------------------------------------------------------------------------------------

export default defineServer(shared, {
  // Its kinds of item: guns, played by its rules (`GUN_RULES`, as each screen plays them), and the bare fist.
  items: [guns(GUN_RULES), melee()],
  setup(game) {
    slingers = new Map();
    running = false;
    round = 0;
    defineWeapons(game);
    // (Their looks and the game's voices are each screen's, `client/`: named and played here by name.)
    game.hud.define('cylinder', CYLINDER);
    game.hud.define('wanted', WANTED);
    game.hud.define('duel', DUEL);
    game.hud.define('roundbar', ROUNDBAR);
    game.hud.define('outfits', {
      ...OUTFITS,
      actions: {
        pick: (player, value) => {
          const s = slingers.get(player.id);
          const i = COWBOYS.findIndex((c) => c.id === value);
          if (!s || i < 0) return;
          s.outfit = i;
          player.setModel(cowboyModel(i));
          s.picker?.remove();
          s.picker = null;
          player.hud.toast(`You ride as ${COWBOYS[i].name}`);
        },
      },
      onClose: (player) => {
        const s = slingers.get(player.id);
        if (s) s.picker = null;
      },
    });
    // The walking grid (built once the town's blocks are here) and the bots on it.
    bots = makeBots(game, navGrid(game, { bounds: MAP.bounds }), MAP.hotspots);

    game.events.on('playerJoin', ({ player }) => {
      if (!slingers.has(player.id)) addSlinger(game, player);
      if (player.bot) bots.add(player as Bot, 0.3 + game.rng.next() * 0.55);
      else {
        balanceBots(game);
        game.hud.feed([{ text: player.name, color: COLORS.brass }, ' rode into Dry Gulch']);
        // Arriving mid-round: watch until the next (a freeze now holds when they press Play).
        if (running && phase !== 'standoff') {
          const alive = [...slingers.values()].find((o) => o.standing && o.player.alive);
          player.freeze(true, { weapons: true });
          arm(player, true);
          if (alive) player.camera.orbit(alive.player, { distance: 6, min: 3, max: 12 });
          player.hud.toast('You ride in at the next high noon');
        }
      }
    });
    // Their screen is in play: choose your look (a modal; O brings it back).
    game.events.on('playerReady', ({ player }) => {
      const s = slingers.get(player.id);
      if (s) showPicker(s);
    });
    game.events.on('playerLeave', ({ player }) => {
      slingers.delete(player.id);
      bots.remove(player);
      boardDirty = true;
      if (!player.bot) balanceBots(game);
    });
    game.events.on('playerDeath', ({ player, source, weapon, headshot }) => onDeath(game, player, source, weapon, !!headshot));

    // House rules: every hit is heard before it lands.
    game.events.on('damage', (hit) => {
      // Nothing lands outside a fight (the standoff, between rounds).
      if (phase !== 'fight') return hit.cancel();
      const by = hit.source;
      if (hit.cause !== 'gun' || !isPlayer(by) || hit.target.kind !== 'player') return;
      const now = game.clock.now;
      // Dead-eye: an aimed Peacemaker headshot, standing still, kills outright.
      const still = Math.hypot(by.velocity.x, by.velocity.z) < 0.6;
      if (hit.weapon === 'revolver' && hit.part === 'head' && guns.of(game)?.aiming(by) && still) {
        hit.amount = Math.max(hit.amount, 500);
        by.hud.pop('DEAD-EYE', { big: true, color: COLORS.brass, sub: 'aimed, still, between the eyes' });
        by.audio.play('dead_eye');
        return;
      }
      // The quick draw: the first moments after the bell hit harder.
      if (now - drawAt < QUICK_DRAW) {
        hit.amount *= 1.5;
        by.hud.pop('QUICK DRAW', { color: COLORS.brass });
      }
      // The Most Wanted takes a little more from everyone.
      const w = mostWanted();
      if (w && w.player === hit.target) hit.amount *= 1.15;
    });

    // The dodge roll: a puff of dust and a jingle of spurs where it happened.
    game.events.on('ability', ({ player, name }) => {
      if (name !== 'roll') return;
      const q = player.position;
      game.fx.burst({ x: q.x, y: q.y + 0.2, z: q.z }, { color: '#c9a36a', count: 18, speed: 2.4, size: 0.18, gravity: -0.5, life: 0.7, drag: 2 });
      game.audio.play('spurs', { at: q });
    });

    game.commands.register('bots', {
      usage: '<n>',
      help: 'Fill the town up to n gunslingers',
      cheat: true,
      run: ([n], g) => {
        const want = Math.max(0, Math.min(MAX_FIGHTERS, Number(n) || 0) - g.players.filter((p) => !p.bot).length);
        while (g.bots.all.length > want) g.bots.remove(g.bots.all[g.bots.all.length - 1]);
        const used = new Set(g.players.map((p) => p.name));
        while (g.bots.all.length < want) {
          const name = BOT_NAMES.find((x) => !used.has(x)) ?? `Drifter ${g.bots.all.length}`;
          used.add(name);
          g.bots.add(name);
        }
        return `${g.players.length} gunslingers`;
      },
    });
    game.commands.register('emote', {
      usage: '<tip_hat|victory|standoff|none>',
      help: "Play one of your figure's clips",
      complete: () => ['tip_hat', 'victory', 'standoff', 'none'],
      run: ([clip], _g, p) => {
        p.animate(!clip || clip === 'none' ? null : clip, { layer: clip === 'tip_hat' ? 'upper' : 'full' });
        return clip ?? 'none';
      },
    });
  },

  start(game) {
    running = true;
    round = 0;
    lastSecond = -1;
    boardDirty = true;
    for (const s of slingers.values()) Object.assign(s, { wins: 0, kills: 0, deaths: 0, headshots: 0, bounty: 0, purse: 0, standing: false, diedAt: -1 });
    for (const p of game.players) if (!slingers.has(p.id)) addSlinger(game, p);
    balanceBots(game);
    startRound(game);
  },

  update(game, dt) {
    const now = game.clock.now;
    bots.update(dt, phase !== 'fight');
    const t = now - phaseAt;
    const humans = [...slingers.values()].filter((s) => !s.player.bot);

    // Each person's own corner, and O for the outfit picker.
    for (const s of humans) {
      personalHud(s);
      if (s.player.input.pressed('KeyO')) showPicker(s);
    }

    if (phase === 'standoff') {
      const count = Math.max(1, COUNT - Math.floor(t));
      for (const s of humans)
        s.player.hud.widget('duel', {
          phase: 'standoff',
          round,
          target: TARGET,
          title: 'HIGH NOON',
          sub: `${[...slingers.values()].filter((o) => o.standing).length} guns in Dry Gulch · wait for the bell`,
          count,
          tally: [],
        });
      if (Math.floor(t) !== lastSecond) {
        lastSecond = Math.floor(t);
        if (t < COUNT) game.audio.play('tick');
      }
      if (t >= COUNT + 0.2) draw(game);
    } else if (phase === 'fight') {
      const standing = [...slingers.values()].filter((s) => s.standing);
      for (const s of standing) if (!s.player.alive) s.standing = false;
      const left = standing.filter((s) => s.player.alive);
      if (left.length <= 1 && slingers.size > 1) endRound(game, left[0] ?? null);
      else if (t >= ROUND_TIME) {
        // Out of time: the one with the most blood left takes it (a tie, nobody).
        const [a, b] = [...left].sort((p, q) => q.player.health - p.player.health);
        endRound(game, a && (!b || a.player.health > b.player.health) ? a : null);
      } else if (t >= REVEAL && !revealed) {
        revealed = true;
        game.hud.banner('NOWHERE TO HIDE', 'The sun is straight overhead', { color: COLORS.brass, duration: 2.5 });
        for (const s of left) game.hud.marker(`reveal-${s.player.id}`, s.player, { offset: { x: 0, y: 2.4, z: 0 }, shape: 'diamond', color: '#ff6a3a', size: 12, edge: true, pulse: true });
      }
      bots.hunt = revealed || left.length === 2 ? left.map((s) => s.player) : [];
      // The edge of town.
      for (const s of left) {
        const q = s.player.position;
        if (q.y < MAP.floorY - 12) s.player.damage(1000, { source: 'world', knockback: 0 });
      }
    } else if (phase === 'roundover') {
      if (t >= BETWEEN) {
        for (const s of slingers.values()) s.player.animate(null);
        if (standings().some((s) => s.wins >= TARGET)) endMatch(game);
        else {
          for (const s of humans) s.player.hud.widget('duel', { phase: null });
          startRound(game);
        }
      }
    } else if (phase === 'matchover') {
      if (t >= MATCH_END) game.restart();
      else if (Math.floor(now) !== lastSecond) {
        lastSecond = Math.floor(now);
        scoreboard(game, true);
      }
      return;
    }

    // The round bar: the round, a pip for each gun, the clock.
    const left = phase === 'fight' ? Math.max(0, ROUND_TIME - t) : ROUND_TIME;
    game.hud.widget('roundbar', {
      round,
      alive: [...slingers.values()].map((s) => (s.standing && s.player.alive ? 'up' : 'dead')),
      time: fmt(left),
      hurry: phase === 'fight' && left < 15 ? 'hurry' : '',
    });
    if (boardDirty) {
      boardDirty = false;
      scoreboard(game);
    }
  },
});
