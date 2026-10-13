import * as THREE from 'three';
import type { VoxelWorld } from '@engine/voxel_engine.js';
import type { Bot, BotControls, CameraApi, GameContext, GameEvents, ItemStack, ModelSpec, OrbitOptions, Player, PlayerAccount, PlayerOptions, Prop, StoreApi, Vec3, VehicleDefinition, VehicleWorld } from '../api/types';
import type { Uniform } from '../character/look';
import { IDLE_INPUT, type PlayerInput } from '../net/protocol';
import type { ItemHost, ItemKind, Penetration } from '../api/items';
import { ItemRunner } from './itemrun';
import type { BulletHit } from './hitscan';
import { clipFrame, type ClipFrame, type EntitySim } from './entities';
import { PlayerHealth } from './health';
import { SimInput } from './input';
import { Inventory, type ItemSim } from './items';
import type { Presentation } from './present';
import type { CreativeBuild } from './creative';
import { abilityStates, copyMemory, freshMemory, resolveMovement, stepMovement, type MoveMemory, type MoveTune } from './movement';
import type { AbilityCamera, AbilityEvent } from './abilities';
import { leanOffset } from './hitboxes';
import type { PropState } from './props';
import { VehicleSim } from './vehicle';

const EYE = 1.62;
const SNEAK_EYE = 1.27;
/** A number, or the fallback for anything else (a game's options, to keep the frame clean). */
const finiteOr = (v: unknown, or: number) => (typeof v === 'number' && Number.isFinite(v) ? v : or);

/** One player as their client draws them (camera, hand, hearts, hotbar). */
export interface PlayerFrame {
  id: string;
  name: string;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  onGround: boolean;
  inWater: boolean;
  eyesInWater: boolean;
  inLava: boolean;
  flying: boolean;
  /** Walk-cycle phase for view bobbing. */
  bob: number;
  sneaking: boolean;
  sprinting: boolean;
  /** Sliding (`movement.slide`). */
  sliding: boolean;
  /**
   * How far their head leans out sideways (blocks, positive to the right of their view: a movement
   * ability's `lean`); left out when upright. Their eyes, head hitbox and figure go with it.
   */
  lean?: number;
  /** Their movement speed multiplier (`player.speed`): prediction moves them the same. */
  speed: number;
  /** A bot (`game.bots`), not a person. */
  bot: boolean;
  /** Where the simulation last turned them (it counts up each time: `teleport` with a view, spawn). */
  view: { seq: number; yaw: number; pitch: number };
  health: number;
  maxHealth: number;
  /** Damage is on (the hearts show). */
  mortal: boolean;
  dead: boolean;
  /** Seconds since dying. */
  deathTime: number;
  /** The items hotbar (item games). */
  hotbar: { slots: (ItemStack | null)[]; selected: number } | null;
  /** The held item's state, as its kind shows it to everyone (`ItemKind.shown`: a gun's rounds, its aim, a reload), or null. */
  hand: { state: object | null };
  /** What their own screen gets from each item kind (`ItemKind.own`: a throw's serial, a sword's readiness), by kind. */
  items?: Record<string, object>;
  /**
   * The game's camera (`controller: 'none'`), or, `follow`ing, the vehicle's (the client works it
   * out from the vehicle's state, every frame).
   */
  camera: { p: [number, number, number]; q: [number, number, number, number]; fov: number; follow: boolean };
  /**
   * Their vehicle (`player.drive`): which one, its state (their client predicts from it), its
   * model, and whether they steer it from afar (`remote`: their body stays on show where it was).
   */
  vehicle: { name: string; state: object; prop: number | null; remote?: boolean } | null;
  /** Creative building (`player.build`): the block hotbar. */
  creative: { hotbar: number[]; selected: number } | null;
  /** Physics is off (before play, dead, a game-driven camera). */
  frozen: boolean;
  /** Watching, not playing (`player.spectate`): other screens don't draw them; their own flies them through anything. */
  spectating?: boolean;
  /** Their weapons are locked (`freeze(true, { weapons: true })`): their screen fires nothing. */
  locked: boolean;
  /**
   * Their camera's tilt from a movement ability this step ([roll, pitch, dip], `AbilityBody.camera`),
   * for their own screen when it doesn't predict (a predicting one works it out itself).
   */
  tilt?: [number, number, number];
  canFly: boolean;
  /** Swings and uses so far (a change swings the arm of their figure on other screens). */
  swings: number;
  /** For client-side prediction: the last input of theirs applied, and movement's memory then. */
  ack: number;
  move: MoveMemory;
  /**
   * Seconds their state trails the frame (a server plays whole inputs, and the time left over is
   * owed to them): other screens draw them this much further on, at their velocity.
   */
  lead: number;
  /** Their figure's skin (`player.setSkin`), or null for the game's. */
  skin: { uv: [number, number]; atlas?: string } | null;
  /** Their figure's model (`player.setModel`), or null for the game's. */
  model: ModelSpec | null;
  /** Their name's colour above their figure. */
  color: string | null;
  /** Their avatar's code (`avatarCode`): who they are in a game that doesn't dress its players itself (none: the platform's plain person). */
  avatar?: string;
  /** What the game dresses their avatar in (`player.setUniform`). */
  uniform?: Uniform;
  /** The cosmetics they wear (ids across the platform); each screen shows those its game shows. */
  wear?: string[];
  /** A clip their figure plays (`player.animate`). */
  clip?: ClipFrame | null;
  /** The solid prop they ride (`player.riding`), and where their feet are on it (its own space). */
  ride: { prop: number; p: [number, number, number] } | null;
  /**
   * Third person (`camera.orbit`): what the camera circles (a prop or a player, by id), the point
   * on it, and the wheel's range. `seq` counts up each time the game sets it (their screen then
   * starts from `distance`; the wheel is theirs after that).
   */
  orbit: { seq: number; prop?: number; player?: string; offset: [number, number, number] | null; distance: number; min: number; max: number; shoulder?: [number, number]; wheel?: false } | null;
}

