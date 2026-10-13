//! Moving colliders ("movers"): block builds that move and turn (ships, lifts, platforms).
//! Bodies collide with them, stand on them and ride along, and are pushed out of their way;
//! rays stop at them.
//!
//! A mover is a grid of solid cells with a pose. Collision happens in the mover's own grid
//! space, where its cells are axis-aligned: a body's box is taken there at the same size
//! (upright bodies are near enough round that turning them with the mover doesn't matter) and
//! swept against the cells by time of impact. Cells are shrunk by a hair and bodies resting a
//! little inside a surface (rounding, a carry) are lifted back out, so they slide over the
//! seams between cells instead of catching on them.

/// Cells collide this much smaller than they are (world units): bodies rest a hair inside.
const SHRINK: f64 = 0.01;
/// A body further inside a mover than this is inside it (let out, not pushed out).
const DEEP: f64 = 0.12;

/// Where a mover is: `world = pos + rot * (local * scale)`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Pose {
    pub pos: [f64; 3],
    /// Unit quaternion (x, y, z, w).
    pub rot: [f64; 4],
    pub scale: f64,
}

impl Pose {
    pub const IDENTITY: Pose = Pose { pos: [0.0; 3], rot: [0.0, 0.0, 0.0, 1.0], scale: 1.0 };

    fn turn(q: [f64; 4], v: [f64; 3]) -> [f64; 3] {
        // v + 2w (q x v) + 2 q x (q x v)
        let (x, y, z, w) = (q[0], q[1], q[2], q[3]);
        let tx = 2.0 * (y * v[2] - z * v[1]);
        let ty = 2.0 * (z * v[0] - x * v[2]);
        let tz = 2.0 * (x * v[1] - y * v[0]);
        [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)]
    }

    pub fn rotate(&self, v: [f64; 3]) -> [f64; 3] {
        Self::turn(self.rot, v)
    }

    pub fn unrotate(&self, v: [f64; 3]) -> [f64; 3] {
        let q = self.rot;
        Self::turn([-q[0], -q[1], -q[2], q[3]], v)
    }

    pub fn to_world(&self, l: [f64; 3]) -> [f64; 3] {
        let r = self.rotate([l[0] * self.scale, l[1] * self.scale, l[2] * self.scale]);
        [self.pos[0] + r[0], self.pos[1] + r[1], self.pos[2] + r[2]]
    }

    pub fn to_local(&self, w: [f64; 3]) -> [f64; 3] {
        let r = self.unrotate([w[0] - self.pos[0], w[1] - self.pos[1], w[2] - self.pos[2]]);
        let s = if self.scale.abs() < 1e-9 { 1e-9 } else { self.scale };
        [r[0] / s, r[1] / s, r[2] / s]
    }
}

pub struct Mover {
    pub id: u32,
    size: [i32; 3],
    /// 1 for a solid cell; index `(y * size.z + z) * size.x + x`.
    cells: Vec<u8>,
    /// Grid coordinates of the model's origin (its pivot).
    pivot: [f64; 3],
    /// Model units per cell (the model's own scale).
    unit: f64,
    /// Farthest cell corner from the origin, in model units.
    radius: f64,
    /// Solid cells with an open side (only these can be in a block without one of them being).
    surface: Vec<[i32; 3]>,
    /// Where it is now, and where it was at the last carry (it has moved since if they differ).
    pub now: Pose,
    pub prev: Pose,
    /// Where it was the carry before that, and the seconds between (its last motion, for the
    /// velocity of a point on it).
    pub was: Pose,
    pub span: f64,
}

/// A body's box in a mover's grid space: centre and half extents.
struct GridBox {
    c: [f64; 3],
    he: [f64; 3],
}

