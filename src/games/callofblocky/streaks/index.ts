import { math, type Bot, type FeedPart, type GameContext, type Player, type Prop, type PropModel, type Vec3 } from '@platform';
import type { Bots } from '../bots';
import { fighterOf, hostile, match, type Fighter } from '../match';
import chopperUrl from '../models/chopper.glb?url';
import hellstormUrl from '../models/hellstorm.glb?url';
import rotorUrl from '../models/rotor.glb?url';
import { TEAMS } from '../modes';
import { COLORS } from '../shared';
import { WEAPONS } from '../weapons';
import { CHOPPER, chopperMuzzle, chopperVehicle, chopperView, launchChopper, launchMissile, MISSILE, missileVehicle, PilotControls, turn, type ChopperState, type MissileState } from './flight';
import { STREAK_IDS, STREAKS, type StreakId } from './kinds';

/**
 * The killstreaks you steer, on the server: seven in a row earns a Hellstorm, ten an Attack Chopper
 * (free-for-all and Team Deathmatch), for whoever's picked them (`kinds.ts`). Earned ones wait until called in with 5 (a controller's
 * D-pad left), the latest first, and last until the match is over.
 *
 * Calling one in puts the fighter's controls and camera in it (`flight.ts` flies it, predicted on
 * their screen). A Hellstorm is steered from afar (`drive(..., { remote: true })`): their body
 * stays where it stood, frozen, for anyone to shoot; killed, they lose it. A chopper's pilot is up
 * in it (`drive`): off the ground, out of harm's way and nobody's target until it's over (shot down
 * or gone home), when they're back where they called it in. Bots call theirs in when the coast is
 * clear and fly them with controls of their own (`PilotControls`), the server stepping them (a
 * bot's body rides in its chopper).
 *
 * - **Hellstorm**: from high over the map it falls toward it; it goes off on the first thing it
 *   meets (or on anyone it passes close to) in a blast that takes out anyone within five blocks or
 *   so and craters the walls.
 * - **Attack Chopper**: forty seconds over the map, its cannon firing explosive rounds (tracers
 *   anyone can see; each goes off where it lands). Anyone it's hostile to can shoot it down (their
 *   guns' hits count, `shot`, falling off with range), for points; it shows on their screens, with
 *   its health. Bots take a moment to notice it, fire up at it in bursts, and their bullets do
 *   less damage to it than people's (`BOT_CHOPPER_DAMAGE`).
 *
 * Kills with either are the pilot's (the blasts are theirs, with the streak as the weapon: the
 * feed shows its picture, and they count toward the next streak). The pilot's own blasts don't
 * hurt them (`selfHarm`).
 */

/** The chopper's health. */
const CHOPPER_HP = 900;
/** Its rounds' speed (blocks a second): their tracers fly at it and they go off when they land. */
const ROUND_SPEED = 160;
/** Points for shooting a chopper down. */
const SHOT_DOWN = 200;
/**
 * Bots' bullets take this share of their damage off a chopper (people's count in full), so the
 * street's bots don't shoot a pilot out of the sky in a second or two.
 */
const BOT_CHOPPER_DAMAGE = 0.45;
/** Seconds a bot takes to start shooting at a chopper it's seen: an unskilled one's, a skilled one's. */
const BOT_NOTICE: [number, number] = [2.2, 1];
/** Seconds a bot keeps its aim on a chopper it's lost sight of (or turned from, to fight someone). */
const AIM_MEMORY = 3;

const Y = new math.Vector3(0, 1, 0);
const NEG_Z = new math.Vector3(0, 0, -1);

interface Flight {
  id: number;
  kind: StreakId;
  f: Fighter;
  pilot: Player;
  /** Its model (and the rotor or flame riding on it). */
  prop: Prop;
  parts: Prop[];
  rotor: Prop | null;
  /** The vehicle's state: the pilot's own (live, `player.vehicle.state`), or a bot's that the server steps. */
  state: MissileState | ChopperState;
  /** A bot's controls (null: a person flies it). */
  ai: PilotControls | null;
  skill: number;
  target: Player | null;
  retarget: number;
  err: Vec3;
  /** Rounds fired so far (the chopper). */
  fired: number;
  hp: number;
  spin: number;
  /** Where the pilot stood and was looking when they called it in (given back after). */
  from: Vec3;
  look: { yaw: number; pitch: number };
  /** Next rotor or whoosh sound, by the game's clock. */
  sound: number;
  /** The pilot's markers on everyone (by player id: whether a foe's or a friend's), and who has a marker on it. */
  marks: Map<string, 'foe' | 'friend'>;
  warned: Set<Player>;
  /** The health bar last shown on those markers. */
  shownHp: number;
  done: boolean;
}

/** A chopper leaving: up and away, then gone. */
interface Leaving {
  prop: Prop;
  rotor: Prop | null;
  v: math.Vector3;
  t: number;
  spin: number;
}

