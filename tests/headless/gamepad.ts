import { readFileSync } from 'node:fs';
import { defineGame } from '../../src/platform';
import { GameHost } from '../../src/platform/host/game';
import type { PlayerInput } from '../../src/platform/net/protocol';
import { sanitizeCommand } from '../../src/platform/net/validate';
import { padBindings, padHints } from '../../src/platform/player/gamepad';
import { games } from '../../src/games/server';
import { guns, melee } from '../../src/platform/kits';
import { check } from './_harness';

const wasm = readFileSync('engine/pkg/voxel_engine_bg.wasm');

const field = defineGame({
  id: 'field',
  title: 'Field',
  world: { terrain: 'flat', flatHeight: 64, spawn: { x: 0.5, y: 65, z: 0.5 }, time: 0.5, freezeTime: true },
  player: { health: 100, hotbar: 'items', movement: { walk: 5, sprint: 8, sprintKeys: ['ShiftLeft'], crouchKeys: ['KeyC'] } },
  items: [guns(), melee()],
  setup(game) {
    for (const id of ['rifle', 'pistol']) game.items.define(id, { kind: 'gun', name: id, icon: 'iron_sword', rpm: 300, damage: 10, magazine: 10, reload: 1 });
  },
});

const idle = (viewSeq: number): PlayerInput => ({ active: true, down: [], pressed: [], buttons: 0, clicked: 0, mouseX: 0, mouseY: 0, wheel: 0, yaw: 0, pitch: 0, viewSeq });

/**
 * Controllers, the parts the host sees: a stick walks the way it points, as fast as it's pushed
 * (sprinting at full speed however far), the hotbar cycles past empty slots (the shoulder
 * buttons, and the mouse wheel), a stick's input is checked like the rest, and the hints on the
 * home page name each button's job the way the game names its keys.
 */
