import type { Bot, GameContext, Player } from '../../src/platform';
import type { Headless } from '../../src/platform/host/headless';
import { bus } from '../../src/games/arena/run/bus';
import { addGold, gold } from '../../src/games/arena/run/gold';
import { GOLD_PER_COST, waveBonus } from '../../src/games/arena/run/coins';
import { FEATHER_PRICE, purchase, REROLL_PRICE, rerollPrice, sell, shopOpen, showShop } from '../../src/games/arena/run/shop';
import { sellPrice } from '../../src/games/arena/run/pack';
import { settle } from '../../src/games/arena/blessings';
import { ARMOR, armorOf } from '../../src/games/arena/items';
import { WARES } from '../../src/games/arena/items/catalog';
import { PRICE, ROLL_TIME, rollChest } from '../../src/games/arena/run/chest';
import { BLEED, FEATHER, isDowned, REVIVE } from '../../src/games/arena/run/downed';
import { hypeValue } from '../../src/games/arena/run/hype';
import { choose, classOf, CLASSES } from '../../src/games/arena/run/classes';
import { award, levelOf, progressOf, savedXp, xpForLevel } from '../../src/games/arena/run/progression';
import { map, state } from '../../src/games/arena/run/state';
import { finalWave, waveSpec } from '../../src/games/arena/run/director';
import { spawnMonster } from '../../src/games/arena/run/spawn';
import { DIFFICULTY } from '../../src/games/arena/run/difficulty';
import { check, launch } from './_harness';

/** The end screen's word (the HUD's `arena-end` widget, its newest): Victory, Defeated, The arena claims you. */
const ended = (h: Headless) => (h.find('hud', 'widget').filter((c) => c.args[0] === 'arena-end').at(-1)?.args[1] as { word?: string } | undefined)?.word;

/**
 * Probe: the run's pieces one at a time. Gold (coins spilled and picked up, champions and goblins
 * worth more, Gold Rush, the wave's bonus and the rake), the shop (the merchant between waves,
 * armour, locks, the feather), the mystery chest (a weapon from a roll, and the chest flying off),
 * going down and being revived, bleeding out, the last one standing, the Phoenix Feather, the
 * crowd's hype and its Favour, classes and their locks, XP and levels, and on past the last wave
 * into the endless ones for a best.
 * `node scripts/headless.mjs tests/headless/_arena-run.ts`
 */
const log = (r: string) => console.log(`  ${r}`);

function scene(seed: number) {
  const h = launch('arena', { seed });
  const game = h.ctx as GameContext;
  const me = game.player as Player;
  me.maxHealth = 400;
  me.health = 400;
  return { h, game, me };
}

/** Into wave `n` now (the countdown and the class menu skipped), the arena cleared, and a monster held back so it lasts. */
function wave(game: GameContext, n: number) {
  game.commands.run(`/wave ${n}`);
  for (const e of game.entities.all()) if (!e.data.scenery) e.remove();
  state.queue = ['zombie'];
  state.spawnTimer = 1e9;
}

/** The wave's last monster let go: it's won once the arena's empty. */
function win(game: GameContext, by: Player) {
  state.queue = [];
  for (const e of game.entities.all()) if (!e.data.scenery) e.damage(9999, { source: by });
}

/** Monsters slain by someone at a spot (their coins spill there). */
function slay(game: GameContext, by: Player, type: string, at: { x: number; z: number }, data?: Record<string, unknown>) {
  const e = game.entities.spawn(type, { x: at.x, y: map().center.y - 1 + 0.05, z: at.z }, { data });
  e.damage(9999, { source: by });
  return e;
}

/** Stand still somewhere for a while (pickups come to you). */
const idle = (h: Headless, seconds: number) => h.run(seconds, { pilot: () => ({}) });

