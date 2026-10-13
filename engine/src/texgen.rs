//! Procedural pixel-art block textures. There are no image assets: every layer of the block
//! texture array is painted here at startup from fixed seeds.
//!
//! Techniques: periodic value noise and toroidal Worley cells for structure (so every full-block
//! texture tiles seamlessly), rank equalisation plus hand-picked palettes for crisp posterised
//! pixel art, and a per-texture height field that both bakes top-left bevel lighting into the
//! albedo and produces the normal map (wrap-around Sobel).
//!
//! Output contract:
//! - `generate()` returns `(albedo, material)`, each `tex::COUNT * 16 * 16 * 4` bytes,
//!   layer-major: byte offset = `(layer * 256 + row * 16 + col) * 4`, row 0 = top of the image.
//! - albedo (sRGB RGBA8): alpha 255 for opaque textures, except the biome tint mask: every pixel
//!   of `grass_top` and the grass fringe of `grass_side` have alpha 0 and neutral grey RGB
//!   ("multiply by the grass colour"). Cutout textures (leaves, glass, plants, torch) use alpha
//!   strictly 0 or 255; transparent texels carry the colour of nearby opaque texels so mipmaps
//!   do not bleed dark fringes. `oak_leaves`, `short_grass` and `fern` are neutral grey (tinted).
//! - material (linear RGBA8): R,G = tangent-space normal XY encoded as n*0.5+0.5 (128 = flat,
//!   +X = toward increasing column, +Y = toward row 0), B = smoothness, A = emissive.

#![allow(clippy::needless_range_loop)]

use crate::blocks::tex;

pub const TEX_SIZE: usize = 16;
const S: i32 = TEX_SIZE as i32;
const P: usize = TEX_SIZE * TEX_SIZE;

type Col = [f32; 3];

/// Returns `(albedo, material)`; see the module docs for the layout and semantics.
pub fn generate() -> (Vec<u8>, Vec<u8>) {
    let n = tex::COUNT * P * 4;
    let mut albedo = vec![0u8; n];
    let mut material = vec![0u8; n];
    for layer in 0..tex::COUNT {
        let t = make(layer as u16);
        let r = layer * P * 4..(layer + 1) * P * 4;
        t.write(&mut albedo[r.clone()], &mut material[r]);
    }
    (albedo, material)
}

fn make(id: u16) -> Tx {
    use tex as T;
    match id {
        T::STONE => stone(),
        T::GRASS_TOP => grass_top(),
        T::GRASS_SIDE => grass_side(),
        T::DIRT => dirt(),
        T::COBBLESTONE => cobblestone(),
        T::OAK_PLANKS => planks(&OAK_PLANK_PAL, 0x5a4226, 51),
        T::BEDROCK => bedrock(),
        T::SAND => sand(),
        T::GRAVEL => gravel(),
        T::OAK_LOG => log_side(&OAK_BARK, 91),
        T::OAK_LOG_TOP => log_top(&OAK_BARK, &OAK_RING, 101),
        T::OAK_LEAVES => leaves(&OAK_LEAF),
        T::GLASS => glass(),
        T::WATER => water(),
        T::LAVA => lava(),
        T::SANDSTONE => sandstone(),
        T::SANDSTONE_TOP => sandstone_top(),
        T::SNOW => snow(),
        T::ICE => ice(),
        T::COAL_ORE => ore(&COAL),
        T::IRON_ORE => ore(&IRON),
        T::GOLD_ORE => ore(&GOLD),
        T::DIAMOND_ORE => ore(&DIAMOND),
        T::REDSTONE_ORE => ore(&REDSTONE),
        T::LAPIS_ORE => ore(&LAPIS),
        T::BIRCH_LOG => birch_log(),
        T::BIRCH_LOG_TOP => log_top(&BIRCH_BARK, &BIRCH_RING, 261),
        T::BIRCH_LEAVES => leaves(&BIRCH_LEAF),
        T::SPRUCE_LOG => log_side(&SPRUCE_BARK, 281),
        T::SPRUCE_LOG_TOP => log_top(&SPRUCE_BARK, &SPRUCE_RING, 291),
        T::SPRUCE_LEAVES => spruce_leaves(),
        T::CACTUS_SIDE => cactus_side(),
        T::CACTUS_TOP => cactus_top(),
        T::SHORT_GRASS => short_grass(),
        T::FERN => fern(),
        T::DANDELION => pixel_art(&DANDELION_ART, &DANDELION_INK),
        T::POPPY => pixel_art(&POPPY_ART, &POPPY_INK),
        T::CORNFLOWER => pixel_art(&CORNFLOWER_ART, &CORNFLOWER_INK),
        T::DEAD_BUSH => dead_bush(),
        T::GLOWSTONE => glowstone(),
        T::BRICKS => bricks(),
        T::STONE_BRICKS => stone_bricks(),
        T::MOSSY_COBBLESTONE => mossy_cobblestone(),
        T::CLAY => clay(),
        T::GRASS_SNOW_SIDE => snow_side(),
        T::OBSIDIAN => obsidian(),
        T::BOOKSHELF => bookshelf(),
        T::TORCH => torch(),
        T::GRANITE => speckled(&GRANITE_PAL, 481, 0.5),
        T::DIORITE => speckled(&DIORITE_PAL, 491, 0.55),
        T::ANDESITE => speckled(&ANDESITE_PAL, 501, 0.45),
        T::DEEPSLATE => deepslate(),
        T::DEEPSLATE_TOP => deepslate_top(),
        T::PODZOL_TOP => podzol_top(),
        T::PODZOL_SIDE => podzol_side(),
        T::WHITE_WOOL => wool(0xe4e6e6, 551),
        T::RED_WOOL => wool(0xa32b26, 561),
        T::YELLOW_WOOL => wool(0xe9b52a, 571),
        T::GREEN_WOOL => wool(0x587a22, 581),
        T::BLUE_WOOL => wool(0x353d9c, 591),
        T::BLACK_WOOL => wool(0x26262b, 601),
        T::SEA_LANTERN => sea_lantern(),
        T::SPRUCE_PLANKS => planks(&SPRUCE_PLANK_PAL, 0x33241a, 621),
        T::BIRCH_PLANKS => planks(&BIRCH_PLANK_PAL, 0x8c774a, 631),
        T::BROWN_MUSHROOM => pixel_art(&BROWN_MUSHROOM_ART, &BROWN_MUSHROOM_INK),
        T::RED_MUSHROOM => pixel_art(&RED_MUSHROOM_ART, &RED_MUSHROOM_INK),
        T::WHITE_CONCRETE => concrete(0xcfd5d6, 661),
        T::LIGHT_GRAY_CONCRETE => concrete(0x8a8a82, 671),
        T::GRAY_CONCRETE => concrete(0x373a3e, 681),
        T::BLACK_CONCRETE => concrete(0x08090e, 691),
        T::RED_CONCRETE => concrete(0x8e2121, 701),
        T::IRON_BLOCK => iron_block(),
        T::END_STONE => speckled(&END_STONE_PAL, 721, 0.55),
        T::RED_BED_HEAD_TOP => bed_top(RED_BED, 731, true),
        T::RED_BED_HEAD_SIDE => bed_side(RED_BED, 733, true),
        T::RED_BED_HEAD_END => bed_end(RED_BED, 747, true),
        T::RED_BED_FOOT_TOP => bed_top(RED_BED, 731, false),
        T::RED_BED_FOOT_SIDE => bed_side(RED_BED, 733, false),
        T::RED_BED_FOOT_END => bed_end(RED_BED, 747, false),
        T::BLUE_BED_HEAD_TOP => bed_top(BLUE_BED, 735, true),
        T::BLUE_BED_HEAD_SIDE => bed_side(BLUE_BED, 737, true),
        T::BLUE_BED_HEAD_END => bed_end(BLUE_BED, 749, true),
        T::BLUE_BED_FOOT_TOP => bed_top(BLUE_BED, 735, false),
        T::BLUE_BED_FOOT_SIDE => bed_side(BLUE_BED, 737, false),
        T::BLUE_BED_FOOT_END => bed_end(BLUE_BED, 749, false),
        T::GREEN_BED_HEAD_TOP => bed_top(GREEN_BED, 739, true),
        T::GREEN_BED_HEAD_SIDE => bed_side(GREEN_BED, 741, true),
        T::GREEN_BED_HEAD_END => bed_end(GREEN_BED, 751, true),
        T::GREEN_BED_FOOT_TOP => bed_top(GREEN_BED, 739, false),
        T::GREEN_BED_FOOT_SIDE => bed_side(GREEN_BED, 741, false),
        T::GREEN_BED_FOOT_END => bed_end(GREEN_BED, 751, false),
        T::YELLOW_BED_HEAD_TOP => bed_top(YELLOW_BED, 743, true),
        T::YELLOW_BED_HEAD_SIDE => bed_side(YELLOW_BED, 745, true),
        T::YELLOW_BED_HEAD_END => bed_end(YELLOW_BED, 753, true),
        T::YELLOW_BED_FOOT_TOP => bed_top(YELLOW_BED, 743, false),
        T::YELLOW_BED_FOOT_SIDE => bed_side(YELLOW_BED, 745, false),
        T::YELLOW_BED_FOOT_END => bed_end(YELLOW_BED, 753, false),
        T::WALL_TORCH => wall_torch(),
        T::ORANGE_CONCRETE => concrete(0xe06101, 1001),
        T::MAGENTA_CONCRETE => concrete(0xa9309f, 1011),
        T::LIGHT_BLUE_CONCRETE => concrete(0x2489c7, 1021),
        T::YELLOW_CONCRETE => concrete(0xf1af15, 1031),
        T::LIME_CONCRETE => concrete(0x5ea918, 1041),
        T::PINK_CONCRETE => concrete(0xd5658f, 1051),
        T::CYAN_CONCRETE => concrete(0x157788, 1061),
        T::PURPLE_CONCRETE => concrete(0x64209c, 1071),
        T::BLUE_CONCRETE => concrete(0x2c2e8f, 1081),
        T::BROWN_CONCRETE => concrete(0x603b1f, 1091),
        T::GREEN_CONCRETE => concrete(0x495b24, 1101),
        T::NEON_RED => neon(0xff3b3b, 1111),
        T::NEON_PINK => neon(0xff4fb4, 1121),
        T::NEON_CYAN => neon(0x3ff2ff, 1131),
        T::NEON_YELLOW => neon(0xffe14a, 1141),
        _ => stone(),
    }
}

// ============================================================================
// Randomness and noise (all periodic over the 16 px tile)
// ============================================================================

#[inline]
fn mix32(mut x: u32) -> u32 {
    x ^= x >> 16;
    x = x.wrapping_mul(0x7feb_352d);
    x ^= x >> 15;
    x = x.wrapping_mul(0x846c_a68b);
    x ^= x >> 16;
    x
}

#[inline]
fn hash(x: i32, y: i32, seed: u32) -> u32 {
    let h = mix32(seed.wrapping_mul(0x9e37_79b9) ^ 0x2545_f491);
    let h = mix32(h ^ (x as u32).wrapping_mul(0x85eb_ca77));
    mix32(h ^ (y as u32).wrapping_mul(0xc2b2_ae3d))
}

/// Per-pixel white noise in [0, 1); coordinates wrap at the tile size.
#[inline]
fn rnd(x: i32, y: i32, seed: u32) -> f32 {
    (hash(x.rem_euclid(S), y.rem_euclid(S), seed) >> 8) as f32 * (1.0 / 16_777_216.0)
}

/// Small sequential generator for placing features.
struct Rng(u32);

impl Rng {
    fn new(seed: u32) -> Rng {
        Rng(mix32(seed ^ 0x5bd1_e995))
    }
    fn u(&mut self) -> u32 {
        self.0 = self.0.wrapping_add(0x9e37_79b9);
        mix32(self.0)
    }
    fn f(&mut self) -> f32 {
        (self.u() >> 8) as f32 * (1.0 / 16_777_216.0)
    }
    /// Inclusive range.
    fn i(&mut self, lo: i32, hi: i32) -> i32 {
        lo + (self.u() % (hi - lo + 1) as u32) as i32
    }
    fn chance(&mut self, p: f32) -> bool {
        self.f() < p
    }
    fn sign(&mut self) -> i32 {
        if self.u() & 1 == 0 {
            1
        } else {
            -1
        }
    }
}

#[inline]
fn lerp(a: f32, b: f32, t: f32) -> f32 {
    a + (b - a) * t
}

/// Periodic value noise in [0, 1]. `x`, `y` in pixels; `cx`, `cy` lattice cells across the tile.
fn vnoise(x: f32, y: f32, cx: i32, cy: i32, seed: u32) -> f32 {
    let fx = x * cx as f32 / S as f32;
    let fy = y * cy as f32 / S as f32;
    let (x0, y0) = (fx.floor(), fy.floor());
    let (tx, ty) = (fx - x0, fy - y0);
    let (tx, ty) = (tx * tx * (3.0 - 2.0 * tx), ty * ty * (3.0 - 2.0 * ty));
    let (x0, y0) = (x0 as i32, y0 as i32);
    let g = |i: i32, j: i32| rnd(i.rem_euclid(cx), j.rem_euclid(cy), seed);
    lerp(lerp(g(x0, y0), g(x0 + 1, y0), tx), lerp(g(x0, y0 + 1), g(x0 + 1, y0 + 1), tx), ty)
}

/// Periodic fractal value noise in [0, 1].
fn fbm(x: f32, y: f32, cx: i32, cy: i32, octaves: u32, seed: u32) -> f32 {
    let (mut sum, mut amp, mut norm) = (0.0, 1.0, 0.0);
    for o in 0..octaves {
        sum += amp * vnoise(x, y, cx << o, cy << o, seed.wrapping_add(o * 7919));
        norm += amp;
        amp *= 0.5;
    }
    sum / norm
}

/// Shortest signed offset on the 16 px torus.
#[inline]
fn wrapd(d: f32) -> f32 {
    let d = d.rem_euclid(S as f32);
    if d > S as f32 * 0.5 {
        d - S as f32
    } else {
        d
    }
}

/// A Worley feature point; `w` scales the size of its cell.
#[derive(Clone, Copy)]
struct Site {
    x: f32,
    y: f32,
    w: f32,
}

struct Near {
    f1: f32,
    f2: f32,
    id: usize,
    dx: f32,
    dy: f32,
}

