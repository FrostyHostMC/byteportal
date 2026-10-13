//! Entity simulation: physics bodies, flow-field navigation, projectiles and hit tests.
//!
//! Plain Rust with no wasm-bindgen types, so a native game server can run exactly the same
//! simulation. State lives in flat `f64` buffers the host reads and writes directly (the web
//! client maps them as `Float64Array`s over wasm memory): no per-entity calls across the boundary.

use crate::blocks::*;
use crate::world::{aabb_collides, aabb_move_axis, carry_box, ground_under, move_axis, settle_box, update_ride, walk_axis, Ride, World};

/// Body buffer layout (f64 fields per body).
pub mod body {
    pub const STRIDE: usize = 38;
    // Inputs (host writes).
    pub const X: usize = 0;
    pub const Y: usize = 1;
    pub const Z: usize = 2;
    pub const VX: usize = 3;
    pub const VY: usize = 4;
    pub const VZ: usize = 5;
    pub const HALF_W: usize = 6;
    pub const HEIGHT: usize = 7;
    pub const SPEED: usize = 8;
    pub const ACCEL: usize = 9;
    pub const JUMP_VEL: usize = 10;
    pub const GRAVITY: usize = 11;
    pub const WISH_X: usize = 12;
    pub const WISH_Z: usize = 13;
    /// 0 = steer by WISH, 1 = navigate to target, 2 = fly straight to target (no gravity), 3 = idle.
    pub const MODE: usize = 14;
    pub const WANT_JUMP: usize = 15;
    /// Bit flags, see `FLAG_*`.
    pub const FLAGS: usize = 16;
    pub const IMP_X: usize = 17;
    pub const IMP_Y: usize = 18;
    pub const IMP_Z: usize = 19;
    /// Navigation target. TARGET_KIND 0 = the nearest player (flow field), 1 = the point
    /// (TX, TY, TZ), 2 = the player in slot TX (flow field).
    pub const TX: usize = 20;
    pub const TY: usize = 21;
    pub const TZ: usize = 22;
    pub const TARGET_KIND: usize = 23;
    // Outputs (simulation writes).
    pub const ON_GROUND: usize = 24;
    pub const IN_WATER: usize = 25;
    pub const LOS: usize = 26;
    pub const PATH_DIST: usize = 27;
    pub const DIST: usize = 28;
    pub const HEADING: usize = 29;
    pub const BLOCKED: usize = 30;
    /// Downward speed at the moment of the last landing (for fall damage); cleared by the host.
    pub const LANDED_SPEED: usize = 31;
    /// The player DIST and LOS are measured to (the target, or the nearest): their slot, or -1.
    pub const PLAYER: usize = 32;
    /// The mover it rides (0 for none), and where its feet are on it (see `world::Ride`).
    pub const RIDE: usize = 33;
    pub const RIDE_X: usize = 34;
    pub const RIDE_Y: usize = 35;
    pub const RIDE_Z: usize = 36;
}

pub const FLAG_ACTIVE: u32 = 1;
/// Push apart from other bodies and from players.
pub const FLAG_SOLID: u32 = 2;
/// Float in water instead of sinking.
pub const FLAG_SWIM: u32 = 4;
/// Not hittable by projectiles or picks (dying bodies).
pub const FLAG_GHOST: u32 = 8;

/// Projectile buffer layout.
pub mod proj {
    pub const STRIDE: usize = 16;
    pub const X: usize = 0;
    pub const Y: usize = 1;
    pub const Z: usize = 2;
    pub const VX: usize = 3;
    pub const VY: usize = 4;
    pub const VZ: usize = 5;
    pub const GRAVITY: usize = 6;
    pub const DRAG: usize = 7;
    pub const RADIUS: usize = 8;
    pub const FLAGS: usize = 9;
    /// Body index that fired it, or -1 - slot for a player.
    pub const OWNER: usize = 10;
    pub const AGE: usize = 11;
    /// 0 none, 1 world, 2 player, 3 body. Set by the simulation, cleared by the host.
    pub const HIT_KIND: usize = 12;
    /// The body index, or the player's slot.
    pub const HIT_INDEX: usize = 13;
}

pub const PFLAG_ACTIVE: u32 = 1;
pub const PFLAG_HITS_PLAYER: u32 = 2;
pub const PFLAG_HITS_BODIES: u32 = 4;
pub const PFLAG_STUCK: u32 = 8;

const GRAVITY: f64 = 30.0;

/// A player as the entity simulation sees them: feet position, box, and slot.
#[derive(Clone, Copy, Debug)]
pub struct Target {
    pub pos: [f64; 3],
    pub hw: f64,
    pub h: f64,
    pub slot: usize,
}

/// At most this many players get a navigation field at once (the ones being chased).
const MAX_FIELDS: usize = 8;
/// How often each navigation field is brought up to date (seconds). The fields take turns, one a
/// step at most, so a step never rebuilds them all at once.
const FLOW_REFRESH: f64 = 0.25;

/// Breadth-first distance field toward one player over walkable cells.
pub struct FlowField {
    ox: i32,
    oy: i32,
    oz: i32,
    solid: Vec<u8>,
    dist: Vec<u16>,
    queue: Vec<u32>,
    valid: bool,
}

const FR: i32 = 48;
const FX: usize = (2 * FR + 1) as usize;
const FZ: usize = FX;
const FY: usize = 28;
const UNREACHED: u16 = u16::MAX;
const DIRS8: [(i32, i32); 8] = [(1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1)];

impl FlowField {
    fn new() -> Self {
        FlowField {
            ox: 0,
            oy: 0,
            oz: 0,
            solid: vec![0; FX * FY * FZ],
            dist: vec![UNREACHED; FX * FY * FZ],
            queue: Vec::with_capacity(1 << 15),
            valid: false,
        }
    }

