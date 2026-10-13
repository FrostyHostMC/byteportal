//! Voxel engine compute core compiled to WebAssembly: terrain generation, lighting, meshing,
//! physics, raycasting, visibility culling and shadow-camera math.

use wasm_bindgen::prelude::*;

pub mod blocks;
pub mod cull;
pub mod damage;
pub mod entities;
pub mod entitytex;
pub mod gen;
pub mod json;
pub mod mesher;
pub mod movers;
pub mod noise;
pub mod noisetex;
pub mod shapes;
pub mod texgen;
pub mod world;

#[cfg(test)]
pub mod testutil;

#[wasm_bindgen]
pub fn block_registry_json() -> String {
    blocks::registry_json()
}

/// Use a game's own blocks from now on (in this engine instance): a JSON list of variants (see
/// `blocks::set_game_blocks`), ids from `game_block_first()` in order; `[]` for none. Call it
/// before making the generator, mesher or world that should know them. Returns how many; throws
/// the reason if the list is wrong (the blocks in use don't change then).
#[wasm_bindgen]
pub fn set_game_blocks(json: &str) -> Result<u32, JsValue> {
    blocks::set_game_blocks(json).map(|n| n as u32).map_err(|e| JsValue::from_str(&e))
}

/// The first id a game's own blocks get; they go up to 254.
#[wasm_bindgen]
pub fn game_block_first() -> u32 {
    blocks::GAME_FIRST as u32
}

/// Albedo layers followed by material layers (see `texgen`).
#[wasm_bindgen]
pub fn generate_textures() -> Vec<u8> {
    let (mut a, m) = texgen::generate();
    a.extend_from_slice(&m);
    a
}

/// Built-in entity atlas (monster skins + item sprites): 256x256 RGBA albedo followed by
/// 256x256 single-channel emissive.
#[wasm_bindgen]
pub fn entity_textures() -> Vec<u8> {
    let (mut a, e) = entitytex::generate();
    a.extend_from_slice(&e);
    a
}

#[wasm_bindgen]
pub fn texture_layer_count() -> u32 {
    blocks::tex::COUNT as u32
}

#[wasm_bindgen]
pub fn noise_texture(size: u32) -> Vec<u8> {
    noisetex::generate(size as usize)
}

#[wasm_bindgen]
pub fn sea_level() -> i32 {
    gen::SEA
}

#[wasm_bindgen]
pub fn mesh_header_words() -> u32 {
    mesher::MESH_HEADER as u32
}

#[wasm_bindgen]
pub fn chunk_header_bytes() -> u32 {
    gen::HEADER_BYTES as u32
}

/// Stateless terrain generator (one per worker).
#[wasm_bindgen]
pub struct TerrainGen {
    inner: gen::Generator,
}

#[wasm_bindgen]
impl TerrainGen {
    #[wasm_bindgen(constructor)]
    pub fn new(seed: u32) -> TerrainGen {
        TerrainGen { inner: gen::Generator::new(seed) }
    }

    pub fn generate(&mut self, cx: i32, cz: i32) -> Vec<u8> {
        self.inner.generate(cx, cz)
    }

    /// Stamp a game structure during generation. `data` is (y * sz + z) * sx + x; 255 = keep.
    #[allow(clippy::too_many_arguments)]
    pub fn add_blueprint(&mut self, ox: i32, oy: i32, oz: i32, sx: i32, sy: i32, sz: i32, data: &[u8]) {
        self.inner.add_blueprint(gen::Blueprint { origin: [ox, oy, oz], size: [sx, sy, sz], data: data.to_vec() });
    }

    /// Flatten terrain to `height` inside `radius`, blending over `blend` blocks.
    pub fn add_terraform(&mut self, cx: f32, cz: f32, radius: f32, blend: f32, height: f32) {
        self.inner.add_terraform(gen::Terraform { cx, cz, radius, blend, height });
    }

    pub fn set_flat(&mut self, height: f32) {
        self.inner.set_flat(height);
    }

    pub fn set_void(&mut self) {
        self.inner.set_void();
    }

