uniform mat4 projectionMatrix;
uniform mat4 viewMatrix;
uniform sampler2D uSceneCopy;   // rgb: opaque scene, a: linear view depth
uniform vec2 uResolution;
uniform float uTime;
uniform float uFar;
uniform float uSSR;

in vec3 vViewPos;
in vec3 vRelPos;
in vec3 vWorldPos;
in vec3 vNormal;
in vec4 vLight;

layout(location = 0) out vec4 fragColor;

float waterHeight(vec2 p) {
  float t = uTime;
  float h = texture(uNoise, p * 0.019 + vec2(t * 0.010, t * 0.006)).a * 0.5;
  h += texture(uNoise, p * 0.053 + vec2(-t * 0.016, t * 0.011)).a * 0.32;
  h += texture(uNoise, p * 0.137 + vec2(t * 0.027, -t * 0.024)).a * 0.18;
  return h;
}

vec3 waterNormal(vec2 p, float dist) {
  const float e = 0.1;
  float h = waterHeight(p);
  float hx = waterHeight(p + vec2(e, 0.0));
  float hz = waterHeight(p + vec2(0.0, e));
  float k = 1.25 * exp(-dist * 0.015) + 0.1;
  return normalize(vec3(-(hx - h) / e * k, 1.0, -(hz - h) / e * k));
}

vec2 toScreen(vec3 viewPos) {
  vec4 c = projectionMatrix * vec4(viewPos, 1.0);
  return c.xy / c.w * 0.5 + 0.5;
}

vec4 traceSSR(vec3 origin, vec3 dir) {
  if (dir.z > 0.35) return vec4(0.0);
  float stepLen = 0.45;
  vec3 p = origin + dir * 0.2;
  const int STEPS = 30;
  for (int i = 0; i < STEPS; i++) {
    p += dir * stepLen;
    vec2 uv = toScreen(p);
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0 || p.z > -0.05) break;
    float sceneZ = texture(uSceneCopy, uv).a;
    float diff = -p.z - sceneZ;
    if (diff > 0.0 && diff < stepLen * 2.0 + 0.4) {
      vec3 lo = p - dir * stepLen;
      vec3 hi = p;
      for (int j = 0; j < 5; j++) {
        vec3 mid = (lo + hi) * 0.5;
        if (-mid.z > texture(uSceneCopy, toScreen(mid)).a) hi = mid; else lo = mid;
      }
      uv = toScreen(hi);
      vec4 s = texture(uSceneCopy, uv);
      if (s.a > uFar * 0.98) return vec4(0.0);
      vec2 e = smoothstep(vec2(0.0), vec2(0.07), uv) * smoothstep(vec2(1.0), vec2(0.93), uv);
      float fade = e.x * e.y * (1.0 - float(i) / float(STEPS)) * smoothstep(0.35, 0.05, dir.z);
      return vec4(s.rgb, fade);
    }
    stepLen *= 1.16;
  }
  return vec4(0.0);
}

void main() {
  float dist = length(vRelPos);
  vec3 Ng = normalize(vNormal);
  bool top = Ng.y > 0.5;
  vec3 Nw = top ? waterNormal(vWorldPos.xz, dist) : Ng;
  bool below = !gl_FrontFacing;
  if (below) Nw = -Nw;
  mat3 viewRot = mat3(viewMatrix);
  vec3 Nv = normalize(viewRot * Nw);
  vec3 Vv = normalize(-vViewPos);
  vec3 Vw = transpose(viewRot) * Vv;

  vec2 suv = gl_FragCoord.xy / uResolution;
  float waterZ = -vViewPos.z;
  vec4 behind = texture(uSceneCopy, suv);
  float thick = max(behind.a - waterZ, 0.0);

  // Refraction with Beer-Lambert absorption and in-scattering.
  vec2 roff = Nv.xy * 0.045 * saturate(thick * 0.4) / (1.0 + waterZ * 0.04);
  vec4 rs = texture(uSceneCopy, clamp(suv + roff, vec2(0.001), vec2(0.999)));
  if (rs.a < waterZ) rs = behind;
  float th = max(rs.a - waterZ, 0.0);
  vec3 trans = exp(-vec3(0.34, 0.068, 0.05) * th);
  float sky = vLight.x;
  vec3 scatterLight = uAmbientSky * 0.9 + uLightColor * 0.16 * saturate(uLightDir.y);
  vec3 scatter = vec3(0.05, 0.2, 0.235) * scatterLight * (0.25 + 0.75 * sky * sky);
  vec3 refr = rs.rgb * trans + scatter * (1.0 - exp(-th * 0.09));

  // Reflection: sky + screen-space reflections of the terrain.
  vec3 Rv = reflect(-Vv, Nv);
  vec3 Rw = transpose(viewRot) * Rv;
  vec3 refl = skyRadiance(normalize(vec3(Rw.x, max(Rw.y, 0.015), Rw.z)));
  if (Rw.y > 0.0) {
    float t = (uCloud.w - vWorldPos.y) / max(Rw.y, 0.02);
    float cov = cloudCoverage(vWorldPos.xz + Rw.xz * t) * exp(-t * 0.0004);
    refl = mix(refl, uAmbientSky * 1.1 + uLightColor * 0.5, cov * 0.8);
  }
  refl *= mix(0.15, 1.0, sky);
  if (uSSR > 0.5 && top && !below) {
    vec4 ssr = traceSSR(vViewPos, Rv);
    refl = mix(refl, ssr.rgb, ssr.a);
  }

  float NoV = saturate(dot(Nv, Vv));
  float F = 0.02 + 0.98 * pow(1.0 - NoV, 5.0);

  // Sun glint.
  float vis = shadowFactor(vRelPos, saturate(uLightDir.y)) * smoothstep(0.3, 0.85, sky) * cloudShadow(vWorldPos);
  vec3 H = normalize(uLightDir + Vw);
  float NoH = saturate(dot(Nw, H));
  float NoL = saturate(dot(Nw, uLightDir));
  float rough = 0.06;
  vec3 spec = uLightColor * D_GGX(NoH, rough) * V_SmithGGX(NoV + 1e-4, NoL, rough) * F * NoL * vis;

  vec3 color = mix(refr, refl, F) + spec;

  // Shoreline foam where the water is only a few pixels deep.
  if (top && !below) {
    float vdepth = thick * abs(Vw.y);
    float edge = 1.0 - smoothstep(0.02, 0.42, vdepth);
    if (edge > 0.0) {
      vec2 fp = vWorldPos.xz;
      float n1 = texture(uNoise, fp * 0.22 + vec2(uTime * 0.03, -uTime * 0.02)).g;
      float n2 = texture(uNoise, fp * 0.47 - vec2(uTime * 0.025, uTime * 0.035)).b;
      float foam = smoothstep(0.35, 0.75, n1 * 0.6 + n2 * 0.55 + edge * 0.45) * edge;
      vec3 foamLight = uAmbientSky * 0.9 + uLightColor * saturate(uLightDir.y) * vis * 0.8;
      color = mix(color, foamLight * 0.95, foam * 0.85);
    }
  }

  if (below) {
    // Looking up from underwater: Snell's window, total internal reflection outside it.
    float window = smoothstep(0.6, 0.72, NoV);
    vec3 deep = vec3(0.02, 0.09, 0.11) * scatterLight;
    color = mix(deep, rs.rgb * 0.85 + spec * 0.2, window);
  } else {
    color = applyFog(color, vRelPos, vWorldPos.y, sky);
  }
  fragColor = vec4(color, 1.0);
}
