//! Lighting + meshing for one chunk column, computed from the 3x3 neighbourhood of columns.
//!
//! Light level 15 falls to 0 within 15 steps, so every light source (sky or block) that can reach
//! the centre column (plus the 1-block border sampled for smooth lighting) lies inside the 48x48
//! region. Lighting computed here is therefore exact and seamless across chunks.
//!
//! Region input layout (`World::extract_region`):
//! ```text
//! 9 x (u16 LE section mask, u16 LE emitter mask), columns ordered dz = -1..1 (outer), dx = -1..1
//! then, per column in that order, 4096 bytes per set section (index (y * 16 + z) * 16 + x)
//! then, only if there are damaged blocks: u32 LE count, and per block its storage index here
//!      (u32 LE, `ri` of it) and what's left of it (256 u16 LE rows, see `damage`)
//! ```
//!
//! A damaged block (shot at: see `damage`) is drawn from what's left of it, little voxel by little
//! voxel, as fine quads with its own texture. It still keeps light out like the block it is (and
//! is lit inside by what reaches it from the open cells around), but nothing culls against a side
//! of it with holes in, and the culler sees through it.
//!
//! Output (`Vec<u32>`): `MESH_HEADER` words of header followed by vertex data of the opaque,
//! cutout and translucent layers. Each quad is 4 vertices x 2 words:
//! ```text
//! w0: x(5) | z(5)<<5 | y(9)<<10 | normal(3)<<19 | ao(2)<<22 | anim(2)<<24 | tint<<26 | xmax/umax<<27 | zmax/vmax<<28 | cutout<<29 | fine<<30 | uvt.0<<31
//! w1: texture layer(10) | uvt.1-2 (2)<<10 | sky*4 (6)<<12 | block*4 (6)<<18 | fx(4)<<24 | fz(4)<<28
//! ```
//! normal: 0 +X, 1 -X, 2 +Y, 3 -Y, 4 +Z, 5 -Z, 6/7 cross planes. anim: 0 none, 1 leaves, 2 plant
//! top vertex, 3 liquid surface vertex (lowered). xmax/zmax flag cross vertices on the far corner.
//! uvt: texture transform (`UV_*` in `blocks`).
//!
//! A `fine` vertex (block models: torches, slabs, stairs, beds) is a point of its block's cell on
//! the 1/16 grid: the cell (x 4 bits, z 4 bits, y 8 bits, each field's top bit spare) and the
//! offset into it in sixteenths, 0..=16 (5 bits each): ox = fx | x.4 << 4, oz = fz | z.4 << 4,
//! oy = (anim bits) | (umax/vmax bits) << 2 | y.8 << 4. Knowing its cell, the shader maps the
//! texture exactly within that block's tile. Fine quads don't animate or widen.
//!
//! Header:
//! ```text
//! [0] header length    [1..4] quad count per layer
//! [4 + s*3 + l]        quad start of section s (0..=16) in layer l
//! [55 + s]             section info: connectivity (15 bits) | sunlit << 16 | has blocks << 17
//! ```

use crate::blocks::*;
use crate::shapes::{on_side, side_mask, Cuboid, Model, FULL_SIDE, NO_TEX, OPPOSITE};

/// A damaged block in the region being meshed.
struct Hurt {
    /// Its storage index.
    at: usize,
    /// What's left (see `damage`).
    bits: [u16; 256],
    /// The sides (bit per face, +X -X +Y -Y +Z -Z) still whole: those hide what's against them.
    whole: u8,
}

pub const RW: usize = 48;
const SZ: usize = RW;
const SY: usize = RW * RW;
/// Storage layers: y = -1 (below world, solid) ..= 256 (above world, open sky).
const LAYERS: usize = 258;
pub const REGION_HEADER: usize = 36;
pub const MESH_HEADER: usize = 80;

#[inline(always)]
fn ri(x: usize, y: usize, z: usize) -> usize {
    // y is the storage layer (world y + 1)
    y * SY + z * SZ + x
}

/// Face direction offsets in region index space.
const FACE_OFF: [isize; 6] = [1, -1, SY as isize, -(SY as isize), SZ as isize, -(SZ as isize)];
/// Tangent (U) and bitangent (V) offsets per face.
const U_OFF: [isize; 6] = [SZ as isize, SZ as isize, 1, 1, 1, 1];
const V_OFF: [isize; 6] = [SY as isize, SY as isize, SZ as isize, SZ as isize, SY as isize, SY as isize];
/// Faces whose (u, v) winding must be reversed to face outward.
const REVERSE: [bool; 6] = [true, false, true, false, false, true];
const CORNER_SIGNS: [(isize, isize); 4] = [(-1, -1), (1, -1), (1, 1), (-1, 1)];

/// Pair index for connectivity bits between faces i < j.
const fn pair_table() -> [[u8; 6]; 6] {
    let mut t = [[0u8; 6]; 6];
    let mut k = 0u8;
    let mut i = 0;
    while i < 6 {
        let mut j = i + 1;
        while j < 6 {
            t[i][j] = k;
            t[j][i] = k;
            k += 1;
            j += 1;
        }
        i += 1;
    }
    t
}
const PAIR: [[u8; 6]; 6] = pair_table();
pub const ALL_CONNECTED: u32 = 0x7fff;
/// Vertex flag (w0 bit 29): quad belongs to the alpha-tested cutout layer.
pub const CUTOUT_FLAG: u32 = 1 << 29;
/// Vertex flag (w0 bit 30): a block model vertex, on the 1/16 grid.
pub const FINE_FLAG: u32 = 1 << 30;

#[derive(Clone, Copy, PartialEq, Eq)]
struct Corner {
    ao: u8,
    sky: u8,
    blk: u8,
}

pub struct Mesher {
    blocks: Vec<u8>,
    sky: Vec<u8>,
    blk: Vec<u8>,
    queue: Vec<u32>,
    low: Vec<u16>,
    top: usize,
    masks: [u16; 9],
    emits: [u16; 9],
    out: [Vec<u32>; 3],
    sec_start: [[u32; 17]; 3],
    sec_info: [u32; 16],
    greedy: Vec<u32>,
    slice_used: [bool; 96],
    visited: Vec<u8>,
    stack: Vec<u16>,
    /// The region's damaged blocks, and per storage index 1 + which one (0 for a whole block);
    /// made the first time a region has any.
    hurts: Vec<Hurt>,
    hurt: Vec<u16>,
    /// The blocks in use, taken at the start of each mesh.
    reg: &'static Registry,
}

impl Default for Mesher {
    fn default() -> Self {
        Self::new()
    }
}

impl Mesher {
    pub fn new() -> Self {
        Mesher {
            blocks: vec![0; LAYERS * SY],
            sky: vec![0; LAYERS * SY],
            blk: vec![0; LAYERS * SY],
            queue: Vec::with_capacity(1 << 16),
            low: vec![0; SY],
            top: 0,
            masks: [0; 9],
            emits: [0; 9],
            out: [Vec::with_capacity(1 << 16), Vec::with_capacity(1 << 14), Vec::with_capacity(1 << 12)],
            sec_start: [[0; 17]; 3],
            sec_info: [0; 16],
            greedy: vec![0; 6 * 16 * 256],
            slice_used: [false; 96],
            visited: vec![0; 4096],
            stack: Vec::with_capacity(4096),
            hurts: Vec::new(),
            hurt: Vec::new(),
            reg: registry(),
        }
    }

    /// Light + mesh the centre column of a region. Returns header + vertex data.
    pub fn mesh(&mut self, region: &[u8]) -> Vec<u32> {
        self.reg = registry();
        self.load(region);
        self.light_sky();
        self.light_block();
        self.build();
        self.assemble()
    }

