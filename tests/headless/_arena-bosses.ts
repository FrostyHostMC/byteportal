import type { Entity, GameContext, Player, SynthVoice, Vec3 } from '@platform';
import type { Client } from '../../src/platform/api/client';
import type { Headless, Pilot } from '../../src/platform/host/headless';
import { sounds } from '../../src/platform/client-kits';
import arenaClient from '../../src/games/arena/client';
import { bus } from '../../src/games/arena/run/bus';
import { bossState, near, type BossState } from '../../src/games/arena/bosses/fight';
import { bossKind } from '../../src/games/arena/bosses';
import { MARK_MSG, type Mark } from '../../src/games/arena/bosses/messages';
import { MAPS } from '../../src/games/arena/maps';
import { map } from '../../src/games/arena/run/state';
import { WAVES } from '../../src/games/arena/run/director';
import { stagger as stun } from '../../src/games/arena/items/status';
import { check, launch } from './_harness';

/**
 * Probe: the four bosses, one at a time, each brought in with `/boss` on a floor kept clear of the
 * waves' monsters: the entrance holds everyone, each signature move lands, a roll or a jump (or a
 * step aside) gets out of it, each phase comes at its mark, and each can be killed (its throes,
 * its fall, its loot and gold). Then each boss's wave on every map: it comes in at a boss gate,
 * gets to a fighter in the middle, keeps to the arena, and every circle it marks (bones, souls,
 * a leap, a nova) lies on the floor. Last, a boss fight with its adds is timed tick by tick.
 * `node scripts/headless.mjs tests/headless/_arena-bosses.ts`
 */
const FLOOR = 70;

interface Scene {
  h: Headless;
  game: GameContext;
  me: Player;
  boss: Entity;
  s: BossState;
  /** The damage the fighter has taken, each hit with what it was (`weapon`) and from whom. */
  hits: { t: number; amount: number; weapon?: string; from: string }[];
  /** Keep the floor to the boss and its own. */
  clear(): void;
  /** Let only `move` be chosen next (the rest held back). */
  only(move: string): void;
  /** Damage taken since `t`. */
  since(t: number): number;
}

function scene(seed: number, type: string, at: Vec3 = { x: 0.5, y: FLOOR + 1, z: 18.5 }, intro = false): Scene {
  const h = launch('arena', { seed });
  games.push(h);
  const game = h.ctx as GameContext;
  const me = game.player as Player;
  me.maxHealth = 1000;
  me.health = 1000;
  // (Bare: no class's armour, so the blows' damage shows as it is.)
  me.armor = 0;
  me.teleport(at, 0, 0);
  const hits: Scene['hits'] = [];
  game.events.on('playerDamage', ({ amount, weapon, source }) => hits.push({ t: h.time, amount, weapon, from: !source || source === 'world' ? 'world' : source.kind === 'entity' ? source.type : 'player' }));
  game.commands.run(`boss ${type}${intro ? '' : ' now'}`);
  const boss = game.entities.all(type)[0];
  check(boss, `${type} came in`);
  const s = bossState(boss);
  const clear = () => {
    for (const e of game.entities.all()) if (e !== sc.boss && e.data.master === undefined) e.remove();
  };
  const only = (move: string) => {
    const s = sc.s;
    for (const k of Object.keys(s.cds)) s.cds[k] = 99;
    for (const name of ['sweep', 'twin', 'stomp', 'rain', 'ribs', 'charge', 'swipe', 'slam', 'fireballs', 'chain', 'prison', 'bite', 'web', 'leap', 'eggs', 'spray', 'bolts', 'nova', 'spikes', 'raise', 'storm']) s.cds[name] = 99;
    s.cds[move] = 0;
  };
  const sc: Scene = { h, game, me, boss, s, hits, clear: () => clear(), only: (m) => only(m), since: (t) => hits.filter((x) => x.t >= t).reduce((a, x) => a + x.amount, 0) };
  return sc;
}

/** Put the fighter `d` blocks from the boss across the open floor (toward the middle and past it), facing it. */
function facing(sc: Scene, d: number) {
  const p = sc.boss.position;
  let dx = 0.5 - p.x, dz = 0.5 - p.z;
  const l = Math.hypot(dx, dz);
  [dx, dz] = l < 2 ? [0, 1] : [dx / l, dz / l];
  // Off the dais in the middle (it's a step up).
  let at = { x: p.x + dx * d, y: FLOOR + 1, z: p.z + dz * d };
  if (Math.hypot(at.x - 0.5, at.z - 0.5) < 4) at = { x: p.x + dx * (d + 7), y: FLOOR + 1, z: p.z + dz * (d + 7) };
  sc.me.teleport(at, Math.atan2(dx, dz), 0);
}

