import type { GunItem } from '@platform/items';

/**
 * The heroes' own blasters (the platform's guns, `kind: 'gun'`, as the troopers' are: they
 * overheat rather than run dry, and cool while the trigger rests: `server.ts`'s `cool`). Their
 * models and looks are each screen's (`client/looks.ts`).
 *
 * - Chewblocca's bowcaster: slow, heavy quarrels; each bursts where it hits (a small blast and a
 *   push: `QUARREL`, dealt by the heroes' rules on each shot, `rules.ts`).
 * - Boba Fetch's EE-3: an accurate automatic carbine. (The gun kit has no burst fire; it fires as
 *   long as the trigger's held, a tight group at a steady pace.)
 */

/** Rounds a blaster's reserve says it has: it never runs out. */
const ENDLESS = 99999;

export const HERO_GUNS: Record<string, GunItem> = {
  hero_bowcaster: {
    kind: 'gun',
    name: "Chewblocca's Bowcaster",
    rpm: 95,
    damage: [52, 40],
    falloff: [30, 80],
    headshot: 1.3,
    magazine: 8,
    reserve: ENDLESS,
    reload: 1.9,
    range: 160,
    spread: { hip: 0.7, aim: 0.1, move: 0.6, air: 1.6, bloom: 0.5 },
    recoil: { up: 2.4, side: 0.6, recover: 0.7 },
    aim: { zoom: 1.5, time: 0.25, move: 0.6, sight: 'dot', color: '#5dff6a' },
    knockback: 0.6,
    mobility: 0.95,
    carve: { radius: 0.16, depth: 0.12 },
  },
  hero_ee3: {
    kind: 'gun',
    name: "Boba Fetch's EE-3",
    auto: true,
    rpm: 470,
    damage: [26, 18],
    falloff: [30, 75],
    headshot: 1.6,
    magazine: 30,
    reserve: ENDLESS,
    reload: 1.5,
    range: 180,
    spread: { hip: 0.9, aim: 0.08, move: 0.8, air: 1.1, bloom: 0.1 },
    recoil: { up: 0.45, side: 0.2, recover: 0.8 },
    aim: { zoom: 1.6, time: 0.2, move: 0.7, sight: 'dot', color: '#ff3b2e' },
    mobility: 1.05,
    carve: { radius: 0.11, depth: 0.04 },
  },
};

export const isHeroGun = (item: string) => item in HERO_GUNS;