    fn load(&mut self, data: &[u8]) {
        self.blocks.fill(AIR);
        // Below-world layer behaves like solid stone.
        self.blocks[..SY].fill(STONE);
        let mut off = REGION_HEADER;
        let mut max_s = 0usize;
        for k in 0..9 {
            let mask = u16::from_le_bytes([data[k * 4], data[k * 4 + 1]]);
            let emit = u16::from_le_bytes([data[k * 4 + 2], data[k * 4 + 3]]);
            self.masks[k] = mask;
            self.emits[k] = emit;
            let xo = (k % 3) * 16;
            let zo = (k / 3) * 16;
            for s in 0..16 {
                if mask & (1 << s) == 0 {
                    continue;
                }
                let src = &data[off..off + 4096];
                off += 4096;
                for y in 0..16 {
                    for z in 0..16 {
                        let d = ri(xo, s * 16 + y + 1, zo + z);
                        let so = (y * 16 + z) * 16;
                        self.blocks[d..d + 16].copy_from_slice(&src[so..so + 16]);
                    }
                }
                max_s = max_s.max(s + 1);
            }
        }
        self.top = max_s * 16;
        self.load_damage(data, off);
    }

    /// The damaged blocks after the sections, if there are any (see the region layout).
    fn load_damage(&mut self, data: &[u8], mut off: usize) {
        for h in &self.hurts {
            self.hurt[h.at] = 0;
        }
        self.hurts.clear();
        let Some(n) = data.get(off..off + 4) else { return };
        let n = u32::from_le_bytes([n[0], n[1], n[2], n[3]]) as usize;
        off += 4;
        if self.hurt.is_empty() {
            self.hurt = vec![0; LAYERS * SY];
        }
        for _ in 0..n.min(u16::MAX as usize - 1) {
            let Some(d) = data.get(off..off + 4 + 512) else { break };
            off += 4 + 512;
            let at = u32::from_le_bytes([d[0], d[1], d[2], d[3]]) as usize;
            if at >= LAYERS * SY || self.hurt[at] != 0 {
                continue;
            }
            let bits: [u16; 256] = std::array::from_fn(|r| u16::from_le_bytes([d[4 + r * 2], d[5 + r * 2]]));
            let all = |f: &dyn Fn(usize) -> bool| (0..256).all(f);
            let whole = (all(&|r| bits[r] & 0x8000 != 0) as u8)
                | ((all(&|r| bits[r] & 1 != 0) as u8) << 1)
                | ((bits[240..].iter().all(|&r| r == 0xffff) as u8) << 2)
                | ((bits[..16].iter().all(|&r| r == 0xffff) as u8) << 3)
                | (((0..16).all(|y| bits[y * 16 + 15] == 0xffff) as u8) << 4)
                | (((0..16).all(|y| bits[y * 16] == 0xffff) as u8) << 5);
            self.hurts.push(Hurt { at, bits, whole });
            self.hurt[at] = self.hurts.len() as u16;
        }
    }

    /// The damaged block at storage index `i`, if it is one.
    #[inline(always)]
    fn hurt_at(&self, i: usize) -> Option<&Hurt> {
        if self.hurts.is_empty() {
            return None;
        }
        match self.hurt[i] {
            0 => None,
            h => Some(&self.hurts[h as usize - 1]),
        }
    }

    /// Which part of its `side` the block at `q` fills (see `shapes`): nothing, for a damaged block
    /// with that side shot into.
    #[inline(always)]
    fn cover(&self, q: usize, side: usize) -> u16 {
        let c = self.reg.shapes.cover[self.blocks[q] as usize][side];
        if c != 0 {
            if let Some(h) = self.hurt_at(q) {
                if h.whole & (1 << side) == 0 {
                    return 0;
                }
            }
        }
        c
    }

    fn light_sky(&mut self) {
        let top = self.top;
        let Mesher { blocks, sky, queue, low, reg, .. } = self;
        // Everything at or above `top` is open sky.
        sky[..(top + 1) * SY].fill(0);
        sky[(top + 1) * SY..].fill(15);
        queue.clear();
        for z in 0..RW {
            for x in 0..RW {
                let base = z * SZ + x;
                let mut y = top as isize - 1;
                while y >= 0 {
                    let i = (y as usize + 1) * SY + base;
                    let op = reg.opacity[blocks[i] as usize];
                    if op == 0 {
                        sky[i] = 15;
                        y -= 1;
                        continue;
                    }
                    if op < 15 {
                        sky[i] = 15 - op;
                        queue.push(i as u32);
                    } else if reg.lit_inside[blocks[i] as usize] == 1 {
                        sky[i] = 15;
                    }
                    break;
                }
                low[base] = (y + 1) as u16;
            }
        }
        // Seed horizontal spread where a neighbouring column's sky column starts higher.
        for z in 0..RW {
            for x in 0..RW {
                let base = z * SZ + x;
                let l = low[base];
                let mut m = l;
                if x > 0 {
                    m = m.max(low[base - 1]);
                }
                if x + 1 < RW {
                    m = m.max(low[base + 1]);
                }
                if z > 0 {
                    m = m.max(low[base - SZ]);
                }
                if z + 1 < RW {
                    m = m.max(low[base + SZ]);
                }
                for y in l..m {
                    queue.push(((y as usize + 1) * SY + base) as u32);
                }
            }
        }
        bfs(reg, blocks, sky, queue);
    }

    fn light_block(&mut self) {
        let top = self.top;
        let Mesher { blocks, blk, queue, emits, reg, .. } = self;
        blk.fill(0);
        queue.clear();
        for k in 0..9 {
            let e = emits[k];
            if e == 0 {
                continue;
            }
            let xo = (k % 3) * 16;
            let zo = (k / 3) * 16;
            for s in 0..16 {
                if e & (1 << s) == 0 {
                    continue;
                }
                for y in 0..16 {
                    for z in 0..16 {
                        let row = ri(xo, s * 16 + y + 1, zo + z);
                        for x in 0..16 {
                            let i = row + x;
                            let em = reg.emit[blocks[i] as usize];
                            if em > 0 {
                                blk[i] = em;
                                queue.push(i as u32);
                            }
                        }
                    }
                }
            }
        }
        let _ = top;
        bfs(reg, blocks, blk, queue);
    }

    #[inline(always)]
    fn corners(&self, q: usize, face: usize) -> [Corner; 4] {
        let du = U_OFF[face];
        let dv = V_OFF[face];
        let b = &self.blocks;
        let opaque = &self.reg.opaque;
        let mut out = [Corner { ao: 3, sky: 0, blk: 0 }; 4];
        for (k, &(su, sv)) in CORNER_SIGNS.iter().enumerate() {
            let s1 = (q as isize + su * du) as usize;
            let s2 = (q as isize + sv * dv) as usize;
            let c = (q as isize + su * du + sv * dv) as usize;
            let o1 = opaque[b[s1] as usize];
            let o2 = opaque[b[s2] as usize];
            let oc = opaque[b[c] as usize];
            let both = o1 & o2;
            let ao = if both == 1 { 0 } else { 3 - (o1 + o2 + oc) };
            let mut ss = self.sky[q] as u32;
            let mut sb = self.blk[q] as u32;
            let mut n = 1u32;
            if o1 == 0 {
                ss += self.sky[s1] as u32;
                sb += self.blk[s1] as u32;
                n += 1;
            }
            if o2 == 0 {
                ss += self.sky[s2] as u32;
                sb += self.blk[s2] as u32;
                n += 1;
            }
            if oc == 0 && both == 0 {
                ss += self.sky[c] as u32;
                sb += self.blk[c] as u32;
                n += 1;
            }
            out[k] = Corner { ao, sky: ((ss * 4 + n / 2) / n) as u8, blk: ((sb * 4 + n / 2) / n) as u8 };
        }
        out
    }