/** Every sound the bosses' fights asked every screen for (`audio.play`), and the games that asked. */
const asked = new Set<string>();
const games: Headless[] = [];

/** The engine's own sounds (`audio/sfx.ts`), which every screen has. */
const ENGINE_SOUNDS = ['hit', 'hurt', 'pickup', 'heal', 'wave', 'victory', 'defeat', 'spawn', 'click', 'countdown', 'lock', 'alarm', 'explosion', 'explosion_big', 'whoosh', 'arrow_hit'];
/** What the screens' own code plays (the stings, the footfalls: `client/bosses.ts`). */
const SCREEN_SOUNDS = ['boss_sting', 'boss_vanquished', 'boss_phase', 'colossus_step', 'warden_step', 'brood_step'];

/** Every sound asked for is one the Arena's screens have (its client code's voices, the standard kits', the engine's). */
function voices(log: (s: string) => void) {
  for (const h of games) for (const c of h.find('audio', 'play')) asked.add(c.args[0] as string);
  const defined = new Set<string>();
  const client = { audio: { play() {}, define: (n: string, _v: SynthVoice) => defined.add(n), defineLoop() {} }, items: { look() {}, get() {} } } as unknown as Client;
  for (const k of sounds.standard()) k.setup?.(client);
  arenaClient.client.setup!(client);
  const missing = [...asked, ...SCREEN_SOUNDS].filter((n) => !defined.has(n) && !ENGINE_SOUNDS.includes(n));
  log(`${asked.size} sounds asked for in the fights, all on the screens`);
  check(!missing.length, `sounds the screens don't have: ${missing.join(', ')}`);
}

/** Put the fighter `d` blocks from the boss where nothing stands between them (no pillar, no step), facing it. */
function clearOf(sc: Scene, d: number) {
  const p = sc.boss.position;
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    const at = { x: p.x + Math.cos(a) * d, y: FLOOR + 1, z: p.z + Math.sin(a) * d };
    let clear = sc.game.world.fits(at);
    for (let t = 0.1; t < 1 && clear; t += 0.05) clear = sc.game.world.getBlock(Math.floor(p.x + (at.x - p.x) * t), FLOOR + 1, Math.floor(p.z + (at.z - p.z) * t)) === sc.game.world.blockId('air');
    if (!clear) continue;
    sc.me.teleport(at, Math.atan2(at.x - p.x, at.z - p.z), 0);
    return;
  }
  throw new Error('no clear spot about the boss');
}

/** Run until `until` (or `max` seconds), keeping the floor clear, with `pilot` at the controls. */
function run(sc: Scene, max: number, until?: () => boolean, pilot?: Pilot) {
  return sc.h.run(max, { pilot: (h) => (sc.clear(), pilot?.(h) ?? null), until: until && (() => until()) });
}

/** Look at the boss and stand still. */
const watch = (sc: Scene): Pilot => () => {
  const e = sc.boss.position;
  const p = sc.me.position;
  return { yaw: Math.atan2(-(e.x - p.x), -(e.z - p.z)), pitch: 0.2 };
};

/** Run until the boss makes `move` (forced), and on until it's done; the damage taken meanwhile. */
function landed(sc: Scene, move: string, pilot?: Pilot, max = 12): number {
  // Only the boss: its own blows count.
  for (const e of sc.game.entities.all()) if (e !== sc.boss) e.remove();
  const t0 = sc.h.time;
  run(sc, max, () => sc.s.move?.name === move, () => (sc.only(move), pilot?.(sc.h) ?? watch(sc)(sc.h)));
  check(sc.s.move?.name === move, `${sc.boss.type} made its ${move}`);
  const rest: Pilot = (h) => (sc.only('none'), (pilot ?? watch(sc))(h));
  run(sc, 6, () => sc.s.move?.name !== move, rest);
  // (Its blows may land a moment after: bones out of the sky, a leap.)
  run(sc, 1.6, undefined, rest);
  return sc.since(t0);
}

/** A pilot that presses `key` once, just before the boss's move `move` lands (`lead` seconds before). */
function before(sc: Scene, move: string, key: string, lead: number, hold: string[] = []): Pilot {
  let done = false;
  return (h) => {
    const w = watch(sc)(h)!;
    if (!done && sc.s.move?.name === move && sc.s.step === 'windup' && sc.s.t <= lead) {
      done = true;
      return { ...w, pressed: [key], down: [key, ...hold] };
    }
    return { ...w, down: done ? hold : [] };
  };
}

