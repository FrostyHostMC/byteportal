import type { Vec3 } from '@platform';
import type { Client, ClientKit } from '@platform/client';
import { HEROES, heroOfSaber, heroOfWeapon, type HeroId, type PowerId } from '../defs';
import type { FxBeam } from '../fxitems';
import { MSG, type Burn, type Clash, type Cut, type Deflects, type Guard, type P3, type Power, type Rocket, type Swing, type Zap } from '../wire';
import type { OwnSaber } from './predict';

/** Powers that last a while, as a hero's figure and effects show them. */
export type Lasting = 'soresu' | 'rage' | 'aura' | 'lightning' | 'choke' | 'roar' | 'flame' | 'jetpack';

/** A power's gesture on a figure: which, since when (this screen's clock), for how long. */
export interface Act {
  k: PowerId | 'land';
  at: number;
  t: number;
}

/** Someone a power has hold of, as their figure shows it (`down`: bowled over, flat on their back). */
export interface Victim {
  kind: 'choke' | 'pull' | 'thrown' | 'down';
  by: string;
  at: number;
  until: number;
}

/** A saber thrown: its flight (the server's), from when this screen heard of it. */
export interface Flight {
  item: string;
  from: Vec3;
  dir: Vec3;
  dist: number;
  at: number;
  t: number;
}

/** What happened this frame, for the effects (each message as it came). */
export type News =
  | { t: 'swing'; m: Swing }
  | { t: 'guard'; m: Guard }
  | { t: 'deflect'; m: Deflects['list'][number] }
  | { t: 'clash'; m: Clash }
  | { t: 'cut'; m: Cut }
  | { t: 'power'; m: Power }
  | { t: 'zap'; m: Zap }
  | { t: 'burst'; at: Vec3 };

/** Where a hero's blade was drawn this frame (the figures kit's word), for trails and sparks. */
export interface Blade {
  base: Vec3;
  tip: Vec3;
  /** Where the figure holding it stands (its trail is the blade's own sweep, not the hero's running or leaping). */
  at: Vec3;
  /** Drawn this frame (this screen's clock). */
  t: number;
  hero: HeroId;
}

/** The beam each hero's blade glows in (`fxitems.ts`). */
export const BEAM: Record<HeroId, FxBeam> = { luke: 'green', ben: 'blue', chewie: 'white', vader: 'red', emperor: 'crimson', boba: 'white' };

/** The blade's colour, linear-ish for particles. */
export const bladeColor = (id: HeroId) => HEROES[id].blade;

const v = (p: P3): Vec3 => ({ x: p[0], y: p[1], z: p[2] });

/**
 * What heroes are doing, as this screen has heard (the server's messages, `wire.ts`), kept for the
 * hero kits to read: each figure's swing, guard, stagger and power gestures (the figures kit poses
 * them), who's held by a power (choked, pulled), sabers in flight, lasting powers (a stance, a
 * rage, an aura, lightning), and this frame's news (the effects kit shows it). The figures kit
 * adds where each blade and hand is drawn.
 */
