import type { GameContext, Player, WidgetDefinition } from '@platform';
import type { RunResult, Unlock } from '../run/bus';
import { WAVES } from '../run/director';
import type { Tallies } from './tally';

/** How a run ended, as the end screen tells it. */
export interface EndRun {
  won: boolean;
  /** The wave it ended on (won: the last), the last before endless, its name. */
  wave: number;
  of: number;
  name: string;
  /** Seconds it lasted, on which map; whether it was in the endless waves. */
  time: number;
  map: string;
  endless: boolean;
}

/** What the run's part said of each fighter at the end (`runEnd`'s results), the levels they reached on the way, and their classes. */
export interface EndExtras {
  results: RunResult[];
  unlocks: Map<string, Unlock[]>;
  classes: Map<string, string>;
}

/** A fighter's experience from the run, as the end screen shows it. */
interface EndXp {
  earned: string;
  lines: { label: string; amount: string }[];
  level: number;
  /** The bar before and after, 0..1 of the level now (before: 0 when they've gone up). */
  from: number;
  to: number;
  up: number;
  togo: string;
  unlocks: { kind: string; name: string }[];
  guest: boolean;
}

const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const num = (n: number) => Math.round(n).toLocaleString('en-US');
/** A class's name from its id (`gladiator`: Gladiator). */
export const className = (id: string) => (id ? id[0].toUpperCase() + id.slice(1).replace(/_/g, ' ') : '');

/**
 * The end-of-run screen: VICTORY or DEFEATED over the run's track (a mark for every wave, the
 * bosses' bigger, lit as far as they got, the one that ended it in blood), the fighter's own run
 * (time, kills, damage, gold, bosses, their best chain, revives, times down, damage taken), the
 * party's (in co-op: each fighter, the best of them crowned), their experience (the XP it earned
 * by what for, the level bar filling from where it was, a level-up, unlocks) and the way on: play
 * again, keep fighting (after a victory, into the endless waves), or switch game. Each fighter's
 * own (`player.hud.widget`), modal (the mouse is theirs): closed, it comes straight back (there's
 * nothing else to do but choose).
 *
 * Its look is the HUD's (`hud.css`'s `--ar-*` tokens, read through the theme): marble type on
 * dark stone glass, the result word in Cinzel, gold for victory, blood for defeat.
 */