/** A pilot that runs (holding `key`) from the moment the boss's `move` is made (its tell's over) for `seconds`: out of a ring, a lane. */
function escape(sc: Scene, move: string, key: string, seconds: number, from: 'windup' | 'act' = 'act'): Pilot {
  let at = -1;
  return (h) => {
    const w = watch(sc)(h)!;
    if (at < 0 && sc.s.move?.name === move && (from === 'windup' || sc.s.step !== 'windup')) at = h.time;
    return { ...w, down: at >= 0 && h.time - at < seconds ? [key] : [] };
  };
}

/** Kill it: the throes (it stands, untouchable, the camera on it), then the fall, the loot, the gold. */
function kill(sc: Scene, log: (s: string) => void) {
  const { game, boss, me, h } = sc;
  let coins = 0;
  bus.on('coins', ({ value }) => (coins += value));
  boss.health = 5;
  boss.damage(50, { source: me, weapon: 'iron_sword' });
  check(boss.alive && sc.s.dying, `${boss.type}: a lethal blow starts its throes, it doesn't drop at once`);
  run(sc, 0.1);
  check(h.find('message', 'arena.boss.fall').length === 1, `${boss.type}: every screen is told it's falling`);
  boss.damage(50, { source: me });
  check(boss.alive, `${boss.type}: nothing lands on it in its throes`);
  run(sc, 4);
  check(!boss.alive, `${boss.type}: dead after its throes`);
  const loot = h.sim.items.frame().length;
  check(loot > 3, `${boss.type}: a shower of loot (${loot} pickups)`);
  check(coins > 0, `${boss.type}: gold for the run (${coins})`);
  check(!game.entities.all().some((e) => e.data.master === boss.id && e.alive), `${boss.type}: its minions fell with it`);
  log(`${boss.type} slain: ${loot} pickups, ${coins} gold`);
}

/** Into the next phase: its health set just past the mark, and the phase's line on every screen. */
function phase(sc: Scene, at: number, n: number) {
  const before = sc.h.find('message', 'arena.boss.phase').length;
  sc.boss.health = sc.boss.maxHealth * (at - 0.02);
  run(sc, 3, () => sc.s.phase === n && sc.s.transition === 0);
  check(sc.s.phase === n, `${sc.boss.type} in phase ${n} below ${Math.round(at * 100)}%`);
  check(sc.h.find('message', 'arena.boss.phase').length > before, `${sc.boss.type}: phase ${n} announced`);
}

/** A boss wave as the director runs it: the boss first, its entrance, and the escort only after. */
function directed(log: (s: string) => void) {
  const h = launch('arena', { seed: 71 });
  games.push(h);
  const game = h.ctx as GameContext;
  const me = game.player as Player;
  me.maxHealth = 1000;
  me.health = 1000;
  const wave = WAVES.findIndex((w) => w.boss) + 1;
  game.commands.run(`wave ${wave}`);
  h.run(8, { until: () => game.entities.all().some((e) => bossKind(e.type)) });
  const boss = game.entities.all().find((e) => bossKind(e.type));
  check(boss, `wave ${wave} brings its boss (${WAVES[wave - 1].boss})`);
  let early = 0;
  h.run(5.2, { until: () => (early = game.entities.all().filter((e) => !bossKind(e.type)).length) > 0 });
  check(!early, `the escort waits for the entrance (${early} came in during it)`);
  h.run(4);
  const escort = game.entities.all().filter((e) => !bossKind(e.type)).length;
  log(`wave ${wave}: ${boss.type} first, its entrance, then ${escort} of its escort`);
  check(escort > 0, 'the escort comes in after the entrance');
}