export class HeroScene {
  /** This screen's clock (`client.time`) as of this frame. */
  now = 0;
  /** Our own player (null watching, or in a replay), whose saber this screen runs ahead (`own`). */
  localId: string | null = null;
  own: OwnSaber | null = null;
  /** The client, while a frame's messages are heard (for our own saber's echoes). */
  private client: Client | null = null;
  swings = new Map<string, { n: number; at: number; d: number }>();
  guards = new Map<string, { on: boolean; at: number }>();
  staggers = new Map<string, { at: number; until: number; broke: boolean }>();
  /** When each hero's blade last turned a bolt, and toward where (the blade twitches to it). */
  flicks = new Map<string, { at: number; to: Vec3 }>();
  acts = new Map<string, Act>();
  victims = new Map<string, Victim>();
  flights = new Map<string, Flight>();
  /** Powers that last, by hero, until when. */
  lasting = new Map<string, Map<Lasting, number>>();
  /** Rockets in flight (by number): where the server last had each, which way, and when we heard. */
  rockets = new Map<number, { by: string; at: Vec3; dir: Vec3; heard: number; target: string | null }>();
  /** Ground burning, until when. */
  burns: { at: Vec3; until: number }[] = [];
  /** Lightning's targets now, by caster. */
  zaps = new Map<string, string[]>();
  /** When each hero last jumped a second time in the air (their figure flips; the Force shimmers). */
  flips = new Map<string, number>();
  blades = new Map<string, Blade>();
  hands = new Map<string, { l: Vec3; r: Vec3; t: number }>();
  news: News[] = [];
  /**
   * Development: hold every hero figure at one moment of a swing (`swing: [n, u]`, u 0..1 of the
   * way through) or in an act (`act: [k, t]`, t seconds in), to look at the poses
   * (`window.__heroes.debug`, in a development build).
   */
  debug: { swing?: [number, number]; act?: [Act['k'], number]; guard?: boolean } | null = null;
  /** Development: messages to take next frame as if the server sent them (`window.__heroes.inject`). */
  private injected: [string, unknown][] = [];
  inject(name: string, data: unknown) {
    this.injected.push([name, data]);
  }
  /** This frame's injected messages, taken. */
  takeInjected(): [string, unknown][] {
    const out = this.injected;
    this.injected = [];
    return out;
  }

  /** A lasting power of theirs, on now. */
  on(id: string, k: Lasting): boolean {
    return (this.lasting.get(id)?.get(k) ?? 0) > this.now;
  }

  /** The saber hero a player is by what they hold, if any (`client.figures`: `fig.held?.item`). */
  static heroOf(item: string | null | undefined): HeroId | null {
    return heroOfSaber(item);
  }
  /** The hero a player is by what they hold, saber or blaster. */
  static heroByWeapon(item: string | null | undefined): HeroId | null {
    return heroOfWeapon(item);
  }

  private last(id: string, k: Lasting, until: number) {
    let m = this.lasting.get(id);
    if (!m) this.lasting.set(id, (m = new Map()));
    m.set(k, until);
  }

  /** The client for this frame's messages (null after). */
  listen(client: Client | null) {
    this.client = client;
  }

  /** A message from the server. */
  hear(name: string, data: unknown) {
    const now = this.now;
    switch (name) {
      case MSG.swing: {
        const m = data as Swing;
        // Ours: this screen showed it already (or shows it now, if it didn't guess it).
        if (m.p === this.localId && this.own && this.client) {
          this.own.swing(this.client, this, m);
          this.news.push({ t: 'swing', m });
          break;
        }
        this.swings.set(m.p, { n: m.n, at: now, d: m.d });
        this.news.push({ t: 'swing', m });
        break;
      }
      case MSG.guard: {
        const m = data as Guard;
        if (m.p === this.localId && this.own) this.own.guardWord(this, m);
        else this.guards.set(m.p, { on: m.on, at: now });
        if (m.broke || m.st) this.staggers.set(m.p, { at: now, until: now + (m.st ?? 0.7), broke: !!m.broke });
        if (m.st || m.broke) this.swings.delete(m.p);
        this.news.push({ t: 'guard', m });
        break;
      }
      case MSG.deflect:
        for (const d of (data as Deflects).list) {
          this.flicks.set(d.p, { at: now, to: v(d.to) });
          this.news.push({ t: 'deflect', m: d });
        }
        break;
      case MSG.clash:
        this.news.push({ t: 'clash', m: data as Clash });
        break;
      case MSG.cut:
        this.news.push({ t: 'cut', m: data as Cut });
        break;
      case MSG.zap: {
        const m = data as Zap;
        this.zaps.set(m.p, m.hits);
        this.news.push({ t: 'zap', m });
        break;
      }
      case MSG.power: {
        const m = data as Power;
        this.power(m);
        this.news.push({ t: 'power', m });
        break;
      }
      case MSG.rocket: {
        const m = data as Rocket;
        const r = this.rockets.get(m.n);
        if (r) Object.assign(r, { at: v(m.at), dir: v(m.dir), heard: now });
        break;
      }
      case MSG.burn: {
        const m = data as Burn;
        for (const at of m.list) this.burns.push({ at: v(at), until: now + m.t });
        break;
      }
      case MSG.burst:
        for (const at of (data as Burn).list) this.news.push({ t: 'burst', at: v(at) });
        break;
    }
  }

