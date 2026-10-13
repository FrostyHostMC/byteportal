//! Damage: blocks partly shot away.
//!
//! A block that's been hit is a 16 x 16 x 16 grid of little voxels, one per pixel of its texture
//! (the 1/16 grid block models are built on). A block nobody has hit is just a block and costs
//! nothing; the world keeps what's left of each damaged one (`Damage`), sparse per column like its
//! edits, and bodies collide with what's left, rays pass through the holes and the mesher draws it.
//!
//! What's left is a bit per little voxel, 1 where it's still there: a row of 16 along x (bit 0 at
//! x = 0) for each (y, z), row `y * 16 + z`.
//!
//! A change travels as what was taken away, cell by cell (`encode`, `decode`):
//! ```text
//! repeated: x i32 LE, z i32 LE, y u8, then the cell's 4096 bits (index y * 256 + z * 16 + x) as
//!           runs, LEB128, alternately kept and taken, starting with kept, adding up to 4096
//! ```
//! Taking bits away is idempotent (a bit taken twice is just gone), so the same change applied
//! again, or everything missing from a block sent whole to a player who joins late, lands in
//! the same place.

/// Little voxels in a block.
pub const CELLS: u32 = 4096;
/// A row with all 16 little voxels.
const WHOLE_ROW: u16 = 0xffff;

/// What's left of a damaged block.
#[derive(Clone, Debug)]
pub struct Damage {
    /// A bit per little voxel still there (rows of x, row `y * 16 + z`).
    pub bits: [u16; 256],
    /// How many are left.
    pub left: u32,
    /// The bits merged into boxes, in 1/16 of a block within the cell (the format of block models'
    /// bounds): what bodies collide with and rays stop at.
    pub boxes: Vec<[u8; 6]>,
}

impl Damage {
    /// A block with nothing taken yet.
    pub fn whole() -> Damage {
        Damage { bits: [WHOLE_ROW; 256], left: CELLS, boxes: vec![[0, 0, 0, 16, 16, 16]] }
    }

    /// Take away the bits set in `taken`; returns the ones that were still there.
    pub fn take(&mut self, taken: &[u16; 256]) -> [u16; 256] {
        let mut gone = [0u16; 256];
        let mut n = 0;
        for ((row, t), g) in self.bits.iter_mut().zip(taken).zip(gone.iter_mut()) {
            *g = *row & *t;
            n += g.count_ones();
            *row &= !*g;
        }
        if n > 0 {
            self.left -= n;
            self.boxes = merge_boxes(&self.bits);
        }
        gone
    }

    #[inline]
    pub fn solid(&self, x: usize, y: usize, z: usize) -> bool {
        (self.bits[y * 16 + z] >> x) & 1 == 1
    }
}

/// How many bits a mask has set.
pub fn count(bits: &[u16; 256]) -> u32 {
    bits.iter().map(|r| r.count_ones()).sum()
}

/// The little voxels merged greedily into boxes: a run along x, grown along z as far as every
/// row has it, then up as far as every layer has that rectangle.
pub fn merge_boxes(bits: &[u16; 256]) -> Vec<[u8; 6]> {
    let mut left = *bits;
    let mut out = Vec::new();
    for y in 0..16 {
        for z in 0..16 {
            loop {
                let row = left[y * 16 + z];
                if row == 0 {
                    break;
                }
                let x0 = row.trailing_zeros() as usize;
                let w = (row >> x0).trailing_ones() as usize;
                let run = (((1u32 << w) - 1) << x0) as u16;
                let mut z1 = z + 1;
                while z1 < 16 && left[y * 16 + z1] & run == run {
                    z1 += 1;
                }
                let mut y1 = y + 1;
                'up: while y1 < 16 {
                    for zz in z..z1 {
                        if left[y1 * 16 + zz] & run != run {
                            break 'up;
                        }
                    }
                    y1 += 1;
                }
                for yy in y..y1 {
                    for zz in z..z1 {
                        left[yy * 16 + zz] &= !run;
                    }
                }
                out.push([x0 as u8, y as u8, z as u8, (x0 + w) as u8, y1 as u8, z1 as u8]);
            }
        }
    }
    out
}