function colossus(log: (s: string) => void) {
  // The entrance: the boss and the fighter held, then both free.
  {
    const sc = scene(11, 'colossus', undefined, true);
    run(sc, 1.5);
    check(sc.h.find('message', 'arena.boss.intro').length === 1, 'the entrance is played on every screen');
    check(sc.me.frozen && sc.s.held, 'the fighter and the boss are held during the entrance');
    const hp = sc.boss.health;
    sc.boss.damage(30, { source: sc.me });
    check(sc.boss.health === hp, 'nothing hurts the boss during its entrance');
    run(sc, 4.5);
    check(!sc.me.frozen && !sc.s.held, 'both free after the entrance');
    log('entrance: held 5.4 s, then the fight');
  }
  const sc = scene(12, 'colossus', { x: 0.5, y: FLOOR + 1, z: 10.5 });
  // The stomp: it lands standing; a jump over it, or a roll through it, takes nothing.
  const stomp = landed(sc, 'stomp');
  const jumped = landed(sc, 'stomp', before(sc, 'stomp', 'Space', 0.1));
  const rolled = landed(sc, 'stomp', before(sc, 'stomp', 'KeyQ', 0.06));
  log(`stomp: ${stomp} standing, ${jumped} jumping it, ${rolled} rolling through it`);
  check(stomp >= 2.5 && jumped === 0 && rolled === 0, 'the stomp lands standing, and a jump or a roll avoids it');
  // The sweep: in front of it it lands; a roll goes through it.
  const swept = landed(sc, 'sweep');
  const swRolled = landed(sc, 'sweep', before(sc, 'sweep', 'KeyQ', 0.06));
  log(`sweep: ${swept} standing, ${swRolled} rolling`);
  check(swept >= 3.5 && swRolled === 0, 'the sweep lands in front of it, and a roll avoids it');
  // The bone rain: a circle under the fighter; standing still it lands, running out of it it doesn't.
  sc.me.teleport({ x: 0.5, y: FLOOR + 1, z: 14.5 }, 0, 0);
  const rain = landed(sc, 'rain');
  const ran = landed(sc, 'rain', escape(sc, 'rain', 'KeyA', 1.4));
  log(`bone rain: ${rain} standing, ${ran} running out of its circle`);
  check(rain >= 4 && ran < rain, 'the bones land on whoever stays in the circle');
  // A blast at its feet staggers it.
  sc.s.staggerCd = 0;
  const b = sc.boss.position;
  sc.game.world.explode({ x: b.x, y: b.y + 0.5, z: b.z }, 1, { damage: 22, reach: 4, by: sc.me, weapon: 'bomb', filter: () => false });
  check(sc.s.stagger > 0, 'a bomb at its feet staggers it');
  log('a bomb staggers it');
  run(sc, 3);
  // Phase two: thralls out of its ribcage; its charge into a wall stuns it.
  phase(sc, 0.6, 2);
  run(sc, 6, () => sc.s.move?.name === 'ribs', () => (sc.only('ribs'), null));
  run(sc, 3);
  const thralls = sc.game.entities.all('thrall').filter((t) => t.data.master === sc.boss.id).length;
  check(thralls === 1, `a thrall climbs out of its ribcage, one for a lone fighter (${thralls})`);
  log(`phase 2: ${thralls} thrall${thralls === 1 ? "" : "s"}`);
  for (const t of sc.game.entities.all('thrall')) t.remove();
  sc.me.teleport({ x: 0.5, y: FLOOR + 1, z: 18.5 }, 0, 0);
  run(sc, 8, () => sc.s.move?.name === 'charge' && sc.s.step === 'act', (h) => (sc.only('charge'), watch(sc)(h)));
  check(sc.s.move?.name === 'charge', 'it charges');
  // Step aside, and it runs on into the wall.
  run(sc, 4, () => sc.s.stagger > 0, () => ({ down: ['KeyA'], yaw: 0, pitch: 0 }));
  check(sc.s.stagger > 0 && sc.s.vulnerable > 0, 'a charge that ends in the wall stuns it');
  log('a charge into the wall stuns it');
  phase(sc, 0.25, 3);
  check(sc.s.enraged, 'enraged below a quarter');
  kill(sc, log);
}

