import type { Client, ClientKit, ClientLoop } from '@platform/client';
import { hz, score, type Instrument, type Note } from '../sounds/hud';
import { hud } from './store';

/** Seconds ahead a beat is put together and handed to the sound (it plays exactly on time from there). */
const AHEAD = 0.12;

/** The four bars' chords (D, E flat, D, C minor: D Phrygian dominant), as semitones from A3 for the bass root and the chord. */
const BARS = [
  { root: -19, chord: [-7, -3, 0] },
  { root: -18, chord: [-6, -2, 1] },
  { root: -19, chord: [-7, -3, 0] },
  { root: -21, chord: [-9, -6, -2] },
];

type Mood = 'off' | 'calm' | 'fight' | 'boss' | 'final' | 'end';

/**
 * The Arena's music, on each screen: synthesised drums and tones (`ar_music`, its instruments in
 * `sounds/hud.ts`) put together a beat at a time, a little ahead, over a low drone (`ar_drone`).
 *
 * - Between waves and before the first: calm: a slow frame drum like a heartbeat, a lyre's
 *   broken chords, the drone low.
 * - A wave: war drums that build as it goes (as its monsters fall, and higher waves start higher):
 *   taiko, then toms and shakers, the lyre running in sixteenths, the bass, claps, brass stabs at
 *   the top; quicker the later the wave.
 * - A boss: heavier and quicker, brass and a choir; the final wave the most of all.
 * - The Crowd's Favour rings bells over it; out of the fight, it's quieter and the drums drop;
 *   under a boss's entrance or fall (the bosses' cinematic), it ducks under their stings.
 * - Victory and defeat end it (their stings say the rest), the drone left low.
 *
 * It plays at the player's music volume (Settings → Sound: `client.audio.music`), silent at 0.
 */
export function music(): ClientKit {
  let drone: ClientLoop | null = null;
  let nextBeat = 0;
  let beat = 0;
  let mood: Mood = 'off';
  let alt = false;

  const stop = () => {
    drone?.stop();
    drone = null;
  };

  return {
    name: 'arena.hud.music',
    frame(client) {
      const now = moodOf(client);
      if (now !== mood) {
        // A new mood starts its phrase from the top on the next beat (a wave's sting plays over the change).
        mood = now;
        beat = 0;
        if (mood === 'off') stop();
      }
      // Quieter out of the fight, and under a boss's entrance or fall (the bosses' cinematic: its own stings).
      const cine = !!document.querySelector('.ab-cine.on');
      const vol = client.audio.music * (hud.me?.state === 'out' ? 0.55 : 1) * (cine ? 0.3 : 1);
      if (mood === 'off' || vol === 0) {
        drone?.set({ volume: 0 });
        nextBeat = client.time;
        return;
      }
      drone ??= client.audio.loop('ar_drone', { volume: 0 });
      drone.set({ volume: vol * (mood === 'calm' ? 0.05 : mood === 'end' ? 0.04 : mood === 'fight' ? 0.06 : 0.08), pitch: 1 });

      const bpm = tempo(mood);
      const len = 60 / bpm;
      // Out of step (the tab was away, the music just started): start again from now.
      if (nextBeat < client.time - 0.25 || nextBeat > client.time + 2) nextBeat = client.time + 0.05;
      while (nextBeat - client.time < AHEAD) {
        const notes = compose(mood, beat, len, intensity());
        if (notes.length) {
          const at = Math.max(0, nextBeat - client.time);
          score.length = 0;
          for (const n of notes) score.push({ ...n, t: n.t + at });
          // (Two voices of the same music taking turns: two beats close together are never taken for one sound.)
          client.audio.play(alt ? 'ar_music_b' : 'ar_music', { volume: vol * (mood === 'calm' ? 0.8 : 1) });
          score.length = 0;
          alt = !alt;
        }
        beat++;
        nextBeat += len;
      }
    },
    dispose: stop,
  };
}

function moodOf(client: Client): Mood {
  const r = hud.run;
  // (Only for someone playing: watching from the home page is quiet.)
  if (!r || client.replay.playing || !client.running || !client.me.id) return 'off';
  if (hud.ended || r.phase === 'victory' || r.phase === 'defeat') return 'end';
  if (r.phase === 'fighting') return r.wave === r.of ? 'final' : r.boss ? 'boss' : 'fight';
  if (r.phase === 'countdown' || r.phase === 'intermission') return 'calm';
  return 'off';
}

/** Beats a minute: calm slow; a wave quicker the later it is; a boss quicker still. */
function tempo(mood: Mood): number {
  const wave = hud.run?.wave ?? 1;
  if (mood === 'calm' || mood === 'end') return 84;
  if (mood === 'final') return 138;
  if (mood === 'boss') return 128;
  return Math.min(128, 104 + wave * 1.4);
}

/** How built up a wave's music is, 0..1: as far through it as they are, starting higher the later the wave. */
function intensity(): number {
  const r = hud.run;
  if (!r) return 0;
  const through = r.total > 0 ? 1 - r.left / r.total : 0;
  return Math.max(0, Math.min(1, 0.15 + Math.min(r.wave, 20) / 40 + through * 0.6 + hud.hype.v * 0.1));
}