    #[inline(always)]
    fn idx(x: i32, y: i32, z: i32) -> usize {
        (y as usize * FZ + z as usize) * FX + x as usize
    }

    #[inline(always)]
    fn inside(x: i32, y: i32, z: i32) -> bool {
        x >= 0 && z >= 0 && y >= 0 && (x as usize) < FX && (y as usize) < FY && (z as usize) < FZ
    }

    #[inline(always)]
    fn solid(&self, x: i32, y: i32, z: i32) -> bool {
        if !Self::inside(x, y, z) {
            return true;
        }
        self.solid[Self::idx(x, y, z)] == 1
    }

    #[inline(always)]
    fn walkable(&self, x: i32, y: i32, z: i32) -> bool {
        Self::inside(x, y, z) && y >= 1 && (y as usize) + 1 < FY && self.solid(x, y - 1, z) && !self.solid(x, y, z) && !self.solid(x, y + 1, z)
    }

    /// Can a body step from walkable cell `a` to walkable cell `b` (horizontally adjacent)?
    fn can_move(&self, a: (i32, i32, i32), b: (i32, i32, i32)) -> bool {
        let dy = b.1 - a.1;
        if !(-3..=1).contains(&dy) {
            return false;
        }
        if dy == 1 && self.solid(a.0, a.1 + 2, a.2) {
            return false;
        }
        if dy < 0 {
            // Dropping down: the column above the landing cell must be open up to our head.
            for yy in (b.1 + 2)..=(a.1 + 1) {
                if self.solid(b.0, yy, b.2) {
                    return false;
                }
            }
        }
        if a.0 != b.0 && a.2 != b.2 {
            // No corner cutting on diagonals.
            let top = a.1.max(b.1);
            for (cx, cz) in [(b.0, a.2), (a.0, b.2)] {
                if self.solid(cx, top, cz) || self.solid(cx, top + 1, cz) {
                    return false;
                }
            }
        }
        true
    }

    fn rebuild(&mut self, world: &World, tx: f64, ty: f64, tz: f64) {
        let cx = tx.floor() as i32;
        let cy = ty.floor() as i32;
        let cz = tz.floor() as i32;
        self.ox = cx - FR;
        self.oz = cz - FR;
        self.oy = cy - (FY as i32 / 2);
        world.solid_box(self.ox, self.oy, self.oz, FX, FY, FZ, &mut self.solid);
        self.dist.fill(UNREACHED);
        self.queue.clear();
        // Target cell: the player's feet, or the ground below if airborne.
        let (lx, lz) = (FR, FR);
        let mut ly = self.feet_cell(lx, cy - self.oy, lz);
        let mut found = false;
        for _ in 0..8 {
            if self.walkable(lx, ly, lz) {
                found = true;
                break;
            }
            ly -= 1;
        }
        if !found {
            self.valid = false;
            return;
        }
        let t = Self::idx(lx, ly, lz);
        self.dist[t] = 0;
        self.queue.push(t as u32);
        let mut head = 0;
        while head < self.queue.len() {
            let i = self.queue[head] as usize;
            head += 1;
            let d = self.dist[i];
            let x = (i % FX) as i32;
            let z = ((i / FX) % FZ) as i32;
            let y = (i / (FX * FZ)) as i32;
            for (dx, dz) in DIRS8 {
                let nx = x + dx;
                let nz = z + dz;
                if nx < 0 || nz < 0 || nx as usize >= FX || nz as usize >= FZ {
                    continue;
                }
                // A body at (nx, ny, nz) moving to (x, y, z): ny in [y - 1, y + 3].
                for dy in -1..=3 {
                    let ny = y + dy;
                    if !self.walkable(nx, ny, nz) {
                        continue;
                    }
                    let ni = Self::idx(nx, ny, nz);
                    if self.dist[ni] != UNREACHED {
                        continue;
                    }
                    if !self.can_move((nx, ny, nz), (x, y, z)) {
                        continue;
                    }
                    self.dist[ni] = d + 1;
                    self.queue.push(ni as u32);
                }
            }
        }
        self.valid = true;
    }

    /// The cell a body whose feet are in local cell `y` stands in: that one, or the one above it
    /// when the feet are inside a block whose collision fills only part of its cell (standing on a
    /// bottom slab or a stair's lower step, the field's walkable cell is the one over the block).
    #[inline(always)]
    fn feet_cell(&self, x: i32, y: i32, z: i32) -> i32 {
        if self.solid(x, y, z) {
            y + 1
        } else {
            y
        }
    }

    /// Local walkable cell at or just below a world position, with its distance.
    fn locate(&self, p: [f64; 3]) -> Option<((i32, i32, i32), u16)> {
        let x = p[0].floor() as i32 - self.ox;
        let z = p[2].floor() as i32 - self.oz;
        let y0 = self.feet_cell(x, (p[1] + 0.01).floor() as i32 - self.oy, z);
        for k in 0..4 {
            let y = y0 - k;
            if self.walkable(x, y, z) {
                let d = self.dist[Self::idx(x, y, z)];
                return Some(((x, y, z), d));
            }
        }
        None
    }

    /// Steering toward the next cell downhill in the field: (dir x, dir z, jump, path distance).
    fn steer(&self, p: [f64; 3]) -> Option<(f64, f64, bool, u16)> {
        if !self.valid {
            return None;
        }
        let ((x, y, z), d) = self.locate(p)?;
        if d == UNREACHED {
            return None;
        }
        if d == 0 {
            return Some((0.0, 0.0, false, 0));
        }
        let mut best: Option<((i32, i32, i32), u16)> = None;
        for (dx, dz) in DIRS8 {
            for dy in [0, 1, -1, -2, -3] {
                let n = (x + dx, y + dy, z + dz);
                if !self.walkable(n.0, n.1, n.2) {
                    continue;
                }
                let nd = self.dist[Self::idx(n.0, n.1, n.2)];
                if nd >= d || !self.can_move((x, y, z), n) {
                    continue;
                }
                let better = match best {
                    None => true,
                    Some((b, bd)) => nd < bd || (nd == bd && (b.0 != x && b.2 != z) && (n.0 == x || n.2 == z)),
                };
                if better {
                    best = Some((n, nd));
                }
            }
        }
        let (n, _) = best?;
        let wx = (n.0 + self.ox) as f64 + 0.5 - p[0];
        let wz = (n.2 + self.oz) as f64 + 0.5 - p[2];
        let l = (wx * wx + wz * wz).sqrt().max(1e-6);
        Some((wx / l, wz / l, n.1 > y, d))
    }
}

