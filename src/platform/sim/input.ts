import type { InputApi } from '../api/types';
import { IDLE_INPUT, type PlayerInput } from '../net/protocol';

/**
 * A player's controls for this tick, as the game (and the built-in systems after it) read them:
 * idle when the controls aren't active, and anything claimed with `consume` reads as idle for
 * the rest of the tick.
 */
export class SimInput implements InputApi {
  private state: PlayerInput = IDLE_INPUT;
  private down = new Set<string>();
  private pressedKeys = new Set<string>();
  private consumedKeys = new Set<string>();
  private consumedButtons = 0;

  /** The new tick's controls. */
  set(state: PlayerInput) {
    this.state = state;
    this.down = new Set(state.down);
    this.pressedKeys = new Set(state.pressed);
    this.consumedKeys.clear();
    this.consumedButtons = 0;
  }

  get active(): boolean {
    return this.state.active;
  }

  get yaw(): number {
    return this.state.yaw;
  }

  get pitch(): number {
    return this.state.pitch;
  }

  get viewSeq(): number {
    return this.state.viewSeq;
  }

  /** What the player's screen's item kits did with these controls, for one kind (see `PlayerInput.acts`): null when that screen doesn't run the kind (or there's no screen). */
  acts(kind: string): unknown[][] | null {
    const acts = this.state.acts;
    return acts && Object.hasOwn(acts, kind) ? acts[kind] : null;
  }

  /** The host time the player's screen was showing (others' positions), for lag-compensated hits. */
  get seen(): number | null {
    return this.state.seen ?? null;
  }

  /** A controller's left stick ([right, forward]), while it's pushed. */
  get move(): [number, number] | null {
    return this.state.active ? (this.state.move ?? null) : null;
  }

  /** The buttons held, as a bit mask (1 left, 2 middle, 4 right). */
  get buttons(): number {
    return this.state.active ? this.state.buttons & ~this.consumedButtons : 0;
  }

  isDown(code: string): boolean {
    return this.state.active && this.down.has(code) && !this.consumedKeys.has(code);
  }

  pressed(code: string, opts?: { dead?: boolean }): boolean {
    return (this.state.active || (opts?.dead === true && this.state.dead === true)) && this.pressedKeys.has(code) && !this.consumedKeys.has(code);
  }

  button(b: number): boolean {
    return this.state.active && (this.state.buttons & ~this.consumedButtons & (1 << b)) !== 0;
  }

  buttonPressed(b: number): boolean {
    return this.state.active && (this.state.clicked & ~this.consumedButtons & (1 << b)) !== 0;
  }

  consume(what: number | string) {
    if (typeof what === 'number') this.consumedButtons |= 1 << what;
    else this.consumedKeys.add(what);
  }

  get mouseX(): number {
    return this.state.active ? this.state.mouseX : 0;
  }

  get mouseY(): number {
    return this.state.active ? this.state.mouseY : 0;
  }

  get wheel(): number {
    return this.state.active ? this.state.wheel : 0;
  }
}
