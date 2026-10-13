import type { ItemDefinition, ItemStack, Vec3 } from '@platform';
import { flyFor, isThrowable, newFlight, throwable, throwVelocity, type Flight, type FlightWorld, type Throwable, type ThrowableItem } from '@platform/items';

/**
 * Something thrown, in the air on this screen: flown here step by step as the server flies it
 * (from the throw: ours at once, someone else's from the server's word), until the server says
 * it went off (`thrownOn(client)`).
 */
export interface ClientThrown {
  readonly key: string;
  readonly item: string;
  /** Thrown from this screen (it left our hand here). */
  readonly mine: boolean;
  readonly position: Vec3;
  /** Rolling or sliding along the ground; come to rest there. */
  readonly grounded: boolean;
  readonly resting: boolean;
  /** Seconds since it was thrown (on this screen). */
  readonly age: number;
  /** How far round it harm reaches when it goes off: its blast's radius and its fire's, added (0 for neither). */
  readonly reach: number;
}

/** A throw this screen made: for the host (the kit's actions), and to fly here at once. */
export interface ThrowMade {
  serial: number;
  item: string;
  from: Vec3;
  v: Vec3;
  cooked: number;
}

/** The controls a throw reads this frame. */
export interface ThrowControls {
  active: boolean;
  isDown(code: string): boolean;
  /** The fire button, held (for a throwable in hand). */
  fire: boolean;
}

/**
 * This player's throwables on their own screen: hold a throwable's `key` (or, with one in hand,
 * the fire button) to pull the pin and cook it, let go to throw it: at once, here (it flies on
 * this screen from this moment, see `Flights`), and to the host with the next controls. What
 * the hotbar shows is the host's word, less the throws it hasn't heard of yet.
 */
export class ThrowController {
  /** Throws made here so far (the host says which it has taken: `PlayerFrame.throws`). */
  serial = 0;
  /** Being cooked: which, for how long, and with which key (null: the fire button). */
  cooking: { item: string; def: ThrowableItem; t: Throwable; held: number; key: string | null } | null = null;
  /** Seconds since the last throw here (its cooldown; the hand's toss). */
  sinceThrow = 99;
  /** The throw just made, for the hand: which item (until the toss is over). */
  tossed: string | null = null;
  private keysWere = new Set<string>();

  constructor(private items: (id: string) => ItemDefinition | undefined) {}

  /** How many of `item` they have, less the throws the host hasn't taken yet. */
  count(slots: readonly (ItemStack | null)[], item: string, taken: number): number {
    let n = 0;
    for (const s of slots) if (s?.item === item) n += s.count;
    return Math.max(0, n - Math.max(0, this.serial - taken));
  }

  /** The throwables they carry with a key of their own (the HUD shows them), in hotbar order. */
  quick(slots: readonly (ItemStack | null)[]): string[] {
    const out: string[] = [];
    for (const s of slots) {
      const d = s ? this.items(s.item) : undefined;
      if (s && isThrowable(d) && d.key && !out.includes(s.item)) out.push(s.item);
    }
    return out;
  }

  /**
   * A frame: start cooking, cook, throw. `eye` is where they are now (as this screen has them),
   * `yaw` / `pitch` the view; `cooking` hears of a pin pulled. Returns a throw made, if one was.
   */
  update(dt: number, c: ThrowControls, slots: readonly (ItemStack | null)[], held: string | null, taken: number, eye: Vec3, yaw: number, pitch: number, cooking: (item: string) => void): ThrowMade | null {
    this.sinceThrow += dt;
    // Gone from the hand as the toss follows through: the hand goes down for what's next.
    if (this.sinceThrow > 0.28) this.tossed = null;
    const down = new Set<string>();
    if (!c.active) {
      this.cooking = null;
      this.keysWere.clear();
      return null;
    }
    let made: ThrowMade | null = null;
    const k = this.cooking;
    if (k) {
      k.held += dt;
      const still = k.key ? c.isDown(k.key) : c.fire;
      if (k.key) down.add(k.key);
      // Let go, or held past its fuse (it goes off in the hand).
      if (!still || (k.t.cook && k.held >= k.t.fuse)) {
        this.cooking = null;
        made = { serial: ++this.serial, item: k.item, from: eye, v: throwVelocity(k.t, yaw, pitch), cooked: k.held };
        this.sinceThrow = 0;
        this.tossed = k.item;
      }
    } else {
      const start = (item: string, def: ThrowableItem, key: string | null) => {
        const t = throwable(def);
        if (this.sinceThrow < t.cooldown || this.count(slots, item, taken) < 1) return false;
        this.cooking = { item, def, t, held: 0, key };
        cooking(item);
        return true;
      };
      for (const s of slots) {
        const d = s ? this.items(s.item) : undefined;
        if (!s || !isThrowable(d) || !d.key) continue;
        if (c.isDown(d.key)) {
          down.add(d.key);
          if (!this.keysWere.has(d.key) && start(s.item, d, d.key)) break;
        }
      }
      const d = held ? this.items(held) : undefined;
      if (!this.cooking && held && isThrowable(d) && c.fire && !this.fireWas) start(held, d, null);
    }
    this.fireWas = c.fire;
    this.keysWere = down;
    return made;
  }
  private fireWas = false;