/// Toroidal Worley query: nearest and second-nearest (weighted) distances.
fn worley(sites: &[Site], x: f32, y: f32) -> Near {
    let mut n = Near { f1: 1e9, f2: 1e9, id: 0, dx: 0.0, dy: 0.0 };
    for (i, p) in sites.iter().enumerate() {
        let dx = wrapd(x - p.x);
        let dy = wrapd(y - p.y);
        let d = (dx * dx + dy * dy).sqrt() / p.w;
        if d < n.f1 {
            n.f2 = n.f1;
            n.f1 = d;
            n.id = i;
            n.dx = dx;
            n.dy = dy;
        } else if d < n.f2 {
            n.f2 = d;
        }
    }
    n
}

/// Poisson-ish scatter of feature points on the torus.
fn scatter(r: &mut Rng, n: usize, min_d: f32, wlo: f32, whi: f32) -> Vec<Site> {
    let mut v: Vec<Site> = Vec::with_capacity(n);
    let mut tries = 0;
    while v.len() < n && tries < 4000 {
        tries += 1;
        let (x, y) = (r.f() * S as f32, r.f() * S as f32);
        let ok = v.iter().all(|p| {
            let (dx, dy) = (wrapd(x - p.x), wrapd(y - p.y));
            dx * dx + dy * dy >= min_d * min_d
        });
        if ok {
            let w = wlo + (whi - wlo) * r.f();
            v.push(Site { x, y, w });
        }
    }
    v
}

// ============================================================================
// Fields, palettes, lighting
// ============================================================================

#[inline]
fn idx(x: i32, y: i32) -> usize {
    (y.rem_euclid(S) * S + x.rem_euclid(S)) as usize
}

#[inline]
fn xy(i: usize) -> (i32, i32) {
    ((i % TEX_SIZE) as i32, (i / TEX_SIZE) as i32)
}

/// Evaluates `f(x, y, px_centre_x, px_centre_y)` for every pixel.
fn field(f: impl Fn(i32, i32, f32, f32) -> f32) -> [f32; P] {
    let mut out = [0.0; P];
    for (i, o) in out.iter_mut().enumerate() {
        let (x, y) = xy(i);
        *o = f(x, y, x as f32 + 0.5, y as f32 + 0.5);
    }
    out
}

/// Rank-equalises a field to (0, 1): palette cut points then set exact colour proportions.
fn equalize(f: &[f32; P]) -> [f32; P] {
    let mut order = [0u16; P];
    for (i, o) in order.iter_mut().enumerate() {
        *o = i as u16;
    }
    order.sort_unstable_by(|&a, &b| f[a as usize].total_cmp(&f[b as usize]).then(a.cmp(&b)));
    let mut out = [0.0; P];
    for (r, &i) in order.iter().enumerate() {
        out[i as usize] = (r as f32 + 0.5) / P as f32;
    }
    out
}

/// Number of cut points at or below `t`.
#[inline]
fn quant(t: f32, cuts: &[f32]) -> i32 {
    cuts.iter().filter(|&&c| t >= c).count() as i32
}

#[inline]
fn hexc(v: u32) -> Col {
    [((v >> 16) & 255) as f32, ((v >> 8) & 255) as f32, (v & 255) as f32]
}

#[inline]
fn pick(p: &[u32], i: i32) -> Col {
    hexc(p[i.clamp(0, p.len() as i32 - 1) as usize])
}

#[inline]
fn mixc(a: Col, b: Col, t: f32) -> Col {
    [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]
}

#[inline]
fn mulc(a: Col, k: f32) -> Col {
    [a[0] * k, a[1] * k, a[2] * k]
}

#[inline]
fn sample(f: &[f32; P], x: i32, y: i32, wrap: bool) -> f32 {
    let (x, y) = if wrap {
        (x.rem_euclid(S), y.rem_euclid(S))
    } else {
        (x.clamp(0, S - 1), y.clamp(0, S - 1))
    };
    f[(y * S + x) as usize]
}

/// Sobel gradient: (d/dcol, d/drow).
fn sobel(f: &[f32; P], x: i32, y: i32, wrap: bool) -> (f32, f32) {
    let s = |dx: i32, dy: i32| sample(f, x + dx, y + dy, wrap);
    let gx = (s(1, -1) + 2.0 * s(1, 0) + s(1, 1) - s(-1, -1) - 2.0 * s(-1, 0) - s(-1, 1)) / 8.0;
    let gy = (s(-1, 1) + 2.0 * s(0, 1) + s(1, 1) - s(-1, -1) - 2.0 * s(0, -1) - s(1, -1)) / 8.0;
    (gx, gy)
}

/// Top-left key light term of a height field: > 0 where the surface faces up-left.
fn light(h: &[f32; P], wrap: bool) -> [f32; P] {
    let mut out = [0.0; P];
    for (i, o) in out.iter_mut().enumerate() {
        let (x, y) = xy(i);
        let (gx, gy) = sobel(h, x, y, wrap);
        *o = gx + gy;
    }
    out
}

// ============================================================================
// Texture canvas
// ============================================================================

struct Tx {
    /// sRGB colour, 0..255.
    c: [Col; P],
    a: [u8; P],
    /// Height field for the normal map (roughly 0..1).
    h: [f32; P],
    sm: [u8; P],
    em: [u8; P],
    /// Normal strength (0 = flat).
    ns: f32,
    /// Tileable: neighbourhood operations wrap around.
    wrap: bool,
    /// Cutout: dilate colours into transparent texels on output.
    cutout: bool,
}

impl Tx {
    fn new(sm: u8, ns: f32) -> Tx {
        Tx {
            c: [[128.0; 3]; P],
            a: [255; P],
            h: [0.5; P],
            sm: [sm; P],
            em: [0; P],
            ns,
            wrap: true,
            cutout: false,
        }
    }

    fn sprite(sm: u8) -> Tx {
        let mut t = Tx::new(sm, 0.0);
        t.a = [0; P];
        t.wrap = false;
        t.cutout = true;
        t
    }

    fn put(&mut self, x: i32, y: i32, c: Col) {
        if (0..S).contains(&x) && (0..S).contains(&y) {
            let i = (y * S + x) as usize;
            self.c[i] = c;
            self.a[i] = 255;
        }
    }

    /// Spreads opaque colours into transparent texels (mip-friendly cutouts).
    fn dilate(&mut self) {
        let mut known = [false; P];
        for i in 0..P {
            known[i] = self.a[i] > 0;
        }
        if !known.iter().any(|&k| k) {
            return;
        }
        for _ in 0..TEX_SIZE {
            let prev = known;
            let prev_c = self.c;
            let mut changed = false;
            for i in 0..P {
                if prev[i] {
                    continue;
                }
                let (x, y) = xy(i);
                let mut sum = [0.0f32; 3];
                let mut n = 0.0;
                for dy in -1..=1 {
                    for dx in -1..=1 {
                        let (nx, ny) = (x + dx, y + dy);
                        if (0..S).contains(&nx) && (0..S).contains(&ny) {
                            let j = (ny * S + nx) as usize;
                            if prev[j] {
                                for k in 0..3 {
                                    sum[k] += prev_c[j][k];
                                }
                                n += 1.0;
                            }
                        }
                    }
                }
                if n > 0.0 {
                    self.c[i] = mulc(sum, 1.0 / n);
                    known[i] = true;
                    changed = true;
                }
            }
            if !changed {
                break;
            }
        }
    }

    fn write(mut self, alb: &mut [u8], mat: &mut [u8]) {
        if self.cutout {
            self.dilate();
        }
        for i in 0..P {
            let (x, y) = xy(i);
            let o = i * 4;
            for k in 0..3 {
                alb[o + k] = self.c[i][k].round().clamp(0.0, 255.0) as u8;
            }
            alb[o + 3] = self.a[i];
            let (mut nx, mut ny) = (0.0f32, 0.0f32);
            if self.ns != 0.0 && (self.a[i] > 0 || !self.cutout) {
                let (gx, gy) = sobel(&self.h, x, y, self.wrap);
                nx = -gx * self.ns;
                ny = gy * self.ns;
            }
            let l = (nx * nx + ny * ny + 1.0).sqrt();
            mat[o] = enc(nx / l);
            mat[o + 1] = enc(ny / l);
            mat[o + 2] = self.sm[i];
            mat[o + 3] = self.em[i];
        }
    }
}

#[inline]
fn enc(n: f32) -> u8 {
    (n * 127.5 + 128.0).floor().clamp(0.0, 255.0) as u8
}

// ============================================================================
// Stone family
// ============================================================================

const STONE_PAL: [u32; 7] = [0x5b5b5f, 0x656569, 0x6f6f73, 0x79797d, 0x838387, 0x8d8d91, 0x97979b];

fn stone_levels() -> [i32; P] {
    let f = field(|x, y, fx, fy| {
        0.36 * fbm(fx, fy, 4, 4, 2, 11) + 0.32 * vnoise(fx, fy, 2, 8, 12) + 0.32 * rnd(x, y, 13)
    });
    let e = equalize(&f);
    let mut lv = [0i32; P];
    for i in 0..P {
        lv[i] = 1 + quant(e[i], &[0.1, 0.36, 0.7, 0.92, 0.985]);
    }
    let mut r = Rng::new(15);
    for _ in 0..2 {
        let (mut x, mut y) = (r.i(0, 15), r.i(0, 15));
        let dir = r.sign();
        let len = r.i(3, 4);
        for _ in 0..len {
            lv[idx(x, y)] = 0;
            x += dir;
            if r.chance(0.35) {
                y += 1;
            }
        }
    }
    lv
}

fn stone() -> Tx {
    let mut t = Tx::new(60, 1.1);
    let lv = stone_levels();
    for i in 0..P {
        t.c[i] = pick(&STONE_PAL, lv[i]);
        t.h[i] = lv[i] as f32 / 6.0;
    }
    t
}

struct OreSpec {
    /// shadow, base, light, highlight
    pal: [u32; 4],
    count: (i32, i32),
    size: (i32, i32),
    sm: u8,
    em: u8,
    seed: u32,
}

const COAL: OreSpec = OreSpec { pal: [0x1d1d20, 0x2b2b2f, 0x3b3b40, 0x55555b], count: (4, 5), size: (7, 10), sm: 70, em: 0, seed: 191 };
const IRON: OreSpec = OreSpec { pal: [0x8a6a53, 0xae8a6d, 0xc9a586, 0xe5c7ab], count: (4, 5), size: (6, 9), sm: 120, em: 0, seed: 201 };
const GOLD: OreSpec = OreSpec { pal: [0xb1800e, 0xdcaa1e, 0xf5d33b, 0xfff08a], count: (4, 4), size: (6, 9), sm: 215, em: 0, seed: 211 };
const DIAMOND: OreSpec = OreSpec { pal: [0x178a92, 0x2fc0ca, 0x66e4ea, 0xcffafa], count: (3, 4), size: (6, 9), sm: 235, em: 0, seed: 221 };
const REDSTONE: OreSpec = OreSpec { pal: [0x780606, 0xae0f0f, 0xdc2020, 0xff6a58], count: (4, 5), size: (6, 9), sm: 205, em: 60, seed: 231 };
const LAPIS: OreSpec = OreSpec { pal: [0x0f276a, 0x1b3e9a, 0x2c5ac6, 0x6a90e6], count: (4, 5), size: (6, 9), sm: 205, em: 0, seed: 241 };

fn ore(o: &OreSpec) -> Tx {
    let mut t = stone();
    let mut r = Rng::new(o.seed);
    let mut m = [0u8; P];
    let count = r.i(o.count.0, o.count.1) as usize;
    let mut centres: Vec<(i32, i32)> = Vec::new();
    let mut tries = 0;
    while centres.len() < count && tries < 1000 {
        tries += 1;
        let (cx, cy) = (r.i(0, 15), r.i(0, 15));
        let far = centres.iter().all(|&(a, b)| {
            let dx = wrapd((a - cx) as f32).abs();
            let dy = wrapd((b - cy) as f32).abs();
            dx.max(dy) >= 5.0
        });
        if far {
            centres.push((cx, cy));
        }
    }
    const N4: [(i32, i32); 4] = [(1, 0), (-1, 0), (0, 1), (0, -1)];
    for (k, &(cx, cy)) in centres.iter().enumerate() {
        let id = k as u8 + 1;
        let size = r.i(o.size.0, o.size.1) as usize;
        let mut pix = vec![(cx, cy)];
        m[idx(cx, cy)] = id;
        let mut guard = 0;
        while pix.len() < size && guard < 400 {
            guard += 1;
            let (px, py) = pix[r.i(0, pix.len() as i32 - 1) as usize];
            let (dx, dy) = N4[r.i(0, 3) as usize];
            let (nx, ny) = (px + dx, py + dy);
            if (nx - cx).abs() > 2 || (ny - cy).abs() > 2 {
                continue;
            }
            let j = idx(nx, ny);
            if m[j] != 0 {
                continue;
            }
            let nb = N4.iter().filter(|&&(a, b)| m[idx(nx + a, ny + b)] == id).count();
            if nb >= 2 || r.chance(0.4) {
                m[j] = id;
                pix.push((nx, ny));
            }
        }
        let mut best = (i32::MIN, 0usize);
        for &(px, py) in &pix {
            let i = idx(px, py);
            let e = |dx: i32, dy: i32| (m[idx(px + dx, py + dy)] != id) as i32;
            let s = e(0, -1) + e(-1, 0) - e(0, 1) - e(1, 0);
            let lvl = if s > 0 {
                2
            } else if s < 0 {
                0
            } else {
                1
            };
            t.c[i] = pick(&o.pal, lvl);
            t.h[i] = 1.25 + 0.1 * lvl as f32;
            t.sm[i] = o.sm;
            t.em[i] = o.em;
            let score = s * 16 - (px - cx) - (py - cy);
            if score > best.0 {
                best = (score, i);
            }
        }
        t.c[best.1] = pick(&o.pal, 3);
    }
    for i in 0..P {
        if m[i] != 0 {
            continue;
        }
        let (x, y) = xy(i);
        if m[idx(x, y - 1)] != 0 || m[idx(x - 1, y)] != 0 {
            t.c[i] = mulc(t.c[i], 0.84);
            t.h[i] -= 0.1;
        }
    }
    t
}

fn speckled(pal: &[u32; 7], seed: u32, grain: f32) -> Tx {
    let mut t = Tx::new(55, 0.9);
    let f = field(|x, y, fx, fy| {
        (1.0 - grain) * fbm(fx, fy, 4, 4, 2, seed) + grain * rnd(x, y, seed + 1)
    });
    let e = equalize(&f);
    for i in 0..P {
        let l = quant(e[i], &[0.04, 0.14, 0.36, 0.64, 0.86, 0.96]);
        t.c[i] = pick(pal, l);
        t.h[i] = l as f32 / 6.0;
    }
    t
}

