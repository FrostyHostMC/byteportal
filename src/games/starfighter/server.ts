import { defineServer, math, type GameContext, type Player, type Vec3 } from '@platform';
import { bowtieFighter, bowtieInterceptor, voxwing } from './ships';
import { shipType, headingTo, type ShipType } from './craft';
import { Weapons, type Target } from './weapons';
import { Pilot } from './pilot';
import { Enemy, type EnemyKind } from './enemies';
import { Capital } from './capital';
import { ARENA, DESTROYER_CENTER } from './layout';
import { RETICLE_FAR, RETICLE_NEAR } from './flight';
import { destroyer, shared, START } from './shared';

/** Seconds a shot-down pilot waits before a new ship (if anyone's still flying). */
const COMEBACK = 12;
/** Bowties shot down, all time, for Rogue Leader. */
const ROGUE_LEADER_KILLS = 100;
const CALLSIGNS = ['Red Five', 'Red Two', 'Red Three', 'Red Four', 'Red Six', 'Red Seven', 'Red Eight', 'Red Nine', 'Red Ten', 'Red Eleven', 'Red Twelve', 'Gold Leader', 'Gold Two', 'Gold Three', 'Gold Four', 'Gold Five'];

interface Wave {
  title: string;
  sub: string;
  bowties: number;
  interceptors: number;
  boss?: boolean;
}

const WAVES: Wave[] = [
  { title: 'WAVE 1', sub: 'Bowtie squadron inbound', bowties: 5, interceptors: 0 },
  { title: 'WAVE 2', sub: 'Interceptors on your tail', bowties: 5, interceptors: 3 },
  { title: 'THE STAR DEMOLISHER', sub: 'Knock out its shield generators', bowties: 3, interceptors: 2, boss: true },
];

// Game state (reset in start).
let types: { voxwing: ShipType; bowtie: EnemyKind; interceptor: EnemyKind } | null = null;
let weapons: Weapons;
let capital: Capital;
/** `start` has set the battle up (a new game's setup clears this: nothing carries over). */
let ready = false;
const pilots = new Map<string, Pilot>();
/** Pilots (by player id) who can't have Not a Scratch this battle: shot down, or launched once it was under way. */
const scratched = new Set<string>();
let enemies: Enemy[] = [];
let wave = 0;
let phase: 'waiting' | 'intro' | 'fight' | 'between' | 'won' | 'lost' = 'waiting';
let startedAt = 0;
let reinforce = 0;
/** Fighters of this wave still on their way (it's only cleared once they've all come). */
let incoming = 0;
/** Victory cinematic: seconds since the bridge blew (-1 = off). */
let cine = -1;
let cineAngle = 0;

function kinds(game: GameContext) {
  if (types) return types;
  const bowtie = shipType(game, bowtieFighter());
  const interceptor = shipType(game, bowtieInterceptor());
  types = {
    voxwing: shipType(game, voxwing()),
    bowtie: { type: bowtie, hp: 24, speed: 40, agility: 1.35, fireRate: 0.16, score: 100 },
    interceptor: { type: interceptor, hp: 32, speed: 52, agility: 1.9, fireRate: 0.12, score: 150 },
  };
  return types;
}

/** Pilots still flying. */
const flying = () => [...pilots.values()].filter((p) => p.alive);

/** More fighters for more pilots: half as many again for each one after the first. */
const crowd = () => 1 + 0.5 * Math.max(0, pilots.size - 1);

/** Where a pilot starts: in formation off the lead's wing, by their place in the squadron. */
function slot(i: number): { at: Vec3; yaw: number } {
  const side = i === 0 ? 0 : (i % 2 ? -1 : 1) * Math.ceil(i / 2);
  return { at: { x: START.x + side * 11, y: START.y + Math.abs(side) * 2, z: START.z + Math.abs(side) * 7 }, yaw: 0 };
}

function callsign(): string {
  const taken = new Set([...pilots.values()].map((p) => p.callsign));
  return CALLSIGNS.find((c) => !taken.has(c)) ?? `Red ${pilots.size + 1}`;
}

