//! Main-thread world: sparse column storage, block edits and damage, region extraction for the
//! meshing workers, voxel raycasting and player physics.

use std::collections::HashMap;
use std::hash::{BuildHasherDefault, Hasher};

use crate::blocks::*;
use crate::damage::{self, Damage};
use crate::gen::HEADER_BYTES;
use crate::mesher::{REGION_HEADER, RW};
use crate::shapes::shapes;
use crate::movers::Mover;

/// The original block of an edit mirrored before its column loaded (filled in when it loads).
const UNKNOWN: u8 = 255;

/// Small, fast hasher for integer keys.
#[derive(Default)]
pub struct FxHasher(u64);

impl Hasher for FxHasher {
    #[inline]
    fn finish(&self) -> u64 {
        self.0
    }
    #[inline]
    fn write(&mut self, bytes: &[u8]) {
        for &b in bytes {
            self.write_u64(b as u64);
        }
    }
    #[inline]
    fn write_u64(&mut self, i: u64) {
        self.0 = (self.0.rotate_left(5) ^ i).wrapping_mul(0x51_7cc1_b727_220a_95);
    }
    #[inline]
    fn write_i32(&mut self, i: i32) {
        self.write_u64(i as u32 as u64);
    }
    #[inline]
    fn write_u32(&mut self, i: u32) {
        self.write_u64(i as u64);
    }
}

pub type FxMap<K, V> = HashMap<K, V, BuildHasherDefault<FxHasher>>;

type Section = Box<[u8; 4096]>;

pub struct Column {
    sections: [Option<Section>; 16],
    emit: u16,
    /// Sections with damaged blocks in them (see `World::damage`): only there does a cell ask.
    damaged: u16,
}

impl Column {
    fn mask(&self) -> u16 {
        let mut m = 0;
        for (s, sec) in self.sections.iter().enumerate() {
            if sec.is_some() {
                m |= 1 << s;
            }
        }
        m
    }
}

#[inline(always)]
fn key(cx: i32, cz: i32) -> u64 {
    ((cx as u32 as u64) << 32) | cz as u32 as u64
}

/// Which blocks can be carved (`World::carve`): by id, and only higher up than `above`.
#[derive(Clone)]
pub struct Destructible {
    pub above: i32,
    pub ids: [bool; 256],
}

pub struct World {
    cols: FxMap<u64, Column>,
    /// Player edits per column: local index (y * 256 + z * 16 + x) -> block.
    edits: FxMap<u64, FxMap<u32, u8>>,
    /// What each edited cell held before its first edit this session (for `revert_edits`).
    originals: FxMap<u64, FxMap<u32, u8>>,
    /// Blocks partly carved away, per column like `edits`: local index -> what's left. Kept while
    /// a column is away, like edits; a block set over one is whole again.
    damage: FxMap<u64, FxMap<u32, Box<Damage>>>,
    /// Which blocks `carve` reaches (none until a game says).
    pub destructible: Option<Box<Destructible>>,
    /// Moving colliders (see `movers`).
    pub movers: Vec<Mover>,
}

/// What a carve changed: the cells it took bits from (and which), the ones left with nothing
/// (air now) and the blocks they were, and how many little voxels went in all.
#[derive(Default)]
pub struct Carved {
    pub cells: Vec<([i32; 3], [u16; 256])>,
    pub emptied: Vec<([i32; 3], u8)>,
    pub removed: u32,
}

impl Default for World {
    fn default() -> Self {
        Self::new()
    }
}

impl World {
    pub fn new() -> Self {
        World { cols: FxMap::default(), edits: FxMap::default(), originals: FxMap::default(), damage: FxMap::default(), destructible: None, movers: Vec::new() }
    }

    pub fn mover(&self, id: u32) -> Option<&Mover> {
        self.movers.iter().find(|m| m.id == id)
    }

    pub fn mover_mut(&mut self, id: u32) -> Option<&mut Mover> {
        self.movers.iter_mut().find(|m| m.id == id)
    }

    /// The first mover along a ray (unit `d`) within `max`: its id and the distance.
    pub fn raycast_movers(&self, o: [f64; 3], d: [f64; 3], max: f64) -> Option<(u32, f64)> {
        let mut best: Option<(u32, f64)> = None;
        for m in &self.movers {
            if let Some(t) = m.ray(o, d, best.map_or(max, |b| b.1)) {
                best = Some((m.id, t));
            }
        }
        best
    }

    pub fn has_column(&self, cx: i32, cz: i32) -> bool {
        self.cols.contains_key(&key(cx, cz))
    }

    pub fn column_count(&self) -> usize {
        self.cols.len()
    }

    /// Insert a generated column (generator output format) and re-apply stored edits.
    pub fn insert_column(&mut self, cx: i32, cz: i32, data: &[u8]) {
        let mask = u16::from_le_bytes([data[0], data[1]]);
        let emit = u16::from_le_bytes([data[2], data[3]]);
        let mut col = Column { sections: Default::default(), emit, damaged: 0 };
        let mut off = HEADER_BYTES;
        for s in 0..16 {
            if mask & (1 << s) != 0 {
                let mut sec: Section = Box::new([0u8; 4096]);
                sec.copy_from_slice(&data[off..off + 4096]);
                off += 4096;
                col.sections[s] = Some(sec);
            }
        }
        let k = key(cx, cz);
        col.damaged = self.damage.get(&k).map_or(0, damaged_sections);
        self.cols.insert(k, col);
        // Edits mirrored while this column was away don't know what they replaced: it's this.
        if let Some(orig) = self.originals.get_mut(&k) {
            let col = &self.cols[&k];
            for (&i, b) in orig.iter_mut() {
                if *b == UNKNOWN {
                    let (x, y, z) = ((i & 15) as usize, (i >> 8) as usize, ((i >> 4) & 15) as usize);
                    *b = col.sections[y >> 4].as_ref().map_or(AIR, |sec| sec[((y & 15) << 8) | (z << 4) | x]);
                }
            }
        }
        if let Some(edits) = self.edits.get(&k) {
            let list: Vec<(u32, u8)> = edits.iter().map(|(&i, &b)| (i, b)).collect();
            for (i, b) in list {
                let (x, y, z) = ((i & 15) as i32, (i >> 8) as i32, ((i >> 4) & 15) as i32);
                self.write(cx * 16 + x, y, cz * 16 + z, b);
            }
        }
    }

    pub fn remove_column(&mut self, cx: i32, cz: i32) {
        self.cols.remove(&key(cx, cz));
    }

    /// Block at world coordinates. Unloaded columns return `unloaded`; outside the world
    /// vertical range returns air.
    #[inline]
    pub fn get_or(&self, x: i32, y: i32, z: i32, unloaded: u8) -> u8 {
        if !(0..256).contains(&y) {
            return if y < 0 { BEDROCK } else { AIR };
        }
        match self.cols.get(&key(x >> 4, z >> 4)) {
            None => unloaded,
            Some(c) => match &c.sections[(y >> 4) as usize] {
                None => AIR,
                Some(s) => s[(((y & 15) << 8) | ((z & 15) << 4) | (x & 15)) as usize],
            },
        }
    }

    #[inline]
    pub fn get(&self, x: i32, y: i32, z: i32) -> u8 {
        self.get_or(x, y, z, AIR)
    }

    /// `get_or`, and whether the cell's section has damaged blocks (then `damage_at` says).
    #[inline]
    fn cell(&self, x: i32, y: i32, z: i32, unloaded: u8) -> (u8, bool) {
        if !(0..256).contains(&y) {
            return (if y < 0 { BEDROCK } else { AIR }, false);
        }
        match self.cols.get(&key(x >> 4, z >> 4)) {
            None => (unloaded, false),
            Some(c) => match &c.sections[(y >> 4) as usize] {
                None => (AIR, false),
                Some(s) => (s[(((y & 15) << 8) | ((z & 15) << 4) | (x & 15)) as usize], c.damaged & (1 << (y >> 4)) != 0),
            },
        }
    }

    /// What's left of a damaged block, if the block at (x, y, z) is one.
    #[inline]
    pub fn damage_at(&self, x: i32, y: i32, z: i32) -> Option<&Damage> {
        let local = (((y & 255) << 8) | ((z & 15) << 4) | (x & 15)) as u32;
        self.damage.get(&key(x >> 4, z >> 4))?.get(&local).map(|d| &**d)
    }

    /// The boxes a cell collides with (none if it isn't solid): the whole cell, a model's own, or
    /// what's left of a damaged block. Unloaded columns hold `unloaded`.
    #[inline]
    pub fn collision_at(&self, x: i32, y: i32, z: i32, unloaded: u8) -> &[[u8; 6]] {
        let (b, hurt) = self.cell(x, y, z, unloaded);
        if SOLID[b as usize] == 0 {
            return &[];
        }
        if hurt {
            if let Some(d) = self.damaged(x, y, z, b) {
                return &d.boxes;
            }
        }
        match self.model_at(x, y, z, b) {
            Some(m) => &m.collide,
            None => &FULL_BOX,
        }
    }

