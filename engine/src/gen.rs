//! Deterministic, stateless terrain generation for one 16x16x256 chunk column.
//!
//! Every chunk can be generated independently from `(seed, cx, cz)`. Features that cross chunk
//! borders (trees) are placed from a margin around the chunk so both sides agree exactly.
//!
//! Output layout (`Generator::generate`):
//! ```text
//! [0..2)      u16 LE  section mask (bit s = section s has any non-air block)
//! [2..4)      u16 LE  emitter mask (bit s = section s contains a light-emitting block)
//! [4..772)    u8      grass tint RGB (sRGB), 16x16, index (z * 16 + x) * 3
//! [772..1028) u8      height map: highest non-air y per column, index z * 16 + x
//! [1028..)    u8      4096 bytes per set section in ascending order, index (y * 16 + z) * 16 + x
//! ```

use crate::blocks::*;
use crate::noise::*;

pub const SEA: i32 = 62;
pub const HEADER_BYTES: usize = 1028;
const W: usize = 16;
const H: usize = 256;

/// Margin (blocks) of columns evaluated around the chunk for cross-border features.
const M: i32 = 5;
/// Width of the evaluated column area.
const A: usize = W + 2 * M as usize;
/// Margin covered by the 3D density grid (tree bases need exact surface heights).
const DM: i32 = 4;
/// Coarse density grid: points every 4 blocks in x/z over [-DM, 16+DM], every 8 blocks in y.
const DG: usize = ((W as i32 + 2 * DM) / 4 + 1) as usize;
const DGY: usize = H / 8 + 1;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Biome {
    Ocean,
    DeepOcean,
    FrozenOcean,
    Beach,
    SnowyBeach,
    River,
    FrozenRiver,
    Plains,
    Forest,
    BirchForest,
    Taiga,
    SnowyTaiga,
    SnowyPlains,
    Desert,
    Savanna,
    Mountains,
    SnowyPeaks,
}

impl Biome {
    fn frozen(self) -> bool {
        matches!(self, Biome::FrozenOcean | Biome::FrozenRiver | Biome::SnowyBeach | Biome::SnowyPlains | Biome::SnowyTaiga | Biome::SnowyPeaks)
    }
    fn watery(self) -> bool {
        matches!(self, Biome::Ocean | Biome::DeepOcean | Biome::FrozenOcean | Biome::River | Biome::FrozenRiver)
    }
}

#[derive(Clone, Copy, Debug)]
pub struct Column {
    /// Base (2D) terrain height.
    pub h: f32,
    /// Amplitude of the 3D density noise (overhangs, cliffs).
    pub amp: f32,
    pub temp: f32,
    pub humid: f32,
    pub cont: f32,
    pub mfac: f32,
    pub biome: Biome,
}

/// A game-supplied voxel structure stamped into the world during generation.
/// `data` is indexed `(y * size_z + z) * size_x + x`; 255 means "leave the terrain untouched".
#[derive(Clone)]
pub struct Blueprint {
    pub origin: [i32; 3],
    pub size: [i32; 3],
    pub data: Vec<u8>,
}

pub const BLUEPRINT_KEEP: u8 = 255;

/// Flattens terrain to `height` inside `radius`, blending back to natural terrain over `blend`.
#[derive(Clone, Copy)]
pub struct Terraform {
    pub cx: f32,
    pub cz: f32,
    pub radius: f32,
    pub blend: f32,
    pub height: f32,
}

/// A void world's plain ground (`Generator::set_void_ground`).
#[derive(Clone, Copy)]
struct Ground {
    y: i32,
    top: u8,
    fill: u8,
    depth: u8,
}

pub struct Generator {
    seed: u32,
    blueprints: Vec<Blueprint>,
    terraforms: Vec<Terraform>,
    flat: Option<f32>,
    /// No terrain at all: only game structures (sky islands over the void).
    void_world: bool,
    /// A void world's own plain ground under its structures (an arena's), if it has one.
    ground: Option<Ground>,
    n_cont: Noise,
    n_ero: Noise,
    n_pv: Noise,
    n_detail: Noise,
    n_river: Noise,
    n_temp: Noise,
    n_humid: Noise,
    n_warp: Noise,
    n_dens: Noise,
    n_cave_a: Noise,
    n_cave_b: Noise,
    n_cheese: Noise,
    n_entrance: Noise,
    n_patch: Noise,
    n_flower: Noise,
    cols: Vec<Column>,
    tops: Vec<i32>,
    dgrid: Vec<f32>,
    blocks: Vec<u8>,
}

const CONT_SPLINE: [(f32, f32); 11] = [
    (-1.0, 26.0),
    (-0.6, 32.0),
    (-0.4, 41.0),
    (-0.22, 51.0),
    (-0.12, 58.0),
    (-0.05, 62.0),
    (0.02, 64.5),
    (0.15, 67.0),
    (0.4, 73.0),
    (0.7, 84.0),
    (1.0, 96.0),
];

#[inline(always)]
fn bidx(x: usize, y: usize, z: usize) -> usize {
    (y * W + z) * W + x
}

impl Generator {
    pub fn new(seed: u32) -> Self {
        let s = |k: u32| hash32(seed.wrapping_mul(0x9e37_79b9) ^ hash32(k));
        Generator {
            seed,
            blueprints: Vec::new(),
            terraforms: Vec::new(),
            flat: None,
            void_world: false,
            ground: None,
            n_cont: Noise::new(s(1)),
            n_ero: Noise::new(s(2)),
            n_pv: Noise::new(s(3)),
            n_detail: Noise::new(s(4)),
            n_river: Noise::new(s(5)),
            n_temp: Noise::new(s(6)),
            n_humid: Noise::new(s(7)),
            n_warp: Noise::new(s(8)),
            n_dens: Noise::new(s(9)),
            n_cave_a: Noise::new(s(10)),
            n_cave_b: Noise::new(s(11)),
            n_cheese: Noise::new(s(12)),
            n_entrance: Noise::new(s(13)),
            n_patch: Noise::new(s(14)),
            n_flower: Noise::new(s(15)),
            cols: vec![
                Column { h: 0.0, amp: 0.0, temp: 0.0, humid: 0.0, cont: 0.0, mfac: 0.0, biome: Biome::Plains };
                A * A
            ],
            tops: vec![0; A * A],
            dgrid: vec![0.0; DG * DG * DGY],
            blocks: vec![0; W * W * H],
        }
    }

    pub fn add_blueprint(&mut self, bp: Blueprint) {
        assert_eq!(bp.data.len(), (bp.size[0] * bp.size[1] * bp.size[2]) as usize, "blueprint data size");
        self.blueprints.push(bp);
    }

    pub fn add_terraform(&mut self, t: Terraform) {
        self.terraforms.push(t);
    }

    /// Replace the natural height model with a flat world at `height`.
    pub fn set_flat(&mut self, height: f32) {
        self.flat = Some(height);
    }

    /// No terrain, water or plants: only game structures, over the void.
    pub fn set_void(&mut self) {
        self.void_world = true;
    }

    /// A void world's ground: a plain slab, `top` at `y` over `depth - 1` of `fill`, everywhere
    /// under the structures, raised or lowered by the terraforms (hills, a sunken yard). No noise,
    /// caves, water or plants: an arena's surroundings for next to nothing.
    pub fn set_void_ground(&mut self, y: i32, top: u8, fill: u8, depth: u8) {
        self.ground = Some(Ground { y, top, fill, depth: depth.max(1) });
    }

