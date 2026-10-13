// 3x3 tent upsample, blended additively onto the next larger mip.
uniform sampler2D uSrc;
uniform vec2 uTexel;
uniform float uRadius;
in vec2 vUv;
layout(location = 0) out vec4 fragColor;
void main() {
  vec2 t = uTexel * uRadius;
  vec3 s = texture(uSrc, vUv + vec2(-t.x, t.y)).rgb;
  s += texture(uSrc, vUv + vec2(0.0, t.y)).rgb * 2.0;
  s += texture(uSrc, vUv + vec2(t.x, t.y)).rgb;
  s += texture(uSrc, vUv + vec2(-t.x, 0.0)).rgb * 2.0;
  s += texture(uSrc, vUv).rgb * 4.0;
  s += texture(uSrc, vUv + vec2(t.x, 0.0)).rgb * 2.0;
  s += texture(uSrc, vUv + vec2(-t.x, -t.y)).rgb;
  s += texture(uSrc, vUv + vec2(0.0, -t.y)).rgb * 2.0;
  s += texture(uSrc, vUv + vec2(t.x, -t.y)).rgb;
  fragColor = vec4(s / 16.0, 1.0);
}