/// The little voxels of the block at `cell` whose middles are within `r` of the segment from `a`
/// to `b` (world coordinates, blocks): a capsule.
pub fn capsule(cell: [i32; 3], a: [f64; 3], b: [f64; 3], r: f64) -> [u16; 256] {
    let mut out = [0u16; 256];
    let ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    let len2 = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2];
    // Only the part of the cell within the capsule's bounds.
    let span = |k: usize| -> (usize, usize) {
        let lo = (a[k].min(b[k]) - r - cell[k] as f64) * 16.0;
        let hi = (a[k].max(b[k]) + r - cell[k] as f64) * 16.0;
        (lo.floor().clamp(0.0, 16.0) as usize, hi.ceil().clamp(0.0, 16.0) as usize)
    };
    let (x0, x1) = span(0);
    let (y0, y1) = span(1);
    let (z0, z1) = span(2);
    let r2 = r * r;
    for y in y0..y1 {
        for z in z0..z1 {
            let mut row = 0u16;
            for x in x0..x1 {
                let p = [cell[0] as f64 + (x as f64 + 0.5) / 16.0, cell[1] as f64 + (y as f64 + 0.5) / 16.0, cell[2] as f64 + (z as f64 + 0.5) / 16.0];
                let ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
                let t = if len2 > 0.0 { ((ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / len2).clamp(0.0, 1.0) } else { 0.0 };
                let d = [ap[0] - ab[0] * t, ap[1] - ab[1] * t, ap[2] - ab[2] * t];
                if d[0] * d[0] + d[1] * d[1] + d[2] * d[2] <= r2 {
                    row |= 1 << x;
                }
            }
            out[y * 16 + z] = row;
        }
    }
    out
}

/// Smooth value noise in -1..1 at `p` (world coordinates, blocks), its lattice `scale` to a block.
fn value_noise(p: [f64; 3], scale: f64, seed: u32) -> f64 {
    let q = [p[0] * scale, p[1] * scale, p[2] * scale];
    let i = [q[0].floor(), q[1].floor(), q[2].floor()];
    let s = [0, 1, 2].map(|a| {
        let f = q[a] - i[a];
        f * f * (3.0 - 2.0 * f)
    });
    let (x, y, z) = (i[0] as i32, i[1] as i32, i[2] as i32);
    let h = |dx: i32, dy: i32, dz: i32| crate::noise::unit(crate::noise::hash3(seed, x + dx, y + dy, z + dz)) as f64;
    let lerp = |a: f64, b: f64, t: f64| a + (b - a) * t;
    let x00 = lerp(h(0, 0, 0), h(1, 0, 0), s[0]);
    let x10 = lerp(h(0, 1, 0), h(1, 1, 0), s[0]);
    let x01 = lerp(h(0, 0, 1), h(1, 0, 1), s[0]);
    let x11 = lerp(h(0, 1, 1), h(1, 1, 1), s[0]);
    lerp(lerp(x00, x10, s[1]), lerp(x01, x11, s[1]), s[2]) * 2.0 - 1.0
}

/// How far a blast's crater reaches toward `p`, as a change to its radius (-1..1 of its
/// roughness): lumps about a block across, and a grain a few pixels across on them.
pub fn ragged(p: [f64; 3], seed: u32) -> f64 {
    0.7 * value_noise(p, 1.3, seed) + 0.3 * value_noise(p, 4.5, seed ^ 0x5bd1_e995)
}

/// The little voxels of the block at `cell` a blast at `center` takes: those within `radius`,
/// give or take `roughness` of it (a ragged sphere, `ragged`, the same for the same `seed`).
pub fn blast(cell: [i32; 3], center: [f64; 3], radius: f64, roughness: f64, seed: u32) -> [u16; 256] {
    let mut out = [0u16; 256];
    let rough = roughness.clamp(0.0, 0.9);
    let (inner, outer) = (radius * (1.0 - rough), radius * (1.0 + rough));
    // The nearest and furthest points of the cell from the centre: all of it, or none of it, in
    // most cells (only those the crater's edge crosses are worked out voxel by voxel).
    let (mut near, mut far) = (0.0, 0.0);
    for a in 0..3 {
        let (lo, hi) = (cell[a] as f64, cell[a] as f64 + 1.0);
        let n = if center[a] < lo { lo - center[a] } else if center[a] > hi { center[a] - hi } else { 0.0 };
        let f = (center[a] - lo).abs().max((hi - center[a]).abs());
        near += n * n;
        far += f * f;
    }
    if near.sqrt() > outer {
        return out;
    }
    if far.sqrt() < inner {
        return [0xffff; 256];
    }
    for y in 0..16 {
        for z in 0..16 {
            let mut row = 0u16;
            for x in 0..16 {
                let p = [cell[0] as f64 + (x as f64 + 0.5) / 16.0, cell[1] as f64 + (y as f64 + 0.5) / 16.0, cell[2] as f64 + (z as f64 + 0.5) / 16.0];
                let d = ((p[0] - center[0]).powi(2) + (p[1] - center[1]).powi(2) + (p[2] - center[2]).powi(2)).sqrt();
                if d > outer {
                    continue;
                }
                if d <= inner || d <= radius * (1.0 + rough * ragged(p, seed)) {
                    row |= 1 << x;
                }
            }
            out[y * 16 + z] = row;
        }
    }
    out
}

