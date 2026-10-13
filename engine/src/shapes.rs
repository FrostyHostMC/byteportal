//! Block models: blocks that aren't full cubes (torches, slabs, stairs, beds, a game's fences,
//! panes, posts and boxes), as boxes on a 1/16 grid, Minecraft style.
//!
//! Each variant's model is built once from its `ModelKind`: written facing north, then turned
//! to its facing. Textures are mapped from world position (the part of the texture under each
//! face), so a half slab shows the lower half of its texture; a face that has to show its
//! texture a particular way round (a bed's pillow toward its head) says which way its image's
//! right and up point, and turning the model turns those with it (see `uv_transform`).
//!
//! A model gives:
//! - `parts`: the boxes drawn, a texture per face;
//! - `bounds`: the boxes you aim at (and rays and sight stop at);
//! - `collide`: the boxes bodies collide with, if the block is solid: its `bounds`, but for a
//!   fence, which is 1.5 blocks high to bodies (Minecraft's), so nobody jumps it;
//! - `cover`: which parts of each of the cell's six sides it fills with opaque faces, as a 4x4
//!   grid, so a neighbour's face against a filled side isn't drawn.
//!
//! Fences and panes join what's beside them (see `joined`): each has a model for every way its
//! four sides can be joined, picked where it stands from its neighbours, so a block placed or
//! broken beside one changes it without its id changing.

use crate::blocks::*;

/// A box face that isn't drawn.
pub const NO_TEX: u16 = u16::MAX;
/// Every cell of the 4x4 side grid: a full side.
pub const FULL_SIDE: u16 = 0xffff;

/// What a block joins (`Shapes::joins`): nothing, fences, panes.
pub const JOIN_FENCE: u8 = 1;
pub const JOIN_PANE: u8 = 2;
/// A joined model's index: a bit per side joined, in facing order (north, east, south, west).
/// East and west: a length of fence, as it's drawn in a hand and an icon.
pub const JOIN_EAST_WEST: usize = 0b1010;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct BoxFace {
    pub tex: u16,
    /// `UV_*` bits.
    pub uvt: u8,
}

#[derive(Clone, Copy, Debug)]
pub struct Cuboid {
    /// Corners in 1/16 of a block, 0..=16, cell-local.
    pub from: [u8; 3],
    pub to: [u8; 3],
    /// +X -X +Y -Y +Z -Z.
    pub faces: [BoxFace; 6],
}

pub struct Model {
    pub parts: Vec<Cuboid>,
    /// [x0, y0, z0, x1, y1, z1] in 1/16 of a block.
    pub bounds: Vec<[u8; 6]>,
    /// What bodies collide with (if the block is solid), in 1/16: `bounds`, or higher (a fence's
    /// reaches 24, into the cell above).
    pub collide: Vec<[u8; 6]>,
    /// Per side of the cell (+X -X +Y -Y +Z -Z), the 4x4 grid of it filled (see `side_mask`).
    pub cover: [u16; 6],
    /// Lit evenly by its own cell (small things: torches), rather than smoothly like a cube face.
    pub flat_light: bool,
}

pub struct Shapes {
    /// By block id; None for blocks that aren't models. A fence or pane's is it standing alone.
    pub models: Vec<Option<Model>>,
    /// By block id, per side (+X -X +Y -Y +Z -Z): the 4x4 grid of that side the block fills
    /// with an opaque face. Full cubes fill everything.
    pub cover: [[u16; 6]; 256],
    /// By block id: what it joins (`JOIN_*`, 0 for most).
    pub joins: [u8; 256],
    /// By block id, a bit per side (+X -X +Y -Y +Z -Z): a fence or pane beside that side joins it
    /// (solid full blocks; a model's sides it fills, like the back of stairs).
    pub anchor: [u8; 256],
    /// By block id, for fences and panes: a model per way it's joined (see `JOIN_EAST_WEST`).
    joined: Vec<Vec<Model>>,
    /// By block id: 1 when it's solid and its collision rises into the cell above (a fence).
    pub rises: [u8; 256],
    /// Some block's collision rises above its cell (a fence): bodies look a cell lower for it.
    pub tall: bool,
}

impl Shapes {
    /// A fence or pane's models, a model per way it's joined; None for other blocks.
    #[inline]
    pub fn joined(&self, b: u8) -> Option<&[Model]> {
        if self.joins[b as usize] == 0 {
            return None;
        }
        Some(&self.joined[b as usize])
    }

    /// Which of its sides a fence or pane `b` joins (bits in facing order), given the blocks beside
    /// it (north, east, south, west): the same kind of block, or a side something can join.
    #[inline]
    pub fn join_mask(&self, b: u8, around: [u8; 4]) -> usize {
        let kind = self.joins[b as usize];
        let mut mask = 0;
        for (d, n) in around.into_iter().enumerate() {
            // The neighbour's side facing back at this block.
            let back = OPPOSITE[FACING_FACE[d]];
            if self.joins[n as usize] == kind || (self.anchor[n as usize] >> back) & 1 == 1 {
                mask |= 1 << d;
            }
        }
        mask
    }

    /// The model block `b` has where it stands, `around` giving the blocks beside it (north,
    /// east, south, west) if it's a fence or a pane (asked only then). None for full blocks.
    #[inline]
    pub fn model_at(&self, b: u8, around: impl FnOnce() -> [u8; 4]) -> Option<&Model> {
        match self.joined(b) {
            Some(j) => Some(&j[self.join_mask(b, around())]),
            None => self.models[b as usize].as_ref(),
        }
    }
}

/// The shapes of the blocks in use (see `blocks::registry`).
#[inline(always)]
pub fn shapes() -> &'static Shapes {
    &registry().shapes
}

/// The face opposite each face.
pub const OPPOSITE: [usize; 6] = [1, 0, 3, 2, 5, 4];

