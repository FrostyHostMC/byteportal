import { readFileSync } from 'node:fs';
import { LETHALS, WEAPONS } from '../../src/games/callofblocky/weapons';
import { Blueprint, defineGame, type Bot, type GameDefinition, type Player, type Vec3 } from '../../src/platform';
import { GameHost, GeneratedWorld } from '../../src/platform/host/game';
import { Headless } from '../../src/platform/host/headless';
import { worldGenConfig } from '../../src/platform/workers/config';
import type { HostEvent, PlayerInput } from '../../src/platform/net/protocol';
import { flyFor, fuseSteps, newFlight, throwable, throwVelocity, type ShotWire, type GunItem, type ThrowableItem } from '../../src/platform/items';
import { guns, melee, throwables } from '../../src/platform/kits';
import { flightWorld } from '../../src/platform/sim/flight';
import { blockIdOf, loadRegistry } from '../../src/platform/world/registry';
import { check } from './_harness';

const wasm = readFileSync('engine/pkg/voxel_engine_bg.wasm');
const FLOOR = 64;

/**
 * A stone yard: a floor, a block-thick wall at z = -6 (x -4..4, four high; its near face at z = -5)
 * and a three-block-thick one at x 8..12, z -8..-6.
 */
function yard(): Blueprint {
  const bp = new Blueprint({ x: -14, y: FLOOR - 1, z: -16 }, { x: 29, y: 6, z: 29 });
  bp.fill({ x: -14, y: FLOOR - 1, z: -16 }, { x: 14, y: FLOOR - 1, z: 12 }, 'stone');
  bp.fill({ x: -4, y: FLOOR, z: -6 }, { x: 4, y: FLOOR + 3, z: -6 }, 'stone');
  bp.fill({ x: 8, y: FLOOR, z: -8 }, { x: 12, y: FLOOR + 3, z: -6 }, 'stone');
  return bp;
}

/** Call of Blocky's rifle and pistol held dead steady (no spread). */
const steady = (id: string): GunItem => ({ ...(WEAPONS[id] as GunItem), spread: { hip: 0, aim: 0, move: 0, air: 0, bloom: 0 }, recoil: { up: 0, side: 0 } });

const range = defineGame({
  id: 'blasting',
  title: 'Blasting range',
  world: { terrain: 'void', structures: [yard()], spawn: { x: 0.5, y: FLOOR, z: 4.5 }, time: 0.5, freezeTime: true, destructible: { above: FLOOR - 1 } },
  // Plenty of health: the test measures the damage rather than who dies.
  player: { health: 1000, hurtCooldown: 0, hotbar: 'items', pvp: true },
  items: [throwables(), guns(), melee()],
  setup(game) {
    game.items.define('frag', LETHALS.frag);
    game.items.define('molotov', LETHALS.molotov);
    game.items.define('rifle', steady('rifle'));
    game.items.define('pistol', steady('pistol'));
  },
});

/** A client's copy of the world: generated the same way, taking in every edit and change the host sends. */
function copyOf(def: GameDefinition, seed: number) {
  const reg = loadRegistry();
  const gw = new GeneratedWorld(seed, worldGenConfig(def, (b) => blockIdOf(reg, b)));
  gw.update([{ x: 0, z: 0 }], 2, Infinity);
  return {
    world: gw.world,
    reg,
    take(events: HostEvent[]) {
      for (const e of events) {
        if (e.t === 'edits') for (const [x, y, z, id] of e.cells) gw.world.mirror_block(x, y, z, id);
        else if (e.t === 'damage') gw.world.apply_damage(e.data);
        else if (e.t === 'revert') gw.world.revert_edits();
      }
    },
    free: () => gw.dispose(),
  };
}

const dist = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/**
 * Destruction in combat: a grenade thrown by a player flies, bounces and goes off exactly where
 * the thrower's own screen flew it, blows a ragged crater in a wall (the floor stays, the client's
 * copy agrees) and hurts less further out (not at all out of reach); a molotov burns whoever
 * stands in its fire and nobody outside it; bullets from a gun that wall-bangs go through a thin
 * wall with less damage and not through a thick one, holing both faces; and an explosion in a
 * world without destructible blocks still blows out whole blocks.
 */
