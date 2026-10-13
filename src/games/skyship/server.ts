import { defineServer, math, vec, type GameContext, type LoopHandle, type Player, type Prop, type PropModel } from '@platform';
import { melee } from '@platform/kits';
import { shared } from './shared';
import { airship, propeller, DECK_SPAWN, HELM, PROPELLER, WHEEL } from './ship';
import { beaconLamp, beaconPad, ISLES, HOME, MOORING, VOID_Y } from './world';

/*
 * Skyship: crew an airship across the sky islands and light the five beacons.
 *
 * The airship is a solid prop (`props.spawn(model, { solid: true })`): everyone walks its decks,
 * climbs to the roof, goes into the cabin and jumps off onto islands while it sails, and the
 * platform carries them with it as it moves, turns, banks and bobs. Whoever takes the helm (E at
 * the wheel) steers it from where they stand; the others go ashore to light the beacons.
 */

/** Blocks a second ahead, radians a second of turn, blocks a second of climb. */
const MAX_SPEED = 11;
const TURN = 0.42;
const CLIMB = 4;
const LOW = 55;
const HIGH = 170;
/** A voyage this quick (seconds) earns Fair Winds. */
const SWIFT = 6 * 60;

interface ShipState {
  x: number;
  y: number;
  z: number;
  yaw: number;
  speed: number;
  turn: number;
  climb: number;
  /** Banked into turns, nose up when climbing: eased, like everything else that moves it. */
  roll: number;
  pitch: number;
  /** Seconds afloat (the bob), and the propeller's angle. */
  t: number;
  spin: number;
}

const Z =new math.Vector3(0, 0, 1);

let shipModel: PropModel;
let screwModel: PropModel;
let ship: Prop;
let screw: Prop;
let s: ShipState;
let helm: Player | null = null;
let lit: boolean[] = [];
let startedAt = 0;
let done = false;
/** The ship went somewhere by `/warp` (a cheat): this voyage's beacons earn no achievements. */
let warped = false;
let wind: LoopHandle | null = null;
/** When it last hit rock (one thud a bump). */
let thudAt = -Infinity;
/** What each player's HUD last showed, and the objective (only changes go out). */
const shown = new Map<string, string>();
let objective = '';

/** The ship's pose from its state: where it is, which way it heads, its bank and pitch, bobbing gently. */
function pose(st: ShipState, p: InstanceType<typeof math.Vector3> = new math.Vector3(), q: InstanceType<typeof math.Quaternion> = new math.Quaternion()) {
  p.set(st.x, st.y + Math.sin(st.t * 0.8) * 0.18, st.z);
  q.setFromEuler(new math.Euler(st.pitch, st.yaw, st.roll, 'YXZ'));
  return { position: p, quaternion: q };
}

/** How much of the ship would be in rock at this state. */
const inRock = (st: ShipState) => ship.overlap(pose(st));