    pub fn set_void_ground(&mut self, y: i32, top: u8, fill: u8, depth: u8) {
        self.inner.set_void_ground(y, top, fill, depth);
    }

    /// [x, y, z] of a pleasant spawn column.
    pub fn find_spawn(&self) -> Vec<i32> {
        let (x, y, z) = self.inner.find_spawn();
        vec![x, y, z]
    }
}

/// Lighting + meshing (one per worker).
#[wasm_bindgen]
pub struct ChunkMesher {
    inner: mesher::Mesher,
}

#[wasm_bindgen]
impl ChunkMesher {
    #[wasm_bindgen(constructor)]
    pub fn new() -> ChunkMesher {
        ChunkMesher { inner: mesher::Mesher::new() }
    }

    pub fn mesh(&mut self, region: &[u8]) -> Vec<u32> {
        self.inner.mesh(region)
    }
}

impl Default for ChunkMesher {
    fn default() -> Self {
        Self::new()
    }
}

/// A world: block storage, edits, raycasts, the players' physics bodies (by slot) and the
/// entity simulation.
#[wasm_bindgen]
pub struct VoxelWorld {
    inner: world::World,
    players: Vec<Option<world::Player>>,
    entities: entities::Entities,
}

impl VoxelWorld {
    // A slot with no player (removed, never added) is ignored rather than a panic: a panic in
    // WebAssembly leaves the world unusable for every later call.
    fn player(&self, i: u32) -> Option<&world::Player> {
        self.players.get(i as usize).and_then(|p| p.as_ref())
    }

    fn player_mut(&mut self, i: u32) -> Option<&mut world::Player> {
        self.players.get_mut(i as usize).and_then(|p| p.as_mut())
    }

    fn settle(world: &mut world::World, dt: f64) {
        for m in world.movers.iter_mut() {
            m.was = m.prev;
            m.span = dt;
            m.prev = m.now;
        }
    }

    /// The players the entities react to: everyone not frozen (dead, in a menu) or a ghost (spectating).
    fn targets(&self) -> Vec<entities::Target> {
        self.players
            .iter()
            .enumerate()
            .filter_map(|(slot, p)| p.as_ref().filter(|p| !p.frozen && !p.ghost).map(|p| entities::Target { pos: p.pos, hw: world::HALF_W, h: world::HEIGHT, slot }))
            .collect()
    }
}

#[wasm_bindgen]
impl VoxelWorld {
    #[wasm_bindgen(constructor)]
    pub fn new() -> VoxelWorld {
        VoxelWorld { inner: world::World::new(), players: Vec::new(), entities: entities::Entities::new(160, 320) }
    }

    pub fn insert_column(&mut self, cx: i32, cz: i32, data: &[u8]) {
        self.inner.insert_column(cx, cz, data);
    }

    pub fn remove_column(&mut self, cx: i32, cz: i32) {
        self.inner.remove_column(cx, cz);
    }

    pub fn has_column(&self, cx: i32, cz: i32) -> bool {
        self.inner.has_column(cx, cz)
    }

    pub fn column_count(&self) -> u32 {
        self.inner.column_count() as u32
    }

    /// Block id; 255 when the column is not loaded.
    pub fn get_block(&self, x: i32, y: i32, z: i32) -> u8 {
        self.inner.get_or(x, y, z, 255)
    }

    pub fn set_block(&mut self, x: i32, y: i32, z: i32, b: u8) -> bool {
        self.inner.set(x, y, z, b)
    }

    /// An edit from the simulation's copy of the world: applied now if loaded, else when the
    /// column loads. True if the block changed now.
    pub fn mirror_block(&mut self, x: i32, y: i32, z: i32, b: u8) -> bool {
        self.inner.mirror(x, y, z, b)
    }

    pub fn extract_region(&self, cx: i32, cz: i32) -> Vec<u8> {
        self.inner.extract_region(cx, cz)
    }

    pub fn export_edits(&self) -> Vec<u8> {
        self.inner.export_edits()
    }