const NORMALS: [[i32; 3]; 6] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
/// How the shaders map a face's texture from world position: the directions of increasing u
/// and of the image's up (see `vertex_unpack.glsl`).
const FACE_U: [[i32; 3]; 6] = [[0, 0, -1], [0, 0, 1], [1, 0, 0], [1, 0, 0], [1, 0, 0], [-1, 0, 0]];
const FACE_V: [[i32; 3]; 6] = [[0, 1, 0], [0, 1, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, 1, 0]];

fn neg(a: [i32; 3]) -> [i32; 3] {
    [-a[0], -a[1], -a[2]]
}

fn face_of(n: [i32; 3]) -> usize {
    NORMALS.iter().position(|&m| m == n).expect("axis-aligned normal")
}

/// The texture transform (`UV_*` bits) that shows a face's image with its right toward `u` and
/// its up toward `v`.
pub fn uv_transform(face: usize, u: [i32; 3], v: [i32; 3]) -> u8 {
    for t in 0..8u8 {
        let (a, b) = image_axes(face, t);
        if a == u && b == v {
            return t;
        }
    }
    panic!("image axes {u:?} {v:?} don't lie in face {face}");
}

/// Which way a face's image right and up point with the texture transform `t` (`UV_*` bits).
fn image_axes(face: usize, t: u8) -> ([i32; 3], [i32; 3]) {
    let (mut a, mut b) = if t & UV_SWAP != 0 { (FACE_V[face], FACE_U[face]) } else { (FACE_U[face], FACE_V[face]) };
    if t & UV_NEG_U != 0 {
        a = neg(a);
    }
    if t & UV_NEG_V != 0 {
        b = neg(b);
    }
    (a, b)
}

/// A face while a model is being built: its texture and which way its image faces.
#[derive(Clone, Copy)]
struct ProtoFace {
    tex: u16,
    u: [i32; 3],
    v: [i32; 3],
}

#[derive(Clone, Copy)]
struct Proto {
    from: [i32; 3],
    to: [i32; 3],
    faces: [ProtoFace; 6],
}

impl Proto {
    /// A box with every face showing `tex` the default way round.
    fn new(from: [i32; 3], to: [i32; 3], tex: u16) -> Proto {
        let faces = std::array::from_fn(|f| ProtoFace { tex, u: FACE_U[f], v: FACE_V[f] });
        Proto { from, to, faces }
    }

    fn face(mut self, f: usize, tex: u16) -> Proto {
        self.faces[f].tex = tex;
        self
    }

    /// Show face `f`'s image with its right toward `u` and its up toward `v`.
    fn orient(mut self, f: usize, u: [i32; 3], v: [i32; 3]) -> Proto {
        self.faces[f].u = u;
        self.faces[f].v = v;
        self
    }

    /// Move a box's corners by `p` and its faces' directions by `d` (a quarter turn about the
    /// cell's centre).
    fn moved(self, p: impl Fn([i32; 3]) -> [i32; 3], d: impl Fn([i32; 3]) -> [i32; 3]) -> Proto {
        let (a, b) = (p(self.from), p(self.to));
        let from = [a[0].min(b[0]), a[1].min(b[1]), a[2].min(b[2])];
        let to = [a[0].max(b[0]), a[1].max(b[1]), a[2].max(b[2])];
        let mut faces = self.faces;
        for f in 0..6 {
            let g = face_of(d(NORMALS[f]));
            faces[g] = ProtoFace { tex: self.faces[f].tex, u: d(self.faces[f].u), v: d(self.faces[f].v) };
        }
        Proto { from, to, faces }
    }

    /// A quarter turn clockwise seen from above (north to east), about the cell's centre.
    fn turn(self) -> Proto {
        self.moved(|a| [16 - a[2], a[1], a[0]], |a| [-a[2], a[1], a[0]])
    }

    fn turned(mut self, quarters: u8) -> Proto {
        for _ in 0..quarters {
            self = self.turn();
        }
        self
    }

    /// A quarter turn about the east-west axis through the cell's centre: `up` brings the north
    /// face to the top (and the top to the south), else to the bottom.
    fn tilt(self, up: bool) -> Proto {
        if up {
            self.moved(|a| [a[0], 16 - a[2], a[1]], |a| [a[0], -a[2], a[1]])
        } else {
            self.moved(|a| [a[0], a[2], 16 - a[1]], |a| [a[0], a[2], -a[1]])
        }
    }

    /// Turned from the way it's written (facing north, or upright) by `o`: tipped, then turned.
    fn oriented(self, o: Orient) -> Proto {
        let p = match o.tilt {
            1 => self.tilt(true),
            -1 => self.tilt(false),
            _ => self,
        };
        p.turned(o.turn)
    }

    fn cuboid(&self) -> Cuboid {
        let c = |a: [i32; 3]| [a[0] as u8, a[1] as u8, a[2] as u8];
        let faces = std::array::from_fn(|f| {
            let pf = self.faces[f];
            BoxFace { tex: pf.tex, uvt: if pf.tex == NO_TEX { 0 } else { uv_transform(f, pf.u, pf.v) } }
        });
        Cuboid { from: c(self.from), to: c(self.to), faces }
    }
}

fn bound(p: &Proto) -> [u8; 6] {
    [p.from[0] as u8, p.from[1] as u8, p.from[2] as u8, p.to[0] as u8, p.to[1] as u8, p.to[2] as u8]
}

/// A box given as corners (1/16), turned to `facing`.
fn turned_box(from: [i32; 3], to: [i32; 3], facing: u8) -> [u8; 6] {
    bound(&Proto::new(from, to, 0).turned(facing))
}

/// Give each face of a material model (slab, stairs) the block's texture for that direction.
fn material(mut p: Proto, b: &Block) -> Proto {
    for f in 0..6 {
        p.faces[f] = ProtoFace { tex: b.tex[f], u: FACE_U[f], v: FACE_V[f] };
    }
    p
}