export const END: { name: string; def: WidgetDefinition } = {
  name: 'arena-end',
  def: {
    at: 'center',
    modal: true,
    html: `
    <div class="es es-{{result}}">
      <div class="kicker"><span>{{map}}</span><i></i><span>{{party}}</span></div>
      <div class="word">{{word}}</div>
      <div class="headline">{{headline}}</div>
      <div class="track"><span data-each="waves" class="pip {{.}}"></span></div>
      <div class="reached"><span class="wv">{{reached}}</span><span class="best" data-if="newBest">New best</span><span class="prev" data-if="best">{{best}}</span></div>
      <div class="cols">
        <div class="panel run">
          <div class="ph"><span>Your run</span><span class="cls" data-if="cls">{{cls}}</span></div>
          <div class="grid">
            <div class="cell"><span class="v">{{time}}</span><span class="k">Time</span></div>
            <div class="cell"><span class="v">{{kills}}</span><span class="k">Kills</span></div>
            <div class="cell"><span class="v">{{damage}}</span><span class="k">Damage</span></div>
            <div class="cell"><span class="v gold">{{gold}}</span><span class="k">Gold earned</span></div>
            <div class="cell"><span class="v">{{bosses}}</span><span class="k">Bosses slain</span></div>
            <div class="cell"><span class="v">{{chain}}</span><span class="k">Best chain</span></div>
            <div class="cell"><span class="v">{{revives}}</span><span class="k">Revives</span></div>
            <div class="cell"><span class="v">{{downs}}</span><span class="k">Times down</span></div>
            <div class="cell"><span class="v">{{taken}}</span><span class="k">Damage taken</span></div>
          </div>
        </div>
        <div class="panel xp" data-if="xp">
          <div class="ph"><span>Experience</span><b class="gain">+{{xp.earned}} XP</b></div>
          <div class="lines"><span data-each="xp.lines" class="line" style="--d: {{$i}}">{{label}}<b>+{{amount}}</b></span></div>
          <div class="level">
            <div class="badge"><small>LV</small><span>{{xp.level}}</span></div>
            <div class="bar" style="--from: {{xp.from}}; --to: {{xp.to}}"><i class="fill"></i><i class="was"></i></div>
            <div class="up" data-if="xp.up > 0">Level up</div>
            <div class="togo" data-if="xp.up == 0">{{xp.togo}}</div>
          </div>
          <div class="unlocks" data-if="xp.unlocks.length > 0"><span data-each="xp.unlocks" class="unlock" style="--d: {{$i}}"><small>{{kind}} unlocked</small>{{name}}</span></div>
          <div class="guest" data-if="xp.guest">Playing as a guest: sign in on the home page to keep your progress.</div>
        </div>
        <div class="panel crew" data-if="crew">
          <div class="ph"><span>The party</span></div>
          <div class="rows">
            <div class="row head"><span class="nm"></span><span>Kills</span><span>Damage</span><span>Gold</span></div>
            <div data-each="crew" class="row you-{{you}} mvp-{{mvp}}"><span class="nm"><i class="crown" data-if="mvp"></i><span class="who"><b>{{name}}</b><small data-if="cls">{{cls}}</small></span></span><span>{{kills}}</span><span>{{damage}}</span><span>{{gold}}</span></div>
          </div>
        </div>
      </div>
      <div class="buttons">
        <button data-action="keep" class="btn primary" data-if="keep">Keep fighting</button>
        <button data-action="again" class="btn {{againClass}}">Play again</button>
        <button data-action="exit" class="btn">Switch game</button>
      </div>
    </div>`,
    css: `
    :scope {
      --fg: var(--ar-fg, #f5efe4); --fg2: var(--ar-fg2, rgba(245, 239, 228, 0.7)); --fg3: var(--ar-fg3, rgba(245, 239, 228, 0.44));
      --gold: var(--ar-gold, #f0c060); --gold-hi: var(--ar-gold-hi, #ffe3a1); --bronze: var(--ar-bronze, #c0773a); --blood: var(--ar-blood, #d8343c);
      --line: var(--ar-line, rgba(224, 168, 96, 0.2)); --line2: var(--ar-line2, rgba(224, 168, 96, 0.42));
      --glass: var(--ar-glass, rgba(18, 13, 10, 0.6)); --glass2: var(--ar-glass2, rgba(14, 10, 8, 0.82));
      --title: var(--ar-title, Georgia, serif); --label: var(--ar-label, 'Arial Narrow', sans-serif);
      --shadow: 0 1px 6px rgba(0, 0, 0, 0.55);
      --c: var(--gold);
      color: var(--fg);
    }
    .es { width: min(960px, calc(100vw - 40px)); display: flex; flex-direction: column; align-items: center; animation: rise 800ms cubic-bezier(0.2, 0.8, 0.2, 1) both; }
    .es-defeat, .es-endless { --c: var(--blood); }
    .kicker { display: flex; align-items: center; gap: 14px; font: 500 13px/1 var(--label); letter-spacing: 0.4em; margin-right: -0.4em; color: var(--fg2); text-transform: uppercase; }
    .kicker i { width: 5px; height: 5px; background: var(--bronze); transform: rotate(45deg); }
    .word {
      margin-top: 12px; font: 800 92px/0.95 var(--title); letter-spacing: 0.14em; margin-right: -0.14em; text-transform: uppercase;
      background: linear-gradient(180deg, #fff6d8 10%, var(--gold) 55%, #b9802c 90%); -webkit-background-clip: text; background-clip: text; color: transparent;
      filter: drop-shadow(0 0 28px rgba(240, 192, 96, 0.35)) drop-shadow(0 3px 2px rgba(0, 0, 0, 0.6));
      animation: slam 900ms cubic-bezier(0.2, 0.8, 0.2, 1) both 150ms;
    }
    .es-endless .word { font-size: 64px; letter-spacing: 0.1em; }
    .es-defeat .word, .es-endless .word { background: linear-gradient(180deg, #ffd9d2 5%, #e0505a 50%, #8e1820 92%); -webkit-background-clip: text; background-clip: text; filter: drop-shadow(0 0 26px rgba(216, 52, 60, 0.35)) drop-shadow(0 3px 2px rgba(0, 0, 0, 0.6)); }
    .headline { margin-top: 12px; font: 500 16px/1.3 var(--sans); letter-spacing: 0.02em; color: var(--fg2); text-shadow: var(--shadow); text-align: center; }
    .track { margin-top: 20px; display: flex; align-items: center; gap: 8px; animation: fade 600ms ease both 500ms; }
    .pip { width: 11px; height: 11px; transform: rotate(45deg); background: rgba(255, 255, 255, 0.1); box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.2); }
    .pip.boss { width: 17px; height: 17px; margin: 0 3px; }
    .pip.won { background: var(--gold); box-shadow: 0 0 8px rgba(240, 192, 96, 0.55); }
    .pip.lost { background: var(--blood); box-shadow: 0 0 10px rgba(216, 52, 60, 0.8); animation: breathe 1.4s ease-in-out infinite; }
    .pip.more { width: auto; height: auto; transform: none; background: none; box-shadow: none; font: 600 12px/1 var(--label); letter-spacing: 0.1em; color: var(--gold); }
    .reached { margin-top: 12px; display: flex; align-items: center; gap: 12px; font: 500 13px/1 var(--label); letter-spacing: 0.3em; text-transform: uppercase; }
    .wv { color: var(--fg); }
    .best { padding: 4px 9px 3px; border-radius: 2px; background: var(--gold); color: #1a120a; font-weight: 600; letter-spacing: 0.24em; animation: glint 2.4s ease-in-out infinite 1.2s; }
    .prev { color: var(--fg3); }
    .cols { margin-top: 22px; width: 100%; display: flex; flex-wrap: wrap; justify-content: center; gap: 12px; }
    .panel { flex: 1 1 300px; max-width: 560px; display: flex; flex-direction: column; gap: 12px; padding: 14px 18px 16px; border-radius: 2px; background: var(--glass2); backdrop-filter: blur(12px); box-shadow: inset 0 1px 0 color-mix(in srgb, var(--c) 60%, transparent), inset 0 0 0 1px var(--line); animation: rise 700ms cubic-bezier(0.2, 0.8, 0.2, 1) both 650ms; }
    .panel.xp { animation-delay: 800ms; }
    .panel.crew { animation-delay: 950ms; }
    .ph { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; font: 500 11px/1 var(--label); letter-spacing: 0.36em; text-transform: uppercase; color: var(--bronze); }
    .gain { font: 600 22px/1 var(--label); letter-spacing: 0.04em; color: var(--gold-hi); text-shadow: 0 0 14px rgba(240, 192, 96, 0.45); }
    .grid { display: grid; grid-template-columns: repeat(3, 1fr); row-gap: 14px; }
    .cell { display: flex; flex-direction: column; gap: 5px; padding-left: 14px; border-left: 1px solid var(--line); }
    .cell:nth-child(3n + 1) { padding-left: 0; border-left: 0; }
    .v { font: 500 28px/1 var(--label); color: var(--fg); font-variant-numeric: tabular-nums; text-shadow: var(--shadow); }
    .v.gold { color: var(--gold-hi); }
    .k { font: 500 10px/1 var(--label); letter-spacing: 0.26em; text-transform: uppercase; color: var(--fg3); white-space: nowrap; }
    .lines { display: flex; flex-wrap: wrap; gap: 6px; }
    .line { display: flex; align-items: baseline; gap: 7px; padding: 4px 9px; border-radius: 2px; background: rgba(255, 255, 255, 0.05); box-shadow: inset 0 0 0 1px var(--line); font: 500 11px/1.2 var(--label); letter-spacing: 0.14em; text-transform: uppercase; white-space: nowrap; color: var(--fg2); animation: pop 400ms cubic-bezier(0.3, 1.6, 0.5, 1) both; animation-delay: calc(1000ms + var(--d) * 90ms); }
    .line b { font: 600 13px/1 var(--label); letter-spacing: 0.02em; color: var(--gold-hi); }
    .level { display: flex; align-items: center; gap: 12px; }
    .badge { display: flex; align-items: baseline; gap: 3px; padding: 6px 10px 5px; border-radius: 2px; background: linear-gradient(180deg, #ffe3a1, var(--gold) 60%, #b9802c); color: #1a120a; box-shadow: 0 0 16px rgba(240, 192, 96, 0.35); }
    .badge small { font: 600 9px/1 var(--label); letter-spacing: 0.1em; }
    .badge span { font: 700 22px/1 var(--label); }
    .bar { position: relative; flex: 1; height: 8px; border-radius: 1px; background: rgba(255, 255, 255, 0.08); box-shadow: inset 0 0 0 1px var(--line); overflow: hidden; }
    .bar i { position: absolute; left: 0; top: 0; bottom: 0; }
    .bar .was { width: calc(var(--from) * 100%); background: rgba(245, 239, 228, 0.55); }
    .bar .fill { width: calc(var(--to) * 100%); background: linear-gradient(90deg, var(--bronze), var(--gold-hi)); box-shadow: 0 0 10px rgba(240, 192, 96, 0.6); animation: fill 1500ms cubic-bezier(0.3, 0.7, 0.2, 1) both 1300ms; }
    .up { font: 700 14px/1 var(--title); letter-spacing: 0.14em; text-transform: uppercase; color: var(--gold-hi); text-shadow: 0 0 12px rgba(240, 192, 96, 0.6); white-space: nowrap; animation: pop 600ms cubic-bezier(0.3, 1.8, 0.5, 1) both 2700ms; }
    .togo { font: 500 11px/1 var(--label); letter-spacing: 0.2em; text-transform: uppercase; color: var(--fg3); white-space: nowrap; }
    .unlocks { display: flex; flex-wrap: wrap; gap: 8px; }
    .unlock { display: flex; flex-direction: column; gap: 3px; padding: 6px 10px; border-radius: 2px; background: rgba(240, 192, 96, 0.1); box-shadow: inset 0 0 0 1px var(--line2); font: 600 14px/1 var(--title); letter-spacing: 0.06em; color: var(--fg); animation: pop 500ms cubic-bezier(0.3, 1.6, 0.5, 1) both; animation-delay: calc(2900ms + var(--d) * 120ms); }
    .unlock small { font: 500 9px/1 var(--label); letter-spacing: 0.24em; text-transform: uppercase; color: var(--gold); }
    .guest { font: 400 12px/1.3 var(--sans); color: var(--fg3); }
    .rows { display: flex; flex-direction: column; }
    .row { display: grid; grid-template-columns: minmax(0, 1.6fr) repeat(3, minmax(0, 1fr)); align-items: center; padding: 6px 2px; border-top: 1px solid rgba(255, 255, 255, 0.05); font: 500 15px/1.1 var(--label); font-variant-numeric: tabular-nums; color: var(--fg2); }
    .row > span:not(.nm) { text-align: right; }
    .row.head { border-top: 0; padding-top: 0; font-size: 10px; letter-spacing: 0.24em; text-transform: uppercase; color: var(--fg3); }
    .nm { display: flex; align-items: center; gap: 8px; min-width: 0; }
    .who { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
    .who b { font: 600 14px/1.1 var(--sans); color: var(--fg); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .who small, .cls { font: 500 9px/1 var(--label); letter-spacing: 0.22em; text-transform: uppercase; color: var(--fg3); }
    .row.you-true { color: var(--fg); box-shadow: inset 2px 0 0 var(--gold); padding-left: 8px; background: rgba(240, 192, 96, 0.06); }
    .crown { flex: none; width: 14px; height: 10px; background: var(--gold); clip-path: polygon(0 100%, 0 20%, 25% 55%, 50% 0, 75% 55%, 100% 20%, 100% 100%); filter: drop-shadow(0 0 4px rgba(240, 192, 96, 0.8)); }
    .buttons { margin-top: 24px; display: flex; gap: 10px; animation: fade 600ms ease both 1100ms; }
    .btn { min-width: 172px; padding: 12px 22px 11px; border-radius: 2px; border: 1px solid var(--line2); background: var(--glass); backdrop-filter: blur(10px); color: var(--fg); font: 500 14px/1 var(--label); letter-spacing: 0.3em; text-transform: uppercase; transition: background 140ms ease, border-color 140ms ease, transform 140ms ease; }
    .btn:hover { background: rgba(240, 192, 96, 0.14); border-color: var(--gold); transform: translateY(-1px); }
    .btn.primary { border-color: transparent; background: linear-gradient(180deg, #ffe3a1, var(--gold) 55%, #c4893a); color: #1a120a; font-weight: 600; box-shadow: 0 0 30px rgba(240, 192, 96, 0.25); }
    .btn.primary:hover { background: linear-gradient(180deg, #fff1c8, #f7cf78 55%, #d39a48); }
    @media (max-height: 800px) { .word { font-size: 70px; } .cols { margin-top: 14px; } .track { margin-top: 14px; } .buttons { margin-top: 16px; } .panel { padding: 12px 16px 14px; gap: 10px; } .v { font-size: 24px; } }
    @media (max-width: 760px) { .word { font-size: 56px; } .pip { width: 7px; height: 7px; } .pip.boss { width: 11px; height: 11px; } .btn { min-width: 0; letter-spacing: 0.16em; } }
    @keyframes fade { from { opacity: 0; } }
    @keyframes rise { from { opacity: 0; transform: translateY(14px); } }
    @keyframes slam { from { opacity: 0; transform: scale(1.18); letter-spacing: 0.4em; } }
    @keyframes pop { from { opacity: 0; transform: scale(1.3); } }
    @keyframes fill { from { width: calc(var(--from) * 100%); } }
    @keyframes breathe { 50% { opacity: 0.5; } }
    @keyframes glint { 50% { box-shadow: 0 0 18px rgba(240, 192, 96, 0.8); } }`,
  },
};

