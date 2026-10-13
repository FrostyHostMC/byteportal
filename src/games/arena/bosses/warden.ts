import { Models, type CharacterLook, type Entity, type GameContext, type Player, type ProjectileSpec, type Vec3 } from '@platform';
import { Sprite } from '../art';
import { map } from '../run/state';
import { spawnMonster } from '../run/spawn';
import { adds, angle, announce, brain, chill, drop, fighters, furthest, own, propModel, pull, quicken, ring, root, strike, sweep, tether, type Move } from './fight';
import { MODEL } from './models';
import type { BossKind } from './registry';

/**
 * The Warden (wave 10): the pit's jailer, a crowned giant with an axe and a soul-chain. He
 * swings at whoever's close, slams the ground (jump the shockwave), throws soul fire at whoever
 * hangs back and casts his chain at the furthest fighter to drag them in (roll, or put a pillar
 * between you). Hurt, he calls for aid, cages fighters in soul prisons (get out of the ring before
 * it closes), and his slams throw rings of soul fire along the ground (jump them). Below a third
 * of his health he's enraged and chains two at once.
 */

const LOOK: CharacterLook = { build: 'heavy', skin: '#5a4e76', hair: 'long', hairColor: '#1c1326', facialHair: 'beard', face: 'glow', eyes: '#e4c4ff', top: 'tunic', topColor: '#36204f', accent: '#c9a23a', bottom: 'trousers', bottomColor: '#140f1c', shoes: 'boots', shoeColor: '#0e0b12', hat: 'crown', ragged: true };
const COLOR = '#c9a2ff';
const SOUL = '#b76bff';
const FIREBALL: ProjectileSpec = { sprite: Sprite.soul_fireball, speed: 17, gravity: 1.5, damage: 3.5, knockback: 1.1, glow: '#5fe8ff' };
/** His chain: quick, straight, and it drags whoever it catches to him. */
const CHAIN: ProjectileSpec = { speed: 34, gravity: 0, damage: 2, knockback: 0, glow: SOUL, weapon: 'warden_chain' };
/** The soul fire his slams send rolling out along the ground. */
const EMBER: ProjectileSpec = { speed: 11, gravity: 0, damage: 3.5, knockback: 0.9, glow: SOUL, weapon: 'warden_ember' };
const SLAM = 8;
const PRISON = 2.4;

const swipe: Move = {
  name: 'swipe',
  can: (c) => c.d < 4.2,
  cooldown: [2, 2.6],
  windup: 0.55,
  start(c) {
    const p = c.self.position;
    const a = angle(p, c.target.position);
    c.s.mem.swipe = a;
    c.self.lookAt(c.target);
    c.self.animate('raise');
    sweep(c.game, p, 4.6, a, 1, c.s.t, SOUL);
  },
  act(c) {
    const p = c.self.position;
    const a = c.s.mem.swipe as number;
    c.self.animate('attack');
    strike(c.game, { source: c.self, at: p, r: 4.6, damage: 5, arc: [a - 1, a + 1], knockback: 8, lift: 3 });
    c.game.audio.play('warden_swing', { at: p });
    c.game.fx.shake(0.12, 0.25);
  },
  recover: 0.55,
  end: (c) => c.self.animate('none'),
};

const slam: Move = {
  name: 'slam',
  can: (c) => c.d < SLAM - 1.5,
  cooldown: [7, 9],
  windup: 0.95,
  start(c) {
    c.self.animate('raise');
    ring(c.game, c.self.position, SLAM, c.s.t, SOUL);
    c.game.audio.play('brute', { at: c.self.position, pitch: 0.7 });
  },
  act(c) {
    const { game, self, s } = c;
    const p = self.position;
    self.animate('attack');
    self.glow(null);
    game.fx.shockwave({ x: p.x, y: p.y, z: p.z }, SLAM, SOUL);
    game.fx.shake(0.35, 0.6);
    game.audio.play('slam', { at: p, volume: 1.3 });
    const { dodged } = strike(game, { source: self, at: p, r: SLAM, damage: [7, 3.5], grounded: true, cover: true, knockback: 9, lift: 3, cause: 'shockwave' });
    // In the air as it lands: jumped clean over it.
    for (const f of dodged) if (!f.onGround) f.achieve('slam_dodge');
    // Hurt, his slams send soul fire rolling out along the ground: jump it.
    if (s.phase >= 2) {
      const n = s.enraged ? 12 : 8;
      const off = game.rng.range(0, Math.PI * 2);
      for (let i = 0; i < n; i++) {
        const a = off + (i / n) * Math.PI * 2;
        game.entities.projectile(EMBER, { x: p.x + Math.cos(a) * 1.5, y: p.y + 0.5, z: p.z + Math.sin(a) * 1.5 }, { x: Math.cos(a), y: 0, z: Math.sin(a) }, self);
      }
      game.audio.play('soul_whoosh', { at: p });
    }
  },
  recover: 1.1,
  end: (c) => {
    c.self.glow(null);
    c.self.animate('none');
  },
};

