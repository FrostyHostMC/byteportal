import type { Entity, Player, Vec3 } from '@platform';
import type { Building } from '@platform/kits';
import type { Fireballs } from './fireballs';
import type { Nav, Step } from './nav';
import { armorPoints, mineTime, swordDamage, type Match, type Member, type Team } from './state';

/** Someone to fight: a player, or another team's bot. */
export type Target = { kind: 'player'; team: Team; p: Player } | { kind: 'bot'; team: Team; e: Entity };

type Mode = 'fortify' | 'gear' | 'guard' | 'rally' | 'raid' | 'hunt';

/**
 * What a bot does for its team: `solo`, everything (the only one on it); `defend`, stay home and
 * guard the bed (the team's first bot, while there are others to raid); `raid`, go out with the
 * rest of the raiders and break beds.
 */
type Role = 'solo' | 'defend' | 'raid';

/** A team's raiders: who's waiting at home to set off, when they go anyway, and at whom. */
interface Squad {
  waiting: Set<Bot>;
  /** When those waiting set off anyway. */
  goAt: number;
  /** When the last lot set off, and for whom. */
  wentAt: number;
  victim: Team | null;
}
const squads = new WeakMap<Team, Squad>();
const squadOf = (t: Team): Squad => {
  let s = squads.get(t);
  if (!s) squads.set(t, (s = { waiting: new Set(), goAt: Infinity, wentAt: -Infinity, victim: null }));
  return s;
};

/** A member's part on its team (see `Role`), as the team stands now. */
function roleOf(t: Team, me: Member): Role {
  const others = t.members.filter((m) => m !== me && !m.out && (m.player || m.body || m.respawnAt !== null));
  if (!others.length) return 'solo';
  // The first bot still in it guards the bed, while there's a bed to guard.
  const firstBot = t.members.find((m) => !m.player && !m.out && (m.body || m.respawnAt !== null));
  return t.bed && firstBot === me ? 'defend' : 'raid';
}

/** Seconds the first raider home waits for the rest before they set off anyway. */
const RALLY_WAIT = 12;
/** A raider on the way turns on enemies this near (or who hit it); a bot at home, nearer `AGGRO`. */
const RAID_AGGRO = 4.5;
/** At the bed it's raiding, a bot keeps at the bed unless it's this hurt. */
const BED_FOCUS_HEALTH = 7;

const REACH = 3.1;
const AGGRO = 8;

const bedCenter = (t: Team): Vec3 => {
  const [a, b] = t.base.bed;
  return { x: (a.x + b.x) / 2 + 0.5, y: a.y, z: (a.z + b.z) / 2 + 0.5 };
};
const flat = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.z - b.z);
const dist = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/**
 * A Bed Wars bot: fortifies its bed with wool, gathers from its generator, shops, then bridges
 * out to break other beds and hunt, fighting whoever comes near (with a little strafing and
 * jump-crits). Everything goes through the public API (`moveDirection`, `damage`) and the
 * building kit's `placeBlock` / `breakBlock`, so the game's block rules apply to bots too.
 */
export class Bot {
  mode: Mode = 'fortify';
  private path: Step[] | null = null;
  private i = 0;
  private goalId = '';
  private replanAt = 0;
  /** After a failed plan, when to try again. */
  private retryAt = 0;
  private blockedSince = -1;
  private target: Target | null = null;
  private victim: Team | null = null;
  private raidAt: number;
  private raidStarted = 0;
  private homeAt: number;
  private gearStage = 0;
  private gearUntil = 0;
  private fortify: Vec3[] = [];
  private attackCd = 0;
  private placeCd = 0;
  private thinkCd = 0;
  private jumpCd = 0;
  private swingCd = 0;
  private bridgingT = 0;
  private fireCd = 5;
  private mining: { key: string; t: number; need: number } | null = null;
  private stuck = { x: 0, z: 0, t: 0 };
  private seed = Math.random() * 100;