const GRANITE_PAL: [u32; 7] = [0x6a4436, 0x80564a, 0x8f6252, 0x9b6c5b, 0xa77866, 0xba8f7e, 0xcea697];
const DIORITE_PAL: [u32; 7] = [0x77777a, 0x9b9b9e, 0xb1b1b4, 0xc1c1c4, 0xcfcfd1, 0xdcdcde, 0xe8e8ea];
const ANDESITE_PAL: [u32; 7] = [0x656566, 0x717172, 0x7c7c7d, 0x868688, 0x909092, 0x9c9c9e, 0xaaaaac];

const DEEPSLATE_PAL: [u32; 6] = [0x2b2b32, 0x33333b, 0x3b3b44, 0x44444e, 0x4d4d58, 0x575763];

fn deepslate() -> Tx {
    let mut t = Tx::new(50, 1.4);
    let f = field(|x, y, fx, fy| {
        0.5 * vnoise(fx, fy, 8, 2, 511) + 0.3 * vnoise(fx, fy, 16, 4, 512) + 0.2 * rnd(x, y, 513)
    });
    let e = equalize(&f);
    let mut lv = [0; P];
    for i in 0..P {
        lv[i] = 1 + quant(e[i], &[0.1, 0.35, 0.68, 0.92]);
    }
    let mut r = Rng::new(514);
    for _ in 0..4 {
        let (x, y0) = (r.i(0, 15), r.i(0, 15));
        let len = r.i(3, 6);
        for k in 0..len {
            lv[idx(x, y0 + k)] = 0;
            let j = idx(x + 1, y0 + k);
            lv[j] = (lv[j] + 1).min(5);
        }
    }
    for i in 0..P {
        t.c[i] = pick(&DEEPSLATE_PAL, lv[i]);
        t.h[i] = lv[i] as f32 / 5.0;
    }
    t
}

/// Warped concentric swirl (deepslate is a pillar block, so its top shows rings).
fn deepslate_top() -> Tx {
    let (seed, sp) = (525, 2.3);
    let mut t = Tx::new(50, 1.3);
    for i in 0..P {
        let (x, y) = xy(i);
        let (fx, fy) = (x as f32 + 0.5, y as f32 + 0.5);
        let dx = wrapd(fx - 8.0);
        let dy = wrapd(fy - 8.0);
        let r = (dx * dx + dy * dy).sqrt() + 6.0 * (fbm(fx, fy, 2, 2, 2, seed) - 0.5);
        let band = (r / sp).fract();
        let mut l = 2 + (rnd(x, y, 522) * 2.2) as i32;
        if band < 0.2 {
            l = 0;
        } else if band < 0.32 {
            l = 1;
        } else if band > 0.88 {
            l = (l + 1).min(5);
        }
        t.c[i] = pick(&DEEPSLATE_PAL, l);
        t.h[i] = l as f32 / 5.0;
    }
    t
}

// ============================================================================
// Soil: dirt, grass, sand, gravel, clay, snow, podzol
// ============================================================================

const DIRT_PAL: [u32; 6] = [0x4a3122, 0x583b29, 0x664531, 0x735039, 0x815b42, 0x8f674b];

fn dirt() -> Tx {
    let mut t = Tx::new(12, 1.0);
    let f = field(|x, y, fx, fy| {
        0.35 * fbm(fx, fy, 4, 4, 2, 21) + 0.25 * vnoise(fx, fy, 8, 8, 22) + 0.4 * rnd(x, y, 23)
    });
    let e = equalize(&f);
    for i in 0..P {
        let l = quant(e[i], &[0.05, 0.2, 0.46, 0.74, 0.93]);
        t.c[i] = pick(&DIRT_PAL, l);
        t.h[i] = 0.4 * l as f32 / 5.0;
    }
    let mut r = Rng::new(24);
    for _ in 0..4 {
        let (x, y) = (r.i(0, 15), r.i(0, 15));
        let two = r.chance(0.5);
        t.c[idx(x, y)] = hexc(0x9a8672);
        t.h[idx(x, y)] = 0.9;
        if two {
            t.c[idx(x + 1, y)] = hexc(0x86725f);
            t.h[idx(x + 1, y)] = 0.8;
        }
        let s = idx(x + 1 + two as i32, y + 1);
        t.c[s] = pick(&DIRT_PAL, 1);
        t.h[s] = 0.1;
    }
    for _ in 0..5 {
        let i = idx(r.i(0, 15), r.i(0, 15));
        t.c[i] = pick(&DIRT_PAL, 0);
        t.h[i] = 0.0;
    }
    t
}

const GRASS_GREY: [u32; 7] = [0x848484, 0x929292, 0xa0a0a0, 0xaeaeae, 0xbcbcbc, 0xc9c9c9, 0xd4d4d4];

fn grass_levels(seed: u32) -> [i32; P] {
    let f = field(|x, y, fx, fy| {
        0.3 * fbm(fx, fy, 4, 4, 2, seed) + 0.2 * vnoise(fx, fy, 8, 8, seed + 1) + 0.5 * rnd(x, y, seed + 2)
    });
    let e = equalize(&f);
    let mut lv = [0; P];
    for i in 0..P {
        lv[i] = quant(e[i], &[0.06, 0.2, 0.4, 0.62, 0.8, 0.93]);
    }
    let mut r = Rng::new(seed + 3);
    for _ in 0..12 {
        let (x, y) = (r.i(0, 15), r.i(0, 15));
        lv[idx(x, y)] = 5 + r.i(0, 1);
        lv[idx(x, y + 1)] = r.i(0, 1);
    }
    lv
}

fn grass_top() -> Tx {
    let mut t = Tx::new(10, 0.7);
    let lv = grass_levels(31);
    for i in 0..P {
        t.c[i] = pick(&GRASS_GREY, lv[i]);
        t.a[i] = 0;
        t.h[i] = lv[i] as f32 / 6.0;
    }
    t
}

fn fringe_depth(seed: u32) -> [i32; TEX_SIZE] {
    let mut d = [3; TEX_SIZE];
    let mut r = Rng::new(seed);
    for v in d.iter_mut() {
        let p = r.f();
        *v = if p < 0.36 {
            3
        } else if p < 0.72 {
            4
        } else if p < 0.91 {
            5
        } else {
            6
        };
    }
    d
}

fn grass_side() -> Tx {
    let mut t = dirt();
    let d = fringe_depth(41);
    for x in 0..S {
        let dep = d[x as usize];
        for y in 0..dep {
            let i = idx(x, y);
            let mut l = 2 + (rnd(x, y, 42) * 3.2) as i32;
            if y == 0 {
                l += 1;
            }
            if y == dep - 1 {
                l = 1 + (rnd(x, y, 43) < 0.5) as i32;
            }
            t.c[i] = pick(&GRASS_GREY, l);
            t.a[i] = 0;
            t.h[i] = 1.0;
            t.sm[i] = 10;
        }
        let j = idx(x, dep);
        t.c[j] = mulc(t.c[j], 0.78);
        t.h[j] = 0.0;
    }
    t
}

const SNOW_PAL: [u32; 5] = [0xd2dde8, 0xdde6ef, 0xe7eef5, 0xeff4f8, 0xf6f9fb];

fn snow_levels(seed: u32) -> [i32; P] {
    let f = field(|x, y, fx, fy| 0.6 * fbm(fx, fy, 4, 4, 2, seed) + 0.4 * rnd(x, y, seed + 1));
    let e = equalize(&f);
    let mut lv = [0; P];
    for i in 0..P {
        lv[i] = quant(e[i], &[0.06, 0.24, 0.58, 0.86]);
    }
    lv
}

fn snow() -> Tx {
    let mut t = Tx::new(45, 0.4);
    let lv = snow_levels(171);
    for i in 0..P {
        t.c[i] = pick(&SNOW_PAL, lv[i]);
        t.h[i] = lv[i] as f32 / 4.0;
    }
    t
}

fn snow_side() -> Tx {
    let mut t = dirt();
    let d = fringe_depth(441);
    let lv = snow_levels(171);
    for x in 0..S {
        let dep = d[x as usize];
        for y in 0..dep {
            let i = idx(x, y);
            let mut l = lv[i].max(1);
            if y == 0 {
                l = 4;
            }
            if y == dep - 1 {
                l = 0;
            }
            t.c[i] = pick(&SNOW_PAL, l);
            t.h[i] = 1.0;
            t.sm[i] = 45;
        }
        let j = idx(x, dep);
        t.c[j] = mulc(t.c[j], 0.78);
        t.h[j] = 0.0;
    }
    t
}

const PODZOL_BASE: [u32; 4] = [0x3b2814, 0x4a3219, 0x573b1e, 0x644424];
const PODZOL_NEEDLE: [u32; 4] = [0x6e4a22, 0x835826, 0x96662c, 0xa87534];

fn podzol_paint(t: &mut Tx, seed: u32) {
    let f = field(|x, y, fx, fy| 0.5 * fbm(fx, fy, 4, 4, 2, seed) + 0.5 * rnd(x, y, seed + 1));
    let e = equalize(&f);
    for i in 0..P {
        let l = quant(e[i], &[0.15, 0.5, 0.85]);
        t.c[i] = pick(&PODZOL_BASE, l);
        t.h[i] = 0.2 * l as f32 / 3.0;
    }
    let mut r = Rng::new(seed + 2);
    for _ in 0..30 {
        let (x, y) = (r.i(0, 15), r.i(0, 15));
        let (dx, dy) = [(1, 0), (1, 1), (1, -1), (0, 1)][r.i(0, 3) as usize];
        let len = r.i(2, 3);
        let tone = r.i(0, 2);
        for k in 0..len {
            let i = idx(x + dx * k, y + dy * k);
            t.c[i] = pick(&PODZOL_NEEDLE, tone + (k == 0) as i32);
            t.h[i] = 0.6 + 0.1 * tone as f32;
        }
    }
}

fn podzol_top() -> Tx {
    let mut t = Tx::new(15, 1.2);
    podzol_paint(&mut t, 531);
    t
}

fn podzol_side() -> Tx {
    let mut t = dirt();
    let mut top = Tx::new(15, 1.2);
    podzol_paint(&mut top, 531);
    let d = fringe_depth(541);
    for x in 0..S {
        let dep = d[x as usize];
        for y in 0..dep {
            let i = idx(x, y);
            let needle = top.h[i] > 0.5;
            t.c[i] = if y == dep - 1 {
                mulc(top.c[i], 0.62)
            } else if needle {
                top.c[i]
            } else {
                mulc(top.c[i], 0.85)
            };
            t.h[i] = 1.0;
            t.sm[i] = 15;
        }
        let j = idx(x, dep);
        t.c[j] = mulc(t.c[j], 0.8);
        t.h[j] = 0.0;
    }
    t
}

const SAND_PAL: [u32; 6] = [0xc6b47c, 0xd0c088, 0xd9ca93, 0xe0d29d, 0xe7daa8, 0xede1b3];

fn sand() -> Tx {
    let mut t = Tx::new(10, 0.35);
    let f = field(|x, y, fx, fy| 0.25 * fbm(fx, fy, 4, 4, 2, 71) + 0.75 * rnd(x, y, 72));
    let e = equalize(&f);
    for i in 0..P {
        let l = quant(e[i], &[0.04, 0.15, 0.42, 0.72, 0.93]);
        t.c[i] = pick(&SAND_PAL, l);
        t.h[i] = l as f32 / 5.0;
    }
    t
}

const GRAVEL_TONES: [[u32; 4]; 5] = [
    [0x575554, 0x6c6967, 0x827e7b, 0x96928e],
    [0x6a6764, 0x827e7a, 0x9a9591, 0xaea9a4],
    [0x584b41, 0x6c5d51, 0x817062, 0x948272],
    [0x3e3c3b, 0x4d4a49, 0x5d5957, 0x6d6966],
    [0x6b5c58, 0x82706b, 0x97847e, 0xa8958f],
];

fn gravel() -> Tx {
    let mut t = Tx::new(25, 2.2);
    let mut r = Rng::new(81);
    let sites = scatter(&mut r, 22, 2.6, 0.8, 1.2);
    let tone: Vec<usize> = sites.iter().map(|_| r.i(0, 4) as usize).collect();
    let mut h = [0.0; P];
    let mut gap = [false; P];
    let mut ids = [0usize; P];
    for i in 0..P {
        let (x, y) = xy(i);
        let n = worley(&sites, x as f32 + 0.5, y as f32 + 0.5);
        let edge = n.f2 - n.f1;
        ids[i] = n.id;
        gap[i] = edge < 0.55;
        h[i] = if gap[i] { 0.0 } else { 0.35 + 0.65 * ((edge - 0.55) / 2.0).clamp(0.0, 1.0).sqrt() };
    }
    let l = light(&h, true);
    for i in 0..P {
        let (x, y) = xy(i);
        if gap[i] {
            t.c[i] = hexc(if rnd(x, y, 82) < 0.5 { 0x3a3634 } else { 0x46423f });
            t.h[i] = 0.0;
            continue;
        }
        let v = 1.6 + 4.5 * l[i] + 0.8 * (rnd(x, y, 83) - 0.5);
        t.c[i] = pick(&GRAVEL_TONES[tone[ids[i]]], v.round() as i32);
        t.h[i] = h[i];
    }
    t
}

const CLAY_PAL: [u32; 5] = [0x8e95a2, 0x959caa, 0x9da4b1, 0xa4abb8, 0xacb3bf];

fn clay() -> Tx {
    let mut t = Tx::new(40, 0.4);
    let f = field(|x, y, fx, fy| 0.7 * fbm(fx, fy, 4, 4, 2, 431) + 0.3 * rnd(x, y, 432));
    let e = equalize(&f);
    for i in 0..P {
        let l = quant(e[i], &[0.07, 0.28, 0.7, 0.93]);
        t.c[i] = pick(&CLAY_PAL, l);
        t.h[i] = l as f32 / 4.0;
    }
    t
}

// ============================================================================
// Rock and masonry: cobble, bedrock, bricks, obsidian, sandstone
// ============================================================================

const COBBLE_PAL: [u32; 7] = [0x4f4f53, 0x5d5d61, 0x6b6b6f, 0x79797d, 0x88888c, 0x97979b, 0xa6a6aa];
const MORTAR_PAL: [u32; 2] = [0x353539, 0x424246];

struct Cobble {
    t: Tx,
    lv: [i32; P],
    mortar: [bool; P],
    lit: [f32; P],
}

