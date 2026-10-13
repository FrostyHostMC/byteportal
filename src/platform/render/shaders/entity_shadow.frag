uniform sampler2D uAtlas;
in vec2 vUv;
layout(location = 0) out vec4 fragColor;
void main() {
  if (texture(uAtlas, vUv).a < 0.5) discard;
  fragColor = vec4(0.0);
}
