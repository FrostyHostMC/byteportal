//! Block registry: ids, render / physics / light properties and texture layers.
//!
//! Face order used everywhere in the engine: 0 = +X, 1 = -X, 2 = +Y, 3 = -Y, 4 = +Z, 5 = -Z.
//!
//! A block id is one byte, and a block with orientations or parts (a torch on a wall, the head
//! of a bed facing east, the top half of a slab) has one id per variant. Every variant of a family
//! shares the family's `name` and differs in its `state` (`"facing=east,part=head"`), the way
//! Minecraft writes block states. Ids never change once given out: saved worlds store them.
//!
//! A game can add blocks of its own (`set_game_blocks`): they take the ids after the built-in
//! ones. What's in use is a `Registry` (the blocks and their per-id tables) per thread, read with
//! `registry()`; the tables still read like the arrays they were (`OPAQUE[id]`).

use std::cell::{Cell, RefCell};
use std::sync::OnceLock;

use crate::json::{self, Json};
use crate::shapes::Shapes;

/// Texture array layers. Order here is the order of layers in the generated texture array.
pub mod tex {
    pub const STONE: u16 = 0;
    pub const GRASS_TOP: u16 = 1;
    pub const GRASS_SIDE: u16 = 2;
    pub const DIRT: u16 = 3;
    pub const COBBLESTONE: u16 = 4;
    pub const OAK_PLANKS: u16 = 5;
    pub const BEDROCK: u16 = 6;
    pub const SAND: u16 = 7;
    pub const GRAVEL: u16 = 8;
    pub const OAK_LOG: u16 = 9;
    pub const OAK_LOG_TOP: u16 = 10;
    pub const OAK_LEAVES: u16 = 11;
    pub const GLASS: u16 = 12;
    pub const WATER: u16 = 13;
    pub const LAVA: u16 = 14;
    pub const SANDSTONE: u16 = 15;
    pub const SANDSTONE_TOP: u16 = 16;
    pub const SNOW: u16 = 17;
    pub const ICE: u16 = 18;
    pub const COAL_ORE: u16 = 19;
    pub const IRON_ORE: u16 = 20;
    pub const GOLD_ORE: u16 = 21;
    pub const DIAMOND_ORE: u16 = 22;
    pub const REDSTONE_ORE: u16 = 23;
    pub const LAPIS_ORE: u16 = 24;
    pub const BIRCH_LOG: u16 = 25;
    pub const BIRCH_LOG_TOP: u16 = 26;
    pub const BIRCH_LEAVES: u16 = 27;
    pub const SPRUCE_LOG: u16 = 28;
    pub const SPRUCE_LOG_TOP: u16 = 29;
    pub const SPRUCE_LEAVES: u16 = 30;
    pub const CACTUS_SIDE: u16 = 31;
    pub const CACTUS_TOP: u16 = 32;
    pub const SHORT_GRASS: u16 = 33;
    pub const FERN: u16 = 34;
    pub const DANDELION: u16 = 35;
    pub const POPPY: u16 = 36;
    pub const CORNFLOWER: u16 = 37;
    pub const DEAD_BUSH: u16 = 38;
    pub const GLOWSTONE: u16 = 39;
    pub const BRICKS: u16 = 40;
    pub const STONE_BRICKS: u16 = 41;
    pub const MOSSY_COBBLESTONE: u16 = 42;
    pub const CLAY: u16 = 43;
    pub const GRASS_SNOW_SIDE: u16 = 44;
    pub const OBSIDIAN: u16 = 45;
    pub const BOOKSHELF: u16 = 46;
    pub const TORCH: u16 = 47;
    pub const GRANITE: u16 = 48;
    pub const DIORITE: u16 = 49;
    pub const ANDESITE: u16 = 50;
    pub const DEEPSLATE: u16 = 51;
    pub const DEEPSLATE_TOP: u16 = 52;
    pub const PODZOL_TOP: u16 = 53;
    pub const PODZOL_SIDE: u16 = 54;
    pub const WHITE_WOOL: u16 = 55;
    pub const RED_WOOL: u16 = 56;
    pub const YELLOW_WOOL: u16 = 57;
    pub const GREEN_WOOL: u16 = 58;
    pub const BLUE_WOOL: u16 = 59;
    pub const BLACK_WOOL: u16 = 60;
    pub const SEA_LANTERN: u16 = 61;
    pub const SPRUCE_PLANKS: u16 = 62;
    pub const BIRCH_PLANKS: u16 = 63;
    pub const BROWN_MUSHROOM: u16 = 64;
    pub const RED_MUSHROOM: u16 = 65;
    pub const WHITE_CONCRETE: u16 = 66;
    pub const LIGHT_GRAY_CONCRETE: u16 = 67;
    pub const GRAY_CONCRETE: u16 = 68;
    pub const BLACK_CONCRETE: u16 = 69;
    pub const RED_CONCRETE: u16 = 70;
    pub const IRON_BLOCK: u16 = 71;
    pub const END_STONE: u16 = 72;
    pub const RED_BED_HEAD_TOP: u16 = 73;
    pub const RED_BED_HEAD_SIDE: u16 = 74;
    pub const BLUE_BED_HEAD_TOP: u16 = 75;
    pub const BLUE_BED_HEAD_SIDE: u16 = 76;
    pub const GREEN_BED_HEAD_TOP: u16 = 77;
    pub const GREEN_BED_HEAD_SIDE: u16 = 78;
    pub const YELLOW_BED_HEAD_TOP: u16 = 79;
    pub const YELLOW_BED_HEAD_SIDE: u16 = 80;
    pub const RED_BED_FOOT_TOP: u16 = 81;
    pub const RED_BED_FOOT_SIDE: u16 = 82;
    pub const RED_BED_HEAD_END: u16 = 83;
    pub const RED_BED_FOOT_END: u16 = 84;
    pub const BLUE_BED_FOOT_TOP: u16 = 85;
    pub const BLUE_BED_FOOT_SIDE: u16 = 86;
    pub const BLUE_BED_HEAD_END: u16 = 87;
    pub const BLUE_BED_FOOT_END: u16 = 88;
    pub const GREEN_BED_FOOT_TOP: u16 = 89;
    pub const GREEN_BED_FOOT_SIDE: u16 = 90;
    pub const GREEN_BED_HEAD_END: u16 = 91;
    pub const GREEN_BED_FOOT_END: u16 = 92;
    pub const YELLOW_BED_FOOT_TOP: u16 = 93;
    pub const YELLOW_BED_FOOT_SIDE: u16 = 94;
    pub const YELLOW_BED_HEAD_END: u16 = 95;
    pub const YELLOW_BED_FOOT_END: u16 = 96;
    pub const WALL_TORCH: u16 = 97;
    pub const ORANGE_CONCRETE: u16 = 98;
    pub const MAGENTA_CONCRETE: u16 = 99;
    pub const LIGHT_BLUE_CONCRETE: u16 = 100;
    pub const YELLOW_CONCRETE: u16 = 101;
    pub const LIME_CONCRETE: u16 = 102;
    pub const PINK_CONCRETE: u16 = 103;
    pub const CYAN_CONCRETE: u16 = 104;
    pub const PURPLE_CONCRETE: u16 = 105;
    pub const BLUE_CONCRETE: u16 = 106;
    pub const BROWN_CONCRETE: u16 = 107;
    pub const GREEN_CONCRETE: u16 = 108;
    pub const NEON_RED: u16 = 109;
    pub const NEON_PINK: u16 = 110;
    pub const NEON_CYAN: u16 = 111;
    pub const NEON_YELLOW: u16 = 112;

    pub const COUNT: usize = 113;

