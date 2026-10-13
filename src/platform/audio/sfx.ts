import type { Acoustics, ClientLoop, LoopKit, LoopVoice, SoundName, SynthKit, SynthVoice, Vec3 } from '../api/types';

type Voice = (ctx: BaseAudioContext, out: AudioNode, t: number, p: number) => void;

/** The sounds the engine keeps: its world's (blocks, pickups, getting hurt) and its screens' (jingles, clicks). */
type EngineSound = 'hit' | 'hurt' | 'pickup' | 'heal' | 'wave' | 'victory' | 'defeat' | 'spawn' | 'click' | 'countdown' | 'lock' | 'alarm';

/** A continuous sound's own nodes: its loudness and pitch set, and stopped. */
type Loop = { set(volume: number, pitch: number): void; stop(): void };

/** How loud a sound is here, which side it's on, how muffled, and how much of it the reverb gets. */
interface Heard {
  gain: number;
  pan: number;
  cutoff: number;
  wet: number;
}

/** No muffling. */
const OPEN = 20000;

/** The nodes a sound goes out through (`Sfx.route`). */
interface Way {
  dry: GainNode;
  pan: StereoPannerNode;
  air: BiquadFilterNode | null;
  wet: GainNode | null;
}

/** Procedurally synthesised sound effects (no audio assets), positional relative to the camera. */
export class Sfx {
  private ctx: BaseAudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  /** The shared reverb's input (with acoustics that have one). */
  private reverb: GainNode | null = null;
  private listener = { x: 0, y: 0, z: 0, rx: 1, rz: 0 };
  private last = new Map<string, number>();
  private acoustic: Acoustics = {};
  /** Rendering offline (`Sfx.offline`): no autoplay rules, no clean-up timers. */
  private offline = false;
  volume = 0.7;
  /** The player's volume setting (0..1), over `volume`. */
  private level = 1;

  /** The live context (not an offline one), for suspending and closing. */
  private get live(): AudioContext | null {
    return this.ctx && !this.offline ? (this.ctx as AudioContext) : null;
  }

  /** The player's volume setting (0..1): everything's loudness. */
  setLevel(level: number) {
    this.level = Math.max(0, Math.min(1, level));
    if (this.master) this.master.gain.value = this.volume * this.level;
  }

  /** Done (switching games): release the audio device. */
  close() {
    for (const l of this.loops) l.drop();
    this.loops.clear();
    void this.live?.close();
    this.ctx = null;
    this.master = null;
    this.reverb = null;
  }

