import type { Client, ClientKit, Figure, Node } from '@platform/client';
import { Mat4, Quat, Vec3 } from '@platform/client/math';
import { BOARDS, GOAL_X, HALF_LENGTH, ICE, PUCK_HALF, type Side } from '../rink';
import type { IceView } from './state';

/**
 * What's in the arena on this screen besides the blocks and the skaters: the rink's markings, the
 * boards, the two goals and their nets (a net bulges when the puck hits the twine) and the goal
 * lights (lit for a goal); the puck (on a stick, wobbling as it's handled, in a goalie's glove, or
 * in flight as the server launched it, played out here); and each skater's gear: a stick from their
 * hands to the ice, a helmet in their team's colour, skates' blades, a goalie's mask, pads, glove
 * and blocker. Anyone on fire burns; a hockey stop throws snow; every bounce and ping is heard.
 */

const v1 = new Vec3();
const v2 = new Vec3();
const v3 = new Vec3();
const q1 = new Quat();
const m1 = new Mat4();
const UP = new Vec3(0, 1, 0);
/** The stick's length to its heel (`tools/models.mjs`). */
const STICK = 1.45;

interface Goal {
  side: Side;
  frame: Node;
  net: Node;
  light: Node;
  /** The twine's bulge (1 as the puck hits it, dying away) and the lamp (seconds left lit). */
  bulge: number;
  lit: number;
}

/** A figure's gear, hung on its joints (and its stick in the world). */
interface Gear {
  fig: Figure;
  head: Node | null;
  helmet: string;
  parts: Node[];
  stick: Node | null;
}

