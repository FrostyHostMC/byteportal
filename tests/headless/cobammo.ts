import { guns } from '../../src/platform/kits';
import { check, launch } from './_harness';

/**
 * Call of Blocky's ammo bags: whoever goes down drops one where they fell; walking over it tops up
 * the spare rounds of every gun you carry; someone whose primary runs out of spare rounds is told
 * where more come from.
 */
export default function cobammo() {
  const h = launch('callofblocky', { seed: 5, radius: 5 });
  const g = h.ctx;
  const kit = guns.of(g)!;
  h.run(1);
  const me = g.players.find((p) => !p.bot)!;
  const bots = g.players.filter((p) => p.bot);
  for (const b of bots) {
    b.protect(9999);
    b.freeze(true, { weapons: true });
  }
  me.protect(9999);
  const picked: string[] = [];
  g.events.on('pickup', (e) => picked.push(`${e.player.name}:${e.item}`));
  const toasts = () => h.find('hud', 'toast').map((c) => String(c.args[0]));

  // Out of spare rounds for the rifle (the pistol nearly): told where more come from, once.
  kit.setAmmo(me, 'rifle', { magazine: 4, reserve: 0 });
  kit.setAmmo(me, 'pistol', { reserve: 3 });
  h.run(2);
  check(toasts().filter((t) => t.includes('the fallen drop ammo')).length === 1, `told once where ammo comes from: ${toasts()}`);

  // A fighter goes down: their bag's where they fell. Walking over it tops up both guns' spare
  // rounds (the magazine as it was), and it's gone.
  const v = bots[0];
  const spot = { ...v.position };
  v.protect(0);
  v.damage(1000, { source: 'world', knockback: 0 });
  h.run(1);
  check(picked.length === 0, `nobody's picked anything up yet: ${picked}`);
  me.teleport(spot, 0, 0);
  h.run(1.5);
  check(picked.join() === `${me.name}:ammo`, `I picked up the bag: ${picked}`);
  const rifle = kit.ammo(me, 'rifle')!;
  const pistol = kit.ammo(me, 'pistol')!;
  check(rifle.reserve === 120 && rifle.magazine === 4 && pistol.reserve === 48, `topped up: rifle ${rifle.magazine}/${rifle.reserve}, pistol ${pistol.reserve}`);
  check(me.inventory.count('ammo') === 0, 'the bag is used, not carried');
  check(h.find('hud', 'pop').some((c) => c.args[0] === '+AMMO'), 'told it topped me up');

  // Another, full up: still used, and said so.
  const w = bots[1];
  const spot2 = { ...w.position };
  w.protect(0);
  w.damage(1000, { source: 'world', knockback: 0 });
  h.run(1);
  me.teleport(spot2, 0, 0);
  h.run(1.5);
  check(picked.filter((x) => x.endsWith(':ammo')).length === 2 && toasts().some((t) => t.includes('Full up')), `a second bag, full up: ${picked}; ${toasts().slice(-2)}`);
  console.log(`  bags dropped and picked up: ${picked.join(', ')}`);
}