fn cobble_base() -> Cobble {
    let mut t = Tx::new(50, 2.4);
    let mut r = Rng::new(61);
    let sites = scatter(&mut r, 11, 4.0, 0.85, 1.2);
    let tone: Vec<f32> = sites.iter().map(|_| r.f() * 2.0 - 1.0).collect();
    let mut h = [0.0; P];
    let mut mortar = [false; P];
    let mut ids = [0usize; P];
    let mut edges = [0.0; P];
    for i in 0..P {
        let (x, y) = xy(i);
        let n = worley(&sites, x as f32 + 0.5, y as f32 + 0.5);
        let edge = n.f2 - n.f1;
        edges[i] = edge;
        ids[i] = n.id;
        mortar[i] = edge < 0.9;
        h[i] = if mortar[i] { 0.0 } else { 0.35 + 0.65 * ((edge - 0.9) / 3.0).clamp(0.0, 1.0).sqrt() };
    }
    let lit = light(&h, true);
    let mut lv = [0; P];
    for i in 0..P {
        let (x, y) = xy(i);
        if mortar[i] {
            t.c[i] = pick(&MORTAR_PAL, (edges[i] > 0.45) as i32);
            t.h[i] = 0.0;
            lv[i] = -1;
            continue;
        }
        let v = 3.0 + 0.9 * tone[ids[i]] + 5.0 * lit[i] + 0.9 * (rnd(x, y, 62) - 0.5);
        lv[i] = (v.round() as i32).clamp(0, 6);
        t.c[i] = pick(&COBBLE_PAL, lv[i]);
        t.h[i] = h[i];
    }
    Cobble { t, lv, mortar, lit }
}

fn cobblestone() -> Tx {
    cobble_base().t
}

const MOSS_PAL: [u32; 7] = [0x2f4520, 0x3b5626, 0x48672c, 0x567933, 0x658b3b, 0x759c45, 0x86ad50];

fn mossy_cobblestone() -> Tx {
    let Cobble { mut t, lv, mortar, lit } = cobble_base();
    let f = field(|x, y, fx, fy| {
        let i = idx(x, y);
        0.7 * fbm(fx, fy, 4, 4, 2, 421) + 0.3 * vnoise(fx, fy, 8, 8, 424) + 0.25 * (rnd(x, y, 422) - 0.5)
            + if mortar[i] { 0.1 } else { 0.0 }
            + 0.4 * lit[i]
    });
    let e = equalize(&f);
    for i in 0..P {
        if e[i] < 0.64 {
            continue;
        }
        let (x, y) = xy(i);
        let l = if mortar[i] { 1 + (rnd(x, y, 423) < 0.5) as i32 } else { (lv[i] + (e[i] > 0.82) as i32).clamp(0, 6) };
        t.c[i] = pick(&MOSS_PAL, l);
        t.h[i] += 0.12;
        t.sm[i] = 15;
    }
    t
}

const BEDROCK_PAL: [u32; 6] = [0x2b2b2d, 0x3b3b3d, 0x4d4d4f, 0x616163, 0x767678, 0x8b8b8d];

fn bedrock() -> Tx {
    let mut t = Tx::new(30, 2.2);
    let mut r = Rng::new(65);
    let sites = scatter(&mut r, 15, 3.0, 0.8, 1.25);
    let tone: Vec<i32> = sites.iter().map(|_| r.i(0, 5)).collect();
    for i in 0..P {
        let (x, y) = xy(i);
        let n = worley(&sites, x as f32 + 0.5, y as f32 + 0.5);
        let mut l = tone[n.id] + (rnd(x, y, 66) * 2.4) as i32 - 1;
        if n.f2 - n.f1 < 0.18 {
            l -= 2;
        }
        let l = l.clamp(0, 5);
        t.c[i] = pick(&BEDROCK_PAL, l);
        t.h[i] = l as f32 / 5.0;
    }
    t
}

const BRICK_PAL: [u32; 6] = [0x773426, 0x873c2e, 0x944535, 0xa0503e, 0xac5b48, 0xb86954];
const BRICK_MORTAR: [u32; 3] = [0x978e85, 0xaaa196, 0xbab2a8];

fn bricks() -> Tx {
    let mut t = Tx::new(35, 2.4);
    for i in 0..P {
        let (x, y) = xy(i);
        let row = y / 4;
        let ry = y % 4;
        let off = if row % 2 == 0 { 0 } else { 4 };
        let bx = (x + off).rem_euclid(16);
        let lx = bx % 8;
        if ry == 3 || lx == 7 {
            let l = if ry == 3 && lx == 7 { 0 } else { 1 + (rnd(x, y, 401) < 0.4) as i32 };
            t.c[i] = pick(&BRICK_MORTAR, l);
            t.h[i] = 0.0;
            continue;
        }
        let tone = rnd(bx / 8, row, 402) * 1.6 - 0.8;
        let mut v = 2.5 + tone + 1.1 * (rnd(x, y, 403) - 0.5);
        if ry == 0 {
            v += 1.0;
        }
        if ry == 2 {
            v -= 0.9;
        }
        if lx == 0 {
            v += 0.5;
        }
        if lx == 6 {
            v -= 0.5;
        }
        let l = (v.round() as i32).clamp(0, 5);
        t.c[i] = pick(&BRICK_PAL, l);
        t.h[i] = if ry == 0 || lx == 0 || ry == 2 || lx == 6 { 0.75 } else { 1.0 };
    }
    t
}

const SBRICK_PAL: [u32; 7] = [0x5e5e60, 0x6a6a6c, 0x757577, 0x808082, 0x8b8b8d, 0x979799, 0xa3a3a5];
const SBRICK_MORTAR: [u32; 2] = [0x3f3f41, 0x4a4a4c];

fn stone_bricks() -> Tx {
    let mut t = Tx::new(55, 2.2);
    let f = field(|x, y, fx, fy| 0.6 * fbm(fx, fy, 4, 4, 2, 411) + 0.4 * rnd(x, y, 412));
    for i in 0..P {
        let (x, y) = xy(i);
        let row = y / 8;
        let ly = y % 8;
        let joint = if row == 0 { 15 } else { 7 };
        let lx = (x - joint - 1).rem_euclid(16);
        if ly == 7 || x == joint {
            t.c[i] = pick(&SBRICK_MORTAR, (rnd(x, y, 413) < 0.5) as i32);
            t.h[i] = 0.0;
            continue;
        }
        let mut v = 2.2 + 2.2 * (f[i] - 0.5) * 2.0 * 0.6;
        let mut h = 1.0;
        if ly == 0 || lx == 0 {
            v = 5.3;
            h = 0.7;
        }
        if ly == 6 || lx == 14 {
            v = 0.6;
            h = 0.7;
        }
        if (ly == 0 && lx == 14) || (ly == 6 && lx == 0) {
            v = 3.0;
        }
        let l = (v.round() as i32).clamp(0, 6);
        t.c[i] = pick(&SBRICK_PAL, l);
        t.h[i] = h;
    }
    t
}

const OBSIDIAN_PAL: [u32; 8] = [0x0e0a17, 0x150f21, 0x1d152c, 0x261c39, 0x302347, 0x3b2c57, 0x55407e, 0x7560b0];

fn obsidian() -> Tx {
    let mut t = Tx::new(200, 1.0);
    let mut r = Rng::new(451);
    let sites = scatter(&mut r, 10, 3.8, 0.85, 1.2);
    let tone: Vec<f32> = sites.iter().map(|_| r.f()).collect();
    for i in 0..P {
        let (x, y) = xy(i);
        let n = worley(&sites, x as f32 + 0.5, y as f32 + 0.5);
        let facet = -(n.dx + n.dy) / 5.0;
        let mut v = 1.0 + 2.2 * tone[n.id] + 1.8 * facet + 0.7 * (rnd(x, y, 452) - 0.5);
        if n.f2 - n.f1 < 0.5 {
            v -= 1.5;
        }
        let l = (v.round() as i32).clamp(0, 5);
        t.c[i] = pick(&OBSIDIAN_PAL, l);
        t.h[i] = l as f32 / 5.0;
    }
    for _ in 0..6 {
        let (x, y) = (r.i(0, 15), r.i(0, 15));
        t.c[idx(x, y)] = pick(&OBSIDIAN_PAL, 7);
        t.c[idx(x + 1, y - 1)] = pick(&OBSIDIAN_PAL, 6);
        t.sm[idx(x, y)] = 240;
    }
    t
}

const SANDSTONE_PAL: [u32; 6] = [0xb39b64, 0xc1a971, 0xccb57c, 0xd5bf87, 0xdec992, 0xe6d39d];

fn sandstone() -> Tx {
    let mut t = Tx::new(25, 1.4);
    // per-row base tone and height: smooth cap, dark seam, speckled body, lower band
    const ROWS: [(f32, f32); 16] = [
        (4.6, 1.0),
        (4.2, 1.0),
        (3.9, 1.0),
        (1.0, 0.55),
        (3.0, 0.9),
        (3.3, 0.9),
        (2.9, 0.9),
        (3.2, 0.9),
        (2.8, 0.9),
        (3.1, 0.9),
        (2.9, 0.9),
        (2.4, 0.85),
        (1.2, 0.55),
        (3.6, 0.95),
        (3.3, 0.95),
        (2.4, 0.9),
    ];
    for i in 0..P {
        let (x, y) = xy(i);
        let (tone, h) = ROWS[y as usize];
        let body = (4..=11).contains(&y);
        let amp = if body { 1.5 } else { 0.7 };
        let v = tone + amp * (rnd(x, y, 152) - 0.5) + 0.8 * (vnoise(x as f32 + 0.5, y as f32 + 0.5, 4, 16, 151) - 0.5);
        let l = (v.round() as i32).clamp(0, 5);
        t.c[i] = pick(&SANDSTONE_PAL, l);
        t.h[i] = h + 0.03 * l as f32;
    }
    t
}

fn sandstone_top() -> Tx {
    let mut t = Tx::new(20, 0.4);
    let f = field(|x, y, fx, fy| 0.5 * fbm(fx, fy, 4, 4, 2, 161) + 0.5 * rnd(x, y, 162));
    let e = equalize(&f);
    for i in 0..P {
        let l = 1 + quant(e[i], &[0.07, 0.3, 0.72, 0.94]);
        t.c[i] = pick(&SANDSTONE_PAL, l);
        t.h[i] = l as f32 / 5.0;
    }
    t
}

// ============================================================================
// Wood: planks, logs, bookshelf
// ============================================================================

const OAK_PLANK_PAL: [u32; 6] = [0x7a5c34, 0x896a3d, 0x9a7947, 0xa98651, 0xb6925b, 0xc29e66];
const SPRUCE_PLANK_PAL: [u32; 6] = [0x4c3620, 0x584027, 0x654a2d, 0x715434, 0x7d5e3b, 0x896843];
const BIRCH_PLANK_PAL: [u32; 6] = [0xae9864, 0xbba671, 0xc7b27d, 0xd1bd88, 0xdbc893, 0xe4d29e];

fn planks(pal: &[u32; 6], seam: u32, seed: u32) -> Tx {
    let mut t = Tx::new(40, 1.6);
    let mut r = Rng::new(seed);
    let mut joints = [0i32; 4];
    let base = r.i(0, 15);
    for (k, j) in joints.iter_mut().enumerate() {
        *j = (base + [0, 8, 4, 12][k] + r.i(-1, 1)).rem_euclid(16);
    }
    let tones: Vec<f32> = (0..4).map(|_| r.f() * 1.0 - 0.5).collect();
    for i in 0..P {
        let (x, y) = xy(i);
        let k = (y / 4) as usize;
        let ry = y % 4;
        if ry == 3 {
            t.c[i] = mulc(hexc(seam), 0.92 + 0.16 * rnd(x, y, seed + 1));
            t.h[i] = 0.0;
            continue;
        }
        if x == joints[k] {
            t.c[i] = mixc(hexc(seam), pick(pal, 0), 0.5);
            t.h[i] = 0.25;
            continue;
        }
        let grain = vnoise(x as f32 + 0.5 + k as f32 * 5.0, y as f32 + 0.5, 2, 16, seed + 2);
        let mut v = 2.6 + tones[k] + 2.4 * (grain - 0.5) + 0.9 * (rnd(x, y, seed + 3) - 0.5);
        if ry == 0 {
            v += 0.7;
        }
        if ry == 2 {
            v -= 0.6;
        }
        let l = (v.round() as i32).clamp(0, 5);
        t.c[i] = pick(pal, l);
        t.h[i] = 0.85 + 0.15 * grain;
        // a nail two pixels either side of each board joint
        if y == 4 * k as i32 + 1 && ((x - joints[k]).rem_euclid(16) == 2 || (joints[k] - x).rem_euclid(16) == 2) {
            t.c[i] = mixc(hexc(seam), pick(pal, 1), 0.35);
            t.h[i] = 0.5;
        }
    }
    t
}

const OAK_BARK: [u32; 5] = [0x41301c, 0x4f3b23, 0x5d4629, 0x6a5130, 0x795d38];
const SPRUCE_BARK: [u32; 5] = [0x2c1e11, 0x382716, 0x44301c, 0x503a22, 0x5d4429];
const BIRCH_BARK: [u32; 5] = [0xb8b6ad, 0xc7c5bc, 0xd5d3ca, 0xe0ded6, 0xeae8e1];
const OAK_RING: [u32; 5] = [0x7a5b33, 0x8d6c3d, 0xa07b48, 0xb08952, 0xbd955c];
const SPRUCE_RING: [u32; 5] = [0x563e26, 0x644a2d, 0x725434, 0x7f5f3b, 0x8b6942];
const BIRCH_RING: [u32; 5] = [0xae9862, 0xbfa970, 0xcdb77d, 0xd9c489, 0xe2ce94];

fn log_side(bark: &[u32; 5], seed: u32) -> Tx {
    let mut t = Tx::new(25, 2.0);
    let f = field(|x, y, fx, fy| {
        let wob = 1.6 * (vnoise(fx, fy, 2, 4, seed) - 0.5);
        let u = (fx + wob) / 4.0 + 0.35 * vnoise(fx, 0.5, 4, 1, seed + 1);
        let ph = u - u.floor();
        let ridge = 1.0 - (ph - 0.5).abs() * 2.0;
        0.6 * ridge + 0.25 * vnoise(fx, fy, 16, 2, seed + 2) + 0.15 * rnd(x, y, seed + 3)
    });
    let e = equalize(&f);
    for i in 0..P {
        let l = quant(e[i], &[0.16, 0.4, 0.66, 0.9]);
        t.c[i] = pick(bark, l);
        t.h[i] = f[i];
    }
    t
}