/** A player takes a ship (at the start, or joining mid-battle). */
function launch(game: GameContext, player: Player, announce: boolean) {
  const cs = callsign();
  const { at, yaw } = slot(pilots.size);
  const p = new Pilot(game, player, kinds(game).voxwing, weapons, cs, at, yaw);
  pilots.set(player.id, p);
  if (phase === 'fight' || phase === 'between') scratched.add(player.id);
  weapons.targets.push(p);
  player.hud.crosshair(false);
  player.hud.banner(cs.toUpperCase(), phase === 'fight' ? 'Join the fight' : 'Standing by', { duration: 2.5, color: '#ff6b5b' });
  if (announce) game.hud.feed(`${player.name} launches as ${cs}`, { color: '#ff9b8b' });
  return p;
}

/** A player left: their ship goes, and their markers on everyone else's screen. */
function ground(game: GameContext, player: Player) {
  const p = pilots.get(player.id);
  if (!p) return;
  p.dispose();
  pilots.delete(player.id);
  weapons.targets = weapons.targets.filter((t) => t !== p);
  for (const q of pilots.values()) q.player.hud.marker(`m${player.id}`, null);
  game.hud.feed(`${p.callsign} has left the battle`, { color: '#9aa4b5' });
  checkLost(game);
}

function spawnEnemy(game: GameContext, kind: EnemyKind, fromHangar: boolean) {
  const c = DESTROYER_CENTER;
  let at: Vec3;
  if (fromHangar) {
    // Out of the hangar under the keel.
    at = { x: c.x + (Math.random() - 0.5) * 30, y: c.y - 24 - Math.random() * 6, z: c.z + 10 + (Math.random() - 0.5) * 50 };
  } else {
    // In from the far side of the arena.
    const a = Math.atan2(START.x - c.x, START.z - c.z) + Math.PI + (Math.random() - 0.5) * 1.6;
    at = { x: c.x + Math.sin(a) * 240, y: 125 + Math.random() * 45, z: c.z + Math.cos(a) * 240 };
  }
  const toward = flying()[0]?.craft.pos ?? START;
  const e = new Enemy(game, kind, weapons, at, headingTo(at, toward).yaw);
  e.onDeath = (_, by, kind) => {
    const p = by && pilots.get(by.id);
    if (p) {
      p.kills++;
      scored(p.player, kind);
    }
    const i = enemies.indexOf(e);
    for (const q of pilots.values()) q.player.hud.marker(`e${i}`, null);
  };
  enemies.push(e);
  weapons.targets.push(e);
}

/** A Bowtie shot down by a pilot: what it earns them. */
function scored(player: Player, kind?: 'laser' | 'torpedo') {
  player.achieve('first_kill');
  if (kind === 'torpedo') player.achieve('stay_on_target');
  const all = (player.store.get<number>('kills') ?? 0) + 1;
  player.store.set('kills', all);
  if (all >= ROGUE_LEADER_KILLS) player.achieve('rogue_leader');
}

function startWave(game: GameContext) {
  const w = WAVES[wave];
  phase = 'fight';
  game.hud.banner(w.title, w.sub, { duration: 3, color: w.boss ? '#ff6b5b' : '#ffd23f' });
  game.audio.play(w.boss ? 'capital_horn' : 'wave');
  const k = kinds(game);
  const bowties = Math.round(w.bowties * crowd());
  const interceptors = Math.round(w.interceptors * crowd());
  incoming = bowties + interceptors;
  const arrive = (kind: EnemyKind, hangar: boolean) => () => {
    incoming--;
    spawnEnemy(game, kind, hangar);
  };
  for (let i = 0; i < bowties; i++) game.clock.after(i * 0.6, arrive(k.bowtie, !!w.boss || i % 2 === 0));
  for (let i = 0; i < interceptors; i++) game.clock.after(1.5 + i * 0.8, arrive(k.interceptor, false));
  if (w.boss) {
    capital.active = true;
    reinforce = 12;
  }
}

function waveCleared(game: GameContext) {
  phase = 'between';
  for (const p of pilots.values()) {
    p.torpedoes += 3;
    p.shields = 100;
    // Anyone shot down comes back for the next wave.
    if (p.down) p.backAt = Math.min(p.backAt, game.clock.now + 3);
  }
  game.hud.banner('WAVE CLEARED', '+3 proton torpedoes, shields recharged', { duration: 2.6, color: '#7ce0ff' });
  game.audio.play('victory', { volume: 0.6 });
  wave++;
  game.clock.after(4, () => startWave(game));
}

