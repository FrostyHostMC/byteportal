import { defineShared } from '@platform';
import { buildArena } from './arena';
import { BLOCKS } from './blocks';
import { FLOOR } from './court';
import hudCss from './hud.css?raw';
import meta from './meta';
import { BODY_GRAVITY, jam, RUN } from './moves';

/**
 * Block Jam, as the server and every screen both have it: the arena (its blocks, in a void world),
 * the ballers' movement (the `jam` ability: screen-relative steering, turbo, jump shots, dunks),
 * and the HUD's look: an arcade scoreboard, chunky type.
 */
export const shared = defineShared({
  ...meta,
  world: {
    terrain: 'void',
    structures: [buildArena()],
    spawn: { x: 0.5, y: FLOOR, z: 5 },
    spawnYaw: Math.PI,
    time: 0.5,
    freezeTime: true,
    maxViewDistance: 4,
  },
  blocks: BLOCKS,
  player: {
    health: false,
    fallDamage: false,
    hotbar: 'items',
    movement: {
      walk: RUN,
      // (Turbo is the jam ability's: nothing sprints or sneaks by itself.)
      sprint: RUN,
      crouch: RUN,
      jump: 1.2,
      gravity: BODY_GRAVITY,
      acceleration: 22,
      airControl: 2.5,
      sprintKeys: ['F24'],
      crouchKeys: ['F23'],
      doubleTapSprint: false,
      edgeGuard: false,
      slide: false,
      mantle: false,
      abilities: { jam },
    },
  },
  hud: {
    health: 'none',
    nameTags: 'always',
    theme: {
      display: "'Bungee', Impact, sans-serif",
      text: "'Barlow Condensed', system-ui, sans-serif",
      fonts: ['Bungee', 'Barlow Condensed:500;700'],
      colors: { accent: '#ff6b1a', ink: '#0b0d14', paper: '#11141f', text: '#ffffff', danger: '#ff3b30', good: '#ffd23f' },
      css: hudCss,
    },
  },
});
