import type { GameContext, MenuHandle, MenuOptions, Player } from '@platform';
import type { TeamColor } from './map';
import { TEAM_STYLE, type Match } from './state';
import { MAPS, mapById, type PlacedMap } from './world';

/**
 * Who plays the places nobody's in: bots in every one (`fill`), one bot for each team nobody
 * picked (`teams`), or no bots at all (`none`: a team with nobody in it is out from the start).
 */
export type BotFill = 'fill' | 'teams' | 'none';

/** What the lobby settled on: the map, places per team, the bots, and who's on which team. */
export interface Plan {
  map: PlacedMap;
  size: number;
  bots: BotFill;
  teams: Map<Player, TeamColor>;
}

/** Seconds a public lobby waits once someone's in it, and once everyone's ready. */
export const COUNTDOWN = 30;
export const READY_COUNTDOWN = 5;

const SIZES = [
  [0, 'Auto', 'As many a team as it takes for everyone'],
  [1, 'Solos', 'One a team'],
  [2, 'Doubles', 'Two a team'],
  [3, 'Threes', 'Three a team'],
  [4, 'Fours', 'Four a team'],
] as const;
const BOTS: [BotFill, string, string][] = [
  ['fill', 'Fill every place', 'Bots play every place nobody takes'],
  ['teams', 'Only empty teams', 'A bot for each team nobody picked'],
  ['none', 'No bots', 'People only (at least two teams)'],
];

/**
 * The waiting room before each match: a glass box over the map. Everyone in the room is in it;
 * they pick a team (stand on its pad, or from the menu: M), vote on the map, and say they're
 * ready. A public lobby starts on its own `COUNTDOWN` after someone's in it; a room of one's own
 * waits till everyone's ready (and its players pick the team size and the bots). Everyone ready:
 * it starts in `READY_COUNTDOWN`.
 */
export class Lobby {
  private picks = new Map<Player, TeamColor>();
  private votes = new Map<Player, string>();
  private ready = new Set<Player>();
  private menus = new Map<Player, MenuHandle>();
  /** The full team each person was last turned away from (so a pad says so once). */
  private refused = new Map<Player, TeamColor>();
  /** Room of one's own settings (kept from match to match): places per team (0: as needed), bots. */
  size = 0;
  bots: BotFill = 'fill';
  /** When it starts (null: not counting down). */
  private startsAt: number | null = null;
  private lastTick = -1;
  /** Started by command, whatever the countdown says. */
  private forced = false;

  constructor(
    private game: GameContext,
    private m: Match,
    private go: (plan: Plan) => void,
  ) {}

  private get own(): boolean {
    return this.game.room !== 'public';
  }

  /** Everyone here (never the platform's bots: Bed Wars' own are creatures). */
  people(): Player[] {
    return this.game.players.filter((p) => !p.bot);
  }

  /** A new lobby over the match's map: picks, votes and readiness start over. */
  open() {
    this.picks.clear();
    this.votes.clear();
    this.ready.clear();
    this.startsAt = null;
    this.lastTick = -1;
    this.forced = false;
    for (const p of this.people()) this.enter(p);
  }

  /** Someone's in the lobby: in the box, empty-handed, with the menu up. */
  enter(p: Player) {
    const l = this.m.map.lobby;
    p.revive();
    p.freeze(false);
    p.teleport(l.spawn, l.yaw, -0.2);
    p.inventory.clear();
    p.armor = 0;
    p.setUniform(null);
    p.color = null;
    p.hud.objective(null);
    for (const id of ['iron', 'gold', 'diamond', 'emerald']) p.hud.stat(id, '', null);
    this.show(p);
    this.refresh();
  }

  leave(p: Player) {
    this.picks.delete(p);
    this.votes.delete(p);
    this.ready.delete(p);
    this.refused.delete(p);
    this.menus.get(p)?.close();
    this.menus.delete(p);
    this.refresh();
  }

  /** The match is on: menus down. */
  close() {
    for (const m of this.menus.values()) m.close();
    this.menus.clear();
    this.startsAt = null;
  }

  /** The menu (again, if they closed it). */
  show(p: Player) {
    this.menus.get(p)?.close();
    const menu: MenuHandle = p.hud.menu({
      ...this.contents(p),
      onClose: () => {
        if (this.menus.get(p) === menu) this.menus.delete(p);
      },
    });
    this.menus.set(p, menu);
  }

  /** A room of one's own set to a size: a team with that many picks is full. */
  private get cap(): number {
    return this.own && this.size ? this.size : 4;
  }