/// A cube's textures and their transforms (+X -X +Y -Y +Z -Z) with the cube turned by `o`:
/// what faced north faces the way it's turned, its image the same way round.
pub fn turn_cube(tex: [u16; 6], uvt: [u8; 6], o: Orient) -> ([u16; 6], [u8; 6]) {
    let mut p = Proto::new([0; 3], [16; 3], 0);
    for f in 0..6 {
        let (u, v) = image_axes(f, uvt[f]);
        p.faces[f] = ProtoFace { tex: tex[f], u, v };
    }
    let c = p.oriented(o).cuboid();
    (std::array::from_fn(|f| c.faces[f].tex), std::array::from_fn(|f| c.faces[f].uvt))
}

/// A fence joined on the sides in `mask` (facing order): a post 4/16 across with two rails to
/// each joined side, Minecraft's. Bodies collide with the post and a bar along each rail, all 1.5
/// high.
fn fence(b: &Block, mask: usize) -> (Vec<Proto>, Vec<[u8; 6]>, Vec<[u8; 6]>) {
    let mut parts = vec![material(Proto::new([6, 0, 6], [10, 16, 10], 0), b)];
    let mut collide = vec![[6, 0, 6, 10, 24, 10]];
    for d in (0..4u8).filter(|d| mask >> *d & 1 == 1) {
        for (y0, y1) in [(6, 9), (12, 15)] {
            // Written running north from the post; its end against the post isn't drawn.
            let rail = Proto::new([7, y0, 0], [9, y1, 6], 0).turned(d);
            parts.push(material(rail, b).face(FACING_FACE[((d + 2) % 4) as usize], NO_TEX));
        }
        collide.push(turned_box([6, 0, 0], [10, 24, 6], d));
    }
    let bounds = parts.iter().map(bound).collect();
    (parts, bounds, collide)
}

/// A pane joined on the sides in `mask`: a thin wall 2/16 thick, from a post in the middle to each
/// joined side (a post alone when nothing is). Faces inside it aren't drawn.
fn pane(b: &Block, mask: usize) -> (Vec<Proto>, Vec<[u8; 6]>, Vec<[u8; 6]>) {
    let mut post = material(Proto::new([7, 0, 7], [9, 16, 9], 0), b);
    let mut parts = Vec::new();
    for d in (0..4u8).filter(|d| mask >> *d & 1 == 1) {
        let arm = Proto::new([7, 0, 0], [9, 16, 7], 0).turned(d);
        parts.push(material(arm, b).face(FACING_FACE[((d + 2) % 4) as usize], NO_TEX));
        post = post.face(FACING_FACE[d as usize], NO_TEX);
    }
    parts.insert(0, post);
    let bounds: Vec<[u8; 6]> = parts.iter().map(bound).collect();
    (parts, bounds.clone(), bounds)
}

fn model_of(b: &Block) -> Option<Model> {
    model_joined(b, 0)
}

/// A model as it's made: the boxes drawn, aimed at, collided with (if not those), lit flat.
type Made = (Vec<Proto>, Vec<[u8; 6]>, Option<Vec<[u8; 6]>>, bool);

/// Block `b`'s model, joined on the sides in `mask` if it's a fence or a pane.
fn model_joined(b: &Block, mask: usize) -> Option<Model> {
    let (parts, bounds, collide, flat_light): Made = match b.model {
        ModelKind::None => return None,
        ModelKind::Torch => {
            let stick = Proto::new([7, 0, 7], [9, 10, 9], b.tex[0]).face(3, b.tex[3]);
            (vec![stick], vec![[6, 0, 6, 10, 10, 10]], None, true)
        }
        ModelKind::WallTorch(facing) => {
            // Upright against the wall behind it (south, facing north). The wall torch texture
            // has the stick at every column pair these faces show (see `texgen::wall_torch`).
            let stick = Proto::new([7, 3, 14], [9, 13, 16], b.tex[0]).face(3, b.tex[3]).turned(facing);
            (vec![stick], vec![turned_box([5, 3, 11], [11, 13, 16], facing)], None, true)
        }
        ModelKind::Slab(top) => {
            let (y0, y1) = if top { (8, 16) } else { (0, 8) };
            let p = material(Proto::new([0, y0, 0], [16, y1, 16], 0), b);
            let bx = bound(&p);
            (vec![p], vec![bx], None, false)
        }
        ModelKind::Stairs(facing, top) => {
            // A half slab, and a step on its north half the other side of it.
            let (slab, step) = if top { ((8, 16), (0, 8)) } else { ((0, 8), (8, 16)) };
            let a = Proto::new([0, slab.0, 0], [16, slab.1, 16], 0).turned(facing);
            let s = Proto::new([0, step.0, 0], [16, step.1, 8], 0).turned(facing);
            let (a, s) = (material(a, b), material(s, b));
            let bounds = vec![bound(&a), bound(&s)];
            (vec![a, s], bounds, None, false)
        }
        ModelKind::Bed(facing, head) => {
            // Facing north: the head half is the northern one. A mattress 3..9 high on four legs.
            let [top, side, end, under, legs, _] = b.tex;
            let toward_head = [0, 0, -1];
            let up = [0, 1, 0];
            let (outer_end, inner_end) = if head { (5, 4) } else { (4, 5) };
            let mattress = Proto::new([0, 3, 0], [16, 9, 16], side)
                .face(2, top)
                .orient(2, [1, 0, 0], toward_head)
                .face(3, under)
                .face(outer_end, end)
                .face(inner_end, NO_TEX)
                .orient(0, toward_head, up)
                .orient(1, toward_head, up);
            let (z0, z1) = if head { (0, 3) } else { (13, 16) };
            let leg = |x0: i32| Proto::new([x0, 0, z0], [x0 + 3, 3, z1], legs).face(2, NO_TEX);
            let parts: Vec<Proto> = [mattress, leg(0), leg(13)].into_iter().map(|p| p.turned(facing)).collect();
            (parts, vec![[0, 0, 0, 16, 9, 16]], None, false)
        }
        ModelKind::Fence => {
            let (parts, bounds, collide) = fence(b, mask);
            (parts, bounds, Some(collide), false)
        }
        ModelKind::Pane => {
            let (parts, bounds, collide) = pane(b, mask);
            (parts, bounds, Some(collide), false)
        }
        // Textures go round with the model (its front where it faces).
        ModelKind::Post(o) => {
            let p = material(Proto::new([6, 0, 6], [10, 16, 10], 0), b).oriented(o);
            (vec![p], vec![bound(&p)], None, false)
        }
        ModelKind::Boxes(list, o) => {
            let parts: Vec<Proto> = list.iter().map(|c| material(Proto::new([c[0], c[1], c[2]].map(i32::from), [c[3], c[4], c[5]].map(i32::from), 0), b).oriented(o)).collect();
            let bounds = parts.iter().map(bound).collect();
            (parts, bounds, None, false)
        }
    };
    let parts: Vec<Cuboid> = parts.iter().map(|p| p.cuboid()).collect();
    let mut cover = [0u16; 6];
    if b.layer == Layer::Opaque {
        for p in &parts {
            for f in 0..6 {
                if p.faces[f].tex != NO_TEX && on_side(p, f) {
                    cover[f] |= side_mask(p, f, true);
                }
            }
        }
    }
    let collide = collide.unwrap_or_else(|| bounds.clone());
    Some(Model { parts, bounds, collide, cover, flat_light })
}

