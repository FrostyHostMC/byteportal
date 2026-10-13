import { Models, type Bot, type GameContext, type ItemDefinition, type ItemKit, type Player, type Vec3 } from '@platform';
import type { BotMind, BotWeapon } from '@platform/kits';
import type { BotHooks } from '../bots';
import { HERO_MODELS } from '../models';
import { STYLE } from '../style';
import type { Team } from '../teams';
import { HERO_ABILITY, type HeroMove } from './abilities';
import { heroBots } from './bots';
import { HEROES, SABER_HEROES, heroNumber, saberOf, usesSaber, type HeroId } from './defs';
import { FX_ITEMS } from './fxitems';
import { HERO_GUNS } from './guns';
import { FORCE, setupPowers, type Powers } from './powers';
import { bladePoint, sabers, type SaberItem, type Sabers } from './saber';
import { GUARD, MOVE, POWERS, REGEN, TOUGH } from './tuning';
import { MSG, p3, type Clash, type Cut, type Deflects } from './wire';

/**
 * The heroes on the server: making someone a hero (their model, health, saber and powers) and
 * back again, and what being one means:
 *
 * - their saber (`saber.ts`: the combo, the guard), their powers (`powers.ts`), how they move
 *   (`abilities.ts`: a movement ability every screen runs), the numbers (`tuning.ts`);
 * - the guard at work (a `damage` listener): bolts from the front deflected (some back at whoever
 *   fired them), swings parried (the one who swung staggered), lightning turned mostly aside;
 *   flanking fire and detonators still hurt;
 * - their health doesn't come back as a trooper's does, only slowly;
 * - hero bots (`bots.ts`).
 *
 * `server.ts` decides who gets to be one (battle points, one of each hero at a time); every
 * screen hears what they do (`wire.ts`) and shows it (`client/`).
 */

/** What the heroes need to know of the match. */
export interface HeroRules {
  teamOf(p: Player): Team | null;
  hostile(a: Player, b: Player): boolean;
  /** Where a hurt hero falls back to (the nearest post their side holds), if anywhere. */
  retreat?(p: Player): Vec3 | null;
}

export interface Heroes {
  /** Define the sabers (and anything else the heroes carry): in `setup`. */
  define(): void;
  /** Make them this hero now (just spawned): their model, health, saber and powers. */
  become(p: Player, id: HeroId): void;
  /** Back to a trooper (they died as the hero, the match ended): what the hero had goes. */
  end(p: Player): void;
  /** The hero they are now, if any. */
  heroOf(p: Player): HeroId | null;
  /** Each step, before the bots. */
  update(dt: number): void;
  /** How bots fight with the heroes' weapons (for `shooterBots`). */
  botWeapons: Record<string, BotWeapon>;
  /** A hero bot's own moves in a fight (powers, blocking), each tick of it. */
  botFight(bot: Bot, mind: BotMind, distance: number): void;
  /** All the bots' hooks the heroes give (`makeBots`): their weapons, their fighting, falling back when hurt. */
  readonly botHooks: BotHooks;
  /** The powers at work (for tests, and bots). */
  readonly powers: Powers;
}

/** The heroes' kinds of item, for `server.ts`'s `items`: their sabers. */
export const heroItems = (): ItemKit[] => [sabers()];

/** The weapon a bolt sent back by a hero's saber kills with (the hero's kill). */
export const DEFLECTED = 'Deflected Bolt';

/** A reflected bolt, on its way back to whoever fired it. */
interface Reflected {
  hero: Player;
  shooter: Player;
  damage: number;
  at: number;
}

const DEG = Math.PI / 180;
/** Whether `from` is within `arc` degrees each side of where `p` looks (level). */
function inFront(p: Player, from: { x: number; z: number }, arc: number): boolean {
  const dx = from.x - p.position.x;
  const dz = from.z - p.position.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.3) return true;
  return (dx * -Math.sin(p.yaw) + dz * -Math.cos(p.yaw)) / d >= Math.cos(arc * DEG);
}

