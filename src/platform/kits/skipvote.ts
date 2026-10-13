import type { GameContext, Player, WidgetHandle } from '@platform';

/**
 * The vote to skip. Someone who doesn't fancy the match that's on (its mode, its map, or the two
 * together) votes (a key, or `/skip`: the game wires those to `toggle`), and once more than half
 * of the people in it have, it's skipped: `skip` moves on. Only the people the game names vote,
 * and only they count toward the half (never bots). Voting again takes your vote back.
 *
 * A vote is for the match on now. It opens a few seconds in (time to see what's on, and a skip
 * can't run on into the match after it), shuts once the match is over, and starts from nothing
 * with each match (`reset`, at each start). Someone leaving takes their vote with them, and
 * everyone left is counted again: the votes still in may be a majority now. Each vote goes up in
 * the feed with the count, and the game's widget (`widget`, default `skipvote`) keeps the count
 * while any are in: `{ what, votes, need, pips }` for everyone (`pips` 'on' or 'off', one for
 * each vote it takes), and each person's own `{ voted }`.
 *
 * ```ts
 * vote = skipVote(game, { people, playing: () => phase === 'playing', match: () => ({ mode, map }), skip: () => endEarly() });
 * // update: for (const p of game.players) if (!p.bot && p.input.pressed('KeyV', { dead: true })) { const no = vote.toggle(p); if (no) p.hud.toast(no); }
 * ```
 */
export interface SkipVoteOptions {
  /** The people in the match: they vote, and the majority is theirs (bots are left out anyway). */
  people(): Player[];
  /** A match is on (not over, not between matches): votes count only then. */
  playing(): boolean;
  /** What's on now, for the feed ("mode on map") and the widget ("mode · map"). */
  match(): { mode: string; map: string };
  /** The vote passed: skip the match on now. */
  skip(): void;
  /** A name's colour in the feed (their side's, in a team mode). Default white. */
  color?(p: Player): string;
  /** The HUD widget it fills. Default `skipvote`. */
  widget?: string;
  /** Seconds into a match before the vote opens. Default 10. */
  opens?: number;
  /** Seconds between one person's changes of mind (a key hammered can't fill the feed). Default 2. */
  settle?: number;
}

export interface SkipVote {
  /** Their vote in, or taken back. Null if it was; else why not, for them to read. */
  toggle(p: Player): string | null;
  /** A match begins (or is over): no votes in, and no widget. */
  reset(): void;
  /** Someone joined: one more person to count (the vote takes more now). */
  joined(p: Player): void;
  /** Someone left: their vote goes with them, and everyone left is counted again. */
  left(p: Player): void;
  /** Whether they've voted to skip the match on now. */
  voted(p: Player): boolean;
  /** Votes in now. */
  readonly votes: number;
}

export function skipVote(game: GameContext, o: SkipVoteOptions): SkipVote {
  const widget = o.widget ?? 'skipvote';
  const opens = o.opens ?? 10;
  const settle = o.settle ?? 2;
  /** Who's voted to skip the match on now (player ids). */
  const votes = new Set<string>();
  /** When each person last voted or took it back (`game.clock.now`). */
  const changed = new Map<string, number>();
  let since = game.clock.now;
  let card: WidgetHandle | null = null;

  const people = () => o.people().filter((p) => !p.bot);
  /** The votes it takes: more than half of the people. */
  const need = () => Math.floor(people().length / 2) + 1;

  const reset = () => {
    votes.clear();
    changed.clear();
    since = game.clock.now;
    card?.remove();
    card = null;
  };

  /** Count the votes again: a majority skips the match; short of one, the widget shows where it stands, and goes when nobody's voting. */
  const count = () => {
    if (!o.playing()) return;
    const n = votes.size;
    const k = need();
    if (n >= k) {
      reset();
      o.skip();
      return;
    }
    if (!n) {
      card?.remove();
      card = null;
      return;
    }
    const m = o.match();
    const pips = Array.from({ length: k }, (_, i) => (i < n ? 'on' : 'off'));
    card = game.hud.widget(widget, { what: `${m.mode} · ${m.map}`, votes: n, need: k, pips });
    for (const p of people()) p.hud.widget(widget, { voted: votes.has(p.id) });
  };

  return {
    get votes() {
      return votes.size;
    },
    reset,
    voted: (p) => votes.has(p.id),
    toggle(p) {
      const now = game.clock.now;
      if (p.bot || !people().some((q) => q.id === p.id)) return 'Only people in the match vote';
      if (!o.playing()) return "This one's over: the next is on in a moment";
      const wait = opens - (now - since);
      if (wait > 0) return `The vote to skip opens in ${Math.ceil(wait)} s`;
      if (now - (changed.get(p.id) ?? -Infinity) < settle) return 'Hang on a second';
      const yes = !votes.has(p.id);
      if (yes) votes.add(p.id);
      else votes.delete(p.id);
      changed.set(p.id, now);
      const m = o.match();
      game.hud.feed([{ text: p.name, color: o.color?.(p) ?? '#ffffff' }, yes ? ` voted to skip ${m.mode} on ${m.map}` : ' took back their vote to skip', ` (${votes.size}/${need()})`]);
      count();
      return null;
    },
    joined(p) {
      if (!p.bot) count();
    },
    left(p) {
      votes.delete(p.id);
      changed.delete(p.id);
      if (!p.bot) count();
    },
  };
}
