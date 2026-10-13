import { readFileSync } from 'node:fs';
import { allSkaters, blade, puckPos } from '../../src/games/blockice/match';
import { fromGoal, goal } from '../../src/games/blockice/rink';
import blockice, { matchNow } from '../../src/games/blockice/server';
import { GameHost } from '../../src/platform/host/game';

const wasm = readFileSync('engine/pkg/voxel_engine_bg.wasm');

/**
 * A person played by a script, crudely: chase the puck, carry it at the net with turbo and snap a
 * shot from the slot, poke at whoever has it. (For the levels' test and probe.)
 */
export function personInput(i: number, mem: { poke: number; wind: number }) {
  const m = matchNow();
  const me = allSkaters(m).find((s) => !s.player.bot);
  const down: string[] = [];
  const pressed: string[] = [];
  if (me) {
    const p = me.player.position;
    const go = (x: number, z: number, turbo: boolean) => {
      const dx = x - p.x;
      const dz = z - p.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.3) return;
      if (dx / d > 0.38) down.push('KeyD');
      if (dx / d < -0.38) down.push('KeyA');
      if (dz / d > 0.38) down.push('KeyS');
      if (dz / d < -0.38) down.push('KeyW');
      if (turbo) down.push('ShiftLeft');
    };
    const pk = m.puck;
    const g = goal(me.team.side);
    if (m.phase === 'faceoff' && m.draw && i % 4 === 0) pressed.push('KeyE');
    if (pk.mode === 'held' && pk.holder === me) {
      const d = fromGoal(me.team.side, p.x, p.z);
      if (mem.wind > 0) {
        // Winding a wrister: let go after a few ticks.
        if (i - mem.wind < 4) down.push('Space');
        else mem.wind = 0;
      } else if (d < 6.5) {
        mem.wind = i;
        down.push('Space');
      } else go(g.x - me.team.side * 4, 0, true);
    } else {
      mem.wind = 0;
      const at = puckPos(m);
      const b = blade(me.player);
      go(at.x - (b.x - p.x), at.z - (b.z - p.z), Math.hypot(at.x - p.x, at.z - p.z) > 4 && i % 90 < 50);
      if (pk.mode === 'held' && pk.holder && pk.holder.team !== me.team && Math.hypot(at.x - b.x, at.z - b.z) < 1.3 && i - mem.poke > 18) {
        pressed.push('KeyE');
        mem.poke = i;
      }
    }
  }
  return { active: true, down, pressed, buttons: 0, clicked: 0, mouseX: 0, mouseY: 0, wheel: 0, yaw: me ? faceYaw(me.player.velocity) : 0, pitch: 0, viewSeq: -1 };
}

/** Facing where they're going (as a person's screen turns them). */
function faceYaw(v: { x: number; z: number }) {
  return Math.hypot(v.x, v.z) > 0.8 ? Math.atan2(-v.x, -v.z) : 0;
}

/** A game for a scripted person (and their bot) against two bots at a level, `seconds` long: the match. */
export function personGame(seed: number, level: string, seconds: number) {
  const h = new GameHost(blockice, { engine: wasm, seed, remote: true, radius: 3, budget: Infinity });
  for (let i = 0; i < 30; i++) h.step(1 / 30);
  const c = h.connect();
  h.command(c.id, { t: 'start', name: 'Person' });
  for (let i = 0; i < 5; i++) h.step(1 / 30);
  h.command(c.id, { t: 'message', msg: { t: 'widgetAction', player: '', widget: 'ice-pick', action: 'level', value: level } });
  h.command(c.id, { t: 'message', msg: { t: 'widgetAction', player: '', widget: 'ice-pick', action: 'team', value: 'yetis' } });
  const mem = { poke: 0, wind: 0 };
  for (let i = 0; i < 30 * seconds; i++) {
    h.command(c.id, { t: 'input', input: personInput(i, mem) });
    h.step(1 / 30);
  }
  return matchNow();
}

/** Balance probe (not a test): a scripted person + their bot against two bots at each level. */
export default function iceLevels() {
  for (const seed of [11, 12, 13]) {
    for (const lv of ['rookie', 'pro', 'allstar'] as const) {
      const m = personGame(seed, lv, 360);
      const st = [...m.teams[0].skaters, ...m.teams[1].skaters].map((s) => `${s.player.name.split(' ').at(-1)}:${s.g}g/${s.sog}s/${s.hits}h/${s.stl}st`).join(' ');
      console.log(`seed ${seed} ${lv.padEnd(7)}: people ${m.teams[0].score} - ${m.teams[1].score} bots (shots ${m.teams[0].shots}-${m.teams[1].shots}) | ${st}`);
    }
  }
}
