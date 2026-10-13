import { Models, type Entity, type GameContext, type Player, type ProjectileSpec, type Vec3 } from '@platform';
import { map } from '../run/state';
import { spawnMonster } from '../run/spawn';
import { adds, angle, announce, brain, chest, chill, fighters, lob, near, pool, quicken, ring, steer, strike, sweep, venom, type Ctx, type Move } from './fight';
import { HATCH } from './minions';
import { MODEL } from './models';
import type { BossKind } from './registry';

/**
 * The Broodmother (wave 15): a spider queen the size of a cart, quick on her eight legs. She
 * bites whoever's close (venom), spits webs that bog you down, leaps onto a marked spot (get out
 * of the ring), and lays egg sacs about the arena that hatch into spiderlings unless they're
 * smashed in time. Hurt, she sprays venom that pools on the floor; below a third of her health
 * she's in a frenzy: every egg hatches at once, she spits three webs at a time and leaps more.
 * A bomb under her makes her rear back for a moment.
 */

const COLOR = '#9cff4a';
const WEB_C = '#eef6ff';
const VENOM_C = '#7fd23a';
const WEB: ProjectileSpec = { speed: 21, gravity: 9, damage: 2, knockback: 0.2, glow: WEB_C, weapon: 'web' };
const GLOB: ProjectileSpec = { speed: 16, gravity: 18, damage: 3, knockback: 0.4, glow: VENOM_C, weapon: 'venom_glob' };
const BITE = 4.9;
const LEAP = 3.8;
/** At most this many egg sacs about at once. */
const EGGS = 4;

const bite: Move = {
  name: 'bite',
  can: (c) => c.d < BITE - 0.6,
  cooldown: [2.4, 3],
  windup: 0.55,
  start(c) {
    const p = c.self.position;
    const a = angle(p, c.target.position);
    c.s.mem.bite = a;
    c.self.lookAt(c.target);
    c.self.animate('bite_wind', { fade: 0.15 });
    sweep(c.game, p, BITE, a, 0.75, c.s.t, COLOR);
    c.game.audio.play('brood_hiss', { at: p });
  },
  act(c) {
    const p = c.self.position;
    const a = c.s.mem.bite as number;
    c.self.animate('bite', { fade: 0.05 });
    const { hit } = strike(c.game, { source: c.self, at: p, r: BITE, damage: 5.8, arc: [a - 0.75, a + 0.75], knockback: 6, lift: 2 });
    for (const f of hit) venom(c.game, f, 3.5, 3, c.self);
    c.game.audio.play('brood_bite', { at: p });
  },
  recover: 0.6,
  end: (c) => c.self.animate('none', { fade: 0.3 }),
};

const web: Move = {
  name: 'web',
  can: (c) => c.d > 5 && c.self.canSee(c.target),
  cooldown: [3.5, 5],
  windup: 0.6,
  start(c) {
    c.self.lookAt(c.target);
    c.self.animate('spit_wind', { fade: 0.2 });
    c.self.glow(WEB_C);
    c.game.audio.play('web_charge', { at: c.self.position });
  },
  act(c) {
    c.self.glow(null);
    c.self.animate('spit', { fade: 0.05 });
    const n = c.s.enraged ? 3 : 1;
    for (let i = 0; i < n; i++) c.self.shoot(WEB, chest(c.self, c.target, WEB.speed), { spread: i ? 0.09 : 0.015 });
    c.game.audio.play('web_spit', { at: c.self.position });
  },
  recover: 0.45,
  end: (c) => {
    c.self.glow(null);
    c.self.animate('none', { fade: 0.3 });
  },
};