/** The helmsman's controls sail it; nobody at the helm, it drifts to a stop and holds its height. */
function sail(game: GameContext, dt: number) {
  const c = helm?.input;
  const thrust = c ? (c.isDown('KeyW') ? 1 : 0) - (c.isDown('KeyS') ? 1 : 0) : 0;
  const turn = c ? (c.isDown('KeyA') ? 1 : 0) - (c.isDown('KeyD') ? 1 : 0) : 0;
  const lift = c ? (c.isDown('Space') ? 1 : 0) - (c.isDown('ShiftLeft') || c.isDown('ShiftRight') ? 1 : 0) : 0;
  const target = thrust > 0 ? MAX_SPEED : thrust < 0 ? -MAX_SPEED * 0.35 : 0;
  s.speed += (target - s.speed) * (1 - Math.exp(-(thrust ? 0.45 : 0.3) * dt));
  s.turn += (turn * TURN * Math.min(1, 0.35 + Math.abs(s.speed) / MAX_SPEED) - s.turn) * (1 - Math.exp(-2 * dt));
  s.climb += (lift * CLIMB - s.climb) * (1 - Math.exp(-1.5 * dt));
  // It moves in three parts, like a walker's axes: sailing, turning (and banking), rising (and
  // pitching, and the bob). Each goes ahead unless it would put more of the hull into rock than
  // is in it now; sailing into rock it scrapes along (east-west or north-south alone) if it can.
  // So a ship pressed against an island can always back off, turn away or climb out.
  const ease = 1 - Math.exp(-3 * dt);
  const dx = -Math.sin(s.yaw) * s.speed * dt;
  const dz = -Math.cos(s.yaw) * s.speed * dt;
  const parts: [part: 'sail' | 'turn' | 'rise', steps: ((st: ShipState) => ShipState)[]][] = [
    ['sail', [(st) => ({ ...st, x: st.x + dx, z: st.z + dz }), (st) => ({ ...st, x: st.x + dx }), (st) => ({ ...st, z: st.z + dz })]],
    ['turn', [(st) => ({ ...st, yaw: st.yaw + st.turn * dt, roll: st.roll + (st.turn * Math.min(1, Math.abs(st.speed) / MAX_SPEED) * 0.18 - st.roll) * ease })]],
    ['rise', [(st) => ({ ...st, y: Math.max(LOW, Math.min(HIGH, st.y + st.climb * dt)), pitch: st.pitch + ((st.climb / CLIMB) * 0.035 - st.pitch) * ease, t: st.t + dt })]],
  ];
  let rock = inRock(s);
  for (const [part, steps] of parts) {
    const moved = steps.some((step) => {
      const next = step(s);
      const n = inRock(next);
      if (n > rock) return false;
      s = next;
      rock = n;
      return true;
    });
    if (moved) continue;
    if (part === 'sail') {
      // Ran into rock: a thud (one a bump), and it bounces back a little.
      if (Math.abs(s.speed) > 3 && game.clock.now - thudAt > 1) {
        thudAt = game.clock.now;
        helm?.achieve('aground');
        game.audio.play('thud', { at: ship.position });
        for (const p of game.players) if (p.riding === ship) p.fx.shake(0.3, 0.3);
      }
      s.speed *= -0.25;
    } else if (part === 'turn') s.turn = 0;
    else s.climb = 0;
  }
  pose(s, ship.position, ship.quaternion);
  if (helm && s.y >= HIGH) helm.achieve('cloud_nine');
  s.spin += (s.speed * 1.4 + (helm ? 1.5 : 0.3)) * dt;
  screw.position.set(PROPELLER.x, PROPELLER.y, PROPELLER.z);
  screw.quaternion.setFromAxisAngle(Z, s.spin);
  wind?.set({ volume: 0.05 + (Math.abs(s.speed) / MAX_SPEED) * 0.3, pitch: 0.8 + (Math.abs(s.speed) / MAX_SPEED) * 0.5 });
}

function takeHelm(game: GameContext, p: Player) {
  helm = p;
  p.achieve('helmsman');
  p.teleport(ship.toWorld(HELM), s.yaw, -0.1);
  p.freeze(true);
  // Scroll out to see the ship from outside while steering (the camera circles her middle).
  p.camera.orbit(ship, { offset: { x: 0.5, y: 8, z: -2 }, max: 70 });
  p.hud.toast('At the helm: W ahead, S astern, A/D turn, Space/Shift climb and sink, scroll out to see her, E to let go');
  game.hud.feed(`${p.name} has the helm`, { color: '#ffd35a' });
  helmMarker(game);
}

function leaveHelm(game: GameContext) {
  const p = helm;
  if (!p) return;
  helm = null;
  p.freeze(false);
  p.camera.orbit(null);
  p.hud.meter('speed', 'Speed', null);
  p.hud.stat('alt', 'Altitude', null);
  helmMarker(game);
}

