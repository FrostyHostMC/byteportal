import type { ViewAnimation } from '@platform';
import type { Client, ClientKit, HeldItem, Node, ViewArm } from '@platform/client';
import { firstPerson } from '@platform/client/kits';
import { Mat4, Quat, Vec3 } from '@platform/client/math';
import type { CrossbowItem } from '../items/crossbow';
import type { ArmsMelee } from '../items/melee';
import { crossbowMove, meleeMove, type CrossbowShown } from '../items/moves';
import { rarityOf, shieldOf } from '../items/rarity';
import { armoryFx } from './fx';
import { boltSpots, heldExtras } from './held';
import type { ClientPart } from './part';

/**
 * The armory on each screen: the first-person view (the platform's kit, `fp`, which the Arena's
 * `client.ts` lists in place of `firstPerson.standard()`) with the Arena's own swings and holds;
 * the off hand (`client.view.item`): the gladius's shield, raised to guard, and the daggers'
 * twin; a ring round the crosshair (a charge, a span, a parry window); the guard, the warhammer's raised charge
 * and the spear raised to throw, the moment the button goes down (the host decides what they do);
 * and the crossbow's screen half (spanning shown as a reload, aiming as aiming down sights, other
 * players' figures shouldering it).
 */
export const fp = new firstPerson.FirstPersonKit({ styles: { staff: 'sword' } });
// (Development: screenshots reach it, to freeze a swing with `timeScale`.)
if (import.meta.env.DEV) (globalThis as { __fp?: unknown }).__fp = fp;

/** The Arena's first-person swings and poses (keys: `move` in blocks, `hand` and `wrist` in radians, pitch-yaw-roll). */
const ANIMS: Record<string, ViewAnimation> = {
  // The gladius: a short, punchy cut from the right, across and down.
  arena_slash: {
    duration: 0.3,
    keys: [
      { t: 0 },
      { t: 0.18, hand: [0.3, -0.15, -0.55], move: [0.08, 0.1, 0.04], ease: 'out' },
      { t: 0.42, hand: [-0.25, 0.3, 1.0], move: [-0.22, 0.06, -0.16], ease: 'in' },
      { t: 0.58, hand: [-0.35, 0.35, 1.25], move: [-0.28, 0.0, -0.1], ease: 'out' },
      { t: 1, ease: 'inOut' },
    ],
  },
  // The daggers: a quick stab straight out, the blade turned down at the end.
  arena_stab: {
    duration: 0.2,
    keys: [{ t: 0 }, { t: 0.35, wrist: [-1.25, 0, 0], move: [-0.14, 0.06, -0.34], ease: 'out' }, { t: 1, ease: 'inOut' }],
  },
  // The greatsword: laid back over to the right, swept wide and flat across to the left (mostly a roll, the blade level).
  arena_sweep: {
    duration: 0.55,
    keys: [
      { t: 0 },
      { t: 0.28, hand: [0.1, -0.35, -1.25], move: [0.18, 0.02, 0.06], ease: 'out' },
      { t: 0.5, hand: [-0.1, 0.3, 1.25], move: [-0.3, -0.04, -0.12], ease: 'in' },
      { t: 0.64, hand: [-0.12, 0.35, 1.45], move: [-0.36, -0.06, -0.08], ease: 'out' },
      { t: 1, ease: 'inOut' },
    ],
  },
  // The warhammer's plain swing: up and over, down in front.
  arena_hammer: {
    duration: 0.5,
    keys: [
      { t: 0 },
      { t: 0.38, hand: [0.55, -0.05, -0.15], move: [0.03, 0.14, 0.08], ease: 'out' },
      { t: 0.58, hand: [-0.95, 0.15, 0.2], move: [-0.06, -0.1, -0.2], ease: 'in' },
      { t: 1, ease: 'inOut' },
    ],
  },
  // The slam, from the raised charge: down hard into the ground.
  arena_slam: {
    duration: 0.6,
    keys: [
      { t: 0, hand: [0.42, -0.2, -0.45], move: [0.02, 0.08, 0.1] },
      { t: 0.22, hand: [-1.25, 0.15, 0.25], move: [-0.08, -0.22, -0.3], ease: 'in' },
      { t: 0.45, hand: [-1.2, 0.15, 0.25], move: [-0.08, -0.24, -0.28] },
      { t: 1, ease: 'inOut' },
    ],
  },
  // A staff thrust forward and up as the spell leaves it; the frost staff's, quicker and smaller.
  arena_cast: {
    duration: 0.4,
    keys: [{ t: 0 }, { t: 0.3, hand: [-0.45, 0.1, 0.1], move: [-0.06, 0.08, -0.24], ease: 'out' }, { t: 1, ease: 'inOut' }],
  },
  arena_cast_quick: {
    duration: 0.2,
    keys: [{ t: 0 }, { t: 0.35, hand: [-0.2, 0.05, 0.05], move: [-0.03, 0.03, -0.1], ease: 'out' }, { t: 1, ease: 'inOut' }],
  },
  // The wand flicked at the target.
  arena_flick: {
    duration: 0.28,
    keys: [{ t: 0 }, { t: 0.15, wrist: [0.35, 0, 0], ease: 'out' }, { t: 0.4, wrist: [-0.85, 0.1, 0], move: [-0.06, 0.04, -0.14], ease: 'in' }, { t: 1, ease: 'inOut' }],
  },
  // The spear's throw: the arm whips forward from the raised pose.
  arena_spear_throw: {
    duration: 0.35,
    keys: [
      { t: 0, hand: [0.22, 0, 0], move: [0.08, 0.1, 0.2] },
      { t: 0.35, hand: [-0.6, 0.1, 0], move: [-0.1, 0.0, -0.45], ease: 'in' },
      { t: 1, hand: [-0.2, 0, 0], move: [0, -0.5, -0.1], ease: 'out' },
    ],
  },
};