function coins() {
  const { h, game, me } = scene(1);
  wave(game, 1);
  const c = map().center;
  me.teleport({ x: c.x, y: c.y - 1, z: c.z + 6 });
  const at = { x: c.x, z: c.z + 7 };
  const start = gold(me);
  slay(game, me, 'zombie', at);
  idle(h, 2);
  const zombie = gold(me) - start;
  slay(game, me, 'zombie', at, { elite: true });
  idle(h, 2);
  const elite = gold(me) - start - zombie;
  state.twist = 'gold_rush';
  slay(game, me, 'zombie', at);
  idle(h, 2);
  const rush = gold(me) - start - zombie - elite;
  state.twist = null;
  const before = gold(me);
  slay(game, me, 'goblin', at);
  idle(h, 3);
  const goblin = gold(me) - before;
  // A boss's bounty, scattered on the bus.
  const pre = gold(me);
  bus.emit('coins', { at: { x: at.x, y: c.y - 1, z: at.z }, value: 300, by: me });
  idle(h, 4);
  const bounty = gold(me) - pre;
  log(`coins: a zombie ${zombie}, a champion ${elite}, in a Gold Rush ${rush}, a goblin's shower ${goblin}, a boss's bounty ${bounty}`);
  check(zombie === GOLD_PER_COST && elite === 3 * GOLD_PER_COST && rush === 2 * GOLD_PER_COST && goblin >= 90 && bounty >= 290, 'what monsters are worth');
  // Coins left lying when the wave's won are raked up; and the wave's bonus.
  slay(game, me, 'brute', { x: c.x + 12, z: c.z - 12 });
  idle(h, 0.5);
  const lying = h.sim.items.frame().filter((p) => p.item.startsWith('coin')).length;
  const was = gold(me);
  win(game, me);
  h.run(2, { pilot: () => ({}) });
  const paid = gold(me) - was;
  log(`wave won: ${lying} piles lying raked up, +${paid} (bonus ${waveBonus(1)})`);
  check(lying > 0 && paid >= waveBonus(1) + 6 * GOLD_PER_COST - 6 && h.sim.items.frame().every((p) => !p.item.startsWith('coin')), 'the wave pays its bonus and rakes up the coins');
}

function shop() {
  const { h, game, me } = scene(2);
  check(!shopOpen(), 'no merchant before the first wave is won');
  wave(game, 1);
  win(game, me);
  h.run(0.5);
  check(state.phase === 'intermission' && shopOpen(), `the merchant is in between waves (${state.phase})`);
  const merchant = game.entities.all().find((e) => e.type === 'merchant')!;
  const s = map().shop!;
  check(merchant.data.scenery && Math.hypot(merchant.position.x - s.x, merchant.position.z - s.z) < 1, 'behind his stall at the map\'s shop spot, as scenery');
  const g = gold(me);
  addGold(game, me, -g);
  check(!purchase(game, me, 'armor:1'), 'nothing without gold');
  addGold(game, me, 2000);
  const price = (id: string) => WARES.find((w) => w.item === id)!.price;
  const armor = me.armor;
  check(purchase(game, me, 'leather_armor') && me.armor === armor + ARMOR.leather_armor.points && armorOf(me) === ARMOR.leather_armor.points, `leather armour: ${me.armor}`);
  check(!purchase(game, me, 'mail_armor'), 'mail is on sale from wave 3');
  check(!purchase(game, me, 'leather_armor'), 'not twice');
  check(purchase(game, me, 'bow') && me.inventory.count('bow') === 1, 'a bow');
  check(!purchase(game, me, 'bow'), 'not a second');
  check(purchase(game, me, FEATHER) && me.inventory.count(FEATHER) === 1 && !purchase(game, me, FEATHER), 'one Phoenix Feather at a time');
  const spent = 2000 - gold(me);
  check(spent === price('leather_armor') + price('bow') + FEATHER_PRICE, `paid for: ${spent}`);
  // The forge: the bow up a rarity.
  check(purchase(game, me, 'forge:bow') && me.inventory.count('bow_rare') === 1 && me.inventory.count('bow') === 0, 'the bow forged to a rare one');
  // Other blessings: three others, put up at once, dearer each time; none once one's chosen.
  const blessings = () =>
    h
      .find('hud', 'menu')
      .filter((m) => (m.args[1] as { title: string }).title === 'Choose a blessing')
      .map((m) => (m.args[1] as { sections: { entries: { label: string }[] }[] }).sections[0].entries.map((e) => e.label));
  h.run(3.6);
  const first = blessings().at(-1) ?? [];
  let purse = gold(me);
  check(first.length === 3 && purchase(game, me, 'reroll') && purse - gold(me) === REROLL_PRICE, `other blessings for ${purse - gold(me)} gold`);
  h.run(0.1);
  const second = blessings().at(-1) ?? [];
  check(blessings().length === 2 && second.every((b) => !first.includes(b)), `three others: ${first.join(', ')} then ${second.join(', ')}`);
  purse = gold(me);
  check(rerollPrice(me) > REROLL_PRICE && purchase(game, me, 'reroll') && purse - gold(me) === REROLL_PRICE + 75, 'dearer the second time');
  settle(game);
  check(!purchase(game, me, 'reroll'), "none once this wave's blessing is chosen");
  // Ready (N): the next wave comes in a few seconds rather than the rest of the break.
  const left = state.nextWaveAt - game.clock.now;
  h.step(1 / 60, { pressed: ['KeyN'], down: ['KeyN'] });
  check(state.nextWaveAt - game.clock.now < 4 && left > 10, `ready: the next wave in ${(state.nextWaveAt - game.clock.now).toFixed(1)} s, not ${left.toFixed(1)}`);
  h.run(5);
  check((state.phase as string) === 'fighting' && !shopOpen() && !game.entities.all().some((e) => e.type === 'merchant'), 'he packs up when the next wave begins');
  log(`shop: armour to ${me.armor} points, a bow (forged rare) and a feather for ${spent} gold and the forge's price; open between waves only; N for ready cuts the break short`);
}

