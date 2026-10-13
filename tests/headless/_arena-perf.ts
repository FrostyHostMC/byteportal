import { readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import type { Entity, GameContext } from '@platform';
import { RoomCore } from '../../src/platform/host/room';
import type { PlayerInput } from '../../src/platform/net/protocol';
import { burn, chill, stagger } from '../../src/games/arena/items/status';
import { makeElite, type Affix } from '../../src/games/arena/monsters/elites';
import { spawnMonster } from '../../src/games/arena/run/spawn';
import { map, state } from '../../src/games/arena/run/state';
import { games } from './_harness';

/**
 * Probe: what an Arena room costs a tick on a server, with a full, hard wave. The room runs as a
 * server runs it (`RoomCore`, 30 ticks a second: the sim, frames, patches, encoding), FIGHTERS
 * fighters with a fire staff, a frost staff and a storm wand shooting at the nearest monster, and
 * the wave kept full (14 alive: knights, wraiths, slimes splitting, a flock of bats, a cultist, a
 * golem, a minotaur, imps, a necromancer raising the dead, elites of every affix), the monsters
 * burned, chilled and staggered now and then besides. It prints the tick's cost (mean, p50, p95,
 * p99, worst) and what's sent: presentation calls a second by kind, and bytes.
 * `SECONDS=60 WARM=10 FIGHTERS=3 node scripts/headless.mjs tests/headless/_arena-perf.ts`
 * (add `node --cpu-prof` to find the hot spots).
 */
const HEAVY = ['knight', 'knight', 'wraith', 'wraith', 'slime', 'bat', 'cultist', 'golem', 'minotaur', 'imp', 'imp', 'necromancer', 'skeleton', 'zombie', 'spider', 'sapper'];
/** `MIX=old`: the first Arena's monsters alone, to compare. */
const OLD = ['zombie', 'zombie', 'skeleton', 'skeleton', 'spider', 'spider', 'sapper', 'necromancer', 'brute', 'zombie', 'skeleton', 'zombie'];
const MIX = process.env.MIX === 'old' ? OLD : HEAVY;
const AFFIXES: Affix[] = ['fiery', 'frozen', 'vampiric', 'shielded', 'hasted', 'explosive', 'splitting', 'juggernaut'];
const ALIVE = 14;
const WEAPONS = ['fire_staff', 'frost_staff', 'storm_wand'];

export default function arenaPerf() {
  const def = games.find((g) => g.id === 'arena')!;
  const fighters = Number(process.env.FIGHTERS ?? 3);
  const seconds = Number(process.env.SECONDS ?? 60);
  const warm = Number(process.env.WARM ?? 10) * 30;
  let bytes = 0;
  let packed = 0;
  let deflateMs = 0;
  const core = new RoomCore(def, { game: def.id, instance: 'public', tickRate: 30, cheats: true, dev: false, saveEvery: 1e9 }, readFileSync('engine/pkg/voxel_engine_bg.wasm'), undefined, {
    send: (_c, text) => {
      bytes += text.length;
      const t0 = performance.now();
      packed += deflateRawSync(text, { level: 3, memLevel: 7, windowBits: 13 }).length;
      deflateMs += performance.now() - t0;
    },
    counts: () => {},
    log: (m) => (m.startsWith('error') ? console.log(m) : undefined),
  });
  const c = core as unknown as { timer: ReturnType<typeof setInterval>; step(dt: number): void };
  clearInterval(c.timer);
  const host = core.host;
  const sim = host.sim as unknown as { ctx: GameContext; players: { api: { id: string }; viewSeq: number }[]; presentation: { send: (...a: unknown[]) => void; message: (...a: unknown[]) => void } };
  const game = sim.ctx;

  // Every presentation call counted by kind (fx.burst, audio.play, hud.marker, a message's name).
  const calls = new Map<string, number>();
  const count = (k: string) => calls.set(k, (calls.get(k) ?? 0) + 1);
  const pres = sim.presentation;
  const send = pres.send.bind(pres);
  // WHO=1: effects and sounds by where in the game they came from (the first game frame on the stack).
  const who = !!process.env.WHO;
  pres.send = (...a: unknown[]) => {
    const kind = `${a[1]}.${a[2]}`;
    count(kind);
    if (who && (a[1] === 'fx' || a[1] === 'audio')) {
      const at = new Error().stack?.split('\n').find((l) => l.includes('/src/games/') || l.includes('/sim/entities.ts'));
      count(`  ${kind} ← ${at?.replace(/.*\/(src\/[^:]+:\d+).*/, '$1') ?? '?'}`);
    }
    return send(...a);
  };
  const message = pres.message.bind(pres);
  pres.message = (...a: unknown[]) => {
    count(`message ${String(a[1]).replace(/^bestiary\.(.*)$/, 'bestiary.$1')}`);
    return message(...a);
  };

  // REPLAY=0: the server keeps no replay history (the Arena shows none).
  if (process.env.REPLAY === '0') game.replay.keep(0);
  const ids = Array.from({ length: fighters }, (_, i) => `f${i}`);
  for (const id of ids) {
    core.connect(id);
    core.command(id, { t: 'start', name: id });
  }
  const seq = new Map<string, number>();
  const input = (o: Partial<PlayerInput> = {}): PlayerInput => ({ active: true, down: [], pressed: [], buttons: 0, clicked: 0, mouseX: 0, mouseY: 0, wheel: 0, yaw: 0, pitch: 0, viewSeq: -1, ...o });
  let armed = false;
  let rng = 7;
  const rand = () => ((rng = (rng * 16807) % 2147483647) / 2147483647);
  let mixAt = 0;
  let affixAt = 0;

  /** Keep the wave full: the director's queue emptied, our mix brought in at the gates, a third as elites. */
  function fill() {
    state.queue = [];
    let alive = game.entities.count();
    const gates = map().gates;
    while (alive < ALIVE) {
      const type = MIX[mixAt++ % MIX.length];
      const g = gates[Math.floor(rand() * gates.length)].at;
      const e = spawnMonster(game, type, { x: g.x + rand() * 2 - 1, y: g.y + 0.05, z: g.z + rand() * 2 - 1 });
      if (!e.data.elite && process.env.MIX !== 'old' && rand() < 0.35) makeElite(game, e, AFFIXES[affixAt++ % AFFIXES.length]);
      alive = game.entities.count();
    }
  }

  // The step's parts, timed: the bodies' physics and path-finding (wasm), the replay history.
  const parts = new Map<string, number[]>();
  const timed = (name: string, obj: Record<string, unknown>, fn: string) => {
    const f = (obj[fn] as (...a: unknown[]) => unknown).bind(obj);
    let acc = 0;
    obj[fn] = (...a: unknown[]) => {
      const t0 = performance.now();
      const r = f(...a);
      acc += performance.now() - t0;
      return r;
    };
    parts.set(name, []);
    return () => {
      parts.get(name)!.push(acc);
      acc = 0;
    };
  };
  const ents = (host.sim as unknown as { entities: { s: { world: Record<string, unknown> }; update: unknown } }).entities;
  const flushes = [
    timed('bodies (wasm)', ents.s.world, 'step_entities'),
    timed('entities (AI + bodies)', ents as unknown as Record<string, unknown>, 'update'),
    timed('replay history', (host as unknown as { replays: { history: Record<string, unknown> } }).replays.history, 'record'),
  ];
  const times: number[] = [];
  let hostMs = 0;
  const step = host.step.bind(host);
  host.step = (dt: number, running?: boolean) => {
    const t0 = performance.now();
    const r = step(dt, running);
    hostMs += performance.now() - t0;
    return r;
  };
  for (let i = -warm - 150; i < seconds * 30; i++) {
    if (i === 0) {
      hostMs = deflateMs = bytes = packed = 0;
      calls.clear();
    }
    const players = game.players;
    // Fighting from the first wave on: tough, armed with magic, the wave kept full.
    if (state.phase === 'fighting') {
      if (!armed) {
        armed = true;
        players.forEach((p, k) => {
          p.maxHealth = 1e6;
          p.health = 1e6;
          p.inventory.give(WEAPONS[k % WEAPONS.length]);
          p.inventory.select(p.inventory.slots.findIndex((s) => s?.item === WEAPONS[k % WEAPONS.length]));
        });
      }
      fill();
      for (const p of players) p.health = p.maxHealth;
      // Statuses besides the staffs': a burn, frost, a stagger on someone now and then.
      if (i % 10 === 0) {
        const all = game.entities.all();
        const e = all[Math.floor(rand() * all.length)] as Entity | undefined;
        if (e) {
          const k = i % 30;
          if (k === 0) burn(game, e, players[0] ?? null, 2, 3);
          else if (k === 10) chill(game, e, 2);
          else stagger(game, e, 0.8);
        }
      }
    }
    // Each fighter turns to the nearest monster and shoots now and then.
    ids.forEach((id, k) => {
      const p = sim.players.find((q) => q.api.id === players[k]?.id);
      const me = players[k];
      let yaw = 0;
      let pitch = 0;
      if (me) {
        let best: Entity | null = null;
        let bd = Infinity;
        for (const e of game.entities.all()) {
          const d = e.distanceTo(me);
          if (d < bd) (bd = d), (best = e);
        }
        if (best) {
          const q = best.position;
          const eye = me.eye;
          yaw = Math.atan2(-(q.x - eye.x), -(q.z - eye.z));
          pitch = Math.atan2(q.y + 1 - eye.y, Math.hypot(q.x - eye.x, q.z - eye.z));
        }
      }
      for (let j = 0; j < 2; j++) {
        const n = (seq.get(id) ?? 0) + 1;
        seq.set(id, n);
        core.command(id, { t: 'input', input: input({ yaw, pitch, viewSeq: p?.viewSeq ?? -1, buttons: (i + k * 7) % 20 < 4 ? 1 : 0, down: (i + k * 50) % 150 < 30 ? ['KeyW'] : [] }), seq: n, dt: 1 / 60 });
      }
    });
    const d0 = deflateMs;
    const t0 = performance.now();
    c.step(1 / 30);
    const ms = performance.now() - t0 - (deflateMs - d0);
    for (const f of flushes) f();
    if (i >= 0) times.push(ms);
    else for (const v of parts.values()) v.length = 0;
  }
  const sorted = [...times].sort((a, b) => a - b);
  const pct = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))].toFixed(2);
  const mean = times.reduce((a, b) => a + b, 0) / times.length;
  console.log(`  arena (${process.env.MIX === 'old' ? 'the old monsters' : 'the heavy mix'}${process.env.REPLAY === '0' ? ', no replay history' : ''}), ${fighters} fighters, ${ALIVE} alive, ${seconds} s at 30 Hz: tick mean ${mean.toFixed(2)} ms (host ${(hostMs / times.length).toFixed(2)}), p50 ${pct(0.5)}, p95 ${pct(0.95)}, p99 ${pct(0.99)}, worst ${sorted.at(-1)!.toFixed(1)}; deflate ${(deflateMs / times.length).toFixed(2)} ms a tick; ${(bytes / seconds / 1024).toFixed(0)} KB/s to all ${fighters} screens (${(packed / seconds / 1024 / fighters).toFixed(1)} KB/s a screen compressed)`);
  for (const [name, v] of parts) {
    const o = [...v].sort((a, b) => a - b);
    console.log(`  ${name}: mean ${(v.reduce((a, b) => a + b, 0) / v.length).toFixed(2)} ms, p95 ${o[Math.floor(0.95 * o.length)].toFixed(2)}, worst ${o.at(-1)!.toFixed(1)}`);
  }
  const rows = [...calls].filter(([k]) => !k.startsWith(' ')).sort((a, b) => b[1] - a[1]);
  const total = rows.reduce((a, [, n]) => a + n, 0);
  console.log(`  presentation: ${(total / seconds).toFixed(0)} calls a second; ${rows.slice(0, 18).map(([k, n]) => `${k} ${(n / seconds).toFixed(1)}`).join(', ')}`);
  if (who) console.log([...calls].filter(([k]) => k.startsWith(' ')).sort((a, b) => b[1] - a[1]).slice(0, 30).map(([k, n]) => `${k} ${(n / seconds).toFixed(1)}/s`).join('\n'));
  console.log(`  at the end: ${game.entities.count()} alive (${[...new Set(game.entities.all().map((e) => e.type))].join(' ')}), wave ${state.wave}, ${state.kills} slain`);
  core.stop();
}