    fn build(&mut self) {
        for o in self.out.iter_mut() {
            o.clear();
        }
        let center = self.masks[4];
        for s in 0..16 {
            for l in 0..3 {
                self.sec_start[l][s] = (self.out[l].len() / 8) as u32;
            }
            if center & (1 << s) == 0 {
                self.sec_info[s] = ALL_CONNECTED;
                continue;
            }
            let (sunlit, opaque_count) = self.mesh_section(s);
            let conn = if opaque_count == 0 {
                ALL_CONNECTED
            } else if opaque_count == 4096 {
                0
            } else {
                self.connectivity(s)
            };
            self.sec_info[s] = conn | ((sunlit as u32) << 16) | (1 << 17);
        }
        for l in 0..3 {
            self.sec_start[l][16] = (self.out[l].len() / 8) as u32;
        }
    }

    /// Returns (sunlit, opaque block count).
    fn mesh_section(&mut self, s: usize) -> (bool, u32) {
        let mut sunlit = false;
        let mut opaque_count = 0u32;
        let reg = self.reg;
        let shapes = &reg.shapes;
        self.slice_used = [false; 96];
        let y0 = s * 16;
        for ly in 0..16 {
            let y = y0 + ly;
            for lz in 0..16 {
                for lx in 0..16 {
                    let i = ri(16 + lx, y + 1, 16 + lz);
                    let b = self.blocks[i];
                    if b == AIR {
                        continue;
                    }
                    let shape = reg.shape[b as usize];
                    let def = &reg.blocks[b as usize];
                    if shape == SHAPE_CUBE && def.layer == Layer::Opaque && self.hurt_at(i).is_some() {
                        // Shot at: what's left of it (the culler looks through it).
                        if self.mesh_damaged(i, lx, y, lz, def) {
                            sunlit = true;
                        }
                        continue;
                    }
                    if reg.opaque[b as usize] == 1 {
                        opaque_count += 1;
                    }
                    match shape {
                        SHAPE_CUBE if def.layer == Layer::Opaque => {
                            for f in 0..6 {
                                let q = (i as isize + FACE_OFF[f]) as usize;
                                if self.cover(q, OPPOSITE[f]) == FULL_SIDE {
                                    continue;
                                }
                                let c = self.corners(q, f);
                                if c.iter().any(|c| c.sky > 0) {
                                    sunlit = true;
                                }
                                let tex = def.tex[f] as u32;
                                let uvt = def.uvt[f] as u32;
                                let (slice, u, v) = match f {
                                    0 | 1 => (lx, lz, ly),
                                    2 | 3 => (ly, lx, lz),
                                    _ => (lz, lx, ly),
                                };
                                if c[0] == c[1] && c[0] == c[2] && c[0] == c[3] {
                                    let key = (1u32 << 31)
                                        | tex
                                        | ((def.tint as u32) << 12)
                                        | ((c[0].ao as u32) << 13)
                                        | ((c[0].sky as u32) << 15)
                                        | ((c[0].blk as u32) << 21)
                                        | (uvt << 27);
                                    let si = f * 16 + slice;
                                    self.greedy[si * 256 + v * 16 + u] = key;
                                    self.slice_used[si] = true;
                                } else {
                                    let plane = slice + if f % 2 == 0 { 1 } else { 0 };
                                    let tint = def.tint as u32;
                                    emit_quad(&mut self.out[0], f, plane, u, v, u + 1, v + 1, y0, &c, tex, tint, uvt, [0; 4], 0);
                                }
                            }
                        }
                        SHAPE_CUBE => {
                            // Cutout cube: leaves / glass.
                            for f in 0..6 {
                                let q = (i as isize + FACE_OFF[f]) as usize;
                                let nb = self.blocks[q];
                                if self.cover(q, OPPOSITE[f]) == FULL_SIDE {
                                    continue;
                                }
                                if def.cull_self && nb == b {
                                    continue;
                                }
                                if def.leaves && reg.blocks[nb as usize].leaves && f % 2 == 1 {
                                    continue;
                                }
                                let c = self.corners(q, f);
                                if c.iter().any(|c| c.sky > 0) {
                                    sunlit = true;
                                }
                                let (slice, u, v) = match f {
                                    0 | 1 => (lx, lz, ly),
                                    2 | 3 => (ly, lx, lz),
                                    _ => (lz, lx, ly),
                                };
                                let plane = slice + if f % 2 == 0 { 1 } else { 0 };
                                let anim = def.anim;
                                emit_quad(&mut self.out[1], f, plane, u, v, u + 1, v + 1, y0, &c, def.tex[f] as u32, def.tint as u32, def.uvt[f] as u32, [anim; 4], CUTOUT_FLAG);
                            }
                        }
                        SHAPE_CROSS => {
                            let c = Corner { ao: 3, sky: self.sky[i] * 4, blk: self.blk[i] * 4 };
                            if c.sky > 0 {
                                sunlit = true;
                            }
                            emit_cross(&mut self.out[1], lx, y, lz, c, def.tex[0] as u32, def.tint as u32, def.anim);
                        }
                        SHAPE_LIQUID => {
                            let layer = def.layer as usize;
                            let above = self.blocks[i + SY];
                            let surface = above != b;
                            for f in 0..6 {
                                let q = (i as isize + FACE_OFF[f]) as usize;
                                let nb = self.blocks[q];
                                if nb == b || self.cover(q, OPPOSITE[f]) == FULL_SIDE {
                                    continue;
                                }
                                let c = self.corners(q, f);
                                let (slice, u, v) = match f {
                                    0 | 1 => (lx, lz, ly),
                                    2 | 3 => (ly, lx, lz),
                                    _ => (lz, lx, ly),
                                };
                                let plane = slice + if f % 2 == 0 { 1 } else { 0 };
                                let lowered = if !surface {
                                    [0; 4]
                                } else if f == 2 {
                                    [3; 4]
                                } else if f == 3 {
                                    [0; 4]
                                } else {
                                    [0, 0, 3, 3]
                                };
                                emit_quad(&mut self.out[layer], f, plane, u, v, u + 1, v + 1, y0, &c, def.tex[f] as u32, 0, 0, lowered, 0);
                            }
                        }
                        SHAPE_MODEL => {
                            // A fence or pane as it's joined to what's beside it here.
                            let around = || [self.blocks[i - SZ], self.blocks[i + 1], self.blocks[i + SZ], self.blocks[i - 1]];
                            if let Some(m) = shapes.model_at(b, around) {
                                if self.mesh_model(m, def, i, lx, y, lz) {
                                    sunlit = true;
                                }
                            }
                        }
                        _ => {}
                    }
                }
            }
        }
        // Greedy merge uniform opaque faces.
        for si in 0..96 {
            if !self.slice_used[si] {
                continue;
            }
            let f = si / 16;
            let slice = si % 16;
            let plane = slice + if f % 2 == 0 { 1 } else { 0 };
            let m = &mut self.greedy[si * 256..(si + 1) * 256];
            for v in 0..16 {
                let mut u = 0;
                while u < 16 {
                    let k = m[v * 16 + u];
                    if k == 0 {
                        u += 1;
                        continue;
                    }
                    let mut w = 1;
                    while u + w < 16 && m[v * 16 + u + w] == k {
                        w += 1;
                    }
                    let mut h = 1;
                    'grow: while v + h < 16 {
                        for d in 0..w {
                            if m[(v + h) * 16 + u + d] != k {
                                break 'grow;
                            }
                        }
                        h += 1;
                    }
                    for dv in 0..h {
                        for du in 0..w {
                            m[(v + dv) * 16 + u + du] = 0;
                        }
                    }
                    let c = Corner { ao: ((k >> 13) & 3) as u8, sky: ((k >> 15) & 63) as u8, blk: ((k >> 21) & 63) as u8 };
                    emit_quad(&mut self.out[0], f, plane, u, v, u + w, v + h, y0, &[c; 4], k & 1023, (k >> 12) & 1, (k >> 27) & 7, [0; 4], 0);
                    u += w;
                }
            }
        }
        (sunlit, opaque_count)
    }

    /// Emit a block model's boxes. Returns whether the sky lights any of it.
    #[allow(clippy::too_many_arguments)]
    fn mesh_model(&mut self, m: &Model, def: &Block, i: usize, lx: usize, y: usize, lz: usize) -> bool {
        let layer = if def.layer == Layer::Opaque { 0 } else { 1 };
        let flags = if layer == 1 { CUTOUT_FLAG } else { 0 };
        let own = Corner { ao: 3, sky: self.sky[i] * 4, blk: self.blk[i] * 4 };
        let cell = [lx as u32, y as u32, lz as u32];
        let mut sunlit = false;
        for p in &m.parts {
            for f in 0..6 {
                let face = p.faces[f];
                if face.tex == NO_TEX {
                    continue;
                }
                let q = (i as isize + FACE_OFF[f]) as usize;
                let nb = self.blocks[q] as usize;
                // Against the cell's side: hidden if the neighbour fills that part of it.
                if on_side(p, f) && (side_mask(p, f, false) & !self.cover(q, OPPOSITE[f])) == 0 {
                    continue;
                }
                // Lit smoothly from the cell it faces, like a cube face; from its own cell where
                // that one's solid (under a top slab) and for small things (torches).
                let c = if m.flat_light || self.reg.opaque[nb] == 1 { [own; 4] } else { self.corners(q, f) };
                if c.iter().any(|c| c.sky > 0) {
                    sunlit = true;
                }
                emit_fine(&mut self.out[layer], f, p, cell, &c, face.tex as u32, def.tint as u32, face.uvt as u32, flags);
            }
        }
        sunlit
    }

    /// What hides each little voxel face on side `f` of the damaged block at `i`: the next block's
    /// little voxels against it if it's damaged too, else the part of its side it fills. 16 rows
    /// of 16 bits over that side: +-X rows of y, bits of z; +-Y rows of z, bits of x; +-Z rows of
    /// y, bits of x (the axes of `side_axes`).
    fn hiding(&self, i: usize, f: usize) -> [u16; 16] {
        let q = (i as isize + FACE_OFF[f]) as usize;
        let b = self.blocks[q] as usize;
        if let Some(h) = self.hurt_at(q).filter(|_| self.reg.shape[b] == SHAPE_CUBE && self.reg.blocks[b].layer == Layer::Opaque) {
            let nb = &h.bits;
            let column = |bit: u32, k: usize| (0..16).fold(0u16, |m, z| m | (((nb[k * 16 + z] >> bit) & 1) << z));
            return std::array::from_fn(|k| match f {
                0 => column(0, k),
                1 => column(15, k),
                2 => nb[k],
                3 => nb[240 + k],
                4 => nb[k * 16],
                _ => nb[k * 16 + 15],
            });
        }
        let c = self.reg.shapes.cover[b][OPPOSITE[f]];
        match c {
            FULL_SIDE => [0xffff; 16],
            0 => [0; 16],
            // The 4 x 4 grid over the side: `a` along the bits, `b` down the rows.
            _ => std::array::from_fn(|k| (0..4).fold(0u16, |m, a| if (c >> ((k / 4) * 4 + a)) & 1 == 1 { m | (0xf << (a * 4)) } else { m })),
        }
    }

    /// A damaged block: the faces of its little voxels that show (where the next one along is
    /// gone, inside it; on its sides, where the next block doesn't hide them), merged into
    /// rectangles slice by slice and drawn as fine quads in the block's own texture, so a chip
    /// shows the pixels it cut through. Faces on its sides are lit like a whole block's (smoothly,
    /// from the cell they face); faces inside it by the light that reaches in. Returns whether the
    /// sky lights any of it.
    fn mesh_damaged(&mut self, i: usize, lx: usize, y: usize, lz: usize, def: &Block) -> bool {
        let bits = self.hurts[self.hurt[i] as usize - 1].bits;
        let hide: [[u16; 16]; 6] = std::array::from_fn(|f| self.hiding(i, f));
        // Faces showing, per direction, in the bits' layout.
        let mut show = [[0u16; 256]; 6];
        for yy in 0..16 {
            for zz in 0..16 {
                let r = yy * 16 + zz;
                let row = bits[r];
                if row == 0 {
                    continue;
                }
                let px = if (hide[0][yy] >> zz) & 1 == 0 { 0x8000 } else { 0 };
                let nx = if (hide[1][yy] >> zz) & 1 == 0 { 1 } else { 0 };
                show[0][r] = row & !(row >> 1) & (0x7fff | px);
                show[1][r] = row & !(row << 1) & (0xfffe | nx);
                show[2][r] = row & !if yy < 15 { bits[r + 16] } else { hide[2][zz] };
                show[3][r] = row & !if yy > 0 { bits[r - 16] } else { hide[3][zz] };
                show[4][r] = row & !if zz < 15 { bits[r + 1] } else { hide[4][yy] };
                show[5][r] = row & !if zz > 0 { bits[r - 1] } else { hide[5][yy] };
            }
        }
        // Light inside: what reaches in from the open cells around it, on average, and shaded as
        // a hollow is (the shadow map is too coarse to darken a pit a few pixels across).
        let (mut sky, mut blk, mut open) = (0u32, 0u32, 0u32);
        for off in FACE_OFF {
            let n = (i as isize + off) as usize;
            if self.reg.opaque[self.blocks[n] as usize] == 0 {
                sky += self.sky[n] as u32;
                blk += self.blk[n] as u32;
                open += 1;
            }
        }
        let avg = |v: u32| if open == 0 { 0 } else { ((v * 4 + open / 2) / open) as u8 };
        let inside = Corner { ao: 2, sky: avg(sky), blk: avg(blk) };
        let cell = [lx as u32, y as u32, lz as u32];
        let mut sunlit = false;
        for f in 0..6 {
            if show[f].iter().all(|&r| r == 0) {
                continue;
            }
            // Slices along the face's normal, each as rows of v, bits of u (`pos`'s axes).
            let mut slices = [[0u16; 16]; 16];
            match f {
                0 | 1 => {
                    for (r, &row) in show[f].iter().enumerate() {
                        let (yy, zz) = (r / 16, r % 16);
                        let mut m = row;
                        while m != 0 {
                            let x = m.trailing_zeros() as usize;
                            m &= m - 1;
                            slices[x][yy] |= 1 << zz;
                        }
                    }
                }
                2 | 3 => {
                    for (s, slice) in slices.iter_mut().enumerate() {
                        slice.copy_from_slice(&show[f][s * 16..s * 16 + 16]);
                    }
                }
                _ => {
                    for (s, slice) in slices.iter_mut().enumerate() {
                        for (yy, row) in slice.iter_mut().enumerate() {
                            *row = show[f][yy * 16 + s];
                        }
                    }
                }
            }
            // On the block's own side: lit smoothly from the cell it faces, like a whole face.
            let q = (i as isize + FACE_OFF[f]) as usize;
            let outer = if self.reg.opaque[self.blocks[q] as usize] == 1 { [inside; 4] } else { self.corners(q, f) };
            let side = if f % 2 == 0 { 15 } else { 0 };
            for (s, grid) in slices.iter_mut().enumerate() {
                if grid.iter().all(|&r| r == 0) {
                    continue;
                }
                let plane = (s + (f % 2 == 0) as usize) as u32;
                let on_side = s == side;
                rectangles(grid, |u0, v0, u1, v1| {
                    let c = if on_side { lerp_corners(&outer, u0, v0, u1, v1) } else { [inside; 4] };
                    if c.iter().any(|c| c.sky > 0) {
                        sunlit = true;
                    }
                    emit_fine_rect(&mut self.out[0], f, cell, plane, [u0, v0, u1, v1], &c, def.tex[f] as u32, def.tint as u32, def.uvt[f] as u32, 0);
                });
            }
        }
        sunlit
    }

    /// Which pairs of section faces are connected through non-opaque blocks.
    fn connectivity(&mut self, s: usize) -> u32 {
        let Mesher { blocks, visited, stack, reg, hurts, hurt, .. } = self;
        visited.fill(0);
        let y0 = s * 16;
        // A damaged block may have a hole through it: the culler looks through it.
        let opaque_at = |c: usize| -> bool {
            let (x, y, z) = (c & 15, c >> 8, (c >> 4) & 15);
            let i = ri(16 + x, y0 + y + 1, 16 + z);
            reg.opaque[blocks[i] as usize] == 1 && (hurts.is_empty() || hurt[i] == 0)
        };
        let mut conn = 0u32;
        for start in 0..4096usize {
            if visited[start] != 0 {
                continue;
            }
            visited[start] = 1;
            if opaque_at(start) {
                continue;
            }
            let mut faces = 0u8;
            stack.clear();
            stack.push(start as u16);
            while let Some(c) = stack.pop() {
                let c = c as usize;
                let (x, y, z) = (c & 15, c >> 8, (c >> 4) & 15);
                faces |= ((x == 15) as u8)
                    | (((x == 0) as u8) << 1)
                    | (((y == 15) as u8) << 2)
                    | (((y == 0) as u8) << 3)
                    | (((z == 15) as u8) << 4)
                    | (((z == 0) as u8) << 5);
                let mut nbs = [usize::MAX; 6];
                if x < 15 {
                    nbs[0] = c + 1;
                }
                if x > 0 {
                    nbs[1] = c - 1;
                }
                if y < 15 {
                    nbs[2] = c + 256;
                }
                if y > 0 {
                    nbs[3] = c - 256;
                }
                if z < 15 {
                    nbs[4] = c + 16;
                }
                if z > 0 {
                    nbs[5] = c - 16;
                }
                for n in nbs {
                    if n != usize::MAX && visited[n] == 0 {
                        visited[n] = 1;
                        if !opaque_at(n) {
                            stack.push(n as u16);
                        }
                    }
                }
            }
            for i in 0..6 {
                if faces & (1 << i) == 0 {
                    continue;
                }
                for j in (i + 1)..6 {
                    if faces & (1 << j) != 0 {
                        conn |= 1 << PAIR[i][j];
                    }
                }
            }
            if conn == ALL_CONNECTED {
                break;
            }
        }
        conn
    }

    fn assemble(&self) -> Vec<u32> {
        let total: usize = self.out.iter().map(|o| o.len()).sum();
        let mut v = Vec::with_capacity(MESH_HEADER + total);
        v.resize(MESH_HEADER, 0);
        v[0] = MESH_HEADER as u32;
        for l in 0..3 {
            v[1 + l] = (self.out[l].len() / 8) as u32;
        }
        for s in 0..17 {
            for l in 0..3 {
                v[4 + s * 3 + l] = self.sec_start[l][s];
            }
        }
        for s in 0..16 {
            v[55 + s] = self.sec_info[s];
        }
        for o in &self.out {
            v.extend_from_slice(o);
        }
        v
    }
}