function chest() {
  const { h, game, me } = scene(3);
  wave(game, 1);
  addGold(game, me, -gold(me));
  check(!rollChest(game, me), 'no roll without the gold');
  addGold(game, me, 5000);
  // Stand back from it, so its gift stays to be seen.
  me.teleport({ x: map().center.x, y: map().center.y, z: map().center.z });
  const gifts: (string | null)[] = [];
  bus.on('chest', ({ item }) => gifts.push(item));
  let rolls = 0;
  for (let i = 0; i < 40 && !gifts.includes(null); i++) {
    if (!rollChest(game, me)) {
      h.run(0.5);
      continue;
    }
    rolls++;
    idle(h, ROLL_TIME + 0.2);
    // (Taken or not, it's gone in a while: the next roll waits.)
    h.run(13);
  }
  const weapons = gifts.filter((g): g is string => !!g);
  log(`chest: ${rolls} rolls gave ${weapons.join(', ')}${gifts.includes(null) ? ', then it flew off' : ''}`);
  check(weapons.length >= 3 && weapons.every((w) => game.items.get(w)), 'it gives weapons the game has');
  check(gifts.includes(null), 'after a few rolls it flies off');
  const refunded = gold(me) === 5000 - PRICE * weapons.length;
  check(refunded, `the gold back when it flies: ${gold(me)}`);
  h.run(12);
  check(rollChest(game, me), 'and lands somewhere new to roll again');
}

