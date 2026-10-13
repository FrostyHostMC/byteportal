import { readFileSync } from 'node:fs';
import { defineGame } from '../../src/platform';
import { GameHost } from '../../src/platform/host/game';
import type { PlayerInput } from '../../src/platform/net/protocol';
import { WheelSteps, type WheelLike } from '../../src/platform/player/input';
import { guns, melee, throwables } from '../../src/platform/kits';
import { check } from './_harness';

const wasm = readFileSync('engine/pkg/voxel_engine_bg.wasm');

/** Steps from a stream of wheel events, each `[ms, deltaY, wheelDeltaY?, deltaMode?]`. */
function steps(events: [number, number, number?, number?][]): number[] {
  const w = new WheelSteps();
  return events.map(([t, deltaY, wheelDeltaY, deltaMode]) => w.step({ timeStamp: t, deltaY, deltaMode: deltaMode ?? 0, wheelDeltaY } as WheelLike)).filter((s) => s !== 0);
}

/** A burst like a trackpad flick or a smooth-scrolling mouse's click: up to `peak` and dying away, an event every 16 ms. */
function burst(at: number, peak: number, n: number, rise = 3): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) out.push([at + i * 16, i < rise ? (peak * (i + 1)) / rise : peak * Math.pow(0.8, i - rise + 1)]);
  return out;
}

const shelf = defineGame({
  id: 'shelf',
  title: 'Shelf',
  world: { terrain: 'void', ground: { y: 40 }, spawn: { x: 0.5, y: 41, z: 0.5 }, time: 0.5, freezeTime: true },
  player: { health: 100, hotbar: 'items' },
  items: [throwables(), guns(), melee()],
  setup(game) {
    for (const id of ['rifle', 'pistol']) game.items.define(id, { kind: 'gun', name: id, icon: 'iron_sword', rpm: 300, damage: 10, magazine: 10, reload: 1 });
    game.items.define('knife', { kind: 'melee', name: 'Knife', icon: 'iron_sword', damage: 5, cooldown: 0.5 });
    game.items.define('frag', { kind: 'throwable', name: 'Frag', icon: 'iron_sword', key: 'KeyG', blast: { radius: 2, damage: 50 } });
  },
});

/**
 * The mouse wheel and the hotbar: a notched wheel steps once a click, however fast; a trackpad
 * flick (momentum and all) or a smooth-scrolling mouse's click steps once, and each fresh click
 * or flick again; and the wheel reaches every filled slot, a throwable with its own key too
 * (1-2-3-4, not 1-2-3-1).
 */
export default function wheel() {
  // A notched wheel (Chrome: 100 a click, 120 in wheelDeltaY), five clicks 40 ms apart: five steps.
  const notched = steps([0, 40, 80, 120, 160].map((t) => [t, 100, -120]));
  check(notched.length === 5 && notched.every((s) => s === 1), `a notched wheel steps once a click: ${notched}`);
  // Firefox counts a click in lines.
  const lines = steps([0, 30, 60].map((t) => [t, 3, undefined, 1]));
  check(lines.length === 3, `a click in lines is a step: ${lines}`);
  // A trackpad flick: 40 events rising and dying away over 640 ms (momentum): one step.
  const flick = steps(burst(0, 30, 40));
  check(flick.length === 1, `a trackpad flick is one step: ${flick.length}`);
  // Two flicks the same way, the second while the first's momentum is still going: two.
  const two = steps([...burst(0, 30, 12), ...burst(12 * 16, 40, 20)]);
  check(two.length === 2, `a second flick in the first's momentum is another step: ${two.length}`);
  // A smooth-scrolling mouse: three clicks 250 ms apart, each a burst of ten small events: three.
  const smooth = steps([0, 250, 500].flatMap((t) => burst(t, 12, 10, 2)));
  check(smooth.length === 3, `a smooth-scrolling mouse steps once a click: ${smooth.length}`);
  // Scrolled back the other way mid-burst: a step back at once.
  const back = steps([...burst(0, 20, 6), ...burst(96, -20, 6)]);
  check(back.join() === '1,-1', `a turn the other way steps back: ${back}`);
  // A slow, steady trackpad drag: one step, not one an event.
  const drag = steps(Array.from({ length: 60 }, (_, i) => [i * 16, 3] as [number, number]));
  check(drag.length === 1, `a steady drag is one step: ${drag.length}`);
  // Sprinting (Shift held): a Mac sends the wheel's clicks sideways (deltaX, wheelDeltaX), and
  // they still step, down and back up; a sideways swipe without Shift doesn't.
  const w = new WheelSteps();
  const shifted = [0, 40, 80, -1, -1].map((dir, i) => w.step({ timeStamp: i * 40 + (dir < 0 ? 200 : 0), deltaY: 0, deltaX: 100 * Math.sign(dir || 1), wheelDeltaX: -120 * Math.sign(dir || 1), deltaMode: 0, shiftKey: true } as WheelLike)).filter((s) => s !== 0);
  check(shifted.join() === '1,1,1,-1,-1', `with Shift held, the sideways wheel still steps: ${shifted}`);
  const swipe = new WheelSteps().step({ timeStamp: 0, deltaY: 0, deltaX: 30, deltaMode: 0, shiftKey: false } as WheelLike);
  check(swipe === 0, `a sideways swipe without Shift doesn't step (${swipe})`);

  // The hotbar: rifle, pistol, knife, frag in 1-4; the wheel goes 1-2-3-4-1 and back 1-4.
  const host = new GameHost(shelf, { engine: wasm, seed: 1, remote: true, radius: 2, budget: Infinity, player: { id: 'p1', name: 'Ann' } });
  const ann = host.connect('Ann');
  host.command(ann.id, { t: 'start' });
  const A = host.sim.players.find((p) => p.id === ann.id)!;
  for (let i = 0; i < 5; i++) host.step(1 / 30);
  for (const id of ['rifle', 'pistol', 'knife']) A.api.inventory.give(id);
  A.api.inventory.give('frag', 2);
  A.api.inventory.select(0);
  const idle: PlayerInput = { active: true, down: [], pressed: [], buttons: 0, clicked: 0, mouseX: 0, mouseY: 0, wheel: 0, yaw: 0, pitch: 0, viewSeq: A.viewSeq };
  const seen: number[] = [A.api.inventory.selected];
  for (const w of [1, 1, 1, 1, -1]) {
    host.command(ann.id, { t: 'input', input: { ...idle, wheel: w } });
    host.step(1 / 30);
    host.command(ann.id, { t: 'input', input: idle });
    host.step(1 / 30);
    seen.push(A.api.inventory.selected);
  }
  check(seen.join() === '0,1,2,3,0,3', `the wheel goes round every filled slot, the frag's too: ${seen.map((s) => s + 1).join('-')}`);
  console.log(`  notched ${notched.length}/5, lines ${lines.length}/3, a flick 1, two flicks 2, smooth clicks ${smooth.length}/3, a drag 1, with Shift ${shifted.length}/5 · hotbar ${seen.map((s) => s + 1).join('-')}`);
}