    /// Lay the void ground in the chunk at (x0, z0).
    fn lay_ground(&mut self, x0: i32, z0: i32, g: Ground) {
        for lz in 0..W {
            for lx in 0..W {
                let (tw, th) = self.terraform_at((x0 + lx as i32) as f32, (z0 + lz as i32) as f32);
                // The slab's top is y (+0.5, the middle of its block, as a terraform's height is given).
                let h = lerp(g.y as f32 + 0.5, th, tw);
                let top = h.floor() as i32;
                let bottom = (top - g.depth as i32 + 1).max(0);
                for y in bottom..=top.min(H as i32 - 1) {
                    self.blocks[bidx(lx, y as usize, lz)] = if y == top { g.top } else { g.fill };
                }
            }
        }
    }

    /// Weight (0..1) of terraforming at a column and the target height.
    fn terraform_at(&self, x: f32, z: f32) -> (f32, f32) {
        let mut best = (0.0f32, 0.0f32);
        for t in &self.terraforms {
            let d = ((x - t.cx).powi(2) + (z - t.cz).powi(2)).sqrt();
            let w = smoothstep(t.radius + t.blend, t.radius, d);
            if w > best.0 {
                best = (w, t.height);
            }
        }
        best
    }

    fn in_blueprint(&self, x: i32, z: i32) -> bool {
        self.blueprints.iter().any(|bp| x >= bp.origin[0] && x < bp.origin[0] + bp.size[0] && z >= bp.origin[2] && z < bp.origin[2] + bp.size[2])
    }

    /// Stamp every blueprint that overlaps this chunk.
    fn stamp_blueprints(&mut self, x0: i32, z0: i32) {
        for bp in &self.blueprints {
            let (bx0, by0, bz0) = (bp.origin[0], bp.origin[1], bp.origin[2]);
            let (sx, sy, sz) = (bp.size[0], bp.size[1], bp.size[2]);
            let lx0 = (bx0 - x0).max(0);
            let lx1 = (bx0 + sx - x0).min(W as i32);
            let lz0 = (bz0 - z0).max(0);
            let lz1 = (bz0 + sz - z0).min(W as i32);
            if lx0 >= lx1 || lz0 >= lz1 {
                continue;
            }
            for by in 0..sy {
                let y = by0 + by;
                if !(0..H as i32).contains(&y) {
                    continue;
                }
                for lz in lz0..lz1 {
                    let bz = z0 + lz - bz0;
                    for lx in lx0..lx1 {
                        let bx = x0 + lx - bx0;
                        let v = bp.data[((by * sz + bz) * sx + bx) as usize];
                        if v != BLUEPRINT_KEEP {
                            self.blocks[bidx(lx as usize, y as usize, lz as usize)] = v;
                        }
                    }
                }
            }
        }
    }

    /// Columns reserved for game structures: no caves, trees or plants.
    fn protected(&self, x: i32, z: i32, margin: i32) -> bool {
        for bp in &self.blueprints {
            if x >= bp.origin[0] - margin && x < bp.origin[0] + bp.size[0] + margin && z >= bp.origin[2] - margin && z < bp.origin[2] + bp.size[2] + margin {
                return true;
            }
        }
        for t in &self.terraforms {
            let d = ((x as f32 - t.cx).powi(2) + (z as f32 - t.cz).powi(2)).sqrt();
            if d < t.radius + t.blend * 0.4 + margin as f32 {
                return true;
            }
        }
        false
    }

    /// Evaluate the 2D climate / height model for one world column.
    pub fn column(&self, x: i32, z: i32) -> Column {
        let fx = x as f32;
        let fz = z as f32;
        let wx = fx + self.n_warp.fbm2(fx / 420.0, fz / 420.0, 2) * 70.0;
        let wz = fz + self.n_warp.fbm2(fx / 420.0 + 71.3, fz / 420.0 - 33.7, 2) * 70.0;

        let cont = (self.n_cont.fbm2(wx / 1700.0, wz / 1700.0, 5) * 1.9 + 0.12).clamp(-1.0, 1.0);
        let ero = (self.n_ero.fbm2(fx / 1150.0, fz / 1150.0, 4) * 1.9).clamp(-1.0, 1.0);
        let temp0 = (self.n_temp.fbm2(fx / 1400.0, fz / 1400.0, 3) * 1.8 + 0.12).clamp(-1.0, 1.0);
        let humid = (self.n_humid.fbm2(fx / 1100.0, fz / 1100.0, 3) * 1.9).clamp(-1.0, 1.0);
        let river = (self.n_river.fbm2(wx / 800.0, wz / 800.0, 3) * 1.9).abs();

        let pv = self.n_pv.fbm2(fx / 460.0, fz / 460.0, 5) * 1.7;
        let ridge = clamp01(1.0 - pv.abs());
        let detail = self.n_detail.fbm2(fx / 120.0, fz / 120.0, 4) * 1.6;

        let land = smoothstep(-0.08, 0.06, cont);
        let base = spline(&CONT_SPLINE, cont);
        let mfac = smoothstep(-0.28, -0.7, ero) * smoothstep(-0.02, 0.22, cont);
        let hilly = smoothstep(0.5, -0.35, ero);
        let mountain = mfac * (14.0 + 108.0 * ridge.powf(1.8));
        let hills = detail * (2.0 + 10.0 * hilly) * (0.35 + 0.65 * land);
        let mut h = base + mountain + hills;

        // Rivers carve valleys through land that is not high mountains.
        let riverw = land * (1.0 - smoothstep(0.2, 0.55, mfac));
        let valley = smoothstep(0.11, 0.018, river);
        let mut river_core = 0.0;
        if riverw > 0.0 && valley > 0.0 {
            river_core = smoothstep(0.035, 0.0, river);
            let target = SEA as f32 - 2.0 - 3.5 * river_core;
            if h > target {
                h = lerp(h, target, valley * riverw);
            }
        }

        if let Some(fh) = self.flat {
            h = fh;
        }
        let (tw, th) = self.terraform_at(fx, fz);
        if tw > 0.0 {
            h = lerp(h, th, tw);
        }
        let mut amp = 1.2 + 34.0 * mfac.powf(1.15) + 3.0 * hilly * land;
        if self.flat.is_some() {
            amp = 0.0;
        } else if tw > 0.0 {
            amp = lerp(amp, 0.3, tw);
        }
        let temp = temp0 - (h - 92.0).max(0.0) / 95.0;

        let biome = if h < SEA as f32 - 0.5 {
            if river_core * riverw > 0.25 || (valley * riverw > 0.6 && cont > -0.05) {
                if temp < -0.5 {
                    Biome::FrozenRiver
                } else {
                    Biome::River
                }
            } else if temp < -0.62 {
                Biome::FrozenOcean
            } else if h < 44.0 {
                Biome::DeepOcean
            } else {
                Biome::Ocean
            }
        } else if h < SEA as f32 + 2.5 && cont < 0.08 && mfac < 0.25 {
            if temp < -0.5 {
                Biome::SnowyBeach
            } else {
                Biome::Beach
            }
        } else if mfac > 0.4 && h > 108.0 {
            if h > 150.0 {
                Biome::SnowyPeaks
            } else {
                Biome::Mountains
            }
        } else if temp < -0.5 {
            if humid > -0.1 {
                Biome::SnowyTaiga
            } else {
                Biome::SnowyPlains
            }
        } else if temp < -0.15 {
            Biome::Taiga
        } else if temp < 0.42 {
            if humid < -0.3 {
                Biome::Plains
            } else if humid < 0.12 {
                Biome::Forest
            } else if humid < 0.42 {
                Biome::BirchForest
            } else {
                Biome::Forest
            }
        } else if humid < -0.05 {
            Biome::Desert
        } else if humid < 0.35 {
            Biome::Savanna
        } else {
            Biome::Forest
        };

        Column { h, amp, temp, humid, cont, mfac, biome }
    }