export interface StreakHooks {
  /** The bots (a bot flying a streak is taken out of their hands meanwhile). */
  bots: Bots;
  /** Points for something done, with a pop-up (shooting a chopper down). */
  award(f: Fighter, points: number, title: string): void;
}

/**
 * How much a gun's hit takes off a chopper `dist` blocks away: its damage at that range, falling
 * off as it does on a person (a shotgun: a few of its pellets).
 */
function chopperDamage(weapon: string, dist: number): number {
  const w = WEAPONS[weapon] as { kind?: string; damage?: number | [number, number]; falloff?: [number, number]; pellets?: number } | undefined;
  if (!w || w.kind !== 'gun' || w.damage === undefined) return 0;
  const [near, far] = Array.isArray(w.damage) ? w.damage : [w.damage, w.damage];
  const [a, b] = w.falloff ?? [20, 50];
  const k = b > a ? Math.min(1, Math.max(0, (dist - a) / (b - a))) : 0;
  return (near + (far - near) * k) * Math.min(3, w.pellets ?? 1);
}

const view = { at: new math.Vector3(), dir: new math.Vector3() };
const _m = new math.Vector3();
const _d = new math.Vector3();

export class Streaks {
  private flights: Flight[] = [];
  private leaving: Leaving[] = [];
  private nextId = 1;
  private models!: { hellstorm: PropModel; chopper: PropModel; rotor: PropModel };
  /** Bots holding a streak: when they may call it in. */
  private botAt = new Map<Player, number>();
  private markAt = 0;
  /** Where each pilot's last streak was (for the kill cams of its kills): by pilot id. */
  private recent = new Map<string, { kind: StreakId; at: Vec3; dir: Vec3 }>();
  /**
   * Bots shooting up at a chopper: which, their next burst (from `next` to `until`), how far off
   * it's aimed, and when they last had it in sight (they keep their place in it for a moment).
   */
  private aimers = new Map<Player, { chopper: number; next: number; until: number; err: Vec3; seen: number }>();

  constructor(
    private game: GameContext,
    private hooks: StreakHooks,
  ) {}

  /** Their models, and the streaks as items (the kill feed shows their pictures: `client/looks.ts`). */
  setup() {
    const g = this.game;
    this.models = { hellstorm: g.props.gltf(hellstormUrl, { radius: 1 }), chopper: g.props.gltf(chopperUrl, { radius: 5 }), rotor: g.props.gltf(rotorUrl, { radius: 5.6 }) };
    for (const id of STREAK_IDS) g.items.define(id, { kind: 'misc', name: STREAKS[id].name });
  }

  /** Streaks are earned in this match: a free-for-all or Team Deathmatch. */
  get on(): boolean {
    return match.mode.id === 'ffa' || match.mode.id === 'tdm';
  }

  /** Someone's streak reached one: it's theirs to call in. */
  earn(f: Fighter, id: StreakId) {
    f.streaks.push(id);
    const p = f.player;
    if (p.bot) {
      if (!this.botAt.has(p)) this.botAt.set(p, this.game.clock.now + 1.5 + Math.random() * 3);
      return;
    }
    p.hud.banner(`${STREAKS[id].name.toUpperCase()} READY`, 'Press 5 to call it in', { color: COLORS.gold, duration: 2.6 });
    p.audio.play('streak_ready');
  }

  /** Whether this player is flying one now. */
  flying(p: Player): boolean {
    return this.flights.some((x) => x.pilot === p);
  }

  /** What this fighter can call in (the latest first), for their HUD. */
  ready(f: Fighter): string {
    const n = f.streaks.length;
    if (!n || !this.on) return '';
    return STREAKS[f.streaks[n - 1]].name + (n > 1 ? ` +${n - 1}` : '');
  }

  /** The chopper they're flying: its seconds left and health (for their HUD), else null. */
  chopperOf(p: Player): { left: number; hp: number } | null {
    const fl = this.flights.find((x) => x.pilot === p && x.kind === 'chopper');
    if (!fl) return null;
    return { left: Math.max(0, CHOPPER.life - (fl.state as ChopperState).t), hp: Math.max(0, fl.hp / CHOPPER_HP) };
  }

  /** Each tick: calls to bring one in, the flights, bots firing up at choppers, the pilots' markers. */
  update(dt: number) {
    const g = this.game;
    const now = g.clock.now;
    this.fadeOut(dt);
    if (match.phase !== 'playing') return;
    for (const f of match.fighters.values()) {
      const p = f.player;
      if (!p.bot) {
        if (!this.on || !p.input.pressed('Digit5')) continue;
        // (5 isn't the empty fifth slot while there are streaks to call in: the hand keeps what it holds.)
        p.input.consume('Digit5');
        if (!p.alive || this.flying(p)) continue;
        if (f.streaks.length) this.callIn(f, f.streaks.pop()!);
        else p.hud.toast(`${STREAKS.hellstorm.name} at ${STREAKS.hellstorm.kills} kills in a row, ${STREAKS.chopper.name} at ${STREAKS.chopper.kills}`);
      } else if (f.streaks.length && p.alive && this.on && !this.flying(p)) {
        // A bot calls it in once nobody's in its face (or it's waited long enough).
        const at = this.botAt.get(p) ?? now + 2;
        this.botAt.set(p, at);
        if (now >= at && (!this.hooks.bots.mind(p)?.target || now - at > 6)) {
          this.botAt.delete(p);
          this.callIn(f, f.streaks.pop()!);
        }
      }
    }
    for (const fl of [...this.flights]) this.fly(fl, dt);
    this.upAtChoppers();
    if (now >= this.markAt) {
      this.markAt = now + 0.25;
      for (const fl of this.flights) this.mark(fl);
    }
  }