fn birch_log() -> Tx {
    let mut t = Tx::new(30, 1.3);
    let f = field(|x, y, fx, fy| {
        0.5 * vnoise(fx, fy, 2, 16, 251) + 0.2 * vnoise(fx, fy, 4, 4, 254) + 0.3 * rnd(x, y, 252)
    });
    let e = equalize(&f);
    for i in 0..P {
        let l = quant(e[i], &[0.08, 0.3, 0.65, 0.9]);
        t.c[i] = pick(&BIRCH_BARK, l);
        t.h[i] = 1.0;
    }
    let mut r = Rng::new(253);
    let mut placed: Vec<(i32, i32)> = Vec::new();
    let mut tries = 0;
    while placed.len() < 8 && tries < 800 {
        tries += 1;
        let (x0, y0) = (r.i(0, 15), r.i(0, 15));
        let clash = placed.iter().any(|&(a, b)| {
            wrapd((a - x0) as f32).abs() < 5.0 && wrapd((b - y0) as f32).abs() < 3.0
        });
        if clash {
            continue;
        }
        placed.push((x0, y0));
        let w = r.i(2, 6);
        for dx in 0..w {
            let end = (dx == 0 || dx == w - 1) && w > 2;
            let i = idx(x0 + dx, y0);
            t.c[i] = hexc(if end { 0x5f5c55 } else { 0x3a3833 });
            t.h[i] = 0.2;
        }
        if w >= 4 && r.chance(0.5) {
            let off = r.i(1, w - 3);
            for dx in off..off + 2 {
                let i = idx(x0 + dx, y0 + 1);
                t.c[i] = hexc(0x4c4a44);
                t.h[i] = 0.3;
            }
        }
    }
    for _ in 0..6 {
        let (x, y) = (r.i(0, 15), r.i(0, 15));
        t.c[idx(x, y)] = hexc(0x9c998f);
    }
    t
}

fn log_top(bark: &[u32; 5], ring: &[u32; 5], seed: u32) -> Tx {
    let mut t = Tx::new(30, 1.3);
    t.wrap = false;
    for i in 0..P {
        let (x, y) = xy(i);
        let (dx, dy) = (x as f32 - 7.5, y as f32 - 7.5);
        let cheb = dx.abs().max(dy.abs());
        if cheb >= 7.0 {
            let l = 1 + (rnd(x, y, seed) * 3.0) as i32;
            t.c[i] = pick(bark, l);
            t.h[i] = 1.0;
            continue;
        }
        let eu = (dx * dx + dy * dy).sqrt();
        let d = 0.65 * cheb + 0.35 * eu + 0.9 * (vnoise(x as f32 + 0.5, y as f32 + 0.5, 4, 4, seed + 1) - 0.5);
        let ringi = (d / 1.9).floor() as i32;
        let mut l = if ringi % 2 == 0 { 3 } else { 1 };
        l += (rnd(x, y, seed + 2) * 1.8) as i32;
        if cheb >= 6.0 {
            l = 0;
        }
        if cheb < 1.0 {
            l = 1;
        }
        let l = l.clamp(0, 4);
        t.c[i] = pick(ring, l);
        t.h[i] = 0.7 + 0.05 * l as f32;
    }
    t
}

const BOOKS: [[u32; 3]; 7] = [
    [0xb03a2e, 0x8e2b22, 0x6a1e18],
    [0x4064a8, 0x2e4a84, 0x203562],
    [0x4f8a3a, 0x3a6b2b, 0x2a4f1f],
    [0x9a6a3a, 0x7a5028, 0x5a3a1c],
    [0xcbb07a, 0xa8905c, 0x857044],
    [0x7a4a8e, 0x5e3570, 0x44264f],
    [0x3f8a86, 0x2e6b68, 0x1f4c4a],
];

fn bookshelf() -> Tx {
    let mut t = Tx::new(35, 1.8);
    // frame
    for i in 0..P {
        let (x, y) = xy(i);
        let grain = vnoise(x as f32 + 0.5, y as f32 + 0.5, 2, 16, 462);
        let mut v = 2.6 + 2.0 * (grain - 0.5) + 0.8 * (rnd(x, y, 463) - 0.5);
        if y == 7 || y == 0 {
            v += 1.0;
        }
        if y == 8 || y == 15 {
            v -= 0.6;
        }
        if x == 15 {
            v -= 0.8;
        }
        t.c[i] = pick(&OAK_PLANK_PAL, (v.round() as i32).clamp(0, 5));
        t.h[i] = 1.0;
    }
    let mut r = Rng::new(461);
    for &(top, bottom) in &[(1, 6), (9, 14)] {
        for y in top..=bottom {
            for x in 1..=14 {
                let i = idx(x, y);
                t.c[i] = hexc(if y == top { 0x1f160c } else { 0x2c2012 });
                t.h[i] = 0.0;
            }
        }
        let mut x = 1;
        while x <= 14 {
            if r.chance(0.1) {
                x += 1;
                continue;
            }
            let w = if r.chance(0.35) { 2 } else { 1 }.min(15 - x);
            let hgt = r.i(4, 6).min(bottom - top + 1);
            let book = BOOKS[r.i(0, 6) as usize];
            let band = r.chance(0.45);
            let band_y = bottom - r.i(1, 2);
            for dx in 0..w {
                for y in (bottom - hgt + 1)..=bottom {
                    let i = idx(x + dx, y);
                    let mut s: i32 = if w == 2 && dx == 0 { 0 } else { 1 };
                    if w == 1 && x % 2 == 0 {
                        s = 1;
                    }
                    if y == bottom - hgt + 1 {
                        s = (s - 1).max(0);
                    }
                    if y == bottom {
                        s = 2;
                    }
                    let mut c = hexc(book[s as usize]);
                    if band && y == band_y {
                        c = mixc(c, hexc(0xe0c25a), 0.6);
                    }
                    t.c[i] = c;
                    t.h[i] = 0.6 + if dx == 0 { 0.1 } else { 0.0 };
                }
            }
            x += w;
        }
    }
    t
}

// ============================================================================
// Foliage
// ============================================================================

struct LeafStyle {
    pal: [u32; 6],
    seed: u32,
    n: usize,
    min_d: f32,
    w: (f32, f32),
    holes: f32,
}

const OAK_LEAF: LeafStyle = LeafStyle {
    pal: [0x626262, 0x787878, 0x8e8e8e, 0xa4a4a4, 0xbababa, 0xcdcdcd],
    seed: 111,
    n: 22,
    min_d: 2.6,
    w: (1.6, 2.2),
    holes: 0.25,
};
const BIRCH_LEAF: LeafStyle = LeafStyle {
    pal: [0x52763a, 0x648a43, 0x779e4e, 0x89b15a, 0x9bc168, 0xaed17b],
    seed: 271,
    n: 22,
    min_d: 2.6,
    w: (1.6, 2.2),
    holes: 0.24,
};

fn leaves(s: &LeafStyle) -> Tx {
    let mut t = Tx::new(15, 1.2);
    t.cutout = true;
    let mut r = Rng::new(s.seed);
    let sites = scatter(&mut r, s.n, s.min_d, s.w.0, s.w.1);
    let mut cover = [0.0; P];
    let mut shade = [0.0; P];
    for i in 0..P {
        let (x, y) = xy(i);
        let n = worley(&sites, x as f32 + 0.5, y as f32 + 0.5);
        let w = sites[n.id].w;
        let (dx, dy) = (n.dx / w, n.dy / w);
        cover[i] = 1.0 - n.f1 + 0.4 * (rnd(x, y, s.seed + 1) - 0.5);
        let edge = n.f2 - n.f1;
        shade[i] = -0.55 * (dx + dy) - 0.35 * n.f1 + 0.35 * (rnd(x, y, s.seed + 2) - 0.5)
            - if edge < 0.12 { 0.3 } else { 0.0 };
    }
    let ce = equalize(&cover);
    let se = equalize(&shade);
    for i in 0..P {
        if ce[i] < s.holes {
            t.a[i] = 0;
            t.h[i] = 0.0;
            continue;
        }
        let l = quant(se[i], &[0.1, 0.28, 0.52, 0.76, 0.92]);
        t.c[i] = pick(&s.pal, l);
        t.h[i] = 0.4 + 0.6 * l as f32 / 5.0;
    }
    t
}

const SPRUCE_LEAF: LeafStyle = LeafStyle {
    pal: [0x3e6e45, 0x4d7f53, 0x5c9061, 0x6ca16f, 0x80b480, 0x97c795],
    seed: 301,
    n: 14,
    min_d: 3.4,
    w: (1.0, 1.0),
    holes: 0.22,
};

fn spruce_leaves() -> Tx {
    let s = &SPRUCE_LEAF;
    let mut t = Tx::new(15, 1.2);
    t.cutout = true;
    let f = field(|x, y, fx, fy| 0.5 * fbm(fx, fy, 4, 4, 2, s.seed + 1) + 0.5 * rnd(x, y, s.seed + 2));
    let e = equalize(&f);
    let mut lv = [0i32; P];
    for i in 0..P {
        lv[i] = quant(e[i], &[0.15, 0.6]);
    }
    let mut r = Rng::new(s.seed);
    let mut sites = scatter(&mut r, s.n, s.min_d, s.w.0, s.w.1);
    let mut branch = [false; P];
    for p in sites.iter_mut() {
        let (cx, cy) = (p.x as i32, p.y as i32);
        let arm = r.i(2, 3);
        let tone = r.i(3, 4);
        lv[idx(cx, cy)] = tone + 1;
        branch[idx(cx, cy)] = true;
        for k in 1..=arm {
            for sd in [-1, 1] {
                let i = idx(cx + sd * k, cy + k);
                lv[i] = tone - (sd > 0) as i32 - (k == 3) as i32;
                branch[i] = true;
            }
        }
        let under = idx(cx, cy + 1);
        if !branch[under] {
            lv[under] = 0;
        }
        p.y += 1.2;
    }
    let hf = field(|x, y, fx, fy| {
        let i = idx(x, y);
        if branch[i] {
            9.0
        } else {
            -worley(&sites, fx, fy).f1 + 0.6 * rnd(x, y, s.seed + 3)
        }
    });
    let he = equalize(&hf);
    for i in 0..P {
        if he[i] < s.holes {
            t.a[i] = 0;
            t.h[i] = 0.0;
            continue;
        }
        t.c[i] = pick(&s.pal, lv[i]);
        t.h[i] = 0.3 + 0.7 * lv[i] as f32 / 5.0;
    }
    t
}

const CACTUS_PAL: [u32; 6] = [0x27501a, 0x32611f, 0x3e7326, 0x4b852e, 0x599837, 0x69aa42];

fn cactus_side() -> Tx {
    let mut t = Tx::new(40, 1.5);
    for i in 0..P {
        let (x, y) = xy(i);
        let ph = x % 4;
        let base = [0.4, 2.6, 4.4, 2.2][ph as usize];
        let v = base + 1.4 * (vnoise(x as f32 + 0.5, y as f32 + 0.5, 16, 4, 311) - 0.5) + 0.6 * (rnd(x, y, 312) - 0.5);
        let l = (v.round() as i32).clamp(0, 5);
        t.c[i] = pick(&CACTUS_PAL, l);
        t.h[i] = [0.0, 0.7, 1.0, 0.7][ph as usize];
    }
    let mut r = Rng::new(313);
    for rib in 0..4 {
        let x = rib * 4 + 2;
        let mut y = r.i(0, 3);
        while y < 16 {
            t.c[idx(x, y)] = hexc(0xd6d3a0);
            t.c[idx(x, y + 1)] = pick(&CACTUS_PAL, 2);
            t.h[idx(x, y)] = 1.2;
            y += r.i(4, 6);
        }
    }
    t
}

fn cactus_top() -> Tx {
    let mut t = Tx::new(40, 1.2);
    t.wrap = false;
    for i in 0..P {
        let (x, y) = xy(i);
        let (dx, dy) = (x as f32 - 7.5, y as f32 - 7.5);
        let cheb = dx.abs().max(dy.abs());
        let n = (rnd(x, y, 321) - 0.5) * 1.2;
        let v = if cheb >= 7.0 {
            0.6
        } else if cheb >= 6.0 {
            1.9
        } else if (4.0..5.0).contains(&cheb) {
            4.1
        } else {
            3.0
        } + n;
        let mut c = pick(&CACTUS_PAL, (v.round() as i32).clamp(0, 5));
        if cheb < 1.0 {
            c = hexc(0xb4d88a);
        } else if (dx.abs() < 1.0 && dy.abs() < 2.0) || (dy.abs() < 1.0 && dx.abs() < 2.0) {
            c = hexc(0x86bd5c);
        }
        t.c[i] = c;
        t.h[i] = if cheb >= 7.0 { 0.3 } else { 0.8 };
    }
    t
}

// ============================================================================
// Liquids, ice, light sources
// ============================================================================

const WATER_PAL: [u32; 5] = [0x4d6f99, 0x55779f, 0x5e7fa6, 0x6787ad, 0x7190b4];

fn water() -> Tx {
    let mut t = Tx::new(255, 0.0);
    let f = field(|x, y, fx, fy| {
        let w = fbm(fx, fy, 4, 4, 2, 131);
        let ph = (2.0 * fx + fy) / S as f32 * core::f32::consts::TAU + 3.5 * w;
        0.7 * (0.5 + 0.5 * ph.sin()) + 0.15 * vnoise(fx, fy, 8, 8, 132) + 0.15 * rnd(x, y, 133)
    });
    let e = equalize(&f);
    for i in 0..P {
        let l = quant(e[i], &[0.12, 0.38, 0.68, 0.9]);
        t.c[i] = pick(&WATER_PAL, l);
    }
    t
}

const LAVA_PAL: [u32; 7] = [0x6e1905, 0x9a2707, 0xc4410b, 0xe2621a, 0xf48a1f, 0xfcb52f, 0xffda66];

fn lava() -> Tx {
    let mut t = Tx::new(180, 1.2);
    let mut r = Rng::new(141);
    let sites = scatter(&mut r, 6, 5.5, 0.9, 1.2);
    let f = field(|x, y, fx, fy| {
        let wx = fx + 5.0 * (vnoise(fx, fy, 2, 2, 142) - 0.5);
        let wy = fy + 5.0 * (vnoise(fx, fy, 2, 2, 143) - 0.5);
        let n = worley(&sites, wx, wy);
        let edge = n.f2 - n.f1;
        0.65 * (edge / 5.0).clamp(0.0, 1.0).sqrt() + 0.35 * fbm(fx, fy, 4, 4, 2, 144) + 0.05 * (rnd(x, y, 145) - 0.5)
    });
    let e = equalize(&f);
    for i in 0..P {
        let l = quant(e[i], &[0.05, 0.12, 0.25, 0.45, 0.68, 0.88]);
        t.c[i] = pick(&LAVA_PAL, l);
        t.em[i] = (200.0 + 55.0 * l as f32 / 6.0).round() as u8;
        t.sm[i] = if l <= 1 { 60 } else { 190 };
        t.h[i] = 1.0 - l as f32 / 6.0;
    }
    t
}

