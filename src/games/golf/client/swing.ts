import type { Client, ClientKit } from '@platform/client';
import { CLUBS, clubOf, lieEffect, strike, type Club, type Swing } from '../clubs';
import { course, Surf, SURF_NAMES } from '../course';
import { mph } from '../course/wind';
import { puttSpeed, simulate } from '../physics';
import { MSG, type AddressMsg } from '../protocol';
import { S, clamp, dirOf, feet, yards, yawOf } from '../scale';
import { flightAt, restAt, type GolfState } from './state';

/**
 * The swing, on the golfer's own screen (so its feel is theirs, whatever the network does).
 * Stepped up to the ball (the server's `MSG.address`), the camera stands behind it looking down
 * the line, and the mouse swings the club:
 *
 * 1. Hold the left button and pull the mouse back (down): the backswing. How far is the power
 *    (past full is an overswing: a little more distance, and less room for error).
 * 2. Push it up through where you started: the downswing, and the strike as it gets there. A
 *    straight stroke hits it straight; drifting right pushes and slices it, left pulls and hooks
 *    it. Commit to it: a slow downswing loses distance and blocks it right (a putt only minds a
 *    real dawdle). Let go before the strike to back off.
 *
 * (Space instead runs the classic three-click meter: start, power, then the strike in the notch.)
 *
 * Before it: the mouse (or A / D, Shift for fine) aims; the wheel or 1-9 picks the club; the arrow
 * keys move the strike point (↓ low on the ball: backspin, a higher flight that stops; ↑ high: a
 * lower runner; ← a draw, → a fade); Q looks at where it'll land. The ring is where a full swing
 * carries, wind and all. Then the camera follows the ball.
 */

type Phase = 'idle' | 'aim' | 'back' | 'down' | 'sent' | 'watch';

/** The mouse's swing: a full backswing is this much of the view's turn (about 250 pixels at the usual sensitivity). */
const FULL = 0.55;
/** A finger's swing on the touch controls (holding swing, pull down, flick up): a thumb's reach, about 80 pixels, is a full backswing. */
const FULL_TOUCH = 0.26;
/** How far off straight (radians) the downswing's path is for an accuracy of 1. */
const PATH_WINDOW = 0.11;

/** The meter: its value's place along the bar (0..1), from `LOW` below the notch to `HIGH` over full. */
const LOW = -0.3;
const HIGH = 1.12;
const at = (m: number) => clamp(0.08 + m * 0.8, 0, 1);
/** Seconds from nothing to full on the backswing, and from full back to the notch. */
const UP = { full: 1.05, putt: 1.3 };
const DOWN = { full: 0.55, putt: 0.7 };
/** The notch's half-width (meter units) for an accuracy of 1. */
const WINDOW = 0.13;

