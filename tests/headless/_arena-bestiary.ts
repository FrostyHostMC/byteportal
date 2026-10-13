import type { Entity, GameContext, Player } from '@platform';
import type { Pilot } from '../../src/platform/host/headless';
import { slamAt } from '../../src/games/arena/items/combat';
import { freeze } from '../../src/games/arena/items/status';
import { makeElite, eliteChance } from '../../src/games/arena/monsters/elites';
import { spawnMonster } from '../../src/games/arena/run/spawn';
import { state } from '../../src/games/arena/run/state';
import { check, launch } from './_harness';
import { DIFFICULTY } from '../../src/games/arena/run/difficulty';

/**
 * Probe: the bestiary's monsters and elites, one at a time on an emptied floor (the waves' own
 * monsters are cleared as they come): the knight's shield, slimes splitting, the wraith's blink
 * and drain, the golem's pound, the imp's fire, the cultist's chant and rite, a flock of bats
 * flying, and elites' affixes.
 * `node scripts/headless.mjs tests/headless/_arena-bestiary.ts`
 */
const FLOOR = 70;

function scene(seed: number) {
  const h = launch('arena', { seed });
  const game = h.ctx as GameContext;
  const me = game.player as Player;
  me.maxHealth = 400;
  me.health = 400;
  // (No armour, whatever the class gave: blows land as dealt.)
  me.armor = 0;
  const mine = new Set<Entity>();
  const spawn = (type: string, x: number, z: number, data: Record<string, unknown> = {}) => {
    const e = spawnMonster(game, type, { x, y: FLOOR + 1.05, z: z + 4 }, { data: { summoned: true, ...data } });
    mine.add(e);
    return e;
  };
  let hurt = 0;
  game.events.on('playerDamage', ({ amount }) => (hurt += amount));
  // Only ours (and what they split into or summon) on the floor.
  const clear = () => {
    for (const e of game.entities.all()) if (!mine.has(e) && !e.data.spawned && !e.data.flock) e.remove();
  };
  me.teleport({ x: -8.5, y: FLOOR + 1, z: 4.5 }, -Math.PI / 2, 0);
  const run = (seconds: number, pilot: Pilot = () => ({})) => h.run(seconds, { pilot: (t) => (clear(), pilot(t)) });
  return { h, game, me, spawn, run, hurt: () => hurt, heal: () => ((me.health = me.maxHealth), (hurt = 0)) };
}