  // -----------------------------------------------------------------------------------------------
  // Calling one in, and the end of it

  private callIn(f: Fighter, kind: StreakId) {
    const g = this.game;
    const p = f.player;
    const map = match.map;
    const b = map.bounds;
    const floor = map.floorY;
    const cx = (b.min.x + b.max.x) / 2;
    const cz = (b.min.z + b.max.z) / 2;
    // In from their side of the map.
    let dx = p.position.x - cx;
    let dz = p.position.z - cz;
    const l = Math.hypot(dx, dz);
    if (l < 1) (dx = 0), (dz = 1);
    else (dx /= l), (dz /= l);
    let state: MissileState | ChopperState;
    let prop: Prop;
    const parts: Prop[] = [];
    let rotor: Prop | null = null;
    if (kind === 'hellstorm') {
      const from = { x: cx + dx * 40, y: floor + 74, z: cz + dz * 40 };
      state = launchMissile(from, { x: cx - dx * 6, y: floor, z: cz - dz * 6 }, floor - 3);
      prop = g.props.spawn(this.models.hellstorm, { position: from });
      // Its motor: a flame out of the nozzle, backward.
      const flame = g.props.bolt({ color: '#ffb347', length: 2.4, width: 0.42, intensity: 5, flicker: 0.6, far: 40 });
      flame.attach(prop);
      flame.position.set(0, 0, 0.95);
      flame.quaternion.setFromAxisAngle(Y, Math.PI);
      parts.push(flame);
      g.audio.play('missile_launch', { at: from });
    } else {
      const hx = (b.max.x - b.min.x) / 2;
      const hz = (b.max.z - b.min.z) / 2;
      const box = { x0: b.min.x - 8, x1: b.max.x + 8, y0: floor + 20, y1: floor + 36, z0: b.min.z - 8, z1: b.max.z + 8 };
      const at = { x: math.MathUtils.clamp(cx + dx * (hx + 6), box.x0, box.x1), y: floor + 26, z: math.MathUtils.clamp(cz + dz * (hz + 6), box.z0, box.z1) };
      state = launchChopper(at, Math.atan2(dx, dz), box);
      prop = g.props.spawn(this.models.chopper, { position: at });
      rotor = g.props.spawn(this.models.rotor);
      rotor.attach(prop);
      rotor.position.set(0, 1.44, -0.25);
      parts.push(rotor);
    }
    const fl: Flight = {
      id: this.nextId++,
      kind,
      f,
      pilot: p,
      prop,
      parts,
      rotor,
      state,
      ai: null,
      skill: 0.5,
      target: null,
      retarget: 0,
      err: { x: 0, y: 0, z: 0 },
      fired: 0,
      hp: CHOPPER_HP,
      spin: 0,
      from: { x: p.position.x, y: p.position.y, z: p.position.z },
      look: { yaw: p.yaw, pitch: p.pitch },
      sound: 0,
      marks: new Map(),
      warned: new Set(),
      shownHp: 1,
      done: false,
    };
    // Their body frozen, their weapons down: where it stands (a Hellstorm), or up in the chopper,
    // where nothing can hurt it.
    p.freeze(true, { weapons: true });
    if (kind === 'chopper') p.protect(CHOPPER.life + 60);
    if (p.bot) {
      fl.ai = new PilotControls();
      fl.skill = this.hooks.bots.mind(p)?.skill ?? 0.5;
      this.hooks.bots.remove(p);
      (kind === 'hellstorm' ? missileVehicle : chopperVehicle).pose(state as never, prop.position, prop.quaternion);
      if (kind === 'chopper') this.aboard(fl);
    } else {
      const v = p.drive(kind, state, { prop, remote: kind === 'hellstorm' });
      fl.state = v.state;
      p.hud.crosshair(false);
      g.clients.send(p, 'cob.streak', { kind, life: kind === 'chopper' ? CHOPPER.life : MISSILE.life, floor });
    }
    this.flights.push(fl);
    this.recent.set(p.id, { kind, at: { ...prop.position }, dir: { x: -dx, y: 0, z: -dz } });
    // Everyone hears of it: enemies with a warning.
    const name = STREAKS[kind].name;
    g.hud.feed([{ text: p.name, color: this.nameColor(p) }, kind === 'hellstorm' ? ' fired a ' : ' called in an ', { icon: { item: kind, view: 'side' } }, ` ${name}`] as FeedPart[]);
    for (const q of g.players) {
      if (q === p || q.bot) continue;
      if (hostile(p, q)) {
        q.hud.toast(`Enemy ${name} inbound!`);
        q.audio.play('alarm', { volume: 0.45 });
      } else q.hud.toast(`Friendly ${name} inbound`);
    }
    this.mark(fl);
  }

