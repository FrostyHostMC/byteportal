import type { Facing, Vec3 } from '../api/types';
import { variant, type BlockDef, type Registry } from './registry';

/** The way each facing points, (x, z). */
export const FACING_DIR: Record<Facing, [number, number]> = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] };
/** The face (+X -X +Y -Y +Z -Z) each facing points out of. */
const FACING_FACE: Record<Facing, number> = { north: 5, east: 0, south: 4, west: 1 };

/** The facing nearest a horizontal direction. */
export function facingOf(dx: number, dz: number): Facing {
  if (Math.abs(dx) > Math.abs(dz)) return dx > 0 ? 'east' : 'west';
  return dz > 0 ? 'south' : 'north';
}

/** How a block is being placed. */
export interface PlaceHow {
  /**
   * The face aimed at (a raycast hit): the side a torch hangs on, the half a slab or stairs
   * takes (the upper one aiming at a ceiling or high on a side), the axis a log lies along.
   */
  against?: { x: number; y: number; z: number; normal: Vec3; point?: Vec3; block: number };
  /** Which way the placer is looking: stairs climb away from them, a bed's head points away. */
  look?: Vec3;
  /** The way a game's facing block should face (`placeBlock`'s `facing`), whatever's aimed at. */
  facing?: Facing;
}

/** Cells to set: [x, y, z, block id]. */
export type Cells = [number, number, number, number][];

/**
 * Where a block goes when it's placed at (x, y, z), Minecraft style, as the cells to set: a
 * torch aimed at the side of a block hangs on it, a slab takes the half aimed at (or joins the
 * same kind of slab into a full block), stairs and beds face away from the placer (a bed's head
 * takes the next cell), a log lies along the axis aimed along. `exact`: the caller named the
 * variant, so it goes as it is (a bed still gets its other half). `join` means the cell holds a
 * slab it completes, so it's all right that it's taken. Null if it can't go there that way (a
 * torch with nothing to hang on).
 */
export function placement(
  reg: Registry,
  def: BlockDef,
  x: number,
  y: number,
  z: number,
  how: PlaceHow,
  exact: boolean,
  get: (x: number, y: number, z: number) => number,
): { cells: Cells; join?: boolean } | null {
  const a = how.against;
  const n = a?.normal;
  const block = (bx: number, by: number, bz: number) => reg.blocks[get(bx, by, bz)];
  const sturdy = (bx: number, by: number, bz: number, face: number) => ((block(bx, by, bz)?.sturdy ?? 0) >> face) & 1;
  const lookFacing = (): Facing => {
    const l = how.look;
    if (l && (l.x !== 0 || l.z !== 0)) return facingOf(l.x, l.z);
    // Nobody looking: face away from the block aimed at.
    return n && (n.x !== 0 || n.z !== 0) ? facingOf(-n.x, -n.z) : 'north';
  };
  // The upper half: aiming at the underside of something, or high on a side.
  const upper = () => {
    if (!n) return false;
    if (n.y !== 0) return n.y < 0;
    const p = a?.point;
    return p ? p.y - Math.floor(p.y) > 0.5 : false;
  };
  const one = (d: BlockDef | null): { cells: Cells } | null => (d ? { cells: [[x, y, z, d.id]] } : null);

  switch (def.model) {
    case 'torch':
    case 'wall_torch': {
      if (exact) return one(def);
      if (n && n.y === 0) {
        const f = facingOf(n.x, n.z);
        if (sturdy(x - n.x, y, z - n.z, FACING_FACE[f])) return one(variant(reg, def, { facing: f }));
      }
      return sturdy(x, y - 1, z, 2) ? one(variant(reg, def, { facing: undefined })) : null;
    }
    case 'slab': {
      // Aimed at a slab of this kind from its open side: fill it in (if two make a block: a
      // game's slab may not).
      const t = a && reg.blocks[a.block];
      if (def.double && a && n && t?.name === def.name && ((t.state.type === 'bottom' && n.y > 0) || (t.state.type === 'top' && n.y < 0))) {
        return { cells: [[a.x, a.y, a.z, def.double]], join: true };
      }
      if (def.double && block(x, y, z)?.name === def.name) return { cells: [[x, y, z, def.double]], join: true };
      return exact ? one(def) : one(variant(reg, def, { type: upper() ? 'top' : 'bottom' }));
    }
    case 'stairs':
      return exact ? one(def) : one(variant(reg, def, { facing: lookFacing(), half: upper() ? 'top' : 'bottom' }));
    case 'bed': {
      const b = exact ? def : variant(reg, def, { facing: lookFacing(), part: 'foot' });
      if (!b) return null;
      const [dx, dz] = FACING_DIR[b.state.facing as Facing];
      const s = b.state.part === 'foot' ? 1 : -1;
      const other = variant(reg, b, { part: b.state.part === 'foot' ? 'head' : 'foot' });
      if (!other) return null;
      return { cells: [[x, y, z, b.id], [x + dx * s, y, z + dz * s, other.id]] };
    }
  }
  // A game's block that faces a way (a sign, a furnace, a ladder): the way asked for; else out
  // from the side of the block aimed at (a sign on a wall), up or down from a top or bottom if it
  // turns that way; else back at whoever places it.
  if (def.state.facing !== undefined && !exact) {
    const vertical = n && n.y !== 0 ? (n.y > 0 ? 'up' : 'down') : null;
    let f: string;
    if (how.facing) f = how.facing;
    else if (n && (n.x !== 0 || n.z !== 0)) f = facingOf(n.x, n.z);
    else if (vertical && variant(reg, def, { facing: vertical })) f = vertical;
    else if (how.look && (how.look.x !== 0 || how.look.z !== 0)) f = facingOf(-how.look.x, -how.look.z);
    else f = def.state.facing;
    return one(variant(reg, def, { facing: f }));
  }
  if (def.state.axis !== undefined && !exact && n) {
    return one(variant(reg, def, { axis: n.x !== 0 ? 'x' : n.z !== 0 ? 'z' : 'y' }));
  }
  return one(def);
}

/**
 * What else goes when the block at (x, y, z) (which was `id`) goes: a plant or torch standing
 * on it, torches hung on its sides, the other half of a bed.
 */
export function dependents(reg: Registry, x: number, y: number, z: number, id: number, get: (x: number, y: number, z: number) => number): [number, number, number][] {
  const out: [number, number, number][] = [];
  const above = reg.blocks[get(x, y + 1, z)];
  if (above && (above.shape === 'cross' || above.model === 'torch')) out.push([x, y + 1, z]);
  for (const f of Object.keys(FACING_DIR) as Facing[]) {
    const [dx, dz] = FACING_DIR[f];
    const d = reg.blocks[get(x + dx, y, z + dz)];
    if (d?.model === 'wall_torch' && d.state.facing === f) out.push([x + dx, y, z + dz]);
  }
  const b = reg.blocks[id];
  if (b?.model === 'bed') {
    const [dx, dz] = FACING_DIR[b.state.facing as Facing];
    const s = b.state.part === 'foot' ? 1 : -1;
    const p = reg.blocks[get(x + dx * s, y, z + dz * s)];
    if (p?.name === b.name && p.state.part !== b.state.part) out.push([x + dx * s, y, z + dz * s]);
  }
  return out;
}
