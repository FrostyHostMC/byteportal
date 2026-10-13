import { Blueprint, math, type Bot, type GameContext, type Player, type Prop, type PropModel, type Vec3 } from '@platform';
import type { BotMind } from '@platform/kits';
import type { Bots } from './bots';
import type { Site, SpawnPoint } from './map';
import { fighterOf, match, teamFighters, type Fighter } from './match';
import { ROUNDS, TEAMS, type Team } from './modes';
import { COLORS } from './shared';

/**
 * The Briefcase: Search and Destroy, pulp style. The attackers carry a briefcase (whatever's in it
 * glows, and it goes off) to one of two sites and plant it there (hold F for a few seconds); the
 * defenders stop them, or crack it open again (hold F by it) before the fuse runs out. One life a
 * round: a side that's all down loses it, unless the case is planted, when the defenders still
 * have to crack it. Time running out before a plant is the defenders' round. First to `ROUNDS`
 * rounds takes the match, and the sides swap after `ROUNDS - 1`.
 *
 * The carrier's team sees who has it; if they go down it drops where they fell, and any attacker
 * can pick it up by walking over it. The case is a little block model on the ground (a prop),
 * and once planted it lies open, glowing, with a beam up into the sky.
 *
 * Bots play it: the carrier takes it to the site its side picked this round, the others escort
 * it (or go for it when it's dropped); defenders split between the sites and hold them, go to
 * see about shots nearby, and rush a planted case, the nearest one cracking it. A bot plants and
 * cracks only with nobody in sight.
 */

/** Seconds: frozen at the start of a round; to plant; the fuse; to crack; the pause after a round. */
const PREP = 5;
const ROUND_TIME = 105;
const FUSE = 35;
const PLANT = 3.5;
const DEFUSE = 6;
const POST = 6;
/** How near an attacker picks up a dropped case, and a defender cracks a planted one. */
const PICKUP = 1.6;
const REACH = 1.9;
const POINTS = { plant: 300, defuse: 300, round: 200 };
const KEY = 'KeyF';

type Phase = 'prep' | 'live' | 'planted' | 'post';

/** What the rounds need from the rest of the server. */
export interface CaseHost {
  /** Revive a fighter and put them at a spawn, armed. */
  spawnAt(f: Fighter, at: SpawnPoint): void;
  /** Points for something done, with a pop-up for them. */
  award(f: Fighter, points: number, title: string): void;
  /** The match is over: this side won. */
  endMatch(winner: Team): void;
}

export class CaseRounds {
  round = 0;
  phase: Phase = 'prep';
  /** When the phase began (`game.clock.now`). */
  phaseAt = 0;
  /** Who attacks this round. */
  attackers: Team = 0;
  /** The site the attacking bots go for this round. */
  target: Site | null = null;
  carrier: Fighter | null = null;
  /** The case lying where its carrier fell. */
  dropped: Vec3 | null = null;
  planted: { site: Site; at: Vec3; by: Fighter; t: number } | null = null;
  /** Who's holding F over it: planting or cracking, and for how long. */
  private acting = new Map<string, { kind: 'plant' | 'defuse'; t: number }>();
  /** Why the last round ended, and who won it. */
  result: { winner: Team; why: string } | null = null;
  private props: Prop[] = [];
  private models: { closed: PropModel; open: PropModel } | null = null;
  private beepAt = 0;

  constructor(
    private game: GameContext,
    private host: CaseHost,
  ) {}

  get defenders(): Team {
    return (1 - this.attackers) as Team;
  }

  /** A fighter's side this round. */
  side(f: Fighter): 'attack' | 'defend' | null {
    return f.team === null ? null : f.team === this.attackers ? 'attack' : 'defend';
  }

  /** Seconds left on the clock that matters: the round's, or the fuse. */
  clock(): number {
    const now = this.game.clock.now;
    if (this.phase === 'prep') return Math.max(0, PREP - (now - this.phaseAt));
    if (this.phase === 'live') return Math.max(0, ROUND_TIME - (now - this.phaseAt));
    if (this.phase === 'planted' && this.planted) return Math.max(0, FUSE - (now - this.planted.t));
    return 0;
  }