export interface PlayerSimParts {
  id: string;
  name: string;
  world: VoxelWorld;
  options: PlayerOptions;
  /** The game's item kinds (`items`), by kind, and what they get of the simulation. */
  kinds: ReadonlyMap<string, ItemKind>;
  itemHost: ItemHost;
  /** The game's vehicles, and the world as they see it. */
  vehicles: Record<string, VehicleDefinition>;
  query: VehicleWorld;
  present: Presentation;
  entities: EntitySim;
  items: ItemSim;
  /** Props by id (what they ride). */
  props: { byId(id: number): Prop | null };
  /** A bullet's path from this player (see `castBullet`), through walls with `pen`. */
  bullet(from: Vec3, dir: Vec3, range: number, seen: number | null, shooter: Player, pen: Penetration | null): BulletHit;
  ctx(): GameContext;
  emit<K extends keyof GameEvents>(event: K, e: GameEvents[K]): void;
  /** Host time (`SimFrame.t`). */
  now(): number;
  /** `player.achieve`: award one of the game's achievements (true the first time). */
  achieve(p: PlayerSim, id: string): boolean;
  /** `player.grant`: give one of the game's cosmetics. */
  grant(p: PlayerSim, id: string): boolean;
}

/**
 * A player in the simulation: moves from their controls (physics in WebAssembly), takes damage,
 * fights, carries a hotbar, and is the `Player` games see (`api`).
 */
