import { defineShared, Models, type HumanoidPoses } from '@platform';
import type { GunOptions } from '@platform/items';
import { roll } from './abilities';
import { BLOCKS } from './blocks';
import hudCss from './hud.css?raw';
import { MAP } from './map';
import meta from './meta';
import { COWBOYS } from './models';

export const COLORS = { brass: '#d9a441', cream: '#f4e6c4', blood: '#b3262c', ink: '#2b1a0e', sage: '#8fae5a' };

/**
 * How Dry Gulch's gunslingers carry themselves (`HumanoidPoses`, every figure the same): the
 * Peacemaker held out at arm's length in one hand, body turned side-on like a duellist, the free
 * hand hovering by the belt; guns carried muzzle-down by the thigh at a run; a revolver's hard
 * muzzle flip; a slow dramatic fall, nearly always backwards; a loose, rolling walk. (Each gun's
 * reload is its own: `hold.poses` in client/looks.ts.)
 */
const STYLE: HumanoidPoses = {
  heldScale: 0.5,
  pistolUnder: 0.5,
  pistol: { hip: [-0.2, -0.1, 0.42], ads: [-0.14, 0.02, 0.52], twist: -0.42, cheek: 0.06, offHand: { offset: [0.2, -0.48, 0.1], turn: [0.5, 0, 0.2] } },
  rifle: { hip: [-0.13, -0.16, 0.26], ads: [-0.05, -0.04, 0.25], twist: -0.24, cheek: 0.14 },
  kick: { back: 0.03, tip: 0.38, decay: 13 },
  sprint: { offset: [-0.2, -0.42, 0.1], turn: [1.15, 0.1, 0] },
  death: { time: 1.05, backward: 0.85 },
  gait: { sway: 0.03, width: 0.12, armSwing: [0.35, 0.85], lean: [0.02, 0.13], bob: [0.018, 0.05] },
};

export const cowboyModel = (outfit: number) => Models.gltf(COWBOYS[outfit % COWBOYS.length].url, { rig: 'humanoid', poses: STYLE, firstPerson: { scale: 0.9 } });

/**
 * Dry Gulch and its blocks (every screen builds the town), how gunslingers move (each screen
 * predicts its own, the dodge roll too), how guns play, and the Wild West HUD.
 */
/** How its guns play: the gun kit's rules, the same on the host (`server.ts`) and on each screen (`client.ts`). */
export const GUN_RULES: GunOptions = {
  autoReload: false,
  aimStopsSprint: true,
  fireStopsSprint: true,
  rateSlack: 2,
  assist: { strength: 0.45 },
};

export const shared = defineShared({
  ...meta,
  blocks: BLOCKS,
  world: {
    seed: MAP.seed,
    structures: MAP.structures,
    terraform: MAP.terraform,
    spawn: MAP.spawns[0],
    spawnYaw: MAP.spawns[0].yaw,
    time: MAP.time,
    freezeTime: true,
  },
  player: {
    health: 100,
    regen: { delay: 7, perSecond: 6 },
    hurtCooldown: 0,
    pvp: true,
    fallDamage: false,
    hotbar: 'items',
    model: cowboyModel(0),
    movement: {
      walk: 5.2,
      sprint: 7.4,
      crouch: 2.4,
      jump: 1.25,
      gravity: 30,
      acceleration: 14,
      airControl: 3,
      sprintKeys: ['ShiftLeft', 'ShiftRight'],
      crouchKeys: ['KeyC'],
      doubleTapSprint: false,
      edgeGuard: false,
      mantle: 1.1,
      abilities: { roll },
    },
  },
  hitscan: {
    rewind: 0.3,
    // Bigger heads: the hat counts (the head's zone starts lower and is wider).
    hitboxes: { stand: { neck: 1.42, headWidth: 0.66 }, crouch: { neck: 1.12, headWidth: 0.68 } },
  },
  hud: {
    health: 'bar',
    healthBars: false,
    nameTags: 'sight',
    theme: {
      display: "'Rye', 'Georgia', serif",
      text: "'Special Elite', 'Courier New', monospace",
      fonts: ['Rye', 'Special Elite'],
      colors: { accent: COLORS.brass, ink: COLORS.ink, paper: '#eadab4', text: COLORS.ink, danger: '#8e1b12', good: COLORS.sage },
      css: hudCss,
    },
  },
});
