import { math, Models, type CharacterLook, type Entity, type GameContext, type IconRef, type MenuEntry, type MenuHandle, type Player, type Prop, type PropModel } from '@platform';
import { RUN_MODELS } from '../models/run';
import { offered, reroll } from '../blessings';
import { ARMOR, armorOf, type ArmorId } from '../items';
import { bus } from './bus';
import { FEATHER, FEATHER_PRICE } from './downed';
import { addGold, gold, spend } from './gold';
import { deliver, forgeNext, forgeWeapon, RARITY, rarityOf, WARES, type Ware } from './loot';
import { canPart, carriesAsGood, fits, sellPrice, sellSlot } from './pack';
import { map, runs, state } from './state';
import { addUsable } from './use';

/**
 * The shop: between waves a merchant sets up his stall at the map's `shop` spot, and E at it opens
 * his wares (a menu on that fighter's screen, paid from their own purse, `gold.ts`): the armory's
 * catalog (`items/catalog.ts`, each on sale from its wave: weapons, armour, supplies), a Phoenix
 * Feather, the forge (a weapon carried, to its next rarity), all handed over through `loot.ts`,
 * and three other blessings to choose from (dearer each time); and he buys what they carry
 * (`pack.ts`), to make room. What won't fit their hotbar is greyed out, saying so. He packs up
 * when the next wave begins.
 */

export { FEATHER_PRICE } from './downed';
/** Three other blessings: this much, and this much more each time in a run. */
export const REROLL_PRICE = 150;
const REROLL_MORE = 75;
export const rerollPrice = (p: Player) => REROLL_PRICE + REROLL_MORE * (runs.get(p.id)?.rerolls ?? 0);
/** Big Spender: this much spent in one run. */
const BIG_SPENDER = 1000;
/** Midas: this much held at once. */
const MIDAS = 1000;

const MERCHANT: CharacterLook = { build: 'heavy', skin: '#c28a5c', hair: 'long', hairColor: '#2a1c14', facialHair: 'beard', eyes: '#3a2a1c', top: 'tunic', topColor: '#7a2f8a', accent: '#e8b923', bottom: 'trousers', bottomColor: '#3a2a4a', shoes: 'boots', shoeColor: '#2a1c14', hat: 'fedora' };

/** Each fighter's open shop, and what it showed (only changes go out). */
const open = new Map<string, { menu: MenuHandle; key: string; subtitle: string }>();
let merchant: Entity | null = null;
let stall: { model: PropModel; prop: Prop | null } | null = null;
/** How far behind his counter's front the merchant stands (blocks). */
const BEHIND = 0.6;
const UP = new math.Vector3(0, 1, 0);

interface Offer {
  icon: IconRef;
  label: string;
  note?: string;
  price: number;
  /** Already theirs (highlighted, not for sale again). */
  owned?: boolean;
  /** Not yet: why. */
  locked?: string;
  /** Room for it in their hotbar (default yes: armour's worn, the forge works in place). */
  fits?: boolean;
  /** Hand it over: false if it couldn't be (a full hotbar). */
  buy(): boolean;
  /** What the bus is told was bought. */
  id: string;
}

/** Kinds of item that aren't weapons (what's left is: blades, bows, staves). */
const NOT_WEAPONS = new Set(['misc', 'consumable', 'throwable']);
const weaponsHeld = (game: GameContext, p: Player) =>
  p.inventory.slots.flatMap((s) => {
    const kind = s && game.items.get(s.item)?.kind;
    return s && kind && !NOT_WEAPONS.has(kind) ? [s.item] : [];
  });

/** Waves won so far: what's on sale. */
const cleared = () => (state.phase === 'fighting' ? state.wave - 1 : state.wave);

function give(p: Player, item: string, count: number): boolean {
  const left = p.inventory.give(item, count);
  return left < count;
}

