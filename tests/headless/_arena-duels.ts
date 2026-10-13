import type { Entity, GameContext, Player, Vec3 } from '@platform';
import type { Pilot } from '../../src/platform/host/headless';
import { bossState } from '../../src/games/arena/bosses/fight';
import type { Mark } from '../../src/games/arena/bosses/messages';
import { launch } from './_harness';

/**
 * Probe: how each boss wave plays for a decent fighter alone, with that wave's arms: the boss and
 * the wave's roster as the director brings them (`/wave`), the arsenal's weapons of the rarity a
 * fighter would have by then, its blessings' worth of extra power, armour, Stout Heart, potions.
 * The fighter closes in and swings, strafes, reads the telegraphs (it jumps the shockwaves, rolls
 * through the blows, gets out of the rings, lanes and pools, smashes eggs, breaks phylacteries,
 * kills what's on it, throws a bomb now and then, drinks when low) but misses some of them
 * (`skill`). Logged: how long the boss takes from its entrance, and what hurt.
 * `node scripts/headless.mjs tests/headless/_arena-duels.ts` (`DUEL_BOSS=lich` for one boss,
 * `DUEL_LOG=1` for every hit and every read).
 */
const FLOOR = 70;

interface Setup {
  boss: string;
  /** Its wave. */
  wave: number;
  /** What it has: weapon, bombs; how much harder its blows land than that weapon's (rarities, blessings). */
  weapon: string;
  bombs: number;
  power: number;
  armor: number;
  /** The chance it reads a telegraph in time. */
  skill: number;
  /** Health potions (a drink heals 10), and its most health (Stout Heart's). */
  potions: number;
  health: number;
  seed: number;
}

const JUMP = new Set(['stomp', 'slam', 'nova']);
const ROLL = new Set(['sweep', 'twin', 'swipe', 'bite', 'chain']);