const ICE_PAL: [u32; 7] = [0x7ea6de, 0x8ab0e5, 0x97bbec, 0xa5c6f1, 0xb6d2f5, 0xcde2f9, 0xe2eefc];

fn ice() -> Tx {
    let mut t = Tx::new(220, 0.8);
    let f = field(|x, y, fx, fy| 0.75 * fbm(fx, fy, 2, 2, 2, 181) + 0.25 * rnd(x, y, 182));
    let e = equalize(&f);
    let mut lv = [0; P];
    for i in 0..P {
        lv[i] = quant(e[i], &[0.15, 0.45, 0.8]);
        t.h[i] = 0.8;
    }
    for i in 0..P {
        let (x, y) = xy(i);
        let (fx, fy) = (x as f32 + 0.5, y as f32 + 0.5);
        let d = (x + y).rem_euclid(16);
        let g = vnoise(fx, fy, 2, 2, 183);
        if d == 6 && g > 0.25 {
            lv[i] = 5;
        } else if (d == 5 || d == 7) && g > 0.45 {
            lv[i] = lv[i].max(4);
        }
        let g2 = vnoise(fx, fy, 2, 2, 185);
        if d == 13 && g2 > 0.45 {
            lv[i] = 5;
        }
    }
    // short white cracks across the grain
    let mut r = Rng::new(186);
    for _ in 0..3 {
        let (x, y) = (r.i(0, 15), r.i(0, 15));
        let len = r.i(2, 4);
        for k in 0..len {
            let i = idx(x + k, y + k);
            lv[i] = 6;
            t.h[i] = 0.3;
        }
    }
    for i in 0..P {
        t.c[i] = pick(&ICE_PAL, lv[i]);
    }
    t
}

const GLOW_PAL: [u32; 7] = [0x5e3a14, 0x8a5a20, 0xb27a2c, 0xd89c3c, 0xf0bf55, 0xfbdc7e, 0xfff1bd];

fn glowstone() -> Tx {
    let mut t = Tx::new(90, 1.4);
    let mut r = Rng::new(391);
    let sites = scatter(&mut r, 10, 3.8, 0.85, 1.25);
    let tone: Vec<f32> = sites.iter().map(|_| r.f()).collect();
    for i in 0..P {
        let (x, y) = xy(i);
        let n = worley(&sites, x as f32 + 0.5, y as f32 + 0.5);
        let edge = n.f2 - n.f1;
        let l = if edge < 0.85 {
            (rnd(x, y, 393) < 0.4) as i32
        } else {
            let v = 6.5 - n.f1 * 1.5 - (1.0 - tone[n.id]) * 2.0 + (rnd(x, y, 392) - 0.5) * 0.9;
            (v.round() as i32).clamp(2, 6)
        };
        t.c[i] = pick(&GLOW_PAL, l);
        t.em[i] = (180.0 + 75.0 * l as f32 / 6.0).round() as u8;
        t.h[i] = l as f32 / 6.0;
    }
    t
}

fn sea_lantern() -> Tx {
    let mut t = Tx::new(160, 1.2);
    t.wrap = false;
    let pal = [0x7ba39b, 0x93bab2, 0xa8cbc3, 0xbad8d1, 0xcce4de, 0xdcede8, 0xebf6f2, 0xf6fcfa];
    for i in 0..P {
        let (x, y) = xy(i);
        let border = x == 0 || y == 0 || x == 15 || y == 15;
        let div = x == 7 || x == 8 || y == 7 || y == 8;
        let (cdx, cdy) = (x as f32 - 7.5, y as f32 - 7.5);
        let dc = cdx.abs().max(cdy.abs());
        let (l, h) = if border {
            (0, 0.2)
        } else if div {
            ((7.0 - dc * 0.45).round() as i32, 0.6)
        } else {
            let lx = if x < 7 { x - 1 } else { x - 9 };
            let ly = if y < 7 { y - 1 } else { y - 9 };
            let pd = (lx as f32 - 2.5).abs().max((ly as f32 - 2.5).abs());
            let mut v = 4.2 - pd * 1.1;
            if lx == 0 || ly == 0 {
                v += 0.9;
            }
            if lx == 5 || ly == 5 {
                v -= 0.6;
            }
            v += (1.0 - dc / 7.5) * 1.2;
            v += 0.5 * (rnd(x, y, 611) - 0.5);
            ((v.round() as i32).clamp(1, 6), 0.9)
        };
        t.c[i] = pick(&pal, l);
        t.em[i] = (150.0 + 105.0 * l as f32 / 7.0).round() as u8;
        t.h[i] = h;
    }
    t
}

// ============================================================================
// Glass, wool
// ============================================================================

fn glass() -> Tx {
    let mut t = Tx::sprite(230);
    for k in 0..S {
        t.put(k, 0, hexc(0xdbe9f1));
        t.put(0, k, hexc(0xdbe9f1));
        t.put(k, 15, hexc(0xb7ccd9));
        t.put(15, k, hexc(0xb7ccd9));
    }
    t.put(0, 0, hexc(0xeef6fa));
    t.put(15, 15, hexc(0xa9c0cf));
    let hi = hexc(0xe6f1f7);
    for &(x, y) in &[(2, 6), (3, 5), (4, 4), (5, 3), (6, 2), (4, 6), (5, 5), (6, 4), (11, 13), (12, 12), (13, 11)] {
        t.put(x, y, hi);
    }
    t.sm = [230; P];
    t
}

/// Minecraft concrete: a flat colour with a faint mottle and a slight sheen.
fn concrete(base: u32, seed: u32) -> Tx {
    let mut t = Tx::new(120, 0.25);
    let c = hexc(base);
    let f = field(|x, y, fx, fy| 0.6 * fbm(fx, fy, 4, 4, 2, seed) + 0.4 * rnd(x, y, seed + 1));
    let e = equalize(&f);
    for i in 0..P {
        let k = (e[i] - 0.5) * 0.09;
        t.c[i] = if k < 0.0 { mixc(c, mulc(c, 0.6), -k * 2.0) } else { mixc(c, [255.0; 3], k * 0.7) };
        t.h[i] = e[i] * 0.3;
    }
    t
}

/// Neon: a bright glowing face with a darker rim, so letters and shapes built from it read as
/// solid strokes of light.
fn neon(base: u32, seed: u32) -> Tx {
    let mut t = Tx::new(200, 0.4);
    let c = hexc(base);
    for i in 0..P {
        let (x, y) = xy(i);
        let rim = x == 0 || y == 0 || x == 15 || y == 15;
        let d = ((x as f32 - 7.5).abs().max((y as f32 - 7.5).abs()) / 7.5).min(1.0);
        let n = (rnd(x, y, seed) - 0.5) * 0.06;
        t.c[i] = if rim { mulc(c, 0.55) } else { mixc(c, [255.0; 3], (1.0 - d) * 0.35 + n) };
        t.em[i] = if rim { 120 } else { (255.0 - d * 45.0) as u8 };
        t.h[i] = if rim { 0.1 } else { 0.6 };
    }
    t
}

/// Block of iron: brushed light steel with a bevelled panel edge.
fn iron_block() -> Tx {
    let mut t = Tx::new(205, 1.0);
    let base = hexc(0xdcdcdc);
    for i in 0..P {
        let (x, y) = xy(i);
        let edge = x == 0 || y == 0 || x == 15 || y == 15;
        let inner = x == 1 || y == 1 || x == 14 || y == 14;
        // Horizontal brushing, lighter toward the top left.
        let brush = 0.05 * (rnd(0, y, 711) - 0.5) + 0.04 * (rnd(x / 3, y, 712) - 0.5) - 0.06 * ((x + y) as f32 / 30.0);
        let (k, h) = if edge {
            (if x == 15 || y == 15 { -0.28 } else { 0.1 }, 0.0)
        } else if inner {
            (if x == 1 || y == 1 { 0.12 } else { -0.12 }, 0.7)
        } else {
            (brush, 0.85)
        };
        t.c[i] = if k < 0.0 { mixc(base, mulc(base, 0.45), -k) } else { mixc(base, [255.0; 3], k) };
        t.h[i] = h;
    }
    t
}

const END_STONE_PAL: [u32; 7] = [0x9c9a6a, 0xb3b27c, 0xc6c58c, 0xd6d69a, 0xdfdea5, 0xe8e8b2, 0xf1f1c2];

/// Blanket fabric: soft mottling around `c`, darkened toward the edges of the bed.
fn blanket(c: Col, x: i32, y: i32, seed: u32) -> Col {
    let n = 0.6 * fbm(x as f32 / 16.0, y as f32 / 16.0, 4, 4, 2, seed) + 0.4 * rnd(x, y, seed + 1);
    let k = (n - 0.5) * 0.3;
    if k < 0.0 {
        mixc(c, mulc(c, 0.55), -k)
    } else {
        mixc(c, [255.0; 3], k * 0.5)
    }
}

const RED_BED: u32 = 0xa32b26;
const BLUE_BED: u32 = 0x353d9c;
const GREEN_BED: u32 = 0x587a22;
const YELLOW_BED: u32 = 0xe9b52a;
const SHEET: u32 = 0xe9e6de;

/// The top of half a bed, head end up (the model turns it to face the bed's way): the head half
/// has the pillow on a white sheet and the blanket turned down over it, the foot half is all
/// blanket. The long edges are darker where the blanket falls over the sides.
fn bed_top(base: u32, seed: u32, head: bool) -> Tx {
    let mut t = Tx::new(20, 0.6);
    t.wrap = false;
    let c = hexc(base);
    let sheet = hexc(SHEET);
    for i in 0..P {
        let (x, y) = xy(i);
        let side = x == 0 || x == 15;
        let (col, h) = if head && y <= 8 {
            let pillow = (2..=6).contains(&y) && (2..=13).contains(&x);
            if pillow {
                // Plump: brighter in the middle, a crease line.
                let d = ((x as f32 - 7.5).abs() / 6.5).max((y as f32 - 4.0).abs() / 2.5);
                let crease = x == 7 || x == 8;
                let v = 1.0 - 0.14 * d * d - if crease { 0.06 } else { 0.0 } - 0.03 * rnd(x, y, seed + 3);
                (mulc(sheet, v), 0.9 - 0.3 * d)
            } else {
                (mulc(sheet, if side { 0.78 } else { 0.9 - 0.03 * rnd(x, y, seed + 4) }), 0.45)
            }
        } else if head && y == 9 {
            // The blanket's turned-down edge.
            (mixc(blanket(c, x, y, seed), [255.0; 3], 0.22), 0.8)
        } else if side || (!head && y == 15) {
            (mulc(blanket(c, x, y, seed), 0.62), 0.2)
        } else {
            (blanket(c, x, y, seed), 0.5)
        };
        t.c[i] = col;
        t.h[i] = h;
    }
    t
}

/// The long side of half a bed, head end to the right. Only rows 7..12 show (the mattress is
/// 3..9 high): the blanket's lit top edge, its folds, a dark hem; the head half ends in the white
/// sheet round the pillow.
fn bed_side(base: u32, seed: u32, head: bool) -> Tx {
    let mut t = Tx::new(25, 0.7);
    t.wrap = false;
    let c = hexc(base);
    let sheet = hexc(SHEET);
    for i in 0..P {
        let (x, y) = xy(i);
        let fabric = if head && x >= 10 { mulc(sheet, 0.92 - 0.03 * rnd(x, y, seed + 6)) } else { blanket(c, x, y, seed) };
        let fold = (x % 5 == 2 && !(head && x >= 10)) as i32 as f32;
        let (col, h) = if y <= 7 {
            (mixc(fabric, [255.0; 3], 0.16), 0.8)
        } else if y >= 12 {
            (mulc(fabric, 0.6), 0.3)
        } else {
            (mulc(fabric, 0.93 - 0.08 * fold - 0.02 * (y - 8) as f32), 0.6 - 0.1 * fold)
        };
        t.c[i] = if head && x == 10 && y > 7 { mulc(col, 0.85) } else { col };
        t.h[i] = h;
    }
    t
}

/// The end of a bed (rows 7..12 show): white sheet at the head, blanket at the foot.
fn bed_end(base: u32, seed: u32, head: bool) -> Tx {
    let mut t = Tx::new(25, 0.7);
    t.wrap = false;
    let c = hexc(base);
    let sheet = hexc(SHEET);
    for i in 0..P {
        let (x, y) = xy(i);
        let fabric = if head { mulc(sheet, 0.9 - 0.03 * rnd(x, y, seed + 8)) } else { blanket(c, x, y, seed) };
        let edge = x == 0 || x == 15;
        let (col, h) = if y <= 7 {
            (mixc(fabric, [255.0; 3], 0.16), 0.8)
        } else if y >= 12 {
            (mulc(fabric, 0.6), 0.3)
        } else {
            (mulc(fabric, if edge { 0.8 } else { 0.95 - 0.02 * (y - 8) as f32 }), 0.6)
        };
        t.c[i] = col;
        t.h[i] = h;
    }
    t
}

fn wool(base: u32, seed: u32) -> Tx {
    let mut t = Tx::new(8, 0.35);
    let c = hexc(base);
    let f = field(|x, y, fx, fy| 0.55 * fbm(fx, fy, 4, 4, 2, seed) + 0.45 * rnd(x, y, seed + 1));
    let e = equalize(&f);
    let mut lv = [0i32; P];
    for i in 0..P {
        lv[i] = 1 + quant(e[i], &[0.22, 0.78]);
    }
    let mut r = Rng::new(seed + 2);
    for _ in 0..26 {
        let (x, y) = (r.i(0, 15), r.i(0, 15));
        let (dx, dy) = [(1, 1), (1, -1), (1, 0), (1, 1)][r.i(0, 3) as usize];
        let len = r.i(2, 3);
        let lit = r.chance(0.55);
        for k in 0..len {
            lv[idx(x + dx * k, y + dy * k)] = if lit { 4 } else { 0 };
        }
    }
    let lum = (c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11) / 255.0;
    let (dk, lt) = if lum < 0.2 {
        (0.3, 0.1)
    } else if lum > 0.8 {
        (0.25, 0.3)
    } else {
        (0.35, 0.14)
    };
    for i in 0..P {
        let k = [-1.0, -0.5, 0.0, 0.5, 1.0][lv[i] as usize];
        t.c[i] = if k < 0.0 {
            mixc(c, mulc(c, 0.5), -k * dk)
        } else {
            mixc(c, [255.0; 3], k * lt)
        };
        t.h[i] = lv[i] as f32 / 4.0;
    }
    t
}

