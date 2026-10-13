import { math, type DamageEvent, type Entity, type GameContext, type IconRef, type MenuHandle, type Player, type Vec3 } from '@platform';
import { combatDamage, frontOf, guardMods } from './items/combat';
import { addArmor } from './items/armor';
import { bus } from './run/bus';
import { crossbowMods } from './items/crossbow';
import { meleeMods } from './items/melee';
import { baseOf } from './items/rarity';
import { setSpearMods } from './items/spear';
import { spellMods } from './items/staff';
import { burn, burning, chill, chillOf, frozen, stunned } from './items/status';

/**
 * Blessings: after each wave cleared, every fighter picks one of three, and keeps it for the rest
 * of the fight, so no two runs play alike. They come common, rare or epic (the rarer offered less
 * often), some can be taken again for more (Berserker II), and many are made for a weapon: a
 * blessing for what you carry is offered more often (Riposte with the gladius, Wildfire with fire,
 * Tremor with the warhammer). They're written here against the damage and death events and the
 * arsenal's hooks (`guardMods`, `spellMods`, …); the server calls `offer` when a wave is won (the
 * menu comes up a moment later, or on B), `settle` when the next begins (anyone who didn't choose
 * is given one of theirs), and `wave` to refresh what lasts a wave. Each one taken is told on the
 * bus (`blessed`) for the HUD to show.
 */
interface Blessing {
  name: string;
  text: string;
  icon: IconRef;
  rarity: 'common' | 'rare' | 'epic';
  /** How many times it can be taken (default once). */
  stacks?: number;
  /** The weapons it's made for (bases): carrying one, it's offered more often. */
  for?: string[];
  /** What it does the moment it's chosen (each time, for one that stacks; the lasting ones are in the listeners below). */
  apply?(game: GameContext, p: Player): void;
}