    pub const NAMES: [&str; COUNT] = [
        "stone", "grass_top", "grass_side", "dirt", "cobblestone", "oak_planks", "bedrock", "sand",
        "gravel", "oak_log", "oak_log_top", "oak_leaves", "glass", "water", "lava", "sandstone",
        "sandstone_top", "snow", "ice", "coal_ore", "iron_ore", "gold_ore", "diamond_ore",
        "redstone_ore", "lapis_ore", "birch_log", "birch_log_top", "birch_leaves", "spruce_log",
        "spruce_log_top", "spruce_leaves", "cactus_side", "cactus_top", "short_grass", "fern",
        "dandelion", "poppy", "cornflower", "dead_bush", "glowstone", "bricks", "stone_bricks",
        "mossy_cobblestone", "clay", "grass_snow_side", "obsidian", "bookshelf", "torch", "granite",
        "diorite", "andesite", "deepslate", "deepslate_top", "podzol_top", "podzol_side",
        "white_wool", "red_wool", "yellow_wool", "green_wool", "blue_wool", "black_wool",
        "sea_lantern", "spruce_planks", "birch_planks", "brown_mushroom", "red_mushroom",
        "white_concrete", "light_gray_concrete", "gray_concrete", "black_concrete", "red_concrete", "iron_block",
        "end_stone", "red_bed_head_top", "red_bed_head_side", "blue_bed_head_top", "blue_bed_head_side",
        "green_bed_head_top", "green_bed_head_side", "yellow_bed_head_top", "yellow_bed_head_side",
        "red_bed_foot_top", "red_bed_foot_side", "red_bed_head_end", "red_bed_foot_end",
        "blue_bed_foot_top", "blue_bed_foot_side", "blue_bed_head_end", "blue_bed_foot_end",
        "green_bed_foot_top", "green_bed_foot_side", "green_bed_head_end", "green_bed_foot_end",
        "yellow_bed_foot_top", "yellow_bed_foot_side", "yellow_bed_head_end", "yellow_bed_foot_end",
        "wall_torch",
        "orange_concrete", "magenta_concrete", "light_blue_concrete", "yellow_concrete", "lime_concrete", "pink_concrete", "cyan_concrete", "purple_concrete", "blue_concrete", "brown_concrete", "green_concrete", "neon_red", "neon_pink", "neon_cyan", "neon_yellow",
    ];
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Shape {
    Air,
    /// Full cube.
    Cube,
    /// Two diagonal quads (plants).
    Cross,
    /// Full cube with a lowered surface when exposed (water, lava).
    Liquid,
    /// Boxes on a 1/16 grid (torches, slabs, stairs, beds): see `ModelKind` and `shapes`.
    Model,
}

/// What a `Shape::Model` block looks like (built in `shapes`). Facings: 0 north (-Z), 1 east
/// (+X), 2 south (+Z), 3 west (-X).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ModelKind {
    None,
    /// A standing torch. `tex[0]`: the torch; `tex[3]`: its underside.
    Torch,
    /// A torch on a wall, pointing toward the facing (the wall is behind it). `tex[0]`: the
    /// wall torch texture; `tex[3]`: its underside.
    WallTorch(u8),
    /// Half a block; true = the upper half. Faces use `tex` by direction.
    Slab(bool),
    /// Stairs climbing toward the facing; true = upside down. Faces use `tex` by direction.
    Stairs(u8, bool),
    /// Half of a bed whose head points toward the facing; true = the head half.
    /// `tex`: [top, side, end, underside, legs, -].
    Bed(u8, bool),
    /// A game's fence: a post, with rails to the fences and solid blocks beside it (see
    /// `shapes::JOIN_FENCE`). Faces use `tex` by direction.
    Fence,
    /// A game's pane: a thin wall joining the panes and solid blocks beside it.
    Pane,
    /// A game's post: a thin pillar, turned by `Orient` (lying along x or z).
    Post(Orient),
    /// A game's own boxes (1/16 grid, written as it faces north), turned by `Orient`.
    Boxes(&'static [[u8; 6]], Orient),
}

/// How a game's block is turned from the way it's written (facing north, or upright): first
/// tipped about the east-west axis (`tilt` 1 brings its north face to the top, -1 to the
/// bottom), then `turn` quarter turns clockwise seen from above (north to east).
#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
pub struct Orient {
    pub tilt: i8,
    pub turn: u8,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Layer {
    Opaque = 0,
    Cutout = 1,
    Translucent = 2,
}

/// Texture transforms (`Block::uvt`, and per face of a model): swap u and v, then negate u,
/// then negate v. Together they make the 8 rotations and mirror images of a texture.
pub const UV_SWAP: u8 = 1;
pub const UV_NEG_U: u8 = 2;
pub const UV_NEG_V: u8 = 4;

#[derive(Clone, Copy)]
pub struct Block {
    /// The family name, shared by all its variants (`red_bed`).
    pub name: &'static str,
    pub label: &'static str,
    /// Which variant of the family (`facing=east,part=head`); empty for the default of a plain block.
    pub state: &'static str,
    pub shape: Shape,
    pub model: ModelKind,
    pub layer: Layer,
    /// Texture layer per face: +X -X +Y -Y +Z -Z (models: see `ModelKind`).
    pub tex: [u16; 6],
    /// Texture transform per face (`UV_*`), for cubes (a log lying on its side).
    pub uvt: [u8; 6],
    /// Full opaque cube: hides neighbour faces, casts ambient occlusion, blocks all light.
    pub opaque: bool,
    /// Collides with entities.
    pub solid: bool,
    /// Light attenuation when light passes through (0..=15). Opaque blocks use 15. A model that
    /// blocks light (a slab) still gets light itself, from its neighbours.
    pub opacity: u8,
    /// Light emission (0..=15).
    pub emit: u8,
    /// Multiply by biome colour (grass, foliage).
    pub tint: bool,
    /// Vertex animation: 0 none, 1 leaves sway, 2 plant sway (top vertices).
    pub anim: u8,
    /// Hide faces between two blocks of the same type (glass).
    pub cull_self: bool,
    /// Leaves-style block: faces toward other leaves are kept (fancy leaves).
    pub leaves: bool,
    /// Can be replaced by placing a block into it (plants, liquids).
    pub replaceable: bool,
    /// Shown in the creative inventory (one variant per family).
    pub placeable: bool,
    /// Players and explosions can break it (not bedrock, not liquids).
    pub breakable: bool,
    /// A slab: the block two halves make together.
    pub double: u8,
    /// Bodies climb it (a game's ladders and vines).
    pub climbable: bool,
}

const fn base(name: &'static str, label: &'static str, t: [u16; 6]) -> Block {
    Block {
        name,
        label,
        state: "",
        shape: Shape::Cube,
        model: ModelKind::None,
        layer: Layer::Opaque,
        tex: t,
        uvt: [0; 6],
        opaque: true,
        solid: true,
        opacity: 15,
        emit: 0,
        tint: false,
        anim: 0,
        cull_self: false,
        leaves: false,
        replaceable: false,
        placeable: true,
        breakable: true,
        double: 0,
        climbable: false,
    }
}

const fn cube(name: &'static str, label: &'static str, t: u16) -> Block {
    base(name, label, [t, t, t, t, t, t])
}

const fn cube3(name: &'static str, label: &'static str, top: u16, side: u16, bottom: u16) -> Block {
    base(name, label, [side, side, top, bottom, side, side])
}

const fn leaves(name: &'static str, label: &'static str, t: u16, tint: bool) -> Block {
    Block {
        layer: Layer::Cutout,
        opaque: false,
        opacity: 1,
        tint,
        anim: 1,
        leaves: true,
        ..cube(name, label, t)
    }
}

const fn plant(name: &'static str, label: &'static str, t: u16, tint: bool, anim: u8) -> Block {
    Block {
        shape: Shape::Cross,
        layer: Layer::Cutout,
        opaque: false,
        solid: false,
        opacity: 0,
        tint,
        anim,
        replaceable: true,
        ..cube(name, label, t)
    }
}

/// A model block: not a full cube, so it neither hides its neighbours' faces wholesale nor
/// darkens them; `opacity` 15 still keeps light out (slabs and stairs make roofs).
const fn model(b: Block, kind: ModelKind, state: &'static str, opacity: u8) -> Block {
    Block { shape: Shape::Model, model: kind, state, opaque: false, opacity, ..b }
}

use tex as T;

pub const AIR: u8 = 0;
pub const STONE: u8 = 1;
pub const GRASS: u8 = 2;
pub const DIRT: u8 = 3;
pub const COBBLESTONE: u8 = 4;
pub const OAK_PLANKS_B: u8 = 5;
pub const BEDROCK: u8 = 6;
pub const SAND: u8 = 7;
pub const GRAVEL: u8 = 8;
pub const OAK_LOG_B: u8 = 9;
pub const OAK_LEAVES_B: u8 = 10;
pub const GLASS_B: u8 = 11;
pub const WATER_B: u8 = 12;
pub const LAVA_B: u8 = 13;
pub const SANDSTONE_B: u8 = 14;
pub const SNOW_B: u8 = 15;
pub const ICE_B: u8 = 16;
pub const COAL_ORE_B: u8 = 17;
pub const IRON_ORE_B: u8 = 18;
pub const GOLD_ORE_B: u8 = 19;
pub const DIAMOND_ORE_B: u8 = 20;
pub const REDSTONE_ORE_B: u8 = 21;
pub const LAPIS_ORE_B: u8 = 22;
pub const BIRCH_LOG_B: u8 = 23;
pub const BIRCH_LEAVES_B: u8 = 24;
pub const SPRUCE_LOG_B: u8 = 25;
pub const SPRUCE_LEAVES_B: u8 = 26;
pub const CACTUS_B: u8 = 27;
pub const SHORT_GRASS_B: u8 = 28;
pub const FERN_B: u8 = 29;
pub const DANDELION_B: u8 = 30;
pub const POPPY_B: u8 = 31;
pub const CORNFLOWER_B: u8 = 32;
pub const DEAD_BUSH_B: u8 = 33;
pub const GLOWSTONE_B: u8 = 34;
pub const BRICKS_B: u8 = 35;
pub const STONE_BRICKS_B: u8 = 36;
pub const MOSSY_COBBLESTONE_B: u8 = 37;
pub const CLAY_B: u8 = 38;
pub const SNOWY_GRASS: u8 = 39;
pub const OBSIDIAN_B: u8 = 40;
pub const BOOKSHELF_B: u8 = 41;
pub const TORCH_B: u8 = 42;
pub const GRANITE_B: u8 = 43;
pub const DIORITE_B: u8 = 44;
pub const ANDESITE_B: u8 = 45;
pub const DEEPSLATE_B: u8 = 46;
pub const PODZOL: u8 = 47;
pub const WHITE_WOOL_B: u8 = 48;
pub const RED_WOOL_B: u8 = 49;
pub const YELLOW_WOOL_B: u8 = 50;
pub const GREEN_WOOL_B: u8 = 51;
pub const BLUE_WOOL_B: u8 = 52;
pub const BLACK_WOOL_B: u8 = 53;
pub const SEA_LANTERN_B: u8 = 54;
pub const SPRUCE_PLANKS_B: u8 = 55;
pub const BIRCH_PLANKS_B: u8 = 56;
pub const BROWN_MUSHROOM_B: u8 = 57;
pub const RED_MUSHROOM_B: u8 = 58;
pub const WHITE_CONCRETE_B: u8 = 59;
pub const LIGHT_GRAY_CONCRETE_B: u8 = 60;
pub const GRAY_CONCRETE_B: u8 = 61;
pub const BLACK_CONCRETE_B: u8 = 62;
pub const RED_CONCRETE_B: u8 = 63;
pub const IRON_BLOCK_B: u8 = 64;
pub const END_STONE_B: u8 = 65;
/// The foot of each bed facing north (red, blue, green, yellow); the other variants are at
/// `BED_VARIANTS` (see `bed_id`).
pub const RED_BED_B: u8 = 66;
pub const BLUE_BED_B: u8 = 67;
pub const GREEN_BED_B: u8 = 68;
pub const YELLOW_BED_B: u8 = 69;
/// Torches on walls, by facing (north, east, south, west).
pub const WALL_TORCH_B: u8 = 70;
/// Seven more variants of each bed colour.
pub const BED_VARIANTS: u8 = 74;
/// Slabs: bottom then top half, per `SLABS` material.
pub const SLAB_B: u8 = 102;
/// Stairs: per `STAIRS` material, per facing, the right way up then upside down.
pub const STAIRS_B: u8 = 118;
/// Logs lying along x, then along z, per `LOGS`.
pub const LOG_AXIS_B: u8 = 166;

/// More full blocks: the other concrete colours, then neon (glowing sign blocks), per `EXTRA`.
pub const EXTRA_B: u8 = 172;

pub const BLOCK_COUNT: usize = 187;

/// Horizontal facings in id order, and the face (+X -X +Y -Y +Z -Z order) each one points out of.
pub const FACING_NAMES: [&str; 4] = ["north", "east", "south", "west"];
pub const FACING_FACE: [usize; 4] = [5, 0, 4, 1];

pub const BED_COLORS: usize = 4;
/// Beds by colour: [head top, head side, head end, foot top, foot side, foot end].
const BED_TEX: [[u16; 6]; BED_COLORS] = [
    [T::RED_BED_HEAD_TOP, T::RED_BED_HEAD_SIDE, T::RED_BED_HEAD_END, T::RED_BED_FOOT_TOP, T::RED_BED_FOOT_SIDE, T::RED_BED_FOOT_END],
    [T::BLUE_BED_HEAD_TOP, T::BLUE_BED_HEAD_SIDE, T::BLUE_BED_HEAD_END, T::BLUE_BED_FOOT_TOP, T::BLUE_BED_FOOT_SIDE, T::BLUE_BED_FOOT_END],
    [T::GREEN_BED_HEAD_TOP, T::GREEN_BED_HEAD_SIDE, T::GREEN_BED_HEAD_END, T::GREEN_BED_FOOT_TOP, T::GREEN_BED_FOOT_SIDE, T::GREEN_BED_FOOT_END],
    [T::YELLOW_BED_HEAD_TOP, T::YELLOW_BED_HEAD_SIDE, T::YELLOW_BED_HEAD_END, T::YELLOW_BED_FOOT_TOP, T::YELLOW_BED_FOOT_SIDE, T::YELLOW_BED_FOOT_END],
];

/// Slab and stair materials: (family name, label, the full block they're cut from).
pub const SLABS: [(&str, &str, u8); 8] = [
    ("stone_slab", "Stone Slab", STONE),
    ("cobblestone_slab", "Cobblestone Slab", COBBLESTONE),
    ("oak_slab", "Oak Slab", OAK_PLANKS_B),
    ("spruce_slab", "Spruce Slab", SPRUCE_PLANKS_B),
    ("birch_slab", "Birch Slab", BIRCH_PLANKS_B),
    ("stone_brick_slab", "Stone Brick Slab", STONE_BRICKS_B),
    ("brick_slab", "Brick Slab", BRICKS_B),
    ("sandstone_slab", "Sandstone Slab", SANDSTONE_B),
];
pub const STAIRS: [(&str, &str, u8); 6] = [
    ("oak_stairs", "Oak Stairs", OAK_PLANKS_B),
    ("spruce_stairs", "Spruce Stairs", SPRUCE_PLANKS_B),
    ("birch_stairs", "Birch Stairs", BIRCH_PLANKS_B),
    ("cobblestone_stairs", "Cobblestone Stairs", COBBLESTONE),
    ("stone_brick_stairs", "Stone Brick Stairs", STONE_BRICKS_B),
    ("brick_stairs", "Brick Stairs", BRICKS_B),
];
pub const LOGS: [u8; 3] = [OAK_LOG_B, BIRCH_LOG_B, SPRUCE_LOG_B];

const FACING_STATES: [&str; 4] = ["facing=north", "facing=east", "facing=south", "facing=west"];
const BED_STATES: [&str; 8] = [
    "facing=north,part=foot",
    "facing=north,part=head",
    "facing=east,part=foot",
    "facing=east,part=head",
    "facing=south,part=foot",
    "facing=south,part=head",
    "facing=west,part=foot",
    "facing=west,part=head",
];
const SLAB_STATES: [&str; 2] = ["type=bottom", "type=top"];
const STAIR_STATES: [&str; 8] = [
    "facing=north,half=bottom",
    "facing=north,half=top",
    "facing=east,half=bottom",
    "facing=east,half=top",
    "facing=south,half=bottom",
    "facing=south,half=top",
    "facing=west,half=bottom",
    "facing=west,half=top",
];

pub const fn bed_id(color: u8, facing: u8, head: bool) -> u8 {
    let k = facing * 2 + head as u8;
    if k == 0 {
        RED_BED_B + color
    } else {
        BED_VARIANTS + color * 7 + k - 1
    }
}

pub const fn slab_id(material: u8, top: bool) -> u8 {
    SLAB_B + material * 2 + top as u8
}

pub const fn stairs_id(material: u8, facing: u8, top: bool) -> u8 {
    STAIRS_B + material * 8 + facing * 2 + top as u8
}

/// Axis 0 = x, 1 = z (a standing log is the log's own id).
pub const fn log_id(log: u8, axis: u8) -> u8 {
    LOG_AXIS_B + log * 2 + axis
}

const BASE: [Block; 70] = [
    Block {
        shape: Shape::Air,
        opaque: false,
        solid: false,
        opacity: 0,
        replaceable: true,
        placeable: false,
        breakable: false,
        ..cube("air", "Air", 0)
    },
    cube("stone", "Stone", T::STONE),
    Block { tint: true, ..base("grass_block", "Grass Block", [T::GRASS_SIDE, T::GRASS_SIDE, T::GRASS_TOP, T::DIRT, T::GRASS_SIDE, T::GRASS_SIDE]) },
    cube("dirt", "Dirt", T::DIRT),
    cube("cobblestone", "Cobblestone", T::COBBLESTONE),
    cube("oak_planks", "Oak Planks", T::OAK_PLANKS),
    Block { placeable: false, breakable: false, ..cube("bedrock", "Bedrock", T::BEDROCK) },
    cube("sand", "Sand", T::SAND),
    cube("gravel", "Gravel", T::GRAVEL),
    Block { state: "axis=y", ..cube3("oak_log", "Oak Log", T::OAK_LOG_TOP, T::OAK_LOG, T::OAK_LOG_TOP) },
    leaves("oak_leaves", "Oak Leaves", T::OAK_LEAVES, true),
    Block {
        layer: Layer::Cutout,
        opaque: false,
        opacity: 0,
        cull_self: true,
        ..cube("glass", "Glass", T::GLASS)
    },
    Block {
        shape: Shape::Liquid,
        layer: Layer::Translucent,
        opaque: false,
        solid: false,
        opacity: 1,
        replaceable: true,
        breakable: false,
        ..cube("water", "Water", T::WATER)
    },
    Block {
        shape: Shape::Liquid,
        layer: Layer::Opaque,
        opaque: false,
        solid: false,
        opacity: 15,
        emit: 15,
        replaceable: true,
        breakable: false,
        ..cube("lava", "Lava", T::LAVA)
    },
    cube3("sandstone", "Sandstone", T::SANDSTONE_TOP, T::SANDSTONE, T::SANDSTONE_TOP),
    cube("snow_block", "Snow", T::SNOW),
    cube("ice", "Ice", T::ICE),
    cube("coal_ore", "Coal Ore", T::COAL_ORE),
    cube("iron_ore", "Iron Ore", T::IRON_ORE),
    cube("gold_ore", "Gold Ore", T::GOLD_ORE),
    cube("diamond_ore", "Diamond Ore", T::DIAMOND_ORE),
    cube("redstone_ore", "Redstone Ore", T::REDSTONE_ORE),
    cube("lapis_ore", "Lapis Ore", T::LAPIS_ORE),
    Block { state: "axis=y", ..cube3("birch_log", "Birch Log", T::BIRCH_LOG_TOP, T::BIRCH_LOG, T::BIRCH_LOG_TOP) },
    leaves("birch_leaves", "Birch Leaves", T::BIRCH_LEAVES, false),
    Block { state: "axis=y", ..cube3("spruce_log", "Spruce Log", T::SPRUCE_LOG_TOP, T::SPRUCE_LOG, T::SPRUCE_LOG_TOP) },
    leaves("spruce_leaves", "Spruce Leaves", T::SPRUCE_LEAVES, false),
    cube3("cactus", "Cactus", T::CACTUS_TOP, T::CACTUS_SIDE, T::CACTUS_TOP),
    plant("short_grass", "Grass", T::SHORT_GRASS, true, 2),
    plant("fern", "Fern", T::FERN, true, 2),
    plant("dandelion", "Dandelion", T::DANDELION, false, 2),
    plant("poppy", "Poppy", T::POPPY, false, 2),
    plant("cornflower", "Cornflower", T::CORNFLOWER, false, 2),
    plant("dead_bush", "Dead Bush", T::DEAD_BUSH, false, 0),
    Block { emit: 15, ..cube("glowstone", "Glowstone", T::GLOWSTONE) },
    cube("bricks", "Bricks", T::BRICKS),
    cube("stone_bricks", "Stone Bricks", T::STONE_BRICKS),
    cube("mossy_cobblestone", "Mossy Cobblestone", T::MOSSY_COBBLESTONE),
    cube("clay", "Clay", T::CLAY),
    cube3("snowy_grass", "Snowy Grass", T::SNOW, T::GRASS_SNOW_SIDE, T::DIRT),
    cube("obsidian", "Obsidian", T::OBSIDIAN),
    cube3("bookshelf", "Bookshelf", T::OAK_PLANKS, T::BOOKSHELF, T::OAK_PLANKS),
    torch(),
    cube("granite", "Granite", T::GRANITE),
    cube("diorite", "Diorite", T::DIORITE),
    cube("andesite", "Andesite", T::ANDESITE),
    cube3("deepslate", "Deepslate", T::DEEPSLATE_TOP, T::DEEPSLATE, T::DEEPSLATE_TOP),
    cube3("podzol", "Podzol", T::PODZOL_TOP, T::PODZOL_SIDE, T::DIRT),
    cube("white_wool", "White Wool", T::WHITE_WOOL),
    cube("red_wool", "Red Wool", T::RED_WOOL),
    cube("yellow_wool", "Yellow Wool", T::YELLOW_WOOL),
    cube("green_wool", "Green Wool", T::GREEN_WOOL),
    cube("blue_wool", "Blue Wool", T::BLUE_WOOL),
    cube("black_wool", "Black Wool", T::BLACK_WOOL),
    Block { emit: 15, ..cube("sea_lantern", "Sea Lantern", T::SEA_LANTERN) },
    cube("spruce_planks", "Spruce Planks", T::SPRUCE_PLANKS),
    cube("birch_planks", "Birch Planks", T::BIRCH_PLANKS),
    plant("brown_mushroom", "Brown Mushroom", T::BROWN_MUSHROOM, false, 0),
    plant("red_mushroom", "Red Mushroom", T::RED_MUSHROOM, false, 0),
    cube("white_concrete", "White Concrete", T::WHITE_CONCRETE),
    cube("light_gray_concrete", "Light Gray Concrete", T::LIGHT_GRAY_CONCRETE),
    cube("gray_concrete", "Gray Concrete", T::GRAY_CONCRETE),
    cube("black_concrete", "Black Concrete", T::BLACK_CONCRETE),
    cube("red_concrete", "Red Concrete", T::RED_CONCRETE),
    cube("iron_block", "Block of Iron", T::IRON_BLOCK),
    cube("end_stone", "End Stone", T::END_STONE),
    bed(0, 0, false),
    bed(1, 0, false),
    bed(2, 0, false),
    bed(3, 0, false),
];

/// Blocks after the variants (ids from `EXTRA_B`), so ids kept in saves never move.
const EXTRA: [Block; 15] = [
    cube("orange_concrete", "Orange Concrete", T::ORANGE_CONCRETE),
    cube("magenta_concrete", "Magenta Concrete", T::MAGENTA_CONCRETE),
    cube("light_blue_concrete", "Light Blue Concrete", T::LIGHT_BLUE_CONCRETE),
    cube("yellow_concrete", "Yellow Concrete", T::YELLOW_CONCRETE),
    cube("lime_concrete", "Lime Concrete", T::LIME_CONCRETE),
    cube("pink_concrete", "Pink Concrete", T::PINK_CONCRETE),
    cube("cyan_concrete", "Cyan Concrete", T::CYAN_CONCRETE),
    cube("purple_concrete", "Purple Concrete", T::PURPLE_CONCRETE),
    cube("blue_concrete", "Blue Concrete", T::BLUE_CONCRETE),
    cube("brown_concrete", "Brown Concrete", T::BROWN_CONCRETE),
    cube("green_concrete", "Green Concrete", T::GREEN_CONCRETE),
    neon("neon_red", "Red Neon", T::NEON_RED),
    neon("neon_pink", "Pink Neon", T::NEON_PINK),
    neon("neon_cyan", "Cyan Neon", T::NEON_CYAN),
    neon("neon_yellow", "Yellow Neon", T::NEON_YELLOW),
];

/// A glowing sign block (neon tubing seen head on): lights its surroundings.
const fn neon(name: &'static str, label: &'static str, t: u16) -> Block {
    Block { emit: 12, ..cube(name, label, t) }
}

const fn torch() -> Block {
    let t = T::TORCH;
    Block {
        layer: Layer::Cutout,
        solid: false,
        emit: 14,
        ..model(base("torch", "Torch", [t, t, t, T::OAK_PLANKS, t, t]), ModelKind::Torch, "", 0)
    }
}

const fn wall_torch(facing: u8) -> Block {
    let t = T::WALL_TORCH;
    Block {
        layer: Layer::Cutout,
        solid: false,
        emit: 14,
        placeable: false,
        ..model(base("torch", "Torch", [t, t, t, T::OAK_PLANKS, t, t]), ModelKind::WallTorch(facing), FACING_STATES[facing as usize], 0)
    }
}

const BED_NAMES: [(&str, &str); BED_COLORS] = [("red_bed", "Red Bed"), ("blue_bed", "Blue Bed"), ("green_bed", "Green Bed"), ("yellow_bed", "Yellow Bed")];

const fn bed(color: usize, facing: u8, head: bool) -> Block {
    let t = &BED_TEX[color];
    let o = if head { 0 } else { 3 };
    let tex = [t[o], t[o + 1], t[o + 2], T::OAK_PLANKS, T::SPRUCE_PLANKS, 0];
    let (name, label) = BED_NAMES[color];
    Block {
        placeable: facing == 0 && !head,
        ..model(base(name, label, tex), ModelKind::Bed(facing, head), BED_STATES[(facing * 2 + head as u8) as usize], 0)
    }
}

pub static BLOCKS: [Block; BLOCK_COUNT] = build();

const fn build() -> [Block; BLOCK_COUNT] {
    let mut out = [BASE[0]; BLOCK_COUNT];
    let mut i = 0;
    while i < BASE.len() {
        out[i] = BASE[i];
        i += 1;
    }
    let mut f = 0u8;
    while f < 4 {
        out[(WALL_TORCH_B + f) as usize] = wall_torch(f);
        f += 1;
    }
    let mut c = 0u8;
    while c < BED_COLORS as u8 {
        let mut k = 1u8;
        while k < 8 {
            out[bed_id(c, k / 2, k % 2 == 1) as usize] = bed(c as usize, k / 2, k % 2 == 1);
            k += 1;
        }
        c += 1;
    }
    let mut m = 0;
    while m < SLABS.len() {
        let (name, label, full) = SLABS[m];
        let t = BASE[full as usize].tex;
        let mut top = 0;
        while top < 2 {
            out[slab_id(m as u8, top == 1) as usize] = Block {
                placeable: top == 0,
                double: full,
                ..model(base(name, label, t), ModelKind::Slab(top == 1), SLAB_STATES[top], 15)
            };
            top += 1;
        }
        m += 1;
    }
    let mut m = 0;
    while m < STAIRS.len() {
        let (name, label, full) = STAIRS[m];
        let t = BASE[full as usize].tex;
        let mut k = 0u8;
        while k < 8 {
            let (facing, top) = (k / 2, k % 2 == 1);
            out[stairs_id(m as u8, facing, top) as usize] = Block {
                placeable: k == 0,
                ..model(base(name, label, t), ModelKind::Stairs(facing, top), STAIR_STATES[k as usize], 15)
            };
            k += 1;
        }
        m += 1;
    }
    let mut l = 0;
    while l < LOGS.len() {
        let log = BASE[LOGS[l] as usize];
        let (top, side) = (log.tex[2], log.tex[0]);
        // Bark grain runs along the image's v: turn it to run along the log.
        let s = UV_SWAP;
        out[log_id(l as u8, 0) as usize] = Block { state: "axis=x", placeable: false, tex: [top, top, side, side, side, side], uvt: [0, 0, s, s, s, s], ..log };
        out[log_id(l as u8, 1) as usize] = Block { state: "axis=z", placeable: false, tex: [side, side, side, side, top, top], uvt: [s, s, 0, 0, 0, 0], ..log };
        l += 1;
    }
    let mut e = 0;
    while e < EXTRA.len() {
        out[EXTRA_B as usize + e] = EXTRA[e];
        e += 1;
    }
    out
}

/// The first id a game's own blocks get (`set_game_blocks`): right after the built-in ones.
pub const GAME_FIRST: usize = BLOCK_COUNT;
/// How many blocks (variants) of its own a game can have: ids up to 254, since 255 means "not
/// loaded" (and "keep" in generator data).
pub const GAME_MAX: usize = 255 - GAME_FIRST;

pub const SHAPE_AIR: u8 = 0;
pub const SHAPE_CUBE: u8 = 1;
pub const SHAPE_CROSS: u8 = 2;
pub const SHAPE_LIQUID: u8 = 3;
pub const SHAPE_MODEL: u8 = 4;

const fn shape_id(s: Shape) -> u8 {
    match s {
        Shape::Air => SHAPE_AIR,
        Shape::Cube => SHAPE_CUBE,
        Shape::Cross => SHAPE_CROSS,
        Shape::Liquid => SHAPE_LIQUID,
        Shape::Model => SHAPE_MODEL,
    }
}

/// The blocks a world is made of: the built-in ones, then the game's own, with the per-id tables
/// the hot loops read. Ids nobody gave out behave like stone, so corrupted data never leaks light
/// or holes.
pub struct Registry {
    /// Every id's block (all 256; ids past `count` are stone).
    pub blocks: Vec<Block>,
    /// Ids below this are blocks: the built-in ones and the game's own.
    pub count: usize,
    /// 1 when the block is a full opaque cube.
    pub opaque: [u8; 256],
    /// Light attenuation (0..=15).
    pub opacity: [u8; 256],
    /// Light emission (0..=15).
    pub emit: [u8; 256],
    /// 1 when the block collides with entities.
    pub solid: [u8; 256],
    /// Render layer (see [`Layer`]).
    pub layer: [u8; 256],
    /// Shape id: 0 air, 1 cube, 2 cross, 3 liquid, 4 model.
    pub shape: [u8; 256],
    /// 1 for a model that keeps light out but is lit itself (slabs, stairs).
    pub lit_inside: [u8; 256],
    /// 1 when bodies climb it (ladders, vines).
    pub climbable: [u8; 256],
    /// The models of blocks that aren't full cubes, and the sides each block fills.
    pub shapes: Shapes,
}

impl Registry {
    /// The built-in blocks followed by `game` (as many as fit).
    pub fn new(game: &[Block]) -> Registry {
        let count = BLOCK_COUNT + game.len().min(GAME_MAX);
        let mut blocks = Vec::with_capacity(256);
        blocks.extend_from_slice(&BLOCKS);
        blocks.extend_from_slice(&game[..count - BLOCK_COUNT]);
        blocks.resize(256, BLOCKS[STONE as usize]);
        let table = |f: &dyn Fn(&Block) -> u8| -> [u8; 256] { std::array::from_fn(|i| f(&blocks[i])) };
        let opaque = table(&|b| b.opaque as u8);
        let opacity = table(&|b| b.opacity);
        let emit = table(&|b| b.emit);
        let solid = table(&|b| b.solid as u8);
        let layer = table(&|b| b.layer as u8);
        let shape = table(&|b| shape_id(b.shape));
        // Blocks light yet is lit itself: light reaches in but doesn't carry on through.
        let lit_inside = table(&|b| (!b.opaque && b.opacity >= 15 && b.shape == Shape::Model) as u8);
        let climbable = table(&|b| b.climbable as u8);
        let shapes = crate::shapes::build(&blocks, count);
        Registry { blocks, count, opaque, opacity, emit, solid, layer, shape, lit_inside, climbable, shapes }
    }

