import type { Vec3 } from '@platform';
import type { Client, ClientKit } from '@platform/client';
import { fuseSteps, isThrowable, throwable, type ThrowOwn } from '@platform/items';
import { Flights, ThrowController, type ClientThrown } from './thrower';

declare module '@platform/client' {
  interface ClientEvents {
    /** A throwable's pin pulled: it's being cooked (`client.me.items.throwable.cooking`). */
    cook: { item: string };
    /** A throw left our hand (the first-person kit tosses). */
    toss: {};
    /** Something thrown: ours (it just left our hand), or someone else's. It flies in `thrownOn(client)`. */
    thrown: { key: string; item: string; mine: boolean };
    /** Something thrown hit a block as it flew, at `speed` (blocks a second). */
    bounce: { key: string; item: string; at: Vec3; speed: number };
    /** It's gone: went off at `at`, or (null) the server turned it down or never said. */
    thrownEnd: { key: string; item: string; at: Vec3 | null };
    /** A fire started (a molotov broke): flames `radius` round `at` for `duration` seconds. */
    fire: { id: number; at: Vec3; radius: number; duration: number; color: string };
  }
}

/** Throwables on a screen (`client.me.items.throwable`): what they carry with keys of their own, and one being cooked. */
export interface ThrowView {
  /**
   * Throwables with a key of their own that they carry (thrown whatever's in hand), in hotbar
   * order: how many (less the throws the server hasn't taken yet), and the key (`'KeyG'`).
   */
  quick: { item: string; count: number; key: string }[];
  /**
   * A throwable being cooked (its pin out, held to throw): which, for how long (seconds), and the
   * fuse it burns down (seconds; 0 when holding it doesn't burn it).
   */
  cooking: { item: string; held: number; fuse: number } | null;
}

/** Each screen's throwables in the air (the throwable kit's), for the kits that draw them. */
const flying = new WeakMap<Client, readonly ClientThrown[]>();

/** Things thrown, in the air on this screen now (see `ClientThrown`): the throwable kit's, if the game uses it. */
export function thrownOn(client: Client): readonly ClientThrown[] {
  return flying.get(client) ?? [];
}

/**
 * Throwables on this screen: the throwable kit's client half (`kind: 'throwable'`). Hold a
 * throwable's key (or, with one in hand, the fire button) to pull the pin and cook it, let go to
 * throw it: it flies here at once and goes to the host with the next controls; everyone else's
 * fly here from the host's word, step by step as the host flies them, until it says they went
 * off. List it before the gun kit: while it's cooked or thrown, the fire button is its.
 */
export function throwables(): ClientKit {
  let ctl: ThrowController | null = null;
  let flights: Flights | null = null;
  /** The host's word: the last throw of ours it has taken. */
  let taken = 0;
  /** The replay showing when things last flew (0: none): a replay's things in the air are its own, and the live game's are back after it. */
  let replayId = 0;
  const sync = (client: Client) => {
    const id = client.replay.playing ? client.replay.id : 0;
    if (id === replayId) return;
    replayId = id;
    flights?.clear();
  };
  const start = (client: Client) => {
    if (ctl && flights) return;
    ctl = new ThrowController((id) => client.item(id));
    flights = new Flights((id) => client.item(id), { hit: (ox, oy, oz, dx, dy, dz, max) => hit(client, ox, oy, oz, dx, dy, dz, max) }, {
      bounce: (key, item, at, speed) => client.emit({ t: 'bounce', key, item, at, speed }),
      end: (key, item, at) => client.emit({ t: 'thrownEnd', key, item, at }),
    });
    flying.set(client, flights.list);
  };
  return {
    name: 'items.throwables',
    kind: 'throwable',
    setup(client) {
      start(client);
      // Someone else's throw (ours flies already): flown here from the host's word.
      client.on('throwable.thrown', (data) => {
        sync(client);
        const [key, item, , x, y, z, vx, vy, vz, fuse] = data as [string, string, string, number, number, number, number, number, number, number];
        if (flights!.add(key, item, { x, y, z }, { x: vx, y: vy, z: vz }, fuse)) client.emit({ t: 'thrown', key, item, mine: false });
      });
      client.on('throwable.end', (data) => {
        sync(client);
        const [key, at] = data as [string, [number, number, number] | null];
        flights!.end(key, at);
      });
      client.on('throwable.fire', (data) => {
        const [id, x, y, z, radius, duration, color] = data as [number, number, number, number, number, number, string];
        client.emit({ t: 'fire', id, at: { x, y, z }, radius, duration, color });
      });
    },
    controls(client, c, dt) {
      start(client);
      const me = client.me;
      const slots = me.hotbar?.slots ?? [];
      const held = me.hotbar ? (slots[me.hotbar.selected]?.item ?? null) : null;
      const eye = { x: me.position.x, y: me.position.y + (me.crouching && !me.flying ? 1.27 : 1.62), z: me.position.z };
      // Dead with one cooked: it drops where they fell, still live. Otherwise the controls cook and
      // throw (dead, they're idle: nothing cooks, and a key still held counts afresh).
      const made = (c.dead ? ctl!.drop(eye) : null) ?? ctl!.update(dt, { active: c.active, isDown: (k) => c.isDown(k), fire: c.button(0) }, slots, held, taken, eye, c.yaw, c.pitch, (item) => client.emit({ t: 'cook', item }));
      // (The hand's on it: the gun after this waits.)
      if (ctl!.cooking || ctl!.tossed) c.consume(0);
      if (!made) return;
      const def = client.item(made.item);
      if (!isThrowable(def)) return;
      c.act([made.serial, made.item, made.from.x, made.from.y, made.from.z, made.v.x, made.v.y, made.v.z, made.cooked]);
      // It flies here at once, on the path the host will fly it on (the client code draws it leaving the hand).
      const key = `${me.id}:${made.serial}`;
      if (flights!.add(key, made.item, made.from, made.v, fuseSteps(throwable(def), made.cooked), true)) client.emit({ t: 'thrown', key, item: made.item, mine: true });
      if (!c.dead) client.emit({ t: 'toss' });
    },
    frame(client, dt) {
      start(client);
      sync(client);
      for (const e of client.events) {
        if (e.t !== 'reset') continue;
        flights!.clear();
        ctl!.reset();
      }
      flights!.update(dt, client.running);
    },
    own(client, host) {
      start(client);
      // A replay's player: nothing of theirs to throw here.
      if (client.replay.playing) return { quick: [], cooking: null } satisfies ThrowView;
      taken = (host as ThrowOwn | null)?.thrown ?? 0;
      const me = client.me;
      const slots = me.hotbar?.slots ?? [];
      const c = ctl!.cooking;
      return {
        quick: ctl!.quick(slots).map((item) => {
          const d = client.item(item);
          return { item, count: ctl!.count(slots, item, taken), key: isThrowable(d) && d.key ? d.key : '' };
        }),
        cooking: c ? { item: c.item, held: c.held, fuse: c.t.cook ? c.t.fuse : 0 } : null,
      } satisfies ThrowView;
    },
    handItem: () => ctl?.inHand ?? null,
  };
}

/** The first solid block along a ray, as a flight meets it (this screen's world). */
function hit(client: Client, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, max: number) {
  const r = client.world.raycast({ x: ox, y: oy, z: oz }, { x: dx, y: dy, z: dz }, max);
  return r && { t: r.distance, nx: r.normal.x, ny: r.normal.y, nz: r.normal.z };
}