fn varint(out: &mut Vec<u8>, mut v: u32) {
    while v >= 0x80 {
        out.push((v as u8) | 0x80);
        v >>= 7;
    }
    out.push(v as u8);
}

fn read_varint(data: &[u8], o: &mut usize) -> Option<u32> {
    let mut v = 0u32;
    for shift in (0..35).step_by(7) {
        let b = *data.get(*o)?;
        *o += 1;
        v |= ((b & 0x7f) as u32) << shift;
        if b & 0x80 == 0 {
            return Some(v);
        }
    }
    None
}

/// Write one cell's change: the bits taken from it.
pub fn encode(out: &mut Vec<u8>, cell: [i32; 3], taken: &[u16; 256]) {
    out.extend_from_slice(&cell[0].to_le_bytes());
    out.extend_from_slice(&cell[2].to_le_bytes());
    out.push(cell[1] as u8);
    // Runs of kept bits (false) and taken ones (true), kept first.
    let mut taking = false;
    let mut run = 0u32;
    for &row in taken {
        // Whole rows of the run going on are the usual case.
        if row == if taking { WHOLE_ROW } else { 0 } {
            run += 16;
            continue;
        }
        for x in 0..16 {
            if ((row >> x) & 1 == 1) != taking {
                varint(out, run);
                run = 0;
                taking = !taking;
            }
            run += 1;
        }
    }
    varint(out, run);
}