    #[inline(always)]
    pub fn table(&self, p: Prop) -> &[u8; 256] {
        match p {
            Prop::Opaque => &self.opaque,
            Prop::Opacity => &self.opacity,
            Prop::Emit => &self.emit,
            Prop::Solid => &self.solid,
            Prop::Layer => &self.layer,
            Prop::Shape => &self.shape,
            Prop::LitInside => &self.lit_inside,
            Prop::Climbable => &self.climbable,
        }
    }
}

/// A per-id table of the blocks in use, read like an array: `SOLID[id as usize]`. (Hot loops take
/// `registry()` once and read its fields.)
#[derive(Clone, Copy)]
pub enum Prop {
    Opaque,
    Opacity,
    Emit,
    Solid,
    Layer,
    Shape,
    LitInside,
    Climbable,
}

impl std::ops::Index<usize> for Prop {
    type Output = u8;
    #[inline(always)]
    fn index(&self, i: usize) -> &u8 {
        &registry().table(*self)[i]
    }
}

/// 1 when the block is a full opaque cube.
pub const OPAQUE: Prop = Prop::Opaque;
/// Light attenuation (0..=15).
pub const OPACITY: Prop = Prop::Opacity;
/// Light emission (0..=15).
pub const EMIT: Prop = Prop::Emit;
/// 1 when the block collides with entities.
pub const SOLID: Prop = Prop::Solid;
/// Render layer (see [`Layer`]).
pub const LAYER: Prop = Prop::Layer;
/// Shape id: 0 air, 1 cube, 2 cross, 3 liquid, 4 model.
pub const SHAPE: Prop = Prop::Shape;
/// 1 for a model that keeps light out but is lit itself (slabs, stairs).
pub const LIT_INSIDE: Prop = Prop::LitInside;
/// 1 when bodies climb it (ladders, vines).
pub const CLIMBABLE: Prop = Prop::Climbable;

thread_local! {
    /// The blocks in use on this thread (None until first asked: the built-in ones).
    static CURRENT: Cell<Option<&'static Registry>> = const { Cell::new(None) };
    /// Registries made from game blocks so far, by their description: going back to one (two
    /// games hosted on one thread, taking turns) doesn't make it again.
    static MADE: RefCell<Vec<(String, &'static Registry)>> = const { RefCell::new(Vec::new()) };
}

/// The blocks in use on this thread: the built-in ones, and the game's own set last.
#[inline(always)]
pub fn registry() -> &'static Registry {
    CURRENT.with(|c| match c.get() {
        Some(r) => r,
        None => {
            let r = builtin();
            c.set(Some(r));
            r
        }
    })
}

fn builtin() -> &'static Registry {
    static BUILTIN: OnceLock<Registry> = OnceLock::new();
    BUILTIN.get_or_init(|| Registry::new(&[]))
}

#[inline(always)]
pub fn block(id: u8) -> &'static Block {
    &registry().blocks[id as usize]
}

