import type { Entity, GameContext, Player, Vec3 } from '@platform';
import { FLOOR, along, inBox, MAPS, type ArenaMap, type Gate, type TrapSpec } from '../../src/games/arena/maps';
import { bankFrom, inHazard } from '../../src/games/arena/maps/hazards';
import { INTRO_MSG, type IntroMessage } from '../../src/games/arena/maps/messages';
import { bus } from '../../src/games/arena/run/bus';
import { addGold, gold } from '../../src/games/arena/run/gold';
import { inFight, map } from '../../src/games/arena/run/state';
import { check, launch } from './_harness';

/**
 * Probe: every map is walkable, and its traps work. On each, zombies brought in at every gate
 * and every boss gate must find their way to a fighter standing in the middle, at the shop, at
 * each chest and at spots round the floor (each placement in turn); the map's own places (the
 * middle, the shop, the chests, the lookout) must have room for a body; nowhere a fighter can get
 * to from the middle may be somewhere they can't get back from (a pit, a ledge: unless it's a
 * hazard that burns them out of it), and a fighter dropped anywhere in a hazard's pool (the Forge's
 * lava, the Sanctum's frozen pool) must be out on dry ground within 2 seconds just walking toward
 * the nearest bank (each burn throws them toward it); the shop needs 3 by 3 of clear floor, and neither the shop
 * nor a chest may be in a trap's way; every boss gate must be open floor a
 * boss fits on (its floor, clear air 9 high for 3 blocks round, open floor 12 long in front of it
 * for its entrance's camera). Then each trap: a fighter with gold
 * walks up to its lever and presses E, pays, and zombies held where it works are hurt and slain
 * by it, the kills theirs. The waves' own monsters are cleared as they come. Last, the run's start
 * and end as the maps see them: every fight's start sends the whole fly-over (a restart right after
 * another too), and a won run carried on (`keepFighting`) stands the vote down till it ends.
 * `node scripts/headless.mjs tests/headless/_arena-maps.ts` (MAP=id for one map).
 */

/** Close enough to be fighting them. */
const REACH = 2.4;
/** How long they get to come (seconds). */
const LIMIT = 40;

export default function arenaMaps() {
  const only = process.env.MAP;
  const rows: string[] = [];
  const failed: string[] = [];
  for (const m of MAPS) {
    if (only && m.id !== only) continue;
    const r = probe(m);
    rows.push(r.row);
    failed.push(...r.failed);
    console.log(`  ${r.row}`);
  }
  if (!only) {
    const r = flow(failed);
    rows.push(r);
    console.log(`  ${r}`);
  }
  check(!failed.length, `monsters that never got there:\n    ${failed.join('\n    ')}`);
  return rows.join(' · ');
}

/** The run's start and end, as the maps see them: the fly-over; the vote and `keepFighting`. */
function flow(failed: string[]): string {
  // A fight begins, and begins again straight after (a restart): the whole fly-over each time.
  const h = launch('arena', { seed: 5 });
  const game = h.ctx as GameContext;
  const me = game.player as Player;
  const fullOnes = () => h.find('message', INTRO_MSG).filter((c) => (c.args[0] as IntroMessage | undefined)?.full).length;
  h.run(0.2, { pilot: () => ({}) });
  const first = fullOnes();
  game.restart();
  h.run(1, { pilot: () => ({}) });
  game.restart();
  h.run(1, { pilot: () => ({}) });
  const sent = fullOnes() - first;
  if (sent !== 2) failed.push(`a fight's start (twice running) sent ${sent} fly-overs, not 2`);
  // A run ends: the vote goes up; carried on into the endless waves, it's stood down.
  const vote = (method: string) => h.find('hud', method).filter((c) => c.args[0] === 'arena-vote').length;
  bus.emit('runEnd', { won: true, wave: 20, endless: false, map: MAPS[0], time: 600, results: [] });
  h.run(2.5, { pilot: () => ({}) });
  const up = vote('widget') > 0;
  bus.emit('keepFighting', { player: me });
  h.run(0.5, { pilot: () => ({}) });
  const down = vote('widgetRemove') > 0;
  // Its endless waves end: the vote's up again.
  const before = vote('widget');
  bus.emit('runEnd', { won: false, wave: 23, endless: true, map: MAPS[0], time: 900, results: [] });
  h.run(2.5, { pilot: () => ({}) });
  const again = vote('widget') > before;
  if (!up) failed.push('the vote isn’t put up as a run ends');
  if (!down) failed.push('the vote stays up past keepFighting');
  if (!again) failed.push('the vote isn’t put up again as the endless run ends');
  const yes = (b: boolean) => (b ? 'yes' : 'NO');
  return `flow: a fly-over at each fight's start ${yes(sent === 2)}; vote up ${yes(up)}, down on keepFighting ${yes(down)}, up again after the endless waves ${yes(again)}`;
}