export default function arenaBestiary() {
  const log = (r: string) => console.log(`  ${r}`);

  // The knight's shield: a blow from in front is turned aside; from behind, from above, or a bomb, it lands.
  {
    const s = scene(11);
    const k = s.spawn('knight', -4.5, 0.5);
    k.setSpeed(0);
    s.run(1.5);
    const hp = () => k.health;
    const at = (x: number, z: number, y = FLOOR + 1) => s.me.teleport({ x, y, z: z + 4 }, 0, 0);
    // In front (it faced us as we stood), out of its reach: an arrow's or a spear's blow.
    at(-8.5, 0.5);
    s.run(0.3);
    let before = hp();
    k.damage(6, { source: s.me, cause: 'melee' });
    const front = before - hp();
    // Behind it (it turns slowly: hit at once).
    at(-2.5, 0.5);
    before = hp();
    k.damage(6, { source: s.me, cause: 'melee' });
    const back = before - hp();
    // From above, out of a jump.
    at(-7.5, 0.5, FLOOR + 2.3);
    before = hp();
    k.damage(6, { source: s.me, cause: 'melee' });
    const above = before - hp();
    // A blast from in front.
    at(-8.5, 0.5);
    s.run(1);
    before = hp();
    k.damage(6, { source: s.me, cause: 'explosion' });
    const blast = before - hp();
    // Magic from in front.
    s.run(2);
    before = hp();
    k.damage(3, { source: s.me, cause: 'projectile', weapon: 'fire_staff' });
    k.damage(3, { source: s.me, cause: 'projectile', weapon: 'frost_staff_epic' });
    const magic = before - hp();
    log(`knight: front ${front.toFixed(1)}, behind ${back.toFixed(1)}, above ${above.toFixed(1)}, blast ${blast.toFixed(1)}, magic ${magic.toFixed(1)}`);
    check(front === 0 && back > 0 && above > 0 && blast > 0 && magic > 0, 'the knight blocks only blows from in front');
    // It fights: we're hurt standing in front of it.
    k.setSpeed(1);
    s.run(6);
    log(`knight swings: ${s.hurt().toFixed(1)} damage to us`);
    check(s.hurt() > 0, 'the knight hits back');
  }

  // A big slime splits in two small ones, and each small one in two tiny ones.
  {
    const s = scene(12);
    const sl = s.spawn('slime', -1.5, 0.5);
    s.run(0.5);
    sl.damage(100, { source: s.me, cause: 'melee' });
    s.run(0.5);
    const small = s.game.entities.all('slime_small');
    for (const e of small) e.damage(100, { source: s.me, cause: 'melee' });
    s.run(0.5);
    const tiny = s.game.entities.count('slime_tiny');
    log(`slime: ${small.length} small, then ${tiny} tiny`);
    check(small.length === 2 && tiny === 4, 'slimes split');
    s.heal();
    s.run(8);
    log(`tiny slimes hop on us: ${s.hurt().toFixed(1)} damage`);
    check(s.hurt() > 0, 'slimes land on you');
  }

  // A slime with a wall between: it oozes round the end of it (a hop at us would only hit the wall).
  {
    const s = scene(22);
    for (let z = 0; z <= 9; z++) for (let y = FLOOR + 1; y <= FLOOR + 3; y++) s.game.world.setBlock(-4, y, z, 'stone');
    const sl = s.spawn('slime', 0.5, 0.5);
    let hopped = 0;
    s.run(16, () => {
      if (sl.alive && sl.position.x < -4.5) hopped++;
      return {};
    });
    log(`slime behind a wall: came round it ${hopped > 0}, ${s.hurt().toFixed(1)} damage`);
    check(hopped > 0 && s.hurt() > 0, 'a slime finds its way round a wall');
  }

  // The wraith blinks in from far off, then drains.
  {
    const s = scene(13);
    const w = s.spawn('wraith', 8.5, 0.5);
    let closest = 99;
    let blinked = false;
    let last = { ...w.position };
    s.run(10, () => {
      const q = w.position;
      if (Math.hypot(q.x - last.x, q.z - last.z) > 1.5) blinked = true;
      last = { ...q };
      closest = Math.min(closest, Math.hypot(q.x - s.me.position.x, q.z - s.me.position.z));
      return {};
    });
    log(`wraith: blinked ${blinked}, came within ${closest.toFixed(1)}; drained ${s.hurt().toFixed(1)}`);
    // (Back in its drain's reach, out of a blade's.)
    check(blinked && closest < 6.5, 'the wraith blinks close');
    check(s.hurt() > 1, 'the wraith drains');
  }

  // The golem pounds the ground: standing in the ring hurts, out of it doesn't.
  {
    const s = scene(14);
    const g = s.spawn('golem', -4.5, 0.5);
    g.setSpeed(0);
    let pounded = false;
    s.game.events.on('playerDamage', ({ source }) => {
      if (source === g) pounded = true;
    });
    s.run(9);
    log(`golem: hit us ${pounded}, ${s.hurt().toFixed(1)} damage`);
    check(pounded && s.hurt() >= 4, 'the golem pounds');
    // Armour: a blow loses a third; a blast is half again.
    const before = g.health;
    g.damage(10, { source: s.me, cause: 'melee' });
    const blow = before - g.health;
    const mid = g.health;
    g.damage(10, { source: s.me, cause: 'explosion' });
    const blast = mid - g.health;
    log(`golem armour: a blow of 10 does ${blow.toFixed(1)}, a blast ${blast.toFixed(1)}`);
    check(blow < 7.5 && blast > blow * 1.4, 'stone shrugs off blows, cracks under blasts');
  }

  // The minotaur charges down its line: standing in it you're gored; stepped aside, it runs into the wall, stunned.
  {
    const s = scene(19);
    const m = s.spawn('minotaur', 4.5, 0.5);
    // (Ready to charge at once, whatever its first wait rolled.)
    m.data._cd = 0;
    let gored = false;
    s.game.events.on('playerDamage', ({ source, amount }) => {
      if (source === m && amount >= 8) gored = true;
    });
    s.run(6);
    log(`minotaur: gored us standing in its line ${gored}`);
    check(gored, 'the charge gores whoever stays in its way');
    // Again, toward the wall behind us; we step out of the line during the tell.
    s.me.teleport({ x: -14.5, y: FLOOR + 1, z: 4.5 }, 0, 0);
    m.teleport({ x: -5.5, y: FLOOR + 1.05, z: 4.5 });
    m.data._cd = 0;
    m.data._stun = 0;
    m.data._charge = undefined;
    let stepped = false;
    let stunned = false;
    s.run(6, () => {
      if (m.data._paw !== undefined && !stepped) {
        stepped = true;
        s.me.teleport({ x: -12.5, y: FLOOR + 1, z: 9.5 }, 0, 0);
      }
      if (((m.data._stun as number | undefined) ?? 0) > 0) stunned = true;
      return {};
    });
    const before = m.health;
    m.data._stun = 2;
    m.damage(10, { source: s.me, cause: 'melee' });
    log(`minotaur into the wall: stepped aside ${stepped}, stunned ${stunned}; a blow of 10 while dazed does ${(before - m.health).toFixed(1)}`);
    check(stepped && stunned && before - m.health > 10, 'a missed charge into a wall stuns it, and dazed it takes more');
  }

  // The imp throws fire and sets you alight.
  {
    const s = scene(15);
    s.spawn('imp', 0.5, 0.5);
    let burned = false;
    s.game.events.on('playerDamage', ({ weapon }) => {
      if (weapon === 'imp_fire') burned = true;
    });
    s.run(10);
    log(`imp: fireball landed ${burned}, ${s.hurt().toFixed(1)} damage`);
    check(burned, 'the imp lands a fireball on someone standing still');
  }

  // The cultist empowers the dead about it, and brought low it summons imps if left alone.
  {
    const s = scene(16);
    const c = s.spawn('cultist', 4.5, 0.5);
    const zs = [s.spawn('zombie', 3.5, 2.5), s.spawn('zombie', 3.5, -1.5)];
    for (const z of zs) z.setSpeed(0);
    c.setSpeed(0);
    s.run(6);
    const strong = zs.filter((z) => ((z.data.empowered as number | undefined) ?? 0) > s.game.clock.now).length;
    log(`cultist: ${strong} of 2 zombies empowered`);
    check(strong >= 1, 'the cultist empowers');
    c.damage(c.health - 3, { source: s.me, cause: 'projectile' });
    s.run(5);
    const imps = s.game.entities.all('imp').length;
    log(`cultist rite: ${c.alive ? 'still kneeling' : 'gone'}, ${imps} imps`);
    check(!c.alive && imps === 2, 'the rite summons two imps');
  }

  // Bats: a flock of four, up in the air, diving to bite.
  {
    const s = scene(17);
    s.spawn('bat', 4.5, 0.5);
    let high = 0;
    s.run(12, () => {
      for (const b of s.game.entities.all('bat')) high = Math.max(high, b.position.y - FLOOR - 1);
      return {};
    });
    const n = s.game.entities.count('bat');
    log(`bats: ${n} in the flock, up to ${high.toFixed(1)} over the floor, ${s.hurt().toFixed(1)} bites`);
    check(n === 4 && high > 2 && s.hurt() > 0, 'bats fly and bite');
  }

  // A bat with a tall wall between: over it and down onto us.
  {
    const s = scene(23);
    for (let z = -2; z <= 11; z++) for (let y = FLOOR + 1; y <= FLOOR + 8; y++) s.game.world.setBlock(-4, y, z, 'stone');
    const b = s.spawn('bat', 0.5, 0.5, { flock: true });
    s.run(20);
    log(`bat behind a wall: ${b.alive ? 'still flying' : 'gone'}, ${s.hurt().toFixed(1)} bites`);
    check(s.hurt() > 0, 'a bat gets over a wall to bite');
  }

  // The armory against the knight: a hammer's slam goes under its shield and leaves it reeling,
  // its guard hanging open; frozen, it's open too.
  {
    const s = scene(21);
    const k = s.spawn('knight', -4.5, 0.5);
    k.setSpeed(0);
    s.me.teleport({ x: -8.5, y: FLOOR + 1, z: 4.5 }, -Math.PI / 2, 0);
    s.run(1.5);
    let hp = k.health;
    k.damage(3, { source: s.me, cause: 'melee', weapon: 'gladius', knockback: 2.2 });
    const bash = hp - k.health;
    hp = k.health;
    slamAt(s.game, s.me, { x: -6.5, y: FLOOR + 1, z: 4.5 }, { radius: 3, damage: 8, knockback: 0.4, weapon: 'warhammer', stagger: 1.4 });
    const slam = hp - k.health;
    s.run(0.1);
    const reeling = k.data._down === true;
    hp = k.health;
    k.damage(5, { source: s.me, cause: 'melee', weapon: 'gladius' });
    const open = hp - k.health;
    s.run(2.5);
    freeze(s.game, k, 1.5);
    s.run(0.1);
    hp = k.health;
    k.damage(5, { source: s.me, cause: 'melee', weapon: 'gladius' });
    const frozen = hp - k.health;
    // A slam by its own cause (the hammer's): through, and the guard knocked open.
    s.run(3);
    hp = k.health;
    k.damage(4, { source: s.me, cause: 'slam', weapon: 'warhammer', from: { x: -6, y: FLOOR + 1, z: 4.5 } });
    k.damage(4, { source: s.me, cause: 'melee', weapon: 'gladius' });
    const slammed = hp - k.health;
    log(`knight vs the armory: a bash from in front ${bash}, the slam ${slam.toFixed(1)}, reeling ${reeling} so a blade does ${open.toFixed(1)}; frozen, ${frozen.toFixed(1)}; a 'slam' then a blade ${slammed.toFixed(1)}`);
    // (Monsters are tougher by the run's difficulty: `run/difficulty.ts`.)
    check(bash === 0 && slam > 0 && reeling && open > 0 && frozen > 0 && slammed >= 8 / DIFFICULTY.monster.tough - 0.01, 'a slam goes under the shield and opens its guard; so does a freeze');
  }

  // Frozen or reeling (the armory's `data.stunned`): a knight in reach does nothing, a bat drops.
  {
    const s = scene(20);
    const k = s.spawn('knight', -7, 0.5);
    const b = s.spawn('bat', 0.5, 0.5, { flock: true });
    s.run(4);
    const flying = b.position.y - FLOOR - 1;
    k.data.stunned = 99;
    b.data.stunned = 99;
    s.heal();
    s.run(4);
    const still = s.hurt();
    const dropped = b.position.y - FLOOR - 1;
    k.data.stunned = 0;
    b.data.stunned = 0;
    s.run(6);
    log(`stunned: the knight did ${still} to us in 4 s, ${s.hurt().toFixed(1)} once it came to; the bat fell from ${flying.toFixed(1)} to ${dropped.toFixed(1)}, back up to ${(b.position.y - FLOOR - 1).toFixed(1)}`);
    check(still === 0 && s.hurt() > 0 && dropped < flying - 2 && flying > 1.5 && b.position.y - FLOOR - 1 > 1.5, 'stunned monsters hold still, then carry on');
  }

  // Elites: the chance grows from wave 6; affixes do what they say.
  {
    const s = scene(18);
    log(`elite chance: wave 5 ${eliteChance(5)}, 6 ${eliteChance(6).toFixed(2)}, 15 ${eliteChance(15).toFixed(2)}, 20 ${eliteChance(20).toFixed(2)}`);
    check(eliteChance(5) === 0 && eliteChance(6) > 0 && eliteChance(20) > eliteChance(6), 'elites from wave 6, more later');
    state.wave = 12;
    let elites = 0;
    for (let i = 0; i < 200; i++) {
      const e = spawnMonster(s.game, 'zombie', { x: -1.5, y: FLOOR + 1.05, z: 4.5 });
      if (e.data.elite) elites++;
      e.remove();
    }
    log(`wave 12: ${elites} elites in 200 zombies (chance ${eliteChance(12).toFixed(2)})`);
    check(elites > 200 * eliteChance(12) * 0.5 && elites < 200 * eliteChance(12) * 1.6, 'elites roll as often as they should');

    const z = s.spawn('zombie', 0.5, 0.5);
    z.setSpeed(0);
    makeElite(s.game, z, 'shielded');
    const hp = z.health;
    z.damage(10, { source: s.me, cause: 'melee' });
    const warded = hp - z.health;
    z.damage(40, { source: s.me, cause: 'melee' });
    const after = hp - z.health;
    log(`shielded zombie: 10 soaked to ${warded}, then ${after.toFixed(1)} of 40 landed (worth ${z.data.worth})`);
    check(warded === 0 && after > 0 && after < 20 && z.data.elite === 'shielded' && z.data.worth === 3, 'the ward soaks, then it takes a share');

    const j = s.spawn('zombie', 3.5, 4.5);
    makeElite(s.game, j, 'juggernaut');
    const b = s.spawn('brute', 3.5, -2.5);
    makeElite(s.game, b, 'juggernaut');
    log(`juggernaut zombie: size ${j.size}; brute ${b.size.toFixed(2)} (${(2.55 * b.size).toFixed(2)} tall)`);
    check(j.size > 1.3 && 2.55 * b.size <= 2.81, 'a juggernaut is huge, but still fits the gates');

    s.heal();
    const x = s.spawn('zombie', -7.5, 1.5);
    x.setSpeed(0);
    makeElite(s.game, x, 'explosive');
    s.run(0.2);
    x.damage(500, { source: s.me, cause: 'melee' });
    s.run(1.5);
    log(`explosive zombie slain beside us: ${s.hurt().toFixed(1)} damage`);
    check(s.hurt() > 2, 'an explosive elite blows up');

    s.heal();
    s.me.teleport({ x: -8.5, y: FLOOR + 1, z: 4.5 }, -Math.PI / 2, 0);
    const f = s.spawn('zombie', -6.5, 0.5);
    f.setSpeed(0);
    makeElite(s.game, f, 'fiery');
    s.run(3);
    log(`fiery zombie beside us: ${s.hurt().toFixed(1)} burn`);
    check(s.hurt() > 1, 'a fiery elite burns');
  }
}
