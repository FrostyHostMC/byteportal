//! Per-frame visibility on the main thread.
//!
//! - Frustum culling at 16^3 section granularity.
//! - Minecraft-style cave culling: a BFS from the camera section that only crosses a section from
//!   one face to another if the mesher found those faces connected through non-opaque blocks, and
//!   never travels back toward the camera. Caves hidden behind solid rock are skipped entirely.
//! - Shadow caster selection for the sun's orthographic frustum.
//!
//! Meshes store vertices ordered by section, so a column's visible sections collapse to one
//! contiguous index range per layer (`[start, count]` in index units, 6 per quad).

use crate::mesher::{ALL_CONNECTED, MESH_HEADER};

const GRID: usize = 128;
const GRID_MASK: i32 = GRID as i32 - 1;
const NONE: u8 = 6;
const DIRS: [(i32, i32, i32); 6] = [(1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1)];

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

#[derive(Clone)]
struct Slot {
    cx: i32,
    cz: i32,
    used: bool,
    /// Quad start per layer per section (17 entries).
    starts: [[u32; 17]; 3],
    info: [u32; 16],
    geo: u16,
    sun_geo: u16,
    vmin: i32,
    vmax: i32,
}

impl Slot {
    fn empty() -> Self {
        Slot { cx: 0, cz: 0, used: false, starts: [[0; 17]; 3], info: [ALL_CONNECTED; 16], geo: 0, sun_geo: 0, vmin: 16, vmax: -1 }
    }
}

type Planes = [[f64; 4]; 6];

fn planes(m: &[f64]) -> Planes {
    // Column-major matrix; row i = (m[i], m[4 + i], m[8 + i], m[12 + i]).
    let row = |i: usize| [m[i], m[4 + i], m[8 + i], m[12 + i]];
    let (r0, r1, r2, r3) = (row(0), row(1), row(2), row(3));
    let mut p = [[0.0; 4]; 6];
    for k in 0..4 {
        p[0][k] = r3[k] + r0[k];
        p[1][k] = r3[k] - r0[k];
        p[2][k] = r3[k] + r1[k];
        p[3][k] = r3[k] - r1[k];
        p[4][k] = r3[k] + r2[k];
        p[5][k] = r3[k] - r2[k];
    }
    for pl in p.iter_mut() {
        let l = (pl[0] * pl[0] + pl[1] * pl[1] + pl[2] * pl[2]).sqrt().max(1e-12);
        for v in pl.iter_mut() {
            *v /= l;
        }
    }
    p
}

#[inline(always)]
fn aabb_visible(p: &Planes, min: [f64; 3], max: [f64; 3]) -> bool {
    for pl in p {
        let x = if pl[0] > 0.0 { max[0] } else { min[0] };
        let y = if pl[1] > 0.0 { max[1] } else { min[1] };
        let z = if pl[2] > 0.0 { max[2] } else { min[2] };
        if pl[0] * x + pl[1] * y + pl[2] * z + pl[3] < 0.0 {
            return false;
        }
    }
    true
}

#[inline(always)]
fn section_box(cx: i32, sy: i32, cz: i32, pad: f64) -> ([f64; 3], [f64; 3]) {
    let x = cx as f64 * 16.0;
    let y = sy as f64 * 16.0;
    let z = cz as f64 * 16.0;
    ([x - pad, y - pad, z - pad], [x + 16.0 + pad, y + 16.0 + pad, z + 16.0 + pad])
}

pub struct Culler {
    grid: Vec<i32>,
    slots: Vec<Slot>,
    free: Vec<usize>,
    pub out: Vec<u32>,
    pub out_shadow: Vec<u32>,
    stamp: Vec<u32>,
    frame: u32,
    queue: Vec<(i32, i32, i32, u8, u8)>,
    pub visible_sections: u32,
}

impl Default for Culler {
    fn default() -> Self {
        Self::new()
    }
}

impl Culler {
    pub fn new() -> Self {
        Culler {
            grid: vec![-1; GRID * GRID],
            slots: Vec::new(),
            free: Vec::new(),
            out: Vec::new(),
            out_shadow: Vec::new(),
            stamp: vec![0; GRID * GRID * 16],
            frame: 0,
            queue: Vec::with_capacity(8192),
            visible_sections: 0,
        }
    }

    #[inline(always)]
    fn cell(cx: i32, cz: i32) -> usize {
        ((cz & GRID_MASK) as usize) * GRID + (cx & GRID_MASK) as usize
    }

    fn lookup(&self, cx: i32, cz: i32) -> Option<usize> {
        let s = self.grid[Self::cell(cx, cz)];
        if s >= 0 {
            let sl = &self.slots[s as usize];
            if sl.used && sl.cx == cx && sl.cz == cz {
                return Some(s as usize);
            }
        }
        None
    }