  /** A fighter's plant or crack in progress, 0..1 (null: not at it). */
  progress(f: Fighter): { kind: 'plant' | 'defuse'; p: number } | null {
    const a = this.acting.get(f.player.id);
    return a ? { kind: a.kind, p: Math.min(1, a.t / (a.kind === 'plant' ? PLANT : DEFUSE)) } : null;
  }

  // -----------------------------------------------------------------------------------------------
  // Rounds
  // -----------------------------------------------------------------------------------------------

  /** A new match: team 0 attacks first. */
  begin() {
    this.round = 0;
    this.attackers = 0;
    this.result = null;
    this.models ??= { closed: this.game.props.model(caseModel(false), { scale: 1 / 12, pivot: { x: 5, y: 0, z: 3.5 } }), open: this.game.props.model(caseModel(true), { scale: 1 / 12, pivot: { x: 5, y: 0, z: 3.5 } }) };
    this.newRound();
  }

  private newRound() {
    const g = this.game;
    this.round++;
    const swap = this.round === ROUNDS;
    if (swap) this.attackers = this.defenders;
    this.phase = 'prep';
    this.phaseAt = g.clock.now;
    this.clearCase();
    this.result = null;
    const sites = match.map.bomb.sites;
    this.target = sites[g.rng.int(0, 1)];
    // Everyone back to their side's end of the map, frozen for the count.
    for (const t of [0, 1] as Team[]) {
      const points = t === this.attackers ? match.map.bomb.attack : match.map.bomb.defend;
      const order = shuffled(points.map((_, i) => i), () => g.rng.next());
      teamFighters(t).forEach((f, i) => {
        this.host.spawnAt(f, points[order[i % order.length]]);
        f.player.freeze(true, { weapons: true });
      });
    }
    // The case goes to one of the attackers, whoever.
    const att = teamFighters(this.attackers);
    this.carrier = att.length ? att[g.rng.int(0, att.length - 1)] : null;
    for (const f of match.fighters.values()) {
      const p = f.player;
      if (p.bot) continue;
      const attack = this.side(f) === 'attack';
      const title = swap ? 'SWITCHING SIDES' : `ROUND ${this.round}`;
      const sub = attack ? (f === this.carrier ? `You have the case: plant it at A or B (hold F)` : 'Attack: get the case planted at A or B') : 'Defend: keep the case off A and B';
      p.hud.banner(title, sub, { color: attack ? TEAMS[this.attackers].color : TEAMS[this.defenders].color, duration: PREP - 0.5 });
    }
    this.siteMarkers();
    g.audio.play(this.round === 1 ? 'match_start' : 'lock');
  }

  private goLive() {
    this.phase = 'live';
    this.phaseAt = this.game.clock.now;
    for (const f of match.fighters.values()) if (f.player.alive) f.player.freeze(false);
    this.game.hud.banner('GO', undefined, { color: COLORS.gold, duration: 0.8 });
    this.game.audio.play('countdown');
  }

  private endRound(winner: Team, why: string) {
    if (this.phase === 'post') return;
    const g = this.game;
    this.phase = 'post';
    this.phaseAt = g.clock.now;
    this.result = { winner, why };
    match.score[winner]++;
    for (const [id] of this.acting) this.stop(id);
    for (const f of match.fighters.values()) {
      const p = f.player;
      if (f.team === winner) f.score += POINTS.round;
      if (p.alive) p.freeze(true, { weapons: true });
      if (p.bot) continue;
      const won = f.team === winner;
      p.hud.banner(won ? 'ROUND WON' : 'ROUND LOST', `${TEAMS[winner].name} take round ${this.round} · ${why}`, { color: won ? COLORS.gold : COLORS.red, duration: POST - 1 });
      p.audio.play(won ? 'victory' : 'defeat');
    }
    g.hud.feed([{ text: TEAMS[winner].name, color: TEAMS[winner].color }, ` take round ${this.round}: ${why}`]);
  }

  // -----------------------------------------------------------------------------------------------
  // Every tick
  // -----------------------------------------------------------------------------------------------