/// Use a game's own blocks on this thread from now on: a JSON list of variants (see
/// `game_block`), given ids from `GAME_FIRST` in order. `[]` goes back to the built-in blocks
/// alone. Returns how many there are; on an error the blocks in use don't change.
pub fn set_game_blocks(text: &str) -> Result<usize, String> {
    if let Some(r) = MADE.with(|m| m.borrow().iter().find(|(k, _)| k == text).map(|(_, r)| *r)) {
        CURRENT.with(|c| c.set(Some(r)));
        return Ok(r.count - BLOCK_COUNT);
    }
    let v = json::parse(text)?;
    let list = v.as_arr().ok_or("game blocks: expected a list")?;
    if list.len() > GAME_MAX {
        return Err(format!("game blocks: {} is too many (at most {GAME_MAX})", list.len()));
    }
    let mut game = Vec::with_capacity(list.len());
    for (i, b) in list.iter().enumerate() {
        let name = b.get("name").and_then(Json::as_str).unwrap_or("?");
        game.push(game_block(b).map_err(|e| format!("game block {} ({name}): {e}", GAME_FIRST + i))?);
    }
    let count = BLOCK_COUNT + game.len();
    if let Some(b) = game.iter().find(|b| b.double as usize >= count) {
        return Err(format!("game block {}: its full block {} isn't a block", b.name, b.double));
    }
    // Made once and kept for the life of the thread (blocks are borrowed for 'static everywhere).
    let r: &'static Registry = if game.is_empty() { builtin() } else { Box::leak(Box::new(Registry::new(&game))) };
    MADE.with(|m| m.borrow_mut().push((text.to_string(), r)));
    CURRENT.with(|c| c.set(Some(r)));
    Ok(game.len())
}