/** A fighter's XP from the run (`RunResult.xp`) and the levels' unlocks, as the end screen shows them: the bar from where it was to where it is. */
function xpOf(r: RunResult, unlocks: Unlock[]): EndXp {
  const x = r.xp;
  const up = Math.max(0, x.level - x.from);
  const frac = (n: number) => (x.need > 0 ? Math.max(0, Math.min(1, n / x.need)) : 1);
  return {
    earned: num(x.earned),
    lines: x.lines.slice(0, 6).map(([label, count, amount]) => ({ label: `${label.toLowerCase()}${count > 1 ? ` ×${count}` : ''}`, amount: num(amount) })),
    level: x.level,
    from: up > 0 ? 0 : frac(x.into - x.earned),
    to: frac(x.into),
    up,
    togo: x.need > 0 ? `${num(x.need - x.into)} to level ${x.level + 1}` : 'Top level',
    unlocks: unlocks.map((u) => ({ kind: u.kind, name: u.name })),
    guest: x.guest,
  };
}

/** The marks along the run's track: each wave, lit as far as they got (the bosses' bigger, the last one in blood when it's lost). */
function waveMarks(run: EndRun): string[] {
  const marks = WAVES.slice(0, run.of).map((w, i) => {
    const n = i + 1;
    const cls = n < run.wave || (run.won && n <= run.wave) ? 'won' : n === run.wave && !run.won ? 'lost' : 'todo';
    return w.boss ? `${cls} boss` : cls;
  });
  if (run.wave > run.of) marks.push('more');
  return marks;
}

