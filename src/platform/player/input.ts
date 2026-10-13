import type { PadAction, PadButton } from '../api/types';
import type { PlayerInput } from '../net/protocol';
import { DEFAULT_PAD, PAD_BUTTONS, readPad } from './gamepad';
import { DEFAULT_KEYS, translation, type KeyBindings, type KeyDefaults } from './keys';
import type { TouchState } from './touch';

/** What the player plays with: a keyboard and mouse, a controller, or the touch controls (a phone or tablet). */
export type InputDevice = 'mouse' | 'pad' | 'touch';

/** Directions a controller moves through menus with (the D-pad or the left stick). */
const NAV: PadButton[] = ['Up', 'Down', 'Left', 'Right'];

/**
 * Keyboard / mouse state with pointer lock and per-frame edge detection, and a controller's
 * buttons and sticks alongside: while it drives the game its buttons press the keys and mouse
 * buttons they're bound to (and its sticks walk and look); otherwise they work the menus. The
 * touch controls (ui/touch.ts) drive the game the same way (`applyTouch`). Keys
 * are read through the player's key bindings (`setBindings`): a rebound key reads as its action's
 * default code, which is also what a controller presses.
 */
export class Input {
  /** The codes held on the keyboard, as the game reads them (after the key bindings). */
  private down = new Set<string>();
  /** Physical keys held, and the code each one reads as. */
  private held = new Map<string, string>();
  /** Physical key -> the code it reads as (null: nothing). Keys not in it read as themselves. */
  private bindings = new Map<string, string | null>();
  private pressedThisFrame = new Set<string>();
  private buttonsDown = 0;
  private buttonsPressed = 0;
  /** Buttons and keys claimed this frame (`consume`): they read as idle until the frame ends. */
  private consumedButtons = 0;
  private consumedKeys = new Set<string>();
  /** Buttons and keys that went down this frame (the page's own systems: a gun's trigger). */
  private frameButtons = 0;
  private frameKeys = new Set<string>();
  /** Mouse movement this frame (mouse look). */
  mouseDX = 0;
  mouseDY = 0;
  /** Hotbar steps from the mouse wheel (see `WheelSteps`). */
  wheel = 0;
  private wheelSteps = new WheelSteps();
  /** Mouse movement from frames that sent no `snapshot` (the host was still busy), for the next. */
  private carryDX = 0;
  private carryDY = 0;
  private sent = false;
  /** The mouse is captured (pointer lock). */
  private pointer = false;
  /** A controller has the game (no pointer lock needed: it doesn't use the mouse). */
  private padHeld = false;
  /** The touch controls have the game (a phone or tablet: no pointer lock either). */
  private touchHeld = false;
  /** When a finger last touched the screen: the mouse events a browser makes up after a tap aren't the mouse. */
  private lastTouch = -1e9;
  onLockChange: ((locked: boolean) => void) | null = null;
  /**
   * A key went down: the code it reads as, and the event itself unless a controller's button
   * pressed it or the key was rebound.
   */
  onKey: ((code: string, e?: KeyboardEvent) => void) | null = null;
  /** What was used last: `lock` captures with it, and the page shows hints for it. */
  device: InputDevice = 'mouse';
  onDevice: ((device: InputDevice) => void) | null = null;
  /**
   * A controller button went down while it isn't driving the game (menus; `Up`/`Down`/`Left`/
   * `Right` also come from the left stick, repeating while held), or its pause button at any time.
   */
  onPadButton: ((button: PadButton, action: PadAction) => void) | null = null;
  /** What each controller button does (the game's `gamepad` over the platform's layout). */
  padBindings: Record<PadButton, PadAction> = { ...DEFAULT_PAD };
  /** The keys the game reads each action by: the controller's `jump`, `crouch` and `sprint` press them, and key bindings read as them. */
  keysFor: KeyDefaults = { ...DEFAULT_KEYS };
  /** The right stick, shaped for aiming ([right, down], each -1..1), while it drives the game. */
  padLook: [number, number] = [0, 0];
  /** How far the right stick is pushed (0..1). */
  padTilt = 0;
  /** The left stick ([right, forward]), while it drives the game and is pushed. */
  private padMove: [number, number] | null = null;
  private padPrev = new Set<PadButton>();
  private padKeys = new Set<string>();
  private padMouse = 0;
  private padWheel = 0;
  private padSprint = false;
  /** Menu directions held (D-pad or stick), and when each repeats next. */
  private navHeld = new Map<PadButton, number>();
  /**
   * Whether the controller drove the game last frame. Buttons held when that changes do nothing
   * until let go (A pressing Play doesn't jump; D-pad up opening a menu doesn't move in it).
   */
  private padDrove = false;
  private padIgnore = new Set<PadButton>();
  private stickIgnore = false;
  /** The touch controls (ui/touch.ts), while they drive the game: keys and mouse buttons held, the stick, its sprint. */
  private touchKeys = new Set<string>();
  private touchMouse = 0;
  private touchMove: [number, number] | null = null;
  private touchPrev = new Set<string>();
  private touchWheel = 0;
  /** A finger is turning the view (aim assist follows a target then, as with a moving stick). */
  touchLooking = false;

