import type { Entity, GameContext, Player } from '@platform';
import type { Pilot } from '../../src/platform/host/headless';
import { grant } from '../../src/games/arena/blessings';
import { check, launch } from './_harness';

/**
 * Probe: the Arena's new pieces one at a time, on an emptied floor (the waves' own monsters are
 * cleared as they come): the Sapper's blast and a roll through it, a slain Sapper's keg, the
 * Necromancer raising the dead, a Treasure Goblin getting away, a bomb, and Volatile's chain.
 * `node scripts/headless.mjs tests/headless/_arena-fun.ts`
 */
const FLOOR = 70;

function scene(seed: number) {
  const h = launch('arena', { seed });
  const game = h.ctx as GameContext;
  const me = game.player as Player;
  const mine = new Set<Entity>();
  // Everything happens along z = 0.5, across the open middle.
  const spawn = (type: string, x: number, z: number) => {
    const e = game.entities.spawn(type, { x, y: FLOOR + 1.05, z });
    mine.add(e);
    return e;
  };
  let hurt = 0;
  game.events.on('playerDamage', ({ amount }) => (hurt += amount));
  // Only ours (and what they raise) on the floor.
  const clear = () => {
    for (const e of game.entities.all()) if (!mine.has(e) && !e.data.master) e.remove();
  };
  me.teleport({ x: -8.5, y: FLOOR + 1, z: 0.5 }, -Math.PI / 2, 0);
  return { h, game, me, spawn, clear, hurt: () => hurt };
}

export default function arenaFun() {
  const rows: string[] = [];
  const log = (r: string) => (rows.push(r), console.log(`  ${r}`));

  // A Sapper reaches you and blows.
  {
    const s = scene(1);
    s.spawn('sapper', -1.5, 0.5);
    s.h.run(6, { pilot: () => (s.clear(), { yaw: -Math.PI / 2, pitch: 0 }) });
    log(`sapper reaches you: ${s.hurt().toFixed(1)} damage, sapper ${s.game.entities.count('sapper') ? 'still there' : 'gone'}`);
    check(s.hurt() > 3 && !s.game.entities.count('sapper'), 'the sapper blows up on you');
  }

  // …and a roll just before it blows.
  {
    const s = scene(2);
    const sap = s.spawn('sapper', -1.5, 0.5);
    let rolled = false;
    const pilot: Pilot = () => {
      s.clear();
      const fuse = sap.data._fuse as number | undefined;
      if (!rolled && fuse !== undefined && fuse < 0.2) {
        rolled = true;
        return { yaw: -Math.PI / 2, pitch: 0, down: ['KeyA'], pressed: ['KeyQ'] };
      }
      return { yaw: -Math.PI / 2, pitch: 0, down: rolled ? ['KeyA'] : [] };
    };
    s.h.run(6, { pilot });
    log(`roll through the blast: rolled ${rolled}, ${s.hurt().toFixed(1)} damage`);
    check(rolled && s.hurt() === 0, `a roll takes you through the blast: ${s.hurt()}`);
  }

  // A Sapper slain in a crowd: its keg goes off among its friends, never hurting you.
  {
    const s = scene(3);
    const sap = s.spawn('sapper', 0.5, 0.5);
    const zs = [s.spawn('zombie', 2, 0.5), s.spawn('zombie', 0.5, 2), s.spawn('zombie', -1, -1)];
    for (const z of zs) z.setSpeed(0);
    sap.setSpeed(0);
    s.me.teleport({ x: -3.5, y: FLOOR + 1, z: 0.5 }, -Math.PI / 2, 0);
    s.h.run(0.2, { pilot: () => (s.clear(), {}) });
    sap.damage(100, { source: s.me, weapon: 'iron_sword' });
    s.h.run(2, { pilot: () => (s.clear(), {}) });
    const hp = zs.map((z) => (z.alive ? z.health.toFixed(0) : 'dead'));
    log(`slain sapper's keg: zombies ${hp.join(', ')}; you took ${s.hurt()}`);
    check(zs.every((z) => !z.alive || z.health < 20) && s.hurt() === 0, 'the keg hurts the monsters, not you');
  }

  // The Necromancer raises the dead.
  {
    const s = scene(4);
    s.spawn('necromancer', 4.5, 0.5);
    s.h.run(9, { pilot: () => (s.clear(), { yaw: -Math.PI / 2, pitch: 0 }) });
    const risen = s.game.entities.all('zombie').filter((z) => z.data.master).length;
    log(`necromancer: ${risen} risen after 9 s`);
    check(risen >= 2, `the dead rise: ${risen}`);
  }

  // A Treasure Goblin runs, then gets away.
  {
    const s = scene(5);
    const g = s.spawn('goblin', 0.5, 0.5);
    let far = 0;
    s.h.run(40, {
      pilot: () => {
        s.clear();
        if (g.alive) far = Math.max(far, Math.hypot(g.position.x - s.me.position.x, g.position.z - s.me.position.z));
        return { yaw: -Math.PI / 2, pitch: 0 };
      },
    });
    const feed = s.h.find('hud', 'feed').some((c) => String(c.args[0]).includes('got away'));
    log(`goblin: ran up to ${far.toFixed(1)} blocks off, ${s.game.entities.count('goblin') ? 'still here' : 'gone'}, "got away" ${feed}`);
    check(!s.game.entities.count('goblin') && feed, 'the goblin gets away');
  }

  // A bomb into a knot of zombies.
  {
    const s = scene(6);
    s.me.inventory.give('bomb', 1);
    const zs = [s.spawn('zombie', -1.5, 0.5), s.spawn('zombie', -1.5, 1.5), s.spawn('zombie', -1.5, -0.5)];
    for (const z of zs) z.setSpeed(0);
    let thrown = false;
    s.h.run(4, {
      pilot: () => {
        s.clear();
        const press = !thrown && s.h.time > 0.5;
        if (press) thrown = true;
        return { yaw: -Math.PI / 2, pitch: -0.25, pressed: press ? ['KeyG'] : [], down: press ? ['KeyG'] : [] };
      },
    });
    const hp = zs.map((z) => (z.alive ? z.health.toFixed(0) : 'dead'));
    log(`bomb: zombies ${hp.join(', ')}; ${s.me.inventory.count('bomb')} left; you took ${s.hurt()}`);
    check(zs.every((z) => !z.alive || z.health < 20) && s.hurt() === 0, 'the bomb hurts them, not you');
  }

  // Volatile: slain monsters burst into their neighbours.
  {
    const s = scene(7);
    grant(s.game, s.me, 'volatile', true);
    const zs = [0, 1, 2, 3].map((i) => s.spawn('zombie', 1 + i * 2, 0.5));
    for (const z of zs) z.setSpeed(0);
    zs[0].damage(100, { source: s.me, weapon: 'iron_sword' });
    s.h.run(1.5, { pilot: () => (s.clear(), {}) });
    const hp = zs.map((z) => (z.alive ? z.health.toFixed(0) : 'dead'));
    log(`volatile: ${hp.join(', ')}`);
    check(zs[1].health < 20 || !zs[1].alive, 'the burst hurts the next one');
  }

  // Stout Heart and a blessing chosen for someone who didn't choose.
  {
    const s = scene(8);
    grant(s.game, s.me, 'stout', true);
    log(`stout heart: ${s.me.maxHealth} max health`);
    check(s.me.maxHealth === 26, 'three more hearts');
  }

}