const fireballs: Move = {
  name: 'fireballs',
  can: (c) => c.d > 8 && c.self.canSee(c.target),
  cooldown: [3, 3.6],
  windup: 0.55,
  start(c) {
    c.self.animate('cast');
    c.self.glow('#5fe8ff');
    c.game.audio.play('necro', { at: c.self.position, pitch: 0.7 });
  },
  act(c) {
    c.self.glow(null);
    const n = c.s.enraged ? 5 : 3;
    for (let i = 0; i < n; i++) c.self.shoot(FIREBALL, c.target, { lead: true, spread: 0.02 + i * 0.03 });
    c.game.audio.play('spawn', { at: c.self.position, pitch: 0.6 });
  },
  recover: 0.4,
  end: (c) => c.self.animate('none'),
};

/** His chain: whirled overhead (the one it's meant for is warned), then cast at them. */
const chain: Move = {
  name: 'chain',
  can: (c) => c.d > 5 && fighters(c.game).some((f) => c.self.distanceTo(f) > 5 && c.self.canSee(f)),
  cooldown: [7, 9],
  weight: 1.3,
  windup: 0.8,
  start(c) {
    const { game, self, s } = c;
    const targets = fighters(game)
      .filter((f) => self.distanceTo(f) > 5 && self.canSee(f))
      .sort((a, b) => self.distanceTo(b) - self.distanceTo(a))
      .slice(0, s.enraged ? 2 : 1);
    s.mem.chained = targets.map((f) => f.id);
    s.focus = targets[0]?.id ?? null;
    self.lookAt(targets[0] ?? c.target);
    self.animate('raise');
    self.glow(SOUL);
    game.audio.play('chain_rattle', { at: self.position });
    for (const f of targets) {
      f.hud.pop('CHAINED!', { color: SOUL, sub: 'Roll, or get behind something' });
      f.audio.play('chain_warn');
      f.fx.flash(SOUL, 0.2, 0.4);
    }
  },
  act(c) {
    const { game, self, s } = c;
    self.glow(null);
    self.animate('attack');
    for (const id of (s.mem.chained as string[]) ?? []) {
      const f = game.players.find((p) => p.id === id && p.alive);
      if (f) self.shoot(CHAIN, f, { lead: 0.5 });
    }
    game.audio.play('chain_throw', { at: self.position });
  },
  recover: 0.5,
  end: (c) => c.self.animate('none'),
};

/** A soul prison closes on a marked circle: whoever's still in it is caged for a while. */
const prison: Move = {
  name: 'prison',
  can: (c) => c.s.phase >= 2,
  cooldown: [16, 20],
  windup: 1.35,
  start(c) {
    const { game, self, s } = c;
    // On whoever's furthest from him: they must move, he comes for them.
    const f = furthest(game, self.position) ?? c.target;
    const at = { ...f.position };
    s.mem.prison = at;
    s.focus = f.id;
    self.animate('cast');
    ring(game, at, PRISON, c.s.t, SOUL);
    game.audio.play('prison_hum', { at });
    f.hud.pop('SOUL PRISON', { color: SOUL, sub: 'Get out of the ring!' });
  },
  act(c) {
    const { game, self, s } = c;
    self.glow(null);
    const at = s.mem.prison as Vec3;
    let caged = 0;
    for (const f of fighters(game)) {
      const q = f.position;
      if (Math.hypot(q.x - at.x, q.z - at.z) > PRISON || Math.abs(q.y - at.y) > 2.5) continue;
      if (!root(game, f, 3.2)) continue;
      caged++;
      f.damage(2, { source: self, knockback: 0, cause: 'magic' });
      f.hud.pop('CAGED', { color: SOUL, sub: 'Fight your way out: it holds 3 seconds' });
      const cage = own(game, game.props.spawn(propModel(game, MODEL.soul_cage, 2), { position: { x: q.x, y: q.y, z: q.z } }));
      game.clock.after(3.2, () => {
        drop(game, cage);
        game.fx.burst({ x: q.x, y: q.y + 1.2, z: q.z }, { color: SOUL, count: 30, speed: 4, size: 0.14, gravity: 2, glow: 1.2 });
      });
    }
    game.fx.shockwave({ x: at.x, y: at.y + 0.1, z: at.z }, PRISON + 0.3, SOUL);
    game.audio.play(caged ? 'prison_slam' : 'soul_whoosh', { at });
    // He comes for the caged: a slam's ready for him when he gets there.
    if (caged) s.cds.slam = Math.min(s.cds.slam ?? 0, 1.5);
  },
  recover: 0.6,
  end: (c) => {
    c.self.glow(null);
    c.self.animate('none');
  },
};

