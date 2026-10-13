import type { GameContext, Player } from '@platform';
import { match, type Fighter, type Post } from './match';
import type { PostSpec } from './maps/kit';
import { other, type Team } from './teams';

/**
 * Conquest: the command posts and the reinforcements.
 *
 * - **Posts.** Each is held, by a firmness from +1 (the Rebels') through 0 (nobody's) to -1 (the
 *   Empire's). Standing in one with nobody of the other side there moves it your way: the other
 *   side's is neutralised first, then it's yours. One trooper takes `CAPTURE` seconds for each
 *   half; more go faster (up to `CROWD` times). Both sides in it: it's contested, and holds. Left
 *   alone, it settles back to whoever holds it. A side's base (`locked`) can't be taken.
 * - **Tickets.** Each side starts with `TICKETS` reinforcements. Every death costs one. Every
 *   `BLEED` seconds, a side holding most of the posts worth fighting over (the bases aside) takes one
 *   ticket from the other, and holding all of them, `ALL_HELD`. Out of tickets, a side loses.
 */

export const TICKETS = 150;
/** Seconds for one trooper to neutralise a post, and as many to take it. */
export const CAPTURE = 8;
/** Most times faster a crowd takes a post. */
const CROWD = 2.5;
/** Seconds for an empty post to settle back to its holder. */
const SETTLE = 12;
export const BLEED = 6;
/** Tickets a bleed takes when one side holds every post worth fighting over. */
const ALL_HELD = 2;
/** How far below a post's feet level still counts as in it. */
const BELOW = 1.5;

/** What happened at a post this step, for the server to tell (feed, banners, points). */
export type PostNews =
  | { t: 'captured'; post: Post; team: Team; by: Fighter[] }
  | { t: 'neutralised'; post: Post; team: Team; by: Fighter[]; from: Team };

export class Conquest {
  private bleedAt = 0;

  constructor(private game: GameContext) {}

  /** A new match on the map's posts: each with its starting holder, the tickets full. */
  begin(posts: PostSpec[], tickets = TICKETS) {
    match.posts = posts.map((spec) => ({ spec, owner: spec.owner, control: spec.owner === 0 ? 1 : spec.owner === 1 ? -1 : 0, count: [0, 0], contested: false, moving: null }));
    match.tickets = [tickets, tickets];
    this.bleedAt = this.game.clock.now + BLEED;
  }

  /** Whether a player stands in a post. */
  inside(post: Post, p: Player): boolean {
    const a = post.spec.at;
    const q = p.position;
    return Math.hypot(q.x - a.x, q.z - a.z) <= post.spec.radius && q.y >= a.y - BELOW && q.y <= a.y + (post.spec.height ?? 6);
  }

  /** The post a player stands in, if any. */
  postOf(p: Player): Post | null {
    return match.posts.find((post) => this.inside(post, p)) ?? null;
  }

  /** Posts a side holds (its base included). */
  held(team: Team): Post[] {
    return match.posts.filter((p) => p.owner === team);
  }

  /** One step: who's in each post, which way it goes, the bleed. Returns what changed hands. In a mode without posts to fight over, nothing moves. */
  update(dt: number): PostNews[] {
    const news: PostNews[] = [];
    if (!match.mode.posts) return news;
    const living = [...match.fighters.values()].filter((f) => f.player.alive);
    for (const post of match.posts) {
      const inside = living.filter((f) => this.inside(post, f.player));
      const by: [Fighter[], Fighter[]] = [inside.filter((f) => f.team === 0), inside.filter((f) => f.team === 1)];
      post.count = [by[0].length, by[1].length];
      post.contested = by[0].length > 0 && by[1].length > 0;
      post.moving = null;
      if (post.spec.locked || post.contested) continue;
      const was = post.control;
      const team: Team | null = by[0].length ? 0 : by[1].length ? 1 : null;
      if (team !== null) {
        const n = by[team].length;
        const rate = Math.min(CROWD, 1 + 0.5 * (n - 1)) / CAPTURE;
        const toward = team === 0 ? 1 : -1;
        if (post.control !== toward) {
          post.control = toward > 0 ? Math.min(1, post.control + rate * dt) : Math.max(-1, post.control - rate * dt);
          post.moving = team;
        }
        // Crossing the middle: whoever held it has lost it.
        if (post.owner !== null && post.owner !== team && Math.sign(post.control) !== Math.sign(was) && Math.abs(was) > 0) {
          const from = post.owner;
          post.owner = null;
          news.push({ t: 'neutralised', post, team, by: by[team], from });
        }
        if (post.control === toward && post.owner !== team) {
          post.owner = team;
          news.push({ t: 'captured', post, team, by: by[team] });
        }
      } else {
        // Nobody here: it settles back to whoever holds it (nobody's settles to the middle).
        const home = post.owner === 0 ? 1 : post.owner === 1 ? -1 : 0;
        const step = dt / SETTLE;
        post.control = post.control < home ? Math.min(home, post.control + step) : Math.max(home, post.control - step);
      }
    }
    // The bleed: the posts worth fighting over (not the bases). Holding most of them wears the other
    // side down slowly; holding them all, fast.
    const now = this.game.clock.now;
    if (now >= this.bleedAt) {
      this.bleedAt = now + BLEED;
      const open = match.posts.filter((p) => !p.spec.locked);
      const h = [open.filter((p) => p.owner === 0).length, open.filter((p) => p.owner === 1).length];
      const leader: Team | null = h[0] > h[1] && h[0] * 2 > open.length ? 0 : h[1] > h[0] && h[1] * 2 > open.length ? 1 : null;
      if (leader !== null) {
        const loser = other(leader);
        match.tickets[loser] = Math.max(0, match.tickets[loser] - (h[leader] === open.length ? ALL_HELD : 1));
      }
    }
    return news;
  }

  /** A death on a side: one ticket. */
  died(team: Team) {
    match.tickets[team] = Math.max(0, match.tickets[team] - 1);
  }

  /** The side out of tickets, if either is (both: the one with fewer posts). */
  loser(): Team | null {
    const [a, b] = match.tickets;
    if (a > 0 && b > 0) return null;
    if (a <= 0 && b <= 0) return this.held(0).length < this.held(1).length ? 0 : 1;
    return a <= 0 ? 0 : 1;
  }

  /**
   * Where a side's fight is: the posts worth going for (the other side's and nobody's, not a base)
   * and its own under threat (the other side in it, or it's slipping), nearest the middle first.
   */
  objectives(team: Team): Post[] {
    const enemy = other(team);
    return match.posts.filter((p) => !p.spec.locked && (p.owner !== team || p.count[enemy] > 0 || p.moving === enemy));
  }

  /**
   * Where a side's front is: its own post nearest to one it doesn't hold (spawning there puts you
   * in the fight), else its base.
   */
  front(team: Team): Post | null {
    const mine = this.held(team);
    const theirs = match.posts.filter((p) => p.owner !== team);
    if (!mine.length) return null;
    if (!theirs.length) return mine[0];
    let best = mine[0];
    let bestD = Infinity;
    for (const m of mine) {
      if (m.contested) continue;
      for (const t of theirs) {
        const d = Math.hypot(m.spec.at.x - t.spec.at.x, m.spec.at.z - t.spec.at.z);
        if (d < bestD) {
          bestD = d;
          best = m;
        }
      }
    }
    return best;
  }
}