fn bfs(reg: &Registry, blocks: &[u8], light: &mut [u8], queue: &mut Vec<u32>) {
    let mut head = 0;
    while head < queue.len() {
        let i = queue[head] as usize;
        head += 1;
        let l = light[i];
        if l <= 1 {
            continue;
        }
        let x = i % RW;
        let z = (i / RW) % RW;
        let y = i / SY;
        let mut visit = |n: usize, queue: &mut Vec<u32>| {
            let b = blocks[n] as usize;
            let op = reg.opacity[b];
            if op >= 15 {
                // A slab or stairs: lit, but the light goes no further.
                if reg.lit_inside[b] == 1 && l - 1 > light[n] {
                    light[n] = l - 1;
                }
                return;
            }
            let nl = l as i32 - (op.max(1)) as i32;
            if nl > light[n] as i32 {
                light[n] = nl as u8;
                queue.push(n as u32);
            }
        };
        if x > 0 {
            visit(i - 1, queue);
        }
        if x + 1 < RW {
            visit(i + 1, queue);
        }
        if z > 0 {
            visit(i - SZ, queue);
        }
        if z + 1 < RW {
            visit(i + SZ, queue);
        }
        if y > 1 {
            visit(i - SY, queue);
        }
        if y + 1 < LAYERS {
            visit(i + SY, queue);
        }
    }
}

