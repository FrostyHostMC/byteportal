//! The platform's built-in entity art: the default player skin (also the first-person arm)
//! and a small starter kit of item sprites (swords, bow, arrow, potion, heart). Like the block
//! textures in `texgen`, nothing here comes from an image file: it is painted at startup from
//! fixed seeds. Games bring their own mobs and items as atlases (`game.items.atlas`).
//!
//! Technique: every model part is a box with Minecraft skin UVs. Each face texel is mapped back
//! to a point on the box surface, so painters work in 3D (part-local x, y, z) and patterns such
//! as noise, hems, straps and seams continue around corners. Painters return a palette level
//! and a small height value; a per-face pass turns the heights into crisp top-left bevel light
//! (lit upper/left rims, shaded lower/right rims, cast shadows) before posterising to the
//! palette. Held items are 16x16 hand-authored or procedurally rasterised sprites with an
//! automatic dark outline.
//!
//! Output contract:
//! - `generate()` returns `(albedo, emissive)`.
//! - albedo: `ATLAS * ATLAS * 4` bytes of sRGB RGBA8, row 0 = top of the image, alpha strictly
//!   0 or 255. Transparent texels next to painted ones carry a nearby colour (filter-friendly).
//! - emissive: `ATLAS * ATLAS` bytes, glow intensity 0..255 (0 = none); a glowing texel's albedo
//!   is its glow colour.
//!
//! Box UV convention (Minecraft skin layout), for a part of `w` x `h` x `d` texels at (u, v):
//! top (u+d, v, w, d), bottom (u+d+w, v, w, d), right (u, v+d, d, h), front (u+d, v+d, w, h),
//! left (u+d+w, v+d, d, h), back (u+2d+w, v+d, w, h). Faces are oriented as on a standard skin
//! (classic `ModelBox`): the front face's left column is the creature's right side; side faces
//! are upright and share their vertical edges with the neighbouring faces in the strip
//! right | front | left | back (wrapping); the top face's bottom row borders the front face;
//! the bottom face uses the same orientation (its last row is the front edge).
//!
//! Atlas layout (256 x 256, unused texels transparent):
//! - (0,0): the player skin, standard 64x64 layout (`HUMAN_*` boxes).
//! - Items: 16x16 sprites in a row at y = 64, see `ITEMS` (x = 16 * index).
//! - Held 3D models (box UVs, lengths along part-space z with z = 0 at the tip / top end):
//!   the four swords at (64 * tier, 96), `SWORD_*` boxes; the potion at (0, 120), `POTION_*`.

#![allow(clippy::needless_range_loop)]

pub const ATLAS: usize = 256;
const AW: i32 = ATLAS as i32;

type Col = [f32; 3];

/// Returns `(albedo, emissive)`; see the module docs for the layout and semantics.
pub fn generate() -> (Vec<u8>, Vec<u8>) {
    let mut cv = Canvas::new();
    player(&mut cv, PLAYER.0, PLAYER.1);
    items(&mut cv, 0, ITEM_Y);
    for (k, m) in SWORD_MODELS.iter().enumerate() {
        sword_model(&mut cv, SWORD_MODEL.0 + 64 * k as i32, SWORD_MODEL.1, m);
    }
    potion_model(&mut cv, POTION_MODEL.0, POTION_MODEL.1);
    cv.finish()
}

// ============================================================================
// Layout
// ============================================================================

/// A model box: UV origin (relative to its region) and size in texels.
#[derive(Clone, Copy, Debug)]
pub struct Part {
    pub u: i32,
    pub v: i32,
    pub w: i32,
    pub h: i32,
    pub d: i32,
}