function downs() {
  const { h, game, me } = scene(4);
  const bob = game.bots.add('Bob') as Bot;
  h.run(0.2);
  wave(game, 2);
  const c = map().center;
  me.teleport({ x: c.x, y: c.y - 1, z: c.z + 5 }, Math.PI, 0);
  me.inventory.give('bomb', 3);
  me.inventory.give('bow');
  me.damage(1000);
  check(isDowned(me) && me.alive && me.abilities.crawl.on, `with Bob standing, a killing blow puts you down (${isDowned(me)}, crawling ${me.abilities.crawl.on})`);
  check(me.inventory.count('bomb') === 0 && me.inventory.count('bow') === 0, 'bombs and bow put away on the ground');
  idle(h, 2);
  check(me.health < me.maxHealth, `bleeding: ${me.health.toFixed(1)} of ${me.maxHealth}`);
  // Bob comes over and holds E on you.
  bob.teleport({ x: c.x, y: c.y - 1, z: c.z + 3.4 }, 0, -0.5);
  bob.controls.lookAt({ x: me.position.x, y: me.position.y + 0.4, z: me.position.z });
  bob.controls.hold('KeyE');
  h.run(REVIVE + 0.3, { pilot: () => ({}) });
  bob.controls.release();
  check(!isDowned(me) && Math.abs(me.health - Math.round(me.maxHealth / 3)) < 2, `Bob revived you: ${me.health.toFixed(1)} health`);
  check(me.inventory.count('bomb') === 3 && me.inventory.count('bow') === 1, 'and back in hand once up');
  check(h.find('hud', 'feed').some((f) => String(f.args[0]) === 'Bob revived Player'), 'and everyone hears');
  // Bob goes down and nobody comes: he bleeds out and falls.
  const fell: string[] = [];
  bus.on('fell', ({ player }) => fell.push(player.name));
  const blows: number[] = [];
  game.events.on('playerDamage', ({ player, amount }) => void (player === bob && blows.push(amount)));
  const taken = state.damageTaken;
  bob.damage(1000);
  check(isDowned(bob), 'Bob down');
  idle(h, BLEED + 1);
  check(!bob.alive && fell.includes('Bob'), `bled out after ${BLEED} s: Bob ${bob.alive ? 'alive' : 'fell'}`);
  // Its end is only what was left of him, and it isn't damage taken (nor anything on the ground).
  check(blows.length === 1 && blows[0] <= bob.maxHealth && state.damageTaken === taken, `the bleed-out's blow: ${blows.map((n) => n.toFixed(1)).join(', ')}; damage taken ${taken.toFixed(1)} then ${state.damageTaken.toFixed(1)}`);
  // Alone on your feet, a killing blow is the end (no feather): the fight's lost.
  me.damage(10000);
  idle(h, 3);
  check(!me.alive && ended(h) === 'Defeated', `the last one standing falls: ${ended(h)}`);
  log(`downs: down with a friend standing, revived in ${REVIVE} s to a third of your health; bled out after ${BLEED} s; the last one standing can't go down`);

  // Alone, the Phoenix Feather.
  const solo = scene(5);
  wave(solo.game, 1);
  solo.me.inventory.give(FEATHER, 1);
  solo.me.damage(10000);
  check(solo.me.alive && solo.me.inventory.count(FEATHER) === 0 && solo.me.health === solo.me.maxHealth / 2, `the feather raises you: ${solo.me.health}`);
  // (Out of the flames' protection first.)
  idle(solo.h, 3);
  solo.me.damage(10000);
  idle(solo.h, 2);
  check(!solo.me.alive, 'once');
  log('phoenix: a killing blow taken once, and you rise on half your health');
}

function hype() {
  const { h, game, me } = scene(6);
  wave(game, 2);
  const c = map().center;
  me.teleport({ x: c.x, y: c.y - 1, z: c.z + 5 });
  const at = { x: c.x, z: c.z + 6 };
  let favour = false;
  bus.on('hype', (e) => (favour ||= e.favour));
  let kills = 0;
  for (; kills < 80 && !favour; kills++) {
    slay(game, me, 'zombie', at);
    h.run(0.3, { pilot: () => ({}) });
  }
  check(favour, `the crowd boils over after ${kills} kills`);
  // The emperor's gifts: whatever's thrown down while it lasts.
  const thrown: string[] = [];
  const spawnPickup = game.items.spawnPickup.bind(game.items);
  (game.items as { spawnPickup: typeof spawnPickup }).spawnPickup = (item, at, o) => (thrown.push(item), spawnPickup(item, at, o));
  const was = gold(me);
  slay(game, me, 'zombie', at);
  idle(h, 2);
  const doubled = gold(me) - was;
  idle(h, 10);
  const gifts = thrown.filter((i) => i !== 'coin' && i !== 'heart');
  log(`hype: the Favour after ${kills} kills in quick succession; a zombie worth ${doubled} under it; ${gifts.length} gifts thrown down (${[...new Set(gifts)].join(', ')}); then the crowd's at ${hypeValue().toFixed(2)}`);
  check(doubled >= 2 * GOLD_PER_COST, `double gold in the Favour: ${doubled}`);
  check(gifts.length >= 8, `gifts thrown: ${gifts.length}`);
  check(hypeValue() < 0.1, 'and it starts again from nothing');
}

