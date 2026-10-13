import { readFileSync } from 'node:fs';
import type { Player, Vec3 } from '../../src/platform';
import { GameHost } from '../../src/platform/host/game';
import { IDLE_INPUT, type HostEvent, type PresentCall } from '../../src/platform/net/protocol';
import type { Fighter } from '../../src/games/callofblocky/match';
import { DEFAULT_PERKS, perkDamage, streakCost, type PerkId } from '../../src/games/callofblocky/perks';
import { guns } from '../../src/platform/kits';
import { DEFAULT_KILLSTREAKS, type KillstreakId } from '../../src/games/callofblocky/streaks/kinds';
import { check, games } from './_harness';

const wasm = readFileSync('engine/pkg/voxel_engine_bg.wasm');
const cob = games.find((g) => g.id === 'callofblocky')!;

type Cob = {
  match: { fighters: Map<string, Fighter>; map: { spawns: Vec3[]; hotspots: Vec3[] } };
  reward(f: Fighter, id: KillstreakId): void;
  bots: { scrambled: ((b: Player) => boolean) | null };
};
type Entry = { label: string; active?: boolean; detail?: string; onSelect?: { $cb: number } };
type Menu = { sections: { title: string; entries: Entry[] }[] };

/**
 * Call of Blocky's perks and killstreaks (`perks.ts`, `streaks/kinds.ts`): a newcomer starts with
 * the defaults; the loadout (L) has a section for each perk tier and one for the killstreaks, and
 * picking through it (no more than three killstreaks) is theirs from their next life; with
 * Hardline, the UAV, the Counter-UAV and the Mortar Team each come a kill sooner, the dossier's
 * cards marked to match; the Mortar Team's shells take out the enemies they're dropped on and
 * spare the caller; Flak Jacket takes most of a frag's blast off; Second Wind starts the health
 * back sooner; Scavenger gets the lethals back from an ammo bag; Lightweight and Warlord; Sleight
 * of Hand reloads in half the time (and her screen's told, to reload as fast); a Ghost doesn't
 * show on the UAV's radar; and the other side's Counter-UAV scrambles the bots.
 */
export default function cobperks() {
  rules();
  live();
}

/** The perks' sums, on their own. */
function rules() {
  const f = (...perks: PerkId[]) => ({ perks }) as unknown as Fighter;
  const frag = { cause: 'explosion', weapon: 'frag' };
  check(perkDamage(frag, f('flak'), f()) === 0.4, 'Flak Jacket: 40% of a frag');
  check(perkDamage({ cause: 'fire', weapon: 'molotov' }, f('flak'), f()) === 0.4, "and of the Mia's fire");
  check(perkDamage({ cause: 'explosion', weapon: 'hellstorm' }, f('flak'), f('dangerclose')) === 1, "neither Flak Jacket nor Danger Close touches a killstreak's blast");
  check(perkDamage(frag, f(), f('dangerclose')) === 1.25, 'Danger Close: 125% of your frag');
  const me = f('dangerclose', 'flak');
  check(perkDamage(frag, me, me) === 0.4, 'Danger Close never makes your own frag hurt you more');
  check(perkDamage({ cause: 'gun', through: 1 }, f(), f('hardened')) === 1.4 && perkDamage({ cause: 'gun', through: 0 }, f(), f('hardened')) === 1, 'Hardened: only through a wall');
  check(streakCost(f('hardline'), 7) === 6 && streakCost(f(), 7) === 7, 'Hardline: a kill sooner');
}