function probe(m: ArenaMap): { row: string; failed: string[] } {
  const h = launch('arena', { seed: 3 });
  const game = h.ctx as GameContext;
  const me = game.player as Player;
  if (map() !== m) game.commands.run(`/map ${m.id}`);
  h.run(0.5, { pilot: () => ({}) });
  check(map() === m, `on ${m.id}`);
  const failed: string[] = [];

  const places: [string, Vec3][] = [['the middle', m.center], ...(m.shop ? [['the shop', m.shop] as [string, Vec3]] : []), ...(m.chests ?? []).map((c, i) => [`chest ${i + 1}`, c] as [string, Vec3])];
  for (const [name, p] of [...places, ['the lookout', m.lookout] as [string, Vec3]]) {
    if (!game.world.fits({ x: p.x, y: p.y + 0.05, z: p.z })) failed.push(`${m.id}: no room for a body at ${name} (${fmt(p)})`);
  }
  if (m.shop) {
    const s = m.shop;
    for (const dx of [-1, 0, 1]) for (const dz of [-1, 0, 1]) if (!game.world.fits({ x: s.x + dx, y: s.y + 0.05, z: s.z + dz })) failed.push(`${m.id}: the shop's floor isn't clear 3 by 3 (at ${fmt({ x: s.x + dx, y: s.y, z: s.z + dz })})`);
  }
  for (const [name, p] of places.slice(1)) {
    const trap = (m.traps ?? []).find((t) => inTrap(t, p));
    if (trap) failed.push(`${m.id}: ${name} is in ${trap.id}'s way (${fmt(p)})`);
  }
  (m.bossGates ?? []).forEach((g, i) => {
    const why = bossRoom(game, g);
    if (why) failed.push(`${m.id}: boss gate ${i + 1} (${fmt(g.at)}): ${why}`);
  });
  const caught = stuck(game, me, m);
  for (const c of caught.spots) failed.push(`${m.id}: a fighter can get into ${c} and not back out`);
  const out = escapes(h, game, me, m, caught.columns, failed);

  // Spots round the floor too: out toward the edge, all round.
  const round = [0, 1, 2, 3, 4, 5].map((i) => {
    const a = (i / 6) * Math.PI * 2 + 0.4;
    const r = m.radius * 0.6;
    return [`floor ${i + 1}`, ground(game, { x: m.center.x + Math.cos(a) * r, y: m.center.y + 4, z: m.center.z + Math.sin(a) * r })] as [string, Vec3 | null];
  });
  const spots = [...places, ...round.filter((s): s is [string, Vec3] => s[1] !== null)];
  const gates = [...m.gates.map((g, i) => [`gate ${i + 1}`, along(g, 0)] as [string, Vec3]), ...(m.bossGates ?? []).map((g, i) => [`boss gate ${i + 1}`, along(g, 0)] as [string, Vec3])];

  let slowest = 0;
  let trips = 0;
  for (const [spot, at] of spots) {
    me.teleport({ x: at.x, y: at.y + 0.05, z: at.z }, 0, 0);
    me.protect(1e6);
    const mine = gates.map(([gate, g]) => ({ gate, e: game.entities.spawn('zombie', g) as Entity, reached: -1 }));
    const ours = new Set(mine.map((x) => x.e));
    const start = game.clock.now;
    h.run(LIMIT, {
      pilot: () => {
        for (const e of game.entities.all()) if (!ours.has(e)) e.remove();
        for (const x of mine) if (x.reached < 0 && x.e.alive && x.e.distanceTo(me) < REACH) x.reached = game.clock.now - start;
        return {};
      },
      until: () => mine.every((x) => x.reached >= 0 || !x.e.alive),
    });
    for (const x of mine) {
      if (x.reached >= 0) {
        slowest = Math.max(slowest, x.reached);
        trips++;
      } else failed.push(`${m.id}: from ${x.gate} to ${spot} (${fmt(at)}): stuck at ${fmt(x.e.position)}${x.e.alive ? '' : ' (dead)'}`);
      x.e.remove();
    }
  }
  const traps = (m.traps ?? []).map((t) => trap(h, game, me, t, failed));
  return {
    row: `${m.name}: ${trips} trips from ${gates.length} gates to ${spots.length} spots, the slowest ${slowest.toFixed(1)} s; ${caught.places} places to stand, ${caught.spots.length ? `${caught.spots.length} traps` : 'none a trap'};${out} traps ${traps.join(', ')}; ${failed.length} failed`,
    failed,
  };
}

