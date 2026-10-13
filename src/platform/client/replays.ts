import type * as THREE from 'three';
import type { ClientEvent, ClientReplay, Me } from '../api/client';
import type { ItemDefinition } from '../api/types';
import type { Sfx } from '../audio/sfx';
import type { Effects } from '../fx/effects';
import type { ClientCommand, PresentCall, ReplayEvent, ReplayWire } from '../net/protocol';
import type { Settings } from '../settings';
import type { PlayerFrame } from '../sim/player';
import type { SimFrame } from '../sim/sim';
import { PlayerCamera } from './camera';
import { soundOf } from './present';
import { ReplayPlayback } from './replay';

/** What a replay on this screen needs of the runtime. */
export interface ReplayViewParts {
  /** The world's camera: a replay's own camera places it. */
  camera: THREE.PerspectiveCamera;
  /** The live game's first-person view: a replay's eyes settle from it and zoom as it does; it zooms back out when one ends. */
  view: PlayerCamera;
  /** The game's layer of the page: marked `replaying` while one plays. */
  ui: HTMLElement;
  fx: Effects;
  sfx: Sfx;
  /** An item as this screen has it (its own sounds). */
  item(id: string): ItemDefinition | undefined;
  /** The player's settings as they are now (the field of view, view bobbing). */
  settings(): Settings;
  /** The game's walking speed (`client.me.walkSpeed`). */
  walkSpeed: number;
  /** Which player is this client's (null: watching the game, not in it yet). */
  player(): string | null;
  /** A message to the game's server. */
  send(cmd: ClientCommand): void;
  /** Something happened for the client code. */
  emit(e: ClientEvent): void;
  /** A message from the host for the client code (the platform's own `$` names, or the game's), as the live game's come. */
  message(name: string, data: unknown): void;
  /** A call to this player's first-person view, as the live game's come. */
  viewCall(method: string, args: unknown[]): void;
  /** Rubble from damage a step brought. */
  damage(data: Uint8Array): void;
  /** `client.me` whole, from what the frame says of a player (with the item kits' word on what they hold). */
  fillMe(base: Omit<Me, 'hand' | 'held' | 'items'>, p: PlayerFrame): Me;
}

/**
 * A replay playing on this screen (`game.replay.show`): its frames are drawn in place of the live
 * game's, through its player's eyes (their own camera, `eyes`) or from its camera. The runtime asks
 * it each frame for the frame to draw (`step`), places the camera with it (`place`) and hands the
 * client code the player it follows (`me`).
 */
export class ReplayView {
  /** The replay playing (null: none). */
  private current: ReplayPlayback | null = null;
  /** The eyes of the player a replay follows: a first-person camera of its own. */
  readonly eyes: PlayerCamera;
  /**
   * When the replay last moved on (ms, the page's clock): it plays on the wall clock, as the server
   * times it, so a slow frame (whose `dt` is capped) doesn't leave it behind to be cut short.
   */
  private wall = 0;
  /** `client.replay.skip()` was called: the replay ends as the next frame starts (every kit sees `replay.end` in its `frame`). */
  private skip = false;

  constructor(private p: ReplayViewParts) {
    this.eyes = new PlayerCamera(p.camera);
  }

  /** The replay playing (null: none). */
  get playback(): ReplayPlayback | null {
    return this.current;
  }

  /** A replay is playing. */
  get playing(): boolean {
    return this.current !== null;
  }

  /** `client.replay`: the replay playing here, as client code sees it. */
  service(): ClientReplay {
    const rv = this;
    return {
      get playing() {
        return rv.current !== null;
      },
      get id() {
        return rv.current?.wire.id ?? 0;
      },
      get follow() {
        return rv.current?.wire.follow ?? null;
      },
      get label() {
        return rv.current?.wire.label ?? '';
      },
      get data() {
        return rv.current?.wire.data ?? null;
      },
      get time() {
        return rv.current?.time ?? 0;
      },
      get duration() {
        return rv.current?.duration ?? 0;
      },
      get speed() {
        return rv.current?.wire.speed ?? 1;
      },
      get hold() {
        return rv.current?.hold ?? 0;
      },
      get skippable() {
        return rv.current?.wire.skippable ?? false;
      },
      skip: () => {
        if (rv.current?.wire.skippable) rv.skip = true;
      },
    };
  }

  /** The player's settings changed: the replay's eyes see as theirs do. */
  applySettings(s: Settings) {
    this.eyes.baseFov = s.fov;
    this.eyes.viewBobbing = s.viewBobbing;
  }

  /** A replay for this screen: it plays from the next frame (one playing already gives way). */
  start(wire: ReplayWire) {
    if (wire.steps.length < 2) return;
    if (this.current) this.end(false);
    this.current = new ReplayPlayback(wire);
    this.wall = performance.now();
    this.skip = false;
    this.eyes.settleFrom(this.p.view);
    this.p.ui.classList.add('replaying');
    this.p.emit({ t: 'replay.start', label: wire.label, follow: wire.follow, data: wire.data });
  }