fn leak(s: &str) -> &'static str {
    Box::leak(s.to_string().into_boxed_str())
}

/// One variant of a game's block from its description:
///
/// ```text
/// { "name": "marble_slab", "label": "Marble Slab", "state": "type=top",
///   "shape": "cube" | "cross" | "slab" | "stairs" | "fence" | "pane" | "post" | "boxes",
///   "facing": 0..3 (stairs), "top": bool, "boxes": [[x0, y0, z0, x1, y1, z1], ...] (1/16),
///   "tilt": -1..1, "turn": 0..3 (a cube, post or boxes turned: see `Orient`),
///   "layer": 0 opaque | 1 cutout, "tex": [+X -X +Y -Y +Z -Z texture layers], "uvt": [6],
///   "solid": bool, "opacity": 0..15, "emit": 0..15, "tint": bool (the grass colour),
///   "cull_self": bool, "replaceable": bool, "placeable": bool, "breakable": bool,
///   "double": id (a slab's full block), "anim": 0 | 1 | 2, "climbable": bool }
/// ```
///
/// Left out: a cube is solid and opaque on the opaque layer; a cross is a plant (cutout, not solid,
/// replaceable, swaying); fences, panes, posts and boxes are solid and let light through. A turned
/// cube's textures are given as it faces north (or stands upright) and turn with it.
fn game_block(v: &Json) -> Result<Block, String> {
    let num = |k: &str, def: f64| v.get(k).and_then(Json::as_f64).unwrap_or(def);
    let flag = |k: &str, def: bool| v.get(k).and_then(Json::as_bool).unwrap_or(def);
    let text = |k: &str| v.get(k).and_then(Json::as_str);
    let name = text("name").filter(|n| !n.is_empty()).ok_or("no name")?;
    let six = |k: &str, max: f64, def: Option<f64>| -> Result<[u16; 6], String> {
        let Some(a) = v.get(k).and_then(Json::as_arr) else {
            return def.map(|d| [d as u16; 6]).ok_or(format!("no {k}"));
        };
        if a.len() != 6 {
            return Err(format!("{k} needs 6 values"));
        }
        let mut out = [0u16; 6];
        for (o, x) in out.iter_mut().zip(a) {
            let x = x.as_f64().filter(|x| *x >= 0.0 && *x < max && x.fract() == 0.0).ok_or(format!("{k}: bad value"))?;
            *o = x as u16;
        }
        Ok(out)
    };
    // The chunk mesh keeps 10 bits of texture layer.
    let tex = six("tex", 1024.0, None)?;
    let uvt = six("uvt", 8.0, Some(0.0))?.map(|t| t as u8);
    let layer = match num("layer", 0.0) as u8 {
        0 => Layer::Opaque,
        1 => Layer::Cutout,
        _ => return Err("layer must be 0 (opaque) or 1 (cutout)".into()),
    };
    let facing = (num("facing", 0.0) as u8).min(3);
    let top = flag("top", false);
    let orient = Orient { tilt: num("tilt", 0.0).clamp(-1.0, 1.0) as i8, turn: (num("turn", 0.0) as u8).min(3) };
    let (shape, model, layer) = match text("shape").unwrap_or("cube") {
        "cube" => (Shape::Cube, ModelKind::None, layer),
        // Plants are drawn with the cutout layer's alpha test.
        "cross" => (Shape::Cross, ModelKind::None, Layer::Cutout),
        "slab" => (Shape::Model, ModelKind::Slab(top), layer),
        "stairs" => (Shape::Model, ModelKind::Stairs(facing, top), layer),
        "fence" => (Shape::Model, ModelKind::Fence, layer),
        "pane" => (Shape::Model, ModelKind::Pane, layer),
        "post" => (Shape::Model, ModelKind::Post(orient), layer),
        "boxes" => (Shape::Model, ModelKind::Boxes(game_boxes(v)?, orient), layer),
        s => return Err(format!("unknown shape {s:?}")),
    };
    // A cube turned: its faces' textures go round with it.
    let (tex, uvt) = if shape == Shape::Cube && orient != Orient::default() { crate::shapes::turn_cube(tex, uvt, orient) } else { (tex, uvt) };
    let cross = shape == Shape::Cross;
    let opaque = shape == Shape::Cube && layer == Layer::Opaque;
    // Slabs and stairs keep light out (they make roofs) and are lit inside, like the built-in
    // ones; thin things (fences, panes, posts, a game's boxes) let it through.
    let blocks_light = opaque || matches!(model, ModelKind::Slab(_) | ModelKind::Stairs(..));
    let opacity = num("opacity", if blocks_light { 15.0 } else { 0.0 }).clamp(0.0, 15.0) as u8;
    Ok(Block {
        name: leak(name),
        label: leak(text("label").unwrap_or(name)),
        state: leak(text("state").unwrap_or("")),
        shape,
        model,
        layer,
        tex,
        uvt,
        opaque,
        solid: flag("solid", !cross),
        opacity: if opaque { 15 } else { opacity },
        emit: num("emit", 0.0).clamp(0.0, 15.0) as u8,
        tint: flag("tint", false),
        anim: (num("anim", if cross { 2.0 } else { 0.0 }) as u8).min(2),
        cull_self: flag("cull_self", false),
        leaves: false,
        replaceable: flag("replaceable", cross),
        placeable: flag("placeable", true),
        breakable: flag("breakable", true),
        double: num("double", 0.0).clamp(0.0, 254.0) as u8,
        climbable: flag("climbable", false),
    })
}

