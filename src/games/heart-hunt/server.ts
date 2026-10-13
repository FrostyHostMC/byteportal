import { defineServer } from '@platform';
import { melee } from '@platform/kits';
import { shared } from './shared';

/**
 * Tutorial game from docs/PLATFORM.md: find ten glowing hearts scattered around a pedestal.
 * Everything here uses the public API only.
 */
let found = 0;
let won = false;

export default defineServer(shared, {
  // Nothing to use but the bare fist.
  items: [melee()],
  setup(game) {
    // (How a heart looks is each screen's: `client.ts`.)
    game.items.define('heart', {
      kind: 'misc',
      name: 'Heart',
      onPickup(g, _count, player) {
        found++;
        player.achieve('first_heart'); // awarded once: after that it does nothing
        g.audio.play('pickup');
        return true; // consumed instead of added to the inventory
      },
    });
    // The hearts found, as ten hearts across the top: a HUD widget of the game's own, filled in from data.
    game.hud.define('tally', {
      at: 'top',
      html: `<div class="pill"><span data-each="hearts" class="{{.}}">♥</span> <b>{{found}} / 10</b></div>`,
      css: `.pill { display: flex; align-items: center; gap: 3px; padding: 5px 14px; border-radius: 999px;
                    background: rgba(10, 13, 20, 0.55); color: #f2f4f8; font: 600 20px var(--sans) }
            .found { color: #ff5a7a; text-shadow: 0 0 8px rgba(255, 90, 122, 0.7) }
            .missing { color: rgba(255, 255, 255, 0.22) }
            b { margin-left: 8px; font-size: 13px }`,
    });
  },

  start(game) {
    found = 0;
    won = false;
    for (let i = 0; i < 10; i++) {
      const a = game.rng.range(0, Math.PI * 2);
      const r = game.rng.range(8, 36);
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      game.items.spawnPickup('heart', { x, y: game.world.surfaceY(x, z) + 1.5, z }, { beam: '#ff5a7a', despawn: 1e9 });
    }
    game.hud.banner('Heart Hunt', 'Follow the beams');
  },

  update(game) {
    // Every tick: only what changed reaches the screen.
    game.hud.widget('tally', { found, hearts: Array.from({ length: 10 }, (_, i) => (i < found ? 'found' : 'missing')) });
    if (found === 10 && !won) {
      won = true;
      // A hunt everyone shares: all ten found is everyone's, and quickly if the clock's under 2:00.
      for (const p of game.players) {
        p.achieve('all_hearts');
        if (game.clock.now < 120) p.achieve('speedy');
      }
      game.fx.fireworks(game.player.position, 4);
      game.audio.play('victory');
      game.hud.screen({
        title: 'You found them all!',
        tone: 'victory',
        icon: { item: 'heart' },
        buttons: [
          { label: 'Play again', primary: true, onClick: () => game.restart() },
          { label: 'Switch game', onClick: () => game.exit() },
        ],
      });
    }
  },
});