    /// The model block `b` has at (x, y, z): a fence or pane joined to what's beside it there.
    #[inline]
    fn model_at(&self, x: i32, y: i32, z: i32, b: u8) -> Option<&'static crate::shapes::Model> {
        if SHAPE[b as usize] != SHAPE_MODEL {
            return None;
        }
        shapes().model_at(b, || [self.get(x, y, z - 1), self.get(x + 1, y, z), self.get(x, y, z + 1), self.get(x - 1, y, z)])
    }

    /// The boxes you aim at in the block `b` at (x, y, z) (see `target_boxes`), a fence as it's
    /// joined there.
    #[inline]
    pub fn target_at(&self, x: i32, y: i32, z: i32, b: u8) -> &'static [[u8; 6]] {
        match self.model_at(x, y, z, b) {
            Some(m) => &m.bounds,
            None => &FULL_BOX,
        }
    }

    /// `damage_at` for a block that can be damaged (a cube: anything else there is stale).
    #[inline]
    fn damaged(&self, x: i32, y: i32, z: i32, b: u8) -> Option<&Damage> {
        if SHAPE[b as usize] != SHAPE_CUBE {
            return None;
        }
        self.damage_at(x, y, z)
    }

    /// Copy the SOLID flag of every block in a box into `out` (x fastest, then z, then y).
    /// Unloaded columns count as solid, and so does the cell over a fence (it's 1.5 high: nobody
    /// jumps it). One hash lookup per column keeps this fast.
    pub fn solid_box(&self, x0: i32, y0: i32, z0: i32, sx: usize, sy: usize, sz: usize, out: &mut [u8]) {
        let shapes = shapes();
        for dz in 0..sz {
            for dx in 0..sx {
                let x = x0 + dx as i32;
                let z = z0 + dz as i32;
                let col = self.cols.get(&key(x >> 4, z >> 4));
                let mut over_fence = 0;
                for dy in 0..sy {
                    let y = y0 + dy as i32;
                    let b = if y < 0 {
                        BEDROCK
                    } else if y > 255 {
                        AIR
                    } else {
                        match col {
                            None => STONE,
                            Some(c) => match &c.sections[(y >> 4) as usize] {
                                None => AIR,
                                Some(s) => s[(((y & 15) << 8) | ((z & 15) << 4) | (x & 15)) as usize],
                            },
                        }
                    };
                    out[(dy * sz + dz) * sx + dx] = SOLID[b as usize] | over_fence;
                    over_fence = shapes.rises[b as usize];
                }
            }
        }
    }

    /// Raw write without recording an edit. Returns false if the column is not loaded.
    fn write(&mut self, x: i32, y: i32, z: i32, b: u8) -> bool {
        if !(0..256).contains(&y) {
            return false;
        }
        let Some(col) = self.cols.get_mut(&key(x >> 4, z >> 4)) else {
            return false;
        };
        let s = (y >> 4) as usize;
        if col.sections[s].is_none() {
            if b == AIR {
                return true;
            }
            col.sections[s] = Some(Box::new([0u8; 4096]));
        }
        let sec = col.sections[s].as_mut().unwrap();
        sec[(((y & 15) << 8) | ((z & 15) << 4) | (x & 15)) as usize] = b;
        // Keep the emitter mask exact for this section.
        let has_emitter = sec.iter().any(|&v| EMIT[v as usize] > 0);
        if has_emitter {
            col.emit |= 1 << s;
        } else {
            col.emit &= !(1 << s);
        }
        if b == AIR && sec.iter().all(|&v| v == AIR) {
            col.sections[s] = None;
        }
        true
    }

    /// Player edit: writes the block and records it so it survives unloading.
    pub fn set(&mut self, x: i32, y: i32, z: i32, b: u8) -> bool {
        let before = self.get_or(x, y, z, 255);
        if !self.write(x, y, z, b) {
            return false;
        }
        let local = (((y & 255) << 8) | ((z & 15) << 4) | (x & 15)) as u32;
        let k = key(x >> 4, z >> 4);
        self.edits.entry(k).or_default().insert(local, b);
        self.originals.entry(k).or_default().entry(local).or_insert(before);
        // Whatever's there now is whole.
        self.heal(k, local);
        true
    }

    /// An edit made in another copy of the world (the simulation's, in a worker or on a server):
    /// written now if its column is loaded, else kept to apply when it loads. Returns whether
    /// the block changed now.
    pub fn mirror(&mut self, x: i32, y: i32, z: i32, b: u8) -> bool {
        if self.set(x, y, z, b) {
            return true;
        }
        if !(0..256).contains(&y) {
            return false;
        }
        let local = (((y & 255) << 8) | ((z & 15) << 4) | (x & 15)) as u32;
        let k = key(x >> 4, z >> 4);
        self.edits.entry(k).or_default().insert(local, b);
        self.originals.entry(k).or_default().entry(local).or_insert(UNKNOWN);
        self.heal(k, local);
        false
    }

    /// Forget a cell's damage (a block set over it is whole).
    fn heal(&mut self, k: u64, local: u32) {
        let Some(m) = self.damage.get_mut(&k) else { return };
        if m.remove(&local).is_none() {
            return;
        }
        let mask = damaged_sections(m);
        if m.is_empty() {
            self.damage.remove(&k);
        }
        if let Some(c) = self.cols.get_mut(&k) {
            c.damaged = mask;
        }
    }

    /// Undo every edit made this session: loaded columns get their original blocks back, whole,
    /// and the edits and damage are forgotten (unloaded columns regenerate clean). Returns the
    /// loaded columns that changed, as flat [cx, cz, ...] pairs, for remeshing.
    pub fn revert_edits(&mut self) -> Vec<i32> {
        let mut touched = Vec::new();
        // Damaged blocks first (those in columns with edits are counted with the edits).
        for (k, _) in std::mem::take(&mut self.damage) {
            if let Some(c) = self.cols.get_mut(&k) {
                c.damaged = 0;
                if !self.originals.contains_key(&k) {
                    touched.push((k >> 32) as u32 as i32);
                    touched.push(k as u32 as i32);
                }
            }
        }
        let originals = std::mem::take(&mut self.originals);
        for (k, cells) in originals {
            let (cx, cz) = ((k >> 32) as u32 as i32, k as u32 as i32);
            if let Some(e) = self.edits.get_mut(&k) {
                for i in cells.keys() {
                    e.remove(i);
                }
                if e.is_empty() {
                    self.edits.remove(&k);
                }
            }
            if !self.cols.contains_key(&k) {
                continue;
            }
            for (i, b) in cells {
                let (x, y, z) = ((i & 15) as i32, (i >> 8) as i32, ((i >> 4) & 15) as i32);
                self.write(cx * 16 + x, y, cz * 16 + z, b);
            }
            touched.push(cx);
            touched.push(cz);
        }
        touched
    }

    /// 3x3 neighbourhood of columns around (cx, cz) in the mesher's region format.
    pub fn extract_region(&self, cx: i32, cz: i32) -> Vec<u8> {
        let mut size = REGION_HEADER;
        let mut cols: [Option<&Column>; 9] = [None; 9];
        for dz in -1..=1 {
            for dx in -1..=1 {
                let k = ((dz + 1) * 3 + dx + 1) as usize;
                cols[k] = self.cols.get(&key(cx + dx, cz + dz));
                if let Some(c) = cols[k] {
                    size += c.mask().count_ones() as usize * 4096;
                }
            }
        }
        let mut out = Vec::with_capacity(size);
        out.resize(REGION_HEADER, 0);
        for (k, c) in cols.iter().enumerate() {
            if let Some(c) = c {
                out[k * 4..k * 4 + 2].copy_from_slice(&c.mask().to_le_bytes());
                out[k * 4 + 2..k * 4 + 4].copy_from_slice(&c.emit.to_le_bytes());
                for sec in c.sections.iter().flatten() {
                    out.extend_from_slice(&sec[..]);
                }
            }
        }
        self.region_damage(cx, cz, &mut out);
        out
    }

    /// The damaged blocks a region's mesh needs (the centre column's, and its neighbours' along
    /// the border it looks across), appended to the region (see `mesher`): [count u32, then per
    /// block its region index u32 and what's left, 256 u16]. Nothing at all when there are none,
    /// so a region with no damage is exactly what it always was.
    fn region_damage(&self, cx: i32, cz: i32, out: &mut Vec<u8>) {
        if self.damage.is_empty() {
            return;
        }
        let start = out.len();
        let mut n = 0u32;
        for dz in -1..=1 {
            for dx in -1..=1 {
                let Some(m) = self.damage.get(&key(cx + dx, cz + dz)) else { continue };
                for (&local, d) in m {
                    let (x, y, z) = ((local & 15) as usize, (local >> 8) as usize, ((local >> 4) & 15) as usize);
                    let (rx, rz) = (((dx + 1) * 16) as usize + x, ((dz + 1) * 16) as usize + z);
                    if !(15..=32).contains(&rx) || !(15..=32).contains(&rz) {
                        continue;
                    }
                    if n == 0 {
                        out.extend_from_slice(&[0; 4]);
                    }
                    n += 1;
                    out.extend_from_slice(&(((y + 1) * RW * RW + rz * RW + rx) as u32).to_le_bytes());
                    for row in &d.bits {
                        out.extend_from_slice(&row.to_le_bytes());
                    }
                }
            }
        }
        if n > 0 {
            out[start..start + 4].copy_from_slice(&n.to_le_bytes());
        }
    }

    /// Whether `carve` can take bits out of block `b` at height `y`: a solid, opaque cube (not a
    /// model, a plant, glass or a liquid) the game made destructible, above its lowest height.
    fn carvable(rule: &Destructible, y: i32, b: u8) -> bool {
        let r = registry();
        let i = b as usize;
        y > rule.above && rule.ids[i] && r.solid[i] == 1 && r.opaque[i] == 1 && r.shape[i] == SHAPE_CUBE
    }

    /// Take a capsule of little voxels out of the destructible blocks it reaches: from `o` along
    /// `d` for `depth` blocks, `radius` round. A block left with nothing is air (an edit, as `set`
    /// makes). Carving where there's nothing left to take changes nothing.
    pub fn carve(&mut self, o: [f64; 3], d: [f64; 3], radius: f64, depth: f64) -> Carved {
        let mut out = Carved::default();
        let Some(rule) = self.destructible.as_deref().cloned() else { return out };
        let len = (d[0] * d[0] + d[1] * d[1] + d[2] * d[2]).sqrt();
        let finite = o.iter().chain(d.iter()).all(|v| v.is_finite()) && radius.is_finite() && depth.is_finite();
        if !finite || len < 1e-12 || radius <= 0.0 {
            return out;
        }
        let (r, depth) = (radius.min(8.0), depth.clamp(0.0, 32.0));
        let b = [o[0] + d[0] / len * depth, o[1] + d[1] / len * depth, o[2] + d[2] / len * depth];
        let lo = [o[0].min(b[0]) - r, o[1].min(b[1]) - r, o[2].min(b[2]) - r];
        let hi = [o[0].max(b[0]) + r, o[1].max(b[1]) + r, o[2].max(b[2]) + r];
        for y in (lo[1].floor() as i32).max(0)..=(hi[1].floor() as i32).min(255) {
            for z in lo[2].floor() as i32..=hi[2].floor() as i32 {
                for x in lo[0].floor() as i32..=hi[0].floor() as i32 {
                    let id = self.get_or(x, y, z, 255);
                    if id == 255 || !Self::carvable(&rule, y, id) {
                        continue;
                    }
                    let taken = damage::capsule([x, y, z], o, b, r);
                    self.take_bits([x, y, z], id, &taken, &mut out);
                }
            }
        }
        out
    }

    /// Take `taken` from the block `id` at `cell` (a carvable one), noting what changed in `out`:
    /// the bits that went, or the block itself once nothing's left of it (air, as an edit).
    fn take_bits(&mut self, cell: [i32; 3], id: u8, taken: &[u16; 256], out: &mut Carved) {
        if taken.iter().all(|&t| t == 0) {
            return;
        }
        let [x, y, z] = cell;
        let (k, local) = (key(x >> 4, z >> 4), (((y & 255) << 8) | ((z & 15) << 4) | (x & 15)) as u32);
        let m = self.damage.entry(k).or_default();
        let d = m.entry(local).or_insert_with(|| Box::new(Damage::whole()));
        let gone = d.take(taken);
        let (n, left) = (damage::count(&gone), d.left);
        if n == 0 {
            return;
        }
        out.removed += n;
        if left == 0 {
            // Nothing left: air, as an edit (the damage goes with it).
            self.set(x, y, z, AIR);
            out.emptied.push((cell, id));
        } else {
            let mask = damaged_sections(m);
            if let Some(c) = self.cols.get_mut(&k) {
                c.damaged = mask;
            }
            out.cells.push((cell, gone));
        }
    }

    /// Whether `carve` and `blast` can take bits out of the block at (x, y, z): the game made it
    /// destructible, it's above the line, and it's a solid, opaque cube.
    pub fn carvable_at(&self, x: i32, y: i32, z: i32) -> bool {
        let Some(rule) = self.destructible.as_deref() else { return false };
        let id = self.get_or(x, y, z, 255);
        id != 255 && Self::carvable(rule, y, id)
    }

    /// A blast's crater: a ragged sphere of little voxels (`damage::blast`) out of the carvable
    /// blocks among `cells` (flat x, y, z triples; the game's explosion picks them), `radius`
    /// round `center`, its edge wandering in and out by `roughness` of that. A block left with
    /// nothing is air, as `carve` leaves it.
    pub fn blast(&mut self, center: [f64; 3], radius: f64, roughness: f64, seed: u32, cells: &[i32]) -> Carved {
        let mut out = Carved::default();
        let Some(rule) = self.destructible.as_deref().cloned() else { return out };
        if !center.iter().all(|v| v.is_finite()) || !radius.is_finite() || radius <= 0.0 {
            return out;
        }
        let radius = radius.min(12.0);
        for c in cells.chunks_exact(3) {
            let (x, y, z) = (c[0], c[1], c[2]);
            if !(0..256).contains(&y) {
                continue;
            }
            let id = self.get_or(x, y, z, 255);
            if id == 255 || !Self::carvable(&rule, y, id) {
                continue;
            }
            let taken = damage::blast([x, y, z], center, radius, roughness, seed);
            self.take_bits([x, y, z], id, &taken, &mut out);
        }
        out
    }

    /// A ray starting in solid material (at `o`, where it went in): how far along unit-ish `d` it
    /// comes out into the open (a hole, air, a slab's empty half), and the face it comes out of
    /// (pointing out, along the ray), or None if it's still in material after `max`. Measured on
    /// the grid of little voxels (1/16 of a block), so what's been shot out of a block counts.
    /// Unloaded columns count as open.
    pub fn ray_exit(&self, o: [f64; 3], d: [f64; 3], max: f64) -> Option<(f64, [i32; 3])> {
        let len = (d[0] * d[0] + d[1] * d[1] + d[2] * d[2]).sqrt();
        if len < 1e-12 || !o.iter().all(|v| v.is_finite()) {
            return None;
        }
        let d = [d[0] / len, d[1] / len, d[2] / len];
        // A hair in, so a ray starting on a face starts inside the block it faces.
        const IN: f64 = 1e-6;
        let s = [(o[0] + d[0] * IN) * 16.0, (o[1] + d[1] * IN) * 16.0, (o[2] + d[2] * IN) * 16.0];
        let mut m = [s[0].floor() as i64, s[1].floor() as i64, s[2].floor() as i64];
        let step = [d[0].signum() as i64, d[1].signum() as i64, d[2].signum() as i64];
        let mut t_max = [0f64; 3];
        let mut t_delta = [0f64; 3];
        for a in 0..3 {
            if d[a].abs() < 1e-12 {
                t_max[a] = f64::INFINITY;
                t_delta[a] = f64::INFINITY;
            } else {
                // In blocks along the ray (the micro grid is 16 to a block).
                let next = if d[a] > 0.0 { m[a] as f64 + 1.0 - s[a] } else { s[a] - m[a] as f64 };
                t_max[a] = IN + next / 16.0 / d[a].abs();
                t_delta[a] = 1.0 / 16.0 / d[a].abs();
            }
        }
        let mut t = 0.0;
        let mut normal = [0i32; 3];
        for _ in 0..4096 {
            let cell = [m[0].div_euclid(16) as i32, m[1].div_euclid(16) as i32, m[2].div_euclid(16) as i32];
            let (mx, my, mz) = (m[0].rem_euclid(16) as u8, m[1].rem_euclid(16) as u8, m[2].rem_euclid(16) as u8);
            let solid = self.collision_at(cell[0], cell[1], cell[2], AIR).iter().any(|b| mx >= b[0] && mx < b[3] && my >= b[1] && my < b[4] && mz >= b[2] && mz < b[5]);
            if !solid {
                return Some((t, normal));
            }
            let a = if t_max[0] < t_max[1] {
                if t_max[0] < t_max[2] {
                    0
                } else {
                    2
                }
            } else if t_max[1] < t_max[2] {
                1
            } else {
                2
            };
            t = t_max[a];
            if t > max {
                return None;
            }
            t_max[a] += t_delta[a];
            m[a] += step[a];
            normal = [0; 3];
            normal[a] = step[a] as i32;
        }
        None
    }

    /// Damage made in another copy of the world (the simulation's): the changes `damage::encode`
    /// wrote, taken from the blocks here whether or not their columns are loaded. A block left with
    /// nothing becomes air, as `mirror` does. Returns the loaded columns whose mesh changes, as
    /// flat [cx, cz, relight] triples: relight 1 where a block went (the light around it changes,
    /// so the columns around it too), 0 where only the column's own mesh does (and its neighbour's,
    /// for a block on the border between them).
    pub fn apply_damage(&mut self, data: &[u8]) -> Vec<i32> {
        let mut touched: Vec<(i32, i32, i32)> = Vec::new();
        let mut note = |cx: i32, cz: i32, relight: i32| match touched.iter_mut().find(|t| t.0 == cx && t.1 == cz) {
            Some(t) => t.2 = t.2.max(relight),
            None => touched.push((cx, cz, relight)),
        };
        let mut o = 0;
        while let Some((cell, taken)) = damage::decode(data, &mut o) {
            let [x, y, z] = cell;
            if !(0..256).contains(&y) {
                continue;
            }
            let (k, local) = (key(x >> 4, z >> 4), (((y & 255) << 8) | ((z & 15) << 4) | (x & 15)) as u32);
            let m = self.damage.entry(k).or_default();
            let d = m.entry(local).or_insert_with(|| Box::new(Damage::whole()));
            let gone = d.take(&taken);
            let left = d.left;
            if left == 0 {
                if self.mirror(x, y, z, AIR) {
                    note(x >> 4, z >> 4, 1);
                }
                continue;
            }
            if left == damage::CELLS {
                // Nothing taken from a whole block: nothing to keep.
                m.remove(&local);
                if m.is_empty() {
                    self.damage.remove(&k);
                }
                continue;
            }
            let mask = damaged_sections(m);
            let Some(c) = self.cols.get_mut(&k) else { continue };
            c.damaged = mask;
            if damage::count(&gone) == 0 {
                continue;
            }
            note(x >> 4, z >> 4, 0);
            // The next column's mesh draws its faces against this block's side.
            let (lx, lz) = (x & 15, z & 15);
            for (dx, dz) in [(-1, 0), (1, 0), (0, -1), (0, 1)] {
                let border = (dx == -1 && lx == 0) || (dx == 1 && lx == 15) || (dz == -1 && lz == 0) || (dz == 1 && lz == 15);
                if border && self.cols.contains_key(&key((x >> 4) + dx, (z >> 4) + dz)) {
                    note((x >> 4) + dx, (z >> 4) + dz, 0);
                }
            }
        }
        touched.into_iter().flat_map(|(cx, cz, r)| [cx, cz, r]).collect()
    }

    /// All the damage there is, as changes (`apply_damage` reads them): everything missing from
    /// each damaged block. What a player joining late needs.
    pub fn export_damage(&self) -> Vec<u8> {
        let mut out = Vec::new();
        for (&k, m) in &self.damage {
            let (cx, cz) = ((k >> 32) as u32 as i32, k as u32 as i32);
            for (&local, d) in m {
                let cell = [cx * 16 + (local & 15) as i32, (local >> 8) as i32, cz * 16 + ((local >> 4) & 15) as i32];
                let missing: [u16; 256] = std::array::from_fn(|r| !d.bits[r]);
                damage::encode(&mut out, cell, &missing);
            }
        }
        out
    }

    /// How many blocks are damaged.
    pub fn damage_count(&self) -> usize {
        self.damage.values().map(|m| m.len()).sum()
    }

    /// Serialise edits: repeated [cx i32, cz i32, count u32, (local u32, block u8)*].
    pub fn export_edits(&self) -> Vec<u8> {
        let mut out = Vec::new();
        for (&k, m) in &self.edits {
            let cx = (k >> 32) as u32 as i32;
            let cz = k as u32 as i32;
            out.extend_from_slice(&cx.to_le_bytes());
            out.extend_from_slice(&cz.to_le_bytes());
            out.extend_from_slice(&(m.len() as u32).to_le_bytes());
            for (&i, &b) in m {
                out.extend_from_slice(&i.to_le_bytes());
                out.push(b);
            }
        }
        out
    }

    pub fn import_edits(&mut self, data: &[u8]) {
        let mut o = 0;
        let rd = |o: &mut usize| -> u32 {
            let v = u32::from_le_bytes([data[*o], data[*o + 1], data[*o + 2], data[*o + 3]]);
            *o += 4;
            v
        };
        while o + 12 <= data.len() {
            let cx = rd(&mut o) as i32;
            let cz = rd(&mut o) as i32;
            let n = rd(&mut o) as usize;
            let m = self.edits.entry(key(cx, cz)).or_default();
            for _ in 0..n {
                if o + 5 > data.len() {
                    return;
                }
                let i = rd(&mut o);
                let b = data[o];
                o += 1;
                m.insert(i, b);
            }
        }
    }

    pub fn clear_edits(&mut self) {
        self.edits.clear();
        self.originals.clear();
        self.damage.clear();
        for c in self.cols.values_mut() {
            c.damaged = 0;
        }
    }

    pub fn edit_count(&self) -> usize {
        self.edits.values().map(|m| m.len()).sum()
    }

    /// Approximate light at a point for entities / the held item: (sky 0..1, block 0..1).
    /// Sky: attenuated by whatever lies above. Block: strongest emitter within Manhattan reach.
    pub fn light_probe(&self, x: i32, y: i32, z: i32) -> (f32, f32) {
        let mut sky: i32 = 15;
        let mut yy = y + 1;
        while yy < 256 && sky > 0 {
            let b = self.get_or(x, yy, z, AIR);
            sky -= OPACITY[b as usize] as i32;
            yy += 1;
        }
        // Open sky nearby still lights overhangs a little.
        if sky <= 0 {
            for (dx, dz) in [(4, 0), (-4, 0), (0, 4), (0, -4)] {
                let mut open = true;
                for yy in (y + 1)..256.min(y + 48) {
                    if OPAQUE[self.get_or(x + dx, yy, z + dz, AIR) as usize] == 1 {
                        open = false;
                        break;
                    }
                }
                if open {
                    sky = sky.max(9);
                }
            }
        }
        let mut blk: i32 = 0;
        const R: i32 = 9;
        for dy in -R..=R {
            for dz in -R..=R {
                let rem = R - dy.abs() - dz.abs();
                if rem < 0 {
                    continue;
                }
                for dx in -rem..=rem {
                    let e = EMIT[self.get_or(x + dx, y + dy, z + dz, AIR) as usize] as i32;
                    if e > 0 {
                        let d = dx.abs() + dy.abs() + dz.abs();
                        blk = blk.max(e - d);
                    }
                }
            }
        }
        (sky.max(0) as f32 / 15.0, blk.max(0) as f32 / 15.0)
    }

    /// Distance along a ray to the first solid (collidable) block or mover, or None within
    /// `max_dist`. Unloaded columns count as solid.
    pub fn raycast_solid(&self, o: [f64; 3], d: [f64; 3], max_dist: f64) -> Option<f64> {
        let blocks = self.raycast_voxels(o, d, max_dist);
        if self.movers.is_empty() {
            return blocks;
        }
        let len = (d[0] * d[0] + d[1] * d[1] + d[2] * d[2]).sqrt();
        if len < 1e-12 {
            return blocks;
        }
        let moving = self.raycast_movers(o, [d[0] / len, d[1] / len, d[2] / len], blocks.unwrap_or(max_dist)).map(|(_, t)| t);
        moving.or(blocks)
    }

    /// `raycast_solid` for blocks only.
    pub fn raycast_voxels(&self, o: [f64; 3], d: [f64; 3], max_dist: f64) -> Option<f64> {
        let len = (d[0] * d[0] + d[1] * d[1] + d[2] * d[2]).sqrt();
        if len < 1e-12 {
            return None;
        }
        let d = [d[0] / len, d[1] / len, d[2] / len];
        let mut p = [o[0].floor() as i32, o[1].floor() as i32, o[2].floor() as i32];
        let step = [d[0].signum() as i32, d[1].signum() as i32, d[2].signum() as i32];
        let mut t_max = [0f64; 3];
        let mut t_delta = [0f64; 3];
        for a in 0..3 {
            if d[a].abs() < 1e-12 {
                t_max[a] = f64::INFINITY;
                t_delta[a] = f64::INFINITY;
            } else {
                let next = if d[a] > 0.0 { p[a] as f64 + 1.0 - o[a] } else { o[a] - p[a] as f64 };
                t_max[a] = next / d[a].abs();
                t_delta[a] = 1.0 / d[a].abs();
            }
        }
        let mut t = 0.0;
        loop {
            let (b, hurt) = self.cell(p[0], p[1], p[2], STONE);
            if SOLID[b as usize] == 1 {
                let damaged = if hurt { self.damaged(p[0], p[1], p[2], b) } else { None };
                if SHAPE[b as usize] != SHAPE_MODEL && damaged.is_none() {
                    return Some(t);
                }
                // A slab, a bed, a block with holes in it: only its boxes stop the ray (a fence:
                // the post and rails you see, not its taller collision).
                if let Some((tb, _)) = ray_boxes(o, d, p, damaged.map_or_else(|| self.target_at(p[0], p[1], p[2], b), |d| &d.boxes)) {
                    if tb <= max_dist {
                        return Some(tb);
                    }
                }
            }
            let a = if t_max[0] < t_max[1] {
                if t_max[0] < t_max[2] {
                    0
                } else {
                    2
                }
            } else if t_max[1] < t_max[2] {
                1
            } else {
                2
            };
            t = t_max[a];
            if t > max_dist {
                return None;
            }
            t_max[a] += t_delta[a];
            p[a] += step[a];
        }
    }

    /// DDA voxel raycast. Returns (block pos, face normal, block id, distance) of the first
    /// targetable block: a model (torch, slab, bed) or a damaged block only where the ray meets
    /// its boxes.
    pub fn raycast(&self, o: [f64; 3], d: [f64; 3], max_dist: f64) -> Option<([i32; 3], [i32; 3], u8, f64)> {
        let len = (d[0] * d[0] + d[1] * d[1] + d[2] * d[2]).sqrt();
        if len < 1e-9 {
            return None;
        }
        let d = [d[0] / len, d[1] / len, d[2] / len];
        let mut p = [o[0].floor() as i32, o[1].floor() as i32, o[2].floor() as i32];
        let step = [d[0].signum() as i32, d[1].signum() as i32, d[2].signum() as i32];
        let mut t_max = [0f64; 3];
        let mut t_delta = [0f64; 3];
        for a in 0..3 {
            if d[a].abs() < 1e-12 {
                t_max[a] = f64::INFINITY;
                t_delta[a] = f64::INFINITY;
            } else {
                let next = if d[a] > 0.0 { p[a] as f64 + 1.0 - o[a] } else { o[a] - p[a] as f64 };
                t_max[a] = next / d[a].abs();
                t_delta[a] = 1.0 / d[a].abs();
            }
        }
        let mut normal = [0i32; 3];
        let mut t = 0.0;
        while t <= max_dist {
            let (b, hurt) = self.cell(p[0], p[1], p[2], AIR);
            if b != AIR && b != WATER_B && b != LAVA_B {
                let damaged = if hurt { self.damaged(p[0], p[1], p[2], b) } else { None };
                if SHAPE[b as usize] != SHAPE_MODEL && damaged.is_none() {
                    return Some((p, normal, b, t));
                }
                if let Some((tb, n)) = ray_boxes(o, d, p, damaged.map_or_else(|| self.target_at(p[0], p[1], p[2], b), |d| &d.boxes)) {
                    if tb <= max_dist {
                        return Some((p, n, b, tb));
                    }
                }
            }
            let a = if t_max[0] < t_max[1] {
                if t_max[0] < t_max[2] {
                    0
                } else {
                    2
                }
            } else if t_max[1] < t_max[2] {
                1
            } else {
                2
            };
            t = t_max[a];
            t_max[a] += t_delta[a];
            p[a] += step[a];
            normal = [0; 3];
            normal[a] = -step[a];
        }
        None
    }
}