/** Everyone who's in the battle is down at once: it's lost. */
function checkLost(game: GameContext) {
  if (phase !== 'fight' && phase !== 'between' && phase !== 'intro') return;
  if (pilots.size && !flying().length) finish(game, false);
}

function finish(game: GameContext, won: boolean) {
  phase = won ? 'won' : 'lost';
  const t = Math.round(game.clock.now - startedAt);
  const time = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
  const team = [...pilots.values()].reduce((n, p) => n + p.kills, 0);
  const many = pilots.size > 1;
  if (won) {
    for (const p of pilots.values()) {
      p.player.achieve('great_shot');
      if (!scratched.has(p.id)) p.player.achieve('not_a_scratch');
    }
  }
  game.clock.after(won ? 6.5 : 2.5, () => {
    for (const p of pilots.values()) {
      const stats: [string, string][] = [['Time', time], ['Kills', String(p.kills)]];
      if (many) stats.push(['Squadron kills', String(team)]);
      stats.push(['Hull', `${Math.round(p.down ? 0 : p.hull)}%`]);
      p.player.hud.screen({
        title: won ? 'Victory!' : 'Shot Down',
        subtitle: won ? `The Star Demolisher is finished. Great shot, ${many ? p.callsign : 'kid'}.` : `${many ? 'Your squadron' : 'You'} fell during ${WAVES[wave].title.toLowerCase()}.`,
        tone: won ? 'victory' : 'defeat',
        stats,
        buttons: [
          { label: won ? 'Fly again' : 'Try again', primary: true, onClick: () => game.restart() },
          { label: 'Switch game', onClick: () => game.exit() },
        ],
      });
    }
  });
  if (won) game.audio.play('victory');
  else game.audio.play('defeat');
}

/** One pilot's HUD: their gauges, reticles, the fighters and weak points, their wingmates and radar. */
function updateHud(p: Pilot) {
  const h = p.player.hud;
  const up = p.alive;
  // In whole percents: a recharging shield sends a change a few times a second, not every tick.
  h.meter('shield', 'SHIELD', up ? Math.round(p.shields) / 100 : null, { color: '#63c7ff', text: `${Math.round(p.shields)}` });
  h.meter('hull', 'HULL', up ? Math.round(p.hull) / 100 : null, { color: p.hull > 40 ? '#7ee07a' : '#ff5a4a', text: `${Math.round(p.hull)}` });
  h.meter('boost', 'BOOST', up ? Math.round(p.boost * 50) / 50 : null, { color: '#ffb14a' });
  h.stat('kills', 'KILLS', p.kills);
  h.stat('torps', 'TORPEDOES', p.torpedoes);
  // Reticles ride on the ship (ahead of the nose), so they sit where their own screen has it.
  h.marker('r1', up ? p.craft.prop : null, { offset: RETICLE_NEAR, shape: 'reticle', color: '#9dff7a', size: 34 });
  h.marker('r2', up ? p.craft.prop : null, { offset: RETICLE_FAR, shape: 'reticle', color: '#9dff7a', size: 20 });
  enemies.forEach((e, i) => {
    if (!e.alive) return;
    const locked = p.lock === e;
    const locking = p.locking === e;
    h.marker(`e${i}`, e.craft.prop, {
      shape: 'box',
      color: locked ? '#ffd23f' : locking ? '#ffa23f' : '#ff4d4d',
      size: { world: e.radius * 2.4, min: 16, max: 90 },
      edge: true,
      pulse: locked || locking,
      label: locked ? 'LOCKED' : locking ? 'LOCKING…' : undefined,
    });
  });
  const boss = WAVES[wave]?.boss;
  capital.generators.forEach((g, i) => {
    const show = boss && g.alive;
    h.marker(`g${i}`, show ? g.pos : null, { shape: 'diamond', color: p.lock === g ? '#ffd23f' : '#ff9a3c', size: 30, edge: true, label: `SHIELD GEN ${Math.ceil((g.hp / g.maxHp) * 100)}%`, pulse: p.lock === g });
  });
  const b = capital.bridge;
  h.marker('bridge', boss && b.alive && !b.shielded ? b.pos : null, { shape: 'diamond', color: '#ff4d4d', size: 36, edge: true, label: `BRIDGE ${Math.ceil((b.hp / b.maxHp) * 100)}%`, pulse: true });
  // Wingmates: a small tag with their callsign.
  for (const q of pilots.values()) {
    if (q === p) continue;
    h.marker(`m${q.id}`, q.alive ? q.craft.prop : null, { shape: 'dot', color: '#8fd0ff', size: 8, label: `${q.callsign} · ${q.player.name}` });
  }
  // Radar: fighters red, weak points orange, wingmates blue, the capital ship grey. It follows the
  // ship and turns with it (on their screen, as it flies).
  const around = up ? p : flying()[0];
  h.radar(
    around
      ? {
          center: around.craft.prop,
          range: 320,
          blips: [
            { x: DESTROYER_CENTER.x, z: DESTROYER_CENTER.z, color: '#9aa4b5', size: 8 },
            ...capital.generators.filter((g) => g.alive).map((g) => ({ x: g.pos.x, z: g.pos.z, y: g.pos.y, color: '#ff9a3c', size: 4 })),
            ...enemies.filter((e) => e.alive).map((e) => ({ at: e.craft.prop, color: '#ff4d4d', size: 4 })),
            ...[...pilots.values()].filter((q) => q !== around && q.alive).map((q) => ({ at: q.craft.prop, color: '#8fd0ff', size: 4 })),
          ],
        }
      : null,
  );
}