function wareOffer(game: GameContext, p: Player, w: Ware): Offer {
  const def = game.items.get(w.item);
  const count = w.count ?? 1;
  const name = def?.name ?? w.item;
  const weapon = w.kind === 'weapon';
  // (Armour's worn, not carried: theirs once they wear it or better.)
  const owned = weapon ? p.inventory.count(w.item) > 0 || carriesAsGood(p, w.item) : w.kind === 'armor' && armorOf(p) >= (ARMOR[w.item as ArmorId]?.points ?? Infinity);
  return {
    id: w.item,
    icon: { item: w.item },
    label: count > 1 ? `${name} ×${count}` : name,
    note: w.note ?? (weapon ? weaponNote(game, w.item) : undefined),
    price: w.price,
    owned,
    locked: (w.from ?? 0) > cleared() ? `After wave ${w.from}` : undefined,
    fits: w.kind === 'armor' || fits(game, p, w.item, count),
    buy: () => deliver(game, p, w),
  };
}

/** A line about a weapon (damage, its kind), from its definition. */
function weaponNote(game: GameContext, item: string): string | undefined {
  const d = game.items.get(item) as { kind?: string; damage?: number | [number, number]; cooldown?: number } | undefined;
  if (!d) return undefined;
  const dmg = Array.isArray(d.damage) ? `${d.damage[0]}-${d.damage[1]}` : d.damage;
  if (d.kind === 'bow') return `Ranged · ${dmg} damage drawn · needs arrows`;
  return dmg !== undefined ? `${dmg} damage${d.cooldown ? ` · ${(1 / d.cooldown).toFixed(1)} swings a second` : ''}` : undefined;
}

function offers(game: GameContext, p: Player): { title: string; offers: Offer[] }[] {
  const wares = WARES.filter((w) => game.items.get(w.item));
  const feather: Offer = {
    id: FEATHER,
    icon: { item: FEATHER },
    label: 'Phoenix Feather',
    note: 'Carried, it takes a killing blow once and raises you in flame',
    price: FEATHER_PRICE,
    owned: p.inventory.count(FEATHER) > 0,
    fits: fits(game, p, FEATHER),
    buy: () => give(p, FEATHER, 1),
  };
  const forge = weaponsHeld(game, p).flatMap((item): Offer[] => {
    const f = forgeNext(item);
    if (!f) return [];
    return [
      {
        id: `forge:${item}`,
        icon: { item: f.item },
        label: `Forge ${game.items.get(item)?.name ?? item}`,
        note: `Into ${game.items.get(f.item)?.name ?? f.item} (${RARITY[rarityOf(f.item)].name})`,
        price: f.price,
        buy: () => forgeWeapon(game, p, item),
      },
    ];
  });
  const blessings: Offer = {
    id: 'reroll',
    icon: { block: 'glowstone' },
    label: 'Other blessings',
    note: offered(p) ? 'Three others to choose from instead' : 'Once a wave is won, before you choose its blessing',
    price: rerollPrice(p),
    locked: offered(p) ? undefined : 'Chosen this wave',
    buy: () => {
      const r = runs.get(p.id);
      if (!reroll(game, p)) return false;
      if (r) r.rerolls++;
      // (The shop makes way for them.)
      closeShopFor(p);
      return true;
    },
  };
  return [
    { title: 'Weapons', offers: wares.filter((w) => w.kind === 'weapon').map((w) => wareOffer(game, p, w)) },
    { title: 'Armour', offers: wares.filter((w) => w.kind === 'armor').map((w) => wareOffer(game, p, w)) },
    { title: 'Supplies', offers: [...wares.filter((w) => w.kind === 'consumable' || w.kind === 'ammo').map((w) => wareOffer(game, p, w)), feather] },
    { title: 'Blessings', offers: [blessings] },
    ...(forge.length ? [{ title: 'The Forge', offers: forge }] : []),
  ].filter((s) => s.offers.length);
}

/** What a ware that won't fit says. */
const FULL = 'Hotbar full · drop (X) or sell';

function contents(game: GameContext, p: Player) {
  const purse = gold(p);
  return {
    title: 'The Merchant',
    subtitle: subtitle(game, p),
    sections: [
      ...offers(game, p).map(({ title, offers: list }) => ({
        title,
        entries: list.map((o): MenuEntry => {
          const full = !o.owned && !o.locked && o.fits === false;
          return {
            icon: o.icon,
            label: o.label,
            note: o.locked ?? (full ? FULL : o.note),
            detail: o.owned ? 'Owned' : o.locked ? 'Soon' : `${o.price} gold`,
            active: o.owned,
            disabled: !!o.owned || !!o.locked || full || purse < o.price,
            onSelect: () => purchase(game, p, o.id),
          };
        }),
      })),
      { title: 'Sell', entries: sales(game, p) },
    ].filter((s) => s.entries.length),
  };
}

