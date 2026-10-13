// ---------------------------------------------------------------------------------------------
// Lighting environment, shadows, clouds and fog shared by terrain and water.
// ---------------------------------------------------------------------------------------------
uniform sampler2D uSkyLut;
uniform sampler2D uNoise;

uniform vec3 uSunDir;       // toward the sun
uniform vec3 uLightDir;     // toward the dominant light (sun or moon)
uniform vec3 uLightColor;   // direct radiance of the dominant light (includes transmittance)
uniform vec3 uAmbientSky;   // irradiance from the upper hemisphere
uniform vec3 uAmbientGround;
uniform vec3 uBlockLight;   // colour of torch / lava light
uniform vec3 uMinLight;     // floor so caves are never pitch black
uniform vec4 uFog;          // x: haze density, y: fade start, z: fade end, w: underwater
uniform float uVoid;        // 1 = no ground below the horizon (sky islands): the sky fades into a deep abyss
uniform vec4 uShadowParams; // x: texel size (uv), y: radius (blocks), z: normal offset, w: enabled
uniform vec4 uCloud;        // x: coverage, yz: uv scroll, w: cloud altitude

float cloudCoverage(vec2 p) {
  vec2 uv = p * (1.0 / 2600.0) + uCloud.yz;
  float base = texture(uNoise, uv).r;
  float billow = texture(uNoise, uv * 2.1 + vec2(0.37, 0.11)).b;
  float detail = texture(uNoise, uv * 5.3 + vec2(0.71, 0.29)).g;
  float n = base * 0.62 + billow * 0.3 + detail * 0.12;
  float c = uCloud.x;
  return smoothstep(0.66 - c * 0.28, 0.8 - c * 0.28, n);
}

// Cloud shadow on the ground for the dominant light.
float cloudShadow(vec3 worldPos) {
  float t = (uCloud.w - worldPos.y) / max(uLightDir.y, 0.08);
  vec2 p = worldPos.xz + uLightDir.xz * t;
  return 1.0 - cloudCoverage(p) * 0.72;
}

vec3 skyRadiance(vec3 dir) {
  if (uVoid > 0.5 && dir.y < 0.02) {
    // Below the horizon of a void world: the horizon haze deepening into a dusky abyss.
    vec3 hz = texture(uSkyLut, skyLutUV(normalize(vec3(dir.x, 0.02, dir.z)))).rgb;
    vec3 deep = uAmbientSky * 0.28 + hz * 0.08;
    return mix(hz, deep, smoothstep(0.0, 0.7, -dir.y + 0.02));
  }
  return texture(uSkyLut, skyLutUV(dir)).rgb;
}

// Aerial perspective + render-distance fade. `skyVis` darkens fog seen deep underground.
vec3 applyFog(vec3 color, vec3 rel, float worldY, float skyVis) {
  float dist = length(rel);
  vec3 dir = rel / max(dist, 1e-4);
  vec3 fogCol = skyRadiance(vec3(dir.x, max(dir.y, uVoid > 0.5 ? -1.0 : -0.2), dir.z));
  fogCol *= mix(0.06, 1.0, smoothstep(0.0, 0.55, skyVis));
  float heightF = exp(-max(worldY - 63.0, 0.0) * 0.011);
  float haze = 1.0 - exp(-dist * uFog.x * heightF);
  // Short-range haze must not pick up the full-atmosphere Mie glow around the sun.
  vec3 hazeCol = fogCol / (1.0 + luma(fogCol) * 0.6);
  color = mix(color, hazeCol, haze);
  float edge = smoothstep(uFog.y, uFog.z, dist);
  return mix(color, fogCol, edge);
}

float D_GGX(float NoH, float a) {
  float a2 = a * a;
  float f = (NoH * a2 - NoH) * NoH + 1.0;
  return a2 / (PI * f * f + 1e-7);
}

float V_SmithGGX(float NoV, float NoL, float a) {
  float a2 = a * a;
  float gl = NoV * sqrt((-NoL * a2 + NoL) * NoL + a2);
  float gv = NoL * sqrt((-NoV * a2 + NoV) * NoV + a2);
  return 0.5 / (gl + gv + 1e-5);
}