export const BLESSINGS = {
  vampire: { name: 'Vampiric', rarity: 'rare', text: 'Every monster you slay heals you a heart', icon: 'heart' },
  berserk: { name: 'Berserker', rarity: 'common', stacks: 3, text: 'Your melee blows hit 30% harder', icon: 'iron_sword' },
  hawkeye: {
    name: 'Hawkeye',
    rarity: 'common',
    for: ['bow', 'crossbow'],
    text: 'Arrows and bolts hit 60% harder, and a kill with one gives two back',
    icon: 'bow',
    apply: (_g, p) => void p.inventory.give('arrow', 12),
  },
  fleet: { name: 'Fleet-footed', rarity: 'common', text: 'Run 20% faster, and roll twice as often', icon: { block: 'ice' }, apply: (_g, p) => boost(p) },
  ironskin: { name: 'Iron Skin', rarity: 'common', stacks: 2, text: 'Take 12% less damage (armour tops out at 48%)', icon: { block: 'iron_block' }, apply: (_g, p) => addArmor(p, 3) },
  stout: {
    name: 'Stout Heart',
    rarity: 'common',
    stacks: 3,
    text: 'Three more hearts, and fully healed',
    icon: 'health_potion',
    apply: (_g, p) => {
      p.maxHealth += 6;
      p.health = p.maxHealth;
    },
  },
  thorns: { name: 'Thorns', rarity: 'common', text: 'Whatever strikes you in melee takes 4 damage', icon: { block: 'cactus' } },
  volatile: { name: 'Volatile', rarity: 'rare', text: 'Monsters you slay burst, hurting those around them', icon: { block: 'redstone_ore' } },
  secondwind: { name: 'Second Wind', rarity: 'rare', text: 'Once a wave, a killing blow leaves you on two hearts instead', icon: { block: 'glowstone' } },
  storm: { name: 'Stormcaller', rarity: 'rare', text: 'Every fourth melee blow calls down lightning', icon: { block: 'neon_yellow' } },
  frost: { name: 'Frostbite', rarity: 'common', for: ['frost_staff'], text: 'Your melee blows frost monsters: four stacks freeze them', icon: { block: 'snow_block' } },
  executioner: { name: 'Executioner', rarity: 'rare', text: 'Double damage to monsters under a third of their health', icon: { item: 'battle_axe' } },
  bombardier: {
    name: 'Bombardier',
    rarity: 'common',
    text: 'Three bombs now, and two more every wave',
    icon: { item: 'bomb' },
    apply: (_g, p) => void p.inventory.give('bomb', 3),
  },
  wildfire: { name: 'Wildfire', rarity: 'rare', for: ['fire_staff', 'bow'], text: 'Fire burns half again as hot, and a burning monster that dies sets those about it alight', icon: { item: 'fire_staff' } },
  embers: { name: 'Ember Blades', rarity: 'rare', text: 'Your melee blows set monsters burning', icon: { block: 'lava' } },
  glacier: { name: 'Glacier', rarity: 'rare', for: ['frost_staff'], text: 'Your frost lasts twice as long, and frosted monsters take 30% more from you', icon: { item: 'frost_staff' } },
  conductor: { name: 'Conductor', rarity: 'rare', for: ['storm_wand', 'spear'], text: 'Lightning leaps to two more, and strikes 30% harder', icon: { item: 'storm_wand' } },
  riposte: { name: 'Riposte', rarity: 'rare', for: ['gladius'], text: 'A parry mends two hearts, and your next blow within 3 seconds strikes three times as hard', icon: { item: 'gladius' } },
  bulwark: { name: 'Bulwark', rarity: 'common', for: ['gladius'], text: 'Your guard stops everything from the front, and parries for longer', icon: { block: 'stone_bricks' } },
  quickdraw: { name: 'Quickdraw', rarity: 'common', stacks: 2, for: ['crossbow'], text: 'Crossbows span 30% faster, and their bolts go through two more', icon: { item: 'crossbow' } },
  assassin: { name: 'Assassin', rarity: 'rare', for: ['daggers'], text: 'Blows from behind, and on staggered or frozen monsters, strike 50% harder', icon: { item: 'daggers' } },
  tremor: { name: 'Tremor', rarity: 'rare', for: ['warhammer', 'greatsword', 'battle_axe'], text: 'Your slams reach half again as far, and stagger for longer', icon: { item: 'warhammer' } },
  boomerang: { name: 'Boomerang', rarity: 'common', for: ['spear'], text: 'Thrown spears come home sooner, and hit twice as hard on the way', icon: { item: 'spear' } },
  arcane: { name: 'Arcane Surge', rarity: 'rare', stacks: 2, for: ['fire_staff', 'frost_staff', 'storm_wand'], text: 'Spells come 25% faster', icon: { block: 'lapis_ore' } },
  bloodlust: { name: 'Bloodlust', rarity: 'epic', text: 'Each kill close on the last adds 10% to your damage, up to half again, for 4 seconds', icon: { block: 'neon_red' } },
  giant: { name: "Giant's Strength", rarity: 'epic', text: 'Your melee reaches a block further and throws monsters twice as far', icon: { block: 'gold_ore' } },
  momentum: { name: 'Momentum', rarity: 'common', text: 'A kill readies your roll again at once', icon: { block: 'neon_cyan' } },
} satisfies Record<string, Blessing>;

export type BlessingId = keyof typeof BLESSINGS;
const ALL = Object.keys(BLESSINGS) as BlessingId[];

/** How often each rarity is offered, against the others. */
const WEIGHT = { common: 6, rare: 3, epic: 1.2 };
/** Each rarity's colour (the HUD frames a blessing's icon in it). */
export const BLESSING_COLOR = { common: '#ffd36b', rare: '#7cc4ff', epic: '#c98bff' } as const;
/** Seconds after a wave's cleared that the blessings come up (the wave's card has its moment first; B brings them sooner). */
const OFFER_AFTER = 3.5;
/** A blessing made for a weapon they carry: this many times as likely. */
const AFFINITY = 2.5;
const ROMAN = ['', '', ' II', ' III', ' IV'];