/** Poses held while a button is: the guard (the sword in close, the shield up), the hammer raised, the spear drawn back. */
const POSES: Record<string, ViewAnimation> = {
  arena_guard: { duration: 1, keys: [{ t: 0, hand: [0.15, 0.25, 0.35], move: [-0.04, -0.04, 0.1] }] },
  arena_raise: { duration: 1, keys: [{ t: 0, hand: [0.42, -0.2, -0.45], move: [0.02, 0.08, 0.1] }] },
  arena_aim: { duration: 1, keys: [{ t: 0, hand: [0.22, 0, 0], move: [0.08, 0.1, 0.2] }] },
};

/** Where the shield sits on the off hand (the view's space): at rest low at the left, and raised to guard. */
const SHIELD_REST = new Vec3(-0.52, -0.5, -0.78);
const SHIELD_UP = new Vec3(-0.22, -0.27, -0.62);
const SHIELD_SCALE = 0.38;
/**
 * The daggers' twin in the off hand: held low at the left, the hand just below the screen's edge,
 * the blade up and in toward the middle; every other stab it thrusts too.
 */
const TWIN_AT = new Vec3(-0.42, -0.6, -0.8);
const TWIN_SCALE = 0.62;
const TWIN_THRUST = new Vec3(0.1, 0.1, -0.3);
const TWIN_TIME = 0.2;

/** Development: a pose held as if its button were down (screenshots have no mouse): `__armoryPose('arena_guard')`. */
let forced: string | null = null;
if (import.meta.env.DEV) (globalThis as { __armoryPose?: unknown }).__armoryPose = (p: string | null) => void (forced = p);

/**
 * The ring round the crosshair: the warhammer's charge filling (amber, bright when full), the
 * crossbow spanning (pale), and a gold flash as a guard goes up that fades over its parry window,
 * so the timing can be learnt.
 */
const RING_CSS = `
.arena-ring { position: absolute; left: 50%; top: 50%; width: 46px; height: 46px; margin: -23px 0 0 -23px; opacity: 0; transition: opacity 0.12s; pointer-events: none; }
.arena-ring.on { opacity: 1; }
.arena-ring circle { fill: none; stroke-width: 3; }
.arena-ring .track { stroke: rgba(0, 0, 0, 0.35); }
.arena-ring .fill { stroke-linecap: round; transform: rotate(-90deg); transform-origin: 50% 50%; filter: drop-shadow(0 0 3px rgba(0, 0, 0, 0.6)); }
.arena-ring.full .fill { filter: drop-shadow(0 0 6px #ffb347); }
`;
const RING_R = 19;
const RING_LEN = 2 * Math.PI * RING_R;

