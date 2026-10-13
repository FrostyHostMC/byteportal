// Movable block builds (ships, vehicles): block textures from the world's texture arrays.
in vec3 position;
in vec3 normal;
in vec2 uv;
in float layer;
in float ao;
uniform mat4 modelMatrix;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform mat4 viewMatrix;
uniform mat4 uShadowFromView;
uniform vec4 uShadowParams;

out vec3 vViewPos;
out vec3 vRelPos;
out vec3 vWorldPos;
out vec3 vNormal;
out vec2 vUv;
flat out float vLayer;
out float vAo;
out vec4 vShadowCoord;

void main() {
  vec4 viewPos = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * viewPos;
  mat3 viewRot = mat3(viewMatrix);
  vViewPos = viewPos.xyz;
  vRelPos = transpose(viewRot) * viewPos.xyz;
  vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  vUv = uv;
  vLayer = layer;
  vAo = ao;
  vShadowCoord = uShadowFromView * vec4(viewPos.xyz + viewRot * vNormal * uShadowParams.z, 1.0);
}
