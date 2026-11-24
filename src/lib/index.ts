/**
 * YSM Three.js Model & Animation Engine (Tree-shakable ESM entry point)
 *
 * Pure parsing/evaluation modules (`BedrockModelParser`, `BedrockAnimationParser`,
 * `MolangEvaluator`, `KeyframeTrack`, `AnimationController`) have zero Three.js
 * dependencies and can be tree-shaken independently for custom 3D engines.
 */

// 1. Pure Parser Layer (zero Three.js dependency)
export {
  BedrockModelParser,
  computeBoxUVs,
  computePerFaceUVs,
  type BedrockModelParseOptions,
} from './parser/BedrockModelParser';
export { BedrockAnimationParser } from './parser/BedrockAnimationParser';
export type {
  AnimationLoopMode,
  BoneChannelType,
  CubeFaceName,
  CubeUVMap,
  InterpolationMode,
  MolangValue,
  MolangVec3,
  NormalizedFaceUV,
  ParsedAnimationClip,
  ParsedAnimationSet,
  ParsedBone,
  ParsedBoneAnimation,
  ParsedBoneChannel,
  ParsedCube,
  ParsedKeyframe,
  ParsedLocator,
  ParsedModel,
  ParsedModelDescription,
  Vec2,
  Vec3,
  YsmManifest,
  YsmTextureDescriptor,
} from './parser/types';

// 2. Pure MoLang Engine (zero Three.js dependency)
export {
  MolangEvaluator,
  type CompiledMolangFn,
  type MolangEvalContext,
  type MolangQueryContext,
} from './molang/MolangEvaluator';

// 3. Pure Animation Engine (zero Three.js dependency)
export { KeyframeTrack } from './animation/KeyframeTrack';
export {
  AnimationController,
  type ActiveLayerInfo,
  type BonePoseDelta,
  type PlayOptions,
} from './animation/AnimationController';

// 4. Three.js WebGL2 Rendering Layer
export {
  BEDROCK_UNIT_SCALE,
  buildCubeGeometry,
} from './renderer/CubeGeometryBuilder';
export {
  TextureManager,
  configureBedrockTexture,
  type ManagedMaterialTable,
  type TextureEntryInput,
} from './renderer/TextureManager';
export {
  bedrockPointToThree,
  buildModelRig,
  setBedrockEulerDegrees,
  type BoneRigNode,
  type BuiltRig,
  type SkeletonDebugResources,
} from './renderer/RigBuilder';

// 5. Multi-Source Loader & Archive Extension Registry
export {
  registerArchiveParser,
  unregisterArchiveParser,
  getRegisteredArchiveParsers,
  findMatchingArchiveParser,
} from './loader/ArchiveRegistry';
export {
  YsmModelInstance,
  type DebugDisplayOptions,
  type ModelResourceStats,
} from './loader/YsmModelInstance';
export {
  YsmModelLoader,
  isZipBytes,
  unpackArchiveBytes,
} from './loader/YsmModelLoader';
export type {
  VirtualFileSystem,
  YsmArchiveParser,
  YsmLoadOptions,
  YsmLoadSource,
  YsmPackFilesInput,
} from './loader/types';