  update(dt: number) {
    const g = this.game;
    const now = g.clock.now;
    if (this.phase === 'prep') {
      if (now - this.phaseAt >= PREP) this.goLive();
      return;
    }
    if (this.phase === 'post') {
      if (now - this.phaseAt >= POST) {
        const won = match.score[0] >= ROUNDS ? 0 : match.score[1] >= ROUNDS ? 1 : null;
        if (won !== null) this.host.endMatch(won);
        else this.newRound();
      }
      return;
    }
    // A dropped case: an attacker walking over it picks it up.
    if (this.dropped) {
      const d = this.dropped;
      const taker = teamFighters(this.attackers).find((f) => f.player.alive && Math.hypot(f.player.position.x - d.x, f.player.position.z - d.z) < PICKUP && Math.abs(f.player.position.y - d.y) < 2);
      if (taker) this.pickUp(taker);
    }
    // Planting and cracking: holding F in the right place, standing still (frozen) while it lasts.
    for (const f of match.fighters.values()) {
      const p = f.player;
      const id = p.id;
      const kind = p.alive && p.input.isDown(KEY) ? this.canAct(f) : null;
      const a = this.acting.get(id);
      if (!kind) {
        if (a) this.stop(id);
        continue;
      }
      if (!a || a.kind !== kind) {
        this.acting.set(id, { kind, t: 0 });
        p.freeze(true, { weapons: true });
        p.audio.play('click');
        continue;
      }
      a.t += dt;
      p.hud.progress(Math.min(1, a.t / (kind === 'plant' ? PLANT : DEFUSE)), { color: kind === 'plant' ? COLORS.gold : TEAMS[f.team ?? 0].color });
      if (kind === 'plant' && a.t >= PLANT) this.plant(f);
      else if (kind === 'defuse' && a.t >= DEFUSE) this.defuse(f);
      if ((this.phase as Phase) === 'post') return;
    }
    // The clock.
    if (this.phase === 'live' && now - this.phaseAt >= ROUND_TIME) this.endRound(this.defenders, 'time ran out');
    else if (this.phase === 'planted' && this.planted) {
      const left = FUSE - (now - this.planted.t);
      // The fuse ticks, faster as it burns down.
      const every = left > 10 ? 1 : left > 4 ? 0.5 : 0.25;
      if (now - this.beepAt >= every) {
        this.beepAt = now;
        g.audio.play('case_beep', { at: this.planted.at, pitch: left > 10 ? 1 : 1.25 });
      }
      if (left <= 0) this.boom();
    }
  }

  /** What holding F does for them now, if anything. */
  private canAct(f: Fighter): 'plant' | 'defuse' | null {
    const q = f.player.position;
    if (this.phase === 'live' && f === this.carrier && f.player.onGround) {
      if (this.siteAt(q)) return 'plant';
    }
    if (this.phase === 'planted' && this.planted && f.team === this.defenders) {
      const c = this.planted.at;
      if (Math.hypot(q.x - c.x, q.z - c.z) < REACH && Math.abs(q.y - c.y) < 1.6) return 'defuse';
    }
    return null;
  }

  private siteAt(q: Vec3): Site | null {
    return match.map.bomb.sites.find((s) => Math.hypot(q.x - s.at.x, q.z - s.at.z) < s.radius && Math.abs(q.y - s.at.y) < 2) ?? null;
  }

  private stop(id: string) {
    this.acting.delete(id);
    const f = match.fighters.get(id);
    if (!f) return;
    f.player.hud.progress(null);
    if (f.player.alive && this.phase !== 'post' && this.phase !== 'prep') f.player.freeze(false);
  }

  private plant(f: Fighter, where?: Site) {
    const g = this.game;
    const site = where ?? this.siteAt(f.player.position) ?? match.map.bomb.sites[0];
    this.stop(f.player.id);
    const q = where ? where.at : f.player.position;
    const at = { x: q.x, y: Math.floor(q.y + 0.01), z: q.z };
    this.planted = { site, at, by: f, t: g.clock.now };
    this.dropped = null;
    this.carrier = null;
    this.phase = 'planted';
    this.beepAt = g.clock.now;
    f.plants++;
    this.host.award(f, POINTS.plant, 'CASE PLANTED');
    this.clearProps();
    const open = g.props.spawn(this.models!.open, { position: at });
    open.quaternion.setFromAxisAngle(UP, f.player.yaw);
    const beam = g.props.bolt({ color: '#ffcc00', length: 60, width: 0.35, intensity: 2.5, far: 30 });
    beam.position.set(at.x, at.y + 0.2, at.z);
    beam.quaternion.setFromUnitVectors(BOLT_AXIS, UP);
    this.props.push(open, beam);
    g.hud.marker('case', { x: at.x, y: at.y + 0.6, z: at.z }, { shape: 'diamond', color: COLORS.red, label: `THE CASE · ${site.name}`, edge: true, pulse: true, size: 22 });
    for (const s of match.map.bomb.sites) if (s !== site) g.hud.marker(`site-${s.name}`, null);
    g.hud.feed([{ text: f.player.name, color: TEAMS[f.team ?? 0].color }, ` planted the case at ${site.name}, ${site.label}`]);
    for (const o of match.fighters.values()) {
      if (o.player.bot) continue;
      const attack = this.side(o) === 'attack';
      o.player.hud.banner('CASE PLANTED', attack ? `At ${site.name}: hold it for ${FUSE} seconds` : `At ${site.name}: crack it (hold F by it) before it goes`, { color: attack ? COLORS.gold : COLORS.red, duration: 2.5 });
    }
    g.audio.play('case_armed', { at });
    this.markers();
  }

