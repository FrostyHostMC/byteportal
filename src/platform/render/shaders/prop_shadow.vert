in vec3 position;
in vec2 uv;
in float layer;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
out vec2 vUv;
flat out float vLayer;
void main() {
  vUv = uv;
  vLayer = layer;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
