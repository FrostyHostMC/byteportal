import type * as THREE from 'three';
import { shownSlots, type Cosmetic } from '../cosmetics';
import type { CosmeticSlot } from '../api/types';
import type { VoxelWorld } from '@engine/voxel_engine.js';
import type { FigureSignals } from '../api/client';
import { Models, Skins } from '../api/models';
import type { ItemDefinition, ModelSpec, SharedDefinition } from '../api/types';
import { avatarLook } from '../avatar';
import type { Content } from '../content';
import type { ClipFrame } from '../sim/entities';
import { freshMemory } from '../sim/movement';
import type { PlayerFrame } from '../sim/player';
import type { SimFrame } from '../sim/sim';
import type { GameHud } from '../ui/hudkit';
import type { PlayerCamera } from './camera';
import type { FigureFrame } from './entities';

/** What other players' figures and name tags need of the runtime. */
export interface AvatarsParts {
  /** The game: its players' look (`player.model`, `player.skin`), and its name tags and health bars (`hud`). */
  def: SharedDefinition;
  /** The game's content: figure types are defined in it, and held items read from it. */
  content: Content;
  /** The first-person view: our own figure (third person) faces where it looks. */
  view: PlayerCamera;
  /** A first-person walker (default), not a game-driven camera: only then are players drawn as figures. */
  walker: boolean;
  /** The world's camera and blocks: in a shooter, a name shows only while nothing blocks the view to it. */
  camera: THREE.PerspectiveCamera;
  world: VoxelWorld;
  /** The HUD: name tags are its markers. */
  hud: GameHud;
  /** What a held item's kind makes its holder's figure do (its kit's `figure`, from the item's state). */
  figure(def: ItemDefinition, state: object | null): FigureSignals | null;
  /** A clip our own movement abilities started, shown on our figure until the host's word arrives. */
  ownClip(): ClipFrame | null;
  /** A cosmetic, by id (what players wear). */
  cosmetic(id: string): Cosmetic | undefined;
}

/**
 * Other players as figures (entities of the built-in `$player` type, made on this screen from their
 * frames), with their names above: their stable entity ids, hurt flashes, and the name tags shown.
 */
export class Avatars {
  private ids = new Map<string, number>();
  /** The cosmetics this game shows. */
  private slots: Set<CosmeticSlot>;
  private hurt = new Map<string, { health: number; flash: number }>();
  private tags = new Set<string>();

  constructor(private p: AvatarsParts) {
    this.slots = shownSlots(p.def);
  }

  /** The entity id a player's figure has (none yet: undefined). */
  idOf(player: string): number | undefined {
    return this.ids.get(player);
  }

  /**
   * A player's model: the game's for them (`player.setModel`), a skin it gave them (null: a box
   * humanoid in it), the game's for everyone (`player.model`, or its `player.skin`: null), or else
   * their avatar, in the game's uniform for them, their hair cut close under a hat they wear here.
   */
  modelOf(p: PlayerFrame): ModelSpec | null {
    const d = this.p.def.player;
    if (p.model) return p.model;
    if (p.skin) return null;
    if (d?.model) return d.model;
    if (d?.skin) return null;
    const hat = this.slots.has('hat') && (p.wear ?? []).some((w) => this.p.cosmetic(w)?.slot === 'hat');
    const key = `${p.avatar ?? ''}|${p.uniform ? JSON.stringify(p.uniform) : ''}|${hat ? 1 : 0}`;
    let model = this.bodies.get(key);
    if (!model) this.bodies.set(key, (model = Models.character({ ...avatarLook(p.avatar, p.uniform), ...(hat ? { hatHair: true } : {}) })));
    return model;
  }

  /** Avatars' models, by what makes them (they're asked for every frame). */
  private bodies = new Map<string, ModelSpec>();