function classes() {
  const { h, game, me } = scene(7);
  const offered = () => h.find('hud', 'menu').some((m) => (m.args[1] as { title: string }).title === 'Choose your class');
  h.run(3);
  check(!offered() && state.phase === 'countdown', 'the fly-over over the map first');
  // (Its screen says when it's over, played out or skipped.)
  h.send({ t: 'game', player: me.id, name: 'arena.introDone', data: {} });
  h.run(0.2);
  check(offered(), 'then the classes, offered in the countdown');
  choose(game, me, 'hunter');
  check(classOf(me) === 'hunter' && me.inventory.count('bow') === 1 && me.inventory.count('arrow') >= 32 && me.inventory.count('bomb') === 3 && me.speed > 1, `a Hunter: ${me.inventory.slots.filter(Boolean).map((s) => `${s!.item}x${s!.count}`).join(' ')}`);
  choose(game, me, 'berserker');
  check(classOf(me) === 'hunter', 'the Berserker is locked at level 1');
  const levels: number[] = [];
  bus.on('levelUp', ({ level }) => levels.push(level));
  award(game, me, [[xpForLevel(4) - savedXp(me), 'TEST']]);
  h.run(0.1);
  check(levelOf(savedXp(me)) === 4 && levels.includes(4), `level 4: ${progressOf(me).level}`);
  const hearts = me.maxHealth;
  choose(game, me, 'berserker');
  check(classOf(me) === 'berserker' && me.inventory.count('battle_axe') === 1 && me.inventory.count('bow') === 0 && me.maxHealth === hearts - CLASSES.hunter.health + CLASSES.berserker.health, `a Berserker now: max health ${me.maxHealth}, ${me.inventory.slots.filter(Boolean).map((s) => s!.item).join(' ')}`);
  h.run(15);
  check((state.phase as string) === 'fighting', 'the first wave begins');
  choose(game, me, 'gladiator');
  check(classOf(me) === 'berserker', 'and the class is set for the run');
  log('classes: offered in the countdown, the Berserker locked until level 4, kits swapped, set once the fight is on');
}

function endless() {
  const { h, game, me } = scene(8);
  wave(game, finalWave());
  for (let i = 0; i < 30 * 60 && state.phase !== 'victory'; i++) {
    win(game, me);
    h.step(1 / 60, {});
  }
  h.run(4);
  check(ended(h) === 'Victory', `the last wave won: ${ended(h)}`);
  // The end screen's Keep fighting.
  h.send({ t: 'widgetAction', player: me.id, widget: 'arena-end', action: 'keep', value: '' });
  h.run(1);
  check(state.endless && state.phase === 'intermission' && shopOpen(), `on into the endless waves (${state.phase})`);
  h.run(20);
  check(state.wave === finalWave() + 1 && (state.phase as string) === 'fighting', `wave ${state.wave}`);
  const budget = waveSpec(finalWave() + 1).budget ?? 0;
  check(budget > (waveSpec(finalWave() - 1).budget ?? 0), `a bigger budget: ${budget}`);
  me.damage(1e6);
  h.run(3);
  check(ended(h) === 'The arena claims you', `lost in the endless waves: ${ended(h)}`);
  const best = (me.store.get<{ best: Record<string, number> }>('arena')?.best ?? {})[map().id];
  check(best === finalWave() + 1, `the best wave kept: ${best}`);
  log(`endless: Keep fighting into wave ${finalWave() + 1} (budget ${budget}); the best wave kept (${best}), XP ${progressOf(me).total}, level ${progressOf(me).level}`);
}