function live() {
  // The bots pick with Math.random too: seeded, a failure plays out the same way again.
  let seed = 0x2545f491;
  Math.random = () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const host = new GameHost(cob, { engine: wasm, seed: 4, remote: true, radius: 4, budget: Infinity, cheats: true });
  const g = host.sim.ctx;
  const c = (globalThis as unknown as { __cob: Cob }).__cob;
  const got: PresentCall[] = [];
  const keep = (events: HostEvent[]) => {
    for (const e of events) {
      if (e.t === 'call') got.push(e.call);
      if (e.t === 'error') throw new Error(`the game threw: ${e.text}`);
    }
  };
  /** What her screen was last sent of her (its `items`: each item kind's word to her). */
  let mine: { items?: Record<string, { reloadSpeed?: number }> } | undefined;
  const step = (seconds: number) => {
    for (let t = 0; t < seconds - 1e-9; t += 1 / 30)
      for (const [id, b] of host.step(1 / 30)) {
        keep(b.events);
        if (id === conn.id && b.frame) mine = (b.frame.players as unknown as { id: string }[]).find((p) => p.id === g.players.find((q) => q.name === 'Ann')?.id) as typeof mine;
      }
  };
  const conn = host.connect('Ann');
  keep(conn.batch.events);
  host.command(conn.id, { t: 'start' });
  step(1);
  const ann = g.players.find((p) => p.name === 'Ann')!;
  const f = c.match.fighters.get(ann.id)!;
  const now = () => g.clock.now;
  // Dead and back (kept out of harm's way: the bots are about).
  const respawn = () => {
    ann.protect(0);
    ann.damage(1000, { source: 'world', knockback: 0 });
    for (let t = 0; t < 6 && !ann.alive; t += 1 / 30) step(1 / 30);
    check(ann.alive, 'Ann is back');
    ann.protect(999);
  };

  // ---- A newcomer: the defaults ----
  check(f.choice.perks.join() === DEFAULT_PERKS.join() && f.perks.join() === DEFAULT_PERKS.join(), `the default perks, taken up: ${f.perks}`);
  check(f.killstreaks.join() === DEFAULT_KILLSTREAKS.join(), `the default killstreaks: ${f.killstreaks}`);
  check(Math.abs(ann.speed - 1.08) < 1e-6, `Lightweight (a default): speed ${ann.speed}`);

  // ---- The loadout ----
  host.command(conn.id, { t: 'input', input: { ...IDLE_INPUT, active: true, pressed: ['KeyL'], down: ['KeyL'] } });
  step(0.1);
  host.command(conn.id, { t: 'input', input: { ...IDLE_INPUT, active: true } });
  const menu = (): Menu => {
    const call = got.filter((x) => x.target === 'hud' && (x.method === 'menu' || x.method === 'menuUpdate')).at(-1);
    check(call, 'a loadout menu');
    return call.args[1] as Menu;
  };
  const sections = menu().sections.map((s) => s.title);
  check(sections.join() === 'Primary,Sidearm,Lethal (G),Perk 1,Perk 2,Perk 3,Killstreaks (pick 3),Outfit', `the loadout's sections: ${sections}`);
  const entry = (section: string, label: string) => {
    const e = menu().sections.find((s) => s.title === section)?.entries.find((x) => x.label === label);
    check(e?.onSelect, `${label} in ${section}`);
    return e;
  };
  const tap = (section: string, label: string) => {
    host.command(conn.id, { t: 'message', msg: { t: 'callback', player: '', id: entry(section, label).onSelect!.$cb } });
    step(0.1);
  };
  const toasts = () => got.filter((x) => x.target === 'hud' && x.method === 'toast').map((x) => String(x.args[0]));
  check(entry('Killstreaks (pick 3)', 'Mortar Team').detail === '6 kills', 'each killstreak shows what it takes');
  tap('Perk 1', 'Flak Jacket');
  tap('Perk 2', 'Hardline');
  tap('Perk 3', 'Danger Close');
  tap('Killstreaks (pick 3)', 'Counter-UAV');
  check(toasts().some((t) => t.includes('3 killstreaks at most')), `a fourth is refused: ${toasts().at(-1)}`);
  tap('Killstreaks (pick 3)', 'Hellstorm');
  tap('Killstreaks (pick 3)', 'Attack Chopper');
  tap('Killstreaks (pick 3)', 'Mortar Team');
  tap('Killstreaks (pick 3)', 'Counter-UAV');
  check(f.choice.perks.join() === 'flak,hardline,dangerclose', `picked: ${f.choice.perks}`);
  check(f.choice.killstreaks.join() === 'uav,counter,mortar', `picked, cheapest first: ${f.choice.killstreaks}`);
  check(entry('Perk 1', 'Flak Jacket').active && !entry('Perk 1', 'Lightweight').active, "the menu shows what's picked");
  respawn();
  check(f.perks.join() === 'flak,hardline,dangerclose' && f.killstreaks.join() === 'uav,counter,mortar', `next life, they're hers: ${f.perks} / ${f.killstreaks}`);
  check(ann.speed === 1, `no Lightweight: speed ${ann.speed}`);

  // ---- Hardline's killstreaks: the UAV at two, the Counter-UAV at three, the Mortar Team at five ----
  ann.protect(999);
  const bots = () => g.players.filter((p) => p.bot && p.alive);
  const deaths: { victim: Player; weapon?: string }[] = [];
  g.events.on('playerDeath', (e) => deaths.push({ victim: e.player, weapon: e.weapon }));
  const kill = () => {
    const b = bots()[0];
    b.protect(0);
    b.damage(1000, { source: ann, weapon: 'rifle', knockback: 0 });
    step(0.1);
  };
  const streak = () => f.streak;
  kill();
  check(streak() === 1 && f.uavUntil <= now(), 'one kill: nothing yet');
  kill();
  check(streak() === 2 && f.uavUntil > now(), `two: the UAV (${f.uavUntil.toFixed(1)} at ${now().toFixed(1)})`);
  kill();
  check(f.jamUntil > now(), 'three: the Counter-UAV');
  // The dossier, as her screen has it (each update only what changed).
  const dossier: Record<string, unknown> = {};
  for (const x of got) if (x.target === 'hud' && (x.method === 'widget' || x.method === 'widgetSet') && x.args[0] === 'dossier') Object.assign(dossier, x.args[1]);
  check((dossier.pips as string[]).join() === 'on,on uav,on counter,off,off mortar', `her streak's cards: ${dossier.pips}`);
  check((dossier.counter as number) > 20, `the Counter-UAV's time on her dossier: ${dossier.counter}`);
  kill();
  step(3.5);
  // The rest stand still in the open, well away from her.
  const open = [...c.match.map.hotspots, ...c.match.map.spawns].filter((p) => Math.hypot(p.x - ann.position.x, p.z - ann.position.z) > 10 && !g.world.raycast({ x: p.x, y: p.y + 1.5, z: p.z }, { x: 0, y: 1, z: 0 }, 60));
  const targets = bots().slice(1);
  targets.forEach((b, i) => {
    b.freeze(true, { weapons: true });
    b.teleport({ x: open[i * 3 % open.length].x, y: open[i * 3 % open.length].y + 0.05, z: open[i * 3 % open.length].z });
  });
  step(0.5);
  got.length = 0;
  const before = deaths.length;
  kill();
  check(streak() === 5, `five in a row: ${streak()}`);
  const markers = got.filter((x) => x.target === 'hud' && x.method === 'marker' && String(x.args[0]).startsWith('mortar') && x.args[1]);
  check(markers.length === 3, `three shells marked for everyone (${markers.length})`);
  step(5);
  const shelled = deaths.slice(before + 1).filter((d) => d.weapon === 'mortar');
  console.log(`  the Mortar Team: ${shelled.length} of ${Math.min(3, targets.length)} shelled (${shelled.map((d) => d.victim.name).join(', ')})`);
  check(shelled.length >= 2, `its shells take out the enemies standing under them (${shelled.length})`);
  check(ann.alive && ann.health === ann.maxHealth, 'and spare the caller');
  for (const b of g.players) if (b.bot) b.freeze(false);

  // ---- Flak Jacket ----
  ann.protect(0);
  ann.health = 100;
  const foe = g.players.find((p) => p.bot)!;
  g.world.explode(ann.position, 0, { damage: [50, 50], reach: 3, knockback: 0, by: foe, weapon: 'frag', effect: false });
  step(0.1);
  check(ann.health >= 75 && ann.health <= 85, `a 50-point frag takes 20 off with Flak Jacket: ${ann.health}`);

  // ---- Second Wind ----
  f.perks = ['flak', 'hardline', 'secondwind'];
  ann.damage(40, { source: 'world', knockback: 0 });
  const hurt = ann.health;
  step(1.5);
  check(ann.health === hurt, `nothing back for a moment (${hurt} → ${ann.health})`);
  step(1.5);
  check(ann.health > hurt + 15, `then it comes back before the usual 4.5 seconds (${hurt} → ${ann.health})`);

  // ---- Scavenger ----
  f.perks = ['scavenger', 'hardline', 'secondwind'];
  ann.protect(999);
  ann.inventory.take('frag', 2);
  check(ann.inventory.count('frag') === 0, 'her frags thrown');
  g.items.spawnPickup('ammo', { x: ann.position.x, y: ann.position.y + 0.5, z: ann.position.z });
  step(1);
  check(ann.inventory.count('frag') === 2, `an ammo bag gives them back: ${ann.inventory.count('frag')}`);

  // ---- Lightweight and Warlord ----
  f.choice.perks = ['lightweight', 'warlord', 'lowprofile'];
  respawn();
  check(Math.abs(ann.speed - 1.08) < 1e-6 && ann.inventory.count('frag') === 3, `Lightweight's pace and Warlord's third frag: speed ${ann.speed}, frags ${ann.inventory.count('frag')}`);

  // ---- Sleight of Hand: a reload in half the time ----
  const kit = guns.of(g)!;
  const reloadTime = () => {
    kit.setAmmo(ann, 'rifle', { magazine: 5, reserve: 120 });
    host.command(conn.id, { t: 'input', input: { ...IDLE_INPUT, active: true, pressed: ['KeyR'], down: ['KeyR'] } });
    step(1 / 30);
    host.command(conn.id, { t: 'input', input: { ...IDLE_INPUT, active: true } });
    let t = 1 / 30;
    for (; t < 5 && kit.ammo(ann, 'rifle')!.magazine < 30; t += 1 / 30) step(1 / 30);
    return t;
  };
  check(kit.reloadSpeed(ann) === 1, 'no Sleight of Hand: the usual pace');
  const usual = reloadTime();
  f.choice.perks = ['lightweight', 'sleight', 'lowprofile'];
  respawn();
  check(kit.reloadSpeed(ann) === 2 && mine?.items?.gun?.reloadSpeed === 2, `Sleight of Hand: twice the pace, and her screen's told (${kit.reloadSpeed(ann)}, ${JSON.stringify(mine?.items?.gun)})`);
  const quick = reloadTime();
  console.log(`  the Big Kahuna's reload: ${usual.toFixed(2)} s, with Sleight of Hand ${quick.toFixed(2)} s`);
  check(Math.abs(usual - 2.1) < 0.2 && Math.abs(quick - 1.05) < 0.2, `a reload in half the time (${usual.toFixed(2)} → ${quick.toFixed(2)} s)`);
  f.choice.perks = ['lightweight', 'warlord', 'lowprofile'];
  respawn();
  check(kit.reloadSpeed(ann) === 1 && !mine?.items?.gun, 'without it again, back to the usual pace');

  // ---- Ghost: off the UAV's radar ----
  ann.protect(999);
  const others = g.players.filter((p) => p.bot && p.alive);
  const ghost = others[0];
  for (const b of others) {
    // (Their picks too: one who respawns meanwhile keeps them.)
    const e = c.match.fighters.get(b.id)!;
    e.perks = b === ghost ? ['ghost'] : [];
    e.choice.perks = [...e.perks];
  }
  // Weapons down a while (a shot shows anyone on the radar for a moment, Ghost or not).
  for (const b of others) b.freeze(true, { weapons: true });
  step(2);
  got.length = 0;
  c.reward(f, 'uav');
  step(0.5);
  const radar = got.filter((x) => x.target === 'hud' && x.method === 'radar').at(-1);
  check(radar, 'her radar redrawn');
  const shown = JSON.stringify((radar.args[0] as { blips: unknown[] }).blips);
  check(!shown.includes(ghost.id) && others.slice(1).some((b) => shown.includes(b.id)), `the UAV shows the others but not the Ghost: ${shown}`);

  for (const b of others) b.freeze(false);

  // ---- Her Counter-UAV scrambles the bots (theirs would scramble her radar, not help them) ----
  const bot = g.players.find((p) => p.bot && p.alive)!;
  check(c.bots.scrambled && !c.bots.scrambled(bot), 'the bots hear fine to start with');
  c.reward(f, 'counter');
  check(c.bots.scrambled!(bot), 'her Counter-UAV scrambles them');
}