  private power(m: Power) {
    const now = this.now;
    const off = m.on === false;
    switch (m.k) {
      case 'djump':
        // Ours ran ahead (`heroState`, from our own movement).
        if (m.p !== this.localId) this.flips.set(m.p, now);
        break;
      case 'push':
        this.acts.set(m.p, { k: 'push', at: now, t: 0.6 });
        for (const h of m.hits ?? []) this.victims.set(h, { kind: 'thrown', by: m.p, at: now, until: now + 0.8 });
        break;
      case 'pull':
        this.acts.set(m.p, { k: 'pull', at: now, t: 0.7 });
        if (m.target) this.victims.set(m.target, { kind: 'pull', by: m.p, at: now, until: now + (m.t ?? 1.5) });
        break;
      case 'choke':
        if (off) {
          this.last(m.p, 'choke', 0);
          if (this.acts.get(m.p)?.k === 'choke') this.acts.delete(m.p);
          if (m.target && this.victims.get(m.target)?.kind === 'choke') this.victims.delete(m.target);
        } else {
          this.last(m.p, 'choke', now + (m.t ?? 3));
          this.acts.set(m.p, { k: 'choke', at: now, t: m.t ?? 3 });
          if (m.target) this.victims.set(m.target, { kind: 'choke', by: m.p, at: now, until: now + (m.t ?? 3) });
        }
        break;
      case 'lightning':
        this.last(m.p, 'lightning', off ? 0 : now + (m.t ?? 3));
        if (off) {
          this.zaps.delete(m.p);
          if (this.acts.get(m.p)?.k === 'lightning') this.acts.delete(m.p);
        } else this.acts.set(m.p, { k: 'lightning', at: now, t: m.t ?? 3 });
        break;
      case 'chain':
        this.acts.set(m.p, { k: 'chain', at: now, t: 0.55 });
        break;
      case 'throw':
        if (m.from && m.dir) this.flights.set(m.p, { item: '', from: v(m.from), dir: v(m.dir), dist: m.dist ?? 10, at: now, t: m.t ?? 1 });
        this.acts.set(m.p, { k: 'throw', at: now, t: m.t ?? 1 });
        break;
      case 'soresu':
      case 'rage':
      case 'aura':
        this.last(m.p, m.k, off ? 0 : now + (m.t ?? 5));
        if (!off) this.acts.set(m.p, { k: m.k, at: now, t: m.k === 'soresu' ? (m.t ?? 5) : 0.7 });
        else if (this.acts.get(m.p)?.k === m.k) this.acts.delete(m.p);
        break;
      case 'rush':
        this.acts.set(m.p, { k: 'rush', at: now, t: 0.42 });
        break;
      case 'leap':
        this.acts.set(m.p, { k: 'leap', at: now, t: 1.6 });
        break;
      case 'land':
        this.acts.set(m.p, { k: 'land', at: now, t: 0.45 });
        for (const h of m.hits ?? []) this.victims.set(h, { kind: 'thrown', by: m.p, at: now, until: now + 0.8 });
        break;
      case 'scatter':
        this.acts.set(m.p, { k: 'scatter', at: now, t: 0.35 });
        break;
      case 'charge':
        this.acts.set(m.p, { k: 'charge', at: now, t: 0.85 });
        break;
      case 'knock':
        if (m.target) this.victims.set(m.target, { kind: 'down', by: m.p, at: now, until: now + (m.t ?? 1.2) });
        break;
      case 'roar':
        this.last(m.p, 'roar', off ? 0 : now + (m.t ?? 6));
        if (!off) {
          this.acts.set(m.p, { k: 'roar', at: now, t: 0.95 });
          for (const h of m.hits ?? []) this.victims.set(h, { kind: 'thrown', by: m.p, at: now, until: now + 0.8 });
        }
        break;
      case 'rocket':
        if (off) {
          if (m.t !== undefined) this.rockets.delete(m.t);
        } else if (m.t !== undefined && m.from && m.dir) {
          this.rockets.set(m.t, { by: m.p, at: v(m.from), dir: v(m.dir), heard: now, target: m.target ?? null });
          this.acts.set(m.p, { k: 'rocket', at: now, t: 0.4 });
        }
        break;
      case 'flame':
        this.last(m.p, 'flame', off ? 0 : now + (m.t ?? 3));
        if (off) {
          if (this.acts.get(m.p)?.k === 'flame') this.acts.delete(m.p);
        } else this.acts.set(m.p, { k: 'flame', at: now, t: m.t ?? 3 });
        break;
      case 'jetpack':
        this.last(m.p, 'jetpack', off ? 0 : now + (m.t ?? 4));
        break;
    }
  }