  constructor(
    private m: Match,
    private nav: Nav,
    private build: Building,
    private fireballs: Fireballs,
    /** Its place on its team (the wallet and gear it buys). */
    readonly me: Member,
    readonly e: Entity,
    /** 0.7 (sloppy) .. 1.1 (sharp): reaction, aim, bridging and mining speed. */
    readonly skill: number,
    firstLife: boolean,
  ) {
    const now = m.now;
    this.raidAt = now + (firstLife ? 38 + (1.1 - skill) * 60 + Math.random() * 25 : 8 + Math.random() * 10);
    this.homeAt = now + 110;
    // One bot on a team wraps the bed (the first of them); the rest go straight to gearing up.
    const fortifier = me.team.members.find((x) => x.body) === me;
    if (!firstLife || !me.team.bed || !fortifier) this.mode = 'gear';
    else this.planFortify();
    e.armor = armorPoints(me);
  }

  get team(): Team {
    return this.me.team;
  }

  private get game() {
    return this.m.game;
  }

  private solid(x: number, y: number, z: number): boolean {
    const w = this.game.world;
    const id = w.getBlock(x, y, z);
    return id !== 0 && (id < 0 || (w.blockInfo(id)?.solid ?? false));
  }

  /** Ground within a few blocks below (live, unlike the route planner's snapshot). */
  private supported(x: number, y: number, z: number): boolean {
    for (let d = 1; d <= 4; d++) if (this.solid(x, y - d, z)) return true;
    return false;
  }

  /** Wool on every open face of the bed: its sides and top. */
  private planFortify() {
    const bed = this.team.base.bed;
    const isBed = (x: number, y: number, z: number) => bed.some((b) => b.x === x && b.y === y && b.z === z);
    for (const b of bed) {
      for (const [dx, dy, dz] of [
        [0, 1, 0],
        [1, 0, 0],
        [-1, 0, 0],
        [0, 0, 1],
        [0, 0, -1],
      ]) {
        const c = { x: b.x + dx, y: b.y + dy, z: b.z + dz };
        if (!isBed(c.x, c.y, c.z) && !this.fortify.some((f) => f.x === c.x && f.y === c.y && f.z === c.z)) this.fortify.push(c);
      }
    }
    // Top first, so a half-finished job still covers the bed.
    this.fortify.sort((a, b) => b.y - a.y);
  }

  // --- perception -------------------------------------------------------------------------

  private enemies(): Target[] {
    const out: Target[] = [];
    for (const t of this.m.teams) {
      if (t === this.team || t.eliminated) continue;
      for (const m of t.members) {
        // (Someone spectating isn't in play.)
        if (m.player?.alive && !m.player.spectating) out.push({ kind: 'player', team: t, p: m.player });
        if (m.body?.alive) out.push({ kind: 'bot', team: t, e: m.body });
      }
    }
    return out;
  }

  private posOf(t: Target): Vec3 {
    return t.kind === 'player' ? t.p.position : t.e.position;
  }

  private valid(t: Target | null): t is Target {
    if (!t) return false;
    // Still in the game, and still on that team (a player who left is someone else's now).
    if (t.kind === 'player') return t.p.alive && this.m.memberOf(t.p)?.team === t.team && !t.team.eliminated;
    return t.e.alive;
  }

  /** What it's up to (debugging). */
  get status(): string {
    const t = this.target ? (this.target.kind === 'player' ? this.target.p.name : this.target.team.color) : '-';
    return `${this.mode}${this.victim ? `>${this.victim.color}` : ''} fight:${t} path:${this.path ? `${this.i}/${this.path.length}` : '-'}${this.mining ? ' mining' : ''}`;
  }

  /** Someone hit us: turn on them. */
  provoke(by: Target) {
    if (!this.valid(this.target) || Math.random() < 0.6) this.target = by;
  }

  // --- the brain ----------------------------------------------------------------------------

  update(dt: number) {
    const e = this.e;
    if (!e.alive || this.m.over) return;
    this.attackCd -= dt;
    this.placeCd -= dt;
    this.jumpCd -= dt;
    this.swingCd -= dt;
    this.bridgingT -= dt;
    this.fireCd -= dt;
    this.thinkCd -= dt;
    if (this.thinkCd <= 0) {
      this.thinkCd = 0.35 + Math.random() * 0.2;
      this.think();
    }
    this.collect();
    // At the bed it came for, the bed comes first (while it can take the blows).
    const focused = this.mode === 'raid' && this.atVictimBed() && e.health > BED_FOCUS_HEALTH;
    if (this.valid(this.target) && !focused) {
      this.fight(this.target, dt);
      return;
    }
    e.lookAt(null);
    switch (this.mode) {
      case 'fortify':
        return this.doFortify(dt);
      case 'gear':
        return this.doGear(dt);
      case 'guard':
        return this.doGuard(dt);
      case 'rally':
        return this.doRally(dt);
      case 'raid':
        return this.doRaid(dt);
      case 'hunt':
        return this.doHunt(dt);
    }
  }