  private defuse(f: Fighter) {
    const g = this.game;
    this.stop(f.player.id);
    f.defuses++;
    this.host.award(f, POINTS.defuse, 'CASE CRACKED');
    g.hud.feed([{ text: f.player.name, color: TEAMS[f.team ?? 0].color }, ' cracked the case']);
    g.audio.play('case_defused', { at: this.planted?.at });
    if (this.planted) g.fx.burst({ x: this.planted.at.x, y: this.planted.at.y + 0.4, z: this.planted.at.z }, { color: '#ffcc00', count: 30, speed: 3, glow: 2, life: 0.6 });
    this.endRound(this.defenders, `${f.player.name} cracked the case`);
    this.clearProps();
    this.game.hud.marker('case', null);
  }

  private boom() {
    const g = this.game;
    const pl = this.planted;
    if (!pl) return;
    // The round's the attackers' before anyone's caught in it (deaths after this don't count).
    this.endRound(this.attackers, `the case went off at ${pl.site.name}`);
    // An achievement (meta.ts) for whoever planted it, a person still in the match.
    if (!pl.by.player.bot && match.fighters.get(pl.by.player.id) === pl.by) pl.by.player.achieve('special_delivery');
    this.clearProps();
    g.hud.marker('case', null);
    const at = { x: pl.at.x, y: pl.at.y + 0.5, z: pl.at.z };
    // A big one, but it leaves the map standing: the next round is played on it.
    g.world.explode(at, 4, { damage: [400, 40], reach: 11, knockback: 1.6, by: pl.by.player, weapon: 'briefcase', filter: () => false });
    g.fx.explosion(at, { size: 4, color: '#ffcc00' });
    g.fx.shockwave(at, 14, '#ffcc00');
    g.fx.shake(0.6, 1.2);
    g.audio.play('explosion_big', { at });
  }

  // -----------------------------------------------------------------------------------------------
  // The case
  // -----------------------------------------------------------------------------------------------

  private pickUp(f: Fighter) {
    this.dropped = null;
    this.carrier = f;
    this.clearProps();
    this.game.hud.feed([{ text: f.player.name, color: TEAMS[f.team ?? 0].color }, ' picked up the case']);
    if (!f.player.bot) f.player.hud.banner('YOU HAVE THE CASE', 'Plant it at A or B: hold F there', { color: COLORS.gold, duration: 2 });
    f.player.audio.play('streak');
    this.markers();
  }

  /** Someone went down: the case drops where the carrier fell; a side all down loses the round. */
  died(v: Fighter) {
    if (this.acting.has(v.player.id)) this.stop(v.player.id);
    if (this.phase !== 'live' && this.phase !== 'planted') return;
    if (v === this.carrier) this.drop(v);
    this.checkSides();
  }

  /** Someone left. */
  left(f: Fighter) {
    this.acting.delete(f.player.id);
    if (f === this.carrier) this.drop(f);
    if (this.phase === 'live' || this.phase === 'planted') this.checkSides();
  }

