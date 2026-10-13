import { defineServer, type GameContext, type Player } from '@platform';
import { ARMORY_KITS, defineArt, defineItems } from './items';
import { defineMonsters } from './monsters';
import { defineBosses } from './bosses';
import { shared } from './shared';
import { ROLL } from './abilities';
import { BLESSINGS, grant, listen as blessingsListen, offer, plainBody, reopen, resetBlessings, settle, wave as blessingsWave, type BlessingId } from './blessings';
import { bus } from './run/bus';
import { directorListen, dusk, finalWave, resetDirector, startWave, tick, TWISTS, waveName, waveSpec, type Twist } from './run/director';
import { kindHooks } from './run/spawn';
import { inFight, map, newRun, resetState, runs, state } from './run/state';
import { PARTS } from './parts';
import { resetGold } from './run/gold';
import { resetUsables } from './run/use';
import { catchUp, payWave } from './run/coins';
import { bledOut, counts, standAll, standing } from './run/downed';
import { closeShop, openShop } from './run/shop';
import { CLASSES, classOf, classWaiting, closeClassMenus, hasChosen, offerClass } from './run/classes';
import { INTRO_TIME } from './maps/messages';
import { results } from './run/progression';
import { feat } from './run/hype';
import { DIFFICULTY } from './run/difficulty';

/** Seconds between waves (the shop open, a blessing to choose). */
const INTERMISSION = 20;
/** Seconds to choose a class before the first wave; once everyone has (or between waves, is ready), it's down to the last few. */
const CHOOSING = 14;
const LAST_SECONDS = 3.5;
/** Ready for the next wave (between waves). */
const READY_KEY = 'KeyN';
/** Who's ready for the next wave, by player id. */
const ready = new Set<string>();
/** A boss's wave won: a beat for its fall (its death cam) before the wave's done, and when that ends. */
const BOSS_BEAT = 1.2;
let wonAt: number | null = null;

/** Each fighter's place round the middle of the map as a fight begins (or they arrive), facing in. */
function stand(p: Player, i: number, n: number) {
  const c = map().center;
  const a = (i / Math.max(1, n)) * Math.PI * 2;
  const r = n > 1 ? 2 : 0;
  const at = { x: c.x + Math.cos(a) * r, y: c.y, z: c.z + Math.sin(a) * r };
  p.teleport(at, n > 1 ? Math.atan2(Math.cos(a), Math.sin(a)) : 0, 0);
}

/**
 * The countdown to the first wave (`state.nextWaveAt`): the map's fly-over first (the maps' part
 * sends it on `runStart`), then everyone choosing a class. (What the screens show of all this is the
 * HUD's, from the bus and the state: `hud/`.)
 */
function begin(game: GameContext) {
  const intro = map().intro.length ? INTRO_TIME.full + INTRO_TIME.ease / 2 : 0;
  state.phase = 'countdown';
  state.startedAt = game.clock.now;
  state.nextWaveAt = game.clock.now + intro + CHOOSING;
  bus.emit('runStart', { map: map() });
  for (const p of game.players) offerClass(game, p, intro);
}

/** The countdown's ticking: down to the last seconds once everyone's seen the map and chosen, then the first wave. */
function countdown(game: GameContext) {
  const now = game.clock.now;
  if (!classWaiting() && game.players.every(hasChosen) && state.nextWaveAt - now > LAST_SECONDS) state.nextWaveAt = now + LAST_SECONDS;
  if (now >= state.nextWaveAt) {
    closeClassMenus();
    startWave(game, 1);
  }
}

function waveCleared(game: GameContext) {
  const n = state.wave;
  const final = n === finalWave() && !state.endless;
  const up = game.players.filter(standing);
  for (const p of game.players) {
    if (standing(p) && runs.get(p.id)?.hurt === false) {
      p.achieve('untouched');
      feat(p, 'untouched', `${p.name}: not a scratch`);
    }
    if (n === 1) p.achieve('first_wave');
  }
  // The rest of the party down, and one left standing to win it.
  if (game.players.length > 1 && up.length === 1) {
    feat(up[0], 'last_stand', `${up[0].name} won it alone!`);
    up[0].achieve('last_stand');
  }
  const bonus = payWave(game, n);
  bus.emit('waveCleared', { wave: n, final, endless: state.endless, bonus });
  standAll(game);
  for (const p of game.players) if (!p.alive) rejoin(game, p);
  state.twist = null;
  state.boss = null;
  if (final) return victory(game);
  intermission(game);
}