/** She crouches, then leaps onto where her target's going: a ring marks it. */
const leap: Move = {
  name: 'leap',
  can: (c) => c.d > 6.5 && c.d < 24 && c.self.onGround,
  cooldown: [6, 8],
  weight: 1.2,
  windup: 0.7,
  start(c) {
    const { game, self, target } = c;
    const m = map();
    const q = target.position;
    let to = { x: q.x + target.velocity.x * 0.5, y: q.y, z: q.z + target.velocity.z * 0.5 };
    if (!game.world.fits({ x: to.x, y: to.y + 0.05, z: to.z }) || Math.hypot(to.x - m.center.x, to.z - m.center.z) > m.radius - 2.5) to = { ...q };
    c.s.aim = to;
    c.s.mem.leap = { t: 0, flight: 0 };
    self.lookAt(target);
    self.animate('leap_wind', { fade: 0.2 });
    // The ring fills until she lands (the wind-up and the flight).
    ring(game, to, LEAP, c.s.t + 1.1, COLOR);
    game.audio.play('brood_hiss', { at: self.position, pitch: 0.8 });
  },
  act(c) {
    const { self, s } = c;
    self.animate('leap', { fade: 0.08 });
    const l = s.mem.leap as { t: number; flight: number };
    // High enough to clear a pillar in the way.
    l.flight = lob(self, s.aim!, 17);
    c.game.audio.play('brood_leap', { at: self.position });
  },
  during(c) {
    const { self, game, s, dt } = c;
    const l = s.mem.leap as { t: number; flight: number };
    l.t += dt;
    self.stop();
    if (!self.onGround || l.t < 0.2) {
      steer(self, s.aim!, l.flight - l.t);
      return l.t > 2.5;
    }
    // Down: the ground shakes where she lands.
    const p = self.position;
    self.animate('land', { fade: 0.05 });
    strike(game, { source: self, at: p, r: LEAP, damage: [9, 5], knockback: 10, lift: 4, cause: 'impact' });
    game.fx.shockwave({ x: p.x, y: p.y + 0.1, z: p.z }, LEAP + 0.5, COLOR);
    game.fx.burst({ x: p.x, y: p.y + 0.3, z: p.z }, { color: '#d8c08a', count: 40, speed: 6, size: 0.17, gravity: 5, life: 1, drag: 1.5 });
    game.fx.shake(0.35, 0.5);
    game.audio.play('brood_land', { at: p, volume: 1.3 });
    return true;
  },
  recover: 0.7,
  end: (c) => c.self.animate('none', { fade: 0.3 }),
};

const eggsOf = (c: Ctx) => c.game.entities.all('egg_sac').filter((e) => e.alive && e.data.master === c.self.id);

/** She lays a clutch of egg sacs and flings them about the arena. */
const eggs: Move = {
  name: 'eggs',
  can: (c) => eggsOf(c).length < EGGS - 1,
  cooldown: [14, 17],
  windup: 0.9,
  start(c) {
    c.self.animate('lay', { fade: 0.25 });
    c.game.audio.play('brood_lay', { at: c.self.position });
  },
  act(c) {
    const { game, self, s } = c;
    const m = map();
    const n = Math.min(EGGS - eggsOf(c).length, adds(game, 2, 1));
    const p = self.position;
    const back = angle(c.target.position, p);
    const spots: Vec3[] = [];
    for (let i = 0; i < n; i++) {
      // About the arena, away from each other: near the fighters, but not on top of them.
      const by = fighters(game)[i % Math.max(1, fighters(game).length)]?.position ?? m.center;
      let at = near(game, by, 9, m.center, m.radius);
      for (let k = 0; k < 6 && spots.some((o) => Math.hypot(o.x - at.x, o.z - at.z) < 4); k++) at = near(game, m.center, m.radius - 4, m.center, m.radius);
      spots.push(at);
    }
    spots.forEach((at, i) => {
      game.clock.after(i * 0.22, () => {
        if (!self.alive) return;
        const q = self.position;
        const from = { x: q.x + Math.cos(back) * 1.8, y: q.y + 1.6, z: q.z + Math.sin(back) * 1.8 };
        const egg = spawnMonster(game, 'egg_sac', game.world.fits(from) ? from : { x: q.x, y: q.y + 0.1, z: q.z }, { data: { master: self.id } });
        lob(egg, at, 11);
        game.audio.play('egg_fling', { at: from, pitch: game.rng.range(0.9, 1.1) });
      });
    });
    if (!s.mem.toldEggs) {
      s.mem.toldEggs = true;
      announce(game, 'Smash the egg sacs!', `They hatch in ${HATCH} seconds`, COLOR);
    }
  },
  recover: 0.8,
  end: (c) => c.self.animate('none', { fade: 0.3 }),
};

