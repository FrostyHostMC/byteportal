import type { IconRef, MenuEntry, MenuHandle, MenuOptions, Player } from '@platform';
import { Sprite } from './art';
import { ALL_SWORDS, ARMOR, CURRENCIES, CURRENCY_NAME, PICK_ITEMS, SWORD_ITEMS, swordItem, type Currency, type Match, type Member, type Team } from './state';

interface Offer {
  icon: IconRef;
  label: string;
  price: [Currency, number];
  note?: string;
  /** Already have it (highlighted, can't buy again). */
  owned?: boolean;
  /** Hand it over; false if there was no room. */
  buy(): boolean;
}

const ROMAN = ['I', 'II', 'III', 'IV'];
const PICK_NAMES = ['Wooden', 'Iron', 'Diamond'];
const PICK_PRICES: [Currency, number][] = [
  ['iron', 10],
  ['gold', 3],
  ['gold', 6],
];

/**
 * The shopkeeper's menu: blocks, weapons, armour, tools and team upgrades, paid for from the
 * shopper's own wallet. Each player has their own (several can shop at once); the team upgrades
 * are the whole team's, whoever pays. An offer of
 * an item shows it as each screen has it (`{ item }`); armour and the team upgrades, which aren't
 * items, show a sprite of the game's own.
 */
export class Shop {
  private open = new Map<Player, { handle: MenuHandle; shown: string }>();

  constructor(
    private m: Match,
    /** Gear or a team upgrade changed (re-apply armour and swords). */
    private upgraded: (t: Team) => void,
  ) {}

  /** Open the shop on this player's screen. */
  show(player: Player) {
    const me = this.m.memberOf(player);
    if (!me || this.open.has(player)) return;
    const handle = player.hud.menu({ ...this.contents(player, me), onClose: () => this.open.delete(player) });
    this.open.set(player, { handle, shown: stateKey(me) });
  }

  close(player: Player) {
    this.open.get(player)?.handle.close();
    this.open.delete(player);
  }

  closeAll() {
    for (const p of [...this.open.keys()]) this.close(p);
  }

  /** Keep prices greyed out correctly as wallets change (and upgrades a teammate bought). */
  refresh() {
    for (const [p, o] of this.open) {
      const me = this.m.memberOf(p);
      if (!me) this.close(p);
      else if (stateKey(me) !== o.shown) o.handle.update(this.contents(p, me));
    }
  }

  private give(p: Player, item: string, count = 1): boolean {
    const left = p.inventory.give(item, count);
    return left < count;
  }

