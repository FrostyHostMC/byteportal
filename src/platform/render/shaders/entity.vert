in vec3 position;
in vec3 normal;
in vec2 uv;
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
out vec4 vShadowCoord;

void main() {
#ifdef SKINNED
  mat4 skin = skinMatrix();
  vec3 pos = (skin * vec4(position, 1.0)).xyz;
  vec3 nrm = mat3(skin) * normal;
#else
  vec3 pos = position;
  vec3 nrm = normal;
#endif
  vec4 viewPos = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * viewPos;
  mat3 viewRot = mat3(viewMatrix);
  vViewPos = viewPos.xyz;
  vRelPos = transpose(viewRot) * viewPos.xyz;
  vWorldPos = (modelMatrix * vec4(pos, 1.0)).xyz;
  vNormal = normalize(mat3(modelMatrix) * nrm);
  vUv = uv;
  vShadowCoord = uShadowFromView * vec4(viewPos.xyz + viewRot * vNormal * uShadowParams.z, 1.0);
}