/**
 * Ships bumping into ships: pushed apart and knocked away from each other. Ramming a fighter
 * hurts it (and you); fighters just jostle each other, and so do wingmates.
 */
function shipContacts() {
  const alive = enemies.filter((e) => e.alive);
  const push = (a: Pilot['craft'], b: Pilot['craft'], strength: number) => {
    const d = b.pos.clone().sub(a.pos);
    if (d.lengthSq() < 1e-4) d.set(1, 0, 0);
    d.normalize();
    a.pos.addScaledVector(d, -0.4);
    b.pos.addScaledVector(d, 0.4);
    a.knock.addScaledVector(d, -strength);
    b.knock.addScaledVector(d, strength);
    return a.pos.clone().add(b.pos).multiplyScalar(0.5);
  };
  const up = flying();
  for (const p of up) {
    for (const e of alive) {
      if (!p.craft.touches(e.craft)) continue;
      // Ramming is a last resort: it only half-wrecks a fighter and hurts you more.
      const at = push(p.craft, e.craft, 14);
      e.hit(13, at, 'laser', p.player);
      if (!e.alive) p.player.achieve('ramming_speed');
      p.crash(at, 0.7);
      p.writeBack();
    }
  }
  for (let i = 0; i < up.length; i++)
    for (let j = i + 1; j < up.length; j++)
      if (up[i].craft.touches(up[j].craft)) {
        push(up[i].craft, up[j].craft, 6);
        up[i].writeBack();
        up[j].writeBack();
      }
  for (let i = 0; i < alive.length; i++)
    for (let j = i + 1; j < alive.length; j++) if (alive[i].craft.touches(alive[j].craft)) push(alive[i].craft, alive[j].craft, 6);
}

