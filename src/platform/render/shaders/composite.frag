uniform sampler2D uScene;
uniform sampler2D uDepth;
uniform sampler2D uBloom;
uniform sampler2D uRays;
uniform float uBloomStrength;
uniform vec3 uRayColor;
uniform float uExposure;
uniform float uUnderwater;    // 0 = air, 1 = water, 2 = lava
uniform vec3 uWaterFog;
uniform float uNear;
uniform float uFar;
uniform float uTime;
uniform float uSaturation;
uniform float uVignette;
uniform vec2 uResolution;
in vec2 vUv;
layout(location = 0) out vec4 fragColor;

// ACES filmic fit (Stephen Hill).
vec3 RRTAndODTFit(vec3 v) {
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return a / b;
}
vec3 aces(vec3 c) {
  const mat3 IN = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
  const mat3 OUT = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
  return saturate(OUT * RRTAndODTFit(IN * c));
}

vec3 linearToSRGB(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

void main() {
  vec2 uv = vUv;
  if (uUnderwater > 0.5) {
    uv += vec2(sin(uv.y * 24.0 + uTime * 2.1), cos(uv.x * 19.0 + uTime * 1.7)) * 0.0022;
  }
  vec3 c = texture(uScene, uv).rgb;
  if (any(isnan(c))) c = vec3(0.0);
  c += texture(uBloom, uv).rgb * uBloomStrength;
  c += texture(uRays, uv).rgb * uRayColor;

  if (uUnderwater > 0.5) {
    float d = texture(uDepth, uv).r;
    float z = d * 2.0 - 1.0;
    float lin = (2.0 * uNear * uFar) / (uFar + uNear - z * (uFar - uNear));
    float density = uUnderwater > 1.5 ? 1.2 : 0.07;
    float f = 1.0 - exp(-lin * density);
    c = mix(c * (uUnderwater > 1.5 ? vec3(1.0) : vec3(0.55, 0.85, 0.95)), uWaterFog, f);
  }

  c *= uExposure;
  c = aces(c);
  float l = luma(c);
  c = mix(vec3(l), c, uSaturation);
  // Gentle S-curve for contrast.
  c = c * c * (3.0 - 2.0 * c) * 0.18 + c * 0.82;
  vec2 q = vUv - 0.5;
  c *= 1.0 - uVignette * dot(q, q) * 1.6;
  c = linearToSRGB(saturate(c));
  // Blue-noise-ish dither to kill banding in the sky.
  c += (ign(gl_FragCoord.xy + fract(uTime) * 91.0) - 0.5) / 255.0;
  fragColor = vec4(c, 1.0);
}
