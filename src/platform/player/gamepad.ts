import type { GameDefinition, PadAction, PadButton } from '../api/types';

/** The buttons of a standard-mapped controller (the Gamepad API's `standard` layout), by index. */
export const PAD_BUTTONS: PadButton[] = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'Back', 'Start', 'L3', 'R3', 'Up', 'Down', 'Left', 'Right'];

/**
 * What each button does unless the game says otherwise (`gamepad` on the game): the usual
 * shooter layout, which suits building too (the triggers are the mouse buttons).
 */
export const DEFAULT_PAD: Record<PadButton, PadAction> = {
  A: 'jump',
  B: 'crouch',
  X: 'KeyR',
  Y: 'next',
  LB: 'prev',
  RB: 'next',
  LT: 'RMB',
  RT: 'LMB',
  Back: 'Tab',
  Start: 'pause',
  L3: 'sprint',
  R3: 'MMB',
  Up: 'KeyE',
  Down: 'KeyF',
  Left: 'prev',
  Right: 'next',
};

/** How the buttons are drawn in hints. */
export const PAD_GLYPHS: Record<PadButton, string> = {
  A: 'A',
  B: 'B',
  X: 'X',
  Y: 'Y',
  LB: 'LB',
  RB: 'RB',
  LT: 'LT',
  RT: 'RT',
  Back: 'View',
  Start: 'Menu',
  L3: 'L3',
  R3: 'R3',
  Up: 'D-pad ↑',
  Down: 'D-pad ↓',
  Left: 'D-pad ←',
  Right: 'D-pad →',
};

/** One controller this frame: buttons held (by name), and the sticks after their dead zones. */
export interface PadState {
  down: Set<PadButton>;
  /** Left stick: x right, y forward (up), each -1..1, length at most 1. */
  move: [number, number];
  /** Right stick: x right, y down, each -1..1, shaped for aiming (fine near the middle). */
  look: [number, number];
  /** How far the right stick is pushed (0..1), before shaping. */
  lookTilt: number;
}

/** A stick's reading with a round dead zone in the middle and a little at the rim (full tilt reads 1). */
export function stick(x: number, y: number, inner: number, outer = 0.92): [number, number, number] {
  const m = Math.hypot(x, y);
  if (m <= inner) return [0, 0, 0];
  const t = Math.min(1, (m - inner) / (outer - inner));
  return [(x / m) * t, (y / m) * t, t];
}

/**
 * Reads the first controller the browser has (it shows one only after a button is pressed on
 * it, a browser rule). Null while there's none.
 */
export function readPad(): PadState | null {
  const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
  let pad: Gamepad | null = null;
  for (const p of pads) {
    if (!p || !p.connected) continue;
    if (!pad || (p.mapping === 'standard' && pad.mapping !== 'standard')) pad = p;
  }
  if (!pad) return null;
  const down = new Set<PadButton>();
  pad.buttons.forEach((b, i) => {
    const name = PAD_BUTTONS[i];
    // The triggers are analog: a light squeeze counts.
    if (name && (b.pressed || b.value > (i === 6 || i === 7 ? 0.2 : 0.5))) down.add(name);
  });
  const ax = (i: number) => (Number.isFinite(pad!.axes[i]) ? pad!.axes[i] : 0);
  const [mx, my] = stick(ax(0), ax(1), 0.16);
  const [lx, ly, tilt] = stick(ax(2), ax(3), 0.1);
  // Aiming wants fine control near the middle and speed at the rim.
  const shaped = tilt > 0 ? Math.pow(tilt, 1.7) / tilt : 0;
  return { down, move: [mx, -my], look: [lx * shaped, ly * shaped], lookTilt: tilt };
}

/** Rumble the controller, if it can (and the player hasn't turned it off). */
export function rumble(strong: number, weak: number, ms: number) {
  const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
  for (const p of pads) {
    const act = (p as (Gamepad & { vibrationActuator?: { playEffect?: (type: string, o: object) => Promise<unknown> } }) | null)?.vibrationActuator;
    if (!act?.playEffect) continue;
    act.playEffect('dual-rumble', { duration: ms, strongMagnitude: Math.min(1, strong), weakMagnitude: Math.min(1, weak) }).catch(() => {});
    return;
  }
}

/** The game's buttons over the platform's layout. */
export function padBindings(game: GameDefinition['gamepad']): Record<PadButton, PadAction> {
  const out = { ...DEFAULT_PAD };
  for (const [b, v] of Object.entries(game ?? {}) as [PadButton, PadAction | [PadAction, string] | undefined][]) {
    if (v !== undefined) out[b] = Array.isArray(v) ? v[0] : v;
  }
  return out;
}

/** Hints are listed in this order (buttons sharing a job share a hint). */
const HINT_ORDER: PadButton[] = ['RT', 'LT', 'A', 'B', 'L3', 'X', 'LB', 'RB', 'Y', 'R3', 'Up', 'Down', 'Left', 'Right', 'Back'];

/** How a key is written in a game's `controls` ('KeyL' is L, 'ShiftLeft' Shift). */
function keyName(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Shift')) return 'Shift';
  if (code.startsWith('Control')) return 'Ctrl';
  if (code.startsWith('Alt')) return 'Alt';
  return code;
}

/**
 * What each controller button does in a game, named as the game names its keys in `controls` (or
 * as it says for the button): null for a button that does nothing the game mentions. The
 * controller's hints and the touch controls' buttons (player/touch.ts) are both named by it.
 */
export function padLabel(def: Pick<GameDefinition, 'controls' | 'gamepad'>, walks: boolean, keys: { jump: string; crouch: string; sprint: string }): (b: PadButton) => string | null {
  const bind = padBindings(def.gamepad);
  const said = (b: PadButton) => {
    const v = def.gamepad?.[b];
    return Array.isArray(v) ? v[1] : null;
  };
  const named = (code: string) => {
    const name = keyName(code);
    for (const [k, v] of def.controls ?? []) if (k.split(/[\s/,·]+/).includes(name)) return v;
    return null;
  };
  return (b) => {
    const own = said(b);
    if (own) return own;
    const a = bind[b];
    if (!a || a === 'pause') return null;
    if (a === 'next' || a === 'prev') return 'switch';
    if (a === 'jump') return walks ? 'jump' : named(keys.jump);
    if (a === 'crouch') return walks ? (named(keys.crouch) ?? 'crouch') : null;
    if (a === 'sprint') return walks ? (named(keys.sprint) ?? 'sprint') : null;
    return named(a);
  };
}

/**
 * The controller's hints for the home page and the pause menu: what each button does, named as
 * the game names its keys in `controls` (or as it says for the button), buttons that do nothing
 * the game mentions left out.
 */
export function padHints(def: Pick<GameDefinition, 'controls' | 'gamepad'>, walks: boolean, keys: { jump: string; crouch: string; sprint: string }): [string, string][] {
  const bind = padBindings(def.gamepad);
  const label = padLabel(def, walks, keys);
  const groups = new Map<string, PadButton[]>();
  for (const b of HINT_ORDER) {
    const l = label(b);
    if (!l) continue;
    const g = groups.get(l) ?? [];
    if (g.length < 2) g.push(b);
    groups.set(l, g);
  }
  const out: [string, string][] = walks ? [['L stick', 'move'], ['R stick', 'look']] : [];
  for (const [l, bs] of groups) out.push([bs.map((b) => PAD_GLYPHS[b]).join(' '), l]);
  const pause = HINT_ORDER.concat('Start').find((b) => bind[b] === 'pause');
  if (pause) out.push([PAD_GLYPHS[pause], 'pause']);
  return out;
}