#[inline(always)]
fn pos(face: usize, plane: usize, u: usize, v: usize) -> (u32, u32, u32) {
    match face {
        0 | 1 => (plane as u32, v as u32, u as u32),
        2 | 3 => (u as u32, plane as u32, v as u32),
        _ => (u as u32, v as u32, plane as u32),
    }
}

#[inline(always)]
fn brightness(c: &Corner) -> u32 {
    c.ao as u32 * 30 + c.sky.max(c.blk) as u32
}

/// Emit one quad. (u0, v0)..(u1, v1) are section-local face-plane coordinates; `y0` is the section
/// base height (added to the y axis). `corners` and `anim` follow the (u, v) corner order.
#[allow(clippy::too_many_arguments)]
#[inline(always)]
fn emit_quad(
    out: &mut Vec<u32>,
    face: usize,
    plane: usize,
    u0: usize,
    v0: usize,
    u1: usize,
    v1: usize,
    y0: usize,
    corners: &[Corner; 4],
    tex: u32,
    tint: u32,
    uvt: u32,
    anim: [u8; 4],
    flags: u32,
) {
    let uv = [(u0, v0), (u1, v0), (u1, v1), (u0, v1)];
    let mut order: [usize; 4] = if REVERSE[face] { [0, 3, 2, 1] } else { [0, 1, 2, 3] };
    let b = |k: usize| brightness(&corners[order[k]]);
    if b(0) + b(2) > b(1) + b(3) {
        order = [order[1], order[2], order[3], order[0]];
    }
    for &k in &order {
        let (u, v) = uv[k];
        let (x, mut y, z) = pos(face, plane, u, v);
        y += y0 as u32;
        let c = &corners[k];
        // Corner side along u / v (bits 27, 28) lets the shader expand quads a hair to hide
        // T-junction cracks between greedy-merged faces.
        let side = (((k == 1 || k == 2) as u32) << 27) | (((k >= 2) as u32) << 28);
        let w0 = x | (z << 5) | (y << 10) | ((face as u32) << 19) | ((c.ao as u32) << 22) | ((anim[k] as u32) << 24) | (tint << 26) | side | flags | ((uvt & 1) << 31);
        let w1 = tex | ((uvt >> 1) << 10) | ((c.sky as u32) << 12) | ((c.blk as u32) << 18);
        out.push(w0);
        out.push(w1);
    }
}

