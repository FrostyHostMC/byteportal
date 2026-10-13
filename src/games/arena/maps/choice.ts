import type { GameContext, MenuHandle, Player } from '@platform';
import { bus } from '../run/bus';
import { map, setMap } from '../run/state';
import { MAPS, mapById, type ArenaMap } from './index';

/**
 * Which map a fight's on. The public room goes round the maps (`MAPS`, in order), a run on each;
 * as a run ends, everyone in it is asked where the next is fought (a row of the maps along the
 * bottom of the screen, under the HUD's end screen, which makes room for it; M brings the same up
 * as a menu when nothing else is up), the most votes winning and a tie (or no votes) going to the
 * rotation's next. In a room of one's own it's a pick: the same at the end of a run (the same map
 * again if nobody picks), and M picks a map to start over on at any time. A won run carried on
 * into the endless waves (`keepFighting`) stands the vote down; it opens again when that ends. The
 * change happens as the next fight starts (`chooseMap`, from the maps' part's `start`).
 */

export const PICK_KEY = 'KeyM';
/** The vote's row of maps (the HUD's end screen moves up for a widget of this name), and how long after a run ends it's put up. */
const VOTE = 'arena-vote';
const AFTER = 1.5;
/** How long a vote shows as made before its menu closes. */
const SEEN = 1.1;

/** The next fight's map, once a run's ended (null: the same again, as after a reset). */
let planned: ArenaMap | null = null;
/** Each fighter's vote (player id → map id), and their menus while they're up. */
const votes = new Map<string, string>();
const menus = new Map<string, MenuHandle>();
/** The vote's on (a run's ended, the next not yet begun). */
let voting = false;

const own = (game: GameContext) => game.room !== 'public';
const next = (m: ArenaMap) => MAPS[(MAPS.indexOf(m) + 1) % MAPS.length];

export function setupChoice(game: GameContext) {
  planned = null;
  votes.clear();
  menus.clear();
  voting = false;
  game.hud.define(VOTE, {
    at: 'bottom',
    html: `<div class="vote">
      <div class="head"><b>Next arena</b><span>{{note}}</span></div>
      <div class="cards"><button data-each="maps" class="card {{state}}" data-action="vote" data-value="{{id}}" style="--c: {{color}}">
        <span class="name">{{name}}</span><span class="line">{{line}}</span>
        <span class="tally"><em data-if="votes > 0">{{votes}}</em><i data-if="state == 'mine'">your pick</i><i data-if="state == 'next'">next</i><i data-if="state == 'mine next'">your pick · next</i></span>
      </button></div>
    </div>`,
    css: VOTE_CSS,
    actions: { vote: (p, id) => vote(game, p, id) },
  });
  game.commands.register('map', {
    usage: '<map>',
    help: 'Start the fight over on another map',
    cheat: true,
    complete: () => MAPS.map((m) => m.id),
    run: ([id], g) => {
      const m = mapById(id);
      if (!m) return `Maps: ${MAPS.map((x) => x.id).join(', ')}`;
      voting = false;
      planned = m;
      g.restart();
    },
  });
  // In a room of one's own, each arrival is told (once the fly-over's done) that M picks the map.
  game.events.on('playerReady', ({ player }) => {
    if (own(game) && !player.bot) game.clock.after(8, () => game.players.includes(player) && player.hud.toast('Your own arena · M picks the map'));
  });
  bus.on('keepFighting', () => standDown(game));
  game.events.on('playerLeave', ({ player }) => {
    votes.delete(player.id);
    menus.delete(player.id);
    if (voting) refresh(game);
  });
}

/** A run's over: the vote on the next opens, for everyone in it. */
export function runEnded(game: GameContext) {
  planned = own(game) ? map() : next(map());
  votes.clear();
  voting = true;
  // A moment for the results to land before the vote's put up under them.
  game.clock.after(AFTER, () => voting && refresh(game));
}