function warden(log: (s: string) => void) {
  const sc = scene(21, 'warden', { x: 0.5, y: FLOOR + 1, z: 9.5 });
  // The slam: jump it (and earn Light on Your Feet).
  const slam = landed(sc, 'slam');
  const jumped = landed(sc, 'slam', before(sc, 'slam', 'Space', 0.1));
  log(`slam: ${slam} standing, ${jumped} jumping it`);
  check(slam >= 4 && jumped === 0 && sc.me.achieved('slam_dodge'), 'the slam lands standing; jumping it avoids it');
  // The chain, from far off (across open floor, nothing in the way): it drags the fighter in.
  clearOf(sc, 12);
  const t0 = sc.h.time;
  run(sc, 8, () => sc.s.move?.name === 'chain' && sc.s.step !== 'windup', (h) => (sc.only('chain'), watch(sc)(h)));
  const far = sc.boss.distanceTo(sc.me);
  run(sc, 3, () => sc.hits.some((x) => x.t >= t0 && x.weapon === 'warden_chain'), watch(sc));
  run(sc, 0.7, undefined, watch(sc));
  const after = sc.boss.distanceTo(sc.me);
  log(`chain: ${far.toFixed(1)} blocks away, dragged to ${after.toFixed(1)}`);
  check(after < far - 4, 'the chain drags the fighter in');
  // Rolling as it's cast: it misses.
  facing(sc, 12);
  run(sc, 1);
  let rolled = false;
  const t1 = sc.h.time;
  run(sc, 6, () => rolled && sc.h.time > t1 + 3, (h) => {
    sc.only(rolled ? 'none' : 'chain');
    const w = watch(sc)(h)!;
    if (!rolled && sc.s.move?.name === 'chain' && sc.s.step !== 'windup') {
      rolled = true;
      return { ...w, pressed: ['KeyQ'], down: ['KeyQ', 'KeyA'] };
    }
    return w;
  });
  const chained = sc.hits.filter((x) => x.t >= t1 && x.weapon === 'warden_chain').length;
  log(`chain, rolling as it's cast: ${chained ? 'caught' : 'missed'}`);
  check(!chained, 'a roll as the chain is cast gets out of its way');
  // Phase two: the soul prison cages whoever stays in its ring.
  phase(sc, 0.66, 2);
  for (const e of sc.game.entities.all()) if (e !== sc.boss) e.remove();
  sc.me.teleport({ x: 0.5, y: FLOOR + 1, z: 16.5 }, 0, 0);
  run(sc, 8, () => sc.s.move?.name === 'prison' && sc.s.step !== 'windup', (h) => (sc.only('prison'), watch(sc)(h)));
  run(sc, 0.2);
  check(sc.me.frozen, 'the soul prison cages whoever stays in its ring');
  run(sc, 3.5);
  check(!sc.me.frozen, 'and lets them go after a while');
  log('soul prison: caged, then free');
  phase(sc, 0.33, 3);
  check(sc.s.enraged, 'enraged below a third');
  kill(sc, log);
}

function broodmother(log: (s: string) => void) {
  const sc = scene(31, 'broodmother', { x: 0.5, y: FLOOR + 1, z: 17.5 });
  // Eggs: laid about the arena; smash one, the rest hatch.
  run(sc, 8, () => sc.s.move?.name === 'eggs' && sc.s.step !== 'windup', (h) => (sc.only('eggs'), watch(sc)(h)));
  run(sc, 1.5);
  const eggs = sc.game.entities.all('egg_sac').filter((e) => e.alive);
  check(eggs.length >= 2, `egg sacs laid (${eggs.length})`);
  eggs[0].damage(100, { source: sc.me });
  run(sc, 7, undefined, (h) => (sc.only('none'), watch(sc)(h)));
  const lings = sc.game.entities.all('spiderling').length;
  log(`eggs: ${eggs.length} laid, one smashed, ${lings} spiderlings hatched`);
  check(lings === (eggs.length - 1) * 3, 'the eggs left alone hatch into spiderlings');
  for (const e of sc.game.entities.all('spiderling')) e.remove();
  // A web: the fighter's slowed.
  facing(sc, 10);
  const t0 = sc.h.time;
  run(sc, 8, () => sc.hits.some((x) => x.t >= t0 && x.weapon === 'web'), (h) => (sc.only('web'), watch(sc)(h)));
  check(sc.me.speed < 0.6, `a web slows (speed ${sc.me.speed.toFixed(2)})`);
  run(sc, 3.5, undefined, (h) => (sc.only('none'), watch(sc)(h)));
  check(Math.abs(sc.me.speed - 1) < 1e-6, 'and wears off');
  log('web: slowed, then not');
  // The leap: onto the ring under the fighter; out of the ring, nothing.
  facing(sc, 12);
  const leap = landed(sc, 'leap');
  facing(sc, 12);
  const away = landed(sc, 'leap', escape(sc, 'leap', 'KeyA', 1.6, 'windup'));
  log(`leap: ${leap} standing in its ring, ${away} running out`);
  check(leap >= 5 && away < leap, 'her leap lands on the marked ring');
  // Phase two: venom pools hurt whoever stands in them.
  phase(sc, 0.65, 2);
  for (const e of sc.game.entities.all()) if (e !== sc.boss) e.remove();
  sc.me.teleport({ x: 0.5, y: FLOOR + 1, z: 16.5 }, 0, 0);
  const t1 = sc.h.time;
  run(sc, 8, () => sc.s.move?.name === 'spray' && sc.s.step !== 'windup', (h) => (sc.only('spray'), watch(sc)(h)));
  run(sc, 4, undefined, (h) => (sc.only('none'), watch(sc)(h)));
  const venom = sc.hits.filter((x) => x.t >= t1 && x.weapon === 'venom').reduce((a, x) => a + x.amount, 0);
  log(`venom pools: ${venom} standing in one`);
  check(venom > 2, 'a venom pool hurts whoever stands in it');
  // Frenzy: every egg hatches at once.
  for (const e of sc.game.entities.all()) if (e !== sc.boss) e.remove();
  run(sc, 8, () => sc.s.move?.name === 'eggs' && sc.s.step !== 'windup', (h) => (sc.only('eggs'), watch(sc)(h)));
  run(sc, 1);
  const before3 = sc.game.entities.all('egg_sac').length;
  phase(sc, 0.3, 3);
  run(sc, 0.5);
  check(before3 > 0 && sc.game.entities.all('egg_sac').length === 0 && sc.game.entities.all('spiderling').length > 0, 'her frenzy hatches every egg at once');
  log('frenzy: every egg hatched');
  kill(sc, log);
}