/// Emit one face of a model box in block `cell` (x and z section-local, y absolute).
/// `corners` follow the (u, v) corner order, like `emit_quad`.
#[allow(clippy::too_many_arguments)]
fn emit_fine(out: &mut Vec<u32>, face: usize, p: &Cuboid, cell: [u32; 3], corners: &[Corner; 4], tex: u32, tint: u32, uvt: u32, flags: u32) {
    let lo = [p.from[0] as u32, p.from[1] as u32, p.from[2] as u32];
    let hi = [p.to[0] as u32, p.to[1] as u32, p.to[2] as u32];
    // The face's plane and its (u, v) extent, laid out as `pos` reads them.
    let (plane, u0, v0, u1, v1) = match face {
        0 => (hi[0], lo[2], lo[1], hi[2], hi[1]),
        1 => (lo[0], lo[2], lo[1], hi[2], hi[1]),
        2 => (hi[1], lo[0], lo[2], hi[0], hi[2]),
        3 => (lo[1], lo[0], lo[2], hi[0], hi[2]),
        4 => (hi[2], lo[0], lo[1], hi[0], hi[1]),
        _ => (lo[2], lo[0], lo[1], hi[0], hi[1]),
    };
    emit_fine_rect(out, face, cell, plane, [u0, v0, u1, v1], corners, tex, tint, uvt, flags);
}

/// Emit one fine quad in block `cell`: on `plane` (sixteenths along the face's normal), over
/// `rect` = [u0, v0, u1, v1] in sixteenths along the face (the axes `pos` reads).
#[allow(clippy::too_many_arguments)]
fn emit_fine_rect(out: &mut Vec<u32>, face: usize, cell: [u32; 3], plane: u32, rect: [u32; 4], corners: &[Corner; 4], tex: u32, tint: u32, uvt: u32, flags: u32) {
    let [u0, v0, u1, v1] = rect;
    let uv = [(u0, v0), (u1, v0), (u1, v1), (u0, v1)];
    let mut order: [usize; 4] = if REVERSE[face] { [0, 3, 2, 1] } else { [0, 1, 2, 3] };
    let b = |k: usize| brightness(&corners[order[k]]);
    if b(0) + b(2) > b(1) + b(3) {
        order = [order[1], order[2], order[3], order[0]];
    }
    for &k in &order {
        let (u, v) = uv[k];
        let (ox, oy, oz) = pos(face, plane as usize, u as usize, v as usize);
        let c = &corners[k];
        let w0 = cell[0]
            | ((ox >> 4) << 4)
            | (cell[2] << 5)
            | ((oz >> 4) << 9)
            | (cell[1] << 10)
            | ((oy >> 4) << 18)
            | ((face as u32) << 19)
            | ((c.ao as u32) << 22)
            | ((oy & 3) << 24)
            | (tint << 26)
            | (((oy >> 2) & 3) << 27)
            | flags
            | FINE_FLAG
            | ((uvt & 1) << 31);
        let w1 = tex | ((uvt >> 1) << 10) | ((c.sky as u32) << 12) | ((c.blk as u32) << 18) | ((ox & 15) << 24) | ((oz & 15) << 28);
        out.push(w0);
        out.push(w1);
    }
}

/// Split a 16 x 16 grid of set bits (rows of v, bits of u) into rectangles, greedily: a run along
/// u, grown down v as far as every row has it. Calls `emit(u0, v0, u1, v1)` for each; the grid
/// is left empty.
fn rectangles(grid: &mut [u16; 16], mut emit: impl FnMut(u32, u32, u32, u32)) {
    for v in 0..16 {
        while grid[v] != 0 {
            let u0 = grid[v].trailing_zeros();
            let w = (grid[v] >> u0).trailing_ones();
            let run = (((1u32 << w) - 1) << u0) as u16;
            let mut v1 = v + 1;
            while v1 < 16 && grid[v1] & run == run {
                v1 += 1;
            }
            for row in &mut grid[v..v1] {
                *row &= !run;
            }
            emit(u0, v as u32, u0 + w, v1 as u32);
        }
    }
}

/// A whole face's corner light (`Mesher::corners`, in its (u, v) corner order) at the corners of
/// the part of it in `u0..u1`, `v0..v1` (sixteenths), blended across the face.
fn lerp_corners(c: &[Corner; 4], u0: u32, v0: u32, u1: u32, v1: u32) -> [Corner; 4] {
    let at = |u: u32, v: u32| {
        let (fu, fv) = (u as f32 / 16.0, v as f32 / 16.0);
        let w = [(1.0 - fu) * (1.0 - fv), fu * (1.0 - fv), fu * fv, (1.0 - fu) * fv];
        let mix = |g: &dyn Fn(&Corner) -> u8| (0..4).map(|k| w[k] * g(&c[k]) as f32).sum::<f32>().round() as u8;
        Corner { ao: mix(&|c| c.ao), sky: mix(&|c| c.sky), blk: mix(&|c| c.blk) }
    };
    [at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1)]
}

