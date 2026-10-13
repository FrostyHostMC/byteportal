import { games } from '../../src/games/server';
import { gameKeys, DEFAULT_KEYS } from '../../src/platform/player/keys';
import { shortLabel, touchButtons, touchHints, type TouchState } from '../../src/platform/player/touch';
import { check } from './_harness';

/** What the touch controls hold, as `TouchControls.read` gives it. */
const fingers = (t: Partial<TouchState>): TouchState => ({ held: [], move: null, sprint: false, look: [0, 0], looking: false, taps: [], ...t });

/**
 * The touch controls (phones and tablets), the parts that aren't the page's fingers: each game's
 * buttons come from its controller layout (`touch` over `gamepad`), named as it names them, short;
 * the triggers fire and aim and turn the view; switching slots is the hotbar's when it's shown;
 * the rarer jobs go in the drawer; and `Input.applyTouch` presses what the buttons stand for, walks
 * with the stick (sprinting pushed on past it) and taps hotbar slots, as a controller does.
 */
export default async function touch() {
  // Names, short.
  check(shortLabel('attack · hold to mine') === 'attack' && shortLabel('lethal (hold to cook)') === 'lethal' && shortLabel('sneak: don’t fall off edges') === 'sneak' && shortLabel('helm') === 'helm', 'short names');

  // Every game has buttons, fire among them where it shoots; none it doesn't name.
  for (const def of games) {
    const walks = (def.player?.controller ?? 'walk') === 'walk';
    const keys = def.player?.movement ? gameKeys({ sprintKeys: def.player.movement.sprintKeys ?? [DEFAULT_KEYS.sprint], crouchKeys: def.player.movement.crouchKeys ?? [DEFAULT_KEYS.crouch] }) : DEFAULT_KEYS;
    const buttons = touchButtons(def, walks, keys, walks);
    check(buttons.every((b) => b.label && b.label.length <= 40), `${def.id}: every button named: ${buttons.map((b) => b.label)}`);
    check(new Set(buttons.map((b) => `${b.slot}${b.index}`)).size === buttons.length, `${def.id}: no two in one place`);
    check(buttons.filter((b) => b.slot === 'action').length <= 3, `${def.id}: three actions at most`);
    check(touchHints(buttons, walks, walks).length >= 2, `${def.id}: hints`);
  }
  const of = (id: string) => {
    const def = games.find((g) => g.id === id)!;
    return touchButtons(def, true, DEFAULT_KEYS, true);
  };
  const cob = of('callofblocky');
  const fire = cob.find((b) => b.slot === 'fire');
  check(fire?.action === 'LMB' && fire.label === 'fire' && fire.looks, `Call of Blocky fires (and looks while firing): ${JSON.stringify(fire)}`);
  check(cob.some((b) => b.slot === 'aim' && b.action === 'RMB' && b.looks), 'and aims');
  check(cob.some((b) => b.action === 'KeyR' && b.label === 'reload') && cob.some((b) => b.action === 'KeyG' && b.label === 'lethal'), `reload and lethal at hand: ${cob.filter((b) => b.slot === 'action').map((b) => b.label)}`);
  check(!cob.some((b) => b.action === 'next'), 'no switch button: the hotbar is tapped');
  check(cob.some((b) => b.slot === 'more' && b.action === 'KeyM'), 'mode and map in the drawer');
  check(!cob.some((b) => b.action === 'Digit3'), "the katana's a hotbar slot (its touch layout takes R3 off)");
  const golf = of('golf');
  check(golf.find((b) => b.slot === 'fire')?.label === 'swing' && golf.some((b) => b.action === 'KeyE' && b.slot === 'action') && !golf.some((b) => b.slot === 'crouch'), `golf: swing, the cart at hand, no crouch: ${golf.map((b) => `${b.slot}:${b.label}`)}`);
  const starfighter = touchButtons(games.find((g) => g.id === 'starfighter')!, false, DEFAULT_KEYS, false);
  check(!starfighter.some((b) => b.slot === 'jump' || b.action === 'next') && starfighter.some((b) => b.label === 'roll left'), `starfighter: rolls, no jump, nothing to switch: ${starfighter.map((b) => b.label)}`);

  // Input acts on them (a page's Input, its window stood in for).
  const g = globalThis as unknown as Record<string, unknown>;
  const had = { window: g.window, document: g.document };
  g.window = new EventTarget();
  g.document = Object.assign(new EventTarget(), { pointerLockElement: null });
  try {
    const { Input } = await import('../../src/platform/player/input');
    const input = new Input(new EventTarget() as unknown as HTMLElement);
    input.keysFor = gameKeys({ sprintKeys: ['ShiftLeft'], crouchKeys: ['KeyC'] });
    const keys: string[] = [];
    input.onKey = (code) => keys.push(code);
    // Not driving (a menu up): nothing.
    input.applyTouch(fingers({ held: ['LMB'], move: [0, 1] }), false);
    let s = input.snapshot(true, 0, 0, 0);
    check(s.buttons === 0 && !s.move && s.down.length === 0, 'a menu up: the fingers do nothing in the game');
    // Fire held, jump pressed, the stick ahead.
    input.applyTouch(fingers({ held: ['LMB', 'jump'], move: [0, 0.8] }), true);
    s = input.snapshot(true, 0, 0, 0);
    check(s.buttons === 1 && s.clicked === 1, `fire: the left button, clicked: ${s.buttons}/${s.clicked}`);
    check(s.down.includes('Space') && s.pressed.includes('Space') && keys.includes('Space'), `jump: Space, pressed: ${s.down}`);
    check(s.move?.[1] === 0.8 && s.down.includes('KeyW'), `the stick walks (and holds W): ${JSON.stringify(s.move)}`);
    // Still held: no second click; let go: nothing.
    input.applyTouch(fingers({ held: ['LMB'], move: [0, 0.8] }), true);
    s = input.snapshot(true, 0, 0, 0);
    check(s.buttons === 1 && s.clicked === 0 && !s.pressed.includes('Space'), 'held: no second click, no second press');
    // Sprint (pushed on past the ring), crouch (the game's key), a hotbar slot tapped, switching.
    input.applyTouch(fingers({ held: ['crouch', 'next'], move: [0, 1], sprint: true, taps: ['Digit3'] }), true);
    s = input.snapshot(true, 0, 0, 0);
    check(s.down.includes('ShiftLeft') && s.down.includes('KeyC'), `sprint and crouch on the game's keys: ${s.down}`);
    check(s.pressed.includes('Digit3') && s.wheel === 1, `a slot tapped, and switched once: ${s.pressed} ${s.wheel}`);
    input.applyTouch(fingers({}), true);
    s = input.snapshot(true, 0, 0, 0);
    check(s.buttons === 0 && s.down.length === 0 && !s.move, 'let go: nothing held');
    // The device: a touch has the game without the pointer (lock and unlock as a controller's).
    let locked: boolean | null = null;
    input.onLockChange = (l) => (locked = l);
    (input as unknown as { device: string }).device = 'touch';
    input.lock();
    check(input.locked && input.touchCaptured && locked === true, 'the touch controls take the game');
    input.applyTouch(fingers({ held: ['RMB'] }), true);
    input.unlock();
    check(!input.locked && locked === false && !input.button(2), 'and let it go (and what they held)');
    console.log('  touch: buttons from each game\'s controller layout (touch over it), short names, fire/aim look, hotbar taps, a drawer; Input presses, walks, sprints, taps; lock and unlock');
  } finally {
    g.window = had.window;
    g.document = had.document;
  }
}