    /// Grass colour (sRGB) for a column.
    fn grass_color(c: &Column) -> [u8; 3] {
        let t = clamp01((c.temp + 1.0) * 0.5);
        let hmd = clamp01((c.humid + 1.0) * 0.5);
        let cold = [0.44f32, 0.62, 0.52];
        let temperate_dry = [0.53f32, 0.7, 0.32];
        let temperate_wet = [0.36f32, 0.63, 0.24];
        let hot_dry = [0.72f32, 0.68, 0.34];
        let hot_wet = [0.3f32, 0.66, 0.17];
        let mut out = [0u8; 3];
        for i in 0..3 {
            let temperate = lerp(temperate_dry[i], temperate_wet[i], hmd);
            let hot = lerp(hot_dry[i], hot_wet[i], hmd * hmd);
            let v = if t < 0.5 { lerp(cold[i], temperate, smoothstep(0.1, 0.5, t)) } else { lerp(temperate, hot, smoothstep(0.55, 0.95, t)) };
            out[i] = (v.clamp(0.0, 1.0) * 255.0 + 0.5) as u8;
        }
        out
    }

    #[inline(always)]
    fn col_at(&self, ax: i32, az: i32) -> &Column {
        &self.cols[(az as usize) * A + ax as usize]
    }

    /// Density at area column (ax, az) (area coords, margin M) and height y.
    #[inline]
    fn density(&self, ax: i32, az: i32, y: i32) -> f32 {
        let c = self.col_at(ax, az);
        let d = c.h - y as f32;
        if d.abs() > c.amp + 0.01 {
            return d;
        }
        // Grid coords relative to the density grid origin (-DM).
        let gx = ax - (M - DM);
        let gz = az - (M - DM);
        let (ix, fx) = ((gx >> 2) as usize, (gx & 3) as f32 * 0.25);
        let (iz, fz) = ((gz >> 2) as usize, (gz & 3) as f32 * 0.25);
        let (iy, fy) = ((y >> 3) as usize, (y & 7) as f32 * 0.125);
        let g = |x: usize, y: usize, z: usize| self.dgrid[(y * DG + z) * DG + x];
        let c00 = lerp(g(ix, iy, iz), g(ix + 1, iy, iz), fx);
        let c10 = lerp(g(ix, iy, iz + 1), g(ix + 1, iy, iz + 1), fx);
        let c01 = lerp(g(ix, iy + 1, iz), g(ix + 1, iy + 1, iz), fx);
        let c11 = lerp(g(ix, iy + 1, iz + 1), g(ix + 1, iy + 1, iz + 1), fx);
        let n = lerp(lerp(c00, c10, fz), lerp(c01, c11, fz), fy);
        d + n * c.amp
    }

    /// Highest solid y at area column, or -1.
    fn surface_y(&self, ax: i32, az: i32) -> i32 {
        let c = self.col_at(ax, az);
        let start = ((c.h + c.amp).ceil() as i32 + 1).min(H as i32 - 1);
        let mut y = start;
        while y >= 0 {
            if self.density(ax, az, y) > 0.0 {
                return y;
            }
            y -= 1;
        }
        -1
    }

    fn slope(&self, ax: i32, az: i32) -> f32 {
        let h = self.col_at(ax, az).h;
        let mut s: f32 = 0.0;
        for (dx, dz) in [(1, 0), (-1, 0), (0, 1), (0, -1)] {
            s = s.max((self.col_at(ax + dx, az + dz).h - h).abs());
        }
        s
    }

    /// (top block, filler block, filler depth) for a surface at world (x, z) and height y.
    fn surface_blocks(&self, ax: i32, az: i32, wx: i32, wz: i32, y: i32) -> (u8, u8, i32) {
        let c = self.col_at(ax, az);
        let slope = self.slope(ax, az);
        let patch = self.n_patch.n2(wx as f32 / 18.0, wz as f32 / 18.0);
        let underwater = y < SEA - 1;
        let snowline = 158.0 + self.n_patch.n2(wx as f32 / 60.0, wz as f32 / 60.0) * 10.0;

        if c.biome.watery() || (underwater && !matches!(c.biome, Biome::Desert)) {
            let depth = SEA - y;
            let top = if depth > 14 {
                if patch > 0.2 { GRAVEL } else if patch < -0.45 { CLAY_B } else { SAND }
            } else if patch > 0.45 {
                GRAVEL
            } else if patch < -0.55 {
                CLAY_B
            } else if matches!(c.biome, Biome::River | Biome::FrozenRiver) && patch > 0.1 {
                DIRT
            } else {
                SAND
            };
            return (top, if top == CLAY_B { CLAY_B } else { top }, 3);
        }

        if (y as f32) > snowline && slope < 4.0 {
            return (SNOW_B, STONE, 2);
        }

        match c.biome {
            Biome::Beach | Biome::SnowyBeach => {
                if slope > 3.0 {
                    (STONE, STONE, 3)
                } else {
                    (SAND, SAND, 3)
                }
            }
            Biome::Desert => (SAND, SAND, 4),
            Biome::SnowyPeaks => {
                if slope > 3.2 {
                    (STONE, STONE, 1)
                } else {
                    (SNOW_B, SNOW_B, 2)
                }
            }
            Biome::Mountains => {
                if slope > 2.6 || (y > 128 && patch > -0.2) {
                    if patch > 0.55 {
                        (GRAVEL, GRAVEL, 2)
                    } else {
                        (STONE, STONE, 1)
                    }
                } else {
                    (GRASS, DIRT, 3)
                }
            }
            Biome::SnowyPlains | Biome::SnowyTaiga => {
                if slope > 3.5 {
                    (STONE, STONE, 1)
                } else {
                    (SNOWY_GRASS, DIRT, 3)
                }
            }
            Biome::Taiga => {
                if slope > 3.5 {
                    (STONE, STONE, 1)
                } else if patch > 0.25 {
                    (PODZOL, DIRT, 3)
                } else {
                    (GRASS, DIRT, 3)
                }
            }
            _ => {
                if slope > 3.8 {
                    (STONE, STONE, 1)
                } else if slope > 3.0 && patch > 0.3 {
                    (GRAVEL, DIRT, 2)
                } else {
                    (GRASS, DIRT, 3 + (patch > 0.0) as i32)
                }
            }
        }
    }

