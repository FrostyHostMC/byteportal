import { defineShared } from '@platform';
import { buildArena } from './arena';
import { BLOCKS } from './blocks';
import hudCss from './hud.css?raw';
import meta from './meta';
import { skate, SKATE } from './moves';
import { ICE } from './rink';

/**
 * Block Ice, as the server and every screen both have it: the arena (its blocks, in a void world),
 * the skaters' movement (the `skate` ability: screen-relative steering on ice, turbo, wind-ups,
 * checks), and the HUD's look: an arcade scoreboard, chunky type, ice blue.
 */
export const shared = defineShared({
  ...meta,
  world: {
    terrain: 'void',
    structures: [buildArena()],
    spawn: { x: 0.5, y: ICE, z: 5 },
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
      walk: SKATE,
      // (Turbo is the skate ability's: nothing sprints or sneaks by itself.)
      sprint: SKATE,
      crouch: SKATE,
      jump: 1.2,
      acceleration: 22,
      airControl: 1,
      sprintKeys: ['F24'],
      crouchKeys: ['F23'],
      doubleTapSprint: false,
      edgeGuard: false,
      slide: false,
      mantle: false,
      abilities: { skate },
    },
  },
  hud: {
    health: 'none',
    nameTags: 'always',
    theme: {
      display: "'Bungee', Impact, sans-serif",
      text: "'Barlow Condensed', system-ui, sans-serif",
      fonts: ['Bungee', 'Barlow Condensed:500;700'],
      colors: { accent: '#3fa9f5', ink: '#0b0d14', paper: '#11141f', text: '#ffffff', danger: '#ff3b30', good: '#ffd23f' },
      css: hudCss,
    },
  },
});
