import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { VehicleView } from '../../src/platform/client/vehicle';
import { GameHost } from '../../src/platform/host/game';
import type { HostEvent, PlayerInput } from '../../src/platform/net/protocol';
import { worldQuery } from '../../src/platform/sim/worldquery';
import { check, games } from './_harness';

type Ship = { x: number; y: number; z: number; yaw: number; hit: number; rollDir: number };
type Vec = { x: number; y: number; z: number };
type Pilot = { player: { id: string; achieved(id: string): boolean; store: { get(key: string): unknown } }; kills: number; down: boolean; alive: boolean; vehicle: { state: Ship }; damage(n: number): void; craft: { pos: THREE.Vector3; forward(v: THREE.Vector3): THREE.Vector3 } };
type Weapons = { laser(from: Vec, dir: Vec, team: 'empire'): void };
type Capital = { generators: { pos: Vec; alive: boolean; hit(d: number, at: Vec, kind: 'torpedo', by?: unknown): void }[] };
type Enemy = { alive: boolean; craft: { pos: { set(x: number, y: number, z: number): void; x: number; y: number; z: number }; speed: number }; hit(d: number, at: unknown, kind: string, by?: unknown): void };

/**
 * Starfighter together: a ship each (a vehicle), steered only by its own pilot, predicted on the
 * pilot's screen exactly as the host flies it; waves grow with the squadron; kills go to whoever
 * shot; lasers fly on their own; a pilot shot down watches and comes back; the battle is lost
 * only when every pilot is down at once.
 */