export function swingKit(st: GolfState): ClientKit {
  let phase: Phase = 'idle';
  let m = 0;
  /** When this part of the swing began (performance.now, ms), and the meter then: the meter runs on the clock, not the frames. */
  let since = 0;
  let from = 0;
  let power = 0;
  let spin = 0;
  let curve = 0;
  let addr: AddressMsg | null = null;
  let scale = 8;
  let ring: { x: number; y: number; z: number } | null = null;
  let ringKey = '';
  let book = new Map<string, number[]>();
  let bookKey = '';
  let look = 0;
  let quality: string | null = null;
  const cam = { p: { x: 0, y: 0, z: 0 }, t: { x: 0, y: 0, z: 0 }, snap: true };
  let watching: string | null = null;
  let watchFrom = { x: 0, y: 0, z: 0 };
  let watchT = 0;
  /** The way the ball was last going (it keeps the chase camera behind it once it stops). */
  let heading = { x: 0, z: -1 };
  let sentAt = 0;
  let released = true;
  /** How this swing is taken: the mouse, or the three-click meter. */
  let mode: 'mouse' | 'meter' = 'mouse';
  /** The mouse's stroke: where it's got to (backswing down, across right, in fulls), its deepest point, the view held still meanwhile. */
  const sw = { x: 0, y: 0, peak: 0, peakX: 0, peakAt: 0, yaw: 0, pitch: 0, trail: [] as [number, number][] };
  let wasDown = false;
  /** The last mouse swing came down too slowly (its strike says so). */
  let tooSlow = false;
  let pathCanvas: HTMLCanvasElement;
  let el: HTMLElement;
  let unstyle: (() => void) | null = null;
  const q = (s: string) => el.querySelector(s) as HTMLElement;

  const clubNow = (client: Client): Club => clubOf(client.me.hand.item) ?? CLUBS[0];

  /** The meter at a moment: climbing since the backswing began, or falling since the power was set. */
  const meter = (club: Club, now: number) => {
    const t = (now - since) / 1000;
    if (phase === 'back') return Math.min(HIGH, t / (club.putter ? UP.putt : UP.full));
    return from - t / (club.putter ? DOWN.putt : DOWN.full);
  };

  /** Carry (yards) at each quarter of the meter for a club from this lie, on flat ground, still air. */
  const carries = (club: Club, lie: Surf): number[] => {
    const key = `${club.id}:${lie}:${spin}:${curve}`;
    if (key === bookKey) return book.get(key)!;
    const flat = {
      ground: () => ({ y: 0, surf: Surf.Fairway }),
      slope: (_x: number, _z: number, out = { x: 0, z: 0 }) => ((out.x = 0), (out.z = 0), out),
      blockTop: () => 0,
      treesNear: () => [],
      inBounds: () => true,
    };
    const out = [0.25, 0.5, 0.75, 1].map((power) => {
      const s = strike(club, { club: club.id, power, accuracy: 0, spin, curve, yaw: 0 }, lie, () => 0.5, puttSpeed);
      const r = simulate(flat, { x: 0, y: 0, z: 0, speed: s.speed, yaw: 0, angle: s.angle, spin: s.spin, tilt: s.tilt, wind: { x: 0, z: 0 }, pin: { x: 1e6, y: 0, z: 1e6 }, seed: 1 }, { flightOnly: true });
      return Math.round(yards(r.carry));
    });
    book = new Map([[key, out]]);
    bookKey = key;
    return out;
  };

  /** Where a full swing lands, on the course, in the wind (the ring). */
  const landing = (client: Client, club: Club) => {
    if (!addr || club.putter) return null;
    const yaw = client.me.look.yaw;
    const key = `${club.id}:${spin}:${curve}:${Math.round(yaw * 400)}`;
    if (key === ringKey) return ring;
    ringKey = key;
    const s = strike(club, { club: club.id, power: 1, accuracy: 0, spin, curve, yaw }, addr.lie, () => 0.5, puttSpeed);
    const pin = course.pin(addr.hole);
    const r = simulate(course, { x: addr.ball.x, y: addr.ball.y, z: addr.ball.z, speed: s.speed, yaw: yaw + s.face, angle: s.angle, spin: s.spin, tilt: s.tilt, wind: addr.wind, pin, seed: 1 }, { flightOnly: true });
    const p = r.path;
    const n = p.length / 3;
    ring = n ? { x: p[(n - 1) * 3], y: course.height(p[(n - 1) * 3], p[(n - 1) * 3 + 2]) + 0.1, z: p[(n - 1) * 3 + 2] } : null;
    return ring;
  };

  const puttScale = (dist: number) => {
    // The meter's length in feet: a round number a little past the putt.
    const ft = feet(dist) * 1.25;
    const pick = [8, 12, 16, 20, 25, 30, 40, 50, 60, 80, 100].find((f) => f >= ft) ?? 100;
    return pick * 0.3048 * S;
  };

  const strikeNow = (client: Client, accuracy: number) => {
    if (!addr) return;
    const club = clubNow(client);
    const s: Swing = { club: club.id, power, accuracy, spin, curve, yaw: mode === 'mouse' ? sw.yaw : client.me.look.yaw, scale };
    client.send(MSG.swing, s);
    client.audio.play(club.putter ? 'golf_putt' : club.wood ? 'golf_drive' : 'golf_iron', { volume: 0.9 });
    const a = Math.abs(accuracy) * lieEffect(addr.lie, club).shaky / club.forgive;
    const slow = mode === 'mouse' && tooSlow;
    quality = slow ? 'TOO SLOW' : a < 0.15 ? 'PURE' : a < 0.55 ? 'GOOD' : a < 1 ? (accuracy < 0 ? 'PULLED' : 'PUSHED') : a < 1.6 ? (accuracy < 0 ? 'HOOKED' : 'SLICED') : 'MISHIT';
    q('.gs-quality').textContent = quality;
    q('.gs-quality').className = `gs-quality on ${slow ? 'bad' : a < 0.15 ? 'pure' : a < 0.55 ? 'good' : 'bad'}`;
    phase = 'sent';
    sentAt = performance.now();
  };

  /** Back off: the club back to the ball, nothing struck. */
  const cancel = () => {
    phase = 'aim';
    m = 0;
    sw.trail = [];
  };

  /** The mouse's stroke comes back through the ball: its power from the backswing and the pace down, its line from the path. */
  const impact = (client: Client, club: Club, now: number) => {
    const down = Math.max(0.03, (now - sw.peakAt) / 1000);
    let slow = 0;
    if (club.putter) {
      // A putt is a smooth stroke: only a real dawdle loses length.
      const pace = clamp((0.55 + 0.6 * sw.peak) / down, 0.55, 1);
      power = clamp(sw.peak * pace, 0.01, HIGH);
    } else {
      // A committed downswing (a full one in about 0.28 s) keeps it all. Slower, the club arrives
      // with less speed (less distance, down to a third) and decelerating, the face left open
      // (blocked right: pushed, then sliced).
      const brisk = 0.12 + 0.16 * sw.peak;
      slow = clamp((down - brisk) / 0.6, 0, 1);
      power = clamp(sw.peak * (1 - 0.65 * slow), 0.01, HIGH);
    }
    // The path down: straight up is square; off to the right pushes and slices, left pulls and hooks.
    const across = sw.x - sw.peakX;
    let accuracy = Math.atan2(across, Math.max(0.08, sw.peak)) / PATH_WINDOW;
    accuracy += 1.1 * slow;
    // A snatch (a stroke too quick for its length) pulls it a touch.
    if (down < 0.05 + 0.05 * sw.peak) accuracy -= 0.25;
    if (power > 1) accuracy /= Math.max(0.45, 1 - (power - 1) * 5);
    tooSlow = slow > 0.2;
    strikeNow(client, clamp(accuracy, -2, 2));
  };

  const release = (client: Client) => {
    phase = 'idle';
    addr = null;
    watching = null;
    el.classList.remove('on', 'putting', 'back', 'down', 'watch');
    client.hud.marker('golf:ring', null);
    client.hud.marker('golf:pin', null);
    if (!released) client.camera.release(0.7);
    released = true;
  };

  return {
    name: 'golf.swing',
    setup(client) {
      unstyle = client.hud.style(CSS);
      el = document.createElement('div');
      el.className = 'gs';
      el.innerHTML = `
        <div class="gs-info">
          <div class="gs-club"><span class="gs-club-name"></span><span class="gs-club-carry"></span></div>
          <div class="gs-lie"></div>
          <div class="gs-read"></div>
        </div>
        <div class="gs-meter">
          <div class="gs-track"><div class="gs-over"></div><div class="gs-notch"></div><div class="gs-fill"></div><div class="gs-power"></div><div class="gs-mark"></div></div>
          <div class="gs-ticks"></div>
        </div>
        <canvas class="gs-path" width="96" height="190"></canvas>
        <div class="gs-help"></div>
        <div class="gs-strike"><div class="gs-ball"><div class="gs-dot"></div></div><div class="gs-strike-label"></div></div>
        <div class="gs-quality"></div>`;
      client.hud.layer('golf.swing', 'panels').append(el);
      pathCanvas = q('.gs-path') as unknown as HTMLCanvasElement;
      st.onAddress((a) => {
        addr = a;
        phase = 'aim';
        m = 0;
        power = 0;
        spin = 0;
        curve = 0;
        sw.trail = [];
        ringKey = '';
        watching = null;
        cam.snap = released;
        released = false;
        const pin = course.pin(a.hole);
        scale = puttScale(Math.hypot(pin.x - a.ball.x, pin.z - a.ball.z));
        el.classList.add('on');
        el.classList.remove('watch');
        q('.gs-quality').className = 'gs-quality';
      });
      st.onRelease(() => {
        // The ball's far off: the camera stays on it a moment, then it's theirs again.
        if (phase === 'watch' && watching) {
          setTimeout(() => {
            if (phase === 'watch' || phase === 'idle') release(client);
          }, 700);
          phase = 'idle';
          return;
        }
        release(client);
      });
      st.onShot((s) => {
        if (s.id !== client.me.id) return;
        watching = s.id;
        watchFrom = { ...cam.p };
        watchT = 0;
        const d = dirOf(client.me.look.yaw);
        heading = { x: d.x, z: d.z };
        phase = 'watch';
        el.classList.remove('back', 'down');
        el.classList.add('watch');
        client.hud.marker('golf:ring', null);
        client.hud.marker('golf:pin', null);
        const club = clubOf(s.club);
        q('.gs-quality').textContent = club?.putter ? `${quality ?? ''}` : `${quality ?? ''} · CARRY ${s.carry} · TOTAL ${s.total}`;
      });
    },

    controls(client, c, dt) {
      const held = c.button(0);
      if (phase !== 'aim' && phase !== 'back' && phase !== 'down') {
        wasDown = held;
        return;
      }
      const club = clubNow(client);
      const now = performance.now();
      const space = c.pressed('Space');
      c.consume(0);
      c.consume('Space');
      look = c.isDown('KeyQ') ? Math.min(1, look + dt * 3) : Math.max(0, look - dt * 3);

      // The mouse's swing: what it moved this frame, the view put back where it was.
      if (mode === 'mouse' && (phase === 'back' || phase === 'down')) {
        const dPitch = sw.pitch - c.pitch;
        const dYaw = sw.yaw - c.yaw;
        c.turn(dPitch, dYaw);
        const full = client.input.device === 'touch' ? FULL_TOUCH : FULL;
        sw.y += dPitch / full;
        sw.x += dYaw / full;
        sw.trail.push([sw.x, sw.y]);
        if (phase === 'back') {
          if (sw.y > sw.peak) {
            sw.peak = Math.min(sw.y, HIGH);
            sw.peakX = sw.x;
            sw.peakAt = now;
          }
          sw.y = Math.min(sw.y, HIGH);
          if (!held) cancel();
          else if (sw.peak > 0.04 && sw.y < sw.peak - 0.04) phase = 'down';
        } else if (sw.y <= 0) impact(client, club, now);
        else if (!held || now - sw.peakAt > 2500) cancel();
        m = clamp(sw.y, LOW, HIGH);
        wasDown = held;
        return;
      }

      if (phase === 'aim') {
        // Aim: the mouse turns the view; A / D too, finely with Shift.
        const fine = c.isDown('ShiftLeft') || c.isDown('ShiftRight');
        const turn = (c.isDown('KeyA') ? 1 : 0) - (c.isDown('KeyD') ? 1 : 0);
        if (turn) c.turn(0, turn * (fine ? 0.06 : 0.55) * dt);
        // The strike point.
        const step = 0.25;
        if (c.pressed('ArrowUp')) spin = clamp(spin + step, -1, 1);
        if (c.pressed('ArrowDown')) spin = clamp(spin - step, -1, 1);
        if (c.pressed('ArrowLeft')) curve = clamp(curve - step, -1, 1);
        if (c.pressed('ArrowRight')) curve = clamp(curve + step, -1, 1);
        if (c.pressed('KeyR')) spin = curve = 0;
        if (club.putter) curve = 0;
        if (held && !wasDown) {
          // The mouse takes the club back from here.
          mode = 'mouse';
          phase = 'back';
          Object.assign(sw, { x: 0, y: 0, peak: 0, peakX: 0, peakAt: now, yaw: c.yaw, pitch: c.pitch, trail: [[0, 0]] });
          m = 0;
        } else if (space) {
          mode = 'meter';
          phase = 'back';
          m = 0;
          since = now;
          client.audio.play('golf_tick', { volume: 0.5 });
        }
      } else if (mode === 'meter' && space) {
        if (phase === 'back') {
          m = meter(club, now);
          power = clamp(m, 0.01, HIGH);
          phase = 'down';
          since = now;
          from = power;
        } else {
          m = meter(club, now);
          const window = WINDOW * (power > 1 ? 1 - (power - 1) * 5 : 1);
          strikeNow(client, clamp(-m / window, -2, 2));
        }
      }
      wasDown = held;
    },

    frame(client, dt) {
      const club = clubNow(client);
      // The meter moves.
      const putt = !!club.putter;
      const now = performance.now();
      if (mode === 'meter' && phase === 'back') {
        m = meter(club, now);
        if (m >= HIGH) {
          m = power = from = HIGH;
          phase = 'down';
          since = now;
        }
      } else if (mode === 'meter' && phase === 'down') {
        m = meter(club, now);
        if (m <= LOW) strikeNow(client, 2);
      }
      // A swing the server didn't take (it can't happen, but): back to the ball.
      if (phase === 'sent' && now - sentAt > 4000) {
        phase = 'aim';
        q('.gs-quality').className = 'gs-quality';
      }

      // The camera.
      if (phase === 'aim' || phase === 'back' || phase === 'down' || phase === 'sent') {
        if (!addr) return;
        const b = restAt(addr.ball);
        const yaw = client.me.look.yaw;
        const d = dirOf(yaw);
        const pitch = client.me.look.pitch;
        // Behind the ball, looking down the line: the ball two thirds of the way down the view.
        const back = putt ? 2.2 : 3.2;
        const up = putt ? 1 : 1.35;
        let p = { x: b.x - d.x * back, y: b.y + up, z: b.z - d.z * back };
        const ahead = putt ? 6 : 14;
        let t = { x: b.x + d.x * ahead, y: b.y + (putt ? -1.26 : -2.9) + Math.tan(clamp(pitch + 0.25, -0.6, 0.9)) * ahead, z: b.z + d.z * ahead };
        // Q: a look at where it's going (the ring, or the hole).
        const pin = course.pin(addr.hole);
        const aimAt = putt ? { x: pin.x, y: pin.y, z: pin.z } : landing(client, club);
        if (look > 0 && aimAt) {
          const lp = { x: aimAt.x - d.x * (putt ? 4 : 12), y: aimAt.y + (putt ? 3 : 9), z: aimAt.z - d.z * (putt ? 4 : 12) };
          const k = look * look * (3 - 2 * look);
          p = mix(p, lp, k);
          t = mix(t, aimAt, k);
        }
        p.y = Math.max(p.y, course.height(p.x, p.z) + 0.4);
        place(client, p, t, dt, 60);
        drawAddress(client, club, dt);
        return;
      }
      if (phase === 'watch' || (phase === 'idle' && watching)) {
        const f = watching ? st.flights.get(watching) : undefined;
        if (!f) return;
        watchT += dt;
        const pos = flightAt(f, Math.min(f.t, f.length));
        const putting = f.msg.club === 'putter';
        const h = Math.hypot(pos.dx, pos.dz);
        if (h > 0.02) heading = { x: pos.dx / h, z: pos.dz / h };
        const hx = heading.x;
        const hz = heading.z;
        let p: { x: number; y: number; z: number };
        if (putting) p = { x: watchFrom.x, y: watchFrom.y + 0.3, z: watchFrom.z };
        else {
          // Chasing it: behind and above, drawing back as it rises.
          const moving = Math.hypot(pos.dx, pos.dy, pos.dz) > 0.05;
          const behind = moving ? 7 + Math.max(0, pos.y - (addr?.ball.y ?? pos.y)) * 0.25 : 6;
          p = { x: pos.x - hx * behind, y: pos.y + 2.6, z: pos.z - hz * behind };
          if (watchT < 0.35) p = mix(watchFrom, p, watchT / 0.35);
        }
        p.y = Math.max(p.y, course.height(p.x, p.z) + 0.6);
        place(client, p, { x: pos.x, y: pos.y, z: pos.z }, dt, 60);
      }
    },

    dispose() {
      unstyle?.();
    },
  };

  function place(client: Client, p: { x: number; y: number; z: number }, t: { x: number; y: number; z: number }, dt: number, fov: number) {
    const k = cam.snap ? 1 : 1 - Math.exp(-dt * 7);
    cam.snap = false;
    cam.p = mix(cam.p, p, k);
    cam.t = mix(cam.t, t, Math.min(1, k * 1.4));
    client.camera.take({ position: cam.p, target: cam.t, fov });
  }

  function drawAddress(client: Client, club: Club, dt: number) {
    if (!addr) return;
    void dt;
    const putt = !!club.putter;
    const pin = course.pin(addr.hole);
    const dist = Math.hypot(pin.x - addr.ball.x, pin.z - addr.ball.z);
    el.classList.toggle('putting', putt);
    el.classList.toggle('back', phase === 'back');
    el.classList.toggle('down', phase === 'down');
    // The club and what it does from here.
    const effect = lieEffect(addr.lie, club);
    q('.gs-club-name').textContent = club.name;
    const ticks = q('.gs-ticks');
    if (putt) {
      q('.gs-club-carry').textContent = `meter ${Math.round(feet(scale))} ft`;
      const ft = Math.round(feet(scale));
      ticks.innerHTML = [0.25, 0.5, 0.75, 1].map((f) => `<span style="left:${at(f) * 100}%">${Math.round(ft * f)} ft</span>`).join('');
    } else {
      const c = carries(club, addr.lie);
      q('.gs-club-carry').textContent = `${c[3]} yds carry`;
      ticks.innerHTML = [0.25, 0.5, 0.75, 1].map((f, i) => `<span style="left:${at(f) * 100}%">${c[i]}</span>`).join('');
    }
    const lie = SURF_NAMES[addr.lie];
    const lost = Math.round((1 - effect.speed * (club.wood ? effect.woods : 1)) * 100);
    q('.gs-lie').textContent = `${lie.replace(/^./, (s) => s.toUpperCase())}${!putt && lost > 2 ? ` · about ${lost}% shorter` : ''} · wind ${mph(addr.wind)} mph ${arrow(yawOf(addr.wind.x, addr.wind.z) - client.me.look.yaw, mph(addr.wind))}`;
    // Reading it: how far, up or down, which way it breaks.
    q('.gs-read').textContent = putt ? readPutt(addr, dist) : `${Math.round(yards(dist))} yds to the pin · ${elev(pin.y - addr.ball.y)}`;
    // The meter (the notch only for the clicks).
    const notch = mode === 'meter' ? WINDOW * (power > 1 ? 1 - (power - 1) * 5 : 1) : 0.012;
    q('.gs-notch').style.left = `${at(-notch) * 100}%`;
    q('.gs-notch').style.width = `${(at(notch) - at(-notch)) * 100}%`;
    q('.gs-over').style.left = `${at(1) * 100}%`;
    q('.gs-mark').style.left = `${at(phase === 'aim' ? 0 : m) * 100}%`;
    const shown = phase === 'back' ? m : phase === 'down' ? (mode === 'mouse' ? sw.peak : power) : phase === 'sent' ? power : 0;
    q('.gs-fill').style.width = `${Math.max(0, at(shown) - at(0)) * 100}%`;
    q('.gs-fill').style.left = `${at(0) * 100}%`;
    q('.gs-power').style.left = `${at(mode === 'mouse' && phase === 'down' ? sw.peak : power) * 100}%`;
    q('.gs-power').style.display = phase === 'down' || phase === 'sent' ? 'block' : 'none';
    q('.gs-help').textContent =
      phase === 'aim'
        ? client.input.device === 'touch'
          ? 'HOLD SWING, PULL DOWN, FLICK UP THROUGH THE BALL · DRAG OR THE STICK TO AIM · TAP A CLUB'
          : 'HOLD CLICK, PULL BACK, SWING UP THROUGH THE BALL · MOUSE / A D AIM · WHEEL CLUB · ARROWS STRIKE POINT · Q LOOK · E STEP AWAY'
        : mode === 'mouse'
          ? phase === 'back'
            ? 'PULL BACK FOR POWER · THEN SWING UP, STRAIGHT'
            : phase === 'down'
              ? 'THROUGH THE BALL…'
              : ''
          : phase === 'back'
            ? 'SPACE TO SET THE POWER'
            : phase === 'down'
              ? 'SPACE IN THE NOTCH'
              : '';
    drawPath(putt);
    // The strike point.
    const dot = q('.gs-dot');
    dot.style.left = `${50 + curve * 34}%`;
    dot.style.top = `${50 - spin * 34}%`;
    q('.gs-strike-label').textContent = putt ? (spin > 0 ? 'Rolling' : spin < 0 ? 'Skidding' : 'Centred') : strikeLabel(spin, curve);
    // Where it's going: the ring (a full swing), and the pin.
    const r = landing(client, club);
    if (r && !putt) client.hud.marker('golf:ring', r, { shape: 'ring', color: '#ffffff', size: { world: 3.2, min: 10, max: 120 }, label: `${Math.round(yards(Math.hypot(r.x - addr.ball.x, r.z - addr.ball.z)))}` });
    else client.hud.marker('golf:ring', null);
    client.hud.marker('golf:pin', { x: pin.x, y: pin.y + 3.2, z: pin.z }, { shape: 'diamond', color: '#ff5a4a', size: 11, edge: true, label: putt ? `${Math.round(feet(dist))} ft` : `${Math.round(yards(dist))} yds` });
  }

  /**
   * The stroke as the mouse has made it: a straight line down the middle to follow, the start (where
   * the ball is struck) and full across it, the backswing's path in gold and the downswing's in white.
   */
  function drawPath(putt: boolean) {
    const g = pathCanvas.getContext('2d');
    if (!g) return;
    const W = pathCanvas.width;
    const H = pathCanvas.height;
    const top = 22;
    const unit = (H - top - 18) / HIGH;
    const px = (x: number) => W / 2 + x * unit * 0.9;
    const py = (y: number) => top + y * unit;
    g.clearRect(0, 0, W, H);
    g.fillStyle = '#0d1a10aa';
    g.fillRect(0, 0, W, H);
    // The overswing past full.
    g.fillStyle = '#ff5a4a33';
    g.fillRect(0, py(1), W, py(HIGH) - py(1));
    g.strokeStyle = '#f3f7ef44';
    g.setLineDash([4, 4]);
    g.beginPath();
    g.moveTo(W / 2, 4);
    g.lineTo(W / 2, H - 4);
    g.stroke();
    g.setLineDash([]);
    g.strokeStyle = '#9be26b';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(8, py(0));
    g.lineTo(W - 8, py(0));
    g.stroke();
    g.strokeStyle = '#f3f7ef66';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(14, py(1));
    g.lineTo(W - 14, py(1));
    g.stroke();
    g.fillStyle = '#f3f7efaa';
    g.font = '600 10px sans-serif';
    g.fillText(putt ? 'STROKE' : 'BALL', 6, py(0) - 5);
    g.fillText('FULL', 6, py(1) - 4);
    if (mode !== 'mouse' || sw.trail.length < 2) return;
    // Its path: gold back, white through.
    const turn = sw.trail.findIndex(([, y]) => y >= sw.peak - 1e-9);
    g.lineWidth = 3;
    g.lineCap = 'round';
    for (const [from, to, colour] of [
      [0, turn, '#ffd84d'],
      [turn, sw.trail.length - 1, '#ffffff'],
    ] as const) {
      if (to <= from) continue;
      g.strokeStyle = colour;
      g.beginPath();
      g.moveTo(px(sw.trail[from][0]), py(sw.trail[from][1]));
      for (let i = from + 1; i <= to; i++) g.lineTo(px(sw.trail[i][0]), py(sw.trail[i][1]));
      g.stroke();
    }
    const [lx, ly] = sw.trail[sw.trail.length - 1];
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.arc(px(lx), py(Math.max(LOW, ly)), 4, 0, Math.PI * 2);
    g.fill();
  }
}