function lich(log: (s: string) => void) {
  const sc = scene(41, 'lich', { x: 0.5, y: FLOOR + 1, z: 16.5 });
  // He floats a block over the floor.
  run(sc, 2, undefined, (h) => (sc.only('none'), watch(sc)(h)));
  const floats = sc.boss.position.y - (FLOOR + 1);
  check(floats > 0.6 && floats < 1.6, `he floats over the floor (${floats.toFixed(2)} blocks)`);
  // Crowded, he blinks to the marked spot well away, leaving frost where he was.
  sc.me.teleport({ x: sc.boss.position.x, y: FLOOR + 1, z: sc.boss.position.z + 2.5 }, 0, 0);
  const pools = sc.h.find('message', 'arena.boss.mark').filter((c) => (c.args[0] as { k: string }).k === 'pool').length;
  sc.s.mem.pressure = 5;
  run(sc, 3, () => sc.s.move?.name === 'blink' && sc.s.step !== 'windup', (h) => (sc.only('blink'), watch(sc)(h)));
  run(sc, 0.2);
  const away = sc.boss.distanceTo(sc.me);
  const frost = sc.h.find('message', 'arena.boss.mark').filter((c) => (c.args[0] as { k: string }).k === 'pool').length > pools;
  log(`blink: ${away.toFixed(1)} blocks away after it, frost left behind: ${frost}`);
  check(away > 6 && frost, 'crowded, he blinks well away and leaves frost behind');
  // The arsenal's stagger (a parry, a slam) cuts a move short and holds him a moment.
  facing(sc, 10);
  run(sc, 6, () => sc.s.move?.name === 'spikes' && sc.s.step === 'windup', (h) => (sc.only('spikes'), watch(sc)(h)));
  stun(sc.game, sc.boss, 1.6);
  run(sc, 0.1);
  check(!sc.s.move && ((sc.boss.data.stunned as number) ?? 0) > 0, 'a stagger from the arsenal cuts his move short');
  run(sc, 1, undefined, (h) => (sc.only('bolts'), watch(sc)(h)));
  check(bossState(sc.boss).move?.name === 'bolts', 'and he takes up the fight again after it');
  log('the arsenal\'s stagger: his move cut short, then back at it');
  // Frost bolts chill.
  const t0 = sc.h.time;
  run(sc, 8, () => sc.hits.some((x) => x.t >= t0 && x.weapon === 'frost'), (h) => (sc.only('bolts'), watch(sc)(h)));
  check(sc.me.speed < 0.9, 'a frost bolt chills');
  log('frost bolt: chilled');
  run(sc, 3);
  // The nova freezes whoever it catches on the ground; a jump clears it.
  clearOf(sc, 3.5);
  run(sc, 8, () => sc.s.move?.name === 'nova' && sc.s.step !== 'windup', (h) => (sc.only('nova'), watch(sc)(h)));
  run(sc, 0.15);
  const frozen = sc.me.frozen;
  run(sc, 2);
  const jumped = landed(sc, 'nova', before(sc, 'nova', 'Space', 0.1));
  log(`nova: ${frozen ? 'frozen' : 'not frozen'} standing, ${jumped} jumping it`);
  check(frozen && jumped === 0, 'the nova freezes whoever stands in it, and a jump clears it');
  // Ice spikes along a lane: step aside.
  facing(sc, 11);
  const spikes = landed(sc, 'spikes');
  const aside = landed(sc, 'spikes', escape(sc, 'spikes', 'KeyA', 1.2, 'windup'));
  log(`ice spikes: ${spikes} standing in the lane, ${aside} stepping aside`);
  check(spikes >= 5 && aside === 0, 'the spikes hit whoever stays in their lane');
  // Phase two: shielded behind phylacteries, which must all be broken.
  phase(sc, 0.66, 2);
  const wards = sc.game.entities.all('phylactery');
  check(sc.s.shield && wards.length >= 3, `shielded behind ${wards.length} phylacteries`);
  const hp = sc.boss.health;
  sc.boss.damage(40, { source: sc.me });
  check(sc.boss.health === hp, 'nothing lands on him while they stand');
  for (const w of wards) w.damage(100, { source: sc.me });
  run(sc, 0.5);
  check(!sc.s.shield && sc.s.stagger > 0, 'his shield shatters when the last falls, and he reels');
  sc.boss.damage(40, { source: sc.me });
  check(sc.boss.health < hp, 'and he can be hurt again');
  log(`phase 2: ${wards.length} phylacteries broken, the shield shattered`);
  // Phase three: the soul storm.
  for (const e of sc.game.entities.all()) if (e !== sc.boss) e.remove();
  phase(sc, 0.33, 3);
  const t1 = sc.h.time;
  run(sc, 6, () => sc.s.move?.name === 'storm', (h) => (sc.only('storm'), watch(sc)(h)));
  run(sc, 10);
  const storm = sc.hits.filter((x) => x.t >= t1 && x.from === 'lich').reduce((a, x) => a + x.amount, 0);
  log(`soul storm: ${storm} standing still through it`);
  check(storm >= 5, 'the soul storm rains on whoever stands about');
  phase(sc, 0.14, 4);
  check(sc.s.enraged, 'enraged at the end');
  kill(sc, log);
}

