/**
 * EXT_meshopt_compression's codecs, dependency-free: vertex attributes (the vertex codec, version 0)
 * and index lists (the index sequence codec). The bitstreams are the extension's (see its spec, and
 * meshoptimizer's reference decoder); decoders are here too, to check what's written reads back.
 */

/** Vertex data (`count` elements of `stride` bytes, stride a multiple of 4) in the vertex codec. */
export function encodeVertexBuffer(data, count, stride) {
  if (stride % 4 || stride > 256 || data.length < count * stride) throw new Error('meshopt: bad vertex data');
  const out = [0xa0];
  const blockMax = Math.min((8192 / stride) & ~15, 256);
  // Copies (a Buffer's slice is a view).
  const first = Uint8Array.from(data.subarray(0, stride));
  const last = Uint8Array.from(first);
  const deltas = new Uint8Array(256);
  for (let base = 0; base < count; base += blockMax) {
    const n = Math.min(blockMax, count - base);
    for (let k = 0; k < stride; k++) {
      deltas.fill(0);
      let p = last[k];
      for (let i = 0; i < n; i++) {
        const v = data[(base + i) * stride + k];
        const d = (v - p) & 0xff;
        deltas[i] = ((d << 1) ^ (d & 0x80 ? 0xff : 0)) & 0xff;
        p = v;
      }
      encodeBytes(out, deltas, (n + 15) & ~15);
    }
    for (let k = 0; k < stride; k++) last[k] = data[(base + n - 1) * stride + k];
  }
  // The first element at the end (the baseline), padded to 32 bytes.
  for (let i = stride; i < 32; i++) out.push(0);
  for (let k = 0; k < stride; k++) out.push(count ? first[k] : 0);
  return Uint8Array.from(out);
}

/** One byte channel of a block: groups of 16, each all zero, 2 or 4 bits a value (with exceptions) or raw. */
function encodeBytes(out, buf, size) {
  const groups = size / 16;
  const header = out.length;
  for (let i = 0; i < (groups + 3) >> 2; i++) out.push(0);
  for (let g = 0; g < groups; g++) {
    const at = g * 16;
    let bits = 8;
    let best = 16;
    for (const b of [0, 2, 4]) {
      let size = b === 0 ? 0 : 2 * b;
      for (let i = 0; i < 16; i++) {
        const v = buf[at + i];
        if (b === 0 ? v !== 0 : v >= (1 << b) - 1) size = b === 0 ? Infinity : size + 1;
      }
      if (size < best) (bits = b), (best = size);
    }
    out[header + (g >> 2)] |= (bits === 0 ? 0 : bits === 2 ? 1 : bits === 4 ? 2 : 3) << ((g & 3) << 1);
    if (bits === 8) for (let i = 0; i < 16; i++) out.push(buf[at + i]);
    else if (bits) {
      const sentinel = (1 << bits) - 1;
      const per = 8 / bits;
      for (let i = 0; i < 16; i += per) {
        let byte = 0;
        for (let k = 0; k < per; k++) byte = (byte << bits) | Math.min(buf[at + i + k], sentinel);
        out.push(byte);
      }
      for (let i = 0; i < 16; i++) if (buf[at + i] >= sentinel) out.push(buf[at + i]);
    }
  }
}

/** An index list in the index sequence codec. */
export function encodeIndexSequence(indices) {
  const out = [0xd1];
  const last = [0, 0];
  let current = 0;
  for (const index of indices) {
    if (Math.abs(index - last[current]) >= 30) current ^= 1;
    const d = (index - last[current]) | 0;
    let v = ((((d << 1) ^ (d >> 31)) >>> 0) * 2 + current) >>> 0;
    while (v >= 0x80) {
      out.push((v & 0x7f) | 0x80);
      v >>>= 7;
    }
    out.push(v);
    last[current] = index;
  }
  out.push(0, 0, 0, 0);
  return Uint8Array.from(out);
}

const dezig = (v) => ((v & 1) !== 0 ? ~(v >>> 1) : v >>> 1);

/** Back from the vertex codec (version 0). */
export function decodeVertexBuffer(source, count, stride) {
  if (source[0] !== 0xa0) throw new Error('meshopt: not a version 0 vertex buffer');
  const target = new Uint8Array(count * stride);
  const blockMax = Math.min((8192 / stride) & ~15, 256);
  const deltas = new Uint8Array(blockMax * stride + 16);
  const temp = source.slice(source.length - stride);
  let o = 1;
  for (let base = 0; base < count; base += blockMax) {
    const n = Math.min(count - base, blockMax);
    const groups = (n + 15) >> 4;
    const headerBytes = (groups + 3) >> 2;
    deltas.fill(0);
    for (let k = 0; k < stride; k++) {
      const h = o;
      o += headerBytes;
      for (let g = 0; g < groups; g++) {
        const bits = [0, 2, 4, 8][(source[h + (g >> 2)] >> ((g & 3) << 1)) & 3];
        const at = k * n + g * 16;
        if (bits === 8) {
          for (let m = 0; m < 16; m++) deltas[at + m] = source[o + m];
          o += 16;
        } else if (bits) {
          const b0 = o;
          o += 2 * bits;
          const per = 8 / bits;
          const sentinel = (1 << bits) - 1;
          for (let m = 0; m < 16; m++) {
            let v = (source[b0 + Math.floor(m / per)] >> (8 - bits - (m % per) * bits)) & sentinel;
            if (v === sentinel) v = source[o++];
            deltas[at + m] = v;
          }
        }
      }
    }
    for (let i = 0; i < n; i++)
      for (let k = 0; k < stride; k++) target[(base + i) * stride + k] = temp[k] = (temp[k] + dezig(deltas[k * n + i])) & 0xff;
  }
  if (o !== source.length - Math.max(stride, 32)) throw new Error('meshopt: vertex buffer length');
  return target;
}

/** Back from the index sequence codec. */
export function decodeIndexSequence(source, count) {
  if (source[0] !== 0xd1) throw new Error('meshopt: not an index sequence');
  const out = new Uint32Array(count);
  const last = new Uint32Array(2);
  let o = 1;
  for (let i = 0; i < count; i++) {
    let v = 0;
    for (let s = 0; ; s += 7) {
      const b = source[o++];
      v += (b & 0x7f) * 2 ** s;
      if (b < 0x80) break;
    }
    const b = v % 2;
    out[i] = last[b] += dezig(Math.floor(v / 2));
  }
  if (o !== source.length - 4) throw new Error('meshopt: index sequence length');
  return out;
}
