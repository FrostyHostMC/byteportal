import type { MovementAbility } from '@platform';

/**
 * Down, not out: a fighter at the end of their health with friends still standing drops to the
 * sand and crawls (`run/downed.ts` turns it on with `player.abilities.crawl.on`). Low, slow, no
 * jumping and no rolling (it comes before the roll, and takes its key), the view down at the sand
 * and rocking with each pull. A pure step like the roll, so it holds on their own screen at once.
 */
export const CRAWL = { speed: 0.28, key: 'KeyQ', dip: 0.15 };

export const crawl: MovementAbility<{ on: boolean }> = {
  state: { on: false },
  step(s, c, body) {
    if (!s.on) return;
    c.consume(CRAWL.key);
    body.stance = 'low';
    body.jump = false;
    body.speed = CRAWL.speed;
    // Each pull along the sand rocks the view a little.
    const moving = Math.hypot(body.velocity.x, body.velocity.z) > 0.3;
    body.camera.dip = CRAWL.dip;
    body.camera.roll = moving ? Math.sin(body.time * 5) * 0.06 : 0;
  },
};