    pub fn import_edits(&mut self, data: &[u8]) {
        self.inner.import_edits(data);
    }

    pub fn clear_edits(&mut self) {
        self.inner.clear_edits();
    }

    /// Undo this session's edits; returns the loaded columns that changed as [cx, cz, ...].
    pub fn revert_edits(&mut self) -> Vec<i32> {
        self.inner.revert_edits()
    }

    pub fn edit_count(&self) -> u32 {
        self.inner.edit_count() as u32
    }

    // ---- Damage: blocks shot into, little voxel by little voxel (see `damage.rs`) ----

    /// Which blocks `carve` can take bits out of: `ids` has 1 for each destructible block id (by
    /// id; all 0 or empty turns carving off), and only blocks higher than `above`. Solid opaque
    /// cubes only, whatever it says.
    pub fn set_destructible(&mut self, above: i32, ids: &[u8]) {
        if !ids.iter().any(|&b| b != 0) {
            self.inner.destructible = None;
            return;
        }
        let mut t = [false; 256];
        for (i, &b) in ids.iter().take(256).enumerate() {
            t[i] = b != 0;
        }
        self.inner.destructible = Some(Box::new(world::Destructible { above, ids: t }));
    }

    /// Take a capsule of little voxels out of the destructible blocks it reaches: from (x, y, z)
    /// along (dx, dy, dz) for `depth` blocks, `radius` round. Returns [removed u32, n u32, then n
    /// blocks left with nothing (air now, an edit) as x, y, z, the block it was (i32 each), then
    /// the changes to the rest for other copies of the world (`apply_damage`)], little-endian.
    #[allow(clippy::too_many_arguments)]
    pub fn carve(&mut self, x: f64, y: f64, z: f64, dx: f64, dy: f64, dz: f64, radius: f64, depth: f64) -> Vec<u8> {
        carved_bytes(&self.inner.carve([x, y, z], [dx, dy, dz], radius, depth))
    }

    /// A blast's crater (`World::blast`): a ragged sphere of little voxels `radius` round (x, y, z),
    /// its edge wandering by `roughness` of that (the same for the same `seed`), out of the
    /// carvable blocks among `cells` (x, y, z triples). Returns what `carve` returns.
    #[allow(clippy::too_many_arguments)]
    pub fn blast(&mut self, x: f64, y: f64, z: f64, radius: f64, roughness: f64, seed: u32, cells: &[i32]) -> Vec<u8> {
        carved_bytes(&self.inner.blast([x, y, z], radius, roughness, seed, cells))
    }

    /// Whether `carve` and `blast` can take bits out of the block at (x, y, z).
    pub fn carvable(&self, x: i32, y: i32, z: i32) -> bool {
        self.inner.carvable_at(x, y, z)
    }

    /// Whether a point is inside solid material: a solid block's collision boxes, less what's been
    /// shot out of it. Unloaded columns count as air.
    pub fn point_solid(&self, x: f64, y: f64, z: f64) -> bool {
        world::point_solid(&self.inner, [x, y, z])
    }

    /// A ray that went into material at (ox, oy, oz): [found, distance, nx, ny, nz], how far along
    /// it comes out into the open and the face it comes out of (see `World::ray_exit`); found 0
    /// when it's still in material after `max`.
    #[allow(clippy::too_many_arguments)]
    pub fn ray_exit(&self, ox: f64, oy: f64, oz: f64, dx: f64, dy: f64, dz: f64, max: f64) -> Vec<f64> {
        match self.inner.ray_exit([ox, oy, oz], [dx, dy, dz], max) {
            Some((t, n)) => vec![1.0, t, n[0] as f64, n[1] as f64, n[2] as f64],
            None => vec![0.0; 5],
        }
    }

    /// Damage from the simulation's copy of the world (`carve`'s changes, `export_damage`), here
    /// too. Returns the loaded columns whose meshes change: [cx, cz, relight] triples, relight 1
    /// where a block went altogether (remesh around it: its light changed).
    pub fn apply_damage(&mut self, data: &[u8]) -> Vec<i32> {
        self.inner.apply_damage(data)
    }