/// Is the straight line between two points free of solid blocks?
pub fn line_clear(world: &World, a: [f64; 3], b: [f64; 3]) -> bool {
    let d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    let len = (d[0] * d[0] + d[1] * d[1] + d[2] * d[2]).sqrt();
    if len < 1e-6 {
        return true;
    }
    match world.raycast_solid(a, d, len) {
        Some(t) => t >= len - 1e-3,
        None => true,
    }
}

/// Ray vs axis-aligned box (slab test). Returns entry distance.
fn ray_aabb(o: [f64; 3], d: [f64; 3], min: [f64; 3], max: [f64; 3]) -> Option<f64> {
    let mut t0 = 0.0f64;
    let mut t1 = f64::INFINITY;
    for a in 0..3 {
        if d[a].abs() < 1e-12 {
            if o[a] < min[a] || o[a] > max[a] {
                return None;
            }
        } else {
            let inv = 1.0 / d[a];
            let mut ta = (min[a] - o[a]) * inv;
            let mut tb = (max[a] - o[a]) * inv;
            if ta > tb {
                std::mem::swap(&mut ta, &mut tb);
            }
            t0 = t0.max(ta);
            t1 = t1.min(tb);
            if t0 > t1 {
                return None;
            }
        }
    }
    Some(t0)
}

/// A chased player's navigation field: its age, and whether a body steered by it since it was built.
struct Nav {
    slot: usize,
    field: FlowField,
    age: f64,
    wanted: bool,
}

pub struct Entities {
    pub bodies: Vec<f64>,
    pub projectiles: Vec<f64>,
    /// A navigation field per chased player, each rebuilt every `FLOW_REFRESH` seconds in turn.
    flows: Vec<Nav>,
    /// Players some body navigated toward this step.
    chased: Vec<usize>,
    /// A field or two no longer wanted, kept to reuse (each is a couple of MB).
    pool: Vec<FlowField>,
}

/// The nearest player to a point.
fn nearest(players: &[Target], p: [f64; 3]) -> Option<usize> {
    let mut best = None;
    let mut bd = f64::INFINITY;
    for (i, t) in players.iter().enumerate() {
        let d = (t.pos[0] - p[0]).powi(2) + (t.pos[1] - p[1]).powi(2) + (t.pos[2] - p[2]).powi(2);
        if d < bd {
            bd = d;
            best = Some(i);
        }
    }
    best
}

impl Entities {
    pub fn new(max_bodies: usize, max_projectiles: usize) -> Self {
        Entities {
            bodies: vec![0.0; max_bodies * body::STRIDE],
            projectiles: vec![0.0; max_projectiles * proj::STRIDE],
            flows: Vec::new(),
            chased: Vec::new(),
            pool: Vec::new(),
        }
    }

    pub fn body_capacity(&self) -> usize {
        self.bodies.len() / body::STRIDE
    }

    pub fn projectile_capacity(&self) -> usize {
        self.projectiles.len() / proj::STRIDE
    }

    /// Rebuild the navigation fields toward these players now, all of them (normally each is
    /// rebuilt every `FLOW_REFRESH` seconds in turn, and only for players being chased).
    pub fn rebuild_flow(&mut self, world: &World, players: &[Target]) {
        self.chased = players.iter().map(|t| t.slot).collect();
        self.update_flows(world, 0.0, players);
        for n in self.flows.iter_mut() {
            if let Some(t) = players.iter().find(|t| t.slot == n.slot) {
                n.field.rebuild(world, t.pos[0], t.pos[1], t.pos[2]);
                n.age = 0.0;
            }
        }
    }

    /// The fields brought up to date for this step: those of players who left put away; a player
    /// chased last step without one given one at once; and the stalest, once it's due, rebuilt
    /// (or put away, if no body steered by it since it was last built). At most one is rebuilt in
    /// a step for its age, so the fields take turns rather than all coming due together.
    fn update_flows(&mut self, world: &World, dt: f64, players: &[Target]) {
        let mut i = 0;
        while i < self.flows.len() {
            if players.iter().any(|t| t.slot == self.flows[i].slot) {
                self.flows[i].age += dt;
                i += 1;
            } else {
                let gone = self.flows.swap_remove(i);
                self.put_away(gone.field);
            }
        }
        for slot in std::mem::take(&mut self.chased) {
            if let Some(n) = self.flows.iter_mut().find(|n| n.slot == slot) {
                n.wanted = true;
                continue;
            }
            if self.flows.len() >= MAX_FIELDS {
                continue;
            }
            if let Some(t) = players.iter().find(|t| t.slot == slot) {
                let mut field = self.pool.pop().unwrap_or_else(FlowField::new);
                field.rebuild(world, t.pos[0], t.pos[1], t.pos[2]);
                self.flows.push(Nav { slot, field, age: 0.0, wanted: true });
            }
        }
        let due = (0..self.flows.len()).filter(|&k| self.flows[k].age >= FLOW_REFRESH).max_by(|&a, &b| self.flows[a].age.total_cmp(&self.flows[b].age));
        if let Some(k) = due {
            if self.flows[k].wanted {
                let n = &mut self.flows[k];
                if let Some(t) = players.iter().find(|t| t.slot == n.slot) {
                    n.field.rebuild(world, t.pos[0], t.pos[1], t.pos[2]);
                }
                n.age = 0.0;
                n.wanted = false;
            } else {
                let gone = self.flows.swap_remove(k);
                self.put_away(gone.field);
            }
        }
    }