const FULL_BOX: [[u8; 6]; 1] = [[0, 0, 0, 16, 16, 16]];

/// The sections of a column with damaged blocks in them (bit per section).
fn damaged_sections(m: &FxMap<u32, Box<Damage>>) -> u16 {
    m.keys().fold(0, |s, &local| s | 1 << (local >> 12))
}

/// The boxes a block collides with, in 1/16 of a block within its cell (none if it isn't
/// solid): the whole cell, or a model's own (a slab's half, a bed 9/16 high; a fence standing
/// alone, 24/16).
#[inline]
pub fn collision_boxes(b: u8) -> &'static [[u8; 6]] {
    if SOLID[b as usize] == 0 {
        return &[];
    }
    if SHAPE[b as usize] == SHAPE_MODEL {
        if let Some(m) = &shapes().models[b as usize] {
            return &m.collide;
        }
    }
    &FULL_BOX
}

/// The boxes you aim at in a block: the whole cell, or a model's own (a torch's stick).
#[inline]
pub fn target_boxes(b: u8) -> &'static [[u8; 6]] {
    if SHAPE[b as usize] == SHAPE_MODEL {
        if let Some(m) = &shapes().models[b as usize] {
            return &m.bounds;
        }
    }
    &FULL_BOX
}

/// Whether a point is inside a solid block (in its collision boxes: half a slab is air, and so is
/// a hole shot in a block). Unloaded columns count as air here.
pub fn point_solid(world: &World, p: [f64; 3]) -> bool {
    let cell = [p[0].floor() as i32, p[1].floor() as i32, p[2].floor() as i32];
    let inside = |cell: [i32; 3]| {
        world.collision_at(cell[0], cell[1], cell[2], AIR).iter().any(|b| {
            let (lo, hi) = world_box(cell, b);
            (0..3).all(|a| p[a] >= lo[a] && p[a] < hi[a])
        })
    };
    // A fence below reaches up into this cell.
    inside(cell) || (shapes().tall && inside([cell[0], cell[1] - 1, cell[2]]))
}

