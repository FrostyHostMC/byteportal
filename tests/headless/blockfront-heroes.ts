import type { Bot, GameContext, Player, Vec3 } from '../../src/platform/api/types';
import type { PlayerInput } from '../../src/platform/net/protocol';
import { HERO_ABILITY, type HeroMove } from '../../src/games/blockfront/heroes/abilities';
import { INTRO_HOLD } from '../../src/games/blockfront/cinema';
import { HEROES, type HeroId } from '../../src/games/blockfront/heroes/defs';
import { match } from '../../src/games/blockfront/match';
import type { Sabers } from '../../src/games/blockfront/heroes/saber';
import type { Team } from '../../src/games/blockfront/teams';
import { check, launch } from './_harness';

/**
 * The heroes' core mechanics, on a platform of stone in the sky over the map (nothing in the
 * way): two saber cuts kill a trooper; the guard turns bolts from the front but not from the side;
 * Force Push throws troopers back; Force Choke kills one; Force Lightning burns several at once;
 * Saber Rush cuts through a line; Chewblocca's and Boba Fetch's powers; each hero's jump (how
 * high and long it floats held, a tap's hop, a second jump in the air, a soft landing); and, in a
 * match of bots, hero bots use their powers.
 */

const DT = 1 / 60;
/** The platform: its middle, and the floor under it. */
const AT = { x: 0.5, y: 110, z: 0.5 };