  constructor(
    private target: HTMLElement,
    /** Aborting it removes every listener (the game is over). */
    signal?: AbortSignal,
  ) {
    // A phone or tablet (no mouse to hover with, a finger to point): the touch controls from the start.
    if (typeof matchMedia === 'function' && matchMedia('(hover: none) and (pointer: coarse)').matches) this.device = 'touch';
    const opts = { signal };
    // A finger: the touch controls (and the mouse events a browser makes up from a tap aren't the mouse).
    window.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch') return;
      this.lastTouch = performance.now();
      this.use('touch');
    }, { capture: true, signal });
    window.addEventListener('touchstart', () => (this.lastTouch = performance.now()), { capture: true, passive: true, signal });
    window.addEventListener('keydown', (e) => {
      const code = this.read(e.code);
      if (this.locked && (isGameKey(e.code) || (code !== null && isGameKey(code)))) e.preventDefault();
      if (e.repeat) return;
      this.use('mouse');
      if (code === null) return;
      this.held.set(e.code, code);
      this.down.add(code);
      this.pressedThisFrame.add(code);
      this.frameKeys.add(code);
      // A rebound key's event describes the physical key, not the one it stands for.
      this.onKey?.(code, code === e.code ? e : undefined);
    }, opts);
    window.addEventListener('keyup', (e) => {
      const code = this.held.get(e.code);
      if (code === undefined) return;
      this.held.delete(e.code);
      // Both Shifts can be down at once: let go of one and the other still holds.
      if (![...this.held.values()].includes(code)) this.down.delete(code);
    }, opts);
    window.addEventListener('blur', () => {
      this.releaseKeys();
      this.buttonsDown = 0;
    }, opts);
    target.addEventListener('mousedown', (e) => {
      // (A tap's made-up mousedown doesn't make the mouse the device; a real click with the pointer captured still counts.)
      if (!this.touchy) this.use('mouse');
      if (!this.pointer) return;
      this.buttonsDown |= 1 << e.button;
      this.buttonsPressed |= 1 << e.button;
      this.frameButtons |= 1 << e.button;
      e.preventDefault();
    }, opts);
    window.addEventListener('mouseup', (e) => {
      this.buttonsDown &= ~(1 << e.button);
    }, opts);
    // No browser menu on a right-click anywhere in the game: the canvas, and the menus and screens
    // over it too. On Windows the menu comes as the button goes back up, so a right-click that
    // opens a screen (a shopkeeper) would pop it over the screen. Text fields and selected text keep it.
    window.addEventListener('contextmenu', (e) => {
      if (!wantsMenu(e.target)) e.preventDefault();
    }, opts);
    window.addEventListener('mousemove', (e) => {
      if (Math.abs(e.movementX) + Math.abs(e.movementY) > 6 && !this.touchy) this.use('mouse');
      if (!this.pointer) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    }, opts);
    window.addEventListener(
      'wheel',
      (e) => {
        if (!this.pointer) return;
        this.wheel += this.wheelSteps.step(e);
      },
      { passive: true, signal },
    );
    document.addEventListener('pointerlockchange', () => {
      const was = this.locked;
      this.pointer = document.pointerLockElement === this.target;
      // The mouse took over from a controller or the touch controls (it lets go of the game when the pointer does).
      if (this.pointer) {
        this.padHeld = false;
        this.touchHeld = false;
      }
      if (!this.pointer) {
        this.releaseKeys();
        this.buttonsDown = 0;
      }
      if (this.locked !== was) this.onLockChange?.(this.locked);
    }, opts);
  }

  /** Read keys through these bindings from now on (keys held now are let go). */
  setBindings(b: KeyBindings) {
    this.bindings = translation(b, this.keysFor);
    this.releaseKeys();
  }

  private read(code: string): string | null {
    const to = this.bindings.get(code);
    return to === undefined ? code : to;
  }

  private releaseKeys() {
    this.down.clear();
    this.held.clear();
  }

  /** The game has the controls: the mouse is captured, or a controller or the touch controls have them. */
  get locked(): boolean {
    return this.pointer || this.padHeld || this.touchHeld;
  }

  /** The touch controls have the game. */
  get touchCaptured(): boolean {
    return this.touchHeld && !this.pointer;
  }

  /** A finger touched the screen a moment ago (what looks like the mouse is a tap's made-up events). */
  private get touchy(): boolean {
    return performance.now() - this.lastTouch < 1000;
  }

  /** The mouse is captured (pointer lock). */
  get pointerLocked(): boolean {
    return this.pointer;
  }

  /** A controller has the game (without the mouse). */
  get padCaptured(): boolean {
    return this.padHeld && !this.pointer;
  }

  private use(device: InputDevice) {
    if (this.device === device) return;
    this.device = device;
    this.onDevice?.(device);
  }

  /** Give the game the controls: with the controller or the touch controls if that's what was used last, else the mouse. */
  lock() {
    if (this.device === 'touch') {
      if (this.touchHeld) return;
      const was = this.locked;
      this.touchHeld = true;
      if (!was) this.onLockChange?.(true);
      return;
    }
    if (this.device === 'pad') {
      if (this.padHeld) return;
      const was = this.locked;
      this.padHeld = true;
      if (!was) this.onLockChange?.(true);
      return;
    }
    const el = this.target as HTMLElement & { requestPointerLock(o?: { unadjustedMovement?: boolean }): Promise<void> | void };
    try {
      const r = el.requestPointerLock({ unadjustedMovement: true });
      // Retry without raw input (unsupported on some platforms); give up quietly if locking isn't allowed now.
      if (r && typeof (r as Promise<void>).catch === 'function') (r as Promise<void>).catch(() => Promise.resolve(el.requestPointerLock()).catch(() => {}));
    } catch {
      el.requestPointerLock();
    }
  }

  unlock() {
    if (this.padHeld || this.touchHeld) {
      this.padHeld = false;
      this.touchHeld = false;
      this.releaseTouch();
      if (!this.pointer) this.onLockChange?.(false);
    }
    if (document.pointerLockElement) document.exitPointerLock();
  }

  /**
   * Read the controller for this frame. While it `drives` the game its buttons press their keys
   * and mouse buttons and its sticks walk and look; otherwise it works the menus (`onPadButton`).
   */
  pollPad(drives: boolean) {
    const pad = readPad();
    const now = performance.now();
    const all = pad?.down ?? new Set<PadButton>();
    const pressed = PAD_BUTTONS.filter((b) => all.has(b) && !this.padPrev.has(b));
    this.padPrev = all;
    if (drives !== this.padDrove) {
      this.padDrove = drives;
      this.padIgnore = new Set(all);
      this.stickIgnore = true;
    }
    for (const b of this.padIgnore) if (!all.has(b)) this.padIgnore.delete(b);
    const held = new Set([...all].filter((b) => !this.padIgnore.has(b)));
    if (pad && (pressed.length || Math.hypot(...pad.move) > 0.5 || pad.lookTilt > 0.5)) this.use('pad');
    const b = this.padBindings;
    for (const btn of pressed) if (b[btn] === 'pause') this.onPadButton?.(btn, 'pause');
    if (!pad || Math.hypot(...pad.move) < 0.3) this.stickIgnore = false;

    if (!pad || !drives) {
      this.releasePad();
      if (!pad) return;
      // Menus: the D-pad and the left stick move (repeating while held), the rest press.
      const dirs = new Set<PadButton>(NAV.filter((d) => held.has(d)));
      const [mx, my] = this.stickIgnore ? [0, 0] : pad.move;
      if (Math.abs(mx) > 0.6 && Math.abs(mx) > Math.abs(my)) dirs.add(mx > 0 ? 'Right' : 'Left');
      if (Math.abs(my) > 0.6 && Math.abs(my) >= Math.abs(mx)) dirs.add(my > 0 ? 'Up' : 'Down');
      for (const d of NAV) {
        if (!dirs.has(d)) {
          this.navHeld.delete(d);
          continue;
        }
        const next = this.navHeld.get(d);
        if (next === undefined || now >= next) {
          this.navHeld.set(d, now + (next === undefined ? 380 : 110));
          this.onPadButton?.(d, b[d]);
        }
      }
      for (const btn of pressed) if (held.has(btn) && !NAV.includes(btn) && b[btn] !== 'pause') this.onPadButton?.(btn, b[btn]);
      return;
    }
    this.navHeld.clear();

    // The game: each button presses what it's bound to, for as long as it's held.
    const keys = new Set<string>();
    const pressedKeys: string[] = [];
    let mouse = 0;
    const act = (a: PadAction, edge: boolean) => {
      if (!a || a === 'pause') return;
      if (a === 'next' || a === 'prev') {
        if (edge) this.padWheel += a === 'next' ? 1 : -1;
        return;
      }
      if (a === 'sprint') {
        if (edge) this.padSprint = true;
        return;
      }
      const m = a === 'LMB' ? 0 : a === 'MMB' ? 1 : a === 'RMB' ? 2 : -1;
      if (m >= 0) {
        mouse |= 1 << m;
        if (edge) {
          this.buttonsPressed |= 1 << m;
          this.frameButtons |= 1 << m;
        }
        return;
      }
      const code = a === 'jump' ? this.keysFor.jump : a === 'crouch' ? this.keysFor.crouch : a;
      keys.add(code);
      if (edge && !this.padKeys.has(code)) {
        this.pressedThisFrame.add(code);
        this.frameKeys.add(code);
        pressedKeys.push(code);
      }
    };
    for (const btn of PAD_BUTTONS) if (held.has(btn)) act(b[btn], pressed.includes(btn));

    // The left stick walks (and holds WASD for games that read the keys); sprint stays on while it points ahead.
    const [mx, my] = pad.move;
    this.padMove = mx !== 0 || my !== 0 ? [mx, my] : null;
    if (my < 0.3) this.padSprint = false;
    const stickKeys: [boolean, string][] = [[my > 0.5, 'KeyW'], [my < -0.5, 'KeyS'], [mx > 0.5, 'KeyD'], [mx < -0.5, 'KeyA']];
    for (const [on, code] of stickKeys) {
      if (!on) continue;
      keys.add(code);
      if (!this.padKeys.has(code)) this.pressedThisFrame.add(code);
    }
    if (this.padSprint) {
      const code = this.keysFor.sprint;
      if (!this.padKeys.has(code)) this.pressedThisFrame.add(code);
      keys.add(code);
    }
    this.padKeys = keys;
    this.padMouse = mouse;
    this.padLook = pad.look;
    this.padTilt = pad.lookTilt;
    // The page's own keys too (E opens the block picker).
    for (const code of pressedKeys) this.onKey?.(code);
  }

  /**
   * The touch controls this frame (ui/touch.ts). While they drive the game their buttons press what
   * they stand for (as a controller's do), the stick walks (and holds WASD for games that read the
   * keys) and, pushed all the way ahead, sprints; tapped keys (a hotbar slot) press once. Their look
   * movement is the caller's to turn (it's in pixels: see the runtime's `touchAim`).
   */
  applyTouch(t: TouchState, drives: boolean) {
    if (!drives) {
      this.releaseTouch();
      return;
    }
    const keys = new Set<string>();
    const pressedKeys: string[] = [];
    let mouse = 0;
    const held = new Set<string>();
    for (const a of t.held) {
      if (!a || a === 'pause') continue;
      held.add(a);
      const edge = !this.touchPrev.has(a);
      if (a === 'next' || a === 'prev') {
        if (edge) this.touchWheel += a === 'next' ? 1 : -1;
        continue;
      }
      const m = a === 'LMB' ? 0 : a === 'MMB' ? 1 : a === 'RMB' ? 2 : -1;
      if (m >= 0) {
        mouse |= 1 << m;
        if (edge) {
          this.buttonsPressed |= 1 << m;
          this.frameButtons |= 1 << m;
        }
        continue;
      }
      const code = a === 'jump' ? this.keysFor.jump : a === 'crouch' ? this.keysFor.crouch : a === 'sprint' ? this.keysFor.sprint : a;
      keys.add(code);
      if (edge && !this.touchKeys.has(code)) pressedKeys.push(code);
    }
    this.touchPrev = held;
    this.touchMove = t.move && (t.move[0] !== 0 || t.move[1] !== 0) ? [t.move[0], t.move[1]] : null;
    const [mx, my] = t.move ?? [0, 0];
    const stickKeys: [boolean, string][] = [[my > 0.5, 'KeyW'], [my < -0.5, 'KeyS'], [mx > 0.5, 'KeyD'], [mx < -0.5, 'KeyA']];
    for (const [on, code] of stickKeys) if (on) keys.add(code);
    if (t.sprint) keys.add(this.keysFor.sprint);
    for (const code of keys) if (!this.touchKeys.has(code)) this.pressedThisFrame.add(code);
    for (const code of pressedKeys) this.frameKeys.add(code);
    this.touchKeys = keys;
    this.touchMouse = mouse;
    this.touchLooking = t.looking;
    for (const code of t.taps) {
      this.pressedThisFrame.add(code);
      this.frameKeys.add(code);
      pressedKeys.push(code);
    }
    // The page's own keys too (E opens the block picker).
    for (const code of pressedKeys) this.onKey?.(code);
  }

  /** The stick's pushed (walking), with the touch controls driving the game. */
  get touchMoving(): boolean {
    return this.touchMove !== null;
  }

  /** The touch controls let go of everything they held in the game. */
  private releaseTouch() {
    this.touchKeys.clear();
    this.touchMouse = 0;
    this.touchMove = null;
    this.touchPrev.clear();
    this.touchLooking = false;
  }

  /** The left stick is pushed (walking), with a controller driving the game. */
  get padMoving(): boolean {
    return this.padMove !== null;
  }

  /** The controller lets go of everything it held in the game. */
  private releasePad() {
    this.padKeys.clear();
    this.padMouse = 0;
    this.padMove = null;
    this.padSprint = false;
    this.padLook = [0, 0];
    this.padTilt = 0;
  }

  isDown(code: string): boolean {
    return (this.down.has(code) || this.padKeys.has(code) || this.touchKeys.has(code)) && !this.consumedKeys.has(code);
  }

  pressed(code: string): boolean {
    return this.pressedThisFrame.has(code) && !this.consumedKeys.has(code);
  }

  button(b: number): boolean {
    return ((this.buttonsDown | this.padMouse | this.touchMouse) & ~this.consumedButtons & (1 << b)) !== 0;
  }

  buttonPressed(b: number): boolean {
    return (this.buttonsPressed & ~this.consumedButtons & (1 << b)) !== 0;
  }

  /**
   * The controls for the simulation's next tick, as plain data: what's held now, and the presses,
   * clicks, wheel and mouse movement since the last snapshot (which this starts over).
   */
  snapshot(active: boolean, yaw: number, pitch: number, viewSeq: number): PlayerInput {
    const s: PlayerInput = {
      active,
      down: this.padKeys.size || this.touchKeys.size ? [...new Set([...this.down, ...this.padKeys, ...this.touchKeys])] : [...this.down],
      pressed: [...this.pressedThisFrame],
      buttons: this.buttonsDown | this.padMouse | this.touchMouse,
      clicked: this.buttonsPressed,
      mouseX: this.carryDX + this.mouseDX,
      mouseY: this.carryDY + this.mouseDY,
      wheel: this.wheel + this.padWheel + this.touchWheel,
      yaw,
      pitch,
      viewSeq,
    };
    if (this.padMove) s.move = [...this.padMove];
    else if (this.touchMove) s.move = [...this.touchMove];
    this.pressedThisFrame.clear();
    this.buttonsPressed = 0;
    this.carryDX = 0;
    this.carryDY = 0;
    this.wheel = 0;
    this.padWheel = 0;
    this.touchWheel = 0;
    this.sent = true;
    return s;
  }

  /** A button went down this frame (whether or not a snapshot has gone since). */
  clickedThisFrame(b: number): boolean {
    return (this.frameButtons & (1 << b)) !== 0;
  }

  /** A key went down this frame. */
  keyThisFrame(code: string): boolean {
    return this.frameKeys.has(code);
  }

  /** Claim a mouse button or key for the rest of this frame. */
  consume(what: number | string) {
    if (typeof what === 'number') this.consumedButtons |= 1 << what;
    else this.consumedKeys.add(what);
  }

  /** The frame is drawn: mouse look starts over (presses and clicks wait for the next snapshot). */
  endFrame() {
    this.consumedButtons = 0;
    this.consumedKeys.clear();
    this.frameButtons = 0;
    this.frameKeys.clear();
    if (!this.sent) {
      this.carryDX += this.mouseDX;
      this.carryDY += this.mouseDY;
    }
    this.sent = false;
    this.mouseDX = 0;
    this.mouseDY = 0;
  }
}