// ============================================================================
// Sprites: plants, mushrooms, torch
// ============================================================================

const PLANT_GREY: [u32; 6] = [0x6c6c6c, 0x808080, 0x949494, 0xa8a8a8, 0xbbbbbb, 0xcdcdcd];

fn short_grass() -> Tx {
    let mut t = Tx::sprite(15);
    // (base x, top row, lean, tone)
    const BLADES: [(i32, i32, f32, i32); 12] = [
        (1, 9, 0.8, 1),
        (3, 5, -1.3, 2),
        (4, 10, 1.6, 1),
        (5, 2, 1.4, 3),
        (6, 8, -2.2, 2),
        (8, 3, -0.9, 3),
        (9, 7, 2.2, 2),
        (10, 11, -1.4, 1),
        (11, 4, 1.2, 3),
        (12, 9, -1.8, 2),
        (14, 6, -1.2, 2),
        (7, 11, 0.6, 1),
    ];
    for &(x0, top, lean, tone) in &BLADES {
        for y in top..=15 {
            let u = (15 - y) as f32 / (15 - top) as f32;
            let x = (x0 as f32 + lean * u * u).round() as i32;
            let mut l = tone + 1;
            if u > 0.75 {
                l += 1;
            }
            if y >= 14 {
                l -= 1;
            }
            t.put(x, y, pick(&PLANT_GREY, l));
        }
    }
    t
}

fn fern() -> Tx {
    let mut t = Tx::sprite(15);
    // fronds as quadratic Bezier curves: (p0, p1, p2, leaflet length, tone)
    type Pt = (f32, f32);
    let fronds: [(Pt, Pt, Pt, f32, i32); 5] = [
        ((7.0, 15.0), (6.0, 10.0), (1.0, 7.0), 2.0, 1),
        ((8.0, 15.0), (10.0, 9.0), (14.5, 6.5), 2.0, 1),
        ((7.5, 15.0), (8.0, 8.0), (6.5, 1.5), 2.2, 2),
        ((7.0, 15.0), (4.0, 13.0), (1.0, 12.5), 1.5, 0),
        ((8.0, 15.0), (11.0, 13.5), (14.5, 12.0), 1.5, 0),
    ];
    for &(p0, p1, p2, len, tone) in &fronds {
        let mut last = (-99, -99);
        let mut k = 0;
        for s in 0..=48 {
            let u = s as f32 / 48.0;
            let a = (1.0 - u) * (1.0 - u);
            let b = 2.0 * (1.0 - u) * u;
            let c = u * u;
            let px = a * p0.0 + b * p1.0 + c * p2.0;
            let py = a * p0.1 + b * p1.1 + c * p2.1;
            let (ix, iy) = (px.round() as i32, py.round() as i32);
            if (ix, iy) == last {
                continue;
            }
            last = (ix, iy);
            k += 1;
            // tangent
            let tx = 2.0 * (1.0 - u) * (p1.0 - p0.0) + 2.0 * u * (p2.0 - p1.0);
            let ty = 2.0 * (1.0 - u) * (p1.1 - p0.1) + 2.0 * u * (p2.1 - p1.1);
            let tl = (tx * tx + ty * ty).sqrt().max(1e-3);
            let (tx, ty) = (tx / tl, ty / tl);
            if k > 2 && k % 2 == 0 {
                let taper = (1.0 - u * 0.8) * len * (u * 4.0).min(1.0);
                let n = taper.round() as i32;
                for side in [-1.0f32, 1.0] {
                    let (nx, ny) = (-ty * side, tx * side);
                    for j in 1..=n {
                        let fx = px + nx * j as f32 + tx * 0.6 * j as f32;
                        let fy = py + ny * j as f32 + ty * 0.6 * j as f32;
                        let l = tone + 2 + (j == n) as i32;
                        t.put(fx.round() as i32, fy.round() as i32, pick(&PLANT_GREY, l));
                    }
                }
            }
            t.put(ix, iy, pick(&PLANT_GREY, tone + if u > 0.6 { 2 } else { 1 }));
        }
    }
    t
}

const TWIG_PAL: [u32; 4] = [0x4f341a, 0x6a4724, 0x83592e, 0x9c6e3b];

fn dead_bush() -> Tx {
    let mut t = Tx::sprite(10);
    let pal = &TWIG_PAL;
    /// Grows a twig upward from (x, y); `dir` is its lean (-1, 0, 1). Forks recursively.
    fn branch(t: &mut Tx, r: &mut Rng, x: i32, y: i32, dir: i32, len: i32, depth: i32) {
        let pal = &TWIG_PAL;
        let (mut x, mut y) = (x, y);
        for s in 0..len {
            let diag = if dir == 0 { r.chance(0.2) } else { r.chance(0.65) };
            if diag {
                x += if dir == 0 { r.sign() } else { dir };
            }
            y -= 1;
            if y < 1 || !(0..S).contains(&x) {
                return;
            }
            let tone = if depth == 0 { 1 } else { 2 } + (s == len - 1) as i32;
            t.put(x, y, pick(pal, tone));
            if depth < 2 && s >= 1 && r.chance(0.3) {
                let nd = if dir == 0 { r.sign() } else { -dir };
                branch(t, r, x, y, nd, (len - s).max(2) - 1, depth + 1);
            }
        }
    }
    let mut r = Rng::new(381);
    t.put(7, 15, pick(pal, 0));
    t.put(8, 15, pick(pal, 0));
    t.put(7, 14, pick(pal, 1));
    branch(&mut t, &mut r, 7, 14, -1, 9, 0);
    branch(&mut t, &mut r, 8, 15, 1, 9, 0);
    branch(&mut t, &mut r, 7, 14, 0, 10, 0);
    t
}

/// Torch stick colours (lit side, shaded side) and flame colours, shared by both torches.
const STICK: [(u32, u32); 2] = [(0x94693a, 0x86602f), (0x61421f, 0x573b1b)];
/// Flame rows, top down: the pixels a torch's top three rows show (left, right).
const FLAME: [(u32, u32); 3] = [(0xffe27a, 0xffcf4a), (0xfffae0, 0xffe890), (0xf5a431, 0xe8841e)];

/// A torch: a stick two pixels wide (columns 7-8) with its flame in rows 6-8. The 3D torch is a
/// box 2x10x2 in the middle of the block, so its sides show rows 6..15 of these columns and its
/// top rows 7-8; the item shows the whole picture, with a flame tip and glow round it.
fn torch() -> Tx {
    let mut t = Tx::sprite(20);
    for y in 9..=15 {
        let v = rnd(0, y, 471) < 0.3;
        for (k, &(a, b)) in STICK.iter().enumerate() {
            t.put(7 + k as i32, y, hexc(if v { a } else { b }));
        }
    }
    for (r, &(a, b)) in FLAME.iter().enumerate() {
        for (k, c) in [a, b].into_iter().enumerate() {
            t.put(7 + k as i32, 6 + r as i32, hexc(c));
            t.em[idx(7 + k as i32, 6 + r as i32)] = 255;
        }
    }
    // Only the flat item shows these: the flame's tip and its orange rim.
    for &(x, y, c) in &[(7, 5, 0xf08c22), (8, 5, 0xe8801e), (6, 6, 0xe8801e), (9, 6, 0xdc6e18), (6, 7, 0xf08c22), (9, 7, 0xe2761a)] {
        t.put(x, y, hexc(c));
        t.em[idx(x, y)] = 255;
    }
    t
}

/// A torch on a wall: an upright 2x10x2 stick against the wall, 3..13 high (see
/// `shapes::ModelKind::WallTorch`). Texture maps from world position and the stick sits at the
/// edge of its block, so its four sides show three different column pairs: the stick is drawn at
/// all three (0-1, 7-8, 14-15, rows 3..12, flame on top), and the top shows rows 0-1 of columns 7-8.
fn wall_torch() -> Tx {
    let mut t = Tx::sprite(20);
    for x0 in [0, 7, 14] {
        for y in 6..=12 {
            let v = rnd(0, y, 471) < 0.3;
            for (k, &(a, b)) in STICK.iter().enumerate() {
                t.put(x0 + k as i32, y, hexc(if v { a } else { b }));
            }
        }
        for (r, &(a, b)) in FLAME.iter().enumerate() {
            for (k, c) in [a, b].into_iter().enumerate() {
                t.put(x0 + k as i32, 3 + r as i32, hexc(c));
                t.em[idx(x0 + k as i32, 3 + r as i32)] = 255;
            }
        }
    }
    for (x, y, c) in [(7, 0, FLAME[0].0), (8, 0, FLAME[0].1), (7, 1, FLAME[1].0), (8, 1, FLAME[1].1)] {
        t.put(x, y, hexc(c));
        t.em[idx(x, y)] = 255;
    }
    t
}

