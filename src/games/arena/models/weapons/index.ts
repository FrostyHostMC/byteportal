// Written by src/games/arena/tools/weapons/build.mjs: the arsenal's models, by item id (a rarity's own: `gladius_epic`).
import gladius from './gladius.glb?url';
import gladiusRare from './gladius_rare.glb?url';
import gladiusEpic from './gladius_epic.glb?url';
import gladiusLegendary from './gladius_legendary.glb?url';
import gladiusShield from './gladius_shield.glb?url';
import gladiusShieldRare from './gladius_shield_rare.glb?url';
import gladiusShieldEpic from './gladius_shield_epic.glb?url';
import gladiusShieldLegendary from './gladius_shield_legendary.glb?url';
import warhammer from './warhammer.glb?url';
import warhammerRare from './warhammer_rare.glb?url';
import warhammerEpic from './warhammer_epic.glb?url';
import warhammerLegendary from './warhammer_legendary.glb?url';
import spear from './spear.glb?url';
import spearRare from './spear_rare.glb?url';
import spearEpic from './spear_epic.glb?url';
import spearLegendary from './spear_legendary.glb?url';
import daggers from './daggers.glb?url';
import daggersRare from './daggers_rare.glb?url';
import daggersEpic from './daggers_epic.glb?url';
import daggersLegendary from './daggers_legendary.glb?url';
import greatsword from './greatsword.glb?url';
import greatswordRare from './greatsword_rare.glb?url';
import greatswordEpic from './greatsword_epic.glb?url';
import greatswordLegendary from './greatsword_legendary.glb?url';
import fireStaff from './fire_staff.glb?url';
import fireStaffRare from './fire_staff_rare.glb?url';
import fireStaffEpic from './fire_staff_epic.glb?url';
import fireStaffLegendary from './fire_staff_legendary.glb?url';
import frostStaff from './frost_staff.glb?url';
import frostStaffRare from './frost_staff_rare.glb?url';
import frostStaffEpic from './frost_staff_epic.glb?url';
import frostStaffLegendary from './frost_staff_legendary.glb?url';
import stormWand from './storm_wand.glb?url';
import stormWandRare from './storm_wand_rare.glb?url';
import stormWandEpic from './storm_wand_epic.glb?url';
import stormWandLegendary from './storm_wand_legendary.glb?url';
import crossbow from './crossbow.glb?url';
import crossbowRare from './crossbow_rare.glb?url';
import crossbowEpic from './crossbow_epic.glb?url';
import crossbowLegendary from './crossbow_legendary.glb?url';
import battleAxe from './battle_axe.glb?url';
import battleAxeRare from './battle_axe_rare.glb?url';
import battleAxeEpic from './battle_axe_epic.glb?url';
import battleAxeLegendary from './battle_axe_legendary.glb?url';
import pike from './pike.glb?url';
import pikeRare from './pike_rare.glb?url';
import pikeEpic from './pike_epic.glb?url';
import pikeLegendary from './pike_legendary.glb?url';
import diamondSword from './diamond_sword.glb?url';
import diamondSwordRare from './diamond_sword_rare.glb?url';
import diamondSwordEpic from './diamond_sword_epic.glb?url';
import diamondSwordLegendary from './diamond_sword_legendary.glb?url';
import bow from './bow.glb?url';
import bowRare from './bow_rare.glb?url';
import bowEpic from './bow_epic.glb?url';
import bowLegendary from './bow_legendary.glb?url';
import bowDrawn from './bow_drawn.glb?url';
import bowDrawnRare from './bow_drawn_rare.glb?url';
import bowDrawnEpic from './bow_drawn_epic.glb?url';
import bowDrawnLegendary from './bow_drawn_legendary.glb?url';
import bolt from './bolt.glb?url';
import leatherArmor from './leather_armor.glb?url';
import mailArmor from './mail_armor.glb?url';
import plateArmor from './plate_armor.glb?url';
import woodenSword from './wooden_sword.glb?url';
import stoneSword from './stone_sword.glb?url';
import ironSword from './iron_sword.glb?url';
import healthPotion from './health_potion.glb?url';

export const WEAPON_MODELS: Record<string, string> = {
  gladius: gladius,
  gladius_rare: gladiusRare,
  gladius_epic: gladiusEpic,
  gladius_legendary: gladiusLegendary,
  gladius_shield: gladiusShield,
  gladius_shield_rare: gladiusShieldRare,
  gladius_shield_epic: gladiusShieldEpic,
  gladius_shield_legendary: gladiusShieldLegendary,
  warhammer: warhammer,
  warhammer_rare: warhammerRare,
  warhammer_epic: warhammerEpic,
  warhammer_legendary: warhammerLegendary,
  spear: spear,
  spear_rare: spearRare,
  spear_epic: spearEpic,
  spear_legendary: spearLegendary,
  daggers: daggers,
  daggers_rare: daggersRare,
  daggers_epic: daggersEpic,
  daggers_legendary: daggersLegendary,
  greatsword: greatsword,
  greatsword_rare: greatswordRare,
  greatsword_epic: greatswordEpic,
  greatsword_legendary: greatswordLegendary,
  fire_staff: fireStaff,
  fire_staff_rare: fireStaffRare,
  fire_staff_epic: fireStaffEpic,
  fire_staff_legendary: fireStaffLegendary,
  frost_staff: frostStaff,
  frost_staff_rare: frostStaffRare,
  frost_staff_epic: frostStaffEpic,
  frost_staff_legendary: frostStaffLegendary,
  storm_wand: stormWand,
  storm_wand_rare: stormWandRare,
  storm_wand_epic: stormWandEpic,
  storm_wand_legendary: stormWandLegendary,
  crossbow: crossbow,
  crossbow_rare: crossbowRare,
  crossbow_epic: crossbowEpic,
  crossbow_legendary: crossbowLegendary,
  battle_axe: battleAxe,
  battle_axe_rare: battleAxeRare,
  battle_axe_epic: battleAxeEpic,
  battle_axe_legendary: battleAxeLegendary,
  pike: pike,
  pike_rare: pikeRare,
  pike_epic: pikeEpic,
  pike_legendary: pikeLegendary,
  diamond_sword: diamondSword,
  diamond_sword_rare: diamondSwordRare,
  diamond_sword_epic: diamondSwordEpic,
  diamond_sword_legendary: diamondSwordLegendary,
  bow: bow,
  bow_rare: bowRare,
  bow_epic: bowEpic,
  bow_legendary: bowLegendary,
  bow_drawn: bowDrawn,
  bow_drawn_rare: bowDrawnRare,
  bow_drawn_epic: bowDrawnEpic,
  bow_drawn_legendary: bowDrawnLegendary,
  bolt: bolt,
  leather_armor: leatherArmor,
  mail_armor: mailArmor,
  plate_armor: plateArmor,
  wooden_sword: woodenSword,
  stone_sword: stoneSword,
  iron_sword: ironSword,
  health_potion: healthPotion,
};