/** The fight goes on after all (a won run carried on into the endless waves): no vote, the same map. */
function standDown(game: GameContext) {
  if (!voting) return;
  voting = false;
  planned = null;
  votes.clear();
  for (const p of game.players) if (!p.bot) p.hud.widget(VOTE).remove();
  for (const menu of menus.values()) menu.close();
  menus.clear();
}

/** What wins as the votes stand: the most votes; a tie (or none) to what was coming anyway. */
function winner(): ArenaMap {
  const fallback = planned ?? map();
  const count = new Map<string, number>();
  for (const id of votes.values()) count.set(id, (count.get(id) ?? 0) + 1);
  const top = Math.max(0, ...count.values());
  if (!top) return fallback;
  const tied = MAPS.filter((m) => count.get(m.id) === top);
  return tied.includes(fallback) ? fallback : tied[0];
}

function vote(game: GameContext, p: Player, id: string) {
  if (!voting || !mapById(id)) return;
  votes.set(p.id, id);
  p.audio.play('click');
  refresh(game);
  // A menu brought up to vote in: seen as made a moment, then out of the way of their results.
  const menu = menus.get(p.id);
  game.clock.after(SEEN, () => {
    if (menus.get(p.id) === menu && menu?.open) menu.close();
  });
}

/** Everyone's row of maps (and menu, if it's up) as the votes stand. */
function refresh(game: GameContext) {
  const win = winner();
  const count = new Map<string, number>();
  for (const id of votes.values()) count.set(id, (count.get(id) ?? 0) + 1);
  for (const p of game.players) {
    if (p.bot) continue;
    const mine = votes.get(p.id);
    const maps = MAPS.map((m) => ({
      id: m.id,
      name: m.name,
      line: m.line,
      color: m.color,
      votes: own(game) ? 0 : (count.get(m.id) ?? 0),
      state: [mine === m.id ? 'mine' : '', win === m && !own(game) ? 'next' : ''].filter(Boolean).join(' '),
    }));
    p.hud.widget(VOTE, { note: subtitle(game), maps });
    const menu = menus.get(p.id);
    if (menu?.open) menu.update({ subtitle: subtitle(game), sections: sections(game, p) });
  }
}

/** What the vote's menu says under its title. */
const subtitle = (game: GameContext) => (own(game) ? 'Where do you fight next?' : `Most votes wins · up next: ${winner().name}`);

/** The vote (or, in a room of one's own, the pick) as a menu: M. */
function offer(game: GameContext, p: Player) {
  menus.get(p.id)?.close();
  const menu = p.hud.menu({
    title: voting ? 'Next arena' : 'Choose the arena',
    subtitle: voting ? subtitle(game) : 'Start the fight over on another map',
    sections: sections(game, p),
    onClose: () => {
      if (menus.get(p.id) === menu) menus.delete(p.id);
    },
  });
  menus.set(p.id, menu);
}

function sections(game: GameContext, p: Player) {
  const mine = votes.get(p.id);
  const win = winner();
  const count = new Map<string, number>();
  for (const id of votes.values()) count.set(id, (count.get(id) ?? 0) + 1);
  // The votes for each and which is next (in a room of one's own, the pick shows as theirs).
  const tally = (m: ArenaMap) => {
    if (own(game)) return '';
    const n = count.get(m.id) ?? 0;
    return win === m ? (n ? `${n} · next` : 'next') : n ? `${n} vote${n === 1 ? '' : 's'}` : '';
  };
  return [
    {
      entries: MAPS.map((m) => ({
        icon: { block: m.icon },
        label: m.name,
        note: m.line,
        detail: voting ? tally(m) : m === map() ? 'now' : '',
        active: voting ? mine === m.id : m === map(),
        onSelect: () => {
          if (voting) return vote(game, p, m.id);
          // A pick in one's own room: the fight starts over there.
          planned = m;
          menus.get(p.id)?.close();
          game.hud.feed([{ text: p.name, color: '#ffd36b' }, ` takes the fight to ${m.name}`]);
          game.restart();
        },
      })),
    },
  ];
}

