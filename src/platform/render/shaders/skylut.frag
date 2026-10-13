// Physically based single-scattering atmosphere (Rayleigh + Mie + ozone) rendered into a small
// equirectangular LUT that every other pass samples for sky colour, fog and reflections.
uniform vec3 uSunDir;
uniform vec3 uMoonDir;
uniform float uSunIntensity;
uniform float uMoonIntensity;
in vec2 vUv;
layout(location = 0) out vec4 fragColor;

const float RG = 6360e3;
const float RT = 6440e3;
const vec3 BETA_R = vec3(5.802e-6, 13.558e-6, 33.1e-6);
const vec3 BETA_M = vec3(3.996e-6);
const vec3 BETA_O = vec3(0.650e-6, 1.881e-6, 0.085e-6);
const float HR = 8000.0;
const float HM = 1200.0;

vec2 raySphere(vec3 ro, vec3 rd, float r) {
  float b = dot(ro, rd);
  float c = dot(ro, ro) - r * r;
  float d = b * b - c;
  if (d < 0.0) return vec2(1e9, -1e9);
  d = sqrt(d);
  return vec2(-b - d, -b + d);
}

vec3 scatter(vec3 rd, vec3 L, float intensity) {
  if (intensity <= 0.0) return vec3(0.0);
  vec3 ro = vec3(0.0, RG + 250.0, 0.0);
  float tmax = raySphere(ro, rd, RT).y;
  vec2 tg = raySphere(ro, rd, RG);
  if (tg.x > 0.0) tmax = min(tmax, tg.x);
  const int N = 18;
  const int M = 6;
  float ds = tmax / float(N);
  float mu = dot(rd, L);
  float phaseR = 3.0 / (16.0 * PI) * (1.0 + mu * mu);
  const float g = 0.78;
  float phaseM = 3.0 / (8.0 * PI) * ((1.0 - g * g) * (1.0 + mu * mu)) / ((2.0 + g * g) * pow(1.0 + g * g - 2.0 * g * mu, 1.5));
  vec3 sumR = vec3(0.0);
  vec3 sumM = vec3(0.0);
  float odR = 0.0;
  float odM = 0.0;
  for (int i = 0; i < N; i++) {
    vec3 p = ro + rd * (ds * (float(i) + 0.5));
    float h = length(p) - RG;
    float hr = exp(-h / HR) * ds;
    float hm = exp(-h / HM) * ds;
    odR += hr;
    odM += hm;
    float tl = raySphere(p, L, RT).y;
    float dl = tl / float(M);
    float lR = 0.0;
    float lM = 0.0;
    bool lit = true;
    for (int j = 0; j < M; j++) {
      vec3 q = p + L * (dl * (float(j) + 0.5));
      float hl = length(q) - RG;
      if (hl < 0.0) { lit = false; break; }
      lR += exp(-hl / HR) * dl;
      lM += exp(-hl / HM) * dl;
    }
    if (lit) {
      vec3 tau = BETA_R * (odR + lR) + BETA_M * 1.1 * (odM + lM) + BETA_O * (odR + lR);
      vec3 att = exp(-tau);
      sumR += att * hr;
      sumM += att * hm;
    }
  }
  // Cheap multiple-scattering term: isotropic re-scattering of the single-scattered light keeps
  // the horizon bright and neutral instead of the dark orange band of pure single scattering.
  vec3 single = sumR * BETA_R * phaseR + sumM * BETA_M * phaseM;
  vec3 multi = (sumR * BETA_R + sumM * BETA_M) * (0.07 * smoothstep(-0.1, 0.25, L.y));
  return intensity * (single + multi);
}

void main() {
  vec3 d = skyLutDir(vUv);
  float below = min(d.y, 0.0);
  vec3 rd = normalize(vec3(d.x, max(d.y, 0.0), d.z));
  vec3 col = scatter(rd, uSunDir, uSunIntensity);
  // Moonlit sky reads as desaturated blue to the dark-adapted eye.
  vec3 moon = scatter(rd, uMoonDir, uMoonIntensity);
  col += luma(moon) * vec3(0.5, 0.68, 1.15);
  // Faint airglow so the night sky is deep blue rather than black.
  col += vec3(0.0016, 0.0024, 0.0048) * (1.0 - rd.y * 0.5);
  // Pull the horizon toward a cool white (multiple scattering the single-scatter model misses).
  float hz = exp(-abs(rd.y) * 9.0);
  col = mix(col, luma(col) * vec3(0.86, 0.95, 1.12), 0.4 * hz);
  col *= 1.0 + below * 1.6;
  fragColor = vec4(max(col, vec3(0.0)), 1.0);
}
