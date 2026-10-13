uniform sampler2D uAtlas;
uniform sampler2D uEmissiveMap;
uniform sampler2D uMaterialMap; // glTF metallic-roughness: G roughness, B metalness
uniform vec2 uMaterial;         // metalness and roughness factors (0, 1: the platform's own matte look)
uniform vec2 uProbe;     // sky, block light at the entity (0..1)
uniform vec4 uTint;      // rgb + strength: hurt flash / wind-up glow
uniform float uOpacity;  // dithered fade-out on death

in vec3 vViewPos;
in vec3 vRelPos;
in vec3 vWorldPos;
in vec3 vNormal;
in vec2 vUv;

layout(location = 0) out vec4 fragColor;

void main() {
  vec4 albedo = texture(uAtlas, vUv);
  if (albedo.a < 0.5) discard;
  if (uOpacity < 0.999 && ign(gl_FragCoord.xy) > uOpacity) discard;
  vec3 N = normalize(vNormal);
  if (!gl_FrontFacing) N = -N;
  float sky = uProbe.x;
  float blk = uProbe.y;
  float ndl = saturate(dot(N, uLightDir));
  float vis = 0.0;
  if (ndl > 0.0 && uLightDir.y > -0.05) vis = shadowFactor(vRelPos, ndl) * smoothstep(0.25, 0.8, sky) * cloudShadow(vWorldPos);
  vec3 direct = uLightColor * ndl * vis;
  vec3 amb = mix(uAmbientGround, uAmbientSky, N.y * 0.5 + 0.5) * max(sky * sky, 0.04);
  vec3 torch = uBlockLight * (pow(blk, 3.2) * 1.8 + blk * 0.06);
  // Gentle wrap light so shaded sides keep their shape.
  float wrap = saturate(dot(N, uLightDir) * 0.5 + 0.5) * 0.12;
  // Metal and gloss (a glTF model's material): the diffuse gives way to the metal's colour, and the
  // sun and the sky shine off it. Fully rough and not metal (every box model) is as ever.
  vec4 mr = texture(uMaterialMap, vUv);
  float metal = saturate(uMaterial.x * mr.b);
  float rough = clamp(uMaterial.y * mr.g, 0.06, 1.0);
  vec3 color = albedo.rgb * (1.0 - metal) * (direct + amb * (0.85 + wrap) + torch + uMinLight);
  if (metal > 0.001 || rough < 0.97) {
    vec3 V = normalize(-vRelPos);
    float NoV = max(dot(N, V), 1e-3);
    vec3 F0 = mix(vec3(0.04), albedo.rgb, metal);
    float a = rough * rough;
    vec3 H = normalize(uLightDir + V);
    vec3 F = F0 + (1.0 - F0) * pow(1.0 - saturate(dot(V, H)), 5.0);
    color += uLightColor * D_GGX(saturate(dot(N, H)), a) * V_SmithGGX(NoV, ndl, a) * F * ndl * vis;
    // The sky (and the ground below the horizon) in it, blurring toward the ambient as it roughens.
    vec3 R = reflect(-V, N);
    vec3 sharp = R.y > 0.0 ? skyRadiance(normalize(vec3(R.x, max(R.y, 0.02), R.z))) : mix(uAmbientSky, uAmbientGround, 0.7) * 0.6;
    vec3 soft = mix(uAmbientGround, uAmbientSky, R.y * 0.5 + 0.5);
    vec3 Fv = F0 + (max(vec3(1.0 - rough), F0) - F0) * pow(1.0 - NoV, 5.0);
    vec3 env = mix(sharp, soft, rough) * max(sky * sky, 0.05) + torch * 0.5;
    color += env * Fv * mix(1.0, 0.35, rough);
  }
  color += albedo.rgb * texture(uEmissiveMap, vUv).r * 4.0;
  color = mix(color, uTint.rgb * (0.35 + luma(color) * 0.8), uTint.a);
  color = applyFog(color, vRelPos, vWorldPos.y, sky);
  fragColor = vec4(color, 1.0);
}
