// Screen-space crepuscular rays: radial blur of sky visibility toward the sun.
uniform sampler2D uDepth;
uniform vec2 uSunUV;
uniform float uAspect;
uniform float uIntensity;
in vec2 vUv;
layout(location = 0) out vec4 fragColor;

float skyMask(vec2 uv) {
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return 0.0;
  float d = texture(uDepth, uv).r;
  if (d < 0.99999) return 0.0;
  vec2 v = (uv - uSunUV) * vec2(uAspect, 1.0);
  return pow(saturate(1.0 - length(v) * 1.6), 3.0);
}

void main() {
  const int N = 48;
  vec2 delta = (vUv - uSunUV) / float(N) * 0.92;
  float jitter = ign(gl_FragCoord.xy);
  vec2 p = vUv - delta * jitter;
  float decay = 1.0;
  float sum = 0.0;
  for (int i = 0; i < N; i++) {
    sum += skyMask(p) * decay;
    decay *= 0.965;
    p -= delta;
  }
  fragColor = vec4(vec3(sum / float(N) * uIntensity), 1.0);
}