/** What they carry, each stack for what the merchant pays (their last weapon kept back). */
function sales(game: GameContext, p: Player): MenuEntry[] {
  return p.inventory.slots.flatMap((s, i): MenuEntry[] => {
    if (!s) return [];
    const name = game.items.get(s.item)?.name ?? s.item;
    const keep = !canPart(game, p, i);
    return [
      {
        icon: { item: s.item },
        label: s.count > 1 ? `${name} ×${s.count}` : name,
        note: keep ? 'Your last weapon: keep something to fight with' : undefined,
        detail: `+${sellPrice(game, s.item, s.count)} gold`,
        disabled: keep,
        onSelect: () => sell(game, p, i, s.item),
      },
    ];
  });
}

/** Sell the stack in `slot` to the merchant (if it's still `item`): the gold, or 0. */
export function sell(game: GameContext, p: Player, slot: number, item?: string): number {
  if (!shopOpen() || !p.alive) return 0;
  const g = sellSlot(game, p, slot, item);
  if (g) refresh(game, p);
  return g;
}

function subtitle(game: GameContext, p: Player) {
  const t = Math.max(0, Math.ceil(state.nextWaveAt - game.clock.now));
  return `You have ${gold(p)} gold · the next wave in ${t}s`;
}

/** What the shop shows them now: their purse, what they carry, their armour (the menu's redrawn when it changes). */
const shownKey = (p: Player) => `${gold(p)}|${armorOf(p)}|${p.inventory.slots.map((s) => (s ? `${s.item}:${s.count}` : '')).join(',')}`;

/** Buy what they chose, by its id (checked again here: a screen can send anything). */
export function purchase(game: GameContext, p: Player, id: string): boolean {
  if (!shopOpen() || !p.alive) return false;
  const o = offers(game, p)
    .flatMap((s) => s.offers)
    .find((x) => x.id === id);
  if (!o || o.owned || o.locked) return false;
  if (o.fits === false) {
    p.hud.toast(FULL);
    return false;
  }
  if (gold(p) < o.price) {
    p.hud.toast('Not enough gold');
    return false;
  }
  if (!o.buy()) {
    p.hud.toast(o.id.endsWith('_armor') ? 'You wear better already' : 'Your hotbar is full');
    return false;
  }
  spend(game, p, o.price);
  p.audio.play('buy');
  p.hud.toast(`Bought ${o.label}`);
  bus.emit('bought', { player: p, item: o.id, price: o.price });
  if ((runs.get(p.id)?.spent ?? 0) >= BIG_SPENDER) p.achieve('big_spender');
  refresh(game, p);
  return true;
}

/** Open the shop on their screen. */
export function showShop(game: GameContext, p: Player) {
  if (p.bot || !shopOpen()) return;
  open.get(p.id)?.menu.close();
  const menu = p.hud.menu({ ...contents(game, p), onClose: () => open.get(p.id)?.menu === menu && open.delete(p.id) });
  open.set(p.id, { menu, key: shownKey(p), subtitle: subtitle(game, p) });
  game.audio.play('merchant', { at: merchant?.position, volume: 0.8 });
}

/** Their shop closed (another menu's coming up). */
function closeShopFor(p: Player) {
  const o = open.get(p.id);
  open.delete(p.id);
  o?.menu.close();
}

function refresh(game: GameContext, p: Player) {
  const o = open.get(p.id);
  if (!o) return;
  o.key = shownKey(p);
  const c = contents(game, p);
  o.subtitle = c.subtitle;
  o.menu.update(c);
}

/** The merchant's here (between waves). */
export const shopOpen = () => merchant !== null && merchant.alive;

