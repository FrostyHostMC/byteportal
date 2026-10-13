import type { Entity, GameContext, ItemHost, ItemKind, ItemKit, ItemUse, Player, Vec3 } from '@platform';
import { addBloom, canReload, isGun, type GunOwn, type GunRules, type GunShown, type ShotWire, damageAt, freshGun, gun, gunMove, lookDir, pelletDirs, RAISE, resolveGunRules, settleBloom, spreadDeg, startReload, stepAim, stepReload, type Gun, type GunState, type GunItem, type GunOptions } from '@platform/items';

/** The gun kit on the host, with what a game asks of a player's guns. */
export interface Guns extends ItemKind<GunItem, GunState> {
  /** Their gun in hand and its state, if a gun's in hand. */
  held(player: Player): { item: string; def: GunItem; state: GunState } | null;
  /** Reloading the gun in hand. */
  reloading(player: Player): boolean;
  /** Aimed down the sights of the gun in hand (more than halfway). */
  aiming(player: Player): boolean;
  /** A carried gun's rounds: in the magazine, and spare. Null if they carry none. */
  ammo(player: Player, item: string): { magazine: number; reserve: number } | null;
  /** Set a carried gun's rounds (a resupply, a start): what's given, the magazine no fuller than it holds. */
  setAmmo(player: Player, item: string, a: { magazine?: number; reserve?: number }): void;
  /**
   * How fast they reload every gun, as a multiple of each one's own pace (a perk, a power-up): 2
   * reloads in half the time. 1 by default, kept until changed (0.25 to 4). Their screen reloads
   * at the same pace.
   */
  setReloadSpeed(player: Player, multiple: number): void;
  reloadSpeed(player: Player): number;
}

/**
 * Guns (`kind: 'gun'`): aiming (the right button), reloading (R, or by itself once empty, unless
 * the game's rules say), firing at the gun's rate, spread and recoil, bullets that hit what the
 * shooter's screen showed (lag compensation), carve destructible blocks and go through walls
 * (`penetration`). A person's screen fires its own shots the moment the trigger's pulled, and
 * sends them with its controls (the kit's client half); the host takes each one the gun could
 * have fired, and decides what it hit. Bots (and a screen without the client half) fire here
 * from the trigger. `options`: the game's gun rules, the same on both halves.
 */
export function guns(options: GunOptions = {}): ItemKit<Guns> {
  const rules = resolveGunRules(options);
  return (host) => guns1(rules, host);
}

/** The game's running gun kit (`game.items.kind('gun')`), with its helpers; null if it doesn't list guns. */
guns.of = (game: GameContext): Guns | null => game.items.kind<Guns>('gun');