    pub fn generate(&mut self, cx: i32, cz: i32) -> Vec<u8> {
        let x0 = cx * W as i32;
        let z0 = cz * W as i32;

        // 1. Column climate / height model over the area (chunk + margin M).
        for az in 0..A as i32 {
            for ax in 0..A as i32 {
                let c = self.column(x0 - M + ax, z0 - M + az);
                self.cols[az as usize * A + ax as usize] = c;
            }
        }

        if self.void_world {
            self.blocks.fill(AIR);
            if let Some(g) = self.ground {
                self.lay_ground(x0, z0, g);
            }
            self.stamp_blueprints(x0, z0);
            return self.pack(cx, cz);
        }

        // 2. Coarse 3D density noise grid (world aligned: x0 - DM is a multiple of 4).
        for gy in 0..DGY {
            for gz in 0..DG {
                for gx in 0..DG {
                    let wx = (x0 - DM + gx as i32 * 4) as f32;
                    let wz = (z0 - DM + gz as i32 * 4) as f32;
                    let wy = (gy * 8) as f32;
                    self.dgrid[(gy * DG + gz) * DG + gx] = (self.n_dens.fbm3(wx / 34.0, wy / 24.0, wz / 34.0, 2) * 1.4).clamp(-1.0, 1.0);
                }
            }
        }

        // 3. Surface heights for the density margin (tree bases need them).
        for az in (M - DM)..(M + W as i32 + DM) {
            for ax in (M - DM)..(M + W as i32 + DM) {
                self.tops[az as usize * A + ax as usize] = self.surface_y(ax, az);
            }
        }

        // 4. Terrain fill + surface decoration + water.
        self.blocks.fill(AIR);
        for lz in 0..W as i32 {
            for lx in 0..W as i32 {
                let ax = lx + M;
                let az = lz + M;
                let wx = x0 + lx;
                let wz = z0 + lz;
                let c = *self.col_at(ax, az);
                let ymax = ((c.h + c.amp).ceil() as i32 + 1).min(H as i32 - 1).max(SEA);
                let frozen = c.biome.frozen() && c.temp < -0.45;
                let mut depth: i32 = -1;
                let mut seen_solid = false;
                let (mut topb, mut fill, mut fdepth) = (GRASS, DIRT, 3);
                let deep_dither = (hash2(self.seed ^ 0x5eed, wx, wz) % 5) as i32;
                let mut y = ymax;
                while y >= 0 {
                    let solid = if y as f32 <= c.h - c.amp - 0.01 { true } else { self.density(ax, az, y) > 0.0 };
                    let i = bidx(lx as usize, y as usize, lz as usize);
                    if solid {
                        if depth < 0 {
                            // New surface (topmost or overhang floor).
                            let (t, f, d) = self.surface_blocks(ax, az, wx, wz, y);
                            topb = t;
                            fill = f;
                            fdepth = d;
                            if seen_solid && (t == GRASS || t == SNOWY_GRASS || t == PODZOL) {
                                // Floors under overhangs stay dirt, grass needs sky.
                                topb = DIRT;
                            }
                            depth = 0;
                            seen_solid = true;
                        } else {
                            depth += 1;
                        }
                        let b = if depth == 0 {
                            topb
                        } else if depth <= fdepth {
                            fill
                        } else if fill == SAND && depth <= fdepth + 3 {
                            SANDSTONE_B
                        } else if y < 4 + deep_dither {
                            DEEPSLATE_B
                        } else {
                            STONE
                        };
                        self.blocks[i] = b;
                    } else {
                        if !seen_solid && y <= SEA {
                            self.blocks[i] = if y == SEA && frozen { ICE_B } else { WATER_B };
                        }
                        depth = -1;
                    }
                    y -= 1;
                }
            }
        }

        // 5. Caves.
        self.carve_caves(x0, z0);

        // 6. Ores and stone variants.
        self.place_ores(cx, cz);

        // 7. Trees (including those rooted in the margin).
        self.place_trees(x0, z0);

        // 8. Ground vegetation.
        self.place_vegetation(x0, z0);

        // 9. Bedrock floor.
        for lz in 0..W {
            for lx in 0..W {
                self.blocks[bidx(lx, 0, lz)] = BEDROCK;
                for y in 1..4 {
                    let h = hash3(self.seed ^ 0xbed, x0 + lx as i32, y as i32, z0 + lz as i32);
                    if h % (y as u32 + 1) == 0 {
                        self.blocks[bidx(lx, y, lz)] = BEDROCK;
                    }
                }
            }
        }

        // 10. Game structures.
        if !self.blueprints.is_empty() {
            self.stamp_blueprints(x0, z0);
        }

        self.pack(cx, cz)
    }

    fn carve_caves(&mut self, x0: i32, z0: i32) {
        // Carve limit per chunk column: stay below the lowest nearby surface unless at an entrance.
        let mut limit = [0i32; W * W];
        let mut ymax = 0;
        for lz in 0..W as i32 {
            for lx in 0..W as i32 {
                let ax = lx + M;
                let az = lz + M;
                let top = self.tops[az as usize * A + ax as usize];
                let mut mn = top;
                for dz in -2..=2 {
                    for dx in -2..=2 {
                        mn = mn.min(self.tops[(az + dz) as usize * A + (ax + dx) as usize]);
                    }
                }
                let wx = (x0 + lx) as f32;
                let wz = (z0 + lz) as f32;
                let entrance = self.n_entrance.n2(wx / 96.0, wz / 96.0) > 0.62 && mn > SEA + 4;
                let l = if self.protected(x0 + lx, z0 + lz, 3) {
                    0
                } else if entrance {
                    top + 1
                } else {
                    mn - 7
                };
                limit[lz as usize * W + lx as usize] = l;
                ymax = ymax.max(l);
            }
        }
        if ymax <= 5 {
            return;
        }
        let ny = (ymax as usize) / 4 + 2;
        let gw = W / 4 + 1;
        let mut ga = vec![0f32; gw * gw * ny];
        let mut gb = vec![0f32; gw * gw * ny];
        let mut gc = vec![0f32; gw * gw * ny];
        for gy in 0..ny {
            for gz in 0..gw {
                for gx in 0..gw {
                    let wx = (x0 + gx as i32 * 4) as f32;
                    let wz = (z0 + gz as i32 * 4) as f32;
                    let wy = (gy * 4) as f32;
                    let i = (gy * gw + gz) * gw + gx;
                    ga[i] = self.n_cave_a.n3(wx / 70.0, wy / 44.0, wz / 70.0);
                    gb[i] = self.n_cave_b.n3(wx / 70.0, wy / 44.0, wz / 70.0);
                    gc[i] = if wy < 60.0 { self.n_cheese.fbm3(wx / 110.0, wy / 60.0, wz / 110.0, 2) } else { -1.0 };
                }
            }
        }
        let interp = |g: &Vec<f32>, lx: usize, y: usize, lz: usize| -> f32 {
            let (ix, fx) = (lx >> 2, (lx & 3) as f32 * 0.25);
            let (iz, fz) = (lz >> 2, (lz & 3) as f32 * 0.25);
            let (iy, fy) = (y >> 2, (y & 3) as f32 * 0.25);
            let s = |x: usize, y: usize, z: usize| g[(y * gw + z) * gw + x];
            let c00 = lerp(s(ix, iy, iz), s(ix + 1, iy, iz), fx);
            let c10 = lerp(s(ix, iy, iz + 1), s(ix + 1, iy, iz + 1), fx);
            let c01 = lerp(s(ix, iy + 1, iz), s(ix + 1, iy + 1, iz), fx);
            let c11 = lerp(s(ix, iy + 1, iz + 1), s(ix + 1, iy + 1, iz + 1), fx);
            lerp(lerp(c00, c10, fz), lerp(c01, c11, fz), fy)
        };
        for lz in 0..W {
            for lx in 0..W {
                let l = limit[lz * W + lx].min(H as i32 - 2);
                for y in 5..=l.max(4) as usize {
                    if y as i32 > l {
                        break;
                    }
                    let i = bidx(lx, y, lz);
                    let b = self.blocks[i];
                    if b == AIR || b == WATER_B || b == ICE_B || b == BEDROCK {
                        continue;
                    }
                    let a = interp(&ga, lx, y, lz);
                    let bb = interp(&gb, lx, y, lz);
                    let mut carve = a * a + bb * bb < 0.0042;
                    if !carve && y < 60 {
                        let ch = interp(&gc, lx, y, lz);
                        let thr = 0.42 + smoothstep(28.0, 58.0, y as f32) * 0.35;
                        carve = ch > thr;
                    }
                    if carve {
                        // Never open a hole directly below water.
                        if self.blocks[bidx(lx, y + 1, lz)] == WATER_B {
                            continue;
                        }
                        self.blocks[i] = if y <= 9 { LAVA_B } else { AIR };
                    }
                }
            }
        }
    }