/** Everyone's camera orbits the capital ship as it breaks up; the fighters fly on. */
function cinematic(game: GameContext, dt: number) {
  cine += dt;
  cineAngle -= dt * 0.16;
  const b = capital.ship.bridge;
  const k = Math.min(1, cine / 1.5);
  const ease = k * k * (3 - 2 * k);
  const dist = 50 + 85 * ease;
  const cam = { x: b.x + Math.sin(cineAngle) * dist, y: b.y + 12 + 18 * ease, z: b.z + Math.cos(cineAngle) * dist };
  const look = { x: b.x, y: b.y - 25 * ease, z: b.z - 60 * ease };
  const quarries = [...pilots.values()].map((p) => ({ pos: p.pos, vel: p.vel, alive: false }));
  for (const p of pilots.values()) {
    p.player.camera.set(cam, look);
    p.player.camera.fov = 70;
    if (p.alive) p.syncBody();
  }
  for (const e of enemies) e.update(dt, quarries, ARENA, enemies);
  capital.update(dt, quarries);
  weapons.update(dt);
  for (const p of pilots.values()) {
    const h = p.player.hud;
    for (const id of ['r1', 'r2', 'bridge', 'g0', 'g1']) h.marker(id, null);
    enemies.forEach((_, i) => h.marker(`e${i}`, null));
    for (const q of pilots.values()) h.marker(`m${q.id}`, null);
    h.radar(null);
    for (const id of ['shield', 'hull', 'boost']) h.meter(id, '', null);
    h.stat('kills', '', null);
    h.stat('torps', '', null);
  }
  game.hud.objective(null);
}

/** Shot down: out of the ship; back in a while if the squadron's still fighting. */
function shotDown(game: GameContext, p: Pilot) {
  p.explode();
  p.backAt = game.clock.now + COMEBACK;
  scratched.add(p.id);
  if (flying().length && phase !== 'won') {
    p.player.hud.banner('SHOT DOWN', `A new ship in ${COMEBACK} seconds`, { duration: 3, color: '#ff5b5b' });
    game.hud.feed(`${p.callsign} is down`, { color: '#ff8a7a' });
  }
  checkLost(game);
}

/** Watching a wingmate while waiting for a new ship: a chase view of the first one still flying. */
function spectate(p: Pilot) {
  const w = flying()[0];
  if (!w) return;
  const c = w.craft;
  const f = c.forward(new math.Vector3());
  p.player.camera.set({ x: c.pos.x - f.x * 22, y: c.pos.y - f.y * 22 + 8, z: c.pos.z - f.z * 22 }, { x: c.pos.x + f.x * 30, y: c.pos.y + f.y * 30, z: c.pos.z + f.z * 30 });
  p.player.camera.fov = 76;
}

/** A shot-down pilot's new ship, in formation at the start. */
function comeBack(game: GameContext, p: Pilot) {
  const i = [...pilots.values()].indexOf(p);
  const { at, yaw } = slot(i);
  p.respawn(at, yaw);
  p.player.hud.banner(p.callsign.toUpperCase(), 'Back in the fight', { duration: 2, color: '#ff6b5b' });
  game.hud.feed(`${p.callsign} is back`, { color: '#ff9b8b' });
}

/** The battle begins (someone's here). */
function begin(game: GameContext) {
  phase = 'intro';
  startedAt = game.clock.now;
  game.clock.after(3, () => startWave(game));
}

