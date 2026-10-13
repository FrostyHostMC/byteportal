uniform sampler2DArray uAlbedo;
in vec2 vUv;
flat in float vLayer;
layout(location = 0) out vec4 fragColor;
void main() {
  if (texture(uAlbedo, vec3(vUv.x, 1.0 - vUv.y, vLayer)).a < 0.5) discard;
  fragColor = vec4(0.0);
}