    /// All the damage, for `apply_damage` in a copy of the world that has none (a late joiner).
    pub fn export_damage(&self) -> Vec<u8> {
        self.inner.export_damage()
    }

    /// How many blocks are damaged.
    pub fn damage_count(&self) -> u32 {
        self.inner.damage_count() as u32
    }

    /// How many of a block's 4096 little voxels are left: fewer once it's been carved, 4096 for
    /// a block that hasn't (whatever it is).
    pub fn damage_left(&self, x: i32, y: i32, z: i32) -> u32 {
        self.inner.damage_at(x, y, z).map_or(damage::CELLS, |d| d.left)
    }

    /// [hit, bx, by, bz, nx, ny, nz, block, distance]
    #[allow(clippy::too_many_arguments)]
    pub fn raycast(&self, ox: f64, oy: f64, oz: f64, dx: f64, dy: f64, dz: f64, max_dist: f64) -> Vec<f64> {
        match self.inner.raycast([ox, oy, oz], [dx, dy, dz], max_dist) {
            Some((p, n, b, t)) => vec![1.0, p[0] as f64, p[1] as f64, p[2] as f64, n[0] as f64, n[1] as f64, n[2] as f64, b as f64, t],
            None => vec![0.0; 9],
        }
    }

    /// A new player body at (x, y, z); returns its slot (slots of removed players are reused).
    pub fn player_add(&mut self, x: f64, y: f64, z: f64) -> u32 {
        let p = Some(world::Player::new(x, y, z));
        match self.players.iter().position(|p| p.is_none()) {
            Some(i) => {
                self.players[i] = p;
                i as u32
            }
            None => {
                self.players.push(p);
                (self.players.len() - 1) as u32
            }
        }
    }

    pub fn player_remove(&mut self, i: u32) {
        if let Some(p) = self.players.get_mut(i as usize) {
            *p = None;
        }
    }

    pub fn player_reset(&mut self, i: u32, x: f64, y: f64, z: f64) {
        let Some(p) = self.player_mut(i) else { return };
        let (flying, frozen, ghost, tune) = (p.flying, p.frozen, p.ghost, p.tune);
        *p = world::Player::new(x, y, z);
        p.flying = flying;
        p.frozen = frozen;
        p.ghost = ghost;
        p.tune = tune;
    }

    pub fn set_flying(&mut self, i: u32, on: bool) {
        let Some(p) = self.player_mut(i) else { return };
        p.flying = on;
        if on {
            p.vel[1] = p.vel[1].max(0.0);
        }
    }

    pub fn set_frozen(&mut self, i: u32, on: bool) {
        if let Some(p) = self.player_mut(i) {
            p.frozen = on;
        }
    }

    /// A spectator (on) or a player again: see `world::Player::ghost`. Flying either way; off, they fall.
    pub fn set_ghost(&mut self, i: u32, on: bool) {
        let Some(p) = self.player_mut(i) else { return };
        if p.ghost == on {
            return;
        }
        p.ghost = on;
        p.flying = on;
        p.vel = [0.0; 3];
    }

    /// How a player moves: [walk, sprint, sneak, jump, gravity, ground_accel, air_accel,
    /// edge_guard (0/1), mantle, slide_friction] (see `world::Tuning`). Kept across `player_reset`.
    pub fn player_tune(&mut self, i: u32, t: &[f64]) {
        let Some(p) = self.player_mut(i) else { return };
        let d = world::Tuning::MINECRAFT;
        let at = |k: usize, def: f64| t.get(k).copied().filter(|v| v.is_finite()).unwrap_or(def);
        p.tune = world::Tuning {
            walk: at(0, d.walk),
            sprint: at(1, d.sprint),
            sneak: at(2, d.sneak),
            jump: at(3, d.jump),
            gravity: at(4, d.gravity),
            ground_accel: at(5, d.ground_accel),
            air_accel: at(6, d.air_accel),
            edge_guard: at(7, 1.0) > 0.5,
            mantle: at(8, d.mantle).clamp(0.0, 2.0),
            slide_friction: at(9, d.slide_friction),
        };
    }