#[allow(clippy::too_many_arguments)]
fn emit_cross(out: &mut Vec<u32>, lx: usize, y: usize, lz: usize, c: Corner, tex: u32, tint: u32, anim: u8) {
    let (x, y, z) = (lx as u32, y as u32, lz as u32);
    // (dx, dz) of the bottom two corners for each diagonal plane; top corners repeat them.
    let planes: [(u32, [(u32, u32); 2]); 2] = [(6, [(0, 0), (1, 1)]), (7, [(1, 0), (0, 1)])];
    for (normal, ends) in planes {
        let verts = [(ends[0], 0u32), (ends[1], 0u32), (ends[1], 1u32), (ends[0], 1u32)];
        for ((dx, dz), dy) in verts {
            let a = if dy == 1 && anim == 2 { 2 } else { 0 };
            let w0 = (x + dx)
                | ((z + dz) << 5)
                | ((y + dy) << 10)
                | (normal << 19)
                | ((c.ao as u32) << 22)
                | (a << 24)
                | (tint << 26)
                | (dx << 27)
                | (dz << 28)
                | CUTOUT_FLAG;
            let w1 = tex | ((c.sky as u32) << 12) | ((c.blk as u32) << 18);
            out.push(w0);
            out.push(w1);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::gen::Generator;
    use crate::world::World;

    fn region_for(g: &mut Generator, w: &mut World, cx: i32, cz: i32) -> Vec<u8> {
        for dz in -1..=1 {
            for dx in -1..=1 {
                if !w.has_column(cx + dx, cz + dz) {
                    let d = g.generate(cx + dx, cz + dz);
                    w.insert_column(cx + dx, cz + dz, &d);
                }
            }
        }
        w.extract_region(cx, cz)
    }

    #[test]
    fn mesh_flat_region() {
        // Single stone layer at y = 0 everywhere, torch in the middle of the centre column.
        let mut data = vec![0u8; REGION_HEADER];
        for k in 0..9 {
            data[k * 4] = 1;
        }
        for k in 0..9 {
            let mut sec = vec![0u8; 4096];
            for i in 0..256 {
                sec[i] = STONE;
            }
            if k == 4 {
                sec[(1 * 16 + 8) * 16 + 8] = TORCH_B;
                data[k * 4 + 2] = 1;
            }
            data.extend_from_slice(&sec);
        }
        let mut m = Mesher::new();
        let out = m.mesh(&data);
        let opaque = out[1];
        assert!(opaque > 0 && opaque <= 256, "opaque quads {opaque}");
        assert_eq!(out[2], 5, "torch box: 5 faces (the underside is on the stone)");
        // Torch light: block light at the torch cell is 14.
        assert_eq!(m.blk[ri(24, 2, 24)], 14);
        assert_eq!(m.sky[ri(24, 5, 24)], 15);
    }

    #[test]
    fn greedy_merges_flat_layer() {
        let mut data = vec![0u8; REGION_HEADER];
        for k in 0..9 {
            data[k * 4] = 1;
        }
        for _ in 0..9 {
            let mut sec = vec![0u8; 4096];
            for i in 0..256 {
                sec[i] = STONE;
            }
            data.extend_from_slice(&sec);
        }
        let mut m = Mesher::new();
        let out = m.mesh(&data);
        assert_eq!(out[1], 1, "one merged top quad");
        // The stone floor seals the -Y face; every other pair of faces is connected.
        let conn = out[55] & ALL_CONNECTED;
        assert_eq!(conn.count_ones(), 10);
        assert!(conn & (1 << PAIR[0][1]) != 0 && conn & (1 << PAIR[2][3]) == 0);
    }

    /// A stone floor across the region with `b` standing on it in the middle of the centre column.
    fn floor_with(b: u8, emits: bool) -> Vec<u8> {
        let mut data = vec![0u8; REGION_HEADER];
        for k in 0..9 {
            data[k * 4] = 1;
        }
        for k in 0..9 {
            let mut sec = vec![0u8; 4096];
            sec[..256].fill(STONE);
            if k == 4 {
                sec[(16 + 8) * 16 + 8] = b;
                data[k * 4 + 2] = emits as u8;
            }
            data.extend_from_slice(&sec);
        }
        data
    }

    #[test]
    fn game_blocks_mesh_like_built_in_ones() {
        // A game's copy of a neon block (its textures and light) meshes exactly like the original.
        let t = crate::blocks::tex::NEON_RED;
        let json = format!(r#"[{{"name":"my_neon","tex":[{t},{t},{t},{t},{t},{t}],"emit":12}},{{"name":"crate","tex":[113,113,114,114,113,113]}}]"#);
        crate::blocks::set_game_blocks(&json).unwrap();
        let neon_red = BLOCKS.iter().position(|b| b.name == "neon_red").unwrap() as u8;
        let mut m = Mesher::new();
        let neon = m.mesh(&floor_with(neon_red, true));
        let blk = m.blk[ri(24, 2, 24)];
        let copy = m.mesh(&floor_with(GAME_FIRST as u8, true));
        assert_eq!(blk, 12, "the neon lights its cell");
        assert_eq!(m.blk[ri(24, 2, 24)], 12, "and so does the copy");
        assert!(neon == copy, "the copy's mesh differs from the neon's");
        // A block with textures of its own: its quads use them.
        let out = m.mesh(&floor_with(GAME_FIRST as u8 + 1, false));
        let layers: std::collections::HashSet<u32> = out[MESH_HEADER..].chunks(2).map(|v| v[1] & 1023).collect();
        assert!(layers.contains(&113) && layers.contains(&114), "crate textures: {layers:?}");
        crate::blocks::set_game_blocks("[]").unwrap();
    }

    /// FNV-1a over a mesh's words: a fingerprint of the exact bytes.
    fn fingerprint(out: &[u32]) -> u64 {
        let mut h: u64 = 0xcbf2_9ce4_8422_2325;
        for w in out {
            for b in w.to_le_bytes() {
                h = (h ^ b as u64).wrapping_mul(0x100_0000_01b3);
            }
        }
        h
    }

    /// Generated hills (seed 99) with a crafted corner: every kind of block beside every other
    /// (stone, glass, leaves, water, slabs, stairs, a bed, torches, logs on their sides).
    fn zoo() -> (World, Vec<(i32, i32)>) {
        let mut g = Generator::new(99);
        let mut w = World::new();
        for cz in -1..=4 {
            for cx in -1..=4 {
                let d = g.generate(cx, cz);
                w.insert_column(cx, cz, &d);
            }
        }
        let kinds = [STONE, GLASS_B, OAK_LEAVES_B, WATER_B, slab_id(0, false), slab_id(0, true), stairs_id(0, 1, false), stairs_id(0, 2, true), bed_id(0, 1, true), TORCH_B, WALL_TORCH_B + 2, log_id(0, 0), log_id(0, 2), GLOWSTONE_B, GRASS, AIR];
        for y in 150..154 {
            for z in 0..16 {
                for x in 0..16 {
                    let k = ((x * 7 + z * 3 + y * 5) as usize) % kinds.len();
                    w.set(x, y, z, kinds[k]);
                }
            }
        }
        let cols = (0..4).flat_map(|cz| (0..4).map(move |cx| (cx, cz))).collect();
        (w, cols)
    }

    /// The meshes of `zoo`'s 16 columns, made before blocks could be damaged.
    const ZOO_PRINTS: [u64; 16] = [
        0x40056ba74006f289,
        0x7fb494aaaf9cd9d8,
        0x50c3637ac45d5d47,
        0x2a44aaf03d9016aa,
        0x765cb23431950c57,
        0xf923284e7ad75c9b,
        0x8cb63e9d9d3efbf,
        0x800ccc6aa9427517,
        0x51d4edbf66b01bb,
        0x8cf8d282ea55eb23,
        0x9b3d6467a51f3548,
        0xad0948e9a7a0f65,
        0xddce55d570a92f5e,
        0x83bbb09adf61acdd,
        0xd2a5d2f5079d5004,
        0x941831181e0a9919,
    ];

    #[test]
    fn undamaged_meshes_are_unchanged() {
        let (mut w, cols) = zoo();
        let mut m = Mesher::new();
        let prints: Vec<u64> = cols.iter().map(|&(cx, cz)| fingerprint(&m.mesh(&w.extract_region(cx, cz)))).collect();
        assert_eq!(prints, ZOO_PRINTS, "undamaged meshes changed");
        // Damage somewhere else (the middle of a column past the edge), and a region with some
        // meshed first by the same mesher: the rest come out exactly as before.
        w.destructible = Some(Box::new(crate::world::Destructible { above: 0, ids: [true; 256] }));
        let top = (0..256).rev().find(|&y| w.get(-8, y, -8) != AIR).unwrap();
        assert!(w.carve([-7.5, top as f64 + 1.0, -7.5], [0.0, -1.0, 0.0], 0.3, 0.6).removed > 0);
        assert!(w.damage_count() > 0);
        m.mesh(&w.extract_region(-1, -1));
        let again: Vec<u64> = cols.iter().map(|&(cx, cz)| fingerprint(&m.mesh(&w.extract_region(cx, cz)))).collect();
        assert_eq!(again, ZOO_PRINTS, "damage elsewhere changed these meshes");
    }

    #[test]
    fn game_shapes_leave_built_in_meshes_alone() {
        // A game's fences, panes, posts, ladders and turned blocks in use: the built-in blocks'
        // meshes are exactly as they were.
        crate::blocks::set_game_blocks(crate::shapes::tests::GAME).unwrap();
        let (w, cols) = zoo();
        let mut m = Mesher::new();
        let prints: Vec<u64> = cols.iter().map(|&(cx, cz)| fingerprint(&m.mesh(&w.extract_region(cx, cz)))).collect();
        assert_eq!(prints, ZOO_PRINTS, "built-in meshes changed with game shapes in use");
        // A fence alone is its post (the floor hides its underside); joined east and west it has
        // two rails each way too, their ends against the post not drawn.
        let fence = crate::shapes::tests::FENCE;
        let alone = m.mesh(&floor_with(fence, false));
        assert_eq!(alone[1], 1 + 5, "the floor and the post");
        let mut row = floor_with(fence, false);
        let at = REGION_HEADER + 4 * 4096 + (16 + 8) * 16;
        row[at + 7] = fence;
        row[at + 9] = fence;
        let joined = m.mesh(&row);
        assert_eq!(joined[1], 1 + 3 * 5 + 2 * 2 * 5 + 4 * 5, "three posts, the ends' rails and the middle's");
        crate::blocks::set_game_blocks("[]").unwrap();
    }

    /// A 3 x 3 of columns, stone up to y = 0 and air above, destructible above the floor.
    fn floor_world() -> World {
        let mut w = World::new();
        for cz in -1..=1 {
            for cx in -1..=1 {
                let mut data = vec![0u8; crate::gen::HEADER_BYTES + 4096];
                data[0] = 1;
                data[crate::gen::HEADER_BYTES..crate::gen::HEADER_BYTES + 256].fill(STONE);
                w.insert_column(cx, cz, &data);
            }
        }
        w.destructible = Some(Box::new(crate::world::Destructible { above: 0, ids: [true; 256] }));
        w
    }

    /// A mesh's opaque quads: per quad its face, whether it's fine, its four vertices' (x, y, z)
    /// in sixteenths within the column (fine) or blocks (cube faces), and its texture layer.
    fn quads(out: &[u32]) -> Vec<(usize, bool, [[u32; 3]; 4], u32)> {
        let n = out[1] as usize;
        (0..n)
            .map(|q| {
                let v = &out[MESH_HEADER + q * 8..MESH_HEADER + q * 8 + 8];
                let fine = v[0] & FINE_FLAG != 0;
                let corners = std::array::from_fn(|k| {
                    let (w0, w1) = (v[k * 2], v[k * 2 + 1]);
                    if fine {
                        let ox = ((w1 >> 24) & 15) | (((w0 >> 4) & 1) << 4);
                        let oy = ((w0 >> 24) & 3) | (((w0 >> 27) & 3) << 2) | (((w0 >> 18) & 1) << 4);
                        let oz = ((w1 >> 28) & 15) | (((w0 >> 9) & 1) << 4);
                        [(w0 & 15) * 16 + ox, ((w0 >> 10) & 255) * 16 + oy, ((w0 >> 5) & 15) * 16 + oz]
                    } else {
                        [w0 & 31, (w0 >> 10) & 511, (w0 >> 5) & 31]
                    }
                });
                (((v[0] >> 19) & 7) as usize, fine, corners, v[1] & 1023)
            })
            .collect()
    }

    /// A quad's area in its face's plane (sixteenths squared for fine ones).
    fn area(c: &[[u32; 3]; 4], face: usize) -> u32 {
        let (a, b) = match face {
            0 | 1 => (1, 2),
            2 | 3 => (0, 2),
            _ => (0, 1),
        };
        let span = |k: usize| c.iter().map(|p| p[k]).max().unwrap() - c.iter().map(|p| p[k]).min().unwrap();
        span(a) * span(b)
    }

    #[test]
    fn damaged_blocks_mesh_what_is_left() {
        let mut w = floor_world();
        // Stone at (8, 1, 8) with bricks east of it: a shot into its top near that side, one into
        // its south face.
        w.set(8, 1, 8, STONE);
        w.set(9, 1, 8, BRICKS_B);
        let mut ids = [true; 256];
        ids[BRICKS_B as usize] = false;
        w.destructible = Some(Box::new(crate::world::Destructible { above: 0, ids }));
        assert!(w.carve([8.9, 2.0, 8.5], [0.0, -1.0, 0.0], 0.15, 0.3).removed > 0);
        assert!(w.carve([8.4, 1.5, 9.0], [0.0, 0.0, -1.0], 0.15, 0.25).removed > 0);
        assert!(w.damage_at(9, 1, 8).is_none(), "bricks aren't destructible here");
        let bits = w.damage_at(8, 1, 8).unwrap().bits;
        let mut m = Mesher::new();
        let out = m.mesh(&w.extract_region(0, 0));
        let qs = quads(&out);
        // Its faces are fine quads in its own texture, at the little voxels' resolution.
        let fine: Vec<_> = qs.iter().filter(|q| q.1).collect();
        assert!(!fine.is_empty() && fine.iter().all(|q| q.3 == crate::blocks::tex::STONE as u32));
        assert!(fine.iter().any(|q| q.2.iter().any(|p| p.iter().any(|&c| c % 16 != 0))), "off the block grid");
        assert!(fine.iter().all(|q| q.2.iter().all(|p| (128..=144).contains(&p[0]) && (16..=32).contains(&p[1]) && (128..=144).contains(&p[2]))), "within its cell");
        // Per direction, their area is exactly the little voxel faces that show: brute force.
        let solid = |x: i32, y: i32, z: i32| -> bool {
            if (0..16).contains(&x) && (0..16).contains(&y) && (0..16).contains(&z) {
                return (bits[y as usize * 16 + z as usize] >> x) & 1 == 1;
            }
            // Outside it: the floor below and the bricks east hide it; the rest is air.
            y < 0 || x > 15
        };
        let dirs = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
        for (f, d) in dirs.iter().enumerate() {
            let mut want = 0;
            for y in 0..16 {
                for z in 0..16 {
                    for x in 0..16 {
                        want += (solid(x, y, z) && !solid(x + d[0], y + d[1], z + d[2])) as u32;
                    }
                }
            }
            let got: u32 = fine.iter().filter(|q| q.0 == f).map(|q| area(&q.2, f)).sum();
            assert_eq!(got, want, "face {f}");
        }
        // The notch in its east side lets the bricks' west face show (a whole cube quad there).
        assert!(qs.iter().any(|q| !q.1 && q.0 == 1 && q.2.iter().all(|p| p[0] == 9)), "the bricks' face behind the notch");
        // The floor under it stays hidden (its underside is whole); nothing else is fine.
        assert_eq!(qs.iter().filter(|q| !q.1 && q.0 == 2 && q.2.iter().all(|p| p[1] == 1)).map(|q| area(&q.2, 2)).sum::<u32>(), 256 - 2);
    }

    #[test]
    fn damaged_column_timing() {
        // Walls along every row of a column, eight high, shot at a thousand times.
        let mut w = floor_world();
        for y in 1..9 {
            for z in (0..16).step_by(2) {
                for x in 0..16 {
                    w.set(x, y, z, STONE);
                }
            }
        }
        let mut m = Mesher::new();
        let whole = w.extract_region(0, 0);
        let mut seed = 7u32;
        let mut rnd = || {
            seed = seed.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            (seed >> 8) as f64 / (1u32 << 24) as f64
        };
        let mut shots = 0;
        while shots < 1000 {
            let (x, y, z) = (rnd() * 16.0, 1.0 + rnd() * 8.0, (rnd() * 8.0).floor() * 2.0);
            let d = [rnd() - 0.5, rnd() - 0.5, 1.0];
            if w.carve([x, y, z], d, 0.1, 0.2).removed > 0 {
                shots += 1;
            }
        }
        let hurt = w.extract_region(0, 0);
        let time = |m: &mut Mesher, r: &[u8]| {
            let t = std::time::Instant::now();
            let mut out = Vec::new();
            for _ in 0..20 {
                out = m.mesh(r);
            }
            (t.elapsed().as_secs_f64() * 1000.0 / 20.0, out[1] + out[2] + out[3])
        };
        let (a, qa) = time(&mut m, &whole);
        let (b, qb) = time(&mut m, &hurt);
        eprintln!("damaged column: {} blocks damaged by {shots} shots, {b:.3} ms/mesh and {qb} quads (whole: {a:.3} ms, {qa} quads; region {} KB)", w.damage_count(), hurt.len() / 1024);
        assert!(qb > qa);
    }

    #[test]
    fn mesh_generated_timing() {
        let mut g = Generator::new(99);
        let mut w = World::new();
        let mut m = Mesher::new();
        let mut regions = vec![];
        for cz in 0..4 {
            for cx in 0..4 {
                regions.push(region_for(&mut g, &mut w, cx, cz));
            }
        }
        let t = std::time::Instant::now();
        let mut quads = 0;
        for r in &regions {
            let out = m.mesh(r);
            quads += out[1] + out[2] + out[3];
        }
        let per = t.elapsed().as_secs_f64() * 1000.0 / regions.len() as f64;
        eprintln!("mesh: {per:.3} ms/column (native), avg quads {}", quads as usize / regions.len());
    }
}