/** A wave's last monster stuck where nobody can reach it comes back in through a gate. */
function straggler() {
  const { h, game } = scene(9);
  wave(game, 2);
  state.queue = [];
  const c = map().center;
  const z = game.entities.spawn('zombie', { x: c.x + 13, y: c.y - 1, z: c.z + 5 });
  z.setSpeed(0);
  const at = { ...z.position };
  idle(h, 30);
  const moved = Math.hypot(z.position.x - at.x, z.position.z - at.z);
  log(`straggler: a monster stuck for good moved ${moved.toFixed(1)} blocks, to a gate`);
  check(z.alive && moved > 3, 'the last monster of a wave, stuck, comes back through a gate');
}

/** Late in the run the monsters are tougher and hit harder (past wave 8; bosses aside). */
function late() {
  const { h, game, me } = scene(10);
  const c = map().center;
  const blows = (n: number) => {
    wave(game, n);
    state.twist = null;
    // (`spawned`: never an elite, whose own toughness would muddle it.)
    const z = spawnMonster(game, 'zombie', { x: c.x + 4, y: c.y + 0.05, z: c.z }, { data: { summoned: true, spawned: true } });
    z.setSpeed(0);
    h.run(1);
    const hp = z.health;
    z.damage(10, { source: me, cause: 'melee' });
    const life = me.health;
    me.damage(4, { source: z });
    return { took: hp - z.health, hurt: life - me.health };
  };
  const { monster, grow } = DIFFICULTY;
  const early = blows(3);
  const later = blows(18);
  const boss = blows(20);
  const n = 18 - grow.from + 1;
  log(`late: a zombie on wave 3 takes ${early.took.toFixed(1)} of a blow of 10 and deals ${early.hurt.toFixed(2)}; on wave 18, ${later.took.toFixed(1)} and ${later.hurt.toFixed(2)}; in the Lich's wave, ${boss.took.toFixed(1)} and ${boss.hurt.toFixed(2)}`);
  check(Math.abs(early.took - 10 / monster.tough) < 0.05, `every monster tougher: ${early.took.toFixed(2)} of 10`);
  check(Math.abs(later.took * (1 + grow.tough * n) - early.took) < 0.05 && Math.abs(later.hurt - early.hurt * (1 + grow.hits * n)) < 0.05, `${n} waves on: ${grow.tough * n * 100}% tougher, ${Math.round(grow.hits * n * 100)}% harder hitting`);
  check(Math.abs(boss.took - early.took) < 0.05 && Math.abs(boss.hurt - early.hurt) < 0.05, "not in a boss's wave (its fight is tuned as it is)");
}

