uniform mat4 modelMatrix;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;

out vec2 vUV;
flat out uint vLayer;
flat out float vCutout;

void main() {
  Vtx v = unpackVertex(modelMatrix[3].xyz);
  vUV = v.uv;
  vLayer = v.layer;
  vCutout = v.cutout;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(v.pos, 1.0);
}