  /** Must be called from a user gesture at least once (browser autoplay rules). */
  unlock() {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.attach(new Ctor());
    }
    const live = this.live;
    if (live?.state === 'suspended') void live.resume();
  }

  /** The graph on a context: the master (through a compressor), the noise, the reverb; loops waiting start. */
  private attach(ctx: BaseAudioContext) {
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume * this.level;
    this.master.connect(comp).connect(ctx.destination);
    const len = ctx.sampleRate;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.buildReverb();
    for (const l of this.loops) l.start();
  }

  /**
   * An offline copy for rendering sounds to samples (tools, checks): play into it (now, or `at` a
   * time into the render), then `render`. Its voices are the ones `define`d on it.
   */
  static offline(seconds: number, sampleRate = 44100): OfflineSfx {
    const s = new Sfx() as OfflineSfx;
    s.offline = true;
    const ctx = new OfflineAudioContext(2, Math.ceil(seconds * sampleRate), sampleRate);
    s.attach(ctx);
    s.render = () => ctx.startRendering();
    // (A render stops once per block of 128 frames at most: whatever's due in one runs together.)
    const due = new Map<number, (() => void)[]>();
    s.at = (time, run) => {
      if (time <= 0) return run();
      const block = Math.round((time * sampleRate) / 128);
      const list = due.get(block);
      if (list) return void list.push(run);
      due.set(block, [run]);
      void ctx.suspend((block * 128) / sampleRate).then(() => {
        for (const r of due.get(block)!) r();
        return ctx.resume();
      });
    };
    return s;
  }

  private held = false;

  /** Freeze all sound (pause menus): loops stop where they are and resume with the game. */
  hold(on: boolean) {
    const live = this.live;
    if (on === this.held || !live) return;
    this.held = on;
    if (on) void live.suspend();
    else void live.resume();
  }

  setListener(pos: Vec3, yaw: number) {
    this.listener.x = pos.x;
    this.listener.y = pos.y;
    this.listener.z = pos.z;
    this.listener.rx = Math.cos(yaw);
    this.listener.rz = -Math.sin(yaw);
    for (const l of this.loops) l.place();
  }

  /** How the world sounds from now on (`client.audio.acoustics`): distance muffling, a reverb. */
  acoustics(a: Acoustics) {
    this.acoustic = { air: a.air, reverb: a.reverb && { ...a.reverb } };
    this.buildReverb();
  }

  /** The reverb the acoustics ask for (none: none), its tail made afresh: decaying noise, darkening as it goes. */
  private buildReverb() {
    const ctx = this.ctx;
    this.reverb?.disconnect();
    this.reverb = null;
    const r = this.acoustic.reverb;
    if (!ctx || !this.master || !r) return;
    const seconds = Math.max(0.2, Math.min(6, r.seconds ?? 1.6));
    const damp = Math.max(0, Math.min(1, r.damp ?? 0.5));
    const rate = ctx.sampleRate;
    const len = Math.floor(seconds * rate);
    const ir = ctx.createBuffer(2, len, rate);
    // A few early reflections (walls near by), then a diffuse tail: noise decaying by 60 dB over
    // `seconds`, through a lowpass that closes as it goes (the air and walls eat the highs first).
    const early = [0.011, 0.019, 0.027, 0.041, 0.053, 0.067];
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / rate;
        const k = Math.min(0.95, 0.12 + damp * 0.75 * (t / seconds) + damp * 0.1);
        lp += (1 - k) * ((Math.random() * 2 - 1) - lp);
        const onset = Math.min(1, t / 0.012);
        d[i] = lp * Math.exp((-6.9 * t) / seconds) * onset;
      }
      for (const [j, e] of early.entries()) {
        const i = Math.floor((e + (c ? 0.003 * (j % 2 ? 1 : -1) : 0)) * rate);
        if (i < len) d[i] += (j % 2 === c ? 0.5 : 0.32) * (1 - j * 0.1);
      }
    }
    const conv = ctx.createConvolver();
    conv.buffer = ir;
    const input = ctx.createGain();
    const out = ctx.createGain();
    out.gain.value = 2.5;
    // (No boom in it: thumps ring on as mud.)
    input.connect(filter(ctx, 'highpass', 220, 0.7)).connect(conv).connect(out).connect(this.master);
    this.reverb = input;
  }

  /** Sounds client code defines (kits, the game's client code: `client.audio.define`). */
  private custom = new Map<string, { voice: SynthVoice; reverb: number }>();
  private customLoops = new Map<string, LoopVoice>();
  private warned = new Set<string>();

  /** Add or replace a sound client code defines (`client.audio.define`; see `SynthKit`). */
  define(name: string, voice: SynthVoice, opts: { reverb?: number } = {}) {
    this.custom.set(name, { voice, reverb: opts.reverb ?? 1 });
  }

  /** Add or replace a continuous sound client code defines (`client.audio.defineLoop`; see `LoopKit`). */
  defineLoop(name: string, voice: LoopVoice) {
    this.customLoops.set(name, voice);
  }

  private warn(what: string) {
    if (this.warned.has(what)) return;
    this.warned.add(what);
    console.warn(what);
  }

  /** How a sound at `at` (none: everywhere) is heard here, `volume` loud, taking `reverb` of the reverb. */
  private heard(at: Vec3 | undefined | null, volume: number, reverb: number): Heard {
    let gain = volume;
    let pan = 0;
    let d = 0;
    if (at) {
      const dx = at.x - this.listener.x;
      const dy = at.y - this.listener.y;
      const dz = at.z - this.listener.z;
      d = Math.hypot(dx, dy, dz);
      gain *= 1 / (1 + d * 0.09);
      if (d > 0.5) pan = Math.max(-0.85, Math.min(0.85, (dx * this.listener.rx + dz * this.listener.rz) / d));
    }
    const air = this.acoustic.air ?? 0;
    const cutoff = at && air > 0 ? Math.min(OPEN, OPEN / (1 + d * air * 0.1)) : OPEN;
    const r = this.acoustic.reverb;
    let wet = 0;
    if (r && this.reverb && reverb > 0) {
      // The echo fades with distance much slower than the sound itself: far off, it's most of what's heard.
      const near = r.near ?? 0.15;
      const far = r.far ?? 0.6;
      wet = (volume * reverb * (near + (far - near) * Math.min(1, d / 100))) / (1 + d * 0.025);
    }
    return { gain, pan, cutoff, wet };
  }

  /**
   * The nodes a sound goes out through, as `h` says: into `input`, muffled, then to the master
   * (loud and to one side) and the reverb. `moving`: it may be muffled later if not now (a loop).
   */
  private route(ctx: BaseAudioContext, input: AudioNode, h: Heard, moving = false): Way {
    let from = input;
    let air: BiquadFilterNode | null = null;
    if (h.cutoff < OPEN || (moving && (this.acoustic.air ?? 0) > 0)) {
      air = filter(ctx, 'lowpass', h.cutoff, 0.5);
      from = input.connect(air);
    }
    const dry = ctx.createGain();
    dry.gain.value = h.gain;
    const pan = ctx.createStereoPanner();
    pan.pan.value = h.pan;
    from.connect(dry).connect(pan).connect(this.master!);
    let wet: GainNode | null = null;
    if (this.reverb) {
      wet = ctx.createGain();
      wet.gain.value = h.wet;
      from.connect(wet).connect(this.reverb);
    }
    return { dry, pan, air, wet };
  }

  play(name: SoundName, opts: { at?: Vec3; volume?: number; pitch?: number } = {}) {
    // (Silent until the audio's running: the client code's sounds are defined by then.)
    const ctx = this.ctx;
    if (!ctx || !this.master || (!this.offline && ctx.state !== 'running')) return;
    const custom = this.custom.get(name);
    const builtin = (VOICES as Record<string, Voice | undefined>)[name];
    if (!custom && !builtin) {
      this.warn(`audio.play: unknown sound "${name}" (define it in the game's client code: client.audio.define)`);
      return;
    }
    // Throttle identical sounds within 30 ms (large waves hitting at once).
    const now = ctx.currentTime;
    if ((this.last.get(name) ?? -1) > now - 0.03) return;
    this.last.set(name, now);
    const h = this.heard(opts.at, opts.volume ?? 1, custom?.reverb ?? 1);
    if (h.gain < 0.02 && h.wet < 0.02) return;
    const g = ctx.createGain();
    const nodes = this.route(ctx, g, h);
    let seconds = 3;
    if (custom) {
      const kit = synthKit(this, ctx, g, now + 0.005, opts.pitch ?? 1);
      custom.voice(kit);
      seconds = kit.end + 0.1;
    } else builtin!.call(this, ctx, g, now + 0.005, opts.pitch ?? 1);
    if (this.offline) return;
    window.setTimeout(() => {
      g.disconnect();
      nodes.dry.disconnect();
      nodes.pan.disconnect();
      nodes.air?.disconnect();
      nodes.wet?.disconnect();
    }, seconds * 1000);
  }

  /** Continuous sounds under way (or waiting for the audio to start). */
  private loops = new Set<Looping>();

  /**
   * Start a continuous sound: the platform's (`engine`, `wind`) or client code's (`defineLoop`),
   * everywhere or at a spot. Safe to call before audio is unlocked: it starts then.
   */
  loop(name: string, opts: { at?: Vec3 | null; volume?: number; pitch?: number } = {}): ClientLoop {
    const make = (LOOPS as Record<string, LoopMaker | undefined>)[name] ?? customLoop(this.customLoops.get(name));
    if (!make) {
      this.warn(`audio.loop: unknown loop "${name}" (define it in the game's client code: client.audio.defineLoop)`);
      return { set() {}, stop() {} };
    }
    const l = new Looping(this, make, opts);
    this.loops.add(l);
    if (this.ctx) l.start();
    return {
      set: (o) => l.set(o),
      stop: () => {
        l.drop();
        this.loops.delete(l);
      },
    };
  }

  /** (`Looping`'s way in: the context, and how a loop is heard.) */
  loopParts() {
    return this.ctx && this.master ? { ctx: this.ctx, heard: (at: Vec3 | null, volume: number) => this.heard(at, volume, 1), route: (input: AudioNode, h: Heard) => this.route(this.ctx!, input, h, true) } : null;
  }

  // ---- building blocks ----

  noiseSrc(ctx: BaseAudioContext): AudioBufferSourceNode {
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    return s;
  }
}