/// Whether face `f` of a box lies on the cell's side `f`.
#[inline]
pub fn on_side(p: &Cuboid, f: usize) -> bool {
    match f {
        0 => p.to[0] == 16,
        1 => p.from[0] == 0,
        2 => p.to[1] == 16,
        3 => p.from[1] == 0,
        4 => p.to[2] == 16,
        _ => p.from[2] == 0,
    }
}

/// The cells of the 4x4 grid over a cell side (4/16 of a block each) that face `f` of a box
/// covers. `inner`: only cells it covers entirely (what it fills); otherwise every cell it
/// touches (what it needs filled to be hidden). The grid's axes are the side's (a, b): x/z on
/// ±X... see `side_axes`.
pub fn side_mask(p: &Cuboid, f: usize, inner: bool) -> u16 {
    let (a, b) = side_axes(f);
    let span = |lo: u8, hi: u8| -> (u32, u32) {
        if inner {
            ((lo as u32).div_ceil(4), hi as u32 / 4)
        } else {
            (lo as u32 / 4, (hi as u32).div_ceil(4))
        }
    };
    let (a0, a1) = span(p.from[a], p.to[a]);
    let (b0, b1) = span(p.from[b], p.to[b]);
    let mut m = 0u16;
    for j in b0..b1 {
        for i in a0..a1 {
            m |= 1 << (j * 4 + i);
        }
    }
    m
}

/// The two axes along a side of face `f`, in grid order (a, then b).
#[inline]
pub fn side_axes(f: usize) -> (usize, usize) {
    match f {
        0 | 1 => (2, 1),
        2 | 3 => (0, 2),
        _ => (0, 1),
    }
}