  /** The act a hero's figure shows now, if it's still going. */
  act(id: string): Act | null {
    const a = this.acts.get(id);
    if (!a) return null;
    if (this.now - a.at > a.t) {
      this.acts.delete(id);
      return null;
    }
    return a;
  }

  victim(id: string): Victim | null {
    const w = this.victims.get(id);
    if (!w) return null;
    if (this.now > w.until) {
      this.victims.delete(id);
      return null;
    }
    return w;
  }

  /** Where a saber in flight is now (and how far into its flight), if theirs is. */
  flight(id: string, hand: Vec3 | null): { at: Vec3; u: number; f: Flight } | null {
    const f = this.flights.get(id);
    if (!f) return null;
    const t = this.now - f.at;
    if (t > f.t) {
      this.flights.delete(id);
      return null;
    }
    const half = f.t / 2;
    const tip = { x: f.from.x + f.dir.x * f.dist, y: f.from.y + f.dir.y * f.dist, z: f.from.z + f.dir.z * f.dist };
    if (t < half) {
      const k = Math.sin((t / half) * Math.PI * 0.5);
      return { at: { x: f.from.x + (tip.x - f.from.x) * k, y: f.from.y + (tip.y - f.from.y) * k, z: f.from.z + (tip.z - f.from.z) * k }, u: t / f.t, f };
    }
    const back = hand ?? f.from;
    const u = (t - half) / half;
    const k = u * u * (3 - 2 * u);
    return { at: { x: tip.x + (back.x - tip.x) * k, y: tip.y + (back.y - tip.y) * k, z: tip.z + (back.z - tip.z) * k }, u: t / f.t, f };
  }

  /** A restart: everything goes. */
  clear() {
    for (const m of [this.swings, this.guards, this.staggers, this.flicks, this.acts, this.victims, this.flights, this.lasting, this.zaps, this.blades, this.hands, this.rockets, this.flips]) m.clear();
    this.burns = [];
    this.news = [];
  }
}

/**
 * The first of the hero kits: each frame, this frame's messages from the server into the scene
 * (the kits after it read it), then our own saber run ahead of the server (`own`).
 */
export function heroState(scene: HeroScene, own: OwnSaber | null = null): ClientKit {
  scene.own = own;
  return {
    name: 'blockfront.heroes.state',
    setup() {
      if (import.meta.env.DEV) (globalThis as { __heroes?: HeroScene }).__heroes = scene;
    },
    frame(client: Client) {
      scene.now = client.time;
      scene.news = [];
      scene.localId = client.replay.playing ? null : client.me.id;
      scene.listen(client);
      for (const e of client.events) {
        if (e.t === 'reset') scene.clear();
        else if (e.t === 'message' && e.name.startsWith('bfh.')) scene.hear(e.name, e.data);
      }
      for (const [name, data] of scene.takeInjected()) scene.hear(name, data);
      scene.listen(null);
      // Our own second jump, as our movement has it (run ahead of the server: `abilities.ts`'s `dj`).
      const dj = scene.localId ? client.me.abilities.hero?.dj : undefined;
      if (scene.localId && typeof dj === 'number' && dj < 0.6) {
        const at = scene.now - dj;
        const last = scene.flips.get(scene.localId);
        if (last === undefined || at - last > 0.25) scene.flips.set(scene.localId, at);
      }
      scene.own?.frame(client, scene);
    },
  };
}
