import type { GameContext, Player, Vec3 } from '@platform';
import { hostile, match, type Fighter } from '../match';
import { COLORS } from '../shared';

/**
 * The Mortar Team (six in a row, a free-for-all or Team Deathmatch): three shells come down on
 * where the caller's enemies stand as it's called, a second or so apart. Each spot gets a red
 * ring on everyone's screen and an incoming whistle first, so whoever's under it has a moment to
 * move. A shell lands on the first thing above the spot (a roof takes it, and is cratered), its
 * blast the caller's (`mortar` the weapon), never hurting them (`selfHarm`). With fewer than
 * three enemies about, the rest land near them; with none, on the map's hotspots.
 */

/** Seconds from the call to the first shell, and between shells. */
const FIRST = 2.6;
const APART = 0.7;
/** How long before a shell lands its whistle starts (the sound's own length). */
const WHISTLE = 1.2;
const SHELLS = 3;

interface Shell {
  id: string;
  at: Vec3;
  by: Player;
  lands: number;
  whistled: boolean;
}

export class Mortars {
  private shells: Shell[] = [];
  private n = 0;

  /** `aloft(p)`: someone up in a chopper (no shell's aimed at them). */
  constructor(
    private game: GameContext,
    private aloft: (p: Player) => boolean,
  ) {}

  /** Shells on `f`'s enemies. */
  call(f: Fighter) {
    const g = this.game;
    const now = g.clock.now;
    const foes = [...match.fighters.values()].filter((e) => e !== f && e.player.alive && hostile(f.player, e.player) && !this.aloft(e.player)).map((e) => e.player.position);
    // The nearest first: whoever's closest is most likely the one shooting at them.
    const from = f.player.position;
    foes.sort((a, b) => Math.hypot(a.x - from.x, a.z - from.z) - Math.hypot(b.x - from.x, b.z - from.z));
    const aims = foes.length ? foes : match.map.hotspots;
    for (let i = 0; i < SHELLS; i++) {
      const base = aims[i % aims.length];
      // A little off where they stood (further off for a second shell on the same one).
      const spread = i < aims.length ? 1.2 : 3.5;
      const a = g.rng.next() * Math.PI * 2;
      const r = g.rng.next() * spread;
      const at = this.landing(base.x + Math.cos(a) * r, base.z + Math.sin(a) * r, base.y);
      const id = `mortar${this.n++}`;
      this.shells.push({ id, at, by: f.player, lands: now + FIRST + i * APART, whistled: false });
      g.hud.marker(id, at, { shape: 'ring', color: COLORS.red, label: 'MORTAR', pulse: true, size: { world: 5, min: 18, max: 90 }, edge: false });
    }
  }

  /** Where a shell coming straight down over (x, z) meets something: a roof, or the ground. */
  private landing(x: number, z: number, y: number): Vec3 {
    const top = match.map.bounds.max.y;
    const hit = this.game.world.raycast({ x, y: top, z }, { x: 0, y: -1, z: 0 }, top - match.map.bounds.min.y + 4);
    return hit ? { x, y: hit.point.y, z } : { x, y, z };
  }

  update() {
    const g = this.game;
    const now = g.clock.now;
    for (const s of this.shells) {
      if (!s.whistled && now >= s.lands - WHISTLE) {
        s.whistled = true;
        g.audio.play('mortar', { at: s.at });
      }
      if (now < s.lands) continue;
      g.hud.marker(s.id, null);
      g.world.explode(s.at, 2.4, { damage: [190, 25], reach: 6, knockback: 1.4, by: s.by, weapon: 'mortar' });
    }
    this.shells = this.shells.filter((s) => now < s.lands);
  }

  /** None coming down (the match is over). */
  reset() {
    for (const s of this.shells) this.game.hud.marker(s.id, null);
    this.shells = [];
  }
}