  /** The item the hand shows for a throw (cooking one by its key, or just thrown), if any. */
  get inHand(): string | null {
    return this.cooking?.key ? this.cooking.item : this.tossed;
  }

  /**
   * They died with one cooked: it drops where they were (from `eye`, straight down), its fuse still
   * burning, a throw like any other (it goes off where they fell). Null with nothing cooked.
   */
  drop(eye: Vec3): ThrowMade | null {
    const k = this.cooking;
    if (!k) return null;
    this.cooking = null;
    this.tossed = null;
    return { serial: ++this.serial, item: k.item, from: eye, v: { x: 0, y: -1, z: 0 }, cooked: k.held };
  }

  reset() {
    this.cooking = null;
    this.tossed = null;
    this.sinceThrow = 99;
  }
}

/** One throwable in the air as this screen flies it (`client.thrown`). */
class Flying implements ClientThrown {
  readonly acc = { t: 0 };
  age = 0;
  /** Came to its fuse here before the host's word: it waits where it is (seconds so far). */
  waiting = 0;
  readonly reach: number;

  constructor(
    readonly key: string,
    readonly item: string,
    readonly t: Throwable,
    readonly f: Flight,
    readonly mine: boolean,
  ) {
    this.reach = (t.blast?.radius ?? 0) + (t.fire ? t.fire.radius : 0);
  }

  get position() {
    return { x: this.f.x, y: this.f.y, z: this.f.z };
  }
  get grounded() {
    return this.f.ground;
  }
  get resting() {
    return this.f.rest;
  }
}

/** What flights tell the client code: a knock as one bounces, and one gone. */
export interface FlightNews {
  bounce(key: string, item: string, at: Vec3, speed: number): void;
  end(key: string, item: string, at: Vec3 | null): void;
}

/**
 * Throwables in the air on this screen: each flown step by step as the host flies it
 * (`sim/throwables`), from the throw (ours: from the moment we threw; others': from the host's
 * word), until the host says it went off. What they look like is client code's (`client.thrown`,
 * and the `thrown` / `bounce` / `thrownEnd` events: see `effects.throwables()`).
 */
export class Flights {
  private shown = new Map<string, Flying>();
  /** Everything in the air, kept in place (`client.thrown`). */
  readonly list: ClientThrown[] = [];

  constructor(
    private items: (id: string) => ItemDefinition | undefined,
    private world: FlightWorld,
    private news: FlightNews,
  ) {}

  /** One in the air: from `from` at `v`, going off `fuse` steps on; `mine` when this screen threw it. Whether it's new. */
  add(key: string, item: string, from: Vec3, v: Vec3, fuse: number, mine = false): boolean {
    const def = this.items(item);
    if (!isThrowable(def) || this.shown.has(key)) return false;
    const s = new Flying(key, item, throwable(def), newFlight(from, v, fuse), mine);
    this.shown.set(key, s);
    this.list.push(s);
    return true;
  }

  /** The host set one off at `at` (or turned it down: null). */
  end(key: string, at: [number, number, number] | null) {
    const s = this.shown.get(key);
    if (!s) return;
    if (at) {
      s.f.x = at[0];
      s.f.y = at[1];
      s.f.z = at[2];
    }
    this.drop(s, at ? { x: at[0], y: at[1], z: at[2] } : null);
  }

  update(dt: number, running: boolean) {
    for (const s of [...this.shown.values()]) {
      s.age += dt;
      if (running && s.waiting === 0) {
        const done = flyFor(s.f, s.t, this.world, s.acc, dt, (speed) => this.news.bounce(s.key, s.item, { x: s.f.x, y: s.f.y, z: s.f.z }, speed));
        // Its time's up here: it waits where it is for the host's word (which is coming).
        if (done) s.waiting = 0.0001;
      }
      if (s.waiting > 0) {
        s.waiting += dt;
        if (s.waiting > 1.5) this.drop(s, null);
      }
    }
  }

  private drop(s: Flying, at: Vec3 | null) {
    this.shown.delete(s.key);
    this.list.splice(this.list.indexOf(s), 1);
    this.news.end(s.key, s.item, at);
  }

  clear() {
    this.shown.clear();
    this.list.length = 0;
  }
}
