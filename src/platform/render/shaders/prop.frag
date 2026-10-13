uniform sampler2DArray uAlbedo;
uniform sampler2DArray uMaterial;
uniform vec2 uProbe;  // sky, block light at the prop (0..1)
uniform vec4 uTint;   // rgb + strength: hit flash

in vec3 vViewPos;
in vec3 vRelPos;
in vec3 vWorldPos;
in vec3 vNormal;
in vec2 vUv;
flat in float vLayer;
in float vAo;

layout(location = 0) out vec4 fragColor;

void main() {
  vec3 tuv = vec3(vUv.x, 1.0 - vUv.y, vLayer);
  vec4 albedo = texture(uAlbedo, tuv);
  if (albedo.a < 0.5) discard;
  vec3 N = normalize(vNormal);
  float sky = uProbe.x;
  float blk = uProbe.y;
  float ndl = saturate(dot(N, uLightDir));
  float vis = 0.0;
  if (ndl > 0.0 && uLightDir.y > -0.05) vis = shadowFactor(vRelPos, ndl) * smoothstep(0.25, 0.8, sky) * cloudShadow(vWorldPos);
  vec3 direct = uLightColor * ndl * vis;
  vec3 amb = mix(uAmbientGround, uAmbientSky, N.y * 0.5 + 0.5) * max(sky * sky, 0.04);
  vec3 torch = uBlockLight * (pow(blk, 3.2) * 1.8 + blk * 0.06);
  vec4 mat = texture(uMaterial, tuv);
  // A little specular sheen from the material smoothness (concrete, iron, glass).
  vec3 V = normalize(-vRelPos);
  vec3 H = normalize(uLightDir + V);
  float spec = pow(saturate(dot(N, H)), 8.0 + mat.b * 120.0) * mat.b * 0.6 * vis;
  vec3 color = albedo.rgb * (direct + amb * vAo + torch * vAo + uMinLight) + uLightColor * spec;
  color += albedo.rgb * mat.a * 3.0;
  color = mix(color, uTint.rgb * (0.35 + luma(color) * 0.8), uTint.a);
  color = applyFog(color, vRelPos, vWorldPos.y, sky);
  fragColor = vec4(color, 1.0);
}