/** A boss fight with its adds, timed: the server's cost a tick. */
function timing(log: (s: string) => void) {
  const sc = scene(51, 'colossus', { x: 0.5, y: FLOOR + 1, z: 12.5 });
  sc.boss.health = sc.boss.maxHealth * 0.5;
  run(sc, 3);
  for (let i = 0; i < 8; i++) sc.game.entities.spawn(i % 2 ? 'zombie' : 'skeleton', { x: -6 + i * 1.5, y: FLOOR + 1.05, z: -8 }, { data: { master: sc.boss.id } });
  const ticks = 60 * 20;
  const t = performance.now();
  sc.h.run(ticks / 60, { pilot: watch(sc) });
  const ms = (performance.now() - t) / ticks;
  log(`a boss fight with ${sc.game.entities.count()} creatures: ${ms.toFixed(2)} ms a tick (headless, the whole simulation)`);
  check(ms < 3, 'a boss fight stays under 3 ms a tick');
}

export default function arenaBosses() {
  const log = (r: string) => console.log(`  ${r}`);
  directed(log);
  colossus(log);
  warden(log);
  broodmother(log);
  lich(log);
  party(log);
  everyMap(log);
  voices(log);
  timing(log);
}

/** Air under a body's feet at `p` (0: standing on something), to a quarter block. */
function gap(game: GameContext, p: Vec3): number {
  for (let d = 0; d < 8; d += 0.25) if (!game.world.fits({ x: p.x, y: p.y + 0.05 - d, z: p.z })) return Math.max(0, d - 0.25);
  return 8;
}

/** How close (flat) each boss gets to a fighter when it's fighting them: its reach. */
const CLOSE: Record<string, number> = { colossus: 7, warden: 4.5, broodmother: 5, lich: 11 };