    fn place_ores(&mut self, cx: i32, cz: i32) {
        let mut rng = Rng::new(((hash2(self.seed ^ 0x0e5, cx, cz) as u64) << 32) | hash2(self.seed, cz, cx) as u64);
        // Large stone-variant blobs first so ores can appear inside them too.
        self.blobs(&mut rng, GRANITE_B, 1.4, 18, 34, 6, 90, 2.2);
        self.blobs(&mut rng, DIORITE_B, 1.2, 18, 34, 6, 90, 2.2);
        self.blobs(&mut rng, ANDESITE_B, 1.4, 18, 34, 6, 90, 2.2);
        self.blobs(&mut rng, DIRT, 0.8, 12, 24, 20, 120, 1.8);
        self.blobs(&mut rng, GRAVEL, 0.8, 12, 24, 6, 120, 1.8);
        self.veins(&mut rng, COAL_ORE_B, 18.0, 6, 14, 5, 130);
        self.veins(&mut rng, IRON_ORE_B, 11.0, 4, 9, 5, 72);
        self.veins(&mut rng, GOLD_ORE_B, 2.5, 4, 8, 5, 32);
        self.veins(&mut rng, REDSTONE_ORE_B, 5.0, 4, 8, 5, 18);
        self.veins(&mut rng, LAPIS_ORE_B, 1.2, 3, 7, 5, 32);
        self.veins(&mut rng, DIAMOND_ORE_B, 1.3, 3, 7, 5, 16);
    }

    #[inline]
    fn replaceable_by_ore(b: u8) -> bool {
        b == STONE || b == DEEPSLATE_B || b == GRANITE_B || b == DIORITE_B || b == ANDESITE_B
    }

