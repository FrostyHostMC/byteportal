import type { GameContext, Player } from '@platform';

/**
 * Armour: worn, not carried (bought, or walked over), each piece over the last; points as
 * `player.armor`'s (4% each), never past the Arena's cap together with whatever else gave them.
 */
export const ARMOR = {
  leather_armor: { name: 'Leather Armour', points: 2 },
  mail_armor: { name: 'Mail Armour', points: 4 },
  plate_armor: { name: 'Plate Armour', points: 7 },
} as const;
/**
 * The most armour a fighter in the Arena has, from everything together (worn, a class, Iron Skin):
 * 12 points, 48% off. Over it, armour does no more (`combat.ts` holds each blow to it, whatever
 * gave the points).
 */
export const ARMOR_CAP = 12;
/** Armour points added (or taken, `n` negative), never past the cap. */
export const addArmor = (p: Player, n: number) => void (p.armor = Math.max(0, Math.min(ARMOR_CAP, p.armor + n)));
export type ArmorId = keyof typeof ARMOR;
/** What each fighter wears (its points), by player. */
const worn = new WeakMap<Player, number>();
export const armorOf = (p: Player): number => worn.get(p) ?? 0;

/** Put on a piece of armour (if it's better than what they wear): their armour goes up by the difference. */
export function wearArmor(game: GameContext, p: Player, id: ArmorId): boolean {
  const was = worn.get(p) ?? 0;
  const now = ARMOR[id].points;
  if (now <= was) return false;
  worn.set(p, now);
  addArmor(p, now - was);
  game.audio.play('arena_armor', { at: p.position });
  p.hud.toast(`${ARMOR[id].name}: ${now * 4}% less damage taken`);
  return true;
}

/** Fresh for a fight: nothing worn (their armour's set back to nothing as they're armed). */
export const shedArmor = (p: Player) => void worn.delete(p);