  private drop(v: Fighter) {
    const q = v.player.position;
    const inside = q.y > (match.map.sea ?? match.map.bounds.min.y + 1);
    // Fallen out of the map: it turns up back at the attackers' end.
    const at = inside ? { x: q.x, y: Math.floor(q.y + 0.01), z: q.z } : { ...match.map.bomb.attack[0] };
    this.carrier = null;
    this.dropped = at;
    this.clearProps();
    const closed = this.game.props.spawn(this.models!.closed, { position: at });
    closed.quaternion.setFromAxisAngle(UP, v.player.yaw);
    this.props.push(closed);
    this.game.hud.feed([{ text: v.player.name, color: TEAMS[v.team ?? 0].color }, ' dropped the case']);
    this.markers();
  }

  private checkSides() {
    const up = (t: Team) => teamFighters(t).filter((f) => f.player.alive).length;
    const att = up(this.attackers);
    const def = up(this.defenders);
    if (def === 0 && teamFighters(this.defenders).length) this.endRound(this.attackers, 'no one left to stop them');
    else if (att === 0 && this.phase === 'live' && teamFighters(this.attackers).length) this.endRound(this.defenders, 'the attackers are all down');
  }

  private clearProps() {
    for (const p of this.props) p.remove();
    this.props = [];
  }

  private clearCase() {
    this.clearProps();
    for (const [id] of this.acting) this.stop(id);
    this.acting.clear();
    this.carrier = null;
    this.dropped = null;
    this.planted = null;
    this.game.hud.marker('case', null);
  }

  // -----------------------------------------------------------------------------------------------
  // Markers
  // -----------------------------------------------------------------------------------------------

  private siteMarkers() {
    for (const s of match.map.bomb.sites) this.game.hud.marker(`site-${s.name}`, { x: s.at.x, y: s.at.y + 1.4, z: s.at.z }, { shape: 'diamond', color: COLORS.gold, label: s.name, edge: true, size: 20 });
    this.markers();
  }

  /** Each person's markers for the case: their carrier (attackers), the case on the ground (attackers). */
  markers() {
    for (const f of match.fighters.values()) {
      const p = f.player;
      if (p.bot) continue;
      const attack = this.side(f) === 'attack';
      const c = this.carrier;
      p.hud.marker('carrier', attack && c && c !== f && this.phase !== 'post' ? c.player : null, { offset: { x: 0, y: 2.5, z: 0 }, shape: 'diamond', color: COLORS.gold, label: 'CASE', size: 14 });
      p.hud.marker('dropped', attack && this.dropped ? { x: this.dropped.x, y: this.dropped.y + 0.6, z: this.dropped.z } : null, { shape: 'diamond', color: COLORS.gold, label: 'PICK UP THE CASE', edge: true, pulse: true, size: 18 });
    }
  }

  /** Cheat (`/case`): hand an attacker the case, while a round is on and it isn't down yet. */
  give(f: Fighter): boolean {
    if (this.phase !== 'live' || this.side(f) !== 'attack' || !f.player.alive) return false;
    this.clearProps();
    this.dropped = null;
    this.carrier = f;
    this.markers();
    return true;
  }

  /** Cheat (`/case A`): the carrier (or any attacker up) plants it at a site now. */
  plantAt(name: string): boolean {
    const site = match.map.bomb.sites.find((s) => s.name === name.toUpperCase());
    const f = this.carrier?.player.alive ? this.carrier : teamFighters(this.attackers).find((o) => o.player.alive);
    if (!site || !f || this.phase !== 'live') return false;
    f.player.teleport({ x: site.at.x, y: site.at.y + 0.05, z: site.at.z });
    this.carrier = f;
    this.plant(f, site);
    return true;
  }

  /** Take everything down (the match is over, or another mode is on). */
  end() {
    this.clearCase();
    for (const s of match.map.bomb.sites) this.game.hud.marker(`site-${s.name}`, null);
    for (const f of match.fighters.values()) {
      f.player.hud.marker('carrier', null);
      f.player.hud.marker('dropped', null);
    }
  }

  // -----------------------------------------------------------------------------------------------
  // Bots
  // -----------------------------------------------------------------------------------------------