/// How far down to look for blocks a box might touch: a cell further when some block's collision
/// rises above its own cell (a fence).
#[inline]
fn reach_below() -> i32 {
    shapes().tall as i32
}

/// How many of a mover's blocks would be in the world's solid blocks with it at `pose` (a block
/// counts when its middle is in one; only its outer blocks can be).
pub fn mover_in_blocks(world: &World, m: &Mover, pose: &crate::movers::Pose) -> u32 {
    m.surface_middles(pose).filter(|p| point_solid(world, *p)).count() as u32
}

/// A box of a cell in world coordinates: (min, max).
#[inline]
fn world_box(cell: [i32; 3], b: &[u8; 6]) -> ([f64; 3], [f64; 3]) {
    let k = 1.0 / 16.0;
    (
        [cell[0] as f64 + b[0] as f64 * k, cell[1] as f64 + b[1] as f64 * k, cell[2] as f64 + b[2] as f64 * k],
        [cell[0] as f64 + b[3] as f64 * k, cell[1] as f64 + b[4] as f64 * k, cell[2] as f64 + b[5] as f64 * k],
    )
}

/// The nearest of a cell's boxes that a ray (unit `d`) meets: its distance and the normal of the
/// face it enters (zero if the ray starts inside).
pub fn ray_boxes(o: [f64; 3], d: [f64; 3], cell: [i32; 3], boxes: &[[u8; 6]]) -> Option<(f64, [i32; 3])> {
    let mut best: Option<(f64, [i32; 3])> = None;
    'boxes: for b in boxes {
        let (lo, hi) = world_box(cell, b);
        let (mut t0, mut t1) = (0.0f64, f64::INFINITY);
        let mut n = [0i32; 3];
        for a in 0..3 {
            if d[a].abs() < 1e-12 {
                if o[a] < lo[a] || o[a] > hi[a] {
                    continue 'boxes;
                }
                continue;
            }
            let (ta, tb) = ((lo[a] - o[a]) / d[a], (hi[a] - o[a]) / d[a]);
            let (near, far) = if ta < tb { (ta, tb) } else { (tb, ta) };
            if near > t0 {
                t0 = near;
                n = [0; 3];
                n[a] = if d[a] > 0.0 { -1 } else { 1 };
            }
            t1 = t1.min(far);
        }
        if t0 <= t1 && best.is_none_or(|(bt, _)| t0 < bt) {
            best = Some((t0, n));
        }
    }
    best
}

/// Whether an axis-aligned box (feet at `p`, half width `hw`, height `h`) overlaps solid blocks.
/// Unloaded columns count as solid so bodies never fall into ungenerated terrain; block models
/// (slabs, beds) and damaged blocks only where their boxes are.
pub fn voxel_collides(world: &World, p: [f64; 3], hw: f64, h: f64) -> bool {
    let lo = [p[0] - hw + EPS, p[1] + EPS, p[2] - hw + EPS];
    let hi = [p[0] + hw - EPS, p[1] + h - EPS, p[2] + hw - EPS];
    for y in lo[1].floor() as i32 - reach_below()..=hi[1].floor() as i32 {
        for z in lo[2].floor() as i32..=hi[2].floor() as i32 {
            for x in lo[0].floor() as i32..=hi[0].floor() as i32 {
                for b in world.collision_at(x, y, z, STONE) {
                    let (bl, bh) = world_box([x, y, z], b);
                    if (0..3).all(|a| bl[a] < hi[a] && bh[a] > lo[a]) {
                        return true;
                    }
                }
            }
        }
    }
    false
}

/// Whether a box overlaps solid blocks or a mover; which (0 for blocks, else the mover's id).
pub fn touching(world: &World, p: [f64; 3], hw: f64, h: f64) -> Option<u32> {
    for m in &world.movers {
        if m.near(&m.now, p, h + hw + 1.0) && m.overlaps(&m.now, p, hw, h) {
            return Some(m.id);
        }
    }
    voxel_collides(world, p, hw, h).then_some(0)
}

/// Whether an axis-aligned box overlaps solid blocks or a mover.
pub fn aabb_collides(world: &World, p: [f64; 3], hw: f64, h: f64) -> bool {
    touching(world, p, hw, h).is_some()
}

/// How near two faces may be and still count as touching rather than overlapping.
const TOUCH: f64 = 1e-7;

/// Move a box along one axis through blocks only, stopping flush against the first solid block
/// (or block model box, or what's left of a damaged block) in its way. Boxes it's already inside don't stop it, so it can always get
/// out. Returns true if the move was blocked.
fn voxel_move_axis(world: &World, pos: &mut [f64; 3], axis: usize, delta: f64, hw: f64, h: f64) -> bool {
    if delta == 0.0 {
        return false;
    }
    let min = [pos[0] - hw, pos[1], pos[2] - hw];
    let max = [pos[0] + hw, pos[1] + h, pos[2] + hw];
    let (mut lo, mut hi) = (min, max);
    if delta > 0.0 {
        hi[axis] += delta;
    } else {
        lo[axis] += delta;
    }
    let mut d = delta;
    for y in (lo[1] - TOUCH).floor() as i32 - reach_below()..=(hi[1] + TOUCH).floor() as i32 {
        for z in (lo[2] - TOUCH).floor() as i32..=(hi[2] + TOUCH).floor() as i32 {
            for x in (lo[0] - TOUCH).floor() as i32..=(hi[0] + TOUCH).floor() as i32 {
                for b in world.collision_at(x, y, z, STONE) {
                    let (bl, bh) = world_box([x, y, z], b);
                    if !(0..3).all(|a| a == axis || (bl[a] < max[a] - TOUCH && bh[a] > min[a] + TOUCH)) {
                        continue;
                    }
                    if delta > 0.0 && bl[axis] >= max[axis] - TOUCH {
                        d = d.min(bl[axis] - max[axis]);
                    } else if delta < 0.0 && bh[axis] <= min[axis] + TOUCH {
                        d = d.max(bh[axis] - min[axis]);
                    }
                }
            }
        }
    }
    let blocked = d != delta;
    // Never backwards.
    pos[axis] += if delta > 0.0 { d.max(0.0) } else { d.min(0.0) };
    blocked
}

/// Move a box along one axis, stopping at the first solid block or mover (except `skip`).
/// Returns what stopped it: 0 for blocks, else the mover's id; None if it moved freely.
pub fn move_axis(world: &World, pos: &mut [f64; 3], axis: usize, delta: f64, hw: f64, h: f64, skip: u32) -> Option<u32> {
    if delta == 0.0 {
        return None;
    }
    let mut to = *pos;
    let mut hit = voxel_move_axis(world, &mut to, axis, delta, hw, h).then_some(0);
    let dist = to[axis] - pos[axis];
    if dist != 0.0 && !world.movers.is_empty() {
        let mut d = [0.0; 3];
        d[axis] = dist;
        let mut t: f64 = 1.0;
        let mut who = 0;
        for m in &world.movers {
            if m.id == skip || !m.near(&m.now, *pos, dist.abs() + h + hw + 1.0) {
                continue;
            }
            let tm = m.sweep(*pos, hw, h, d);
            if tm < t {
                t = tm;
                who = m.id;
            }
        }
        if t < 1.0 {
            // Stop just short of it (never backwards).
            let mut moved = dist * t - dist.signum() * EPS * 2.0;
            if moved * dist < 0.0 {
                moved = 0.0;
            }
            to = *pos;
            to[axis] += moved;
            hit = Some(who);
        }
    }
    *pos = to;
    hit
}

/// Move a box along one axis, snapping flush against the first solid block or mover. Returns
/// true if the move was blocked.
pub fn aabb_move_axis(world: &World, pos: &mut [f64; 3], axis: usize, delta: f64, hw: f64, h: f64) -> bool {
    move_axis(world, pos, axis, delta, hw, h, 0).is_some()
}

/// A walking box blocked sideways steps up onto what's in its way if it's low (a slab, a stair,
/// a tilted deck, a lip): up, across, back down. Returns what stopped it, like `move_axis`.
pub fn walk_axis(world: &World, pos: &mut [f64; 3], axis: usize, delta: f64, hw: f64, h: f64, grounded: bool) -> Option<u32> {
    let start = *pos;
    let hit = move_axis(world, pos, axis, delta, hw, h, 0);
    if !grounded || hit.is_none() {
        return hit;
    }
    let mut p = start;
    let mut up = p;
    move_axis(world, &mut up, 1, STEP_UP, hw, h, 0);
    let rise = up[1] - p[1];
    if rise <= EPS {
        return hit;
    }
    p = up;
    let across = move_axis(world, &mut p, axis, delta, hw, h, 0);
    if (p[axis] - start[axis]).abs() <= (pos[axis] - start[axis]).abs() + EPS {
        return hit;
    }
    move_axis(world, &mut p, 1, -rise, hw, h, 0);
    *pos = p;
    across
}