/** One beat's notes (`t` from the beat's start): its four sixteenths of each part that plays now. */
function compose(mood: Mood, beat: number, len: number, k: number): Note[] {
  const out: Note[] = [];
  const s16 = len / 4;
  const barBeat = beat % 4;
  const bar = BARS[Math.floor(beat / 4) % BARS.length];
  const fill = Math.floor(beat / 4) % 4 === 3 && barBeat === 3;
  const add = (i: Instrument, step: number, v: number, extra: Partial<Note> = {}) => out.push({ i, t: step * s16, v, ...extra });
  const chordHz = (oct: number) => bar.chord.map((n) => hz(n + oct));
  const favour = hud.hype.f > 0;

  if (mood === 'end') {
    if (barBeat === 0) add('pluck', 0, 0.05, { f: [hz(bar.chord[0])], d: 0.9 });
    return out;
  }

  if (mood === 'calm') {
    // A heartbeat on the frame drum, the lyre breaking the chord slowly, a breath of shaker.
    if (barBeat === 0) add('taiko', 0, 0.22, { f: [0.9] });
    if (barBeat === 0) add('tom', 2, 0.08, { f: [0.8] });
    if (barBeat === 2) add('taiko', 0, 0.12, { f: [0.95] });
    const arp = chordHz(12);
    add('pluck', 0, 0.06, { f: [arp[barBeat % 3]], d: 0.8 });
    if (barBeat % 2 === 1) add('pluck', 2, 0.04, { f: [arp[(barBeat + 1) % 3] * 2], d: 0.6 });
    if (barBeat === 1 || barBeat === 3) add('shaker', 2, 0.03);
    if (barBeat === 0 && Math.floor(beat / 4) % 2 === 0) add('bass', 0, 0.07, { f: [hz(bar.root)], d: len * 3 });
    // The last seconds before a wave: the drums gather.
    const next = hud.run?.next ?? 99;
    if (next > 0 && next <= 4) {
      add('tom', 0, 0.12, { f: [1.1] });
      add('tom', 2, 0.1, { f: [1.2] });
      if (next <= 2) add('roll', 0, 0.12, { d: len * 0.9 });
    }
    return out;
  }

  const boss = mood === 'boss' || mood === 'final';
  const heavy = boss ? Math.max(0.7, k) : k;
  // Out of the fight, watching: the drums drop out, the lyre and the bass go on.
  if (hud.me?.state === 'out') {
    if (barBeat === 0) add('bass', 0, 0.1, { f: [hz(bar.root)], d: len * 2 });
    add('pluck', 0, 0.04, { f: [chordHz(12)[barBeat % 3]], d: 0.5 });
    return out;
  }
  // War drums: the downbeats always; more as it builds.
  if (barBeat === 0 || barBeat === 2) add('taiko', 0, 0.42 + heavy * 0.18);
  if (heavy > 0.35 && barBeat === 1) add('taiko', 2, 0.25, { f: [1.08] });
  if (heavy > 0.55 && barBeat === 3) add('taiko', 2, 0.28, { f: [1.05] });
  if (boss) add('taiko', 0, 0.3, { f: [0.85] });
  // Toms: a fill at the end of every fourth bar, a figure on the off beats when it's built up.
  if (fill) [0, 1, 2, 3].forEach((s) => add('tom', s, 0.18 + s * 0.04, { f: [1.3 - s * 0.1] }));
  else if (heavy > 0.45 && barBeat === 3) add('tom', 2, 0.15, { f: [1.15] });
  // Shakers and hats.
  if (heavy > 0.25) for (const s of [2]) add('shaker', s, 0.05 + heavy * 0.03);
  if (heavy > 0.5) for (const s of [1, 3]) add('hat', s, 0.035);
  // Claps on two and four.
  if (heavy > 0.65 && (barBeat === 1 || barBeat === 3)) add('clap', 0, 0.12);
  // The bass: the root, pushing.
  if (heavy > 0.2) {
    const root = hz(bar.root);
    add('bass', 0, 0.16, { f: [root], d: s16 * 1.6 });
    if (heavy > 0.4) add('bass', 3, 0.12, { f: [root], d: s16 });
    if (heavy > 0.6 && barBeat % 2 === 1) add('bass', 2, 0.12, { f: [root * 2], d: s16 });
  }
  // The lyre running through the chord in sixteenths.
  if (heavy > 0.3) {
    const arp = chordHz(12);
    const order = [0, 1, 2, 1];
    for (let s = 0; s < 4; s++) {
      if (heavy < 0.5 && s % 2 === 1) continue;
      const f = arp[order[(s + barBeat) % 4]] * (s === 0 && barBeat === 0 ? 2 : 1);
      add('pluck', s, 0.045 + (s === 0 ? 0.02 : 0), { f: [f], d: 0.25 });
    }
  }
  // Brass at the top, and always for a boss: stabs on the bar and pushed off the beat.
  if (heavy > 0.8 || boss) {
    if (barBeat === 0) add('stab', 0, 0.05, { f: chordHz(0), d: 0.28 });
    if (barBeat === 1) add('stab', 2, 0.045, { f: chordHz(0), d: 0.2 });
    if (barBeat === 2 && boss) add('stab', 3, 0.04, { f: chordHz(0), d: 0.2 });
  }
  // The choir over a boss and the final wave: a held chord each bar.
  if (boss && barBeat === 0) add('choir', 0, mood === 'final' ? 0.05 : 0.04, { f: chordHz(-12), d: len * 4, vowel: mood === 'final' ? 'a' : 'o' });
  // A horn calling every other bar in the final wave.
  if (mood === 'final' && barBeat === 0 && Math.floor(beat / 4) % 2 === 0) add('horn', 0, 0.05, { f: [hz(bar.root + 12)], d: len * 2 });
  // The Crowd's Favour: bells over it all.
  if (favour && (barBeat === 0 || barBeat === 2)) add('bell', 0, 0.035, { f: [chordHz(24)[barBeat === 0 ? 0 : 2]] });
  return out;
}