/** Each fighter's blessings (and how many times each), the three they're offered (and its menu), and their counts. */
const owned = new Map<string, Map<BlessingId, number>>();
const offers = new Map<string, Offer>();
const meleeHits = new Map<string, number>();
const windUsed = new Set<string>();
/** Riposte's blow ready (until when), Bloodlust's kills (how many, until when). */
const riposte = new Map<string, number>();
const lust = new Map<string, { n: number; until: number }>();

export const level = (p: Player, id: BlessingId): number => owned.get(p.id)?.get(id) ?? 0;
export const has = (p: Player, id: BlessingId) => level(p, id) > 0;
export const blessingsOf = (p: Player): BlessingId[] => [...(owned.get(p.id)?.keys() ?? [])];

/** Fleet-footed's speed and quick rolls (roll's state: `abilities.ts`). */
function boost(p: Player) {
  p.speed = 1.2;
  const roll = p.abilities.roll as { quick?: boolean } | undefined;
  if (roll) roll.quick = true;
}

/** A fresh fight: nobody blessed; their bodies back to plain. */
export function resetBlessings() {
  const open = [...offers.values()];
  offers.clear();
  for (const o of open) o.menu?.close();
  owned.clear();
  meleeHits.clear();
  windUsed.clear();
  riposte.clear();
  lust.clear();
}

/** What a fighter's body is without blessings (their armour, health, speed), for arming them afresh. */
export function plainBody(p: Player) {
  owned.delete(p.id);
  const o = offers.get(p.id);
  offers.delete(p.id);
  o?.menu?.close();
  p.armor = 0;
  p.maxHealth = 20;
  p.health = 20;
  p.speed = 1;
  const roll = p.abilities.roll as { quick?: boolean } | undefined;
  if (roll) roll.quick = false;
}

/** A blessing's name at a level (Berserker II). */
const titled = (id: BlessingId, n: number) => BLESSINGS[id].name + (ROMAN[n] ?? '');

/** Give them a blessing (chosen from their three, or by the arena for them), or one more of one that stacks. */
export function grant(game: GameContext, p: Player, id: BlessingId, chosen: boolean) {
  const mine = owned.get(p.id) ?? new Map<BlessingId, number>();
  owned.set(p.id, mine);
  const b: Blessing = BLESSINGS[id];
  const n = (mine.get(id) ?? 0) + 1;
  if (n > (b.stacks ?? 1)) return;
  mine.set(id, n);
  b.apply?.(game, p);
  // (Off the offers first, so its menu closing isn't taken for putting the choice off.)
  const o = offers.get(p.id);
  offers.delete(p.id);
  o?.menu?.close();
  // (The HUD shows it, from the bus: a callout, its icon joining their blessings.)
  bus.emit('blessed', { player: p, id, name: titled(id, n), text: b.text, chosen });
  p.audio.play(`arena_bless_${b.rarity}`);
  const q = p.position;
  game.fx.burst({ x: q.x, y: q.y + 1, z: q.z }, { color: BLESSING_COLOR[b.rarity], count: b.rarity === 'epic' ? 50 : 30, speed: 3, gravity: -2, glow: 1 });
}

/** The key that brings the blessings back up, closed without choosing. */
export const BLESS_KEY = 'KeyB';

/** The weapons a fighter carries (bases), for the blessings made for them. */
function carried(p: Player): Set<string> {
  const out = new Set<string>();
  for (const s of p.inventory.slots) if (s) out.add(baseOf(s.item));
  return out;
}