export function sceneKit(view: IceView, teams: () => [string, string]): ClientKit {
  let rink: Node | null = null;
  let boardsNode: Node | null = null;
  const goals: Goal[] = [];
  let puck: Node | null = null;
  const gear = new Map<string, Gear>();
  const last = new Vec3();
  let effectsAt = 0;
  let stridesAt = 0;
  let scene: Client['scene'] | null = null;

  const place = (client: Client, id: string, at: { x: number; y: number; z: number }): Node | null => {
    const made = client.scene.item(id);
    if (!made) return null;
    const holder = client.scene.node();
    made.node.position.set(0, 0, 0);
    holder.add(made.node);
    holder.position.set(at.x, at.y, at.z);
    client.scene.add(holder);
    return holder;
  };

  /** A piece of gear on a joint (its own origin at the joint), or null while its model's coming. */
  const hang = (client: Client, id: string, on: Node): Node | null => {
    const made = client.scene.item(id);
    if (!made) return null;
    const holder = client.scene.node();
    made.node.position.set(0, 0, 0);
    holder.add(made.node);
    on.add(holder);
    return holder;
  };

  const figureOf = (client: Client, id: string | null): Figure | null => {
    if (!id) return null;
    for (const f of client.figures.all) if (f.player === id) return f;
    return null;
  };

  const handPos = (fig: Figure, side: 'L' | 'R', out: Vec3): Vec3 | null => {
    const j = fig.rig?.joints[side === 'L' ? 'handL' : 'handR'];
    if (!j) return null;
    j.updateMatrixWorld(true);
    const e = j.matrixWorld.elements;
    return out.set(e[12], e[13], e[14]);
  };

  /** Ahead of a figure and to its right, on the ice. */
  const ahead = (fig: Figure) => {
    v3.set(0, 0, 1).applyQuaternion(fig.root.quaternion);
    const fx = v3.x;
    const fz = v3.z;
    const l = Math.hypot(fx, fz) || 1;
    return { fx: fx / l, fz: fz / l, rx: -fz / l, rz: fx / l };
  };

  /** Where a skater's blade is now (its heel on the ice, or up in a wind-up or a follow-through). */
  const heelOf = (fig: Figure, out: Vec3) => {
    const id = fig.player!;
    const s = view.skaters.get(id);
    const p = fig.root.position;
    const a = ahead(fig);
    if (s?.goalie) return out.set(p.x + a.fx * 0.75 + a.rx * 0.1, ICE + 0.02, p.z + a.fz * 0.75 + a.rz * 0.1);
    if (s && s.stun > 0) return out.set(p.x + a.rx * 1.2, ICE + 0.02, p.z + a.rz * 1.2);
    // Wound up: the blade back and up over the right shoulder; let go: swept through and up ahead.
    const w = s?.wind ?? 0;
    const t = s?.shot ?? 0;
    if (w > 0.02) {
      const k = Math.min(1, w * 1.4);
      return out.set(p.x + a.fx * (0.9 - 1.8 * k) + a.rx * (0.25 + 0.35 * k), ICE + 0.02 + 1.5 * k * k, p.z + a.fz * (0.9 - 1.8 * k) + a.rz * (0.25 + 0.35 * k));
    }
    if (t > 0 && t < 0.45) {
      const k = Math.sin((t / 0.45) * Math.PI);
      return out.set(p.x + a.fx * (0.95 + 0.4 * k) - a.rx * 0.3 * k, ICE + 0.02 + 0.9 * k, p.z + a.fz * (0.95 + 0.4 * k) - a.rz * 0.3 * k);
    }
    return out.set(p.x + a.fx * 0.95 + a.rx * 0.22, ICE + 0.02, p.z + a.fz * 0.95 + a.rz * 0.22);
  };

  /** Put a stick in the world: its heel at `heel`, its shaft up toward `top`, the blade ahead of the figure. */
  const lay = (node: Node, heel: Vec3, top: Vec3, fig: Figure) => {
    const y = v1.copy(top).sub(heel);
    if (y.lengthSq() < 1e-6) y.set(0, 1, 0);
    y.normalize();
    const a = ahead(fig);
    const z = v2.set(a.fx, 0, a.fz);
    z.addScaledVector(y, -z.dot(y));
    if (z.lengthSq() < 1e-6) z.set(1, 0, 0);
    z.normalize();
    const x = v3.copy(y).cross(z);
    m1.makeBasis(x, y, z);
    node.quaternion.setFromRotationMatrix(m1);
    node.position.copy(heel).addScaledVector(y, STICK);
  };

  /** A figure's gear: hung when its rig's here (again if it's been rebuilt, or its team's changed). */
  const dress = (client: Client, fig: Figure, id: string) => {
    const rig = fig.rig;
    if (!rig) return null;
    const s = view.skaters.get(id);
    if (!s) return null;
    const [home, away] = teams();
    const team = s.team === 0 ? home : away;
    const helmet = s.goalie ? 'ice_mask' : `ice_helmet_${team}`;
    let g = gear.get(id);
    if (g && (g.fig !== fig || g.head !== rig.joints.head || g.helmet !== helmet)) {
      for (const n of g.parts) n.parent?.remove(n);
      if (g.stick) client.scene.remove(g.stick);
      gear.delete(id);
      g = undefined;
    }
    if (g) return g;
    if (!team) return null;
    const parts: (Node | null)[] = [hang(client, helmet, rig.joints.head), hang(client, 'ice_blade', rig.joints.footL), hang(client, 'ice_blade', rig.joints.footR)];
    if (s.goalie) parts.push(hang(client, 'ice_pad', rig.joints.lowerLegL), hang(client, 'ice_pad', rig.joints.lowerLegR), hang(client, 'ice_glove', rig.joints.handL), hang(client, 'ice_blocker', rig.joints.handR));
    const stick = place(client, 'ice_stick', fig.root.position);
    if (parts.some((p) => !p) || !stick) {
      for (const p of parts) p?.parent?.remove(p);
      if (stick) client.scene.remove(stick);
      return null;
    }
    g = { fig, head: rig.joints.head, helmet, parts: parts as Node[], stick };
    gear.set(id, g);
    return g;
  };

  return {
    name: 'ice.scene',
    dispose() {
      for (const n of [rink, boardsNode, puck, ...goals.flatMap((g) => [g.frame, g.net, g.light])]) if (n) scene?.remove(n);
      for (const g of gear.values()) {
        for (const n of g.parts) n.parent?.remove(n);
        if (g.stick) scene?.remove(g.stick);
      }
    },
    frame(client, dt) {
      scene = client.scene;
      if (!rink) rink = place(client, 'ice_rink', { x: 0, y: ICE + 0.01, z: 0 });
      if (!boardsNode) boardsNode = place(client, 'ice_boards', { x: 0, y: ICE, z: 0 });
      // The goals, each whole once its frame, net and light are all here.
      if (goals.length < 2 && client.scene.item('ice_goal') && client.scene.item('ice_net') && client.scene.item('ice_light')) {
        for (const side of [1, -1] as Side[]) {
          if (goals.some((g) => g.side === side)) continue;
          const at = { x: side * GOAL_X, y: ICE, z: 0 };
          const frame = place(client, 'ice_goal', at);
          const net = place(client, 'ice_net', at);
          const light = place(client, 'ice_light', { x: side * (HALF_LENGTH - 0.08), y: ICE + BOARDS + 1.8, z: 0 });
          if (!frame || !net || !light) {
            for (const n of [frame, net, light]) if (n) client.scene.remove(n);
            continue;
          }
          if (side < 0) {
            frame.quaternion.setFromAxisAngle(UP, Math.PI);
            net.quaternion.setFromAxisAngle(UP, Math.PI);
          }
          light.scale.setScalar(2.2);
          light.visible = false;
          goals.push({ side, frame, net, light, bulge: 0, lit: 0 });
        }
      }
      if (!puck) puck = place(client, 'ice_puck', { x: 0, y: ICE + PUCK_HALF, z: 0 });

      // What the puck did this frame: the boards' thud, the glass, a post's ping, the twine.
      for (const e of view.events) {
        const at = { x: e.x, y: e.y, z: e.z };
        const loud = Math.min(1, 0.2 + e.speed / 14);
        if (e.kind === 'boards') client.audio.play('ice_boards', { at, volume: loud });
        else if (e.kind === 'glass') client.audio.play('ice_glass', { at, volume: loud });
        else if (e.kind === 'post' || e.kind === 'bar') {
          client.audio.play('ice_post', { at, volume: Math.min(1, 0.4 + e.speed / 10) });
          client.fx.burst(at, { color: '#ffffff', count: 8, speed: 2.5, gravity: 4, glow: 0.6, life: 0.3 });
        } else if (e.kind === 'net' || e.kind === 'goal') {
          client.audio.play('ice_twine', { at, volume: loud });
          const g = goals.find((x) => x.side === e.side);
          if (g) g.bulge = Math.max(g.bulge, Math.min(1.2, 0.4 + e.speed / 20));
        } else if (e.kind === 'ice') client.audio.play('ice_clack', { at, volume: loud * 0.7 });
      }
      for (const mo of view.moments) {
        if (mo.k === 'goal') {
          const g = goals.find((x) => x.side === mo.side);
          if (g) {
            g.lit = 4;
            g.bulge = 1.3;
            const at = g.light.position;
            client.fx.burst({ x: at.x, y: at.y + 0.6, z: at.z }, { color: '#ff3b30', count: 50, speed: 3.5, gravity: 2, glow: 1, life: 1.1 });
          }
          if (mo.fire) {
            const gx = (mo.side as Side) * GOAL_X;
            client.fx.burst({ x: gx + (mo.side as Side) * 0.5, y: ICE + 0.6, z: 0 }, { color: '#ff7a1a', count: 40, speed: 2.5, gravity: -3, glow: 1, life: 1.1 });
          }
        } else if (mo.k === 'hit') {
          const [x, y, z] = mo.at;
          client.fx.burst({ x, y, z }, { color: '#e8f6ff', count: mo.boards ? 30 : 14, speed: mo.boards ? 5 : 3, gravity: 6, glow: 0.4, life: 0.5 });
          if (mo.boards) client.fx.shake(0.5, 0.4);
        } else if (mo.k === 'save') {
          const [x, y, z] = mo.at;
          client.fx.burst({ x, y, z }, { color: '#ffffff', count: 10, speed: 2.5, gravity: 5, glow: 0.5, life: 0.35 });
        }
      }

      // The nets bulge and settle; the lamps flash while they're lit.
      for (const g of goals) {
        g.bulge = Math.max(0, g.bulge - dt * 2.4);
        const b = g.bulge;
        const wob = Math.sin(client.time * 30) * b;
        g.net.scale.set(1 + 0.25 * b + 0.05 * wob, 1 - 0.04 * b, 1 + 0.06 * b);
        g.lit = Math.max(0, g.lit - dt);
        g.light.visible = g.lit > 0 && Math.sin(client.time * 18) > -0.3;
        if (g.lit > 0 && Math.random() < dt * 14) {
          const at = g.light.position;
          client.fx.particles({ x: at.x, y: at.y + 0.6, z: at.z }, [1, 0.12, 0.08], { count: 3, speed: 1.4, size: 0.4, gravity: 0, glow: 1, life: 0.45, spread: 0.35, up: 0.6 });
        }
      }

      // Everyone's gear, and their sticks laid from their hands to the ice.
      const seen = new Set<string>();
      for (const fig of client.figures.all) {
        const id = fig.player;
        if (!id) continue;
        const g = dress(client, fig, id);
        if (!g?.stick) continue;
        seen.add(id);
        const s = view.skaters.get(id);
        const heel = heelOf(fig, new Vec3());
        const hand = handPos(fig, s?.goalie ? 'R' : 'L', new Vec3()) ?? new Vec3().copy(fig.root.position).add(v1.set(0, 1.1, 0));
        lay(g.stick, heel, hand, fig);
      }
      for (const [id, g] of gear) {
        if (seen.has(id)) continue;
        for (const n of g.parts) n.parent?.remove(n);
        if (g.stick) client.scene.remove(g.stick);
        gear.delete(id);
      }

      // The puck: on the carrier's blade (handled, side to side), in a goalie's glove, or flying.
      if (!puck) return;
      const fig = figureOf(client, view.holder);
      const now = new Vec3();
      if (view.holder && fig) {
        const s = view.skaters.get(view.holder);
        if (s?.goalie) {
          const glove = handPos(fig, 'L', v1);
          if (glove) now.copy(glove).add(v2.set(0, -0.15, 0));
          else now.copy(fig.root.position).add(v2.set(0, 1, 0));
        } else {
          const a = ahead(fig);
          const p = fig.root.position;
          const wob = (s?.wind ?? 0) > 0 ? 0 : Math.sin(client.time * 7.5) * 0.16;
          now.set(p.x + a.fx * 1.02 + a.rx * (0.22 + wob), ICE + PUCK_HALF, p.z + a.fz * 1.02 + a.rz * (0.22 + wob));
          if ((s?.wind ?? 0) > 0) now.set(p.x + a.fx * 0.9 + a.rx * 0.45, ICE + PUCK_HALF, p.z + a.fz * 0.9 + a.rz * 0.45);
        }
      } else if (view.flight) now.set(view.flight.x, view.flight.y, view.flight.z);
      else now.copy(last);
      puck.visible = !!((view.holder && fig) || view.flight);
      // It spins as it slides.
      const moved = Math.hypot(now.x - last.x, now.z - last.z);
      if (moved > 1e-4 && moved < 3) puck.quaternion.premultiply(q1.setFromAxisAngle(UP, moved * 3));
      puck.position.copy(now);
      last.copy(now);

      // Effects, a few times a second: fire at the skates, snow from a stop, the puck's trail.
      effectsAt += dt;
      if (effectsAt > 1 / 30) {
        effectsAt = 0;
        for (const [id, s] of view.skaters) {
          const f = figureOf(client, id);
          if (!f) continue;
          const p = f.root.position;
          if (s.fire) {
            client.fx.particles({ x: p.x, y: p.y + 0.1, z: p.z }, [1, 0.22, 0.02], { count: 4, speed: 0.7, size: 0.22, gravity: -5, glow: 0.7, life: 0.5, spread: 0.35, up: 2 });
            client.fx.particles({ x: p.x, y: p.y + 0.3, z: p.z }, [1, 0.6, 0.05], { count: 2, speed: 0.5, size: 0.14, gravity: -6, glow: 0.9, life: 0.35, spread: 0.25, up: 2.4 });
          }
          if (s.stop) {
            const a = ahead(f);
            client.fx.particles({ x: p.x + a.fx * 0.3, y: ICE + 0.1, z: p.z + a.fz * 0.3 }, [0.92, 0.97, 1], { count: 5, speed: 3.2, size: 0.1, gravity: 9, glow: 0.2, life: 0.45, spread: 0.3, up: 1.2 });
          }
        }
        const f = view.flight;
        if (f && puck.visible) {
          const sp = Math.hypot(f.vx, f.vz);
          if (view.flightFire) client.fx.particles({ x: now.x, y: now.y + 0.05, z: now.z }, [1, 0.3, 0.03], { count: 4, speed: 0.4, size: 0.18, gravity: -3, glow: 0.8, life: 0.45, spread: 0.1, up: 0.8 });
          else if (sp > 16) client.fx.particles({ x: now.x, y: now.y, z: now.z }, [0.85, 0.93, 1], { count: 2, speed: 0.2, size: 0.07, gravity: 0, glow: 0.3, life: 0.25, spread: 0.05, up: 0 });
        }
      }
      // Strides: a carve of the skates now and then for whoever's going quickly.
      stridesAt += dt;
      if (stridesAt > 0.12) {
        stridesAt = 0;
        for (const f of client.figures.all) {
          if (!f.player) continue;
          const sp = f.state.speed ?? 0;
          if (sp > 5 && Math.random() < 0.3) client.audio.play('ice_stride', { at: { x: f.root.position.x, y: ICE, z: f.root.position.z }, volume: Math.min(0.5, sp / 24) });
        }
      }
    },
  };
}
