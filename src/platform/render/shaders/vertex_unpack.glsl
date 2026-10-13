// ---------------------------------------------------------------------------------------------
// Packed chunk vertex decoding + vertex animation (shared by terrain, water and shadow passes).
//   w0: x(5) | z(5)<<5 | y(9)<<10 | normal(3)<<19 | ao(2)<<22 | anim(2)<<24 | tint<<26
//       | xmax<<27 | zmax<<28 | cutout<<29 | fine<<30 | uvt.0<<31
//   w1: layer(10) | uvt.1-2<<10 | sky*4(6)<<12 | block*4(6)<<18 | fx(4)<<24 | fz(4)<<28
// A fine vertex (block models: torches, slabs, stairs, beds) is its block's cell (x 4 bits, z 4, y 8)
// and an offset into it in sixteenths, 0..16 (see `mesher.rs`), so its texture maps exactly within
// the block's own tile. uvt turns the texture: 1 swaps u and v, 2 negates u, 4 negates v.
// ---------------------------------------------------------------------------------------------
in uvec2 aData;

uniform float uTime;
uniform vec4 uWind; // xy: direction, z: strength, w: gust phase

struct Vtx {
  vec3 pos;      // chunk-local (animated)
  vec3 normal;   // world-space geometric normal
  vec3 tangent;  // world-space +u
  vec3 bitangent;// world-space +v (texture up)
  vec2 uv;       // unwrapped texture coordinates in block units
  uint layer;
  uint normalIdx;
  float ao;
  float sky;
  float blk;
  float tint;
  float cutout;
  float plantV;  // 0 for cross-plane plants, -1 for cube faces
  bool fine;     // a block model's face (torch, slab, bed): part of one texture tile
};

vec3 windOffset(vec3 w, float amount) {
  float t = uTime;
  float gust = 0.65 + 0.35 * sin(t * 0.35 + w.x * 0.013 + w.z * 0.017 + uWind.w);
  vec3 o;
  o.x = sin(t * 1.9 + w.x * 0.61 + w.y * 0.37) + 0.5 * sin(t * 3.7 + w.z * 1.13);
  o.y = 0.35 * sin(t * 2.3 + w.x * 0.43 + w.z * 0.51);
  o.z = cos(t * 1.7 + w.z * 0.57 + w.y * 0.23) + 0.5 * cos(t * 3.3 + w.x * 0.97);
  o.xz += uWind.xy * 0.8;
  return o * amount * gust * uWind.z;
}