/** Put a fighter's end screen up (or back up), filled in from the run, their tallies and what the run's part said. */
export function endScreen(p: Player, run: EndRun, tallies: Tallies, extras: EndExtras) {
  if (p.bot) return;
  const t = tallies.of(p.id);
  const fighters = [...tallies.names.keys()];
  const coop = fighters.length > 1;
  const mvp = coop ? tallies.runBest() : null;
  const endless = run.endless || run.wave > run.of;
  const who = coop ? 'Your party' : 'You';
  const headline = run.won
    ? `${who} conquered ${run.map} in ${fmtTime(run.time)}`
    : endless
      ? `${who} held on to endless wave ${run.wave}: ${run.name}`
      : `${who} fell on wave ${run.wave}: ${run.name}`;
  const r = extras.results.find((x) => x.player.id === p.id);
  const xp = r ? xpOf(r, extras.unlocks.get(p.id) ?? []) : null;
  const clsOf = (id: string) => className(extras.classes.get(id) ?? extras.results.find((x) => x.player.id === id)?.cls ?? '');
  const keep = run.won && !endless;
  const data = {
    result: run.won ? 'victory' : endless ? 'endless' : 'defeat',
    word: run.won ? 'Victory' : endless ? 'The arena claims you' : 'Defeated',
    map: run.map,
    party: coop ? `${fighters.length} fighters` : 'Solo',
    headline,
    waves: waveMarks(run),
    reached: endless ? `Endless wave ${run.wave}` : `Wave ${run.wave} of ${run.of}`,
    newBest: !!r?.newBest,
    best: r && !r.newBest && r.best > 0 ? `Best: wave ${r.best}` : '',
    cls: clsOf(p.id),
    time: fmtTime(run.time),
    kills: num(t.kills),
    damage: num(t.damage),
    gold: num(t.gold),
    bosses: String(t.bosses),
    chain: String(t.chain),
    revives: String(t.revives),
    downs: String(t.downs),
    taken: num(t.taken),
    xp,
    crew: coop
      ? fighters.map((id) => {
          const f = tallies.of(id);
          return { name: tallies.names.get(id) ?? '', cls: clsOf(id), kills: num(f.kills), damage: num(f.damage), gold: num(f.gold), you: id === p.id, mvp: id === mvp };
        })
      : null,
    keep,
    againClass: keep ? '' : 'primary',
  };
  p.hud.widget(END.name, data);
}

/** Seconds into the end screen that its level-up lands (its `.up`'s animation delay, after the bar fills). */
export const LEVEL_UP_AT = 2.7;

/** The end screen's buttons (`END.def.actions`, set by the HUD's part): play again, leave, or keep fighting. */
export function endActions(game: GameContext, keep: (p: Player) => void): WidgetDefinition['actions'] {
  return {
    again: () => game.restart(),
    exit: () => game.exit(),
    keep: (p) => keep(p),
  };
}