/** A ring on the wheel while nobody has the helm. */
function helmMarker(game: GameContext) {
  game.hud.marker('helm', helm ? null : ship, { offset: WHEEL, label: 'Helm (E)', shape: 'ring', color: '#ffd35a', size: 14 });
}

/** Back aboard (fell off, or joined late): on the main deck. */
function aboard(p: Player) {
  const at = ship.toWorld({ x: DECK_SPAWN.x + (Math.random() - 0.5) * 3, y: DECK_SPAWN.y + 0.5, z: DECK_SPAWN.z + (Math.random() - 0.5) * 3 });
  p.teleport(at, s.yaw, 0);
}

function light(game: GameContext, i: number, by: Player) {
  lit[i] = true;
  const isle = ISLES[i];
  const lamp = beaconLamp(isle);
  game.world.setBlock(lamp.x, lamp.y, lamp.z, 'sea_lantern');
  const pad = beaconPad(isle);
  game.fx.fireworks({ x: pad.x, y: pad.y + 5, z: pad.z }, 4);
  game.audio.play('bell', { at: pad, volume: 1.2 });
  game.hud.marker(`beacon${i}`, null);
  const n = lit.filter(Boolean).length;
  game.hud.banner(`${isle.name} is lit`, `${n} of ${ISLES.length} beacons`, { duration: 2.5, color: '#ffd35a' });
  game.hud.feed(`${by.name} lit the beacon on ${isle.name}`, { color: '#ffd35a' });
  if (!warped) {
    by.achieve('first_beacon');
    // Lit while someone else steers: the crew's, both of them.
    if (helm && helm !== by) {
      by.achieve('crew');
      helm.achieve('crew');
    }
  }
  radar(game);
  if (n === ISLES.length) finish(game);
}

function radar(game: GameContext) {
  game.hud.radar({
    center: ship,
    range: 300,
    blips: [...ISLES.map((isle, i) => ({ x: isle.at.x, z: isle.at.z, y: isle.at.y, color: lit[i] ? '#6ee07a' : '#ffd35a', size: 5 })), { x: HOME.at.x, z: HOME.at.z, color: '#ffffff', size: 4 }],
  });
}

const clockText = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

function finish(game: GameContext) {
  done = true;
  const time = game.clock.now - startedAt;
  const best = game.store.get<number>('best');
  if (best === undefined || time < best) game.store.set('best', time);
  // Everyone aboard for it made the voyage.
  if (!warped)
    for (const p of game.players) {
      p.achieve('all_beacons');
      if (time < SWIFT) p.achieve('swift_voyage');
    }
  game.audio.play('victory');
  game.clock.after(2.5, () =>
    game.hud.screen({
      title: 'Voyage complete',
      subtitle: 'Every beacon in the sky is burning.',
      tone: 'victory',
      stats: [
        ['Time', clockText(time)],
        ['Best', clockText(Math.min(time, best ?? Infinity))],
      ],
      buttons: [{ label: 'Sail again', primary: true, onClick: () => game.restart() }],
    }),
  );
}

/** Each player's own readout: the helmsman's speed and height; everyone else, where the ship is. */
function readouts(p: Player) {
  const key = (k: string, v: string) => {
    const was = shown.get(`${p.id}:${k}`);
    shown.set(`${p.id}:${k}`, v);
    return was !== v;
  };
  if (p === helm) {
    const speed = Math.abs(s.speed);
    const text = `${speed.toFixed(0)} b/s${s.speed < -0.5 ? ' astern' : ''}`;
    if (key('speed', text)) p.hud.meter('speed', 'Speed', speed / MAX_SPEED, { color: '#ffd35a', text });
    const alt = String(Math.round(s.y));
    if (key('alt', alt)) p.hud.stat('alt', 'Altitude', alt);
  }
  const ashore = p.riding !== ship ? 'ashore' : 'aboard';
  if (key('ship', ashore)) p.hud.marker('ship', ashore === 'ashore' ? ship : null, { offset: { x: 0.5, y: 22, z: -2 }, label: 'Airship', shape: 'dot', color: '#ff7a55', edge: true });
}