function ring(client: Client) {
  client.hud.style(RING_CSS);
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 46 46');
  svg.classList.add('arena-ring');
  const circle = (cls: string) => {
    const c = document.createElementNS(ns, 'circle');
    c.setAttribute('cx', '23');
    c.setAttribute('cy', '23');
    c.setAttribute('r', String(RING_R));
    c.classList.add(cls);
    svg.append(c);
    return c;
  };
  circle('track');
  const fill = circle('fill');
  fill.setAttribute('stroke-dasharray', `${RING_LEN}`);
  client.hud.layer('arena.armory', 'middle').append(svg);
  let shown = '';
  /** Show `k` (0..1) of the ring in `color`, or hide it (null). */
  return (k: number | null, color = '#ffb347') => {
    const key = k === null ? '' : `${Math.round(k * 60)}|${color}`;
    if (key === shown) return;
    shown = key;
    svg.classList.toggle('on', k !== null);
    svg.classList.toggle('full', k !== null && k >= 1);
    if (k === null) return;
    fill.setAttribute('stroke', color);
    fill.setAttribute('stroke-dashoffset', String(RING_LEN * (1 - Math.min(1, k))));
  };
}

function armory(): ClientKit {
  let lmb = false;
  let rmb = false;
  let pose: string | null = null;
  let showRing: ReturnType<typeof ring> | null = null;
  /** How long the fire button's been held with a warhammer in hand, and since the guard went up (seconds). */
  let held = 0;
  let guardFor = 99;
  /** What's in the off hand (a shield, a twin dagger: by item), its node; how far a shield's raised (0..1), and a twin's thrust (seconds left) and turn. */
  let off: { id: string; node: Node } | null = null;
  let raised = 0;
  let thrust = 0;
  let stabs = 0;
  const qRest = new Quat().setFromAxisAngle(new Vec3(0, 1, 0), 0.5).multiply(new Quat().setFromAxisAngle(new Vec3(1, 0, 0), -0.15));
  const qUp = new Quat().setFromAxisAngle(new Vec3(0, 1, 0), 0.12);
  const qTwin = twinTurn();
  const at = new Vec3();
  const q = new Quat();
  /** The crossbow in hand (its loaded look), and the bolts shown in its groove. */
  let boltHost: HeldItem | null = null;
  let bolts: Node[] = [];

  const setBolts = (client: Client, host: HeldItem | null) => {
    if (host === boltHost) return;
    for (const b of bolts) client.view.free(b);
    bolts = [];
    boltHost = null;
    if (!host?.def) return;
    for (const p of boltSpots(host.def as CrossbowItem)) {
      const node = client.view.item('crossbow_bolt');
      if (!node) return;
      node.position.copy(p);
      host.node.add(node);
      bolts.push(node);
    }
    boltHost = host;
  };

  const setOff = (client: Client, id: string | null) => {
    if (off?.id === id) return;
    if (off) client.view.free(off.node);
    off = null;
    if (!id) return;
    const node = client.view.item(id);
    if (!node) return;
    client.view.root.add(node);
    off = { id, node };
  };
  /** The twin's hand: a copy of the player's own left arm (or their skin's), made again when their arms change. */
  let twinArm: TwinArm | null = null;
  const setTwinArm = (client: Client, on: boolean) => {
    const version = client.view.arms.version;
    if (twinArm && (!on || twinArm.version !== version)) {
      for (const n of twinArm.nodes) n.parent?.remove(n);
      if (twinArm.skin) client.view.free(twinArm.skin);
      twinArm = null;
    }
    if (on && !twinArm) twinArm = makeTwinArm(client);
  };

  return {
    name: 'arena.armory',
    setup(client) {
      for (const [name, anim] of Object.entries({ ...ANIMS, ...POSES })) fp.define(name, anim);
      showRing = ring(client);
    },
    controls(_client, c) {
      lmb = c.active && c.button(0);
      rmb = c.active && c.button(2);
    },
    frame(client, dt) {
      const me = client.me;
      const id = me.hand.item;
      const def = id ? (client.item(id) as ArmsMelee | undefined) : undefined;
      const melee = def?.kind === 'melee' && !me.dead;
      // What's held up while the button is: the host decides what comes of it.
      let want: string | null = null;
      if (melee && def.guard && rmb) want = 'arena_guard';
      else if (melee && def.slam && lmb) want = 'arena_raise';
      else if (melee && def.throw && rmb) want = 'arena_aim';
      if (forced) want = forced;
      if (want !== pose) {
        if (want === 'arena_guard') guardFor = 0;
        pose = want;
        fp.pose(want, { ease: want ? 0.08 : 0.14 });
      }
      // The ring: a hammer's charge, a crossbow spanning, a guard's parry window.
      held = melee && def.slam && lmb ? held + dt : 0;
      guardFor += dt;
      const span = (me.held?.state as { reload?: number } | undefined)?.reload ?? -1;
      if (melee && def.slam && held > def.slam.min) showRing?.(Math.min(1, (held - def.slam.min) / (def.slam.charge - def.slam.min)));
      else if (melee && def.guard && pose === 'arena_guard' && guardFor < def.guard.parry + 0.15) showRing?.(1 - guardFor / (def.guard.parry + 0.15), '#ffe28a');
      else if (span >= 0) showRing?.(span, '#e8e2d4');
      else showRing?.(null);
      // The crossbow's bolt in its groove while it's spanned (gone as it's loosed, back as it's spanned again).
      const hand = client.view.held;
      const xbow = hand?.def?.kind === 'gun' && !!(hand.def as CrossbowItem).ammo ? hand : null;
      setBolts(client, xbow);
      const loaded = (me.held?.state as { mag?: number } | undefined)?.mag === 1;
      for (const b of bolts) b.visible = loaded;
      // The off hand: the gladius's shield (raised behind the guard), the daggers' twin.
      const twin = melee && !!def.backstab && !!id;
      setOff(client, melee && def.guard && id ? shieldOf(rarityOf(id)) : twin ? id : null);
      if (!off) return setTwinArm(client, false);
      const bob = me.bob.amount * Math.sin(me.bob.phase) * 0.02;
      off.node.visible = fp.visible;
      if (twin) {
        // Every other stab, the twin goes in too.
        for (const e of client.events) if (e.t === 'use' && ++stabs % 2 === 0) thrust = TWIN_TIME;
        thrust = Math.max(0, thrust - dt);
        const k = Math.sin((1 - thrust / TWIN_TIME) * Math.PI) * (thrust > 0 ? 1 : 0);
        off.node.position.copy(TWIN_AT).addScaledVector(TWIN_THRUST, k);
        off.node.position.y += bob;
        off.node.quaternion.copy(qTwin);
        off.node.scale.setScalar(TWIN_SCALE);
        setTwinArm(client, true);
        if (twinArm) placeTwinArm(twinArm, off.node.position, qTwin, fp.visible);
        return;
      }
      setTwinArm(client, false);
      raised += ((pose === 'arena_guard' ? 1 : 0) - raised) * Math.min(1, dt * 16);
      at.copy(SHIELD_REST).lerp(SHIELD_UP, raised);
      at.y += bob * (1 - raised);
      off.node.position.copy(at);
      off.node.quaternion.copy(q.copy(qRest).slerp(qUp, raised));
      off.node.scale.setScalar(SHIELD_SCALE);
    },
    dispose() {
      off?.node.parent?.remove(off.node);
      off = null;
      for (const n of twinArm?.nodes ?? []) n.parent?.remove(n);
      twinArm = null;
      for (const b of bolts) b.parent?.remove(b);
      bolts = [];
    },
  };
}

