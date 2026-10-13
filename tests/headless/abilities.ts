import { readFileSync } from 'node:fs';
import type { BlockRef, GameDefinition, MovementAbility } from '../../src/platform/api/types';
import moves from '../../src/games/moves/server';
import { roll } from '../../src/games/highnoon/abilities';
import { Predictor } from '../../src/platform/client/predict';
import { GameHost, GeneratedWorld } from '../../src/platform/host/game';
import { worldGenConfig } from '../../src/platform/workers/config';
import { quantize } from '../../src/platform/net/delta';
import type { HostBatch, PlayerInput } from '../../src/platform/net/protocol';
import { SimInput } from '../../src/platform/sim/input';
import { freshMemory, NO_MODS, resolveMovement, stepMovement } from '../../src/platform/sim/movement';
import { worldQuery } from '../../src/platform/sim/worldquery';
import { loadRegistry } from '../../src/platform/world/registry';
import { check } from './_harness';

/**
 * Movement abilities are predicted: a client runs the movement lab's course (`?game=moves`) at 60
 * frames a second with 100 ms of latency (the server's frames rounded as a socket carries them),
 * predicting on its own copy of the world: it dashes across the first gap, double-jumps up the
 * step, wall-runs, wall-jumps to the other wall and back, and lands on the finish, steering by
 * what its own screen shows, as a player would. The server's word should barely move it, however
 * much the abilities throw the body about. A second client that doesn't know the abilities, fed
 * the same inputs and frames, shows what the corrections would be without them. And an ability
 * that does nothing leaves walking exactly as it was.
 */
export default function abilities() {
  predicted();
  neutral();
  body();
}

function predicted() {
  const def = moves;
  const host = new GameHost(def, { engine: readFileSync('engine/pkg/voxel_engine_bg.wasm'), seed: 7, remote: true, radius: 3, budget: Infinity });
  const registry = loadRegistry();
  const mine = new GeneratedWorld(host.seed, worldGenConfig(def, (b: BlockRef) => (typeof b === 'number' ? b : registry.byName.get(b)!.id)));
  const heard: Record<string, number> = {};
  host.sim.ctx.events.on('ability', ({ ability, name }) => {
    heard[`${ability} ${name}`] = (heard[`${ability} ${name}`] ?? 0) + 1;
  });
  const ann = host.connect('Ann');
  host.command(ann.id, { t: 'start' });
  const me = host.sim.players[0];
  const tune = resolveMovement(def.player!.movement);
  const predictor = new Predictor(mine.world, tune, () => NO_MODS, worldQuery(mine.world, registry));
  // The same client, not knowing the abilities: the host's word is all it has of them.
  const unaware = new Predictor(mine.world, resolveMovement({ ...def.player!.movement, abilities: {} }));

  const late: HostBatch[] = [];
  const done = new Set<string>();
  /** Once, the first time `when` holds: the moment to press. */
  const once = (key: string, when: boolean) => (when && !done.has(key) ? (done.add(key), true) : false);
  let worst = 0;
  let sum = 0;
  let n = 0;
  let unawareWorst = 0;
  let finished = -1;
  for (let frame = 0; frame < 60 * 12 && (finished < 0 || frame < finished + 30); frame++) {
    mine.update([me.state], 3, Infinity);
    const p = predictor.shown();
    const down = ['KeyW', 'ShiftLeft'];
    const pressed: string[] = [];
    let yaw = 0;
    const press = (code: string) => {
      pressed.push(code);
      down.push(code);
    };
    if (p && frame > 20) {
      const air = !p.onGround;
      // The start: a running jump off the edge, and a dash in the air carries it over the gap.
      if (once('jump off the start', p.onGround && p.z < 0.7 && p.z > 0)) press('Space');
      if (once('dash', air && p.z < -0.6 && p.z > -3)) press('KeyQ');
      // Two blocks up: a jump, and a second at its top.
      if (once('jump at the step', p.onGround && p.z < -15.1 && p.z > -17)) press('Space');
      if (once('double jump', done.has('jump at the step') && air && p.vy < 1 && p.z > -18)) press('Space');
      // Along the right-hand wall, off the edge: it catches the wall.
      if (p.y > 65.5 && p.z < -17 && p.z > -25) yaw = p.x < 2.3 ? -0.5 : 0;
      if (once('jump onto the wall', p.onGround && p.y > 65.5 && p.z < -24.4)) press('Space');
      // A wall-jump across to the left-hand wall, which catches them; and off it onto the finish.
      if (once('wall-jump left', air && p.z < -28.5 && p.x > 2)) press('Space');
      if (once('wall-jump right', air && p.z < -35 && p.x < -1)) press('Space');
      if (p.onGround && p.y > 65.5 && p.z < -38) {
        down.length = 0;
        if (finished < 0) finished = frame;
      }
    }
    const input: PlayerInput = { active: true, down, pressed, buttons: 0, clicked: 0, mouseX: 0, mouseY: 0, wheel: 0, yaw, pitch: 0, viewSeq: me.viewSeq };
    predictor.step(input, 1 / 60, frame + 1);
    unaware.step(input, 1 / 60, frame + 1);
    host.command(ann.id, { t: 'input', input, seq: frame + 1, dt: 1 / 60 });
    if (frame % 2 === 1) {
      late.push(host.step(1 / 30).get(ann.id)!);
      // Three steps (100 ms) of latency.
      if (late.length > 3) {
        const f = late.shift()!.frame!;
        // Rounded as a socket carries it (to 1e-4): the abilities' timers too.
        const them = quantize(f.players.find((q) => q.id === ann.id)!);
        predictor.reconcile(them);
        unaware.reconcile(them);
        if (frame > 60) {
          worst = Math.max(worst, predictor.lastCorrection);
          sum += predictor.lastCorrection;
          n++;
          unawareWorst = Math.max(unawareWorst, unaware.lastCorrection);
        }
      }
    }
  }
  const s = me.state;
  const moved = Object.entries(heard)
    .map(([k, v]) => `${k} ×${v}`)
    .join(', ');
  console.log(`  the course with 100 ms latency (${moved}): corrections average ${(sum / n).toFixed(5)}, worst ${worst.toFixed(5)} blocks; without predicting the abilities, worst ${unawareWorst.toFixed(2)} · ended at ${s.x.toFixed(1)}, ${s.y.toFixed(1)}, ${s.z.toFixed(1)}`);
  for (const k of ['dash dash', 'doubleJump jump', 'wallRun start', 'wallRun jump']) check(heard[k], `the host never heard "${k}" (heard: ${moved || 'nothing'})`);
  check((heard['wallRun start'] ?? 0) >= 2 && (heard['wallRun jump'] ?? 0) >= 2, `two wall-runs and two wall-jumps: ${moved}`);
  check(finished > 0 && s.z < -37 && s.y > 65.5, `should have finished the course: at ${s.x.toFixed(2)}, ${s.y.toFixed(2)}, ${s.z.toFixed(2)}`);
  check(worst < 0.01, `prediction drifted: worst correction ${worst}`);
  check(unawareWorst > 0.5, `without the abilities, prediction should have been corrected a lot: ${unawareWorst}`);
}