    fn put_away(&mut self, field: FlowField) {
        if self.pool.len() < 2 {
            self.pool.push(field);
        }
    }

    /// Advance all bodies toward, or away from, these players.
    pub fn step_bodies(&mut self, world: &World, dt: f64, players: &[Target]) {
        let dt = dt.min(0.1);
        self.update_flows(world, dt, players);
        let n = self.body_capacity();
        let steps = ((dt / (1.0 / 90.0)).ceil() as usize).max(1);
        let h = dt / steps as f64;
        let flows = &self.flows;
        let chased = &mut self.chased;
        for i in 0..n {
            let b = &mut self.bodies[i * body::STRIDE..(i + 1) * body::STRIDE];
            if (b[body::FLAGS] as u32) & FLAG_ACTIVE == 0 {
                continue;
            }
            // Navigation decides the wish direction once per frame.
            let pos = [b[body::X], b[body::Y], b[body::Z]];
            let eye = [pos[0], pos[1] + b[body::HEIGHT] * 0.85, pos[2]];
            let kind = b[body::TARGET_KIND] as i32;
            // The player this body cares about: the one it's after, or the nearest.
            let reference = if kind == 2 { players.iter().position(|t| t.slot as f64 == b[body::TX]) } else { nearest(players, pos) };
            let (dist, los) = match reference {
                Some(r) => {
                    let t = &players[r];
                    let d = ((t.pos[0] - pos[0]).powi(2) + (t.pos[2] - pos[2]).powi(2) + (t.pos[1] - pos[1]).powi(2)).sqrt();
                    (d, line_clear(world, eye, [t.pos[0], t.pos[1] + t.h * 0.9, t.pos[2]]))
                }
                None => (999.0, false),
            };
            b[body::DIST] = dist;
            b[body::LOS] = los as u8 as f64;
            b[body::PLAYER] = reference.map_or(-1.0, |r| players[r].slot as f64);
            let mode = b[body::MODE] as i32;
            let mut want_jump = b[body::WANT_JUMP] > 0.5;
            if mode == 1 {
                let (tx, tz, field) = if kind == 1 {
                    (b[body::TX], b[body::TZ], None)
                } else if let Some(r) = reference {
                    (players[r].pos[0], players[r].pos[2], Some(players[r].slot))
                } else {
                    // Nobody to go after: stay put.
                    (pos[0], pos[2], None)
                };
                let direct = || {
                    let dx = tx - pos[0];
                    let dz = tz - pos[2];
                    let l = (dx * dx + dz * dz).sqrt();
                    if l < 0.05 {
                        (0.0, 0.0)
                    } else {
                        (dx / l, dz / l)
                    }
                };
                let mut wish = direct();
                b[body::PATH_DIST] = -1.0;
                if let Some(slot) = field {
                    if !chased.contains(&slot) {
                        chased.push(slot);
                    }
                }
                let flow = field.and_then(|slot| flows.iter().find(|n| n.slot == slot)).map(|n| &n.field);
                if let Some(flow) = flow {
                    let close = los && dist < 4.5;
                    match flow.steer(pos) {
                        Some((wx, wz, jump, d)) => {
                            b[body::PATH_DIST] = d as f64;
                            if !close {
                                wish = (wx, wz);
                                want_jump |= jump;
                            }
                        }
                        None => {}
                    }
                }
                b[body::WISH_X] = wish.0;
                b[body::WISH_Z] = wish.1;
            } else if mode == 3 {
                b[body::WISH_X] = 0.0;
                b[body::WISH_Z] = 0.0;
            }
            b[body::BLOCKED] = 0.0;
            if b[body::RIDE] != 0.0 {
                // Where its mover went.
                let mut pos = [b[body::X], b[body::Y], b[body::Z]];
                let mut ride = Self::ride_of(b);
                carry_box(world, &mut pos, b[body::HALF_W], b[body::HEIGHT], &mut ride);
                Self::set_ride(b, ride);
                b[body::X] = pos[0];
                b[body::Y] = pos[1];
                b[body::Z] = pos[2];
            }
            for _ in 0..steps {
                Self::integrate(world, b, h, mode, want_jump);
            }
            b[body::WANT_JUMP] = 0.0;
            let sp = (b[body::VX] * b[body::VX] + b[body::VZ] * b[body::VZ]).sqrt();
            if sp > 0.3 {
                b[body::HEADING] = b[body::VX].atan2(b[body::VZ]);
            }
        }
        self.separate(world, players);
    }

    fn ride_of(b: &[f64]) -> Ride {
        Ride { id: b[body::RIDE] as u32, local: [b[body::RIDE_X], b[body::RIDE_Y], b[body::RIDE_Z]] }
    }

    fn set_ride(b: &mut [f64], r: Ride) {
        b[body::RIDE] = r.id as f64;
        b[body::RIDE_X] = r.local[0];
        b[body::RIDE_Y] = r.local[1];
        b[body::RIDE_Z] = r.local[2];
    }

    /// Carry every body with the mover it rides, and out of the way of any that ran into it.
    pub fn carry(&mut self, world: &World) {
        for i in 0..self.body_capacity() {
            let b = &mut self.bodies[i * body::STRIDE..(i + 1) * body::STRIDE];
            if (b[body::FLAGS] as u32) & FLAG_ACTIVE == 0 {
                continue;
            }
            let mut pos = [b[body::X], b[body::Y], b[body::Z]];
            let mut ride = Self::ride_of(b);
            carry_box(world, &mut pos, b[body::HALF_W], b[body::HEIGHT], &mut ride);
            Self::set_ride(b, ride);
            b[body::X] = pos[0];
            b[body::Y] = pos[1];
            b[body::Z] = pos[2];
        }
    }

