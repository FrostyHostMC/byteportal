// ---------------------------------------------------------------------------------------------
// Shared helpers (prepended to most shaders).
// ---------------------------------------------------------------------------------------------
#define PI 3.14159265359
#define TAU 6.28318530718

float saturate(float x) { return clamp(x, 0.0, 1.0); }
vec3 saturate(vec3 x) { return clamp(x, 0.0, 1.0); }
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}

float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}

// Interleaved gradient noise (Jimenez), stable per pixel.
float ign(vec2 p) {
  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}

// Equirectangular sky LUT parameterisation with extra resolution near the horizon.
vec2 skyLutUV(vec3 d) {
  float az = atan(d.z, d.x);
  float el = asin(clamp(d.y, -1.0, 1.0));
  float v = 0.5 + 0.5 * sign(el) * sqrt(abs(el) / (0.5 * PI));
  return vec2(az / TAU + 0.5, v);
}

vec3 skyLutDir(vec2 uv) {
  float az = (uv.x - 0.5) * TAU;
  float t = uv.y * 2.0 - 1.0;
  float el = sign(t) * t * t * 0.5 * PI;
  float c = cos(el);
  return vec3(cos(az) * c, sin(el), sin(az) * c);
}