  private offers(p: Player, me: Member): { title: string; offers: Offer[] }[] {
    const inv = p.inventory;
    const t = me.team;
    const sword = (tier: number, label: string, price: [Currency, number]): Offer => ({
      icon: { item: SWORD_ITEMS[tier] },
      label,
      price,
      note: `${[4, 5, 6, 7][tier] + (t.sharp ? 1 : 0)} damage`,
      owned: me.sword >= tier,
      buy: () => {
        for (const s of ALL_SWORDS) inv.take(s, inv.count(s));
        me.sword = tier;
        return this.give(p, swordItem(t, tier));
      },
    });
    const armor = (tier: number, label: string, icon: IconRef, price: [Currency, number]): Offer => ({
      icon,
      label,
      price,
      note: `Permanent · blocks ${ARMOR[tier] * 4}% of damage`,
      owned: me.armor >= tier,
      buy: () => {
        me.armor = tier;
        this.upgraded(t);
        return true;
      },
    });
    const pick: Offer =
      me.pick < 3
        ? {
            icon: { item: PICK_ITEMS[me.pick + 1] },
            label: `${PICK_NAMES[me.pick]} Pickaxe`,
            price: PICK_PRICES[me.pick],
            note: me.pick ? 'Upgrade · mines faster' : 'Mines end stone and wood fast',
            buy: () => {
              if (me.pick) inv.take(PICK_ITEMS[me.pick], inv.count(PICK_ITEMS[me.pick]));
              me.pick++;
              return this.give(p, PICK_ITEMS[me.pick]);
            },
          }
        : { icon: { item: 'diamond_pickaxe' }, label: 'Diamond Pickaxe', price: ['gold', 6], note: 'Fully upgraded', owned: true, buy: () => false };
    return [
      {
        title: 'Blocks',
        offers: [
          { icon: { item: `wool_${t.color}` }, label: 'Wool ×16', price: ['iron', 4], note: 'Cheap and quick to place', buy: () => this.give(p, `wool_${t.color}`, 16) },
          { icon: { item: 'planks' }, label: 'Oak Planks ×16', price: ['gold', 4], note: 'Sturdier than wool', buy: () => this.give(p, 'planks', 16) },
          { icon: { item: 'end_stone' }, label: 'End Stone ×12', price: ['iron', 24], note: 'Blast-proof; slow to mine by hand', buy: () => this.give(p, 'end_stone', 12) },
          { icon: { item: 'obsidian' }, label: 'Obsidian ×4', price: ['emerald', 4], note: 'Almost unbreakable', buy: () => this.give(p, 'obsidian', 4) },
        ],
      },
      {
        title: 'Weapons',
        offers: [
          sword(1, 'Stone Sword', ['iron', 10]),
          sword(2, 'Iron Sword', ['gold', 7]),
          sword(3, 'Diamond Sword', ['emerald', 4]),
          { icon: { item: 'bow' }, label: 'Bow', price: ['gold', 12], note: 'Hold left-click to draw', buy: () => this.give(p, 'bow') },
          { icon: { item: 'arrow' }, label: 'Arrows ×8', price: ['gold', 2], buy: () => this.give(p, 'arrow', 8) },
        ],
      },
      {
        title: 'Armor & tools',
        offers: [
          armor(1, 'Iron Armor', Sprite.iron_armor, ['gold', 12]),
          armor(2, 'Diamond Armor', Sprite.diamond_armor, ['emerald', 6]),
          pick,
          {
            icon: { item: 'shears' },
            label: 'Shears',
            price: ['iron', 20],
            note: 'Permanent · cuts through wool',
            owned: me.shears,
            buy: () => {
              me.shears = true;
              return this.give(p, 'shears');
            },
          },
        ],
      },
      {
        title: 'Utility',
        offers: [
          { icon: { item: 'golden_apple' }, label: 'Golden Apple', price: ['gold', 3], note: 'Regenerates 4 hearts over 5 s', buy: () => this.give(p, 'golden_apple') },
          { icon: { item: 'fire_charge' }, label: 'Fireball', price: ['iron', 40], note: 'Right-click to throw · blasts wool and wood', buy: () => this.give(p, 'fire_charge') },
        ],
      },
      {
        title: 'Team upgrades',
        offers: [
          {
            icon: 'diamond_sword',
            label: 'Sharpened Swords',
            price: ['diamond', 4],
            note: '+1 damage on every sword, the whole team\'s',
            owned: t.sharp,
            buy: () => {
              t.sharp = true;
              // The swords the team already carries get their edge too.
              for (const mate of t.members) {
                const bag = mate.player?.inventory;
                if (!bag) continue;
                for (let tier = 0; tier < 4; tier++) {
                  const n = bag.count(SWORD_ITEMS[tier]);
                  if (n) {
                    bag.take(SWORD_ITEMS[tier], n);
                    bag.give(swordItem(t, tier), n);
                  }
                }
              }
              this.upgraded(t);
              return true;
            },
          },
          {
            icon: Sprite.diamond_armor,
            label: `Reinforced Armor ${ROMAN[Math.min(3, t.prot)]}`,
            price: ['diamond', 2 ** (Math.min(3, t.prot) + 1)],
            note: t.prot >= 4 ? 'Fully upgraded' : 'Tougher armour for the whole team, for good',
            owned: t.prot >= 4,
            buy: () => {
              t.prot++;
              this.upgraded(t);
              return true;
            },
          },
          {
            icon: Sprite.golden_apple,
            label: 'Heal Pool',
            price: ['diamond', 1],
            note: 'The team regenerates on its island',
            owned: t.heal,
            buy: () => {
              t.heal = true;
              return true;
            },
          },
        ],
      },
    ];
  }

  private contents(p: Player, me: Member): MenuOptions {
    const w = me.wallet;
    const o = this.open.get(p);
    if (o) o.shown = stateKey(me);
    const sections = this.offers(p, me).map(({ title, offers }) => ({
      title,
      entries: offers.map((o): MenuEntry => {
        const [cur, n] = o.price;
        return {
          icon: o.icon,
          label: o.label,
          note: o.note,
          detail: o.owned ? 'Owned' : `${n} ${CURRENCY_NAME[cur][n === 1 ? 0 : 1]}`,
          active: o.owned,
          disabled: o.owned || w[cur] < n,
          onSelect: () => this.purchase(p, o),
        };
      }),
    }));
    return {
      title: 'Item Shop',
      subtitle: `You have ${w.iron} iron · ${w.gold} gold · ${w.diamond} ${CURRENCY_NAME.diamond[w.diamond === 1 ? 0 : 1].toLowerCase()} · ${w.emerald} ${CURRENCY_NAME.emerald[w.emerald === 1 ? 0 : 1].toLowerCase()}`,
      sections,
    };
  }

  private purchase(p: Player, o: Offer) {
    const me = this.m.memberOf(p);
    if (!me) return;
    const w = me.wallet;
    const [cur, n] = o.price;
    if (o.owned || w[cur] < n) return;
    if (!o.buy()) {
      p.hud.toast('Your hotbar is full');
      return;
    }
    w[cur] -= n;
    p.audio.play('buy');
    p.hud.toast(`Bought ${o.label}`);
    p.achieve('retail_therapy');
    this.open.get(p)?.handle.update(this.contents(p, me));
  }
}

/** What the shop shows: the wallet, and the team's upgrades. */
const stateKey = (me: Member) => [...CURRENCIES.map((c) => me.wallet[c]), me.team.sharp, me.team.prot, me.team.heal].join(',');