  private think() {
    const p = this.e.position;
    const now = this.m.now;
    // Keep fighting while they're close; otherwise pick the nearest enemy in range.
    if (this.valid(this.target)) {
      const q = this.posOf(this.target);
      if (dist(p, q) > AGGRO + 5 || q.y < p.y - 6) this.target = null;
    } else {
      this.target = null;
      let best = this.mode === 'raid' || this.mode === 'rally' ? RAID_AGGRO : AGGRO;
      for (const t of this.enemies()) {
        const q = this.posOf(t);
        const d = dist(p, q);
        if (Math.abs(q.y - p.y) < 4 && d < best) {
          best = d;
          this.target = t;
        }
      }
    }
    // Home is under attack: go and deal with it.
    if (!this.target && this.team.bed && this.mode !== 'fortify') {
      const bed = bedCenter(this.team);
      if (flat(p, bed) < 50) {
        for (const t of this.enemies()) {
          if (dist(this.posOf(t), bed) < 11) {
            this.target = t;
            break;
          }
        }
      }
    }
    this.throwFireball();
    // Plans.
    if (this.mode === 'guard' && now > this.raidAt) {
      // A defender stays; a raider goes to join the rest.
      const role = this.role();
      if (role === 'solo') this.startRaid();
      else if (role === 'raid') this.mode = 'rally';
    }
    if ((this.mode === 'raid' || this.mode === 'hunt') && now > this.homeAt) {
      this.mode = 'gear';
      this.gearStage = 0;
      this.homeAt = now + 120;
      this.raidAt = now + 20;
    }
    if (this.mode === 'raid' && now - this.raidStarted > 100) {
      // Getting nowhere: go home, try someone else later.
      this.victim = null;
      this.mode = 'gear';
      this.gearStage = 0;
    }
  }

  /** The team this bot's squad goes for, chosen by whoever sets it off. */
  private startRaid(victim?: Team) {
    if (victim && victim.bed && !victim.eliminated) {
      this.victim = victim;
      this.mode = 'raid';
      this.raidStarted = this.m.now;
      return;
    }
    const others = this.m.teams.filter((t) => t !== this.team && !t.eliminated);
    const beds = others.filter((t) => t.bed);
    if (!beds.length) {
      this.mode = others.length ? 'hunt' : 'guard';
      return;
    }
    // Neighbours are likelier than the far side; the player a little likelier still.
    const home = this.team.base.spawn;
    const weights = beds.map((t) => (flat(home, t.base.spawn) < 80 ? 1 : 0.45) * (t.members.some((m) => m.player) ? 1.25 : 1));
    let r = Math.random() * weights.reduce((a, b) => a + b, 0);
    this.victim = beds[beds.length - 1];
    for (let i = 0; i < beds.length; i++) {
      r -= weights[i];
      if (r <= 0) {
        this.victim = beds[i];
        break;
      }
    }
    this.mode = 'raid';
    this.raidStarted = this.m.now;
  }

  // --- modes ------------------------------------------------------------------------------

  private doFortify(dt: number) {
    const c = bedCenter(this.team);
    const p = this.e.position;
    if (!this.fortify.length || !this.team.bed || this.m.now > 30) {
      this.mode = 'gear';
      return;
    }
    if (flat(p, c) > 2.6) {
      this.goTo('fortify', c, (x, y, z) => Math.hypot(x + 0.5 - c.x, z + 0.5 - c.z) < 2.4 && Math.abs(y - c.y) <= 1, dt);
      return;
    }
    this.e.stop();
    const f = this.fortify[0];
    this.e.lookAt({ x: f.x + 0.5, y: f.y + 0.5, z: f.z + 0.5 });
    if (this.placeCd > 0) return;
    this.fortify.shift();
    if (!this.solid(f.x, f.y, f.z) && this.build.placeBlock(f.x, f.y, f.z, this.team.wool, this.e)) {
      this.placeCd = 0.3 / this.skill;
      this.e.animate('attack');
    }
  }

