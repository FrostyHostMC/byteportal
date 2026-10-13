import { defineShared, Models } from '@platform';
import { ATLAS, skinOrigin } from './art';
import { BLOCKS } from './blocks';
import hudCss from './hud.css?raw';
import { MAPS, WORLD } from './map';
import meta from './meta';
import { peek } from './peek';
import { FIGHTERS as FIGHTER_MODELS } from './models/fighters';
import { chopperVehicle, missileVehicle } from './streaks/flight';
import { FIGHTER_STYLE } from './style';

export const COLORS = { gold: '#ffcc00', red: '#e63946', ink: '#111111', cream: '#fdf1d6', pink: '#ff5c8a', teal: '#1fa3a0' };

/** Each outfit's fighter (in the same order as `OUTFITS`): a model on the platform's humanoid rig, animated by it. */
export const fighterModel = (outfit: number) => Models.gltf(FIGHTER_MODELS[outfit % FIGHTER_MODELS.length].url, { rig: 'humanoid', ...FIGHTER_STYLE });

/**
 * The maps (every screen builds them all, far apart in one world, and shoots into them: map.ts),
 * how fighters move (each screen predicts its own: sprint, slide, mantle), and the comic-book HUD.
 */
export const shared = defineShared({
  ...meta,
  // Big Kahuna Burger's thatch, bamboo, tiki heads, chain-link and menu board (blocks.ts).
  blocks: BLOCKS,
  // The killstreaks you steer (`streaks/flight.ts`): each pilot's screen flies theirs ahead of the server.
  vehicles: { hellstorm: missileVehicle, chopper: chopperVehicle },
  world: {
    seed: WORLD.seed,
    // No landscape to make: the maps and their backdrops stand on a plain ground over the void,
    // deep enough for Jackrabbit Lane's storm drain, and nothing past the haze is loaded (so only
    // the map being played is: the others are hundreds of blocks away).
    terrain: 'void',
    ground: { y: WORLD.floorY - 1, top: 'grass_block', fill: 'dirt', depth: 10 },
    maxViewDistance: 10,
    structures: WORLD.structures,
    terraform: WORLD.terraform,
    // The home page looks down Jackrabbit Lane from the west end, toward the diner (fighters
    // spawn at their map's spawns; a match on another map moves this there: `world.spawn`).
    spawn: { x: MAPS[0].home.x, y: MAPS[0].home.y, z: MAPS[0].home.z },
    spawnYaw: MAPS[0].home.yaw,
    time: WORLD.time,
    freezeTime: true,
    // Walls, roofs, cars, the diner: shot into, pixel by pixel (each gun's `carve`). The ground
    // layer and everything below it (the storm drain, the drained pool) stay whole, so nobody
    // shoots their way out of a map. A restart puts it all back.
    destructible: { above: WORLD.floorY - 1 },
  },
  player: {
    health: 100,
    regen: { delay: 4.5, perSecond: 35 },
    hurtCooldown: 0,
    pvp: true,
    fallDamage: false,
    hotbar: 'items',
    skin: skinOrigin(0),
    skinAtlas: ATLAS,
    model: fighterModel(0),
    movement: {
      walk: 6,
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
      slide: { speed: 11.5, time: 0.8, friction: 1.3, cooldown: 0.6 },
      mantle: 1.1,
      // Q and E lean out to peek round corners (peek.ts).
      abilities: { peek },
    },
  },
  hud: {
    health: 'bar',
    healthBars: true,
    nameTags: 'sight',
    theme: {
      display: "'Bangers', 'Impact', 'Arial Black', sans-serif",
      text: "'Archivo', 'Helvetica Neue', system-ui, sans-serif",
      fonts: ['Bangers', 'Archivo'],
      colors: { accent: COLORS.gold, ink: COLORS.ink, paper: COLORS.cream, text: COLORS.ink, danger: COLORS.red, good: COLORS.gold },
      // The comic-book look: ink outlines, hard shadows, paper panels.
      css: hudCss,
    },
  },
});
