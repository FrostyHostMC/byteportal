import type { Client, ClientKit, Figure, Node } from '@platform/client';
import { Quat, Vec3 } from '@platform/client/math';
import { BALL_RADIUS, FLOOR, rim, type Side } from '../court';
import type { JamView } from './state';

/**
 * What's in the arena on this screen besides the blocks and the ballers: the court's markings, the
 * two baskets and their nets (a net swishes when the ball drops through, a rim shakes when it's
 * dunked on), and the ball: dribbled in time with the hand, up in the hands for a shot or a dunk,
 * or in flight as the server launched it (played out here, so it's smooth). Anyone on fire burns,
 * and so does the ball they touch. Every bounce, clank and swish is heard here too.
 */

const v1 = new Vec3();
const v2 = new Vec3();
const q1 = new Quat();
const UP = new Vec3(0, 1, 0);

interface Basket {
  side: Side;
  hoop: Node;
  net: Node;
  /** The net's swish (1 as the ball drops through, dying away) and the rim's shake. */
  swish: number;
  shake: number;
}

export function sceneKit(view: JamView): ClientKit {
  let court: Node | null = null;
  const baskets: Basket[] = [];
  let ball: Node | null = null;
  /** Its shadow on the floor (bigger and fainter the higher it is). */
  let shadow: Node | null = null;
  /** The ball as last drawn (for its spin), and the dribble's last bounce (for its sound). */
  const last = new Vec3();
  let lastBounce = 0;
  let flameAt = 0;

  const place = (client: Client, id: string, at: { x: number; y: number; z: number }, scale = 1): Node | null => {
    const made = client.scene.item(id);
    if (!made) return null;
    const holder = client.scene.node();
    // (The item's mesh comes centred on its middle: put its own origin back where it was.)
    made.node.position.set(0, 0, 0);
    holder.add(made.node);
    holder.position.set(at.x, at.y, at.z);
    holder.scale.setScalar(scale);
    client.scene.add(holder);
    return holder;
  };

  /** A baller's figure, by player id. */
  const figureOf = (client: Client, id: string | null): Figure | null => {
    if (!id) return null;
    for (const f of client.figures.all) if (f.player === id) return f;
    return null;
  };

  const handPos = (fig: Figure, side: 'L' | 'R', out: Vec3): Vec3 | null => {
    const j = fig.rig?.joints[side === 'L' ? 'handL' : 'handR'];
    if (!j) return null;
    j.updateMatrixWorld(true);
    const m = j.matrixWorld.elements;
    return out.set(m[12], m[13], m[14]);
  };

  let scene: Client['scene'] | null = null;
  return {
    name: 'jam.scene',
    dispose() {
      // What this kit put in the world goes with it (a game switched away from, then back to).
      for (const n of [court, ball, shadow, ...baskets.flatMap((b) => [b.hoop, b.net])]) if (n) scene?.remove(n);
    },
    frame(client, dt) {
      scene = client.scene;
      // The court and the baskets, once their models are here.
      if (!court) court = place(client, 'jam_court', { x: 0, y: FLOOR + 0.012, z: 0 });
      // (A basket goes up whole, once both its models are here: a hoop placed alone, its net still
      // coming, would be placed again next frame.)
      if (baskets.length < 2 && client.scene.item('jam_hoop') && client.scene.item('jam_net')) {
        for (const side of [1, -1] as Side[]) {
          if (baskets.some((b) => b.side === side)) continue;
          const r = rim(side);
          const hoop = place(client, 'jam_hoop', r);
          const net = place(client, 'jam_net', r);
          if (!hoop || !net) {
            for (const n of [hoop, net]) if (n) client.scene.remove(n);
            continue;
          }
          if (side < 0) {
            hoop.quaternion.setFromAxisAngle(UP, Math.PI);
            net.quaternion.setFromAxisAngle(UP, Math.PI);
          }
          baskets.push({ side, hoop, net, swish: 0, shake: 0 });
        }
      }
      if (!ball) ball = place(client, 'jam_ball', { x: 0, y: FLOOR + 1, z: 0 }, BALL_RADIUS * 2);
      if (!shadow) shadow = place(client, 'jam_shadow', { x: 0, y: FLOOR + 0.02, z: 0 }, BALL_RADIUS * 2);

      // What the ball did this frame.
      for (const e of view.events) {
        const at = { x: e.x, y: e.y, z: e.z };
        const loud = Math.min(1, 0.25 + e.speed / 9);
        if (e.kind === 'rim') {
          client.audio.play('jam_rim', { at, volume: loud });
          const b = baskets.find((x) => x.side === e.side);
          if (b) b.shake = Math.max(b.shake, Math.min(1, e.speed / 6));
        } else if (e.kind === 'board') client.audio.play('jam_board', { at, volume: loud });
        else if (e.kind === 'floor') client.audio.play('jam_bounce', { at, volume: loud });
        else if (e.kind === 'wall') client.audio.play('jam_bounce', { at, volume: loud * 0.6, pitch: 0.7 });
        else if (e.kind === 'net') {
          client.audio.play('jam_swish', { at });
          const b = baskets.find((x) => x.side === e.side);
          if (b) b.swish = 1;
        }
      }
      for (const mo of view.moments) {
        if (mo.k === 'slam') {
          const b = baskets.find((x) => x.side === mo.side);
          if (b) {
            b.shake = 1.6;
            b.swish = 1.3;
          }
          const r = rim(mo.side as Side);
          client.fx.shake(0.55, 0.35);
          client.fx.burst({ x: r.x, y: r.y, z: r.z }, { color: '#ffb02e', count: 26, speed: 4, gravity: 9, glow: 1, life: 0.7 });
          client.audio.play('jam_slam', { at: r });
        } else if (mo.k === 'score' && mo.fire) {
          // The net goes up in flames.
          const r = rim(mo.side as Side);
          client.fx.burst({ x: r.x, y: r.y - 0.25, z: r.z }, { color: '#ff6b1a', count: 40, speed: 2.5, gravity: -3, glow: 1, life: 1.1 });
          client.audio.play('jam_flame', { at: r });
        } else if (mo.k === 'block') {
          const [x, y, z] = mo.at;
          client.fx.burst({ x, y, z }, { color: '#ffffff', count: 18, speed: 3.5, gravity: 6, glow: 0.8, life: 0.5 });
          client.audio.play('jam_block', { at: { x, y, z } });
        }
      }

      // The nets swish and the rims shake.
      for (const b of baskets) {
        b.swish = Math.max(0, b.swish - dt * 2.2);
        b.shake = Math.max(0, b.shake - dt * 3);
        const s = b.swish;
        const wob = Math.sin(client.time * 38) * s;
        b.net.scale.set(1 - 0.12 * s, 1 + 0.35 * s + 0.08 * wob, 1 - 0.12 * s);
        const tip = Math.sin(client.time * 46) * b.shake * 0.05;
        q1.setFromAxisAngle(v1.set(0, 0, 1), tip * b.side);
        b.hoop.quaternion.setFromAxisAngle(UP, b.side < 0 ? Math.PI : 0).multiply(q1);
        b.net.position.y = rim(b.side).y - 0.02 - Math.abs(tip) * 2;
      }

      // The ball.
      if (!ball) return;
      const fig = figureOf(client, view.holder);
      const now = new Vec3();
      let held = false;
      if (view.holder && fig) {
        const b = view.ballers.get(view.holder);
        const air = b?.air ?? 0;
        const r = handPos(fig, 'R', v1);
        const l = handPos(fig, 'L', v2);
        if (air === 1 || air === 3 || air === 4 || air === 2) {
          // Up in the hands: between them (a jump shot, a two-handed dunk), or in the right one.
          const one = air === 3 && b && (b.style === 0 || b.style === 3);
          if (r && l && !one) now.copy(r).add(l).multiplyScalar(0.5);
          else if (r) now.copy(r);
          else now.copy(fig.root.position).add(v1.set(0, 2.3, 0));
          now.y += 0.08;
          held = true;
        } else {
          // The dribble: down to the floor beside them and back up to the hand.
          const p = view.dribble.get(view.holder) ?? 0;
          const h = Math.abs(Math.cos(p / 2));
          const root = fig.root.position;
          v1.set(0.38, 0, 0.42).applyQuaternion(fig.root.quaternion);
          const top = r ? Math.max(FLOOR + 0.6, r.y - 0.14) : FLOOR + 1.0;
          now.set(root.x + v1.x, FLOOR + BALL_RADIUS + (top - FLOOR - BALL_RADIUS) * h, root.z + v1.z);
          if (r && h > 0.85) now.lerp(v2.copy(r).add(v1.set(0, -0.14, 0)), (h - 0.85) / 0.15 * 0.6);
          // A thump each time it hits the floor.
          const bounce = Math.floor((p + Math.PI) / (Math.PI * 2));
          if (bounce !== lastBounce) {
            lastBounce = bounce;
            client.audio.play('jam_dribble', { at: { x: now.x, y: FLOOR, z: now.z }, volume: 0.55 });
          }
          held = true;
        }
      } else {
        const f = view.ballInAir();
        if (f) now.set(f.x, f.y, f.z);
        else now.copy(last);
      }
      ball.visible = !!(view.holder || view.flight);
      // Spun by how far it's gone (rolling, flying).
      const dx = now.x - last.x;
      const dz = now.z - last.z;
      const d = Math.hypot(dx, dz);
      if (d > 1e-4 && d < 2) {
        q1.setFromAxisAngle(v1.set(dz / d, 0, -dx / d), d / BALL_RADIUS);
        ball.quaternion.premultiply(q1);
      }
      if (!held && view.flight && d < 1e-4) ball.quaternion.premultiply(q1.setFromAxisAngle(UP, dt * 2));
      ball.position.copy(now);
      last.copy(now);
      if (shadow) {
        const up = Math.max(0, now.y - FLOOR);
        shadow.visible = ball.visible;
        shadow.position.set(now.x, FLOOR + 0.025, now.z);
        shadow.scale.setScalar(BALL_RADIUS * 2 * (1 + up * 0.12));
      }

      // Fire: anyone on it burns at the feet, and the ball they've touched trails flames.
      flameAt += dt;
      if (flameAt > 1 / 30) {
        flameAt = 0;
        for (const [id, b] of view.ballers) {
          if (!b.fire) continue;
          const f = figureOf(client, id);
          if (!f) continue;
          const p = f.root.position;
          client.fx.particles({ x: p.x, y: p.y + 0.1, z: p.z }, [1, 0.22, 0.02], { count: 4, speed: 0.7, size: 0.22, gravity: -5, glow: 0.7, life: 0.5, spread: 0.35, up: 2 });
          client.fx.particles({ x: p.x, y: p.y + 0.3, z: p.z }, [1, 0.6, 0.05], { count: 2, speed: 0.5, size: 0.14, gravity: -6, glow: 0.9, life: 0.35, spread: 0.25, up: 2.4 });
        }
        const hot = view.holder ? view.ballers.get(view.holder)?.fire : view.flight && view.flightFire;
        if (hot && ball.visible) client.fx.particles({ x: now.x, y: now.y, z: now.z }, [1, 0.3, 0.03], { count: 4, speed: 0.4, size: 0.18, gravity: -3, glow: 0.8, life: 0.45, spread: 0.12, up: 0.8 });
      }
    },
  };
}