export class PlayerSim {
  readonly id: string;
  name: string;
  /** Their physics body in the engine's world. */
  readonly slot: number;
  readonly walker: boolean;
  readonly itemMode: boolean;
  yaw = 0;
  pitch = 0;
  allowFlight: boolean;
  sneaking = false;
  sprinting = false;
  sliding = false;
  /** How far their head leans out sideways (see `PlayerFrame.lean`). */
  lean = 0;
  /** Movement speed multiplier (`player.speed`). */
  speedMul = 1;
  /** How they move (the game's `player.movement`). */
  readonly tune: MoveTune;
  /** A bot's controls (`game.bots`); null for a person. */
  bot: BotControlsImpl | null = null;
  readonly state = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, onGround: false, inWater: false, eyesInWater: false, inLava: false, flying: false, bob: 0, frozen: false, ride: 0, rideX: 0, rideY: 0, rideZ: 0 };
  readonly input = new SimInput();
  readonly inventory: Inventory;
  readonly health: PlayerHealth;
  /** Their items: the hotbar slot, and each item kind's step (see `ItemRunner`). */
  readonly items: ItemRunner;
  /** The game's camera, for `controller: 'none'`. */
  readonly cam = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), fov: 70 };
  private seq = 0;
  /** Double-tap state for sprinting and flying, the slide, the game's movement abilities. */
  private memory = freshMemory();
  /** What their movement abilities triggered since the game last heard. */
  private abilityEvents: AbilityEvent[] = [];
  /** The camera their movement abilities asked for on the last step (see `PlayerFrame.tilt`). */
  private tilt: AbilityCamera | null = null;
  /** The game froze them (`freeze(true)`): it holds when they press Play. */
  held = false;
  /** The game's freeze locks their weapons too (`freeze(true, { weapons: true })`). */
  private lockWeapons = false;
  /** Watching, not playing (`player.spectate`). */
  spectating = false;
  /** The last input applied, by the client's count (a predicting client replays what's after). */
  ack = -1;
  /** Seconds their state trails the step (see `PlayerFrame.lead`). */
  lead = 0;
  /** Swings and uses so far. */
  swings = 0;
  skin: { uv: [number, number]; atlas?: string } | null = null;
  /** Their account (signed in), or null: a guest or a bot. Set as they join. */
  account: PlayerAccount | null = null;
  /** `player.adopted`: the name whose kept data is theirs to take, on their first visit since claiming it. */
  adopted: string | null = null;
  /** `player.store` (the simulation sets it as they join: their account's, or a guest's for this visit). */
  store: StoreApi = guestStore();
  /** The game's achievements they have (their account's, as they joined, and any since). */
  achieved = new Set<string>();
  /** Their avatar's code (`avatarCode`), or null: the game's own look for them. */
  avatar: string | null = null;
  /** What the game dresses their avatar in (`player.setUniform`), or null: their own clothes. */
  uniform: Uniform | null = null;
  /** The cosmetics they wear (ids across the platform). */
  wear: string[] = [];
  /** Cosmetics given to them here (`player.grant`), so each is given once. */
  owns = new Set<string>();
  model: ModelSpec | null = null;
  color: string | null = null;
  /** A clip their figure plays (`animate`), and how many they've asked for. */
  clip: ClipFrame | null = null;
  private clipSeq = 0;
  readonly api: Player;
  /** Creative building's block hotbar and placing (games with `player.build`). */
  creative: CreativeBuild | null = null;
  /** What they're driving (`drive`): their controls move it instead of their body. */
  vehicle: VehicleSim | null = null;
  /** Their client works the camera out from the vehicle (until the game sets one). */
  followVehicle = false;
  /** Third person (`camera.orbit`), as their frame carries it. */
  orbit: PlayerFrame['orbit'] = null;
  private orbitSeq = 0;
  /**
   * The first player's place while nobody holds it: their client left and the next to join
   * takes over (`game.player` stays the same object). Frozen, idle and not drawn meanwhile.
   */
  vacant = false;

  constructor(private p: PlayerSimParts) {
    this.id = p.id;
    this.name = p.name;
    this.slot = p.world.player_add(0, 100, 0);
    const o = p.options;
    this.walker = (o.controller ?? 'walk') === 'walk';
    this.itemMode = this.walker && (o.hotbar ?? (o.build ? 'blocks' : 'items')) === 'items';
    this.allowFlight = o.fly ?? false;
    this.tune = resolveMovement(o.movement);
    p.world.player_tune(this.slot, new Float64Array(this.tune.params));
    const present = p.present;
    this.inventory = new Inventory(p.items.defs, p.kinds);
    this.health = new PlayerHealth(
      p.world,
      this.slot,
      present.audio(this.id),
      present.fx(this.id),
      p.emit,
      () => this.position,
      () => this.api,
      (from) => {
        present.send(this.id, 'view', 'kick', [0.6]);
        if (from) present.send(this.id, 'hud', 'hurtFrom', [{ x: from.x, y: from.y, z: from.z }]);
      },
    );
    this.health.configure(o);
    const me = this;
    this.items = new ItemRunner(
      [...p.kinds.values()],
      {
        get api() {
          return me.api;
        },
        inventory: this.inventory,
        get eye() {
          return me.eye;
        },
        get falling() {
          const s = me.state;
          return !s.onGround && s.vy < -1 && !s.inWater;
        },
        get moving() {
          const s = me.state;
          return Math.hypot(s.vx, s.vz) / Math.max(1, me.tune.params[0]);
        },
        get stance(): 0 | 1 | 2 {
          return me.sliding ? 2 : me.sneaking ? 1 : 0;
        },
        bullet: (from, dir, range, seen, pen) => p.bullet(from, dir, range, seen, me.api, pen),
        hitMarker: (kind) => present.send(this.id, 'hud', 'hitMarker', [kind]),
        now: () => p.now(),
      },
      p.itemHost,
      p.ctx,
    );
    this.api = this.makeApi();
  }

  get position(): Vec3 {
    const s = this.state;
    return { x: s.x, y: s.y, z: s.z };
  }

  get eye(): Vec3 {
    const s = this.state;
    // Leaning out takes the eyes sideways with the head.
    const side = leanOffset(this.yaw, this.lean);
    return { x: s.x + side.x, y: s.y + (this.sneaking && !s.flying ? SNEAK_EYE : EYE), z: s.z + side.z };
  }

  /** Unit vector along the view (yaw 0 looks toward -z). */
  get look(): Vec3 {
    const cp = Math.cos(this.pitch);
    return { x: -Math.sin(this.yaw) * cp, y: Math.sin(this.pitch), z: -Math.cos(this.yaw) * cp };
  }

  /** Turn the player from the simulation's side (teleports, spawning): the client follows. */
  setView(yaw: number, pitch: number) {
    this.yaw = yaw;
    this.pitch = pitch;
    this.seq++;
  }

  /** Counts up each time the simulation turns the player; clients echo it to show they've caught up. */
  get viewSeq(): number {
    return this.seq;
  }

  /** Put the player somewhere, facing `yaw` / `pitch` (spawning, a save); a game-driven camera starts at their eyes. */
  place(x: number, y: number, z: number, yaw: number, pitch = 0) {
    this.p.world.player_reset(this.slot, x, y, z);
    this.syncState();
    this.setView(yaw, pitch);
    this.cam.pos.set(x, y + EYE, z);
    this.cam.quat.setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'));
  }

  /**
   * A new player in this place (the first player's, left by someone else): nothing of the last
   * one's carries over (where they were, flying, health, what they held, their vehicle, their skin).
   */
  fresh(x: number, y: number, z: number, yaw: number) {
    this.inventory.clear();
    this.reset();
    this.health.configure(this.p.options);
    this.health.revive();
    this.p.world.set_flying(this.slot, false);
    this.vehicle = null;
    this.followVehicle = false;
    this.skin = null;
    this.model = null;
    this.uniform = null;
    this.color = null;
    this.clip = null;
    this.orbit = null;
    this.ack = -1;
    this.lead = 0;
    this.swings = 0;
    // Their screen counts its actions from the start.
    this.items.reset(true);
    this.speedMul = 1;
    this.sliding = false;
    this.lean = 0;
    this.memory = freshMemory();
    this.abilityEvents = [];
    this.tilt = null;
    this.input.set(IDLE_INPUT);
    this.place(x, y, z, yaw);
  }

  /** Read the physics body back from WebAssembly. */
  syncState() {
    const st = this.p.world.player_state(this.slot);
    const S = this.state;
    S.x = st[0];
    S.y = st[1];
    S.z = st[2];
    S.vx = st[3];
    S.vy = st[4];
    S.vz = st[5];
    S.onGround = st[6] > 0.5;
    S.inWater = st[7] > 0.5;
    S.eyesInWater = st[8] > 0.5;
    S.inLava = st[9] > 0.5;
    S.flying = st[10] > 0.5;
    S.bob = st[11];
    S.frozen = st[12] > 0.5;
    S.ride = st[13];
    S.rideX = st[14];
    S.rideY = st[15];
    S.rideZ = st[16];
  }

  /** Walk, sprint, sneak, jump, swim and fly from this tick's controls (or drive). */
  move(dt: number) {
    const world = this.p.world;
    // Upright unless a movement ability leans them out on this step.
    this.lean = 0;
    if (this.vehicle) {
      this.vehicle.def.step(this.vehicle.state, this.input, dt, this.p.query);
      this.followBody();
      return;
    }
    if (!this.walker) {
      // No walking body: it stays put (games may teleport it, e.g. to follow a vehicle).
      world.set_frozen(this.slot, true);
      this.syncState();
      return;
    }
    const inp = this.input;
    // The client's view, once it has caught up with any the simulation set.
    if (inp.active && inp.viewSeq === this.viewSeq) {
      this.yaw = inp.yaw;
      this.pitch = inp.pitch;
    }
    const item = this.items.move(inp.buttons);
    const mods = { speed: this.speedMul * (item?.speed ?? 1), noSprint: item?.noSprint ?? false };
    const { sneak, sprint, slide, lean, events, camera } = stepMovement(world, this.slot, inp, this.yaw, this.allowFlight, this.memory, dt, this.tune, mods, this.pitch, this.p.query);
    if (events.length) {
      this.abilityEvents.push(...events);
      // A clip an ability asked for plays on their figure (their own screen played it already).
      for (const [, , clip] of events) if (clip) this.clip = clipFrame(++this.clipSeq, clip.name, clip.opts, this.p.now());
    }
    this.tilt = camera;
    this.syncState();
    this.sneaking = sneak;
    this.sliding = slide;
    this.lean = lean;
    this.sprinting = sprint && Math.hypot(this.state.vx, this.state.vz) > Math.min(4.5, this.tune.params[0] * 1.02);
  }

  /** The game hears what their movement abilities triggered since the last time (`ability` events). */
  announceAbilities() {
    if (!this.abilityEvents.length) return;
    const events = this.abilityEvents;
    this.abilityEvents = [];
    for (const [ability, name] of events) this.p.emit('ability', { player: this.api, ability, name });
  }

  /**
   * Their vehicle's model where it will be `seconds` on (a server owes them that much time): a
   * step of the vehicle on a copy of its state, with the last controls. For other screens, which
   * draw the model; the vehicle itself is untouched.
   */
  aheadVehicle(seconds: number) {
    const v = this.vehicle;
    if (!v?.prop || v.prop.removed || seconds < 1e-3) return;
    const s = structuredClone(v.state);
    v.def.step(s, this.input, seconds, this.p.query);
    v.def.pose(s, v.prop.position, v.prop.quaternion);
  }

  /** The vehicle's model to where its state has it, and their (frozen) body with it (unless they steer it from afar). */
  followBody() {
    const v = this.vehicle;
    if (!v) return;
    const at = v.place();
    if (!v.remote) this.p.world.player_reset(this.slot, at.x, at.y, at.z);
    this.p.world.set_frozen(this.slot, true);
    this.syncState();
  }

  /** Regeneration, fall damage, the death timer. */
  updateHealth(dt: number) {
    const s = this.state;
    this.health.update(dt, s.onGround, s.vy);
  }

  /** The built-in weapons and hotbar (after the game has had its say on the controls). */
  updateHands(dt: number, running: boolean) {
    if (this.itemMode) this.items.update(running ? dt : 0, this.input, this.weaponsLocked);
  }

  /** A weapons-locked freeze holds (it ends with the freeze: `freeze(false)`, a revive); a spectator's are always put away. */
  get weaponsLocked(): boolean {
    return this.spectating || (this.lockWeapons && this.p.world.player_state(this.slot)[12] > 0.5);
  }

  /** `spectate`: a ghost in the engine (flying through anything, nobody's target), unhurt; dead or not, free to fly. */
  spectate(on: boolean) {
    if (on === this.spectating) return;
    this.spectating = on;
    const world = this.p.world;
    world.set_ghost(this.slot, on);
    this.health.ghost = on;
    world.set_frozen(this.slot, this.held || (!on && this.health.dead));
    this.syncState();
  }

  /** `freeze`: their body, and with `weapons` their weapons too. */
  freeze(frozen: boolean, weapons = false) {
    this.p.world.set_frozen(this.slot, frozen);
    this.held = frozen;
    this.lockWeapons = frozen && weapons;
  }

  reset() {
    this.items.reset(false);
    this.held = false;
    this.lockWeapons = false;
    this.spectate(false);
  }

  frame(): PlayerFrame {
    const s = this.state;
    const h = this.health;
    const q = this.cam.quat;
    const p = this.cam.pos;
    return {
      id: this.id,
      name: this.name,
      x: s.x,
      y: s.y,
      z: s.z,
      vx: s.vx,
      vy: s.vy,
      vz: s.vz,
      onGround: s.onGround,
      inWater: s.inWater,
      eyesInWater: s.eyesInWater,
      inLava: s.inLava,
      flying: s.flying,
      bob: s.bob,
      sneaking: this.sneaking,
      sprinting: this.sprinting,
      sliding: this.sliding,
      ...(this.lean && { lean: this.lean }),
      speed: this.speedMul,
      bot: !!this.bot,
      view: { seq: this.viewSeq, yaw: this.yaw, pitch: this.pitch },
      health: h.health,
      maxHealth: h.max,
      mortal: h.enabled,
      dead: h.dead,
      deathTime: h.deathTime,
      hotbar: this.itemMode && !this.spectating ? { slots: this.inventory.slots.map((st) => (st ? { ...st } : null)), selected: this.inventory.selected } : null,
      hand: { state: this.itemMode && !this.spectating ? this.items.shown() : null },
      ...(this.itemMode && { items: this.items.own() }),
      camera: { p: [p.x, p.y, p.z], q: [q.x, q.y, q.z, q.w], fov: this.cam.fov, follow: this.followVehicle && !!this.vehicle },
      vehicle: this.vehicle && { name: this.vehicle.name, state: this.vehicle.state, prop: this.vehicle.prop && !this.vehicle.prop.removed ? this.vehicle.prop.id : null, ...(this.vehicle.remote ? { remote: true } : {}) },
      creative: this.creative ? { hotbar: [...this.creative.hotbar], selected: this.creative.selected } : null,
      frozen: s.frozen,
      ...(this.spectating && { spectating: true }),
      locked: this.weaponsLocked,
      ...(this.tilt && { tilt: this.tilt }),
      canFly: this.allowFlight,
      swings: this.swings,
      ack: this.ack,
      move: copyMemory(this.memory),
      lead: this.lead,
      skin: this.skin,
      model: this.model,
      color: this.color,
      ...(this.avatar ? { avatar: this.avatar } : {}),
      ...(this.uniform ? { uniform: this.uniform } : {}),
      ...(this.wear.length ? { wear: this.wear } : {}),
      clip: this.clip,
      ride: s.ride ? { prop: s.ride, p: [s.rideX, s.rideY, s.rideZ] } : null,
      orbit: this.orbit,
    };
  }

  /** `camera.orbit`: third person round a prop or a player, or back to first person. */
  setOrbit(target: Prop | Player | null, o: OrbitOptions = {}) {
    if (!target) {
      this.orbit = null;
      return;
    }
    const who = (target as Player).kind === 'player' ? { player: (target as Player).id } : { prop: (target as PropState).id };
    const off = o.offset ? ([o.offset.x, o.offset.y, o.offset.z] as [number, number, number]) : null;
    const max = Math.max(0, o.max ?? 30);
    const min = Math.min(max, Math.max(0, o.min ?? 0));
    this.orbit = {
      seq: ++this.orbitSeq,
      ...who,
      offset: off,
      distance: Math.min(max, Math.max(min, o.distance ?? 0)),
      min,
      max,
      ...(o.shoulder && { shoulder: [finiteOr(o.shoulder.right, 0), finiteOr(o.shoulder.up, 0)] as [number, number] }),
      ...(o.wheel === false && { wheel: false as const }),
    };
  }

  /** Gone from the game: their body leaves the world. */
  remove() {
    this.p.world.player_remove(this.slot);
  }

  private makeApi(): Player {
    const me = this;
    const world = this.p.world;
    const present = this.p.present;
    const camera: CameraApi = {
      get position() {
        if (!me.walker) {
          const c = me.cam.pos;
          return { x: c.x, y: c.y, z: c.z };
        }
        return me.eye;
      },
      get forward() {
        if (!me.walker) {
          const d = new THREE.Vector3(0, 0, -1).applyQuaternion(me.cam.quat);
          return { x: d.x, y: d.y, z: d.z };
        }
        return me.look;
      },
      set(pos, target, up) {
        me.followVehicle = false;
        const c = me.cam;
        c.pos.set(pos.x, pos.y, pos.z);
        const m = new THREE.Matrix4().lookAt(c.pos, new THREE.Vector3(target.x, target.y, target.z), new THREE.Vector3(up?.x ?? 0, up?.y ?? 1, up?.z ?? 0));
        c.quat.setFromRotationMatrix(m);
      },
      setPose(pos, q) {
        me.followVehicle = false;
        me.cam.pos.set(pos.x, pos.y, pos.z);
        me.cam.quat.set(q.x, q.y, q.z, q.w).normalize();
      },
      get fov() {
        return me.cam.fov;
      },
      set fov(v: number) {
        me.cam.fov = Math.max(10, Math.min(150, v));
      },
      follow() {
        me.followVehicle = true;
      },
      orbit(target, opts) {
        me.setOrbit(target, opts);
      },
    };
    return {
      kind: 'player',
      id: this.id,
      get name() {
        return me.name;
      },
      get account() {
        return me.account && { ...me.account };
      },
      get store() {
        return me.store;
      },
      get adopted() {
        return me.adopted;
      },
      achieve: (id) => this.p.achieve(this, id),
      grant: (id) => this.p.grant(this, id),
      achieved: (id) => me.achieved.has(id),
      hud: present.hud(this.id),
      audio: present.audio(this.id),
      fx: present.fx(this.id),
      setSkin: (skin, atlas) => {
        me.skin = { uv: [skin[0], skin[1]], atlas };
        present.send(me.id, 'view', 'setSkin', [skin, atlas]);
      },
      setModel: (model) => {
        me.model = model;
      },
      setUniform: (uniform) => {
        me.uniform = uniform ? { ...uniform } : null;
      },
      animate: (clip, opts) => {
        me.clip = clip ? clipFrame(++me.clipSeq, clip, opts, me.p.now()) : null;
      },
      get color() {
        return me.color;
      },
      set color(c: string | null) {
        me.color = c;
      },
      input: this.input,
      camera,
      viewModel: present.view(this.id),
      inventory: this.inventory,
      get position() {
        return me.position;
      },
      get eye() {
        return me.eye;
      },
      get velocity() {
        const s = me.state;
        return { x: s.vx, y: s.vy, z: s.vz };
      },
      get look() {
        return me.look;
      },
      get yaw() {
        return me.yaw;
      },
      get pitch() {
        return me.pitch;
      },
      get onGround() {
        return me.state.onGround;
      },
      get health() {
        return me.health.health;
      },
      set health(v: number) {
        me.health.health = Math.max(0, Math.min(me.health.max, v));
      },
      get maxHealth() {
        return me.health.max;
      },
      set maxHealth(v: number) {
        me.health.max = v;
        me.health.health = Math.min(me.health.health, v);
      },
      get alive() {
        return !me.health.dead;
      },
      get armor() {
        return me.health.armor;
      },
      set armor(v: number) {
        me.health.armor = v;
      },
      teleport: (pos, yaw, pitch) => {
        world.player_reset(this.slot, pos.x, pos.y, pos.z);
        this.syncState();
        if (yaw !== undefined || pitch !== undefined) this.setView(yaw ?? this.yaw, pitch ?? this.pitch);
      },
      damage: (amount, opts) => this.health.damage(amount, opts),
      heal: (amount, opts) => this.health.heal(amount, opts),
      revive: () => {
        this.spectate(false);
        this.health.revive();
      },
      impulse: (x, y, z) => world.player_impulse(this.slot, x, y, z),
      freeze: (f, opts) => this.freeze(!!f, !!opts?.weapons),
      get frozen() {
        return world.player_state(me.slot)[12] > 0.5;
      },
      spectate: (on) => this.spectate(!!on),
      get spectating() {
        return me.spectating;
      },
      drive: <S extends object>(name: string, state: S, opts: { prop?: Prop; remote?: boolean } = {}) => {
        const def = this.p.vehicles[name];
        if (!def) throw new Error(`player.drive: no vehicle "${name}" (add it to the game's \`vehicles\`)`);
        this.vehicle = new VehicleSim(name, def, state, (opts.prop as PropState | undefined) ?? null, !!opts.remote);
        this.followVehicle = true;
        this.followBody();
        return this.vehicle as unknown as import('../api/types').Vehicle<S>;
      },
      leaveVehicle: () => {
        this.vehicle = null;
        this.followVehicle = false;
      },
      get vehicle() {
        return me.vehicle;
      },
      get riding() {
        return me.state.ride ? me.p.props.byId(me.state.ride) : null;
      },
      get bot() {
        return !!me.bot;
      },
      get crouching() {
        return me.sneaking;
      },
      get sliding() {
        return me.sliding;
      },
      get speed() {
        return me.speedMul;
      },
      set speed(v: number) {
        me.speedMul = Math.max(0, Math.min(5, Number.isFinite(v) ? v : 1));
      },
      get abilities() {
        return abilityStates(me.memory, me.tune);
      },
      protect: (seconds) => this.health.protect(seconds),
    };
  }
}