  private doGear(dt: number) {
    const b = this.team.base;
    if (this.gearStage === 0) {
      const g = b.generator;
      if (this.goTo('gen', g, (x, y, z) => Math.hypot(x + 0.5 - g.x, z + 0.5 - g.z) < 1.2 && Math.abs(y - g.y) <= 1, dt) === 'arrived') {
        this.gearStage = 1;
        this.gearUntil = this.m.now + 3 + Math.random() * 3;
      }
    } else if (this.gearStage === 1) {
      this.e.stop();
      if (this.m.now > this.gearUntil) this.gearStage = 2;
    } else {
      const s = b.shop;
      if (this.goTo('shop', s, (x, y, z) => Math.hypot(x + 0.5 - s.x, z + 0.5 - s.z) < 2.6 && Math.abs(y - s.y) <= 1, dt) === 'arrived') {
        this.e.lookAt({ x: s.x, y: s.y + 1.6, z: s.z });
        this.shop();
        this.gearStage = 0;
        // A raider joins the rest once it's time (till then, it minds the bed).
        this.mode = this.role() === 'raid' && this.m.now > this.raidAt ? 'rally' : 'guard';
      }
    }
  }

  /** Its part on the team, as the team stands now (see `Role`). */
  private role(): Role {
    return roleOf(this.team, this.me);
  }

  private atVictimBed(): boolean {
    const v = this.victim;
    return !!v && v.bed && flat(this.e.position, bedCenter(v)) < 4 && Math.abs(this.e.position.y - v.base.bed[0].y) < 2.5;
  }

  /**
   * Wait at home for the team's other raiders, then all set off at one bed. The first one home
   * starts a short clock: when it runs out, or everyone's there, they go (anyone coming home just
   * after goes after them).
   */
  private doRally(dt: number) {
    const sq = squadOf(this.team);
    const now = this.m.now;
    const s = this.team.base.spawn;
    if (this.goTo('rally', s, (x, y, z) => Math.hypot(x + 0.5 - s.x, z + 0.5 - s.z) < 2.5 && Math.abs(y - s.y) <= 1, dt) !== 'arrived') {
      // Can't get home (cut off): go from here.
      if (this.blockedSince >= 0 && now - this.blockedSince > 5) this.launch(sq);
      return;
    }
    // Pace about near the spawn meanwhile.
    const t = now * 0.6 + this.seed;
    if (Math.sin(t * 0.7) > 0.5) this.walk(Math.cos(t), Math.sin(t), dt, false);
    else this.e.stop();
    for (const b of sq.waiting) if (!b.e.alive || b.mode !== 'rally') sq.waiting.delete(b);
    if (!sq.waiting.size) sq.goAt = now + RALLY_WAIT;
    sq.waiting.add(this);
    // Just behind the others: after them.
    if (sq.victim?.bed && now - sq.wentAt < 8) {
      sq.waiting.delete(this);
      return this.startRaid(sq.victim);
    }
    const raiders = this.team.members.filter((m) => m.body?.alive && roleOf(this.team, m) === 'raid').length;
    if (sq.waiting.size >= raiders || now >= sq.goAt) this.launch(sq);
  }

  /** Set off with everyone waiting: one of them picks the bed, all go for it. */
  private launch(sq: Squad) {
    const everyone = [...sq.waiting].filter((b) => b.e.alive && b.mode === 'rally');
    if (!everyone.includes(this)) everyone.push(this);
    sq.waiting.clear();
    this.startRaid();
    sq.victim = this.mode === 'raid' ? this.victim : null;
    sq.wentAt = this.m.now;
    for (const b of everyone) if (b !== this) b.startRaid(sq.victim ?? undefined);
  }

  private doGuard(dt: number) {
    const c = bedCenter(this.team);
    const p = this.e.position;
    if (flat(p, c) > 4.5) {
      this.goTo('guard', c, (x, y, z) => Math.hypot(x + 0.5 - c.x, z + 0.5 - c.z) < 3.5 && Math.abs(y - c.y) <= 2, dt);
      return;
    }
    // Pace about a little.
    const t = this.m.now * 0.6 + this.seed;
    if (Math.sin(t * 0.7) > 0.3) this.walk(Math.cos(t), Math.sin(t), dt, false);
    else this.e.stop();
  }

