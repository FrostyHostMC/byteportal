// ---------------------------------------------------------------------------------------------
// Skinning, for a glTF model's skinned meshes (materials made with SKINNED defined). Each vertex
// is moved by up to four bones, weighted; the bones' matrices come in three.js's bone texture
// (four texels a bone), bound for any skinned mesh as for three.js's own materials.
// ---------------------------------------------------------------------------------------------
#ifdef SKINNED
in vec4 skinIndex;
in vec4 skinWeight;
uniform mat4 bindMatrix;
uniform mat4 bindMatrixInverse;
uniform highp sampler2D boneTexture;

mat4 boneMatrix(float i) {
  int size = textureSize(boneTexture, 0).x;
  int j = int(i) * 4;
  int x = j % size;
  int y = j / size;
  return mat4(
    texelFetch(boneTexture, ivec2(x, y), 0),
    texelFetch(boneTexture, ivec2(x + 1, y), 0),
    texelFetch(boneTexture, ivec2(x + 2, y), 0),
    texelFetch(boneTexture, ivec2(x + 3, y), 0)
  );
}

// The vertex's bones blended, in the mesh's own space: its position and normal as they move it.
mat4 skinMatrix() {
  mat4 m = skinWeight.x * boneMatrix(skinIndex.x) + skinWeight.y * boneMatrix(skinIndex.y) + skinWeight.z * boneMatrix(skinIndex.z) + skinWeight.w * boneMatrix(skinIndex.w);
  return bindMatrixInverse * m * bindMatrix;
}
#endif
