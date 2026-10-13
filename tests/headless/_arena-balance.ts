import type { Entity, GameContext, Player } from '@platform';
import type { Pilot } from '../../src/platform/host/headless';
import { RARE_BASES, RARITIES, RARITY, variant, type RareBase, type Rarity } from '../../src/games/arena/items/rarity';
import { check, launch } from './_harness';

/**
 * Probe: the arsenal's balance. Each weapon in each rarity is used as a player would use it (held
 * swings, a hammer's charged slams, a bow drawn full and loosed, a crossbow fired as it's spanned,
 * staffs held) for ten seconds on dummies that are held in place and never die, and what it deals
 * is measured: on one in front (`single`), and on a knot of five (`crowd`). From that, how long it
 * takes to bring down the toughest of the bestiary (a brute; a golem behind its armour; an elite
 * golem, which takes two-fifths of each blow; a juggernaut minotaur, a quarter) by the rarity a
 * fighter can expect to hold by then. Prints the table, and checks every weapon stays in its band.
 * `node scripts/headless.mjs tests/headless/_arena-balance.ts`
 */
const FLOOR = 70;
const SECONDS = 10;
const LMB = 1;

interface Result {
  single: number;
  crowd: number;
}

/** Who a dummy stands for: health, armour points, and the share of each blow it takes (elites). */
const FOES = [
  { name: 'brute', health: 70, armor: 0, share: 1 },
  { name: 'golem', health: 95, armor: 8, share: 1 },
  { name: 'elite golem', health: 95, armor: 8, share: 1 / 2.5 },
  { name: 'juggernaut minotaur', health: 70, armor: 0, share: 1 / 4 },
];
/** Seconds to bring one down at `dps` (its armour and share taken off). */
const ttk = (dps: number, f: (typeof FOES)[number]) => f.health / (dps * (1 - 0.04 * f.armor) * f.share);

function measure(base: RareBase, rarity: Rarity, crowd: boolean): number {
  const h = launch('arena', { seed: 7 });
  const game = h.ctx as GameContext;
  const me = game.player as Player;
  const id = variant(base, rarity);
  const def = game.items.get(id) as unknown as { kind: string; slam?: { charge: number }; drawTime?: number; reach?: number };
  me.protect(9999);
  me.inventory.clear();
  me.inventory.give(id);
  me.inventory.give('arrow', 64);
  me.inventory.give('arrow', 64);
  me.inventory.select(0);
  // Across the Colosseum's open middle (its statues and columns stand off it, at z ±8).
  me.teleport({ x: -8.5, y: FLOOR + 1, z: 0.5 }, -Math.PI / 2, 0);
  const ranged = def.kind === 'bow' || def.kind === 'gun' || def.kind === 'staff';
  // In front, at a weapon's reach (a little inside it), or eight blocks off for what shoots.
  const d = ranged ? 8 : Math.min(2.6, (def.reach ?? 3) - 0.4);
  const spots = crowd
    ? [0, -0.6, 0.6, -1.1, 1.1].map((a, i) => ({ x: -8.5 + Math.cos(a * (ranged ? 0.25 : 0.6)) * (d + (i > 2 ? 0.4 : 0)), z: 0.5 + Math.sin(a * (ranged ? 0.25 : 0.6)) * (d + (i > 2 ? 0.4 : 0)) }))
    : [{ x: -8.5 + d, z: 0.5 }];
  const dummies: Entity[] = [];
  const pin = () => {
    for (const e of game.entities.all()) if (!dummies.includes(e)) e.remove();
    spots.forEach((p, i) => {
      if (!dummies[i]?.alive) {
        dummies[i] = game.entities.spawn('zombie', { x: p.x, y: FLOOR + 1.05, z: p.z });
        dummies[i].setSpeed(0);
      }
      dummies[i].teleport({ x: p.x, y: FLOOR + 1.05, z: p.z });
      dummies[i].data._cd = 99;
    });
  };
  let dealt = 0;
  let counting = false;
  game.events.on('entityDamage', ({ entity, amount }) => {
    if (!dummies.includes(entity)) return;
    if (counting) dealt += amount;
    entity.health = entity.maxHealth;
  });
  pin();
  h.run(0.5, { pilot: () => (pin(), {}) });
  // How it's used: a slam charged full and let go, a bow drawn full and loosed, the rest held down.
  let t = 0;
  const cycle = def.slam ? def.slam.charge + 0.15 : def.kind === 'bow' ? (def.drawTime ?? 0.9) + 0.08 : 0;
  const pilot: Pilot = () => {
    pin();
    t += 1 / 60;
    const target = dummies[0].position;
    const eye = me.eye;
    const dx = target.x - eye.x;
    const dz = target.z - eye.z;
    const dy = target.y + 1.1 - eye.y;
    const yaw = Math.atan2(-dx, -dz);
    const pitch = Math.atan2(dy, Math.hypot(dx, dz)) - (def.slam ? 0.4 : 0);
    const down = cycle ? (t % cycle) < cycle - 0.08 : true;
    return { yaw, pitch, buttons: down ? LMB : 0, clicked: def.kind === 'gun' ? LMB : 0 };
  };
  counting = true;
  h.run(SECONDS, { pilot });
  return dealt / SECONDS;
}

