import type {
  CubeFaceName,
  CubeUVMap,
  NormalizedFaceUV,
  ParsedBone,
  ParsedCube,
  ParsedLocator,
  ParsedModel,
  ParsedModelDescription,
  Vec2,
  Vec3,
  YsmManifest,
  YsmTextureDescriptor,
} from './types';

/** Raw Bedrock 1.12.0+ face UV definition */
interface RawFaceUV {
  uv: Vec2;
  uv_size?: Vec2;
  uv_rotation?: number;
  material_instance?: string;
}

type RawPerFaceUV = Partial<Record<CubeFaceName, RawFaceUV>>;

interface RawCube {
  origin?: Vec3;
  size?: Vec3;
  uv?: Vec2 | RawPerFaceUV;
  inflate?: number;
  mirror?: boolean;
  pivot?: Vec3;
  rotation?: Vec3;
  material_instance?: string;
}

interface RawBone {
  name: string;
  parent?: string;
  pivot?: Vec3;
  rotation?: Vec3;
  bind_pose_rotation?: Vec3;
  mirror?: boolean;
  inflate?: number;
  cubes?: RawCube[];
  locators?: Record<string, Vec3 | { offset?: Vec3; rotation?: Vec3 }>;
  poly_mesh?: unknown;
  material?: string;
}

interface RawGeometry112 {
  description?: {
    identifier?: string;
    texture_width?: number;
    texture_height?: number;
    visible_bounds_width?: number;
    visible_bounds_height?: number;
    visible_bounds_offset?: Vec3;
  };
  bones?: RawBone[];
}

interface RawModelFile {
  format_version?: string;
  'minecraft:geometry'?: RawGeometry112[];
  textures?: string[] | Record<string, string>;
  [legacyKey: string]: unknown;
}

export interface BedrockModelParseOptions {
  /** Select a specific geometry identifier if the file contains multiple geometries */
  geometryIdentifier?: string;
  /** Optional texture count for UV vertical page routing */
  textureCount?: number;
  /** Optional bone-to-texture mapping overrides */
  boneTextures?: Record<string, string>;
}

const ALL_FACES: readonly CubeFaceName[] = [
  'east',
  'west',
  'up',
  'down',
  'south',
  'north',
];

function toVec3(val: unknown, fallback: Vec3 = [0, 0, 0]): Vec3 {
  if (Array.isArray(val) && val.length >= 3) {
    return [Number(val[0]) || 0, Number(val[1]) || 0, Number(val[2]) || 0];
  }
  return [fallback[0], fallback[1], fallback[2]];
}

function makeHiddenUV(): NormalizedFaceUV {
  return { u0: 0, v0: 0, u1: 0, v1: 0, hidden: true };
}

/**
 * Computes Bedrock Box UV mapping for all 6 faces (normalized to [0, 1], flipY = false).
 *
 * Standard Bedrock unfolding from [u, v] with w = floor(sx), h = floor(sy), d = floor(sz):
 *
 *              ┌────────┬────────┐
 *              │   Up   │  Down  │   height = d
 *     ┌────────┼────────┼────────┼────────┐
 *     │  East  │ North  │  West  │ South  │  height = h
 *     └────────┴────────┴────────┴────────┘
 *        d         w        d        w
 *
 * When mirror = true:
 *   - East (+X) and West (-X) swap their source texture rectangles.
 *   - Every face flips horizontally (u0 <-> u1) so mirrored limbs stitch seamlessly.
 */
