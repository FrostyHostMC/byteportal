import type { Entity, GameContext, Player, Vec3 } from '@platform';
import type { ArenaPart } from '../part';
import { bus } from '../run/bus';
import { spawnMonster } from '../run/spawn';
import { map, state } from '../run/state';
import { BOSSES, bossKind, bossWidth, type BossKind } from './index';
import { bossState, clearHazards, fighters, resetHolds, resetProps, roofed, root, stagger, toughness, updateHazards, updateHolds, v3 } from './fight';
import { CAM_MSG, FALL_MSG, INTRO_MSG, type CamMessage, type FallMessage, type IntroMessage } from './messages';

/** The entrance: seconds it lasts, and when (seconds in) the boss roars. */
const INTRO = 5.4;
const ROAR = 2.3;
/** Its death: seconds of throes before the last blast, and the camera's hold on it after. */
const THROES = 2.8;
const AFTER = 0.9;
/** How much harder blows land on a boss while it reels (staggered, stunned, channelling). */
const OPEN = 1.5;
/** Seconds before the same boss can be staggered again. */
const STAGGER_AGAIN = 7;
/** What its death showers, for each fighter (items by id, how many). */
const LOOT: [string, number][] = [
  ['health_potion', 1],
  ['bomb_bundle', 2],
  ['heart', 3],
  ['arrow_bundle', 1],
];

/** A boss's minions (they have `data.master`, its id): they fall with it. */
const minionsOf = (game: GameContext, e: Entity) => game.entities.all().filter((m) => m !== e && m.data.master === e.id);

/** Where a boss faces as it comes in: the middle of the floor (or straight ahead, standing on it). */
function facing(e: Entity): number {
  const c = map().center;
  const p = e.position;
  const dx = c.x - p.x;
  const dz = c.z - p.z;
  return Math.hypot(dx, dz) < 3 ? 0 : Math.atan2(-dx, -dz);
}

/**
 * A boss comes in: every screen's camera goes to it (its name card, its roar, `client/bosses.ts`),
 * while it stands still, the fighters are held and nothing can hurt them, and the rest of the wave
 * waits at the gates.
 */
function entrance(game: GameContext, e: Entity, kind: BossKind) {
  const s = bossState(e);
  const yaw = facing(e);
  const p = e.position;
  e.lookAt({ x: p.x - Math.sin(yaw) * 10, y: p.y + kind.height * 0.6, z: p.z - Math.cos(yaw) * 10 });
  if (e.data.quick) return;
  s.held = true;
  // Come in under a gate's arch: it strides out into the open as the camera finds it.
  if (roofed(game, p, kind.height)) s.emerge = { yaw, height: kind.height, back: bossWidth(kind.id) / 2 + 0.6 };
  // The rest of the wave waits at the gates (once the director's done bringing this one in).
  game.clock.after(0, () => (state.spawnTimer = Math.max(state.spawnTimer, INTRO)));
  for (const f of fighters(game)) {
    f.protect(INTRO + 0.6);
    root(game, f, INTRO, true);
  }
  const msg: IntroMessage = { id: e.id, type: kind.id, name: kind.name, title: kind.title, color: kind.color, at: v3(p), yaw, height: kind.height, time: INTRO, roar: ROAR };
  game.clients.send('all', INTRO_MSG, msg);
  game.clock.after(ROAR, () => e.alive && !s.dying && kind.roar(game, e));
  game.clock.after(INTRO, () => {
    s.held = false;
    s.emerge = null;
    e.lookAt(null);
  });
}

/**
 * A boss is beaten: it stops where it is and goes through its throes (light bursting from it)
 * with every screen's camera on it, its minions falling with it; then the last blow, credited to
 * whoever dealt the one that beat it.
 */
function beaten(game: GameContext, e: Entity, kind: BossKind, by: Player | null, weapon?: string) {
  const s = bossState(e);
  s.dying = { by, weapon };
  s.move?.end?.({ self: e, game, s, dt: 0, target: by ?? fighters(game)[0], d: 0, hp: 0, tempo: 1 });
  s.move = null;
  s.step = null;
  e.stop();
  e.glow(null);
  clearHazards(game, e);
  for (const m of minionsOf(game, e)) m.kill();
  for (const f of fighters(game)) {
    f.protect(THROES + AFTER + 0.5);
    root(game, f, THROES + 0.4, true);
  }
  const msg: FallMessage = { id: e.id, name: kind.name, color: kind.color, at: v3(e.position), height: kind.height, time: THROES, hold: AFTER, by: by?.name ?? null };
  game.clients.send('all', FALL_MSG, msg);
  kind.throes(game, e);
  // Light bursting out of it as it goes, quicker and quicker.
  let n = 0;
  const crack = () => {
    if (!e.alive) return;
    const q = e.position;
    const h = kind.height;
    const at = { x: q.x + game.rng.range(-0.4, 0.4) * h * 0.4, y: q.y + game.rng.range(0.25, 0.85) * h, z: q.z + game.rng.range(-0.4, 0.4) * h * 0.4 };
    game.fx.burst(at, { color: kind.color, count: 22, speed: 5, size: 0.16, gravity: -1, glow: 1.4, life: 0.7, drag: 2 });
    game.audio.play('boss_crack', { at, pitch: 0.8 + n * 0.06 });
    n++;
    game.clock.after(Math.max(0.12, 0.5 - n * 0.05), crack);
  };
  game.clock.after(0.3, crack);
  game.clock.after(THROES, () => {
    if (!e.alive) return;
    s.dying!.final = true;
    e.damage(Math.ceil(e.health) + 1, { source: by && game.players.includes(by) ? by : 'world', weapon, knockback: 0 });
  });
}