export default function arenaBalance() {
  const table = new Map<string, Result>();
  for (const base of RARE_BASES)
    for (const r of RARITIES) table.set(variant(base, r), { single: measure(base, r, false), crowd: measure(base, r, true) });

  const pad = (s: string, n: number) => s.padEnd(n);
  const num = (x: number) => x.toFixed(1).padStart(5);
  console.log(`  ${pad('weapon', 14)}${RARITIES.map((r) => pad(r, 13)).join('')}  common TTK: brute / golem / elite golem / juggernaut;  epic: elite golem, legendary: elite golem`);
  for (const base of RARE_BASES) {
    const cells = RARITIES.map((r) => {
      const x = table.get(variant(base, r))!;
      return `${num(x.single)}/${num(x.crowd)}  `;
    });
    const c = table.get(base)!.single;
    const e = table.get(variant(base, 'epic'))!.single;
    const l = table.get(variant(base, 'legendary'))!.single;
    console.log(`  ${pad(base, 14)}${cells.join('')}  ${FOES.map((f) => ttk(c, f).toFixed(0)).join(' / ')} s;  ${ttk(e, FOES[2]).toFixed(0)} s, ${ttk(l, FOES[2]).toFixed(0)} s`);
  }
  console.log(`  (damage a second: one in front / five in a knot; ${SECONDS} s each)`);

  // The bands: every weapon pulls its weight, none runs away with it.
  const AOE = new Set(['greatsword', 'warhammer', 'storm_wand', 'fire_staff', 'battle_axe']);
  for (const base of RARE_BASES) {
    const c = table.get(base)!;
    const e = table.get(variant(base, 'epic'))!;
    const l = table.get(variant(base, 'legendary'))!;
    // (What hits a crowd may give up a little on one: the floor's lower for it.)
    const floor = AOE.has(base) ? 7.5 : 8.5;
    check(c.single >= floor && c.single <= 20, `${base}: ${c.single.toFixed(1)} a second on one, common (${floor}..20)`);
    check(l.single >= c.single * 1.8, `${base}: a legendary deals ${(l.single / c.single).toFixed(2)}x a common's`);
    check(ttk(e.single, FOES[2]) <= 26, `${base}: an epic takes ${ttk(e.single, FOES[2]).toFixed(0)} s on an elite golem (26 at most)`);
    if (AOE.has(base)) check(c.crowd >= c.single * 2.2, `${base}: ${(c.crowd / c.single).toFixed(1)}x on a crowd (2.2 at least)`);
  }
  console.log(`  rarities: ${RARITIES.map((r) => `${r} x${RARITY[r].damage} damage, x${RARITY[r].pace} time`).join('; ')}`);
}