    /// One step of a player's movement. `gravity` and `control` multiply the game's gravity and
    /// how quickly speed follows the wish, for this step only (1, 1; movement abilities change them).
    #[allow(clippy::too_many_arguments)]
    pub fn player_step(&mut self, i: u32, wish_x: f64, wish_z: f64, jump: bool, sneak: bool, sprint: bool, slide: bool, speed: f64, gravity: f64, control: f64, dt: f64) {
        let input = world::MoveInput { wish_x, wish_z, jump, sneak, sprint, slide, speed };
        let VoxelWorld { inner, players, .. } = self;
        if let Some(Some(p)) = players.get_mut(i as usize) {
            p.gravity_scale = gravity;
            p.control_scale = control;
            p.step(inner, &input, dt);
        }
    }

    /// Whether a player's body (0.6 x 1.8 x 0.6) fits with its feet at (x, y, z): no solid block,
    /// block model or mover in the way (unloaded columns count as solid).
    pub fn player_fits(&self, x: f64, y: f64, z: f64) -> bool {
        !world::aabb_collides(&self.inner, [x, y, z], world::HALF_W, world::HEIGHT)
    }

    /// [x, y, z, vx, vy, vz, on_ground, in_water, eyes_in_water, in_lava, flying, bob, frozen,
    /// ride, ride_x, ride_y, ride_z] (the mover they ride, 0 for none, and where they are on it)
    pub fn player_state(&self, i: u32) -> Vec<f64> {
        let Some(p) = self.player(i) else {
            // Nobody there: nowhere, frozen.
            let mut v = vec![0.0; 17];
            v[12] = 1.0;
            return v;
        };
        vec![
            p.pos[0],
            p.pos[1],
            p.pos[2],
            p.vel[0],
            p.vel[1],
            p.vel[2],
            p.on_ground as u8 as f64,
            p.in_water as u8 as f64,
            p.eyes_in_water as u8 as f64,
            p.in_lava as u8 as f64,
            p.flying as u8 as f64,
            p.bob,
            p.frozen as u8 as f64,
            p.ride.id as f64,
            p.ride.local[0],
            p.ride.local[1],
            p.ride.local[2],
        ]
    }

    /// Put a player's body back exactly as `player_state` described it (client-side prediction
    /// starts again from the server's word).
    pub fn player_restore(&mut self, i: u32, s: &[f64]) {
        if s.len() < 12 {
            return;
        }
        let Some(p) = self.player_mut(i) else { return };
        p.pos = [s[0], s[1], s[2]];
        p.vel = [s[3], s[4], s[5]];
        p.on_ground = s[6] > 0.5;
        p.in_water = s[7] > 0.5;
        p.eyes_in_water = s[8] > 0.5;
        p.in_lava = s[9] > 0.5;
        p.flying = s[10] > 0.5;
        p.bob = s[11];
        p.frozen = s.get(12).is_some_and(|f| *f > 0.5);
        p.ride = if s.len() >= 17 { world::Ride { id: s[13] as u32, local: [s[14], s[15], s[16]] } } else { world::Ride::default() };
    }

    // ---- Movers: moving block colliders (see `movers.rs`) ----

    /// Add (or replace) a mover: `cells` holds 1 for each solid cell of an `sx` x `sy` x `sz` grid
    /// (index `(y * sz + z) * sx + x`); the model's origin is at grid point (`px`, `py`, `pz`) and
    /// a cell is `unit` model units across.
    #[allow(clippy::too_many_arguments)]
    pub fn mover_add(&mut self, id: u32, sx: i32, sy: i32, sz: i32, cells: &[u8], px: f64, py: f64, pz: f64, unit: f64) {
        if id == 0 || sx <= 0 || sy <= 0 || sz <= 0 || cells.len() < (sx * sy * sz) as usize {
            return;
        }
        self.mover_remove(id);
        let m = movers::Mover::new(id, [sx, sy, sz], cells[..(sx * sy * sz) as usize].to_vec(), [px, py, pz], unit);
        self.inner.movers.push(m);
    }