export default defineServer(shared, {
  setup(game) {
    // A new game (a server's room starting again): nothing carried over from the last.
    types = null;
    ready = false;
    pilots.clear();
    scratched.clear();
    enemies = [];
    phase = 'waiting';
    // (Its voices are each screen's, `client/sounds.ts`: played here by name.)
    game.commands.register('wave', {
      cheat: true,
      usage: '<1-3>',
      help: 'Jump to a wave',
      complete: () => ['1', '2', '3'],
      run: ([n]) => {
        const w = Number(n) - 1;
        if (!(w >= 0 && w < WAVES.length)) throw new Error('Waves are 1 to 3');
        for (const e of enemies) if (e.alive) e.hit(1e6, e.pos);
        // Skipping waves isn't flying the whole battle.
        for (const id of pilots.keys()) scratched.add(id);
        wave = w;
        startWave(game);
        return `Wave ${n}`;
      },
    });
    game.events.on('playerJoin', ({ player }) => {
      // Before the battle, `start` launches everyone; after everyone left, the next one begins it.
      if (!ready) return;
      launch(game, player, phase !== 'waiting');
      if (phase === 'waiting') begin(game);
    });
    game.events.on('playerLeave', ({ player }) => {
      if (!ready) return;
      ground(game, player);
      // The last one out: the battle resets for whoever comes next.
      if (!game.players.length && phase !== 'waiting') game.restart();
    });
  },

  start(game) {
    if (ready) weapons.clear();
    for (const p of pilots.values()) p.dispose();
    pilots.clear();
    scratched.clear();
    enemies = [];
    wave = 0;
    incoming = 0;
    cine = -1;
    startedAt = game.clock.now;
    game.hud.crosshair(false);
    kinds(game);
    weapons = new Weapons(game);
    capital = new Capital(game, destroyer, weapons, {
      generatorDown: (left, by) => {
        by?.achieve('shields_down');
        if (!left) for (const p of pilots.values()) p.torpedoes += 2;
        game.hud.banner(left ? 'SHIELD GENERATOR DOWN' : 'SHIELDS ARE DOWN', left ? 'One more to go' : 'Hit the bridge! +2 torpedoes', { duration: 2.6, color: '#ffd23f' });
      },
      bridgeDown: () => {
        game.hud.banner('DIRECT HIT', 'The Star Demolisher is breaking up', { duration: 3.5, color: '#ffd23f' });
        // Swing the cameras out to watch it go.
        cine = 0;
        // Start south-west of the tower and swing west, over the sea (the ridge is to the east).
        cineAngle = -0.5;
        for (const e of enemies) if (e.alive) game.clock.after(0.5 + Math.random() * 2, () => e.hit(1e6, e.pos));
        finish(game, true);
      },
    });
    weapons.targets.push(...capital.targets());
    weapons.onWorldHit = (at, kind, team) => {
      if (team === 'rebel') capital.worldHit(at, kind);
    };
    if (import.meta.env.DEV) (globalThis as unknown as { __sf: unknown }).__sf = { pilots, get pilot() { return pilots.values().next().value; }, get enemies() { return enemies; }, capital, weapons };
    phase = 'waiting';
    ready = true;
    for (const player of game.players) launch(game, player, false);
    if (pilots.size) begin(game);
  },

  update(game, dt) {
    if (!ready) return;
    if (cine >= 0) {
      cinematic(game, dt);
      return;
    }
    const empire = weapons.targets.filter((t): t is Target => t.team === 'empire');
    for (const p of pilots.values()) {
      if (!p.down && p.hull <= 0) shotDown(game, p);
      if (p.alive) {
        p.update(dt, empire);
        // The edge of the battle (the ship turns itself back): say so, now and then.
        const out = Math.hypot(p.pos.x - ARENA.center.x, p.pos.z - ARENA.center.z) - ARENA.radius;
        if (out > 0 && game.clock.now - p.warned > 2) {
          p.warned = game.clock.now;
          p.player.hud.toast('Return to the battle!');
        }
      } else if (p.down) {
        spectate(p);
        if (game.clock.now >= p.backAt && (phase === 'fight' || phase === 'between') && flying().length) comeBack(game, p);
      }
    }
    const quarries = [...pilots.values()];
    for (const e of enemies) e.update(dt, quarries, ARENA, enemies);
    shipContacts();
    capital.update(dt, quarries);
    weapons.update(dt);
    for (const p of pilots.values()) updateHud(p);

    if (phase === 'fight' && flying().length) {
      const w = WAVES[wave];
      const alive = enemies.filter((e) => e.alive).length;
      if (w.boss) {
        // Fighters keep launching while the capital ship stands.
        reinforce -= dt;
        if (reinforce <= 0 && alive < 4 + pilots.size) {
          reinforce = 9 / crowd();
          const k = kinds(game);
          spawnEnemy(game, Math.random() < 0.35 ? k.interceptor : k.bowtie, true);
        }
        game.hud.objective(capital.bridge.shielded ? `Shield generators: ${capital.generators.filter((g) => g.alive).length} left` : 'Destroy the bridge!');
      } else {
        game.hud.objective(`${w.title}  ·  ${alive} fighters left`);
        if (alive === 0 && incoming === 0 && enemies.length > 0) waveCleared(game);
      }
    } else if (phase !== 'fight') {
      game.hud.objective(null);
    }
    // Forget dead fighters (keeps marker ids stable until the wave ends).
    if (phase === 'between') {
      for (const p of pilots.values()) enemies.forEach((_, i) => p.player.hud.marker(`e${i}`, null));
      enemies = enemies.filter((e) => e.alive);
      weapons.targets = weapons.targets.filter((t) => t.alive || t.team === 'rebel');
    }
  },
});
