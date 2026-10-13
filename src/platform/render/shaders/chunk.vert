uniform mat4 modelMatrix;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform mat4 viewMatrix;
uniform mat4 uShadowFromView;
uniform vec4 uShadowParams;

out vec3 vViewPos;
out vec3 vRelPos;
out vec3 vWorldPos;
out vec2 vUV;
out vec3 vNormal;
out vec3 vTangent;
out vec3 vBitangent;
out vec4 vLight;
out vec4 vShadowCoord;
flat out uint vLayer;
flat out uint vFlags;

void main() {
  vec3 origin = modelMatrix[3].xyz;
  Vtx v = unpackVertex(origin);
  vec4 viewPos = modelViewMatrix * vec4(v.pos, 1.0);
  gl_Position = projectionMatrix * viewPos;
  mat3 viewRot = mat3(viewMatrix);
  vViewPos = viewPos.xyz;
  vRelPos = transpose(viewRot) * viewPos.xyz;
  vWorldPos = origin + v.pos;
  vUV = v.uv;
  vNormal = v.normal;
  vTangent = v.tangent;
  vBitangent = v.bitangent;
  vLight = vec4(v.sky, v.blk, v.ao, v.tint);
  vLayer = v.layer;
  vFlags = (v.normalIdx >= 6u ? 1u : 0u) | (v.cutout > 0.5 ? 2u : 0u) | (v.fine ? 4u : 0u);
  float off = uShadowParams.z * (v.normalIdx >= 6u ? 0.25 : 1.0);
  vShadowCoord = uShadowFromView * vec4(viewPos.xyz + viewRot * v.normal * off, 1.0);
}
