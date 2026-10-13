import type { Client } from '@platform/client';
import type { firstPerson } from '@platform/client/kits';
import { HERO_ABILITY, type HeroMove } from '../abilities';
import { heroByNumber, usesSaber } from '../defs';
import { POWERS, SABER, SWING_PITCH, swingLength } from '../tuning';
import type { Guard, Swing } from '../wire';
import { FP_GUARD, FP_GUARD_NAME, FP_SWINGS, fpSwing } from './fpsaber';
import type { HeroScene } from './state';

/** A swing this screen started ahead of the server: which of the combo, and when. */
interface Guess {
  n: number;
  at: number;
}

/**
 * Our own saber, at once: the swings of the combo and the guard shown on our figure (and our
 * first-person arm, and heard) the moment we press, rather than a round trip later when the
 * server's word comes back. It runs the combo as the server's saber does (`saber.ts`: the same
 * timings, `tuning.ts`), from our own controls; the damage stays the server's.
 *
 * The server still tells everyone of each swing (`bfh.swing`). Ours come back to us: each is
 * taken as the confirmation of the oldest swing we guessed (in order), and if the server's swing
 * is another of the combo than we guessed, the swing on show takes its step (from then on we
 * follow the server's combo). A guess the server never confirms (it refused: our hands were busy,
 * we were parried) is dropped, the figure easing back to its stance. A swing of ours the server
 * started that we didn't guess is shown when it comes. Our guard goes up and down with our own
 * RMB; the server's word on it only matters when it breaks, or we're staggered.
 */
export class OwnSaber {
  /** The swing under way (-1: none), when it began and how long it takes. */
  private n = -1;
  private t0 = 0;
  private len = 0;
  /** The next swing of the combo, and until when it still follows on. */
  private next = 0;
  private followUntil = -99;
  /** When LMB was last pressed (a press counts for a moment), and whether it was down last frame. */
  private asked = -99;
  private down = false;
  private guard = false;
  /** Swings guessed, awaiting the server's word, oldest first. */
  private guesses: Guess[] = [];
  /** The round trip as we've seen it (seconds): how long to wait for the server's word. */
  private rtt = 0.25;

  constructor(private fp: firstPerson.FirstPersonKit | null) {
    // The combo's cuts and the guard as our own arm has them (`fpsaber.ts`).
    FP_SWINGS.forEach((a, n) => fp?.define(fpSwing(n), a));
    fp?.define(FP_GUARD_NAME, FP_GUARD);
  }

  /** Our swing, heard and felt: the whoosh, and the first-person arm's cut (that swing of the combo, over `len` seconds). */
  private feel(client: Client, n: number, len: number) {
    client.audio.play('bfh_saber_swing', { pitch: SWING_PITCH[n] * (0.96 + Math.random() * 0.08), volume: 0.9 });
    this.fp?.play(fpSwing(n), { speed: swingLength(n, 1) / len });
  }

  /** The guard up or down, on the first-person arm too. */
  private guardArm(on: boolean) {
    this.fp?.pose(on ? FP_GUARD_NAME : null);
  }

  /** Nothing of ours under way (not a hero, dead, a replay). */
  private rest(scene: HeroScene, id: string | null) {
    this.n = -1;
    this.guesses = [];
    if (this.guard && id) scene.guards.set(id, { on: false, at: scene.now });
    if (this.guard) this.guardArm(false);
    this.guard = false;
  }

  /** Each frame, after the server's messages: our controls into swings and the guard. */
  frame(client: Client, scene: HeroScene) {
    const me = client.me;
    const id = scene.localId;
    const m = me.abilities[HERO_ABILITY] as unknown as HeroMove | undefined;
    // (Only a saber runs ahead: a blaster's shots are the gun kit's, predicted its own way.)
    if (!id || !m || !usesSaber(heroByNumber(m.h)) || me.dead || client.replay.playing) return this.rest(scene, id);
    const now = scene.now;
    const lmb = client.input.button(0);
    const rmb = client.input.button(2);
    if (lmb && !this.down) this.asked = now;
    this.down = lmb;
    // The swing under way ends.
    if (this.n >= 0 && now - this.t0 >= this.len) {
      this.n = -1;
      this.followUntil = now + SABER.follow;
    }
    // A guess the server never took: dropped (the figure eases back to its stance).
    const wait = Math.max(0.4, this.rtt * 2 + 0.25);
    while (this.guesses.length && now - this.guesses[0].at > wait) {
      const g = this.guesses.shift()!;
      if (scene.swings.get(id)?.at === g.at) scene.swings.delete(id);
      if (this.t0 === g.at) this.n = -1;
    }
    const st = scene.staggers.get(id);
    const staggered = !!st && now < st.until;
    // The guard: RMB, while it can go up and we're not mid-swing (as the server has it).
    const guard = rmb && m.g > 0 && this.n < 0 && !staggered;
    if (guard !== this.guard) {
      this.guard = guard;
      scene.guards.set(id, { on: guard, at: now });
      this.guardArm(guard);
    }
    // A swing: pressed a moment ago or held, the last one over, hands free, not guarding.
    const wants = now - this.asked <= SABER.buffer || lmb;
    if (wants && this.n < 0 && !guard && m.k > 0 && !staggered) {
      if (now > this.followUntil) this.next = 0;
      const n = this.next;
      this.n = n;
      this.t0 = now;
      this.len = swingLength(n, scene.on(id, 'rage') ? POWERS.rage.pace : 1);
      this.next = (n + 1) % 3;
      this.asked = -99;
      this.guesses.push({ n, at: now });
      scene.swings.set(id, { n, at: now, d: this.len });
      this.feel(client, n, this.len);
    }
  }

  /** The server's word on a swing of ours (`bfh.swing`). */
  swing(client: Client, scene: HeroScene, m: Swing) {
    const now = scene.now;
    const g = this.guesses.shift();
    if (g) {
      // Confirmed. Another step of the combo than we guessed: the swing on show takes it.
      this.rtt += (now - g.at - this.rtt) * 0.2;
      if (g.n !== m.n) {
        const shown = scene.swings.get(m.p);
        if (shown?.at === g.at) scene.swings.set(m.p, { ...shown, n: m.n });
        if (this.t0 === g.at) this.n = m.n;
        this.next = (m.n + 1) % 3;
      }
      return;
    }
    // One we didn't guess: shown now, and our combo follows it.
    scene.swings.set(m.p, { n: m.n, at: now, d: m.d });
    this.n = m.n;
    this.t0 = now;
    this.len = m.d;
    this.next = (m.n + 1) % 3;
    this.feel(client, m.n, m.d);
  }

  /** The server's word on our guard (`bfh.guard`): only a break or a stagger counts (the rest is ours). */
  guardWord(scene: HeroScene, m: Guard) {
    if (!m.broke && !m.st) return;
    this.n = -1;
    this.guesses = [];
    if (this.guard) this.guardArm(false);
    this.guard = false;
    scene.guards.set(m.p, { on: false, at: scene.now });
  }
}