type LoopMaker = (self: Sfx, ctx: BaseAudioContext, out: AudioNode) => Loop;

/** An `Sfx` rendering offline: `at` runs something that far into the render (seconds), `render` renders. */
export type OfflineSfx = Sfx & { render(): Promise<AudioBuffer>; at(time: number, run: () => void): void };

/**
 * One continuous sound: its own nodes (made when the audio starts), heard from where it is. Its
 * loudness goes on its nodes; where it is, on the way out (moved as the listener moves).
 */
class Looping {
  private at: Vec3 | null;
  private volume: number;
  private pitch: number;
  private nodes: Loop | null = null;
  private out: GainNode | null = null;
  private way: Way | null = null;
  private dropped = false;

  constructor(
    private sfx: Sfx,
    private make: LoopMaker,
    opts: { at?: Vec3 | null; volume?: number; pitch?: number },
  ) {
    this.at = opts.at ? { ...opts.at } : null;
    this.volume = opts.volume ?? 1;
    this.pitch = opts.pitch ?? 1;
  }

  /** The audio's running: make the nodes, as last set. */
  start() {
    const parts = this.sfx.loopParts();
    if (!parts || this.dropped) return;
    this.nodes?.stop();
    const ctx = parts.ctx;
    this.out = ctx.createGain();
    this.way = parts.route(this.out, parts.heard(this.at, 1));
    this.nodes = this.make(this.sfx, ctx, this.out);
    this.nodes.set(this.volume, this.pitch);
  }