    pub fn capacity(&self) -> usize {
        self.slots.len()
    }

    /// Register / update a column's mesh layout. `header` is the mesher's output header.
    /// Returns the slot index used for the per-slot output arrays.
    pub fn set_column(&mut self, cx: i32, cz: i32, header: &[u32]) -> usize {
        assert!(header.len() >= MESH_HEADER);
        let slot = match self.lookup(cx, cz) {
            Some(s) => s,
            None => {
                let s = if let Some(s) = self.free.pop() {
                    s
                } else {
                    self.slots.push(Slot::empty());
                    self.out.extend_from_slice(&[0; 6]);
                    self.out_shadow.extend_from_slice(&[0; 4]);
                    self.slots.len() - 1
                };
                let cell = Self::cell(cx, cz);
                // Evict a stale occupant of the same grid cell (outside the grid radius).
                let prev = self.grid[cell];
                if prev >= 0 && prev as usize != s {
                    self.slots[prev as usize].used = false;
                    self.free.push(prev as usize);
                }
                self.grid[cell] = s as i32;
                s
            }
        };
        let sl = &mut self.slots[slot];
        sl.cx = cx;
        sl.cz = cz;
        sl.used = true;
        sl.geo = 0;
        sl.sun_geo = 0;
        for s in 0..17 {
            for l in 0..3 {
                sl.starts[l][s] = header[4 + s * 3 + l];
            }
        }
        for s in 0..16 {
            sl.info[s] = header[55 + s];
            let has = (0..3).any(|l| sl.starts[l][s + 1] > sl.starts[l][s]);
            if has {
                sl.geo |= 1 << s;
            }
            let casts = (0..2).any(|l| sl.starts[l][s + 1] > sl.starts[l][s]);
            if casts && (header[55 + s] >> 16) & 1 == 1 {
                sl.sun_geo |= 1 << s;
            }
        }
        slot
    }

    pub fn remove_column(&mut self, cx: i32, cz: i32) {
        if let Some(s) = self.lookup(cx, cz) {
            self.slots[s].used = false;
            self.grid[Self::cell(cx, cz)] = -1;
            self.free.push(s);
            for v in &mut self.out[s * 6..s * 6 + 6] {
                *v = 0;
            }
            for v in &mut self.out_shadow[s * 4..s * 4 + 4] {
                *v = 0;
            }
        }
    }

    fn write_ranges(&mut self) {
        let mut visible = 0;
        for (i, sl) in self.slots.iter_mut().enumerate() {
            let o = &mut self.out[i * 6..i * 6 + 6];
            if !sl.used || sl.vmin > sl.vmax {
                o.fill(0);
                continue;
            }
            visible += (sl.vmax - sl.vmin + 1) as u32;
            for l in 0..3 {
                let a = sl.starts[l][sl.vmin as usize];
                let b = sl.starts[l][sl.vmax as usize + 1];
                o[l * 2] = a * 6;
                o[l * 2 + 1] = (b - a) * 6;
            }
        }
        self.visible_sections = visible;
    }