/** Two bodies walk, sprint, turn and jump side by side on the same inputs, one with an ability that does nothing: they never differ. */
function neutral() {
  const def = moves;
  const registry = loadRegistry();
  const w = new GeneratedWorld(7, worldGenConfig(def, (b: BlockRef) => (typeof b === 'number' ? b : registry.byName.get(b)!.id)));
  w.update([{ x: 0, z: 0 }], 3, Infinity);
  const plain = resolveMovement({ ...def.player!.movement, abilities: {} });
  const idle = resolveMovement({ ...def.player!.movement, abilities: { idle: { state: { steps: 0 }, step: (s: { steps: number }) => void s.steps++ } } });
  const bodies = [plain, idle].map((tune) => {
    const slot = w.world.player_add(0.5, 64, 9.5);
    w.world.player_tune(slot, new Float64Array(tune.params));
    return { slot, tune, memory: freshMemory() };
  });
  const input = new SimInput();
  const query = worldQuery(w.world, registry);
  let differ = 0;
  for (let frame = 0; frame < 60 * 6; frame++) {
    const t = frame / 60;
    input.set({
      active: true,
      down: ['KeyW', ...(frame % 200 > 100 ? ['ShiftLeft'] : []), ...(frame % 50 < 8 ? ['Space'] : [])],
      pressed: frame % 50 === 0 ? ['Space'] : [],
      buttons: 0,
      clicked: 0,
      mouseX: 0,
      mouseY: 0,
      wheel: 0,
      yaw: Math.sin(t * 0.9) * 0.4,
      pitch: 0,
      viewSeq: 0,
    });
    for (const b of bodies) stepMovement(w.world, b.slot, input, input.yaw, false, b.memory, 1 / 60, b.tune, NO_MODS, 0, query);
    const [a, b] = bodies.map((x) => w.world.player_state(x.slot));
    if (a.some((v, i) => v !== b[i])) differ++;
  }
  const at = w.world.player_state(bodies[0].slot);
  console.log(`  6 s of walking, sprinting and jumping with an ability that does nothing: ${differ} steps differ from none (ended at ${at[0].toFixed(1)}, ${at[1].toFixed(1)}, ${at[2].toFixed(1)})`);
  check(differ === 0, `an ability that does nothing changed walking in ${differ} steps`);
  check((bodies[1].memory.abilities?.idle as { steps: number }).steps === 60 * 6, 'the idle ability stepped every step');
}

/**
 * What an ability does to the body beyond moving it: High Noon's dodge roll goes low
 * (`body.stance`) and tips the roller's camera (`body.camera`), and a wave plays a clip on their
 * figure (`trigger(name, { clip })`). With 100 ms of latency, the roller's own screen is low, tipped
 * and waving from the very input (before the host has heard), the host agrees (their hitbox and
 * figure are low, everyone's screen gets the clip, their frame carries the camera for a screen that
 * doesn't predict), the clip starts once per wave however often the input is replayed, and the
 * prediction still holds exactly.
 */