  set(o: { volume?: number; pitch?: number; at?: Vec3 | null }) {
    if (this.dropped) return;
    this.volume = o.volume ?? this.volume;
    this.pitch = o.pitch ?? this.pitch;
    if (o.at !== undefined) this.at = o.at ? { ...o.at } : null;
    this.nodes?.set(this.volume, this.pitch);
    if (o.at !== undefined) this.place();
  }

  /** Heard from where it is now (it moved, or we did). */
  place() {
    const parts = this.sfx.loopParts();
    const w = this.way;
    if (!parts || !w) return;
    const h = parts.heard(this.at, 1);
    const t = parts.ctx.currentTime;
    w.dry.gain.setTargetAtTime(h.gain, t, 0.04);
    w.pan.pan.setTargetAtTime(h.pan, t, 0.04);
    w.air?.frequency.setTargetAtTime(h.cutoff, t, 0.04);
    w.wet?.gain.setTargetAtTime(h.wet, t, 0.04);
  }

  drop() {
    if (this.dropped) return;
    this.dropped = true;
    this.nodes?.stop();
    const w = this.way;
    const out = this.out;
    if (!w || !out) return;
    // (After the loop's own fade.)
    window.setTimeout(() => {
      out.disconnect();
      w.dry.disconnect();
      w.pan.disconnect();
      w.air?.disconnect();
      w.wet?.disconnect();
    }, 700);
  }
}