  /** It's over: shot down or cut short (`gone`: it vanishes), or done (a chopper flies off). */
  private end(fl: Flight, how: 'done' | 'gone' = 'done') {
    if (fl.done) return;
    fl.done = true;
    this.flights.splice(this.flights.indexOf(fl), 1);
    const g = this.game;
    const p = fl.pilot;
    this.recent.set(p.id, { kind: fl.kind, at: { x: fl.prop.position.x, y: fl.prop.position.y, z: fl.prop.position.z }, dir: this.recent.get(p.id)?.dir ?? { x: 0, y: 0, z: 1 } });
    if (fl.kind === 'chopper' && how === 'done') {
      const s = fl.state as ChopperState;
      const out = new math.Vector3(-Math.sin(s.heading), 0, -Math.cos(s.heading)).multiplyScalar(18);
      out.y = 7;
      this.leaving.push({ prop: fl.prop, rotor: fl.rotor, v: out, t: 0, spin: fl.spin });
    } else {
      for (const x of fl.parts) x.remove();
      fl.prop.remove();
    }
    // Their markers, and the ones on it.
    for (const qid of fl.marks.keys()) p.hud.marker(`sk:${qid}`, null);
    for (const q of fl.warned) q.hud.marker(`chopper:${fl.id}`, null);
    // Back in their body (a bot, back to its own devices).
    if (fl.ai) {
      if (match.fighters.has(p.id)) this.hooks.bots.add(p as Bot, fl.skill);
    } else {
      if (p.vehicle) p.leaveVehicle();
      p.hud.crosshair(true);
      g.clients.send(p, 'cob.streak', null);
    }
    // Back where they called it in (from the chopper, down out of it).
    if (fl.kind === 'chopper') p.protect(0);
    if (p.alive) {
      p.freeze(false);
      p.teleport(fl.from, fl.look.yaw, fl.look.pitch);
    }
  }

  /** Whether they're up in a chopper (off the ground: nobody's target). */
  aloft(p: Player): boolean {
    return this.flights.some((x) => x.pilot === p && x.kind === 'chopper');
  }

  /** A bot's body rides in its chopper, in the cabin (a person's goes with the vehicle they drive). */
  private aboard(fl: Flight) {
    const s = fl.state as ChopperState;
    fl.pilot.teleport({ x: s.x, y: s.y - 0.9, z: s.z });
  }

  /** The pilot died, or left: theirs is over (a chopper flies off without them). */
  died(p: Player) {
    for (const fl of this.flights.filter((x) => x.pilot === p)) this.end(fl, fl.kind === 'chopper' ? 'done' : 'gone');
    this.botAt.delete(p);
  }

  /** A new match, or the end of one: everything's grounded. */
  reset() {
    for (const fl of [...this.flights]) this.end(fl, 'gone');
    for (const l of this.leaving) {
      l.rotor?.remove();
      l.prop.remove();
    }
    this.leaving = [];
    this.botAt.clear();
    this.recent.clear();
    this.aimers.clear();
  }

  // -----------------------------------------------------------------------------------------------
  // Flying

  private fly(fl: Flight, dt: number) {
    const p = fl.pilot;
    if (!p.alive || !match.fighters.has(p.id)) return this.end(fl, fl.kind === 'chopper' ? 'done' : 'gone');
    if (fl.ai) {
      this.pilot(fl, dt);
      const def = fl.kind === 'hellstorm' ? missileVehicle : chopperVehicle;
      def.step(fl.state as never, fl.ai, dt, this.game.world);
      def.pose(fl.state as never, fl.prop.position, fl.prop.quaternion);
      if (fl.kind === 'chopper') this.aboard(fl);
    }
    if (fl.kind === 'hellstorm') this.missile(fl);
    else this.chopper(fl, dt);
  }