/** What they carry: a full hotbar greys out the shop (saying why); the merchant buys; X drops the stack in hand (not straight back); a better weapon of a kind takes the worse one's slot. */
function pack() {
  const { h, game, me } = scene(12);
  wave(game, 1);
  win(game, me);
  h.run(0.5);
  const inv = me.inventory;
  inv.clear();
  for (const item of ['gladius', 'bow', 'spear', 'warhammer', 'daggers', 'stone_sword', 'iron_sword']) inv.give(item);
  inv.give('health_potion', 2);
  inv.give('bomb', 2);
  addGold(game, me, 2000 - gold(me));
  const slotOf = (item: string) => inv.slots.findIndex((x) => x?.item === item);
  type Entry = { label: string; note?: string; detail?: string; disabled?: boolean };
  const shown = () => {
    showShop(game, me);
    h.step(1 / 60);
    const m = h.find('hud', 'menu').filter((c) => (c.args[1] as { title: string }).title === 'The Merchant').at(-1)!;
    return (m.args[1] as { sections: { title?: string; entries: Entry[] }[] }).sections;
  };
  // Full, and out of arrows: the arrows greyed out, saying why; but potions and bombs still fit their stacks.
  let sections = shown();
  const entry = (label: string) => sections.flatMap((x) => x.entries).find((e) => e.label === label);
  check(!inv.slots.includes(null) && entry('Arrow ×12')?.disabled && entry('Arrow ×12')?.note?.startsWith('Hotbar full'), `a full hotbar: the arrows say so (${JSON.stringify(entry('Arrow ×12'))})`);
  check(!purchase(game, me, 'arrow') && purchase(game, me, 'health_potion') && purchase(game, me, 'bomb'), 'no arrows; potions and bombs join their stacks');
  // Sell the stone sword: 40% of its price, and a slot free.
  const sales = sections.find((x) => x.title === 'Sell')!.entries;
  const was = gold(me);
  check(sales.length === 9 && sell(game, me, slotOf('stone_sword'), 'stone_sword') === sellPrice(game, 'stone_sword') && gold(me) - was === 20 && slotOf('stone_sword') < 0, `sold the stone sword for ${gold(me) - was}`);
  check(purchase(game, me, 'arrow') && inv.count('arrow') === 12, 'now the arrows fit');
  // X drops the spear in hand: thrown out, not straight back while they stand there; walk off and back, and it's theirs again.
  inv.select(slotOf('spear'));
  h.step(1 / 60, { pressed: ['KeyX'], down: ['KeyX'] });
  const lying = () => h.sim.items.frame().filter((x) => x.item === 'spear');
  check(inv.count('spear') === 0 && lying().length === 1, 'X drops the spear');
  idle(h, 4);
  check(inv.count('spear') === 0 && lying().length === 1, 'and it stays where it fell while they stand by');
  const at = { ...me.position };
  me.teleport({ x: at.x + 12, y: at.y, z: at.z }, 0, 0);
  idle(h, 0.5);
  const q = lying()[0];
  me.teleport({ x: q.x, y: q.y - 0.3, z: q.z }, 0, 0);
  idle(h, 1);
  check(inv.count('spear') === 1, 'walk away and back, and it comes to them');
  // Not the last weapon: with only the gladius to fight with, X keeps it and the merchant won't take it.
  inv.clear();
  inv.give('gladius');
  inv.give('bow');
  inv.select(slotOf('gladius'));
  h.step(1 / 60, { pressed: ['KeyX'], down: ['KeyX'] });
  check(inv.count('gladius') === 1 && sell(game, me, slotOf('gladius')) === 0 && sell(game, me, slotOf('bow')) > 0, 'their last weapon is kept (the bow, needing arrows, goes)');
  // A better spear takes the common one's slot, which is sold; a worse one is gold.
  inv.give('spear');
  const slot = slotOf('spear');
  let before = gold(me);
  game.items.spawnPickup('spear_epic', me.position);
  idle(h, 1);
  check(inv.slots[slot]?.item === 'spear_epic' && gold(me) - before === sellPrice(game, 'spear'), `an epic spear in the common one's slot, +${gold(me) - before} gold`);
  before = gold(me);
  game.items.spawnPickup('spear_rare', me.position);
  idle(h, 1);
  const spears = inv.slots.filter((x) => x?.item.startsWith('spear')).length;
  check(spears === 1 && inv.slots[slot]?.item === 'spear_epic' && gold(me) - before === sellPrice(game, 'spear_rare'), `a rare one after it comes as gold: +${gold(me) - before}`);
  log(`pack: a full hotbar greys out arrows (sell or drop); sold a stone sword for 20; X drops, not straight back; the last weapon kept; a better spear replaces the worse (+${sellPrice(game, 'spear')}), a worse one is gold (+${sellPrice(game, 'spear_rare')})`);
}

export default function arenaRun() {
  pack();
  late();
  straggler();
  coins();
  shop();
  chest();
  downs();
  hype();
  classes();
  endless();
}
