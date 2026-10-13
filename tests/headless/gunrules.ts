import { readFileSync } from 'node:fs';
import { defineGame, Models, type DamageEvent, type GameDefinition, type HitscanOptions } from '../../src/platform';
import { GameHost } from '../../src/platform/host/game';
import type { PlayerInput } from '../../src/platform/net/protocol';
import { assistOf, gun, gunMove, resolveGunRules, type GunOptions } from '../../src/platform/items';
import { guns as gunKit, melee } from '../../src/platform/kits';
import { resolveHitscan } from '../../src/platform/sim/hitboxes';
import { check } from './_harness';

const wasm = readFileSync('engine/pkg/voxel_engine_bg.wasm');

/** The rules a test plays under: the gun kit's, and where bullets meet players (`hitscan`). */
type Rules = GunOptions & HitscanOptions;

/** A flat field and a gun with no spread (like `guns.ts`), under the given rules. */
const range = (rules?: Rules): GameDefinition => {
  const { rewind, hitboxes, ...guns } = rules ?? {};
  return defineGame({
    id: 'range',
    title: 'Range',
    world: { terrain: 'flat', flatHeight: 64, spawn: { x: 0.5, y: 65, z: 0.5 }, time: 0.5, freezeTime: true },
    player: { health: 100, hurtCooldown: 0, pvp: true, hotbar: 'items' },
    hitscan: { rewind, hitboxes },
    items: [gunKit(guns), melee()],
    setup(game) {
      game.items.define('rifle', {
        kind: 'gun',
        name: 'Rifle',
        icon: 'iron_sword',
        rpm: 600,
        auto: true,
        damage: 10,
        headshot: 2,
        magazine: 30,
        reload: 1,
        spread: { hip: 0, aim: 0, move: 0, air: 0, bloom: 0 },
        recoil: { up: 0, side: 0 },
        aim: { assist: { strength: 0.3, follow: { hip: 0.5 } } },
      });
      game.items.define('sword', { kind: 'melee', name: 'Sword', icon: 'iron_sword', damage: 6, cooldown: 0.3, reach: 4 });
      game.entities.define('dummy', { name: 'Dummy', model: Models.humanoid({ skin: [0, 0] }), hitbox: { width: 0.6, height: 1.8 }, health: 40, speed: 0 });
    },
  });
};

const idle = (viewSeq: number): PlayerInput => ({ active: true, down: [], pressed: [], buttons: 0, clicked: 0, mouseX: 0, mouseY: 0, wheel: 0, yaw: 0, pitch: 0, viewSeq, acts: { gun: [] } });

/** Ann and Bob in a game with these rules: Ann holds the rifle, Bob stands 8 blocks in front of her. */
function duel(guns?: Rules) {
  const host = new GameHost(range(guns), { engine: wasm, seed: 1, remote: true, radius: 3, budget: Infinity, player: { id: 'p1', name: 'Ann' } });
  const ann = host.connect('Ann');
  const bob = host.connect('Bob');
  host.command(ann.id, { t: 'start' });
  host.command(bob.id, { t: 'start' });
  const sim = host.sim;
  const A = sim.players.find((p) => p.id === ann.id)!;
  const B = sim.players.find((p) => p.id === bob.id)!;
  const step = (n = 1) => {
    for (let i = 0; i < n; i++) host.step(1 / 30);
  };
  step(3);
  A.api.teleport({ x: 0.5, y: 65, z: 8.5 }, 0, 0);
  B.api.teleport({ x: 0.5, y: 65, z: 0.5 }, 0, 0);
  A.api.inventory.give('rifle');
  step(20);
  const aimAt = (p: { x: number; y: number; z: number }, dy: number) => {
    const e = A.eye;
    const dx = p.x - e.x;
    const dz = p.z - e.z;
    return { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(p.y + dy - e.y, Math.hypot(dx, dz)) };
  };
  let serial = 1;
  /** One shot from Ann's screen at Bob's `dy` above his feet, as it was showing him at `seen`. */
  const fire = (dy: number, at = B.position, seen = sim.time) => {
    const aim = aimAt(at, dy);
    host.command(ann.id, { t: 'input', input: { ...idle(A.viewSeq), yaw: aim.yaw, pitch: aim.pitch, acts: { gun: [[serial++, aim.yaw, aim.pitch, 0]] }, seen } });
    step();
  };
  const hurt: { amount: number; head: boolean }[] = [];
  sim.ctx.events.on('playerDamage', (e) => {
    if (e.player === B.api) hurt.push({ amount: e.amount, head: !!e.headshot });
  });
  return { host, sim, ann, bob, A, B, step, fire, hurt, serial: () => serial++ };
}

/**
 * A game's own gun rules (`guns`: rewind, hitboxes, reloading, the fire-rate slack, movement,
 * aim assist) and the `damage` event changing and cancelling hits of every kind.
 */