/// The most boxes a game's block can be made of.
pub const MAX_BOXES: usize = 16;

/// A game block's own boxes (`"boxes"`): each [x0, y0, z0, x1, y1, z1] on the 1/16 grid, inside
/// its cell and not empty. Kept for the life of the thread, like the rest of its description.
fn game_boxes(v: &Json) -> Result<&'static [[u8; 6]], String> {
    let list = v.get("boxes").and_then(Json::as_arr).ok_or("a boxes shape needs boxes")?;
    if list.is_empty() || list.len() > MAX_BOXES {
        return Err(format!("boxes: 1 to {MAX_BOXES} of them"));
    }
    let mut out = Vec::with_capacity(list.len());
    for b in list {
        let a = b.as_arr().filter(|a| a.len() == 6).ok_or("boxes: each is [x0, y0, z0, x1, y1, z1]")?;
        let mut c = [0u8; 6];
        for (o, x) in c.iter_mut().zip(a) {
            let x = x.as_f64().filter(|x| (0.0..=16.0).contains(x) && x.fract() == 0.0).ok_or("boxes: corners are whole sixteenths, 0 to 16")?;
            *o = x as u8;
        }
        if (0..3).any(|k| c[k] >= c[k + 3]) {
            return Err("boxes: each box's far corner must be past its near one".into());
        }
        out.push(c);
    }
    Ok(Box::leak(out.into_boxed_slice()))
}