  private doRaid(dt: number) {
    const v = this.victim;
    if (!v || !v.bed || v.eliminated) {
      this.victim = null;
      if (Math.random() < 0.5) this.mode = 'hunt';
      else this.startRaid();
      return;
    }
    const c = bedCenter(v);
    const p = this.e.position;
    const y = v.base.bed[0].y;
    if (flat(p, c) < 3.4 && Math.abs(p.y - y) < 2.5 && this.e.onGround) {
      this.breakBed(v, dt);
      return;
    }
    this.goTo(`bed-${v.color}`, c, (x, yy, z) => Math.hypot(x + 0.5 - c.x, z + 0.5 - c.z) < 3 && Math.abs(yy - y) <= 1, dt);
  }

  private doHunt(dt: number) {
    const p = this.e.position;
    let best: Target | null = null;
    let bd = Infinity;
    for (const t of this.enemies()) {
      const d = dist(p, this.posOf(t));
      if (d < bd) {
        bd = d;
        best = t;
      }
    }
    if (!best) {
      this.mode = 'guard';
      return;
    }
    const q = this.posOf(best);
    const key = `hunt-${Math.floor(q.x / 4)},${Math.floor(q.z / 4)}`;
    this.goTo(key, q, (x, y, z) => Math.hypot(x + 0.5 - q.x, z + 0.5 - q.z) < 3 && Math.abs(y - q.y) <= 2, dt);
    // Out of reach (towered up, say): go home and shop, and come back later.
    if (this.blockedSince >= 0 && this.m.now - this.blockedSince > 6) {
      this.blockedSince = -1;
      this.mode = 'gear';
      this.gearStage = 0;
    }
  }

  // --- actions ------------------------------------------------------------------------------

  private fight(t: Target, dt: number) {
    const e = this.e;
    const p = e.position;
    const q = this.posOf(t);
    const dx = q.x - p.x;
    const dz = q.z - p.z;
    const d2 = Math.hypot(dx, dz) || 1;
    const d = Math.hypot(dx, q.y - p.y, dz);
    e.lookAt({ x: q.x, y: q.y + 1.5, z: q.z });
    // Close in with a weave, then circle.
    const weave = Math.sin(this.m.now * 1.9 + this.seed) * (d2 < 2.2 ? 1 : 0.4);
    const fwd = d2 > 2 ? 1 : d2 < 1.2 ? -0.4 : 0.15;
    this.walk((dx / d2) * fwd - (dz / d2) * weave, (dz / d2) * fwd + (dx / d2) * weave, dt, true);
    if (this.jumpCd <= 0 && e.onGround && (q.y > p.y + 1.1 || (d < 4 && Math.random() < 0.25 * this.skill))) {
      e.jump();
      this.jumpCd = 1 + Math.random();
    }
    if (d < REACH && this.attackCd <= 0) {
      this.attackCd = (0.55 + Math.random() * 0.3) / this.skill;
      e.animate('attack');
      this.game.audio.play('swing', { at: p, volume: 0.45 });
      if (Math.random() < 0.6 + 0.3 * this.skill) {
        const dmg = swordDamage(this.me);
        if (t.kind === 'player') t.p.damage(dmg, { source: e, knockback: 0.8 });
        else t.e.damage(dmg, { source: e, knockback: 0.9 });
      }
    }
  }

  /**
   * Knock people off bridges: a fireball at anyone standing over the void (on a bridge or at an
   * edge) at mid range, leading them a little.
   */
  private throwFireball() {
    if (this.me.fireballs <= 0 || this.fireCd > 0) return;
    const p = this.e.position;
    const eye = { x: p.x, y: p.y + 1.6, z: p.z };
    for (const t of this.enemies()) {
      const q = this.posOf(t);
      const d = dist(eye, q);
      if (d < 7 || d > 30 || !this.exposed(q)) continue;
      const v = t.kind === 'player' ? t.p.velocity : t.e.velocity;
      const lead = d / 20;
      const aim = { x: q.x + v.x * lead, y: q.y + 0.9, z: q.z + v.z * lead };
      if (!this.game.world.lineOfSight(eye, aim)) continue;
      const dir = { x: aim.x - eye.x, y: aim.y - eye.y, z: aim.z - eye.z };
      const l = Math.hypot(dir.x, dir.y, dir.z);
      this.e.lookAt(aim);
      this.e.animate('attack');
      this.fireballs.launch({ x: eye.x + (dir.x / l) * 0.9, y: eye.y + (dir.y / l) * 0.9, z: eye.z + (dir.z / l) * 0.9 }, dir, this.team, this.e);
      this.me.fireballs--;
      this.fireCd = 7 + Math.random() * 5;
      return;
    }
  }