export function computeBoxUVs(
  uvOrigin: Vec2,
  size: Vec3,
  texWidth: number,
  texHeight: number,
  mirror: boolean,
): { uvs: CubeUVMap; textureIndex: number } {
  const safeW = Math.max(1, texWidth);
  const safeH = Math.max(1, texHeight);

  // Support multi-texture page selection when V exceeds textureHeight
  let textureIndex = 0;
  let u = Number(uvOrigin[0]) || 0;
  let v = Number(uvOrigin[1]) || 0;
  if (v >= safeH) {
    textureIndex = Math.floor(v / safeH);
    v = v - textureIndex * safeH;
  }

  // Bedrock uses floor of cube size for box UV pixel extents
  const w = Math.floor(Math.abs(size[0]));
  const h = Math.floor(Math.abs(size[1]));
  const d = Math.floor(Math.abs(size[2]));

  const norm = (
    px0: number,
    py0: number,
    px1: number,
    py1: number,
  ): NormalizedFaceUV => ({
    u0: px0 / safeW,
    v0: py0 / safeH,
    u1: px1 / safeW,
    v1: py1 / safeH,
  });

  // Unmirrored face pixel rectangles (matching Three.js BoxGeometry vertex order when flipY = false)
  // East (+X in Three local space, character right side)
  const eastRect: [number, number, number, number] = [u, v + d, u + d, v + d + h];
  // North (-Z front face)
  const northRect: [number, number, number, number] = [
    u + d,
    v + d,
    u + d + w,
    v + d + h,
  ];
  // West (-X in Three local space, character left side)
  const westRect: [number, number, number, number] = [
    u + d + w,
    v + d,
    u + 2 * d + w,
    v + d + h,
  ];
  // South (+Z back face)
  const southRect: [number, number, number, number] = [
    u + 2 * d + w,
    v + d,
    u + 2 * d + 2 * w,
    v + d + h,
  ];
  // Up (+Y top face): stitches forehead at v+d with North top edge
  const upRect: [number, number, number, number] = [
    u + d + w,
    v + d,
    u + d,
    v,
  ];
  // Down (-Y bottom face): stitches chin with North bottom edge
  const downRect: [number, number, number, number] = [
    u + d + 2 * w,
    v,
    u + d + w,
    v + d,
  ];

  if (!mirror) {
    return {
      textureIndex,
      uvs: {
        east: norm(...eastRect),
        west: norm(...westRect),
        up: norm(...upRect),
        down: norm(...downRect),
        south: norm(...southRect),
        north: norm(...northRect),
      },
    };
  }

  // Mirrored: swap East & West and flip U horizontally on every face
  return {
    textureIndex,
    uvs: {
      east: norm(westRect[2], westRect[1], westRect[0], westRect[3]),
      west: norm(eastRect[2], eastRect[1], eastRect[0], eastRect[3]),
      up: norm(upRect[2], upRect[1], upRect[0], upRect[3]),
      down: norm(downRect[2], downRect[1], downRect[0], downRect[3]),
      south: norm(southRect[2], southRect[1], southRect[0], southRect[3]),
      north: norm(northRect[2], northRect[1], northRect[0], northRect[3]),
    },
  };
}

/**
 * Computes Bedrock Per-Face UV mapping (`uv: { north: { uv, uv_size }, ... }`).
 * Supports negative `uv_size` for explicit UV flips, `uv_rotation`, and omitted faces.
 */
export function computePerFaceUVs(
  perFace: RawPerFaceUV,
  texWidth: number,
  texHeight: number,
  mirror: boolean,
): { uvs: CubeUVMap; textureIndex: number; materialKey?: string } {
  const safeW = Math.max(1, texWidth);
  const safeH = Math.max(1, texHeight);

  let textureIndex = 0;
  let materialKey: string | undefined;

  const uvs = {} as CubeUVMap;

  for (const face of ALL_FACES) {
    // When mirror is enabled in per-face mode, swap east & west lookups
    const lookupFace: CubeFaceName =
      mirror && face === 'east'
        ? 'west'
        : mirror && face === 'west'
          ? 'east'
          : face;

    const def = perFace[lookupFace];
    if (!def || !Array.isArray(def.uv)) {
      uvs[face] = makeHiddenUV();
      continue;
    }

    if (def.material_instance && !materialKey) {
      materialKey = def.material_instance;
    }

    const u = Number(def.uv[0]) || 0;
    let v = Number(def.uv[1]) || 0;
    const uw = def.uv_size ? Number(def.uv_size[0]) || 0 : 0;
    const vh = def.uv_size ? Number(def.uv_size[1]) || 0 : 0;

    if (v >= safeH) {
      textureIndex = Math.floor(v / safeH);
      v = v - textureIndex * safeH;
    }

    if (uw === 0 && vh === 0) {
      uvs[face] = makeHiddenUV();
      continue;
    }

    let px0 = u;
    let py0 = v;
    let px1 = u + uw;
    let py1 = v + vh;

    // Align Bedrock up/down orientation to match BoxGeometry top-left vertex convention
    if (face === 'up') {
      px0 = u + uw;
      px1 = u;
      py0 = v + vh;
      py1 = v;
    } else if (face === 'down') {
      px0 = u + uw;
      px1 = u;
      py0 = v;
      py1 = v + vh;
    }

    if (mirror) {
      const tmp = px0;
      px0 = px1;
      px1 = tmp;
    }

    uvs[face] = {
      u0: px0 / safeW,
      v0: py0 / safeH,
      u1: px1 / safeW,
      v1: py1 / safeH,
      uvRotation: def.uv_rotation,
      hidden: false,
    };
  }

  return { uvs, textureIndex, materialKey };
}

