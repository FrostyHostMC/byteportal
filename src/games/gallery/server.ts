import { defineServer, HumanoidJoints, math, Models, type Entity } from '@platform';
import { melee } from '@platform/kits';
import auctioneer from './models/auctioneer_npc.gltf?url';
import barrier from './models/barrier.gltf?url';
import cards from './models/card_and_token.gltf?url';
import monitor from './models/casino_monitor.gltf?url';
import chair from './models/chair.gltf?url';
import mannequin from './models/mannequin.glb?url';
import mannequinMixamo from './models/mannequin_mixamo.glb?url';
import mannequinSkinned from './models/mannequin_skinned.glb?url';
import barChair from './models/chair_bar_brown.gltf?url';
import bigWin from './models/game_bigwin.gltf?url';
import slot from './models/game_slot.gltf?url';
import sofa from './models/sofa_red.gltf?url';
import billiards from './models/table_billiards.gltf?url';
import blackjack from './models/table_blackjack.gltf?url';
import roulette from './models/table_roulette.gltf?url';
import vending from './models/vending_machine.gltf?url';
import { BLOCKY, FLOOR, shared } from './shared';

/** The pieces on show, in rows. (Models from the hytopia-casino project's own set, not the HYTOPIA asset pack.) */
const PIECES: [string, string][] = [
  ['Slot machine', slot],
  ['Big win', bigWin],
  ['Vending machine', vending],
  ['Monitor', monitor],
  ['Blackjack', blackjack],
  ['Roulette', roulette],
  ['Billiards', billiards],
  ['Sofa', sofa],
  ['Chair', chair],
  ['Bar stool', barChair],
  ['Barrier', barrier],
  ['Cards and tokens', cards],
];

const UP = new math.Vector3(0, 1, 0);

const SPOTS = [
  { x: -6, z: -4 },
  { x: 6, z: -4 },
  { x: 6, z: -16 },
  { x: -6, z: -16 },
];

/**
 * Figures on the humanoid rig (`scripts/mannequin.mjs` makes them): rigid parts; one skinned
 * mesh; and the same skin on a Mixamo-style skeleton (resting in a T-pose, its bones named and
 * turned its own way), which `joints` maps onto the rig. The skinned ones have `wave` and `cheer` clips.
 */
const MANNEQUINS: { id: string; label: string; model: ReturnType<typeof Models.gltf> }[] = [
  { id: 'mannequin', label: 'Rigid mannequin', model: Models.gltf(mannequin, { rig: 'humanoid' }) },
  { id: 'mannequin_skinned', label: 'Skinned mannequin', model: Models.gltf(mannequinSkinned, { rig: 'humanoid' }) },
  { id: 'mannequin_mixamo', label: 'Mixamo-style skeleton', model: Models.gltf(mannequinMixamo, { rig: 'humanoid', joints: HumanoidJoints.mixamo() }) },
];

/**
 * Model gallery (a development preview, `?game=gallery`): glTF models as props, labelled, and as
 * figures: an auctioneer standing (a prop looping its idle) and one strolling between the tables
 * (an entity), a runner (walking, then running), players as a glTF model (their first-person arm
 * is its arm), and glTF items: a sword in hand and on the floor, and the cards (held as their
 * model, their icon a picture of it); and humanoids on the platform's rig pacing the front aisle
 * (rigid, skinned, and a Mixamo-style skeleton), waving as they go (a clip over the upper body),
 * and one cheering (a clip over the whole body).
 */
