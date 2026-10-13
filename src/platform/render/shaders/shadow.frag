uniform sampler2DArray uAlbedo;

in vec2 vUV;
flat in uint vLayer;
flat in float vCutout;

layout(location = 0) out vec4 fragColor;

void main() {
  if (vCutout > 0.5) {
    vec2 tuv = vec2(fract(vUV.x), 1.0 - fract(vUV.y));
    float a = textureLod(uAlbedo, vec3(tuv, float(vLayer)), 1.0).a;
    if (a < 0.5) discard;
  }
  fragColor = vec4(0.0);
}