/** It's dead: the last blast, a shower of loot and gold, and its minions and hazards gone. */
function fallen(game: GameContext, e: Entity, kind: BossKind, at: Vec3, by: Player | null) {
  const h = kind.height;
  const mid = { x: at.x, y: at.y + h * 0.45, z: at.z };
  game.fx.explosion(mid, { size: 3, color: kind.color });
  game.fx.shockwave({ x: at.x, y: at.y + 0.1, z: at.z }, 13, kind.color);
  game.fx.burst(mid, { color: kind.color, count: 120, speed: 10, size: 0.22, gravity: 3, glow: 1.5, life: 1.6, drag: 1.2 });
  game.fx.burst(mid, { color: '#ffffff', count: 40, speed: 14, size: 0.12, gravity: 8, glow: 2, life: 0.9 });
  game.fx.flash(kind.color, 0.4, 0.8);
  game.fx.shake(0.55, 1.1);
  game.audio.play('boss_fall', { volume: 1.4 });
  clearHazards(game, e);
  for (const m of minionsOf(game, e)) m.kill();
  shower(game, at, Math.max(1, game.players.length));
  bus.emit('coins', { at: { ...at }, value: Math.round(kind.bounty * (1 + 0.5 * Math.max(0, game.players.length - 1))), by });
}

/** Loot thrown up out of a fallen boss in a fountain, for `n` fighters. */
function shower(game: GameContext, at: Vec3, n: number) {
  const list = LOOT.flatMap(([item, k]) => (game.items.get(item) ? Array.from({ length: k * n }, () => item) : []));
  list.forEach((item, i) => {
    game.clock.after(0.25 + i * 0.07, () => {
      const a = game.rng.range(0, Math.PI * 2);
      const sp = game.rng.range(2.5, 5.5);
      game.items.spawnPickup(item, { x: at.x, y: at.y + 1.6, z: at.z }, { velocity: { x: Math.cos(a) * sp, y: game.rng.range(7, 11), z: Math.sin(a) * sp }, despawn: 90 });
    });
  });
}

/** Sparks off a boss that turns a blow away (shielded, mid-roar), now and then. */
function deflect(game: GameContext, e: Entity, color: string) {
  const last = (e.data.deflected as number | undefined) ?? -1;
  if (game.clock.now - last < 0.25) return;
  e.data.deflected = game.clock.now;
  const q = e.position;
  const h = (bossKind(e.type)?.height ?? 3) * 0.55;
  game.fx.burst({ x: q.x, y: q.y + h, z: q.z }, { color, count: 14, speed: 4, size: 0.1, gravity: 0, glow: 1.5, life: 0.35 });
  game.audio.play('boss_deflect', { at: q });
}

/** The fight's rules for bosses (added once per game, after every other part's listeners, so they see each blow's final amount). */
function rules(game: GameContext) {
  game.events.on('damage', (hit) => {
    const t = hit.target;
    if (t.kind !== 'entity') return;
    const kind = bossKind(t.type);
    if (!kind) return;
    const s = bossState(t);
    if (s.dying) {
      if (!s.dying.final) hit.cancel();
      return;
    }
    if (s.held || s.transition > 0 || s.shield) {
      hit.cancel();
      deflect(game, t, s.shield ? '#9fe8ff' : kind.color);
      return;
    }
    const by = hit.source && hit.source !== 'world' && hit.source.kind === 'player' ? hit.source : null;
    // A blast at its feet: it reels (its move cut short), and takes more for a moment.
    if (kind.stagger && by && hit.cause === 'explosion' && hit.amount >= 8 && s.staggerCd <= 0) {
      stagger(t, game, kind.stagger);
      s.staggerCd = STAGGER_AGAIN;
      game.audio.play('boss_stagger', { at: t.position });
      by.hud.pop('STAGGERED!', { color: kind.color });
      bus.emit('feat', { player: by, name: 'boss_stagger', text: `${by.name} staggered ${kind.name}!` });
    }
    // Tougher for a bigger party, and for one brought back mightier (`data.might`: an endless wave's).
    hit.amount /= toughness(game) * ((t.data.might as number | undefined) ?? 1);
    if (s.stagger > 0 || s.vulnerable > 0) hit.amount *= OPEN;
    if (hit.amount >= t.health) {
      beaten(game, t, kind, by, hit.weapon);
      hit.amount = Math.max(0, t.health - 1);
      if (hit.amount <= 0) hit.cancel();
    }
  });
  // What the bosses' shots do to whoever they hit, besides the damage.
  const hits = Object.assign({}, ...BOSSES.map((b) => b.hits ?? {})) as NonNullable<BossKind['hits']>;
  game.events.on('playerDamage', ({ player, weapon }) => {
    if (weapon && hits[weapon] && player.alive) hits[weapon](game, player);
  });
}