    fn integrate(world: &World, b: &mut [f64], dt: f64, mode: i32, want_jump: bool) {
        let hw = b[body::HALF_W];
        let hh = b[body::HEIGHT];
        let mut pos = [b[body::X], b[body::Y], b[body::Z]];
        settle_box(world, &mut pos, hw, hh);
        let on_ground = b[body::ON_GROUND] > 0.5;

        // Liquids.
        let feet = world.get(pos[0].floor() as i32, (pos[1] + 0.3).floor() as i32, pos[2].floor() as i32);
        let in_water = feet == WATER_B || feet == LAVA_B;
        b[body::IN_WATER] = in_water as u8 as f64;

        let speed = b[body::SPEED];
        let accel = if on_ground || mode == 2 { b[body::ACCEL] } else { b[body::ACCEL] * 0.25 };
        let k = 1.0 - (-accel * dt).exp();
        let tvx = b[body::WISH_X] * speed;
        let tvz = b[body::WISH_Z] * speed;
        b[body::VX] += (tvx - b[body::VX]) * k;
        b[body::VZ] += (tvz - b[body::VZ]) * k;

        // Impulses (knockback) apply once.
        b[body::VX] += b[body::IMP_X];
        b[body::VY] += b[body::IMP_Y];
        b[body::VZ] += b[body::IMP_Z];
        b[body::IMP_X] = 0.0;
        b[body::IMP_Y] = 0.0;
        b[body::IMP_Z] = 0.0;

        if mode == 2 {
            b[body::VY] *= (-3.0 * dt).exp();
        } else if in_water {
            let swim = (b[body::FLAGS] as u32) & FLAG_SWIM != 0;
            b[body::VY] += if swim { 6.0 } else { -8.0 } * dt;
            b[body::VY] *= (-2.5 * dt).exp();
            b[body::VX] *= (-1.5 * dt).exp();
            b[body::VZ] *= (-1.5 * dt).exp();
        } else {
            b[body::VY] -= GRAVITY * b[body::GRAVITY] * dt;
            b[body::VY] = b[body::VY].max(-60.0);
        }
        if want_jump && (on_ground || in_water) {
            b[body::VY] = b[body::VY].max(b[body::JUMP_VEL]);
        }

        let vy = b[body::VY];
        let mut ground = None;
        if let Some(by) = move_axis(world, &mut pos, 1, vy * dt, hw, hh, 0) {
            if vy < 0.0 {
                if !on_ground {
                    b[body::LANDED_SPEED] = b[body::LANDED_SPEED].max(-vy);
                }
                b[body::ON_GROUND] = 1.0;
                ground = Some(by);
            }
            b[body::VY] = 0.0;
        } else {
            ground = if vy <= 0.0 { ground_under(world, pos, hw, hh, 0.03) } else { None };
            b[body::ON_GROUND] = ground.is_some() as u8 as f64;
        }
        let grounded = b[body::ON_GROUND] > 0.5 && mode != 2;
        for axis in [0usize, 2] {
            let vi = if axis == 0 { body::VX } else { body::VZ };
            let before = pos;
            if walk_axis(world, &mut pos, axis, b[vi] * dt, hw, hh, grounded).is_some() {
                b[body::BLOCKED] = 1.0;
                // Auto-step: hop up a 1-block ledge when walking into it.
                if grounded {
                    let mut up = before;
                    up[1] += 1.05;
                    up[axis] += b[vi].signum() * 0.3;
                    if !aabb_collides(world, up, hw, hh) {
                        b[body::VY] = b[body::VY].max(b[body::JUMP_VEL]);
                    }
                }
                b[vi] = 0.0;
            }
        }
        let mut ride = Self::ride_of(b);
        let kick = update_ride(world, pos, ground, mode == 2 || in_water, &mut ride);
        Self::set_ride(b, ride);
        b[body::VX] += kick[0];
        b[body::VY] += kick[1];
        b[body::VZ] += kick[2];
        b[body::X] = pos[0];
        b[body::Y] = pos[1];
        b[body::Z] = pos[2];
    }

    /// Soft collisions between bodies, and bodies against players.
    fn separate(&mut self, world: &World, players: &[Target]) {
        let n = self.body_capacity();
        let s = body::STRIDE;
        for i in 0..n {
            let fi = self.bodies[i * s + body::FLAGS] as u32;
            if fi & FLAG_ACTIVE == 0 || fi & FLAG_SOLID == 0 {
                continue;
            }
            let (xi, yi, zi, hwi, hi) = (
                self.bodies[i * s + body::X],
                self.bodies[i * s + body::Y],
                self.bodies[i * s + body::Z],
                self.bodies[i * s + body::HALF_W],
                self.bodies[i * s + body::HEIGHT],
            );
            let mut push = [0.0f64; 2];
            let mut add = |ox: f64, oy: f64, oz: f64, ohw: f64, oh: f64, weight: f64| {
                if yi > oy + oh || oy > yi + hi {
                    return;
                }
                let dx = xi - ox;
                let dz = zi - oz;
                let min = hwi + ohw;
                let d2 = dx * dx + dz * dz;
                if d2 >= min * min {
                    return;
                }
                let d = d2.sqrt();
                let (nx, nz) = if d < 1e-4 { (((i * 7) % 5) as f64 - 2.0, 1.0) } else { (dx / d, dz / d) };
                let overlap = min - d;
                push[0] += nx * overlap * weight;
                push[1] += nz * overlap * weight;
            };
            for t in players {
                add(t.pos[0], t.pos[1], t.pos[2], t.hw, t.h, 1.0);
            }
            for j in 0..n {
                if j == i {
                    continue;
                }
                let fj = self.bodies[j * s + body::FLAGS] as u32;
                if fj & FLAG_ACTIVE == 0 || fj & FLAG_SOLID == 0 {
                    continue;
                }
                add(
                    self.bodies[j * s + body::X],
                    self.bodies[j * s + body::Y],
                    self.bodies[j * s + body::Z],
                    self.bodies[j * s + body::HALF_W],
                    self.bodies[j * s + body::HEIGHT],
                    0.5,
                );
            }
            if push[0] != 0.0 || push[1] != 0.0 {
                let mut pos = [xi, yi, zi];
                aabb_move_axis(world, &mut pos, 0, push[0].clamp(-0.2, 0.2), hwi, hi);
                aabb_move_axis(world, &mut pos, 2, push[1].clamp(-0.2, 0.2), hwi, hi);
                self.bodies[i * s + body::X] = pos[0];
                self.bodies[i * s + body::Z] = pos[2];
            }
        }
    }