function env(ctx: BaseAudioContext, t: number, attack: number, decay: number, peak = 1, hold = 0): GainNode {
  const g = ctx.createGain();
  const top = Math.max(0.0002, peak);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(top, t + attack);
  if (hold > 0) g.gain.setValueAtTime(top, t + attack + hold);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + decay);
  return g;
}

function osc(ctx: BaseAudioContext, type: OscillatorType, f0: number, f1: number, t: number, dur: number): OscillatorNode {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  o.start(t);
  o.stop(t + dur + 0.05);
  return o;
}

function filter(ctx: BaseAudioContext, type: BiquadFilterType, f: number, q = 1): BiquadFilterNode {
  const b = ctx.createBiquadFilter();
  b.type = type;
  b.frequency.value = f;
  b.Q.value = q;
  return b;
}

/** Soft clipping, harder with `drive` (0..1): the curves, kept by amount. */
const CURVES = new Map<number, Float32Array<ArrayBuffer>>();
function shaper(ctx: BaseAudioContext, drive: number): WaveShaperNode {
  const k = Math.round(Math.max(0, Math.min(1, drive)) * 20) / 20;
  let curve = CURVES.get(k);
  if (!curve) {
    const n = 1024;
    const a = 1 + k * 24;
    curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = Math.tanh(a * x) / Math.tanh(a);
    }
    CURVES.set(k, curve);
  }
  const w = ctx.createWaveShaper();
  w.curve = curve;
  w.oversample = '2x';
  return w;
}

function noiseBurst(self: Sfx, ctx: BaseAudioContext, out: AudioNode, t: number, dur: number, type: BiquadFilterType, f0: number, f1: number, peak: number, q = 1, attack = 0.005, hold = 0) {
  const n = self.noiseSrc(ctx);
  const f = filter(ctx, type, f0, q);
  f.frequency.setValueAtTime(f0, t);
  f.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const e = env(ctx, t, attack, dur, peak, hold);
  n.connect(f).connect(e).connect(out);
  n.start(t, Math.random() * 0.5);
  n.stop(t + attack + hold + dur + 0.05);
}

function tone(ctx: BaseAudioContext, out: AudioNode, type: OscillatorType, f0: number, f1: number, t: number, dur: number, peak: number, lowpass = 0) {
  const o = osc(ctx, type, f0, f1, t, dur);
  const e = env(ctx, t, 0.008, dur, peak);
  if (lowpass > 0) o.connect(filter(ctx, 'lowpass', lowpass)).connect(e).connect(out);
  else o.connect(e).connect(out);
}

/** A frequency's path on `param`, times `k`: from `from`, along `glide`'s points, or to `to` over `duration`. */
function sweep(param: AudioParam, o: { from: number; to?: number; glide?: [number, number][]; duration: number }, start: number, k: number) {
  param.setValueAtTime(o.from * k, start);
  if (o.glide) for (const [at, f] of o.glide) param.exponentialRampToValueAtTime(Math.max(0.01, f * k), start + Math.max(0.001, at));
  else if (o.to !== undefined && o.to !== o.from) param.exponentialRampToValueAtTime(Math.max(0.01, o.to * k), start + o.duration);
}