    /// Main camera culling. `vp` = projection * view (column-major, world space).
    pub fn cull(&mut self, vp: &[f64], cam: [f64; 3], radius: i32, occlusion: bool) {
        let p = planes(vp);
        for sl in self.slots.iter_mut() {
            sl.vmin = 16;
            sl.vmax = -1;
        }
        let ccx = (cam[0] / 16.0).floor() as i32;
        let ccz = (cam[2] / 16.0).floor() as i32;
        let csy = (cam[1] / 16.0).floor() as i32;

        if !occlusion || !(0..16).contains(&csy) {
            for sl in self.slots.iter_mut() {
                if !sl.used || sl.geo == 0 {
                    continue;
                }
                if (sl.cx - ccx).abs() > radius + 1 || (sl.cz - ccz).abs() > radius + 1 {
                    continue;
                }
                let lo = sl.geo.trailing_zeros() as i32;
                let hi = 15 - sl.geo.leading_zeros() as i32;
                let (mn, _) = section_box(sl.cx, lo, sl.cz, 1.0);
                let (_, mx) = section_box(sl.cx, hi, sl.cz, 1.0);
                if !aabb_visible(&p, mn, mx) {
                    continue;
                }
                for s in lo..=hi {
                    if sl.geo & (1 << s) == 0 {
                        continue;
                    }
                    let (mn, mx) = section_box(sl.cx, s, sl.cz, 1.0);
                    if aabb_visible(&p, mn, mx) {
                        sl.vmin = sl.vmin.min(s);
                        sl.vmax = sl.vmax.max(s);
                    }
                }
            }
            self.write_ranges();
            return;
        }

        self.frame = self.frame.wrapping_add(1);
        if self.frame == 0 {
            self.stamp.fill(0);
            self.frame = 1;
        }
        let frame = self.frame;
        self.queue.clear();
        self.queue.push((ccx, csy, ccz, 0, NONE));
        self.stamp[Self::cell(ccx, ccz) * 16 + csy as usize] = frame;
        let mut head = 0;
        while head < self.queue.len() {
            let (cx, sy, cz, dirs, from) = self.queue[head];
            head += 1;
            let slot = self.lookup(cx, cz);
            let info = match slot {
                Some(s) => {
                    let sl = &mut self.slots[s];
                    if sl.geo & (1 << sy) != 0 {
                        sl.vmin = sl.vmin.min(sy);
                        sl.vmax = sl.vmax.max(sy);
                    }
                    sl.info[sy as usize]
                }
                None => ALL_CONNECTED,
            };
            // The camera's own section is treated as fully open (the camera may be inside blocks).
            let conn = if from == NONE { ALL_CONNECTED } else { info & ALL_CONNECTED };
            for d in 0..6u8 {
                if dirs & (1 << (d ^ 1)) != 0 {
                    continue;
                }
                if from != NONE {
                    let entry = (from ^ 1) as usize;
                    if conn & (1 << PAIR[entry][d as usize]) == 0 {
                        continue;
                    }
                }
                let (dx, dy, dz) = DIRS[d as usize];
                let (nx, ny, nz) = (cx + dx, sy + dy, cz + dz);
                if !(0..16).contains(&ny) || (nx - ccx).abs() > radius || (nz - ccz).abs() > radius {
                    continue;
                }
                let si = Self::cell(nx, nz) * 16 + ny as usize;
                if self.stamp[si] == frame {
                    continue;
                }
                let (mn, mx) = section_box(nx, ny, nz, 1.0);
                if !aabb_visible(&p, mn, mx) {
                    continue;
                }
                self.stamp[si] = frame;
                self.queue.push((nx, ny, nz, dirs | (1 << d), d));
            }
        }
        self.write_ranges();
    }

    /// Shadow caster selection: sections that have sun-exposed geometry inside the light frustum.
    pub fn cull_shadow(&mut self, vp: &[f64], cam: [f64; 3], radius_chunks: i32) {
        let p = planes(vp);
        let ccx = (cam[0] / 16.0).floor() as i32;
        let ccz = (cam[2] / 16.0).floor() as i32;
        for (i, sl) in self.slots.iter().enumerate() {
            let o = &mut self.out_shadow[i * 4..i * 4 + 4];
            o.fill(0);
            if !sl.used || sl.sun_geo == 0 {
                continue;
            }
            if (sl.cx - ccx).abs() > radius_chunks || (sl.cz - ccz).abs() > radius_chunks {
                continue;
            }
            let lo = sl.sun_geo.trailing_zeros() as i32;
            let hi = 15 - sl.sun_geo.leading_zeros() as i32;
            let (mn, _) = section_box(sl.cx, lo, sl.cz, 1.0);
            let (_, mx) = section_box(sl.cx, hi, sl.cz, 1.0);
            if !aabb_visible(&p, mn, mx) {
                continue;
            }
            let mut vmin = 16;
            let mut vmax = -1;
            for s in lo..=hi {
                if sl.sun_geo & (1 << s) == 0 {
                    continue;
                }
                let (mn, mx) = section_box(sl.cx, s, sl.cz, 1.0);
                if aabb_visible(&p, mn, mx) {
                    vmin = vmin.min(s);
                    vmax = vmax.max(s);
                }
            }
            if vmin <= vmax {
                for l in 0..2 {
                    let a = sl.starts[l][vmin as usize];
                    let b = sl.starts[l][vmax as usize + 1];
                    o[l * 2] = a * 6;
                    o[l * 2 + 1] = (b - a) * 6;
                }
            }
        }
    }
}

fn normalize(v: [f64; 3]) -> [f64; 3] {
    let l = (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).sqrt().max(1e-12);
    [v[0] / l, v[1] / l, v[2] / l]
}

