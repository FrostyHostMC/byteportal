/**
 * Messages over a socket: JSON, with typed arrays (atlas pixels, blueprint cells, saved edits)
 * carried as base64, and Infinity, NaN and `undefined` in lists kept (plain JSON makes them all
 * null, and `play('hit', undefined)` must not arrive as `play('hit', null)`). Works the same in
 * the browser and in Node.
 */

type Typed = Uint8Array | Int8Array | Uint16Array | Int16Array | Uint32Array | Int32Array | Float32Array | Float64Array;

const KINDS: Record<string, new (b: ArrayBuffer) => Typed> = {
  u8: Uint8Array,
  i8: Int8Array,
  u16: Uint16Array,
  i16: Int16Array,
  u32: Uint32Array,
  i32: Int32Array,
  f32: Float32Array,
  f64: Float64Array,
};

function kindOf(v: Typed): string {
  for (const [k, C] of Object.entries(KINDS)) if (v instanceof C) return k;
  return 'u8';
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function encode(msg: unknown): string {
  return JSON.stringify(msg, function (this: unknown, _k, v: unknown) {
    if (v === undefined && Array.isArray(this)) return { $u: 1 };
    if (typeof v === 'number' && !Number.isFinite(v)) return { $n: String(v) };
    if (ArrayBuffer.isView(v) && !(v instanceof DataView)) {
      const t = v as Typed;
      return { $t: kindOf(t), b: toBase64(new Uint8Array(t.buffer, t.byteOffset, t.byteLength)) };
    }
    return v;
  });
}

export function decode<T>(text: string): T {
  return JSON.parse(text, (_k, v: unknown) => {
    // Returning undefined leaves the list with a hole there, which reads as undefined.
    if (v && typeof v === 'object' && (v as { $u?: unknown }).$u === 1) return undefined;
    if (v && typeof v === 'object' && typeof (v as { $n?: unknown }).$n === 'string') return Number((v as { $n: string }).$n);
    if (v && typeof v === 'object' && typeof (v as { $t?: unknown }).$t === 'string' && typeof (v as { b?: unknown }).b === 'string') {
      const { $t, b } = v as { $t: string; b: string };
      const bytes = fromBase64(b);
      const C = KINDS[$t] ?? Uint8Array;
      return new C(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    }
    return v;
  }) as T;
}
