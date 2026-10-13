import type { Pilot } from '../../src/platform/host/headless';
import { purchase } from '../../src/games/arena/run/shop';
import { ARMOR, armorOf } from '../../src/games/arena/items';
import { gold } from '../../src/games/arena/run/gold';
import { WARES } from '../../src/games/arena/items/catalog';
import { progressOf } from '../../src/games/arena/run/progression';
import { map, state } from '../../src/games/arena/run/state';
import { bus } from '../../src/games/arena/run/bus';
import { check, launch } from './_harness';

/**
 * A bot plays the Arena's whole run, twenty waves and four bosses: it walks at the nearest monster
 * (or reward), attacks, hops over obstacles and holds its best weapon, and between waves it spends
 * its gold at the merchant's (armour first, then the best blade on sale, a potion). It gets extra
 * health, and monsters hanging back (or holding out a long time) take chip damage so the run doesn't
 * depend on chasing archers or getting round a pillar.
 */
export default function arena() {
  const t0 = performance.now();
  const h = launch('arena', { seed: 1337 });
  const game = h.ctx;
  const me = game.player;
  me.maxHealth = 800;
  me.health = 800;
  // (As a blast: no shield turns it, as a knight's does the bot's blows from in front.)
  game.clock.every(0.7, () => {
    for (const e of game.entities.all()) if (!e.data.scenery && e.type !== 'warden' && (e.distanceTo(me) > 4 || e.age > 20)) e.damage(4, { source: me, knockback: 0, cause: 'explosion' });
  });

  // Shopping, between waves: the next armour, the best blade it can afford, potions.
  const bought: string[] = [];
  const shop = () => {
    const buy = (id: string) => purchase(game, me, id) && bought.push(id);
    for (const w of WARES.filter((x) => x.kind === 'armor')) if (gold(me) >= w.price && buy(w.item)) break;
    const blades = WARES.filter((w) => w.kind === 'weapon' && game.items.get(w.item)?.kind === 'melee' && !me.inventory.count(w.item)).sort((a, b) => b.price - a.price);
    for (const w of blades) if (gold(me) >= w.price && buy(w.item)) break;
    if (me.inventory.count('health_potion') < 2 && gold(me) >= 40) buy('health_potion');
  };
  // (Each wave won, a trip to the merchant's.)
  let cleared = 0;
  let shopped = 0;
  bus.on('waveCleared', () => cleared++);

  let hop = 0;
  let think = 0;
  let last: ReturnType<Pilot> = {};
  const pilot: Pilot = () => {
    // Decide every 80 ms, like a person's reactions; hold the controls in between.
    if ((think += 1 / 60) < 0.08) return { ...last, clicked: 0, pressed: [] };
    think = 0;
    if (cleared !== shopped) {
      shopped = cleared;
      shop();
    }
    const eye = me.eye;
    let target: { x: number; y: number; z: number } | null = null;
    let best = Infinity;
    let height = 1.3;
    for (const e of game.entities.all()) {
      if (e.data.scenery) continue;
      const d = Math.hypot(e.position.x - eye.x, e.position.z - eye.z);
      if (d < best) {
        best = d;
        target = e.position;
        height = e.type === 'spider' ? 0.5 : e.type === 'warden' ? 2.6 : e.type === 'brute' ? 1.6 : 1.3;
      }
    }
    const fighting = !!target;
    if (!target) {
      for (const p of h.sim.items.frame()) {
        const d = Math.hypot(p.x - eye.x, p.z - eye.z);
        if (d < best) {
          best = d;
          target = { x: p.x, y: p.y - 1.3, z: p.z };
          height = 0.5;
        }
      }
    }
    if (!target) return (last = {});
    const dx = target.x - eye.x;
    const dy = target.y + height - eye.y;
    const dz = target.z - eye.z;
    const down = best > 2.4 ? ['KeyW'] : [];
    if (down.length && Math.hypot(me.velocity.x, me.velocity.z) < 0.5) hop = 2;
    if (hop > 0 && hop--) down.push('Space');
    // Hold the best melee weapon.
    const inv = me.inventory;
    let slot = inv.selected;
    let rank = -1;
    inv.slots.forEach((s, i) => {
      const d = s && game.items.get(s.item);
      if (d && d.kind === 'melee' && (d.rank ?? 0) > rank) {
        rank = d.rank ?? 0;
        slot = i;
      }
    });
    if (slot !== inv.selected) inv.select(slot);
    last = { down, yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) };
    // (A tap: the button down for the frame, as a hand's click; a warhammer swings on its release.)
    return { ...last, clicked: fighting ? 1 : 0, buttons: fighting ? 1 : 0 };
  };

  // The end screen (the HUD's `arena-end` widget), once it's up.
  type End = { word: string; kills: string; reached: string; newBest: boolean };
  const end = () => h.find('hud', 'widget').find((c) => c.args[0] === 'arena-end')?.args[1] as End | undefined;
  const simulated = h.run(3600, { pilot, until: () => state.phase === 'victory' && end() !== undefined });
  const result = end()?.word;
  const wall = (performance.now() - t0) / 1000;
  console.log(`  ${result ?? 'no result'} after ${simulated.toFixed(0)} s of game time (${(simulated / 60).toFixed(1)} min), ${wall.toFixed(1)} s wall clock (${(simulated / wall).toFixed(0)}× real time)`);
  check(result === 'Victory', `expected Victory, got ${result ?? 'nothing'} (${game.entities.all().map((e) => `${e.type} ${e.health}/${e.maxHealth} at ${e.position.x.toFixed(0)},${e.position.y.toFixed(0)},${e.position.z.toFixed(0)}`).join(', ')}; me at ${JSON.stringify(me.position)})`);
  // Achievements along the way: the first kill, the first wave, the win, and (never down) the win unbroken.
  const missing = ['first_blood', 'first_wave', 'champion', 'unbroken'].filter((a) => !me.achieved(a));
  check(!missing.length, `achievements not earned: ${missing.join(', ')}`);
  const popped = h.find('hud', 'achievement').map((c) => (c.args[0] as { title: string }).title);
  check(popped.includes('Champion') && popped.includes('Warmed Up'), `achievements popped up: ${popped.join(', ')}`);
  const slain = end()?.kills.replace(/,/g, '');
  check(String(me.store.get<number>('kills')) === slain, `kills kept all-time: ${me.store.get('kills')} of ${slain}`);
  // The economy: gold earned and spent at the merchant's (scarce: a few buys), the best armour by the end.
  check(bought.length >= 5 && armorOf(me) === ARMOR.plate_armor.points, `shopping: ${bought.join(', ')} (armour ${armorOf(me)})`);
  // Levels: XP earned for the run, the best wave kept.
  const xp = progressOf(me);
  const best = (me.store.get<{ best: Record<string, number> }>('arena')?.best ?? {})[map().id];
  check(xp.level >= 4 && end()?.newBest && best === 20, `progression: level ${xp.level} (${xp.total} XP), best ${best}`);
  console.log(`  bought: ${bought.join(', ')}`);
  console.log(`  ${end()?.reached}, ${slain} slain, level ${xp.level}`);
  console.log(`  achievements: ${popped.join(', ')}`);
}
