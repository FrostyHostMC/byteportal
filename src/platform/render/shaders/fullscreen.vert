in vec3 position;
out vec2 vUv;
out vec2 vNdc;
void main() {
  vNdc = position.xy;
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 1.0, 1.0);
}
