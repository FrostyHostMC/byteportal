import { defineShared, Models } from '@platform';
import { BLOCKS } from './blocks';
import { HERO_ABILITIES } from './heroes/abilities';
import { THEME_CSS } from './hud';
import { MAPS, WORLD } from './map';
import meta from './meta';
import { TROOPER_VARIANTS } from './models';
import { STYLE } from './style';
import type { Team } from './teams';

export const COLORS = { yellow: '#ffe81f', ink: '#0b0f14', paper: '#e9edf2', red: '#ff3b30', blue: '#4db8ff', green: '#5dff6a' };

/**
 * A side's trooper of a class (`ClassInfo.model`), in one of its looks (`variant`, any number: the
 * Rebels have a few faces a class, the Empire's are all alike): a model on the platform's humanoid rig.
 */
export function trooperModel(team: Team, model: number, variant = 0) {
  const classes = TROOPER_VARIANTS[team];
  const looks = classes[model % classes.length];
  return Models.gltf(looks[Math.abs(variant) % looks.length].url, { rig: 'humanoid', ...STYLE });
}

/**
 * What the server and every screen agree on: the maps (built into one void world over a desert
 * floor, and shot into: blaster bolts scorch and chip the walls), how troopers move (each screen
 * predicts its own: sprint, slide, mantle), and the HUD's look.
 */
export const shared = defineShared({
  ...meta,
  blocks: BLOCKS,
  world: {
    seed: WORLD.seed,
    terrain: 'void',
    ground: { y: WORLD.floorY - 1, top: WORLD.ground.top, fill: WORLD.ground.fill, depth: 6 },
    maxViewDistance: 11,
    structures: WORLD.structures,
    terraform: WORLD.terraform,
    spawn: { x: MAPS[0].home.x, y: MAPS[0].home.y, z: MAPS[0].home.z },
    spawnYaw: MAPS[0].home.yaw,
    time: WORLD.time,
    freezeTime: true,
    // Walls and roofs chip and scorch under blaster fire (each blaster's `carve`); the ground, and
    // the canyon's and the glacier's walls round the maps, stay whole.
    destructible: { above: WORLD.floorY - 1, except: ['canyon_rock', 'canyon_rock_pale', 'glacier', 'frost_rock'] },
  },
  player: {
    health: 100,
    regen: { delay: 5, perSecond: 25 },
    hurtCooldown: 0,
    pvp: true,
    fallDamage: false,
    hotbar: 'items',
    model: trooperModel(0, 0),
    movement: {
      walk: 5.8,
      sprint: 8.4,
      crouch: 2.8,
      jump: 1.3,
      gravity: 30,
      acceleration: 16,
      airControl: 4,
      sprintKeys: ['ShiftLeft', 'ShiftRight'],
      crouchKeys: ['KeyC'],
      doubleTapSprint: false,
      edgeGuard: false,
      slide: { speed: 11, time: 0.75, friction: 1.3, cooldown: 0.6 },
      mantle: 1.1,
      // The heroes' moves (a Force jump, the guard's pace, Luke's rush and leap, the powers' cooldowns):
      // every player has them, resting until the server makes them a hero (`heroes/abilities.ts`).
      abilities: HERO_ABILITIES,
    },
  },
  hud: {
    health: 'bar',
    healthBars: true,
    nameTags: 'sight',
    theme: {
      display: "'Barlow Condensed', 'Arial Narrow', 'Helvetica Neue', sans-serif",
      text: "'Barlow', 'Helvetica Neue', system-ui, sans-serif",
      fonts: ['Barlow Condensed:300;400;500;600;700', 'Barlow:400;500;600'],
      colors: { accent: COLORS.yellow, ink: COLORS.ink, paper: COLORS.ink, text: COLORS.paper, danger: COLORS.red, good: COLORS.paper },
      css: THEME_CSS,
    },
  },
});