/** Three blessings they can still take (others than `not`, if there are three), weighted by rarity and what they carry (in a menu, `after` seconds, until the next wave). */
export function offer(game: GameContext, p: Player, not: readonly BlessingId[] = [], after = OFFER_AFTER) {
  const arms = carried(p);
  const open = ALL.filter((id) => level(p, id) < ((BLESSINGS[id] as Blessing).stacks ?? 1));
  const fresh = open.filter((id) => !not.includes(id));
  const pool = (fresh.length >= 3 ? fresh : open).map((id) => {
    const b: Blessing = BLESSINGS[id];
    return { id, w: WEIGHT[b.rarity] * (b.for?.some((w) => arms.has(w)) ? AFFINITY : 1) };
  });
  const choices: BlessingId[] = [];
  while (choices.length < 3 && pool.length) {
    let t = game.rng.next() * pool.reduce((a, x) => a + x.w, 0);
    const i = Math.max(0, pool.findIndex((x) => (t -= x.w) <= 0));
    choices.push(pool.splice(i, 1)[0].id);
  }
  if (!choices.length) return;
  const o: Offer = { choices, menu: null };
  offers.set(p.id, o);
  if (!p.bot) game.clock.after(after, () => offers.get(p.id) === o && !o.menu && game.players.includes(p) && show(game, p, o));
}

/** They've a blessing still to choose. */
export const offered = (p: Player) => offers.has(p.id);

/** Their three drawn again (bought at the shop) and put up at once: false if they've none to choose. */
export function reroll(game: GameContext, p: Player): boolean {
  const o = offers.get(p.id);
  if (!o) return false;
  offers.delete(p.id);
  o.menu?.close();
  offer(game, p, o.choices, 0);
  if (!offers.has(p.id)) offers.set(p.id, o);
  return true;
}

interface Offer {
  choices: BlessingId[];
  menu: MenuHandle | null;
}

const RARITY_NAME = { common: 'Common', rare: 'Rare', epic: 'Epic' };

function show(game: GameContext, p: Player, o: Offer) {
  o.menu = p.hud.menu({
    title: 'Choose a blessing',
    subtitle: 'Yours for the rest of the fight',
    sections: [
      {
        entries: o.choices.map((id) => {
          const b: Blessing = BLESSINGS[id];
          const n = level(p, id) + 1;
          return { icon: b.icon, label: titled(id, n), detail: RARITY_NAME[b.rarity], note: b.text, onSelect: () => grant(game, p, id, true) };
        }),
      },
    ],
    // Closed without choosing: B brings it back, and when the wave begins one is chosen for them.
    onClose: () => {
      if (offers.get(p.id) !== o) return;
      o.menu = null;
      p.hud.toast('Press B to choose your blessing');
    },
  });
}

/** Between waves: B brings back the blessings of anyone who closed them without choosing. */
export function reopen(game: GameContext) {
  for (const p of game.players) {
    const o = offers.get(p.id);
    if (o && !o.menu && !p.bot && p.input.pressed(BLESS_KEY)) show(game, p, o);
  }
}

/** The next wave begins: anyone who didn't choose is given one of the three. */
export function settle(game: GameContext) {
  for (const p of game.players) {
    const o = offers.get(p.id);
    if (o) grant(game, p, o.choices[Math.floor(game.rng.next() * o.choices.length)], false);
  }
}

/** A new wave: Second Wind's back, and the Bombardier's bombs. */
export function wave(game: GameContext) {
  windUsed.clear();
  for (const p of game.players) if (has(p, 'bombardier')) p.inventory.give('bomb', 2);
}

const FWD = new math.Vector3(0, 0, -1);
const DOWN = new math.Vector3(0, -1, 0);

/** Lightning on a monster: a bolt from the sky, and whatever's about it hurt too. */
function lightning(game: GameContext, by: Player, on: Entity) {
  const q = on.position;
  const bolt = game.props.bolt({ color: '#cfe9ff', length: 18, width: 0.45, intensity: 7, flicker: 0.6 });
  bolt.position.set(q.x, q.y + 18, q.z);
  bolt.quaternion.setFromUnitVectors(FWD, DOWN);
  game.clock.after(0.22, () => bolt.remove());
  game.fx.burst({ x: q.x, y: q.y + 0.3, z: q.z }, { color: '#cfe9ff', count: 30, speed: 5, glow: 1, life: 0.4 });
  game.fx.shockwave({ x: q.x, y: q.y + 0.1, z: q.z }, 3, '#9fd4ff');
  game.audio.play('thunder', { at: q });
  for (const e of game.entities.near(q, 3)) {
    if (!e.alive) continue;
    e.damage(e === on ? 8 : 4, { source: by, knockback: 0.6, weapon: 'lightning', cause: 'lightning' });
  }
}