Vtx unpackVertex(vec3 chunkOrigin) {
  Vtx v;
  uint w0 = aData.x;
  uint w1 = aData.y;
  vec3 p = vec3(float(w0 & 31u), float((w0 >> 10u) & 511u), float((w0 >> 5u) & 31u));
  uint n = (w0 >> 19u) & 7u;
  bool fine = ((w0 >> 30u) & 1u) == 1u;
  v.fine = fine;
  uint anim = fine ? 0u : (w0 >> 24u) & 3u;
  uint uvt = ((w0 >> 31u) & 1u) | (((w1 >> 10u) & 3u) << 1u);
  // Where in its block's cell a fine vertex is, 0..1.
  vec3 inCell = vec3(0.0);
  if (fine) {
    p = vec3(float(w0 & 15u), float((w0 >> 10u) & 255u), float((w0 >> 5u) & 15u));
    uint ox = ((w1 >> 24u) & 15u) | (((w0 >> 4u) & 1u) << 4u);
    uint oy = ((w0 >> 24u) & 3u) | (((w0 >> 27u) & 3u) << 2u) | (((w0 >> 18u) & 1u) << 4u);
    uint oz = ((w1 >> 28u) & 15u) | (((w0 >> 9u) & 1u) << 4u);
    inCell = vec3(float(ox), float(oy), float(oz)) / 16.0;
    p += inCell;
  }
  v.normalIdx = n;
  v.ao = float((w0 >> 22u) & 3u) / 3.0;
  v.tint = float((w0 >> 26u) & 1u);
  v.cutout = float((w0 >> 29u) & 1u);
  v.layer = w1 & 1023u;
  v.sky = float((w1 >> 12u) & 63u) / 60.0;
  v.blk = float((w1 >> 18u) & 63u) / 60.0;
  v.plantV = -1.0;
  vec3 animRef = p;

  if (n == 0u) { v.normal = vec3(1, 0, 0); v.tangent = vec3(0, 0, -1); v.bitangent = vec3(0, 1, 0); v.uv = vec2(-p.z, p.y); }
  else if (n == 1u) { v.normal = vec3(-1, 0, 0); v.tangent = vec3(0, 0, 1); v.bitangent = vec3(0, 1, 0); v.uv = vec2(p.z, p.y); }
  else if (n == 2u) { v.normal = vec3(0, 1, 0); v.tangent = vec3(1, 0, 0); v.bitangent = vec3(0, 0, 1); v.uv = vec2(p.x, p.z); }
  else if (n == 3u) { v.normal = vec3(0, -1, 0); v.tangent = vec3(1, 0, 0); v.bitangent = vec3(0, 0, -1); v.uv = vec2(p.x, -p.z); }
  else if (n == 4u) { v.normal = vec3(0, 0, 1); v.tangent = vec3(1, 0, 0); v.bitangent = vec3(0, 1, 0); v.uv = vec2(p.x, p.y); }
  else if (n == 5u) { v.normal = vec3(0, 0, -1); v.tangent = vec3(-1, 0, 0); v.bitangent = vec3(0, 1, 0); v.uv = vec2(-p.x, p.y); }
  else {
    // Cross-plane plant: shrink toward the cell centre and jitter per cell.
    float xmax = float((w0 >> 27u) & 1u);
    float zmax = float((w0 >> 28u) & 1u);
    vec2 cell = p.xz - vec2(xmax, zmax);
    v.uv = vec2(n == 6u ? xmax : zmax, p.y);
    float inset = 0.14;
    p.x += xmax > 0.5 ? -inset : inset;
    p.z += zmax > 0.5 ? -inset : inset;
#ifdef TORCH_LAYER
    if (v.layer != uint(TORCH_LAYER)) {
#else
    {
#endif
      vec2 j = hash22(chunkOrigin.xz + cell + 0.37) - 0.5;
      p.xz += j * 0.36;
    }
    // Animate both top corners of a plant together.
    animRef = vec3(cell.x + 0.5, p.y, cell.y + 0.5);
    v.normal = vec3(0, 1, 0);
    v.tangent = n == 6u ? normalize(vec3(1, 0, 1)) : normalize(vec3(-1, 0, 1));
    v.bitangent = vec3(0, 1, 0);
    // The fragment shader derives the height along the plant from fract(uv.y).
    v.plantV = 0.0;
  }

  if (uvt != 0u) {
    if ((uvt & 1u) != 0u) {
      v.uv = v.uv.yx;
      vec3 t = v.tangent;
      v.tangent = v.bitangent;
      v.bitangent = t;
    }
    if ((uvt & 2u) != 0u) {
      v.uv.x = -v.uv.x;
      v.tangent = -v.tangent;
    }
    if ((uvt & 4u) != 0u) {
      v.uv.y = -v.uv.y;
      v.bitangent = -v.bitangent;
    }
  }

  if (fine) {
    // Its block's own tile, from the cell (0..1 along each axis, turned as the texture is),
    // kept a hair inside it so it never wraps round to the tile's far edge.
    v.uv = vec2(dot(inCell, v.tangent), dot(inCell, v.bitangent));
    v.uv += vec2(v.tangent.x + v.tangent.y + v.tangent.z < 0.0 ? 1.0 : 0.0, v.bitangent.x + v.bitangent.y + v.bitangent.z < 0.0 ? 1.0 : 0.0);
    v.uv = clamp(v.uv, 1.0 / 1024.0, 1.0 - 1.0 / 1024.0);
    // Widen a hair along the face at the block's edges, like cube faces, so there are no cracks
    // between it and the next block's faces.
    vec3 edge = step(0.999, inCell) - step(inCell, vec3(0.001));
    p += edge * (vec3(1.0) - abs(v.normal)) * 0.0022;
  }

  if (n < 6u && !fine) {
    // Expand cube faces by a hair along their plane to close T-junction cracks.
    const float EPS = 0.0022;
    float us = ((w0 >> 27u) & 1u) == 1u ? EPS : -EPS;
    float vs = ((w0 >> 28u) & 1u) == 1u ? EPS : -EPS;
    if (n < 2u) p += vec3(0.0, vs, us);
    else if (n < 4u) p += vec3(us, 0.0, vs);
    else p += vec3(us, vs, 0.0);
  }

  vec3 world = chunkOrigin + animRef;
  if (anim == 1u) {
    p += windOffset(world, 0.045) * smoothstep(0.3, 0.9, v.sky);
  } else if (anim == 2u) {
    p.xz += windOffset(world, 0.11).xz * smoothstep(0.3, 0.9, v.sky);
  } else if (anim == 3u) {
    p.y -= 0.125;
    p.y += (sin(world.x * 0.8 + uTime * 1.6) + sin(world.z * 0.7 + uTime * 1.3 + world.x * 0.2)) * 0.018;
  }
  v.pos = p;
  return v;
}
