import { readFileSync } from 'node:fs';
import { rim } from '../../src/games/blockjam/court';
import { ballPos } from '../../src/games/blockjam/match';
import blockjam, { matchNow } from '../../src/games/blockjam/server';
import { GameHost } from '../../src/platform/host/game';

const wasm = readFileSync('engine/pkg/voxel_engine_bg.wasm');

/**
 * A person played by a script, crudely: drive at the rim with turbo and dunk, a jumper when the
 * shot clock's low, chase the ball, swipe at whoever has it. (For the levels' test and probe.)
 */
export function personInput(i: number, mem: { swipe: number; jump: number }) {
  const m = matchNow();
  const me = m.teams.flatMap((t) => t.ballers).find((b) => !b.player.bot);
  const down: string[] = [];
  const pressed: string[] = [];
  if (me) {
    const p = me.player.position;
    const go = (x: number, z: number, turbo: boolean) => {
      const dx = x - p.x;
      const dz = z - p.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.4) return;
      if (dx / d > 0.38) down.push('KeyD');
      if (dx / d < -0.38) down.push('KeyA');
      if (dz / d > 0.38) down.push('KeyS');
      if (dz / d < -0.38) down.push('KeyW');
      if (turbo) down.push('ShiftLeft');
    };
    const ball = m.ball;
    const r = rim(me.team.side);
    if (ball.mode === 'held' && ball.holder === me) {
      const d = Math.hypot(r.x - p.x, r.z - p.z);
      if (mem.jump >= 0) {
        // A jump shot: let go about the top.
        if (i - mem.jump < 7) down.push('Space');
        else mem.jump = -1;
      } else if (d < 5) {
        down.push('ShiftLeft', 'Space');
        pressed.push('Space');
      } else if (m.shotClock < 6 && d < 8) {
        mem.jump = i;
        down.push('Space');
        pressed.push('Space');
      } else go(r.x - me.team.side * 0.8, r.z, true);
    } else {
      mem.jump = -1;
      const at = ballPos(m);
      go(at.x, at.z, Math.hypot(at.x - p.x, at.z - p.z) > 4 && i % 90 < 50);
      if (ball.mode === 'held' && ball.holder && ball.holder.team !== me.team && Math.hypot(at.x - p.x, at.z - p.z) < 1.4 && i - mem.swipe > 20) {
        pressed.push('KeyE');
        mem.swipe = i;
      }
    }
  }
  return { active: true, down, pressed, buttons: 0, clicked: 0, mouseX: 0, mouseY: 0, wheel: 0, yaw: 0, pitch: 0, viewSeq: -1 };
}

/** A game for a scripted person (and their bot) against two bots at a level, `seconds` long: the score. */
export function personGame(seed: number, level: string, seconds: number) {
  const h = new GameHost(blockjam, { engine: wasm, seed, remote: true, radius: 3, budget: Infinity });
  for (let i = 0; i < 30; i++) h.step(1 / 30);
  const c = h.connect();
  h.command(c.id, { t: 'start', name: 'Person' });
  for (let i = 0; i < 5; i++) h.step(1 / 30);
  h.command(c.id, { t: 'message', msg: { t: 'widgetAction', player: '', widget: 'jam-pick', action: 'level', value: level } });
  h.command(c.id, { t: 'message', msg: { t: 'widgetAction', player: '', widget: 'jam-pick', action: 'team', value: 'blaze' } });
  const mem = { swipe: 0, jump: -1 };
  for (let i = 0; i < 30 * seconds; i++) {
    h.command(c.id, { t: 'input', input: personInput(i, mem) });
    h.step(1 / 30);
  }
  return matchNow();
}

/** Balance probe (not a test): a scripted person + their bot against two bots at each level. */
export default function jamLevels() {
  for (const seed of [11, 12, 13]) {
    for (const lv of ['rookie', 'pro', 'allstar'] as const) {
      const m = personGame(seed, lv, 240);
      const st = m.teams.map((t) => t.ballers.map((b) => `${b.player.name.split(' ').at(-1)}:${b.pts}p/${b.stl}s/${b.blk}b/${b.dunks}d`).join(' '));
      console.log(`seed ${seed} ${lv.padEnd(7)}: people ${String(m.teams[0].score).padStart(2)} - ${String(m.teams[1].score).padStart(2)} bots | ${st.join(' || ')}`);
    }
  }
}
