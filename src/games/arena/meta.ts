import { defineMeta, type CosmeticModel } from '@platform';
import cover from './cover.webp?url';

const GOLD = '#e8b923';
const BRONZE = '#b0772c';
const BRONZE_DARK = '#7d5220';

/** A bronze helm (galea): a shell over the crown, a brow band, cheek and neck guards. */
const helm = (): CosmeticModel['boxes'] => [
  { from: [-4.6, -2.4, -4.6], to: [4.6, 0.9, 4.6], color: BRONZE },
  { from: [-3.6, 0.9, -3.6], to: [3.6, 1.6, 3.6], color: BRONZE },
  { from: [-4.9, -2.8, 4.1], to: [4.9, -1.9, 4.9], color: BRONZE_DARK },
  { from: [-4.9, -6.2, 0.6], to: [-4.4, -2.4, 4.4], color: BRONZE },
  { from: [4.4, -6.2, 0.6], to: [4.9, -2.4, 4.4], color: BRONZE },
  { from: [-4.6, -4.6, -4.9], to: [4.6, -2.4, -4.4], color: BRONZE_DARK },
];

/** A laurel wreath round the head: a band, and leaves fanning back from the brow. */
const laurel = (leaf: string, band: string, glow = false): CosmeticModel['boxes'] => [
  { from: [-4.8, -1.8, -3.8], to: [-4.3, -0.8, 3.6], color: band },
  { from: [4.3, -1.8, -3.8], to: [4.8, -0.8, 3.6], color: band },
  { from: [-3.8, -1.8, -4.8], to: [3.8, -0.8, -4.3], color: band },
  ...[-1, 1].flatMap((s): CosmeticModel['boxes'] =>
    [3, 1, -1, -3].map((z, i) => ({ from: [s < 0 ? -5.6 : 4.6, -1.2 + i * 0.35, z - 0.9], to: [s < 0 ? -4.6 : 5.6, 0.2 + i * 0.35, z + 0.9], color: leaf, glow })),
  ),
  { from: [-1.6, -1.4, 4.3], to: [-0.4, -0.2, 5], color: leaf, glow },
  { from: [0.4, -1.4, 4.3], to: [1.6, -0.2, 5], color: leaf, glow },
];

/**
 * Arena: twenty waves of monsters and four bosses in an arena, then the endless waves; gold, a
 * shop, a mystery chest, classes, blessings, a crowd to win over.
 */