/// A string as JSON writes it (game blocks' names and labels can hold anything).
fn quoted(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

/// JSON description of the blocks in use for the UI (names, states, textures, shapes, flags).
pub fn registry_json() -> String {
    use crate::shapes::{FULL_SIDE, NO_TEX};
    let reg = registry();
    let shapes = &reg.shapes;
    let mut s = String::with_capacity(65536);
    s.push_str("{\"blocks\":[");
    for (i, b) in reg.blocks[..reg.count].iter().enumerate() {
        if i > 0 {
            s.push(',');
        }
        let shape = match b.shape {
            Shape::Air => "air",
            Shape::Cube => "cube",
            Shape::Cross => "cross",
            Shape::Liquid => "liquid",
            Shape::Model => "model",
        };
        let kind = match b.model {
            ModelKind::None => "",
            ModelKind::Torch => "torch",
            ModelKind::WallTorch(_) => "wall_torch",
            ModelKind::Slab(_) => "slab",
            ModelKind::Stairs(..) => "stairs",
            ModelKind::Bed(..) => "bed",
            ModelKind::Fence => "fence",
            ModelKind::Pane => "pane",
            ModelKind::Post(_) => "post",
            ModelKind::Boxes(..) => "boxes",
        };
        // Small attachments (plants, torches) break at a touch and show as flat items.
        let small = matches!(b.shape, Shape::Cross) || matches!(b.model, ModelKind::Torch | ModelKind::WallTorch(_));
        // Sides solid enough to hang a torch on or stand one on (bit per face, +X -X +Y -Y +Z -Z).
        let sturdy = match &shapes.models[i] {
            _ if !b.solid => 0,
            Some(m) => (0..6).fold(0u8, |a, f| a | (((m.cover[f] == FULL_SIDE) as u8) << f)),
            None if b.shape == Shape::Cube => 63,
            None => 0,
        };
        s.push_str(&format!(
            "{{\"id\":{},\"name\":{},\"label\":{},\"state\":{},\"shape\":\"{}\",\"model\":\"{}\",\"layer\":{},\"tex\":[{},{},{},{},{},{}],\"uvt\":[{},{},{},{},{},{}],\"tint\":{},\"emit\":{},\"solid\":{},\"replaceable\":{},\"placeable\":{},\"breakable\":{},\"small\":{},\"double\":{},\"sturdy\":{},\"opacity\":{},\"cull_self\":{},\"anim\":{}",
            i, quoted(b.name), quoted(b.label), quoted(b.state), shape, kind, b.layer as u8, b.tex[0], b.tex[1], b.tex[2], b.tex[3], b.tex[4], b.tex[5],
            b.uvt[0], b.uvt[1], b.uvt[2], b.uvt[3], b.uvt[4], b.uvt[5], b.tint, b.emit, b.solid, b.replaceable, b.placeable, b.breakable, small, b.double, sturdy, b.opacity, b.cull_self, b.anim
        ));
        if b.climbable {
            s.push_str(",\"climbable\":true");
        }
        if let Some(m) = &shapes.models[i] {
            let list = |s: &mut String, key: &str, boxes: &[[u8; 6]]| {
                s.push_str(&format!(",\"{key}\":["));
                for (k, bx) in boxes.iter().enumerate() {
                    if k > 0 {
                        s.push(',');
                    }
                    s.push_str(&format!("[{},{},{},{},{},{}]", bx[0], bx[1], bx[2], bx[3], bx[4], bx[5]));
                }
                s.push(']');
            };
            list(&mut s, "boxes", &m.bounds);
            // What bodies collide with, where that's more (a fence is 1.5 high).
            if m.collide != m.bounds {
                list(&mut s, "collide", &m.collide);
            }
            // A fence or pane is drawn (an icon, in a hand) joined east and west, as it usually stands.
            let look = shapes.joined(i as u8).map_or(m, |j| &j[crate::shapes::JOIN_EAST_WEST]);
            if shapes.joins[i] != 0 {
                s.push_str(",\"joins\":true");
            }
            s.push_str(",\"parts\":[");
            for (k, p) in look.parts.iter().enumerate() {
                if k > 0 {
                    s.push(',');
                }
                let t = |f: usize| if p.faces[f].tex == NO_TEX { -1 } else { p.faces[f].tex as i32 };
                s.push_str(&format!(
                    "[{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{}]",
                    p.from[0], p.from[1], p.from[2], p.to[0], p.to[1], p.to[2],
                    t(0), t(1), t(2), t(3), t(4), t(5),
                    p.faces[0].uvt, p.faces[1].uvt, p.faces[2].uvt, p.faces[3].uvt, p.faces[4].uvt, p.faces[5].uvt
                ));
            }
            s.push(']');
        }
        s.push('}');
    }
    s.push_str("],\"textures\":[");
    for (i, n) in tex::NAMES.iter().enumerate() {
        if i > 0 {
            s.push(',');
        }
        s.push('"');
        s.push_str(n);
        s.push('"');
    }
    s.push_str("]}");
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_match_table() {
        assert_eq!(BLOCKS[GRASS as usize].name, "grass_block");
        assert_eq!(BLOCKS[WATER_B as usize].name, "water");
        assert_eq!(BLOCKS[TORCH_B as usize].name, "torch");
        assert_eq!(BLOCKS[RED_MUSHROOM_B as usize].name, "red_mushroom");
        assert_eq!(BLOCKS[SNOWY_GRASS as usize].name, "snowy_grass");
        assert_eq!(OPAQUE[STONE as usize], 1);
        assert_eq!(OPAQUE[OAK_LEAVES_B as usize], 0);
        assert_eq!(EMIT[GLOWSTONE_B as usize], 15);
        assert_eq!(tex::NAMES[tex::RED_MUSHROOM as usize], "red_mushroom");
        assert_eq!(BLOCKS[IRON_BLOCK_B as usize].name, "iron_block");
        assert_eq!(tex::NAMES[tex::IRON_BLOCK as usize], "iron_block");
        assert_eq!(BLOCKS[YELLOW_BED_B as usize].name, "yellow_bed");
        assert_eq!(tex::NAMES[tex::WALL_TORCH as usize], "wall_torch");
        assert_eq!(tex::NAMES[tex::YELLOW_BED_FOOT_END as usize], "yellow_bed_foot_end");
    }

    #[test]
    fn variants_fill_their_ranges() {
        // Every id below BLOCK_COUNT is a real block, and each (family, state) pair appears once.
        let mut seen = std::collections::HashSet::new();
        for b in BLOCKS.iter() {
            assert!(seen.insert((b.name, b.state)), "duplicate {}[{}]", b.name, b.state);
        }
        assert_eq!(BLOCKS[(WALL_TORCH_B + 3) as usize].state, "facing=west");
        assert_eq!(BLOCKS[bed_id(3, 3, true) as usize].name, "yellow_bed");
        assert_eq!(BLOCKS[bed_id(3, 3, true) as usize].state, "facing=west,part=head");
        assert_eq!(bed_id(3, 3, true) as usize, SLAB_B as usize - 1);
        assert_eq!(BLOCKS[slab_id(7, true) as usize].name, "sandstone_slab");
        assert_eq!(slab_id(7, true) as usize, STAIRS_B as usize - 1);
        assert_eq!(BLOCKS[stairs_id(5, 3, true) as usize].state, "facing=west,half=top");
        assert_eq!(stairs_id(5, 3, true) as usize, LOG_AXIS_B as usize - 1);
        assert_eq!(BLOCKS[log_id(2, 1) as usize].name, "spruce_log");
        assert_eq!(log_id(2, 1) as usize, EXTRA_B as usize - 1);
        assert_eq!(EXTRA_B as usize + EXTRA.len(), BLOCK_COUNT);
        assert_eq!(BLOCKS[EXTRA_B as usize].name, "orange_concrete");
        assert_eq!(BLOCKS[BLOCK_COUNT - 1].name, "neon_yellow");
        assert_eq!(tex::NAMES[tex::NEON_YELLOW as usize], "neon_yellow");
        assert_eq!(EMIT[BLOCK_COUNT - 1], 12);
        // One placeable variant per family.
        let mut families = std::collections::HashMap::new();
        for b in BLOCKS.iter().filter(|b| b.placeable) {
            assert!(families.insert(b.name, ()).is_none(), "{} placeable twice", b.name);
        }
        assert_eq!(LIT_INSIDE[slab_id(0, false) as usize], 1);
        assert_eq!(LIT_INSIDE[TORCH_B as usize], 0);
        assert!(!BLOCKS[BEDROCK as usize].breakable && !BLOCKS[WATER_B as usize].breakable && BLOCKS[STONE as usize].breakable);
    }

    /// A game's own blocks: a glowing cube, a plant, and a slab (both halves) that makes the cube.
    const GAME: &str = r#"[
        {"name":"marble","label":"Marble \"Polished\"","tex":[113,113,114,114,113,113],"emit":9,"breakable":false},
        {"name":"weed","shape":"cross","tex":[115,115,115,115,115,115]},
        {"name":"marble_slab","state":"type=bottom","shape":"slab","tex":[113,113,114,114,113,113],"double":187},
        {"name":"marble_slab","state":"type=top","shape":"slab","top":true,"placeable":false,"tex":[113,113,114,114,113,113],"double":187},
        {"name":"grate","layer":1,"cull_self":true,"tex":[116,116,116,116,116,116]}
    ]"#;

    #[test]
    fn game_blocks_follow_the_built_in_ones() {
        // (The registry is per thread: other tests running alongside keep the built-in blocks.)
        assert_eq!(set_game_blocks(GAME), Ok(5));
        let reg = registry();
        assert_eq!(reg.count, BLOCK_COUNT + 5);
        for i in 0..BLOCK_COUNT {
            assert_eq!((reg.blocks[i].name, reg.blocks[i].state), (BLOCKS[i].name, BLOCKS[i].state), "built-in block {i} moved");
        }
        let (marble, weed, slab, grate) = (GAME_FIRST, GAME_FIRST + 1, GAME_FIRST + 2, GAME_FIRST + 4);
        assert_eq!(block(marble as u8).name, "marble");
        assert_eq!((OPAQUE[marble], SOLID[marble], EMIT[marble], OPACITY[marble]), (1, 1, 9, 15));
        assert!(!block(marble as u8).breakable);
        assert_eq!((SHAPE[weed], SOLID[weed], LAYER[weed], OPACITY[weed]), (SHAPE_CROSS, 0, Layer::Cutout as u8, 0));
        assert!(block(weed as u8).replaceable && block(weed as u8).anim == 2);
        assert_eq!((SHAPE[slab], LIT_INSIDE[slab], block(slab as u8).double), (SHAPE_MODEL, 1, marble as u8));
        let bottom = reg.shapes.models[slab].as_ref().expect("a slab has a model");
        assert_eq!((bottom.cover[3], bottom.cover[2]), (crate::shapes::FULL_SIDE, 0), "a bottom slab fills its underside only");
        assert_eq!((OPAQUE[grate], OPACITY[grate], reg.shapes.cover[grate]), (0, 0, [0; 6]));
        // Past them, ids are unknown and act like stone.
        let unknown = GAME_FIRST + 5;
        assert_eq!((OPAQUE[unknown], SOLID[unknown], SHAPE[unknown]), (1, 1, SHAPE_CUBE));
        // The UI's description has them, labels written safely.
        let text = registry_json();
        let parsed = json::parse(&text).expect("registry JSON parses");
        let listed = parsed.get("blocks").and_then(Json::as_arr).unwrap();
        assert_eq!(listed.len(), BLOCK_COUNT + 5);
        assert_eq!(listed[marble].get("label").and_then(Json::as_str), Some("Marble \"Polished\""));
        assert_eq!(listed[slab].get("model").and_then(Json::as_str), Some("slab"));
        assert_eq!(listed[BEDROCK as usize].get("breakable").and_then(Json::as_bool), Some(false));

        // The same list again is the same registry (a host and its client on one thread).
        assert_eq!(set_game_blocks(GAME), Ok(5));
        assert!(std::ptr::eq(reg, registry()));
        // None: the built-in blocks alone.
        assert_eq!(set_game_blocks("[]"), Ok(0));
        assert_eq!((registry().count, OPAQUE[marble], EMIT[marble]), (BLOCK_COUNT, 1, 0));
    }

    #[test]
    fn wrong_game_blocks_are_refused() {
        let before = registry();
        for bad in [
            "{}",
            r#"[{"tex":[1,1,1,1,1,1]}]"#,
            r#"[{"name":"a","tex":[1,1,1]}]"#,
            r#"[{"name":"a","tex":[1,1,1,1,1,1024]}]"#,
            r#"[{"name":"a","shape":"sphere","tex":[1,1,1,1,1,1]}]"#,
            r#"[{"name":"a","layer":2,"tex":[1,1,1,1,1,1]}]"#,
            r#"[{"name":"a","shape":"slab","double":250,"tex":[1,1,1,1,1,1]}]"#,
        ] {
            assert!(set_game_blocks(bad).is_err(), "{bad} should be refused");
        }
        let too_many = format!("[{}]", vec![r#"{"name":"a","tex":[1,1,1,1,1,1]}"#; GAME_MAX + 1].join(","));
        assert!(set_game_blocks(&too_many).unwrap_err().contains("too many"));
        let most = format!("[{}]", vec![r#"{"name":"a","tex":[1,1,1,1,1,1]}"#; GAME_MAX].join(","));
        assert_eq!(set_game_blocks(&most), Ok(GAME_MAX));
        assert_eq!(registry().count, 255, "ids up to 254");
        assert_eq!(set_game_blocks("[]"), Ok(0));
        assert!(std::ptr::eq(before, registry()));
    }
}
