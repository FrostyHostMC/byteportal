import type { ItemDefinition, Vec3 } from '@platform';
import { addBloom, canReload, DEFAULT_GUN_RULES, freshGun, gun, pelletDirs, RAISE, settleBloom, spreadDeg, startReload, stepAim, stepReload, type Gun, type GunRules, type GunShown, type GunState, type GunItem, isGun } from '@platform/items';

/** The controls a gun reads this frame (the page's own input, as the snapshot will send it). */
export interface GunControls {
  active: boolean;
  trigger: boolean;
  triggerPressed: boolean;
  aim: boolean;
  reload: boolean;
}

/** What the player's doing, for the spread and the sprint-to-fire delay. */
export interface GunBody {
  moving: number;
  air: boolean;
  crouch: boolean;
  sprinting: boolean;
  dead: boolean;
}

/** What a frame of the gun brought besides shots: a reload started, the trigger on an empty gun (their sounds are client code's). */
export type GunNews = 'reload' | 'empty';

/** One shot fired this frame: for the host, and for this screen's tracers and impacts. */
export interface FiredShot {
  serial: number;
  yaw: number;
  pitch: number;
  spread: number;
  dirs: Vec3[];
}

/**
 * The held gun on this player's own screen: it fires the moment the trigger's pulled (at the
 * gun's rate, while it has rounds), aims, reloads and kicks the view, with the same rules the
 * host plays (`sim/guns`). Each shot goes to the host with the controls (`PlayerInput.shots`);
 * the host decides what it hit. The host's word on the gun (its rounds, a reload) is taken
 * once nothing has happened here for a moment, so a refill or a correction shows without
 * fighting what this screen just did.
 */
export class GunController {
  item: string | null = null;
  def: GunItem | null = null;
  g: Gun | null = null;
  state: GunState | null = null;
  /** Sprinting, blended 0..1 (the gun comes down; it can't fire until it's back up). */
  sprint = 0;
  /** Seconds since something happened here (a shot, a reload): the host's word waits for quiet. */
  private quiet = 99;
  /** How much of the view's recoil is still to settle back, in radians of pitch. */
  private debt = 0;
  private sinceShot = 99;
  /** Guns carried, as this screen last had them (switching back finds the same rounds). */
  private kept = new Map<string, GunState>();
  /** Reload length and a shotgun's rounds going in, for the animation. */
  reloadTotal = 1;
  /** How fast this player reloads, as the host says (`GunOwn`): a multiple of each gun's pace. */
  reloadSpeed = 1;
  shellsToLoad = 0;

  /** The game's gun rules (`guns`), as the host plays them. */
  constructor(private rules: GunRules = DEFAULT_GUN_RULES) {}

  /** The gun in hand changed (or none): take the host's state for it, else what we had, else a full one. */
  hold(item: string | null, def: ItemDefinition | undefined, host: GunShown | null | undefined) {
    if (item === this.item) return;
    if (this.item && this.state) {
      this.state.reload = -1;
      this.state.aim = 0;
      this.kept.set(this.item, this.state);
    }
    this.item = item;
    if (!item || !isGun(def)) {
      this.def = null;
      this.g = null;
      this.state = null;
      return;
    }
    this.def = def;
    this.g = gun(def);
    const st = this.kept.get(item) ?? freshGun(def);
    if (host) {
      st.mag = host.mag;
      st.reserve = host.reserve;
      st.serial = Math.max(st.serial, host.serial);
    }
    st.cooldown = Math.max(st.cooldown, RAISE);
    st.reload = -1;
    this.state = st;
    this.quiet = 99;
  }

  /** The host's view of the held gun (from the newest frame): taken when things are quiet here. */
  reconcile(host: GunShown | null | undefined) {
    const st = this.state;
    if (!st || !host) return;
    if (host.serial > st.serial) st.serial = host.serial;
    if (this.quiet < 0.6) return;
    if (host.mag !== st.mag || host.reserve !== st.reserve) {
      st.mag = host.mag;
      st.reserve = host.reserve;
    }
    if ((host.reload >= 0) !== (st.reload >= 0)) st.reload = host.reload;
  }

  /** Forget everything (dead, a restart): guns come back full from the host. */
  reset() {
    this.kept.clear();
    this.item = null;
    this.state = null;
    this.def = null;
    this.g = null;
    this.debt = 0;
  }