export default function gunrules() {
  // Defaults: exactly today's numbers.
  const d = { ...resolveGunRules(), ...resolveHitscan() };
  check(d.rewind === 0.35 && d.rateSlack === 3 && d.autoReload && d.aimSlows && d.aimStopsSprint && d.fireStopsSprint, `default rules: ${JSON.stringify(d)}`);
  check(JSON.stringify(d.boxes) === JSON.stringify([[1.5, 2, 0.36, 0.28], [1.2, 1.7, 0.38, 0.3], [0.85, 1.4, 0.45, 0.45]]), `default hitboxes: ${JSON.stringify(d.boxes)}`);

  // A longer rewind: a shot as Bob was 0.8 s ago hits (the default 0.35 s cap would miss it).
  for (const [rewind, hits] of [
    [undefined, 0],
    [1.2, 1],
  ] as const) {
    const t = duel(rewind === undefined ? undefined : { rewind });
    const was = { t: t.sim.time, ...t.B.position };
    t.B.api.teleport({ x: 4.5, y: 65, z: 0.5 }, 0, 0);
    t.step(24);
    t.fire(1.0, was, was.t);
    check(t.hurt.length === hits, `rewind ${rewind ?? 'default'}: a shot where Bob was 0.8 s ago ${hits ? 'hits' : 'misses'} (${t.hurt.length} hits)`);
  }

  // Hitboxes: with the neck at 1.1, a shot 1.3 up Bob is a head hit (by default it's his chest).
  for (const [guns, head] of [
    [undefined, false],
    [{ hitboxes: { stand: { neck: 1.1 } } }, true],
  ] as const) {
    const t = duel(guns);
    t.fire(1.3);
    check(t.hurt.length === 1 && t.hurt[0].head === head && t.hurt[0].amount === (head ? 20 : 10), `hitboxes ${JSON.stringify(guns ?? 'default')}: ${JSON.stringify(t.hurt)}`);
  }
  // Wider: a shot 0.45 to Bob's side misses him by default and hits a 1.2-wide body.
  for (const [guns, hits] of [
    [undefined, 0],
    [{ hitboxes: { stand: { width: 1.2 } } }, 1],
  ] as const) {
    const t = duel(guns);
    const b = t.B.position;
    t.fire(1.0, { x: b.x + 0.45, y: b.y, z: b.z });
    check(t.hurt.length === hits, `width ${JSON.stringify(guns ?? 'default')}: ${t.hurt.length} hits`);
  }

  // No reloading by itself: an emptied magazine stays empty until R.
  for (const autoReload of [true, false]) {
    const t = duel({ autoReload });
    gunKit.of(t.sim.ctx)!.setAmmo(t.A.api, 'rifle', { magazine: 1, reserve: 30 });
    t.step();
    t.fire(1.0);
    t.step(60);
    const ammo = gunKit.of(t.sim.ctx)!.ammo(t.A.api, 'rifle')!;
    check(ammo.magazine === (autoReload ? 30 : 0), `autoReload ${autoReload}: magazine ${ammo.magazine} two seconds after emptying`);
  }

  // The fire-rate slack: eight shots arriving in one tick; the host takes fewer with less slack.
  const burst = (rateSlack?: number) => {
    const t = duel(rateSlack === undefined ? undefined : { rateSlack });
    let shots = 0;
    t.sim.ctx.events.on('shot', (e) => {
      if (e.player === t.A.api) shots++;
    });
    t.step(30);
    const many = Array.from({ length: 8 }, () => [t.serial(), 0, 0, 0] as [number, number, number, number]);
    t.host.command(t.ann.id, { t: 'input', input: { ...idle(t.A.viewSeq), acts: { gun: many }, seen: t.sim.time } });
    t.step();
    return shots;
  };
  const [loose, strict] = [burst(), burst(1)];
  check(loose >= 2 && loose <= 4 && strict === 1, `8 shots at once: the default slack takes ${loose}, a slack of 1 takes ${strict}`);

  // Movement: aiming and firing stop a sprint and aiming slows, unless the rules say not.
  const rifle = { kind: 'gun', name: 'R', icon: 'iron_sword', rpm: 600, damage: 1, magazine: 1, reload: 1, aim: { move: 0.5 } } as const;
  const def = gunMove(rifle, 4 | 1);
  const free = gunMove(rifle, 4 | 1, resolveGunRules({ aimSlows: false, aimStopsSprint: false, fireStopsSprint: false }));
  const aimOnly = gunMove(rifle, 1, resolveGunRules({ fireStopsSprint: false }));
  check(def.noSprint && def.speed === 0.5 && !free.noSprint && free.speed === 1 && !aimOnly.noSprint, `move mods: ${JSON.stringify({ def, free, aimOnly })}`);

  // Aim assist's shape: the gun's own over the game's over the defaults.
  const g = gun({ ...rifle, aim: { assist: { strength: 0.3, follow: { hip: 0.5 } } } });
  const a = assistOf(g, resolveGunRules({ assist: { strength: 0.9, cone: { radius: 2, angle: 3 }, slow: { aim: 0.8 } } }));
  check(a.strength === 0.3 && a.radius === 2 && Math.abs(a.angle - (3 * Math.PI) / 180) < 1e-12 && a.slow.hip === 0.45 && a.slow.aim === 0.8 && a.follow.hip === 0.5 && a.follow.aim === 0.6, `assist: ${JSON.stringify(a)}`);
  const plain = assistOf(gun({ ...rifle, aim: { assist: 0.25 } }), resolveGunRules());
  check(plain.strength === 0.25 && plain.radius === 1.1 && plain.angle === 0.025, `assist from a number: ${JSON.stringify(plain)}`);

  // The damage event: halve Bob's gun damage, then cancel it, then see melee, world, projectile and creature damage.
  const t = duel();
  const heard: DamageEvent[] = [];
  // Read through a function: `check` narrows what it has seen.
  const hp = () => t.B.api.health;
  let rule: (e: DamageEvent) => void = () => {};
  t.sim.ctx.events.on('damage', (e) => {
    heard.push(e);
    rule(e);
  });
  rule = (e) => {
    if (e.cause === 'gun') e.amount /= 2;
  };
  t.fire(1.0);
  let e = heard.at(-1)!;
  check(t.hurt.length === 1 && t.hurt[0].amount === 5 && hp() === 95, `halved: ${JSON.stringify(t.hurt)}, health ${hp()}`);
  check(e.target === t.B.api && e.source === t.A.api && e.cause === 'gun' && e.part === 'body' && e.weapon === 'rifle' && e.headshot === false && e.amount === 5, `the event says who, what and where: ${JSON.stringify({ cause: e.cause, part: e.part, weapon: e.weapon, headshot: e.headshot })}`);
  t.fire(1.8);
  e = heard.at(-1)!;
  check(e.part === 'head' && e.headshot === true && t.hurt.at(-1)!.amount === 10, `a head hit: part ${e.part}, ${t.hurt.at(-1)!.amount} damage`);
  rule = (e) => e.target.kind === 'player' && e.cause === 'gun' && e.cancel();
  const hurtBefore = t.hurt.length;
  t.fire(1.0);
  check(heard.at(-1)!.cancelled && t.hurt.length === hurtBefore && hp() === 85, `cancelled: no playerDamage, health ${hp()}`);
  // Setting it to nothing cancels it too.
  rule = (e) => (e.amount = 0);
  check(!t.B.api.damage(5, { source: 'world' }) && hp() === 85, 'amount 0: nothing lands');
  rule = () => {};
  check(t.B.api.damage(4, { source: 'world' }) && heard.at(-1)!.cause === 'world' && hp() === 81, `world damage: cause ${heard.at(-1)!.cause}`);
  // Melee: Ann steps up to Bob with a sword.
  t.A.api.inventory.clear();
  t.A.api.inventory.give('sword');
  t.A.api.teleport({ x: 0.5, y: 65, z: 2.5 }, 0, 0);
  t.step(15);
  rule = (e) => {
    if (e.cause === 'melee') e.knockback = 0;
  };
  const b0 = t.B.position;
  t.host.command(t.ann.id, { t: 'input', input: { ...idle(t.A.viewSeq), yaw: 0, pitch: -0.3, buttons: 1, clicked: 1 } });
  t.step(6);
  e = heard.at(-1)!;
  const b1 = t.B.position;
  check(e.cause === 'melee' && e.source === t.A.api && e.weapon === 'sword' && e.knockback === 0 && hp() === 75, `melee: cause ${e.cause}, weapon ${e.weapon}, health ${hp()}`);
  check(Math.hypot(b1.x - b0.x, b1.z - b0.z) < 0.05, `no knockback when a listener takes it away: moved ${Math.hypot(b1.x - b0.x, b1.z - b0.z).toFixed(3)}`);
  // A projectile (Ann's, straight at Bob).
  rule = () => {};
  t.A.api.teleport({ x: 0.5, y: 65, z: 8.5 }, 0, 0);
  t.step(5);
  const from = { x: 0.5, y: t.B.position.y + 1.2, z: 6.5 };
  t.sim.ctx.entities.projectile({ speed: 40, gravity: 0, damage: 3 }, from, { x: 0, y: 0, z: -1 }, t.A.api);
  t.step(15);
  e = heard.at(-1)!;
  check(e.cause === 'projectile' && e.source === t.A.api && e.target === t.B.api && hp() === 72, `projectile: cause ${e.cause}, health ${hp()}`);
  // A creature: double it, then cancel it (`damage` answers whether it landed).
  const dummy = t.sim.ctx.entities.spawn('dummy', { x: 6.5, y: 65, z: 0.5 });
  const dummyHp = () => dummy.health;
  t.step(5);
  rule = (e) => {
    if (e.target === dummy) e.amount *= 2;
  };
  check(dummy.damage(5, { source: t.A.api }) && dummyHp() === 30 && heard.at(-1)!.cause === 'melee', `creature damage doubled: health ${dummyHp()}`);
  rule = (e) => e.target === dummy && e.cancel();
  check(!dummy.damage(5, { source: t.A.api }) && dummyHp() === 30, `creature damage cancelled: health ${dummyHp()}`);
  console.log(`  rewind, hitboxes, auto-reload, slack (${loose} vs ${strict}), move mods and assist shape follow the rules; damage halved, cancelled, and heard from guns, blades, the world, projectiles and creatures`);
}
