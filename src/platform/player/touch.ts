import type { GameDefinition, PadAction, PadButton } from '../api/types';
import { padBindings, padLabel } from './gamepad';

/**
 * Where a touch button sits: the trigger buttons in the right thumb's reach (`fire`, `aim`), the
 * face buttons around them (`jump`, `crouch`, then three `action`s: X and the bumpers), and the
 * rest (Y, R3, the D-pad's jobs, View's) in a drawer the "more" button opens (`more`).
 */
export type TouchSlot = 'fire' | 'aim' | 'jump' | 'crouch' | 'action' | 'more';

/** One button of the touch controls. */
export interface TouchButton {
  /** The controller button it stands for (its job is that button's). */
  pad: PadButton;
  action: PadAction;
  /** What it says (short: the first part of the game's name for it). */
  label: string;
  /** The game's whole name for it (a long press's hint). */
  title: string;
  slot: TouchSlot;
  /** Its place among the buttons in its slot (0 first). */
  index: number;
  /** A finger on it turns the view too, as it moves (fire and aim while looking about). */
  looks: boolean;
}

/** Where each controller button's job goes on a touch screen (L3 sprints by pushing the stick ahead; Start is the pause button). */
const SLOTS: [PadButton, TouchSlot][] = [
  ['RT', 'fire'],
  ['LT', 'aim'],
  ['A', 'jump'],
  ['B', 'crouch'],
  ['X', 'action'],
  ['RB', 'action'],
  ['LB', 'action'],
  ['Y', 'more'],
  ['R3', 'more'],
  ['Up', 'more'],
  ['Down', 'more'],
  ['Left', 'more'],
  ['Right', 'more'],
  ['Back', 'more'],
];

/** The most buttons in a slot (a phone has room for so many). */
const MOST: Partial<Record<TouchSlot, number>> = { action: 3, more: 8 };

/** A button's name, short: "attack · hold to mine" says "attack", "lethal (hold to cook)" "lethal", "sneak: slower, no falling" "sneak". */
export function shortLabel(label: string): string {
  return label.split(/\s+·\s+|\s*\(|:\s|\s+[—–-]\s+|,\s/)[0].trim() || label;
}

/**
 * A game's touch buttons: its controller layout's (`gamepad`, with `touch` over it), each named as
 * the controller's hints name it, those that do nothing the game mentions left off. Switching
 * slots is one button, and none when the hotbar is shown (its slots are tapped).
 */
export function touchButtons(def: Pick<GameDefinition, 'controls' | 'gamepad' | 'touch'>, walks: boolean, keys: { jump: string; crouch: string; sprint: string }, hotbar: boolean): TouchButton[] {
  const layout = { ...def.gamepad, ...def.touch };
  const bind = padBindings(layout);
  const label = padLabel({ controls: def.controls, gamepad: layout }, walks, keys);
  const out: TouchButton[] = [];
  const counts = new Map<TouchSlot, number>();
  const seen = new Set<string>();
  for (const [pad, slot] of SLOTS) {
    const action = bind[pad];
    if (!action || action === 'pause' || action === 'sprint') continue;
    const name = label(pad);
    if (!name) continue;
    // One switch button (next), and none with the hotbar's slots to tap.
    if (action === 'next' || action === 'prev') {
      if (hotbar || seen.has('switch')) continue;
      seen.add('switch');
    } else {
      if (seen.has(action)) continue;
      seen.add(action);
    }
    const n = counts.get(slot) ?? 0;
    if (n >= (MOST[slot] ?? 1)) continue;
    counts.set(slot, n + 1);
    out.push({ pad, action: action === 'prev' ? 'next' : action, label: shortLabel(name), title: name, slot, index: n, looks: slot === 'fire' || slot === 'aim' });
  }
  return out;
}

/**
 * The touch controls' hints for the home page and the pause menu: the stick and look, then the
 * buttons (those whose name says it all in one line, the rest each with the game's whole name).
 */
export function touchHints(buttons: TouchButton[], walks: boolean, hotbar: boolean): [string, string][] {
  const out: [string, string][] = walks ? [['Left thumb', 'move · push on past the ring to sprint'], ['Drag', 'look']] : [['Left thumb', 'move'], ['Drag', 'steer']];
  if (hotbar) out.push(['Tap a slot', 'pick it']);
  const plain = buttons.filter((b) => b.title === b.label && b.slot !== 'more');
  if (plain.length) out.push(['Buttons', plain.map((b) => b.label).join(' · ')]);
  for (const b of buttons) if (b.title !== b.label || b.slot === 'more') out.push([b.slot === 'more' ? `⋯ ${b.label}` : b.label, b.title]);
  out.push(['❚❚', 'pause']);
  return out;
}

/** What the touch controls hold this frame (ui/touch.ts reads the fingers; `Input` acts on it). */
export interface TouchState {
  /** The buttons' jobs held. */
  held: PadAction[];
  /** The stick: [right, forward], each -1..1 (null: no finger on it). */
  move: [number, number] | null;
  /** The stick's pushed all the way ahead: sprinting. */
  sprint: boolean;
  /** Look movement this frame, in CSS pixels ([right, down]). */
  look: [number, number];
  /** A finger is turning the view. */
  looking: boolean;
  /** Keys tapped this frame (a hotbar slot: `Digit3`). */
  taps: string[];
}
