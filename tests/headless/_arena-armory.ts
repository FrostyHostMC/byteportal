import type { Entity, GameContext, Player } from '@platform';
import type { Pilot } from '../../src/platform/host/headless';
import { BLESSINGS, grant, level, offer } from '../../src/games/arena/blessings';
import { forge, forgePrice } from '../../src/games/arena/items/forge';
import { rollWeapon } from '../../src/games/arena/items/loot';
import { baseOf, rarityOf, variant } from '../../src/games/arena/items/rarity';
import { SHOWS } from '../../src/games/arena/items/moves';
import { POTION } from '../../src/games/arena/items/potions';
import { burning, chillOf, frozen, stagger, stunned } from '../../src/games/arena/items/status';
import { check, launch } from './_harness';

/**
 * Probe: the Arena's arsenal, one weapon at a time, on an emptied floor (the waves' own monsters
 * are cleared as they come), each proving its mechanic: the gladius parries (the attacker reels,
 * an arrow flies back) and blocks, the warhammer's slam hits all round, the spear goes through and
 * comes home, crossbow bolts pierce, the daggers strike harder from behind, the greatsword sweeps,
 * fire burns and spreads, frost freezes, lightning leaps; rarities scale, the forge swaps, the
 * chest rolls, R drinks a potion, and the blessings made for the new weapons work.
 * `node scripts/headless.mjs tests/headless/_arena-armory.ts`
 */
const FLOOR = 70;
const LMB = 1;
const RMB = 4;
/** Looking along +x, level (where the monsters stand). */
const EAST = { yaw: -Math.PI / 2, pitch: 0 };

function scene(seed: number) {
  const h = launch('arena', { seed });
  const game = h.ctx as GameContext;
  const me = game.player as Player;
  me.maxHealth = 800;
  me.health = 800;
  const mine = new Set<Entity>();
  // Everything happens along z = 0.5, across the Colosseum's open middle (its statues and columns
  // stand off it, at z ±8).
  const spawn = (type: string, x: number, z = 0.5, still = true) => {
    const e = game.entities.spawn(type, { x, y: FLOOR + 1.05, z });
    if (still) e.setSpeed(0);
    mine.add(e);
    return e;
  };
  let hurt = 0;
  game.events.on('playerDamage', ({ player, amount }) => player === me && (hurt += amount));
  const clear = () => {
    for (const e of game.entities.all()) if (!mine.has(e) && !e.data.master) e.remove();
  };
  /** Into their hand: a weapon (and arrows for what shoots them). */
  const hold = (id: string) => {
    me.inventory.give(id);
    me.inventory.select(me.inventory.slots.findIndex((s) => s?.item === id));
  };
  me.teleport({ x: -8.5, y: FLOOR + 1, z: 0.5 }, EAST.yaw, 0);
  // Past the countdown, the floor cleared.
  h.run(0.3, { pilot: () => (clear(), {}) });
  const run = (seconds: number, pilot: Pilot = () => ({ ...EAST })) => h.run(seconds, { pilot: (x) => (clear(), pilot(x)) });
  return { h, game, me, spawn, clear, hold, run, hurt: () => hurt };
}

const lost = (e: Entity) => (e.alive ? e.maxHealth - e.health : e.maxHealth);
const fmt = (es: Entity[]) => es.map((e) => (e.alive ? e.health.toFixed(1) : 'dead')).join(', ');