/** Between waves: a breather, a blessing to choose, the reward on the dais, the shop open. */
function intermission(game: GameContext) {
  state.phase = 'intermission';
  ready.clear();
  state.nextWaveAt = game.clock.now + INTERMISSION;
  for (const p of game.players) p.heal(DIFFICULTY.breakHeal);
  // A blessing each, chosen from three.
  for (const p of game.players) offer(game, p);
  game.env.time = dusk(state.wave);
  openShop(game);
  // A reward for each fighter, in a ring on the dais: each can take only their own.
  const w = waveSpec(state.wave);
  const c = map().center;
  const rewards = game.players.flatMap((p) => (w.reward ?? []).map((r) => ({ ...r, p })));
  const radius = 1.2 + 0.4 * (game.players.length - 1);
  rewards.forEach((r, i) => {
    const a = (i / rewards.length) * Math.PI * 2;
    const at = { x: c.x + Math.cos(a) * radius, y: c.y + 0.5, z: c.z + Math.sin(a) * radius };
    game.items.spawnPickup(r.item, at, { count: r.count ?? 1, beam: '#ffd36b', despawn: 600, for: game.players.length > 1 ? r.p : undefined });
  });
}

/** Between waves, N says they're ready: once all the people fighting are, the next wave comes in a few seconds. */
function readyUp(game: GameContext) {
  const people = game.players.filter((p) => !p.bot);
  for (const p of people) {
    if (ready.has(p.id) || !p.input.pressed(READY_KEY)) continue;
    ready.add(p.id);
    const n = people.filter((q) => ready.has(q.id)).length;
    bus.emit('ready', { player: p, ready: n, of: people.length });
    if (people.length > 1) game.hud.feed(`${p.name} is ready (${n}/${people.length})`, { color: '#9dff8a' });
    p.hud.toast(n < people.length ? 'Ready: waiting for the others' : 'Ready: here they come');
  }
  if (people.length && people.every((p) => ready.has(p.id))) state.nextWaveAt = Math.min(state.nextWaveAt, game.clock.now + LAST_SECONDS);
}

/** Armed for the fight: their class's kit (`run/`), and gold to catch up if they're late; then the parts'. */
function arm(game: GameContext, p: Player) {
  plainBody(p);
  p.inventory.clear();
  runs.set(p.id, newRun(state.wave, game.clock.now, ''));
  const cleared = state.phase === 'fighting' ? state.wave - 1 : state.phase === 'intermission' || state.phase === 'victory' ? state.wave : 0;
  catchUp(game, p, cleared);
  for (const part of PARTS) part.arm?.(game, p);
  p.inventory.select(0);
}

/** Someone's out of the wave (bled out, or the last on their feet fell): they watch from the stands until it's won. */
function fall(game: GameContext, p: Player) {
  game.hud.feed(`${p.name} has fallen`, { color: '#ff8a4c' });
  bus.emit('fell', { player: p });
  game.clock.after(1.5, () => {
    if (p.alive || !game.players.includes(p)) return;
    const { lookout: l, center: c } = map();
    const dx = c.x - l.x;
    const dz = c.z - l.z;
    p.teleport(l, Math.atan2(-dx, -dz), Math.atan2(c.y - l.y - 1.6, Math.hypot(dx, dz)));
    p.freeze(true);
  });
}

/** Back on the arena floor after sitting a wave out. */
function rejoin(game: GameContext, p: Player) {
  p.revive();
  p.freeze(false);
  p.teleport(map().center, game.rng.range(0, Math.PI * 2), 0);
  bus.emit('rejoined', { player: p });
}

/** Nobody's left on their feet: the arena wins. */
function checkWipe(game: GameContext) {
  if (game.players.length && !game.players.some(standing)) defeat(game);
}

let fireworks: (() => void) | null = null;

