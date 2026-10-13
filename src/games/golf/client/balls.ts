import type { Client, ClientKit, Node } from '@platform/client';
import { Quat, Vec3 } from '@platform/client/math';
import { BALL_SIZE, yards } from '../scale';
import { flightAt, restAt, type GolfState } from './state';

/**
 * Every ball on the course, drawn on this screen: at rest where the server says it lies, and in
 * flight along the path the server played out (`MSG.shot`), with what happens on the way (a thud
 * on landing, sand and water thrown up, leaves, the rattle of the cup). Others' balls carry their
 * owner's name; your own, out of sight, is marked with how far it is.
 */
export function ballsKit(st: GolfState): ClientKit {
  const nodes = new Map<string, Node>();
  /** Where each ball is drawn (eased over the half-block steps as it rolls). */
  const drawn = new Map<string, { x: number; y: number; z: number }>();
  const marked = new Set<string>();
  let trailAt = 0;
  const axis = new Vec3();
  const turn = new Quat();
  /** Roll a ball's model by how far it's gone: turned about the level line across its way. */
  const roll = (node: Node, from: { x: number; z: number }, to: { x: number; z: number }) => {
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const d = Math.hypot(dx, dz);
    if (d < 1e-5 || d > 3) return;
    axis.set(dz / d, 0, -dx / d);
    turn.setFromAxisAngle(axis, d / (BALL_SIZE / 2));
    node.quaternion.premultiply(turn);
  };

  const nodeFor = (client: Client, id: string): Node | null => {
    let n = nodes.get(id);
    if (n) return n;
    const made = client.scene.item('golf_ball');
    if (!made) return null;
    const holder = client.scene.node();
    made.node.position.set(-made.center.x, -made.center.y, -made.center.z);
    holder.add(made.node);
    holder.scale.setScalar(BALL_SIZE);
    client.scene.add(holder);
    nodes.set(id, holder);
    return holder;
  };

  const play = (client: Client, kind: string, at: { x: number; y: number; z: number }, speed: number, mine: boolean) => {
    const loud = Math.min(1, 0.35 + speed / 18);
    switch (kind) {
      case 'land':
      case 'bounce':
        client.audio.play('golf_bounce', { at, volume: loud });
        client.fx.particles(at, [0.28, 0.45, 0.16], { count: Math.round(3 + speed), speed: 1.2, size: 0.05, gravity: 9, life: 0.6, up: 1.5 });
        break;
      case 'sand':
        client.audio.play('golf_sand', { at, volume: loud });
        client.fx.particles(at, [0.85, 0.78, 0.55], { count: 18, speed: 2, size: 0.07, gravity: 10, life: 0.9, up: 2.5 });
        break;
      case 'splash':
        client.audio.play('golf_splash', { at });
        client.fx.particles({ x: at.x, y: at.y + 0.1, z: at.z }, [0.75, 0.86, 1], { count: 34, speed: 2.5, size: 0.09, gravity: 12, life: 1, up: 4 });
        break;
      case 'tree':
        client.audio.play('golf_tree', { at });
        client.fx.particles(at, [0.18, 0.4, 0.12], { count: 12, speed: 1.5, size: 0.08, gravity: 5, life: 1.2 });
        break;
      case 'trunk':
      case 'pin':
        client.audio.play('golf_knock', { at });
        break;
      case 'lip':
        client.audio.play('golf_lip', { at });
        break;
      case 'cup':
        client.audio.play('golf_cup', { at });
        if (mine) client.fx.burst({ x: at.x, y: at.y + 0.2, z: at.z }, { color: '#ffffff', count: 16, speed: 1.6, gravity: -1, glow: 0.8, life: 0.8 });
        break;
    }
  };

  return {
    name: 'golf.balls',
    frame(client, dt) {
      const me = client.me.id;
      trailAt += dt;
      const trail = trailAt > 0.03;
      if (trail) trailAt = 0;
      const seen = new Set<string>();
      // Shots in the air.
      for (const [id, f] of st.flights) {
        f.t += dt;
        const events = f.msg.events;
        while (f.next < events.length && events[f.next].t <= f.t) {
          const e = events[f.next++];
          play(client, e.kind, e, e.speed, id === me);
        }
        const p = flightAt(f, Math.min(f.t, f.length));
        const node = nodeFor(client, id);
        seen.add(id);
        const hidden = f.t >= f.length && (f.msg.outcome === 'holed' || f.msg.outcome === 'water');
        const was = drawn.get(id);
        if (node) {
          node.visible = !hidden;
          if (was) roll(node, was, p);
          node.position.set(p.x, p.y, p.z);
        }
        drawn.set(id, { x: p.x, y: p.y, z: p.z });
        // A thin white trail behind a ball in the air.
        if (trail && p.dy !== 0 && f.t < f.length && f.msg.club !== 'putter')
          client.fx.particles({ x: p.x, y: p.y, z: p.z }, [1, 1, 1], { count: 1, speed: 0, size: 0.045, gravity: 0, life: 0.9, glow: 0.4 });
        if (f.t >= f.length + 0.5) st.flights.delete(id);
      }
      // Balls at rest.
      for (const [id, b] of st.balls) {
        if (seen.has(id)) continue;
        const node = nodeFor(client, id);
        if (!b.at) {
          if (node) node.visible = false;
          drawn.delete(id);
          continue;
        }
        const want = restAt(b.at);
        const d = drawn.get(id);
        const at = d && Math.hypot(d.x - want.x, d.z - want.z) < 0.5 ? { x: want.x, y: d.y + (want.y - d.y) * Math.min(1, dt * 12), z: want.z } : want;
        drawn.set(id, at);
        if (node) {
          node.visible = true;
          node.position.set(at.x, at.y, at.z);
        }
        seen.add(id);
      }
      // Balls whose players left.
      for (const [id, n] of nodes)
        if (!st.balls.has(id) && !st.flights.has(id)) {
          client.scene.remove(n);
          nodes.delete(id);
          drawn.delete(id);
        }
      // Markers: others' balls by name; our own, when it's far off and we're not at it.
      const pos = client.me.position;
      for (const [id, at] of drawn) {
        const b = st.balls.get(id);
        const key = `ball:${id}`;
        if (id === me) {
          const far = Math.hypot(at.x - pos.x, at.z - pos.z);
          const show = !st.address && !st.flights.has(id) && far > 6;
          if (show) {
            client.hud.marker(key, { x: at.x, y: at.y + 0.3, z: at.z }, { shape: 'diamond', color: '#ffffff', label: `Your ball · ${Math.round(yards(far))} yds`, edge: true, size: 12 });
            marked.add(key);
          } else if (marked.delete(key)) client.hud.marker(key, null);
          continue;
        }
        if (b && Math.hypot(at.x - pos.x, at.z - pos.z) < 120) {
          client.hud.marker(key, { x: at.x, y: at.y + 0.35, z: at.z }, { shape: 'dot', color: b.color, label: b.name, size: 7 });
          marked.add(key);
        } else if (marked.delete(key)) client.hud.marker(key, null);
      }
      for (const key of [...marked]) {
        const id = key.slice(5);
        if (!drawn.has(id)) {
          marked.delete(key);
          client.hud.marker(key, null);
        }
      }
    },
    dispose() {
      nodes.clear();
    },
  };
}