  /**
   * The figure type for a player: their model (`modelOf`), else a box humanoid in their skin
   * (`player.setSkin`), else the game's player skin. Defined the first time it's needed.
   */
  type(p: PlayerFrame): string {
    const d = this.p.def.player;
    const content = this.p.content;
    // A model (theirs, the game's for everyone, their avatar): one figure type per model.
    // (A box humanoid on the rig: players' bodies are jointed, and wear what they wear.)
    const given = this.modelOf(p);
    const model = given && given.rig === 'humanoid' && !given.gltf ? { ...given, skeleton: true } : given;
    if (model) {
      const type = `$player:model:${JSON.stringify(model)}`;
      if (!content.entities.has(type)) content.defineEntity(type, { name: 'Player', model, hitbox: { width: 0.6, height: 1.8 }, health: 20, speed: 4.3 });
      return type;
    }
    const skin = p.skin ?? (d?.skin ? { uv: d.skin, atlas: d.skinAtlas } : { uv: Skins.player, atlas: undefined });
    const type = `$player:${skin.atlas ?? 'builtin'}:${skin.uv.join(',')}`;
    if (!content.entities.has(type)) {
      content.defineEntity(type, { name: 'Player', model: Models.humanoid({ skin: skin.uv, atlas: skin.atlas, skeleton: true }), hitbox: { width: 0.6, height: 1.8 }, health: 20, speed: 4.3 });
    }
    return type;
  }

  /**
   * Other players as figures, with their names above. `self` is whose eyes we see through (a
   * replay's player, not `live`: drawn only if `showSelf`, a camera away from their eyes), or none.
   */
  frames(f: SimFrame, me: PlayerFrame, self: string | null, live = true, showSelf = false): FigureFrame[] {
    const { def, view, hud } = this.p;
    const out: FigureFrame[] = [];
    const seen = new Set<string>();
    for (const other of f.players) {
      // Spectators aren't there to see (nor, from our own eyes, is our own figure while we watch).
      if (other.spectating) continue;
      // Only people on foot get a figure: a driver is their vehicle's model, but one steering it
      // from afar (`remote`) stands where they are and shows there (our own too, seen from the
      // vehicle, as the host has it). Our own shows in third person, where we're shown
      // (predicted) facing where we look.
      const mine = other.id === self;
      const remote = !!other.vehicle?.remote;
      if ((mine && !(live ? view.thirdPerson || remote : showSelf)) || !this.p.walker || (other.vehicle && !remote)) continue;
      const p = mine && live && !remote ? { ...me, view: { ...me.view, yaw: view.yaw, pitch: view.pitch } } : other;
      const type = this.type(p);
      let id = this.ids.get(p.id);
      if (id === undefined) this.ids.set(p.id, (id = -1 - this.ids.size));
      const cp = Math.cos(p.view.pitch);
      const eye = { x: p.x, y: p.y + 1.62, z: p.z };
      // A red flash when their health drops.
      const h = this.hurt.get(p.id) ?? { health: p.health, flash: 0 };
      // As strong as the hit: a quarter of their health or more flashes them red; a scratch off a
      // tough one (a hero under fire) barely tints them, so steady fire doesn't paint them red.
      if (p.health < h.health) h.flash = Math.max(h.flash, Math.min(1, 0.3 + (3 * (h.health - p.health)) / Math.max(1, p.maxHealth)));
      h.health = p.health;
      h.flash = Math.max(0, h.flash - 0.05);
      this.hurt.set(p.id, h);
      const held = p.hotbar?.slots[p.hotbar.selected]?.item ?? null;
      // What their held item's kind makes their figure do (its kit's `figure`, from the item's
      // state as the host shows it: a gun's aim and reload): the dead aim nothing.
      const heldDef = held ? this.p.content.items.get(held) : undefined;
      const mech = p.dead || !heldDef ? null : this.p.figure(heldDef, p.hand.state);
      // What they wear that this game shows: hats and back items on the figure, a title and tag colour on the name.
      const worn = (p.wear ?? []).map((w) => this.p.cosmetic(w)).filter((c): c is Cosmetic => !!c && this.slots.has(c.slot));
      out.push({
        id,
        player: p.id,
        type,
        x: p.x,
        y: p.y,
        z: p.z,
        vx: p.vx,
        vz: p.vz,
        yaw: p.view.yaw,
        look: { x: eye.x - Math.sin(p.view.yaw) * cp * 4, y: eye.y + Math.sin(p.view.pitch) * 4, z: eye.z - Math.cos(p.view.yaw) * cp * 4 },
        attacks: p.swings,
        raised: false,
        casting: false,
        glow: null,
        hurt: h.flash,
        dying: p.dead ? p.deathTime : -1,
        held,
        aim: mech?.aim ?? 0,
        posture: p.sliding ? 2 : p.sneaking ? 1 : 0,
        lean: p.lean ?? 0,
        air: !p.onGround && !p.flying && !p.inWater,
        sprint: p.sprinting,
        reloading: mech?.reloading ?? false,
        sights: mech?.sights ?? 0,
        clip: (mine && this.p.ownClip()) || p.clip || undefined,
        wear: worn.filter((c) => c.slot === 'hat' || c.slot === 'back').map((c) => c.id),
      });
      if (mine) continue;
      const tags = def.hud?.nameTags ?? 'always';
      if (tags === 'never' || p.dead) continue;
      const top = { x: p.x, y: p.y + (p.sliding ? 1.45 : p.sneaking ? 1.95 : 2.25), z: p.z };
      // In a shooter, names show only while nothing blocks the view (no finding people through walls).
      if (tags === 'sight') {
        const c = this.p.camera.position;
        if (!this.p.world.line_clear(c.x, c.y, c.z, top.x, top.y - 0.35, top.z)) continue;
      }
      const tag = `$name:${p.id}`;
      seen.add(tag);
      this.tags.add(tag);
      const bar = def.hud?.healthBars && p.maxHealth > 0 ? p.health / p.maxHealth : undefined;
      // (A game's colour for them, a team's, wins over their tag's.)
      const title = worn.find((c) => c.slot === 'title')?.text;
      hud.marker(tag, top, { label: p.name, sub: title, shape: 'dot', size: 3, color: p.color ?? worn.find((c) => c.slot === 'tag')?.color ?? '#ffffff', bar });
    }
    for (const tag of this.tags) {
      if (seen.has(tag)) continue;
      hud.marker(tag, null);
      this.tags.delete(tag);
    }
    return out;
  }
}