/// Read one cell's change at `o`: the cell and the bits taken. None when the data is short or
/// doesn't add up.
pub fn decode(data: &[u8], o: &mut usize) -> Option<([i32; 3], [u16; 256])> {
    let head = data.get(*o..*o + 9)?;
    let x = i32::from_le_bytes([head[0], head[1], head[2], head[3]]);
    let z = i32::from_le_bytes([head[4], head[5], head[6], head[7]]);
    let y = head[8] as i32;
    *o += 9;
    let mut taken = [0u16; 256];
    let mut i = 0u32;
    let mut taking = false;
    let mut runs = 0;
    while i < CELLS {
        let n = read_varint(data, o)?;
        // Only the first run (kept) may be empty; an empty one after that would never end.
        if n > CELLS - i || (n == 0 && runs > 0) {
            return None;
        }
        if taking {
            for k in i..i + n {
                taken[(k >> 4) as usize] |= 1 << (k & 15);
            }
        }
        i += n;
        taking = !taking;
        runs += 1;
    }
    Some(([x, y, z], taken))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn boxes_cover_exactly_what_is_left() {
        let mut d = Damage::whole();
        assert_eq!(d.boxes, vec![[0, 0, 0, 16, 16, 16]]);
        // A 4 x 4 tunnel along z through the middle, and a chip off a corner.
        let mut taken = [0u16; 256];
        for y in 6..10 {
            for z in 0..16 {
                taken[y * 16 + z] = 0b0000_0011_1100_0000;
            }
        }
        taken[15 * 16 + 15] = 0x8000;
        let gone = d.take(&taken);
        assert_eq!(count(&gone), 4 * 4 * 16 + 1);
        assert_eq!(d.left, CELLS - 257);
        // The boxes fill exactly the bits left, without overlapping.
        let mut filled = [0u16; 256];
        for b in &d.boxes {
            for y in b[1]..b[4] {
                for z in b[2]..b[5] {
                    for x in b[0]..b[3] {
                        let r = &mut filled[y as usize * 16 + z as usize];
                        assert_eq!(*r & (1 << x), 0, "boxes overlap at {x} {y} {z}");
                        *r |= 1 << x;
                    }
                }
            }
        }
        assert_eq!(filled, d.bits);
        assert!(d.boxes.len() <= 8, "a tunnel and a chip merge into a few boxes: {}", d.boxes.len());
        // Taking the same again takes nothing.
        assert_eq!(count(&d.take(&taken)), 0);
    }

    #[test]
    fn capsules_take_a_rounded_channel() {
        // Straight in along +z through the middle of the block at the origin, radius 3/16.
        let c = capsule([0, 0, 0], [0.5, 0.5, -0.1], [0.5, 0.5, 0.6], 3.0 / 16.0);
        let n = count(&c);
        // 32 a layer (the middles within 3/16 of the axis), over the 10 layers the segment reaches in
        // the block and the few its end cap does.
        assert!(n > 320 && n < 420, "{n}");
        assert_eq!(c[8 * 16 + 15] & (1 << 8), 0, "not past the end");
        assert_ne!(c[8 * 16] & (1 << 8), 0, "the front face");
        assert_eq!(c[8 * 16 + 4] & (1 << 2), 0, "not wider than it is");
        // Nothing of a block it doesn't reach.
        assert_eq!(count(&capsule([3, 0, 0], [0.5, 0.5, -0.1], [0.5, 0.5, 0.6], 0.2)), 0);
    }

    #[test]
    fn blasts_take_a_ragged_sphere() {
        let c = [0.5, 0.5, 0.5];
        // All of a block well inside, none of one well outside; the one the edge crosses, part.
        assert_eq!(count(&blast([0, 0, 0], c, 2.0, 0.3, 1)), CELLS);
        assert_eq!(count(&blast([4, 0, 0], c, 2.0, 0.3, 1)), 0);
        let edge = count(&blast([1, 0, 0], [-1.0, 0.5, 0.5], 2.5, 0.3, 1));
        assert!(edge > 200 && edge < CELLS - 200, "{edge}");
        // The same blast, the same crater; another seed, another edge.
        assert_eq!(blast([1, 0, 0], [-1.0, 0.5, 0.5], 2.5, 0.3, 1), blast([1, 0, 0], [-1.0, 0.5, 0.5], 2.5, 0.3, 1));
        assert_ne!(blast([1, 0, 0], [-1.0, 0.5, 0.5], 2.5, 0.3, 1), blast([1, 0, 0], [-1.0, 0.5, 0.5], 2.5, 0.3, 2));
        // Smooth (roughness 0): exactly the sphere.
        let s = blast([1, 0, 0], [0.0, 0.5, 0.5], 1.5, 0.0, 1);
        for (i, row) in s.iter().enumerate() {
            for x in 0..16 {
                let p = [1.0 + (x as f64 + 0.5) / 16.0, ((i / 16) as f64 + 0.5) / 16.0, ((i % 16) as f64 + 0.5) / 16.0];
                let d = (p[0].powi(2) + (p[1] - 0.5).powi(2) + (p[2] - 0.5).powi(2)).sqrt();
                assert_eq!((row >> x) & 1 == 1, d <= 1.5, "{p:?} at {d}");
            }
        }
        // Ragged: the edge wanders in and out of the smooth sphere by up to its roughness.
        let mut out = 0;
        let mut short = 0;
        for i in 0..200 {
            let a = i as f64 * 0.7;
            let dir = [a.cos() * (i as f64 * 0.3).sin(), (i as f64 * 0.3).cos(), a.sin() * (i as f64 * 0.3).sin()];
            let k = 1.0 + 0.3 * ragged([dir[0] * 2.0, dir[1] * 2.0, dir[2] * 2.0], 9);
            assert!((0.7..=1.3).contains(&k));
            out += (k > 1.05) as u32;
            short += (k < 0.95) as u32;
        }
        assert!(out > 20 && short > 20, "lumps both ways: {out} out, {short} in");
    }

    #[test]
    fn changes_round_trip() {
        let mut taken = [0u16; 256];
        taken[0] = 1;
        taken[17] = 0xf0f0;
        taken[255] = 0xffff;
        for row in taken.iter_mut().skip(100).take(20) {
            *row = 0xffff;
        }
        let mut out = Vec::new();
        encode(&mut out, [-70000, 200, 12], &taken);
        encode(&mut out, [1, 2, 3], &[0xffff; 256]);
        let mut o = 0;
        assert_eq!(decode(&out, &mut o), Some(([-70000, 200, 12], taken)));
        assert_eq!(decode(&out, &mut o), Some(([1, 2, 3], [0xffff; 256])));
        assert_eq!(o, out.len());
        assert_eq!(decode(&out, &mut o), None);
        // A whole block taken is a few bytes: the cell, an empty kept run and 4096.
        let mut whole = Vec::new();
        encode(&mut whole, [1, 2, 3], &[0xffff; 256]);
        assert_eq!(whole.len(), 9 + 1 + 2);
        // Truncated or nonsense data is refused, not looped on.
        assert_eq!(decode(&out[..12], &mut 0), None);
        assert_eq!(decode(&[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], &mut 0), None);
    }
}