export function setupHeroes(game: GameContext, rules: HeroRules): Heroes {
  const who = new Map<string, HeroId>();
  /** Each hero's health as last allowed (their own healing aside, it only comes back slowly), and when they were last hurt. */
  const allowed = new Map<string, number>();
  const hurtAt = new Map<string, number>();
  const reflected: Reflected[] = [];
  let deflects: Deflects['list'] = [];
  const kind = () => game.items.kind<Sabers>('saber');
  const heroOf = (p: Player) => who.get(p.id) ?? null;
  const send = (name: string, data: unknown) => game.clients.send('all', name, data);

  const powers = setupPowers(game, {
    hostile: rules.hostile,
    heroOf,
    heal(p, amount) {
      p.health = Math.min(p.maxHealth, p.health + amount);
      allowed.set(p.id, p.health);
    },
  });

  const bots = heroBots(game, { heroOf, hostile: rules.hostile, powers, sabers: kind, retreat: (p) => rules.retreat?.(p) ?? null });
  const botWeapons: Record<string, BotWeapon> = {
    ...Object.fromEntries(SABER_HEROES.map((id) => [saberOf(id), { range: 1.8, rush: true }])),
    hero_bowcaster: { range: 13 },
    hero_ee3: { range: 20 },
  };

  const configure = () =>
    kind()?.configure({
      hostile: rules.hostile,
      hero: (p) => who.has(p.id),
      damage: (p) => (powers.rage(p) ? POWERS.rage.damage : 1),
      pace: (p) => (powers.rage(p) ? POWERS.rage.pace : 1),
      busy: (p) => powers.busy(p) || powers.held(p),
      unguarded: (p) => powers.unguarded(p) || powers.held(p),
      cut(by, target) {
        const at = { x: target.position.x, y: target.position.y + 1.2, z: target.position.z };
        send(MSG.cut, { p: by.id, at: p3(at) } satisfies Cut);
        game.audio.play('bfh_saber_hit', { at, pitch: 0.9 + Math.random() * 0.2 });
      },
      send,
    });

  // The guard at work: what comes at a hero from the front (from anywhere, in Soresu) while it's up.
  game.events.on('damage', (hit) => {
    const t = hit.target;
    if (t.kind !== 'player' || !who.has(t.id) || !t.alive || hit.cancelled) return;
    const src = hit.source;
    const by = src && src !== 'world' && src.kind === 'player' ? src : null;
    // A hero's own quarrel bursting, or own rocket, doesn't hurt them.
    if (by === t && (hit.weapon === 'hero_bowcaster' || hit.weapon === FORCE.rocket)) return hit.cancel();
    if (by && !rules.hostile(by, t)) return;
    // Enraged (Chewblocca's roar): he takes less of everything.
    if (powers.enraged(t)) hit.amount *= POWERS.roar.taken;
    if (hit.cause === 'melee' || hit.cause === 'gun') hurtAt.set(t.id, game.clock.now);
    const k = kind();
    const all = powers.soresu(t);
    const from = by?.position ?? hit.from;
    const guarded = !!k && (all || k.guarding(t)) && !!from && (all || inFront(t, from, GUARD.arc));
    // Unguarded (or from the side), a bolt does a hero less harm than a trooper.
    if (!guarded) {
      if (hit.cause === 'gun') hit.amount *= TOUGH.blaster;
      return;
    }
    if (!k || !from) return;
    const blade = bladePoint(t);
    if (hit.cause === 'gun' && by) {
      // A bolt: turned aside, or straight back at whoever fired it.
      hit.cancel();
      if (!all) k.drain(t, GUARD.bolt);
      const back = game.rng.next() < (all ? POWERS.soresu.reflect : GUARD.reflect);
      let to: { x: number; y: number; z: number };
      if (back) {
        to = { x: by.position.x, y: by.position.y + 1.2, z: by.position.z };
        const d = Math.hypot(to.x - blade.x, to.y - blade.y, to.z - blade.z);
        reflected.push({ hero: t, shooter: by, damage: all ? POWERS.soresu.reflectDamage : GUARD.reflectDamage, at: game.clock.now + d / 90 });
      } else {
        // Off at an angle: away from the blade, up or down a little.
        const a = Math.atan2(by.position.x - t.position.x, by.position.z - t.position.z) + (game.rng.next() < 0.5 ? -1 : 1) * game.rng.range(0.5, 1.4);
        to = { x: blade.x + Math.sin(a) * 30, y: blade.y + game.rng.range(-4, 9), z: blade.z + Math.cos(a) * 30 };
      }
      deflects.push({ p: t.id, w: hit.weapon ?? '', to: p3(to), r: back });
      return;
    }
    if (hit.cause === 'melee' && by && hit.weapon?.startsWith('saber_')) {
      // A swing parried: little gets through, the one who swung reels.
      hit.amount *= GUARD.parried;
      hit.knockback = 0;
      if (!all) k.drain(t, GUARD.parry);
      if (who.has(by.id)) k.stagger(by, GUARD.stagger);
      send(MSG.clash, { p: t.id, by: by.id, at: p3(blade) } satisfies Clash);
      game.audio.play('bfh_saber_clash', { at: blade, pitch: 0.9 + Math.random() * 0.2 });
      return;
    }
    if (hit.weapon === FORCE.lightning || hit.weapon === FORCE.chain) {
      // Lightning caught on the blade: most of it.
      hit.amount *= GUARD.lightningThrough;
      if (!all) k.drain(t, GUARD.lightning * (hit.weapon === FORCE.chain ? 0.5 : 1 / 30));
      return;
    }
    if (hit.weapon === FORCE.throw) {
      hit.amount *= GUARD.parried;
      send(MSG.clash, { p: t.id, by: by?.id ?? '', at: p3(blade) } satisfies Clash);
      game.audio.play('bfh_saber_clash', { at: blade });
    }
  });
  game.events.on('playerDamage', ({ player }) => {
    if (who.has(player.id)) hurtAt.set(player.id, game.clock.now);
  });
  // The bowcaster's quarrels burst where they hit (the gun kit's shot does the hit itself).
  game.events.on('shot', ({ player, weapon, from, dir }) => {
    if (weapon === 'hero_bowcaster') powers.quarrel(player, from, dir, 0);
  });
  // Someone new on the scene: which heroes have their guard up (the powers tell them the rest).
  game.events.on('playerReady', ({ player: to }) => {
    const k = kind();
    for (const id of who.keys()) {
      const p = game.players.find((q) => q.id === id);
      if (p && k?.guarding(p)) game.clients.send(to, MSG.guard, { p: id, on: true });
    }
  });

  return {
    powers,
    define() {
      for (const id of SABER_HEROES) game.items.define(saberOf(id), { kind: 'saber', name: `${HEROES[id].name}'s Saber`, stack: 1 } satisfies SaberItem as unknown as ItemDefinition);
      for (const [id, gun] of Object.entries(HERO_GUNS)) game.items.define(id, gun as unknown as ItemDefinition);
      for (const [id, def] of Object.entries(FX_ITEMS)) game.items.define(id, def);
      configure();
    },
    become(p, id) {
      const h = HEROES[id];
      if (who.get(p.id) !== id) powers.end(p);
      who.set(p.id, id);
      p.setModel(Models.gltf(HERO_MODELS[id], { rig: 'humanoid', ...STYLE }));
      p.maxHealth = h.health;
      p.health = h.health;
      p.speed = MOVE.speed;
      p.inventory.clear();
      p.inventory.give(h.weapon);
      p.inventory.select(0);
      allowed.set(p.id, h.health);
      hurtAt.set(p.id, -99);
      const saber = usesSaber(id);
      if (saber) kind()?.fresh(p);
      Object.assign(p.abilities[HERO_ABILITY] as HeroMove, { h: heroNumber(id), c0: 0, c1: 0, c2: 0, a0: 0, a1: 0, a2: 0, g: saber ? 1 : 0, k: 1, m: GUARD.meter, j: 0, r: 0, l: 0, f: 0, ft: 0 });
      game.audio.play(saber ? 'bfh_saber_ignite' : 'bfh_hero_ready', { at: p.eye });
    },
    end(p) {
      if (!who.has(p.id)) return;
      powers.end(p);
      bots.forget(p);
      const held = HEROES[who.get(p.id)!]?.powers.find((w) => w.hold);
      if (p.bot && held) (p as Bot).controls.hold(held.key, false);
      who.delete(p.id);
      allowed.delete(p.id);
      p.speed = 1;
      Object.assign(p.abilities[HERO_ABILITY] as HeroMove, { h: 0, g: 0, k: 0, r: 0, l: 0, f: 0, a0: 0, a1: 0, a2: 0 });
    },
    heroOf,
    update(dt) {
      powers.update(dt);
      bots.update();
      const now = game.clock.now;
      const k = kind();
      for (const [id, hero] of who) {
        const p = game.players.find((q) => q.id === id);
        if (!p) {
          who.delete(id);
          continue;
        }
        if (!p.alive) continue;
        // Their health doesn't come back as a trooper's does (the game's `regen`, a little each
        // step): only slowly, a while after they were last hurt. (Healing all at once, the game's
        // or their own, stands.)
        const was = allowed.get(id) ?? p.health;
        const rise = p.health - was;
        const mend = now - (hurtAt.get(id) ?? -99) > REGEN.after ? REGEN.perSecond * dt : 0;
        if (rise > mend && rise < REGEN.step) p.health = Math.min(p.maxHealth, was + mend);
        allowed.set(id, p.health);
        // What their movement ability and HUD go by: the guard, their hands, the meter.
        const s = k?.of(p);
        const m = p.abilities[HERO_ABILITY] as HeroMove;
        const g = s && s.broken === 0 && s.stagger === 0 && !powers.unguarded(p) && !powers.held(p) ? 1 : 0;
        const free = !powers.busy(p) && !powers.held(p) && !(s && s.stagger > 0) ? 1 : 0;
        if (m.g !== g) m.g = g;
        if (m.k !== free) m.k = free;
        const meter = Math.round(s?.meter ?? GUARD.meter);
        if (m.m !== meter) m.m = meter;
        if (m.h !== heroNumber(hero)) m.h = heroNumber(hero);
        const speed = Math.round(MOVE.speed * powers.speed(p) * 100) / 100;
        if (p.speed !== speed) p.speed = speed;
      }
      // Bolts sent back reach whoever fired them.
      for (let i = reflected.length - 1; i >= 0; i--) {
        const r = reflected[i];
        if (r.at > now) continue;
        reflected.splice(i, 1);
        if (r.shooter.alive && r.hero.alive) r.shooter.damage(r.damage, { source: r.hero, cause: 'gun', weapon: DEFLECTED, part: 'body', knockback: 0.2 });
      }
      if (deflects.length) {
        send(MSG.deflect, { list: deflects } satisfies Deflects);
        // A deflection's zing at each blade that turned something (one a step each).
        for (const id of new Set(deflects.map((d) => d.p))) {
          const p = game.players.find((q) => q.id === id);
          if (p) game.audio.play('bfh_saber_deflect', { at: bladePoint(p), pitch: 0.9 + Math.random() * 0.25 });
        }
        deflects = [];
      }
    },
    botWeapons,
    botFight: (bot, mind) => bots.fight(bot, mind),
    botHooks: {
      weapons: botWeapons,
      fight: (bot, mind) => bots.fight(bot, mind),
      goal: (bot) => bots.goal(bot),
      ignore: (bot, other) => bots.ignore(bot, other),
      after: (brains) => bots.after(brains),
    },
  };
}
