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
out vec4 vLight;
out vec4 vShadowCoord;

void main() {
  vec3 origin = modelMatrix[3].xyz;
  Vtx v = unpackVertex(origin);
  vec4 viewPos = modelViewMatrix * vec4(v.pos, 1.0);
  gl_Position = projectionMatrix * viewPos;
  mat3 viewRot = mat3(viewMatrix);
  vViewPos = viewPos.xyz;
  vRelPos = transpose(viewRot) * viewPos.xyz;
  vWorldPos = origin + v.pos;
  vNormal = v.normal;
  vLight = vec4(v.sky, v.blk, v.ao, 0.0);
  vShadowCoord = uShadowFromView * vec4(viewPos.xyz + viewRot * v.normal * uShadowParams.z, 1.0);
}