export default function starfighterMultiplayer() {
  const def = games.find((g) => g.id === 'starfighter')!;
  const host = new GameHost(def, { engine: readFileSync('engine/pkg/voxel_engine_bg.wasm'), seed: 7, remote: true, radius: 8, budget: Infinity, cheats: true, player: { id: 'p1', name: 'Player' } });
  // The game's own state (development builds expose it), once it has started.
  const game = () => (globalThis as unknown as { __sf: { pilots: Map<string, Pilot>; enemies: Enemy[]; weapons: Weapons; capital: Capital } }).__sf;
  const events = new Map<string, HostEvent[]>();
  let last = new Map<string, import('../../src/platform/net/protocol').HostBatch>();
  const step = (n = 1) => {
    for (let i = 0; i < n; i++) {
      last = host.step(1 / 30);
      for (const [id, b] of last) events.set(id, [...(events.get(id) ?? []), ...b.events]);
    }
  };
  const calls = (id: string, method: string) => (events.get(id) ?? []).flatMap((e) => (e.t === 'call' && e.call.method === method ? [e.call.args] : []));
  const idle = (o: Partial<PlayerInput> = {}): PlayerInput => ({ active: true, down: [], pressed: [], buttons: 0, clicked: 0, mouseX: 0, mouseY: 0, wheel: 0, yaw: 0, pitch: 0, viewSeq: -1, ...o });

  const ann = host.connect('Ann');
  const bob = host.connect('Bob');
  host.command(ann.id, { t: 'start' });
  host.command(bob.id, { t: 'start' });
  step(10);
  const A = () => game().pilots.get(ann.player!)!;
  const B = () => game().pilots.get(bob.player!)!;
  check(game().pilots.size === 2 && A().vehicle && B().vehicle, 'a ship each');
  const frame = () => last.get(ann.id)!.frame!;
  const fa = () => frame().players.find((p) => p.id === ann.player)!;
  check(fa().vehicle?.name === 'voxwing' && fa().camera.follow && fa().vehicle!.prop !== null, `Ann's frame carries her vehicle: ${JSON.stringify(fa().vehicle?.name)}`);

  // Each steers only their own: Ann pushes the stick right (inputs numbered, as a server's client sends them),
  // and her own screen's prediction lands where the host flies her.
  // Her screen's copy of the world has the same blocks (here: the host's own).
  const client = new VehicleView(def.vehicles!, worldQuery(host.world.world, host.sim.registry), true);
  client.reconcile(fa());
  const yawA = A().vehicle.state.yaw;
  const yawB = B().vehicle.state.yaw;
  let seq = 0;
  let worst = 0;
  for (let i = 0; i < 90; i++) {
    for (let k = 0; k < 2; k++) {
      const input = idle({ mouseX: 14 });
      client.step(input, 1 / 60, ++seq);
      host.command(ann.id, { t: 'input', input, seq, dt: 1 / 60 });
    }
    step(1);
    client.reconcile(fa());
    if (i > 5) worst = Math.max(worst, client.lastCorrection);
  }
  check(Math.abs(A().vehicle.state.yaw - yawA) > 0.5 && Math.abs(B().vehicle.state.yaw - yawB) < 0.05, `Ann turned (${(A().vehicle.state.yaw - yawA).toFixed(2)}), Bob didn't (${(B().vehicle.state.yaw - yawB).toFixed(2)})`);
  check(worst < 0.01, `prediction lands where the host flies her: worst correction ${worst.toFixed(4)} blocks`);

  // Wave 1 for two: 5 Bowties, half as many again.
  step(30 * 5);
  check(game().enemies.length === 8, `wave 1 for two pilots: ${game().enemies.length} fighters`);

  // Ann shoots one down (it hangs still, 70 blocks off her nose): her kill.
  const target = game().enemies.find((e) => e.alive)!;
  const c0 = A().craft;
  const f0 = c0.forward(new THREE.Vector3());
  const spot = { x: c0.pos.x + f0.x * 70, y: c0.pos.y + f0.y * 70, z: c0.pos.z + f0.z * 70 };
  let lasers = 0;
  for (let i = 0; i < 60 && target.alive; i++) {
    target.craft.pos.set(spot.x, spot.y, spot.z);
    target.craft.speed = 0;
    host.command(ann.id, { t: 'input', input: idle({ buttons: 1 }), seq: ++seq, dt: 1 / 30 });
    step(1);
    lasers = Math.max(lasers, frame().props.filter((p) => p.v && p.by === ann.player).length);
  }
  check(!target.alive && A().kills === 1 && B().kills === 0, `Ann's kill: ${A().kills}, Bob ${B().kills}`);
  check(lasers > 0, 'her lasers fly on their own, marked as hers');
  check(A().player.achieved('first_kill') && !B().player.achieved('first_kill') && A().player.store.get('kills') === 1, 'Scratch One for Ann (and her kill kept all-time), not Bob');
  host.command(ann.id, { t: 'input', input: idle(), seq: ++seq, dt: 1 / 30 });

  // Ann rolls (Q) as an enemy bolt reaches her: it glances off. Do a barrel roll!
  host.command(ann.id, { t: 'input', input: idle({ pressed: ['KeyQ'] }), seq: ++seq, dt: 1 / 30 });
  host.command(ann.id, { t: 'input', input: idle(), seq: ++seq, dt: 1 / 30 });
  // (Her inputs are played at their pace: the roll begins once the host reaches that one.)
  for (let i = 0; i < 10 && !A().vehicle.state.rollDir; i++) step(1);
  check(A().vehicle.state.rollDir !== 0, 'Ann is rolling');
  const c1 = A().craft;
  const f1 = c1.forward(new THREE.Vector3());
  game().weapons.laser({ x: c1.pos.x + f1.x, y: c1.pos.y + f1.y, z: c1.pos.z + f1.z }, { x: -f1.x, y: -f1.y, z: -f1.z }, 'empire');
  step(1);
  check(A().player.achieved('barrel_roll') && !B().player.achieved('barrel_roll'), 'Do a Barrel Roll! for Ann');

  // Her torpedo finishes a shield generator: Shields Down is hers.
  const gen = game().capital.generators[0];
  gen.hit(1e6, gen.pos, 'torpedo', A().player);
  step(1);
  check(!gen.alive && A().player.achieved('shields_down') && !B().player.achieved('shields_down'), 'Shields Down for Ann');

  // Bob is shot down: he watches (the game's camera), Ann flies on, and he's back after a while.
  B().damage(1000);
  step(3);
  const fb = () => frame().players.find((p) => p.id === bob.player)!;
  check(B().down && !fb().vehicle && !fb().camera.follow, 'Bob is down, out of his ship, watching');
  check(calls(bob.id, 'banner').some((a) => a[0] === 'SHOT DOWN') && !calls(ann.id, 'screen').length, 'he hears it; the battle goes on');
  step(30 * 13);
  check(!B().down && !!fb().vehicle && fb().camera.follow, 'Bob is back in a new ship');

  // Both down at once: lost.
  A().damage(1000);
  B().damage(1000);
  step(30 * 3);
  const screen = (id: string) => (events.get(id) ?? []).flatMap((e) => (e.t === 'call' && e.call.method === 'screen' ? [e.call.args[1] as { title: string; subtitle: string }] : [])).at(-1);
  check(screen(ann.id)?.title === 'Shot Down' && screen(bob.id)?.subtitle.startsWith('Your squadron fell'), `lost when both are down: ${JSON.stringify(screen(bob.id))}`);
  host.dispose();
  console.log(`  a ship each · Ann steered, Bob didn't · prediction within ${worst.toFixed(4)} blocks · 8 Bowties for two · Ann's kill · her achievements (Scratch One, Do a Barrel Roll!, Shields Down) · Bob down and back · lost when both fell`);
}