  private missile(fl: Flight) {
    const g = this.game;
    const s = fl.state as MissileState;
    const now = g.clock.now;
    // It goes off on anyone it passes close to.
    if (!s.hit) {
      for (const q of g.players) {
        if (!q.alive || q === fl.pilot || !hostile(fl.pilot, q)) continue;
        if (Math.hypot(q.position.x - s.x, q.position.y + 0.9 - s.y, q.position.z - s.z) < 1.8) s.hit = 1;
      }
    }
    if (!s.hit) {
      if (now >= fl.sound) {
        fl.sound = now + 0.3;
        g.audio.play('missile_air', { at: { x: s.x, y: s.y, z: s.z }, volume: s.boost ? 1 : 0.7, pitch: s.boost ? 1.3 : 1 });
      }
      return;
    }
    const at = { x: s.x, y: s.y, z: s.z };
    this.recent.set(fl.pilot.id, { kind: 'hellstorm', at, dir: this.recent.get(fl.pilot.id)?.dir ?? { x: 0, y: 0, z: 1 } });
    g.world.explode(at, 3.4, { damage: [240, 30], reach: 9, knockback: 1.8, by: fl.pilot, weapon: 'hellstorm' });
    g.fx.explosion(at, { size: 4 });
    g.fx.shockwave(at, 11, '#ffcc66');
    g.fx.burst(at, { color: '#3a3a3a', count: 40, speed: 6, size: 0.9, gravity: -1.5, life: 2.4, drag: 1.5 });
    g.audio.play('explosion_big', { at });
    this.hooks.bots.hear(at, fl.pilot);
    this.end(fl, 'gone');
  }

  private chopper(fl: Flight, dt: number) {
    const g = this.game;
    const s = fl.state as ChopperState;
    const now = g.clock.now;
    fl.spin += dt * 13;
    fl.rotor?.quaternion.setFromAxisAngle(Y, fl.spin);
    // Its rounds: what it's fired since last time (a few at most, after a stall).
    for (let n = 0; fl.fired < s.shots && n < 4; n++) {
      fl.fired++;
      this.round(fl, s);
    }
    fl.fired = s.shots;
    if (now >= fl.sound) {
      fl.sound = now + 0.22;
      g.audio.play('rotor', { at: { x: s.x, y: s.y, z: s.z } });
    }
    this.recent.set(fl.pilot.id, { kind: 'chopper', at: { x: s.x, y: s.y, z: s.z }, dir: { x: 0, y: 0, z: 0 } });
    if (s.t >= CHOPPER.life) {
      if (!fl.pilot.bot) fl.pilot.hud.toast('The chopper is heading home');
      this.end(fl, 'done');
    }
  }

  /**
   * One round from the chin gun: along the sight line to what it's on (a wall, the ground, someone
   * in front of it), from the muzzle, a little spread. Its tracer flies there; it goes off on landing.
   */
  private round(fl: Flight, s: ChopperState) {
    const g = this.game;
    chopperView(s, view);
    let far: number = CHOPPER.range;
    const hit = g.world.raycast(view.at, view.dir, CHOPPER.range);
    if (hit) far = Math.hypot(hit.point.x - view.at.x, hit.point.y - view.at.y, hit.point.z - view.at.z);
    const body = this.bodyOnLine(view.at, view.dir, far, fl.pilot);
    if (body) far = body;
    const aim = _m.copy(view.at).addScaledVector(view.dir, far);
    const muzzle = chopperMuzzle(s);
    const dir = _d.copy(aim).sub(muzzle);
    let dist = dir.length();
    dir.normalize();
    const spread = 0.011;
    dir.x += (g.rng.next() - 0.5) * 2 * spread;
    dir.y += (g.rng.next() - 0.5) * 2 * spread;
    dir.z += (g.rng.next() - 0.5) * 2 * spread;
    dir.normalize();
    dist += 2;
    const wall = g.world.raycast(muzzle, dir, dist);
    if (wall) dist = Math.hypot(wall.point.x - muzzle.x, wall.point.y - muzzle.y, wall.point.z - muzzle.z);
    const someone = this.bodyOnLine(muzzle, dir, dist, fl.pilot);
    if (someone) dist = someone;
    const end = { x: muzzle.x + dir.x * (dist - 0.2), y: muzzle.y + dir.y * (dist - 0.2), z: muzzle.z + dir.z * (dist - 0.2) };
    const tracer = g.props.bolt({ color: '#ffd166', length: 5, width: 0.3, intensity: 7, far: 45 });
    tracer.quaternion.setFromUnitVectors(NEG_Z, dir);
    tracer.launch({ x: muzzle.x, y: muzzle.y, z: muzzle.z }, { x: dir.x * ROUND_SPEED, y: dir.y * ROUND_SPEED, z: dir.z * ROUND_SPEED });
    g.audio.play('chopper_gun', { at: { x: muzzle.x, y: muzzle.y, z: muzzle.z } });
    g.fx.burst({ x: muzzle.x, y: muzzle.y, z: muzzle.z }, { color: '#ffcc66', count: 3, speed: 2, size: 0.3, glow: 3, life: 0.08 });
    const pilot = fl.pilot;
    g.clock.after(dist / ROUND_SPEED, () => {
      tracer.remove();
      if (match.phase !== 'playing') return;
      // A little fireball and its bang (the explosion's own), a bite out of the wall.
      g.world.explode(end, 0.8, { damage: [58, 14], reach: 2.3, knockback: 0.4, by: pilot, weapon: 'chopper', effect: false });
      g.fx.explosion(end, { size: 0.55 });
    });
  }