/** Where a trap does its work: spots to hold zombies at. */
function targets(game: GameContext, t: TrapSpec): Vec3[] {
  const mid = (b: TrapSpec['zone'][number]) => ({ x: (b.min.x + b.max.x + 1) / 2, y: b.max.y + 3, z: (b.min.z + b.max.z + 1) / 2 });
  const raw: Vec3[] =
    t.kind === 'jets'
      ? t.jets.map((j) => ({ x: j.at.x + j.dir.x * j.length * 0.45, y: j.at.y + 1, z: j.at.z + j.dir.z * j.length * 0.45 }))
      : t.kind === 'pendulum'
        ? t.blades.map((b) => ({ x: b.pivot.x, y: b.pivot.y - b.length + 2, z: b.pivot.z }))
        : t.kind === 'bell'
          ? [0, 1, 2].map((i) => ({ x: t.bell.x + Math.cos(i * 2.1) * t.reach * 0.6, y: FLOOR + 3, z: t.bell.z + Math.sin(i * 2.1) * t.reach * 0.6 }))
          : t.kind === 'sluice'
            ? [t.channel[Math.floor(t.channel.length / 3)], t.channel[Math.floor((t.channel.length * 2) / 3)]].map((c) => ({ x: c.x + 0.5, y: c.y + 1.5, z: c.z + 0.5 }))
            : t.zone.map(mid);
  return raw.map((p) => ground(game, p)).filter((p): p is Vec3 => p !== null);
}

/**
 * A trap, end to end: gold in hand, up to its lever, E; zombies held where it works must be hurt
 * by it (credited to whoever pulled it) and, mostly, slain. Its row: hits and kills.
 */
function trap(h: ReturnType<typeof launch>, game: GameContext, me: Player, t: TrapSpec, failed: string[]): string {
  const where = targets(game, t);
  if (!where.length) {
    failed.push(`${t.id}: nowhere to stand in it`);
    return `${t.id} ?`;
  }
  // Stand at the lever's front, looking at it.
  const front = { x: Math.sin(t.lever.face), z: Math.cos(t.lever.face) };
  const stand = ground(game, { x: t.lever.at.x + front.x * 1.3, y: t.lever.at.y + 2, z: t.lever.at.z + front.z * 1.3 }) ?? t.lever.at;
  const eye = { x: stand.x, y: stand.y + 1.62, z: stand.z };
  const aim = { x: t.lever.at.x - eye.x, y: t.lever.at.y + 0.9 - eye.y, z: t.lever.at.z - eye.z };
  const yaw = Math.atan2(-aim.x, -aim.z);
  const pitch = Math.atan2(aim.y, Math.hypot(aim.x, aim.z));
  me.teleport(stand, yaw, pitch);
  me.protect(1e6);
  addGold(game, me, t.price + 50 - gold(me));
  const held = where.flatMap((p) => [0, 1].map((k) => game.entities.spawn('zombie', { x: p.x + (k ? 0.3 : -0.3), y: p.y + 0.05, z: p.z })));
  for (const e of held) e.setSpeed(0);
  const ours = new Set(held);
  let hits = 0;
  let kills = 0;
  let wrong = 0;
  const off = game.events.on('damage', (d) => {
    if (d.weapon !== 'trap' || d.target.kind !== 'entity' || !ours.has(d.target)) return;
    if (d.source === me) hits++;
    else wrong++;
  });
  bus.on('slain', ({ entity, by, weapon }) => {
    if (ours.has(entity) && weapon === 'trap' && by === me) kills++;
  });
  // (Its kills may drop coins too: the price is looked for as a payment of its own.)
  let paid = false;
  bus.on('gold', ({ player, delta }) => {
    if (player === me && delta === -t.price && !paid) paid = true;
  });
  let pressed = false;
  h.run(t.time + 2, {
    pilot: () => {
      for (const e of game.entities.all()) if (!ours.has(e)) e.remove();
      for (const e of held) if (e.alive) e.setSpeed(0);
      if (pressed) return { yaw, pitch };
      pressed = true;
      return { yaw, pitch, pressed: ['KeyE'] };
    },
  });
  off();
  for (const e of held) e.remove();
  if (!paid) failed.push(`${t.id}: the lever didn't take ${t.price} gold`);
  if (!hits) failed.push(`${t.id}: hurt nothing held in it (${where.map(fmt).join('; ')})`);
  if (wrong) failed.push(`${t.id}: ${wrong} hits not credited to the puller`);
  return `${t.id.split('.')[1]} ${hits}/${kills}`;
}

