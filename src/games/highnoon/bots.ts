import type { GameContext, Player, Vec3 } from '@platform';
import { shooterBots, type NavGrid, type ShooterBots } from '@platform/kits';

/**
 * Bot gunslingers: the platform's shooter bots (`shooterBots`), tuned for Dry Gulch. Slow guns,
 * so every shot waits for the sights and the gun's pace; the Yellowboy at range, the Peacemaker
 * up close. Nothing reloads by itself here, so they press R when they're dry, and thumb rounds in
 * between fights. Shot at, they sometimes dodge-roll (Q). With nobody in sight they prowl the
 * town toward the last place they saw someone or heard a shot, and once the sun gives everyone
 * away, straight for the nearest.
 */
export interface Bots extends ShooterBots {
  /** Everyone still standing, once the sun gives them away: bots with nobody in sight go for the nearest. */
  hunt: Player[];
}

const dist2 = (a: Vec3, b: Vec3) => (a.x - b.x) ** 2 + (a.z - b.z) ** 2;

export function makeBots(game: GameContext, nav: NavGrid, hotspots: Vec3[]): Bots {
  const bots: Bots = Object.assign(
    shooterBots(game, {
      nav,
      hotspots,
      weapons: {
        revolver: { range: 11, ads: 14, steady: true },
        rifle: { range: 22, ads: true, steady: true },
      },
      aim: {
        reaction: [0.72, 0.32],
        miss: [2.8, 1],
        head: [0.1, 0.3],
        settle: [0.7, 2.2],
        drag: [0.28, 0.08],
        shake: [0.35, 0],
        hipShake: 0.22,
        tolerance: [0.9, 0.5],
        pace: [2, 1.1],
        paceRandom: 0.2,
      },
      senses: { view: 0.3, hearing: 50, chaseHeard: 5 },
      moves: {
        range: 14,
        keep: [1.3, 0.55],
        strafe: [0.4, 1.3],
        hop: 0,
        crouch: 0,
        slide: false,
        hotspot: 0.6,
        wander: [6, 14],
        replan: [1.8, 2.8],
        glance: 0.3,
        // Dry: the other gun if it's loaded, whatever the range, else load.
        swapWithin: Infinity,
        // Between fights: the revolver in hand, a round thumbed in now and then until it's full.
        topUp: 1,
        topUpChance: 0.1,
      },
      // The right gun for the range: the rifle out past 18, the revolver inside 12.
      weapon: (_bot, _mind, dist) => (dist > 18 ? 'rifle' : dist < 12 ? 'revolver' : null),
      // Just hit: a dodge roll now and then (the roll goes the way it's strafing).
      fight: (bot, mind) => {
        if (game.clock.now - mind.hurtAt < 0.3 && mind.strafe !== 0 && Math.random() < 0.35 * mind.skill + 0.1) bot.controls.press('KeyQ');
      },
      goal: (bot) => {
        const pos = bot.position;
        const prey = bots.hunt.filter((p) => p !== bot && p.alive).sort((p, q) => dist2(p.position, pos) - dist2(q.position, pos))[0];
        return prey ? { ...prey.position } : null;
      },
    }),
    { hunt: [] as Player[] },
  );
  return bots;
}
