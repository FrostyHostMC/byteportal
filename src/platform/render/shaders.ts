import common from './shaders/common.glsl?raw';
import unpack from './shaders/vertex_unpack.glsl?raw';
import lighting from './shaders/lighting.glsl?raw';
import shadowing from './shaders/shadowing.glsl?raw';
import chunkVert from './shaders/chunk.vert?raw';
import chunkFrag from './shaders/chunk.frag?raw';
import waterVert from './shaders/water.vert?raw';
import waterFrag from './shaders/water.frag?raw';
import shadowVert from './shaders/shadow.vert?raw';
import shadowFrag from './shaders/shadow.frag?raw';
import fullscreenVert from './shaders/fullscreen.vert?raw';
import copyFrag from './shaders/copy.frag?raw';
import skyLutFrag from './shaders/skylut.frag?raw';
import skyFrag from './shaders/sky.frag?raw';
import bloomDownFrag from './shaders/bloom_down.frag?raw';
import bloomUpFrag from './shaders/bloom_up.frag?raw';
import godraysFrag from './shaders/godrays.frag?raw';
import compositeFrag from './shaders/composite.frag?raw';
import entityVert from './shaders/entity.vert?raw';
import entityFrag from './shaders/entity.frag?raw';
import entityShadowVert from './shaders/entity_shadow.vert?raw';
import entityShadowFrag from './shaders/entity_shadow.frag?raw';
import skinning from './shaders/skinning.glsl?raw';
import fxVert from './shaders/fx.vert?raw';
import propVert from './shaders/prop.vert?raw';
import propFrag from './shaders/prop.frag?raw';
import propShadowVert from './shaders/prop_shadow.vert?raw';
import propShadowFrag from './shaders/prop_shadow.frag?raw';
import fxFrag from './shaders/fx.frag?raw';

const HEADER = `precision highp float;
precision highp int;
precision highp sampler2D;
precision highp sampler2DArray;
precision highp sampler2DShadow;
`;

const join = (...parts: string[]) => HEADER + parts.join('\n');

export const Shaders = {
  chunk: { vertex: join(common, unpack, chunkVert), fragment: join(common, lighting, shadowing, chunkFrag) },
  water: { vertex: join(common, unpack, waterVert), fragment: join(common, lighting, shadowing, waterFrag) },
  shadow: { vertex: join(common, unpack, shadowVert), fragment: join(common, shadowFrag) },
  copy: { vertex: join(fullscreenVert), fragment: join(copyFrag) },
  skyLut: { vertex: join(fullscreenVert), fragment: join(common, skyLutFrag) },
  sky: { vertex: join(fullscreenVert), fragment: join(common, lighting, skyFrag) },
  bloomDown: { vertex: join(fullscreenVert), fragment: join(common, bloomDownFrag) },
  bloomUp: { vertex: join(fullscreenVert), fragment: join(common, bloomUpFrag) },
  godrays: { vertex: join(fullscreenVert), fragment: join(common, godraysFrag) },
  composite: { vertex: join(fullscreenVert), fragment: join(common, compositeFrag) },
  entity: { vertex: join(common, skinning, entityVert), fragment: join(common, lighting, shadowing, entityFrag) },
  entityShadow: { vertex: join(skinning, entityShadowVert), fragment: join(entityShadowFrag) },
  fx: { vertex: join(fxVert), fragment: join(common, fxFrag) },
  prop: { vertex: join(common, propVert), fragment: join(common, lighting, shadowing, propFrag) },
  propShadow: { vertex: join(propShadowVert), fragment: join(propShadowFrag) },
};