/** Each boss's wave on every map, the fighter standing in the middle (unhurt, the waves' monsters cleared). */
function everyMap(log: (s: string) => void) {
  const rows: string[] = [];
  for (const m0 of MAPS) {
    // Spots about the floor (the bones', the storm's, the eggs'): on the floor, not in the air over a sunken one.
    {
      const h = launch('arena', { seed: 3 });
      const game = h.ctx as GameContext;
      game.commands.run(`map ${m0.id}`);
      h.run(0.5, { pilot: () => ({}) });
      const m = map();
      check(m.id === m0.id, `the fight moved to ${m0.id}`);
      let off = 0;
      for (let i = 0; i < 200; i++) {
        const p = near(game, m.center, m.radius - 2, m.center, m.radius);
        if (!game.world.fits({ x: p.x, y: p.y + 0.05, z: p.z }) || gap(game, p) > 0.6) off++;
      }
      check(off <= 2, `${m0.id}: spots about the floor on it (${off} of 200 not)`);
    }
    const seen: string[] = [];
    for (const w of WAVES.map((x, i) => ({ wave: i + 1, boss: x.boss })).filter((x) => x.boss && bossKind(x.boss))) {
      const h = launch('arena', { seed: 7 });
      const game = h.ctx as GameContext;
      const me = game.player as Player;
      game.commands.run(`map ${m0.id}`);
      h.run(0.5, { pilot: () => ({}) });
      const m = map();
      me.maxHealth = 5000;
      me.health = 5000;
      me.teleport({ x: m.center.x, y: m.center.y + 0.05, z: m.center.z }, 0, 0);
      game.commands.run(`wave ${w.wave}`);
      h.run(10, { until: () => game.entities.all().some((e) => bossKind(e.type)) });
      const boss = game.entities.all().find((e) => bossKind(e.type));
      check(boss, `${m0.id}: wave ${w.wave} brings its boss`);
      const s = bossState(boss);
      const at = boss.position;
      const gateD = Math.min(...(m.bossGates ?? m.gates).map((g) => Math.hypot(g.at.x - at.x, g.at.z - at.z)));
      check(gateD < 2, `${m0.id}: the ${boss.type} comes in at a boss gate (${gateD.toFixed(1)} from one)`);
      const marks = h.find('message', MARK_MSG).length;
      const t0 = h.time;
      let close = -1;
      let outside = 0;
      let floats = 0;
      h.run(25, {
        pilot: () => {
          for (const e of game.entities.all()) if (e !== boss && e.data.master === undefined) e.remove();
          me.health = me.maxHealth;
          const b = boss.position;
          const p = me.position;
          if (close < 0 && Math.hypot(b.x - p.x, b.z - p.z) < CLOSE[boss.type]) close = h.time - t0;
          if (Math.hypot(b.x - m.center.x, b.z - m.center.z) > m.radius + 1.5) outside++;
          if (boss.type === 'lich' && !s.held && h.time - t0 > 6) {
            const g = gap(game, b);
            if (g < 0.4 || g > 3.2) floats++;
          }
          return { yaw: Math.atan2(-(b.x - p.x), -(b.z - p.z)), pitch: 0.1 };
        },
      });
      const rings = h.find('message', MARK_MSG).slice(marks).map((c) => c.args[0] as Mark).filter((k): k is Extract<Mark, { k: 'ring' }> => k.k === 'ring');
      const off = rings.filter((r) => {
        const p = { x: r.at[0], y: r.at[1], z: r.at[2] };
        return !game.world.fits({ x: p.x, y: p.y + 0.05, z: p.z }) || gap(game, p) > 0.6;
      });
      check(close >= 0 && close < 16, `${m0.id}: the ${boss.type} gets to the fighter in the middle (${close.toFixed(1)} s)`);
      check(!outside, `${m0.id}: the ${boss.type} keeps to the arena (${outside} ticks outside)`);
      check(!off.length, `${m0.id}: the ${boss.type}'s circles on the floor (${off.length} of ${rings.length} not: ${off.map((r) => r.at.map((v) => v.toFixed(1)).join(',')).join('; ')})`);
      check(!floats, `${m0.id}: the Lich floats over the floor (${floats} ticks too high or low)`);
      seen.push(`${boss.type} ${close.toFixed(0)} s`);
    }
    rows.push(`${m0.id} (${seen.join(', ')})`);
  }
  log(`every map: in at a boss gate, at the middle in: ${rows.join('; ')}; circles on the floor`);
}

/** Three fighters: all held for the entrance, the boss tougher for them, and adds for each. */
function party(log: (s: string) => void) {
  const sc = scene(61, 'colossus', { x: 0.5, y: FLOOR + 1, z: 12.5 });
  const b1 = sc.game.bots.add('Ann');
  const b2 = sc.game.bots.add('Bob');
  run(sc, 1);
  for (const [i, b] of [b1, b2].entries()) b.teleport({ x: -3 + i * 6, y: FLOOR + 1, z: 12.5 }, 0, 0);
  // A fresh one, with its entrance (the floor's kept to it now).
  sc.boss.remove();
  sc.game.commands.run('boss colossus');
  const boss = sc.game.entities.all('colossus').find((e) => e.alive)!;
  sc.boss = boss;
  sc.s = bossState(boss);
  run(sc, 1);
  check([sc.me, b1, b2].every((p) => p.frozen), 'the whole party is held for the entrance');
  run(sc, 5);
  check([sc.me, b1, b2].every((p) => !p.frozen), 'and let go after it');
  const hp = boss.health;
  boss.damage(27, { source: sc.me });
  const took = hp - boss.health;
  log(`three fighters: a blow of 27 takes ${took.toFixed(1)} (the boss ${(27 / took).toFixed(1)} times as tough)`);
  // (Times the run's difficulty, from its wave: `run/difficulty.ts`.)
  check(Math.abs(27 / took - 2.4 * ((boss.data.tough as number | undefined) ?? 1)) < 0.05, 'a boss is 2.4 times as tough for three');
}
