import type { GameContext, IconRef, MenuHandle, MenuOptions, Player } from '@platform';
import { MAPS } from './map';
import { match } from './match';
import { MODES, type MatchPlan, type ModeId } from './modes';

/**
 * The vote on what's next. Once a match is played out and its final scores have had a moment,
 * everyone in it is asked what to play next: a mode and a map, each voted on by itself, from a
 * menu that shows the counts as they come in (anyone can change their mind till the countdown's
 * out; closed, M brings it back). The most votes wins each; a tie, or no votes at all, goes to
 * what was coming next anyway (the rotation's next in a public room, the same again in a room of
 * one's own), else to the first of those tied. Only people vote: never bots. A match skipped
 * (the `skipVote` kit) moves straight on to the next without one.
 */

/** Seconds of final scores before the vote opens, and how long it's open. */
export const SCORES = 4;
export const VOTING = 14;

/** What the vote needs from the rest of the server. */
export interface NextHost {
  /** The menu's pictures. */
  modeIcon(id: ModeId): IconRef;
  mapIcon(id: string): IconRef;
  /** A match's name ("Team Deathmatch on Hijacked"). */
  name(plan: MatchPlan): string;
}

type Pick = { mode?: ModeId; map?: string };

export class NextVote {
  /** Each person's picks (player ids), and their menus while they're up. */
  private picks = new Map<string, Pick>();
  private menus = new Map<string, MenuHandle>();
  /** What's next if nobody votes; null while there's no vote on. */
  private fallback: MatchPlan | null = null;
  private closesAt = 0;

  constructor(
    private game: GameContext,
    private host: NextHost,
  ) {}

  /** A vote's on. */
  get open(): boolean {
    return this.fallback !== null;
  }

  /** The people in the match: they vote. */
  people(): Player[] {
    return [...match.fighters.values()].map((f) => f.player).filter((p) => !p.bot);
  }

  /** The vote opens for `seconds` (the match played out, its scores seen): everyone in it gets the menu. */
  begin(fallback: MatchPlan, seconds = VOTING) {
    this.close();
    this.fallback = fallback;
    this.closesAt = this.game.clock.now + seconds;
    for (const p of this.people()) this.offer(p);
  }

  /** Their menu (again, if they closed it; or they've just joined). */
  offer(p: Player) {
    if (!this.open || p.bot || !match.fighters.has(p.id)) return;
    this.menus.get(p.id)?.close();
    const menu: MenuHandle = p.hud.menu({
      title: 'Next match',
      subtitle: this.subtitle(),
      sections: this.sections(p),
      onClose: () => {
        if (this.menus.get(p.id) === menu) this.menus.delete(p.id);
      },
    });
    this.menus.set(p.id, menu);
  }

  /** Someone left: their votes go with them. */
  left(p: Player) {
    this.picks.delete(p.id);
    this.menus.delete(p.id);
    if (this.open) this.refresh();
  }

  /** Once a second: the countdown on every menu that's up (the entries as they are). */
  tick() {
    if (!this.open) return;
    for (const menu of this.menus.values()) if (menu.open) menu.update({ subtitle: this.subtitle() });
  }

  /** What wins as the votes stand: the most votes for each; a tie to what was coming next, else the first tied. */
  winner(): MatchPlan {
    const fallback = this.fallback ?? { mode: match.mode.id, map: match.map.id };
    const { modes, maps } = this.counts();
    const best = <T extends string>(ids: readonly T[], votes: Map<string, number>, dflt: T): T => {
      const top = Math.max(0, ...votes.values());
      if (!top) return dflt;
      const tied = ids.filter((id) => (votes.get(id) ?? 0) === top);
      return tied.includes(dflt) ? dflt : tied[0];
    };
    return {
      mode: best(Object.keys(MODES) as ModeId[], modes, fallback.mode),
      map: best(
        MAPS.map((m) => m.id),
        maps,
        fallback.map,
      ),
    };
  }

  /** The countdown's out: what's next (the menus close). */
  end(): MatchPlan {
    const plan = this.winner();
    const votes = this.picks.size;
    this.close();
    if (votes) this.game.hud.feed([`The vote's in: ${this.host.name(plan)} next`]);
    return plan;
  }

  /** No vote on: menus closed, votes gone. */
  close() {
    for (const m of this.menus.values()) m.close();
    this.menus.clear();
    this.picks.clear();
    this.fallback = null;
  }

  private choose(p: Player, pick: Pick) {
    if (!this.open || !match.fighters.has(p.id)) return;
    this.picks.set(p.id, { ...this.picks.get(p.id), ...pick });
    this.refresh();
  }

  private counts() {
    const modes = new Map<string, number>();
    const maps = new Map<string, number>();
    for (const pick of this.picks.values()) {
      if (pick.mode) modes.set(pick.mode, (modes.get(pick.mode) ?? 0) + 1);
      if (pick.map) maps.set(pick.map, (maps.get(pick.map) ?? 0) + 1);
    }
    return { modes, maps };
  }

  /** Every menu that's up, as the votes stand now. */
  private refresh() {
    for (const [id, menu] of this.menus) {
      const p = match.fighters.get(id)?.player;
      if (p && menu.open) menu.update({ subtitle: this.subtitle(), sections: this.sections(p) });
    }
  }

  private subtitle(): string {
    const left = Math.max(0, Math.ceil(this.closesAt - this.game.clock.now));
    return `Vote for the mode and the map: the most votes wins each. Up next: ${this.host.name(this.winner())}, in ${left}`;
  }

  private sections(p: Player): MenuOptions['sections'] {
    const { modes, maps } = this.counts();
    const mine = this.picks.get(p.id);
    const next = this.winner();
    const detail = (n: number, leads: boolean) => [n ? `${n} vote${n === 1 ? '' : 's'}` : '', leads ? 'next' : ''].filter(Boolean).join(' · ');
    return [
      {
        title: 'Mode',
        entries: Object.values(MODES).map((m) => ({
          icon: this.host.modeIcon(m.id),
          label: m.name,
          note: m.goal,
          detail: detail(modes.get(m.id) ?? 0, next.mode === m.id),
          active: mine?.mode === m.id,
          onSelect: () => this.choose(p, { mode: m.id }),
        })),
      },
      {
        title: 'Map',
        entries: MAPS.map((m) => ({
          icon: this.host.mapIcon(m.id),
          label: m.name,
          note: m.blurb,
          detail: detail(maps.get(m.id) ?? 0, next.map === m.id),
          active: mine?.map === m.id,
          onSelect: () => this.choose(p, { map: m.id }),
        })),
      },
    ];
  }
}
