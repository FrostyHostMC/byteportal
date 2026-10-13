// 13-tap downsample (Jimenez, CoD: AW). The first pass applies a soft threshold and a Karis
// average to suppress fireflies.
uniform sampler2D uSrc;
uniform vec2 uTexel;
uniform float uPrefilter;
uniform vec4 uThreshold; // x: threshold, y: knee
in vec2 vUv;
layout(location = 0) out vec4 fragColor;

vec3 prefilter(vec3 c) {
  float br = max(c.r, max(c.g, c.b));
  float rq = clamp(br - uThreshold.x + uThreshold.y, 0.0, 2.0 * uThreshold.y);
  rq = rq * rq / (4.0 * uThreshold.y + 1e-5);
  float w = max(rq, br - uThreshold.x) / max(br, 1e-5);
  return c * w;
}

float karis(vec3 c) { return 1.0 / (1.0 + luma(c)); }

void main() {
  vec2 t = uTexel;
  vec3 a = texture(uSrc, vUv + t * vec2(-2, 2)).rgb;
  vec3 b = texture(uSrc, vUv + t * vec2(0, 2)).rgb;
  vec3 c = texture(uSrc, vUv + t * vec2(2, 2)).rgb;
  vec3 d = texture(uSrc, vUv + t * vec2(-2, 0)).rgb;
  vec3 e = texture(uSrc, vUv).rgb;
  vec3 f = texture(uSrc, vUv + t * vec2(2, 0)).rgb;
  vec3 g = texture(uSrc, vUv + t * vec2(-2, -2)).rgb;
  vec3 h = texture(uSrc, vUv + t * vec2(0, -2)).rgb;
  vec3 i = texture(uSrc, vUv + t * vec2(2, -2)).rgb;
  vec3 j = texture(uSrc, vUv + t * vec2(-1, 1)).rgb;
  vec3 k = texture(uSrc, vUv + t * vec2(1, 1)).rgb;
  vec3 l = texture(uSrc, vUv + t * vec2(-1, -1)).rgb;
  vec3 m = texture(uSrc, vUv + t * vec2(1, -1)).rgb;
  vec3 res;
  if (uPrefilter > 0.5) {
    vec3 g0 = (a + b + d + e) * 0.25;
    vec3 g1 = (b + c + e + f) * 0.25;
    vec3 g2 = (d + e + g + h) * 0.25;
    vec3 g3 = (e + f + h + i) * 0.25;
    vec3 g4 = (j + k + l + m) * 0.25;
    float w0 = karis(g0), w1 = karis(g1), w2 = karis(g2), w3 = karis(g3), w4 = karis(g4);
    res = (g0 * w0 * 0.125 + g1 * w1 * 0.125 + g2 * w2 * 0.125 + g3 * w3 * 0.125 + g4 * w4 * 0.5) /
          (w0 * 0.125 + w1 * 0.125 + w2 * 0.125 + w3 * 0.125 + w4 * 0.5);
    res = prefilter(res);
  } else {
    res = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  }
  // Never let a stray NaN / Inf smear across the whole mip chain.
  if (any(isnan(res)) || any(isinf(res))) res = vec3(0.0);
  fragColor = vec4(min(res, vec3(6.0e4)), 1.0);
}