/// Lift a box out of any mover it's resting a little inside (rounding, a carry).
pub fn settle_box(world: &World, pos: &mut [f64; 3], hw: f64, h: f64) {
    if world.movers.is_empty() {
        return;
    }
    for _ in 0..3 {
        let mut best: Option<([f64; 3], f64)> = None;
        for m in &world.movers {
            if !m.near(&m.now, *pos, h + hw + 1.0) {
                continue;
            }
            if let Some((v, d)) = m.shallow(*pos, hw, h) {
                if best.is_none_or(|(_, bd)| d > bd) {
                    best = Some((v, d));
                }
            }
        }
        let Some((v, _)) = best else { return };
        for axis in [1, 0, 2] {
            voxel_move_axis(world, pos, axis, v[axis], hw, h);
        }
    }
}

/// A body's link to the mover it rides: the mover's id (0 for none) and where the body is on it.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Ride {
    pub id: u32,
    /// Feet position in the mover's own space.
    pub local: [f64; 3],
}

/// Carry a body with the mover it rides (to where it now is on it), and out of the way of any
/// that moved into it; walls and other movers stop it on the way.
pub fn carry_box(world: &World, pos: &mut [f64; 3], hw: f64, h: f64, ride: &mut Ride) {
    if ride.id != 0 {
        match world.mover(ride.id) {
            None => ride.id = 0,
            Some(m) => {
                let to = m.now.to_world(ride.local);
                if (0..3).map(|a| (to[a] - pos[a]).powi(2)).sum::<f64>() > JUMP * JUMP {
                    // Moved a long way at once (put somewhere else): they go straight there with it.
                    *pos = to;
                } else {
                    for axis in [1, 0, 2] {
                        move_axis(world, pos, axis, to[axis] - pos[axis], hw, h, m.id);
                    }
                }
                ride.local = m.now.to_local(*pos);
            }
        }
    }
    for m in &world.movers {
        if m.id == ride.id || !m.moved() || m.jumped() || !(m.near(&m.now, *pos, h + hw + 1.0) || m.near(&m.prev, *pos, h + hw + 1.0)) {
            continue;
        }
        if m.overlaps(&m.now, *pos, hw, h) && !m.overlaps(&m.prev, *pos, hw, h) {
            // It ran into them: they go where it would have taken them.
            let to = m.now.to_world(m.prev.to_local(*pos));
            for axis in [1, 0, 2] {
                move_axis(world, pos, axis, to[axis] - pos[axis], hw, h, m.id);
            }
        }
    }
}

/// After a step: what a body stands on decides what it rides. On a mover it rides that one; on
/// blocks, nothing; in the air it keeps riding while it's near (a jump on deck lands on deck),
/// and leaving takes the mover's motion with it. Returns a velocity change.
pub fn update_ride(world: &World, pos: [f64; 3], ground: Option<u32>, free: bool, ride: &mut Ride) -> [f64; 3] {
    let mut kick = [0.0; 3];
    match ground {
        Some(id) => ride.id = id,
        None if ride.id != 0 => match world.mover(ride.id) {
            Some(m) if !free && m.near(&m.now, pos, 4.0) => {}
            Some(m) => {
                if !free {
                    kick = m.velocity_at(pos);
                }
                ride.id = 0;
            }
            None => ride.id = 0,
        },
        None => {}
    }
    if let Some(m) = world.mover(ride.id) {
        ride.local = m.now.to_local(pos);
    } else {
        ride.id = 0;
    }
    kick
}

/// What's under a box resting at `p` (probing `depth` down): 0 for blocks, a mover's id.
pub fn ground_under(world: &World, p: [f64; 3], hw: f64, h: f64, depth: f64) -> Option<u32> {
    let mut probe = p;
    probe[1] -= depth;
    touching(world, probe, hw, h)
}

/// Player physics state (AABB 0.6 x 1.8 x 0.6, feet position).
pub struct Player {
    pub pos: [f64; 3],
    pub vel: [f64; 3],
    pub on_ground: bool,
    pub in_water: bool,
    pub eyes_in_water: bool,
    pub in_lava: bool,
    pub flying: bool,
    pub frozen: bool,
    /// Watching, not playing (a spectator): they fly through anything, and nothing takes them
    /// for a player (see `VoxelWorld::targets`).
    pub ghost: bool,
    pub bob: f64,
    /// The mover they're riding, if any.
    pub ride: Ride,
    /// How they move (the game's `player.movement`).
    pub tune: Tuning,
    /// This step's gravity and steering, as multiples of the tuning's (1, 1): a game's movement
    /// abilities change them for a step (a wall-run's slow slide down, a dash that keeps its speed
    /// with no steering or friction). `player_step` sets them every step.
    pub gravity_scale: f64,
    pub control_scale: f64,
}

pub const HALF_W: f64 = 0.3;
pub const HEIGHT: f64 = 1.8;
pub const EYE: f64 = 1.62;
const EPS: f64 = 1e-4;
/// Further than this in one carry (blocks) and a mover was put somewhere, not moved: whoever rides
/// it goes straight there, and nobody is pushed.
pub const JUMP: f64 = 8.0;
/// How high a walker steps up without jumping: onto a slab or a stair, a mover's deck.
pub const STEP_UP: f64 = 0.6;
/// Climbing a ladder or vine (blocks a second): up, the fastest down, and the fastest sideways
/// off the ground (Minecraft's are about 2.4, 3 and 3).
pub const CLIMB_UP: f64 = 2.6;
pub const CLIMB_DOWN: f64 = 2.4;
pub const CLIMB_SIDE: f64 = 3.0;
/// How far ahead a climber feels for something to push against.
const CLIMB_PROBE: f64 = 0.05;

pub struct MoveInput {
    /// Desired horizontal direction in world space (length <= 1).
    pub wish_x: f64,
    pub wish_z: f64,
    pub jump: bool,
    pub sneak: bool,
    pub sprint: bool,
    /// Sliding: on the ground, speed bleeds away at `Tuning::slide_friction` whatever the wish.
    pub slide: bool,
    /// Multiplies the walking, sprinting and sneaking speeds (a heavy weapon, aiming).
    pub speed: f64,
}

/// How a player moves: speeds (blocks a second), jump, gravity, acceleration, and the extras a
/// game can turn on. The defaults are Minecraft's.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Tuning {
    pub walk: f64,
    pub sprint: f64,
    pub sneak: f64,
    /// Upward speed of a jump.
    pub jump: f64,
    pub gravity: f64,
    /// How quickly speed follows the wish, on the ground and in the air (per second).
    pub ground_accel: f64,
    pub air_accel: f64,
    /// Sneaking on the ground won't walk off edges.
    pub edge_guard: bool,
    /// Running into a ledge in the air climbs onto it if its top is at most this far above the feet (0: off).
    pub mantle: f64,
    /// How quickly a slide slows (per second).
    pub slide_friction: f64,
}

impl Tuning {
    pub const MINECRAFT: Tuning = Tuning {
        walk: 4.317,
        sprint: 5.61,
        sneak: 1.31,
        jump: 9.0,
        gravity: 32.0,
        ground_accel: 14.0,
        air_accel: 3.0,
        edge_guard: true,
        mantle: 0.0,
        slide_friction: 1.4,
    };
}

impl Player {
    pub fn new(x: f64, y: f64, z: f64) -> Self {
        Player {
            pos: [x, y, z],
            vel: [0.0; 3],
            on_ground: false,
            in_water: false,
            eyes_in_water: false,
            in_lava: false,
            flying: false,
            frozen: false,
            ghost: false,
            bob: 0.0,
            ride: Ride::default(),
            tune: Tuning::MINECRAFT,
            gravity_scale: 1.0,
            control_scale: 1.0,
        }
    }

    fn collides(world: &World, p: [f64; 3]) -> bool {
        aabb_collides(world, p, HALF_W, HEIGHT)
    }

    /// Add an instantaneous velocity change (knockback, launch pads...).
    pub fn impulse(&mut self, v: [f64; 3]) {
        for (a, d) in self.vel.iter_mut().zip(v) {
            *a += d;
        }
        if v[1] > 0.0 {
            self.on_ground = false;
        }
    }

    fn liquid_state(&mut self, world: &World) {
        let x = self.pos[0].floor() as i32;
        let z = self.pos[2].floor() as i32;
        let feet = world.get(x, (self.pos[1] + 0.2).floor() as i32, z);
        let waist = world.get(x, (self.pos[1] + 0.9).floor() as i32, z);
        let eye_y = self.pos[1] + EYE;
        let eyes = world.get(x, eye_y.floor() as i32, z);
        self.in_water = feet == WATER_B || waist == WATER_B;
        self.in_lava = feet == LAVA_B || waist == LAVA_B;
        // Water surface sits 0.125 below the block top.
        let above = world.get(x, eye_y.floor() as i32 + 1, z);
        let surface_ok = above == WATER_B || eye_y.fract() < 0.875;
        self.eyes_in_water = eyes == WATER_B && surface_ok;
    }

    /// Carried by the mover they ride, pushed by one that ran into them (see `carry_box`).
    pub fn carry(&mut self, world: &World) {
        carry_box(world, &mut self.pos, HALF_W, HEIGHT, &mut self.ride);
    }

    pub fn step(&mut self, world: &World, input: &MoveInput, dt: f64) {
        if self.ghost && !self.frozen {
            self.ghost_step(input, dt);
            return;
        }
        // Frozen or not, a rider goes where their mover went.
        if self.ride.id != 0 {
            self.carry(world);
        }
        if self.frozen {
            self.vel = [0.0; 3];
            // Frozen on a mover (put there: a helmsman, a cutscene), they ride it all the same.
            if self.ride.id == 0 {
                if let Some(m) = ground_under(world, self.pos, HALF_W, HEIGHT, 0.1).and_then(|id| world.mover(id)) {
                    self.ride = Ride { id: m.id, local: m.now.to_local(self.pos) };
                }
            }
            return;
        }
        let dt = dt.min(0.1);
        let steps = ((dt / (1.0 / 120.0)).ceil() as usize).max(1);
        let h = dt / steps as f64;
        for _ in 0..steps {
            self.substep(world, input, h);
        }
    }

    /// A spectator's flight: creative flight's speeds (sprint for faster, jump up, sneak down),
    /// straight through blocks, never landing.
    fn ghost_step(&mut self, input: &MoveInput, dt: f64) {
        let dt = dt.min(0.1);
        let speed = if input.sprint { 21.0 } else { 10.9 };
        let k = 1.0 - (-10.0 * dt).exp();
        let target = [input.wish_x * speed, if input.jump { 8.0 } else if input.sneak { -8.0 } else { 0.0 }, input.wish_z * speed];
        for a in 0..3 {
            self.vel[a] += (target[a] - self.vel[a]) * k;
            self.pos[a] += self.vel[a] * dt;
        }
        self.flying = true;
        self.on_ground = false;
        self.in_water = false;
        self.eyes_in_water = false;
        self.in_lava = false;
        self.ride = Ride::default();
    }