function victory(game: GameContext) {
  state.phase = 'victory';
  bus.emit('runEnd', { won: true, wave: state.wave, endless: false, map: map(), time: game.clock.now - state.startedAt, results: results(game, true) });
  for (const p of game.players) {
    p.achieve('champion');
    const r = runs.get(p.id);
    if (r && r.from === 0 && !r.fell) p.achieve('unbroken');
    if (!p.bot) {
      const won = new Set(p.store.get<string[]>('classWins') ?? []);
      won.add(classOf(p));
      p.store.set('classWins', [...won]);
      if (won.size >= Object.keys(CLASSES).length) p.achieve('class_act');
    }
  }
  // Fireworks over the arena until they fight on (or start again).
  const c = map().center;
  const burst = () => game.fx.fireworks({ x: c.x, y: c.y, z: c.z }, 6);
  burst();
  fireworks = game.clock.every(1.1, burst);
}

/** On past the run's last wave (someone chose to keep fighting): the endless waves, for a best. */
function endless(game: GameContext) {
  if (state.phase !== 'victory') return;
  fireworks?.();
  fireworks = null;
  state.endless = true;
  intermission(game);
}

function defeat(game: GameContext) {
  if (state.phase === 'defeat' || state.phase === 'victory') return;
  state.phase = 'defeat';
  closeShop(game);
  bus.emit('runEnd', { won: false, wave: state.wave, endless: state.endless, map: map(), time: game.clock.now - state.startedAt, results: results(game, false) });
}

/**
 * Arena: survive twenty waves in an arena, four bosses among them, then on into the endless waves
 * for a best. Earn gold from what you slay and spend it at the merchant's between waves or on the
 * mystery chest, choose a blessing after each wave, pick a class, win the crowd. Alone or together:
 * more fighters bring more monsters, a fighter at the end of their health goes down for a friend
 * to revive, and the fight is lost when nobody's left standing. Built entirely on the public
 * platform API.
 *
 * This file is the flow: the countdown, the waves and the time between them, falling and coming
 * back, victory, the endless waves and defeat. Its parts: `maps/` (where), `monsters/` and
 * `bosses/` (who), `run/` (the waves, `director.ts`; gold, the shop, the chest, the crowd, revives,
 * classes and levels, `part.ts`), `items/` and `blessings.ts`, `hud/`, and the screens' `client/`.
 * They talk on `run/bus.ts`.
 */