/** A slain monster bursting (Volatile). */
function burst(game: GameContext, by: Player, at: Vec3) {
  game.fx.burst({ x: at.x, y: at.y + 1, z: at.z }, { color: '#ff7a3a', count: 26, speed: 4, glow: 1, life: 0.5 });
  game.fx.shockwave({ x: at.x, y: at.y + 0.2, z: at.z }, 3, '#ff7a3a');
  game.audio.play('pop', { at });
  for (const e of game.entities.near(at, 3)) if (e.alive) e.damage(6, { source: by, knockback: 1.2, weapon: 'volatile', cause: 'explosion' });
}

/** A melee weapon's blow, or its slam (not a thorn, a burst or a fist). */
const meleeBlow = (game: GameContext, hit: DamageEvent) => (hit.cause === 'melee' || hit.cause === 'slam') && !!hit.weapon && game.items.get(hit.weapon)?.kind === 'melee';
/** An arrow or a bolt (a bow's or a crossbow's). */
const shot = (game: GameContext, hit: DamageEvent) => hit.cause === 'projectile' && !!hit.weapon && ['bow', 'gun'].includes(game.items.get(hit.weapon)?.kind ?? '');

/** The arsenal's hooks, as the blessings change them. */
function hooks() {
  guardMods.take = (p) => (has(p, 'bulwark') ? 0 : 1);
  guardMods.parry = (p) => (has(p, 'bulwark') ? 1.5 : 1);
  guardMods.parried = (game, p) => {
    if (!has(p, 'riposte')) return;
    p.heal(4);
    riposte.set(p.id, game.clock.now + 3);
    p.hud.pop('Riposte!', { color: '#ffd36b' });
  };
  spellMods.pace = (p) => 0.75 ** level(p, 'arcane');
  spellMods.chain = (p) => (has(p, 'conductor') ? 2 : 0);
  spellMods.fire = (p) => (has(p, 'wildfire') ? 1.5 : 1);
  spellMods.chillTime = (p) => (has(p, 'glacier') ? 6 : 3);
  crossbowMods.reload = (p) => 0.7 ** level(p, 'quickdraw');
  crossbowMods.pierce = (p) => 2 * level(p, 'quickdraw');
  meleeMods.reach = (p) => (has(p, 'giant') ? 1 : 0);
  meleeMods.slam = (p) => (has(p, 'tremor') ? 1.5 : 1);
  setSpearMods({ home: (p) => (has(p, 'boomerang') ? 2 : 1), back: (p) => (has(p, 'boomerang') ? 0.3 : 1) });
}