/** Guns in one game. */
function guns1(rules: GunRules, host: ItemHost): Guns {
  const defOf = (item: string) => host.game.items.get(item);
  /** Players who reload at a pace of their own (`setReloadSpeed`); everyone else at 1. */
  const pace = new WeakMap<Player, number>();
  const paceOf = (p: Player) => pace.get(p) ?? 1;
  const heldGun = (p: Player) => {
    const stack = p.inventory.held;
    if (!stack) return null;
    const def = defOf(stack.item);
    if (!isGun(def)) return null;
    const state = p.inventory.state<GunState>(stack.item);
    return state && { item: stack.item, def, state };
  };
  return {
    kind: 'gun',
    stack: 1,
    holds: true,
    state: (def) => freshGun(def),
    equip(use, item, held) {
      const st = use.player.inventory.state<GunState>(item);
      if (!st) return;
      if (held) st.cooldown = Math.max(st.cooldown, RAISE);
      else {
        // Put away: it stops reloading, and comes down from the sights.
        st.reload = -1;
        st.aim = 0;
      }
    },
    step(use) {
      const held = use.held;
      if (!held?.state) return;
      const st = held.state;
      const def = held.def;
      const g = gun(def);
      const c = use.controls;
      const active = c.active;
      const trigger = active && c.button(0);
      st.aim = stepAim(g, st.aim, active && c.button(2), use.dt);
      st.cooldown = Math.max(0, st.cooldown - use.dt);
      st.bloom = settleBloom(g, st.bloom, use.dt);
      st.tokens = Math.min(rules.rateSlack, st.tokens + use.dt / g.interval);
      stepReload(g, st, use.dt * paceOf(use.player), trigger);
      if (active && c.pressed('KeyR') && canReload(g, st)) reload(use, held.item, g, st);
      // Their screen's shots (locked, or not at the controls, it fires none: those it sent anyway are refused).
      const shots = use.acts;
      if (shots) {
        if (active) {
          for (const shot of shots) {
            // [serial, yaw, pitch, the cone's spread in degrees], as their screen fired it (anything else is turned down).
            const [serial, yaw, pitch, spread] = shot as number[];
            if (shot.length !== 4 || !Number.isSafeInteger(serial) || serial < 0 || !finite(yaw, 1e6) || !finite(pitch, Math.PI / 2) || !finite(spread, 45) || spread < 0) continue;
            if (st.mag <= 0 || st.tokens < 0.75 || serial <= st.serial) continue;
            // A shotgun's trigger stops its reload.
            if (st.reload >= 0) {
              if (!def.shells) continue;
              st.reload = -1;
            }
            st.tokens -= 1;
            fire(use, held.item, g, st, serial, yaw, pitch, spread, true);
          }
        }
      } else if (active) {
        const pull = def.auto ? trigger : c.buttonPressed(0);
        if (pull && st.reload >= 0 && def.shells && st.mag > 0) st.reload = -1;
        if (pull && st.mag <= 0 && st.reload < 0 && st.cooldown <= 0) {
          use.player.audio.play(def.sounds?.empty ?? 'gun_empty', { item: { id: held.item, sound: 'empty' } });
          st.cooldown = 0.25;
        }
        while (pull && st.mag > 0 && st.reload < 0 && st.cooldown <= 0) {
          fire(use, held.item, g, st, st.serial + 1, use.player.yaw, use.player.pitch, null, false);
          if (!def.auto) break;
        }
      }
      // Empty: reload by itself.
      if (!c.locked && rules.autoReload && st.mag <= 0 && st.cooldown <= 0.05 && canReload(g, st)) reload(use, held.item, g, st);
    },
    move: (def, controls) => gunMove(def, controls.buttons, rules),
    own: (v) => (pace.has(v.player) ? ({ reloadSpeed: paceOf(v.player) } satisfies GunOwn) : null),
    shown: (_v, _item, st) => (st ? ({ mag: st.mag, reserve: st.reserve, reload: st.reload, serial: st.serial, aim: st.aim } satisfies GunShown) : null),
    held: heldGun,
    reloading: (p) => (heldGun(p)?.state.reload ?? -1) >= 0,
    aiming: (p) => (heldGun(p)?.state.aim ?? 0) > 0.5,
    ammo(p, item) {
      const st = p.inventory.state<GunState>(item);
      return st && { magazine: st.mag, reserve: st.reserve };
    },
    setAmmo(p, item, a) {
      const st = p.inventory.state<GunState>(item);
      const def = defOf(item);
      if (!st || !isGun(def)) return;
      if (a.magazine !== undefined) st.mag = Math.max(0, Math.min(def.magazine, Math.floor(a.magazine)));
      if (a.reserve !== undefined) st.reserve = Math.max(0, Math.floor(a.reserve));
    },
    setReloadSpeed(p, multiple) {
      const k = Number.isFinite(multiple) ? Math.max(0.25, Math.min(4, multiple)) : 1;
      if (k === 1) pace.delete(p);
      else pace.set(p, k);
    },
    reloadSpeed: paceOf,
  };
}

/** A number, no bigger than `max` either way. */
const finite = (v: unknown, max: number): v is number => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= max;

function reload(use: ItemUse<GunItem, GunState>, item: string, g: Gun, st: GunState) {
  startReload(g, st);
  use.player.audio.play(g.def.sounds?.reload ?? 'gun_reload', { volume: 0.8, item: { id: item, sound: 'reload' } });
}

/**
 * One shot: its bullets, what they hit, the damage, the shooter's hit marker, and what everyone
 * else sees and hears. `fromScreen`: their screen fired it (with `spreadIn`, its cone), so its
 * bullets meet bodies where that screen showed them.
 */