    pub fn mover_remove(&mut self, id: u32) {
        self.inner.movers.retain(|m| m.id != id);
    }

    pub fn mover_count(&self) -> u32 {
        self.inner.movers.len() as u32
    }

    /// Where a mover is now: position, rotation (unit quaternion) and scale. `snap` places it
    /// without motion (new, teleported): nothing riding it is carried and nobody is pushed.
    #[allow(clippy::too_many_arguments)]
    pub fn mover_pose(&mut self, id: u32, x: f64, y: f64, z: f64, qx: f64, qy: f64, qz: f64, qw: f64, scale: f64, snap: bool) {
        let Some(m) = self.inner.mover_mut(id) else { return };
        let l = (qx * qx + qy * qy + qz * qz + qw * qw).sqrt();
        let rot = if l > 1e-9 { [qx / l, qy / l, qz / l, qw / l] } else { [0.0, 0.0, 0.0, 1.0] };
        m.now = movers::Pose { pos: [x, y, z], rot, scale };
        if snap {
            m.prev = m.now;
            m.was = m.now;
        }
    }

    /// The movers have moved (`mover_pose`) over `dt` seconds: carry what rides them, push what
    /// they ran into, and start measuring their motion afresh.
    pub fn movers_carry(&mut self, dt: f64) {
        if self.inner.movers.is_empty() {
            return;
        }
        let VoxelWorld { inner, players, entities } = self;
        for p in players.iter_mut().flatten() {
            p.carry(inner);
        }
        entities.carry(inner);
        Self::settle(inner, dt);
    }

    /// `movers_carry` without the carrying (a client's copy of the world, which only predicts).
    pub fn movers_settle(&mut self, dt: f64) {
        Self::settle(&mut self.inner, dt);
    }

    /// [mover id or 0, distance] for the first mover along a ray within `max_dist`.
    #[allow(clippy::too_many_arguments)]
    pub fn mover_raycast(&self, ox: f64, oy: f64, oz: f64, dx: f64, dy: f64, dz: f64, max_dist: f64) -> Vec<f64> {
        let l = (dx * dx + dy * dy + dz * dz).sqrt();
        if l < 1e-12 {
            return vec![0.0, 0.0];
        }
        match self.inner.raycast_movers([ox, oy, oz], [dx / l, dy / l, dz / l], max_dist) {
            Some((id, t)) => vec![id as f64, t],
            None => vec![0.0, 0.0],
        }
    }

    /// How many of a mover's blocks would be in the world's solid blocks with it at this pose
    /// (position, rotation, scale): 0 when it's clear.
    #[allow(clippy::too_many_arguments)]
    pub fn mover_overlap(&self, id: u32, x: f64, y: f64, z: f64, qx: f64, qy: f64, qz: f64, qw: f64, scale: f64) -> u32 {
        let Some(m) = self.inner.mover(id) else { return 0 };
        let l = (qx * qx + qy * qy + qz * qz + qw * qw).sqrt();
        let rot = if l > 1e-9 { [qx / l, qy / l, qz / l, qw / l] } else { [0.0, 0.0, 0.0, 1.0] };
        world::mover_in_blocks(&self.inner, m, &movers::Pose { pos: [x, y, z], rot, scale })
    }

    /// The mover whose cells hold this point, or 0.
    pub fn mover_at(&self, x: f64, y: f64, z: f64) -> u32 {
        self.inner.movers.iter().find(|m| m.contains([x, y, z])).map_or(0, |m| m.id)
    }

    /// [ride, x, y, z] for an entity body: the mover it rides (0 for none) and where it is on it.
    pub fn body_ride(&self, i: u32) -> Vec<f64> {
        let b = &self.entities.bodies;
        let o = i as usize * entities::body::STRIDE;
        if o + entities::body::STRIDE > b.len() {
            return vec![0.0; 4];
        }
        vec![b[o + entities::body::RIDE], b[o + entities::body::RIDE_X], b[o + entities::body::RIDE_Y], b[o + entities::body::RIDE_Z]]
    }