/** The toolkit handed to game-defined sounds; `end` is when the last layer's done (seconds from the start). */
function synthKit(self: Sfx, ctx: BaseAudioContext, out: AudioNode, t: number, pitch: number): SynthKit & { end: number } {
  const kit = {
    pitch,
    end: 0,
    tone(o: Parameters<SynthKit['tone']>[0]) {
      const start = t + (o.delay ?? 0);
      const attack = o.attack ?? 0.008;
      const hold = o.hold ?? 0;
      const len = attack + hold + o.duration;
      kit.end = Math.max(kit.end, (o.delay ?? 0) + len);
      const node = ctx.createOscillator();
      node.type = o.wave ?? 'sine';
      sweep(node.frequency, o, start, 1);
      node.start(start);
      node.stop(start + len + 0.05);
      if (o.vibrato) {
        const lfo = ctx.createOscillator();
        lfo.frequency.value = o.vibrato.rate;
        const lg = ctx.createGain();
        lg.gain.value = o.vibrato.depth;
        lfo.connect(lg).connect(node.frequency);
        lfo.start(start);
        lfo.stop(start + len + 0.05);
      }
      if (o.fm) {
        // The modulator follows the tone's pitch (times `ratio`), and bends it by `depth` times it.
        const m = ctx.createOscillator();
        sweep(m.frequency, o, start, o.fm.ratio);
        const bend = ctx.createGain();
        bend.gain.value = 0;
        sweep(bend.gain, o, start, o.fm.depth);
        m.connect(bend);
        if (o.fm.to !== undefined && o.fm.depth > 0) {
          const ease = ctx.createGain();
          ease.gain.setValueAtTime(1, start);
          ease.gain.exponentialRampToValueAtTime(Math.max(0.001, o.fm.to / o.fm.depth), start + len);
          bend.connect(ease).connect(node.frequency);
        } else bend.connect(node.frequency);
        m.start(start);
        m.stop(start + len + 0.05);
      }
      let chain: AudioNode = node;
      if (o.drive) chain = chain.connect(shaper(ctx, o.drive));
      if (o.highpass) chain = chain.connect(filter(ctx, 'highpass', o.highpass, 0.7));
      if (o.lowpass) {
        const lp = typeof o.lowpass === 'number' ? { freq: o.lowpass } : o.lowpass;
        const f = filter(ctx, 'lowpass', lp.freq, lp.q ?? 1);
        if (lp.to) {
          f.frequency.setValueAtTime(lp.freq, start);
          f.frequency.exponentialRampToValueAtTime(lp.to, start + (lp.time ?? len));
        }
        chain = chain.connect(f);
      }
      if (o.bandpass) {
        const bp = filter(ctx, 'bandpass', o.bandpass.freq, o.bandpass.q ?? 1);
        if (o.bandpass.to) {
          bp.frequency.setValueAtTime(o.bandpass.freq, start);
          bp.frequency.exponentialRampToValueAtTime(o.bandpass.to, start + o.duration);
        }
        chain = chain.connect(bp);
      }
      chain.connect(env(ctx, start, attack, o.duration, o.volume ?? 0.5, hold)).connect(out);
    },
    noise(o: Parameters<SynthKit['noise']>[0]) {
      const attack = o.attack ?? 0.005;
      const hold = o.hold ?? 0;
      kit.end = Math.max(kit.end, (o.delay ?? 0) + attack + hold + o.duration);
      noiseBurst(self, ctx, out, t + (o.delay ?? 0), o.duration, o.filter ?? 'bandpass', o.from, o.to ?? o.from, o.volume ?? 0.3, o.q ?? 1, attack, hold);
    },
  };
  return kit;
}