export default function destruction() {
  const host = new GameHost(range, { engine: wasm, seed: 11, remote: true, radius: 3, budget: Infinity });
  const client = copyOf(range, host.seed);
  const ann = host.connect('Ann');
  host.command(ann.id, { t: 'start' });
  // Someone else watching: what everyone but the thrower hears.
  const bob = host.connect('Bob');
  host.command(bob.id, { t: 'start' });
  const bobHears: HostEvent[] = [];
  const sim = host.sim;
  const game = sim.ctx;
  const A = sim.players.find((p) => p.id === ann.id)!;
  const events: HostEvent[] = [];
  /** Steps at a server's 30 a second; the client's copy takes what each brings. */
  const step = (n = 1) => {
    for (let i = 0; i < n; i++) {
      const all = host.step(1 / 30);
      const b = all.get(ann.id)!;
      client.take(b.events);
      events.push(...b.events);
      bobHears.push(...all.get(bob.id)!.events);
    }
  };
  const calls = (method: string) => events.filter((e) => e.t === 'call' && e.call.method === method).map((e) => (e as Extract<HostEvent, { t: 'call' }>).call);
  /** The platform's messages to the screens (`$thrown`, `$thrownEnd`, `$fire`): each one's data. */
  const said = (name: string) => calls(name).map((c) => c.args[0] as unknown[]);
  const input = (o: Partial<PlayerInput> = {}): PlayerInput => ({ active: true, down: [], pressed: [], buttons: 0, clicked: 0, mouseX: 0, mouseY: 0, wheel: 0, yaw: A.yaw, pitch: A.pitch, viewSeq: A.viewSeq, acts: { gun: [], throwable: [] }, ...o });
  step(4);
  const hurt = new Map<Player, { amount: number; cause: string; weapon?: string; through?: number }[]>();
  game.events.on('damage', (e) => {
    if (e.target.kind !== 'player') return;
    const l = hurt.get(e.target) ?? [];
    l.push({ amount: e.amount, cause: e.cause, weapon: e.weapon, through: e.through });
    hurt.set(e.target, l);
  });
  const took = (p: Player) => (hurt.get(p) ?? []).reduce((n, h) => n + h.amount, 0);
  const changed = new Set<string>();
  game.events.on('blockChange', (e) => changed.add(`${e.x},${e.y},${e.z}`));
  const dummy = (name: string, at: Vec3): Bot => {
    const b = game.bots.add(name);
    b.teleport(at, 0, 0);
    return b;
  };

  // ---- A frag, thrown by Ann: predicted on her screen, flown by the host, the same place ----
  A.api.inventory.give('frag', 2);
  A.api.teleport({ x: 0.5, y: FLOOR, z: 2.5 }, 0, 0);
  step(6);
  const frag = throwable(LETHALS.frag as ThrowableItem);
  const eye = A.eye;
  // Her screen flies it at 60 frames a second, on its copy of the world, from the moment she throws.
  const flying = flightWorld(client.world, client.reg);
  const fly = (yaw: number, pitch: number, cooked: number) => {
    const v = throwVelocity(frag, yaw, pitch);
    const f = newFlight(eye, v, fuseSteps(frag, cooked));
    let bounces = 0;
    for (let i = 0; i < 60 * 6 && !flyFor(f, frag, flying, { t: 0 }, 1 / 60, () => bounces++); i++);
    return { v, f, bounces, cooked };
  };
  // She banks it off the floor to the foot of the wall, a little to the right, cooked so it goes
  // off there: the throw that does that (as a player finds one by eye).
  let pick: ReturnType<typeof fly> | null = null;
  for (let pitch = -0.7; pitch < 0.3 && !pick; pitch += 0.05)
    for (let cooked = 0; cooked < 3 && !pick; cooked += 0.1) {
      const t = fly(0.1, pitch, cooked);
      if (t.bounces >= 1 && t.f.z > -5 && t.f.z < -4.6 && t.f.y < FLOOR + 2.5) pick = t;
    }
  check(pick, 'a throw that puts it at the foot of the wall');
  const { v, f: mine, bounces, cooked } = pick;
  const fuse = mine.fuse;
  check(mine.steps === fuse, `her screen flew it to its fuse: ${mine.steps} of ${fuse} steps`);
  const predicted = { x: mine.x, y: mine.y, z: mine.z };
  // Who's round where it'll go off: close, further, out of reach (all in plain sight of it).
  const near = dummy('Near', { x: predicted.x, y: FLOOR, z: predicted.z + 1.4 });
  const mid = dummy('Mid', { x: predicted.x, y: FLOOR, z: predicted.z + 3.6 });
  const far = dummy('Far', { x: predicted.x + 7.5, y: FLOOR, z: predicted.z + 2 });
  for (const b of [near, mid, far]) b.freeze(true);
  step(3);
  host.command(ann.id, { t: 'input', input: input({ acts: { gun: [], throwable: [[1, 'frag', eye.x, eye.y, eye.z, v.x, v.y, v.z, cooked]] } }) });
  step();
  const told = bobHears.filter((e) => e.t === 'call' && e.call.target === 'message' && e.call.method === 'throwable.thrown');
  check(A.api.inventory.count('frag') === 1 && told.length === 1 && said('throwable.thrown').length === 0, 'the host took the throw (one frag left), and tells everyone but Ann (her screen flies it already)');
  const live = throwables.of(game)!.thrown();
  check(live.length === 1 && live[0].item === 'frag' && live[0].by === A.api && live[0].radius === frag.blast!.radius && Math.abs(live[0].left - (fuse - 2) / 120) < 0.02, `items.thrown lists it: ${JSON.stringify(live.map((l) => ({ ...l, by: l.by.name })))}`);
  const damageBefore = host.world.world.damage_count();
  for (let i = 0; i < 30 * 5 && !said('throwable.end').length; i++) step();
  const end = said('throwable.end')[0];
  check(end, 'it went off');
  const [ex, ey, ez] = end[1] as [number, number, number];
  const miss = dist({ x: ex, y: ey, z: ez }, predicted);
  check(miss < 1e-9, `it went off where her screen had it: ${miss} blocks off (${ex.toFixed(3)}, ${ey.toFixed(3)}, ${ez.toFixed(3)})`);
  step(2);
  // The crater: the wall is bitten into, the floor under it whole, and the client's copy has it too.
  const w = host.world.world;
  let taken = 0;
  let bitten = 0;
  let gone = 0;
  for (let y = FLOOR; y <= FLOOR + 3; y++)
    for (let x = -4; x <= 4; x++) {
      const left = w.damage_left(x, y, -6);
      if (w.get_block(x, y, -6) === 0) gone++;
      else if (left < 4096) bitten++;
      taken += w.get_block(x, y, -6) === 0 ? 4096 : 4096 - left;
      check(w.get_block(x, y, -6) === client.world.get_block(x, y, -6) && left === client.world.damage_left(x, y, -6), `the client's copy has the same crater at ${x},${y}`);
    }
  // (The Pineapple blows clean through: blocks gone, several blocks' worth of voxels.)
  check(w.damage_count() > damageBefore && bitten >= 3 && gone >= 1 && taken > 4096 * 4, `a crater through the wall: ${taken} little voxels, ${gone} blocks gone, ${bitten} bitten`);
  // Every block it bit into or blew away was told of (`blockChange`: what a nav grid follows).
  let heard = 0;
  for (let y = FLOOR; y <= FLOOR + 3; y++) for (let x = -4; x <= 4; x++) if (w.damage_left(x, y, -6) < 4096 || w.get_block(x, y, -6) === 0) heard += changed.has(`${x},${y},-6`) ? 1 : 0;
  check(heard === bitten + gone, `blockChange for each block the crater changed: ${heard} of ${bitten + gone}`);
  let floorWhole = true;
  for (let x = Math.floor(ex) - 3; x <= Math.floor(ex) + 3; x++) for (let z = Math.floor(ez) - 3; z <= Math.floor(ez) + 3; z++) floorWhole &&= w.damage_left(x, FLOOR - 1, z) === 4096 && w.get_block(x, FLOOR - 1, z) === blockIdOf(sim.registry, 'stone');
  check(floorWhole, 'the floor under it is whole');
  // Damage: the nearer, the more; none out of reach; all of it the frag's, an explosion.
  const [dn, dm, df] = [took(near), took(mid), took(far)];
  check(dn > dm && dm > 0 && df === 0, `damage falls off: ${dn.toFixed(1)} at 1.4, ${dm.toFixed(1)} at 3.6, ${df} at 7.8`);
  check([...(hurt.get(near) ?? []), ...(hurt.get(mid) ?? [])].every((h) => h.cause === 'explosion' && h.weapon === 'frag'), 'as an explosion, with the frag');
  const blast = frag.blast!;
  const expect = (d: number) => blast.near + (blast.far - blast.near) * (d / blast.radius);
  const nearD = Math.hypot(near.position.x - ex, near.position.z - ez);
  check(Math.abs(dn - expect(nearD)) < 20, `about what the falloff says at ${nearD.toFixed(2)}: ${dn.toFixed(1)} (${expect(nearD).toFixed(1)})`);
  console.log(`  frag: bounced ${bounces}×, went off ${miss.toExponential(1)} blocks from where Ann's screen had it after ${fuse} steps; crater ${taken} voxels (${gone} blocks gone, ${bitten} bitten); damage ${dn.toFixed(0)} / ${dm.toFixed(0)} / ${df} at 1.4 / 3.6 / 7.8 blocks`);

  // ---- Bots throw: from code (lobbed at a spot), and by holding the key (cooking it) ----
  for (const b of [near, mid, far]) game.bots.remove(b);
  game.restart();
  step(4);
  const lobber = dummy('Lobber', { x: -8.5, y: FLOOR, z: 8.5 });
  lobber.inventory.give('frag', 2);
  step(4);
  const spot = { x: -4.5, y: FLOOR, z: 0.5 };
  events.length = 0;
  check(throwables.of(game)!.throw(lobber, 'frag', { at: spot }), 'throwables.throw: a bot lobs one at a spot');
  check(!throwables.of(game)!.throw(lobber, 'frag', { at: spot }) && lobber.inventory.count('frag') === 1, 'not again straight away (its cooldown); one used');
  step();
  check(said('throwable.thrown').length === 1, 'everyone sees it thrown (Ann too)');
  for (let i = 0; i < 30 * 5 && !said('throwable.end').length; i++) step();
  const lob = said('throwable.end')[0]?.[1] as [number, number, number] | undefined;
  check(lob && Math.hypot(lob[0] - spot.x, lob[2] - spot.z) < 3, `it came down about where it was lobbed: ${lob?.map((n) => n.toFixed(2))}`);
  // Holding G (as a bot's controls do): the pin, a second's cook, let go.
  step(30);
  events.length = 0;
  lobber.controls.look(Math.PI * 0.75, 0.2);
  lobber.controls.hold('KeyG');
  step(30);
  check(!said('throwable.thrown').length && lobber.inventory.count('frag') === 1, 'held: cooking, not thrown yet');
  lobber.controls.hold('KeyG', false);
  step();
  const cookedThrow = said('throwable.thrown')[0];
  check(cookedThrow && lobber.inventory.count('frag') === 0, 'let go: thrown');
  const fuseLeft = (cookedThrow[9] as number) / 120;
  check(fuseLeft > 1.9 && fuseLeft < 2.3, `cooked about a second: ${fuseLeft.toFixed(2)} s of fuse left`);
  game.bots.remove(lobber);
  console.log(`  bots: player.throw lobbed one to ${lob ? Math.hypot(lob[0] - spot.x, lob[2] - spot.z).toFixed(2) : '?'} blocks of the spot; held G a second and let go: ${fuseLeft.toFixed(2)} s of fuse left`);

  // ---- A molotov: breaks where it lands, burns who's in the fire ----
  hurt.clear();
  A.api.inventory.give('molotov', 1);
  A.api.teleport({ x: -6.5, y: FLOOR, z: 6.5 }, 0, 0);
  step(30);
  const mol = throwable(LETHALS.molotov as ThrowableItem);
  const meye = A.eye;
  const mv = throwVelocity(mol, 0.2, -0.35);
  const lands = newFlight(meye, mv, fuseSteps(mol, 0));
  for (let i = 0; i < 600 && !flyFor(lands, mol, flying, { t: 0 }, 1 / 60); i++);
  check(lands.struck, 'it breaks where it lands');
  const inFire = dummy('Singed', { x: lands.x + 0.8, y: FLOOR, z: lands.z + 0.6 });
  const clear = dummy('Clear', { x: lands.x + 5, y: FLOOR, z: lands.z });
  for (const b of [inFire, clear]) b.freeze(true);
  step(3);
  host.command(ann.id, { t: 'input', input: input({ acts: { gun: [], throwable: [[2, 'molotov', meye.x, meye.y, meye.z, mv.x, mv.y, mv.z, 0]] } }) });
  events.length = 0;
  step(30 * 3);
  const fire = said('throwable.fire')[0];
  check(fire && Math.hypot((fire[1] as number) - lands.x, (fire[3] as number) - lands.z) < 0.01, 'a fire where it broke');
  const burns = [...(hurt.get(inFire) ?? [])];
  const fires = throwables.of(game)!.fires();
  check(fires.length === 1 && fires[0].radius === 3 && fires[0].left > 3, `fires lists it: ${JSON.stringify(fires.map((f) => ({ ...f, by: f.by.name })))}`);
  check(burns.length >= 4 && burns.every((h) => h.cause === 'fire' && h.weapon === 'molotov'), `the one in the fire burns, again and again: ${burns.length} burns, ${took(inFire).toFixed(0)} damage`);
  check(!hurt.has(clear), 'the one outside it, not at all');
  const before = took(inFire);
  step(30 * 6);
  check(took(inFire) > before && said('throwable.fire').length === 1, 'it burns on for its while');
  const out = took(inFire);
  step(30 * 2);
  check(took(inFire) === out, `then goes out (${out.toFixed(0)} damage in all)`);
  console.log(`  molotov: landed ${lands.steps} steps out, burnt the one in the fire ${burns.length}× in its first 3 s (${out.toFixed(0)} damage over its 7 s), the one outside 0`);

  // ---- Wall-banging ----
  for (const b of [inFire, clear]) game.bots.remove(b);
  // (A new match: the walls whole again.)
  game.restart();
  step(4);
  check(host.world.world.damage_count() === 0 && client.world.damage_count() === 0, 'a restart puts the crater back');
  hurt.clear();
  A.api.inventory.clear();
  A.api.inventory.give('rifle');
  A.api.inventory.give('pistol');
  const shoot = (serial: number, target: Player, gun: 'rifle' | 'pistol') => {
    A.api.inventory.select(A.api.inventory.slots.findIndex((s) => s?.item === gun));
    step(20);
    const e = A.eye;
    const c = { x: target.position.x, y: target.position.y + 1.1, z: target.position.z };
    const yaw = Math.atan2(-(c.x - e.x), -(c.z - e.z));
    const pitch = Math.atan2(c.y - e.y, Math.hypot(c.x - e.x, c.z - e.z));
    bobHears.length = 0;
    host.command(ann.id, { t: 'input', input: input({ yaw, pitch, acts: { gun: [[serial, yaw, pitch, 0]], throwable: [] }, seen: sim.time }) });
    step();
    // (What everyone else's screen draws: Ann's drew it herself.)
    const shot = bobHears.find((e) => e.t === 'call' && e.call.target === 'message' && e.call.method === 'gun.shot');
    return shot?.t === 'call' ? (shot.call.args[0] as ShotWire) : undefined;
  };
  // Through the thin wall (a block of stone, head on).
  A.api.teleport({ x: 0.5, y: FLOOR, z: -1.5 }, 0, 0);
  const behind = dummy('Behind', { x: 0.5, y: FLOOR, z: -9.5 });
  behind.freeze(true);
  // (Where the wall's whole, away from the frag's crater.)
  const intact = (x: number) => [-1, 0, 1].every((dx) => [FLOOR, FLOOR + 1, FLOOR + 2].every((y) => host.world.world.damage_left(x + dx, y, -6) === 4096 && host.world.world.get_block(x + dx, y, -6) !== 0));
  const columns = [0, -2, 2].filter(intact);
  check(columns.length >= 2, `whole wall left to shoot through: ${columns}`);
  const [wx, px] = columns;
  const whole = intact(wx);
  A.api.teleport({ x: wx + 0.5, y: FLOOR, z: -1.5 }, 0, 0);
  behind.teleport({ x: wx + 0.5, y: FLOOR, z: -9.5 }, 0, 0);
  step(10);
  const rifle = WEAPONS.rifle as GunItem;
  const shot = shoot(1, behind, 'rifle');
  const thin = took(behind);
  const full = (rifle.damage as [number, number])[0];
  const pen = rifle.penetration!;
  check(whole, 'the wall is whole where the bullet goes');
  check(thin > 0 && thin < full, `the rifle hits through a block-thick wall, for less: ${thin.toFixed(1)} of ${full}`);
  check(Math.abs(thin - full * (1 - pen.damageLoss! * 1)) < 1.5, `about a block's worth less (${(full * (1 - pen.damageLoss!)).toFixed(1)})`);
  check(hurt.get(behind)?.[0].through !== undefined && Math.abs(hurt.get(behind)![0].through! - 1) < 0.1, `the hit says it went through a block: ${hurt.get(behind)?.[0].through}`);
  check(shot?.walls?.[0]?.length === 1, 'other screens hear where it went in and came out');
  const hole = host.world.world;
  check(hole.damage_left(wx, FLOOR + 1, -6) < 4096, `holed where it went in and came out: ${4096 - hole.damage_left(wx, FLOOR + 1, -6)} voxels`);
  // The pistol doesn't go through a whole wall.
  hurt.clear();
  A.api.teleport({ x: px + 0.5, y: FLOOR, z: -1.5 }, 0, 0);
  behind.teleport({ x: px + 0.5, y: FLOOR, z: -9.5 }, 0, 0);
  step(10);
  shoot(2, behind, 'pistol');
  check(!hurt.has(behind), 'the pistol stops in a whole wall');
  // The thick wall stops the rifle.
  hurt.clear();
  A.api.teleport({ x: 10.5, y: FLOOR, z: -1.5 }, 0, 0);
  behind.teleport({ x: 10.5, y: FLOOR, z: -11.5 }, 0, 0);
  step(10);
  const thick = shoot(3, behind, 'rifle');
  check(!hurt.has(behind) && !thick?.walls, `a three-block wall stops it: ${took(behind)}`);
  console.log(`  wall-bang: rifle through a block of stone ${thin.toFixed(1)} of ${full} (${pen.depth} blocks, -${pen.damageLoss} a block); pistol stopped by a whole wall; a three-block wall stops the rifle`);
  client.free();
  host.dispose();

  // ---- A world without destructible blocks: explosions blow out whole blocks, as always ----
  const plain = defineGame({
    id: 'plain-blast',
    title: 'Plain blast',
    world: { terrain: 'void', structures: [new Blueprint({ x: -6, y: FLOOR - 1, z: -6 }, { x: 13, y: 9, z: 13 }).fill({ x: -6, y: FLOOR - 1, z: -6 }, { x: 6, y: FLOOR + 7, z: 6 }, 'stone')], spawn: { x: 0.5, y: FLOOR + 9, z: 0.5 }, time: 0.5, freezeTime: true },
    player: { health: false, hotbar: 'items' },
  });
  const h = new Headless(plain, { wasm, radius: 2 });
  h.start();
  h.run(0.2);
  const broken: string[] = [];
  h.ctx.events.on('blockBreak', (e) => broken.push(`${e.x},${e.y},${e.z}`));
  const c = { x: 0.5, y: FLOOR + 3.5, z: 0.5 };
  const n = h.ctx.world.explode(c, 2.5);
  h.step(1 / 60, {});
  const pw = h.host.world.world;
  let inside = true;
  let outside = true;
  // (Inside the stone cube: y FLOOR - 1 to FLOOR + 7.)
  for (let y = -4; y <= 4; y++)
    for (let z = -5; z <= 5; z++)
      for (let x = -5; x <= 5; x++) {
        const d = Math.hypot(x + 0.5 - c.x, y + FLOOR + 3 + 0.5 - c.y, z + 0.5 - c.z);
        const b = pw.get_block(x, y + FLOOR + 3, z);
        if (d <= 1.85) inside &&= b === 0;
        if (d >= 3.15) outside &&= b !== 0;
      }
  check(n > 30 && broken.length === n && pw.damage_count() === 0, `whole blocks out (${n}), each a blockBreak, nothing carved`);
  check(inside && outside, 'a ragged sphere: everything well inside gone, everything well outside there');
  console.log(`  a world without destructible blocks: explode(2.5) blew out ${n} whole blocks, carved nothing`);
}