fn cross(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

fn dot(a: [f64; 3], b: [f64; 3]) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

/// Stable orthographic shadow camera. `to_sun` points from the scene toward the light.
/// Returns view (16) followed by projection (16), both column-major. The camera centre is snapped
/// to whole shadow-map texels in light space so shadows don't shimmer as the player moves.
pub fn shadow_camera(to_sun: [f64; 3], center: [f64; 3], radius: f64, depth: f64, resolution: f64) -> [f64; 32] {
    let f = normalize([-to_sun[0], -to_sun[1], -to_sun[2]]);
    let up_hint = if f[1].abs() > 0.99 { [0.0, 0.0, 1.0] } else { [0.0, 1.0, 0.0] };
    let right = normalize(cross(f, up_hint));
    let up = cross(right, f);
    let texel = 2.0 * radius / resolution;
    let cr = dot(center, right);
    let cu = dot(center, up);
    let dr = (cr / texel).floor() * texel - cr;
    let du = (cu / texel).floor() * texel - cu;
    let c = [
        center[0] + right[0] * dr + up[0] * du,
        center[1] + right[1] * dr + up[1] * du,
        center[2] + right[2] * dr + up[2] * du,
    ];
    let eye = [c[0] - f[0] * depth, c[1] - f[1] * depth, c[2] - f[2] * depth];
    let back = [-f[0], -f[1], -f[2]];
    let mut out = [0.0; 32];
    // View: rows = right, up, back.
    let rows = [right, up, back];
    for (r, row) in rows.iter().enumerate() {
        out[r] = row[0];
        out[4 + r] = row[1];
        out[8 + r] = row[2];
        out[12 + r] = -dot(*row, eye);
    }
    out[15] = 1.0;
    // Orthographic projection.
    let (l, rr, b, t, n, fa) = (-radius, radius, -radius, radius, 0.0, depth * 2.0);
    let p = &mut out[16..32];
    p[0] = 2.0 / (rr - l);
    p[5] = 2.0 / (t - b);
    p[10] = -2.0 / (fa - n);
    p[12] = -(rr + l) / (rr - l);
    p[13] = -(t + b) / (t - b);
    p[14] = -(fa + n) / (fa - n);
    p[15] = 1.0;
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn perspective_vp(eye: [f64; 3], yaw: f64) -> [f64; 16] {
        // Column-major projection * view for a camera looking along (-sin yaw, 0, -cos yaw).
        let (f, n, fa) = (1.0 / (0.6f64).tan(), 0.1, 500.0);
        let p = [f, 0.0, 0.0, 0.0, 0.0, f, 0.0, 0.0, 0.0, 0.0, (fa + n) / (n - fa), -1.0, 0.0, 0.0, 2.0 * fa * n / (n - fa), 0.0];
        let fwd = [-yaw.sin(), 0.0, -yaw.cos()];
        let right = [yaw.cos(), 0.0, -yaw.sin()];
        let up = [0.0, 1.0, 0.0];
        let back = [-fwd[0], -fwd[1], -fwd[2]];
        let mut v = [0.0; 16];
        for (r, row) in [right, up, back].iter().enumerate() {
            v[r] = row[0];
            v[4 + r] = row[1];
            v[8 + r] = row[2];
            v[12 + r] = -dot(*row, eye);
        }
        v[15] = 1.0;
        let mut m = [0.0; 16];
        for c in 0..4 {
            for r in 0..4 {
                m[c * 4 + r] = (0..4).map(|k| p[k * 4 + r] * v[c * 4 + k]).sum();
            }
        }
        m
    }

    #[test]
    fn occlusion_matches_frustum_in_open_air() {
        let mut c = Culler::new();
        let mut header = vec![0u32; MESH_HEADER];
        // Every section has one opaque quad and is fully connected.
        for s in 0..=16 {
            header[4 + s * 3] = s as u32;
        }
        for s in 0..16 {
            header[55 + s] = ALL_CONNECTED | (1 << 16) | (1 << 17);
        }
        for cz in -6..=6 {
            for cx in -6..=6 {
                c.set_column(cx, cz, &header);
            }
        }
        let eye = [8.0, 70.0, 8.0];
        let vp = perspective_vp(eye, 0.7);
        c.cull(&vp, eye, 6, false);
        let frustum = c.visible_sections;
        c.cull(&vp, eye, 6, true);
        let occl = c.visible_sections;
        assert!(frustum > 50, "frustum sees {frustum}");
        // Ranges are contiguous per column, so occlusion may only equal or trim what frustum shows.
        assert!(occl >= frustum * 9 / 10 && occl <= frustum, "frustum {frustum} occlusion {occl}");
    }

    #[test]
    fn shadow_camera_projects_center_to_middle() {
        let m = shadow_camera([0.3, 0.8, 0.2], [1000.5, 70.0, -333.3], 96.0, 300.0, 4096.0);
        let v = &m[..16];
        let p = &m[16..];
        let c = [1000.5, 70.0, -333.3, 1.0];
        let mut vc = [0.0; 4];
        for r in 0..4 {
            vc[r] = (0..4).map(|k| v[k * 4 + r] * c[k]).sum();
        }
        let mut pc = [0.0; 4];
        for r in 0..4 {
            pc[r] = (0..4).map(|k| p[k * 4 + r] * vc[k]).sum();
        }
        assert!(pc[0].abs() < 0.01 && pc[1].abs() < 0.01, "{pc:?}");
        assert!(pc[2].abs() < 0.01, "center at mid depth {pc:?}");
    }
}