/**
 * The twin's arm: a humanoid player's own left arm (their model's upper arm, forearm and fist,
 * copied: the first-person view keeps the originals for two-handed holds), or a skin's left arm.
 */
interface TwinArm {
  version: number;
  arm: ViewArm | null;
  skin: Node | null;
  nodes: Node[];
}

function makeTwinArm(client: Client): TwinArm {
  const arms = client.view.arms;
  const version = arms.version;
  if (arms.humanoid) {
    const L = arms.humanoid.L;
    // (A node is a three.js object: copying it shares its meshes' geometry and materials.)
    const copy = (n: Node) => (n as unknown as { clone(): Node }).clone();
    const arm: ViewArm = { ...L, upper: copy(L.upper), forearm: copy(L.forearm), fist: copy(L.fist) };
    const nodes = [arm.upper, arm.forearm, arm.fist];
    client.view.root.add(...nodes);
    return { version, arm, skin: null, nodes };
  }
  const skin = arms.arm({ mirror: true });
  if (skin) client.view.root.add(skin);
  return { version, arm: null, skin, nodes: skin ? [skin] : [] };
}

/** The arms' size in the view (the first-person kit's, for a sword-sized thing in the fist: its grip's scale over the model's, a little bigger than life). */
const TWIN_ARM_SCALE = (0.62 / 0.52) * 1.2;
/** From the twin's fist back toward the elbow, and how far the whole arm runs (off the screen's edge). */
const TWIN_ELBOW = new Vec3(-0.65, -0.65, 0.6).normalize();
const TWIN_REACH = 0.55;

