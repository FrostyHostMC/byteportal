import { guns } from '../../src/platform/kits';
import { earn, goldOf, planWave, purchase } from '../../src/games/siege/server';
import { check, launch, lastScreen } from './_harness';

const enemies = (h: ReturnType<typeof launch>) => ['rifleman', 'assaulter', 'heavy', 'demo'].reduce((n, t) => n + h.ctx.entities.count(t), 0);

/**
 * Siege Night: bots fill the team to six around one person and raise a wall by day; nightfall brings
 * the hostiles, which the bots shoot for gold; the quartermaster sells guns, materials and turrets;
 * the downed are revived; with nobody defending (or everyone down) the operation is lost.
 */
export default function siege() {
  // The team: one person, five bots; the quartermaster stands by the relay.
  const h = launch('siege-night', { seed: 7 });
  const game = h.ctx;
  const me = game.player;
  check(game.players.length === 6, `six on the team: ${game.players.length}`);
  check(game.players.filter((p) => p.bot).length === 5, 'five of them bots');
  check(me.inventory.count('pistol') === 1 && me.inventory.count('planks') === 32, 'sidearm and planks given');
  check(me.inventory.held?.item === 'pistol', `the sidearm is in hand: ${me.inventory.held?.item}`);
  check(game.entities.count('merchant') === 1, 'a quartermaster');

  // The land: the base is level on its mound, berms round the edge, a lookout hill and a bomb crater; a war zone of ruins and wrecks; the quartermaster in his hut and the VIP in the command post.
  const w = game.world;
  const name = (x: number, y: number, z: number) => w.blockName(w.getBlock(x, y, z));
  const solid = (x: number, y: number, z: number) => w.getBlock(x, y, z) !== w.blockId('air');
  check([-4, 0, 3, 6, 9].every((d) => w.surfaceY(d, 8) === 67) && w.surfaceY(20, 0) === 67, 'the base is level, on a mound three blocks above the field');
  check(w.surfaceY(32, 10) === 64, 'down to the field');
  check(w.surfaceY(54, -8) >= 72 && w.surfaceY(-48, -34) >= 73, 'rubble berms round the edge');
  check(w.surfaceY(37, -30) === 73 && w.surfaceY(-34, 26) <= 61, 'a lookout hill to the south-east and a bomb crater to the north-west');
  check(solid(14, 68, 6) && solid(-14, 68, -6) && !solid(14, 68, 0) && !solid(0, 68, -14), 'a perimeter wall with a gate in the middle of each side');
  check(name(15, 68, 13) === 'cobblestone_stairs' && !solid(15, 71, 14) && solid(13, 71, 13), 'a bastion at each corner, stairs up to a hatch in its roof');
  check(solid(-5, 68, 0) && !solid(0, 68, 4) && !solid(1, 68, 4) && solid(0, 72, 0) && name(4, 68, -2) === 'cobblestone_stairs', 'a command post with a door at each end and stairs up to its roof');
  check(name(-12, 68, 4) === 'blue_bed' && name(9, 67, 9) === 'white_concrete' && solid(7, 69, -12), 'barracks with bunks, a painted helipad, fuel tanks');
  check(name(-8, 68, 2) === 'stone_bricks' && name(-7, 70, 2) === 'oak_planks', 'the quartermaster hut stands');
  check(game.entities.all('merchant').every((m) => m.position.x < -5.5 && m.position.x > -8), 'with the quartermaster inside');
  check(game.entities.count('vip') === 1 && Math.abs(game.entities.all('vip')[0].position.x - 0.5) < 1, 'the VIP is in the command post');
  let apartment = 0;
  for (let x = 34; x <= 42; x++) for (let z = 14; z <= 21; z++) for (let y = 65; y <= 72; y++) if (solid(x, y, z)) apartment++;
  check(apartment > 120 && name(33, 68, 17) === 'cobblestone', `a ruined apartment block with a rubble ramp: ${apartment} blocks`);
  check(Math.max(...[25, 26, 27, 28, 29, 30, 31].map((z) => w.surfaceY(63, z))) >= 80, 'a ruined tower on the skyline');
  check(solid(-37, 66, 9) && solid(-7, 66, -35) && solid(10, 65, -38), 'a burnt-out lorry, a crashed helicopter and a gutted bus, in full-size blocks');
  // The small corner leaderboard is sent (and no centred scoreboard).
  h.run(2);
  check(h.calls.some((c) => c.method === 'widget' && JSON.stringify(c.args).includes('squad')), 'the corner leaderboard widget is sent');
  check(!h.calls.some((c) => c.method === 'scoreboard'), 'no centred scoreboard');

  // The shop: gold buys things, and not before you have it.
  check(!purchase(game, me, 'lmg'), 'no LMG without the gold');
  earn(me, 500);
  const before = goldOf(me);
  check(purchase(game, me, 'smg') && me.inventory.count('smg') === 1, 'bought the SMG');
  check((me.inventory.held?.item as string) === 'smg', 'and it is in hand');
  check(purchase(game, me, 'armor') && me.armor === 5, `armour: ${me.armor}`);
  check(purchase(game, me, 'turret') && game.entities.count('turret') === 1, 'bought a turret');
  check(purchase(game, me, 'cobble') && me.inventory.count('cobble') === 24, 'bought cobblestone');
  check(before - goldOf(me) === 70 + 50 + 100 + 30, `paid ${before - goldOf(me)}`);

  // The ammo resupply really refills the guns you carry (and doesn't drop spare guns on the floor).
  const kit = guns.of(game)!;
  kit.setAmmo(me, 'smg', { magazine: 0, reserve: 0 });
  kit.setAmmo(me, 'pistol', { magazine: 1, reserve: 2 });
  check(purchase(game, me, 'ammo'), 'bought an ammo resupply');
  check(JSON.stringify(kit.ammo(me, 'smg')) === JSON.stringify({ magazine: 32, reserve: 160 }) && JSON.stringify(kit.ammo(me, 'pistol')) === JSON.stringify({ magazine: 15, reserve: 75 }), `the guns are full again: ${JSON.stringify(kit.ammo(me, 'smg'))} ${JSON.stringify(kit.ammo(me, 'pistol'))}`);
  const strayGuns = (h.step(1 / 60).frame?.pickups ?? []).filter((p) => ['pistol', 'smg', 'rifle', 'shotgun', 'sniper', 'lmg'].includes(p.item));
  check(strayGuns.length === 0, `no spare guns on the floor: ${strayGuns.length}`);

  // The night's wave has a breach crew: two to four demolitions men, more on later nights.
  const crews = [1, 2, 3, 4, 5].map((n) => planWave(game, n).filter((t) => t === 'demo').length);
  check(JSON.stringify(crews) === JSON.stringify([2, 2, 3, 3, 4]), `C4 crews by night: ${crews}`);
  check([1, 3, 5].every((n) => planWave(game, n).length === 5 + 4 * n), 'and the wave is still the same size');

  // By day the bots build a wall ring (and nobody comes).
  h.run(35);
  check(enemies(h) === 0, 'no hostiles by day');
  let wall = 0;
  const air = game.world.blockId('air');
  for (let x = -10; x <= 10; x++) for (let z = -10; z <= 10; z++) if (Math.hypot(x, z) > 8.4 && Math.hypot(x, z) < 9.6 && game.world.getBlock(x, 68, z) !== air) wall++;
  check(wall > 15, `the bots built a wall: ${wall} blocks`);

  // Night: the hostiles come, the best gun is in hand, and the bots (the person idles) shoot them down for gold.
  h.run(25);
  check(enemies(h) > 0, `hostiles at night: ${enemies(h)}`);
  check(game.entities.all().some((e) => (e.data as { cover?: unknown }).cover), 'the hostiles are working up from cover to cover');
  let killed = 0;
  game.events.on('entityDeath', () => killed++);
  me.maxHealth = me.health = 1000;
  h.run(120);
  check(killed > 0, `the bots and turret killed hostiles: ${killed}`);
  check(game.players.some((p) => p.bot && p.armor > 0), 'the bots spent their gold on armour');
  console.log(`  after 180 s: ${killed} killed, ${enemies(h)} alive, wall ${wall} blocks, bot armour ${game.players.filter((p) => p.bot).map((p) => p.armor)}, bot guns ${game.players.filter((p) => p.bot).map((p) => ['rifle', 'smg', 'shotgun'].find((g) => p.inventory.count(g)) ?? 'pistol')}`);

  // A person who goes down at night is marked, and a bot brings them back up.
  const r = launch('siege-night', { seed: 11 });
  r.run(47);
  const down = r.ctx.player;
  for (let i = 0; i < 4 && down.alive; i++) {
    down.damage(99999);
    r.run(0.6);
  }
  check(!down.alive && down.spectating && r.ctx.entities.count('downed') === 1, 'down: marked and watching');
  let revived = false; // the night's gunmen may well shoot them down again after: it's the revive that counts
  for (let i = 0; i < 25 && !revived; i++) {
    r.run(1);
    revived = down.alive && !down.spectating;
  }
  check(revived, 'a bot revived them');

  // Night brings the siren's ammo crates round the relay; walking into one picks it up (and it's gone).
  const k = launch('siege-night', { seed: 14 });
  k.run(45.4);
  const crates = () => (k.step(1 / 60).frame?.pickups ?? []).filter((p) => p.item === 'ammo_crate');
  check(crates().length === 4, `four ammo crates at nightfall: ${crates().length}`);
  const c0 = crates()[0];
  k.ctx.player.teleport({ x: c0.x, y: c0.y - 0.5, z: c0.z });
  k.run(1);
  check(crates().length <= 3, `at least one picked up: ${crates().length} left`);

  // A satchel charge beside a wall blows a crater in it (in the open field, north of the site).
  const b = launch('siege-night', { seed: 12 });
  const bw = b.ctx.world;
  const top = (x: number, z: number) => bw.surfaceY(x, z) + 1;
  for (const p of b.ctx.players) p.spectate(true);
  b.run(1);
  const wallXs = [3, 4, 5, 6, 7, 8, 9];
  const wallY = wallXs.map((x) => top(x, 32)); // (the ground's height before the wall goes up)
  wallXs.forEach((x, i) => [0, 1].forEach((dy) => bw.setBlock(x, wallY[i] + dy, 32, 'cobblestone')));
  const walls = () => wallXs.flatMap((x, i) => [0, 1].filter((dy) => bw.getBlock(x, wallY[i] + dy, 32) !== air)).length;
  check(walls() === 14, 'a wall');
  b.ctx.entities.spawn('charge', { x: 6.5, y: top(6, 31) + 0.05, z: 31.5 });
  b.run(4);
  check(walls() < 14, `the charge went off and holed the wall: ${walls()} of 14 blocks left`);

  // C4: a demolitions man creeps up to the perimeter wall, plants a charge ("C4 set"), and it blows a hole in the wall.
  const c4 = launch('siege-night', { seed: 17 });
  const cw = c4.ctx.world;
  for (const p of c4.ctx.players) if (p.bot) p.spectate(true);
  const wallCells: [number, number, number][] = [];
  for (let z = 3; z <= 6; z++) for (const y of [68, 69, 70]) wallCells.push([14, y, z]);
  const wallLeft = () => wallCells.filter(([x, y, z]) => cw.getBlock(x, y, z) !== air).length;
  check(wallLeft() === 12, `the perimeter wall stands: ${wallLeft()} blocks`);
  c4.ctx.entities.spawn('demo', { x: 24.5, y: cw.surfaceY(24, 4) + 1.05, z: 4.5 });
  let planted = false;
  let said = false;
  for (let i = 0; i < 40 && wallLeft() === 12; i++) {
    c4.run(1);
    planted ||= c4.ctx.entities.count('charge') > 0;
    said ||= c4.calls.some((c) => c.method === 'feed' && JSON.stringify(c.args).includes('C4 set'));
  }
  check(planted, 'the demo planted a C4 charge on the wall');
  check(said, 'and called it: C4 set');
  check(wallLeft() < 12, `and it blew a hole in the wall: ${wallLeft()} of 12 blocks left`);
  // A charge somebody shoots is defused: no blast.
  const c = launch('siege-night', { seed: 13 });
  const ch = c.ctx.entities.spawn('charge', { x: 6.5, y: 65.05, z: 33.5 });
  c.ctx.player.teleport({ x: 7.5, y: 65.05, z: 33.5 });
  ch.damage(999, { source: c.ctx.player });
  c.run(3);
  check(c.ctx.entities.count('charge') === 0 && c.ctx.player.health === c.ctx.player.maxHealth, 'a shot charge is defused');

  // One nobody shoots hurts whoever's beside it.
  const d2 = launch('siege-night', { seed: 15 });
  d2.ctx.entities.spawn('charge', { x: 6.5, y: 65.05, z: 33.5 });
  d2.ctx.player.teleport({ x: 7.5, y: 65.05, z: 33.5 });
  d2.run(4);
  check(d2.ctx.player.health < d2.ctx.player.maxHealth, `a charge hurts the person beside it: ${d2.ctx.player.health}/${d2.ctx.player.maxHealth}`);

  // Nobody defending (everyone spectating, which monsters ignore): the relay falls.
  const lone = launch('siege-night', { seed: 8 });
  for (const p of lone.ctx.players) p.spectate(true);
  lone.run(300);
  check(lastScreen(lone) === 'The VIP is down', `lost: ${lastScreen(lone)}`);

  // Everyone going down at night ends it too.
  const wiped = launch('siege-night', { seed: 9 });
  wiped.run(60);
  // (a player just hit is briefly immune, so try again until nobody's left standing)
  for (let i = 0; i < 4; i++) {
    for (const p of wiped.ctx.players) if (p.alive) p.damage(99999);
    wiped.run(0.6);
  }
  wiped.run(1);
  check(lastScreen(wiped) === 'The team is down', `wiped: ${lastScreen(wiped)}`);
}