/** Venom sprayed onto marked spots about her target, where it pools for a while. */
const spray: Move = {
  name: 'spray',
  can: (c) => c.s.phase >= 2 && c.d < 20,
  cooldown: [7, 9],
  windup: 0.75,
  start(c) {
    const { game, target } = c;
    const m = map();
    const q = target.position;
    const spots = [{ x: q.x + target.velocity.x * 0.7, y: q.y, z: q.z + target.velocity.z * 0.7 }];
    for (let i = 0; i < (c.s.enraged ? 4 : 2); i++) spots.push(near(game, q, 5, m.center, m.radius));
    c.s.mem.spray = spots;
    c.self.lookAt(target);
    c.self.animate('spit_wind', { fade: 0.2 });
    c.self.glow(VENOM_C);
    for (const at of spots) ring(game, at, 2.3, c.s.t + 0.8, VENOM_C);
    game.audio.play('web_charge', { at: c.self.position, pitch: 0.7 });
  },
  act(c) {
    const { game, self } = c;
    self.glow(null);
    self.animate('spit', { fade: 0.05 });
    const spots = c.s.mem.spray as Vec3[];
    for (const at of spots) {
      self.shoot(GLOB, at);
      game.clock.after(0.8, () => {
        if (!self.alive) return;
        pool(game, self, at, 2.3, 7, VENOM_C, { damage: 1.15, every: 0.7, chill: [0.75, 0.8], weapon: 'venom' });
        game.fx.burst({ x: at.x, y: at.y + 0.3, z: at.z }, { color: VENOM_C, count: 24, speed: 3, size: 0.14, gravity: 8 });
        game.audio.play('venom_splash', { at });
      });
    }
    game.audio.play('venom_spit', { at: self.position });
  },
  recover: 0.6,
  end: (c) => {
    c.self.glow(null);
    c.self.animate('none', { fade: 0.3 });
  },
};

const broodAI = brain({
  moves: [bite, web, leap, eggs, spray],
  tempo: (s) => (s.enraged ? 0.75 : 1),
  phases: [
    {
      at: 0.66,
      enter(c) {
        roar(c.game, c.self);
        announce(c.game, 'The Broodmother spits venom', 'Stay out of the pools', VENOM_C);
        c.s.cds.eggs = 2;
        c.s.cds.spray = 3;
      },
    },
    {
      at: 0.33,
      enter(c) {
        roar(c.game, c.self);
        c.s.enraged = true;
        quicken(c.self, 1.3);
        // Every egg hatches at once.
        for (const e of eggsOf(c)) e.data.hatchNow = true;
        announce(c.game, 'FRENZY', 'Every egg hatches at once', '#ff5a2a');
      },
    },
  ],
});

/** She rears up, forelegs high, and screeches. */
function roar(game: GameContext, e: Entity) {
  const p = e.position;
  e.animate('rear', { fade: 0.2 });
  game.audio.play('brood_screech', { at: p, volume: 1.6 });
  game.fx.shake(0.3, 1.2);
  game.fx.shockwave({ x: p.x, y: p.y + 0.1, z: p.z }, 8, COLOR);
  strike(game, { source: e, at: p, r: 5.5, damage: 0.5, knockback: 10, lift: 4, cause: 'shockwave' });
}

/** Caught in a web: bogged down, and hard to see through for a moment. */
function webbed(game: GameContext, p: Player) {
  chill(game, p, 0.4, 2.8);
  p.fx.flash(WEB_C, 0.35, 0.6);
  p.hud.pop('WEBBED', { color: WEB_C, sub: 'Slowed' });
  game.audio.play('web_hit', { at: p.position });
}

export const broodmother: BossKind = {
  id: 'broodmother',
  name: 'The Broodmother',
  title: 'Queen of the Deep Webs',
  color: COLOR,
  height: 3.4,
  bounty: 350,
  stagger: 1.4,
  define: () => ({
    name: 'The Broodmother',
    model: Models.gltf(MODEL.broodmother, { clips: { idle: 'idle', walk: 'walk', run: 'run' }, head: 'head', scale: 2 }),
    hitbox: { width: 4.2, height: 2.8 },
    health: 2300,
    speed: 4.4,
    jump: 9,
    knockbackResistance: 1,
    boss: true,
    ai: broodAI,
    sounds: { ambient: 'brood_chitter', hurt: 'brood_hurt' },
    bloodColor: '#7fd23a',
  }),
  spawned(game, e) {
    const p = e.position;
    game.fx.burst({ x: p.x, y: p.y + 1, z: p.z }, { color: WEB_C, count: 70, speed: 6, size: 0.14, gravity: 3, life: 1.6, drag: 1 });
    game.audio.play('brood_chitter', { at: p, volume: 1.4 });
  },
  roar,
  throes(game, e) {
    e.animate('death', { fade: 0.2 });
    game.audio.play('brood_death', { at: e.position, volume: 1.5 });
  },
  hits: { web: webbed },
};