export default defineMeta({
  id: 'arena',
  title: 'Arena',
  tagline: 'Twenty waves, four bosses and a crowd to win over',
  accent: '#ff8a4c',
  cover,
  instances: true,
  controls: [
    ['LMB', 'attack · hold to draw a bow or charge a hammer'],
    ['RMB', 'block · throw · aim (by weapon)'],
    ['R', 'drink a potion'],
    ['Q', 'dodge roll'],
    ['G', 'throw a bomb'],
    ['E', 'shop · mystery chest · hold to revive'],
    ['B', 'choose your blessing'],
    ['N', 'ready for the next wave'],
    ['X', 'drop the item in hand'],
    ['1-9', 'weapons'],
  ],
  gamepad: { LB: ['KeyQ', 'dodge roll'], RB: ['KeyG', 'throw a bomb'], Up: ['KeyE', 'use · revive'], Down: ['KeyX', 'drop'], Y: ['KeyB', 'blessing'], R3: ['KeyN', 'ready'] },
  achievements: {
    first_blood: { title: 'First Blood', description: 'Slay your first monster in the arena' },
    first_wave: { title: 'Warmed Up', description: 'Clear the first wave' },
    untouched: { title: 'Untouched', description: 'Clear a wave without taking any damage' },
    master_of_arms: { title: 'Master of Arms', description: 'In one fight, slay monsters with four kinds of weapon: blades, axes and hammers, polearms, bows, spells' },
    colossus_slain: { title: 'Bonebreaker', description: 'Bring down the Bone Colossus' },
    warden_slain: { title: 'Jailbreak', description: 'Defeat the Warden', reward: 'warden_crown' },
    broodmother_slain: { title: 'Exterminator', description: 'Slay the Broodmother' },
    lich_slain: { title: 'Kingslayer', description: 'Destroy the Lich King' },
    matador: { title: 'Matador', description: "Bait the Bone Colossus's charge into a wall" },
    shell_shock: { title: 'Shell Shock', description: 'Stagger a boss with a bomb' },
    champion: { title: 'Champion', description: 'Survive all twenty waves and win the arena', reward: 'champions_laurel' },
    unbroken: { title: 'Unbroken', description: 'Win the arena from the first wave without once going down', reward: 'unbroken' },
    abyss: { title: 'Into the Abyss', description: 'Reach endless wave 25' },
    legend: { title: 'Legend of the Arena', description: 'Reach wave 30', reward: 'legend' },
    class_act: { title: 'Class Act', description: 'Win the arena with every class' },
    crowd_favourite: { title: "The Crowd's Favourite", description: "Win the Crowd's Favour", reward: 'crowd_favourite' },
    rampage: { title: 'Rampage', description: 'Slay five monsters in quick succession' },
    kaboom: { title: 'Kaboom', description: 'Slay four monsters with a single blast' },
    clutch: { title: 'Clutch', description: 'Slay a monster with a heart of health or less left' },
    last_stand: { title: 'Last One Standing', description: 'Win a wave alone, with the rest of your party down' },
    guardian_angel: { title: 'Guardian Angel', description: 'Revive five fallen friends in one fight' },
    phoenix: { title: 'From the Ashes', description: 'Rise again with a Phoenix Feather' },
    pickpocket: { title: 'Pickpocket', description: 'Catch a Treasure Goblin before it gets away' },
    big_spender: { title: 'Big Spender', description: 'Spend 1,000 gold in one fight' },
    midas: { title: 'Midas', description: 'Hold 1,000 gold at once' },
    high_roller: { title: 'High Roller', description: 'Roll a legendary weapon from the mystery chest' },
    veteran: { title: 'Arena Veteran', description: 'Slay 250 monsters in the arena, all time' },
    slayer: { title: 'Slayer', description: 'Slay 2,500 monsters in the arena, all time' },
    rising_star: { title: 'Rising Star', description: 'Reach level 10' },
    arena_legend: { title: 'Living Legend', description: 'Reach level 30', reward: 'emperors_laurels' },
    slam_dodge: { title: 'Light on Your Feet', description: "Jump over the Warden's ground slam", hidden: true },
    splinters: { title: 'Splinters', description: 'Deal the Warden its final blow with the wooden sword', hidden: true },
    bad_luck: { title: 'Bad Luck', description: 'Watch the mystery chest fly away with your roll', hidden: true },
  },
  cosmetics: {
    warden_crown: {
      name: 'The Warden’s Crown',
      slot: 'hat',
      how: 'Defeat the Warden',
      model: {
        boxes: [
          { from: [-4.5, -1, 4.1], to: [4.5, 2, 4.5], color: GOLD },
          { from: [-4.5, -1, -4.5], to: [4.5, 2, -4.1], color: GOLD },
          { from: [-4.5, -1, -4.1], to: [-4.1, 2, 4.1], color: GOLD },
          { from: [4.1, -1, -4.1], to: [4.5, 2, 4.1], color: GOLD },
          { from: [-4.5, 2, 4.1], to: [-2.9, 3.6, 4.5], color: GOLD },
          { from: [-0.8, 2, 4.1], to: [0.8, 4.2, 4.5], color: GOLD },
          { from: [2.9, 2, 4.1], to: [4.5, 3.6, 4.5], color: GOLD },
          { from: [-4.5, 2, -4.5], to: [-2.9, 3.6, -4.1], color: GOLD },
          { from: [2.9, 2, -4.5], to: [4.5, 3.6, -4.1], color: GOLD },
          { from: [-0.6, 0, 4.5], to: [0.6, 1.2, 4.8], color: '#e0323a', glow: true },
        ],
      },
    },
    champions_laurel: { name: 'Champion’s Laurel', slot: 'hat', how: 'Win the arena', model: { boxes: laurel('#4f8a3a', '#3a6a2a') } },
    unbroken: { name: 'Unbroken', slot: 'title', text: 'Unbroken', how: 'Win from the first wave without going down' },
    legend: { name: 'Legend of the Arena', slot: 'title', text: 'Legend of the Arena', how: 'Reach wave 30' },
    crowd_favourite: { name: 'Crowd Favourite', slot: 'title', text: 'Crowd Favourite', how: "Win the Crowd's Favour" },
    bronze_helm: { name: 'Bronze Helm', slot: 'hat', how: 'Reach level 3 in the arena', model: { boxes: helm() } },
    crimson_cape: {
      name: 'Crimson Cape',
      slot: 'back',
      how: 'Reach level 6 in the arena',
      model: {
        boxes: [
          { from: [-4.4, -0.2, 0], to: [4.4, 0.9, 1.3], color: GOLD },
          { from: [-4.2, -9, 0.3], to: [4.2, -0.2, 1.1], color: '#9e1c22' },
          { from: [-4.6, -14, 0.6], to: [4.6, -9, 1.4], color: '#8a161c' },
          { from: [-4.8, -15, 0.9], to: [4.8, -14, 1.6], color: '#6e1015' },
        ],
      },
    },
    pit_fighter: { name: 'Pit Fighter', slot: 'title', text: 'Pit Fighter', how: 'Reach level 10 in the arena' },
    plumed_helm: {
      name: 'Plumed Helm',
      slot: 'hat',
      how: 'Reach level 15 in the arena',
      model: {
        boxes: [
          ...helm(),
          { from: [-0.7, 1.6, -4.4], to: [0.7, 3.4, 3.6], color: '#c41e2a' },
          { from: [-0.7, 3.4, -3.6], to: [0.7, 4.6, 2.4], color: '#d8262f' },
          { from: [-0.7, 1.6, -5.6], to: [0.7, 2.8, -4.4], color: '#a8161f' },
        ],
      },
    },
    phoenix_wings: {
      name: 'Phoenix Wings',
      slot: 'back',
      how: 'Reach level 20 in the arena',
      model: {
        boxes: [-1, 1].flatMap((s): CosmeticModel['boxes'] => {
          const x = (a: number, b: number): [number, number] => (s < 0 ? [-b, -a] : [a, b]);
          const box = (a: number, b: number, y0: number, y1: number, z0: number, z1: number, color: string, glow = false) => {
            const [x0, x1] = x(a, b);
            return { from: [x0, y0, z0] as [number, number, number], to: [x1, y1, z1] as [number, number, number], color, glow };
          };
          return [box(1, 3, -2, 4, 0.5, 1.5, '#9e0f1c'), box(3, 7, -4, 5, 0.7, 1.5, '#d8261a'), box(7, 11, -6, 6, 0.9, 1.5, '#ff6a1a', true), box(11, 13, -3, 7, 1.1, 1.5, '#ffb52e', true)];
        }),
      },
    },
    blood_gold: { name: 'Arena Gold', slot: 'tag', color: '#f2b134', how: 'Reach level 25 in the arena' },
    emperors_laurels: { name: 'The Emperor’s Laurels', slot: 'hat', how: 'Reach level 30 in the arena', model: { boxes: laurel('#ffd23a', GOLD, true) } },
  },
});