/** A right-click here should get the browser's menu: in a text field (paste), or over selected text (copy). */
function wantsMenu(target: EventTarget | null): boolean {
  if (target instanceof Element && target.closest('input, textarea, [contenteditable]')) return true;
  return !!document.getSelection()?.toString();
}

function isGameKey(code: string): boolean {
  return code === 'Space' || code === 'Tab' || code.startsWith('Arrow') || code === 'F3' || code === 'F1' || code === 'KeyE';
}

/** What a wheel step needs of a `WheelEvent`. */
export type WheelLike = Pick<WheelEvent, 'deltaY' | 'deltaMode' | 'timeStamp'> & { deltaX?: number; shiftKey?: boolean; wheelDeltaX?: number; wheelDeltaY?: number };

/**
 * Hotbar steps from the mouse wheel. A notched wheel's click is an event of its own (in lines, or
 * a multiple of 120 in `wheelDeltaY`) and is a step each. A trackpad, or a mouse that scrolls
 * smoothly, sends a burst of small events for one flick or click (and a trackpad's momentum after
 * it): that's one step, as it starts, and another only for a fresh push inside the burst (an event
 * well bigger than the last, a moment after the last step) or a turn the other way.
 */
export class WheelSteps {
  private t = -1e9;
  private dir = 0;
  private size = 0;
  private stepped = -1e9;

  /** Steps (-1, 0 or 1) for one event. */
  step(e: WheelLike): number {
    // With Shift held (sprinting), a Mac (and Chrome on Windows) turns the wheel's scroll sideways: it's still the wheel.
    const sideways = !!e.shiftKey && !e.deltaY;
    const px = (sideways ? (e.deltaX ?? 0) : e.deltaY) * (e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 800 : 1);
    if (!(px !== 0)) return 0;
    const dir = Math.sign(px);
    const size = Math.abs(px);
    const t = e.timeStamp;
    const legacy = sideways ? e.wheelDeltaX : e.wheelDeltaY;
    const notch = e.deltaMode === 1 || (typeof legacy === 'number' && legacy !== 0 && legacy % 120 === 0);
    const fresh = t - this.t > 120 || dir !== this.dir;
    const push = size > this.size * 1.5 && t - this.stepped > 150;
    this.t = t;
    this.dir = dir;
    this.size = size;
    if (!notch && !fresh && !push) return 0;
    this.stepped = t;
    return dir;
  }
}
