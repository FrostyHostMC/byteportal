// Shadow-map sampling (terrain and water fragment shaders only).
uniform sampler2DShadow uShadowMap;

in vec4 vShadowCoord;

const vec2 POISSON[8] = vec2[](
  vec2(-0.7071, 0.7071), vec2(-0.0000, -0.8750), vec2(0.5303, 0.5303), vec2(-0.6250, -0.0000),
  vec2(0.3536, -0.3536), vec2(-0.0000, 0.3750), vec2(-0.1768, -0.1768), vec2(0.1250, 0.0000)
);

float shadowFactor(vec3 rel, float ndl) {
  if (uShadowParams.w < 0.5) return 1.0;
  vec3 sc = vShadowCoord.xyz / vShadowCoord.w;
  if (sc.x <= 0.002 || sc.x >= 0.998 || sc.y <= 0.002 || sc.y >= 0.998 || sc.z >= 1.0) return 1.0;
  float a = ign(gl_FragCoord.xy) * TAU;
  float ca = cos(a), sa = sin(a);
  mat2 rot = mat2(ca, sa, -sa, ca);
  float r = uShadowParams.x * 1.75;
  float bias = 0.00004 + 0.00014 * (1.0 - ndl);
  float s = 0.0;
  for (int i = 0; i < 8; i++) {
    s += texture(uShadowMap, vec3(sc.xy + rot * POISSON[i] * r, sc.z - bias));
  }
  s *= 0.125;
  float d = length(rel.xz);
  return mix(s, 1.0, smoothstep(uShadowParams.y * 0.8, uShadowParams.y * 0.97, d));
}

