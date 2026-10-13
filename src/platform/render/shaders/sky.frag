uniform mat4 uInvViewProj;   // inverse(projection * view rotation)
uniform vec3 uMoonDir;
uniform vec3 uSunDisk;       // sun disk radiance
uniform vec3 uMoonDisk;
uniform float uNight;
uniform mat3 uStarRot;
uniform vec3 uCameraPos;
uniform float uTime;

in vec2 vNdc;
layout(location = 0) out vec4 fragColor;

vec3 stars(vec3 dir) {
  vec3 sd = uStarRot * dir;
  vec3 g = sd * 260.0;
  vec3 cell = floor(g);
  vec3 f = fract(g) - 0.5;
  float h = hash13(cell);
  vec3 col = vec3(0.0);
  if (h > 0.9955) {
    float b = (h - 0.9955) / 0.0045;
    float d = length(f);
    float tw = 0.75 + 0.25 * sin(uTime * (2.0 + h * 5.0) + h * 91.0);
    vec3 tint = mix(vec3(1.0, 0.82, 0.65), vec3(0.7, 0.82, 1.0), hash13(cell + 7.1));
    col += tint * smoothstep(0.32, 0.0, d) * b * b * tw * 2.5;
  }
  // Milky way band.
  float bd = dot(sd, normalize(vec3(0.3, 0.2, 0.93)));
  float band = exp(-bd * bd * 18.0);
  float n = texture(uNoise, sd.xz * 0.9 + sd.y * 0.3).r;
  col += vec3(0.5, 0.55, 0.75) * band * smoothstep(0.35, 0.8, n) * 0.06;
  return col;
}

void main() {
  vec4 p = uInvViewProj * vec4(vNdc, 1.0, 1.0);
  vec3 dir = normalize(p.xyz / p.w);
  vec3 col = skyRadiance(dir);

  float horizon = smoothstep(-0.08, 0.06, dir.y);
  if (uNight > 0.01) col += stars(dir) * uNight * horizon;

  // Sun disk with limb darkening.
  float cs = dot(dir, uSunDir);
  float sunEdge = 0.99955;
  if (cs > sunEdge - 0.0003) {
    float r = saturate((1.0 - cs) / (1.0 - sunEdge));
    float disk = smoothstep(1.0, 0.8, r);
    float limb = 0.55 + 0.45 * sqrt(saturate(1.0 - r * r));
    col += uSunDisk * disk * limb * horizon;
  }

  // Moon with a few craters.
  float cm = dot(dir, uMoonDir);
  float moonEdge = 0.99945;
  if (cm > moonEdge - 0.0003) {
    float r = saturate((1.0 - cm) / (1.0 - moonEdge));
    float disk = smoothstep(1.0, 0.85, r);
    vec3 side = normalize(cross(uMoonDir, vec3(0.0, 1.0, 0.0)));
    vec3 up = cross(side, uMoonDir);
    vec2 mp = vec2(dot(dir, side), dot(dir, up)) * 40.0;
    float craters = texture(uNoise, mp * 0.8 + 0.5).b;
    col += uMoonDisk * disk * (0.7 + 0.35 * craters) * horizon;
  }

  // Cloud layer.
  float t = (uCloud.w - uCameraPos.y) / dir.y;
  if (t > 0.0 && abs(dir.y) > 0.001) {
    vec2 cp = uCameraPos.xz + dir.xz * t;
    float cov = cloudCoverage(cp);
    if (cov > 0.002) {
      float toward = cloudCoverage(cp + uLightDir.xz * 90.0);
      float lightAmt = exp(-toward * 2.2) * 0.8 + 0.2;
      float mu = dot(dir, uLightDir);
      float phase = 0.6 + 1.6 * pow(saturate(mu), 12.0) + 0.3 * pow(saturate(mu), 2.0);
      vec3 cc = uAmbientSky * 1.25 + uLightColor * lightAmt * phase * 0.42;
      cc = mix(cc, cc * (0.7 + 0.3 * cov), 0.6);
      float fade = exp(-t * 0.00032) * smoothstep(0.0, 0.1, abs(dir.y));
      col = mix(col, cc, cov * fade * 0.94);
    }
  }
  fragColor = vec4(col, 1.0);
}