    /// Advance projectiles; hits are reported in HIT_KIND / HIT_INDEX for the host to consume.
    pub fn step_projectiles(&mut self, world: &World, dt: f64, players: &[Target]) {
        let n = self.projectile_capacity();
        for i in 0..n {
            let base = i * proj::STRIDE;
            let flags = self.projectiles[base + proj::FLAGS] as u32;
            if flags & PFLAG_ACTIVE == 0 {
                continue;
            }
            self.projectiles[base + proj::AGE] += dt;
            if flags & PFLAG_STUCK != 0 || self.projectiles[base + proj::HIT_KIND] != 0.0 {
                continue;
            }
            let p = &mut self.projectiles[base..base + proj::STRIDE];
            p[proj::VY] -= p[proj::GRAVITY] * dt;
            let drag = (-p[proj::DRAG] * dt).exp();
            p[proj::VX] *= drag;
            p[proj::VY] *= drag;
            p[proj::VZ] *= drag;
            let v = [p[proj::VX], p[proj::VY], p[proj::VZ]];
            let speed = (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).sqrt();
            let travel = speed * dt;
            let o = [p[proj::X], p[proj::Y], p[proj::Z]];
            let r = p[proj::RADIUS];
            let owner = p[proj::OWNER] as i64;
            if travel < 1e-9 {
                continue;
            }
            let d = [v[0] / speed, v[1] / speed, v[2] / speed];
            // Nearest hit along this frame's segment: world, player, bodies.
            let mut best_t = travel;
            let mut kind = 0.0;
            let mut index = -1.0;
            if let Some(t) = world.raycast_solid(o, d, travel) {
                best_t = t;
                kind = 1.0;
            }
            if flags & PFLAG_HITS_PLAYER != 0 {
                for pl in players {
                    // Never the player who fired it.
                    if owner == -1 - pl.slot as i64 {
                        continue;
                    }
                    let min = [pl.pos[0] - pl.hw - r, pl.pos[1] - r, pl.pos[2] - pl.hw - r];
                    let max = [pl.pos[0] + pl.hw + r, pl.pos[1] + pl.h + r, pl.pos[2] + pl.hw + r];
                    if let Some(t) = ray_aabb(o, d, min, max) {
                        if t < best_t {
                            best_t = t;
                            kind = 2.0;
                            index = pl.slot as f64;
                        }
                    }
                }
            }
            if flags & PFLAG_HITS_BODIES != 0 {
                let nb = self.bodies.len() / body::STRIDE;
                for j in 0..nb {
                    if j as i64 == owner {
                        continue;
                    }
                    let bb = &self.bodies[j * body::STRIDE..(j + 1) * body::STRIDE];
                    let bf = bb[body::FLAGS] as u32;
                    if bf & FLAG_ACTIVE == 0 || bf & FLAG_GHOST != 0 {
                        continue;
                    }
                    let hw = bb[body::HALF_W] + r;
                    let min = [bb[body::X] - hw, bb[body::Y] - r, bb[body::Z] - hw];
                    let max = [bb[body::X] + hw, bb[body::Y] + bb[body::HEIGHT] + r, bb[body::Z] + hw];
                    if let Some(t) = ray_aabb(o, d, min, max) {
                        if t < best_t {
                            best_t = t;
                            kind = 3.0;
                            index = j as f64;
                        }
                    }
                }
            }
            let p = &mut self.projectiles[base..base + proj::STRIDE];
            p[proj::X] = o[0] + d[0] * best_t;
            p[proj::Y] = o[1] + d[1] * best_t;
            p[proj::Z] = o[2] + d[2] * best_t;
            if kind != 0.0 {
                p[proj::HIT_KIND] = kind;
                p[proj::HIT_INDEX] = index;
                if kind == 1.0 {
                    // Back off slightly so stuck arrows poke out of the surface.
                    p[proj::X] -= d[0] * 0.08;
                    p[proj::Y] -= d[1] * 0.08;
                    p[proj::Z] -= d[2] * 0.08;
                    p[proj::FLAGS] = (flags | PFLAG_STUCK) as f64;
                }
            }
        }
    }