/** The blessings' lasting effects, on the game's damage and death events (after the arsenal's own: `combatDamage`). */
export function listen(game: GameContext) {
  hooks();
  game.events.on('damage', (hit) => {
    combatDamage(game, hit);
    if (hit.cancelled) return;
    const { target, source } = hit;
    // A fighter hitting a monster.
    if (target.kind === 'entity' && source && source !== 'world' && source.kind === 'player') {
      const p = source;
      const blow = meleeBlow(game, hit);
      if (blow && has(p, 'berserk')) hit.amount *= 1 + 0.3 * level(p, 'berserk');
      if (blow && has(p, 'giant')) hit.knockback *= 2;
      if (shot(game, hit) && has(p, 'hawkeye')) hit.amount *= 1.6;
      if (has(p, 'executioner') && target.health < target.maxHealth / 3) hit.amount *= 2;
      if (has(p, 'assassin') && (stunned(target) || frozen(target) || !frontOf(target, p))) hit.amount *= 1.5;
      if (has(p, 'glacier') && (chillOf(target) > 0 || frozen(target))) hit.amount *= 1.3;
      if (has(p, 'wildfire') && hit.cause === 'fire') hit.amount *= 1.5;
      if (has(p, 'conductor') && hit.cause === 'lightning') hit.amount *= 1.3;
      const l = lust.get(p.id);
      if (l && game.clock.now < l.until) hit.amount *= 1 + 0.1 * l.n;
      if (blow && (riposte.get(p.id) ?? 0) > game.clock.now) {
        riposte.delete(p.id);
        hit.amount *= 3;
      }
      if (blow && has(p, 'frost')) chill(game, target, 1, spellMods.chillTime(p));
      if (blow && has(p, 'embers')) burn(game, target, p, 2 * spellMods.fire(p), 3, 'embers');
      if (blow && has(p, 'storm')) {
        const n = (meleeHits.get(p.id) ?? 0) + 1;
        meleeHits.set(p.id, n % 4);
        if (n % 4 === 0) game.clock.after(0.05, () => target.alive && lightning(game, p, target));
      }
    }
    // A monster hitting a fighter.
    if (target.kind === 'player') {
      const p = target;
      if (source && source !== 'world' && source.kind === 'entity' && hit.cause === 'melee' && has(p, 'thorns') && source.alive) {
        const s = source;
        game.clock.after(0, () => s.alive && s.damage(4, { source: p, knockback: 0.4, weapon: 'thorns' }));
      }
      // Armour takes its share after this: a blow that would still be the last.
      if (has(p, 'secondwind') && !windUsed.has(p.id) && hit.amount * (1 - 0.04 * p.armor) >= p.health) {
        windUsed.add(p.id);
        hit.cancel();
        p.health = 4;
        p.protect(1.5);
        bus.emit('feat', { player: p, name: 'second_wind', text: 'Second wind' });
        p.audio.play('heal', { pitch: 0.8 });
        const q = p.position;
        game.fx.shockwave({ x: q.x, y: q.y + 0.1, z: q.z }, 4, '#ffe38a');
      }
    }
  });

  game.events.on('entityDeath', ({ entity, killer, weapon }) => {
    if (!killer || killer === 'world' || killer.kind !== 'player') return;
    const p = killer;
    if (has(p, 'vampire') && p.alive) p.heal(2);
    const kind = weapon ? game.items.get(weapon)?.kind : undefined;
    if ((kind === 'bow' || kind === 'gun') && has(p, 'hawkeye')) p.inventory.give('arrow', 2);
    if (has(p, 'volatile') && weapon !== 'volatile') {
      const at = { ...entity.position };
      game.clock.after(0.15, () => burst(game, p, at));
    }
    // Wildfire: the fire leaps to those about it.
    if (has(p, 'wildfire') && burning(entity)) {
      const q = entity.position;
      game.fx.burst({ x: q.x, y: q.y + 1, z: q.z }, { color: '#ff8a2a', count: 24, speed: 4, glow: 1.4, life: 0.5, gravity: -2 });
      for (const e of game.entities.near(q, 3.2)) if (e.alive && e !== entity) burn(game, e, p, 3 * 1.5, 3, 'wildfire');
    }
    if (has(p, 'momentum')) {
      const roll = p.abilities.roll as { cool?: number } | undefined;
      if (roll) roll.cool = 0;
    }
    if (has(p, 'bloodlust')) {
      const now = game.clock.now;
      const l = lust.get(p.id);
      const n = l && now < l.until ? Math.min(5, l.n + 1) : 1;
      lust.set(p.id, { n, until: now + 4 });
      if (n >= 2) p.hud.pop(`Bloodlust +${n * 10}%`, { color: '#ff5a5a' });
    }
  });
}
