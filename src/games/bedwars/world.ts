import { Blueprint, type BlockRef, type IconRef, type Vec3 } from '@platform';
import type { BedwarsMap, TeamBase, TeamColor } from './map';
import { MAP_DEFS, type MapDef } from './maps';

/** Each map's picture in the vote menu: a block that says what it's like. */
const ICONS: Record<string, IconRef> = {
  skyhold: { block: 'stone_bricks' },
  canyon: { block: 'sandstone' },
  frostpeak: { block: 'snow_block' },
  sakura: { block: 'pink_concrete' },
};

/** Where the lobby's team pads are: stand on one to join that team. */
export interface Pad {
  color: TeamColor;
  /** Centre of the 3x3 pad (block coordinates). */
  x: number;
  z: number;
}

/** The waiting room: a glass-floored box high over the map's centre, taken away when the match starts. */
export interface Lobby {
  blueprint: Blueprint;
  spawn: Vec3;
  yaw: number;
  /** The y players stand at. */
  feet: number;
  pads: Pad[];
}

export interface PlacedMap extends BedwarsMap {
  id: string;
  name: string;
  blurb: string;
  icon: IconRef;
  lobby: Lobby;
}

/** Maps sit this far apart along x, all in the one world: only the one being played is ever near anyone. */
const SPACING = 512;
/** The lobby's floor, this far above the map's centre (out of reach of anything built: `Match.canPlace`). */
const LOBBY_UP = 30;
const LOBBY_HALF = 10;
const PAD_R = 6.5;

const WOOL: Record<TeamColor, BlockRef> = { red: 'red_wool', blue: 'blue_wool', green: 'green_wool', yellow: 'yellow_wool' };

function lobbyAt(map: BedwarsMap): Lobby {
  const cx = Math.floor(map.center.x);
  const cz = Math.floor(map.center.z);
  const y = Math.floor(map.center.y) + LOBBY_UP;
  const bp = new Blueprint({ x: cx - LOBBY_HALF, y, z: cz - LOBBY_HALF }, { x: LOBBY_HALF * 2 + 1, y: 5, z: LOBBY_HALF * 2 + 1 });
  // Each team's pad on the side of the lobby its island is on.
  const pads: Pad[] = map.teams.map((t) => {
    const dx = t.spawn.x - map.center.x;
    const dz = t.spawn.z - map.center.z;
    const l = Math.hypot(dx, dz) || 1;
    return { color: t.color, x: cx + Math.round((dx / l) * PAD_R), z: cz + Math.round((dz / l) * PAD_R) };
  });
  const padAt = (x: number, z: number) => pads.find((p) => Math.abs(x - p.x) <= 1 && Math.abs(z - p.z) <= 1);
  for (let x = cx - LOBBY_HALF; x <= cx + LOBBY_HALF; x++)
    for (let z = cz - LOBBY_HALF; z <= cz + LOBBY_HALF; z++) {
      const ax = Math.abs(x - cx);
      const az = Math.abs(z - cz);
      const pad = padAt(x, z);
      const edge = ax === LOBBY_HALF || az === LOBBY_HALF;
      // A window in the middle to look down on the map through; a lit ring round it.
      const floor: BlockRef = pad ? WOOL[pad.color] : ax <= 2 && az <= 2 ? 'glass' : Math.max(ax, az) === 3 ? 'sea_lantern' : (x + z) % 2 === 0 ? 'white_concrete' : 'light_gray_concrete';
      bp.set(x, y, z, edge ? 'stone_bricks' : floor);
      if (!edge) continue;
      // Glass walls, lanterns on the corners.
      const corner = ax === LOBBY_HALF && az === LOBBY_HALF;
      for (let k = 1; k <= 3; k++) bp.set(x, y + k, z, corner ? (k === 3 ? 'sea_lantern' : 'stone_bricks') : 'glass');
    }
  return { blueprint: bp, spawn: { x: cx + 0.5, y: y + 1, z: cz + 0.5 }, yaw: 0, feet: y + 1, pads };
}

function place(def: MapDef, i: number): PlacedMap {
  const map = def.build();
  const off = { x: i * SPACING, y: 0, z: 0 };
  const at = (v: Vec3): Vec3 => ({ x: v.x + off.x, y: v.y + off.y, z: v.z + off.z });
  const base = (b: TeamBase): TeamBase => ({ ...b, bed: [at(b.bed[0]), at(b.bed[1])], spawn: at(b.spawn), generator: at(b.generator), shop: at(b.shop) });
  const moved: BedwarsMap = {
    blueprints: map.blueprints.map((bp) => (i ? bp.moved(off) : bp)),
    teams: map.teams.map(base),
    diamonds: map.diamonds.map(at),
    emeralds: map.emeralds.map(at),
    center: at(map.center),
    voidY: map.voidY,
  };
  return { ...moved, id: def.id, name: def.name, blurb: def.blurb, icon: ICONS[def.id] ?? { block: 'white_wool' }, lobby: lobbyAt(moved) };
}

/** Every map, far apart in the one world. The first is where a new room's lobby is. */
export const MAPS: readonly PlacedMap[] = MAP_DEFS.map(place);

export const mapById = (id: string): PlacedMap | undefined => MAPS.find((m) => m.id === id);

/** Everything built: every map and its lobby. */
export const STRUCTURES: Blueprint[] = MAPS.flatMap((m) => [...m.blueprints, m.lobby.blueprint]);
