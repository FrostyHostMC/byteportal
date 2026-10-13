import type { GameContext, ItemHost, ItemKind, ItemKit, ItemUse, Player, Vec3 } from '@platform';
import { flyFor, fuseSteps, type ThrowOwn, isThrowable, lobView, newFlight, STEP, throwable, throwVelocity, type Flight, type FlightWorld, type Throwable, type ThrowableItem, type ThrownInfo } from '@platform/items';

/** A fire burning where a molotov broke (`fires`). */
export interface FireInfo {
  position: Vec3;
  radius: number;
  left: number;
  by: Player;
}

/** The throwable kit on the host, with what a game asks of throws. */
export interface Throwables extends ItemKind<ThrowableItem> {
  /**
   * Throw one of theirs, now, along their view, or one given (`yaw`, `pitch`), or lobbed to land at
   * `at`; `cook` seconds off its fuse. False if they have none, or threw one too recently.
   */
  throw(player: Player, item: string, opts?: { at?: Vec3; yaw?: number; pitch?: number; cook?: number }): boolean;
  /**
   * Throwables in the air (or come to rest, waiting to go off): what a bot keeps away from.
   * `radius` is how far one reaches (its blast's, or its fire's); `left`, seconds until it goes off.
   */
  thrown(): ThrownInfo[];
  /** The fires they started, burning (`left`: seconds until each is out). */
  fires(): FireInfo[];
}

/** One in the air (or at rest), as the host flies it. */
interface Live {
  key: string;
  item: string;
  t: Throwable;
  f: Flight;
  acc: { t: number };
  by: Player;
  /** Seconds since the throw (it can't hit its thrower straight out of their hand). */
  age: number;
}

/** A fire burning where a molotov broke. */
interface Fire {
  id: number;
  at: Vec3;
  radius: number;
  left: number;
  dps: number;
  by: Player;
  weapon: string;
  /** Seconds to its next burn. */
  next: number;
}

/** A player's throwing on the host. */
interface Hand {
  /** The last throw their screen made that the host has taken (or turned down), and the host's own count. */
  thrown: number;
  madeHere: number;
  /** When they last threw (host time), for its `cooldown`. */
  lastThrow: number;
  /** A throwable being cooked with no screen to do it (a bot holding its key): which, and for how long. */
  cooking: { item: string; cooked: number; key: string | null } | null;
  /** The keys held last step. */
  keysWere: Set<string>;
  /** Dead, and a throw of their screen's taken since (the one they had cooked, dropped): no more till they're back. */
  dropped: boolean;
}

/** A number, no bigger than `max` either way. */
const finite = (v: unknown, max: number): v is number => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= max;

/** How often a fire burns whoever's in it: long enough for the default `hurtCooldown`. */
const BURN_EVERY = 0.5;

/**
 * Throwables (`kind: 'throwable'`): grenades, molotovs. Hold a throwable's `key` (from any slot),
 * or the fire button with one in hand, to cook it (pull the pin); let go to throw it. Held past
 * its fuse, it goes off in the hand. It flies, bounces and rolls the same on every machine
 * (`@platform/items`), and when its fuse is out (or, with `impact`, when it strikes something or
 * someone) it goes off: the blast (damage, a push, a crater) and the fire, which burns on for its
 * while. A person's screen cooks and throws its own at once and sends each throw with its
 * controls (the kit's client half): the host takes it if they have one and aren't throwing faster
 * than its `cooldown`, and flies it from where their screen threw it. Bots cook and throw here.
 * List it before the gun: while cooking, it takes the fire button from the kits after it.
 */
export function throwables(): ItemKit<Throwables> {
  return (host) => throwables1(host);
}

/** The game's running throwable kit (`game.items.kind('throwable')`), with its helpers; null if it doesn't list throwables. */
throwables.of = (game: GameContext): Throwables | null => game.items.kind<Throwables>('throwable');