const fn part(u: i32, v: i32, w: i32, h: i32, d: i32) -> Part {
    Part { u, v, w, h, d }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Face {
    Top,
    Bottom,
    Right,
    Front,
    Left,
    Back,
}

pub const FACES: [Face; 6] = [Face::Top, Face::Bottom, Face::Right, Face::Front, Face::Left, Face::Back];

impl Part {
    /// Atlas rectangle `(x, y, width, height)` of a face, relative to the region origin.
    pub fn rect(&self, f: Face) -> (i32, i32, i32, i32) {
        let Part { u, v, w, h, d } = *self;
        match f {
            Face::Top => (u + d, v, w, d),
            Face::Bottom => (u + d + w, v, w, d),
            Face::Right => (u, v + d, d, h),
            Face::Front => (u + d, v + d, w, h),
            Face::Left => (u + d + w, v + d, d, h),
            Face::Back => (u + 2 * d + w, v + d, w, h),
        }
    }
}

pub const PLAYER: (i32, i32) = (0, 0);

/// The standard 64x64 humanoid skin layout.
pub const HUMAN_HEAD: Part = part(0, 0, 8, 8, 8);
pub const HUMAN_BODY: Part = part(16, 16, 8, 12, 4);
pub const HUMAN_ARM: Part = part(40, 16, 4, 12, 4);
pub const HUMAN_LEG: Part = part(0, 16, 4, 12, 4);

/// Held sword models, one 64x24 region per tier at (SWORD_MODEL.0 + 64 * tier, SWORD_MODEL.1).
/// Blade 4 wide (x) and 1 thick (y): its broad faces are the top / bottom faces.
pub const SWORD_MODEL: (i32, i32) = (0, 96);
pub const SWORD_BLADE: Part = part(0, 0, 4, 1, 15);
pub const SWORD_TIP1: Part = part(0, 18, 2, 1, 2);
pub const SWORD_TIP2: Part = part(10, 18, 1, 1, 2);
pub const SWORD_GUARD: Part = part(40, 0, 10, 2, 2);
pub const SWORD_GRIP: Part = part(40, 6, 2, 2, 6);
pub const SWORD_POMMEL: Part = part(40, 16, 3, 3, 2);

/// The potion model, upright along z (z = 0 at the top of each box).
pub const POTION_MODEL: (i32, i32) = (0, 120);
pub const POTION_BODY: Part = part(0, 0, 6, 6, 5);
pub const POTION_SHOULDER: Part = part(24, 0, 4, 4, 1);
pub const POTION_NECK: Part = part(36, 0, 2, 2, 3);
pub const POTION_LIP: Part = part(48, 0, 3, 3, 1);
pub const POTION_CORK: Part = part(24, 6, 2, 2, 2);

pub const ITEM_Y: i32 = 64;
/// Item sprites, left to right from x = 0 at y = `ITEM_Y`, 16 px apart.
pub const ITEMS: [&str; 9] = [
    "wooden_sword",
    "stone_sword",
    "iron_sword",
    "diamond_sword",
    "bow",
    "bow_pulling",
    "arrow",
    "health_potion",
    "heart",
];

// ============================================================================
// Randomness and noise
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
fn hash3(x: i32, y: i32, z: i32, seed: u32) -> u32 {
    let h = mix32(seed.wrapping_mul(0x9e37_79b9) ^ 0x2545_f491);
    let h = mix32(h ^ (x as u32).wrapping_mul(0x85eb_ca77));
    let h = mix32(h ^ (y as u32).wrapping_mul(0xc2b2_ae3d));
    mix32(h ^ (z as u32).wrapping_mul(0x27d4_eb2f))
}

#[inline]
fn unit(h: u32) -> f32 {
    (h >> 8) as f32 * (1.0 / 16_777_216.0)
}

/// Per-texel white noise in [0, 1).
#[inline]
fn rnd(x: i32, y: i32, seed: u32) -> f32 {
    unit(hash3(x, y, 0, seed))
}

#[inline]
fn lerp(a: f32, b: f32, t: f32) -> f32 {
    a + (b - a) * t
}

/// 3D value noise in [0, 1] on a unit lattice.
fn vnoise3(x: f32, y: f32, z: f32, seed: u32) -> f32 {
    let (x0, y0, z0) = (x.floor(), y.floor(), z.floor());
    let s = |t: f32| t * t * (3.0 - 2.0 * t);
    let (tx, ty, tz) = (s(x - x0), s(y - y0), s(z - z0));
    let (i, j, k) = (x0 as i32, y0 as i32, z0 as i32);
    let g = |a: i32, b: i32, c: i32| unit(hash3(i + a, j + b, k + c, seed));
    let a = lerp(lerp(g(0, 0, 0), g(1, 0, 0), tx), lerp(g(0, 1, 0), g(1, 1, 0), tx), ty);
    let b = lerp(lerp(g(0, 0, 1), g(1, 0, 1), tx), lerp(g(0, 1, 1), g(1, 1, 1), tx), ty);
    lerp(a, b, tz)
}

#[inline]
fn hexc(v: u32) -> Col {
    [((v >> 16) & 255) as f32, ((v >> 8) & 255) as f32, (v & 255) as f32]
}

#[inline]
fn pick(p: &[u32], i: i32) -> Col {
    hexc(p[i.clamp(0, p.len() as i32 - 1) as usize])
}

// ============================================================================
// Canvas
// ============================================================================

const N: usize = ATLAS * ATLAS;

struct Canvas {
    c: Vec<Col>,
    a: Vec<bool>,
    /// Texel has a meaningful colour (opaque, or a deliberately coloured hole).
    known: Vec<bool>,
    e: Vec<u8>,
}

impl Canvas {
    fn new() -> Canvas {
        Canvas { c: vec![[0.0; 3]; N], a: vec![false; N], known: vec![false; N], e: vec![0; N] }
    }

    #[inline]
    fn at(x: i32, y: i32) -> Option<usize> {
        if (0..AW).contains(&x) && (0..AW).contains(&y) {
            Some((y * AW + x) as usize)
        } else {
            None
        }
    }

    fn set(&mut self, x: i32, y: i32, c: Col, e: u8) {
        if let Some(i) = Canvas::at(x, y) {
            self.c[i] = c;
            self.a[i] = true;
            self.known[i] = true;
            self.e[i] = e;
        }
    }

    /// A transparent texel that still carries a colour for texture filtering.
    fn hole(&mut self, x: i32, y: i32, c: Col) {
        if let Some(i) = Canvas::at(x, y) {
            self.c[i] = c;
            self.a[i] = false;
            self.known[i] = true;
            self.e[i] = 0;
        }
    }

    fn finish(mut self) -> (Vec<u8>, Vec<u8>) {
        // One dilation pass: unpainted texels bordering painted ones take their average colour.
        let prev = self.c.clone();
        for y in 0..AW {
            for x in 0..AW {
                let i = (y * AW + x) as usize;
                if self.known[i] {
                    continue;
                }
                let (mut sum, mut n) = ([0.0f32; 3], 0.0f32);
                for dy in -1..=1 {
                    for dx in -1..=1 {
                        if let Some(j) = Canvas::at(x + dx, y + dy) {
                            if self.known[j] {
                                for k in 0..3 {
                                    sum[k] += prev[j][k];
                                }
                                n += 1.0;
                            }
                        }
                    }
                }
                if n > 0.0 {
                    self.c[i] = [sum[0] / n, sum[1] / n, sum[2] / n];
                }
            }
        }
        let mut alb = vec![0u8; N * 4];
        for i in 0..N {
            for k in 0..3 {
                alb[i * 4 + k] = self.c[i][k].round().clamp(0.0, 255.0) as u8;
            }
            alb[i * 4 + 3] = if self.a[i] { 255 } else { 0 };
            if !self.a[i] {
                self.e[i] = 0;
            }
        }
        (alb, self.e)
    }
}

// ============================================================================
// Box painting
// ============================================================================

/// A face texel seen from the painter: where it is on the face and on the 3D box.
/// (A general toolkit: not every sampler is used by the built-in art.)
#[derive(Clone, Copy)]
#[allow(dead_code)]
struct S {
    f: Face,
    /// Face-local column and row, and face width.
    c: i32,
    r: i32,
    fw: i32,
    /// Surface point (texel centre) in part space: x from the creature's right side (0) to its
    /// left (w), y from the top (0) down (h), z from the front (0) to the back (d).
    x: f32,
    y: f32,
    z: f32,
    /// The voxel cell under the texel.
    ix: i32,
    iy: i32,
    iz: i32,
    w: i32,
    h: i32,
    d: i32,
    /// Atlas texel (per-texel white noise).
    ax: i32,
    ay: i32,
    /// Column in the side strip right | front | left | back (continuous around the box);
    /// -1 on the top and bottom faces.
    per: i32,
}

#[allow(dead_code)]
impl S {
    fn new(p: &Part, f: Face, c: i32, r: i32, ax: i32, ay: i32) -> S {
        let (w, h, d) = (p.w, p.h, p.d);
        let fw = match f {
            Face::Top | Face::Bottom | Face::Front | Face::Back => w,
            Face::Right | Face::Left => d,
        };
        let (ix, iy, iz) = match f {
            Face::Front => (c, r, 0),
            Face::Back => (w - 1 - c, r, d - 1),
            Face::Right => (0, r, d - 1 - c),
            Face::Left => (w - 1, r, c),
            Face::Top => (c, 0, d - 1 - r),
            Face::Bottom => (c, h - 1, d - 1 - r),
        };
        let (mut x, mut y, mut z) = (ix as f32 + 0.5, iy as f32 + 0.5, iz as f32 + 0.5);
        match f {
            Face::Front => z = 0.0,
            Face::Back => z = d as f32,
            Face::Right => x = 0.0,
            Face::Left => x = w as f32,
            Face::Top => y = 0.0,
            Face::Bottom => y = h as f32,
        }
        let per = match f {
            Face::Right => c,
            Face::Front => d + c,
            Face::Left => d + w + c,
            Face::Back => 2 * d + w + c,
            _ => -1,
        };
        S { f, c, r, fw, x, y, z, ix, iy, iz, w, h, d, ax, ay, per }
    }

    #[inline]
    fn side(&self) -> bool {
        !matches!(self.f, Face::Top | Face::Bottom)
    }

    #[inline]
    fn rnd(&self, seed: u32) -> f32 {
        rnd(self.ax, self.ay, seed)
    }

    /// Smooth noise with feature sizes (in texels) per axis.
    #[inline]
    fn n(&self, sx: f32, sy: f32, sz: f32, seed: u32) -> f32 {
        vnoise3(self.x / sx, self.y / sy, self.z / sz, seed)
    }

    #[inline]
    fn n1(&self, s: f32, seed: u32) -> f32 {
        self.n(s, s, s, seed)
    }

    /// Two-octave noise.
    fn fbm(&self, s: f32, seed: u32) -> f32 {
        0.65 * self.n1(s, seed) + 0.35 * self.n1(s * 0.5, seed.wrapping_add(17))
    }

    /// Smooth noise around the side strip (ragged hems and similar), periodic so it also
    /// joins up where the back face meets the right face. `s` is the feature size in texels.
    fn pn(&self, s: f32, seed: u32) -> f32 {
        let len = (2 * (self.w + self.d)) as f32;
        let a = (self.per as f32 + 0.5) / len * std::f32::consts::TAU;
        let r = len / (std::f32::consts::TAU * s);
        vnoise3(r * a.cos() + 64.0, r * a.sin() + 64.0, 0.5, seed)
    }

    /// Per-column white noise around the side strip.
    fn pr(&self, seed: u32) -> f32 {
        rnd(self.per, 7, seed)
    }

    /// Distance to a point in part space, with y stretched by `ky`.
    fn dist(&self, p: [f32; 3], ky: f32) -> f32 {
        let (dx, dy, dz) = (self.x - p[0], (self.y - p[1]) * ky, self.z - p[2]);
        (dx * dx + dy * dy + dz * dz).sqrt()
    }

    /// Horizontal distance from the vertical centre line of the part (for symmetric designs).
    fn cx(&self) -> f32 {
        (self.x - self.w as f32 * 0.5).abs()
    }
}

/// What a painter returns for a texel.
#[derive(Clone, Copy)]
struct Px {
    pal: &'static [u32],
    /// Palette level before lighting.
    l: f32,
    /// Height for the bevel pass (texels; small values).
    h: f32,
    /// Emissive intensity.
    e: u8,
    a: bool,
    /// How strongly the bevel light moves the level (0 for glowing texels).
    k: f32,
}

fn px(pal: &'static [u32], l: f32) -> Px {
    Px { pal, l, h: 0.0, e: 0, a: true, k: 1.0 }
}

#[allow(dead_code)]
impl Px {
    fn h(mut self, h: f32) -> Px {
        self.h = h;
        self
    }
    fn dl(mut self, dl: f32) -> Px {
        self.l += dl;
        self
    }
    fn glow(mut self, e: u8) -> Px {
        self.e = e;
        self.k = 0.0;
        self
    }
    /// Transparent, keeping the colour for filtering.
    fn clear(mut self) -> Px {
        self.a = false;
        self.h = -1.5;
        self
    }
}

/// Paints all six faces of `p` (region origin `ox`, `oy`) with `f`, then applies bevel light.
fn paint_box(cv: &mut Canvas, ox: i32, oy: i32, p: Part, mut f: impl FnMut(&S) -> Px) {
    let mut buf: Vec<Px> = Vec::new();
    for face in FACES {
        let (fx, fy, fw, fh) = p.rect(face);
        buf.clear();
        for r in 0..fh {
            for c in 0..fw {
                let s = S::new(&p, face, c, r, ox + fx + c, oy + fy + r);
                buf.push(f(&s));
            }
        }
        let hat = |c: i32, r: i32| buf[(r.clamp(0, fh - 1) * fw + c.clamp(0, fw - 1)) as usize].h;
        for r in 0..fh {
            for c in 0..fw {
                let q = buf[(r * fw + c) as usize];
                let (x, y) = (ox + fx + c, oy + fy + r);
                if !q.a {
                    cv.hole(x, y, pick(q.pal, q.l.round() as i32));
                    continue;
                }
                let d = |o: f32| (q.h - o).clamp(-1.0, 1.0);
                let (up, lf, dn, rt) = (d(hat(c, r - 1)), d(hat(c - 1, r)), d(hat(c, r + 1)), d(hat(c + 1, r)));
                // Key light from the top left: upper/left rims of raised shapes catch light,
                // lower/right rims turn away, and raised shapes cast shadow down and right.
                let light = 0.9 * up.max(0.0) + 0.6 * lf.max(0.0)
                    - 0.9 * (-up).max(0.0)
                    - 0.55 * (-lf).max(0.0)
                    - 0.7 * dn.max(0.0)
                    - 0.45 * rt.max(0.0);
                let lvl = (q.l + q.k * light).round() as i32;
                cv.set(x, y, pick(q.pal, lvl), q.e);
            }
        }
    }
}

/// Applies a hand-drawn face overlay: `art` rows use '.' for "no change".
fn glyph(art: &[&str], c: i32, r: i32) -> u8 {
    if r < 0 || r as usize >= art.len() {
        return b'.';
    }
    let row = art[r as usize].as_bytes();
    if c < 0 || c as usize >= row.len() {
        b'.'
    } else {
        row[c as usize]
    }
}

// ============================================================================
// Shared palettes
// ============================================================================

const IRON: [u32; 8] = [0x1c1e22, 0x2a2d32, 0x3a3e44, 0x4c5158, 0x60656d, 0x767c83, 0x8f959b, 0xb0b5ba];
const LEATHER: [u32; 7] = [0x20130b, 0x2e1c10, 0x3d2616, 0x4d311c, 0x5e3d23, 0x704a2b, 0x845a35];
const GOLD: [u32; 8] = [0x4a2c07, 0x6b420b, 0x8e5c12, 0xb27a1b, 0xd09a28, 0xe8bb40, 0xf8da74, 0xfff2bd];


// ============================================================================
// Player (adventurer): standard layout, also the first-person arm
// ============================================================================

const P_SKIN: [u32; 8] = [0x4a2a1c, 0x6a3f2a, 0x8a5638, 0xa56c47, 0xbb8158, 0xcd966b, 0xdcab82, 0xe8c19c];
const P_HAIR: [u32; 6] = [0x1a100a, 0x28190f, 0x372215, 0x472d1b, 0x583822, 0x6b452b];
const P_TUNIC: [u32; 8] = [0x0b2224, 0x103033, 0x163f43, 0x1c5054, 0x246266, 0x2e7578, 0x3b898a, 0x4c9d9b];
const P_PANTS: [u32; 6] = [0x14171e, 0x1c2029, 0x252a36, 0x2f3544, 0x3a4153, 0x464e63];
const P_EYE: [u32; 3] = [0x1d3b6b, 0x2f5fa5, 0xe9eef2];

fn player(cv: &mut Canvas, ox: i32, oy: i32) {
    paint_box(cv, ox, oy, HUMAN_HEAD, player_head);
    paint_box(cv, ox, oy, HUMAN_BODY, player_body);
    paint_box(cv, ox, oy, HUMAN_ARM, player_arm);
    paint_box(cv, ox, oy, HUMAN_LEG, player_leg);
}

/// Warm skin with a soft top-down gradient.
fn p_skin(s: &S, seed: u32) -> Px {
    let l = 4.6 + 1.0 * (s.fbm(2.0, seed) - 0.5) + 0.5 * (s.rnd(seed + 1) - 0.5) - 0.8 * s.y / s.h as f32;
    px(&P_SKIN, l)
}

fn p_tunic(s: &S, seed: u32) -> Px {
    let fold = s.n(1.5, 4.0, 1.5, seed);
    let l = 4.2 + 1.8 * (fold - 0.5) + 0.6 * (s.rnd(seed + 1) - 0.5) - 0.9 * s.y / s.h as f32;
    px(&P_TUNIC, l).h(0.4)
}

fn p_leather(s: &S, seed: u32, l0: f32) -> Px {
    let l = l0 + 1.2 * (s.fbm(1.8, seed) - 0.5) + 0.6 * (s.rnd(seed + 1) - 0.5);
    px(&LEATHER, l).h(0.8)
}

const PLAYER_FACE: [&str; 8] = [
    "hhhhhhhh",
    "hhhhhhhh",
    "hh.hh..h",
    ".bb..bb.",
    ".wi..iw.",
    "...nN...",
    "..mMMm..",
    "........",
];

fn player_head(s: &S) -> Px {
    let skin = p_skin(s, 101).dl(0.4);
    let hair = |s: &S| {
        let l = 2.6 + 2.0 * (s.n(1.0, 2.5, 1.0, 102) - 0.5) + 0.8 * (s.rnd(103) - 0.5);
        px(&P_HAIR, l).h(0.7)
    };
    match s.f {
        Face::Top => hair(s),
        Face::Bottom => skin.dl(-1.2),
        Face::Front => match glyph(&PLAYER_FACE, s.c, s.r) {
            b'h' => hair(s),
            b'b' => px(&P_HAIR, 1.5).h(0.3),
            b'w' => px(&P_EYE, 2.0),
            b'i' => px(&P_EYE, if s.r == 4 { 0.6 } else { 1.0 }).h(-0.2),
            b'n' => skin.dl(-0.4).h(0.5),
            b'N' => skin.dl(-1.0),
            b'm' => skin.dl(-1.2),
            b'M' => px(&P_SKIN, 1.6).h(-0.4),
            _ => skin,
        },
        Face::Back => {
            let edge = 5.6 + 1.2 * s.pn(1.0, 104);
            if s.y < edge { hair(s) } else { skin.dl(-0.6) }
        }
        Face::Right | Face::Left => {
            // Hair over the top and back; an ear in front of it.
            let front = s.z;
            let edge = if front < 3.0 { 2.4 } else { 2.4 + (front - 3.0) * 1.1 };
            if s.y < edge + 0.6 * (s.n1(1.0, 105) - 0.5) {
                return hair(s);
            }
            if (4..=5).contains(&s.iy) && s.iz == 4 {
                return skin.dl(if s.iy == 4 { 0.3 } else { -0.8 }).h(0.4);
            }
            skin
        }
    }
}

fn player_body(s: &S) -> Px {
    match s.f {
        Face::Top => {
            if (2..=5).contains(&s.ix) && s.iz <= 1 {
                return p_skin(s, 111).dl(-0.6);
            }
            if s.ix == 0 {
                return p_leather(s, 113, 3.4);
            }
            return p_tunic(s, 115).dl(0.5);
        }
        Face::Bottom => return px(&P_PANTS, 2.0 + 0.8 * (s.rnd(117) - 0.5)),
        _ => {}
    }
    if s.iy >= 9 {
        let mut p = px(&P_PANTS, 3.0 + 1.0 * (s.n(1.4, 3.0, 1.4, 119) - 0.5) + 0.5 * (s.rnd(120) - 0.5));
        if s.iy == 9 {
            p.l -= 0.7;
        }
        return p;
    }
    // Belt with a brass buckle.
    if s.iy == 8 {
        if s.f == Face::Front && (3..=4).contains(&s.c) {
            return px(&GOLD, if s.c == 3 { 5.0 } else { 3.6 }).h(1.0);
        }
        return p_leather(s, 121, 2.6);
    }
    // V-neck.
    if s.f == Face::Front && ((s.r == 0 && (2..=5).contains(&s.c)) || (s.r == 1 && (3..=4).contains(&s.c))) {
        return p_skin(s, 111).dl(-0.4);
    }
    // Leather sash from the right shoulder to the left hip (continues round the back).
    if (s.f == Face::Front || s.f == Face::Back) && s.ix == s.iy {
        let mut p = p_leather(s, 123, 3.8);
        if s.f == Face::Front && s.iy == 3 {
            p = px(&IRON, 6.0).h(1.0); // a rivet
        }
        return p;
    }
    let mut p = p_tunic(s, 115);
    if s.f == Face::Right || s.f == Face::Left {
        p.l -= 0.5;
    }
    if s.f == Face::Front && s.iy >= 2 && s.c == 6 && s.iy <= 7 {
        p.l -= 0.8; // placket seam
    }
    p
}

/// Short tunic sleeve, bare forearm, leather bracer and a fist. Faces as seen in first person:
/// front = thumb side (faces up when the arm is raised), left = inner (fingers), right = outer
/// (back of the hand), bottom = knuckles.
fn player_arm(s: &S) -> Px {
    if s.f == Face::Top {
        return p_tunic(s, 131).dl(0.4);
    }
    if s.f == Face::Bottom {
        // Curled fingers: four knuckle ridges across the fist.
        let mut p = p_skin(s, 133).dl(-0.3);
        if s.r % 2 == 1 {
            p = p.dl(-0.5);
        }
        return p.h(if s.c % 2 == 0 { 0.3 } else { 0.0 });
    }
    let hem = 3.5 + 0.6 * s.pn(1.2, 135);
    if s.y < hem {
        let mut p = p_tunic(s, 131);
        if s.y > hem - 1.0 {
            p = p.dl(-0.9).h(0.6); // rolled hem
        }
        return p;
    }
    if (6..=8).contains(&s.iy) {
        let mut p = p_leather(s, 137, 4.0);
        if s.iy == 6 || s.iy == 8 {
            p = p.dl(-1.0);
        }
        if s.iy == 7 && s.f == Face::Right && s.c == 1 {
            p = px(&IRON, 5.5).h(1.0); // stud
        }
        return p;
    }
    let mut p = p_skin(s, 139);
    if s.iy >= 9 {
        // The fist.
        p.l += 0.3;
        match s.f {
            Face::Left => {
                // finger segments stacked along the grip
                p.h = if s.c % 2 == 0 { 0.4 } else { -0.2 };
                if s.iy == 9 {
                    p.l -= 0.7;
                }
            }
            Face::Right => {
                if s.iy == 10 {
                    p.l += 0.6; // knuckles
                    p.h = 0.5;
                }
            }
            Face::Front => {
                if s.iy == 9 && (1..=2).contains(&s.c) {
                    p.l += 0.5; // thumb
                    p.h = 0.6;
                } else if s.iy == 11 {
                    p.l -= 0.6;
                }
            }
            _ => {}
        }
    }
    p
}

fn player_leg(s: &S) -> Px {
    match s.f {
        Face::Top => return px(&P_PANTS, 3.0),
        Face::Bottom => return px(&LEATHER, 0.8 + 0.6 * (s.rnd(141) - 0.5)),
        _ => {}
    }
    if s.iy >= 9 {
        let mut p = p_leather(s, 143, 3.4);
        if s.iy == 9 {
            p = p.dl(0.8).h(1.0); // boot cuff
        } else if s.iy == 11 {
            p = p.dl(-1.4); // sole
        }
        return p;
    }
    let mut p = px(&P_PANTS, 3.2 + 1.2 * (s.n(1.4, 3.0, 1.4, 145) - 0.5) + 0.5 * (s.rnd(146) - 0.5)).h(0.3);
    if (s.f == Face::Right || s.f == Face::Left) && s.iz == 2 {
        p.l -= 0.8; // seam
    }
    if s.f == Face::Front && (5..=6).contains(&s.iy) {
        p.l += 0.5; // knees
    }
    p
}

// ============================================================================
// Held 3D models (swords, potion)
// ============================================================================

/// Palettes for a sword model, each dark to light.
struct SwordModel {
    blade: [u32; 5],
    guard: [u32; 3],
    pommel: [u32; 3],
    speckle: bool,
    glow: u8,
}

static SWORD_MODELS: [SwordModel; 4] = [
    SwordModel {
        blade: [0x2e1d0d, 0x755830, 0x967443, 0xb28d56, 0xd2ad74],
        guard: [0x24170a, 0x5b4023, 0x7a5a32],
        pommel: [0x3d2616, 0x6b4c28, 0x9a7646],
        speckle: false,
        glow: 0,
    },
    SwordModel {
        blade: [0x1c1c1f, 0x505054, 0x6b6b6f, 0x88888c, 0xa6a6aa],
        guard: [0x24170a, 0x5b4023, 0x7a5a32],
        pommel: [0x2a2a2e, 0x5a5a5e, 0x8a8a8e],
        speckle: true,
        glow: 0,
    },
    SwordModel {
        blade: [0x25282c, 0x8b9197, 0xb9bdc2, 0xdfe2e5, 0xffffff],
        guard: [0x1d1f22, 0x4b5057, 0x6d737a],
        pommel: [0x3a3e44, 0x6d737a, 0xb9bdc2],
        speckle: false,
        glow: 0,
    },
    SwordModel {
        blade: [0x0c3337, 0x22a0a6, 0x4ad6d4, 0x8ff4ee, 0xe8ffff],
        guard: [0x0a2729, 0x1d6468, 0x2f8e93],
        pommel: [0x0a2729, 0x22a0a6, 0x8ff4ee],
        speckle: false,
        glow: 40,
    },
];

fn sword_model(cv: &mut Canvas, ox: i32, oy: i32, m: &'static SwordModel) {
    let glow = |p: Px| if m.glow > 0 { p.glow(m.glow) } else { p };
    let blade = |s: &S| -> Px {
        // Part-space z = 0 is the tip end; z = d meets the guard.
        let along = s.z / s.d as f32;
        let mut p = match s.f {
            Face::Top | Face::Bottom => {
                let edge = s.ix == 0 || s.ix == s.w - 1;
                // A fuller down the middle that stops short of the tip and the guard.
                let fuller = !edge && along > 0.12 && along < 0.9;
                if edge {
                    px(&m.blade, 4.2).h(0.2)
                } else if fuller {
                    px(&m.blade, 1.6).h(-0.6)
                } else {
                    px(&m.blade, 2.9).h(0.3)
                }
            }
            // The honed edges (1 px faces) catch the light.
            Face::Right | Face::Left => px(&m.blade, 4.4),
            _ => px(&m.blade, 3.0),
        };
        p.l += 0.4 * (s.rnd(701) - 0.5) + 0.3 * (1.0 - along);
        if m.speckle && s.rnd(703) < 0.45 {
            p.l += if s.rnd(704) < 0.5 { -1.0 } else { 0.7 };
        }
        // A scratch or two.
        if s.rnd(702) < 0.04 {
            p.l += 1.2;
        }
        glow(p)
    };
    paint_box(cv, ox, oy, SWORD_BLADE, blade);
    paint_box(cv, ox, oy, SWORD_TIP1, |s| glow(px(&m.blade, if s.side() && (s.c == 0 || s.c == s.fw - 1) { 4.3 } else { 3.3 } + 0.3 * (s.rnd(705) - 0.5))));
    paint_box(cv, ox, oy, SWORD_TIP2, |s| glow(px(&m.blade, 4.1 + 0.2 * (s.rnd(706) - 0.5))));
    paint_box(cv, ox, oy, SWORD_GUARD, |s| {
        // Lit upper rim, shaded lower rim, darker flared ends and a central boss.
        let end = s.cx() > 3.8;
        let boss = s.cx() < 1.2 && matches!(s.f, Face::Front | Face::Back);
        let mut l = 1.3 + 0.35 * (s.rnd(707) - 0.5);
        if s.f == Face::Top || (s.side() && s.r == 0) {
            l += 0.7;
        }
        if s.side() && s.r == s.h - 1 {
            l -= 0.5;
        }
        if end {
            l -= 0.4;
        }
        if boss {
            l += 0.8;
        }
        px(&m.guard, l).h(if boss { 0.8 } else { 0.4 })
    });
    paint_box(cv, ox, oy, SWORD_GRIP, |s| {
        // Leather strips wound in a spiral, with dark gaps.
        let t = ((s.z * 1.0 + s.per.max(0) as f32 * 0.5) as i32).rem_euclid(3);
        match t {
            0 => p_leather(s, 709, 4.6).h(0.8),
            1 => p_leather(s, 709, 3.2).h(0.5),
            _ => px(&LEATHER, 0.8),
        }
    });
    paint_box(cv, ox, oy, SWORD_POMMEL, |s| {
        let lit = s.f == Face::Top || s.f == Face::Front || (s.side() && s.r == 0);
        px(&m.pommel, 1.0 + if lit { 0.9 } else { 0.0 } + 0.3 * (s.rnd(711) - 0.5)).h(0.5)
    });
}

const GLASS: [u32; 6] = [0x5f7680, 0x8fb0c0, 0xa9c6d2, 0xc8dde6, 0xe2f0f5, 0xffffff];
const BREW: [u32; 6] = [0x5a0712, 0x8e0f1e, 0xb8141f, 0xd8202c, 0xff5c5c, 0xffb0a8];
const CORK: [u32; 4] = [0x5e4222, 0x7a5a32, 0x8a6638, 0xb08a5a];

fn potion_model(cv: &mut Canvas, ox: i32, oy: i32) {
    // Glass bottle, liquid up to a meniscus (part-space z = 0 is the top).
    paint_box(cv, ox, oy, POTION_BODY, |s| {
        let side = s.side();
        // The top cap: brew seen through the glass from above.
        if s.f == Face::Front {
            let rim = s.c == 0 || s.r == 0 || s.c == s.fw - 1 || s.r == s.h - 1;
            return if rim { px(&GLASS, 4.0) } else { px(&BREW, 4.4 + 0.5 * (s.rnd(729) - 0.5)).glow(60) };
        }
        let liquid = s.f == Face::Back || s.z > 1.0;
        if liquid {
            let meniscus = side && s.z < 1.9;
            let highlight = side && s.c == 1 && s.z < 4.0;
            let l = if meniscus { 4.2 } else if highlight { 5.0 } else { 2.6 + 0.5 * (s.rnd(721) - 0.5) - 0.3 * (s.z - 2.0).max(0.0) };
            return px(&BREW, l).glow(90);
        }
        // Empty glass: pale, with a bright streak.
        let l = if side && s.c == 1 { 5.0 } else { 2.6 + 0.4 * (s.rnd(723) - 0.5) };
        px(&GLASS, l)
    });
    paint_box(cv, ox, oy, POTION_SHOULDER, |s| px(&GLASS, if s.side() && s.c == 0 { 4.6 } else { 2.8 }));
    paint_box(cv, ox, oy, POTION_NECK, |s| px(&GLASS, if s.side() && s.c == 0 { 4.4 } else { 2.2 }));
    paint_box(cv, ox, oy, POTION_LIP, |s| px(&GLASS, 3.4 + 0.3 * (s.rnd(725) - 0.5)).h(0.5));
    paint_box(cv, ox, oy, POTION_CORK, |s| px(&CORK, 1.6 + 0.8 * (s.rnd(727) - 0.5) + if s.f == Face::Front { 0.8 } else { 0.0 }));
}

// ============================================================================
// Items
// ============================================================================

/// A 16x16 item sprite.
struct Sprite {
    c: [u32; 256],
    a: [bool; 256],
    e: [u8; 256],
    /// Outline colour this texel asks for on transparent 4-neighbours (0 = none).
    ol: [u32; 256],
}

impl Sprite {
    fn new() -> Sprite {
        Sprite { c: [0; 256], a: [false; 256], e: [0; 256], ol: [0; 256] }
    }

    fn put(&mut self, x: i32, y: i32, c: u32, ol: u32) {
        if (0..16).contains(&x) && (0..16).contains(&y) {
            let i = (y * 16 + x) as usize;
            self.c[i] = c;
            self.a[i] = true;
            self.ol[i] = ol;
        }
    }

    fn glow(&mut self, x: i32, y: i32, e: u8) {
        if (0..16).contains(&x) && (0..16).contains(&y) {
            self.e[(y * 16 + x) as usize] = e;
        }
    }

    fn opaque(&self, x: i32, y: i32) -> bool {
        (0..16).contains(&x) && (0..16).contains(&y) && self.a[(y * 16 + x) as usize]
    }

    /// Paints ASCII art; each ink is (char, colour, outline colour, emissive).
    fn art(&mut self, rows: &[&str], ink: &[(u8, u32, u32, u8)]) {
        for (y, row) in rows.iter().enumerate() {
            for (x, ch) in row.bytes().enumerate() {
                if let Some(&(_, c, ol, e)) = ink.iter().find(|k| k.0 == ch) {
                    self.put(x as i32, y as i32, c, ol);
                    self.glow(x as i32, y as i32, e);
                }
            }
        }
    }

    /// Dark outline around everything that asks for one.
    fn outline(&mut self) {
        let prev_a = self.a;
        let prev_ol = self.ol;
        for y in 0..16i32 {
            for x in 0..16i32 {
                let i = (y * 16 + x) as usize;
                if prev_a[i] {
                    continue;
                }
                for (dx, dy) in [(0, -1), (-1, 0), (1, 0), (0, 1)] {
                    let (nx, ny) = (x + dx, y + dy);
                    if (0..16).contains(&nx) && (0..16).contains(&ny) {
                        let j = (ny * 16 + nx) as usize;
                        if prev_a[j] && prev_ol[j] != 0 {
                            self.c[i] = prev_ol[j];
                            self.a[i] = true;
                            self.ol[i] = 0;
                            break;
                        }
                    }
                }
            }
        }
    }

    /// Mirror left to right.
    fn flip_x(mut self) -> Sprite {
        for y in 0..16 {
            for x in 0..8 {
                let (i, j) = (y * 16 + x, y * 16 + 15 - x);
                self.c.swap(i, j);
                self.a.swap(i, j);
                self.e.swap(i, j);
                self.ol.swap(i, j);
            }
        }
        self
    }

    fn blit(&self, cv: &mut Canvas, ox: i32, oy: i32) {
        for i in 0..256 {
            let (x, y) = ((i % 16) as i32, (i / 16) as i32);
            if self.a[i] {
                cv.set(ox + x, oy + y, hexc(self.c[i]), self.e[i]);
            }
        }
    }
}

fn items(cv: &mut Canvas, ox: i32, oy: i32) {
    let list: [Sprite; 9] = [
        sword(&WOOD_SWORD),
        sword(&STONE_SWORD),
        sword(&IRON_SWORD),
        sword(&DIAMOND_SWORD),
        // Minecraft's orientation: wood arc to the upper left, arrow pointing up-left. The
        // first-person bow transforms (shared with Minecraft) rely on it.
        bow(false).flip_x(),
        bow(true).flip_x(),
        arrow(),
        potion(),
        heart(),
    ];
    for (k, s) in list.iter().enumerate() {
        s.blit(cv, ox + 16 * k as i32, oy);
    }
}

struct SwordPal {
    /// blade: highlight, light, mid, dark, outline
    blade: [u32; 5],
    /// guard: light, dark, outline
    guard: [u32; 3],
    /// pommel: light, dark
    pommel: [u32; 2],
    speckle: bool,
    glow: u8,
}

const WOOD_SWORD: SwordPal = SwordPal {
    blade: [0xd2ad74, 0xb28d56, 0x967443, 0x755830, 0x2e1d0d],
    guard: [0x7a5a32, 0x5b4023, 0x24170a],
    pommel: [0x9a7646, 0x6b4c28],
    speckle: false,
    glow: 0,
};
const STONE_SWORD: SwordPal = SwordPal {
    blade: [0xa6a6aa, 0x88888c, 0x6b6b6f, 0x505054, 0x1c1c1f],
    guard: [0x7a5a32, 0x5b4023, 0x24170a],
    pommel: [0x8a8a8e, 0x5a5a5e],
    speckle: true,
    glow: 0,
};
const IRON_SWORD: SwordPal = SwordPal {
    blade: [0xffffff, 0xdfe2e5, 0xb9bdc2, 0x8b9197, 0x25282c],
    guard: [0x6d737a, 0x4b5057, 0x1d1f22],
    pommel: [0xb9bdc2, 0x6d737a],
    speckle: false,
    glow: 0,
};
const DIAMOND_SWORD: SwordPal = SwordPal {
    blade: [0xe8ffff, 0x8ff4ee, 0x4ad6d4, 0x22a0a6, 0x0c3337],
    guard: [0x2f8e93, 0x1d6468, 0x0a2729],
    pommel: [0x8ff4ee, 0x22a0a6],
    speckle: false,
    glow: 40,
};

const HANDLE: [u32; 3] = [0x80592f, 0x5a3c1c, 0x22160a];

const SWORD_ART: [&str; 16] = [
    "................",
    ".............wm.",
    "............wmd.",
    "...........lmd..",
    "..........lmd...",
    ".........lmd....",
    "........lmd.....",
    "...g...lmd......",
    "...Gg.lmd.......",
    "....Ggmd........",
    "....hGg.........",
    "...hH.Gg........",
    "..hH...Gg.......",
    ".pH.............",
    ".PP.............",
    "................",
];

fn sword(p: &SwordPal) -> Sprite {
    let mut s = Sprite::new();
    let b = p.blade;
    let ink = [
        (b'w', b[0], b[4], p.glow),
        (b'l', b[1], b[4], p.glow),
        (b'm', b[2], b[4], p.glow),
        (b'd', b[3], b[4], p.glow),
        (b'g', p.guard[0], p.guard[2], 0),
        (b'G', p.guard[1], p.guard[2], 0),
        (b'h', HANDLE[0], HANDLE[2], 0),
        (b'H', HANDLE[1], HANDLE[2], 0),
        (b'p', p.pommel[0], HANDLE[2], 0),
        (b'P', p.pommel[1], HANDLE[2], 0),
    ];
    s.art(&SWORD_ART, &ink);
    if p.speckle {
        for y in 0..16 {
            for x in 0..16 {
                let i = (y * 16 + x) as usize;
                if s.a[i] && s.c[i] == b[2] && rnd(x, y, 401) < 0.45 {
                    s.c[i] = if rnd(x, y, 403) < 0.5 { b[3] } else { b[1] };
                } else if s.a[i] && s.c[i] == b[1] && rnd(x, y, 402) < 0.35 {
                    s.c[i] = b[2];
                }
            }
        }
    }
    s.outline();
    s
}



const BOW_WOOD: [u32; 4] = [0xa47a45, 0x80592f, 0x5c3e1d, 0x23160a];
const STRING: u32 = 0xd9d6cc;

fn bow(pull: bool) -> Sprite {
    let mut s = Sprite::new();
    // limb: circular arc through the tips (1,2), (13,14) and the grip (11,4)
    let (cx, cy, rr) = (5.0f32, 11.0f32, 9.19f32);
    for y in 0..16 {
        for x in 0..16 {
            let (fx, fy) = (x as f32 + 0.5, y as f32 + 0.5);
            let dist = ((fx - cx).powi(2) + (fy - cy).powi(2)).sqrt();
            // position along the limb: 0 at the grip, 1 at a tip
            let along = ((fx + fy - 16.0).abs() / 12.0).min(1.2);
            if x - y < -1 {
                continue;
            }
            let thick = 1.7 - 0.9 * along;
            let off = dist - rr;
            if off <= 0.55 && off >= -thick && along <= 1.02 {
                let grip = along < 0.14;
                let c = if grip {
                    if off > -0.5 { 0x6b3a22 } else { 0x4a2616 }
                } else if off > -0.35 {
                    BOW_WOOD[0]
                } else if off > -1.0 {
                    BOW_WOOD[1]
                } else {
                    BOW_WOOD[2]
                };
                s.put(x, y, c, BOW_WOOD[3]);
            }
        }
    }
    let (t1, t2) = ((1, 2), (13, 14));
    if pull {
        let nock = (4, 11);
        line(&mut s, t1, nock, STRING);
        line(&mut s, nock, t2, STRING);
        draw_arrow(&mut s, 0, 0, true);
    } else {
        line(&mut s, t1, t2, STRING);
    }
    s.outline();
    s
}

fn line(s: &mut Sprite, a: (i32, i32), b: (i32, i32), c: u32) {
    let (mut x, mut y) = a;
    let (dx, dy) = ((b.0 - a.0).abs(), -(b.1 - a.1).abs());
    let (sx, sy) = (if a.0 < b.0 { 1 } else { -1 }, if a.1 < b.1 { 1 } else { -1 });
    let mut err = dx + dy;
    loop {
        if !s.opaque(x, y) {
            s.put(x, y, c, 0);
        }
        if (x, y) == b {
            break;
        }
        let e2 = 2 * err;
        if e2 >= dy {
            err += dy;
            x += sx;
        }
        if e2 <= dx {
            err += dx;
            y += sy;
        }
    }
}

const FLINT: [u32; 4] = [0xd6d9dc, 0xa3a8ad, 0x6d7278, 0x1f2124];
const SHAFT: [u32; 3] = [0x9a7446, 0x72522c, 0x24170a];
const FEATHER: [u32; 3] = [0xf4f2ec, 0xc9c5ba, 0x3a3833];

/// Arrow along the anti-diagonal, head at the top right; `(ox, oy)` shifts it.
fn draw_arrow(s: &mut Sprite, ox: i32, oy: i32, nocked: bool) {
    let mut p = |x: i32, y: i32, c: u32, ol: u32| s.put(x + ox, y + oy, c, ol);
    // head
    p(12, 1, FLINT[1], FLINT[3]);
    p(13, 1, FLINT[0], FLINT[3]);
    p(14, 1, FLINT[0], FLINT[3]);
    p(13, 2, FLINT[1], FLINT[3]);
    p(14, 2, FLINT[2], FLINT[3]);
    p(14, 3, FLINT[2], FLINT[3]);
    // shaft
    let start = if nocked { 4 } else { 3 };
    for x in start..=12 {
        let y = 15 - x;
        p(x, y, if x % 2 == 0 { SHAFT[0] } else { SHAFT[1] }, SHAFT[2]);
    }
    // fletching
    let fl = if nocked { 1 } else { 0 };
    for &(x, y, c) in &[(3, 10, 0), (2, 11, 0), (3, 11, 1), (4, 12, 1), (5, 12, 0), (4, 13, 0)] {
        p(x + fl, y - fl, FEATHER[c], FEATHER[2]);
    }
    if !nocked {
        p(2, 13, SHAFT[1], SHAFT[2]);
    }
}

fn arrow() -> Sprite {
    let mut s = Sprite::new();
    draw_arrow(&mut s, 0, 0, false);
    s.outline();
    s
}



const POTION_ART: [&str; 16] = [
    "................",
    "......oooo......",
    ".....ocCCCo.....",
    ".....oCCCdo.....",
    "......oGgo......",
    "......oGgo......",
    ".....ooGgoo.....",
    "...ooGwGgggoo...",
    "..oGwGgggggggo..",
    "..oWsssssssssRo.",
    ".oWrhrrrrrrrrRo.",
    ".oWrrrrrrrrrRRo.",
    ".orrrrrrrrrrRRo.",
    "..oRrrrrrrrRRo..",
    "...ooRRRRRRoo...",
    ".....oooooo.....",
];

fn potion() -> Sprite {
    let mut s = Sprite::new();
    s.art(
        &POTION_ART,
        &[
            (b'o', 0x241a24, 0, 0),
            (b'c', 0xb08a5a, 0, 0),
            (b'C', 0x8a6638, 0, 0),
            (b'd', 0x5e4222, 0, 0),
            (b'G', 0xc8dde6, 0, 0),
            (b'g', 0x8fb0c0, 0, 0),
            (b'w', 0xffffff, 0, 0),
            (b'W', 0xffd0d0, 0, 90),
            (b's', 0xff5c5c, 0, 90),
            (b'h', 0xffb0a8, 0, 90),
            (b'r', 0xd8202c, 0, 90),
            (b'R', 0x8e0f1e, 0, 90),
        ],
    );
    s
}

const HEART_ART: [&str; 16] = [
    "................",
    "................",
    "...ooo....ooo...",
    "..ohhro..orrro..",
    ".ohwhrrooorrrro.",
    ".ohhrrrrrrrrrro.",
    ".orrrrrrrrrrrdo.",
    ".orrrrrrrrrrrdo.",
    "..orrrrrrrrrdo..",
    "...orrrrrrrdo...",
    "....orrrrrdo....",
    ".....orrrdo.....",
    "......ordo......",
    ".......oo.......",
    "................",
    "................",
];

fn heart() -> Sprite {
    let mut s = Sprite::new();
    s.art(
        &HEART_ART,
        &[
            (b'o', 0x2a0508, 0, 0),
            (b'w', 0xffffff, 0, 0),
            (b'h', 0xff7a7a, 0, 0),
            (b'r', 0xe0202a, 0, 0),
            (b'd', 0x96101c, 0, 0),
        ],
    );
    s
}





// ============================================================================
// Tests and preview
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn contract() {
        let t0 = std::time::Instant::now();
        let (a, e) = generate();
        eprintln!("entitytex: generate() took {:?}", t0.elapsed());
        assert_eq!(a.len(), ATLAS * ATLAS * 4);
        assert_eq!(e.len(), ATLAS * ATLAS);
        let (a2, e2) = generate();
        assert!(a == a2 && e == e2, "deterministic");
        for i in 0..ATLAS * ATLAS {
            let al = a[i * 4 + 3];
            assert!(al == 0 || al == 255, "alpha strictly 0 or 255");
            if al == 0 {
                assert_eq!(e[i], 0, "no glow on transparent texels");
            }
        }
        // Every face is painted (the crown's top and bottom are deliberately open), and nothing
        // is painted outside the face rectangles and item cells.
        let sword: &[Part] = &[SWORD_BLADE, SWORD_TIP1, SWORD_TIP2, SWORD_GUARD, SWORD_GRIP, SWORD_POMMEL];
        let models: [((i32, i32), &[Part]); 6] = [
            (PLAYER, &[HUMAN_HEAD, HUMAN_BODY, HUMAN_ARM, HUMAN_LEG]),
            (SWORD_MODEL, sword),
            ((SWORD_MODEL.0 + 64, SWORD_MODEL.1), sword),
            ((SWORD_MODEL.0 + 128, SWORD_MODEL.1), sword),
            ((SWORD_MODEL.0 + 192, SWORD_MODEL.1), sword),
            (POTION_MODEL, &[POTION_BODY, POTION_SHOULDER, POTION_NECK, POTION_LIP, POTION_CORK]),
        ];
        let mut owned = vec![false; ATLAS * ATLAS];
        let opaque = |x: i32, y: i32| a[((y * AW + x) * 4 + 3) as usize] == 255;
        for (region, parts) in models {
            for p in parts {
                for f in FACES {
                    let (fx, fy, fw, fh) = p.rect(f);
                    let mut n = 0;
                    for y in 0..fh {
                        for x in 0..fw {
                            let (ax, ay) = (region.0 + fx + x, region.1 + fy + y);
                            let i = (ay * AW + ax) as usize;
                            assert!(!owned[i], "faces overlap at ({ax}, {ay})");
                            owned[i] = true;
                            n += opaque(ax, ay) as i32;
                        }
                    }
                    assert!(n * 2 > fw * fh, "{region:?} {p:?} {f:?} mostly empty");
                }
            }
        }
        for k in 0..ITEMS.len() as i32 {
            let n: i32 = (0..256).map(|i| opaque(16 * k + i % 16, ITEM_Y + i / 16) as i32).sum();
            assert!(n > 20 && n < 200, "{} has a clear silhouette", ITEMS[k as usize]);
            for i in 0..256 {
                owned[((ITEM_Y + i / 16) * AW + 16 * k + i % 16) as usize] = true;
            }
        }
        for i in 0..ATLAS * ATLAS {
            assert!(owned[i] || a[i * 4 + 3] == 0, "stray texel at {}", i);
        }
        // Emissive levels per the spec.
        let emax = |(x0, y0): (i32, i32), w: i32, h: i32| {
            let mut m = 0u8;
            for y in y0..y0 + h {
                for x in x0..x0 + w {
                    m = m.max(e[(y * AW + x) as usize]);
                }
            }
            m
        };
        assert_eq!(emax(PLAYER, 64, 64), 0);
        let item_glow = |k: i32| emax((16 * k, ITEM_Y), 16, 16);
        assert_eq!(item_glow(3), 40, "diamond blade");
        assert_eq!(item_glow(7), 90, "potion liquid");
        for k in [0, 1, 2, 4, 5, 6, 8] {
            assert_eq!(item_glow(k), 0, "{} does not glow", ITEMS[k as usize]);
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
        fn set(&mut self, x: i32, y: i32, c: [u8; 3]) {
            if x >= 0 && y >= 0 && (x as usize) < self.w && (y as usize) < self.h {
                let o = (y as usize * self.w + x as usize) * 3;
                self.px[o..o + 3].copy_from_slice(&c);
            }
        }
        fn save(&self, name: &str) {
            let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("target/entitytex-preview");
            std::fs::create_dir_all(&dir).unwrap();
            std::fs::write(dir.join(name), png(self.w, self.h, &self.px)).unwrap();
        }
    }

    fn checker(x: i32, y: i32, s: i32) -> [u8; 3] {
        if (x / s + y / s) & 1 == 0 {
            [92, 92, 98]
        } else {
            [128, 128, 136]
        }
    }

    fn texel(a: &[u8], x: i32, y: i32) -> Option<[u8; 3]> {
        let o = ((y * AW + x) * 4) as usize;
        if a[o + 3] == 0 {
            None
        } else {
            Some([a[o], a[o + 1], a[o + 2]])
        }
    }

    fn atlas_sheet(a: &[u8], e: &[u8]) {
        let s = 4;
        let mut img = Img::new(ATLAS * s, ATLAS * s, [0, 0, 0]);
        let mut em = Img::new(ATLAS * s, ATLAS * s, [0, 0, 0]);
        for y in 0..AW {
            for x in 0..AW {
                let t = texel(a, x, y);
                let g = e[(y * AW + x) as usize];
                for yy in 0..s as i32 {
                    for xx in 0..s as i32 {
                        let (px, py) = (x * s as i32 + xx, y * s as i32 + yy);
                        let mut c = t.unwrap_or_else(|| checker(px, py, 8));
                        if (x % 64 == 0 || y % 64 == 0) && t.is_none() {
                            c = [60, 60, 150];
                        }
                        img.set(px, py, c);
                        let gc = if g > 0 {
                            let o = ((y * AW + x) * 4) as usize;
                            let k = g as f32 / 255.0;
                            [(a[o] as f32 * k) as u8, (a[o + 1] as f32 * k) as u8, (a[o + 2] as f32 * k) as u8]
                        } else if t.is_some() {
                            [28, 28, 32]
                        } else {
                            [0, 0, 0]
                        };
                        em.set(px, py, gc);
                    }
                }
            }
        }
        img.save("atlas.png");
        em.save("emissive.png");
    }

    // ---------------------------------------------------------------- model preview

    /// A box placed in model space (x: creature's right to left, y: down, z: front to back).
    struct Placed {
        p: Part,
        region: (i32, i32),
        at: [f32; 3],
    }

    fn pl(p: Part, region: (i32, i32), x: f32, y: f32, z: f32) -> Placed {
        Placed { p, region, at: [x, y, z] }
    }

    /// Face texel (c, r) at sub-position (fu, fv) in [0,1) -> part-space point.
    fn face_point(p: &Part, f: Face, c: f32, r: f32) -> [f32; 3] {
        let (w, h, d) = (p.w as f32, p.h as f32, p.d as f32);
        match f {
            Face::Front => [c, r, 0.0],
            Face::Back => [w - c, r, d],
            Face::Right => [0.0, r, d - c],
            Face::Left => [w, r, c],
            Face::Top => [c, 0.0, d - r],
            Face::Bottom => [c, h, d - r],
        }
    }

    fn normal(f: Face) -> [f32; 3] {
        match f {
            Face::Front => [0.0, 0.0, -1.0],
            Face::Back => [0.0, 0.0, 1.0],
            Face::Right => [-1.0, 0.0, 0.0],
            Face::Left => [1.0, 0.0, 0.0],
            Face::Top => [0.0, -1.0, 0.0],
            Face::Bottom => [0.0, 1.0, 0.0],
        }
    }

    struct View {
        right: [f32; 3],
        down: [f32; 3],
        fwd: [f32; 3],
    }

    fn view(yaw: f32, pitch: f32) -> View {
        let (sy, cy) = yaw.to_radians().sin_cos();
        let (sp, cp) = pitch.to_radians().sin_cos();
        View {
            right: [cy, 0.0, -sy],
            down: [-sy * sp, cp, -cy * sp],
            fwd: [sy * cp, sp, cy * cp],
        }
    }

    fn dot(a: [f32; 3], b: [f32; 3]) -> f32 {
        a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
    }

    /// Renders the model into `img` at (x0, y0) inside a `wbox` x `hbox` cell; returns nothing.
    #[allow(clippy::too_many_arguments)]
    fn render(img: &mut Img, a: &[u8], e: &[u8], parts: &[Placed], v: &View, scale: f32, x0: i32, y0: i32, wbox: i32, hbox: i32, shade: bool, night: bool) {
        // bounds
        let (mut lo, mut hi) = ([f32::MAX; 2], [f32::MIN; 2]);
        for pp in parts {
            for k in 0..8 {
                let q = [
                    pp.at[0] + if k & 1 != 0 { pp.p.w as f32 } else { 0.0 },
                    pp.at[1] + if k & 2 != 0 { pp.p.h as f32 } else { 0.0 },
                    pp.at[2] + if k & 4 != 0 { pp.p.d as f32 } else { 0.0 },
                ];
                let (sx, sy) = (dot(q, v.right), dot(q, v.down));
                lo = [lo[0].min(sx), lo[1].min(sy)];
                hi = [hi[0].max(sx), hi[1].max(sy)];
            }
        }
        let offx = x0 as f32 + (wbox as f32 - (hi[0] - lo[0]) * scale) * 0.5 - lo[0] * scale;
        let offy = y0 as f32 + (hbox as f32 - (hi[1] - lo[1]) * scale) * 0.5 - lo[1] * scale;
        let mut zb = vec![f32::MAX; (wbox * hbox) as usize];
        let sub = (scale * 1.6).ceil() as i32;
        for pp in parts {
            for f in FACES {
                let nrm = normal(f);
                if dot(nrm, v.fwd) >= -1e-4 {
                    continue;
                }
                let lightk = if shade {
                    let l = [-0.45f32, -0.75, -0.5];
                    let ll = (dot(nrm, l) / (0.45f32 * 0.45 + 0.75 * 0.75 + 0.25).sqrt()).max(0.0);
                    0.55 + 0.5 * ll
                } else {
                    1.0
                };
                let (fx, fy, fw, fh) = pp.p.rect(f);
                for r in 0..fh {
                    for c in 0..fw {
                        let (ax, ay) = (pp.region.0 + fx + c, pp.region.1 + fy + r);
                        let Some(col) = texel(a, ax, ay) else { continue };
                        let g = e[(ay * AW + ax) as usize] as f32 / 255.0;
                        let col = if night {
                            let k = 0.22 + 1.0 * g;
                            [(col[0] as f32 * k).min(255.0) as u8, (col[1] as f32 * k).min(255.0) as u8, (col[2] as f32 * k).min(255.0) as u8]
                        } else {
                            let k = lightk.max(g);
                            [(col[0] as f32 * k).min(255.0) as u8, (col[1] as f32 * k).min(255.0) as u8, (col[2] as f32 * k).min(255.0) as u8]
                        };
                        for sv in 0..sub {
                            for su in 0..sub {
                                let q = face_point(&pp.p, f, c as f32 + (su as f32 + 0.5) / sub as f32, r as f32 + (sv as f32 + 0.5) / sub as f32);
                                let q = [q[0] + pp.at[0], q[1] + pp.at[1], q[2] + pp.at[2]];
                                let sx = (dot(q, v.right) * scale + offx).floor() as i32;
                                let sy = (dot(q, v.down) * scale + offy).floor() as i32;
                                if sx < x0 || sy < y0 || sx >= x0 + wbox || sy >= y0 + hbox {
                                    continue;
                                }
                                let zi = ((sy - y0) * wbox + (sx - x0)) as usize;
                                let depth = dot(q, v.fwd);
                                if depth < zb[zi] {
                                    zb[zi] = depth;
                                    img.set(sx, sy, col);
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    fn model_sheet(a: &[u8], e: &[u8], parts: &[Placed], scale: f32, cell: (i32, i32), name: &str) {
        // front, right side, back, left side, top | 3/4 front, 3/4 back, 3/4 night
        let views: [(f32, f32, bool, bool); 8] = [
            (0.0, 0.0, false, false),
            (90.0, 0.0, false, false),
            (180.0, 0.0, false, false),
            (270.0, 0.0, false, false),
            (0.0, 90.0, false, false),
            (35.0, 25.0, true, false),
            (215.0, 25.0, true, false),
            (325.0, 20.0, true, true),
        ];
        let (cw, ch) = cell;
        let cols = 4;
        let mut img = Img::new((cw * cols) as usize, (ch * 2) as usize, [150, 170, 190]);
        for (k, &(yaw, pitch, shade, night)) in views.iter().enumerate() {
            let (x0, y0) = ((k as i32 % cols) * cw, (k as i32 / cols) * ch);
            if night {
                for y in y0..y0 + ch {
                    for x in x0..x0 + cw {
                        img.set(x, y, [16, 18, 30]);
                    }
                }
            } else if k % 2 == 1 {
                for y in y0..y0 + ch {
                    for x in x0..x0 + cw {
                        img.set(x, y, [140, 160, 182]);
                    }
                }
            }
            render(&mut img, a, e, parts, &view(yaw, pitch), scale, x0, y0, cw, ch, shade, night);
        }
        img.save(name);
    }

    /// Large axis views (front, right, back, left) plus a 3/4 view, for detail checks.
    fn closeup(a: &[u8], e: &[u8], parts: &[Placed], scale: f32, cell: (i32, i32), views: &[(f32, f32, bool)], name: &str) {
        let (cw, ch) = cell;
        let mut img = Img::new((cw * views.len() as i32) as usize, ch as usize, [150, 170, 190]);
        for (k, &(yaw, pitch, shade)) in views.iter().enumerate() {
            let x0 = k as i32 * cw;
            if k % 2 == 1 {
                for y in 0..ch {
                    for x in x0..x0 + cw {
                        img.set(x, y, [140, 160, 182]);
                    }
                }
            }
            render(&mut img, a, e, parts, &view(yaw, pitch), scale, x0, 0, cw, ch, shade, false);
        }
        img.save(name);
    }

    fn items_zoom(a: &[u8], list: &[usize], name: &str) {
        let s = 16i32;
        let cw = 16 * s + 8;
        let mut img = Img::new((list.len() as i32 * cw) as usize, (16 * s) as usize, [40, 42, 48]);
        for (n, &k) in list.iter().enumerate() {
            for y in 0..16 {
                for x in 0..16 {
                    let t = texel(a, 16 * k as i32 + x, ITEM_Y + y);
                    for yy in 0..s {
                        for xx in 0..s {
                            let (px, py) = (n as i32 * cw + x * s + xx, y * s + yy);
                            img.set(px, py, t.unwrap_or_else(|| checker(px, py, 32)));
                        }
                    }
                }
            }
        }
        img.save(name);
    }

    fn humanoid(region: (i32, i32), head: Part, body: Part, arm: Part, leg: Part) -> Vec<Placed> {
        let bw = body.w as f32;
        let aw = arm.w as f32;
        let (hx, bx) = (aw + (bw - head.w as f32) * 0.5, aw);
        let hz = 0.0;
        let bz = (head.d - body.d) as f32 * 0.5;
        let az = bz + (body.d - arm.d) as f32 * 0.5;
        let lz = bz + (body.d - leg.d) as f32 * 0.5;
        let hy = head.h as f32;
        let lx0 = aw + bw * 0.5 - leg.w as f32;
        vec![
            pl(head, region, hx, 0.0, hz),
            pl(body, region, bx, hy, bz),
            pl(arm, region, 0.0, hy, az),
            pl(arm, region, aw + bw, hy, az),
            pl(leg, region, lx0, hy + body.h as f32, lz),
            pl(leg, region, lx0 + leg.w as f32, hy + body.h as f32, lz),
        ]
    }

    fn items_sheet(a: &[u8]) {
        let s = 8i32;
        let pad = 8;
        let cols = 7;
        let cw = 16 * s + pad;
        let mut img = Img::new((cols * cw + pad) as usize, (2 * cw + pad + 2 * (16 * 3 + pad)) as usize, [40, 42, 48]);
        for k in 0..ITEMS.len() as i32 {
            let (x0, y0) = (pad + (k % cols) * cw, pad + (k / cols) * cw);
            for y in 0..16 {
                for x in 0..16 {
                    let t = texel(a, 16 * k + x, ITEM_Y + y);
                    for yy in 0..s {
                        for xx in 0..s {
                            let (px, py) = (x0 + x * s + xx, y0 + y * s + yy);
                            img.set(px, py, t.unwrap_or_else(|| checker(px, py, 16)));
                        }
                    }
                }
            }
        }
        // small sizes on light and dark backgrounds
        for (row, bg) in [[200u8, 205, 210], [24, 26, 30]].iter().enumerate() {
            let y0 = pad + 2 * cw + row as i32 * (16 * 3 + pad);
            for k in 0..ITEMS.len() as i32 {
                let x0 = pad + k * (16 * 3 + 8);
                for y in 0..16 {
                    for x in 0..16 {
                        let t = texel(a, 16 * k + x, ITEM_Y + y);
                        for yy in 0..3 {
                            for xx in 0..3 {
                                img.set(x0 + x * 3 + xx, y0 + y * 3 + yy, t.unwrap_or(*bg));
                            }
                        }
                    }
                }
            }
        }
        img.save("items.png");
    }

    #[test]
    #[ignore]
    fn preview() {
        let (a, e) = generate();
        atlas_sheet(&a, &e);
        items_sheet(&a);
        let p = humanoid(PLAYER, HUMAN_HEAD, HUMAN_BODY, HUMAN_ARM, HUMAN_LEG);
        model_sheet(&a, &e, &p, 6.0, (240, 240), "model_player.png");
        let axis: [(f32, f32, bool); 5] = [(0.0, 0.0, false), (90.0, 0.0, false), (180.0, 0.0, false), (270.0, 0.0, false), (35.0, 25.0, true)];
        closeup(&a, &e, &p, 11.0, (200, 370), &axis, "close_player.png");
        // text dump of the item sprites: luma digit 0-9, '.' transparent, '*' glowing
        if std::env::var("DUMP_ITEMS").is_ok() {
            for (k, name) in ITEMS.iter().enumerate() {
                eprintln!("{name}");
                for y in 0..16 {
                    let mut line = String::new();
                    for x in 0..16 {
                        let (ax, ay) = (16 * k as i32 + x, ITEM_Y + y);
                        match texel(&a, ax, ay) {
                            None => line.push('.'),
                            Some(c) => {
                                let l = (c[0] as u32 * 3 + c[1] as u32 * 6 + c[2] as u32) / 10;
                                if e[(ay * AW + ax) as usize] > 0 {
                                    line.push('*');
                                } else {
                                    line.push(char::from(b'0' + (l * 10 / 256) as u8));
                                }
                            }
                        }
                    }
                    eprintln!("  {line}");
                }
            }
        }
        items_zoom(&a, &[0, 1, 2, 3, 4], "zoom_items_a.png");
        items_zoom(&a, &[5, 6, 7, 8], "zoom_items_b.png");
    }
}
