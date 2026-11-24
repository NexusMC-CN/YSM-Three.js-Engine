/**
 * Pure TypeScript IR types for Minecraft Bedrock 1.12.0+ geometry,
 * 1.8.0+ animations, and Yes Steve Model (YSM) manifests.
 *
 * Strictly zero Three.js dependencies so parser/molang/animation layers
 * can be tree-shaken and integrated into any custom 3D engine.
 */

export type Vec2 = [number, number];
export type Vec3 = [number, number, number];

export type CubeFaceName = 'east' | 'west' | 'up' | 'down' | 'south' | 'north';

/**
 * Normalized UV rectangle in [0, 1] texture coordinates (top-left origin, flipY = false).
 * u0 -> u1 runs left-to-right across the face when viewed from outside.
 * v0 -> v1 runs top-to-bottom across the face when viewed from outside.
 */
export interface NormalizedFaceUV {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
  /** Optional texture rotation in degrees (0, 90, 180, 270) for per-face UV */
  uvRotation?: number;
  /** True if the face has zero area or was omitted in per-face UV mode */
  hidden?: boolean;
}

export type CubeUVMap = Record<CubeFaceName, NormalizedFaceUV>;

export interface ParsedCube {
  /** Bedrock origin [ox, oy, oz] in pixel units (16 units = 1 block) */
  origin: Vec3;
  /** Raw Bedrock size [sx, sy, sz] before inflate */
  size: Vec3;
  /** Bidirectional outer expansion in Bedrock units */
  inflate: number;
  /** Effective dimensions after applying 2 * inflate on each axis */
  inflatedSize: Vec3;
  /** Center point in Bedrock model space [ox + sx/2, oy + sy/2, oz + sz/2] */
  center: Vec3;
  /** Optional cube-local pivot in Bedrock space */
  pivot?: Vec3;
  /** Optional cube-local rotation in degrees [rx, ry, rz] */
  rotation?: Vec3;
  /** Whether East/West UVs and horizontal face UVs are mirrored */
  mirror: boolean;
  /** UV mode used by this cube */
  uvMode: 'box' | 'per-face';
  /** Computed 6-face normalized UV coordinates */
  uvs: CubeUVMap;
  /** Optional material/texture index derived from UV vertical page offset or material tag */
  textureIndex: number;
  /** Optional explicit material/texture key */
  materialKey?: string;
}

export interface ParsedLocator {
  name: string;
  offset: Vec3;
  rotation?: Vec3;
}

export interface ParsedBone {
  name: string;
  parent?: string;
  /** Rotation pivot in Bedrock model space */
  pivot: Vec3;
  /** Initial bind rotation in degrees [rx, ry, rz] */
  rotation: Vec3;
  /** Default bone-level mirror flag inherited by cubes unless overridden */
  mirror: boolean;
  /** Default bone-level inflate inherited by cubes unless overridden */
  inflate: number;
  /** Optional explicit material/texture key for this bone */
  materialKey?: string;
  /** Cubes rigidly attached to this bone */
  cubes: ParsedCube[];
  /** Reserved for Phase 2 locator attachment points */
  locators: ParsedLocator[];
  /** Reserved for Phase 2 poly_mesh raw passthrough */
  hasPolyMesh?: boolean;
  /** Ordered names of direct child bones */
  children: string[];
}

export interface ParsedModelDescription {
  identifier: string;
  textureWidth: number;
  textureHeight: number;
  visibleBoundsWidth: number;
  visibleBoundsHeight: number;
  visibleBoundsOffset: Vec3;
}

export interface ParsedModel {
  formatVersion: string;
  description: ParsedModelDescription;
  /** Topologically sorted bones (parents always appear before children) */
  bones: ParsedBone[];
  /** Fast lookup map by bone name */
  boneMap: Record<string, ParsedBone>;
  /** Root bone names (bones without parents) */
  rootBones: string[];
  /** Total cube count across all bones */
  cubeCount: number;
  /** Optional texture slots referenced by the model or manifest */
  textures: string[];
}

/* ============================================================================
 * Bedrock 1.8.0+ Animation IR
 * ============================================================================ */

export type AnimationLoopMode = 'loop' | 'once' | 'hold_on_last_frame';
export type InterpolationMode = 'linear' | 'step' | 'catmullrom';
export type BoneChannelType = 'rotation' | 'position' | 'scale';

/** A single scalar value inside a keyframe: either a constant number or a MoLang expression string */
export type MolangValue = number | string;
export type MolangVec3 = [MolangValue, MolangValue, MolangValue];

export interface ParsedKeyframe {
  /** Keyframe timestamp in seconds */
  time: number;
  /** Incoming value when approaching this timestamp (supports discontinuous pre/post steps) */
  pre: MolangVec3;
  /** Outgoing value when leaving this timestamp */
  post: MolangVec3;
  /** Interpolation mode from this keyframe to the next */
  lerpMode: InterpolationMode;
}

export interface ParsedBoneChannel {
  channel: BoneChannelType;
  /** Static single-frame value (when JSON specifies a constant/expression without timestamps) */
  staticValue?: MolangVec3;
  /** Time-sorted keyframe array */
  keyframes: ParsedKeyframe[];
}

export interface ParsedBoneAnimation {
  boneName: string;
  rotation?: ParsedBoneChannel;
  position?: ParsedBoneChannel;
  scale?: ParsedBoneChannel;
}

export interface ParsedAnimationClip {
  name: string;
  /** Clip duration in seconds */
  length: number;
  /** Loop behavior: true -> 'loop', false -> 'once', 'hold_on_last_frame' -> 'hold_on_last_frame' */
  loop: AnimationLoopMode;
  /** Optional blend weight expression or constant */
  blendWeight: MolangValue;
  /** Bone animation tracks keyed by bone name */
  bones: Record<string, ParsedBoneAnimation>;
  /** Optional override_previous_animation flag */
  overridePreviousAnimation: boolean;
}

export interface ParsedAnimationSet {
  formatVersion: string;
  clips: Record<string, ParsedAnimationClip>;
}

/* ============================================================================
 * YSM Manifest IR (ysm.json / legacy folder layout)
 * ============================================================================ */

export interface YsmTextureDescriptor {
  id: string;
  path: string;
  /** Optional UV V-offset page index when mapping multi-texture atlases */
  uvPage?: number;
}

export interface YsmManifest {
  specVersion: number;
  name: string;
  authors: string[];
  description?: string;
  mainModelPath: string;
  animationPaths: string[];
  textures: YsmTextureDescriptor[];
  /** Optional bone-name to texture-id overrides */
  boneTextures?: Record<string, string>;
}
