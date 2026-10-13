/**
 * Rebindable controls. The platform and every game read keys by their own codes ('KeyW', a
 * game's sprint key…), so a binding works by translation at the source: `Input` turns the key the
 * player pressed into the code its action is read by. Games, the simulation and online prediction
 * all go on seeing the codes they know and need no changes.
 *
 * Which code an action is read by is up to the game (`KeyDefaults`: a shooter sprints on Shift
 * and crouches on C, the sandbox crouches on Shift and sprints on Ctrl); the player's bindings
 * (`KeyBindings`) are theirs in every game, and the game's keys fill in the rest.
 */

export type Action = 'forward' | 'back' | 'left' | 'right' | 'jump' | 'crouch' | 'sprint';

/** The actions that can be rebound, in the order the pause menu lists them. */
export const ACTIONS: readonly { id: Action; label: string }[] = [
  { id: 'forward', label: 'Forward' },
  { id: 'back', label: 'Back' },
  { id: 'left', label: 'Left' },
  { id: 'right', label: 'Right' },
  { id: 'jump', label: 'Jump' },
  { id: 'crouch', label: 'Crouch' },
  { id: 'sprint', label: 'Sprint' },
];

/** The code a game reads each action by: its keys before the player moves any. */
export type KeyDefaults = Record<Action, string>;

/** The movement's own keys (a game's `player.movement` can move sprint and crouch). */
export const DEFAULT_KEYS: KeyDefaults = {
  forward: 'KeyW',
  back: 'KeyS',
  left: 'KeyA',
  right: 'KeyD',
  jump: 'Space',
  crouch: 'ShiftLeft',
  sprint: 'ControlLeft',
};

/** A game's keys, from its movement's sprint and crouch keys (the first of each). */
export function gameKeys(movement: { sprintKeys: string[]; crouchKeys: string[] }): KeyDefaults {
  return { ...DEFAULT_KEYS, crouch: movement.crouchKeys[0] ?? DEFAULT_KEYS.crouch, sprint: movement.sprintKeys[0] ?? DEFAULT_KEYS.sprint };
}

/** The keys the player chose: action -> key code. Actions left out keep the game's key. */
export type KeyBindings = Partial<Record<Action, string>>;

/**
 * Keys that can't be bound: Escape (pause, and cancelling a rebind), F1 and F3 (HUD and debug),
 * and Cmd / the Windows key, whose browser and system shortcuts (Cmd+W closes the tab) a page
 * can't stop.
 */
const RESERVED = new Set(['Escape', 'F1', 'F3', 'MetaLeft', 'MetaRight', 'OSLeft', 'OSRight']);

/** Left and right modifiers count as one key: binding either binds both. */
const PAIRS = ['Shift', 'Control', 'Alt'];

export function normalize(code: string): string {
  for (const p of PAIRS) if (code === `${p}Right`) return `${p}Left`;
  return code;
}

function sides(code: string): string[] {
  for (const p of PAIRS) if (code === `${p}Left`) return [code, `${p}Right`];
  return [code];
}

export function canBind(code: string): boolean {
  return code !== '' && code !== 'Unidentified' && !RESERVED.has(code);
}

/**
 * Every action's key in a game with keys `d`: the player's choices, and the game's keys for the
 * rest. A game key the player gave another action goes to the action that key came from (a swap),
 * so no two actions share a key: bind Jump to C in a game that crouches on C and Crouch takes Space.
 */
export function resolve(b: KeyBindings, d: KeyDefaults): KeyDefaults {
  const keys = { ...d };
  for (const a of ACTIONS) {
    const k = b[a.id];
    if (!k) continue;
    const had = ACTIONS.find((x) => x.id !== a.id && normalize(keys[x.id]) === k);
    if (had) keys[had.id] = keys[a.id];
    keys[a.id] = k;
  }
  return keys;
}

export function keyFor(b: KeyBindings, d: KeyDefaults, action: Action): string {
  return resolve(b, d)[action];
}

/**
 * Bind `action` to `code`. Whichever action had that key takes this one's old key instead (a
 * swap), so two actions never share a key: Sprint on Shift puts Crouch on Ctrl. Both are the
 * player's choice from then on, in every game.
 */
export function rebind(b: KeyBindings, d: KeyDefaults, action: Action, code: string): KeyBindings {
  const key = normalize(code);
  const keys = resolve(b, d);
  const next: KeyBindings = { ...b, [action]: key };
  const had = ACTIONS.find((a) => a.id !== action && normalize(keys[a.id]) === key);
  if (had) next[had.id] = normalize(keys[action]);
  return next;
}

/** Only known actions bound to plain key codes, no two on one key (settings come from storage). */
export function sanitize(raw: unknown): KeyBindings {
  const out: KeyBindings = {};
  if (!raw || typeof raw !== 'object') return out;
  const taken = new Set<string>();
  for (const a of ACTIONS) {
    const k = (raw as Record<string, unknown>)[a.id];
    if (typeof k !== 'string' || !canBind(k) || taken.has(normalize(k))) continue;
    out[a.id] = normalize(k);
    taken.add(out[a.id]!);
  }
  return out;
}

/**
 * What each physical key reads as under `b` in a game with keys `d`: the game's code for the
 * action bound to it, or null for a game key whose action has moved elsewhere. Keys not in the
 * map read as themselves.
 */
export function translation(b: KeyBindings, d: KeyDefaults): Map<string, string | null> {
  const keys = resolve(b, d);
  const moved = ACTIONS.filter((a) => normalize(keys[a.id]) !== normalize(d[a.id]));
  const m = new Map<string, string | null>();
  for (const a of moved) for (const c of sides(normalize(d[a.id]))) m.set(c, null);
  for (const a of moved) for (const c of sides(keys[a.id])) m.set(c, d[a.id]);
  return m;
}

const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

const NAMES: Record<string, string> = {
  ShiftLeft: 'Shift',
  ControlLeft: 'Ctrl',
  AltLeft: mac ? 'Option' : 'Alt',
  Space: 'Space',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  CapsLock: 'Caps Lock',
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
};

/** A key code as a player would name it: 'KeyW' -> 'W', 'ShiftLeft' -> 'Shift'. */
export function keyLabel(code: string): string {
  const c = normalize(code);
  if (NAMES[c]) return NAMES[c];
  if (c.startsWith('Key')) return c.slice(3);
  if (c.startsWith('Digit')) return c.slice(5);
  if (c.startsWith('Numpad')) return `Num ${c.slice(6)}`;
  return c;
}

/** The bound key's name for an action. */
export function actionLabel(b: KeyBindings, d: KeyDefaults, action: Action): string {
  return keyLabel(keyFor(b, d, action));
}

/** 'WASD', or whatever the four movement keys are now ('ESDF', or '↑←↓→'). */
export function moveLabel(b: KeyBindings, d: KeyDefaults): string {
  const keys = (['forward', 'left', 'back', 'right'] as const).map((a) => actionLabel(b, d, a));
  return keys.every((k) => [...k].length === 1) ? keys.join('') : keys.join(' ');
}

/**
 * A control hint written for the game's keys ('Shift', 'W / S', 'Space / Shift'), with the keys
 * the player has bound instead. Words that aren't one of the game's action keys ('LMB', 'Wheel',
 * 'E') stay.
 */
export function relabel(b: KeyBindings, d: KeyDefaults, hint: string): string {
  const keys = resolve(b, d);
  return hint.replace(/[A-Za-z]+/g, (word) => {
    const a = ACTIONS.find((x) => keyLabel(d[x.id]) === word);
    return a ? keyLabel(keys[a.id]) : word;
  });
}
