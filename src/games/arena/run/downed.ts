import type { Actor, GameContext, Player } from '@platform';
import { bus } from './bus';
import { feat } from './hype';
import { inFight, runs } from './state';
import { addUsable, bar, holdOf, removeUsable } from './use';

/**
 * Down, not out. A blow that would end a fighter while a friend still stands drops them to the
 * sand instead: they crawl (`crawl.ts`), slowly bleeding out over `BLEED` seconds (their health
 * running down with it, and each blow that finds them on the ground taking more off), while a
 * marker calls their friends over. A friend holds E on them for `REVIVE` seconds (the bleeding
 * waits while they do) and they're up on a third of their health. Bled out, they've fallen: out
 * of the wave as before (`fell`). The last one standing can't go down, so alone there's no second
 * chance but a Phoenix Feather (the shop's), which, carried, takes any killing blow once and
 * raises its bearer in a burst of flame.
 *
 * Their own screen shows it (`client/run.ts`, the `arena.downed` message): the bleeding, the time
 * left, who's reviving them. On the ground they can't drink (the armory's potions refuse) or swing
 * the arsenal; their bombs and bows (the platform's kits, which don't ask) are put away till they're up.
 */
export const BLEED = 20;
export const REVIVE = 3;
/** Seconds of bleeding each point of damage costs someone on the ground. */
const HIT_BLEED = 0.5;
/** Back up on this much of their health. */
const REVIVED = 1 / 3;
/** Guardian Angel: revives in one fight. */
const ANGEL = 5;
export const FEATHER = 'phoenix_feather';
/** What the merchant asks for one. */
export const FEATHER_PRICE = 350;

interface Down {
  bleed: number;
  /** What was put away while they're down (bombs, bows), to give back. */
  stash: { item: string; count: number }[];
  /** Whoever last hurt them (their killer, if they bleed out). */
  by: Actor | null;
  /** When their markers and screen were last told. */
  told: number;
}

const downs = new Map<string, Down>();
/** Someone being finished off (bled out): their last blow isn't caught again. */
let finishing: Player | null = null;

export const isDowned = (p: Player) => downs.has(p.id);
/** They're dying of bleeding out (already counted as a down), not of a blow on their feet. */
export const bledOut = (p: Player) => p === finishing;
/** A blow they took that counts as damage taken (the end screen's, the wave's, Untouched): not on the ground, not the bleed-out's end. */
export const counts = (p: Player) => p !== finishing && !downs.has(p.id);
/** In the fight on their feet: alive, playing, not downed. */
export const standing = (p: Player) => p.alive && !p.spectating && !downs.has(p.id);

/** Their markers on everyone else's screen, and their own screen's word (null: they're up). */
function tell(game: GameContext, p: Player, d: Down | null, reviver: Player | null = null, progress = 0) {
  const id = `arena.downed:${p.id}`;
  for (const o of game.players) {
    if (o === p) continue;
    o.hud.marker(id, d ? p : null, d ? { label: reviver ? `${reviver.name} reviving` : `REVIVE ${p.name}`, color: '#ff4d4d', shape: 'diamond', edge: true, pulse: !reviver, bar: reviver ? progress : d.bleed / BLEED, offset: { x: 0, y: 2, z: 0 } } : undefined);
  }
  if (!p.bot) game.clients.send(p, 'arena.downed', d ? { bleed: Math.max(0, d.bleed), max: BLEED, reviver: reviver?.name ?? null, progress } : null);
}

function down(game: GameContext, p: Player, by: Actor | null) {
  const d: Down = { bleed: BLEED, stash: putAway(game, p), by, told: game.clock.now };
  downs.set(p.id, d);
  p.health = p.maxHealth;
  p.abilities.crawl.on = true;
  bar(p, true);
  game.hud.feed(`${p.name} is down!`, { color: '#ff6b6b' });
  const r = runs.get(p.id);
  if (r) {
    r.fell = true;
    r.hurt = true;
    r.downs++;
  }
  game.audio.play('downed', { at: p.position });
  p.fx.flash('#a00000', 0.5, 0.6);
  const q = p.position;
  game.fx.burst({ x: q.x, y: q.y + 0.4, z: q.z }, { color: '#a01818', count: 26, speed: 2.5, gravity: 8 });
  addUsable({
    id: `revive:${p.id}`,
    at: () => (downs.has(p.id) ? { x: p.position.x, y: p.position.y + 0.5, z: p.position.z } : null),
    reach: 2.4,
    hold: REVIVE,
    label: (o) => (o !== p && standing(o) ? `Hold to revive ${p.name}` : null),
    use: (g, o) => revive(g, p, o),
  });
  tell(game, p, d);
  bus.emit('downed', { player: p, bleed: BLEED });
}

/** Kinds of item that work on the ground unless put away (the platform's kits: they don't ask whether you're down). */
const STOWED = new Set(['throwable', 'bow']);

/** Their bombs and bows out of their hands while they're down. */
function putAway(game: GameContext, p: Player): Down['stash'] {
  const stash: Down['stash'] = [];
  for (const slot of p.inventory.slots) {
    if (!slot || !STOWED.has(game.items.get(slot.item)?.kind ?? '')) continue;
    stash.push({ ...slot });
  }
  for (const s of stash) p.inventory.take(s.item, s.count);
  return stash;
}

const giveBack = (p: Player, d: Down | undefined) => {
  for (const s of d?.stash ?? []) p.inventory.give(s.item, s.count);
};

