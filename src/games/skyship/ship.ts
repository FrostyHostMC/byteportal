import { Blueprint, type BlockRef, type Vec3 } from '@platform';

/*
 * The airship, in its own space: the origin is the middle of the main deck's top, the bow points
 * toward -z and +y is up. Players stand on the main deck at y = 0.
 *
 *   hull       31 long (bow at z = -17, stern at z = 13), 11 wide, planked, with a keel
 *   main deck  railed, with a gap amidships on each side (the gangways, z = -1..1)
 *   cabin      the stern (z >= 8): door in its front wall, windows, a roof deck at y = 4
 *              reached by three steps up its front on the port side
 *   helm       the wheel on the roof deck, the helmsman standing behind it
 *   envelope   a striped gas bag above, held up by four struts from the deck
 */

/** Where the helmsman stands (behind the wheel on the roof deck), and where the crew comes aboard. */
export const HELM: Vec3 = { x: 0.5, y: 4, z: 12.5 };
export const WHEEL: Vec3 = { x: 0.5, y: 5.3, z: 11.5 };
export const DECK_SPAWN: Vec3 = { x: 0.5, y: 0, z: 2.5 };
/** Where the propeller spins, behind the stern. */
export const PROPELLER: Vec3 = { x: 0.5, y: -1.5, z: 14.6 };

const BOW = -17;
const STERN = 13;
const CABIN = 8;

/** Half the hull's width at `z`: full amidships, a pointed bow, a narrower stern. */
function half(z: number): number {
  if (z < -10) return Math.round(5 * Math.sqrt(Math.max(0, (z - BOW) / 7)));
  if (z > 9) return Math.round(5 - (z - 9) * 0.5);
  return 5;
}

const inside = (x: number, z: number) => z >= BOW && z <= STERN && Math.abs(x) <= half(z);
const edge = (x: number, z: number) => inside(x, z) && (!inside(x - 1, z) || !inside(x + 1, z) || !inside(x, z - 1) || !inside(x, z + 1));

/** The envelope: an ellipsoid above the deck. */
const BAG = { y: 16, z: -2, rx: 6.5, ry: 5, rz: 15 };
const inBag = (x: number, y: number, z: number) => ((x - 0.5) / BAG.rx) ** 2 + ((y + 0.5 - BAG.y) / BAG.ry) ** 2 + ((z + 0.5 - BAG.z) / BAG.rz) ** 2 <= 1;