struct Ink(&'static [(u8, u32)]);

/// Paints a hand-authored 16x16 sprite; `.` is transparent, other characters index `ink`.
fn pixel_art(art: &[&str; 16], ink: &Ink) -> Tx {
    let mut t = Tx::sprite(15);
    for (y, row) in art.iter().enumerate() {
        for (x, ch) in row.bytes().enumerate() {
            if ch == b'.' {
                continue;
            }
            if let Some(&(_, c)) = ink.0.iter().find(|(k, _)| *k == ch) {
                t.put(x as i32, y as i32, hexc(c));
            }
        }
    }
    t
}

const DANDELION_ART: [&str; 16] = [
    "................",
    "................",
    "................",
    "................",
    "......abb.......",
    ".....abbbc......",
    ".....abdbc......",
    ".....bbbcc......",
    "......bcc.......",
    ".......G........",
    ".......g........",
    ".......g........",
    "..l....g...l....",
    "...lL..g..Ll....",
    "....lLLgLLl.....",
    ".......g........",
];
const DANDELION_INK: Ink = Ink(&[
    (b'a', 0xfff27a),
    (b'b', 0xf8d42a),
    (b'c', 0xdca316),
    (b'd', 0xc27d10),
    (b'g', 0x4f8a2b),
    (b'G', 0x386b1f),
    (b'l', 0x64a537),
    (b'L', 0x3f7a24),
]);

const POPPY_ART: [&str; 16] = [
    "................",
    "................",
    "................",
    "......abbc......",
    ".....abbbbc.....",
    "....abbddbbc....",
    "....bbbddbcc....",
    ".....bbbbcc.....",
    "......cGcc......",
    ".......G........",
    ".......g........",
    ".......g.l......",
    "....l..glL......",
    ".....lLg........",
    "......Lg........",
    ".......g........",
];
const POPPY_INK: Ink = Ink(&[
    (b'a', 0xf0503c),
    (b'b', 0xd21e1e),
    (b'c', 0xa0121a),
    (b'd', 0x2a1a14),
    (b'g', 0x4f8a2b),
    (b'G', 0x386b1f),
    (b'l', 0x64a537),
    (b'L', 0x3f7a24),
]);

const CORNFLOWER_ART: [&str; 16] = [
    "................",
    "................",
    "................",
    ".....a.a.b......",
    "....aabbbbc.....",
    "...abbddbbcc....",
    "....bbddbbc.....",
    "...bb.bbc.cc....",
    "......cGc.......",
    ".......G........",
    ".......g........",
    "......Lg........",
    ".....lLg..l.....",
    ".......glL......",
    ".......gL.......",
    ".......g........",
];
const CORNFLOWER_INK: Ink = Ink(&[
    (b'a', 0x8aa8ff),
    (b'b', 0x4a6ee8),
    (b'c', 0x2f4bbf),
    (b'd', 0x2a237a),
    (b'g', 0x4f8a2b),
    (b'G', 0x386b1f),
    (b'l', 0x64a537),
    (b'L', 0x3f7a24),
]);

const BROWN_MUSHROOM_ART: [&str; 16] = [
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "......abbc......",
    ".....abbbbc.....",
    ".....cuuuuc.....",
    ".......sS.......",
    ".......sS.......",
    ".......sS.......",
];
const BROWN_MUSHROOM_INK: Ink = Ink(&[
    (b'a', 0xb38a66),
    (b'b', 0x96704f),
    (b'c', 0x7a5a3e),
    (b'u', 0x5e4430),
    (b's', 0xdcd0b8),
    (b'S', 0xb8aa90),
]);

const RED_MUSHROOM_ART: [&str; 16] = [
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "......hrrr......",
    ".....hwrrwr.....",
    "....hrrrrrrR....",
    "....rwrrrwRR....",
    ".....uuuuuu.....",
    ".......sS.......",
    ".......sS.......",
    ".......sS.......",
];
const RED_MUSHROOM_INK: Ink = Ink(&[
    (b'h', 0xf0544a),
    (b'r', 0xd8261e),
    (b'R', 0xa8161a),
    (b'w', 0xf2ece2),
    (b'u', 0x8a2a20),
    (b's', 0xe0d8c8),
    (b'S', 0xc2b8a6),
]);

// ============================================================================
// Tests and preview
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    const CUTOUT: [u16; 14] = [
        tex::WALL_TORCH,
        tex::OAK_LEAVES,
        tex::BIRCH_LEAVES,
        tex::SPRUCE_LEAVES,
        tex::GLASS,
        tex::SHORT_GRASS,
        tex::FERN,
        tex::DANDELION,
        tex::POPPY,
        tex::CORNFLOWER,
        tex::DEAD_BUSH,
        tex::TORCH,
        tex::BROWN_MUSHROOM,
        tex::RED_MUSHROOM,
    ];

    #[test]
    fn contract() {
        let t0 = std::time::Instant::now();
        let (a, m) = generate();
        let dt = t0.elapsed();
        eprintln!("texgen: generate() took {:?}", dt);
        assert_eq!(a.len(), tex::COUNT * P * 4);
        assert_eq!(m.len(), tex::COUNT * P * 4);
        let (a2, m2) = generate();
        assert!(a == a2 && m == m2, "deterministic");
        // Normal orientation: the top row of a brick (row 4, below the mortar row 3) faces up
        // (+Y toward row 0), the bottom row of the brick above (row 2) faces down.
        let g = |layer: u16, x: usize, y: usize| m[(layer as usize * P + y * 16 + x) * 4 + 1];
        assert!(g(tex::BRICKS, 2, 4) > 150, "brick top edge normal must point up");
        assert!(g(tex::BRICKS, 2, 2) < 106, "brick bottom edge normal must point down");
        assert_eq!(m[(tex::WATER as usize * P) * 4..][..2], [128, 128], "water is flat");
        for layer in 0..tex::COUNT {
            let l = layer as u16;
            let px = &a[layer * P * 4..(layer + 1) * P * 4];
            let alphas: Vec<u8> = px.chunks(4).map(|p| p[3]).collect();
            if l == tex::GRASS_TOP {
                assert!(alphas.iter().all(|&v| v == 0));
            } else if l == tex::GRASS_SIDE {
                assert!(alphas.iter().all(|&v| v == 0 || v == 255));
                assert!(alphas[..16].iter().all(|&v| v == 0), "grass fringe on row 0");
                assert!(alphas[15 * 16..].iter().all(|&v| v == 255), "dirt on row 15");
            } else if CUTOUT.contains(&l) {
                assert!(alphas.iter().all(|&v| v == 0 || v == 255), "{}", tex::NAMES[layer]);
                assert!(alphas.contains(&0), "{}", tex::NAMES[layer]);
            } else {
                assert!(alphas.iter().all(|&v| v == 255), "{}", tex::NAMES[layer]);
            }
        }
    }

    // ---------------------------------------------------------------- tiny PNG encoder

    fn crc32(bytes: &[u8]) -> u32 {
        let mut c = 0xffff_ffffu32;
        for &b in bytes {
            c ^= b as u32;
            for _ in 0..8 {
                c = if c & 1 != 0 { (c >> 1) ^ 0xedb8_8320 } else { c >> 1 };
            }
        }
        !c
    }

    fn adler32(bytes: &[u8]) -> u32 {
        let (mut a, mut b) = (1u32, 0u32);
        for &x in bytes {
            a = (a + x as u32) % 65521;
            b = (b + a) % 65521;
        }
        (b << 16) | a
    }

    fn chunk(out: &mut Vec<u8>, kind: &[u8; 4], data: &[u8]) {
        out.extend_from_slice(&(data.len() as u32).to_be_bytes());
        let mut body = kind.to_vec();
        body.extend_from_slice(data);
        out.extend_from_slice(&body);
        out.extend_from_slice(&crc32(&body).to_be_bytes());
    }

    fn png(w: usize, h: usize, rgb: &[u8]) -> Vec<u8> {
        let mut raw = Vec::with_capacity((w * 3 + 1) * h);
        for y in 0..h {
            raw.push(0);
            raw.extend_from_slice(&rgb[y * w * 3..(y + 1) * w * 3]);
        }
        let mut z = vec![0x78, 0x01];
        let blocks: Vec<&[u8]> = raw.chunks(65535).collect();
        for (k, b) in blocks.iter().enumerate() {
            z.push((k + 1 == blocks.len()) as u8);
            z.extend_from_slice(&(b.len() as u16).to_le_bytes());
            z.extend_from_slice(&(!(b.len() as u16)).to_le_bytes());
            z.extend_from_slice(b);
        }
        z.extend_from_slice(&adler32(&raw).to_be_bytes());
        let mut ihdr = Vec::new();
        ihdr.extend_from_slice(&(w as u32).to_be_bytes());
        ihdr.extend_from_slice(&(h as u32).to_be_bytes());
        ihdr.extend_from_slice(&[8, 2, 0, 0, 0]);
        let mut out = b"\x89PNG\r\n\x1a\n".to_vec();
        chunk(&mut out, b"IHDR", &ihdr);
        chunk(&mut out, b"IDAT", &z);
        chunk(&mut out, b"IEND", &[]);
        out
    }

    // ---------------------------------------------------------------- canvas helpers

    struct Img {
        w: usize,
        h: usize,
        px: Vec<u8>,
    }

    impl Img {
        fn new(w: usize, h: usize, bg: [u8; 3]) -> Img {
            let mut px = Vec::with_capacity(w * h * 3);
            for _ in 0..w * h {
                px.extend_from_slice(&bg);
            }
            Img { w, h, px }
        }
        fn set(&mut self, x: usize, y: usize, c: [u8; 3]) {
            if x < self.w && y < self.h {
                let o = (y * self.w + x) * 3;
                self.px[o..o + 3].copy_from_slice(&c);
            }
        }
        fn save(&self, name: &str) {
            let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("target/texgen-preview");
            std::fs::create_dir_all(&dir).unwrap();
            std::fs::write(dir.join(name), png(self.w, self.h, &self.px)).unwrap();
        }
        /// Digits in a 3x5 font, scaled.
        fn number(&mut self, x: usize, y: usize, n: usize, s: usize, c: [u8; 3]) {
            const F: [u16; 10] = [
                0b111_101_101_101_111,
                0b010_110_010_010_111,
                0b111_001_111_100_111,
                0b111_001_111_001_111,
                0b101_101_111_001_001,
                0b111_100_111_001_111,
                0b111_100_111_101_111,
                0b111_001_001_010_010,
                0b111_101_111_101_111,
                0b111_101_111_001_111,
            ];
            let digits: Vec<usize> = n.to_string().bytes().map(|b| (b - b'0') as usize).collect();
            for (k, &d) in digits.iter().enumerate() {
                for row in 0..5 {
                    for col in 0..3 {
                        if F[d] >> (14 - (row * 3 + col)) & 1 == 1 {
                            for yy in 0..s {
                                for xx in 0..s {
                                    self.set(x + (k * 4 + col) * s + xx, y + row * s + yy, c);
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    fn lin(c: u8) -> f32 {
        let c = c as f32 / 255.0;
        if c <= 0.04045 {
            c / 12.92
        } else {
            ((c + 0.055) / 1.055).powf(2.4)
        }
    }

    fn srgb(l: f32) -> u8 {
        let l = l.clamp(0.0, 1.0);
        let c = if l <= 0.0031308 { l * 12.92 } else { 1.055 * l.powf(1.0 / 2.4) - 0.055 };
        (c * 255.0).round() as u8
    }

    const TINT: [f32; 3] = [0.30, 0.55, 0.13];

    /// Display colour of a texel (tint applied like the shader), or None if transparent.
    fn texel(a: &[u8], layer: usize, x: usize, y: usize) -> Option<[u8; 3]> {
        let o = (layer * P + y * 16 + x) * 4;
        let (r, g, b, al) = (a[o], a[o + 1], a[o + 2], a[o + 3]);
        let l = layer as u16;
        let tint_mask = l == tex::GRASS_TOP || l == tex::GRASS_SIDE;
        let tint_all = l == tex::OAK_LEAVES || l == tex::SHORT_GRASS || l == tex::FERN;
        if tint_mask && al == 0 || tint_all && al == 255 {
            return Some([srgb(lin(r) * TINT[0]), srgb(lin(g) * TINT[1]), srgb(lin(b) * TINT[2])]);
        }
        if al == 0 {
            return None;
        }
        Some([r, g, b])
    }

    fn checker(x: usize, y: usize) -> [u8; 3] {
        if (x / 4 + y / 4) & 1 == 0 {
            [96, 96, 100]
        } else {
            [140, 140, 146]
        }
    }

    fn draw_tex(img: &mut Img, a: &[u8], layer: usize, ox: usize, oy: usize, scale: usize, reps: usize) {
        for ty in 0..16 * reps {
            for tx in 0..16 * reps {
                let c = texel(a, layer, tx % 16, ty % 16);
                for yy in 0..scale {
                    for xx in 0..scale {
                        let (px, py) = (ox + tx * scale + xx, oy + ty * scale + yy);
                        img.set(px, py, c.unwrap_or_else(|| checker(px, py)));
                    }
                }
            }
        }
    }

    fn albedo_sheet(a: &[u8], layers: &[usize], cols: usize, name: &str) {
        let (s1, s3) = (8usize, 3usize);
        let cw = 16 * s1 + 2 + 48 * s3;
        let ch = 14 + 48 * s3;
        let rows = layers.len().div_ceil(cols);
        let mut img = Img::new(cols * (cw + 2) + 2, rows * (ch + 2) + 2, [34, 34, 38]);
        for (k, &layer) in layers.iter().enumerate() {
            let ox = 2 + (k % cols) * (cw + 2);
            let oy = 2 + (k / cols) * (ch + 2);
            img.number(ox, oy + 1, layer, 2, [230, 230, 120]);
            draw_tex(&mut img, a, layer, ox, oy + 14, s1, 1);
            draw_tex(&mut img, a, layer, ox + 16 * s1 + 2, oy + 14, s3, 3);
        }
        img.save(name);
    }

    fn material_sheet(m: &[u8], cols: usize, name: &str) {
        let s = 4usize;
        let cw = 3 * 16 * s + 4;
        let ch = 12 + 16 * s;
        let rows = tex::COUNT.div_ceil(cols);
        let mut img = Img::new(cols * (cw + 4) + 4, rows * (ch + 4) + 4, [34, 34, 38]);
        for layer in 0..tex::COUNT {
            let ox = 4 + (layer % cols) * (cw + 4);
            let oy = 4 + (layer / cols) * (ch + 4);
            img.number(ox, oy, layer, 2, [230, 230, 120]);
            for y in 0..16 {
                for x in 0..16 {
                    let o = (layer * P + y * 16 + x) * 4;
                    let n = [m[o], m[o + 1], 255];
                    let sm = [m[o + 2]; 3];
                    let em = [m[o + 3], (m[o + 3] as f32 * 0.8) as u8, (m[o + 3] as f32 * 0.4) as u8];
                    for yy in 0..s {
                        for xx in 0..s {
                            img.set(ox + x * s + xx, oy + 12 + y * s + yy, n);
                            img.set(ox + 16 * s + 2 + x * s + xx, oy + 12 + y * s + yy, sm);
                            img.set(ox + 32 * s + 4 + x * s + xx, oy + 12 + y * s + yy, em);
                        }
                    }
                }
            }
        }
        img.save(name);
    }

    fn scene(a: &[u8], name: &str) {
        use tex::*;
        let n = u16::MAX;
        let layout: [[u16; 12]; 8] = [
            [SHORT_GRASS, FERN, DANDELION, POPPY, CORNFLOWER, TORCH, SHORT_GRASS, BROWN_MUSHROOM, RED_MUSHROOM, DEAD_BUSH, n, FERN],
            [GRASS_SIDE, GRASS_SIDE, GRASS_SIDE, GRASS_SIDE, GRASS_SIDE, GRASS_SIDE, GRASS_SIDE, PODZOL_SIDE, PODZOL_SIDE, SAND, GRASS_SNOW_SIDE, GRASS_SIDE],
            [DIRT, DIRT, DIRT, DIRT, DIRT, DIRT, DIRT, DIRT, DIRT, SANDSTONE, DIRT, DIRT],
            [STONE, COAL_ORE, STONE, IRON_ORE, STONE, GOLD_ORE, STONE, ANDESITE, GRANITE, DIORITE, GRAVEL, CLAY],
            [STONE, DIAMOND_ORE, REDSTONE_ORE, LAPIS_ORE, DEEPSLATE, DEEPSLATE, COBBLESTONE, MOSSY_COBBLESTONE, STONE_BRICKS, BRICKS, OBSIDIAN, BEDROCK],
            [OAK_LOG, OAK_PLANKS, OAK_LEAVES, BIRCH_LOG, BIRCH_PLANKS, BIRCH_LEAVES, SPRUCE_LOG, SPRUCE_PLANKS, SPRUCE_LEAVES, BOOKSHELF, GLASS, CACTUS_SIDE],
            [WATER, WATER, LAVA, LAVA, GLOWSTONE, SEA_LANTERN, ICE, SNOW, SANDSTONE_TOP, PODZOL_TOP, GRASS_TOP, DEEPSLATE_TOP],
            [WHITE_WOOL, RED_WOOL, YELLOW_WOOL, GREEN_WOOL, BLUE_WOOL, BLACK_WOOL, OAK_LOG_TOP, BIRCH_LOG_TOP, SPRUCE_LOG_TOP, CACTUS_TOP, DIRT, STONE],
        ];
        let s = 4usize;
        let mut img = Img::new(12 * 16 * s, 8 * 16 * s, [138, 180, 232]);
        for (by, row) in layout.iter().enumerate() {
            for (bx, &l) in row.iter().enumerate() {
                if l == n {
                    continue;
                }
                for y in 0..16 {
                    for x in 0..16 {
                        if let Some(c) = texel(a, l as usize, x, y) {
                            for yy in 0..s {
                                for xx in 0..s {
                                    img.set((bx * 16 + x) * s + xx, (by * 16 + y) * s + yy, c);
                                }
                            }
                        }
                    }
                }
            }
        }
        img.save(name);
    }

    #[test]
    #[ignore]
    fn preview() {
        let (a, m) = generate();
        let all: Vec<usize> = (0..tex::COUNT).collect();
        albedo_sheet(&a, &all, 6, "albedo.png");
        for (k, part) in all.chunks(12).enumerate() {
            albedo_sheet(&a, part, 4, &format!("albedo_{}.png", k));
        }
        if let Ok(list) = std::env::var("TEXGEN_FOCUS") {
            let pick: Vec<usize> = list.split(',').filter_map(|s| s.trim().parse().ok()).collect();
            albedo_sheet(&a, &pick, 3, "focus.png");
        }
        material_sheet(&m, 8, "material.png");
        scene(&a, "scene.png");
        // per-layer statistics: luma range, average colour (opaque or tint-mask texels),
        // transparent share, smoothness and emissive ranges
        for l in 0..tex::COUNT {
            let (mut lo, mut hi, mut n, mut sum) = (255u32, 0u32, 0u32, [0u32; 3]);
            let (mut s0, mut s1, mut e0, mut e1) = (255u8, 0u8, 255u8, 0u8);
            let tint_mask = l == tex::GRASS_TOP as usize || l == tex::GRASS_SIDE as usize;
            for p in 0..P {
                let o = (l * P + p) * 4;
                if a[o + 3] == 0 && !tint_mask {
                    continue;
                }
                let y = (a[o] as u32 * 3 + a[o + 1] as u32 * 6 + a[o + 2] as u32) / 10;
                lo = lo.min(y);
                hi = hi.max(y);
                n += 1;
                for k in 0..3 {
                    sum[k] += a[o + k] as u32;
                }
                s0 = s0.min(m[o + 2]);
                s1 = s1.max(m[o + 2]);
                e0 = e0.min(m[o + 3]);
                e1 = e1.max(m[o + 3]);
            }
            eprintln!(
                "{:2} {:18} luma {:3}..{:3}  avg #{:02X}{:02X}{:02X}  clear {:3.0}%  smooth {:3}..{:3}  emit {:3}..{:3}",
                l,
                tex::NAMES[l],
                lo,
                hi,
                sum[0] / n,
                sum[1] / n,
                sum[2] / n,
                100.0 * (P as u32 - n) as f32 / P as f32,
                s0,
                s1,
                e0,
                e1
            );
        }
    }
}