  /** Standing where a push would send them into the void: on a bridge or at an edge. */
  private exposed(q: Vec3): boolean {
    const x = Math.floor(q.x);
    const y = Math.floor(q.y + 0.05) - 1;
    const z = Math.floor(q.z);
    let ground = 0;
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) if (this.solid(x + dx, y, z + dz)) ground++;
    return ground <= 7;
  }

  /** Hit the bed, or whatever is covering it on the way. */
  private breakBed(v: Team, dt: number) {
    const e = this.e;
    const p = e.position;
    const eye = { x: p.x, y: p.y + 1.6, z: p.z };
    const beds = [...v.base.bed].sort((a, b) => dist(eye, a) - dist(eye, b));
    for (const b of beds) {
      const aim = { x: b.x + 0.5, y: b.y + 0.4, z: b.z + 0.5 };
      const dir = { x: aim.x - eye.x, y: aim.y - eye.y, z: aim.z - eye.z };
      const hit = this.game.world.raycast(eye, dir, 5);
      if (!hit) continue;
      const name = this.game.world.blockName(hit.block);
      if (this.m.canBreak(hit, name, e)) {
        this.mine(hit, dt);
        return;
      }
    }
    // Something unbreakable in the way: circle round to another side.
    const t = this.m.now * 0.8 + this.seed;
    this.walk(Math.cos(t), Math.sin(t), dt, false);
  }

  private mine(b: Vec3, dt: number) {
    const e = this.e;
    e.stop();
    e.lookAt({ x: b.x + 0.5, y: b.y + 0.5, z: b.z + 0.5 });
    const key = `${b.x},${b.y},${b.z}`;
    if (this.mining?.key !== key) {
      const name = this.game.world.blockName(this.game.world.getBlock(b.x, b.y, b.z));
      this.mining = { key, t: 0, need: mineTime(name, this.me.pick, this.me.shears) * (1.15 / this.skill) };
    }
    this.mining.t += dt;
    this.progressed();
    if (this.swingCd <= 0) {
      this.swingCd = 0.28;
      e.animate('attack');
      this.game.audio.play('hit', { at: b, volume: 0.25, pitch: 1.5 });
    }
    if (this.mining.t >= this.mining.need) {
      this.mining = null;
      if (!this.build.breakBlock(b.x, b.y, b.z, e)) this.path = null;
    }
  }

  /**
   * Walk in a direction without walking off an edge: when the ground ahead falls away into the
   * void, lay a block of wool there first (if `bridge`), or stop.
   */
  private walk(dx: number, dz: number, _dt: number, bridge: boolean) {
    const e = this.e;
    const l = Math.hypot(dx, dz);
    if (l < 1e-3) {
      e.stop();
      return;
    }
    dx /= l;
    dz /= l;
    const p = e.position;
    const fy = Math.floor(p.y + 0.05);
    if (e.onGround) {
      const ax = Math.floor(p.x + dx * 0.95);
      const az = Math.floor(p.z + dz * 0.95);
      if ((ax !== Math.floor(p.x) || az !== Math.floor(p.z)) && !this.solid(ax, fy, az) && !this.supported(ax, fy, az)) {
        if (!bridge || !this.bridge(ax, fy - 1, az)) {
          e.stop();
          return;
        }
      }
    }
    e.setSpeed(this.bridgingT > 0 ? 0.42 + 0.15 * this.skill : this.valid(this.target) ? 1.05 : 1);
    e.moveDirection(dx, dz);
  }

  private bridge(x: number, y: number, z: number): boolean {
    if (this.placeCd > 0) return false;
    if (!this.build.placeBlock(x, y, z, this.team.wool, this.e)) return false;
    this.placeCd = 0.3 / this.skill;
    this.bridgingT = 0.9;
    this.e.animate('attack');
    this.progressed();
    return true;
  }

  /**
   * Follow a route to a goal, planning (and re-planning) it as needed. Returns `arrived` when
   * standing in a goal cell.
   */
  private goTo(key: string, toward: Vec3, goal: (x: number, y: number, z: number) => boolean, dt: number): 'moving' | 'arrived' | 'blocked' {
    const e = this.e;
    const p = e.position;
    const now = this.m.now;
    if (e.onGround && goal(Math.floor(p.x), Math.floor(p.y + 0.05), Math.floor(p.z))) {
      e.stop();
      this.path = null;
      return 'arrived';
    }
    if (!e.onGround && this.bridgingT <= 0) {
      // Mid-air (knocked back, falling): let physics happen.
      return 'moving';
    }
    if (key !== this.goalId || (!this.path && now >= this.retryAt) || now > this.replanAt) {
      this.goalId = key;
      this.path = this.nav.find(p, toward, goal);
      this.i = 0;
      this.replanAt = now + 5;
      this.stuck = { x: p.x, z: p.z, t: now };
      if (!this.path) this.retryAt = now + 1.5;
    }
    if (!this.path) {
      e.stop();
      if (this.blockedSince < 0) this.blockedSince = now;
      return 'blocked';
    }
    this.blockedSince = -1;
    const path = this.path;
    while (this.i < path.length) {
      const s = path[this.i];
      if (Math.hypot(s.x + 0.5 - p.x, s.z + 0.5 - p.z) < 0.4 && Math.abs(p.y - s.y) < 1.2) this.i++;
      else break;
    }
    if (this.i >= path.length) {
      this.path = null;
      return 'moving';
    }
    const s = path[this.i];
    if (Math.hypot(s.x + 0.5 - p.x, s.z + 0.5 - p.z) > 3 || p.y < s.y - 2.5) {
      // Knocked off the route.
      this.path = null;
      return 'moving';
    }
    for (const b of s.dig) {
      if (this.solid(b.x, b.y, b.z)) {
        this.mine(b, dt);
        return 'moving';
      }
    }
    // Stuck on something: hop, then re-plan.
    if (Math.hypot(p.x - this.stuck.x, p.z - this.stuck.z) > 0.6) this.stuck = { x: p.x, z: p.z, t: now };
    else if (now - this.stuck.t > 1.2 && this.jumpCd <= 0) {
      e.jump();
      this.jumpCd = 0.8;
      if (now - this.stuck.t > 3.5) this.path = null;
    }
    this.walk(s.x + 0.5 - p.x, s.z + 0.5 - p.z, dt, true);
    return 'moving';
  }

  /** Bridging and digging are slow but not stuck. */
  private progressed() {
    const p = this.e.position;
    this.stuck = { x: p.x, z: p.z, t: this.m.now };
  }

  /** Scoop up any generator pile we're standing on. */
  private collect() {
    const p = this.e.position;
    for (const pile of this.m.piles) {
      if (pile.count > 0 && flat(p, pile.at) < 1.4 && Math.abs(p.y - pile.at.y) < 2) this.me.wallet[pile.item] += pile.take();
    }
  }

  /** Spend at the shop: better swords and armour first, then tools and team upgrades. */
  private shop() {
    const me = this.me;
    const t = this.team;
    const w = me.wallet;
    const buy = (cur: keyof typeof w, n: number, fn: () => void): boolean => {
      if (w[cur] < n) return false;
      w[cur] -= n;
      fn();
      return true;
    };
    let bought = true;
    while (bought) {
      bought =
        (me.sword < 1 && buy('iron', 10, () => (me.sword = 1))) ||
        (me.armor < 1 && buy('gold', 12, () => (me.armor = 1))) ||
        (me.sword < 2 && buy('gold', 7, () => (me.sword = 2))) ||
        (me.pick < 1 && buy('iron', 10, () => (me.pick = 1))) ||
        (me.pick === 1 && buy('gold', 3, () => (me.pick = 2))) ||
        (!me.shears && buy('iron', 20, () => (me.shears = true))) ||
        (me.armor < 2 && buy('emerald', 6, () => (me.armor = 2))) ||
        (me.sword < 3 && buy('emerald', 4, () => (me.sword = 3))) ||
        (!t.sharp && buy('diamond', 4, () => (t.sharp = true))) ||
        (t.prot < 4 && buy('diamond', 2 ** (t.prot + 1), () => t.prot++)) ||
        (me.fireballs < 2 && me.sword >= 1 && buy('iron', 40, () => me.fireballs++));
    }
    this.e.armor = armorPoints(me);
  }
}