export function airship(): Blueprint {
  const bp = new Blueprint({ x: -10, y: -6, z: BOW - 1 }, { x: 22, y: 32, z: STERN - BOW + 3 });
  const set = (x: number, y: number, z: number, b: BlockRef) => bp.set(x, y, z, b);

  for (let z = BOW; z <= STERN; z++)
    for (let x = -5; x <= 5; x++) {
      if (!inside(x, z)) continue;
      // Main deck, edged with the hull's planking.
      set(x, -1, z, edge(x, z) ? 'spruce_planks' : 'oak_planks');
      // The hull narrows below, down to the keel.
      for (let d = 1; d <= 3; d++) {
        const w = half(z) - d;
        if (Math.abs(x) <= w) set(x, -1 - d, z, Math.abs(x) === w || d === 3 ? 'spruce_planks' : 'birch_planks');
      }
      // Rail round the deck, open amidships for the gangways.
      if (edge(x, z) && !(Math.abs(z) <= 1 && Math.abs(x) === 5)) set(x, 0, z, 'spruce_planks');
    }
  for (let z = BOW + 3; z <= STERN - 2; z++) set(0, -5, z, 'spruce_log');
  // Lanterns on the rail at the corners of the main deck, and at the bow.
  for (const [x, z] of [
    [-5, -8],
    [5, -8],
    [-5, 6],
    [5, 6],
  ])
    set(x, 0, z, 'sea_lantern');
  set(0, 0, BOW, 'sea_lantern');

  // The cabin: walls three high round the stern, a roof deck on top.
  for (let z = CABIN; z <= STERN; z++)
    for (let x = -5; x <= 5; x++) {
      if (!inside(x, z)) continue;
      const wall = edge(x, z) || z === CABIN;
      for (let y = 0; y <= 2; y++) {
        if (!wall) continue;
        const door = z === CABIN && x === 0 && y <= 1;
        const window = y === 1 && !door && (z === CABIN ? Math.abs(x) === 3 : z % 2 === 1);
        if (door) set(x, y, z, 'air');
        else set(x, y, z, window ? 'glass' : 'spruce_planks');
      }
      set(x, 3, z, edge(x, z) || z === CABIN ? 'spruce_log' : 'spruce_planks');
      // The roof deck's rail, open along the front (the steps come up there).
      if (edge(x, z) && z > CABIN) set(x, 4, z, 'spruce_planks');
    }
  // Inside: a lantern, a table, a bookshelf.
  set(0, 2, STERN - 2, 'glowstone');
  set(-2, 0, STERN - 2, 'bookshelf');
  set(2, 0, 11, 'spruce_log');
  // Steps up the cabin's front on the port side: one block, two, three, then the roof.
  set(-2, 0, CABIN - 1, 'spruce_planks');
  for (let y = 0; y <= 1; y++) set(-3, y, CABIN - 1, 'spruce_planks');
  for (let y = 0; y <= 2; y++) set(-4, y, CABIN - 1, 'spruce_planks');
  // The wheel: a waist-high post (the helmsman looks out over it), spokes either side.
  set(0, 4, 11, 'spruce_log');
  set(-1, 4, 11, 'birch_planks');
  set(1, 4, 11, 'birch_planks');

  // Struts from the deck up to the envelope.
  for (const [x, z] of [
    [-4, -9],
    [4, -9],
    [-4, 4],
    [4, 4],
  ])
    for (let y = 0; y < 13; y++) if (!inBag(x, y, z)) set(x, y, z, 'spruce_log');

  // The envelope: a shell of wool, striped, with a darker keel line and fins at the tail.
  for (let y = BAG.y - BAG.ry - 1; y <= BAG.y + BAG.ry + 1; y++)
    for (let z = BAG.z - BAG.rz - 1; z <= BAG.z + BAG.rz + 1; z++)
      for (let x = -7; x <= 8; x++) {
        if (!inBag(x, y, z)) continue;
        if (inBag(x - 1, y, z) && inBag(x + 1, y, z) && inBag(x, y - 1, z) && inBag(x, y + 1, z) && inBag(x, y, z - 1) && inBag(x, y, z + 1)) continue;
        const stripe = ((z - BAG.z + 60) % 8 + 8) % 8 === 0;
        const bottom = y < BAG.y - BAG.ry + 1.5;
        set(x, y, z, stripe ? 'white_wool' : bottom ? 'black_wool' : 'red_wool');
      }
  // Fins on the tail: out from the envelope's sides and up from its top, over its last few blocks.
  for (let z = BAG.z + BAG.rz - 7; z <= BAG.z + BAG.rz - 1; z++) {
    const k = 1 - ((z + 0.5 - BAG.z) / BAG.rz) ** 2;
    if (k <= 0) continue;
    const side = Math.floor(BAG.rx * Math.sqrt(k));
    const top = Math.floor(BAG.y + BAG.ry * Math.sqrt(k));
    const reach = Math.min(3, BAG.z + BAG.rz - z);
    for (let d = 0; d <= reach; d++) {
      set(-side - d, BAG.y, z, 'white_wool');
      set(1 + side + d, BAG.y, z, 'white_wool');
      set(0, top + d, z, 'white_wool');
      set(1, top + d, z, 'white_wool');
    }
  }
  return bp;
}

/** The propeller: four spruce blades round a hub, facing along z. */
export function propeller(): Blueprint {
  const bp = new Blueprint({ x: -3, y: -3, z: 0 }, { x: 7, y: 7, z: 1 });
  bp.set(0, 0, 0, 'iron_block');
  for (let d = 1; d <= 3; d++) {
    bp.set(d, 0, 0, 'spruce_planks');
    bp.set(-d, 0, 0, 'spruce_planks');
    bp.set(0, d, 0, 'spruce_planks');
    bp.set(0, -d, 0, 'spruce_planks');
  }
  return bp;
}