/**
 * Pure parser for Minecraft Bedrock 1.12.0+ (and 1.8.0 legacy) entity geometry JSON.
 * Does NOT import Three.js — safe to use in Node, Workers, or custom WebGL/WebGPU engines.
 */
export class BedrockModelParser {
  /**
   * Parses a Bedrock geometry JSON string or pre-parsed object into a normalized `ParsedModel`.
   */
  parse(input: string | Record<string, unknown>, options: BedrockModelParseOptions = {}): ParsedModel {
    const raw: RawModelFile =
      typeof input === 'string' ? (JSON.parse(input) as RawModelFile) : (input as RawModelFile);

    if (!raw || typeof raw !== 'object') {
      throw new Error('BedrockModelParser: Invalid geometry JSON payload.');
    }

    const formatVersion = typeof raw.format_version === 'string' ? raw.format_version : '1.12.0';
    const geometry = this.extractGeometry(raw, options.geometryIdentifier);

    const descRaw = geometry.description ?? {};
    const description: ParsedModelDescription = {
      identifier: descRaw.identifier ?? 'geometry.unknown',
      textureWidth: Math.max(1, Number(descRaw.texture_width) || 64),
      textureHeight: Math.max(1, Number(descRaw.texture_height) || 64),
      visibleBoundsWidth: Number(descRaw.visible_bounds_width) || 2,
      visibleBoundsHeight: Number(descRaw.visible_bounds_height) || 2,
      visibleBoundsOffset: toVec3(descRaw.visible_bounds_offset, [0, 1, 0]),
    };

    const textures = this.extractTextures(raw);
    const rawBones = Array.isArray(geometry.bones) ? geometry.bones : [];

    const boneMap: Record<string, ParsedBone> = {};
    let cubeCount = 0;

    for (const rawBone of rawBones) {
      if (!rawBone || typeof rawBone.name !== 'string' || !rawBone.name) {
        continue;
      }

      const boneMirror = Boolean(rawBone.mirror);
      const boneInflate = Number(rawBone.inflate) || 0;
      const boneMaterialKey =
        rawBone.material ?? options.boneTextures?.[rawBone.name];

      const parsedCubes: ParsedCube[] = [];
      const rawCubes = Array.isArray(rawBone.cubes) ? rawBone.cubes : [];

      for (const rawCube of rawCubes) {
        const origin = toVec3(rawCube.origin, [0, 0, 0]);
        const size = toVec3(rawCube.size, [0, 0, 0]);
        const inflate =
          rawCube.inflate !== undefined ? Number(rawCube.inflate) || 0 : boneInflate;
        const mirror =
          rawCube.mirror !== undefined ? Boolean(rawCube.mirror) : boneMirror;

        const inflatedSize: Vec3 = [
          size[0] + inflate * 2,
          size[1] + inflate * 2,
          size[2] + inflate * 2,
        ];
        const center: Vec3 = [
          origin[0] + size[0] * 0.5,
          origin[1] + size[1] * 0.5,
          origin[2] + size[2] * 0.5,
        ];

        const isBoxUV = Array.isArray(rawCube.uv) || rawCube.uv === undefined;
        let uvMode: 'box' | 'per-face';
        let uvs: CubeUVMap;
        let textureIndex = 0;
        let materialKey = rawCube.material_instance ?? boneMaterialKey;

        if (isBoxUV) {
          uvMode = 'box';
          const uvArr: Vec2 = Array.isArray(rawCube.uv)
            ? [Number(rawCube.uv[0]) || 0, Number(rawCube.uv[1]) || 0]
            : [0, 0];
          const res = computeBoxUVs(
            uvArr,
            size,
            description.textureWidth,
            description.textureHeight,
            mirror,
          );
          uvs = res.uvs;
          textureIndex = res.textureIndex;
        } else {
          uvMode = 'per-face';
          const res = computePerFaceUVs(
            rawCube.uv as RawPerFaceUV,
            description.textureWidth,
            description.textureHeight,
            mirror,
          );
          uvs = res.uvs;
          textureIndex = res.textureIndex;
          if (!materialKey && res.materialKey) {
            materialKey = res.materialKey;
          }
        }

        if (options.textureCount && options.textureCount > 0) {
          textureIndex = Math.min(textureIndex, options.textureCount - 1);
        }

        const parsedCube: ParsedCube = {
          origin,
          size,
          inflate,
          inflatedSize,
          center,
          mirror,
          uvMode,
          uvs,
          textureIndex,
          ...(materialKey ? { materialKey } : {}),
          ...(rawCube.pivot ? { pivot: toVec3(rawCube.pivot) } : {}),
          ...(rawCube.rotation ? { rotation: toVec3(rawCube.rotation) } : {}),
        };

        parsedCubes.push(parsedCube);
        cubeCount++;
      }

      const locators: ParsedLocator[] = [];
      if (rawBone.locators && typeof rawBone.locators === 'object') {
        for (const [locName, locVal] of Object.entries(rawBone.locators)) {
          if (Array.isArray(locVal)) {
            locators.push({ name: locName, offset: toVec3(locVal) });
          } else if (locVal && typeof locVal === 'object') {
            locators.push({
              name: locName,
              offset: toVec3(locVal.offset),
              ...(locVal.rotation ? { rotation: toVec3(locVal.rotation) } : {}),
            });
          }
        }
      }

      const rotation = rawBone.rotation
        ? toVec3(rawBone.rotation)
        : rawBone.bind_pose_rotation
          ? toVec3(rawBone.bind_pose_rotation)
          : ([0, 0, 0] as Vec3);

      const parsedBone: ParsedBone = {
        name: rawBone.name,
        ...(rawBone.parent ? { parent: rawBone.parent } : {}),
        pivot: toVec3(rawBone.pivot, [0, 0, 0]),
        rotation,
        mirror: boneMirror,
        inflate: boneInflate,
        ...(boneMaterialKey ? { materialKey: boneMaterialKey } : {}),
        cubes: parsedCubes,
        locators,
        ...(rawBone.poly_mesh ? { hasPolyMesh: true } : {}),
        children: [],
      };

      boneMap[parsedBone.name] = parsedBone;
    }

    // Link children & compute topologically sorted bone array (parents before children)
    const rootBones: string[] = [];
    for (const bone of Object.values(boneMap)) {
      if (bone.parent && boneMap[bone.parent]) {
        boneMap[bone.parent].children.push(bone.name);
      } else {
        // Detach dangling parent reference gracefully so root traversal works
        if (bone.parent && !boneMap[bone.parent]) {
          delete bone.parent;
        }
        rootBones.push(bone.name);
      }
    }

    const sortedBones: ParsedBone[] = [];
    const visited = new Set<string>();

    const visit = (name: string): void => {
      if (visited.has(name)) return;
      visited.add(name);
      const bone = boneMap[name];
      if (!bone) return;
      sortedBones.push(bone);
      for (const childName of bone.children) {
        visit(childName);
      }
    };

    for (const rootName of rootBones) {
      visit(rootName);
    }
    // Cycle guard: include any isolated cyclic bones without crashing
    for (const boneName of Object.keys(boneMap)) {
      if (!visited.has(boneName)) {
        visit(boneName);
      }
    }

    return {
      formatVersion,
      description,
      bones: sortedBones,
      boneMap,
      rootBones,
      cubeCount,
      textures,
    };
  }