function body() {
  const wave: MovementAbility<{ cool: number }> = {
    state: { cool: 0 },
    step(s, c, b, dt) {
      s.cool = Math.max(0, s.cool - dt);
      if (c.pressed('KeyE') && s.cool === 0) {
        s.cool = 1;
        b.trigger('wave', { clip: 'wave', layer: 'upper' });
      }
    },
  };
  const def: GameDefinition = {
    id: 'body-test',
    title: 'Body',
    world: { terrain: 'void', ground: { y: 40 }, spawn: { x: 0.5, y: 41, z: 0.5 }, seed: 5 },
    player: { movement: { crouchKeys: ['KeyC'], abilities: { roll, wave } } },
  };
  const host = new GameHost(def, { engine: readFileSync('engine/pkg/voxel_engine_bg.wasm'), seed: 5, remote: true, radius: 2, budget: Infinity });
  const registry = loadRegistry();
  const mine = new GeneratedWorld(host.seed, worldGenConfig(def, (b: BlockRef) => (typeof b === 'number' ? b : registry.byName.get(b)!.id)));
  const ann = host.connect('Ann');
  host.command(ann.id, { t: 'start' });
  const me = host.sim.players[0];
  const predictor = new Predictor(mine.world, resolveMovement(def.player!.movement), () => NO_MODS, worldQuery(mine.world, registry));
  const late: HostBatch[] = [];
  const presses: Record<number, string> = { 40: 'KeyQ', 70: 'KeyE', 190: 'KeyQ', 230: 'KeyE' };
  let worst = 0;
  let lowAtOnce = false;
  let tippedAtOnce = false;
  let hostLow = 0;
  let hostTilt = 0;
  let predictedLow = 0;
  let clips = 0;
  const hostClips = new Set<number>();
  let clipName = '';
  for (let frame = 0; frame < 300; frame++) {
    mine.update([me.state], 2, Infinity);
    const press = presses[frame];
    const input: PlayerInput = { active: true, down: ['KeyD', ...(press ? [press] : [])], pressed: press ? [press] : [], buttons: 0, clicked: 0, mouseX: 0, mouseY: 0, wheel: 0, yaw: 0, pitch: 0, viewSeq: me.viewSeq };
    predictor.step(input, 1 / 60, frame + 1);
    // The press's own frame: low and tipped here already, the host yet to hear of it.
    if (frame === 40) {
      lowAtOnce = !!predictor.shown()?.sliding && !me.sliding;
      tippedAtOnce = (predictor.tilt?.[0] ?? 0) !== 0;
    }
    if (predictor.shown()?.sliding) predictedLow++;
    clips += predictor.takeClips().filter((c) => c.name === 'wave').length;
    host.command(ann.id, { t: 'input', input, seq: frame + 1, dt: 1 / 60 });
    if (frame % 2 === 1) {
      const b = host.step(1 / 30).get(ann.id)!;
      const f = b.frame!.players.find((q) => q.id === me.id)!;
      if (f.sliding) hostLow++;
      if (f.tilt) hostTilt++;
      if (f.clip) {
        hostClips.add(f.clip.seq);
        clipName = f.clip.name;
      }
      late.push(b);
      if (late.length > 3) {
        predictor.reconcile(quantize(late.shift()!.frame!.players.find((q) => q.id === me.id)!));
        if (frame > 30) worst = Math.max(worst, predictor.lastCorrection);
      }
    }
  }
  console.log(
    `  two rolls and two waves with 100 ms latency: low on their own screen ${predictedLow} frames (from the press: ${lowAtOnce}), on the host ${hostLow} steps; camera tipped at once: ${tippedAtOnce}, in ${hostTilt} host frames; clips started here ${clips}, on the host ${hostClips.size} (${clipName}); worst correction ${worst.toFixed(5)}`,
  );
  check(lowAtOnce && tippedAtOnce, `the roll should lower and tip their own screen on the press's frame (low ${lowAtOnce}, tipped ${tippedAtOnce})`);
  check(hostLow >= 16 && hostLow <= 24, `the host should have them low through both rolls (~20 steps): ${hostLow}`);
  check(predictedLow >= 34 && predictedLow <= 46, `their screen should show them low through both rolls (~40 frames): ${predictedLow}`);
  check(hostTilt >= 14, `the host's frames should carry the camera through the rolls: ${hostTilt}`);
  check(clips === 2, `each wave's clip should start once on their screen, not again on replays: ${clips}`);
  check(hostClips.size === 2 && clipName === 'wave', `the host should play both waves on their figure: ${[...hostClips]} ${clipName}`);
  check(worst < 0.01, `rolling and waving shouldn't upset prediction: worst correction ${worst}`);
  check(!me.sliding && !me.sneaking && !predictor.tilt, 'standing again, the camera level, after the rolls');
}