  /** How far along a line (from `o`, along unit `d`, within `max`) it meets someone's body (not `except`), or null. */
  private bodyOnLine(o: Vec3, d: Vec3, max: number, except: Player): number | null {
    let best: number | null = null;
    for (const q of this.game.players) {
      if (!q.alive || q === except) continue;
      const cx = q.position.x - o.x;
      const cy = q.position.y + 0.95 - o.y;
      const cz = q.position.z - o.z;
      const t = cx * d.x + cy * d.y + cz * d.z;
      if (t <= 0 || t >= max || (best !== null && t >= best)) continue;
      const off = Math.hypot(cx - d.x * t, (cy - d.y * t) * 0.55, cz - d.z * t);
      if (off < 0.6) best = t;
    }
    return best;
  }

  /** Choppers on their way home: up and away, the rotor still turning, then gone. */
  private fadeOut(dt: number) {
    for (const l of [...this.leaving]) {
      l.t += dt;
      l.spin += dt * 13;
      l.prop.position.addScaledVector(l.v, dt);
      l.rotor?.quaternion.setFromAxisAngle(Y, l.spin);
      if (l.t > 5) {
        l.rotor?.remove();
        l.prop.remove();
        this.leaving.splice(this.leaving.indexOf(l), 1);
      }
    }
  }

  // -----------------------------------------------------------------------------------------------
  // Shooting a chopper down

  /** A shot was fired (`shot`): if it hits a chopper its shooter's hostile to, that's damage. */
  shot(by: Player, weapon: string, from: Vec3, dir: Vec3) {
    for (const fl of this.flights) {
      if (fl.kind !== 'chopper' || !hostile(by, fl.pilot)) continue;
      const t = this.hitsChopper(fl.state as ChopperState, from, dir);
      if (t === null || t > 150) continue;
      if (this.game.world.raycast(from, dir, t)) continue;
      const dmg = chopperDamage(weapon, t) * (by.bot ? BOT_CHOPPER_DAMAGE : 1);
      if (!dmg) continue;
      fl.hp -= dmg;
      fl.prop.flash('#ffffff', 0.07);
      if (!by.bot) by.audio.play('hitmarker');
      if (fl.hp <= 0) this.shotDown(fl, by);
      return;
    }
  }

  /** Where a line meets a chopper (its nose, cabin and tail as balls), or null. */
  private hitsChopper(s: ChopperState, o: Vec3, d: Vec3): number | null {
    const h = s.heading;
    const fx = -Math.sin(h);
    const fz = -Math.cos(h);
    const balls: [number, number, number, number][] = [
      [s.x, s.y, s.z, 1.9],
      [s.x + fx * 2.9, s.y - 0.3, s.z + fz * 2.9, 1.4],
      [s.x - fx * 3.4, s.y + 0.3, s.z - fz * 3.4, 1.0],
    ];
    let best: number | null = null;
    for (const [x, y, z, r] of balls) {
      const cx = x - o.x;
      const cy = y - o.y;
      const cz = z - o.z;
      const t = cx * d.x + cy * d.y + cz * d.z;
      const d2 = cx * cx + cy * cy + cz * cz - t * t;
      if (t <= 0 || d2 > r * r) continue;
      const at = t - Math.sqrt(r * r - d2);
      if (best === null || at < best) best = at;
    }
    return best;
  }

  private shotDown(fl: Flight, by: Player) {
    const g = this.game;
    const s = fl.state as ChopperState;
    const at = { x: s.x, y: s.y, z: s.z };
    g.fx.explosion(at, { size: 4 });
    g.fx.burst(at, { color: '#2e2e2e', count: 50, speed: 7, size: 1, gravity: -1, life: 2.6, drag: 1.2 });
    g.fx.burst(at, { color: '#ffcc00', count: 30, speed: 9, size: 0.3, glow: 2, life: 0.9, gravity: 12 });
    g.audio.play('explosion_big', { at });
    g.hud.feed([{ text: by.name, color: this.nameColor(by) }, ' shot down ', { text: `${fl.pilot.name}'s`, color: this.nameColor(fl.pilot) }, { icon: { item: 'chopper', view: 'side' } }] as FeedPart[]);
    if (!fl.pilot.bot) fl.pilot.hud.banner('CHOPPER DOWN', `Shot down by ${by.name}`, { color: COLORS.red, duration: 2 });
    const f = fighterOf(by);
    if (f) this.hooks.award(f, SHOT_DOWN, 'CHOPPER DOWN');
    this.end(fl, 'gone');
  }