function fire(use: ItemUse<GunItem, GunState>, id: string, g: Gun, st: GunState, serial: number, yaw: number, pitch: number, spreadIn: number | null, fromScreen: boolean) {
  const me = use.player;
  const host = use.host;
  st.mag--;
  st.serial = serial;
  st.cooldown = Math.max(0, st.cooldown) + g.interval;
  // The shooter's screen says how wide its cone was; the host holds it to what the gun allows now.
  const own = spreadDeg(g, { aim: st.aim, moving: use.moving, air: !me.onGround, crouch: use.stance > 0, bloom: st.bloom });
  const spread = spreadIn === null ? own : Math.min(own * 1.4 + 0.5, Math.max(own * 0.6, spreadIn));
  st.bloom = addBloom(g, st.bloom);
  const eye = me.eye;
  const dirs = pelletDirs(g, yaw, pitch, spread, serial);
  const damage = new Map<Player | Entity, { amount: number; head: boolean; at: Vec3; through: number }>();
  const wire: ShotWire = { by: me.id, item: id, ends: [], normals: [], blocks: [] };
  const carve = g.carve && host.carves ? g.carve : null;
  dirs.forEach((dir, i) => {
    const hit = use.hitscan(eye, dir, g.range, { penetration: g.penetration, rewind: fromScreen });
    wire.ends.push([hit.point.x, hit.point.y, hit.point.z, hit.target ? 2 : hit.block >= 0 ? 1 : 0]);
    wire.normals.push(hit.normal ? [hit.normal.x, hit.normal.y, hit.normal.z] : null);
    wire.blocks.push(hit.block);
    if (hit.walls.length) {
      wire.walls ??= dirs.map(() => []);
      wire.walls[i] = hit.walls.map((p) => [p.entry.x, p.entry.y, p.entry.z, p.normal.x, p.normal.y, p.normal.z, p.exit.x, p.exit.y, p.exit.z, p.out.x, p.out.y, p.out.z, p.block]);
    }
    // A block it hit loses a little of itself (the host's word: everyone's world takes it); a
    // wall it went through, a hole where it went in and where it came out.
    if (carve) {
      for (const p of hit.walls) {
        use.game.world.carve(p.entry, dir, { ...carve, by: me });
        use.game.world.carve(p.exit, { x: -dir.x, y: -dir.y, z: -dir.z }, { ...carve, by: me });
      }
      if (!hit.target && hit.block >= 0) use.game.world.carve(hit.point, dir, { ...carve, by: me });
    }
    if (!hit.target) return;
    const d = damage.get(hit.target) ?? { amount: 0, head: false, at: hit.point, through: 0 };
    d.amount += damageAt(g, hit.dist, hit.head, hit.through);
    d.head ||= hit.head;
    d.through = Math.max(d.through, hit.through);
    damage.set(hit.target, d);
  });
  host.emit('shot', { player: me, weapon: id, from: eye, dir: lookDir(yaw, pitch) });
  // What everyone else sees and hears (the shooter's own screen showed it already): the gun's own
  // shot as each screen has it (its look's), else the server's.
  host.send('gun.shot', wire, { except: me });
  host.audio({ except: me }).play(g.def.sounds?.use ?? 'gunshot', { at: { x: eye.x, y: eye.y, z: eye.z }, item: { id, sound: 'use' } });
  let marker: boolean | 'kill' | null = null;
  for (const [target, d] of damage) {
    if (!target.alive) continue;
    const was = target.health;
    const opts = { source: me, knockback: g.def.knockback ?? 0, crit: d.head, weapon: id, headshot: d.head, from: eye, cause: 'gun' as const, part: d.head ? ('head' as const) : ('body' as const), ...(d.through > 0 && { through: Math.round(d.through * 100) / 100 }) };
    // A hit that didn't land (protected, or a `damage` listener cancelled it) gets no marker.
    if (!target.damage(d.amount, opts)) continue;
    // Numbers for the shooter alone (a creature shows its own to everyone): what it took off them.
    if (target.kind === 'player') me.fx.damageNumber({ x: d.at.x, y: d.at.y + 0.3, z: d.at.z }, Math.round(was - target.health), { crit: d.head });
    marker = !target.alive ? 'kill' : marker === 'kill' ? 'kill' : marker || d.head;
  }
  if (marker !== null) {
    use.hitMarker(marker);
    me.audio.play(marker === 'kill' ? 'kill' : 'hitmarker', { pitch: marker === true ? 1.25 : 1 });
  }
}