/**
 * This client's player before it's in the game (watching it before joining): a stand-in at the
 * spawn, for the camera (circling above it on the title screen) and the terrain around it.
 */
export function standIn(spawn: { x: number; y: number; z: number; yaw: number }, fov: number): PlayerFrame {
  const sp = spawn;
  return {
    id: '',
    name: '',
    x: sp.x,
    y: sp.y,
    z: sp.z,
    vx: 0,
    vy: 0,
    vz: 0,
    onGround: true,
    inWater: false,
    eyesInWater: false,
    inLava: false,
    flying: false,
    bob: 0,
    sneaking: false,
    sprinting: false,
    sliding: false,
    speed: 1,
    bot: false,
    view: { seq: 0, yaw: sp.yaw, pitch: 0 },
    health: 20,
    maxHealth: 20,
    mortal: false,
    dead: false,
    deathTime: 0,
    hotbar: null,
    hand: { state: null },
    camera: { p: [sp.x, sp.y + 1.62, sp.z], q: [0, 0, 0, 1], fov, follow: false },
    vehicle: null,
    creative: null,
    frozen: true,
    locked: false,
    canFly: false,
    swings: 0,
    ack: -1,
    move: freshMemory(),
    lead: 0,
    skin: null,
    model: null,
    color: null,
    ride: null,
    orbit: null,
  };
}