    fn substep(&mut self, world: &World, input: &MoveInput, dt: f64) {
        settle_box(world, &mut self.pos, HALF_W, HEIGHT);
        self.liquid_state(world);
        let t = self.tune;
        let wish = [input.wish_x, input.wish_z];
        let k_speed = input.speed.max(0.0);
        let (target_speed, accel) = if self.flying {
            (if input.sprint { 21.0 } else { 10.9 }, 10.0)
        } else if self.in_water || self.in_lava {
            (if input.sprint { 3.4 } else { 2.3 }, 6.0)
        } else if input.slide && self.on_ground {
            // A slide: whatever the wish, speed bleeds away.
            (0.0, t.slide_friction)
        } else if input.sneak {
            (t.sneak * k_speed, if self.on_ground { t.ground_accel } else { t.air_accel })
        } else if input.sprint {
            (t.sprint * k_speed, if self.on_ground { t.ground_accel } else { t.air_accel })
        } else {
            (t.walk * k_speed, if self.on_ground { t.ground_accel } else { t.air_accel })
        };

        // Horizontal acceleration toward the wished velocity (exponential approach).
        let k = 1.0 - (-accel * self.control_scale.max(0.0) * dt).exp();
        let sliding = input.slide && self.on_ground;
        let tx = if sliding { 0.0 } else { wish[0] * target_speed };
        let tz = if sliding { 0.0 } else { wish[1] * target_speed };
        if self.flying || self.on_ground || wish[0] != 0.0 || wish[1] != 0.0 || self.in_water {
            self.vel[0] += (tx - self.vel[0]) * k;
            self.vel[2] += (tz - self.vel[2]) * k;
        }

        // Vertical.
        if self.flying {
            let ty = if input.jump { 8.0 } else if input.sneak { -8.0 } else { 0.0 };
            self.vel[1] += (ty - self.vel[1]) * (1.0 - (-10.0 * dt).exp());
        } else if self.in_water || self.in_lava {
            let drag = if self.in_lava { 4.0 } else { 2.2 };
            self.vel[1] -= 9.0 * dt;
            if input.jump {
                self.vel[1] += 24.0 * dt;
            }
            self.vel[1] *= (-drag * dt).exp();
            self.vel[1] = self.vel[1].clamp(-4.0, 4.0);
            let hdrag = (-1.5 * dt).exp();
            self.vel[0] *= hdrag;
            self.vel[2] *= hdrag;
        } else {
            self.vel[1] -= t.gravity * self.gravity_scale * dt;
            self.vel[1] = self.vel[1].max(-60.0);
            if input.jump && self.on_ground {
                self.vel[1] = t.jump;
                self.on_ground = false;
            }
        }

        self.climb(world, input, wish);

        // Sneaking on the ground: don't walk off edges.
        let guard = input.sneak && self.on_ground && !self.flying && t.edge_guard && !input.slide;

        let dy = self.vel[1] * dt;
        let mut ground = None;
        if let Some(by) = move_axis(world, &mut self.pos, 1, dy, HALF_W, HEIGHT, 0) {
            if self.vel[1] < 0.0 {
                self.on_ground = true;
                ground = Some(by);
            }
            self.vel[1] = 0.0;
        } else {
            self.on_ground = false;
            // Resting exactly on a surface: probe slightly below.
            if self.vel[1] <= 0.0 {
                ground = ground_under(world, self.pos, HALF_W, HEIGHT, 0.02);
                self.on_ground = ground.is_some();
            }
        }
        if self.flying && self.on_ground {
            self.flying = false;
        }

        let grounded = self.on_ground && !self.flying;
        for axis in [0usize, 2] {
            let d = self.vel[axis] * dt;
            if guard {
                let mut p = self.pos;
                p[axis] += d;
                p[1] -= 0.6;
                if !Self::collides(world, p) {
                    self.vel[axis] = 0.0;
                    continue;
                }
            }
            if walk_axis(world, &mut self.pos, axis, d, HALF_W, HEIGHT, grounded).is_some() {
                // Climb out of water onto a ledge.
                if self.in_water && input.jump {
                    self.vel[1] = self.vel[1].max(5.0);
                }
                // Mantle: in the air, pushing into a ledge whose top is within reach, climb onto it.
                let push = if axis == 0 { wish[0] } else { wish[1] };
                if t.mantle > 0.0 && !grounded && !self.flying && !self.in_water && push * d.signum() > 0.3 {
                    self.mantle(world, axis, d.signum());
                }
                self.vel[axis] = 0.0;
            }
        }

        let kick = update_ride(world, self.pos, ground, self.flying || self.in_water, &mut self.ride);
        for a in 0..3 {
            self.vel[a] += kick[a];
        }

        let speed = (self.vel[0] * self.vel[0] + self.vel[2] * self.vel[2]).sqrt();
        if self.on_ground && !self.flying {
            self.bob += speed * dt;
        }
    }

    /// On a ladder or a vine (a climbable block where their feet are), Minecraft's way: pushing
    /// into something (the wall behind it, a ladder's rungs) or holding jump climbs, sneaking holds
    /// on, and otherwise they slide down slowly; off the ground, sideways speed is held down so
    /// they don't fly off it. It reads only the blocks and this step's input, so a client
    /// predicting its own player climbs exactly as the host does.
    fn climb(&mut self, world: &World, input: &MoveInput, wish: [f64; 2]) {
        if self.flying || self.in_water || self.in_lava {
            return;
        }
        let feet = world.get(self.pos[0].floor() as i32, self.pos[1].floor() as i32, self.pos[2].floor() as i32);
        if CLIMBABLE[feet as usize] == 0 {
            return;
        }
        let w = (wish[0] * wish[0] + wish[1] * wish[1]).sqrt();
        let pushing = w > 0.1 && {
            let mut p = self.pos;
            p[0] += wish[0] / w * CLIMB_PROBE;
            p[2] += wish[1] / w * CLIMB_PROBE;
            Self::collides(world, p)
        };
        if pushing || input.jump {
            self.vel[1] = CLIMB_UP;
            self.on_ground = false;
        } else if input.sneak {
            self.vel[1] = 0.0;
        } else {
            self.vel[1] = self.vel[1].max(-CLIMB_DOWN);
        }
        if !self.on_ground {
            for a in [0, 2] {
                self.vel[a] = self.vel[a].clamp(-CLIMB_SIDE, CLIMB_SIDE);
            }
        }
    }