/** How long a fighter dropped in a hazard's pool may take to be out on dry ground. */
const ESCAPE = 2;

/**
 * Every column of each hazard at floor level a body fits in and a fighter can get to from the
 * middle (the Forge's lava river, pockets, pools; the Sanctum's frozen pool): one dropped onto
 * its bottom, walking (W, nothing else)
 * toward the nearest bank, must be out of it and on the ground within `ESCAPE` seconds; and one
 * afloat at its surface must count as in it (it burns, and throws them out). Its part
 * of the row: how many drops, and the slowest out.
 */
function escapes(h: ReturnType<typeof launch>, game: GameContext, me: Player, m: ArenaMap, reach: Set<string>, failed: string[]): string {
  if (!m.hazards?.length) return '';
  // (Its burns don't land: hundreds of drops would add up. It throws them out all the same.)
  if (!me.alive) me.revive();
  const off = game.events.on('damage', (d) => d.target === me && d.cancel());
  let drops = 0;
  let slowest = 0;
  for (const hz of m.hazards) {
    const cells = new Map<string, Vec3>();
    for (const b of hz.zone)
      for (let x = b.min.x; x <= b.max.x; x++)
        for (let z = b.min.z; z <= b.max.z; z++) {
          // Its bottom, at floor level, with room for a body and something under it.
          if (!reach.has(`${x},${z}`)) continue;
          for (let y = Math.max(b.min.y, FLOOR - 3); y <= Math.min(b.max.y, FLOOR); y++) {
            const at = { x: x + 0.5, y, z: z + 0.5 };
            if (game.world.fits(at) && !game.world.fits({ ...at, y: y - 1 })) {
              cells.set(`${x},${z}`, at);
              break;
            }
          }
        }
    for (const at of cells.values()) {
      // Afloat at its surface (feet a little over the top of it) is in it too: it burns there.
      const run = hz.zone.find((b) => Math.floor(at.x) >= b.min.x && Math.floor(at.x) <= b.max.x && Math.floor(at.z) >= b.min.z && Math.floor(at.z) <= b.max.z && b.min.y <= at.y && b.max.y >= at.y);
      if (run && !inHazard(hz.zone, { ...at, y: run.max.y + 1.1 })) failed.push(`${m.id}: afloat on the ${hz.kind} at ${fmt(at)} isn't in it`);
      const bank = bankFrom(game, hz.zone, at);
      if (!bank) {
        failed.push(`${m.id}: no bank near the ${hz.kind} at ${fmt(at)}`);
        continue;
      }
      // Mid-fight (the hazards burn only then), whatever the waves have got to with nobody to fight.
      if (!inFight()) game.commands.run('/wave 1');
      me.freeze(false);
      me.teleport({ x: at.x, y: at.y + 0.05, z: at.z }, Math.atan2(-(bank.x - at.x), -(bank.z - at.z)), 0);
      let t = 0;
      let outAt = -1;
      h.run(ESCAPE + 0.5, {
        pilot: () => {
          for (const e of game.entities.all()) e.remove();
          t += 1 / 60;
          const p = me.position;
          // Out: on the ground (or held still by the run, over it) and not in it.
          if (outAt < 0 && (me.onGround || me.frozen) && !inHazard(hz.zone, p)) outAt = t;
          // While in it, toward the nearest bank from where they are now; out of it, still.
          if (!inHazard(hz.zone, p)) return {};
          const to = bankFrom(game, hz.zone, p) ?? bank;
          const yaw = Math.atan2(-(to.x - p.x), -(to.z - p.z));
          return { yaw, pitch: 0, down: ['KeyW'] };
        },
        until: () => outAt >= 0,
      });
      drops++;
      if (outAt < 0 || outAt > ESCAPE) failed.push(`${m.id}: dropped in the ${hz.kind} at ${fmt(at)}, ${outAt < 0 ? `still in it after ${ESCAPE + 0.5} s (at ${fmt(me.position)})` : `out only after ${outAt.toFixed(1)} s`}`);
      else slowest = Math.max(slowest, outAt);
    }
  }
  off();
  return ` ${drops} drops into its hazards, all out within ${slowest.toFixed(1)} s;`;
}