    /// Nearest active body hit by a ray before any solid block; returns (index, distance).
    pub fn pick_body(&self, world: &World, o: [f64; 3], dir: [f64; 3], max_dist: f64, pad: f64) -> Option<(usize, f64)> {
        let l = (dir[0] * dir[0] + dir[1] * dir[1] + dir[2] * dir[2]).sqrt();
        if l < 1e-9 {
            return None;
        }
        let d = [dir[0] / l, dir[1] / l, dir[2] / l];
        let block = world.raycast_solid(o, d, max_dist).unwrap_or(max_dist);
        let mut best: Option<(usize, f64)> = None;
        for j in 0..self.body_capacity() {
            let bb = &self.bodies[j * body::STRIDE..(j + 1) * body::STRIDE];
            let bf = bb[body::FLAGS] as u32;
            if bf & FLAG_ACTIVE == 0 || bf & FLAG_GHOST != 0 {
                continue;
            }
            let hw = bb[body::HALF_W] + pad;
            let min = [bb[body::X] - hw, bb[body::Y] - pad, bb[body::Z] - hw];
            let max = [bb[body::X] + hw, bb[body::Y] + bb[body::HEIGHT] + pad, bb[body::Z] + hw];
            if let Some(t) = ray_aabb(o, d, min, max) {
                if t <= block && t <= max_dist && best.map_or(true, |(_, bt)| t < bt) {
                    best = Some((j, t));
                }
            }
        }
        best
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::gen::HEADER_BYTES;

    /// A flat stone world at y = 0..=63 around the origin (4x4 chunks).
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

    fn target(pos: [f64; 3], slot: usize) -> Target {
        Target { pos, hw: 0.3, h: 1.8, slot }
    }

    #[test]
    fn bodies_chase_the_nearest_player_or_their_target() {
        let w = flat_world();
        let mut e = Entities::new(4, 4);
        spawn(&mut e, 0, 0.5, 0.5);
        spawn(&mut e, 1, 0.5, 0.5);
        // Body 1 is after the player in slot 3, although slot 5 is nearer.
        e.bodies[body::STRIDE + body::TARGET_KIND] = 2.0;
        e.bodies[body::STRIDE + body::TX] = 3.0;
        let players = [target([10.5, 64.0, 0.5], 5), target([-20.5, 64.0, 0.5], 3)];
        for _ in 0..(60 * 4) {
            e.step_bodies(&w, 1.0 / 60.0, &players);
        }
        let b0 = &e.bodies[0..body::STRIDE];
        let b1 = &e.bodies[body::STRIDE..2 * body::STRIDE];
        assert_eq!(b0[body::PLAYER], 5.0);
        assert!(b0[body::X] > 7.0, "body 0 went to the nearest player, x = {}", b0[body::X]);
        assert_eq!(b1[body::PLAYER], 3.0);
        assert!(b1[body::X] < -10.0, "body 1 went after its target, x = {}", b1[body::X]);
    }

    #[test]
    fn navigation_fields_take_turns() {
        let w = flat_world();
        let mut e = Entities::new(8, 4);
        let players: Vec<Target> = (0..4).map(|k| target([k as f64 * 6.0 - 9.0, 64.0, 12.0], k + 1)).collect();
        for k in 0..4 {
            spawn(&mut e, k, k as f64 * 6.0 - 9.0, -12.0);
            e.bodies[k * body::STRIDE + body::TARGET_KIND] = 2.0;
            e.bodies[k * body::STRIDE + body::TX] = (k + 1) as f64;
        }
        // A field for each chased player at once, then rebuilt in turn: one a step at most, each
        // about every FLOW_REFRESH seconds.
        e.step_bodies(&w, 1.0 / 30.0, &players);
        e.step_bodies(&w, 1.0 / 30.0, &players);
        assert_eq!(e.flows.len(), 4);
        for _ in 0..60 {
            e.step_bodies(&w, 1.0 / 30.0, &players);
            let fresh = e.flows.iter().filter(|n| n.age == 0.0).count();
            assert!(fresh <= 1, "{fresh} fields rebuilt in one step");
            assert!(e.flows.iter().all(|n| n.age < FLOW_REFRESH + 4.5 / 30.0), "a field went stale: {:?}", e.flows.iter().map(|n| n.age).collect::<Vec<_>>());
        }
        // Nobody chasing any more: the fields are put away as they come due.
        for k in 0..4 {
            e.bodies[k * body::STRIDE + body::MODE] = 3.0;
        }
        for _ in 0..30 {
            e.step_bodies(&w, 1.0 / 30.0, &players);
        }
        assert!(e.flows.is_empty() && e.pool.len() <= 2);
    }

    #[test]
    fn bodies_find_a_player_standing_on_a_slab_or_a_stair() {
        let mut w = flat_world();
        // A bottom slab and a stair's lower step: a body stands half a block up, inside the cell.
        w.set(6, 64, 0, slab_id(0, false));
        w.set(-6, 64, 6, stairs_id(0, 1, false));
        let mut f = FlowField::new();
        for feet in [[6.5, 64.5, 0.5], [-5.5, 64.5, 6.5], [0.5, 64.0, 0.5]] {
            f.rebuild(&w, feet[0], feet[1], feet[2]);
            assert!(f.valid, "a field toward a player at {feet:?}");
            let (_, d) = f.locate([0.5, 64.0, -10.5]).unwrap();
            assert!(d != UNREACHED && d > 0, "a body a way off is on the field toward {feet:?}");
        }
        // A body standing on the slab is placed on the field too.
        f.rebuild(&w, 0.5, 64.0, -10.5);
        let (_, d) = f.locate([6.5, 64.5, 0.5]).expect("a body on the slab is on the field");
        assert!(d != UNREACHED);
        // And one goes and gets the player on the slab.
        let mut e = Entities::new(4, 4);
        spawn(&mut e, 0, 0.5, -10.0);
        let player = [6.5, 64.5, 0.5];
        for _ in 0..(60 * 8) {
            e.step_bodies(&w, 1.0 / 60.0, &[target(player, 0)]);
        }
        let b = &e.bodies[0..body::STRIDE];
        let d = ((b[body::X] - player[0]).powi(2) + (b[body::Z] - player[2]).powi(2)).sqrt();
        assert!(d < 1.6, "the body should reach the player on the slab, ended {d:.2} away at ({:.1},{:.1})", b[body::X], b[body::Z]);
    }

    #[test]
    fn projectiles_hit_other_players_not_their_shooter() {
        let w = flat_world();
        let mut e = Entities::new(4, 4);
        // Fired by the player in slot 1, from inside their own box, at the player in slot 2.
        let p = &mut e.projectiles[0..proj::STRIDE];
        p[proj::X] = 0.5;
        p[proj::Y] = 65.0;
        p[proj::Z] = 0.5;
        p[proj::VZ] = 30.0;
        p[proj::RADIUS] = 0.05;
        p[proj::OWNER] = -2.0;
        p[proj::FLAGS] = (PFLAG_ACTIVE | PFLAG_HITS_PLAYER) as f64;
        let players = [target([0.5, 64.0, 0.5], 1), target([0.5, 64.0, 6.0], 2)];
        for _ in 0..30 {
            e.step_projectiles(&w, 1.0 / 60.0, &players);
        }
        assert_eq!(e.projectiles[proj::HIT_KIND], 2.0);
        assert_eq!(e.projectiles[proj::HIT_INDEX], 2.0);
    }

    fn spawn(e: &mut Entities, i: usize, x: f64, z: f64) {
        let b = &mut e.bodies[i * body::STRIDE..(i + 1) * body::STRIDE];
        b[body::X] = x;
        b[body::Y] = 64.0;
        b[body::Z] = z;
        b[body::HALF_W] = 0.3;
        b[body::HEIGHT] = 1.9;
        b[body::SPEED] = 4.0;
        b[body::ACCEL] = 12.0;
        b[body::JUMP_VEL] = 8.5;
        b[body::GRAVITY] = 1.0;
        b[body::MODE] = 1.0;
        b[body::FLAGS] = (FLAG_ACTIVE | FLAG_SOLID) as f64;
    }

    #[test]
    fn bodies_path_around_a_wall_to_the_player() {
        let mut w = flat_world();
        // Wall across x in [-10, 10] at z = 0, 3 blocks tall (too tall to hop).
        for x in -10..=10 {
            for y in 64..67 {
                w.set(x, y, 0, STONE);
            }
        }
        let mut e = Entities::new(8, 8);
        spawn(&mut e, 0, 0.5, -8.0);
        let player = [0.5, 64.0, 8.0];
        for _ in 0..(60 * 20) {
            e.step_bodies(&w, 1.0 / 60.0, &[target(player, 0)]);
        }
        let b = &e.bodies[0..body::STRIDE];
        let d = ((b[body::X] - player[0]).powi(2) + (b[body::Z] - player[2]).powi(2)).sqrt();
        assert!(d < 2.0, "body should reach the player around the wall, ended {d:.2} away at ({:.1},{:.1})", b[body::X], b[body::Z]);
    }

    #[test]
    fn bodies_climb_single_steps() {
        let mut w = flat_world();
        for x in -20..20 {
            for z in 2..20 {
                w.set(x, 64, z, STONE);
            }
        }
        let mut e = Entities::new(4, 4);
        spawn(&mut e, 0, 0.5, -5.0);
        let player = [0.5, 65.0, 10.0];
        for _ in 0..(60 * 8) {
            e.step_bodies(&w, 1.0 / 60.0, &[target(player, 0)]);
        }
        let b = &e.bodies[0..body::STRIDE];
        assert!(b[body::Y] >= 64.9, "climbed onto the step, y = {}", b[body::Y]);
    }

    #[test]
    fn arrows_hit_bodies_and_walls() {
        let mut w = flat_world();
        w.set(0, 65, 12, STONE);
        let mut e = Entities::new(4, 4);
        spawn(&mut e, 0, 0.5, 6.0);
        e.bodies[body::MODE] = 3.0;
        // Arrow from the player toward the body.
        let p = &mut e.projectiles[0..proj::STRIDE];
        p[proj::X] = 0.5;
        p[proj::Y] = 65.5;
        p[proj::Z] = 0.5;
        p[proj::VZ] = 30.0;
        p[proj::GRAVITY] = 10.0;
        p[proj::RADIUS] = 0.05;
        p[proj::OWNER] = -1.0;
        p[proj::FLAGS] = (PFLAG_ACTIVE | PFLAG_HITS_BODIES) as f64;
        for _ in 0..60 {
            e.step_projectiles(&w, 1.0 / 60.0, &[target([100.0, 64.0, 100.0], 0)]);
        }
        assert_eq!(e.projectiles[proj::HIT_KIND], 3.0);
        assert_eq!(e.projectiles[proj::HIT_INDEX], 0.0);
        // A second arrow flies past everything into the wall block.
        let p = &mut e.projectiles[proj::STRIDE..2 * proj::STRIDE];
        p[proj::X] = 0.5;
        p[proj::Y] = 65.5;
        p[proj::Z] = 8.0;
        p[proj::VZ] = 30.0;
        p[proj::RADIUS] = 0.05;
        p[proj::OWNER] = -1.0;
        p[proj::FLAGS] = (PFLAG_ACTIVE | PFLAG_HITS_BODIES) as f64;
        for _ in 0..60 {
            e.step_projectiles(&w, 1.0 / 60.0, &[target([100.0, 64.0, 100.0], 0)]);
        }
        let p = &e.projectiles[proj::STRIDE..2 * proj::STRIDE];
        assert_eq!(p[proj::HIT_KIND], 1.0);
        assert!(p[proj::Z] < 12.0 && p[proj::Z] > 11.5, "stuck at the wall face, z = {}", p[proj::Z]);
    }

    #[test]
    fn melee_pick_respects_walls() {
        let mut w = flat_world();
        let mut e = Entities::new(4, 4);
        spawn(&mut e, 0, 0.5, 3.0);
        let hit = e.pick_body(&w, [0.5, 65.6, 0.5], [0.0, 0.0, 1.0], 4.0, 0.1);
        assert_eq!(hit.map(|h| h.0), Some(0));
        w.set(0, 65, 2, STONE);
        let hit = e.pick_body(&w, [0.5, 65.6, 0.5], [0.0, 0.0, 1.0], 4.0, 0.1);
        assert!(hit.is_none());
    }
}
