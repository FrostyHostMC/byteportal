uniform sampler2D uColor;
uniform sampler2D uDepth;
uniform float uNear;
uniform float uFar;
in vec2 vUv;
layout(location = 0) out vec4 fragColor;
void main() {
  vec3 c = texture(uColor, vUv).rgb;
  float d = texture(uDepth, vUv).r;
  float z = d * 2.0 - 1.0;
  float lin = d >= 1.0 ? uFar : (2.0 * uNear * uFar) / (uFar + uNear - z * (uFar - uNear));
  fragColor = vec4(c, lin);
}