  pick(p: Player, color: TeamColor | null) {
    if (color === (this.picks.get(p) ?? null)) return;
    if (color && this.count(color) >= this.cap) {
      // Told once for as long as they stand on its pad.
      if (this.refused.get(p) !== color) p.hud.toast(`${TEAM_STYLE[color].name} is full`);
      this.refused.set(p, color);
      return;
    }
    if (color) this.picks.set(p, color);
    else this.picks.delete(p);
    if (color) {
      p.setUniform(null);
      p.color = TEAM_STYLE[color].css;
      p.hud.toast(`You'll play for ${TEAM_STYLE[color].name}`);
    } else p.color = null;
    p.audio.play('click');
    this.refresh();
  }

  /** Start now (the `bw start` command): as if the countdown ran out. */
  startNow() {
    this.forced = true;
  }

  update() {
    const game = this.game;
    const now = game.clock.now;
    const people = this.people();
    const l = this.m.map.lobby;
    for (const p of people) {
      // Out of the box somehow: back in.
      if (p.position.y < l.feet - 4) p.teleport(l.spawn, l.yaw, 0);
      // Standing on a team's pad picks it.
      const q = p.position;
      const pad = Math.abs(q.y - l.feet) < 0.6 ? l.pads.find((d) => Math.abs(Math.floor(q.x) - d.x) <= 1 && Math.abs(Math.floor(q.z) - d.z) <= 1) : undefined;
      if (pad) this.pick(p, pad.color);
      else this.refused.delete(p);
      if (p.input.pressed('KeyM')) this.show(p);
    }
    if (!people.length) {
      this.startsAt = null;
      return;
    }
    const allReady = people.every((p) => this.ready.has(p));
    if (this.own) {
      // A room of one's own waits for everyone.
      if (!allReady) this.startsAt = null;
      else this.startsAt ??= now + READY_COUNTDOWN;
    } else {
      this.startsAt ??= now + COUNTDOWN;
      if (allReady) this.startsAt = Math.min(this.startsAt, now + READY_COUNTDOWN);
    }
    const left = this.startsAt === null ? null : Math.max(0, Math.ceil(this.startsAt - now));
    if ((left ?? -1) !== this.lastTick) {
      this.lastTick = left ?? -1;
      if (left !== null && left > 0 && left <= 5) {
        game.hud.banner(String(left), 'Get ready', { duration: 0.9, color: '#ff5b5b' });
        game.audio.play('countdown');
      }
      for (const p of people) p.hud.objective(this.status(p, left));
      for (const [p, menu] of this.menus) if (menu.open) menu.update({ subtitle: this.subtitle(p, left) });
    }
    if (this.forced || (this.startsAt !== null && now >= this.startsAt)) this.go(this.plan());
  }

  /** Places on each team as things stand: the room's choice, else enough for the biggest pick; and room for everyone. */
  private teamSize(): number {
    const colors = this.m.map.teams.map((t) => t.color);
    const need = Math.ceil(this.people().length / colors.length);
    const most = Math.max(0, ...colors.map((c) => this.count(c)));
    return Math.min(4, Math.max(need, this.own && this.size ? this.size : Math.max(1, most)));
  }

  /** Who goes where, on which map. Anyone whose pick was full is told where they went instead. */
  plan(): Plan {
    const people = this.people();
    const colors = this.m.map.teams.map((t) => t.color);
    const size = this.teamSize();
    const teams = new Map<Player, TeamColor>();
    const on = (c: TeamColor) => [...teams.values()].filter((x) => x === c).length;
    // Picks first, as long as there's room; then everyone else, to whichever team has fewest.
    for (const p of people) {
      const c = this.picks.get(p);
      if (c && on(c) < size) teams.set(p, c);
    }
    for (const p of people) {
      if (teams.has(p)) continue;
      const open = colors.filter((c) => on(c) < size);
      if (!open.length) break;
      const c = open.reduce((a, b) => (on(b) < on(a) ? b : a));
      teams.set(p, c);
      const wanted = this.picks.get(p);
      if (wanted) p.hud.toast(`${TEAM_STYLE[wanted].name} was full: you play for ${TEAM_STYLE[c].name}`);
    }
    // No bots needs two teams with someone on them.
    const bots = this.own ? (this.bots === 'none' && new Set(teams.values()).size < 2 ? 'teams' : this.bots) : 'fill';
    return { map: mapById(this.nextMap()) ?? this.m.map, size, bots, teams };
  }

  private count(c: TeamColor): number {
    return [...this.picks.values()].filter((x) => x === c).length;
  }