  /** Where a bot goes when nobody's in sight (the `shooterBots` goal hook). */
  goal(bot: Bot, _mind: BotMind): Vec3 | null {
    const f = fighterOf(bot);
    if (!f || f.team === null || (this.phase !== 'live' && this.phase !== 'planted')) return null;
    const sites = match.map.bomb.sites;
    if (this.side(f) === 'attack') {
      if (this.planted) return around(this.planted.at, bot, 4);
      if (f === this.carrier) return this.target?.at ?? sites[0].at;
      if (this.dropped) {
        const d = this.dropped;
        const nearest = nearestTo(teamFighters(this.attackers), d);
        return nearest === f ? d : around(d, bot, 4);
      }
      const c = this.carrier?.player;
      return c?.alive ? around(c.position, bot, 3) : around((this.target ?? sites[0]).at, bot, 4);
    }
    // Defending.
    if (this.planted) {
      const nearest = nearestTo(teamFighters(this.defenders), this.planted.at);
      return nearest === f ? this.planted.at : around(this.planted.at, bot, 5);
    }
    if (this.dropped) return around(this.dropped, bot, 3);
    // Hold their site (half the side each); once the other site's holders are all down, it's
    // lost: over there to take it back (a rotation). Shots heard don't pull them off it.
    const side = teamFighters(this.defenders);
    const mine = side.indexOf(f);
    const held = (s: number) => side.some((o, i) => i % 2 === s && o.player.alive);
    const other = 1 - (mine % 2);
    const go = !held(other) && side.some((_, i) => i % 2 === other) ? other : mine % 2;
    return around(sites[go].at, bot, 4 + (mine >> 1) * 2);
  }

  /** After the bots have moved this tick: those in place (and with nobody in sight) hold F. */
  driveBots(bots: Bots) {
    for (const f of match.fighters.values()) {
      const p = f.player;
      if (!p.bot) continue;
      const bot = p as Bot;
      const mind = bots.mind(bot);
      const hold = p.alive && !mind?.target && this.canAct(f) !== null && (this.phase === 'live' || this.phase === 'planted');
      bot.controls.hold(KEY, hold);
    }
  }
}

const UP = new math.Vector3(0, 1, 0);
const BOLT_AXIS = new math.Vector3(0, 0, -1);

/** A point a little way round `c`, the same for the same bot (so a side spreads out rather than piling up). */
function around(c: Vec3, bot: Player, r: number): Vec3 {
  let h = 0;
  for (const ch of bot.id) h = (h * 31 + ch.charCodeAt(0)) | 0;
  const a = ((h >>> 0) % 360) * (Math.PI / 180);
  return { x: c.x + Math.cos(a) * r, y: c.y, z: c.z + Math.sin(a) * r };
}

function nearestTo(fs: Fighter[], at: Vec3): Fighter | null {
  let best: Fighter | null = null;
  let d = Infinity;
  for (const f of fs) {
    if (!f.player.alive) continue;
    const q = f.player.position;
    const e = Math.hypot(q.x - at.x, q.z - at.z) + Math.abs(q.y - at.y) * 2;
    if (e < d) {
      d = e;
      best = f;
    }
  }
  return best;
}

function shuffled<T>(xs: T[], rnd: () => number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * The case as a little block model (twelve cells to a block): brown leather, brass latches, a
 * handle; open, the lid stands up at the back and the inside glows gold.
 */
function caseModel(open: boolean): Blueprint {
  const bp = new Blueprint({ x: 0, y: 0, z: -1 }, { x: 10, y: 9, z: 9 });
  const fill = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, b: string | ((x: number, y: number, z: number) => string | undefined)) => bp.fill({ x: x0, y: y0, z: z0 }, { x: x1, y: y1, z: z1 }, b);
  if (!open) {
    // Lying flat: 10 long, 3 high, 7 deep, a seam round its middle, latches and a handle at the front.
    fill(0, 0, 0, 9, 2, 6, (_x, y) => (y === 1 ? 'black_concrete' : 'brown_concrete'));
    for (const x of [2, 7]) bp.set(x, 1, 0, 'neon_yellow');
    fill(3, 1, -1, 6, 1, -1, 'black_concrete');
    return bp;
  }
  // Open: the base, its inside glowing, and the lid standing up along the back.
  fill(0, 0, 0, 9, 1, 6, (x, y, z) => (y === 1 && x > 0 && x < 9 && z > 0 && z < 6 ? 'neon_yellow' : 'brown_concrete'));
  fill(0, 2, 6, 9, 8, 7, (x, y, z) => (z === 6 && x > 0 && x < 9 && y > 2 && y < 8 ? 'neon_yellow' : 'brown_concrete'));
  for (const x of [2, 7]) bp.set(x, 1, 0, 'yellow_concrete');
  return bp;
}
