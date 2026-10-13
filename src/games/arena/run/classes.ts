import type { GameContext, IconRef, MenuEntry, MenuHandle, Player } from '@platform';
import { INTRO_DONE_MSG } from '../maps/messages';
import { bus } from './bus';
import { baseOf } from './loot';
import { levelOf, savedXp } from './progression';
import { runs, state } from './state';

/**
 * Classes: what a fighter walks into the arena with, chosen as the run begins (a menu through the
 * countdown; someone arriving late gets a little while to choose), and kept for the run. Each has
 * its weapons and a perk of its own; the later ones unlock with levels (`progression.ts`).
 * Weapons the game doesn't have yet are given as something like them (`or`).
 */
export interface FighterClass {
  name: string;
  /** What it fights with, and its perk, as the menu says them. */
  text: string;
  perk: string;
  /** The level it unlocks at. */
  level: number;
  /** Its weapons and supplies: each item, how many, and what's given while the game hasn't that item. */
  kit: { item: string; count?: number; or?: string }[];
  /** Its body: armour points, hearts more (half-hearts), speed. */
  armor?: number;
  health?: number;
  speed?: number;
}

export const CLASSES = {
  gladiator: {
    name: 'Gladiator',
    text: 'Gladius and shield: block, parry, stand your ground',
    perk: 'Stalwart: armour from the start, and a potion',
    level: 1,
    kit: [{ item: 'gladius', or: 'stone_sword' }, { item: 'health_potion' }],
    armor: 4,
  },
  hunter: {
    name: 'Hunter',
    text: 'Bow, daggers and three bombs: strike from afar, finish up close',
    perk: 'Quarry: quicker, two more hearts, arrows that hit harder; a bow kill gives one back, and each wave brings a dozen and a bomb',
    level: 1,
    kit: [{ item: 'daggers', or: 'wooden_sword' }, { item: 'bow' }, { item: 'arrow', count: 48 }, { item: 'bomb', count: 3 }],
    health: 4,
    speed: 1.1,
  },
  berserker: {
    name: 'Berserker',
    text: 'A battle axe and three more hearts',
    perk: 'Bloodlust: every kill heals half a heart',
    level: 4,
    kit: [{ item: 'battle_axe' }],
    health: 6,
  },
  pyromancer: {
    name: 'Pyromancer',
    text: 'A fire staff and a bag of bombs: set the pit ablaze',
    perk: 'Kindling: a bomb more each wave, and your blasts hit harder; but a heart less',
    level: 8,
    kit: [{ item: 'fire_staff', or: 'wooden_sword' }, { item: 'bomb', count: 3 }],
    health: -2,
  },
} satisfies Record<string, FighterClass>;

export type ClassId = keyof typeof CLASSES;
export const CLASS_IDS = Object.keys(CLASSES) as ClassId[];
const isClass = (id: unknown): id is ClassId => typeof id === 'string' && id in CLASSES;
export const classOf = (p: Player): ClassId => {
  const c = runs.get(p.id)?.cls;
  return isClass(c) ? c : 'gladiator';
};

/** Someone arriving after the first wave may change their class for this long (their fly-over first). */
const LATE_CHOICE = 24;
/** Pyromancer: bombs each wave, and how much harder their blasts hit. */
const KINDLING = 1;
const KINDLING_BLAST = 1.15;
/** Hunter: arrows and a bomb each wave (the bomb for the crowds that close in), and how much harder their bow's (or crossbow's) shots hit. */
const QUIVER = 12;
const SNARE = 1;
const QUARRY_SHOT = 1.2;
const shotBy = (weapon: string | undefined) => !!weapon && (baseOf(weapon) === 'bow' || baseOf(weapon) === 'crossbow');

/** Whether they may take up a class (bots: any). */
export const unlocked = (p: Player, id: ClassId) => p.bot || levelOf(savedXp(p)) >= CLASSES[id].level;

/** The class they'd take up now: the one they last chose, if they still may, else the Gladiator. */
export function preferred(p: Player): ClassId {
  const last = p.store.get<string>('class');
  return isClass(last) && unlocked(p, last) ? last : 'gladiator';
}

/** What the class gives, item by item, as this game has them. */
function kitOf(game: GameContext, id: ClassId): { item: string; count: number }[] {
  const out: { item: string; count: number }[] = [];
  for (const k of CLASSES[id].kit as FighterClass['kit']) {
    const item = game.items.get(k.item) ? k.item : k.or;
    if (item) out.push({ item, count: k.count ?? 1 });
  }
  return out;
}

/** Equip `id`: its kit and its body, over what they had (the first time, from nothing). */
export function equip(game: GameContext, p: Player, id: ClassId) {
  const r = runs.get(p.id);
  if (!r) return;
  const was = isClass(r.cls) && r.cls !== id ? CLASSES[r.cls as ClassId] : null;
  if (was) {
    // Hand back the old kit (as much of it as they still have) and undo its body.
    for (const k of kitOf(game, r.cls as ClassId)) p.inventory.take(k.item, Math.min(k.count, p.inventory.count(k.item)));
    body(p, was, -1);
  }
  r.cls = id;
  for (const k of kitOf(game, id)) p.inventory.give(k.item, k.count);
  body(p, CLASSES[id], 1);
  p.inventory.select(0);
  if (!p.bot) p.store.set('class', id);
  bus.emit('classPicked', { player: p, cls: id });
}

function body(p: Player, c: FighterClass, sign: 1 | -1) {
  if (c.armor) p.armor = Math.max(0, p.armor + sign * c.armor);
  if (c.health) {
    p.maxHealth = Math.max(2, p.maxHealth + sign * c.health);
    p.health = sign > 0 ? p.maxHealth : Math.min(p.health, p.maxHealth);
  }
  if (c.speed) p.speed = sign > 0 ? c.speed : 1;
}