export default function arenaArmory() {
  const log = (r: string) => console.log(`  ${r}`);

  // Rarities: ids round trip, a legendary hits 1.9 times as hard, and the forge takes one up a step.
  {
    const s = scene(1);
    check(variant('gladius', 'epic') === 'gladius_epic' && variant('gladius', 'common') === 'gladius', 'variant ids');
    check(rarityOf('fire_staff_legendary') === 'legendary' && baseOf('fire_staff_legendary') === 'fire_staff' && rarityOf('fire_staff') === 'common' && rarityOf('iron_sword') === 'common', 'rarityOf and baseOf');
    const dmg = (id: string) => (s.game.items.get(id) as unknown as { damage: number }).damage;
    check(Math.abs(dmg('gladius_legendary') / dmg('gladius') - 1.9) < 1e-6 && dmg('gladius_rare') > dmg('gladius'), 'a legendary hits 1.9 times as hard');
    s.hold('daggers');
    const price = forgePrice('daggers');
    const now = forge(s.game, s.me, 'daggers');
    check(now === 'daggers_rare' && s.me.inventory.held?.item === 'daggers_rare' && !s.me.inventory.count('daggers'), `the forge: daggers became ${now}`);
    check(forgePrice('daggers_legendary') === null && forgePrice('iron_sword') === null, 'a legendary (or a starter sword) goes no further');
    const rolls = Array.from({ length: 400 }, () => rarityOf(rollWeapon(s.game)));
    const count = (r: string) => rolls.filter((x) => x === r).length;
    log(`rarities: forge daggers ${price} gold; 400 chest rolls: ${['common', 'rare', 'epic', 'legendary'].map((r) => `${count(r)} ${r}`).join(', ')}`);
    check(count('common') > count('rare') && count('rare') > count('epic') && count('legendary') > 0, 'the chest rolls the rarer less often');
  }

  // The gladius: a blow just as the guard goes up is parried (the zombie reels), a blow later is blocked.
  {
    const s = scene(2);
    s.hold('gladius');
    const z = s.spawn('zombie', -6.8);
    // What the screens are told (the stars over its head are theirs to draw: told once, not streamed).
    const told: { name: string; data: unknown }[] = [];
    const send = s.game.clients.send.bind(s.game.clients);
    (s.game.clients as { send: typeof send }).send = (to, name, data) => (told.push({ name, data }), send(to, name, data));
    let parried = false;
    let blockedTook = -1;
    let t = 0;
    s.run(1.4, () => {
      t += 1 / 60;
      if (t > 0.1 && !parried) {
        parried = true;
        const before = s.hurt();
        s.me.damage(3, { source: z, cause: 'melee' });
        check(s.hurt() === before, 'a parried blow does nothing');
      }
      if (t > 1.0 && blockedTook < 0) {
        const before = s.me.health;
        s.me.damage(4, { source: z, cause: 'melee' });
        blockedTook = before - s.me.health;
      }
      return { ...EAST, buttons: RMB };
    });
    const reels = stunned(z) || (z.data.stunned as number) > 0;
    s.run(1);
    const stars = told.filter((m) => m.name === 'armory.status' && (m.data as { id: number }).id === z.id).map((m) => (m.data as { f: number }).f);
    log(`gladius: parried, the zombie ${reels ? 'reels' : 'stands'} (the screens told ${stars.join(' then ')}); a blow on the shield later took ${blockedTook.toFixed(2)} of 4`);
    check(z.data.stunned !== undefined && blockedTook > 0 && blockedTook < 1.5, 'parry staggers, the block takes most of a blow');
    check(stars.length === 2 && stars[0] & SHOWS.stun && stars[1] === 0, 'the stars told once as it reels, once as it stops');
  }

  // …and an arrow parried flies back at the archer.
  {
    const s = scene(3);
    s.hold('gladius');
    const sk = s.spawn('skeleton', 2);
    sk.data._cd = 99;
    let t = 0;
    s.run(1.5, () => {
      t += 1 / 60;
      if (Math.abs(t - 0.12) < 0.009) s.me.damage(2, { source: sk, cause: 'projectile' });
      return { ...EAST, buttons: t > 0.05 ? RMB : 0 };
    });
    log(`gladius: an arrow reflected, the skeleton lost ${lost(sk).toFixed(1)}`);
    check(lost(sk) > 0, 'the reflected arrow hurts its archer');
  }

  // The warhammer: held, then let go: everything round you is hit and staggered, behind you too.
  {
    const s = scene(4);
    s.hold('warhammer');
    const ring = [s.spawn('zombie', -6.3), s.spawn('zombie', -10.7), s.spawn('zombie', -8.5, 2.5), s.spawn('zombie', -8.5, -1.5)];
    let t = 0;
    s.run(1.6, () => {
      t += 1 / 60;
      return { ...EAST, pitch: -0.5, buttons: t < 1.1 ? LMB : 0 };
    });
    log(`warhammer slam: ${fmt(ring)}; staggered ${ring.filter((e) => e.data.stunned !== undefined).length}`);
    check(ring.every((e) => lost(e) > 6) && ring.filter((e) => e.data.stunned !== undefined).length >= 3, 'the slam hits all round');
  }

  // A knight's shield turns a sword from the front, but a slam comes down past it.
  {
    const s = scene(14);
    s.hold('gladius');
    s.hold('warhammer');
    const k = s.spawn('knight', -6.0);
    s.run(1.5);
    s.me.inventory.select(s.me.inventory.slots.findIndex((x) => x?.item === 'gladius'));
    s.run(0.6);
    s.run(0.5, () => ({ ...EAST, clicked: LMB }));
    const swordFront = lost(k);
    s.me.inventory.select(s.me.inventory.slots.findIndex((x) => x?.item === 'warhammer'));
    s.run(0.6);
    let t = 0;
    s.run(1.3, () => {
      t += 1 / 60;
      return { ...EAST, pitch: -0.5, buttons: t < 0.95 ? LMB : 0 };
    });
    const slam = lost(k) - swordFront;
    log(`knight: a sword from the front took ${swordFront.toFixed(1)}, a slam ${slam.toFixed(1)}`);
    check(swordFront < 1 && slam > 6, 'the shield turns the sword, not the slam');
  }

  // The spear: thrown through a line of them, then home again into the hand.
  {
    const s = scene(5);
    s.hold('spear');
    const line = [s.spawn('zombie', -3), s.spawn('zombie', -1.5), s.spawn('zombie', 0)];
    let t = 0;
    let gone = false;
    s.run(7, () => {
      t += 1 / 60;
      if (t > 0.5 && !s.me.inventory.count('spear')) gone = true;
      return { ...EAST, buttons: t > 0.1 && t < 0.4 ? RMB : 0 };
    });
    const back = s.me.inventory.held?.item === 'spear';
    log(`spear: thrown through ${fmt(line)}; it ${gone ? 'left the hand' : 'never left'} and ${back ? 'came home' : 'is still out'}`);
    check(gone && back && line.filter((e) => lost(e) > 0).length >= 3, 'the spear goes through three and comes home');
  }

  // The crossbow: a bolt through three in a line; then a wait while it's spanned again.
  {
    const s = scene(6);
    s.hold('crossbow');
    s.me.inventory.give('arrow', 10);
    const line = [s.spawn('zombie', -2), s.spawn('zombie', 0), s.spawn('zombie', 2), s.spawn('zombie', 4)];
    let t = 0;
    s.run(0.9, () => {
      t += 1 / 60;
      return { ...EAST, clicked: t < 0.05 || (t > 0.4 && t < 0.45) ? LMB : 0, buttons: 0 };
    });
    const arrows = s.me.inventory.count('arrow');
    log(`crossbow: ${fmt(line)}; ${10 - arrows} bolt loosed in 0.9 s`);
    check(line.slice(0, 3).every((e) => lost(e) > 6) && lost(line[3]) === 0 && arrows === 9, 'a bolt goes through three, and the next waits for the span');
  }

  // The daggers: a stab on one that's reeling (or straight after a roll) strikes two and a half times as hard.
  {
    const s = scene(7);
    s.hold('daggers');
    const a = s.spawn('zombie', -6.4);
    s.run(0.25, () => ({ ...EAST, clicked: LMB }));
    const front = lost(a);
    a.remove();
    s.run(0.3);
    const b = s.spawn('zombie', -6.4);
    stagger(s.game, b, 2);
    s.run(0.25, () => ({ ...EAST, clicked: LMB }));
    const reeling = lost(b);
    log(`daggers: ${front.toFixed(1)} to its face, ${reeling.toFixed(1)} on one reeling`);
    check(front > 0 && reeling > front * 2.2, 'a stab on a reeling foe strikes much harder');
  }

  // The greatsword: one sweep catches three spread across the front.
  {
    const s = scene(8);
    s.hold('greatsword');
    const fan = [s.spawn('zombie', -5.5, 0.5), s.spawn('zombie', -6.2, 2.8), s.spawn('zombie', -6.2, -1.8)];
    s.run(0.3, () => ({ ...EAST, clicked: LMB }));
    log(`greatsword sweep: ${fmt(fan)}`);
    check(fan.every((e) => lost(e) > 8), 'the sweep hits all three');
  }

  // The fire staff: a fireball bursts among them and sets them burning (Wildfire spreads it from the dead).
  {
    const s = scene(9);
    s.hold('fire_staff');
    grant(s.game, s.me, 'wildfire', true);
    const knot = [s.spawn('zombie', -1, 0.5), s.spawn('zombie', -1, 1.6), s.spawn('zombie', -0.2, -0.4)];
    s.run(0.6, () => ({ ...EAST, clicked: LMB }));
    const lit = knot.filter((e) => burning(e)).length;
    const after = knot.map(lost);
    s.run(2, () => ({ ...EAST }));
    const later = knot.map(lost);
    log(`fire staff: ${lit} burning; lost ${after.map((x) => x.toFixed(1)).join(', ')}, then ${later.map((x) => x.toFixed(1)).join(', ')}`);
    check(lit >= 2 && later.every((x, i) => x > after[i] || x >= 20), 'the burst sets them burning, and they keep burning');
  }

  // The frost staff: a stream of shards freezes one solid.
  {
    const s = scene(10);
    s.hold('frost_staff');
    const z = s.spawn('zombie', -2, 0.5, false);
    let froze = false;
    let most = 0;
    s.run(2, () => {
      most = Math.max(most, chillOf(z));
      if (frozen(z)) froze = true;
      return { ...EAST, pitch: -0.05, buttons: froze ? 0 : LMB };
    });
    log(`frost staff: most frost ${most}, ${froze ? 'frozen solid' : 'never froze'}`);
    check(froze, 'four shards freeze it');
  }

  // The storm wand: one bolt leaps through four.
  {
    const s = scene(11);
    s.hold('storm_wand');
    const chain = [s.spawn('zombie', -4), s.spawn('zombie', -1, 2), s.spawn('zombie', 1.5, 0), s.spawn('zombie', 4, 1.5)];
    s.run(0.3, () => ({ ...EAST, clicked: LMB }));
    log(`storm wand: ${fmt(chain)}`);
    check(chain.every((e) => lost(e) > 2), 'the lightning leaps to all four');
  }

  // R drinks a potion, from anywhere in the hotbar, and the hand goes back to the sword.
  {
    const s = scene(12);
    // (A plain sword and two potions, whatever the class gave.)
    s.me.inventory.clear();
    s.me.inventory.give('wooden_sword');
    s.me.inventory.give('health_potion', 2);
    s.me.inventory.select(0);
    s.me.health = 700;
    let t = 0;
    s.run(1.4, () => {
      t += 1 / 60;
      return { ...EAST, pressed: t < 0.02 ? ['KeyR'] : [] };
    });
    log(`potion on R: ${s.me.health.toFixed(1)} health, ${s.me.inventory.count('health_potion')} left, holding ${s.me.inventory.held?.item}`);
    check(s.me.health >= 700 + POTION.heal && s.me.health < 702 + POTION.heal && s.me.inventory.count('health_potion') === 1 && s.me.inventory.held?.item === 'wooden_sword', 'R drinks one and puts it away');
  }

  // Blessings: Riposte mends on a parry; one that stacks comes again (Berserker II); offers are three apart.
  {
    const s = scene(13);
    s.hold('gladius');
    grant(s.game, s.me, 'riposte', true);
    grant(s.game, s.me, 'berserk', true);
    grant(s.game, s.me, 'berserk', true);
    s.me.health = 600;
    const z = s.spawn('zombie', -6.8);
    let t = 0;
    s.run(0.4, () => {
      t += 1 / 60;
      if (Math.abs(t - 0.1) < 0.009) s.me.damage(3, { source: z, cause: 'melee' });
      return { ...EAST, buttons: RMB };
    });
    const healed = s.me.health > 600;
    offer(s.game, s.me);
    // (It comes up a moment after the wave's cleared.)
    s.run(3.7);
    const shown = s.h.find('hud', 'menu').at(-1)?.args.find((a) => typeof a === 'object' && a && 'sections' in a) as { sections: { entries: { label: string }[] }[] } | undefined;
    const labels = shown?.sections[0].entries.map((e) => e.label) ?? [];
    log(`blessings: ${Object.keys(BLESSINGS).length} in all; riposte ${healed ? 'mended' : 'did nothing'}, berserker level ${level(s.me, 'berserk')}; offered ${labels.join(', ')}`);
    check(Object.keys(BLESSINGS).length >= 25 && healed && level(s.me, 'berserk') === 2 && new Set(labels).size === 3, 'blessings: riposte, stacking, offers');
  }
}