export default function gamepad() {
  const host = new GameHost(field, { engine: wasm, seed: 1, remote: true, radius: 3, budget: Infinity, player: { id: 'p1', name: 'Ann' } });
  const ann = host.connect('Ann');
  host.command(ann.id, { t: 'start' });
  const A = host.sim.players.find((p) => p.id === ann.id)!;
  const step = (n: number) => {
    for (let i = 0; i < n; i++) host.step(1 / 30);
  };
  step(5);
  const walk = (input: Partial<PlayerInput>, seconds = 1) => {
    A.api.teleport({ x: 0.5, y: 65, z: 0.5 }, 0, 0);
    step(10);
    host.command(ann.id, { t: 'input', input: { ...idle(A.viewSeq), ...input } });
    step(6); // up to speed
    const from = { ...A.position };
    step(Math.round(seconds * 30));
    host.command(ann.id, { t: 'input', input: idle(A.viewSeq) });
    return { dx: A.position.x - from.x, dz: A.position.z - from.z };
  };

  // Facing -z (yaw 0): stick forward walks -z at walking speed, half pushed about half as fast,
  // right strafes +x.
  const full = walk({ move: [0, 1] });
  const half = walk({ move: [0, 0.5] });
  const right = walk({ move: [1, 0] });
  const keys = walk({ down: ['KeyW'] });
  check(full.dz < -4.5 && Math.abs(full.dx) < 0.05, `stick forward walks ahead at walking speed: ${JSON.stringify(full)}`);
  check(Math.abs(full.dz - keys.dz) < 0.2, `as fast as W: ${full.dz.toFixed(2)} and ${keys.dz.toFixed(2)}`);
  check(half.dz / full.dz > 0.45 && half.dz / full.dz < 0.55, `half pushed, half as fast: ${half.dz.toFixed(2)} of ${full.dz.toFixed(2)}`);
  check(right.dx > 4.5 && Math.abs(right.dz) < 0.05, `stick right strafes right: ${JSON.stringify(right)}`);
  // Sprinting (its key held, as the controller's L3 does) is full sprint speed, even with the stick short of the rim.
  const sprint = walk({ move: [0.1, 0.7], down: ['ShiftLeft'] });
  check(Math.hypot(sprint.dx, sprint.dz) > 7.5, `sprinting at full speed with the stick part way: ${Math.hypot(sprint.dx, sprint.dz).toFixed(2)}`);
  // Mostly sideways doesn't sprint.
  const sideways = walk({ move: [0.9, 0.3], down: ['ShiftLeft'] });
  check(Math.hypot(sideways.dx, sideways.dz) < 5.2, `no sprinting sideways: ${Math.hypot(sideways.dx, sideways.dz).toFixed(2)}`);

  // The hotbar: two guns in slots 1 and 2; next / previous skip the seven empty slots.
  const inv = A.api.inventory;
  inv.give('rifle');
  inv.give('pistol');
  inv.select(0);
  const slots: number[] = [];
  for (const wheel of [1, 1, -1, -1]) {
    host.command(ann.id, { t: 'input', input: { ...idle(A.viewSeq), wheel } });
    step(1);
    slots.push(inv.selected);
  }
  check(slots.join() === '1,0,1,0', `cycling the hotbar skips empty slots: ${slots.join()}`);

  // A stick's input is checked like the rest: pulled into range, and anything else refused; a
  // stick pushed past its rim (a doctored client) walks no faster than full.
  const ok = sanitizeCommand({ t: 'input', input: { ...idle(0), move: [0.5, -0.25] } });
  const far = sanitizeCommand({ t: 'input', input: { ...idle(0), move: [0.5, 2] } });
  const odd = sanitizeCommand({ t: 'input', input: { ...idle(0), move: 'fast' } });
  check(ok?.t === 'input' && ok.input.move?.join() === '0.5,-0.25', `a stick in range goes through: ${JSON.stringify(ok)}`);
  check(far?.t === 'input' && far.input.move?.join() === '0.5,1', `a stick out of range is pulled in: ${JSON.stringify(far)}`);
  check(odd === null, 'a stick that isn\'t a pair of numbers is refused');
  const corner = walk({ move: [1, 1] });
  check(Math.hypot(corner.dx, corner.dz) < Math.hypot(full.dx, full.dz) + 0.1, `a stick pushed past its rim is no faster: ${Math.hypot(corner.dx, corner.dz).toFixed(2)}`);

  // Call of Blocky's buttons, and the hints the home page shows for them.
  const cob = games.find((g) => g.id === 'callofblocky')!;
  const binds = padBindings(cob.gamepad);
  check(binds.Up === 'KeyL' && binds.R3 === 'Digit3' && binds.RB === 'KeyG' && binds.Down === 'KeyF' && binds.Right === 'KeyM' && binds.RT === 'LMB', `the game's buttons over the platform's: ${JSON.stringify(binds)}`);
  const hints = padHints(cob, true, { jump: 'Space', crouch: 'KeyC', sprint: 'ShiftLeft' });
  const said = Object.fromEntries(hints.map(([k, v]) => [v, k]));
  const want: Record<string, string> = { fire: 'RT', aim: 'LT', jump: 'A', 'crouch · slide': 'B', sprint: 'L3', reload: 'X', switch: 'LB', 'vote to skip': 'Y', lethal: 'RB', katana: 'R3', loadout: 'D-pad ↑', 'plant · crack': 'D-pad ↓', killstreak: 'D-pad ←', 'mode and map': 'D-pad →', scores: 'View', pause: 'Menu' };
  for (const [job, button] of Object.entries(want)) check(said[job] === button, `hint "${button} ${job}": ${JSON.stringify(hints)}`);
  console.log(`  stick ${(-full.dz).toFixed(2)} b/s (W ${(-keys.dz).toFixed(2)}), half ${(-half.dz).toFixed(2)}, sprint ${Math.hypot(sprint.dx, sprint.dz).toFixed(2)} · hotbar ${slots.join(' ')} · ${hints.map(([k, v]) => `${k} ${v}`).join(' · ')}`);
}