/**
 * A bot's keyboard and mouse (`game.bots`): what the game's code holds, presses and aims each
 * tick becomes the bot's `PlayerInput`, read like anyone's.
 */
export class BotControlsImpl implements BotControls {
  private keys = new Set<string>();
  private pressedKeys = new Set<string>();
  private held = 0;
  private clicks = 0;
  yaw = 0;
  pitch = 0;

  constructor(private eye: () => Vec3) {}

  hold(code: string, down = true) {
    if (down) this.keys.add(code);
    else this.keys.delete(code);
  }

  press(code: string) {
    this.pressedKeys.add(code);
  }

  button(b: number, down = true) {
    if (down) this.held |= 1 << b;
    else this.held &= ~(1 << b);
  }

  click(b: number) {
    this.clicks |= 1 << b;
    this.held |= 0;
  }

  look(yaw: number, pitch: number) {
    this.yaw = yaw;
    this.pitch = Math.max(-Math.PI / 2 + 0.001, Math.min(Math.PI / 2 - 0.001, pitch));
  }

  lookAt(point: Vec3) {
    const e = this.eye();
    const dx = point.x - e.x;
    const dy = point.y - e.y;
    const dz = point.z - e.z;
    this.look(Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz)));
  }

  release() {
    this.keys.clear();
    this.held = 0;
  }

  /** This tick's controls; presses and clicks are used up. `viewSeq` keeps the look theirs. */
  snapshot(active: boolean, viewSeq: number): PlayerInput {
    const i: PlayerInput = {
      active,
      down: [...this.keys],
      pressed: [...this.pressedKeys],
      buttons: this.held | this.clicks,
      clicked: this.clicks,
      mouseX: 0,
      mouseY: 0,
      wheel: 0,
      yaw: this.yaw,
      pitch: this.pitch,
      viewSeq,
    };
    this.pressedKeys.clear();
    this.clicks = 0;
    return i;
  }
}

export type { Bot };

/** A guest's `player.store`: theirs until they leave, kept nowhere. */
export function guestStore(): StoreApi {
  const data = new Map<string, string>();
  return {
    get: <T>(key: string) => (data.has(key) ? (JSON.parse(data.get(key)!) as T) : undefined),
    set: (key, value) => {
      if (value === undefined) data.delete(key);
      else data.set(key, JSON.stringify(value));
    },
    delete: (key) => void data.delete(key),
    keys: (prefix = '') => [...data.keys()].filter((k) => k.startsWith(prefix)).sort(),
  };
}
