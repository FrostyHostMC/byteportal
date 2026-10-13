import type { Pilot } from '../../src/platform/host/headless';
import { course } from '../../src/games/obby/course';
import { check, launch, lastScreen } from './_harness';

/**
 * Sky Obby: the course doesn't cross itself, and a bot runs it start to finish. The bot follows
 * the course's waypoints platform by platform, sprinting and jumping at each edge, lines up for
 * sharp turns, waits for a blinking platform to appear, and after a fall pauses a moment (so it
 * doesn't meet the same cannon bolt every time).
 */
export default function obby() {
  // Stages that aren't neighbours never come close: nothing overhead to bump into, nothing to cut across.
  const w = course.waypoints;
  for (const a of w)
    for (const b of w) {
      if (Math.abs(a.stage - b.stage) < 2) continue;
      const near = Math.hypot(a.x - b.x, a.z - b.z) < 4 && Math.abs(a.y - b.y) < 6;
      check(!near, `stages ${a.stage + 1} and ${b.stage + 1} come too close near ${a.x}, ${a.y}, ${a.z}`);
    }

  const t0 = performance.now();
  const h = launch('obby', { seed: 5 });
  const game = h.ctx;
  const me = game.player;
  const world = game.world;
  const solid = (x: number, y: number, z: number) => !!world.blockInfo(world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z)))?.solid;
  const glass = world.blockId('glass');

  let wi = 1;
  let wait = 0;
  let falls = 0;
  let last = { ...me.position };
  let best = 0;
  let bestAt = 0;
  const pilot: Pilot = () => {
    const pos = me.position;
    if (Math.hypot(pos.x - last.x, pos.y - last.y, pos.z - last.z) > 3) {
      // Back at a checkpoint: carry on from the waypoint nearest to it.
      falls++;
      let d = Infinity;
      w.forEach((p, i) => {
        const e = Math.hypot(p.x - pos.x, p.y - pos.y, p.z - pos.z);
        if (e < d) (d = e), (wi = i + 1);
      });
      wait = Math.random() * 1.5;
    }
    last = { ...pos };
    if (wait > 0) {
      wait -= 1 / 60;
      return {};
    }
    if (me.onGround)
      for (let j = wi; j < Math.min(w.length, wi + 4); j++)
        if (Math.hypot(w[j].x - pos.x, w[j].z - pos.z) < 0.7 && Math.abs(w[j].y - pos.y) < 0.3) wi = j + 1;
    if (wi > best) (best = wi), (bestAt = game.clock.now);
    const t = w[Math.min(wi, w.length - 1)];
    const yaw = Math.atan2(-(t.x - pos.x), -(t.z - pos.z));
    // A blinking platform that isn't there (or is about to go): wait for it.
    const target = world.getBlock(Math.floor(t.x), Math.floor(t.y - 1), Math.floor(t.z));
    if (me.onGround && (!solid(t.x, t.y - 1, t.z) || target === glass) && Math.hypot(t.x - pos.x, t.z - pos.z) > 1) return { yaw, pitch: 0 };
    // Landed heading the wrong way for a short hop (round the spiral): sneak, which won't walk off
    // the edge, until the run-up points at it. (Long jumps need the speed, so no stopping for those.)
    const v = me.velocity;
    const speed = Math.hypot(v.x, v.z);
    const dist = Math.hypot(t.x - pos.x, t.z - pos.z);
    const off = speed > 0.5 ? Math.acos(Math.max(-1, Math.min(1, (v.x * (t.x - pos.x) + v.z * (t.z - pos.z)) / (speed * dist || 1)))) : 0;
    if (me.onGround && off > 0.45 && dist < 2.9) return { down: ['KeyW', 'ShiftLeft'], yaw, pitch: 0 };
    const down = ['KeyW', 'ControlLeft'];
    if (me.onGround && !solid(pos.x, pos.y - 0.5, pos.z)) down.push('Space');
    return { down, yaw, pitch: 0 };
  };

  const simulated = h.run(900, {
    pilot,
    until: () => lastScreen(h) !== undefined || game.clock.now - bestAt > 60,
  });
  const result = lastScreen(h);
  const wall = (performance.now() - t0) / 1000;
  const stuck = w[Math.min(best, w.length - 1)];
  console.log(`  ${result ?? 'no result'} after ${simulated.toFixed(0)} s of game time (${falls} falls), ${wall.toFixed(1)} s wall clock`);
  check(result !== undefined, `the bot didn't finish: stuck on stage ${stuck.stage + 1} heading for ${stuck.x}, ${stuck.y}, ${stuck.z} (waypoint ${best}/${w.length})`);

  // Its achievements: past each notable stage and finished; quick, and with no falls, if it was.
  const stat = (key: string) => String(h.find('hud', 'stat').filter((c) => c.args[0] === key).at(-1)?.args[2]);
  const [m, sec] = stat('time').split(':').map(Number);
  const passed = ['lava_lake', 'crumble', 'blink', 'spiral', 'crossfire', 'finish'];
  check(passed.every((id) => me.achieved(id)), `the bot's achievements: ${passed.filter((id) => !me.achieved(id))} missing`);
  check(me.achieved('speedrun') === m * 60 + sec < 120, `Speedrunner in ${stat('time')}: ${me.achieved('speedrun')}`);
  check(me.achieved('flawless') === (stat('falls') === '0'), `Sure-Footed with ${stat('falls')} falls: ${me.achieved('flawless')}`);
}