  /**
   * Parses a YSM v2 `ysm.json` manifest into a normalized `YsmManifest`.
   */
  parseManifest(input: string | Record<string, unknown>): YsmManifest {
    const raw =
      typeof input === 'string'
        ? (JSON.parse(input) as Record<string, unknown>)
        : input;

    const metadata = (raw.metadata as Record<string, unknown>) ?? {};
    const files = (raw.files as Record<string, unknown>) ?? {};
    const player = (files.player as Record<string, unknown>) ?? {};
    const modelBlock = (player.model as Record<string, unknown>) ?? (raw.models as Record<string, unknown>) ?? {};
    const animBlock = (player.animation as Record<string, unknown>) ?? (raw.animations as Record<string, unknown>) ?? {};
    const textureBlock = (player.texture ?? raw.textures) as unknown;

    const mainModelPath =
      typeof modelBlock.main === 'string'
        ? modelBlock.main
        : typeof raw.main === 'string'
          ? raw.main
          : 'models/main.json';

    const animationPaths: string[] = [];
    if (typeof animBlock === 'object' && animBlock !== null) {
      for (const val of Object.values(animBlock)) {
        if (typeof val === 'string') {
          animationPaths.push(val);
        }
      }
    } else if (Array.isArray(raw.animations)) {
      for (const item of raw.animations) {
        if (typeof item === 'string') animationPaths.push(item);
      }
    }

    const textures: YsmTextureDescriptor[] = [];
    if (Array.isArray(textureBlock)) {
      textureBlock.forEach((entry, idx) => {
        if (typeof entry === 'string') {
          textures.push({ id: `tex_${idx}`, path: entry, uvPage: idx });
        } else if (entry && typeof entry === 'object') {
          const obj = entry as Record<string, unknown>;
          const texPath = String(obj.uv ?? obj.path ?? '');
          if (texPath) {
            textures.push({
              id: String(obj.id ?? obj.name ?? `tex_${idx}`),
              path: texPath,
              uvPage: typeof obj.uv_page === 'number' ? obj.uv_page : idx,
            });
          }
        }
      });
    } else if (textureBlock && typeof textureBlock === 'object') {
      Object.entries(textureBlock as Record<string, unknown>).forEach(([key, val], idx) => {
        if (typeof val === 'string') {
          textures.push({ id: key, path: val, uvPage: idx });
        }
      });
    }

    const authorsRaw = metadata.authors ?? raw.authors;
    const authors: string[] = [];
    if (Array.isArray(authorsRaw)) {
      for (const a of authorsRaw) {
        if (typeof a === 'string') authors.push(a);
        else if (a && typeof a === 'object' && typeof (a as Record<string, unknown>).name === 'string') {
          authors.push(String((a as Record<string, unknown>).name));
        }
      }
    }

    const boneTextures =
      raw.bone_textures && typeof raw.bone_textures === 'object'
        ? (raw.bone_textures as Record<string, string>)
        : undefined;

    return {
      specVersion: Number(raw.spec ?? 2),
      name: String(metadata.name ?? raw.name ?? 'Unnamed YSM Model'),
      authors: authors.length > 0 ? authors : ['Unknown'],
      description: typeof metadata.description === 'string' ? metadata.description : undefined,
      mainModelPath,
      animationPaths,
      textures,
      boneTextures,
    };
  }