/** The merchant sets up at the map's shop spot, facing the middle. */
export function openShop(game: GameContext) {
  if (shopOpen()) return;
  const m = map();
  const at = m.shop ?? m.center;
  // The stall faces the middle; he stands behind its counter.
  const dx = m.center.x - at.x;
  const dz = m.center.z - at.z;
  const d = Math.hypot(dx, dz) || 1;
  if (stall) {
    stall.prop = game.props.spawn(stall.model, { position: { x: at.x, y: at.y, z: at.z } });
    stall.prop.quaternion.setFromAxisAngle(UP, Math.atan2(dx, dz));
  }
  const yaw = Math.atan2(-dx, -dz);
  merchant = game.entities.spawn('merchant', { x: at.x - (dx / d) * BEHIND, y: at.y + 0.05, z: at.z - (dz / d) * BEHIND }, { yaw, data: { scenery: true } });
  game.fx.burst({ x: at.x, y: at.y + 1.5, z: at.z }, { color: '#ffd23a', count: 40, speed: 3, gravity: -1, glow: 1 });
  game.audio.play('merchant', { at });
  game.hud.marker('arena.shop', merchant, { label: 'Shop', color: '#ffd23a', shape: 'diamond', edge: true, offset: { x: 0, y: 2.9, z: 0 } });
}

/** The next wave's begun: he packs up (and every shop closes). */
export function closeShop(game: GameContext) {
  for (const o of open.values()) o.menu.close();
  open.clear();
  game.hud.marker('arena.shop', null);
  stall?.prop?.remove();
  if (stall) stall.prop = null;
  if (!merchant) return;
  const q = merchant.position;
  game.fx.burst({ x: q.x, y: q.y + 1, z: q.z }, { color: '#ffd23a', count: 20, speed: 2, gravity: -1 });
  merchant.remove();
  merchant = null;
}

export function shopSetup(game: GameContext) {
  game.entities.define('merchant', {
    name: 'The Merchant',
    model: Models.character(MERCHANT),
    hitbox: { width: 0.7, height: 1.95 },
    health: 100,
    speed: 0,
    invulnerable: true,
    knockbackResistance: 1,
    // He keeps an eye on whoever's nearest.
    ai: (self) => {
      self.stop();
      const p = self.nearestPlayer();
      if (p && self.distanceTo(p) < 10) self.lookAt(p);
    },
  });
  game.items.define(FEATHER, { kind: 'misc', name: 'Phoenix Feather', stack: 1 });
  stall = { model: game.props.gltf(RUN_MODELS.stall, { radius: 2 }), prop: null };
  addUsable({
    id: 'shop',
    at: () => (merchant?.alive ? { x: merchant.position.x, y: merchant.position.y + 1.2, z: merchant.position.z } : null),
    reach: 3.2,
    label: () => 'Shop',
    use: (g, p) => showShop(g, p),
  });
  // For trying the shop and the chest (development, or a server with cheats).
  game.commands.register('gold', {
    usage: '<amount>',
    help: 'Give yourself gold',
    cheat: true,
    run: ([n], g, p) => {
      const amount = Math.round(Number(n));
      if (!amount) throw new Error('How much?');
      addGold(g, p, amount, undefined, 'gift');
      return `${gold(p)} gold`;
    },
  });
  bus.on('gold', ({ player, total }) => {
    if (total >= MIDAS) player.achieve('midas');
  });
  game.events.on('playerLeave', ({ player }) => void open.delete(player.id));
}

/** Keep each open shop true to its fighter's purse and hotbar, and the time left. */
export function shopUpdate(game: GameContext) {
  for (const [id, o] of open) {
    const p = game.players.find((x) => x.id === id);
    if (!p || !o.menu.open) {
      open.delete(id);
      continue;
    }
    if (o.key !== shownKey(p)) refresh(game, p);
    const sub = subtitle(game, p);
    if (sub !== o.subtitle) {
      o.subtitle = sub;
      o.menu.update({ subtitle: sub });
    }
  }
}

/** A fresh fight: no merchant, nobody's armour bought. */
export function resetShop() {
  for (const o of open.values()) o.menu.close();
  open.clear();
  merchant = null;
  // (The restart took his stall.)
  if (stall) stall.prop = null;
}