    /// [sky, block] light estimate (0..1) at a block position.
    pub fn light_probe(&self, x: i32, y: i32, z: i32) -> Vec<f32> {
        let (s, b) = self.inner.light_probe(x, y, z);
        vec![s, b]
    }

    /// Add a velocity change to a player (knockback, launch pads).
    pub fn player_impulse(&mut self, i: u32, vx: f64, vy: f64, vz: f64) {
        if let Some(p) = self.player_mut(i) {
            p.impulse([vx, vy, vz]);
        }
    }

    // ---- Entity simulation (see `entities.rs` for the buffer layouts) ----

    pub fn bodies_ptr(&self) -> u32 {
        self.entities.bodies.as_ptr() as u32
    }

    pub fn body_capacity(&self) -> u32 {
        self.entities.body_capacity() as u32
    }

    pub fn body_stride(&self) -> u32 {
        entities::body::STRIDE as u32
    }

    pub fn projectiles_ptr(&self) -> u32 {
        self.entities.projectiles.as_ptr() as u32
    }

    pub fn projectile_capacity(&self) -> u32 {
        self.entities.projectile_capacity() as u32
    }

    pub fn projectile_stride(&self) -> u32 {
        entities::proj::STRIDE as u32
    }

    /// Advance bodies (navigation, physics, separation) and projectiles.
    pub fn step_entities(&mut self, dt: f64) {
        let targets = self.targets();
        self.entities.step_bodies(&self.inner, dt, &targets);
        self.entities.step_projectiles(&self.inner, dt, &targets);
    }

    /// Force a navigation-field rebuild toward the players now.
    pub fn rebuild_flow(&mut self) {
        let targets = self.targets();
        self.entities.rebuild_flow(&self.inner, &targets);
    }

    /// [body index or -1, distance] for the first body hit by a ray before any solid block.
    #[allow(clippy::too_many_arguments)]
    pub fn pick_body(&self, ox: f64, oy: f64, oz: f64, dx: f64, dy: f64, dz: f64, max_dist: f64, pad: f64) -> Vec<f64> {
        match self.entities.pick_body(&self.inner, [ox, oy, oz], [dx, dy, dz], max_dist, pad) {
            Some((i, t)) => vec![i as f64, t],
            None => vec![-1.0, 0.0],
        }
    }

    /// Whether the segment between two points is free of solid blocks.
    #[allow(clippy::too_many_arguments)]
    pub fn line_clear(&self, ax: f64, ay: f64, az: f64, bx: f64, by: f64, bz: f64) -> bool {
        entities::line_clear(&self.inner, [ax, ay, az], [bx, by, bz])
    }

    /// How high the collision of the block at (x, y, z) reaches above the bottom of its cell, in
    /// blocks: 0 if nothing there is solid, 1 for a full block, 0.5 for a bottom slab, 1.5 for a
    /// fence; a fence as it's joined there, a carved block as what's left of it. Unloaded columns
    /// count as solid.
    pub fn collision_top(&self, x: i32, y: i32, z: i32) -> f64 {
        self.inner.collision_at(x, y, z, blocks::STONE).iter().map(|b| b[4]).max().unwrap_or(0) as f64 / 16.0
    }

    /// The boxes you aim at in the block at (x, y, z), 6 numbers each (1/16 of a block within its
    /// cell): a fence or pane as it's joined there. Empty for air.
    pub fn target_boxes(&self, x: i32, y: i32, z: i32) -> Vec<u8> {
        let b = self.inner.get(x, y, z);
        if b == blocks::AIR {
            return Vec::new();
        }
        self.inner.target_at(x, y, z, b).concat()
    }