    #[allow(clippy::too_many_arguments)]
    fn veins(&mut self, rng: &mut Rng, ore: u8, count: f32, smin: i32, smax: i32, ymin: i32, ymax: i32) {
        let n = count as i32 + rng.chance(count.fract()) as i32;
        for _ in 0..n {
            let mut px = rng.range(0, 15) as f32;
            let mut py = rng.range(ymin, ymax) as f32;
            let mut pz = rng.range(0, 15) as f32;
            let size = rng.range(smin, smax);
            let mut dx = rng.f() * 2.0 - 1.0;
            let mut dy = (rng.f() * 2.0 - 1.0) * 0.5;
            let mut dz = rng.f() * 2.0 - 1.0;
            for _ in 0..size {
                let (x, y, z) = (px.round() as i32, py.round() as i32, pz.round() as i32);
                self.set_if(x, y, z, ore, Self::replaceable_by_ore);
                if rng.chance(0.5) {
                    let o = rng.range(0, 5);
                    let (ox, oy, oz) = [(1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1)][o as usize];
                    self.set_if(x + ox, y + oy, z + oz, ore, Self::replaceable_by_ore);
                }
                dx += (rng.f() - 0.5) * 0.8;
                dy += (rng.f() - 0.5) * 0.5;
                dz += (rng.f() - 0.5) * 0.8;
                let l = (dx * dx + dy * dy + dz * dz).sqrt().max(0.001);
                px += dx / l * 0.7;
                py += dy / l * 0.5;
                pz += dz / l * 0.7;
            }
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn blobs(&mut self, rng: &mut Rng, b: u8, count: f32, smin: i32, smax: i32, ymin: i32, ymax: i32, radius: f32) {
        let n = count as i32 + rng.chance(count.fract()) as i32;
        for _ in 0..n {
            let mut px = rng.range(0, 15) as f32;
            let mut py = rng.range(ymin, ymax) as f32;
            let mut pz = rng.range(0, 15) as f32;
            let steps = rng.range(smin, smax) / 6 + 1;
            for _ in 0..steps {
                let r = radius * (0.7 + rng.f() * 0.6);
                let ri = r.ceil() as i32;
                for oy in -ri..=ri {
                    for oz in -ri..=ri {
                        for ox in -ri..=ri {
                            if (ox * ox + oy * oy + oz * oz) as f32 <= r * r {
                                self.set_if(px as i32 + ox, py as i32 + oy, pz as i32 + oz, b, |c| c == STONE || c == DEEPSLATE_B);
                            }
                        }
                    }
                }
                px += (rng.f() - 0.5) * 3.0;
                py += (rng.f() - 0.5) * 2.0;
                pz += (rng.f() - 0.5) * 3.0;
            }
        }
    }

    #[inline]
    fn set_if(&mut self, x: i32, y: i32, z: i32, b: u8, pred: impl Fn(u8) -> bool) {
        if (0..W as i32).contains(&x) && (0..H as i32).contains(&y) && (0..W as i32).contains(&z) {
            let i = bidx(x as usize, y as usize, z as usize);
            if pred(self.blocks[i]) {
                self.blocks[i] = b;
            }
        }
    }

    /// Place a tree block if it lands inside this chunk. Logs replace leaves / plants,
    /// leaves only fill air or plants.
    #[inline]
    fn tree_set(&mut self, x0: i32, z0: i32, wx: i32, y: i32, wz: i32, b: u8) {
        let lx = wx - x0;
        let lz = wz - z0;
        if !(0..W as i32).contains(&lx) || !(0..W as i32).contains(&lz) || !(0..H as i32).contains(&y) {
            return;
        }
        let i = bidx(lx as usize, y as usize, lz as usize);
        let cur = self.blocks[i];
        let is_log = b == OAK_LOG_B || b == BIRCH_LOG_B || b == SPRUCE_LOG_B || b == CACTUS_B;
        let cur_soft = cur == AIR || SHAPE[cur as usize] == SHAPE_CROSS;
        let cur_leaves = cur == OAK_LEAVES_B || cur == BIRCH_LEAVES_B || cur == SPRUCE_LEAVES_B;
        if cur_soft || (is_log && cur_leaves) {
            self.blocks[i] = b;
        }
    }

    fn place_trees(&mut self, x0: i32, z0: i32) {
        const CELL: i32 = 6;
        let reach = DM; // max horizontal extent of a tree from its trunk
        let gx0 = (x0 - reach).div_euclid(CELL);
        let gx1 = (x0 + W as i32 - 1 + reach).div_euclid(CELL);
        let gz0 = (z0 - reach).div_euclid(CELL);
        let gz1 = (z0 + W as i32 - 1 + reach).div_euclid(CELL);
        for gz in gz0..=gz1 {
            for gx in gx0..=gx1 {
                let h = hash2(self.seed ^ 0x7ee5, gx, gz);
                let tx = gx * CELL + (h % CELL as u32) as i32;
                let tz = gz * CELL + ((h >> 8) % CELL as u32) as i32;
                if tx < x0 - reach || tx >= x0 + W as i32 + reach || tz < z0 - reach || tz >= z0 + W as i32 + reach {
                    continue;
                }
                if self.protected(tx, tz, 4) {
                    continue;
                }
                let ax = tx - x0 + M;
                let az = tz - z0 + M;
                let c = *self.col_at(ax, az);
                let r = unit(hash32(h ^ 0x51ed));
                // Density varies slowly inside a biome for natural clearings.
                let clump = 0.65 + 0.35 * self.n_flower.n2(tx as f32 / 40.0, tz as f32 / 40.0);
                let (density, kind) = match c.biome {
                    Biome::Forest => (0.85 * clump, if r < 0.2 { 1 } else if unit(hash32(h ^ 0xb16)) < 0.12 { 4 } else { 0 }),
                    Biome::BirchForest => (0.8 * clump, if r < 0.85 { 1 } else { 0 }),
                    Biome::Taiga => (0.8 * clump, 2),
                    Biome::SnowyTaiga => (0.55 * clump, 2),
                    Biome::SnowyPlains => (0.025, 2),
                    Biome::Plains => (0.035 * clump, if unit(hash32(h ^ 0xb16)) < 0.2 { 4 } else { 0 }),
                    Biome::Savanna => (0.07, 0),
                    Biome::Mountains => (if c.h < 128.0 { 0.2 } else { 0.0 }, 2),
                    Biome::Desert => (0.1, 3),
                    _ => (0.0, 0),
                };
                if unit(hash32(h ^ 0xde5)) >= density {
                    continue;
                }
                let top = self.tops[az as usize * A + ax as usize];
                if top < SEA || top > H as i32 - 20 {
                    continue;
                }
                if self.slope(ax, az) > 2.2 {
                    continue;
                }
                let (tb, _, _) = self.surface_blocks(ax, az, tx, tz, top);
                let ok = if kind == 3 { tb == SAND } else { tb == GRASS || tb == DIRT || tb == PODZOL || tb == SNOWY_GRASS };
                if !ok {
                    continue;
                }
                let mut rng = Rng::new(((h as u64) << 32) | hash32(h ^ 0x1234) as u64);
                let y = top + 1;
                // Ground under trunks becomes dirt.
                if kind != 3 {
                    self.tree_set_ground(x0, z0, tx, top, tz);
                }
                match kind {
                    0 => self.oak(x0, z0, tx, y, tz, &mut rng, OAK_LOG_B, OAK_LEAVES_B, 4, 6),
                    1 => self.oak(x0, z0, tx, y, tz, &mut rng, BIRCH_LOG_B, BIRCH_LEAVES_B, 5, 7),
                    2 => self.spruce(x0, z0, tx, y, tz, &mut rng),
                    3 => self.cactus(x0, z0, tx, y, tz, &mut rng),
                    _ => self.big_oak(x0, z0, tx, y, tz, &mut rng),
                }
            }
        }
    }

    fn tree_set_ground(&mut self, x0: i32, z0: i32, wx: i32, y: i32, wz: i32) {
        let lx = wx - x0;
        let lz = wz - z0;
        if (0..W as i32).contains(&lx) && (0..W as i32).contains(&lz) && y >= 0 {
            let i = bidx(lx as usize, y as usize, lz as usize);
            if self.blocks[i] == GRASS || self.blocks[i] == SNOWY_GRASS || self.blocks[i] == PODZOL {
                self.blocks[i] = DIRT;
            }
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn oak(&mut self, x0: i32, z0: i32, x: i32, y: i32, z: i32, rng: &mut Rng, log: u8, leaves: u8, hmin: i32, hmax: i32) {
        let h = rng.range(hmin, hmax);
        let top = y + h;
        for dy in -3..=0i32 {
            let ly = top + dy;
            let r: i32 = if dy >= -1 { 1 } else { 2 };
            for dz in -r..=r {
                for dx in -r..=r {
                    let corner = dx.abs() == r && dz.abs() == r;
                    if corner && (dy == 0 || rng.chance(0.55)) {
                        continue;
                    }
                    self.tree_set(x0, z0, x + dx, ly, z + dz, leaves);
                }
            }
        }
        for ly in y..top {
            self.tree_set(x0, z0, x, ly, z, log);
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn big_oak(&mut self, x0: i32, z0: i32, x: i32, y: i32, z: i32, rng: &mut Rng) {
        let h = rng.range(7, 10);
        let top = y + h;
        let blob = |s: &mut Self, cx: i32, cy: i32, cz: i32, r: f32, rng: &mut Rng| {
            let ri = r.ceil() as i32;
            for dy in -ri + 1..=ri - 1 {
                for dz in -ri..=ri {
                    for dx in -ri..=ri {
                        let d = (dx * dx) as f32 + (dy * dy) as f32 * 1.6 + (dz * dz) as f32;
                        if d <= r * r - rng.f() * 1.5 {
                            s.tree_set(x0, z0, cx + dx, cy + dy, cz + dz, OAK_LEAVES_B);
                        }
                    }
                }
            }
        };
        blob(self, x, top, z, 3.0, rng);
        let branches = rng.range(2, 3);
        for b in 0..branches {
            let ang = rng.f() * 6.283 + b as f32 * 2.1;
            let (bx, bz) = ((ang.cos() * 1.6).round() as i32, (ang.sin() * 1.6).round() as i32);
            let by = y + h - 3 - rng.range(0, 2);
            self.tree_set(x0, z0, x + bx.signum(), by, z + bz.signum(), OAK_LOG_B);
            blob(self, x + bx, by + 1, z + bz, 2.3, rng);
            // Re-place the branch log inside its own leaves.
            self.tree_set(x0, z0, x + bx.signum(), by, z + bz.signum(), OAK_LOG_B);
        }
        for ly in y..top {
            self.tree_set(x0, z0, x, ly, z, OAK_LOG_B);
        }
    }

    fn spruce(&mut self, x0: i32, z0: i32, x: i32, y: i32, z: i32, rng: &mut Rng) {
        let h = rng.range(7, 11);
        let top = y + h;
        let bare = rng.range(1, 3);
        self.tree_set(x0, z0, x, top, z, SPRUCE_LEAVES_B);
        self.tree_set(x0, z0, x, top + 1, z, SPRUCE_LEAVES_B);
        let mut r = 0i32;
        let mut max_r = 1i32;
        let mut ly = top - 1;
        while ly >= y + bare {
            for dz in -r..=r {
                for dx in -r..=r {
                    if r > 0 && dx.abs() == r && dz.abs() == r {
                        continue;
                    }
                    self.tree_set(x0, z0, x + dx, ly, z + dz, SPRUCE_LEAVES_B);
                }
            }
            if r >= max_r {
                r = 0;
                max_r = (max_r + 1).min(3);
            } else {
                r += 1;
            }
            ly -= 1;
        }
        for ly in y..top {
            self.tree_set(x0, z0, x, ly, z, SPRUCE_LOG_B);
        }
    }

    fn cactus(&mut self, x0: i32, z0: i32, x: i32, y: i32, z: i32, rng: &mut Rng) {
        let h = rng.range(1, 3);
        for ly in y..y + h {
            self.tree_set(x0, z0, x, ly, z, CACTUS_B);
        }
    }

    fn place_vegetation(&mut self, x0: i32, z0: i32) {
        for lz in 0..W as i32 {
            for lx in 0..W as i32 {
                let ax = lx + M;
                let az = lz + M;
                let top = self.tops[az as usize * A + ax as usize];
                if top < SEA || top >= H as i32 - 2 {
                    continue;
                }
                let tb = self.blocks[bidx(lx as usize, top as usize, lz as usize)];
                let above = bidx(lx as usize, top as usize + 1, lz as usize);
                if self.blocks[above] != AIR {
                    continue;
                }
                let wx = x0 + lx;
                let wz = z0 + lz;
                if self.in_blueprint(wx, wz) {
                    continue;
                }
                let c = *self.col_at(ax, az);
                let h = hash2(self.seed ^ 0x0e6e, wx, wz);
                let r = unit(h);
                let fl = self.n_flower.n2(wx as f32 / 28.0, wz as f32 / 28.0);
                let flower = |h: u32, fl: f32| -> u8 {
                    let k = (h >> 24) % 3;
                    if fl > 0.62 {
                        [POPPY_B, POPPY_B, DANDELION_B][k as usize]
                    } else if fl < -0.62 {
                        [CORNFLOWER_B, CORNFLOWER_B, DANDELION_B][k as usize]
                    } else {
                        [DANDELION_B, POPPY_B, CORNFLOWER_B][k as usize]
                    }
                };
                let plant = match tb {
                    GRASS => {
                        let (grass, fern, flowers, shroom) = match c.biome {
                            Biome::Plains => (0.32, 0.0, if fl.abs() > 0.55 { 0.14 } else { 0.012 }, 0.0),
                            Biome::Forest => (0.22, 0.03, if fl.abs() > 0.6 { 0.06 } else { 0.01 }, 0.006),
                            Biome::BirchForest => (0.28, 0.0, if fl.abs() > 0.55 { 0.08 } else { 0.015 }, 0.0),
                            Biome::Taiga => (0.1, 0.14, 0.0, 0.01),
                            Biome::Savanna => (0.45, 0.0, 0.004, 0.0),
                            Biome::Mountains => (0.14, 0.02, 0.01, 0.0),
                            _ => (0.12, 0.0, 0.004, 0.0),
                        };
                        if r < flowers {
                            flower(h, fl)
                        } else if r < flowers + shroom {
                            if (h >> 20) & 1 == 0 { BROWN_MUSHROOM_B } else { RED_MUSHROOM_B }
                        } else if r < flowers + shroom + fern {
                            FERN_B
                        } else if r < flowers + shroom + fern + grass {
                            SHORT_GRASS_B
                        } else {
                            AIR
                        }
                    }
                    PODZOL => {
                        if r < 0.18 {
                            FERN_B
                        } else if r < 0.2 {
                            if (h >> 20) & 1 == 0 { BROWN_MUSHROOM_B } else { RED_MUSHROOM_B }
                        } else if r < 0.26 {
                            SHORT_GRASS_B
                        } else {
                            AIR
                        }
                    }
                    SAND if c.biome == Biome::Desert => {
                        if r < 0.012 {
                            DEAD_BUSH_B
                        } else {
                            AIR
                        }
                    }
                    _ => AIR,
                };
                if plant != AIR {
                    self.blocks[above] = plant;
                }
            }
        }
    }

    fn pack(&self, cx: i32, cz: i32) -> Vec<u8> {
        let mut mask: u16 = 0;
        let mut emit: u16 = 0;
        let emits = &registry().emit;
        for s in 0..16 {
            let sec = &self.blocks[s * 4096..(s + 1) * 4096];
            if sec.iter().any(|&b| b != AIR) {
                mask |= 1 << s;
                if sec.iter().any(|&b| emits[b as usize] > 0) {
                    emit |= 1 << s;
                }
            }
        }
        let n = mask.count_ones() as usize;
        let mut out = vec![0u8; HEADER_BYTES + n * 4096];
        out[0..2].copy_from_slice(&mask.to_le_bytes());
        out[2..4].copy_from_slice(&emit.to_le_bytes());
        let x0 = cx * W as i32;
        let z0 = cz * W as i32;
        for lz in 0..W {
            for lx in 0..W {
                let c = self.col_at(lx as i32 + M, lz as i32 + M);
                let mut col = Self::grass_color(c);
                // Tiny per-block jitter keeps large fields lively.
                let j = (hash2(self.seed ^ 0x7147, x0 + lx as i32, z0 + lz as i32) % 9) as i32 - 4;
                for v in col.iter_mut() {
                    *v = (*v as i32 + j).clamp(0, 255) as u8;
                }
                let o = 4 + (lz * W + lx) * 3;
                out[o..o + 3].copy_from_slice(&col);
                let mut hy = 0;
                for y in (0..H).rev() {
                    if self.blocks[bidx(lx, y, lz)] != AIR {
                        hy = y;
                        break;
                    }
                }
                out[772 + lz * W + lx] = hy as u8;
            }
        }
        let mut o = HEADER_BYTES;
        for s in 0..16 {
            if mask & (1 << s) != 0 {
                out[o..o + 4096].copy_from_slice(&self.blocks[s * 4096..(s + 1) * 4096]);
                o += 4096;
            }
        }
        out
    }

    /// Find a pleasant spawn column near the origin: dry land, not mountainous, not a desert.
    pub fn find_spawn(&self) -> (i32, i32, i32) {
        let mut best = (0, 80, 0);
        for ring in 0..160i32 {
            let r = ring * 24;
            let steps = (ring * 8).max(1);
            for s in 0..steps {
                let a = s as f32 / steps as f32 * std::f32::consts::TAU;
                let x = (a.cos() * r as f32) as i32;
                let z = (a.sin() * r as f32) as i32;
                let c = self.column(x, z);
                let good_biome = matches!(c.biome, Biome::Plains | Biome::Forest | Biome::BirchForest | Biome::Taiga | Biome::Savanna);
                if good_biome && c.h > SEA as f32 + 3.0 && c.mfac < 0.15 && c.amp < 6.0 {
                    return (x, c.h.ceil() as i32 + 1, z);
                }
                if ring == 0 {
                    best = (x, c.h.max(SEA as f32).ceil() as i32 + 1, z);
                }
            }
        }
        best
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deterministic_and_sane() {
        let mut g = Generator::new(42);
        let a = g.generate(3, -7);
        let b = g.generate(3, -7);
        assert_eq!(a, b);
        let mask = u16::from_le_bytes([a[0], a[1]]);
        assert!(mask & 1 == 1, "bottom section must exist");
        assert_eq!(a.len(), HEADER_BYTES + mask.count_ones() as usize * 4096);
    }

    #[test]
    fn border_trees_agree() {
        // A tree crossing the border must be identical when seen from either chunk: compare the
        // shared column just across the border using an extended generation.
        let mut g = Generator::new(7);
        for cx in -3..3 {
            let a = g.generate(cx, 0);
            let b = g.generate(cx + 1, 0);
            // Both must at least decode.
            assert!(a.len() >= HEADER_BYTES && b.len() >= HEADER_BYTES);
        }
    }

    #[test]
    fn void_world_has_only_structures() {
        let mut g = Generator::new(7);
        g.set_void();
        let empty = g.generate(0, 0);
        assert_eq!(u16::from_le_bytes([empty[0], empty[1]]), 0, "no sections in an empty void chunk");
        g.add_blueprint(Blueprint { origin: [2, 100, 3], size: [1, 1, 1], data: vec![STONE] });
        let data = g.generate(0, 0);
        assert_eq!(u16::from_le_bytes([data[0], data[1]]), 1 << (100 / 16));
    }

    #[test]
    fn void_ground_is_a_plain_slab_shaped_by_terraforms() {
        let mut g = Generator::new(7);
        g.set_void();
        g.set_void_ground(63, GRASS, DIRT, 4);
        // A hill (its top at 80) off in one corner; a structure standing on the plain.
        g.add_terraform(Terraform { cx: 40.0, cz: 40.0, radius: 4.0, blend: 20.0, height: 80.5 });
        g.add_blueprint(Blueprint { origin: [2, 64, 3], size: [1, 1, 1], data: vec![STONE] });
        let mut w = crate::world::World::new();
        for cz in -1..4 {
            for cx in -1..4 {
                let d = g.generate(cx, cz);
                w.insert_column(cx, cz, &d);
            }
        }
        let top = |x: i32, z: i32| (0..256).rev().find(|&y| w.get(x, y, z) != AIR).unwrap_or(-1);
        // Grass at 63 over three of dirt, the void below; the structure on it.
        assert_eq!(w.get(0, 63, 0), GRASS);
        assert_eq!(w.get(0, 60, 0), DIRT);
        assert_eq!(w.get(0, 59, 0), AIR);
        assert_eq!(w.get(-15, 63, -15), GRASS, "everywhere, not only near the origin");
        assert_eq!(w.get(2, 64, 3), STONE);
        // No water, trees or caves: flat far from the hill, the hill's top where it says.
        assert_eq!(top(20, -10), 63);
        assert_eq!(top(40, 40), 80, "the hill");
        let slope = top(40, 55);
        assert!(slope > 63 && slope < 80, "its slope: {slope}");
    }

    #[test]
    fn blueprints_stamp_and_terraform() {
        let mut g = Generator::new(3);
        g.add_terraform(Terraform { cx: 0.0, cz: 0.0, radius: 30.0, blend: 20.0, height: 70.5 });
        // 20x4x20 platform of bricks straddling four chunks, air above it.
        let (sx, sy, sz) = (20, 4, 20);
        let mut data = vec![BLUEPRINT_KEEP; (sx * sy * sz) as usize];
        for z in 0..sz {
            for x in 0..sx {
                data[((0 * sz + z) * sx + x) as usize] = BRICKS_B;
                for y in 1..sy {
                    data[((y * sz + z) * sx + x) as usize] = AIR;
                }
            }
        }
        g.add_blueprint(Blueprint { origin: [-10, 70, -10], size: [sx, sy, sz], data });
        let mut w = crate::world::World::new();
        for cz in -1..1 {
            for cx in -1..1 {
                let d = g.generate(cx, cz);
                w.insert_column(cx, cz, &d);
            }
        }
        assert_eq!(w.get(-10, 70, -10), BRICKS_B);
        assert_eq!(w.get(9, 70, 9), BRICKS_B);
        assert_eq!(w.get(0, 72, 0), AIR);
        // Terraformed ground just outside the platform is flat at 70.
        let mut top = 0;
        for y in (0..256).rev() {
            if w.get(12, y, 12) != AIR && SHAPE[w.get(12, y, 12) as usize] != SHAPE_CROSS {
                top = y;
                break;
            }
        }
        assert_eq!(top, 70, "terraformed surface");
    }

    #[test]
    fn timing() {
        let mut g = Generator::new(1337);
        let t = std::time::Instant::now();
        let n = 64;
        for i in 0..n {
            std::hint::black_box(g.generate(i % 8, i / 8));
        }
        let per = t.elapsed().as_secs_f64() * 1000.0 / n as f64;
        eprintln!("generate: {per:.3} ms/chunk (native)");
    }

    #[test]
    fn biome_distribution() {
        let g = Generator::new(1337);
        let mut counts = std::collections::HashMap::new();
        let mut land = 0;
        let n = 120;
        for zi in 0..n {
            for xi in 0..n {
                let c = g.column(xi * 64 - 3840, zi * 64 - 3840);
                *counts.entry(format!("{:?}", c.biome)).or_insert(0) += 1;
                if c.h >= SEA as f32 {
                    land += 1;
                }
            }
        }
        eprintln!("land fraction {:.2}", land as f32 / (n * n) as f32);
        let mut v: Vec<_> = counts.into_iter().collect();
        v.sort_by(|a, b| b.1.cmp(&a.1));
        eprintln!("{v:?}");
    }
}

#[cfg(test)]
mod map_tests {
    use super::*;

    fn biome_rgb(b: Biome) -> [f32; 3] {
        match b {
            Biome::Ocean => [0.15, 0.3, 0.65],
            Biome::DeepOcean => [0.08, 0.18, 0.5],
            Biome::FrozenOcean => [0.55, 0.65, 0.85],
            Biome::Beach => [0.9, 0.85, 0.55],
            Biome::SnowyBeach => [0.9, 0.9, 0.8],
            Biome::River => [0.2, 0.45, 0.85],
            Biome::FrozenRiver => [0.6, 0.75, 0.95],
            Biome::Plains => [0.55, 0.78, 0.3],
            Biome::Forest => [0.2, 0.5, 0.15],
            Biome::BirchForest => [0.4, 0.62, 0.3],
            Biome::Taiga => [0.2, 0.4, 0.3],
            Biome::SnowyTaiga => [0.6, 0.72, 0.68],
            Biome::SnowyPlains => [0.92, 0.95, 0.97],
            Biome::Desert => [0.95, 0.8, 0.45],
            Biome::Savanna => [0.7, 0.68, 0.3],
            Biome::Mountains => [0.5, 0.5, 0.5],
            Biome::SnowyPeaks => [1.0, 1.0, 1.0],
        }
    }

    /// `TERRAIN_MAP=/path.png cargo test --release map -- --ignored`
    #[test]
    #[ignore]
    fn map() {
        let path = std::env::var("TERRAIN_MAP").unwrap_or_else(|_| "/tmp/terrain_map.png".into());
        let g = Generator::new(1337);
        let n = 768usize;
        let step = 8i32;
        let mut img = vec![0u8; n * n * 3];
        let mut hs = vec![0f32; n * n];
        let mut bs = vec![Biome::Plains; n * n];
        for zi in 0..n {
            for xi in 0..n {
                let c = g.column((xi as i32 - n as i32 / 2) * step, (zi as i32 - n as i32 / 2) * step);
                hs[zi * n + xi] = c.h;
                bs[zi * n + xi] = c.biome;
            }
        }
        for zi in 0..n {
            for xi in 0..n {
                let h = hs[zi * n + xi];
                let hx = hs[zi * n + (xi + 1).min(n - 1)] - hs[zi * n + xi.saturating_sub(1)];
                let hz = hs[(zi + 1).min(n - 1) * n + xi] - hs[zi.saturating_sub(1) * n + xi];
                let shade = (1.0 - (hx + hz) * 0.02).clamp(0.55, 1.35);
                let mut c = biome_rgb(bs[zi * n + xi]);
                if h < SEA as f32 {
                    let d = ((SEA as f32 - h) / 30.0).clamp(0.0, 1.0);
                    for v in c.iter_mut() {
                        *v *= 1.0 - d * 0.5;
                    }
                }
                for k in 0..3 {
                    img[(zi * n + xi) * 3 + k] = ((c[k] * shade).clamp(0.0, 1.0) * 255.0) as u8;
                }
            }
        }
        crate::testutil::write_png(&path, n, n, &img);
    }
}