export default defineServer(shared, {
  // Its kinds of item: swords (and the bare fist).
  items: [melee()],
  setup(game) {
    // (How they look and are held is each screen's: `client/looks.ts`.)
    game.items.define('blocky_sword', { kind: 'melee', name: 'Blocky Sword', damage: 6, cooldown: 0.45, reach: 3.5 });
    game.items.define('cards', { kind: 'misc', name: 'Cards and Tokens' });
    game.entities.define('runner', {
      name: 'Runner',
      model: BLOCKY,
      hitbox: { width: 0.6, height: 1.8 },
      health: 20,
      speed: 3,
      invulnerable: true,
      // Laps the floor: a lap walking, a lap running.
      ai: (self: Entity) => {
        const s = self.data as { spot?: number; laps?: number };
        const spots = [{ x: -12, z: 8 }, { x: 12, z: 8 }, { x: 12, z: -28 }, { x: -12, z: -28 }];
        const to = spots[(s.spot ??= 0)];
        if (Math.hypot(self.position.x - to.x, self.position.z - to.z) < 1.2) {
          s.spot = (s.spot + 1) % spots.length;
          if (s.spot === 0) s.laps = (s.laps ?? 0) + 1;
        }
        self.setSpeed((s.laps ?? 0) % 2 ? 2.2 : 1);
        self.moveTo({ x: to.x, y: FLOOR, z: to.z });
      },
    });
    // Everyone gets the sword and the cards, however late they come.
    game.events.on('playerJoin', ({ player }) => {
      if (!player.inventory.count('blocky_sword')) player.inventory.give('blocky_sword');
      if (!player.inventory.count('cards')) player.inventory.give('cards');
    });
    for (const m of MANNEQUINS) {
      game.entities.define(m.id, {
        name: m.label,
        model: m.model,
        hitbox: { width: 0.6, height: 1.85 },
        health: 20,
        speed: 1.8,
        invulnerable: true,
        // Paces the aisle, waving for a while every few seconds (the skinned ones: the rigid one has no clips).
        ai: (self: Entity, _game, dt) => {
          const s = self.data as { home: number; dir?: number; t?: number; waving?: boolean };
          s.dir ??= 1;
          if (Math.abs(self.position.x - s.home) > 3) s.dir = self.position.x > s.home ? -1 : 1;
          self.moveTo({ x: s.home + s.dir * 3.5, y: FLOOR, z: 3.5 });
          s.t = (s.t ?? 0) + dt;
          const wave = s.t % 7 > 4;
          if (wave !== !!s.waving) {
            s.waving = wave;
            self.animate(wave ? 'wave' : 'none', { layer: 'upper', loop: true, fade: 0.3 });
          }
        },
      });
    }
    game.entities.define('cheerer', {
      name: 'Cheering mannequin',
      model: MANNEQUINS[1].model,
      hitbox: { width: 0.6, height: 1.85 },
      health: 20,
      speed: 0,
      invulnerable: true,
    });
    game.entities.define('auctioneer', {
      name: 'Auctioneer',
      // Blockbench models face -z (north): turned to face +z, the way figures walk.
      model: Models.gltf(auctioneer, { clips: { idle: 'idle' }, head: 'h_head', hand: 'r_rightArm', yaw: Math.PI }),
      hitbox: { width: 0.9, height: 2.9 },
      health: 20,
      speed: 1.6,
      invulnerable: true,
      // Strolls from spot to spot, looking at whoever's nearest.
      ai: (self: Entity) => {
        const s = self.data as { spot?: number };
        const to = SPOTS[(s.spot ??= 0)];
        const d = Math.hypot(self.position.x - to.x, self.position.z - to.z);
        if (d < 1) s.spot = (s.spot + 1) % SPOTS.length;
        self.moveTo({ x: to.x, y: FLOOR, z: to.z });
        const p = self.nearestPlayer();
        if (p && self.distanceTo(p) < 8) self.lookAt(p);
      },
    });
  },

  start(game) {
    const cols = 4;
    PIECES.forEach(([name, url], i) => {
      const model = game.props.gltf(url);
      const x = ((i % cols) - (cols - 1) / 2) * 6;
      const z = -Math.floor(i / cols) * 7 - 2;
      const prop = game.props.spawn(model, { position: { x, y: FLOOR, z } });
      // Their fronts toward the entrance (they face -z, as Blockbench models do).
      prop.quaternion.setFromAxisAngle(UP, Math.PI);
      game.hud.marker(`piece${i}`, prop, { offset: { x: 0, y: 3.4, z: 0 }, shape: 'dot', size: 4, color: '#ffd36b', label: name });
    });
    const standing = game.props.spawn(game.props.gltf(auctioneer, { animation: 'idle' }), { position: { x: 0, y: FLOOR, z: -24 } });
    standing.quaternion.setFromAxisAngle(UP, Math.PI);
    game.hud.marker('standing', standing, { offset: { x: 0, y: 3.4, z: 0 }, shape: 'dot', size: 4, color: '#8fd0ff', label: 'Auctioneer (a prop, idling)' });
    game.entities.spawn('auctioneer', { x: SPOTS[0].x, y: FLOOR, z: SPOTS[0].z });
    game.entities.spawn('runner', { x: -12, y: FLOOR, z: 8 });
    MANNEQUINS.forEach((m, i) => {
      const home = (i - 1) * 7.5;
      const e = game.entities.spawn(m.id, { x: home, y: FLOOR, z: 3.5 }, { data: { home } });
      game.hud.marker(`mannequin${i}`, e, { offset: { x: 0, y: 2.3, z: 0 }, shape: 'dot', size: 4, color: '#b6f09c', label: m.label });
    });
    const cheerer = game.entities.spawn('cheerer', { x: 5, y: FLOOR, z: -24 }, { yaw: 0 });
    cheerer.animate('cheer', { loop: true });
    game.hud.marker('cheerer', cheerer, { offset: { x: 0, y: 2.4, z: 0 }, shape: 'dot', size: 4, color: '#b6f09c', label: 'Skinned, cheering (a full-body clip)' });
    game.items.spawnPickup('blocky_sword', { x: 10, y: FLOOR + 0.5, z: 6 }, { beam: '#ffd36b', despawn: 1e9 });
    for (const p of game.players) {
      p.inventory.give('blocky_sword');
      p.inventory.give('cards');
    }
    // The block shapes yard, labelled.
    const shapes: [string, number, number, number][] = [
      ['Fence: joins fences and walls', 32.5, FLOOR + 1.4, -3.5],
      ['Ladder: climb it', 29.5, FLOOR + 5.4, -0.5],
      ['Panes: glass, iron bars', 25.5, FLOOR + 3.3, 2.5],
      ['Poster, facing south', 27.5, FLOOR + 1.9, 3.5],
      ['Beams (posts), tables and chairs (boxes)', 21.5, FLOOR + 4.4, 7.5],
      ['Sign, facing west', 18.5, FLOOR + 1.3, 1.5],
      ['Vine: climb it', 25.5, FLOOR + 4.3, -4.5],
    ];
    shapes.forEach(([label, x, y, z], i) => game.hud.marker(`shape${i}`, { x, y, z }, { shape: 'dot', size: 4, color: '#ffb36b', label }));
    game.hud.objective('glTF models: 12 props and an animated figure · block shapes to the east');
  },
});