/** Every tick: M brings up the vote (or the pick); in the public room between votes, it says what's next. */
export function updateChoice(game: GameContext) {
  for (const p of game.players) {
    if (p.bot || !p.input.pressed(PICK_KEY, { dead: true })) continue;
    if (voting || own(game)) offer(game, p);
    else p.hud.toast(`The arena moves on each run · next: ${next(map()).name} · vote when this run ends`);
  }
}

/**
 * A fight begins: on the vote's winner if a run just ended (the same map after a reset or a pick
 * made); newcomers come in at its middle, and the fighters are moved there.
 */
export function chooseMap(game: GameContext) {
  const m = voting ? winner() : (planned ?? map());
  if (voting) for (const p of game.players) if (!p.bot) p.hud.widget(VOTE).remove();
  for (const menu of menus.values()) menu.close();
  menus.clear();
  votes.clear();
  voting = false;
  planned = null;
  const moved = m !== map();
  setMap(m);
  game.env.time = m.time;
  const c = m.center;
  game.world.spawn = { x: c.x, y: c.y + 0.05, z: c.z, yaw: 0 };
  if (!moved) return;
  // Everyone to the new map's middle, spread out a little.
  game.players.forEach((p, i) => {
    const a = (i / Math.max(1, game.players.length)) * Math.PI * 2;
    const r = game.players.length > 1 ? 1.5 : 0;
    p.teleport({ x: c.x + Math.cos(a) * r, y: c.y + 0.05, z: c.z + Math.sin(a) * r }, game.rng.range(0, Math.PI * 2), 0);
  });
}

/** The row of maps: compact (it sits under the end screen's buttons), in the HUD's palette where it has one. */
const VOTE_CSS = `
:scope { margin-bottom: 22px; pointer-events: auto; }
.vote { display: flex; flex-direction: column; align-items: center; gap: 6px; }
.head { display: flex; gap: 12px; align-items: baseline; font: 500 12px/1 var(--ar-label, var(--sans)); letter-spacing: 0.06em; color: var(--ar-fg2, #e9dcc4); text-shadow: 0 1px 3px #000c; }
.head b { font: 700 15px/1 var(--ar-title, var(--pixel)); letter-spacing: 0.14em; text-transform: uppercase; color: var(--ar-gold, #ffd36b); }
.cards { display: flex; gap: 8px; }
.card { all: unset; box-sizing: border-box; width: 180px; padding: 8px 11px 7px; display: flex; flex-direction: column; gap: 2px; cursor: pointer;
  background: var(--ar-glass, linear-gradient(180deg, #1c140ee6, #0d0907e6)); border: 1px solid var(--ar-line, #ffffff26); border-top: 3px solid var(--c); border-radius: 5px;
  box-shadow: 0 6px 16px #0008; transition: transform 120ms ease, border-color 120ms ease; }
.card:hover { transform: translateY(-2px); border-color: var(--ar-line2, #ffffff55); }
.card.mine, .card.mine.next { border-color: var(--c); box-shadow: 0 0 0 1px var(--c), 0 6px 16px #0008; }
.name { font: 700 13px/1.15 var(--ar-title, var(--pixel)); color: var(--ar-fg, #fff3df); letter-spacing: 0.02em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.line { font: 400 11px/1.3 var(--sans); color: var(--ar-fg3, #d8c8adcc); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tally { display: flex; gap: 7px; align-items: center; font: 600 10px/1 var(--ar-label, var(--sans)); color: var(--c); min-height: 14px; }
.tally em { font-style: normal; background: var(--c); color: #140c06; border-radius: 8px; padding: 2px 6px; }
.tally i { font-style: normal; text-transform: uppercase; letter-spacing: 0.1em; }
@media (max-width: 1400px) { .card { width: 156px; } .line { display: none; } }
`;
