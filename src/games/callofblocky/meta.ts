import { defineMeta } from '@platform';
import cover from './cover.webp?url';

/**
 * Call of Blocky: fast pulp shootouts on Jackrabbit Lane, a Nuketown-style cul-de-sac, at Big
 * Kahuna Burger, aboard Hijacked's yacht, in the Nukeblock test town and in Rust's oil yard:
 * free-for-all, Team Deathmatch, and The Briefcase (plant it or stop it).
 */
export default defineMeta({
  id: 'callofblocky',
  title: 'Call of Blocky',
  tagline: 'Free-for-all, Team Deathmatch and The Briefcase, on Jackrabbit Lane and at Big Kahuna Burger.',
  accent: '#ffcc00',
  cover,
  controls: [
    ['LMB', 'fire'],
    ['RMB', 'aim'],
    ['R', 'reload'],
    ['Shift', 'sprint'],
    ['C', 'crouch · slide'],
    ['Q E', 'lean left · right (hold, or tap to stay)'],
    ['1 2 3', 'weapons'],
    ['G', 'lethal (hold to cook)'],
    ['5', 'call in a killstreak'],
    ['F', 'plant · crack the case (hold)'],
    ['L', 'loadout'],
    ['M', 'mode and map (your own game)'],
    ['V', 'vote to skip this mode and map'],
    ['Tab', 'scores'],
  ],
  // Controllers: the platform's shooter layout (RT fire, LT aim, X reload, B crouch and slide,
  // L3 sprint, LB switch weapons), with the lethal on RB (hold to cook), the loadout on the
  // D-pad's up, planting and cracking the case on its down, the mode and map on its right,
  // killstreaks on its left, and the katana on R3; Y votes to skip (LB alone switches weapons).
  gamepad: {
    R3: ['Digit3', 'katana'],
    Left: ['Digit5', 'killstreak'],
    RB: ['KeyG', 'lethal'],
    Up: 'KeyL',
    Down: ['KeyF', 'plant · crack'],
    Right: ['KeyM', 'mode and map'],
    Y: ['KeyV', 'vote to skip'],
  },
  // Touch: the katana's a hotbar slot to tap.
  touch: { R3: null },
  // Awarded by the server (`player.achieve`): server.ts, briefcase.ts, progression.ts.
  achievements: {
    made_your_bones: { title: 'Made Your Bones', description: 'Get your first kill' },
    on_the_payroll: { title: 'On the Payroll', description: 'Play a match through to the end' },
    top_billing: { title: 'Top Billing', description: 'Win a match: first in a free-for-all, or on the side that wins', reward: 'top_billing' },
    triple_feature: { title: 'Triple Feature', description: 'Three kills, each within four seconds of the last' },
    knock_knock: { title: 'Knock Knock', description: 'Kill someone with a headshot through a wall' },
    whats_in_the_case: { title: "What's in the Case?", description: 'Grab the briefcase when it turns up in a free-for-all or Team Deathmatch' },
    special_delivery: { title: 'Special Delivery', description: 'In The Briefcase, plant the case and see it go off', reward: 'briefcase' },
    death_from_above: { title: 'Death from Above', description: 'Take someone out with a Hellstorm or the Attack Chopper' },
    made_man: { title: 'Made Man', description: 'Reach level 10', reward: 'fedora' },
    sleeps_with_the_fishes: { title: 'Sleeps with the Fishes', description: 'Go overboard on Hijacked', hidden: true },
  },
  instances: true,
  cosmetics: {
    fedora: {
      name: 'Made Man’s Fedora',
      slot: 'hat',
      how: 'Reach level 10',
      model: {
        boxes: [
          { from: [-6.4, -2.2, -6.4], to: [6.4, -1.5, 6.4], color: '#1f1f22' },
          { from: [-4.3, -2.2, -4.3], to: [4.3, 3.2, 4.3], color: '#26262a' },
          { from: [-4.4, -1.6, -4.4], to: [4.4, -0.4, 4.4], color: '#8e1f1f' },
          { from: [-1.2, 2.9, -4.3], to: [1.2, 3.4, 4.3], color: '#18181b' },
        ],
      },
    },
    briefcase: {
      name: 'The Briefcase',
      slot: 'back',
      how: 'Plant the case and see it go off',
      model: {
        boxes: [
          { from: [-3, -8, 0], to: [3, -1, 1.6], color: '#b88a4a' },
          { from: [-1.2, -1, 0.4], to: [1.2, 0, 1.2], color: '#5a3a1a' },
          { from: [-2, -2.4, 1.6], to: [-1, -1.6, 1.8], color: '#e8b923' },
          { from: [1, -2.4, 1.6], to: [2, -1.6, 1.8], color: '#e8b923' },
        ],
      },
    },
    top_billing: { name: 'Top Billing', slot: 'title', text: 'Top Billing', how: 'Win a match' },
  },
});