/** A continuous sound client code defined (`LoopKit`): steady layers, their frequencies following the pitch. */
function customLoop(voice: LoopVoice | undefined): LoopMaker | undefined {
  if (!voice) return undefined;
  return (self, ctx, out) => {
    const g = ctx.createGain();
    g.gain.value = 0;
    g.connect(out);
    /** Every frequency to move with the pitch: the param, and its frequency at pitch 1. */
    const follow: [AudioParam, number][] = [];
    const sources: AudioScheduledSourceNode[] = [];
    const kit: LoopKit = {
      tone(o) {
        const node = ctx.createOscillator();
        node.type = o.wave ?? 'sine';
        node.frequency.value = o.freq;
        follow.push([node.frequency, o.freq]);
        sources.push(node);
        if (o.vibrato) {
          const lfo = ctx.createOscillator();
          lfo.frequency.value = o.vibrato.rate;
          const lg = ctx.createGain();
          lg.gain.value = o.vibrato.depth;
          lfo.connect(lg).connect(node.frequency);
          sources.push(lfo);
        }
        if (o.fm) {
          const m = ctx.createOscillator();
          m.frequency.value = o.freq * o.fm.ratio;
          follow.push([m.frequency, o.freq * o.fm.ratio]);
          const bend = ctx.createGain();
          bend.gain.value = o.freq * o.fm.depth;
          follow.push([bend.gain, o.freq * o.fm.depth]);
          m.connect(bend).connect(node.frequency);
          sources.push(m);
        }
        let chain: AudioNode = node;
        if (o.drive) chain = chain.connect(shaper(ctx, o.drive));
        for (const [type, f, q] of [
          ['highpass', o.highpass, 0.7],
          ['lowpass', o.lowpass, 1],
          ['bandpass', o.bandpass?.freq, o.bandpass?.q ?? 1],
        ] as const) {
          if (!f) continue;
          const b = filter(ctx, type, f, q);
          follow.push([b.frequency, f]);
          chain = chain.connect(b);
        }
        const v = ctx.createGain();
        v.gain.value = o.volume ?? 0.5;
        chain.connect(v).connect(g);
      },
      noise(o) {
        const n = self.noiseSrc(ctx);
        const b = filter(ctx, o.filter ?? 'bandpass', o.freq, o.q ?? 1);
        follow.push([b.frequency, o.freq]);
        const v = ctx.createGain();
        v.gain.value = o.volume ?? 0.3;
        n.connect(b).connect(v).connect(g);
        sources.push(n);
      },
    };
    voice(kit);
    for (const s of sources) s.start();
    return {
      set(volume, pitch) {
        const t = ctx.currentTime;
        for (const [param, f] of follow) param.setTargetAtTime(Math.min(20000, f * pitch), t, 0.03);
        g.gain.setTargetAtTime(volume, t, 0.03);
      },
      stop() {
        const t = ctx.currentTime;
        g.gain.setTargetAtTime(0, t, 0.06);
        for (const s of sources) s.stop(t + 0.5);
        sources[0]?.addEventListener('ended', () => g.disconnect());
      },
    };
  };
}

/** The engine's own sounds: its world's and its screens' (the sounds kit, `sounds.standard()`, defines the rest). */
const VOICES: Record<EngineSound, Voice> = {
  hit(this: Sfx, ctx, out, t, p) {
    tone(ctx, out, 'sine', 170 * p, 55, t, 0.14, 0.9);
    noiseBurst(this, ctx, out, t, 0.05, 'highpass', 2500, 1500, 0.35);
  },
  hurt(this: Sfx, ctx, out, t, p) {
    tone(ctx, out, 'sawtooth', 240 * p, 120 * p, t, 0.22, 0.35, 1200);
    noiseBurst(this, ctx, out, t, 0.12, 'lowpass', 1500, 400, 0.3);
  },
  pickup(this: Sfx, ctx, out, t, p) {
    tone(ctx, out, 'sine', 880 * p, 880 * p, t, 0.07, 0.3);
    tone(ctx, out, 'sine', 1320 * p, 1320 * p, t + 0.07, 0.1, 0.3);
  },
  heal(this: Sfx, ctx, out, t, p) {
    [660, 880, 1100].forEach((f, i) => tone(ctx, out, 'sine', f * p, f * p * 1.01, t + i * 0.06, 0.35, 0.18));
  },
  wave(this: Sfx, ctx, out, t, p) {
    const f = filter(ctx, 'lowpass', 300);
    f.frequency.setValueAtTime(300, t);
    f.frequency.exponentialRampToValueAtTime(2400, t + 0.5);
    const e = env(ctx, t, 0.15, 1.1, 0.35);
    f.connect(e).connect(out);
    for (const fr of [110, 165, 220.5]) osc(ctx, 'sawtooth', fr * p, fr * p, t, 1.3).connect(f);
  },
  victory(this: Sfx, ctx, out, t) {
    [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(ctx, out, 'square', f, f, t + i * 0.13, i === 5 ? 0.8 : 0.16, 0.14, 3000));
    [262, 330, 392].forEach((f) => tone(ctx, out, 'triangle', f, f, t + 0.65, 1.0, 0.18));
  },
  defeat(this: Sfx, ctx, out, t) {
    [392, 370, 349, 262].forEach((f, i) => tone(ctx, out, 'sawtooth', f, f * 0.98, t + i * 0.28, i === 3 ? 1.0 : 0.3, 0.16, 1400));
  },
  spawn(this: Sfx, ctx, out, t, p) {
    noiseBurst(this, ctx, out, t, 0.5, 'bandpass', 400 * p, 2400 * p, 0.25, 2);
    tone(ctx, out, 'sine', 300 * p, 900 * p, t + 0.05, 0.4, 0.12);
  },
  click(this: Sfx, ctx, out, t) {
    tone(ctx, out, 'sine', 1200, 900, t, 0.04, 0.2);
  },
  countdown(this: Sfx, ctx, out, t, p) {
    tone(ctx, out, 'square', 660 * p, 660 * p, t, 0.12, 0.18, 2500);
  },
  lock(this: Sfx, ctx, out, t, p) {
    tone(ctx, out, 'square', 1480 * p, 1480 * p, t, 0.06, 0.14, 4000);
    tone(ctx, out, 'square', 1480 * p, 1480 * p, t + 0.09, 0.06, 0.14, 4000);
  },
  alarm(this: Sfx, ctx, out, t, p) {
    for (let i = 0; i < 3; i++) tone(ctx, out, 'square', (i % 2 ? 520 : 760) * p, (i % 2 ? 520 : 760) * p, t + i * 0.16, 0.14, 0.12, 2200);
  },
};