/** Back on their feet: by a friend's hands, or (`by` null) the wave won. */
export function revive(game: GameContext, p: Player, by: Player | null) {
  const d = downs.get(p.id);
  if (!d) return;
  downs.delete(p.id);
  giveBack(p, d);
  removeUsable(`revive:${p.id}`);
  p.abilities.crawl.on = false;
  bar(p, false);
  p.health = Math.max(1, Math.round(p.maxHealth * REVIVED));
  p.protect(1.5);
  tell(game, p, null);
  const q = p.position;
  game.fx.burst({ x: q.x, y: q.y + 1, z: q.z }, { color: '#9dff8a', count: 30, speed: 3, gravity: -2, glow: 1 });
  game.audio.play('revive', { at: q });
  if (by) {
    game.hud.feed(`${by.name} revived ${p.name}`, { color: '#9dff8a' });
    const r = runs.get(by.id);
    if (r) {
      r.revives++;
      if (r.revives >= ANGEL) by.achieve('guardian_angel');
    }
    feat(by, 'revive', `${by.name} revived ${p.name}!`);
  }
  bus.emit('revived', { player: p, by });
}

/** Bled out: they've fallen (the platform's death, so `playerDeath` and the server's `fall` follow). */
function bleedOut(game: GameContext, p: Player) {
  const d = downs.get(p.id);
  downs.delete(p.id);
  giveBack(p, d);
  removeUsable(`revive:${p.id}`);
  p.abilities.crawl.on = false;
  bar(p, false);
  tell(game, p, null);
  // Just what's left of them, armour aside (not a blow of thousands that would swamp what anyone
  // sums of damage taken), again if something softened it; and the tallies skip it (`bledOut`).
  finishing = p;
  const armor = p.armor;
  p.armor = 0;
  for (let i = 0; i < 4 && p.alive; i++) {
    p.protect(0);
    p.damage(Math.max(1, p.health) * 2 ** i, { source: d?.by ?? 'world', knockback: 0 });
  }
  p.armor = armor;
  finishing = null;
}

/** The Phoenix Feather burns up and its bearer rises from the blow that would have ended them. */
function rise(game: GameContext, p: Player) {
  p.inventory.take(FEATHER, 1);
  p.health = Math.round(p.maxHealth / 2);
  p.protect(2.5);
  const q = p.position;
  game.fx.burst({ x: q.x, y: q.y + 1, z: q.z }, { color: '#ff8a2a', count: 60, speed: 6, gravity: -3, glow: 1, life: 0.9 });
  game.fx.shockwave({ x: q.x, y: q.y + 0.2, z: q.z }, 5, '#ffb347');
  game.audio.play('phoenix', { at: q });
  p.achieve('phoenix');
  feat(p, 'phoenix', `${p.name} rises from the ashes!`);
  // The flames throw back whatever's close.
  for (const e of game.entities.near(q, 4)) if (e.alive && !e.data.scenery) e.damage(6, { source: p, knockback: 2, weapon: 'phoenix', cause: 'fire' });
}

export function downedListen(game: GameContext) {
  game.events.on('damage', (hit) => {
    if (hit.cancelled || hit.target.kind !== 'player') return;
    const p = hit.target;
    if (p === finishing) return;
    const s = hit.source;
    // (Fighters never hurt each other: the server's listener cancels that.)
    if (s && s !== 'world' && s.kind === 'player') return;
    const d = downs.get(p.id);
    if (d) {
      // On the ground, a blow takes off time instead.
      hit.cancel();
      d.bleed -= hit.amount * HIT_BLEED;
      d.by = s ?? d.by;
      p.fx.flash('#a00000', 0.35, 0.25);
      return;
    }
    if (!inFight()) return;
    // Armour takes its share after this: a blow that would still be the last.
    if (hit.amount * (1 - 0.04 * p.armor) < p.health) return;
    if (p.inventory.count(FEATHER) > 0) {
      hit.cancel();
      rise(game, p);
    } else if (game.players.some((o) => o !== p && standing(o))) {
      hit.cancel();
      down(game, p, s ?? null);
    }
  });
  game.events.on('playerLeave', ({ player }) => {
    downs.delete(player.id);
    removeUsable(`revive:${player.id}`);
  });
}

export function downedUpdate(game: GameContext, dt: number) {
  if (!downs.size) return;
  const now = game.clock.now;
  for (const [id, d] of [...downs]) {
    const p = game.players.find((o) => o.id === id);
    if (!p || !p.alive) {
      if (p) giveBack(p, d);
      downs.delete(id);
      continue;
    }
    // Someone holding E on them: the bleeding waits.
    const reviver = game.players.find((o) => holdOf(o)?.id === `revive:${id}`) ?? null;
    if (!reviver) d.bleed -= dt;
    if (d.bleed <= 0) {
      bleedOut(game, p);
      continue;
    }
    p.health = Math.max(1, (p.maxHealth * d.bleed) / BLEED);
    if (reviver || now - d.told >= 0.25) {
      d.told = now;
      tell(game, p, d, reviver, reviver ? (holdOf(reviver)?.t ?? 0) / REVIVE : 0);
    }
  }
  // Nobody left standing to revive anyone: those on the ground are done for.
  if (!game.players.some(standing)) for (const id of [...downs.keys()]) {
    const p = game.players.find((o) => o.id === id);
    if (p) bleedOut(game, p);
  }
}

/** The wave's won: everyone on the ground gets up. */
export function standAll(game: GameContext) {
  for (const p of game.players) if (downs.has(p.id)) revive(game, p, null);
}

/** A fresh fight: nobody down (their crawl off). */
export function resetDowned(game: GameContext) {
  for (const p of game.players) {
    if (p.abilities.crawl) p.abilities.crawl.on = false;
    tell(game, p, null);
  }
  downs.clear();
  finishing = null;
}