function duel(o: Setup) {
  const h = launch('arena', { seed: o.seed });
  const game = h.ctx as GameContext;
  const me = game.player as Player;
  me.teleport({ x: 0.5, y: FLOOR + 1, z: 16.5 }, 0, 0);
  me.inventory.clear();
  me.inventory.give(o.weapon);
  if (o.bombs) me.inventory.give('bomb', o.bombs);
  me.inventory.select(0);
  me.armor = o.armor;
  me.maxHealth = o.health;
  me.health = o.health;
  game.events.on('damage', (hit) => {
    if (hit.source && hit.source !== 'world' && hit.source.kind === 'player' && hit.target.kind === 'entity') hit.amount *= o.power;
  });
  const hurt = new Map<string, number>();
  const log: string[] = [];
  game.events.on('playerDamage', ({ amount, weapon, source }) => {
    const k = weapon ?? (source && source !== 'world' && source.kind === 'entity' ? (source === boss ? `${source.type}:${s.move?.name ?? 'after'}` : source.type) : 'other');
    hurt.set(k, (hurt.get(k) ?? 0) + amount);
    if (process.env.DUEL_LOG) log.push(`${h.time.toFixed(2)} -${amount} ${k} move=${s.move?.name}/${s.step} t=${s.t.toFixed(2)} roll=${JSON.stringify(me.abilities.roll)} ground=${me.onGround} hp=${me.health.toFixed(1)}`);
  });
  game.commands.run(`wave ${o.wave}`);
  h.run(10, { until: () => game.entities.count(o.boss) > 0 });
  const boss = game.entities.all(o.boss)[0];
  if (!boss) throw new Error(`wave ${o.wave} brought no ${o.boss}`);
  const s = bossState(boss);
  const rng = mulberry(o.seed);
  const decided = new Map<string, boolean>();
  const reads = (key: string) => {
    if (!decided.has(key)) decided.set(key, rng() < o.skill);
    return decided.get(key)!;
  };
  // The rings and lanes on the ground, as the screens have them.
  let marks: { m: Mark; t0: number }[] = [];
  let seen = 0;
  let strafe = 1;
  let strafeT = 0;
  let bombT = 0;
  let think = 0;
  let last: ReturnType<Pilot> = {};
  let potions = o.potions;
  let resting = false;

  const pilot: Pilot = () => {
    const calls = h.find('message', 'arena.boss.mark');
    for (; seen < calls.length; seen++) {
      const m = calls[seen].args[0] as Mark;
      if (m.k === 'clear') marks = marks.filter((x) => (x.m as { id?: string }).id !== m.id);
      else marks.push({ m, t0: h.time });
    }
    marks = marks.filter((x) => x.m.k !== 'clear' && h.time - x.t0 < (x.m as { t: number }).t);
    if ((think += 1 / 60) < 0.1) return { ...last, pressed: [], clicked: 0 };
    think = 0;
    const p = me.position;
    // Low: a potion, or back off to get its breath back.
    if (me.health < 7 && potions > 0) {
      potions--;
      me.heal(10);
    }
    if (me.health < 9) resting = true;
    if (me.health > 16) resting = false;
    if (resting) {
      const b = boss.position;
      return (last = { yaw: Math.atan2(p.x - b.x, p.z - b.z), pitch: 0, down: ['KeyW', strafe > 0 ? 'KeyD' : 'KeyA'], pressed: [], clicked: 0 });
    }
    // What to hit: an egg sac or a phylactery first, then the nearest thing near, else the boss.
    const near = game.entities.all().filter((e) => e.alive && e !== boss && !e.data.scenery && Math.hypot(e.position.x - p.x, e.position.z - p.z) < 5);
    const objective = game.entities.all().filter((e) => e.alive && (e.type === 'egg_sac' || e.type === 'phylactery'));
    // (Whatever's on it first: a decent fighter doesn't let the small ones chew on it.)
    const onMe = near.filter((e) => e.type !== 'egg_sac' && e.type !== 'phylactery' && dist(e.position, p) < 3.2).sort((a, b) => dist(a.position, p) - dist(b.position, p));
    const target: Entity = onMe[0] ?? objective.sort((a, b) => dist(a.position, p) - dist(b.position, p))[0] ?? near[0] ?? boss;
    const t = target.position;
    const half = target === boss ? (o.boss === 'colossus' ? 1.6 : o.boss === 'broodmother' ? 2.1 : 0.85) : 0.4;
    const d = dist(t, p);
    const yaw = Math.atan2(-(t.x - p.x), -(t.z - p.z));
    const ht = target === boss ? (o.boss === 'colossus' ? 2.5 : o.boss === 'broodmother' ? 1.3 : 2.2) : 0.6;
    const pitch = Math.atan2(t.y + ht - me.eye.y, Math.max(0.5, d));
    // Move: in to striking range and strafe there.
    if ((strafeT -= 0.1) <= 0) {
      strafeT = 1 + rng() * 1.5;
      strafe = rng() < 0.5 ? 1 : -1;
    }
    const down: string[] = [];
    if (d - half > 2.6) down.push('KeyW');
    else if (d - half < 1.4) down.push('KeyS');
    down.push(strafe > 0 ? 'KeyD' : 'KeyA');
    const pressed: string[] = [];
    // Out of any ring or lane about to land on it, away from its middle.
    for (const { m, t0 } of marks) {
      if (m.k === 'clear') continue;
      const left = m.t - (h.time - t0);
      // (A ring round the boss itself is a shockwave: jumped, below, not outrun.)
      if (m.k === 'ring' && left < 1.1 && left > 0 && dist({ x: m.at[0], y: 0, z: m.at[2] }, boss.position) > 1.5) {
        const [x, , z] = m.at;
        if (Math.hypot(p.x - x, p.z - z) < m.r + 0.6 && reads(`ring${t0}`)) {
          const away = Math.atan2(-(p.x - x), -(p.z - z));
          // Facing away from the ring's middle and running.
          return (last = { yaw: away, pitch: 0, down: ['KeyW'], pressed: [], clicked: 0 });
        }
      }
      // Out of a pool it's standing in.
      if (m.k === 'pool') {
        const [x, , z] = m.at;
        if (Math.hypot(p.x - x, p.z - z) < m.r + 0.4 && reads(`pool${t0}`)) return (last = { yaw: Math.atan2(-(p.x - x), -(p.z - z)), pitch: 0, down: ['KeyW'], pressed: [], clicked: 0 });
        continue;
      }
      if (m.k === 'lane' && left < 1 && left > 0 && reads(`lane${t0}`)) {
        const [ax, , az] = m.at;
        const [bx, , bz] = m.to;
        const l = Math.hypot(bx - ax, bz - az) || 1;
        const side = ((p.x - ax) * (bz - az) - (p.z - az) * (bx - ax)) / l;
        if (Math.abs(side) < m.w / 2 + 0.8) {
          const sx = -(bz - az) / l, sz = (bx - ax) / l;
          const sign = side >= 0 ? 1 : -1;
          return (last = { yaw: Math.atan2(-sx * sign, -sz * sign), pitch: 0, down: ['KeyW'], pressed: [], clicked: 0 });
        }
      }
    }
    // A sweep marked on the ground about to land on it (the twin's second): roll.
    for (const { m, t0 } of marks) {
      if (m.k !== 'sweep') continue;
      const left = m.t - (h.time - t0);
      // (The low one, in its own colour, is jumped.)
      if (left > 0 && left < 0.22 && dist(boss.position, p) < m.r + 1 && reads(`sweep${t0}`)) {
        if (m.c === '#ff6a2a') down.push('Space');
        else pressed.push('KeyQ');
      }
    }
    // The boss's blow coming: jump it or roll through it.
    // (One read for each blow: its move and when its cooldown began.)
    const key = `${s.move?.name}@${Math.round((s.cds[s.move?.name ?? ''] ?? 0) + h.time)}`;
    if (s.move && s.step === 'windup' && s.t < 0.2 && dist(boss.position, p) < 10 && reads(key)) {
      if (JUMP.has(s.move.name)) down.push('Space');
      else if (ROLL.has(s.move.name)) pressed.push('KeyQ');
      if (process.env.DUEL_LOG) log.push(`${h.time.toFixed(2)} react ${s.move.name} t=${s.t.toFixed(2)}`);
    }
    // A bomb now and then, when it's busy winding up close by.
    bombT -= 0.1;
    if (o.bombs && bombT <= 0 && me.inventory.count('bomb') > 0 && s.step === 'windup' && dist(boss.position, p) < 9) {
      bombT = 8;
      pressed.push('KeyG');
    }
    last = { yaw, pitch, down, pressed, clicked: d - half < 3.2 ? 1 : 0 };
    return last;
  };
  const t0 = h.time;
  h.run(420, { pilot, until: () => !boss.alive || !me.alive });
  if (process.env.DUEL_LOG) console.log(log.join('\n'));
  const took = [...hurt].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${Math.round(v)}`).join(', ');
  const time = h.time - t0;
  return { won: !boss.alive, time, left: Math.max(0, boss.health / boss.maxHealth), took, total: [...hurt.values()].reduce((a, b) => a + b, 0) };
}

const dist = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.z - b.z);

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export default function arenaDuels() {
  // Its gear by then: a weapon of the rarity it'd have bought or forged, its blessings' worth of power, a class's or Iron Skin's armour, Stout Heart, potions.
  const runs: Omit<Setup, 'seed' | 'skill'>[] = [
    { boss: 'colossus', wave: 5, weapon: 'gladius_rare', bombs: 3, power: 1.1, armor: 4, potions: 2, health: 20 },
    { boss: 'warden', wave: 10, weapon: 'diamond_sword_rare', bombs: 4, power: 1.15, armor: 8, potions: 3, health: 26 },
    { boss: 'broodmother', wave: 15, weapon: 'diamond_sword_epic', bombs: 4, power: 1.2, armor: 10, potions: 3, health: 26 },
    { boss: 'lich', wave: 20, weapon: 'diamond_sword_legendary', bombs: 4, power: 1.25, armor: 12, potions: 4, health: 26 },
  ];
  for (const r of runs.filter((x) => !process.env.DUEL_BOSS || x.boss === process.env.DUEL_BOSS)) {
    for (const skill of [0.85, 0.55]) {
      const out = [1, 2, 3, 4, 5, 6].map((seed) => duel({ ...r, skill, seed }));
      const won = out.filter((x) => x.won);
      const mins = won.map((x) => (x.time / 60).toFixed(1)).join(', ');
      console.log(
        `  ${r.boss} (${r.weapon} x${r.power}, armour ${r.armor}, reads ${Math.round(skill * 100)}%): won ${won.length}/${out.length} in ${mins || '-'} min; lost: ${out
          .filter((x) => !x.won)
          .map((x) => `at ${Math.round(x.left * 100)}% after ${(x.time / 60).toFixed(1)} min`)
          .join('; ') || 'none'}`,
      );
      console.log(`    hurt by: ${out[0].took}`);
    }
  }
}