/** Continuous sounds, built per start from oscillators and noise. */
const LOOPS: Record<'engine' | 'wind', LoopMaker> = {
  // Thruster roar: detuned saws and a sub under a lowpass, plus filtered noise.
  engine(self, ctx, out) {
    const lp = filter(ctx, 'lowpass', 600, 0.7);
    const g = ctx.createGain();
    g.gain.value = 0;
    lp.connect(g).connect(out);
    const oscs = [58, 58.7, 29].map((f, i) => {
      const o = ctx.createOscillator();
      o.type = i === 2 ? 'square' : 'sawtooth';
      o.frequency.value = f;
      o.connect(lp);
      o.start();
      return { o, f };
    });
    const n = self.noiseSrc(ctx);
    const bp = filter(ctx, 'bandpass', 900, 0.8);
    const ng = ctx.createGain();
    ng.gain.value = 0.35;
    n.connect(bp).connect(ng).connect(g);
    n.start();
    return {
      set(volume, pitch) {
        const t = ctx.currentTime;
        for (const { o, f } of oscs) o.frequency.setTargetAtTime(f * pitch, t, 0.08);
        lp.frequency.setTargetAtTime(350 + 900 * pitch, t, 0.08);
        bp.frequency.setTargetAtTime(600 + 1200 * pitch, t, 0.08);
        g.gain.setTargetAtTime(volume * 0.3, t, 0.08);
      },
      stop() {
        const t = ctx.currentTime;
        g.gain.setTargetAtTime(0, t, 0.1);
        for (const { o } of oscs) o.stop(t + 0.6);
        n.stop(t + 0.6);
        n.addEventListener('ended', () => g.disconnect());
      },
    };
  },
  wind(self, ctx, out) {
    const n = self.noiseSrc(ctx);
    const bp = filter(ctx, 'bandpass', 500, 0.5);
    const g = ctx.createGain();
    g.gain.value = 0;
    n.connect(bp).connect(g).connect(out);
    n.start();
    return {
      set(volume, pitch) {
        const t = ctx.currentTime;
        bp.frequency.setTargetAtTime(300 + 900 * pitch, t, 0.15);
        g.gain.setTargetAtTime(volume * 0.4, t, 0.15);
      },
      stop() {
        g.gain.setTargetAtTime(0, ctx.currentTime, 0.1);
        n.stop(ctx.currentTime + 0.6);
        n.addEventListener('ended', () => g.disconnect());
      },
    };
  },
};