/** May they change class now: before the first wave, or just arrived after it. */
export function canChoose(game: GameContext, p: Player) {
  const r = runs.get(p.id);
  return state.phase === 'countdown' || (!!r && r.from > 0 && game.clock.now - r.armedAt < LATE_CHOICE);
}

const menus = new Map<string, MenuHandle>();
/** People whose class menu waits for their fly-over to end, and when it opens at the latest (by id). */
const waiting = new Map<string, number>();

/** Put the classes up on their screen once their fly-over's over (`after` seconds at the latest; sooner if their screen says it's done). */
export function offerClass(game: GameContext, p: Player, after: number) {
  if (!p.bot) waiting.set(p.id, game.clock.now + after);
}

/** Someone's class menu is still waiting for their fly-over. */
export const classWaiting = () => waiting.size > 0;
/** Who has chosen this run (the countdown moves on once everyone has). */
const chosen = new Set<string>();
export const hasChosen = (p: Player) => p.bot || chosen.has(p.id);

function entries(game: GameContext, p: Player): MenuEntry[] {
  const mine = classOf(p);
  return CLASS_IDS.map((id) => {
    const c: FighterClass = CLASSES[id];
    const first = kitOf(game, id)[0];
    const icon: IconRef = first ? { item: first.item } : 'wooden_sword';
    const open = unlocked(p, id);
    return {
      icon,
      label: c.name,
      note: `${c.text}. ${c.perk}.`,
      detail: open ? (id === mine ? 'Chosen' : '') : `LV ${c.level}`,
      active: open && id === mine,
      disabled: !open,
      onSelect: () => choose(game, p, id),
    };
  });
}

/** They chose `id` (from the menu: checked again here, as a screen can send anything). */
export function choose(game: GameContext, p: Player, id: ClassId) {
  if (!unlocked(p, id)) {
    p.hud.toast(`${CLASSES[id].name} unlocks at level ${CLASSES[id].level}`);
    return;
  }
  if (!canChoose(game, p)) {
    p.hud.toast('Your class is set for this run');
    return;
  }
  chosen.add(p.id);
  if (classOf(p) !== id) equip(game, p, id);
  p.audio.play('click');
  p.hud.toast(`${CLASSES[id].name}: ${CLASSES[id].perk}`);
  closeClassMenu(p);
}

/** Put the classes up on their screen (people only). */
export function showClassMenu(game: GameContext, p: Player) {
  if (p.bot) return;
  closeClassMenu(p);
  const m = p.hud.menu({
    title: 'Choose your class',
    subtitle: state.phase === 'countdown' ? 'Set for the run once the first wave begins' : 'Set for the run in a few seconds',
    sections: [{ entries: entries(game, p) }],
    onClose: () => {
      if (menus.get(p.id) === m) menus.delete(p.id);
      chosen.add(p.id);
      bus.emit('classSet', { player: p });
    },
  });
  menus.set(p.id, m);
}

export function closeClassMenu(p: Player) {
  const m = menus.get(p.id);
  menus.delete(p.id);
  m?.close();
}

/** The first wave's begun: anyone still choosing (or yet to) keeps what they have. */
export function closeClassMenus() {
  for (const m of [...menus.values()]) m.close();
  menus.clear();
  waiting.clear();
}

export function classesListen(game: GameContext) {
  bus.on('slain', ({ by, weapon }) => {
    if (!by) return;
    const c = classOf(by);
    if (c === 'berserker' && by.alive) by.heal(1);
    if (c === 'hunter' && shotBy(weapon)) by.inventory.give('arrow', 1);
  });
  bus.on('waveStart', () => {
    for (const p of game.players) {
      if (!p.alive) continue;
      if (classOf(p) === 'pyromancer') p.inventory.give('bomb', KINDLING);
      if (classOf(p) === 'hunter') {
        p.inventory.give('arrow', QUIVER);
        p.inventory.give('bomb', SNARE);
      }
    }
  });
  game.events.on('damage', (hit) => {
    const s = hit.source;
    if (hit.target.kind !== 'entity' || !s || s === 'world' || s.kind !== 'player') return;
    if (hit.cause === 'explosion' && classOf(s) === 'pyromancer') hit.amount *= KINDLING_BLAST;
    if (shotBy(hit.weapon) && classOf(s) === 'hunter') hit.amount *= QUARRY_SHOT;
  });
  // Their screen's fly-over is done (played out or skipped): their menu now.
  game.events.on('clientMessage', ({ player, name }) => {
    if (name === INTRO_DONE_MSG && waiting.has(player.id)) waiting.set(player.id, game.clock.now);
  });
  game.events.on('playerLeave', ({ player }) => {
    menus.delete(player.id);
    chosen.delete(player.id);
    waiting.delete(player.id);
  });
}

/** Menus whose fly-overs are over go up; someone late who didn't choose in time: their menu goes, and they keep what they have. */
export function classesUpdate(game: GameContext) {
  for (const [id, at] of waiting) {
    if (game.clock.now < at) continue;
    waiting.delete(id);
    const p = game.players.find((x) => x.id === id);
    if (p && canChoose(game, p)) showClassMenu(game, p);
  }
  for (const [id, m] of menus) {
    const p = game.players.find((x) => x.id === id);
    if (p && !canChoose(game, p)) {
      menus.delete(id);
      m.close();
    }
  }
}

/** A fresh run: nobody's chosen yet. */
export function resetClasses() {
  closeClassMenus();
  chosen.clear();
}