/// The shapes of every id's block (`blocks` has all 256; ids from `count` on are unknown, and
/// fill their cell like stone).
pub(crate) fn build(blocks: &[Block], count: usize) -> Shapes {
    let mut models = Vec::with_capacity(256);
    let mut cover = [[0u16; 6]; 256];
    let mut joins = [0u8; 256];
    let mut anchor = [0u8; 256];
    let mut joined = Vec::with_capacity(256);
    let mut rises = [0u8; 256];
    for id in 0..256usize {
        let b = &blocks[id];
        let m = if id < count { model_of(b) } else { None };
        cover[id] = match &m {
            Some(m) => m.cover,
            None if id >= count || b.opaque => [FULL_SIDE; 6],
            None => [0; 6],
        };
        // Fences and panes join solid full blocks (not leaves), and a model's full sides.
        anchor[id] = match &m {
            _ if !b.solid && id < count => 0,
            Some(m) => (0..6).fold(0, |a, f| a | (((m.cover[f] == FULL_SIDE) as u8) << f)),
            None if id >= count || (b.shape == Shape::Cube && !b.leaves) => 0x3f,
            None => 0,
        };
        let kind = if id >= count {
            0
        } else {
            match b.model {
                ModelKind::Fence => JOIN_FENCE,
                ModelKind::Pane => JOIN_PANE,
                _ => 0,
            }
        };
        joins[id] = kind;
        joined.push(if kind == 0 { Vec::new() } else { (0..16).filter_map(|mask| model_joined(b, mask)).collect() });
        rises[id] = (b.solid && m.as_ref().is_some_and(|m| m.collide.iter().any(|c| c[4] > 16))) as u8;
        models.push(m);
    }
    let tall = rises.contains(&1);
    Shapes { models, cover, joins, anchor, joined, rises, tall }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::world::{point_solid, MoveInput, Player, World, CLIMB_DOWN, CLIMB_UP};

    /// A game's blocks of every new shape: a fence, a pane, a post upright and lying along x, a
    /// ladder facing north and east, a cube turned east (its front, a bookshelf, on +X), a vine
    /// and a table.
    pub(crate) const GAME: &str = r#"[
        {"name":"rail","shape":"fence","tex":[5,5,5,5,5,5]},
        {"name":"window","shape":"pane","layer":1,"tex":[12,12,12,12,12,12]},
        {"name":"beam","state":"axis=y","shape":"post","tex":[9,9,10,10,9,9]},
        {"name":"beam","state":"axis=x","shape":"post","tilt":1,"turn":1,"placeable":false,"tex":[9,9,10,10,9,9]},
        {"name":"ladder","state":"facing=north","shape":"boxes","boxes":[[0,0,13,16,16,16]],"layer":1,"climbable":true,"tex":[5,5,5,5,5,5]},
        {"name":"ladder","state":"facing=east","shape":"boxes","boxes":[[0,0,13,16,16,16]],"turn":1,"layer":1,"climbable":true,"placeable":false,"tex":[5,5,5,5,5,5]},
        {"name":"stove","state":"facing=east","turn":1,"tex":[4,4,0,0,4,46]},
        {"name":"vine","shape":"cross","climbable":true,"tex":[11,11,11,11,11,11]},
        {"name":"table","shape":"boxes","boxes":[[0,13,0,16,16,16],[1,0,1,3,13,3],[13,0,1,15,13,3],[1,0,13,3,13,15],[13,0,13,15,13,15]],"tex":[5,5,5,5,5,5]}
    ]"#;
    pub(crate) const FENCE: u8 = GAME_FIRST as u8;
    const PANE: u8 = FENCE + 1;
    const BEAM: u8 = FENCE + 2;
    const BEAM_X: u8 = FENCE + 3;
    const LADDER: u8 = FENCE + 4;
    const LADDER_E: u8 = FENCE + 5;
    const STOVE: u8 = FENCE + 6;
    const VINE: u8 = FENCE + 7;
    const TABLE: u8 = FENCE + 8;

    #[test]
    fn transforms_cover_every_orientation() {
        // Default axes need no transform; a bed's top shows its head end at the image's top.
        for f in 0..6 {
            assert_eq!(uv_transform(f, FACE_U[f], FACE_V[f]), 0);
        }
        assert_eq!(uv_transform(2, [1, 0, 0], [0, 0, -1]), UV_NEG_V);
    }

    #[test]
    fn slabs_and_stairs_fill_their_sides() {
        let s = shapes();
        let bottom = &s.models[slab_id(0, false) as usize].as_ref().unwrap();
        assert_eq!(bottom.cover[3], FULL_SIDE, "underside full");
        assert_eq!(bottom.cover[2], 0, "top open");
        assert_eq!(bottom.cover[0], 0x00ff, "lower half of each side");
        let stairs = &s.models[stairs_id(0, NORTH_F, false) as usize].as_ref().unwrap();
        assert_eq!(stairs.cover[5], FULL_SIDE, "the back (north) is full");
        assert_eq!(stairs.cover[4], 0x00ff, "the front (south) only low");
        // East-facing stairs have their back to the east.
        let east = &s.models[stairs_id(0, 1, false) as usize].as_ref().unwrap();
        assert_eq!(east.cover[0], FULL_SIDE);
        assert_eq!(s.cover[STONE as usize], [FULL_SIDE; 6]);
        assert_eq!(s.cover[GLASS_B as usize], [0; 6]);
        assert_eq!(s.cover[TORCH_B as usize], [0; 6]);
    }

    #[test]
    fn turned_models_keep_their_textures_the_same_way_round() {
        let s = shapes();
        // The wall torch's top shows the same part of its texture whichever way it faces.
        let tops: Vec<(u8, [u8; 3])> = (0..4)
            .map(|f| {
                let m = s.models[(WALL_TORCH_B + f) as usize].as_ref().unwrap();
                (m.parts[0].faces[2].uvt, m.parts[0].from)
            })
            .collect();
        assert_eq!(tops[0], (0, [7, 3, 14]));
        assert_eq!(tops[1].1, [0, 3, 7], "east: against the wall to the west");
        // Beds: head half facing east has its pillow end on +X.
        let head = s.models[bed_id(0, 1, true) as usize].as_ref().unwrap();
        let end = BLOCKS[bed_id(0, 1, true) as usize].tex[2];
        assert_eq!(head.parts[0].faces[0].tex, end);
        assert_eq!(head.parts[0].faces[1].tex, NO_TEX, "the side against the foot isn't drawn");
    }

    const NORTH_F: u8 = 0;

    /// FNV-1a, a word at a time.
    fn fnv(h: &mut u64, w: u64) {
        for b in w.to_le_bytes() {
            *h = (*h ^ b as u64).wrapping_mul(0x100_0000_01b3);
        }
    }

    /// Generated hills (seed 99) with a crafted layer of every kind of built-in block beside every
    /// other (as the mesher's zoo), for fingerprinting what bodies and rays do among them.
    fn zoo() -> crate::world::World {
        let mut g = crate::gen::Generator::new(99);
        let mut w = crate::world::World::new();
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
        w
    }

    /// The built-in blocks' tables and models (what the mesher, light and physics read), as they
    /// were before game blocks could have shapes of their own.
    #[test]
    fn built_in_tables_are_unchanged() {
        let reg = crate::blocks::registry();
        let mut h = 0xcbf2_9ce4_8422_2325u64;
        for id in 0..256 {
            for t in [&reg.opaque, &reg.opacity, &reg.emit, &reg.solid, &reg.layer, &reg.shape, &reg.lit_inside] {
                fnv(&mut h, t[id] as u64);
            }
            for c in reg.shapes.cover[id] {
                fnv(&mut h, c as u64);
            }
            let b = &reg.blocks[id];
            for f in 0..6 {
                fnv(&mut h, b.tex[f] as u64 | (b.uvt[f] as u64) << 16);
            }
            if let Some(m) = &reg.shapes.models[id] {
                for p in &m.parts {
                    for k in 0..3 {
                        fnv(&mut h, p.from[k] as u64 | (p.to[k] as u64) << 8);
                    }
                    for f in p.faces {
                        fnv(&mut h, f.tex as u64 | (f.uvt as u64) << 16);
                    }
                }
                for bx in &m.bounds {
                    for v in bx {
                        fnv(&mut h, *v as u64);
                    }
                }
                fnv(&mut h, m.flat_light as u64);
            }
        }
        assert_eq!(h, 0x181ea19e98622433, "built-in block tables changed");
    }

    /// What bodies walking, jumping and falling over the built-in blocks do, and rays through
    /// them, as a fingerprint.
    fn physics_print() -> u64 {
        use crate::world::{walk_axis, MoveInput, Player};
        let w = zoo();
        let mut h = 0xcbf2_9ce4_8422_2325u64;
        for k in 0..24 {
            let (x, z) = (0.5 + (k * 5 % 16) as f64 + 0.13 * k as f64 % 1.0, 0.5 + (k * 3 % 16) as f64);
            let mut p = Player::new(x, 156.0, z);
            for step in 0..400 {
                let a = (k as f64 * 0.7 + step as f64 * 0.01).sin();
                let input = MoveInput { wish_x: a, wish_z: (1.0 - a * a).sqrt() * if k % 2 == 0 { 1.0 } else { -1.0 }, jump: step % 50 < 5, sneak: k % 5 == 0, sprint: k % 3 == 0, slide: false, speed: 1.0 };
                p.step(&w, &input, 1.0 / 60.0);
                for v in p.pos.iter().chain(&p.vel) {
                    fnv(&mut h, v.to_bits());
                }
                fnv(&mut h, (p.on_ground as u64) | (p.in_water as u64) << 1);
            }
        }
        // Creatures' boxes (smaller and larger) stepping along.
        for k in 0..16 {
            let mut pos = [1.0 + k as f64 * 0.9, 154.0, 8.0];
            for _ in 0..200 {
                walk_axis(&w, &mut pos, if k % 2 == 0 { 0 } else { 2 }, 0.05, 0.2 + k as f64 * 0.05, 0.6 + k as f64 * 0.1, true);
                crate::world::move_axis(&w, &mut pos, 1, -0.05, 0.3, 1.0, 0);
                for v in pos {
                    fnv(&mut h, v.to_bits());
                }
            }
        }
        for k in 0..4000 {
            let t = k as f64 * 0.37;
            let o = [8.0 + 9.0 * t.sin(), 152.0 + 4.0 * (t * 0.3).cos(), 8.0 + 9.0 * (t * 1.3).cos()];
            let d = [(t * 2.1).cos(), (t * 0.9).sin() - 0.3, (t * 1.7).sin()];
            match w.raycast(o, d, 12.0) {
                Some((p, n, b, t)) => {
                    for v in p.iter().chain(&n) {
                        fnv(&mut h, *v as u64);
                    }
                    fnv(&mut h, b as u64);
                    fnv(&mut h, t.to_bits());
                }
                None => fnv(&mut h, 1),
            }
            fnv(&mut h, w.raycast_solid(o, d, 12.0).map_or(7, f64::to_bits));
        }
        h
    }

    /// The fingerprint as it was before game blocks could have shapes of their own.
    const PHYSICS_PRINT: u64 = 0x4e8d53d99c21d40e;

    /// Bodies and rays among the built-in blocks behave as they did to the last bit, with or
    /// without a game's fences (whose collision reaches into the cell above) in use.
    #[test]
    fn built_in_physics_and_rays_are_unchanged() {
        assert_eq!(physics_print(), PHYSICS_PRINT, "built-in physics or rays changed");
        set_game_blocks(GAME).unwrap();
        assert!(shapes().tall);
        assert_eq!(physics_print(), PHYSICS_PRINT, "a game's fences changed physics among built-in blocks");
    }

    /// A 3 x 3 of columns, stone at y = 0 and air above.
    fn floor() -> World {
        let mut w = World::new();
        for cz in -1..=1 {
            for cx in -1..=1 {
                let mut data = vec![0u8; crate::gen::HEADER_BYTES + 4096];
                data[0] = 1;
                data[crate::gen::HEADER_BYTES..crate::gen::HEADER_BYTES + 256].fill(STONE);
                w.insert_column(cx, cz, &data);
            }
        }
        w
    }

    fn input(wish_x: f64, wish_z: f64, jump: bool, sneak: bool) -> MoveInput {
        MoveInput { wish_x, wish_z, jump, sneak, sprint: false, slide: false, speed: 1.0 }
    }

    #[test]
    fn game_shapes_are_built() {
        set_game_blocks(GAME).unwrap();
        let s = shapes();
        let model = |b: u8| s.models[b as usize].as_ref().unwrap();
        // A fence alone: its post, 1.5 high to bodies; it lets light through.
        assert_eq!((model(FENCE).bounds.clone(), model(FENCE).collide.clone()), (vec![[6, 0, 6, 10, 16, 10]], vec![[6, 0, 6, 10, 24, 10]]));
        assert_eq!((SOLID[FENCE as usize], OPACITY[FENCE as usize], OPAQUE[FENCE as usize]), (1, 0, 0));
        // It joins glass (north) and the full back of stairs (south), not a pane or a slab's side.
        let around = [GLASS_B, PANE, stairs_id(0, NORTH_F, false), slab_id(0, false)];
        assert_eq!(s.join_mask(FENCE, around), 0b0101);
        assert_eq!(s.join_mask(FENCE, [FENCE, STONE, OAK_LEAVES_B, AIR]), 0b0011, "fences and stone, not leaves");
        let joined = s.model_at(FENCE, || [AIR, FENCE, AIR, FENCE]).unwrap();
        assert_eq!((joined.parts.len(), joined.collide.len()), (5, 3), "a post and two rails each way");
        assert_eq!(joined.parts[1].faces[1].tex, NO_TEX, "a rail's end against the post isn't drawn");
        // Panes join panes and glass; alone, a post 2/16 across.
        assert_eq!(s.join_mask(PANE, [PANE, GLASS_B, FENCE, AIR]), 0b0011);
        assert_eq!(model(PANE).bounds, vec![[7, 0, 7, 9, 16, 9]]);
        let wall = s.model_at(PANE, || [PANE, AIR, PANE, AIR]).unwrap();
        assert_eq!(wall.bounds, vec![[7, 0, 7, 9, 16, 9], [7, 0, 0, 9, 16, 7], [7, 0, 9, 9, 16, 16]]);
        assert_eq!((wall.parts[0].faces[4].tex, wall.parts[0].faces[5].tex), (NO_TEX, NO_TEX), "the post's faces inside the wall");
        // A post lying along x: its ends (the log's top) at either end.
        assert_eq!(model(BEAM).bounds, vec![[6, 0, 6, 10, 16, 10]]);
        let beam = model(BEAM_X);
        assert_eq!(beam.bounds, vec![[0, 6, 6, 16, 10, 10]]);
        assert_eq!([0, 1, 2].map(|f| beam.parts[0].faces[f].tex), [10, 10, 9]);
        // A ladder turned east hangs on the wall to its west; bodies climb it.
        assert_eq!(model(LADDER).bounds, vec![[0, 0, 13, 16, 16, 16]]);
        assert_eq!(model(LADDER_E).bounds, vec![[0, 0, 0, 3, 16, 16]]);
        assert_eq!((CLIMBABLE[LADDER as usize], CLIMBABLE[VINE as usize], CLIMBABLE[TABLE as usize], CLIMBABLE[STONE as usize]), (1, 1, 0, 0));
        // A cube turned east shows its front on the east face and its back on the west.
        let stove = block(STOVE);
        assert_eq!((stove.shape, stove.tex[0], stove.tex[1], stove.tex[2]), (Shape::Cube, 46, 4, 0));
        assert_eq!(OPAQUE[STOVE as usize], 1);
        assert_eq!(model(TABLE).parts.len(), 5);
        assert!(!s.tall || model(FENCE).collide[0][4] == 24);
        // Built-in blocks don't join or climb.
        assert_eq!((s.joins[STONE as usize], s.joins[GLASS_B as usize]), (0, 0));

        // The UI's description: a fence drawn joined east and west, its taller collision, a ladder climbable.
        let parsed = crate::json::parse(&registry_json()).unwrap();
        let listed = parsed.get("blocks").and_then(crate::json::Json::as_arr).unwrap();
        let fence = &listed[FENCE as usize];
        assert_eq!(fence.get("model").and_then(crate::json::Json::as_str), Some("fence"));
        assert_eq!(fence.get("parts").and_then(crate::json::Json::as_arr).map(|p| p.len()), Some(5));
        assert_eq!(fence.get("collide").and_then(crate::json::Json::as_arr).map(|p| p.len()), Some(1));
        assert_eq!(listed[LADDER as usize].get("climbable").and_then(crate::json::Json::as_bool), Some(true));
        assert!(listed[STONE as usize].get("climbable").is_none());
    }

    #[test]
    fn wrong_shapes_are_refused() {
        for bad in [
            r#"[{"name":"a","shape":"boxes","tex":[1,1,1,1,1,1]}]"#,
            r#"[{"name":"a","shape":"boxes","boxes":[],"tex":[1,1,1,1,1,1]}]"#,
            r#"[{"name":"a","shape":"boxes","boxes":[[0,0,0,16,17,16]],"tex":[1,1,1,1,1,1]}]"#,
            r#"[{"name":"a","shape":"boxes","boxes":[[4,0,0,4,16,16]],"tex":[1,1,1,1,1,1]}]"#,
            r#"[{"name":"a","shape":"boxes","boxes":[[0,0,0,16,16]],"tex":[1,1,1,1,1,1]}]"#,
            r#"[{"name":"a","shape":"boxes","boxes":[[0,0,0,1.5,16,16]],"tex":[1,1,1,1,1,1]}]"#,
        ] {
            assert!(set_game_blocks(bad).is_err(), "{bad} should be refused");
        }
        let many = format!(r#"[{{"name":"a","shape":"boxes","boxes":[{}],"tex":[1,1,1,1,1,1]}}]"#, vec!["[0,0,0,1,1,1]"; MAX_BOXES + 1].join(","));
        assert!(set_game_blocks(&many).is_err());
    }

    #[test]
    fn fences_join_stop_bodies_and_let_rays_between_their_rails() {
        set_game_blocks(GAME).unwrap();
        let mut w = floor();
        // A fence along x at z = 4, from x = 2 to 6, into a stone block at x = 7.
        for x in 2..=6 {
            w.set(x, 1, 4, FENCE);
        }
        w.set(7, 1, 4, STONE);
        let parts = |w: &World, x: i32| w.target_at(x, 1, 4, FENCE).len();
        assert_eq!((parts(&w, 2), parts(&w, 4), parts(&w, 6)), (3, 5, 5), "the end one joins east only; the last joins the stone");
        assert_eq!(w.collision_at(4, 1, 4, AIR).iter().map(|b| b[4]).max(), Some(24));
        // Nobody jumps it: pushing into it and jumping, they stay on their side.
        let mut p = Player::new(4.5, 1.0, 2.5);
        let mut highest: f64 = 0.0;
        for _ in 0..240 {
            p.step(&w, &input(0.0, 1.0, true, false), 1.0 / 60.0);
            highest = highest.max(p.pos[1]);
        }
        assert!(p.pos[2] + 0.3 <= 4.0 + 6.0 / 16.0 + 1e-9 && highest > 2.0, "jumped to {highest} and got to z {}", p.pos[2]);
        // Dropped on it, they stand on its collision, 1.5 up.
        let mut q = Player::new(4.5, 4.0, 4.5);
        for _ in 0..120 {
            q.step(&w, &input(0.0, 0.0, false, false), 1.0 / 60.0);
        }
        assert!((q.pos[1] - 2.5).abs() < 1e-6 && q.on_ground, "stands at {}", q.pos[1]);
        assert!(point_solid(&w, [4.5, 2.2, 4.5]), "the collision above the post");
        // Aimed at: the lower rail is hit, the gap between the rails isn't (nor the collision above).
        let rail = w.raycast([3.2, 1.0 + 7.5 / 16.0, 2.0], [0.0, 0.0, 1.0], 6.0).expect("the lower rail");
        assert_eq!((rail.0, rail.1, rail.2), ([3, 1, 4], [0, 0, -1], FENCE));
        assert!((rail.3 - (2.0 + 7.0 / 16.0)).abs() < 1e-9);
        assert!(w.raycast([3.2, 1.0 + 10.5 / 16.0, 2.0], [0.0, 0.0, 1.0], 6.0).is_none(), "between the rails");
        assert!(w.raycast_solid([3.2, 1.0 + 10.5 / 16.0, 2.0], [0.0, 0.0, 1.0], 6.0).is_none(), "sight between the rails");
        assert!(w.raycast_solid([4.5, 2.2, 2.0], [0.0, 0.0, 1.0], 6.0).is_none(), "sight over it");
        // Creatures' pathfinding sees the cell over it as closed too.
        let mut cells = [0u8; 3];
        w.solid_box(4, 1, 4, 1, 3, 1, &mut cells);
        assert_eq!(cells, [1, 1, 0]);
        // Break the stone: the last one stands free on that side.
        w.set(7, 1, 4, AIR);
        assert_eq!(parts(&w, 6), 3);
    }

    #[test]
    fn panes_are_thin_walls() {
        set_game_blocks(GAME).unwrap();
        let mut w = floor();
        for x in 2..=6 {
            w.set(x, 1, 4, PANE);
            w.set(x, 2, 4, PANE);
        }
        let mut p = Player::new(4.5, 1.0, 2.5);
        for _ in 0..120 {
            p.step(&w, &input(0.0, 1.0, false, false), 1.0 / 60.0);
        }
        assert!((p.pos[2] - (4.0 + 7.0 / 16.0 - 0.3)).abs() < 1e-3, "stopped by the pane at {}", p.pos[2]);
        // Sideways along it, then round its end.
        let hit = w.raycast([4.5, 1.5, 2.0], [0.0, 0.0, 1.0], 6.0).unwrap();
        assert_eq!((hit.0, hit.2), ([4, 1, 4], PANE));
        assert!(w.raycast([4.5, 1.5, 4.5], [1.0, 0.0, 0.0], 1.0).is_some(), "inside the wall, along it");
    }

    #[test]
    fn ladders_climb_hold_and_let_down_slowly() {
        set_game_blocks(GAME).unwrap();
        let mut w = floor();
        // A wall along x at z = 5, five high, with a ladder up its north face at x = 8.
        for y in 1..=5 {
            for x in 0..16 {
                w.set(x, y, 5, STONE);
            }
            w.set(8, y, 4, LADDER);
        }
        let dt = 1.0 / 60.0;
        let push = input(0.0, 1.0, false, false);
        let mut p = Player::new(8.5, 1.0, 2.5);
        for _ in 0..60 {
            p.step(&w, &push, dt);
        }
        assert!(p.pos[1] > 2.0 && (p.vel[1] - CLIMB_UP).abs() < 1e-9, "climbing: at {} going {}", p.pos[1], p.vel[1]);
        // Holding on (sneaking) they stay where they are.
        let y = p.pos[1];
        for _ in 0..60 {
            p.step(&w, &input(0.0, 0.0, false, true), dt);
        }
        assert!((p.pos[1] - y).abs() < 1e-3 && !p.on_ground, "held at {y}, now {}", p.pos[1]);
        // Letting go, they slide down no faster than CLIMB_DOWN, to the floor.
        let mut fastest: f64 = 0.0;
        for _ in 0..180 {
            p.step(&w, &input(0.0, 0.0, false, false), dt);
            fastest = fastest.min(p.vel[1]);
        }
        assert!(fastest >= -CLIMB_DOWN - 1e-9 && fastest < -CLIMB_DOWN + 0.5, "slid down at {fastest}");
        assert!(p.on_ground && (p.pos[1] - 1.0).abs() < 1e-9);
        // Climbing all the way, they come out on top of the wall.
        let mut steps = 0;
        while steps < 300 && !(p.on_ground && p.pos[2] > 5.3) {
            p.step(&w, &push, dt);
            steps += 1;
        }
        assert!((p.pos[1] - 6.0).abs() < 1e-9 && p.pos[2] < 6.0, "on top: {:?}", p.pos);
        assert!((1.8..2.6).contains(&(steps as f64 * dt)), "five blocks up in {} s", steps as f64 * dt);
        // Without the ladder, the same push only stands them at the wall.
        let mut plain = floor();
        for y in 1..=5 {
            for x in 0..16 {
                plain.set(x, y, 5, STONE);
            }
        }
        let mut q = Player::new(8.5, 1.0, 2.5);
        for _ in 0..120 {
            q.step(&plain, &push, dt);
        }
        assert!((q.pos[1] - 1.0).abs() < 1e-9);
        // In a vine with nothing behind it, holding jump climbs.
        for y in 1..=4 {
            w.set(12, y, 10, VINE);
        }
        let mut v = Player::new(12.5, 1.0, 10.5);
        for _ in 0..60 {
            v.step(&w, &input(0.0, 0.0, true, false), dt);
        }
        assert!(v.pos[1] > 3.0 && v.pos[1] < 5.5, "up the vine to {}", v.pos[1]);
    }
}