  /** Bots with nobody else to shoot fire up at an enemy chopper they can see. */
  /**
   * Bots with nobody else to fight shoot up at an enemy chopper in sight: once they've taken it in
   * (`BOT_NOTICE`), in short bursts with pauses between, each burst aimed off by an error of its
   * own (more for an unskilled bot), so whole bursts can go wide.
   */
  private upAtChoppers() {
    const g = this.game;
    const now = g.clock.now;
    const busy = new Set<Player>();
    for (const fl of this.flights) {
      if (fl.kind !== 'chopper') continue;
      const s = fl.state as ChopperState;
      for (const b of g.bots.all) {
        if (busy.has(b) || !b.alive || this.flying(b) || !hostile(b, fl.pilot)) continue;
        const mind = this.hooks.bots.mind(b);
        if (!mind || mind.target) continue;
        const e = b.eye;
        if (Math.hypot(s.x - e.x, s.y - e.y, s.z - e.z) > 75 || !g.world.lineOfSight(e, { x: s.x, y: s.y, z: s.z })) continue;
        busy.add(b);
        const miss = 1.6 + (1 - mind.skill) * 2.4;
        const off = () => ({ x: (Math.random() - 0.5) * miss, y: (Math.random() - 0.5) * miss, z: (Math.random() - 0.5) * miss });
        let a = this.aimers.get(b);
        if (!a || a.chopper !== fl.id) {
          const notice = BOT_NOTICE[0] + (BOT_NOTICE[1] - BOT_NOTICE[0]) * mind.skill;
          this.aimers.set(b, (a = { chopper: fl.id, next: now + notice, until: 0, err: off(), seen: now }));
        }
        a.seen = now;
        if (now >= a.next) {
          a.until = now + 0.5 + Math.random() * 0.5;
          a.next = a.until + 0.6 + Math.random() * 0.6;
          a.err = off();
        }
        b.controls.lookAt({ x: s.x + a.err.x, y: s.y + a.err.y, z: s.z + a.err.z });
        if (now < a.until) b.controls.click(0);
      }
    }
    // Out of sight (or busy) a while: they'll have to take it in again.
    for (const [b, a] of [...this.aimers]) if (now - a.seen > AIM_MEMORY) this.aimers.delete(b);
  }

  // -----------------------------------------------------------------------------------------------
  // Bots at the controls

  /** A bot's hands on its streak's controls this tick: turn toward its target, and go for it. */
  private pilot(fl: Flight, dt: number) {
    const g = this.game;
    const ai = fl.ai!;
    const now = g.clock.now;
    ai.keys.clear();
    ai.buttons = 0;
    ai.clicked = 0;
    ai.mouseX = 0;
    ai.mouseY = 0;
    if (!fl.target?.alive || now >= fl.retarget) {
      fl.target = this.pickTarget(fl);
      fl.retarget = now + (fl.kind === 'chopper' ? 3 : 99);
      const miss = (1 - fl.skill) * 2.4;
      fl.err = { x: (Math.random() - 0.5) * miss, y: (Math.random() - 0.5) * miss * 0.5, z: (Math.random() - 0.5) * miss };
    }
    const tgt = fl.target;
    const aimAt = (from: Vec3, yaw: number, pitch: number, k: number, rate: number) => {
      if (!tgt) return { dy: 1, dp: 1 };
      const to = { x: tgt.position.x + fl.err.x - from.x, y: tgt.position.y + 0.9 + fl.err.y - from.y, z: tgt.position.z + fl.err.z - from.z };
      const dy = turn(yaw, Math.atan2(-to.x, -to.z));
      const dp = Math.atan2(to.y, Math.hypot(to.x, to.z)) - pitch;
      const r = rate * dt;
      ai.mouseX = -math.MathUtils.clamp(dy, -r, r) / k;
      ai.mouseY = -math.MathUtils.clamp(dp, -r, r) / k;
      return { dy, dp };
    };
    if (fl.kind === 'hellstorm') {
      const s = fl.state as MissileState;
      const { dy, dp } = aimAt(s, s.yaw, s.pitch, s.boost ? MISSILE.steerBoosted : MISSILE.steer, 1.2 + fl.skill);
      if (!s.boost && s.t > 1.2 && Math.abs(dy) < 0.05 && Math.abs(dp) < 0.05) ai.clicked = 1;
      return;
    }
    const s = fl.state as ChopperState;
    chopperView(s, view);
    const { dy, dp } = aimAt(view.at, s.yaw, s.pitch, CHOPPER.aim, 1.4 + fl.skill * 1.6);
    const b = match.map.bounds;
    const gx = tgt ? tgt.position.x : (b.min.x + b.max.x) / 2;
    const gz = tgt ? tgt.position.z : (b.min.z + b.max.z) / 2;
    const d = Math.hypot(gx - s.x, gz - s.z);
    if (d > 26) ai.keys.add('KeyW');
    else if (d < 12) ai.keys.add('KeyS');
    else ai.keys.add(Math.floor(now / 5) % 2 ? 'KeyA' : 'KeyD');
    const want = s.y0 + 6;
    if (s.y < want - 1) ai.keys.add('Space');
    else if (s.y > want + 1) ai.keys.add('KeyC');
    if (tgt && Math.abs(dy) < 0.07 && Math.abs(dp) < 0.07 && g.world.lineOfSight(chopperMuzzle(s), { x: tgt.position.x, y: tgt.position.y + 1, z: tgt.position.z })) ai.buttons = 1;
  }