    /// Up onto the ledge in front (along `axis`, toward `dir`) if its top is within `tune.mantle`
    /// of the feet and there's room above: enough upward speed to clear it.
    fn mantle(&mut self, world: &World, axis: usize, dir: f64) {
        let t = self.tune;
        let steps = (t.mantle * 16.0).ceil() as usize;
        for i in 1..=steps {
            let h = i as f64 / 16.0;
            let mut up = self.pos;
            up[1] += h;
            if Self::collides(world, up) {
                // A ceiling first: no room to climb.
                return;
            }
            let mut over = up;
            over[axis] += dir * 0.3;
            if !Self::collides(world, over) {
                let need = (2.0 * t.gravity * (h + 0.08)).sqrt();
                if self.vel[1] < need {
                    self.vel[1] = need;
                }
                return;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::gen::Generator;

    #[test]
    fn revert_restores_generated_blocks() {
        let mut w = World::new();
        let mut g = crate::gen::Generator::new(7);
        let data = g.generate(0, 0);
        w.insert_column(0, 0, &data);
        let before: Vec<u8> = (0..256).map(|y| w.get(5, y, 5)).collect();
        for y in 60..90 {
            w.set(5, y, 5, 0);
        }
        w.set(5, 70, 5, 3); // edited twice: the original is the generated block
        assert_ne!(w.edit_count(), 0);
        let touched = w.revert_edits();
        assert_eq!(touched, vec![0, 0]);
        let after: Vec<u8> = (0..256).map(|y| w.get(5, y, 5)).collect();
        assert_eq!(before, after);
        assert_eq!(w.edit_count(), 0);
        // Reloading the column regenerates it without the reverted edits.
        w.remove_column(0, 0);
        w.insert_column(0, 0, &data);
        assert_eq!(before, (0..256).map(|y| w.get(5, y, 5)).collect::<Vec<u8>>());
    }

    #[test]
    fn mirrored_edits_wait_for_their_column() {
        let mut g = Generator::new(7);
        let data = g.generate(0, 0);
        let mut w = World::new();
        assert!(!w.mirror(5, 200, 5, GLOWSTONE_B), "column not loaded yet");
        assert!(!w.mirror(6, 30, 6, AIR));
        w.insert_column(0, 0, &data);
        assert_eq!(w.get(5, 200, 5), GLOWSTONE_B);
        assert_eq!(w.get(6, 30, 6), AIR);
        assert!(w.mirror(7, 200, 7, GLOWSTONE_B), "loaded now");
        // Reverting restores what the generator put there, learned when the column loaded.
        let mut clean = World::new();
        clean.insert_column(0, 0, &data);
        w.revert_edits();
        for (x, y, z) in [(5, 200, 5), (6, 30, 6), (7, 200, 7)] {
            assert_eq!(w.get(x, y, z), clean.get(x, y, z));
        }
        assert_eq!(w.edit_count(), 0);
    }

    #[test]
    fn edits_survive_reload() {
        let mut g = Generator::new(5);
        let mut w = World::new();
        let d = g.generate(0, 0);
        w.insert_column(0, 0, &d);
        assert!(w.set(3, 200, 4, GLOWSTONE_B));
        assert_eq!(w.get(3, 200, 4), GLOWSTONE_B);
        w.remove_column(0, 0);
        assert_eq!(w.get_or(3, 200, 4, 255), 255);
        w.insert_column(0, 0, &d);
        assert_eq!(w.get(3, 200, 4), GLOWSTONE_B);
        let r = w.extract_region(0, 0);
        assert_eq!(u16::from_le_bytes([r[16 + 2], r[16 + 3]]) & (1 << 12), 1 << 12, "emitter bit for section 12");
        let e = w.export_edits();
        let mut w2 = World::new();
        w2.import_edits(&e);
        w2.insert_column(0, 0, &d);
        assert_eq!(w2.get(3, 200, 4), GLOWSTONE_B);
    }

    /// A flat world (3x3 columns round the origin) and the height of its first air block.
    fn flat() -> (World, i32) {
        let mut g = Generator::new(1);
        g.set_flat(64.0);
        let mut w = World::new();
        for cz in -1..=1 {
            for cx in -1..=1 {
                let d = g.generate(cx, cz);
                w.insert_column(cx, cz, &d);
            }
        }
        let top = (0..256).find(|&y| w.get(8, y, 8) == AIR).unwrap();
        (w, top)
    }

    fn walk(w: &World, p: &mut Player, wish_x: f64, secs: f64) {
        let input = MoveInput { wish_x, wish_z: 0.0, jump: false, sneak: false, sprint: false, slide: false, speed: 1.0 };
        for _ in 0..(secs * 60.0) as usize {
            p.step(w, &input, 1.0 / 60.0);
        }
    }

    #[test]
    fn mantles_onto_ledges_within_reach() {
        let (mut w, top) = flat();
        // A block two high and four deep east of the player.
        for y in top..top + 2 {
            for z in 6..11 {
                for x in 11..15 {
                    w.set(x, y, z, STONE);
                }
            }
        }
        let run = |mantle: f64| {
            let mut p = Player::new(8.5, top as f64, 8.5);
            p.tune.mantle = mantle;
            walk(&w, &mut p, 0.0, 0.3);
            let jump = MoveInput { wish_x: 1.0, wish_z: 0.0, jump: true, sneak: false, sprint: false, slide: false, speed: 1.0 };
            for _ in 0..90 {
                p.step(&w, &jump, 1.0 / 60.0);
            }
            walk(&w, &mut p, 1.0, 0.5);
            p
        };
        let stuck = run(0.0);
        assert!(stuck.pos[0] < 11.0 && (stuck.pos[1] - top as f64).abs() < 1e-6, "no mantling: stopped at the wall {:?}", stuck.pos);
        let over = run(1.0);
        assert!((over.pos[1] - (top as f64 + 2.0)).abs() < 1e-6 && over.pos[0] > 11.0, "mantled onto the wall: {:?}", over.pos);
    }

    #[test]
    fn slides_bleed_speed_away() {
        let (w, top) = flat();
        let mut p = Player::new(-10.5, top as f64, 8.5);
        walk(&w, &mut p, 0.0, 0.3);
        p.impulse([10.0, 0.0, 0.0]);
        let slide = MoveInput { wish_x: 1.0, wish_z: 0.0, jump: false, sneak: true, sprint: false, slide: true, speed: 1.0 };
        for _ in 0..30 {
            p.step(&w, &slide, 1.0 / 60.0);
        }
        // Half a second at 1.4/s friction: still well above walking speed, and slowing.
        assert!(p.vel[0] > 4.5 && p.vel[0] < 10.0, "sliding: {:?}", p.vel);
    }

    #[test]
    fn step_scales_gravity_and_control() {
        let (w, top) = flat();
        let idle = MoveInput { wish_x: 0.0, wish_z: 0.0, jump: false, sneak: false, sprint: false, slide: false, speed: 1.0 };
        // In the air with no gravity, a body holds its height; at a tenth, it sinks slowly.
        let fall = |scale: f64| {
            let mut p = Player::new(8.5, top as f64 + 10.0, 8.5);
            p.gravity_scale = scale;
            for _ in 0..30 {
                p.step(&w, &idle, 1.0 / 60.0);
            }
            top as f64 + 10.0 - p.pos[1]
        };
        assert!(fall(0.0).abs() < 1e-9, "floats: {}", fall(0.0));
        assert!(fall(0.1) > 0.0 && fall(0.1) < fall(1.0) * 0.2, "sinks slowly: {} vs {}", fall(0.1), fall(1.0));
        // On the ground with no control, a push keeps its speed (no friction, no steering).
        let mut p = Player::new(-10.5, top as f64, 8.5);
        walk(&w, &mut p, 0.0, 0.3);
        p.impulse([12.0, 0.0, 0.0]);
        p.control_scale = 0.0;
        for _ in 0..10 {
            p.step(&w, &idle, 1.0 / 60.0);
        }
        assert!((p.vel[0] - 12.0).abs() < 1e-9 && p.on_ground, "kept its speed: {:?}", p.vel);
        p.control_scale = 1.0;
        walk(&w, &mut p, 0.0, 0.5);
        assert!(p.vel[0].abs() < 0.1, "stopped with control back: {:?}", p.vel);
    }

    #[test]
    fn walks_up_slabs_and_stairs_but_not_blocks() {
        let (mut w, top) = flat();
        // A bottom slab, then oak stairs climbing east, then a full block past the stairs' top.
        w.set(10, top, 8, slab_id(0, false));
        w.set(12, top, 8, stairs_id(0, 1, false));
        w.set(13, top + 1, 8, STONE);
        let mut p = Player::new(8.5, top as f64, 8.5);
        walk(&w, &mut p, 0.0, 0.5);
        assert!(p.on_ground && (p.pos[1] - top as f64).abs() < 1e-6, "standing on the ground: {:?}", p.pos);
        walk(&w, &mut p, 1.0, 0.6);
        assert!(p.pos[0] > 10.4 && (p.pos[1] - (top as f64 + 0.5)).abs() < 1e-6, "on the slab: {:?}", p.pos);
        walk(&w, &mut p, 1.0, 1.0);
        // Up the stairs' lower step (another half), then the block stops it.
        assert!((p.pos[1] - (top as f64 + 1.0)).abs() < 1e-6, "on the stairs: {:?}", p.pos);
        assert!(p.pos[0] <= 13.0 - HALF_W + 1e-6 && p.pos[0] > 12.5, "stopped by the block past the stairs: {:?}", p.pos);
        // A box sitting on the slab's top doesn't collide; one reaching into it does.
        assert!(!aabb_collides(&w, [10.5, top as f64 + 0.5, 8.5], 0.3, 1.8));
        assert!(aabb_collides(&w, [10.5, top as f64 + 0.4, 8.5], 0.3, 1.8));
    }

    #[test]
    fn rays_hit_model_boxes() {
        let (mut w, top) = flat();
        w.set(8, top, 8, slab_id(0, false));
        w.set(8, top, 9, TORCH_B);
        let y = top as f64;
        // Straight down onto the slab's top face, halfway down its cell.
        let (p, n, b, t) = w.raycast([8.5, y + 3.0, 8.5], [0.0, -1.0, 0.0], 6.0).unwrap();
        assert_eq!((p, n, b), ([8, top, 8], [0, 1, 0], slab_id(0, false)));
        assert!((t - 2.5).abs() < 1e-9);
        // Over the slab's empty upper half and past the torch's stick: nothing.
        assert!(w.raycast([8.5, y + 0.75, 5.0], [0.0, 0.0, 1.0], 3.4).is_none());
        assert!(w.raycast([8.05, y + 0.25, 9.5], [1.0, 0.0, 0.0], 0.2).is_none(), "beside the torch");
        let (p, _, b, _) = w.raycast([8.5, y + 0.25, 7.2], [0.0, 0.0, 1.0], 3.0).unwrap();
        assert_eq!((p, b), ([8, top, 8], slab_id(0, false)), "the slab's side");
        let (p, n, b, _) = w.raycast([8.5, y + 0.5, 11.0], [0.0, 0.0, -1.0], 3.0).unwrap();
        assert_eq!((p, n, b), ([8, top, 9], [0, 0, 1], TORCH_B), "the torch's stick");
        // Solid rays (arrows, line of sight) pass over the slab and through the torch.
        assert!(w.raycast_solid([8.5, y + 0.75, 5.0], [0.0, 0.0, 1.0], 6.0).is_none());
        assert!(w.raycast_solid([8.5, y + 0.25, 5.0], [0.0, 0.0, 1.0], 6.0).is_some());
    }

    // ---- Damage ----

    /// `flat()` with a stone wall three high along z = 12 (x = 6..=10) and everything above the
    /// ground destructible.
    fn wall() -> (World, i32) {
        let (mut w, top) = flat();
        for y in top..top + 3 {
            for x in 6..11 {
                w.set(x, y, 12, STONE);
            }
        }
        w.destructible = Some(Box::new(Destructible { above: top - 1, ids: [true; 256] }));
        (w, top)
    }

    /// Shoot a doorway through the wall at x = 8.5: a stack of fat tunnels, wide and tall enough
    /// for a player. `depth`: how far in from the front (z = 12) they go.
    fn doorway(w: &mut World, top: i32, depth: f64) {
        for dy in [0.35, 0.8, 1.25, 1.7] {
            w.carve([8.5, top as f64 + dy, 11.99], [0.0, 0.0, 1.0], 0.5, depth);
        }
    }

    fn walk_z(w: &World, p: &mut Player, wish_z: f64, secs: f64) {
        let input = MoveInput { wish_x: 0.0, wish_z, jump: false, sneak: false, sprint: false, slide: false, speed: 1.0 };
        for _ in 0..(secs * 60.0) as usize {
            p.step(w, &input, 1.0 / 60.0);
        }
    }

    #[test]
    fn carving_takes_bits_once_and_only_where_it_may() {
        let (mut w, top) = wall();
        w.set(12, top, 11, slab_id(0, false));
        let y = top as f64 + 1.5;
        // A shot into the middle of the wall's front.
        let c = w.carve([8.5, y, 12.0], [0.0, 0.0, 1.0], 0.12, 0.25);
        assert!(c.removed > 20 && c.cells.len() == 1 && c.emptied.is_empty(), "{} bits, {} cells", c.removed, c.cells.len());
        assert_eq!(w.damage_count(), 1);
        let d = w.damage_at(8, top + 1, 12).unwrap().clone();
        assert_eq!(d.left + c.removed, damage::CELLS);
        assert_eq!(damage::count(&c.cells[0].1), c.removed, "the change is what went");
        // The same shot again: nothing left there to take, nothing changes.
        let again = w.carve([8.5, y, 12.0], [0.0, 0.0, 1.0], 0.12, 0.25);
        assert_eq!((again.removed, again.cells.len(), again.emptied.len()), (0, 0, 0));
        assert_eq!(w.damage_at(8, top + 1, 12).unwrap().bits, d.bits);
        // Air, the ground (not above the line), a slab (a model), unloaded columns: nothing.
        assert_eq!(w.carve([8.5, y, 5.0], [0.0, 0.0, 1.0], 0.3, 1.0).removed, 0);
        assert_eq!(w.carve([3.5, top as f64, 3.5], [0.0, -1.0, 0.0], 0.4, 1.0).removed, 0);
        assert_eq!(w.carve([12.5, top as f64 + 0.25, 10.99], [0.0, 0.0, 1.0], 0.3, 0.5).removed, 0);
        assert_eq!(w.carve([100.5, 70.0, 100.5], [0.0, -1.0, 0.0], 2.0, 40.0).removed, 0);
        // A block the rule leaves out, and no rule at all.
        let mut ids = [true; 256];
        ids[STONE as usize] = false;
        w.destructible = Some(Box::new(Destructible { above: top - 1, ids }));
        assert_eq!(w.carve([7.5, y, 12.0], [0.0, 0.0, 1.0], 0.12, 0.25).removed, 0);
        w.destructible = None;
        assert_eq!(w.carve([7.5, y, 12.0], [0.0, 0.0, 1.0], 0.12, 0.25).removed, 0);
        assert_eq!(w.damage_count(), 1);
    }

    #[test]
    fn rays_and_sight_pass_through_holes() {
        let (mut w, top) = wall();
        let y = top as f64 + 1.5;
        // Beside where the hole will be, and through it, before: the wall.
        assert!((w.raycast_solid([8.5, y, 10.0], [0.0, 0.0, 1.0], 5.0).unwrap() - 2.0).abs() < 1e-9);
        // A tunnel right through (the wall is a block thick).
        w.carve([8.5, y, 11.99], [0.0, 0.0, 1.0], 0.2, 1.2);
        assert!(w.raycast_solid([8.5, y, 10.0], [0.0, 0.0, 1.0], 5.0).is_none(), "through the hole");
        assert!(w.raycast([8.5, y, 10.0], [0.0, 0.0, 1.0], 5.0).is_none(), "aiming through the hole");
        assert!(crate::entities::line_clear(&w, [8.5, y, 10.0], [8.5, y, 15.0]));
        // A little to the side: the wall, where it always was.
        let t = w.raycast_solid([8.5 + 0.3, y, 10.0], [0.0, 0.0, 1.0], 5.0).unwrap();
        assert!((t - 2.0).abs() < 1e-9, "{t}");
        assert!(!crate::entities::line_clear(&w, [8.8, y, 10.0], [8.8, y, 15.0]));
        // Into the hole at a slant: stopped by its side, inside the block, facing back out.
        let d = [0.25f64, 0.0, 1.0];
        let (p, n, b, t) = w.raycast([8.5, y, 11.5], d, 5.0).unwrap();
        let hit_z = 11.5 + t / (d[0] * d[0] + d[2] * d[2]).sqrt();
        assert_eq!((p, b), ([8, top + 1, 12], STONE));
        assert!(hit_z > 12.1 && hit_z < 13.0 && n == [-1, 0, 0], "hit at z {hit_z}, normal {n:?}");
    }

    #[test]
    fn players_stop_at_whats_left_and_walk_through_holes() {
        // A recess, not through: they walk into it and stop at what's left of the wall.
        let (mut w, top) = wall();
        doorway(&mut w, top, 0.1);
        let mut p = Player::new(8.5, top as f64, 9.5);
        walk_z(&w, &mut p, 1.0, 2.0);
        let front = p.pos[2] + HALF_W;
        assert!(front > 12.1 && front < 12.6, "stopped inside the recess: front at {front}");
        assert!(!aabb_collides(&w, p.pos, HALF_W, HEIGHT));
        // A small hole doesn't let them through: they stop at the wall's face.
        let (mut w, top) = wall();
        w.carve([8.5, top as f64 + 1.0, 11.99], [0.0, 0.0, 1.0], 0.2, 1.2);
        let mut p = Player::new(8.5, top as f64, 9.5);
        walk_z(&w, &mut p, 1.0, 2.0);
        assert!((p.pos[2] + HALF_W - 12.0).abs() < 1e-3, "stopped at the wall: {:?}", p.pos);
        // A doorway right through: they walk out the other side.
        let (mut w, top) = wall();
        doorway(&mut w, top, 1.2);
        let mut p = Player::new(8.5, top as f64, 9.5);
        walk_z(&w, &mut p, 1.0, 2.0);
        assert!(p.pos[2] > 13.5 && p.on_ground && (p.pos[1] - top as f64).abs() < 1e-6, "walked through: {:?}", p.pos);
        // And back.
        walk_z(&w, &mut p, -1.0, 2.0);
        assert!(p.pos[2] < 11.0, "walked back: {:?}", p.pos);
    }

    #[test]
    fn settling_off_a_mover_in_a_hole_does_not_trap() {
        let (mut w, top) = wall();
        doorway(&mut w, top, 1.2);
        // A deck in the doorway, its top a little above the ground; they're a little inside it.
        let mut deck = Mover::new(9, [3, 1, 3], vec![1; 9], [1.5, 1.0, 1.5], 1.0);
        deck.now = crate::movers::Pose { pos: [8.5, top as f64 + 0.1, 12.5], rot: [0.0, 0.0, 0.0, 1.0], scale: 1.0 };
        deck.prev = deck.now;
        deck.was = deck.now;
        w.movers.push(deck);
        let mut pos = [8.5, top as f64 + 0.06, 12.5];
        settle_box(&w, &mut pos, HALF_W, HEIGHT);
        // (Onto its top, give or take the hair bodies rest inside a mover.)
        assert!((pos[1] - (top as f64 + 0.1)).abs() < 0.02, "lifted onto the deck: {pos:?}");
        assert!(!voxel_collides(&w, pos, HALF_W, HEIGHT), "not into what's left of the wall");
        // Standing on it in the doorway, they can walk off either way.
        for (wish, past) in [(1.0, 13.8), (-1.0, 11.2)] {
            let mut p = Player::new(pos[0], pos[1], pos[2]);
            walk_z(&w, &mut p, wish, 1.5);
            assert!(if wish > 0.0 { p.pos[2] > past } else { p.pos[2] < past }, "walked off the deck ({wish}): {:?}", p.pos);
        }
    }

    #[test]
    fn a_block_carved_to_nothing_is_air_and_reverts_whole() {
        let (mut w, top) = wall();
        let before = w.edit_count();
        let c = w.carve([8.5, top as f64 + 1.5, 11.5], [0.0, 0.0, 1.0], 1.0, 1.0);
        assert_eq!(c.emptied, vec![([8, top + 1, 12], STONE)]);
        assert_eq!(w.get(8, top + 1, 12), AIR);
        assert!(w.damage_at(8, top + 1, 12).is_none());
        assert_eq!(w.edit_count(), before, "the cell was an edit already (the wall)");
        assert!(w.damage_count() >= 4, "its neighbours are chipped: {}", w.damage_count());
        // A restart: the wall's whole again (the generated world, less the wall itself, which was an edit).
        let touched = w.revert_edits();
        assert!(touched.chunks(2).any(|c| c == [0, 0]));
        assert_eq!(w.damage_count(), 0);
        assert_eq!(w.get(8, top + 1, 12), AIR);
        // A block of the world itself, carved away and reverted: back, whole.
        let (mut w, top) = wall();
        w.clear_edits();
        assert_eq!(w.carve([8.5, top as f64 - 0.5, 8.5], [0.0, 1.0, 0.0], 1.0, 0.1).removed, 0, "the ground isn't above the line");
        w.destructible = Some(Box::new(Destructible { above: 0, ids: [true; 256] }));
        let ground = w.get(8, top - 1, 8);
        w.carve([8.5, top as f64 - 0.5, 8.5], [1.0, 0.0, 0.0], 1.0, 0.1);
        assert_eq!(w.get(8, top - 1, 8), AIR);
        assert!(w.damage_count() > 0);
        w.revert_edits();
        assert_eq!(w.get(8, top - 1, 8), ground);
        assert!(w.damage_at(8, top - 1, 8).is_none() && w.damage_count() == 0);
        assert!(aabb_collides(&w, [8.5, top as f64 - 0.9, 8.5], HALF_W, HEIGHT));
    }

    /// Every cell round a point, as an explosion lists what it reaches.
    fn around(c: [f64; 3], r: i32) -> Vec<i32> {
        let mut cells = Vec::new();
        let (x0, y0, z0) = (c[0].floor() as i32, c[1].floor() as i32, c[2].floor() as i32);
        for y in y0 - r..=y0 + r {
            for z in z0 - r..=z0 + r {
                for x in x0 - r..=x0 + r {
                    cells.extend([x, y, z]);
                }
            }
        }
        cells
    }

    #[test]
    fn blasts_leave_a_ragged_crater_and_the_ground_whole() {
        let (mut w, top) = wall();
        let ground = w.get(8, top - 1, 12);
        // A grenade at rest against the wall's face, a block and a half up.
        let at = [8.5, top as f64 + 1.5, 11.9];
        let c = w.blast(at, 2.0, 0.3, 7, &around(at, 4));
        // The block it touched is gone altogether; the wall round it is bitten into, raggedly.
        assert_eq!(w.get(8, top + 1, 12), AIR);
        assert!(c.emptied.iter().any(|(p, b)| *p == [8, top + 1, 12] && *b == STONE));
        let bitten: Vec<u32> = (6..11).flat_map(|x| (top..top + 3).map(move |y| (x, y))).filter_map(|(x, y)| w.damage_at(x, y, 12).map(|d| d.left)).collect();
        assert!(bitten.len() >= 4 && bitten.iter().all(|&l| l > 0 && l < damage::CELLS), "{bitten:?}");
        assert!(bitten.iter().any(|&l| l < 2048) && bitten.iter().any(|&l| l > 2048), "some deep, some shallow: {bitten:?}");
        // The ground (not above the line) is whole, though the blast reached it.
        assert_eq!(w.get(8, top - 1, 12), ground);
        assert!(w.damage_at(8, top - 1, 12).is_none() && w.damage_at(8, top - 1, 11).is_none());
        // Its edge is ragged: along the wall's face, the crater's edge isn't where a smooth
        // sphere's would be.
        let (mut smooth, _) = wall();
        smooth.blast(at, 2.0, 0.0, 7, &around(at, 4));
        let differ = (6..11).flat_map(|x| (top..top + 3).map(move |y| (x, y))).any(|(x, y)| w.damage_at(x, y, 12).map(|d| d.bits) != smooth.damage_at(x, y, 12).map(|d| d.bits));
        assert!(differ, "roughness shows");
        // The same blast on another copy: the same crater (the host's and every client's agree).
        let (mut again, _) = wall();
        let c2 = again.blast(at, 2.0, 0.3, 7, &around(at, 4));
        assert_eq!((c2.removed, c2.emptied.len(), c2.cells.len()), (c.removed, c.emptied.len(), c.cells.len()));
        assert!((6..11).all(|x| (top..top + 3).all(|y| w.damage_at(x, y, 12).map(|d| d.bits) == again.damage_at(x, y, 12).map(|d| d.bits))));
        // And a copy that takes the changes over the wire gets it too.
        let (mut copy, _) = wall();
        copy.destructible = None;
        let mut changes = Vec::new();
        for (cell, gone) in &c.cells {
            damage::encode(&mut changes, *cell, gone);
        }
        for (p, _) in &c.emptied {
            copy.mirror(p[0], p[1], p[2], AIR);
        }
        copy.apply_damage(&changes);
        assert!((6..11).all(|x| (top..top + 3).all(|y| w.damage_at(x, y, 12).map(|d| d.bits) == copy.damage_at(x, y, 12).map(|d| d.bits) && w.get(x, y, 12) == copy.get(x, y, 12))));
        // Only the cells it's given, and nothing without a rule.
        let (mut w2, _) = wall();
        assert_eq!(w2.blast(at, 0.5, 0.3, 7, &[6, top, 12]).cells.len(), 0, "out of reach");
        w2.destructible = None;
        assert_eq!(w2.blast(at, 2.0, 0.3, 7, &around(at, 4)).removed, 0);
        assert!(!w2.carvable_at(8, top + 1, 12));
        assert!(w.carvable_at(9, top + 1, 12) && !w.carvable_at(8, top - 1, 12));
    }

    #[test]
    fn rays_come_out_of_walls_where_the_material_ends() {
        let (mut w, top) = wall();
        let y = top as f64 + 1.5;
        // Straight through a block-thick wall: out of its far face, a block on.
        let (t, n) = w.ray_exit([8.5, y, 12.0], [0.0, 0.0, 1.0], 3.0).unwrap();
        assert!((t - 1.0).abs() < 1e-6 && n == [0, 0, 1], "{t} {n:?}");
        // At a slant, further.
        let d = [0.5f64, 0.0, 1.0];
        let (t, n) = w.ray_exit([8.2, y, 12.0], d, 3.0).unwrap();
        assert!((t - (1.25f64).sqrt()).abs() < 1e-6 && n == [0, 0, 1], "{t} {n:?}");
        // Along the wall, five blocks of it: still in material three blocks on.
        assert!(w.ray_exit([6.0, y, 12.5], [1.0, 0.0, 0.0], 3.0).is_none());
        let (t, n) = w.ray_exit([6.0, y, 12.5], [1.0, 0.0, 0.0], 6.0).unwrap();
        assert!((t - 5.0).abs() < 1e-6 && n == [1, 0, 0]);
        // Shot into from behind (a pit in its back face): less of it to go through.
        w.carve([8.5, y, 13.01], [0.0, 0.0, -1.0], 0.2, 0.5);
        let (t, _) = w.ray_exit([8.5, y, 12.0], [0.0, 0.0, 1.0], 3.0).unwrap();
        assert!(t > 0.25 && t < 0.4, "out into the pit: {t}");
        // Down into the ground: the whole ground is material (the world's own blocks).
        assert!(w.ray_exit([8.5, top as f64, 8.5], [0.0, -1.0, 0.0], 3.0).is_none());
    }

    #[test]
    fn damage_replicates_exactly_and_idempotently() {
        let (mut host, top) = wall();
        let (mut copy, _) = wall();
        copy.destructible = None;
        let mut changes = Vec::new();
        for (i, dy) in [0.3, 0.9, 1.4, 2.2, 2.6].iter().enumerate() {
            let c = host.carve([6.5 + i as f64, top as f64 + dy, 11.99], [0.1, -0.2, 1.0], 0.15, 0.4);
            for (cell, gone) in &c.cells {
                damage::encode(&mut changes, *cell, gone);
            }
        }
        let touched = copy.apply_damage(&changes);
        assert!(touched.len() >= 3 && touched.chunks(3).all(|t| t[2] == 0), "{touched:?}");
        let same = |a: &World, b: &World| {
            (6..11).all(|x| (top..top + 3).all(|y| a.damage_at(x, y, 12).map(|d| d.bits) == b.damage_at(x, y, 12).map(|d| d.bits)))
        };
        assert_eq!(copy.damage_count(), host.damage_count());
        assert!(same(&host, &copy));
        // The same changes again change nothing.
        assert!(copy.apply_damage(&changes).is_empty());
        assert!(same(&host, &copy));
        // Late: everything at once, into a world that has none, even before its column loads.
        let (mut late, _) = wall();
        late.remove_column(0, 0);
        assert!(late.apply_damage(&host.export_damage()).is_empty(), "nothing loaded to remesh");
        let mut g = Generator::new(1);
        g.set_flat(64.0);
        late.insert_column(0, 0, &g.generate(0, 0));
        assert!(same(&host, &late));
        let hole = [8.5, top as f64 + 1.4, 12.2];
        assert_eq!(point_solid(&host, hole), point_solid(&late, hole));
        // A block set over a damaged one is whole.
        late.set(8, top + 1, 12, STONE);
        assert!(late.damage_at(8, top + 1, 12).is_none());
    }

    #[test]
    fn player_lands_on_ground() {
        let mut g = Generator::new(5);
        let mut w = World::new();
        for cz in -1..=1 {
            for cx in -1..=1 {
                let d = g.generate(cx, cz);
                w.insert_column(cx, cz, &d);
            }
        }
        let mut p = Player::new(8.5, 200.0, 8.5);
        let input = MoveInput { wish_x: 0.0, wish_z: 0.0, jump: false, sneak: false, sprint: false, slide: false, speed: 1.0 };
        for _ in 0..600 {
            p.step(&w, &input, 1.0 / 60.0);
        }
        assert!(p.on_ground || p.in_water, "player should settle");
        let below = w.get(8, (p.pos[1] - 0.5).floor() as i32, 8);
        assert!(SOLID[below as usize] == 1 || p.in_water, "standing on solid, got {below}");
        let hit = w.raycast([8.5, p.pos[1] + EYE, 8.5], [0.0, -1.0, 0.0], 8.0);
        assert!(hit.is_some());
    }
}