    /// Whether block `id` at (x, y, z) would overlap any player's body (only its solid boxes:
    /// a bottom slab leaves room above it). By id, not what's there: the block would be new, and
    /// whole.
    pub fn player_overlaps(&self, x: i32, y: i32, z: i32, id: u8) -> bool {
        let k = 1.0 / 16.0;
        self.players.iter().flatten().any(|p| {
            let p = &p.pos;
            let (x0, x1) = (p[0] - world::HALF_W, p[0] + world::HALF_W);
            let (y0, y1) = (p[1], p[1] + world::HEIGHT);
            let (z0, z1) = (p[2] - world::HALF_W, p[2] + world::HALF_W);
            world::collision_boxes(id).iter().any(|b| {
                let (bx0, by0, bz0) = (x as f64 + b[0] as f64 * k, y as f64 + b[1] as f64 * k, z as f64 + b[2] as f64 * k);
                let (bx1, by1, bz1) = (x as f64 + b[3] as f64 * k, y as f64 + b[4] as f64 * k, z as f64 + b[5] as f64 * k);
                bx0 < x1 && bx1 > x0 && by0 < y1 && by1 > y0 && bz0 < z1 && bz1 > z0
            })
        })
    }
}

impl Default for VoxelWorld {
    fn default() -> Self {
        Self::new()
    }
}

/// Visibility culling over registered chunk meshes.
#[wasm_bindgen]
pub struct Culler {
    inner: cull::Culler,
}

#[wasm_bindgen]
impl Culler {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Culler {
        Culler { inner: cull::Culler::new() }
    }

    pub fn set_column(&mut self, cx: i32, cz: i32, header: &[u32]) -> u32 {
        self.inner.set_column(cx, cz, header) as u32
    }

    pub fn remove_column(&mut self, cx: i32, cz: i32) {
        self.inner.remove_column(cx, cz);
    }

    pub fn cull(&mut self, vp: &[f64], cx: f64, cy: f64, cz: f64, radius: i32, occlusion: bool) {
        self.inner.cull(vp, [cx, cy, cz], radius, occlusion);
    }

    pub fn cull_shadow(&mut self, vp: &[f64], cx: f64, cy: f64, cz: f64, radius: i32) {
        self.inner.cull_shadow(vp, [cx, cy, cz], radius);
    }

    /// Slot capacity; output arrays hold 6 (main) / 4 (shadow) words per slot.
    pub fn capacity(&self) -> u32 {
        self.inner.capacity() as u32
    }

    pub fn out_ptr(&self) -> u32 {
        self.inner.out.as_ptr() as u32
    }

    pub fn out_shadow_ptr(&self) -> u32 {
        self.inner.out_shadow.as_ptr() as u32
    }

    pub fn visible_sections(&self) -> u32 {
        self.inner.visible_sections
    }
}

impl Default for Culler {
    fn default() -> Self {
        Self::new()
    }
}

/// View (16) + projection (16) matrices of a texel-snapped orthographic shadow camera.
#[wasm_bindgen]
pub fn shadow_camera(to_sun: &[f64], center: &[f64], radius: f64, depth: f64, resolution: f64) -> Vec<f64> {
    cull::shadow_camera([to_sun[0], to_sun[1], to_sun[2]], [center[0], center[1], center[2]], radius, depth, resolution).to_vec()
}

/// What a carve or a blast changed, for the host: [removed u32, n u32, then n blocks left with
/// nothing (air now, an edit) as x, y, z, the block it was (i32 each), then the changes to the rest
/// for other copies of the world (`apply_damage`)], little-endian.
fn carved_bytes(c: &world::Carved) -> Vec<u8> {
    let mut out = Vec::with_capacity(8 + c.emptied.len() * 16 + c.cells.len() * 64);
    out.extend_from_slice(&c.removed.to_le_bytes());
    out.extend_from_slice(&(c.emptied.len() as u32).to_le_bytes());
    for (p, id) in &c.emptied {
        for v in [p[0], p[1], p[2], *id as i32] {
            out.extend_from_slice(&v.to_le_bytes());
        }
    }
    for (cell, gone) in &c.cells {
        damage::encode(&mut out, *cell, gone);
    }
    out
}