/** Aid at the gates: the dead, a sapper among them (slay it beside him and its keg goes off in his face). */
function aid(game: GameContext, e: Entity) {
  const gates = map().gates;
  const list = ['zombie', 'sapper', 'zombie', 'skeleton', 'zombie', 'skeleton'].slice(0, adds(game, 3, 1));
  list.forEach((type, i) => {
    const g = gates[i % gates.length];
    spawnMonster(game, type, g.at, { yaw: g.yaw, data: { master: e.id } });
  });
}

const wardenAI = brain({
  moves: [swipe, slam, fireballs, chain, prison],
  tempo: (s) => (s.enraged ? 0.7 : 1),
  phases: [
    {
      at: 0.66,
      enter(c) {
        roar(c.game, c.self);
        aid(c.game, c.self);
        announce(c.game, 'The Warden calls for aid!', 'His soul prisons close on the slow', COLOR);
        c.s.cds.prison = 3;
      },
    },
    {
      at: 0.33,
      enter(c) {
        roar(c.game, c.self);
        aid(c.game, c.self);
        c.s.enraged = true;
        quicken(c.self, 1.4);
        announce(c.game, 'ENRAGED', 'The Warden chains two at once', '#ff5a5a');
      },
    },
  ],
  always(c) {
    if (c.s.enraged && !c.s.move) c.self.glow(Math.sin(c.self.age * 4) > 0.85 ? '#ff2a2a' : null);
  },
});

/** His roar: axe up, the ground slammed, a blast that throws back whoever's close. */
function roar(game: GameContext, e: Entity) {
  const p = e.position;
  e.animate('raise');
  game.audio.play('warden_roar', { at: p, volume: 1.5 });
  game.clock.after(0.5, () => {
    if (!e.alive) return;
    e.animate('attack');
    game.fx.shockwave({ x: p.x, y: p.y + 0.1, z: p.z }, 8, SOUL);
    game.fx.burst({ x: p.x, y: p.y + 2.5, z: p.z }, { color: SOUL, count: 60, speed: 6, size: 0.16, gravity: -1, glow: 1.3, life: 1 });
    game.fx.shake(0.3, 1);
    strike(game, { source: e, at: p, r: 5, damage: 0.5, knockback: 10, lift: 4, cause: 'shockwave' });
    game.clock.after(0.4, () => e.alive && e.animate('none'));
  });
}

/** Caught by his chain: dragged to his feet. */
function dragged(game: GameContext, p: Player) {
  const w = game.entities.all('warden').find((e) => e.alive);
  if (!w) return;
  const q = p.position;
  // Reeled in to his feet over half a second, and slow to get away for a moment after.
  pull(game, p, () => (w.alive ? w.position : null), 0.5);
  game.clock.after(0.5, () => p.alive && chill(game, p, 0.6, 1));
  tether(game, w, p, 0.55, SOUL);
  game.audio.play('chain_yank', { at: q });
  p.hud.pop('DRAGGED IN', { color: SOUL });
}

export const warden: BossKind = {
  id: 'warden',
  name: 'The Warden',
  title: 'Keeper of the Pit',
  color: COLOR,
  height: 4.4,
  bounty: 250,
  define: () => ({
    name: 'The Warden',
    model: Models.character(LOOK, { scale: 1.95 }),
    hitbox: { width: 1.7, height: 4.2 },
    health: 1600,
    speed: 2.7,
    knockbackResistance: 0.95,
    boss: true,
    ai: wardenAI,
    sounds: { ambient: 'boss', hurt: 'brute', death: 'boss' },
    bloodColor: '#6a2bd9',
  }),
  spawned(game, e) {
    const p = e.position;
    game.fx.burst({ x: p.x, y: p.y + 2, z: p.z }, { color: SOUL, count: 80, speed: 6, size: 0.18, gravity: -1.5, glow: 1.3, life: 1.4, drag: 1.5 });
    game.audio.play('warden_laugh', { at: p, volume: 1.2 });
  },
  roar,
  throes(game, e) {
    e.animate('raise');
    game.audio.play('warden_death', { at: e.position, volume: 1.5 });
  },
  hits: { warden_chain: dragged },
};