export default defineServer(shared, {
  // Nothing to use but the bare fist.
  items: [melee()],
  setup(game) {
    shipModel = game.props.model(airship());
    screwModel = game.props.model(propeller());
    // (Its voices, the beacon's bell and the hull's thud, are each screen's, `client/sounds.ts`: played here by name.)
    game.events.on('playerJoin', ({ player }) => {
      // Late to the voyage: straight aboard, wherever the ship is.
      if (ship && vec.distance2D(ship.position, MOORING) > 3) aboard(player);
    });
    game.events.on('playerLeave', ({ player }) => {
      if (player === helm) leaveHelm(game);
    });
    game.commands.register('warp', {
      usage: '<1-5>',
      help: 'Move the airship alongside a beacon island',
      cheat: true,
      run: ([n]) => {
        const isle = ISLES[Number(n) - 1];
        if (!isle) throw new Error('Which island? 1 to 5');
        warped = true;
        // Everyone aboard goes with it (a solid prop put somewhere far takes its riders along).
        s = { ...s, x: isle.at.x + isle.radius + 9, y: isle.at.y + 1, z: isle.at.z, yaw: 0, speed: 0, turn: 0, climb: 0, roll: 0, pitch: 0 };
        pose(s, ship.position, ship.quaternion);
        return `Alongside ${isle.name}`;
      },
    });
  },

  start(game) {
    done = false;
    warped = false;
    helm = null;
    lit = ISLES.map(() => false);
    shown.clear();
    objective = '';
    s = { x: MOORING.x, y: MOORING.y, z: MOORING.z, yaw: 0, speed: 0, turn: 0, climb: 0, roll: 0, pitch: 0, t: 0, spin: 0 };
    thudAt = -Infinity;
    ship = game.props.spawn(shipModel, { solid: true });
    screw = game.props.spawn(screwModel);
    screw.attach(ship);
    pose(s, ship.position, ship.quaternion);
    for (const p of game.players) p.freeze(false);
    ISLES.forEach((isle, i) => {
      const lamp = beaconLamp(isle);
      game.world.setBlock(lamp.x, lamp.y, lamp.z, 'black_concrete');
      game.hud.marker(`beacon${i}`, beaconPad(isle), { label: isle.name, shape: 'diamond', color: '#ffd35a', edge: true });
    });
    helmMarker(game);
    radar(game);
    wind?.stop();
    wind = game.audio.loop('wind', { volume: 0.05 });
    startedAt = game.clock.now;
    game.hud.banner('Skyship', 'Take the helm on the cabin roof, and light the five beacons', { duration: 4 });
  },

  update(game, dt) {
    sail(game, dt);
    for (const p of game.players) {
      if (p.input.pressed('KeyE')) {
        if (p === helm) leaveHelm(game);
        else if (!helm && vec.distance(p.eye, ship.toWorld(WHEEL)) < 2.6) takeHelm(game, p);
      }
      if (p.position.y < VOID_Y) {
        if (p === helm) leaveHelm(game);
        aboard(p);
        p.hud.toast('Man overboard! Hauled back aboard.');
        p.achieve('overboard');
      }
      if (!done)
        ISLES.forEach((isle, i) => {
          if (lit[i]) return;
          const pad = beaconPad(isle);
          if (vec.distance2D(p.position, pad) < 1.7 && Math.abs(p.position.y - pad.y) < 1.2) light(game, i, p);
        });
      readouts(p);
    }
    const text = `Beacons lit: ${lit.filter(Boolean).length} / ${ISLES.length}   ·   ${clockText(game.clock.now - startedAt)}`;
    if (!done && text !== objective) game.hud.objective((objective = text));
  },
});