/** Games whose rules are in (one game per module in a room, but a test runs several). */
const ruled = new WeakSet<GameContext>();

/** A spot `d` blocks ahead of a fighter, on the floor and well inside the map. */
function ahead(p: Player, d: number): Vec3 {
  const m = map();
  const q = p.position;
  let x = q.x - Math.sin(p.yaw) * d;
  let z = q.z - Math.cos(p.yaw) * d;
  const ox = x - m.center.x;
  const oz = z - m.center.z;
  const r = Math.hypot(ox, oz);
  const max = m.radius - 5;
  if (r > max) {
    x = m.center.x + (ox / r) * max;
    z = m.center.z + (oz / r) * max;
  }
  return { x, y: q.y + 0.05, z };
}

/**
 * Whoever brings a boss in (`spawnMonster`) may say in its `data`: `quick` (no entrance: it fights
 * at once) and `might` (it takes that many times less damage: a boss come back in an endless wave).
 *
 * The bosses' own business: each one's entrance, its death and its loot, the rules for hurting
 * one (tougher for a bigger party; blasts stagger some; nothing lands while it roars or shields
 * itself), its chills, roots and hazards wearing off, and two cheats: `/boss <id> [now]` brings
 * one in ahead of you, `/bosshp <percent>` sets the bosses' health (to see a phase).
 */
export const bossesPart: ArenaPart = {
  name: 'bossesPart',
  setup(game) {
    bus.on('spawned', ({ entity, type }) => {
      const kind = bossKind(type);
      if (kind) entrance(game, entity, kind);
    });
    bus.on('slain', ({ entity, type, by, at }) => {
      const kind = bossKind(type);
      if (kind) fallen(game, entity, kind, at, by);
    });
    game.commands.register('boss', {
      usage: '<boss> [now]',
      help: 'Bring in a boss ahead of you (now: without its entrance)',
      cheat: true,
      complete: () => BOSSES.map((b) => b.id),
      run: ([id, now], g, p) => {
        const kind = bossKind(id);
        if (!kind) return `Bosses: ${BOSSES.map((b) => b.id).join(', ')}`;
        const at = ahead(p, 13);
        const dx = p.position.x - at.x;
        const dz = p.position.z - at.z;
        spawnMonster(g, kind.id, at, { yaw: Math.atan2(-dx, -dz), data: now ? { quick: true } : {} });
        return `${kind.name} comes in`;
      },
    });
    game.commands.register('bosscam', {
      usage: '[degrees] [distance] [height] [look] | off',
      help: "Look at the boss from an angle (0: in front of it), on your own screen; 'off' to stop",
      cheat: true,
      run: ([deg, dist, up, look], g, p) => {
        const e = g.entities.all().find((x) => bossKind(x.type) && x.alive);
        if (!e || deg === 'off') {
          g.clients.send(p, CAM_MSG, null);
          return 'Camera back';
        }
        const h = bossKind(e.type)!.height;
        const msg: CamMessage = { id: e.id, angle: ((Number(deg) || 0) * Math.PI) / 180, dist: Number(dist) || h * 1.8 + 3, up: Number(up) || h * 0.5, look: Number(look) || 0.55, height: h };
        g.clients.send(p, CAM_MSG, msg);
      },
    });
    game.commands.register('bosshp', {
      usage: '<percent>',
      help: "Set the bosses' health (to see a phase)",
      cheat: true,
      run: ([pct], g) => {
        const f = Math.max(1, Math.min(100, Number(pct) || 50)) / 100;
        const bosses = g.entities.all().filter((e) => bossKind(e.type) && e.alive);
        for (const e of bosses) e.health = Math.max(1, e.maxHealth * f);
        return `${bosses.length} at ${Math.round(f * 100)}%`;
      },
    });
  },
  start(game) {
    resetHolds(game);
    resetProps(game);
    clearHazards(game);
  },
  update(game) {
    // (The rules go in at the first tick, after every part's setup and start: theirs come first.)
    if (!ruled.has(game)) {
      ruled.add(game);
      rules(game);
    }
    updateHolds(game);
    updateHazards(game);
  },
};