/** The twin's arm on its grip: the fist round the handle, the arm straight back from it off the screen. */
function placeTwinArm(t: TwinArm, grip: Vec3, gripQ: Quat, visible: boolean) {
  for (const n of t.nodes) n.visible = visible;
  if (t.skin) {
    // A skin's arm: a 4 x 12 px box along y, the shoulder end up: from the fist back along the elbow's way.
    t.skin.quaternion.setFromUnitVectors(new Vec3(0, 1, 0), TWIN_ELBOW);
    t.skin.position.copy(grip).addScaledVector(TWIN_ELBOW, (6 / 16) * 0.8);
    t.skin.scale.setScalar(0.8);
    return;
  }
  const h = t.arm!;
  const k = TWIN_ARM_SCALE;
  // The fist turned with the dagger, its grip on the handle.
  h.fist.quaternion.copy(gripQ).multiply(new Quat().copy(h.gripQ).invert());
  h.fist.position.copy(grip).sub(new Vec3().copy(h.grip).multiplyScalar(k).applyQuaternion(h.fist.quaternion));
  h.fist.scale.setScalar(k);
  // The forearm back from the wrist, the upper arm on in line, drawn out to reach off the screen.
  const y = TWIN_ELBOW;
  const z = new Vec3(0, 0, 1).applyQuaternion(h.fist.quaternion);
  z.addScaledVector(y, -z.dot(y)).normalize();
  h.forearm.quaternion.setFromRotationMatrix(new Mat4().makeBasis(new Vec3().crossVectors(y, z), y, z));
  h.forearm.position.copy(h.fist.position).addScaledVector(y, h.wrist.length() * k);
  h.forearm.scale.setScalar(k);
  const upperLen = h.elbow.length() * k;
  const stretch = Math.max(1, (TWIN_REACH - h.wrist.length() * k) / Math.max(1e-3, upperLen));
  h.upper.quaternion.copy(h.forearm.quaternion);
  h.upper.position.copy(h.forearm.position).addScaledVector(y, upperLen * stretch);
  h.upper.scale.set(k, k * stretch, k);
}

/** The twin dagger's turn: its blade (+z) up and in toward the middle, its flat (+y) to the eye. */
function twinTurn(): Quat {
  const axis = new Vec3(0.3, 0.85, -0.42).normalize();
  const face = new Vec3(0.55, 0.05, 0.8);
  face.addScaledVector(axis, -face.dot(axis)).normalize();
  const x = new Vec3().crossVectors(face, axis);
  return new Quat().setFromRotationMatrix(new Mat4().makeBasis(x, face, axis));
}

/**
 * The crossbow's screen half (its kind is `gun`: `items/crossbow.ts`): how aimed it is (the right
 * button, eased), spanning shown as the gun pose's reload, figures shouldering it, and its slower
 * steps while aiming, predicted as the host has them.
 */
function crossbowScreen(): ClientKit {
  let want = false;
  let aim = 0;
  return {
    name: 'arena.crossbow',
    kind: 'gun',
    controls(_client, c) {
      want = c.active && c.button(2);
    },
    frame(_client, dt) {
      aim += ((want ? 1 : 0) - aim) * Math.min(1, dt * 12);
    },
    move: (def, controls) => crossbowMove(def, controls),
    heldState(client, _item, def) {
      const st = client.me.hand.state as CrossbowShown | null;
      const arrows = client.me.hotbar?.slots.reduce((n, s) => n + (s?.item === 'arrow' ? s.count : 0), 0) ?? 0;
      return { aim, sprint: client.me.sprinting ? 1 : 0, slide: 0, reload: st?.r ?? -1, shells: 0, sight: 'iron', zoom: (def as CrossbowItem | undefined)?.zoom ?? 1.5, mag: st?.l ? 1 : 0, reserve: arrows };
    },
    figureSignals(state) {
      const s = state as CrossbowShown | null;
      return { aim: 1, sights: s?.a ? 1 : 0, reloading: (s?.r ?? -1) >= 0 };
    },
  };
}

/**
 * The melee weapons' screen half: how they slow their holder (guarding, charging), predicted as the
 * host has it; and a raised guard, from the host's word, as the figure's `sights` (a melee weapon
 * has none of its own: `client/held.ts` brings the shield up by it).
 */
const meleeScreen: ClientKit = {
  name: 'arena.melee',
  kind: 'melee',
  move: (def, controls) => meleeMove(def as ArmsMelee, controls),
  figureSignals: (state) => ((state as { g?: boolean } | null)?.g ? { sights: 1 } : { sights: 0 }),
};

export const armoryClient: ClientPart = { name: 'armoryClient', kits: [armory(), crossbowScreen(), meleeScreen, heldExtras(), armoryFx()] };