/** How high a fighter climbs onto something (a jump reaches about 1.27 blocks: a block, not a fence), and how far round the middle they're followed. */
const CLIMB = 1.2;
const SWEEP = 46;

/**
 * Everywhere a fighter can stand (the floor of a column, a ledge, a step; a liquid's surface,
 * swimming) round the map's middle, and how they move between them: onto a neighbour as high as
 * a jump reaches (room for the body over them to jump), off a ledge any way down (landing on the
 * highest thing under it). From the middle, everywhere they can get to; then whether each of those
 * has a way back to it. A place with no way back is a trap, unless it's in one of the map's
 * hazards (they burn there, and are back next wave). Returns how many places they can get to, the
 * traps (a patch of them as one line), and the columns they can get to.
 */
function stuck(game: GameContext, me: Player, m: ArenaMap): { places: number; spots: string[]; columns: Set<string> } {
  // The ground round the middle generated first.
  me.teleport({ x: m.center.x, y: m.center.y + 0.05, z: m.center.z }, 0, 0);
  const w = game.world;
  const liquid = (x: number, y: number, z: number) => !!w.blockInfo(w.getBlock(x, y, z))?.liquid;
  const fits = (x: number, y: number, z: number) => w.fits({ x: x + 0.5, y, z: z + 0.5 });
  type Node = { x: number; z: number; s: number; i: number };
  const cols = new Map<string, Node[]>();
  const nodes: Node[] = [];
  const cx = Math.floor(m.center.x);
  const cz = Math.floor(m.center.z);
  for (let x = cx - SWEEP; x <= cx + SWEEP; x++)
    for (let z = cz - SWEEP; z <= cz + SWEEP; z++) {
      const list: Node[] = [];
      for (let y = FLOOR - 4; y <= FLOOR + 30; y++) {
        const h = w.collisionHeight(x, y, z);
        let s = -1;
        if (h > 0 && !liquid(x, y, z) && fits(x, y + h, z)) s = y + h;
        else if (liquid(x, y, z) && !liquid(x, y + 1, z) && fits(x, y + 0.6, z)) s = y + 0.6;
        if (s < 0 || list.some((n) => Math.abs(n.s - s) < 0.3)) continue;
        const n = { x, z, s, i: nodes.length };
        nodes.push(n);
        list.push(n);
      }
      cols.set(`${x},${z}`, list);
    }
  const moves = (a: Node): Node[] => {
    const out: Node[] = [];
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const list = cols.get(`${a.x + dx},${a.z + dz}`);
      if (!list) continue;
      for (const b of list) {
        if (b.s > a.s + CLIMB || b.s < a.s - 0.6) continue;
        // Up a step or a jump: room over us at that height.
        if (b.s <= a.s + 0.6 || fits(a.x, b.s, a.z)) out.push(b);
      }
      // Off the edge at our own height (nothing there to walk onto), down onto the highest thing under it.
      if (fits(a.x + dx, a.s, a.z + dz)) {
        const under = list.filter((b) => b.s <= a.s + 0.6).sort((p, q) => q.s - p.s)[0];
        if (under && under.s < a.s - 0.6) out.push(under);
      }
    }
    return out;
  };
  const edges = nodes.map(moves);
  const back: number[][] = nodes.map(() => []);
  edges.forEach((list, i) => list.forEach((b) => back[b.i].push(i)));
  const start = [...(cols.get(`${cx},${cz}`) ?? [])].sort((p, q) => Math.abs(p.s - m.center.y) - Math.abs(q.s - m.center.y))[0];
  if (!start) return { places: 0, spots: ['the middle (no floor there)'], columns: new Set() };
  const search = (from: number, next: (i: number) => number[]) => {
    const seen = new Uint8Array(nodes.length);
    const queue = [from];
    seen[from] = 1;
    while (queue.length) for (const j of next(queue.pop()!)) if (!seen[j]) (seen[j] = 1), queue.push(j);
    return seen;
  };
  const there = search(start.i, (i) => edges[i].map((b) => b.i));
  const home = search(start.i, (i) => back[i]);
  // (As `maps/hazards.ts` judges it: the body's feet a little up.)
  const burns = (n: Node) => (m.hazards ?? []).some((h) => h.zone.some((b) => inBox(b, { x: n.x + 0.5, y: n.s + 0.3, z: n.z + 0.5 })));
  const caught = nodes.filter((n) => there[n.i] && !home[n.i] && !burns(n));
  const spots: string[] = [];
  const done = new Set<number>();
  for (const n of caught) {
    if (done.has(n.i)) continue;
    const patch = caught.filter((o) => Math.abs(o.x - n.x) <= 6 && Math.abs(o.z - n.z) <= 6);
    for (const o of patch) done.add(o.i);
    spots.push(`${patch.length} spot${patch.length === 1 ? '' : 's'} round (${n.x - m.origin.x + 0.5}, ${n.s.toFixed(1)}, ${n.z - m.origin.z + 0.5}) from its origin`);
  }
  const columns = new Set(nodes.filter((n) => there[n.i]).map((n) => `${n.x},${n.z}`));
  return { places: nodes.filter((n) => there[n.i]).length, spots, columns };
}