  /** The map with the most votes; a tie, or none, goes to the next in turn (a public room) or the same again (one's own). */
  private nextMap(): string {
    const i = MAPS.findIndex((m) => m.id === this.m.map.id);
    const dflt = this.own ? this.m.map.id : MAPS[(i + 1) % MAPS.length].id;
    const votes = this.voteCounts();
    const top = Math.max(0, ...votes.values());
    if (!top) return dflt;
    const tied = MAPS.filter((m) => votes.get(m.id) === top).map((m) => m.id);
    return tied.includes(dflt) ? dflt : tied[0];
  }

  private voteCounts(): Map<string, number> {
    const n = new Map<string, number>();
    for (const id of this.votes.values()) n.set(id, (n.get(id) ?? 0) + 1);
    return n;
  }

  private status(p: Player, left: number | null): string {
    const n = this.people().length;
    const team = this.picks.get(p);
    const when = left === null ? (this.ready.has(p) ? 'Waiting for everyone to be ready' : 'Ready up to start (M)') : `Starting in ${left}s`;
    return `LOBBY · ${when} · ${n} ${n === 1 ? 'player' : 'players'} · ${team ? `You: ${TEAM_STYLE[team].name}` : 'Stand on a pad to pick a team'} · M for the menu`;
  }

  private subtitle(p: Player, left: number | null): string {
    const next = mapById(this.nextMap())!;
    const when = left === null ? (this.own ? 'Starts when everyone is ready' : 'Waiting for players') : `Starting in ${left}s`;
    return `${when} · Next map: ${next.name}${this.ready.has(p) ? ' · You are ready' : ''}`;
  }

  /** Every menu that's up, as things stand now. */
  private refresh() {
    const left = this.startsAt === null ? null : Math.max(0, Math.ceil(this.startsAt - this.game.clock.now));
    for (const [p, menu] of this.menus) if (menu.open) menu.update(this.contents(p, left));
    for (const p of this.people()) p.hud.objective(this.status(p, left));
  }

  private contents(p: Player, left: number | null = null): MenuOptions {
    const mine = this.picks.get(p);
    const votes = this.voteCounts();
    const cap = this.cap;
    const next = this.nextMap();
    const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;
    const sections: MenuOptions['sections'] = [
      {
        title: 'Your team',
        entries: [
          ...this.m.map.teams.map((t) => {
            const style = TEAM_STYLE[t.color];
            const who = [...this.picks].filter(([, c]) => c === t.color).map(([q]) => q.name);
            return {
              icon: { block: style.wool },
              label: style.name,
              note: who.length ? who.join(', ') : 'Nobody yet',
              active: mine === t.color,
              detail: mine === t.color ? 'Your team' : who.length >= cap ? 'Full' : '',
              disabled: who.length >= cap && mine !== t.color,
              onSelect: () => this.pick(p, t.color),
            };
          }),
          { icon: { block: 'white_wool' }, label: 'Any team', note: 'Put me wherever there’s room', active: !mine, onSelect: () => this.pick(p, null) },
        ],
      },
    ];
    if (MAPS.length > 1) {
      sections.push({
        title: 'Map',
        entries: MAPS.map((m) => {
          const n = votes.get(m.id) ?? 0;
          return {
            icon: m.icon,
            label: m.name,
            note: m.blurb,
            detail: [n ? plural(n, 'vote') : '', next === m.id ? 'next' : ''].filter(Boolean).join(' · '),
            active: this.votes.get(p) === m.id,
            onSelect: () => {
              this.votes.set(p, m.id);
              this.refresh();
            },
          };
        }),
      });
    }
    if (this.own) {
      sections.push(
        {
          title: 'Team size',
          entries: SIZES.map(([n, label, note]) => ({ label, note, active: this.size === n, onSelect: () => this.set(() => (this.size = n)) })),
        },
        {
          title: 'Bots',
          entries: BOTS.map(([id, label, note]) => ({ label, note, active: this.bots === id, onSelect: () => this.set(() => (this.bots = id)) })),
        },
      );
    }
    const ready = this.ready.has(p);
    sections.push({
      entries: [
        {
          icon: { block: ready ? 'lime_wool' : 'white_wool' },
          label: ready ? 'Ready!' : 'Ready',
          note: ready ? 'Click again if you’re not' : this.own ? 'It starts once everyone is ready' : `Everyone ready: it starts in ${READY_COUNTDOWN}`,
          active: ready,
          onSelect: () => {
            if (this.ready.has(p)) this.ready.delete(p);
            else this.ready.add(p);
            p.audio.play('click');
            this.refresh();
          },
        },
      ],
    });
    return { title: 'Bed Wars lobby', subtitle: this.subtitle(p, left), sections };
  }

  /** A room's setting changed: everyone sees it, and has to say they're ready again. */
  private set(change: () => void) {
    change();
    this.ready.clear();
    this.refresh();
  }
}