export default function blockfrontHeroes() {
  const t0 = performance.now();
  const h = launch('blockfront', { seed: 5, radius: 6 });
  const g = h.ctx;
  const me = g.player;
  // Past the match's opening fly-over, which holds everyone still (cinema.ts).
  h.run(INTRO_HOLD + 0.1);
  g.commands.run('/bots 0');
  check(g.players.length === 1, `expected only the player once the bots went, got ${g.players.length}`);
  /** The platform, laid whole (again: bolts that miss chip it, and a section mustn't stand anyone on a hole). */
  const floor = () => {
    for (let x = -14; x <= 14; x++) for (let z = -14; z <= 14; z++) g.world.setBlock(Math.floor(AT.x) + x, AT.y - 1, Math.floor(AT.z) + z, 'air');
    for (let x = -14; x <= 14; x++) for (let z = -14; z <= 14; z++) g.world.setBlock(Math.floor(AT.x) + x, AT.y - 1, Math.floor(AT.z) + z, 'stone');
  };
  floor();
  h.run(0.2);

  const troopers: Bot[] = [];
  /** The troopers fight for the other side from the hero's. */
  let theirs: Team = 1;
  const trooper = (): Bot => {
    const b = g.bots.add(`Target ${troopers.length + 1}`);
    const f = match.fighters.get(b.id)!;
    f.team = theirs;
    f.cls = 'trooper';
    b.maxHealth = b.health = 100;
    troopers.push(b);
    return b;
  };
  const place = (p: Player, x: number, z: number, yaw = 0) => p.teleport({ x: AT.x + x, y: AT.y, z: AT.z + z }, yaw, 0);
  /** Everyone's health back and spawn protection gone; the troopers held still, weapons down. */
  const ready = (who: Player[]) => {
    floor();
    for (const p of who) {
      if (!p.alive) p.revive();
      p.health = p.maxHealth;
      p.protect(0);
      if (p !== me) p.freeze(true, { weapons: true });
    }
  };
  /** Face a point (yaw 0 looks toward -z). */
  const yawTo = (from: Vec3, to: Vec3) => Math.atan2(-(to.x - from.x), -(to.z - from.z));
  const hero = (id: HeroId) => {
    g.commands.run(`/hero ${id}`);
    theirs = HEROES[id].team === 0 ? 1 : 0;
    for (const t of troopers) match.fighters.get(t.id)!.team = theirs;
    check(me.inventory.held?.item === HEROES[id].weapon, `expected ${id}'s weapon in hand, got ${me.inventory.held?.item}`);
    const m = me.abilities[HERO_ABILITY] as HeroMove;
    m.c0 = m.c1 = m.c2 = 0;
  };
  const idle = (seconds: number, input: Partial<PlayerInput> = {}) => h.run(seconds, { pilot: () => ({ yaw: me.yaw, pitch: me.pitch, ...input }) });
  const tap = (input: Partial<PlayerInput>) => h.step(DT, { yaw: me.yaw, pitch: me.pitch, ...input });
  const messages = (name: string) => h.calls.filter((c) => c.target === 'message' && c.method === name).length;

  // ---- The saber: two cuts kill a 100-health trooper.
  hero('luke');
  const t1 = trooper();
  idle(0.2);
  place(me, 0, 0, 0);
  place(t1, 0, -2.2);
  ready([me, t1]);
  idle(0.3);
  check(t1.maxHealth === 100, `a trooper has 100 health (got ${t1.maxHealth})`);
  tap({ clicked: 1 });
  idle(0.5);
  const afterOne = t1.health;
  check(t1.alive && afterOne < 100 && afterOne > 0, `one cut should hurt, not kill (health ${afterOne})`);
  place(me, 0, 0, 0);
  place(t1, 0, -2.2);
  tap({ clicked: 1 });
  idle(0.6);
  check(!t1.alive, `two cuts should kill a trooper (health ${t1.health})`);
  console.log(`  saber: first cut left ${afterOne.toFixed(0)} of 100, the second killed`);

  // ---- The combo: held, three swings follow on, each a different one.
  idle(0.6);
  const swings0 = h.calls.length;
  idle(1.3, { buttons: 1 });
  const combo = h.calls.slice(swings0).filter((c) => c.target === 'message' && c.method === 'bfh.swing').map((c) => (c.args[0] as { n: number }).n);
  check(combo.slice(0, 3).join(',') === '0,1,2', `held, the combo should run 0,1,2 (got ${combo.join(',')})`);
  idle(0.6);

  // ---- The guard: bolts from the front turned, from the side and behind not.
  hero('ben');
  const shooter = t1;
  shooter.revive();
  idle(0.2);
  place(me, 0, 0, 0);
  place(shooter, 0, -10);
  ready([me, shooter]);
  idle(0.9, { buttons: 4 });
  const bolt = (from: Player) => me.damage(24, { source: from, cause: 'gun', weapon: 'imp_rifle', part: 'body' });
  let before = me.health;
  let deflected0 = messages('bfh.deflect');
  for (let i = 0; i < 6; i++) {
    bolt(shooter);
    idle(0.1, { buttons: 4 });
  }
  const frontLoss = before - me.health;
  const frontDeflects = messages('bfh.deflect') - deflected0;
  check(frontLoss === 0, `the guard should stop bolts from the front (lost ${frontLoss})`);
  check(frontDeflects > 0, 'deflected bolts should be shown');
  place(shooter, 10, 0);
  idle(0.1, { buttons: 4 });
  before = me.health;
  bolt(shooter);
  idle(0.1, { buttons: 4 });
  const sideLoss = before - me.health;
  // (A hero shrugs off some of a bolt: TOUGH.blaster.)
  check(sideLoss > 10, `a bolt from the side should get through the guard (lost ${sideLoss})`);
  place(shooter, 0, 10);
  idle(0.1, { buttons: 4 });
  before = me.health;
  bolt(shooter);
  idle(0.1);
  check(before - me.health > 10, 'a bolt from behind should get through');
  // A detonator's blast from the front gets through the guard whole.
  place(shooter, 0, -10);
  idle(0.1, { buttons: 4 });
  before = me.health;
  me.damage(90, { source: shooter, cause: 'explosion', weapon: 'detonator' });
  idle(0.1, { buttons: 4 });
  check(before - me.health >= 89, `a detonator should hurt through the guard (lost ${(before - me.health).toFixed(0)})`);
  // Without the guard up, from the front: it hurts.
  place(shooter, 0, -10);
  idle(0.2);
  before = me.health;
  bolt(shooter);
  idle(0.1);
  check(before - me.health > 10, 'with the guard down, a bolt should hurt');
  // A live trooper firing at the guard: most bolts turned.
  me.health = me.maxHealth;
  shooter.freeze(false);
  deflected0 = messages('bfh.deflect');
  before = me.health;
  let shots = 0;
  const off = g.events.on('shot', ({ player }) => player === shooter && shots++);
  const through: string[] = [];
  const off2 = g.events.on('playerDamage', ({ player, source }) => {
    if (player !== me || source !== shooter) return;
    const dx = shooter.position.x - me.position.x;
    const dz = shooter.position.z - me.position.z;
    const ang = Math.acos((dx * -Math.sin(me.yaw) + dz * -Math.cos(me.yaw)) / Math.hypot(dx, dz)) * 57.3;
    through.push(`${ang.toFixed(0)}°`);
  });
  idle(3, { buttons: 4, yaw: yawTo(me.position, shooter.position) });
  off();
  off2();
  if (through.length) console.log(`  (through the guard: from ${through.join(', ')} off where he looked)`);
  const liveDeflects = messages('bfh.deflect') - deflected0;
  console.log(`  guard: 6 frontal bolts all turned (${frontDeflects} shown), a flanking one took ${sideLoss.toFixed(0)}; a live trooper fired ${shots}, ${liveDeflects} steps of deflections, ${(before - me.health).toFixed(0)} got through`);
  check(shots > 5, `the trooper should have fired at the hero (${shots})`);
  check(liveDeflects > 0, 'a live trooper\'s bolts should be deflected');
  shooter.freeze(true, { weapons: true });

  // ---- Force Push: two troopers in front thrown back, and hurt.
  hero('luke');
  const t2 = trooper();
  idle(0.2);
  place(me, 0, 0, 0);
  place(shooter, -1, -3.5);
  place(t2, 1.2, -4.5);
  ready([me, shooter, t2]);
  idle(0.3);
  const was = [shooter, t2].map((t) => ({ ...t.position }));
  shooter.freeze(false);
  t2.freeze(false);
  tap({ pressed: ['KeyQ'] });
  idle(0.35);
  const pushed = [shooter, t2].map((t, i) => t.position.z - was[i].z);
  console.log(`  push: thrown back ${pushed.map((d) => d.toFixed(1)).join(' and ')} blocks, health ${shooter.health.toFixed(0)} and ${t2.health.toFixed(0)}`);
  check(pushed.every((d) => d < -2.5), `push should throw both back (moved ${pushed.map((d) => d.toFixed(2)).join(', ')})`);
  check(shooter.health < 100 && t2.health < 100, 'push should hurt');
  check((me.abilities[HERO_ABILITY] as HeroMove).c0 > 0, 'push should be cooling down');

  // ---- Saber Rush: a dash through a line of troopers.
  (me.abilities[HERO_ABILITY] as HeroMove).c1 = 0;
  idle(0.1);
  place(me, 0, 8, 0);
  place(shooter, 0.3, 4);
  place(t2, -0.4, 2.5);
  ready([me, shooter, t2]);
  idle(0.3);
  const startZ = me.position.z;
  tap({ pressed: ['KeyE'] });
  idle(0.6);
  console.log(`  rush: ${(startZ - me.position.z).toFixed(1)} blocks, troopers at ${shooter.health.toFixed(0)} and ${t2.health.toFixed(0)}`);
  check(startZ - me.position.z > 5, `the rush should carry Luke well ahead (${(startZ - me.position.z).toFixed(1)})`);
  check(shooter.health < 100 && t2.health < 100, 'the rush should cut both troopers');

  // ---- Force Choke: a trooper lifted and choked to death.
  hero('vader');
  idle(0.2);
  place(me, 0, 0, 0);
  place(shooter, 0, -8);
  ready([me, shooter, t2]);
  place(t2, 8, 8);
  idle(0.3);
  const ground = shooter.position.y;
  tap({ pressed: ['KeyE'], yaw: yawTo(me.eye, shooter.position), pitch: -0.08 });
  idle(0.8);
  const lifted = shooter.position.y - ground;
  idle(3);
  console.log(`  choke: lifted ${lifted.toFixed(2)} blocks, ${shooter.alive ? `alive at ${shooter.health.toFixed(0)}` : 'dead'}`);
  check(lifted > 0.6, `the choked should be lifted (${lifted.toFixed(2)})`);
  check(!shooter.alive, `a choke should kill a trooper (health ${shooter.health})`);

  // ---- Saber Throw: out and back, cutting.
  shooter.revive();
  (me.abilities[HERO_ABILITY] as HeroMove).c0 = 0;
  idle(0.2);
  place(me, 0, 0, 0);
  place(shooter, 0.4, -6);
  place(t2, -0.3, -11);
  ready([me, shooter, t2]);
  idle(0.3);
  tap({ pressed: ['KeyQ'], pitch: -0.05 });
  idle(1.3);
  console.log(`  saber throw: troopers at ${shooter.health.toFixed(0)} and ${t2.health.toFixed(0)}`);
  check(shooter.health < 100 && t2.health < 100, 'the thrown saber should cut both troopers in its path');

  // ---- Force Lightning: three troopers in front burning at once.
  hero('emperor');
  const t3 = trooper();
  idle(0.2);
  place(me, 0, 0, 0);
  place(shooter, -1.5, -5);
  place(t2, 1.5, -6);
  place(t3, 0, -8);
  ready([me, shooter, t2, t3]);
  idle(0.3);
  const confirms0 = messages('bf.hit');
  h.run(1.4, { pilot: () => ({ yaw: 0, pitch: -0.12, down: ['KeyQ'] }) });
  idle(0.2);
  const confirms = messages('bf.hit') - confirms0;
  const burnt = [shooter, t2, t3].map((t) => (t.alive ? t.health : 0));
  console.log(`  lightning: 1.4 s held, troopers at ${burnt.map((v) => v.toFixed(0)).join(', ')}; ${confirms} hit confirms`);
  check(burnt.every((v) => v < 60), `lightning should burn all three (${burnt.join(', ')})`);
  // (Its harm comes a little every tick: the confirms come summed, a few a second, not one a tick.)
  check(confirms >= 2 && confirms <= 8, `lightning's hit confirms should come a few a second (${confirms} in 1.4 s)`);
  check((me.abilities[HERO_ABILITY] as HeroMove).c0 > 0, 'lightning should cool down once let go');

  // ---- Chewblocca: the bowcaster's quarrels burst (a trooper beside the one hit is hurt too).
  hero('chewie');
  const holding = (): string | undefined => me.inventory.held?.item;
  check(holding() === 'hero_bowcaster' && me.maxHealth === 850, `Chewblocca carries the bowcaster, 850 health (${holding()}, ${me.maxHealth})`);
  idle(0.2);
  place(me, 0, 0, 0);
  place(shooter, 0, -8);
  place(t2, 1.3, -8.3);
  place(t3, 6, 6);
  ready([me, shooter, t2, t3]);
  idle(0.3);
  tap({ clicked: 1, yaw: yawTo(me.eye, shooter.position), pitch: -0.12 });
  idle(0.8);
  const quarrelled = [100 - shooter.health, 100 - t2.health];
  console.log(`  bowcaster: the one hit lost ${quarrelled[0].toFixed(0)}, the one beside it ${quarrelled[1].toFixed(0)} (the burst)`);
  check(quarrelled[0] > 60, `a quarrel should hit hard (${quarrelled[0]})`);
  check(quarrelled[1] > 5, `a quarrel's burst should hurt someone beside (${quarrelled[1]})`);

  // Scatter Shot: three troopers across the front, all hit.
  ready([shooter, t2, t3]);
  place(shooter, -2.5, -9);
  place(t2, 0, -10);
  place(t3, 2.5, -9);
  idle(0.3);
  tap({ pressed: ['KeyQ'], yaw: 0, pitch: -0.1 });
  idle(0.3);
  const scattered = [shooter, t2, t3].map((t) => (t.alive ? t.health : 0));
  console.log(`  scatter shot: troopers at ${scattered.map((v) => v.toFixed(0)).join(', ')}`);
  check(scattered.every((v) => v < 100), `a scatter shot should hit all three (${scattered.join(', ')})`);

  // Wookiee Charge: a trooper in the way is bowled over (hurt, thrown, held down a moment).
  ready([shooter, t2, t3]);
  place(me, 0, 6, 0);
  place(shooter, 0.3, 1.5);
  place(t2, 8, 8);
  place(t3, -8, 8);
  idle(0.3);
  shooter.freeze(false);
  const was2 = { ...shooter.position };
  tap({ pressed: ['KeyE'], yaw: 0, pitch: 0 });
  idle(0.85);
  const flung = Math.hypot(shooter.position.x - was2.x, shooter.position.z - was2.z);
  const downed = shooter.frozen;
  console.log(`  charge: Chewblocca ran ${(6 - (me.position.z - AT.z)).toFixed(1)} blocks, the trooper thrown ${flung.toFixed(1)} and ${downed ? 'held down' : 'up again'}, at ${shooter.health.toFixed(0)}`);
  check(shooter.health < 100 && flung > 1.5, `the charge should hurt and throw the trooper (health ${shooter.health}, thrown ${flung.toFixed(2)})`);
  check(downed, 'a charged trooper should be held down a moment');
  idle(1.2);

  // Enraged: the roar staggers those near; he takes half.
  ready([me, shooter, t2, t3]);
  place(me, 0, 0, 0);
  place(shooter, 1.5, -2.5);
  place(t2, -1.5, -3);
  place(t3, 9, 9);
  idle(0.3);
  shooter.freeze(false);
  t2.freeze(false);
  tap({ pressed: ['KeyF'] });
  idle(0.4);
  const staggered = [shooter.frozen, t2.frozen];
  before = me.health;
  me.damage(100, { source: 'world', knockback: 0 });
  const tookEnraged = before - me.health;
  console.log(`  roar: ${staggered.filter(Boolean).length} of 2 near staggered; enraged, 100 did ${tookEnraged.toFixed(0)}`);
  check(staggered.every(Boolean), 'the roar should stagger both troopers near');
  check(tookEnraged < 60, `enraged, Chewblocca should take about half (${tookEnraged})`);
  idle(1.2);

  // ---- Boba Fetch: the EE-3, a wrist rocket that seeks, the flamethrower, the jetpack.
  hero('boba');
  check(holding() === 'hero_ee3', `Boba Fetch carries the EE-3 (${holding()})`);
  idle(0.2);
  place(me, 0, 0, 0);
  place(shooter, 3, -14);
  place(t2, 9, 9);
  place(t3, -9, 9);
  ready([me, shooter, t2, t3]);
  idle(0.3);
  // Aimed a little off: it seeks him out.
  tap({ pressed: ['KeyQ'], yaw: yawTo(me.eye, shooter.position) + 0.12, pitch: -0.05 });
  let flew = 0;
  h.run(2, { pilot: () => ({ yaw: me.yaw, pitch: me.pitch }), until: () => (flew += g.players.length ? 1 : 0) > 0 && !shooter.alive });
  console.log(`  wrist rocket: the trooper 14 blocks off ${shooter.alive ? `at ${shooter.health.toFixed(0)}` : 'dead'}`);
  check(!shooter.alive || shooter.health < 40, `the rocket should find the trooper (${shooter.health})`);
  idle(0.3);

  shooter.revive();
  idle(0.2);
  place(me, 0, 0, 0);
  place(shooter, -0.8, -4);
  place(t2, 0.9, -4.5);
  place(t3, 9, 9);
  ready([me, shooter, t2, t3]);
  (me.abilities[HERO_ABILITY] as HeroMove).c1 = 0;
  idle(0.3);
  h.run(1.2, { pilot: () => ({ yaw: 0, pitch: -0.2, down: ['KeyE'] }) });
  const burnt2 = [shooter, t2].map((t) => (t.alive ? t.health : 0));
  const burning = h.calls.filter((c) => c.target === 'message' && c.method === 'bfh.burn').length;
  console.log(`  flamethrower: 1.2 s, troopers at ${burnt2.map((v) => v.toFixed(0)).join(', ')}; ${burning} patches of ground set burning`);
  check(burnt2.every((v) => v < 50), `the flamethrower should burn both (${burnt2.join(', ')})`);
  check(burning > 0, 'the flamethrower should set the ground burning');
  idle(0.5);

  place(me, 0, 0, 0);
  idle(0.5);
  const liftFrom = me.position.y;
  tap({ pressed: ['KeyF'] });
  h.run(0.8, { pilot: () => ({ yaw: me.yaw, pitch: me.pitch, down: ['Space'] }) });
  const up = me.position.y - liftFrom;
  idle(1.2);
  const hovering = me.position.y - liftFrom;
  console.log(`  jetpack: up ${up.toFixed(1)} blocks climbing, ${hovering.toFixed(1)} after hovering a while`);
  check(up > 3, `the jetpack should lift Boba (${up.toFixed(2)})`);
  check(hovering > 2.5, `the jetpack should hold him up (${hovering.toFixed(2)})`);
  idle(4);

  // ---- The heroes' jumps: Battlefront's, floaty with Space held (`JUMP`).
  /**
   * One jump from standing, a frame at a time: Space pressed, and held `hold` seconds (all the way
   * by default); `second`: pressed again that far in; `run`: W and sprint held until they land,
   * and nothing after. Afterwards, `after` seconds on the ground (Space still down if it was).
   */
  const jump = (opts: { hold?: number; second?: number; run?: boolean; after?: number } = {}) => {
    const y0 = me.position.y;
    const hold = opts.hold ?? 99;
    const ys: number[] = [];
    let t = 0;
    let peak = 0;
    let peakT = 0;
    let air = 0;
    let left = false;
    let landSpeed = 0;
    for (let i = 0; i < 300 && !air; i++) {
      const down = [...(t < hold ? ['Space'] : []), ...(opts.run ? ['KeyW', 'ShiftLeft'] : [])];
      const pressed = i === 0 || (opts.second !== undefined && Math.abs(t - opts.second) < DT / 2) ? ['Space'] : [];
      if (pressed.length && !down.includes('Space')) down.push('Space');
      h.step(DT, { yaw: me.yaw, pitch: me.pitch, down, pressed });
      t += DT;
      const y = me.position.y - y0;
      ys.push(y);
      if (y > peak) [peak, peakT] = [y, t];
      if (!me.onGround) left = true;
      else if (left) {
        air = t;
        landSpeed = Math.hypot(me.velocity.x, me.velocity.z);
      }
    }
    const hang = ys.filter((y) => y > peak - 0.25).length * DT;
    const held = hold > air;
    h.run(opts.after ?? 0.1, { pilot: () => ({ yaw: me.yaw, pitch: me.pitch, down: held ? ['Space'] : [] }) });
    return { peak, peakT, air, hang, landSpeed, after: Math.hypot(me.velocity.x, me.velocity.z), rest: me.position.y - y0, grounded: me.onGround };
  };
  const arcs: string[] = [];
  const later: (() => void)[] = [];
  for (const id of ['luke', 'ben', 'emperor', 'vader', 'chewie', 'boba'] as HeroId[]) {
    hero(id);
    place(me, 0, 6, 0);
    ready([me]);
    idle(0.4);
    const full = jump({ after: 0.4 });
    idle(0.3);
    const tap = jump({ hold: 0.1 });
    idle(0.3);
    const second = jump({ second: full.peakT });
    idle(0.3);
    place(me, 0, 8, 0);
    idle(0.3);
    const run = jump({ run: true, hold: 0.3 });
    idle(0.5);
    arcs.push(`${id}: ${full.peak.toFixed(2)} high at ${full.peakT.toFixed(2)} s, ${full.hang.toFixed(2)} s near the top, ${full.air.toFixed(2)} s up; tapped ${tap.peak.toFixed(2)} (${tap.air.toFixed(2)} s); again at the top ${second.peak.toFixed(2)}; landing at a run ${run.landSpeed.toFixed(1)} -> ${run.after.toFixed(1)} b/s 0.1 s on`);
    later.push(() => check(full.grounded && Math.abs(full.rest) < 0.05, `${id} held Space through the landing: they should stay down (${full.rest.toFixed(2)} up)`));
    if (id !== 'chewie' && id !== 'boba') later.push(() => check(tap.peak < full.peak - 0.3, `${id}: a tap should hop lower than a held jump (${tap.peak.toFixed(2)}, ${full.peak.toFixed(2)})`));
    if (id === 'chewie') later.push(() => check(second.peak < full.peak + 0.1, `Chewblocca has no second jump (${second.peak.toFixed(2)} after ${full.peak.toFixed(2)})`));
    else later.push(() => check(second.peak > full.peak + 0.5, `${id}'s second jump should take them higher (${second.peak.toFixed(2)} after ${full.peak.toFixed(2)})`));
    if (id === 'luke' || id === 'ben' || id === 'emperor') {
      later.push(() => check(full.peak > 2.1 && full.peak < 2.7, `${id}'s Force jump should rise 2.1-2.7 blocks (${full.peak.toFixed(2)})`));
      later.push(() => check(full.air > 1.2 && full.air < 1.7, `${id}'s Force jump should float 1.2-1.7 s (${full.air.toFixed(2)})`));
      later.push(() => check(full.hang > 0.35, `${id} should hang at the top of a Force jump (${full.hang.toFixed(2)} s)`));
    }
    if (id === 'vader') later.push(() => check(full.peak > 2 && full.air < 1.2, `Darth Voxel jumps high but comes down heavy (${full.peak.toFixed(2)}, ${full.air.toFixed(2)} s)`));
    later.push(() => check(run.after > run.landSpeed * 0.45, `${id} should land softly, keeping some way (${run.landSpeed.toFixed(1)} -> ${run.after.toFixed(1)})`));
  }
  console.log(`  jumps:\n    ${arcs.join('\n    ')}`);
  for (const c of later) c();

  // ---- A hero's health doesn't come back as a trooper's does.
  me.damage(120, { source: 'world', knockback: 0 });
  const hurt = me.health;
  idle(4);
  check(me.health <= hurt + 0.5, `a hero shouldn't mend soon after being hurt (${hurt.toFixed(0)}, then ${me.health.toFixed(0)} 4 s later)`);
  idle(8);
  check(me.health > hurt + 5 && me.health < hurt + 40, `a hero should mend slowly a while after (${hurt.toFixed(0)}, then ${me.health.toFixed(0)} 12 s later)`);

  // ---- Bots as heroes use their powers.
  for (const t of troopers) g.bots.remove(t);
  g.commands.run('/bots 5');
  idle(1);
  // The player steps aside (back to a trooper, next life), and two bots a side take the heroes.
  me.protect(0);
  me.damage(10000, { source: 'world' });
  const want: HeroId[] = ['luke', 'chewie', 'vader', 'boba'];
  for (const id of want) {
    const b = g.bots.all.find((q) => match.fighters.get(q.id)?.team === HEROES[id].team && !match.fighters.get(q.id)?.wantHero);
    if (!b) continue;
    const f = match.fighters.get(b.id)!;
    f.bp = 5000;
    f.wantHero = id;
    b.protect(0);
    b.damage(10000, { source: 'world' });
  }
  const used = new Map<string, Set<string>>();
  const t00 = h.calls.length;
  idle(6);
  const botHeroes = [...match.fighters.values()].filter((f) => f.player.bot && f.hero);
  check(botHeroes.length === 4, `four bots should have become heroes (${botHeroes.length})`);
  // Bring the fight to them: everyone to the middle post.
  h.run(75, {
    pilot: () => ({ yaw: me.yaw, pitch: me.pitch }),
    until: () => {
      for (const f of match.fighters.values()) {
        if (!f.player.bot || !f.hero) continue;
        const m = f.player.abilities[HERO_ABILITY] as HeroMove;
        [m.c0, m.c1, m.c2].forEach((c, i) => {
          if (c > 0) {
            const set = used.get(f.hero!) ?? new Set();
            set.add(HEROES[f.hero!].powers[i].name);
            used.set(f.hero!, set);
          }
        });
      }
      return false;
    },
  });
  const powers = h.calls.slice(t00).filter((c) => c.target === 'message' && c.method === 'bfh.power').length;
  const swings = h.calls.slice(t00).filter((c) => c.target === 'message' && c.method === 'bfh.swing').length;
  console.log(`  bots: ${[...used].map(([id, s]) => `${HEROES[id as HeroId].name}: ${[...s].join(', ')}`).join('; ') || 'none'} (${powers} power messages, ${swings} swings)`);
  check(used.size >= 3 && [...used.values()].reduce((n, s) => n + s.size, 0) >= 6, 'hero bots should use their powers');
  check(swings > 5, 'hero bots should swing their sabers');
  // ---- A hurt hero bot falls back to the nearest post its side holds (and survives the trip here: protected).
  const fb = [...match.fighters.values()].find((f) => f.player.bot && f.hero && f.player.alive);
  check(fb, 'a hero bot should be alive to test falling back');
  const post = () =>
    match.posts
      .filter((p) => p.owner === fb.team)
      .map((p) => Math.hypot(p.spec.at.x - fb.player.position.x, p.spec.at.z - fb.player.position.z))
      .sort((a, b) => a - b)[0] ?? Infinity;
  fb.player.health = fb.player.maxHealth * 0.18;
  fb.player.protect(30);
  const far = post();
  let nearest = far;
  h.run(12, { pilot: () => ({ yaw: me.yaw, pitch: me.pitch }), until: () => ((nearest = Math.min(nearest, post())), nearest < 5) });
  console.log(`  falling back: ${HEROES[fb.hero!].name} at ${Math.round((fb.player.health / fb.player.maxHealth) * 100)}%, ${far.toFixed(0)} blocks from its side's nearest post, then ${nearest.toFixed(0)}`);
  check(far < 5 || nearest < far * 0.6, `a hurt hero bot should fall back toward its post (${far.toFixed(1)} -> ${nearest.toFixed(1)})`);
  // Shot while falling back: it turns to the shooter, guard up.
  const foe = g.players.find((p) => p.alive && match.fighters.get(p.id)?.team !== fb.team && p !== me);
  check(foe, 'someone to shoot the hero bot');
  fb.player.protect(0);
  fb.player.health = fb.player.maxHealth * 0.2;
  let guarded = 0;
  let ticks = 0;
  h.run(2, {
    pilot: () => ({ yaw: me.yaw, pitch: me.pitch }),
    until: () => {
      if (ticks++ % 12 === 0 && fb.player.alive) fb.player.damage(2, { source: foe, cause: 'gun', weapon: 'imp_rifle', part: 'body' });
      if (g.items.kind<Sabers>('saber')?.guarding(fb.player)) guarded++;
      return false;
    },
  });
  console.log(`  shot while falling back: guard up ${guarded} of ${ticks} steps`);
  check(guarded > 10, 'a hero bot falling back should raise its guard when shot');
  console.log(`  ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  void (g as GameContext);
}