  /** Who a bot goes for: with the Hellstorm, whoever stands with the most others near; with the chopper, the nearest. */
  private pickTarget(fl: Flight): Player | null {
    const g = this.game;
    const foes = g.players.filter((q) => q.alive && q !== fl.pilot && hostile(fl.pilot, q) && !this.flying(q));
    if (!foes.length) return null;
    const s = fl.state;
    const score = (q: Player) => {
      if (fl.kind === 'hellstorm') return foes.filter((o) => Math.hypot(o.position.x - q.position.x, o.position.z - q.position.z) < 7).length + (q.bot ? 0 : 0.5) + Math.random() * 0.3;
      return -Math.hypot(q.position.x - s.x, q.position.z - s.z) + (q.bot ? 0 : 6);
    };
    return foes.reduce((a, q) => (score(q) > score(a) ? q : a));
  }

  // -----------------------------------------------------------------------------------------------
  // Markers

  /**
   * What the pilot sees: a box on everyone they're after (their side, in a team mode, a dot); and
   * on everyone the chopper's hostile to, a marker on it with its health.
   */
  private mark(fl: Flight) {
    const g = this.game;
    const p = fl.pilot;
    if (!p.bot) {
      const seen = new Set<string>();
      for (const q of g.players) {
        if (q === p || !q.alive) continue;
        seen.add(q.id);
        const foe = hostile(p, q);
        const kind = foe ? 'foe' : 'friend';
        if (fl.marks.get(q.id) === kind) continue;
        fl.marks.set(q.id, kind);
        const team = fighterOf(q)?.team;
        p.hud.marker(`sk:${q.id}`, q, foe ? { shape: 'box', color: '#ff2e3f', size: { world: 1.6, min: 18, max: 56 }, offset: { x: 0, y: 1, z: 0 } } : { shape: 'dot', color: team !== null && team !== undefined ? TEAMS[team].color : '#ffffff', size: 6, offset: { x: 0, y: 2.3, z: 0 } });
      }
      for (const qid of [...fl.marks.keys()]) {
        if (seen.has(qid)) continue;
        p.hud.marker(`sk:${qid}`, null);
        fl.marks.delete(qid);
      }
    }
    if (fl.kind !== 'chopper') return;
    const hp = Math.max(0, fl.hp / CHOPPER_HP);
    const redo = Math.abs(hp - fl.shownHp) > 0.01;
    fl.shownHp = hp;
    for (const q of g.players) {
      if (q === p || q.bot || !hostile(p, q)) continue;
      if (fl.warned.has(q) && !redo) continue;
      fl.warned.add(q);
      q.hud.marker(`chopper:${fl.id}`, fl.prop, { shape: 'diamond', color: COLORS.red, label: 'ENEMY CHOPPER', edge: true, size: 16, bar: hp, offset: { x: 0, y: 2.2, z: 0 } });
    }
    if (!p.bot && redo) g.clients.send(p, 'cob.hull', hp);
  }

  private nameColor(p: Player): string {
    const t = fighterOf(p)?.team;
    return match.mode.teams && t !== null && t !== undefined ? TEAMS[t].color : p.bot ? '#ffe7a3' : COLORS.gold;
  }

  // -----------------------------------------------------------------------------------------------
  // Kill cams

  /**
   * Where a kill cam of a streak's kill looks from (a camera standing still: through the pilot's
   * eyes it would be their body on the ground): beside where the victim fell, the Hellstorm coming
   * down on them, or looking up at the chopper. Null for anything else.
   */
  killcamView(victim: Player, killer: Player, weapon: string | undefined): { at: Vec3; look: Vec3 } | null {
    if (weapon !== 'hellstorm' && weapon !== 'chopper') return null;
    const r = this.recent.get(killer.id);
    const v = victim.position;
    if (weapon === 'hellstorm') {
      // Side on to the way it came in, back a way and up.
      const d = r?.dir ?? { x: 0, y: 0, z: 1 };
      const sx = -d.z || 1;
      const sz = d.x;
      return { at: { x: v.x + sx * 13 - d.x * 6, y: v.y + 9, z: v.z + sz * 13 - d.z * 6 }, look: { x: v.x, y: v.y + 3, z: v.z } };
    }
    const c = r?.at ?? { x: v.x, y: v.y + 25, z: v.z + 10 };
    const hx = v.x - c.x;
    const hz = v.z - c.z;
    const l = Math.hypot(hx, hz) || 1;
    return { at: { x: v.x + (hx / l) * 7, y: v.y + 2.5, z: v.z + (hz / l) * 7 }, look: { x: (v.x + c.x) / 2, y: (v.y + c.y) / 2, z: (v.z + c.z) / 2 } };
  }
}

/** A streak's blast never hurts its own pilot, nor the Mortar Team's its caller (`damage` listener). */
export const selfHarm = (weapon: string | undefined, target: unknown, source: unknown) => (weapon === 'hellstorm' || weapon === 'chopper' || weapon === 'mortar') && target === source;
