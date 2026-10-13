
uniform sampler2DArray uAlbedo;
uniform sampler2DArray uMaterial;
uniform sampler2D uBiome;
uniform float uTime;

in vec3 vViewPos;
in vec3 vRelPos;
in vec3 vWorldPos;
in vec2 vUV;
in vec3 vNormal;
in vec3 vTangent;
in vec3 vBitangent;
in vec4 vLight;
flat in uint vLayer;
flat in uint vFlags;

layout(location = 0) out vec4 fragColor;

const vec3 FOLIAGE = vec3(0.66, 0.8, 0.56);

void main() {
  vec2 dx = dFdx(vUV);
  vec2 dy = dFdy(vUV);
  vec2 tuv = vec2(fract(vUV.x), 1.0 - fract(vUV.y));
  if ((vFlags & 4u) != 0u) {
    // A block model's face shows part of one tile, and its texture needn't tile (a bed's top).
    // Its coordinates are already the tile's (0..1): clamp rather than wrap them (multisampling
    // reads edge pixels a little outside the face), and keep the filtering (mip blends,
    // anisotropic taps) from reaching round to the far edge.
    float lod = log2(max(max(length(dx), length(dy)) * 16.0, 1.0));
    float h = min(0.5, 0.5 * max(exp2(ceil(lod)) / 16.0, max(max(abs(dx.x), abs(dy.x)), max(abs(dx.y), abs(dy.y)))));
    vec2 c = clamp(vUV, vec2(h), vec2(1.0 - h));
    tuv = vec2(c.x, 1.0 - c.y);
  }
  float layer = float(vLayer);
  vec4 albedo = textureGrad(uAlbedo, vec3(tuv, layer), dx, dy);
  bool isCross = (vFlags & 1u) != 0u;

#ifdef CUTOUT
  // Coverage-preserving alpha test: boost alpha with mip level, then sharpen for alpha-to-coverage.
  float lod = log2(max(max(length(dx), length(dy)) * 16.0, 1e-4));
  float a = albedo.a * (1.0 + max(lod, 0.0) * 0.28);
  a = (a - 0.5) / max(fwidth(a), 1e-4) + 0.5;
  if (a < 0.08) discard;
  float outAlpha = saturate(a);
#else
  float outAlpha = 1.0;
#endif

  vec3 base = albedo.rgb;
  if (vLight.w > 0.5) {
    vec3 tint = texture(uBiome, vWorldPos.xz / 1024.0).rgb;
#ifdef CUTOUT
    base *= tint * (isCross ? vec3(1.0) : FOLIAGE);
#else
    base = mix(base, base * tint, 1.0 - albedo.a);
#endif
  }

  vec4 mat = textureGrad(uMaterial, vec3(tuv, layer), dx, dy);
  vec3 Ng = vNormal;
  vec3 T = vTangent;
  vec3 B = vBitangent;
#ifdef CUTOUT
  if (!gl_FrontFacing && !isCross) {
    Ng = -Ng;
    T = -T;
  }
#endif
  vec3 N = Ng;
  if (!isCross) {
    vec2 nxy = mat.rg * 2.0 - 1.0;
    N = normalize(T * nxy.x + B * nxy.y + Ng * sqrt(saturate(1.0 - dot(nxy, nxy))));
  }

  float sky = vLight.x;
  // (Clamped: MSAA shades an edge pixel at its centre, which can be just off the triangle, and the
  // light is extrapolated there, a hair below 0 where it changes across it: pow of that is NaN,
  // which comes out black, dashes along the triangles' edges.)
  float blk = max(vLight.y, 0.0);
  float ao = vLight.z;
  float aoF = 0.38 + 0.62 * ao * ao;
  float plantH = isCross ? fract(vUV.y) : 1.0;
  if (isCross) aoF *= mix(0.5, 1.0, plantH);

  vec3 V = -normalize(vRelPos);
  float ndlRaw = dot(N, uLightDir);
  float geomNdl = dot(Ng, uLightDir);
  float ndl = isCross ? (0.5 + 0.35 * saturate(uLightDir.y)) : saturate(ndlRaw);
  float skyOcc = smoothstep(0.3, 0.85, sky);

  float vis = 0.0;
  if ((geomNdl > 0.0 || isCross || (vFlags & 2u) != 0u) && skyOcc > 0.0 && uLightDir.y > -0.05) {
    vis = shadowFactor(vRelPos, saturate(geomNdl)) * skyOcc * cloudShadow(vWorldPos);
  }

  // Underwater floors (below sea level, not open to the sky): scattering softens shadows and the
  // wavy surface focuses light into caustics.
  if (vWorldPos.y < 63.0 && sky < 0.985 && sky > 0.2) {
    float depth = clamp(62.9 - vWorldPos.y, 0.0, 30.0);
    vec2 cp = vWorldPos.xz + uLightDir.xz * depth * 0.4;
    float c1 = texture(uNoise, cp * 0.055 + vec2(uTime * 0.012, uTime * 0.009)).b;
    float c2 = texture(uNoise, cp * 0.071 - vec2(uTime * 0.010, -uTime * 0.013)).b;
    // Caustics need strong direct light: they fade out under moonlight.
    float caustic = pow(1.0 - abs(c1 - c2), 7.0) * 1.8 * smoothstep(0.2, 1.0, luma(uLightColor));
    float soft = mix(0.55, 0.35, saturate(depth / 12.0));
    float shadowLight = skyOcc * cloudShadow(vWorldPos) * saturate(uLightDir.y * 4.0);
    vis = mix(vis, shadowLight, soft) * (0.75 + caustic * exp(-depth * 0.12));
  }
  vec3 direct = uLightColor * ndl * vis;
#ifdef CUTOUT
  // Light transmitted through leaves and grass blades.
  float trans = isCross ? 0.35 : saturate(-ndlRaw) * 0.55 + 0.1;
  direct += uLightColor * trans * vis * 0.7;
#endif

  float skyVis = sky * sky;
  vec3 amb = mix(uAmbientGround, uAmbientSky, N.y * 0.5 + 0.5) * skyVis;
  vec3 torch = uBlockLight * (pow(blk, 3.2) * 1.8 + blk * 0.06);
  vec3 lighting = direct * mix(1.0, aoF, 0.6) + (amb + torch + uMinLight) * aoF;
  vec3 color = base * lighting;

  float smoothness = mat.b;
  if (smoothness > 0.03 && !isCross) {
    float rough = max((1.0 - smoothness) * (1.0 - smoothness), 0.045);
    vec3 H = normalize(uLightDir + V);
    float NoH = saturate(dot(N, H));
    float NoV = saturate(dot(N, V)) + 1e-4;
    float NoL = saturate(ndlRaw);
    float F = 0.04 + 0.96 * pow(1.0 - saturate(dot(H, V)), 5.0);
    color += uLightColor * D_GGX(NoH, rough) * V_SmithGGX(NoV, NoL, rough) * F * NoL * vis;
    vec3 R = reflect(-V, N);
    float Fv = 0.04 + 0.96 * pow(1.0 - NoV, 5.0);
    color += skyRadiance(vec3(R.x, abs(R.y), R.z)) * Fv * smoothness * smoothness * skyVis * aoF * 0.8;
  }

  color += base * mat.a * 4.0;
  color = applyFog(color, vRelPos, vWorldPos.y, sky);
  fragColor = vec4(color, outAlpha);
}
