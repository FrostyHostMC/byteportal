import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { course } from '../../src/games/golf/course';
import { Surf } from '../../src/games/golf/course/types';
import { BASE } from '../../src/games/golf/scale';

/**
 * A map of Blockyard Links as a PNG (`GOLF_MAP=path`, default golf-map.png): every block's ground,
 * shaded by height, the trees, tees and pins. For laying the holes out; not a test.
 *
 *   GOLF_MAP=map.png node scripts/headless.mjs tests/headless/_golf-map.ts
 */
export default function golfMap() {
  const t0 = performance.now();
  const only = process.env.GOLF_HOLE ? course.holes[Number(process.env.GOLF_HOLE) - 1] : null;
  const b = only ? only.box : course.box;
  const scale = Number(process.env.GOLF_SCALE ?? 1);
  const w = Math.ceil((b.x1 - b.x0) / scale);
  const h = Math.ceil((b.z1 - b.z0) / scale);
  const px = Buffer.alloc(w * h * 3);
  const colors: Record<number, [number, number, number]> = {
    [Surf.Out]: [58, 96, 44],
    [Surf.Rough]: [74, 128, 52],
    [Surf.Deep]: [62, 108, 45],
    [Surf.Fairway]: [112, 178, 70],
    [Surf.Fringe]: [104, 190, 80],
    [Surf.Green]: [128, 214, 96],
    [Surf.Tee]: [120, 200, 90],
    [Surf.Sand]: [232, 216, 160],
    [Surf.Water]: [52, 104, 190],
    [Surf.Path]: [180, 176, 168],
  };
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const g = course.ground(b.x0 + (i + 0.5) * scale, b.z0 + (j + 0.5) * scale);
      const c = colors[g.surf];
      const shade = 1 + (g.y - BASE) * 0.06;
      const k = (j * w + i) * 3;
      px[k] = Math.min(255, c[0] * shade);
      px[k + 1] = Math.min(255, c[1] * shade);
      px[k + 2] = Math.min(255, c[2] * shade);
    }
  const dot = (x: number, z: number, r: number, c: [number, number, number]) => {
    for (let dz = -r; dz <= r; dz++)
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dz * dz > r * r) continue;
        const i = Math.floor((x - b.x0) / scale) + dx;
        const j = Math.floor((z - b.z0) / scale) + dz;
        if (i < 0 || j < 0 || i >= w || j >= h) continue;
        const k = (j * w + i) * 3;
        px[k] = c[0];
        px[k + 1] = c[1];
        px[k + 2] = c[2];
      }
  };
  for (const t of course.trees) dot(t.x, t.z, Math.max(1, Math.round(t.r / scale / 1.6)), t.kind === 'spruce' ? [24, 60, 30] : t.kind === 'birch' ? [110, 150, 60] : [30, 80, 28]);
  for (const hole of course.holes) {
    dot(hole.tee.x, hole.tee.z, 2, [255, 255, 255]);
    dot(hole.green.pin.x, hole.green.pin.z, 2, [230, 30, 30]);
    dot(hole.cartTee.x, hole.cartTee.z, 1, [255, 220, 0]);
    dot(hole.cartGreen.x, hole.cartGreen.z, 1, [255, 220, 0]);
  }
  writeFileSync(process.env.GOLF_MAP ?? 'golf-map.png', encodePng(w, h, px));
  console.log(`  ${w}x${h} map, ${course.trees.length} trees, ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  for (const hole of course.holes) {
    const p = hole.green.pin;
    console.log(`  ${String(hole.index + 1).padStart(2)} ${hole.name.padEnd(12)} par ${hole.par} ${hole.yards} yd  tee (${hole.tee.x}, ${hole.tee.z}) y ${hole.tee.y.toFixed(1)}  pin (${p.x.toFixed(1)}, ${p.z.toFixed(1)}) y ${p.y.toFixed(2)}`);
  }
}

function encodePng(w: number, h: number, rgb: Buffer): Buffer {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let j = 0; j < h; j++) rgb.copy(raw, j * (w * 3 + 1) + 1, j * w * 3, (j + 1) * w * 3);
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

function crc32(buf: Buffer): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}
