import type { GameDefinition } from '../../src/platform/api/types';
import { DEFAULT_KEYS, gameKeys, rebind, relabel, resolve, sanitize, translation, type KeyBindings } from '../../src/platform/player/keys';
import { resolveMovement } from '../../src/platform/sim/movement';
import { check, games, launch } from './_harness';

/**
 * Rebindable controls: binding a key another action has swaps the two, both Shifts (or Ctrls)
 * count as one key, a game key whose action moved reads as nothing, and saved bindings are
 * cleaned up. A game's own sprint and crouch keys are its defaults (a shooter's Shift sprint and
 * C crouch), and the player's bindings follow them from game to game. Then the translation drives
 * a real player: with Sprint on Shift and Crouch on Ctrl, holding Shift sprints and holding Ctrl
 * crouches; in a game that sprints on Shift and crouches on C, Sprint moved to Q sprints on Q.
 */
export default function keys() {
  const d = DEFAULT_KEYS;
  // Sprint to Shift: Crouch takes Ctrl.
  const swapped = rebind({}, d, 'sprint', 'ShiftRight');
  check(swapped.sprint === 'ShiftLeft' && swapped.crouch === 'ControlLeft', `swap: ${JSON.stringify(swapped)}`);
  const t = translation(swapped, d);
  check(t.get('ShiftLeft') === 'ControlLeft' && t.get('ShiftRight') === 'ControlLeft', 'either Shift reads as sprint');
  check(t.get('ControlLeft') === 'ShiftLeft' && t.get('ControlRight') === 'ShiftLeft', 'either Ctrl reads as crouch');
  check(!t.has('KeyW') && !t.has('Space'), 'keys nobody moved read as themselves');

  // Back to the game's key: nothing reads differently.
  check(translation(rebind(swapped, d, 'sprint', 'ControlLeft'), d).size === 0, 'swapping back leaves every key as it is');

  // Forward to E: E reads as W, and W reads as nothing.
  const esdf = rebind({}, d, 'forward', 'KeyE');
  const te = translation(esdf, d);
  check(te.get('KeyE') === 'KeyW' && te.get('KeyW') === null, 'a moved action leaves its old key idle');

  // Games' control hints follow the bindings, word by word.
  check(relabel(swapped, d, 'Ctrl') === 'Shift' && relabel(swapped, d, 'Space / Shift') === 'Space / Ctrl', 'hints name the bound keys');
  check(relabel(esdf, d, 'W / S') === 'E / S' && relabel(esdf, d, 'Wheel') === 'Wheel' && relabel(esdf, d, 'LMB') === 'LMB', 'other words in hints stay');

  // A shooter's keys: sprint on Shift, crouch on C.
  const shooter = gameKeys({ sprintKeys: ['ShiftLeft', 'ShiftRight'], crouchKeys: ['KeyC'] });
  check(shooter.sprint === 'ShiftLeft' && shooter.crouch === 'KeyC' && shooter.forward === 'KeyW', `a game's own keys (${JSON.stringify(shooter)})`);
  const q = rebind({}, shooter, 'sprint', 'KeyQ');
  const tq = translation(q, shooter);
  check(tq.get('KeyQ') === 'ShiftLeft' && tq.get('ShiftLeft') === null && tq.get('ShiftRight') === null && !tq.has('KeyC'), 'Sprint on Q reads as the game’s sprint key; Shift reads as nothing');
  check(relabel(q, shooter, 'Shift') === 'Q' && relabel(q, shooter, 'C') === 'C', 'the game’s hints follow its own keys');
  // Jump to C there: Crouch takes Space.
  const jc = resolve(rebind({}, shooter, 'jump', 'KeyC'), shooter);
  check(jc.jump === 'KeyC' && jc.crouch === 'Space', `taking a game's key swaps in that game (${JSON.stringify(jc)})`);

  // Bindings go from game to game: made in one, they settle against the next one's keys.
  const crouchOnC = rebind({}, d, 'crouch', 'KeyC');
  check(resolve(crouchOnC, shooter).crouch === 'KeyC' && translation(crouchOnC, shooter).size === 0, 'Crouch on C is the shooter’s own key: nothing to translate');
  const sprintOnC = resolve(rebind({}, d, 'sprint', 'KeyC'), shooter);
  check(sprintOnC.sprint === 'KeyC' && sprintOnC.crouch === 'ShiftLeft', `a choice that clashes with a game's key swaps with it (${JSON.stringify(sprintOnC)})`);
  // A choice the game's keys already match is kept for the next game.
  const kept = rebind(crouchOnC, shooter, 'jump', 'KeyV');
  check(resolve(kept, d).crouch === 'KeyC', `a choice stays after rebinding in a game it matches (${JSON.stringify(kept)})`);

  // Saved bindings: unknown actions, reserved keys and junk dropped, clashes settled.
  const clean = sanitize({ sprint: 'ShiftLeft', crouch: 'ShiftLeft', jump: 'Escape', fly: 'KeyF', back: 7 });
  check(clean.sprint !== clean.crouch, `no two actions share a key after loading (${JSON.stringify(clean)})`);
  check(clean.jump === undefined && !('fly' in clean) && clean.back === undefined, 'reserved keys and junk are dropped');
  check(Object.keys(sanitize('nonsense')).length === 0 && Object.keys(sanitize(null)).length === 0, 'junk loads as no bindings');

  // What the player's own keys do, through the translation, on a real walking player.
  const hunt = games.find((g) => g.id === 'heart-hunt')!;
  const speed = (def: GameDefinition, b: KeyBindings, physical: string[]) => {
    const h = launch(def, { seed: 2 });
    const me = h.ctx.player;
    h.run(1); // settle on the ground
    const map = translation(b, gameKeys(resolveMovement(def.player?.movement)));
    const down = physical.map((k) => (map.has(k) ? map.get(k) : k)).filter((k): k is string => !!k);
    const a = { ...me.position };
    // Away from the pedestal at the spawn, across the flattened ground.
    h.run(1.5, { pilot: () => ({ down, yaw: Math.PI, pitch: 0 }) });
    return Math.hypot(me.position.x - a.x, me.position.z - a.z) / 1.5;
  };
  const walk = speed(hunt, {}, ['KeyW']);
  const sprintOnShift = speed(hunt, swapped, ['KeyW', 'ShiftLeft']);
  const crouchOnCtrl = speed(hunt, swapped, ['KeyW', 'ControlLeft']);
  const defaultShift = speed(hunt, {}, ['KeyW', 'ShiftLeft']);
  check(sprintOnShift > walk * 1.2, `Shift should sprint once it's bound to sprint (${sprintOnShift.toFixed(2)} vs walking ${walk.toFixed(2)} m/s)`);
  check(crouchOnCtrl < walk * 0.6, `Ctrl should crouch once it's bound to crouch (${crouchOnCtrl.toFixed(2)} m/s)`);
  check(defaultShift < walk * 0.6, `by default Shift still crouches (${defaultShift.toFixed(2)} m/s)`);
  // The same game made a shooter: Sprint moved to Q sprints on Q, and Shift no longer does.
  const shooting: GameDefinition = { ...hunt, player: { ...hunt.player, movement: { ...hunt.player?.movement, sprintKeys: ['ShiftLeft', 'ShiftRight'], crouchKeys: ['KeyC'] } } };
  const sprintOnQ = speed(shooting, q, ['KeyW', 'KeyQ']);
  const shiftAfterQ = speed(shooting, q, ['KeyW', 'ShiftLeft']);
  check(sprintOnQ > walk * 1.2, `Q should sprint in a shooter once Sprint is on Q (${sprintOnQ.toFixed(2)} m/s)`);
  check(Math.abs(shiftAfterQ - walk) < walk * 0.1, `Shift should just walk there then (${shiftAfterQ.toFixed(2)} m/s)`);
  console.log(`  walk ${walk.toFixed(2)} · Shift→sprint ${sprintOnShift.toFixed(2)} · Ctrl→crouch ${crouchOnCtrl.toFixed(2)} · shooter Q→sprint ${sprintOnQ.toFixed(2)} m/s`);
}