export default defineServer(shared, {
  // Its kinds of item: bombs, bows, the arsenal's blades, crossbows and staffs (and the bare fist), potions (`items/`).
  items: ARMORY_KITS,
  setup(game) {
    bus.clear();
    resetUsables();
    resetGold();
    resetState();
    resetDirector();
    runs.clear();
    resetBlessings();
    // (Its voices and its items' looks are each screen's, `client/`: played and named here.)
    // No replays to show, so none kept: recording would cost a sixth of every step.
    game.replay.keep(0);
    defineArt(game);
    defineItems(game);
    defineMonsters(game);
    defineBosses(game);
    // Fighters never hurt each other (nor themselves): a bomb at your feet only throws monsters
    // about. First, so nothing after it takes a friend's blow for a real one.
    game.events.on('damage', (hit) => {
      if (hit.target.kind === 'player' && hit.source && hit.source !== 'world' && hit.source.kind === 'player') hit.cancel();
    });
    directorListen(game);
    blessingsListen(game);
    for (const part of PARTS) part.setup?.(game);
    // The dodge roll: untouchable for most of it, and a puff of sand.
    game.events.on('ability', ({ player, name }) => {
      if (name !== 'roll') return;
      player.protect(ROLL.safe);
      const q = player.position;
      game.fx.burst({ x: q.x, y: q.y + 0.2, z: q.z }, { color: '#d8c08a', count: 16, speed: 2.2, size: 0.18, gravity: -0.5, life: 0.6, drag: 2 });
      game.audio.play('whoosh', { at: q, volume: 0.6 });
    });
    game.events.on('entityDeath', ({ entity, killer, weapon }) => {
      if (entity.data.scenery) return;
      const by = killer && killer !== 'world' && killer.kind === 'player' ? killer : null;
      kindHooks(entity.type)?.slain?.(game, entity, by);
      bus.emit('slain', { entity, type: entity.type, by, weapon, at: { ...entity.position } });
    });
    game.events.on('entityDamage', ({ amount, source }) => {
      if (source === 'world' || source?.kind !== 'player') return;
      state.damageDealt += amount;
      const r = runs.get(source.id);
      if (r) r.damage += amount;
    });
    game.events.on('playerDamage', ({ player, amount }) => {
      if (!counts(player)) return;
      state.damageTaken += amount;
      const r = runs.get(player.id);
      if (r) r.hurt = true;
    });
    game.events.on('playerDeath', ({ player }) => {
      if (!inFight()) return;
      const r = runs.get(player.id);
      if (r) {
        r.fell = true;
        if (!bledOut(player)) r.downs++;
      }
      if (game.players.some(standing)) fall(game, player);
      else defeat(game);
    });
    bus.on('keepFighting', () => endless(game));
    game.commands.register('bless', {
      usage: '<blessing>',
      help: 'Give yourself a blessing',
      cheat: true,
      complete: () => Object.keys(BLESSINGS),
      run: ([id], g, p) => {
        if (!(id in BLESSINGS)) return `Blessings: ${Object.keys(BLESSINGS).join(', ')}`;
        grant(g, p, id as BlessingId, true);
      },
    });
    game.commands.register('wave', {
      usage: '<n> [twist]',
      help: 'Skip to wave n (clears the arena; past the last, the endless waves), with a twist if named',
      cheat: true,
      complete: () => Object.keys(TWISTS),
      run: ([n, twist], g) => {
        const w = Math.max(1, Number(n) || 1);
        if (twist && !(twist in TWISTS)) return `Twists: ${Object.keys(TWISTS).join(', ')}`;
        for (const e of g.entities.all()) if (!e.data.scenery) e.remove();
        closeClassMenus();
        closeShop(g);
        state.queue = [];
        state.endless = w > finalWave();
        startWave(g, w, twist as Twist | undefined);
        return `Wave ${w}: ${waveName(w)}${twist ? ` · ${TWISTS[twist as Twist].name}` : ''}`;
      },
    });
    game.commands.register('win', {
      help: 'Win this wave (every monster in it slain)',
      cheat: true,
      run: (_, g, p) => {
        if (state.phase !== 'fighting') return 'No wave on';
        state.queue = [];
        for (const e of g.entities.all()) if (!e.data.scenery) e.damage(1e6, { source: p });
      },
    });
    game.events.on('playerJoin', ({ player }) => {
      // Before the fight, `start` arms everyone; after everyone left, the next one starts it.
      if (state.phase === 'intro') return;
      arm(game, player);
      stand(player, 0, 1);
      if (state.phase === 'waiting') return begin(game);
      game.hud.feed(`${player.name} joins the fight`, { color: '#ffb36b' });
      // Their class once their (shorter) fly-over's done.
      if (inFight()) offerClass(game, player, INTRO_TIME.short + INTRO_TIME.ease / 2);
    });
    game.events.on('playerLeave', () => {
      // The last one out: the arena resets for whoever comes next.
      if (!game.players.length) {
        if (state.phase !== 'waiting' && state.phase !== 'intro') game.restart();
      } else if (inFight()) {
        checkWipe(game);
      }
    });
  },

  start(game) {
    resetState();
    resetGold();
    resetDirector();
    state.startedAt = game.clock.now;
    runs.clear();
    resetBlessings();
    fireworks = null;
    wonAt = null;
    // The parts first: the maps' choose where this fight is.
    for (const part of PARTS) part.start?.(game);
    const c = map().center;
    game.world.spawn = { x: c.x, y: c.y + 0.05, z: c.z, yaw: 0 };
    game.env.time = map().time;
    if (!game.players.length) {
      state.phase = 'waiting';
      return;
    }
    game.players.forEach((p, i) => {
      arm(game, p);
      stand(p, i, game.players.length);
    });
    begin(game);
  },

  update(game, dt) {
    for (const part of PARTS) part.update?.(game, dt);
    if (state.phase === 'countdown') countdown(game);
    else if (state.phase === 'fighting') {
      if (tick(game, dt).cleared) {
        wonAt ??= game.clock.now + (state.boss ? BOSS_BEAT : 0);
        if (game.clock.now >= wonAt) {
          wonAt = null;
          waveCleared(game);
        }
      }
    } else if (state.phase === 'intermission') {
      reopen(game);
      readyUp(game);
      if (game.clock.now >= state.nextWaveAt) {
        // Anyone who didn't choose a blessing is given one; Second Wind's back, the Bombardier's bombs.
        settle(game);
        blessingsWave(game);
        closeShop(game);
        startWave(game, state.wave + 1);
      }
    }
  },
});
