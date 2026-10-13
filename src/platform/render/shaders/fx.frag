// Additive glow used by beams, shockwaves and pickup halos.
uniform vec3 uColor;
uniform float uIntensity;
uniform float uTime;
uniform float uMode;  // 0 = beam (fade along v), 1 = ring (fade toward edges), 2 = soft disc, 3 = bolt
in vec2 vUv;
layout(location = 0) out vec4 fragColor;
void main() {
  float a;
  if (uMode < 0.5) {
    float edge = 1.0 - abs(vUv.x - 0.5) * 2.0;
    a = pow(edge, 2.0) * pow(1.0 - vUv.y, 1.5) * (0.8 + 0.2 * sin(uTime * 4.0 + vUv.y * 12.0));
  } else if (uMode < 1.5) {
    float d = length(vUv - 0.5) * 2.0;
    a = smoothstep(0.62, 0.88, d) * smoothstep(1.0, 0.9, d);
  } else if (uMode < 2.5) {
    float d = length(vUv - 0.5) * 2.0;
    a = pow(saturate(1.0 - d), 2.2);
  } else {
    // Laser bolt: soft across, rounded ends, a white-hot core.
    float across = 1.0 - abs(vUv.x - 0.5) * 2.0;
    float along = smoothstep(0.0, 0.18, vUv.y) * smoothstep(1.0, 0.82, vUv.y);
    // Alpha-blended (not additive) so a red bolt stays red against a bright sky; HDR so it blooms.
    a = saturate(pow(across, 0.9) * along * 1.25);
    float core = pow(across, 5.0) * along;
    fragColor = vec4(mix(uColor, vec3(1.0), core * 0.3) * uIntensity, a);
    return;
  }
  fragColor = vec4(uColor * a * uIntensity, 1.0);
}