  /** The replay's over here: played out, ended by the server, or skipped (the server hears). */
  end(skipped: boolean) {
    const r = this.current;
    if (!r) return;
    this.current = null;
    this.skip = false;
    const player = this.p.player();
    if (skipped && player) this.p.send({ t: 'message', msg: { t: 'replaySkip', player, id: r.wire.id } });
    this.p.view.aimZoom = 1;
    this.p.ui.classList.remove('replaying');
    this.p.emit({ t: 'replay.end', label: r.wire.label, skipped });
  }

  /**
   * While a replay plays, what the live game shows in the world isn't: its effects, sounds out in
   * the world, shots, throws and fires (the item kinds' messages), and calls to our own view (it's
   * the replay's eyes now). The HUD's calls, sounds of no place and the game's own messages still come.
   */
  hides(c: PresentCall): boolean {
    if (!this.current) return false;
    switch (c.target) {
      case 'fx':
        return true;
      case 'audio':
        return c.method === 'play' && !!(c.args[1] as { at?: unknown } | undefined)?.at;
      case 'message':
        return c.kit === true || (c.method.startsWith('$') && c.method !== '$reset');
      case 'view':
        return c.method !== 'visible' && c.method !== 'setSkin';
      default:
        return false;
    }
  }

  /**
   * The replay on by this frame's time: what was shown in the steps it passed (the followed
   * player's own shots kick their hands; everyone else's fly from their figures), and the frame to
   * draw with whoever's eyes it follows in it, and whether its first frame is still standing still
   * (its `hold`). Null: none is playing, or it just ended (the live game is drawn).
   */
  step(): { frame: SimFrame; eyes: PlayerFrame | null; follow: string | null; holding: boolean } | null {
    const r = this.current;
    if (!r) return null;
    if (r.done || this.skip) {
      this.end(this.skip);
      return null;
    }
    const wall = performance.now();
    const due = r.advance(Math.min(0.5, Math.max(0, (wall - this.wall) / 1000)));
    this.wall = wall;
    const frame = r.sample();
    const follow = r.wire.follow;
    for (const e of due) this.event(e, follow);
    const eyes = follow ? (frame.players.find((p) => p.id === follow) ?? null) : null;
    return { frame, eyes, follow, holding: r.holding };
  }

  /**
   * Something shown in a replay's step, as the followed player's screen showed it: calls to
   * everyone (but those their own screen made itself: their shots, their throws), and theirs.
   */
  private event(e: ReplayEvent, follow: string | null) {
    if (e.t === 'damage') return this.p.damage(e.data);
    const c = e.call;
    if (c.to !== null && c.to !== follow) return;
    // (Messages go to the game's client code as they came: its kits tell the followed player's own shots from others'.)
    if (c.target === 'message') return this.p.message(c.method, c.args[0]);
    // Their own screen made these itself (the sound of their shot): shown from their `$shot`.
    if (c.to === null && c.skip !== undefined && c.skip === follow) return;
    switch (c.target) {
      case 'fx':
        return (this.p.fx as unknown as Record<string, (...a: unknown[]) => void>)[c.method]?.(...c.args);
      case 'audio': {
        const sound = c.method === 'play' ? soundOf(c.args[0] as string, c.args[1] as Parameters<typeof soundOf>[1], (id) => this.p.item(id)) : null;
        if (sound) this.p.sfx.play(sound[0], sound[1]);
        return;
      }
      case 'view':
        return this.p.viewCall(c.method, c.args);
    }
  }

  /** Where a replay's camera is: the followed player's eyes (first person), else its own camera. */
  place(dt: number, eyes: PlayerFrame | null) {
    const r = this.current!;
    if (eyes) {
      const v = this.eyes;
      v.yaw = eyes.view.yaw;
      v.pitch = eyes.view.pitch;
      // (Aiming zooms as client code has it: `client.camera.zoom`.)
      v.aimZoom = this.p.view.aimZoom;
      v.follow(dt, eyes);
      return;
    }
    const cam = r.wire.camera;
    if (!cam) return;
    const camera = this.p.camera;
    camera.position.set(cam.at[0], cam.at[1], cam.at[2]);
    camera.up.set(0, 1, 0);
    camera.lookAt(cam.look[0], cam.look[1], cam.look[2]);
    const fov = cam.fov ?? this.p.settings().fov;
    if (camera.fov !== fov) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
    camera.updateMatrixWorld();
  }

  /** `client.me` in a replay: the player it follows, as it shows them (their look, what they hold, their items as they were). */
  me(p: PlayerFrame): Me {
    return this.p.fillMe({
      id: p.id,
      position: { x: p.x, y: p.y, z: p.z },
      velocity: { x: p.vx, y: p.vy, z: p.vz },
      look: { yaw: p.view.yaw, pitch: p.view.pitch },
      onGround: p.onGround,
      flying: p.flying,
      crouching: p.sneaking,
      sprinting: p.sprinting,
      sliding: p.sliding,
      dead: p.dead,
      inVehicle: !!p.vehicle,
      health: p.health,
      maxHealth: p.maxHealth,
      bob: { phase: p.bob * Math.PI * 0.9, amount: this.p.settings().viewBobbing && p.onGround && !p.flying ? Math.min(1, Math.hypot(p.vx, p.vz) / 4.3) : 0 },
      thirdPerson: false,
      walkSpeed: this.p.walkSpeed,
      hotbar: p.hotbar,
      abilities: {},
    }, p);
  }
}