impl Mover {
    pub fn new(id: u32, size: [i32; 3], cells: Vec<u8>, pivot: [f64; 3], unit: f64) -> Mover {
        let mut r2: f64 = 0.0;
        for y in 0..size[1] {
            for z in 0..size[2] {
                for x in 0..size[0] {
                    if cells[((y * size[2] + z) * size[0] + x) as usize] == 0 {
                        continue;
                    }
                    // The cell's farthest corner from the origin.
                    let far = |c: i32, a: usize| (c as f64 - pivot[a]).abs().max((c as f64 + 1.0 - pivot[a]).abs()) * unit;
                    let e = [far(x, 0), far(y, 1), far(z, 2)];
                    r2 = r2.max(e[0] * e[0] + e[1] * e[1] + e[2] * e[2]);
                }
            }
        }
        let mut m = Mover { id, size, cells, pivot, unit, radius: r2.sqrt(), surface: Vec::new(), now: Pose::IDENTITY, prev: Pose::IDENTITY, was: Pose::IDENTITY, span: 0.0 };
        const SIDES: [(i32, i32, i32); 6] = [(1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1)];
        for y in 0..size[1] {
            for z in 0..size[2] {
                for x in 0..size[0] {
                    if m.solid(x, y, z) && SIDES.iter().any(|(dx, dy, dz)| !m.solid(x + dx, y + dy, z + dz)) {
                        m.surface.push([x, y, z]);
                    }
                }
            }
        }
        m
    }

    /// The middles of its outer blocks, in the world with it at `pose`.
    pub fn surface_middles<'a>(&'a self, pose: &'a Pose) -> impl Iterator<Item = [f64; 3]> + 'a {
        self.surface.iter().map(move |c| pose.to_world([0, 1, 2].map(|a| (c[a] as f64 + 0.5 - self.pivot[a]) * self.unit)))
    }

    /// Whether its last carry moved it further than a rider is carried (see `world::JUMP`).
    pub fn jumped(&self) -> bool {
        let d = [0, 1, 2].map(|a| self.now.pos[a] - self.prev.pos[a]);
        d[0] * d[0] + d[1] * d[1] + d[2] * d[2] > crate::world::JUMP * crate::world::JUMP
    }

    #[inline]
    fn solid(&self, x: i32, y: i32, z: i32) -> bool {
        x >= 0 && y >= 0 && z >= 0 && x < self.size[0] && y < self.size[1] && z < self.size[2] && self.cells[((y * self.size[2] + z) * self.size[0] + x) as usize] != 0
    }

    /// World units per cell in this pose.
    #[inline]
    fn cell(&self, pose: &Pose) -> f64 {
        (self.unit * pose.scale).abs().max(1e-9)
    }

    fn to_grid(&self, pose: &Pose, w: [f64; 3]) -> [f64; 3] {
        let l = pose.to_local(w);
        [l[0] / self.unit + self.pivot[0], l[1] / self.unit + self.pivot[1], l[2] / self.unit + self.pivot[2]]
    }

    /// Whether a point is within `margin` of its bounds (a cheap first test).
    pub fn near(&self, pose: &Pose, p: [f64; 3], margin: f64) -> bool {
        let r = self.radius * pose.scale.abs() + margin;
        let d = [p[0] - pose.pos[0], p[1] - pose.pos[1], p[2] - pose.pos[2]];
        d[0] * d[0] + d[1] * d[1] + d[2] * d[2] <= r * r
    }

    fn body(&self, pose: &Pose, p: [f64; 3], hw: f64, h: f64) -> GridBox {
        let k = self.cell(pose);
        GridBox { c: self.to_grid(pose, [p[0], p[1] + h * 0.5, p[2]]), he: [hw / k, h * 0.5 / k, hw / k] }
    }