  /**
   * A frame: aim, reload, fire. Returns the shots fired (and kicks the view through `kick`);
   * `happened` hears of a reload started and the trigger pulled on an empty gun. `yaw` / `pitch`
   * are the view now.
   */
  update(dt: number, c: GunControls, body: GunBody, yaw: number, pitch: number, kick: (dPitch: number, dYaw: number) => void, happened: (e: GunNews) => void): FiredShot[] {
    const st = this.state;
    const g = this.g;
    const def = this.def;
    this.quiet += dt;
    this.sinceShot += dt;
    this.sprint += ((body.sprinting && !c.trigger ? 1 : 0) - this.sprint) * Math.min(1, dt * 10);
    if (!st || !g || !def) return [];
    const active = c.active && !body.dead;
    st.aim = stepAim(g, st.aim, active && c.aim, dt);
    st.cooldown = Math.max(0, st.cooldown - dt);
    st.bloom = settleBloom(g, st.bloom, dt);
    const trigger = active && c.trigger;
    const was = st.mag;
    if (stepReload(g, st, dt * this.reloadSpeed, trigger) || st.mag !== was) this.quiet = 0;
    if (active && c.reload && canReload(g, st)) this.reload(g, st, happened);
    const out: FiredShot[] = [];
    const pull = active && (def.auto ? c.trigger : c.triggerPressed);
    // Coming out of a sprint, the gun has to come up first.
    const ready = this.sprint < 0.35;
    if (pull && st.reload >= 0 && def.shells && st.mag > 0) st.reload = -1;
    if (pull && st.mag <= 0 && st.reload < 0 && st.cooldown <= 0) {
      happened('empty');
      st.cooldown = 0.25;
    }
    while (pull && ready && st.mag > 0 && st.reload < 0 && st.cooldown <= 0) {
      st.mag--;
      st.serial++;
      st.cooldown += g.interval;
      const spread = spreadDeg(g, { aim: st.aim, moving: body.moving, air: body.air, crouch: body.crouch, bloom: st.bloom });
      st.bloom = addBloom(g, st.bloom);
      out.push({ serial: st.serial, yaw, pitch, spread, dirs: pelletDirs(g, yaw, pitch, spread, st.serial) });
      this.quiet = 0;
      this.sinceShot = 0;
      // The view kicks up, and a little to a side.
      const k = 1 - 0.35 * st.aim;
      const up = g.recoil.up * (0.85 + Math.random() * 0.3) * k * (Math.PI / 180);
      const side = g.recoil.side * (Math.random() * 2 - 1) * k * (Math.PI / 180);
      kick(up, side);
      this.debt += up;
      if (!def.auto) break;
    }
    // Empty: reload by itself.
    if (this.rules.autoReload && st.mag <= 0 && st.cooldown <= 0.05 && canReload(g, st)) this.reload(g, st, happened);
    // Between bursts, the view settles back down some of the way.
    if (this.sinceShot > g.interval * 1.5 && this.debt > 0) {
      const r = Math.min(this.debt, this.debt * dt * 9 + 0.0005);
      kick(-r * g.recoil.recover, 0);
      this.debt -= r;
    }
    return out;
  }

  private reload(g: Gun, st: GunState, happened: (e: GunNews) => void) {
    startReload(g, st);
    this.quiet = 0;
    this.reloadTotal = g.def.reload / this.reloadSpeed;
    this.shellsToLoad = g.def.shells ? Math.min(g.def.magazine - st.mag, st.reserve) : 0;
    happened('reload');
  }

  /** Reload progress 0..1 (a shotgun: over all its rounds), or -1. */
  get reloadProgress(): number {
    const st = this.state;
    const g = this.g;
    if (!st || !g || st.reload < 0) return -1;
    if (g.def.shells) {
      const n = Math.max(1, this.shellsToLoad);
      const left = Math.min(this.def!.magazine - st.mag, st.reserve);
      const done = n - left;
      return Math.max(0, Math.min(0.999, (done + (1 - st.reload / g.def.reload)) / n));
    }
    return Math.max(0, Math.min(1, 1 - st.reload / g.def.reload));
  }

  /** The spread cone now, in degrees (for the crosshair). */
  spread(body: GunBody): number {
    const st = this.state;
    const g = this.g;
    if (!st || !g) return 0;
    return spreadDeg(g, { aim: st.aim, moving: body.moving, air: body.air, crouch: body.crouch, bloom: st.bloom });
  }
}