/** Whether a spot's where a trap does its work (its zone, a jet's flames, a blade's swing, the bell's blast, the sluice). */
function inTrap(t: TrapSpec, p: Vec3): boolean {
  const near = (q: Vec3, r: number) => Math.hypot(p.x - q.x, p.z - q.z) < r;
  if (t.zone.some((b) => inBox(b, { x: p.x, y: b.min.y, z: p.z }, 1))) return true;
  if (t.kind === 'jets')
    return t.jets.some((j) => {
      const u = (p.x - j.at.x) * j.dir.x + (p.z - j.at.z) * j.dir.z;
      const across = Math.abs(-(p.x - j.at.x) * j.dir.z + (p.z - j.at.z) * j.dir.x);
      return u > -1 && u < j.length + 1 && across < 2.5;
    });
  if (t.kind === 'pendulum') return t.blades.some((b) => near(b.pivot, b.length * 0.8 + 1.5));
  if (t.kind === 'bell') return near(t.bell, t.reach);
  if (t.kind === 'sluice') return t.channel.some((c) => near({ x: c.x + 0.5, y: c.y, z: c.z + 0.5 }, 1.5));
  return false;
}

/** What's wrong with a boss gate as somewhere a big boss comes in (null: nothing). */
function bossRoom(game: GameContext, g: Gate): string | null {
  const solid = (x: number, y: number, z: number) => !!game.world.blockInfo(game.world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z)))?.solid;
  const { x, z } = g.at;
  const y = Math.floor(g.at.y);
  if (!solid(x, y - 1, z)) return 'no floor under it';
  for (let dx = -3; dx <= 3; dx++)
    for (let dz = -3; dz <= 3; dz++) {
      if (Math.hypot(dx, dz) > 3.2) continue;
      for (let k = 0; k < 9; k++) if (solid(x + dx, y + k, z + dz)) return `something in its way ${k} up at ${fmt({ x: x + dx, y: y + k, z: z + dz })}`;
    }
  const f = { x: -Math.sin(g.yaw), z: -Math.cos(g.yaw) };
  for (let d = 3; d <= 12; d++)
    for (const s of [-1, 0, 1]) {
      const cx = x + f.x * d - f.z * s;
      const cz = z + f.z * d + f.x * s;
      // Open floor within a step of the gate's, three blocks of air over it.
      const floor = [0, -1, 1, -2].map((dy) => y + dy).find((fy) => solid(cx, fy - 1, cz) && !solid(cx, fy, cz) && !solid(cx, fy + 1, cz) && !solid(cx, fy + 2, cz));
      if (floor === undefined) return `the floor in front isn't open ${d} blocks out (${fmt({ x: cx, y, z: cz })})`;
    }
  return null;
}

/** The floor under a point (feet), or null where there's none within a few blocks. */
function ground(game: GameContext, p: Vec3): Vec3 | null {
  for (let y = Math.floor(p.y); y > p.y - 10; y--) {
    const at = { x: p.x, y, z: p.z };
    if (game.world.fits(at) && !game.world.fits({ x: p.x, y: y - 1, z: p.z })) return at;
  }
  return null;
}

const fmt = (p: Vec3) => `${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}`;
