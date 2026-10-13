in vec3 position;
in vec2 uv;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
out vec2 vUv;
void main() {
  vUv = uv;
#ifdef SKINNED
  vec3 pos = (skinMatrix() * vec4(position, 1.0)).xyz;
#else
  vec3 pos = position;
#endif
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
