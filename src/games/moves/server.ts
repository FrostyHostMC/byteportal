import { defineServer, type GameContext, type Player, type Vec3 } from '@platform';
import { melee } from '@platform/kits';
import { DASH, WALL_RUN, type DashState, type WallRunState } from './abilities';
import { FLOOR, HIGH, shared } from './shared';

interface Checkpoint extends Vec3 {
  name: string;
  /** Standing on the course past this z (and this high) reaches it. */
  from: number;
  /** A marker over the stretch ahead: what it takes. */
  hint: { at: Vec3; label: string; color: string } | null;
}

/**
 * Where each stretch of the course begins (falling off puts them back at the last one they stood
 * on), from the start along -z: a gap to dash across, a step to double-jump up, a gap between two
 * walls to wall-run, and the finish.
 */
const CHECKPOINTS: Checkpoint[] = [
  { name: 'start', x: 0.5, y: FLOOR, z: 9.5, from: Infinity, hint: { at: { x: 0.5, y: FLOOR + 1.5, z: -3 }, label: 'Dash: jump, then Q', color: '#8fd0ff' } },
  { name: 'dash', x: 0.5, y: FLOOR, z: -8.5, from: -7, hint: { at: { x: 0.5, y: HIGH + 1, z: -16.5 }, label: 'Double jump: Space again in the air', color: '#ffffff' } },
  { name: 'double jump', x: 0.5, y: HIGH, z: -18.5, from: -17, hint: { at: { x: 0.5, y: HIGH + 2, z: -31 }, label: 'Wall-run: jump along a wall holding W · Space kicks off it', color: '#ffb347' } },
  { name: 'finish', x: 0.5, y: HIGH, z: -40.5, from: -38, hint: null },
];

/** The marker over the stretch ahead of them (their own: each player sees where they're at). */
function showHint(p: Player, checkpoint: number) {
  const h = CHECKPOINTS[checkpoint].hint;
  p.hud.marker('hint', h?.at ?? null, h ? { shape: 'dot', size: 3, color: h.color, label: h.label } : undefined);
}

/** One player's run: the stretch they're on, when they left the start, and whether they're done. */
interface Run {
  checkpoint: number;
  started: number | null;
  done: boolean;
}
const runs = new Map<string, Run>();

function runOf(p: Player): Run {
  let r = runs.get(p.id);
  if (!r) runs.set(p.id, (r = { checkpoint: 0, started: null, done: false }));
  return r;
}

function toStart(p: Player) {
  const c = CHECKPOINTS[0];
  runs.set(p.id, { checkpoint: 0, started: null, done: false });
  p.teleport(c, 0, 0);
  showHint(p, 0);
}

/** The HUD: the dash's cooldown filling back up, and the wall-run's time while it lasts. */
function showMoves(p: Player) {
  const d = p.abilities.dash as DashState;
  const w = p.abilities.wallRun as WallRunState;
  const ready = 1 - d.cool / DASH.cooldown;
  p.hud.meter('dash', 'Dash (Q)', Math.round(ready * 20) / 20, { color: ready >= 1 ? '#8fd0ff' : '#50708a' });
  p.hud.meter('wallrun', 'Wall-run', w.left > 0 ? Math.round((w.left / WALL_RUN.time) * 20) / 20 : null, { color: '#ffb347' });
}

function update(game: GameContext) {
  for (const p of game.players) {
    const run = runOf(p);
    const at = p.position;
    showMoves(p);
    if (at.y < FLOOR - 14) {
      const c = CHECKPOINTS[run.checkpoint];
      p.teleport(c, 0, 0);
      p.hud.toast(`Back to the ${c.name}`);
      continue;
    }
    if (run.started === null && at.z < 0) run.started = game.clock.now;
    if (!p.onGround) continue;
    let reached = 0;
    CHECKPOINTS.forEach((c, i) => {
      if (at.z < c.from && at.y >= c.y - 0.1) reached = i;
    });
    if (reached > run.checkpoint) {
      run.checkpoint = reached;
      showHint(p, reached);
      if (reached === CHECKPOINTS.length - 1 && !run.done) {
        run.done = true;
        const time = run.started === null ? 0 : game.clock.now - run.started;
        p.hud.banner('Course complete', `${time.toFixed(2)} s`, { color: '#ffd36b' });
        p.audio.play('victory');
        game.clock.after(3, () => toStart(p));
      } else {
        p.audio.play('click');
      }
    }
  }
}

/**
 * Movement lab (a development preview, `?game=moves`): movement abilities a game defines (a dash,
 * a double jump, a wall-run with wall-jumps) on a short course that needs each of them. They're
 * pure steps the platform runs on the host and predicts on each player's own screen, so they
 * answer at once online; the game hears what they did (`ability` events) for sounds and effects.
 */
export default defineServer(shared, {
  // Nothing to use but the bare fist.
  items: [melee()],
  setup(game) {
    game.events.on('ability', ({ player, ability, name }) => {
      const at = player.position;
      if (ability === 'dash') {
        game.audio.play('whoosh', { at, volume: 0.8, pitch: 1.3 });
        game.fx.burst({ x: at.x, y: at.y + 0.9, z: at.z }, { color: '#8fd0ff', count: 16, speed: 3, size: 0.12, glow: 1, life: 0.35, drag: 3 });
      } else if (ability === 'doubleJump') {
        game.audio.play('swing', { at, pitch: 1.5 });
        game.fx.burst(at, { color: '#ffffff', count: 12, speed: 2.5, size: 0.1, life: 0.4, gravity: -2 });
      } else if (ability === 'wallRun' && name === 'start') {
        game.audio.play('whoosh', { at, volume: 0.4, pitch: 0.8 });
      } else if (ability === 'wallRun' && name === 'jump') {
        game.audio.play('swing', { at, pitch: 1.2 });
        game.fx.burst({ x: at.x, y: at.y + 0.5, z: at.z }, { color: '#ffb347', count: 12, speed: 3, size: 0.1, life: 0.4 });
      }
    });
    game.events.on('playerJoin', ({ player }) => {
      toStart(player);
      player.camera.orbit(player, { max: 10 });
    });
    game.events.on('playerLeave', ({ player }) => runs.delete(player.id));
  },

  start(game) {
    runs.clear();
    for (const p of game.players) {
      toStart(p);
      // The wheel pulls the camera out to watch the moves from behind.
      p.camera.orbit(p, { max: 10 });
    }
    game.hud.objective('Dash (Q) the gap, double-jump the step, wall-run the walls');
  },

  update,
});
