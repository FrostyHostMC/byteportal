import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GameHost } from '../../src/platform/host/game';
import { SqliteStore } from '../../src/platform/host/sqlite';
import { check, games } from './_harness';

const wasm = readFileSync('engine/pkg/voxel_engine_bg.wasm');
const game = (id: string) => games.find((g) => g.id === id)!;

/**
 * Kept across restarts, in SQLite: a Sandbox server's world (seed, builds, time of day), each
 * signed-in player's place, and the game's own data; Bed Wars' all-time stats per player; a
 * player's own data (`player.store`) for their account, what was kept under their name adopted once.
 */
export default function store() {
  const dir = mkdtempSync(join(tmpdir(), 'voxel-store-'));
  try {
    sandbox(join(dir, 'sandbox.sqlite'));
    bedwars(join(dir, 'bedwars.sqlite'));
    playerData(join(dir, 'heart-hunt.sqlite'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function sandbox(path: string) {
  // First run: Ann builds a little tower, flies up beside it and leaves; the game notes a visit.
  let db = SqliteStore.open(path, 'sandbox');
  let host = new GameHost(game('sandbox'), { engine: wasm, seed: 777, remote: true, radius: 3, budget: Infinity, store: db });
  // Signed in: where she leaves off is kept for her account (a guest's isn't).
  const account = { account: { id: 'ann', name: 'Ann', avatar: null } };
  let ann = host.connect('Ann', account);
  host.command(ann.id, { t: 'start' });
  for (let i = 0; i < 5; i++) host.step(1 / 30);
  const p = host.sim.players[0];
  const x = Math.floor(p.state.x) + 3;
  const z = Math.floor(p.state.z) + 3;
  const top = host.sim.surfaceY(x, z);
  for (let y = top + 1; y <= top + 4; y++) check(host.sim.placeBlockAt(x, y, z, 'glowstone', p.api), `placing at ${y}`);
  host.sim.env.time = 0.8;
  p.allowFlight = true;
  host.world.world.set_flying(p.slot, true);
  p.api.teleport({ x: x + 1.5, y: top + 6, z: z + 0.5 }, 1.25, -0.4);
  host.step(1 / 30);
  host.sim.ctx.store.set('visits', { Ann: 1 });
  const where = { x: p.state.x, y: p.state.y, z: p.state.z };
  host.disconnect(ann.id);
  host.persist();
  db.close();

  // A new server on the same database: the same world, and Ann where she was.
  db = SqliteStore.open(path, 'sandbox');
  const kept = db.world();
  check(kept?.seed === 777 && kept.edits !== null, `the world is kept: ${JSON.stringify({ seed: kept?.seed, edits: kept?.edits?.length })}`);
  host = new GameHost(game('sandbox'), { engine: wasm, seed: kept!.seed, remote: true, radius: 3, budget: Infinity, store: db });
  ann = host.connect('Ann', account);
  const w = host.sim.ctx.world;
  const tower = [1, 2, 3, 4].map((dy) => w.blockName(w.getBlock(x, top + dy, z)));
  check(tower.every((b) => b === 'glowstone'), `the tower is back: ${tower}`);
  const q = host.sim.players[0];
  check(Math.hypot(q.state.x - where.x, q.state.y - where.y, q.state.z - where.z) < 0.01 && Math.abs(q.yaw - 1.25) < 1e-9, `Ann is where she left: ${q.state.x},${q.state.y},${q.state.z} yaw ${q.yaw}`);
  check(Math.abs(host.sim.env.time - 0.8) < 0.01, `time of day kept: ${host.sim.env.time}`);
  check((host.sim.ctx.store.get<{ Ann: number }>('visits')?.Ann ?? 0) === 1, 'game.store kept');
  // Someone new starts at the spawn; so does a guest calling themself Ann.
  host.connect('Bob');
  const bob = host.sim.players[1];
  check(Math.hypot(bob.state.x - q.state.x, bob.state.z - q.state.z) > 1, 'Bob starts at the spawn');
  host.disconnect(ann.id);
  host.connect('Ann');
  const guest = host.sim.players.find((p) => p.name === 'Ann' && !p.account)!;
  check(Math.hypot(guest.state.x - where.x, guest.state.z - where.z) > 1, `a guest named Ann doesn't get her place: ${guest.state.x},${guest.state.z}`);
  db.close();

  // A database belongs to its game.
  let wrong = '';
  try {
    SqliteStore.open(path, 'bedwars');
  } catch (err) {
    wrong = (err as Error).message;
  }
  check(wrong.includes('holds a sandbox world'), `opening it for another game fails: ${wrong}`);
  console.log(`  sandbox: seed, a 4-block tower, time of day, Ann's place and game data survived a restart`);
}

function bedwars(path: string) {
  let db = SqliteStore.open(path, 'bedwars');
  const run = () => {
    const host = new GameHost(game('bedwars'), { engine: wasm, seed: 1, remote: true, radius: 4, budget: Infinity, cheats: true, store: db });
    const ann = host.connect('Ann', { account: { id: 'ann', name: 'Ann', avatar: null } });
    host.command(ann.id, { t: 'start' });
    for (let i = 0; i < 5; i++) host.step(1 / 30);
    // Out of the lobby, into a match, and won.
    host.command(ann.id, { t: 'exec', id: 1, line: 'bw start' });
    for (let i = 0; i < 5; i++) host.step(1 / 30);
    host.command(ann.id, { t: 'exec', id: 2, line: 'bw win' });
    for (let i = 0; i < 70; i++) host.step(1 / 30);
    host.persist();
  };
  run();
  db.close();
  db = SqliteStore.open(path, 'bedwars');
  run();
  const stats = db.data().get('$player:ann:stats') as { games: number; wins: number } | undefined;
  check(stats?.games === 2 && stats.wins === 2, `Ann's all-time stats across two servers: ${JSON.stringify(stats)}`);
  db.close();
  console.log(`  bedwars: all-time stats per player kept (${JSON.stringify(stats)})`);
}

function playerData(path: string) {
  // Before accounts, the game kept Ann's XP under her name.
  let db = SqliteStore.open(path, 'heart-hunt');
  db.data().set('xp:Ann', 40);
  db.put('xp:Ann', 40);
  db.flush();
  const ann = { account: { id: 'ann1', name: 'Ann', avatar: null } };
  const open = () => new GameHost(game('heart-hunt'), { engine: wasm, seed: 1, remote: true, radius: 3, budget: Infinity, store: db });
  const join = (host: GameHost, name: string, who?: typeof ann) => {
    const c = host.connect(undefined, who);
    host.command(c.id, { t: 'start', name });
    return { id: c.id, p: host.sim.players.find((x) => !x.vacant && x.name === (who?.account.name ?? name))! };
  };

  let host = open();
  const a = join(host, 'Whoever', ann);
  check(a.p.name === 'Ann' && a.p.api.account?.id === 'ann1', `signed in, she plays as her account's name: ${a.p.name}`);
  check(a.p.api.adopted === 'Ann', `her first visit: what was kept as Ann is hers (${a.p.api.adopted})`);
  // (What the game does with it.)
  const store = host.sim.ctx.store;
  a.p.api.store.set('xp', store.get<number>(`xp:${a.p.api.adopted}`));
  store.delete('xp:Ann');
  a.p.api.store.set('outfit', 3);
  check(store.keys().every((k) => !k.startsWith('$')), `game.store lists nobody's own data: ${store.keys()}`);
  const g = join(host, 'Gus');
  check(g.p.api.account === null && g.p.api.adopted === null, 'a guest has no account');
  g.p.api.store.set('xp', 5);
  check(g.p.api.store.get('xp') === 5, "a guest's own data while they're here");
  host.disconnect(a.id);
  host.disconnect(g.id);
  host.persist();
  host.dispose();
  db.close();

  // Another server on the same database.
  db = SqliteStore.open(path, 'heart-hunt');
  host = open();
  const a2 = join(host, 'Ann', ann);
  check(a2.p.api.adopted === null, 'adopting is once');
  check(a2.p.api.store.get('xp') === 40 && a2.p.api.store.get('outfit') === 3, `her own data is back: ${a2.p.api.store.keys()}`);
  const g2 = join(host, 'Gus');
  check(g2.p.api.store.get('xp') === undefined, "a guest's is gone with them");
  host.dispose();
  db.close();
  console.log(`  player.store: kept for the account across servers, a guest's for the visit; the name's old data adopted once; game.store lists none of it`);
}