    /// The solid cells a grid box (grown by `pad` cells) may touch.
    fn cells_around(&self, lo: [f64; 3], hi: [f64; 3]) -> impl Iterator<Item = [i32; 3]> + '_ {
        let a = [lo[0].floor().max(0.0) as i32, lo[1].floor().max(0.0) as i32, lo[2].floor().max(0.0) as i32];
        let b = [
            (hi[0].floor() as i32).min(self.size[0] - 1),
            (hi[1].floor() as i32).min(self.size[1] - 1),
            (hi[2].floor() as i32).min(self.size[2] - 1),
        ];
        let empty = hi[0] < 0.0 || hi[1] < 0.0 || hi[2] < 0.0 || a[0] > b[0] || a[1] > b[1] || a[2] > b[2];
        let (a, b) = if empty { ([1, 1, 1], [0, 0, 0]) } else { (a, b) };
        (a[1]..=b[1]).flat_map(move |y| (a[2]..=b[2]).flat_map(move |z| (a[0]..=b[0]).map(move |x| [x, y, z]))).filter(|c| self.solid(c[0], c[1], c[2]))
    }

    /// How far a grid box reaches into a cell on each axis (shrunk cells); all positive = inside.
    fn overlap(&self, g: &GridBox, cell: [i32; 3], s: f64) -> [f64; 3] {
        let mut o = [0.0; 3];
        for a in 0..3 {
            let lo = cell[a] as f64 + s;
            let hi = cell[a] as f64 + 1.0 - s;
            o[a] = (g.c[a] + g.he[a]).min(hi) - (g.c[a] - g.he[a]).max(lo);
        }
        o
    }

    /// Whether a body (feet at `p`) overlaps its cells in `pose`.
    pub fn overlaps(&self, pose: &Pose, p: [f64; 3], hw: f64, h: f64) -> bool {
        let g = self.body(pose, p, hw, h);
        let s = SHRINK / self.cell(pose);
        let lo = [g.c[0] - g.he[0], g.c[1] - g.he[1], g.c[2] - g.he[2]];
        let hi = [g.c[0] + g.he[0], g.c[1] + g.he[1], g.c[2] + g.he[2]];
        self.cells_around(lo, hi).any(|c| {
            let o = self.overlap(&g, c, s);
            o[0] > 0.0 && o[1] > 0.0 && o[2] > 0.0
        })
    }

    /// How much of a move `d` (world) a body can make before it meets a cell: 0..=1. Cells it is
    /// already deep inside don't stop it (so it can get out).
    pub fn sweep(&self, p: [f64; 3], hw: f64, h: f64, d: [f64; 3]) -> f64 {
        let pose = &self.now;
        let k = self.cell(pose);
        let g = self.body(pose, p, hw, h);
        let r = pose.unrotate(d);
        let dg = [r[0] / pose.scale / self.unit, r[1] / pose.scale / self.unit, r[2] / pose.scale / self.unit];
        let s = SHRINK / k;
        let deep = DEEP / k;
        let lo = [0, 1, 2].map(|a| (g.c[a] - g.he[a]).min(g.c[a] - g.he[a] + dg[a]));
        let hi = [0, 1, 2].map(|a| (g.c[a] + g.he[a]).max(g.c[a] + g.he[a] + dg[a]));
        let mut best: f64 = 1.0;
        for cell in self.cells_around(lo, hi) {
            let o = self.overlap(&g, cell, s);
            if o[0] > 0.0 && o[1] > 0.0 && o[2] > 0.0 {
                // Already touching it from inside: stop only a move further in along the shallowest axis.
                let a = if o[0] <= o[1] && o[0] <= o[2] { 0 } else if o[1] <= o[2] { 1 } else { 2 };
                if o[a] > deep {
                    continue;
                }
                let inward = dg[a] * (cell[a] as f64 + 0.5 - g.c[a]) > 0.0;
                if inward {
                    return 0.0;
                }
                continue;
            }
            // Moving box against the cell: a ray from the box centre against the cell grown by the box.
            let mut t0 = f64::NEG_INFINITY;
            let mut t1 = f64::INFINITY;
            let mut hit = true;
            for a in 0..3 {
                let lo = cell[a] as f64 + s - g.he[a];
                let hi = cell[a] as f64 + 1.0 - s + g.he[a];
                if dg[a].abs() < 1e-12 {
                    if g.c[a] <= lo || g.c[a] >= hi {
                        hit = false;
                        break;
                    }
                } else {
                    let mut ta = (lo - g.c[a]) / dg[a];
                    let mut tb = (hi - g.c[a]) / dg[a];
                    if ta > tb {
                        std::mem::swap(&mut ta, &mut tb);
                    }
                    t0 = t0.max(ta);
                    t1 = t1.min(tb);
                }
            }
            if hit && t0 < t1 && t0 >= 0.0 && t0 < best {
                best = t0;
            }
        }
        best
    }

    /// A body resting a little inside its cells (by up to `DEEP`): the world move that lifts it
    /// back out along the shallowest way, and how deep it was.
    pub fn shallow(&self, p: [f64; 3], hw: f64, h: f64) -> Option<([f64; 3], f64)> {
        let pose = &self.now;
        let k = self.cell(pose);
        let g = self.body(pose, p, hw, h);
        let s = SHRINK / k;
        let deep = DEEP / k;
        let lo = [g.c[0] - g.he[0], g.c[1] - g.he[1], g.c[2] - g.he[2]];
        let hi = [g.c[0] + g.he[0], g.c[1] + g.he[1], g.c[2] + g.he[2]];
        let mut best: Option<([f64; 3], f64)> = None;
        for cell in self.cells_around(lo, hi) {
            let o = self.overlap(&g, cell, s);
            if !(o[0] > 0.0 && o[1] > 0.0 && o[2] > 0.0) {
                continue;
            }
            let a = if o[0] <= o[1] && o[0] <= o[2] { 0 } else if o[1] <= o[2] { 1 } else { 2 };
            if o[a] > deep || best.is_some_and(|(_, d)| d >= o[a]) {
                continue;
            }
            let mut v = [0.0; 3];
            v[a] = if g.c[a] < cell[a] as f64 + 0.5 { -(o[a] + 1e-4 / k) } else { o[a] + 1e-4 / k };
            let w = pose.rotate([v[0] * k, v[1] * k, v[2] * k]);
            best = Some((w, o[a]));
        }
        best
    }

    /// Distance along a ray (unit `d`) to its first cell, within `max`.
    pub fn ray(&self, o: [f64; 3], d: [f64; 3], max: f64) -> Option<f64> {
        let pose = &self.now;
        if !self.near(pose, o, max) {
            return None;
        }
        let og = self.to_grid(pose, o);
        let r = pose.unrotate(d);
        let k = pose.scale * self.unit;
        let dg = [r[0] / k, r[1] / k, r[2] / k];
        // Clip the ray to the grid's box.
        let mut t0: f64 = 0.0;
        let mut t1 = max;
        for a in 0..3 {
            if dg[a].abs() < 1e-12 {
                if og[a] < 0.0 || og[a] > self.size[a] as f64 {
                    return None;
                }
            } else {
                let mut ta = (0.0 - og[a]) / dg[a];
                let mut tb = (self.size[a] as f64 - og[a]) / dg[a];
                if ta > tb {
                    std::mem::swap(&mut ta, &mut tb);
                }
                t0 = t0.max(ta);
                t1 = t1.min(tb);
            }
        }
        if t0 > t1 {
            return None;
        }
        // Walk the cells from where it enters (a hair in, so the first cell is the right one).
        let start = [og[0] + dg[0] * (t0 + 1e-9), og[1] + dg[1] * (t0 + 1e-9), og[2] + dg[2] * (t0 + 1e-9)];
        let mut c = [start[0].floor() as i32, start[1].floor() as i32, start[2].floor() as i32];
        let step = [dg[0].signum() as i32, dg[1].signum() as i32, dg[2].signum() as i32];
        let mut t_max = [f64::INFINITY; 3];
        let mut t_delta = [f64::INFINITY; 3];
        for a in 0..3 {
            if dg[a].abs() >= 1e-12 {
                let next = if dg[a] > 0.0 { c[a] as f64 + 1.0 - start[a] } else { start[a] - c[a] as f64 };
                t_max[a] = t0 + next / dg[a].abs();
                t_delta[a] = 1.0 / dg[a].abs();
            }
        }
        let mut t = t0;
        loop {
            if self.solid(c[0], c[1], c[2]) {
                return Some(t);
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
            if t > t1 {
                return None;
            }
            t_max[a] += t_delta[a];
            c[a] += step[a];
        }
    }

    /// Whether a point is inside one of its cells.
    pub fn contains(&self, p: [f64; 3]) -> bool {
        if !self.near(&self.now, p, 0.0) {
            return false;
        }
        let g = self.to_grid(&self.now, p);
        self.solid(g[0].floor() as i32, g[1].floor() as i32, g[2].floor() as i32)
    }

    /// How fast the point of it now at `w` was moving over its last motion.
    pub fn velocity_at(&self, w: [f64; 3]) -> [f64; 3] {
        if self.span <= 1e-6 {
            return [0.0; 3];
        }
        let was = self.was.to_world(self.now.to_local(w));
        [(w[0] - was[0]) / self.span, (w[1] - was[1]) / self.span, (w[2] - was[2]) / self.span]
    }

    /// Whether it moved since the last carry.
    pub fn moved(&self) -> bool {
        self.now != self.prev
    }

    pub fn bounds_radius(&self, pose: &Pose) -> f64 {
        self.radius * pose.scale.abs()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::blocks::STONE;
    use crate::gen::HEADER_BYTES;
    use crate::world::{MoveInput, Player, World};

    /// Stone up to y = 63 around the origin, air above.
    fn flat_world() -> World {
        let mut w = World::new();
        for cz in -3..3 {
            for cx in -3..3 {
                let mut data = vec![0u8; HEADER_BYTES + 4 * 4096];
                data[0] = 0b1111;
                for i in 0..4 * 4096 {
                    data[HEADER_BYTES + i] = STONE;
                }
                w.insert_column(cx, cz, &data);
            }
        }
        w
    }

    /// A flat deck `n` x 1 x `n` with its origin at the middle of its top face.
    fn deck(id: u32, n: i32) -> Mover {
        Mover::new(id, [n, 1, n], vec![1; (n * n) as usize], [n as f64 / 2.0, 1.0, n as f64 / 2.0], 1.0)
    }

    fn place(w: &mut World, id: u32, pos: [f64; 3], yaw: f64) {
        let m = w.mover_mut(id).unwrap();
        m.now = Pose { pos, rot: [0.0, (yaw / 2.0).sin(), 0.0, (yaw / 2.0).cos()], scale: 1.0 };
    }

    /// The carry after movers moved (what `VoxelWorld::movers_carry` does for one player).
    fn carry(w: &mut World, p: &mut Player, dt: f64) {
        p.carry(w);
        for m in w.movers.iter_mut() {
            m.was = m.prev;
            m.span = dt;
            m.prev = m.now;
        }
    }

    const IDLE: MoveInput = MoveInput { wish_x: 0.0, wish_z: 0.0, jump: false, sneak: false, sprint: false, slide: false, speed: 1.0 };

    fn settle(w: &World, p: &mut Player) {
        for _ in 0..90 {
            p.step(w, &IDLE, 1.0 / 60.0);
        }
    }

    #[test]
    fn a_body_lands_on_a_mover_and_rides_it() {
        let mut w = flat_world();
        w.movers.push(deck(7, 10));
        place(&mut w, 7, [0.0, 100.0, 0.0], 0.0);
        carry(&mut w, &mut Player::new(0.0, 0.0, 0.0), 0.05);
        let mut p = Player::new(1.5, 104.0, 0.5);
        settle(&w, &mut p);
        assert!(p.on_ground, "standing");
        assert!((p.pos[1] - 100.0).abs() < 0.05, "on the deck, not in it: {}", p.pos[1]);
        assert_eq!(p.ride.id, 7);

        // It slides 3 blocks east and rises 2: they go with it.
        place(&mut w, 7, [3.0, 102.0, 0.0], 0.0);
        carry(&mut w, &mut p, 0.05);
        assert!((p.pos[0] - 4.5).abs() < 1e-6 && (p.pos[1] - 102.0).abs() < 0.05, "carried: {:?}", p.pos);
        // A quarter turn about its middle takes them round it.
        place(&mut w, 7, [3.0, 102.0, 0.0], std::f64::consts::FRAC_PI_2);
        carry(&mut w, &mut p, 0.05);
        assert!((p.pos[0] - 3.5).abs() < 1e-6 && (p.pos[2] + 1.5).abs() < 1e-6, "turned with it: {:?}", p.pos);
        settle(&w, &mut p);
        assert!(p.on_ground && p.ride.id == 7 && (p.pos[1] - 102.0).abs() < 0.05, "still standing on it: {:?}", p.pos);
    }

    #[test]
    fn walking_across_a_turned_deck_does_not_catch_on_seams() {
        let mut w = flat_world();
        w.movers.push(deck(1, 30));
        place(&mut w, 1, [0.0, 100.0, 0.0], 0.52);
        carry(&mut w, &mut Player::new(0.0, 0.0, 0.0), 0.05);
        let mut p = Player::new(-6.0, 101.0, 0.3);
        settle(&w, &mut p);
        let start = p.pos;
        let walk = MoveInput { wish_x: 1.0, wish_z: 0.0, jump: false, sneak: false, sprint: false, slide: false, speed: 1.0 };
        for _ in 0..120 {
            p.step(&w, &walk, 1.0 / 60.0);
        }
        let d = p.pos[0] - start[0];
        assert!(d > 7.5, "walked {d} blocks in 2 s");
        assert!(p.on_ground && (p.pos[1] - 100.0).abs() < 0.05);
        // And jumping lands back on deck.
        let jump = MoveInput { wish_x: 0.0, wish_z: 0.0, jump: true, sneak: false, sprint: false, slide: false, speed: 1.0 };
        p.step(&w, &jump, 1.0 / 60.0);
        settle(&w, &mut p);
        assert!(p.on_ground && (p.pos[1] - 100.0).abs() < 0.05);
    }

    #[test]
    fn walking_up_and_down_a_tilted_deck() {
        let mut w = flat_world();
        w.movers.push(deck(6, 30));
        // Pitched 8 degrees about x: the deck rises toward -z.
        let a: f64 = 8f64.to_radians();
        w.mover_mut(6).unwrap().now = Pose { pos: [0.0, 100.0, 0.0], rot: [(a / 2.0).sin(), 0.0, 0.0, (a / 2.0).cos()], scale: 1.0 };
        carry(&mut w, &mut Player::new(0.0, 0.0, 0.0), 0.05);
        let mut p = Player::new(0.5, 103.0, 6.0);
        settle(&w, &mut p);
        assert!(p.on_ground && p.ride.id == 6, "on the slope");
        let z0 = p.pos[2];
        let up = MoveInput { wish_x: 0.0, wish_z: -1.0, jump: false, sneak: false, sprint: false, slide: false, speed: 1.0 };
        for _ in 0..120 {
            p.step(&w, &up, 1.0 / 60.0);
        }
        assert!(z0 - p.pos[2] > 7.0, "walked uphill {}", z0 - p.pos[2]);
        let surface = 100.0 + (-p.pos[2]) * a.tan();
        assert!((p.pos[1] - surface).abs() < 0.2, "on the surface: {} vs {surface}", p.pos[1]);
        let down = MoveInput { wish_x: 0.0, wish_z: 1.0, jump: false, sneak: false, sprint: false, slide: false, speed: 1.0 };
        let z1 = p.pos[2];
        for _ in 0..120 {
            p.step(&w, &down, 1.0 / 60.0);
        }
        assert!(p.pos[2] - z1 > 7.0 && p.ride.id == 6, "walked back down");
    }

    #[test]
    fn a_rider_jumping_on_a_moving_deck_lands_where_they_jumped() {
        let mut w = flat_world();
        w.movers.push(deck(2, 12));
        place(&mut w, 2, [0.0, 100.0, 0.0], 0.0);
        carry(&mut w, &mut Player::new(0.0, 0.0, 0.0), 0.05);
        let mut p = Player::new(0.5, 101.0, 0.5);
        settle(&w, &mut p);
        let jump = MoveInput { wish_x: 0.0, wish_z: 0.0, jump: true, sneak: false, sprint: false, slide: false, speed: 1.0 };
        let dt = 1.0 / 20.0;
        for i in 0..40 {
            // The deck sails on at 6 blocks a second.
            place(&mut w, 2, [6.0 * dt * (i + 1) as f64, 100.0, 0.0], 0.0);
            carry(&mut w, &mut p, dt);
            p.step(&w, if i == 0 { &jump } else { &IDLE }, dt);
        }
        let deck_x = 6.0 * dt * 40.0;
        assert!(p.on_ground && p.ride.id == 2, "landed on deck");
        assert!((p.pos[0] - (deck_x + 0.5)).abs() < 0.05, "same spot on deck: {} vs {}", p.pos[0], deck_x + 0.5);
    }

    #[test]
    fn stepping_off_takes_the_decks_motion() {
        let mut w = flat_world();
        w.movers.push(deck(3, 4));
        place(&mut w, 3, [0.0, 100.0, 0.0], 0.0);
        carry(&mut w, &mut Player::new(0.0, 0.0, 0.0), 0.05);
        let mut p = Player::new(1.5, 101.0, 0.0);
        settle(&w, &mut p);
        let dt = 1.0 / 20.0;
        let walk = MoveInput { wish_x: 1.0, wish_z: 0.0, jump: false, sneak: false, sprint: false, slide: false, speed: 1.0 };
        let mut vz_after = 0.0;
        for i in 0..60 {
            place(&mut w, 3, [0.0, 100.0, 5.0 * dt * (i + 1) as f64], 0.0);
            carry(&mut w, &mut p, dt);
            p.step(&w, &walk, dt);
            if p.ride.id == 0 {
                vz_after = p.vel[2];
                break;
            }
        }
        assert!(vz_after > 4.0, "left moving with it: vz {vz_after}");
    }

    #[test]
    fn a_mover_pushes_a_body_it_runs_into() {
        let mut w = flat_world();
        // A wall 1 x 4 x 6, standing on the ground at x = 2.
        w.movers.push(Mover::new(4, [1, 4, 6], vec![1; 24], [0.0, 0.0, 3.0], 1.0));
        place(&mut w, 4, [2.0, 64.0, 0.0], 0.0);
        carry(&mut w, &mut Player::new(0.0, 0.0, 0.0), 0.05);
        let mut p = Player::new(3.5, 64.0, 0.0);
        settle(&w, &mut p);
        for i in 0..10 {
            place(&mut w, 4, [2.0 + 0.3 * (i + 1) as f64, 64.0, 0.0], 0.0);
            carry(&mut w, &mut p, 0.05);
            p.step(&w, &IDLE, 0.05);
        }
        let face = 2.0 + 3.0 + 1.0;
        assert!(p.pos[0] >= face + 0.29, "pushed ahead of the wall: {} (face at {face})", p.pos[0]);
        assert!(p.ride.id == 0 && p.on_ground);
    }

    #[test]
    fn a_mover_that_jumps_into_a_body_pushes_it() {
        let mut w = flat_world();
        w.movers.push(Mover::new(2, [1, 3, 6], vec![1; 18], [0.0, 0.0, 3.0], 1.0));
        place(&mut w, 2, [30.0, 64.0, 0.0], 0.0);
        carry(&mut w, &mut Player::new(0.0, 0.0, 0.0), 0.05);
        let mut p = Player::new(32.5, 64.0, 0.5);
        settle(&w, &mut p);
        place(&mut w, 2, [31.47, 64.0, 0.0], 0.0);
        let m = w.mover(2).unwrap();
        assert!(m.moved());
        assert!(m.overlaps(&m.now, p.pos, 0.3, 1.8), "overlaps now");
        assert!(!m.overlaps(&m.prev, p.pos, 0.3, 1.8), "not before");
        carry(&mut w, &mut p, 0.05);
        assert!(p.pos[0] > 32.47 + 0.29, "pushed: {:?}", p.pos);
    }

    #[test]
    fn frozen_on_deck_still_rides() {
        let mut w = flat_world();
        w.movers.push(deck(8, 6));
        place(&mut w, 8, [0.0, 100.0, 0.0], 0.0);
        carry(&mut w, &mut Player::new(0.0, 0.0, 0.0), 0.05);
        // Put on the deck and frozen straight away (never stepped on it).
        let mut p = Player::new(1.5, 100.0, 1.5);
        p.frozen = true;
        p.step(&w, &IDLE, 0.05);
        assert_eq!(p.ride.id, 8);
        place(&mut w, 8, [5.0, 103.0, 0.0], 0.0);
        carry(&mut w, &mut p, 0.05);
        assert!((p.pos[0] - 6.5).abs() < 1e-6 && (p.pos[1] - 103.0).abs() < 1e-6, "carried while frozen: {:?}", p.pos);
    }

    #[test]
    fn walking_up_a_low_lip_onto_a_deck() {
        let mut w = flat_world();
        // A deck whose top is 0.18 above the ground (y = 64), starting at x = 3.
        w.movers.push(Mover::new(9, [8, 1, 8], vec![1; 64], [0.0, 1.0, 4.0], 1.0));
        place(&mut w, 9, [3.0, 64.18, 0.0], 0.0);
        carry(&mut w, &mut Player::new(0.0, 0.0, 0.0), 0.05);
        let mut p = Player::new(0.5, 64.0, 0.5);
        settle(&w, &mut p);
        let walk = MoveInput { wish_x: 1.0, wish_z: 0.0, jump: false, sneak: false, sprint: false, slide: false, speed: 1.0 };
        for _ in 0..90 {
            p.step(&w, &walk, 1.0 / 60.0);
        }
        assert!(p.pos[0] > 5.0 && p.ride.id == 9, "stepped up onto the deck: {:?} riding {}", p.pos, p.ride.id);
    }

    #[test]
    fn overlap_counts_blocks_in_the_ground() {
        let mut w = flat_world();
        w.movers.push(deck(11, 10));
        let m = w.mover(11).unwrap();
        let at = |y: f64, tilt: f64| Pose { pos: [0.0, y, 0.0], rot: [(tilt / 2.0).sin(), 0.0, 0.0, (tilt / 2.0).cos()], scale: 1.0 };
        // Stone is solid up to y = 64; the deck's blocks sit just under its origin.
        assert_eq!(crate::world::mover_in_blocks(&w, m, &at(70.0, 0.0)), 0, "clear in the air");
        assert_eq!(crate::world::mover_in_blocks(&w, m, &at(64.0, 0.0)), 100, "sunk into the ground: all of it");
        let dipped = crate::world::mover_in_blocks(&w, m, &at(65.0, 0.3));
        assert!(dipped > 0 && dipped < 100, "tilted, one end dips in: {dipped}");
    }

    #[test]
    fn riders_go_with_a_mover_moved_far_at_once() {
        let mut w = flat_world();
        w.movers.push(deck(12, 6));
        place(&mut w, 12, [0.0, 100.0, 0.0], 0.0);
        carry(&mut w, &mut Player::new(0.0, 0.0, 0.0), 0.05);
        let mut p = Player::new(1.5, 101.0, 0.5);
        settle(&w, &mut p);
        // Put 30 blocks away (through where a wall would stop a carry): they arrive with it.
        place(&mut w, 12, [30.0, 90.0, -20.0], 0.0);
        carry(&mut w, &mut p, 0.05);
        assert!((p.pos[0] - 31.5).abs() < 1e-6 && (p.pos[1] - 90.0).abs() < 0.05 && (p.pos[2] + 19.5).abs() < 1e-6, "went with it: {:?}", p.pos);
        settle(&w, &mut p);
        assert!(p.on_ground && p.ride.id == 12);
    }

    #[test]
    fn rays_stop_at_movers() {
        let mut w = flat_world();
        w.movers.push(deck(5, 4));
        place(&mut w, 5, [0.0, 100.0, 0.0], 0.8);
        let t = w.raycast_solid([0.0, 110.0, 0.0], [0.0, -1.0, 0.0], 50.0).unwrap();
        assert!((t - 10.0).abs() < 1e-6, "top face at 10: {t}");
        assert_eq!(w.raycast_movers([0.0, 99.5, -20.0], [0.0, 0.0, 1.0], 50.0).map(|h| h.0), Some(5));
        assert!(w.raycast_movers([0.0, 99.5, -20.0], [0.0, 0.0, -1.0], 50.0).is_none());
        assert!(crate::entities::line_clear(&w, [0.0, 110.0, 0.0], [0.0, 105.0, 0.0]));
        assert!(!crate::entities::line_clear(&w, [0.0, 110.0, 0.0], [0.0, 90.0, 0.0]));
    }
}