/** Throwables in one game. */
function throwables1(host: ItemHost): Throwables {
  const flight: FlightWorld = {
    hit(ox, oy, oz, dx, dy, dz, max) {
      const r = host.solid({ x: ox, y: oy, z: oz }, { x: dx, y: dy, z: dz }, max);
      return r && { t: r.dist, nx: r.normal.x, ny: r.normal.y, nz: r.normal.z };
    },
  };
  let live: Live[] = [];
  let fires: Fire[] = [];
  let nextFire = 1;
  const hands = new WeakMap<Player, Hand>();
  const handOf = (p: Player) => {
    let h = hands.get(p);
    if (!h) hands.set(p, (h = { thrown: 0, madeHere: 0, lastThrow: -99, cooking: null, keysWere: new Set(), dropped: false }));
    return h;
  };
  const def = (item: string) => host.game.items.get(item);
  const ready = (h: Hand, t: Throwable) => host.now() - h.lastThrow >= t.cooldown;

  /** In the air: `key` names it on every screen (the thrower's own already flies it when `mine`). */
  const launch = (by: Player, item: string, t: Throwable, from: Vec3, v: Vec3, fuse: number, key: string, mine: boolean) => {
    const f = newFlight(from, v, fuse);
    live.push({ key, item, t, f, acc: { t: 0 }, by, age: 0 });
    host.send('throwable.thrown', [key, item, by.id, f.x, f.y, f.z, f.vx, f.vy, f.vz, f.fuse], { except: mine ? by : undefined });
    // Their figure swings its arm; everyone else hears it go (their own screen played it).
    host.swing(by);
    host.audio({ except: mine ? by : undefined }).play(t.def.sounds?.use ?? 'whoosh', { at: { x: from.x, y: from.y, z: from.z }, volume: 0.7, item: { id: item, sound: 'use' } });
  };

  /** A throw made here (a bot letting go of its key, `throw`): from their eyes along a view (as hard as `speed`). */
  const throwNow = (p: Player, h: Hand, item: string, t: Throwable, yaw: number, pitch: number, cooked: number, speed = t.speed) => {
    if (!p.inventory.take(item, 1)) return false;
    h.lastThrow = host.now();
    launch(p, item, t, p.eye, throwVelocity(t, yaw, pitch, speed), fuseSteps(t, cooked), `${p.id}:h${++h.madeHere}`, false);
    return true;
  };

  /** One they had cooked, dropped where they fell (from their eyes, straight down), its fuse still burning. */
  const drop = (p: Player, h: Hand, item: string, t: Throwable, cooked: number) => {
    if (!p.inventory.take(item, 1)) return;
    h.lastThrow = host.now();
    launch(p, item, t, p.eye, { x: 0, y: -1, z: 0 }, fuseSteps(t, cooked), `${p.id}:h${++h.madeHere}`, false);
  };

  /** A throw their screen made: taken, or turned away (locked, every one is). */
  const take = (use: ItemUse<ThrowableItem>, h: Hand, serial: number, item: string, from: Vec3, v: Vec3, cook: number) => {
    if (serial <= h.thrown) return;
    h.thrown = serial;
    const p = use.player;
    const key = `${p.id}:${serial}`;
    const d = def(item);
    // Dead: one more (the one they had cooked falls, or a throw that crossed their death on the way), no others.
    const dead = !p.alive;
    // A little slack on the cooldown: their screen's clock isn't ours.
    if ((dead && h.dropped) || use.controls.locked || !isThrowable(d) || p.inventory.count(item) < 1 || use.now - h.lastThrow < throwable(d).cooldown * 0.6) {
      host.send('throwable.end', [key, null], { to: p });
      return;
    }
    const t = throwable(d);
    // From their eyes, give or take where their screen had them; no faster than it's thrown.
    const eye = p.eye;
    const start = Math.hypot(from.x - eye.x, from.y - eye.y, from.z - eye.z) < 2.5 ? from : eye;
    const speed = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
    const vel = !(speed > 0) ? throwVelocity(t, p.yaw, p.pitch) : speed > t.speed * 1.05 ? { x: (v.x / speed) * t.speed, y: (v.y / speed) * t.speed, z: (v.z / speed) * t.speed } : v;
    p.inventory.take(item, 1);
    h.lastThrow = use.now;
    h.dropped = dead;
    launch(p, item, t, start, vel, fuseSteps(t, cook), key, true);
  };

  /** Someone in its way (not its thrower, for a moment after it leaves their hand). */
  const meetsSomeone = (l: Live): boolean => {
    const f = l.f;
    for (const o of host.bodies()) {
      if (o.target === l.by && l.age < 0.4) continue;
      const hw = o.width / 2 + l.t.radius;
      if (Math.abs(f.x - o.feet.x) < hw && Math.abs(f.z - o.feet.z) < hw && f.y > o.feet.y - l.t.radius && f.y < o.feet.y + o.height + l.t.radius) return true;
    }
    return false;
  };

  const goOff = (l: Live) => {
    const h = host;
    const game = h.game;
    const at = { x: l.f.x, y: l.f.y, z: l.f.z };
    h.send('throwable.end', [l.key, [at.x, at.y, at.z]]);
    const b = l.t.blast;
    if (b) {
      h.guard(() => h.blast(at, { reach: b.radius, near: b.near, far: b.far, knockback: b.knockback, by: l.by, weapon: l.item }));
      game.fx.explosion(at, { size: b.size, color: b.color });
      if (b.carve > 0) game.world.explode(at, b.carve, { effect: false, by: l.by });
    }
    const fire = l.t.fire;
    if (fire) {
      // On the ground under where it broke (a wall's foot, the floor it hit).
      const down = flight.hit(at.x, at.y + 0.05, at.z, 0, -1, 0, 5);
      const ground = { x: at.x, y: down ? at.y + 0.05 - down.t : at.y, z: at.z };
      const id = nextFire++;
      fires.push({ id, at: ground, radius: fire.radius, left: fire.duration, dps: fire.damage, by: l.by, weapon: l.item, next: 0.15 });
      h.send('throwable.fire', [id, ground.x, ground.y, ground.z, fire.radius, fire.duration, fire.color]);
      game.audio.play(l.t.def.sounds?.hit ?? 'glass', { at, item: { id: l.item, sound: 'hit' } });
      game.audio.play('fire', { at: ground });
    }
  };

  /** Whoever's standing in a fire (not behind a wall from its middle) burns. */
  const burn = (fire: Fire) => {
    const h = host;
    const c = fire.at;
    for (const o of h.bodies()) {
      const p = o.feet;
      if (Math.hypot(p.x - c.x, p.z - c.z) > fire.radius + o.width / 2 || p.y < c.y - 1.2 || p.y > c.y + 1.6) continue;
      if (!h.game.world.lineOfSight({ x: c.x, y: c.y + 0.5, z: c.z }, { x: p.x, y: p.y + 0.5, z: p.z })) continue;
      h.guard(() => o.target.damage(fire.dps * BURN_EVERY, { source: fire.by, from: c, knockback: 0, weapon: fire.weapon, cause: 'fire' }));
    }
    // Now and then a crackle.
    if (Math.random() < 0.5) h.game.audio.play('fire', { at: c, volume: 0.6 });
  };

  return {
    kind: 'throwable',
    holds: true,
    step(use) {
      const h = handOf(use.player);
      if (use.player.alive) h.dropped = false;
      const sent = use.acts;
      if (sent) {
        for (const a of sent) {
          // [serial, item, from x, y, z, velocity x, y, z, seconds cooked], as their screen threw it (anything else is turned down).
          const [serial, item, x, y, z, vx, vy, vz, cook] = a as [number, string, number, number, number, number, number, number, number];
          if (a.length !== 9 || !Number.isSafeInteger(serial) || serial < 0 || typeof item !== 'string' || ![x, y, z, vx, vy, vz].every((v) => finite(v, 1e6)) || !finite(cook, 60) || cook < 0) continue;
          take(use, h, serial, item, { x, y, z }, { x: vx, y: vy, z: vz }, cook);
        }
        return;
      }
      const c = use.controls;
      // Dead with one cooked (a bot's, here): it drops where they fell, still live.
      if (!use.player.alive && h.cooking) {
        const ck = h.cooking;
        h.cooking = null;
        const d = def(ck.item);
        if (isThrowable(d)) drop(use.player, h, ck.item, throwable(d), ck.cooked);
      }
      if (!c.active) {
        h.cooking = null;
        h.keysWere.clear();
        return;
      }
      const p = use.player;
      const inv = p.inventory;
      const inHand = use.held?.item ?? null;
      const down = new Set<string>();
      if (h.cooking) {
        const ck = h.cooking;
        ck.cooked += use.dt;
        const d = def(ck.item);
        const held = ck.key ? c.isDown(ck.key) : c.button(0);
        if (!isThrowable(d) || inv.count(ck.item) < 1) h.cooking = null;
        else {
          const t = throwable(d);
          // Held too long: it goes off in the hand.
          if (!held || (t.cook && ck.cooked >= t.fuse)) {
            h.cooking = null;
            throwNow(p, h, ck.item, t, p.yaw, p.pitch, ck.cooked);
          }
        }
      } else {
        for (const s of inv.slots) {
          const d = s ? def(s.item) : undefined;
          if (!isThrowable(d) || !d.key) continue;
          if (c.isDown(d.key)) down.add(d.key);
          if (c.isDown(d.key) && !h.keysWere.has(d.key) && ready(h, throwable(d))) {
            h.cooking = { item: s!.item, cooked: 0, key: d.key };
            break;
          }
        }
        const d = inHand ? def(inHand) : undefined;
        if (!h.cooking && inHand && isThrowable(d) && c.buttonPressed(0) && ready(h, throwable(d))) h.cooking = { item: inHand, cooked: 0, key: null };
        if (h.cooking) {
          // The pin (its own sound, as their screen has it; none by default).
          const cd = def(h.cooking.item);
          p.audio.play(cd?.sounds?.draw ?? '', { item: { id: h.cooking.item, sound: 'draw' } });
        }
      }
      h.keysWere = down;
      // (The hand's on it: the gun after this waits.)
      if (h.cooking) c.consume(0);
    },
    own: (v) => ({ thrown: handOf(v.player).thrown }) satisfies ThrowOwn,
    update(h, dt) {
      for (const l of [...live]) {
        l.age += dt;
        let off = flyFor(l.f, l.t, flight, l.acc, dt);
        // An impact throwable breaks on whoever it meets, too (the host's word: screens fly it on until they hear).
        if (!off && l.t.impact && meetsSomeone(l)) off = true;
        if (!off) continue;
        live.splice(live.indexOf(l), 1);
        goOff(l);
      }
      for (const fire of [...fires]) {
        fire.left -= dt;
        fire.next -= dt;
        if (fire.next <= 0) {
          fire.next += BURN_EVERY;
          burn(fire);
        }
        if (fire.left <= 0) fires.splice(fires.indexOf(fire), 1);
      }
      void h;
    },
    reset(p, whole) {
      const h = handOf(p);
      h.cooking = null;
      h.lastThrow = -99;
      // A new person in their place: their screen counts its throws from the start.
      if (whole) h.thrown = 0;
    },
    clear() {
      live = [];
      fires = [];
    },
    throw(p, item, opts = {}) {
      const d = def(item);
      if (!isThrowable(d) || !p.alive || p.inventory.count(item) < 1) return false;
      const h = handOf(p);
      const t = throwable(d);
      if (!ready(h, t)) return false;
      let yaw = opts.yaw ?? p.yaw;
      let pitch = opts.pitch ?? p.pitch;
      let speed = t.speed;
      if (opts.at) {
        const lob = lobView(t, p.eye, opts.at);
        if (!lob) return false;
        ({ yaw, pitch, speed } = lob);
      }
      if (h.cooking?.item === item) h.cooking = null;
      return throwNow(p, h, item, t, yaw, pitch, opts.cook ?? 0, speed);
    },
    thrown: () =>
      live.map((l) => ({
        item: l.item,
        position: { x: l.f.x, y: l.f.y, z: l.f.z },
        by: l.by,
        radius: l.t.blast?.radius ?? l.t.fire?.radius ?? 0,
        left: Math.max(0, (l.f.fuse - l.f.steps) * STEP),
      })),
    fires: () => fires.map((f) => ({ position: { ...f.at }, radius: f.radius, left: f.left, by: f.by })),
  };
}