function mix(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }, k: number) {
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k };
}

function strikeLabel(spin: number, curve: number): string {
  const parts: string[] = [];
  if (spin < 0) parts.push(spin <= -0.75 ? 'Big backspin' : 'Backspin');
  if (spin > 0) parts.push(spin >= 0.75 ? 'Low runner' : 'Topspin');
  if (curve < 0) parts.push(curve <= -0.75 ? 'Big draw' : 'Draw');
  if (curve > 0) parts.push(curve >= 0.75 ? 'Big fade' : 'Fade');
  return parts.join(' · ') || 'Centred';
}

function elev(dy: number): string {
  const ft = Math.round(dy / S / 0.3048);
  return Math.abs(ft) < 2 ? 'level' : ft > 0 ? `${ft} ft uphill` : `${-ft} ft downhill`;
}

/** An arrow for the wind, turned from where you look (up: behind you, helping). */
function arrow(rel: number, speed: number): string {
  if (speed < 1) return '';
  const a = ((rel % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2) - Math.PI;
  const arrows = ['↑', '↖', '←', '↙', '↓', '↘', '→', '↗'];
  return arrows[(Math.round(a / (Math.PI / 4)) + 8) % 8];
}

/** A putt read: its length, the rise or fall, and which way and how much it breaks along the line. */
function readPutt(a: AddressMsg, dist: number): string {
  const pin = course.pin(a.hole);
  const dx = (pin.x - a.ball.x) / (dist || 1);
  const dz = (pin.z - a.ball.z) / (dist || 1);
  let side = 0;
  let n = 0;
  for (let t = 0.1; t < 0.95; t += 0.1) {
    const s = course.slope(a.ball.x + (pin.x - a.ball.x) * t, a.ball.z + (pin.z - a.ball.z) * t);
    // Across the line (right positive): the right of (dx, dz) is (-dz, dx).
    side += s.x * -dz + s.z * dx;
    n++;
  }
  side /= n;
  const rise = pin.y - a.ball.y;
  const pct = Math.abs(side * 100);
  const breaks = pct < 0.4 ? 'straight' : `breaks ${side > 0 ? 'left' : 'right'} (${pct.toFixed(1)}%)`;
  const ft = rise / S / 0.3048;
  const slope = Math.abs(ft) < 0.25 ? 'flat' : ft > 0 ? `${(ft * 12).toFixed(0)} in uphill` : `${(-ft * 12).toFixed(0)} in downhill`;
  return `${Math.round(feet(dist))} ft · ${slope} · ${breaks}`;
}

const CSS = `
.gs { position: absolute; inset: 0; display: none; font-family: var(--sans); color: #f3f7ef; pointer-events: none; }
.gs.on { display: block; }
.gs.watch .gs-meter, .gs.watch .gs-info, .gs.watch .gs-strike { display: none; }
.gs-info { position: absolute; left: 18px; bottom: 84px; display: flex; flex-direction: column; gap: 3px; padding: 10px 14px; border-radius: 6px; background: linear-gradient(160deg, #0d1a10dd, #173022cc); border: 1px solid #9be26b33; box-shadow: 0 4px 18px #0007; max-width: 300px; }
.gs-club { display: flex; align-items: baseline; gap: 10px; }
.gs-club-name { font: 700 26px/1 var(--pixel); letter-spacing: 0.08em; text-transform: uppercase; }
.gs-club-carry { font: 600 14px/1 var(--sans); opacity: 0.85; }
.gs-lie, .gs-read { font: 600 13px/1.35 var(--sans); opacity: 0.92; }
.gs-read { color: #d8f5c6; }
.gs-meter { position: absolute; left: 50%; bottom: 84px; transform: translateX(-50%); width: min(620px, 56vw); }
.gs-track { position: relative; height: 20px; border-radius: 4px; background: linear-gradient(#0d1a10cc, #173022cc); border: 2px solid #f3f7ef55; overflow: hidden; box-shadow: 0 2px 10px #0008; }
.gs-over { position: absolute; top: 0; bottom: 0; right: 0; background: repeating-linear-gradient(135deg, #ff5a4a55 0 6px, #ff5a4a22 6px 12px); }
.gs-notch { position: absolute; top: 0; bottom: 0; background: #9be26b; box-shadow: 0 0 10px #9be26b; }
.gs-fill { position: absolute; top: 4px; bottom: 4px; background: linear-gradient(90deg, #f3f7ef33, #ffd84dcc); border-radius: 2px; }
.gs-power { position: absolute; top: 0; bottom: 0; width: 3px; margin-left: -1px; background: #ffd84d; box-shadow: 0 0 8px #ffd84d; }
.gs-mark { position: absolute; top: -2px; bottom: -2px; width: 4px; margin-left: -2px; background: #fff; box-shadow: 0 0 6px #fff; }
.gs-ticks { position: relative; height: 15px; font: 600 12px/15px var(--sans); color: #f3f7efcc; text-shadow: 0 1px 2px #000c; }
.gs-ticks span { position: absolute; transform: translateX(-50%); }
.gs-help { position: absolute; bottom: 128px; left: 50%; transform: translateX(-50%); font: 600 11px/1 var(--pixel); letter-spacing: 0.14em; opacity: 0.8; text-align: center; white-space: nowrap; text-shadow: 0 1px 2px #000c; }
.gs-path { position: absolute; left: calc(50% + min(310px, 28vw) + 14px); bottom: 70px; width: 96px; height: 190px; border-radius: 6px; box-shadow: 0 4px 18px #0007; }
.gs.watch .gs-path { display: none; }
.gs-strike { position: absolute; right: 22px; bottom: 84px; display: flex; flex-direction: column; align-items: center; gap: 5px; padding: 10px; border-radius: 6px; background: #0d1a10aa; }
.gs-ball { width: 54px; height: 54px; border-radius: 50%; background: radial-gradient(circle at 35% 30%, #fff, #d9dde2 70%, #aab0b8); position: relative; box-shadow: 0 2px 8px #0009; }
.gs-dot { position: absolute; width: 10px; height: 10px; margin: -5px 0 0 -5px; border-radius: 50%; background: #e8322b; box-shadow: 0 0 0 2px #fff8; }
.gs-strike-label { font: 600 11px/1.2 var(--sans); text-align: center; max-width: 110px; text-shadow: 0 1px 2px #000a; }
body.touch-mode :is(.gs-info, .gs-meter, .gs-help, .gs-path, .gs-strike, .gs-quality) { zoom: var(--hud-zoom, 1); }
body.touch-playing .gs-strike { bottom: auto; top: calc((env(safe-area-inset-top, 0px) + 60px * var(--touch-zoom, 1)) / var(--hud-zoom, 1)); right: calc((env(safe-area-inset-right, 0px) + 12px * var(--touch-zoom, 1)) / var(--hud-zoom, 1)); }
body.touch-playing .gs-path { left: auto; bottom: auto; top: calc((env(safe-area-inset-top, 0px) + 60px * var(--touch-zoom, 1)) / var(--hud-zoom, 1)); right: calc((env(safe-area-inset-right, 0px) + 92px * var(--touch-zoom, 1)) / var(--hud-zoom, 1)); }
body.touch-playing .gs-info { left: calc((env(safe-area-inset-left, 0px) + 12px * var(--touch-zoom, 1)) / var(--hud-zoom, 1)); bottom: calc(150px / var(--hud-zoom, 1)); }
.gs-quality { position: absolute; left: 50%; top: 22%; transform: translateX(-50%); font: 700 28px/1 var(--pixel); letter-spacing: 0.12em; opacity: 0; transition: opacity 0.3s; text-shadow: 0 2px 6px #000c; white-space: nowrap; }
.gs-quality.on { opacity: 1; }
.gs-quality.pure { color: #ffd84d; }
.gs-quality.good { color: #9be26b; }
.gs-quality.bad { color: #ff8a6a; }
`;