  private extractGeometry(raw: RawModelFile, identifier?: string): RawGeometry112 {
    if (Array.isArray(raw['minecraft:geometry']) && raw['minecraft:geometry'].length > 0) {
      if (identifier) {
        const matched = raw['minecraft:geometry'].find(
          (g) => g.description?.identifier === identifier,
        );
        if (matched) return matched;
      }
      return raw['minecraft:geometry'][0];
    }

    // Legacy Bedrock 1.8.0 / 1.10.0 top-level `geometry.*` support
    for (const [key, val] of Object.entries(raw)) {
      if (key.startsWith('geometry.') && val && typeof val === 'object') {
        const legacy = val as Record<string, unknown>;
        return {
          description: {
            identifier: key,
            texture_width: Number(legacy.texturewidth) || 64,
            texture_height: Number(legacy.textureheight) || 64,
            visible_bounds_width: Number(legacy.visible_bounds_width) || 2,
            visible_bounds_height: Number(legacy.visible_bounds_height) || 2,
            visible_bounds_offset: toVec3(legacy.visible_bounds_offset, [0, 1, 0]),
          },
          bones: Array.isArray(legacy.bones) ? (legacy.bones as RawBone[]) : [],
        };
      }
    }

    throw new Error(
      'BedrockModelParser: No "minecraft:geometry" array or legacy "geometry.*" block found.',
    );
  }

  private extractTextures(raw: RawModelFile): string[] {
    if (Array.isArray(raw.textures)) {
      return raw.textures.filter((t): t is string => typeof t === 'string');
    }
    if (raw.textures && typeof raw.textures === 'object') {
      return Object.values(raw.textures).filter((t): t is string => typeof t === 'string');
    }
    return [];
  }
}
