import type {
  AnimationLoopMode,
  BoneChannelType,
  InterpolationMode,
  MolangValue,
  MolangVec3,
  ParsedAnimationClip,
  ParsedAnimationSet,
  ParsedBoneAnimation,
  ParsedBoneChannel,
  ParsedKeyframe,
} from './types';

interface RawKeyframeObj {
  pre?: unknown;
  post?: unknown;
  lerp_mode?: string;
}

interface RawBoneAnim {
  rotation?: unknown;
  position?: unknown;
  scale?: unknown;
}

interface RawAnimationClip {
  loop?: boolean | string;
  animation_length?: number;
  blend_weight?: number | string;
  override_previous_animation?: boolean;
  anim_time_update?: unknown; // Explicitly skipped per spec
  bones?: Record<string, RawBoneAnim>;
}

interface RawAnimationFile {
  format_version?: string;
  animations?: Record<string, RawAnimationClip>;
}

function toMolangValue(val: unknown, fallback = 0): MolangValue {
  if (typeof val === 'number') {
    return Number.isFinite(val) ? val : fallback;
  }
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (trimmed === '') return fallback;
    // Fast-path numeric literal strings without operators
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(trimmed)) {
      return Number(trimmed);
    }
    return trimmed;
  }
  return fallback;
}

function toMolangVec3(val: unknown, defaultScalar: number): MolangVec3 {
  if (typeof val === 'number' || typeof val === 'string') {
    const v = toMolangValue(val, defaultScalar);
    return [v, v, v];
  }
  if (Array.isArray(val)) {
    return [
      toMolangValue(val[0], defaultScalar),
      toMolangValue(val[1], defaultScalar),
      toMolangValue(val[2], defaultScalar),
    ];
  }
  return [defaultScalar, defaultScalar, defaultScalar];
}

function parseLoopMode(loop: unknown): AnimationLoopMode {
  if (loop === true || loop === 'true' || loop === 'loop') {
    return 'loop';
  }
  if (loop === 'hold_on_last_frame') {
    return 'hold_on_last_frame';
  }
  return 'once';
}

function parseLerpMode(rawMode: unknown): InterpolationMode {
  if (typeof rawMode !== 'string') return 'linear';
  const lower = rawMode.toLowerCase();
  if (lower === 'catmullrom' || lower === 'smooth') return 'catmullrom';
  if (lower === 'step' || lower === 'discrete') return 'step';
  return 'linear';
}

function isTimestampMap(val: unknown): val is Record<string, unknown> {
  if (!val || typeof val !== 'object' || Array.isArray(val)) return false;
  const keys = Object.keys(val);
  if (keys.length === 0) return false;
  return keys.every((k) => !Number.isNaN(Number(k)));
}

function parseChannel(
  channel: BoneChannelType,
  rawChannel: unknown,
): ParsedBoneChannel | undefined {
  if (rawChannel === undefined || rawChannel === null) return undefined;

  const defaultScalar = channel === 'scale' ? 1 : 0;

  // Case 1: Static constant or MoLang expression (number, string, or [x, y, z] tuple)
  if (
    typeof rawChannel === 'number' ||
    typeof rawChannel === 'string' ||
    Array.isArray(rawChannel)
  ) {
    return {
      channel,
      staticValue: toMolangVec3(rawChannel, defaultScalar),
      keyframes: [],
    };
  }

  // Case 2: Single keyframe object with vector / pre / post (no timestamp keys)
  if (typeof rawChannel === 'object' && !isTimestampMap(rawChannel)) {
    const obj = rawChannel as Record<string, unknown>;
    if (obj.vector !== undefined) {
      return {
        channel,
        staticValue: toMolangVec3(obj.vector, defaultScalar),
        keyframes: [],
      };
    }
    if (obj.post !== undefined || obj.pre !== undefined) {
      const post = toMolangVec3(obj.post ?? obj.pre, defaultScalar);
      const pre = obj.pre !== undefined ? toMolangVec3(obj.pre, defaultScalar) : post;
      return {
        channel,
        keyframes: [
          {
            time: 0,
            pre,
            post,
            lerpMode: parseLerpMode(obj.lerp_mode),
          },
        ],
      };
    }
    return undefined;
  }

  // Case 3: Timestamped keyframe dictionary `{ "0.0": ..., "0.5": { pre, post, lerp_mode } }`
  const entries = Object.entries(rawChannel as Record<string, unknown>);
  const keyframes: ParsedKeyframe[] = [];

  for (const [timeStr, kfRaw] of entries) {
    const time = Number(timeStr);
    if (!Number.isFinite(time)) continue;

    if (
      typeof kfRaw === 'number' ||
      typeof kfRaw === 'string' ||
      Array.isArray(kfRaw)
    ) {
      const vec = toMolangVec3(kfRaw, defaultScalar);
      keyframes.push({
        time,
        pre: vec,
        post: vec,
        lerpMode: 'linear',
      });
    } else if (kfRaw && typeof kfRaw === 'object') {
      const obj = kfRaw as RawKeyframeObj & { vector?: unknown };
      if (obj.vector !== undefined) {
        const vec = toMolangVec3(obj.vector, defaultScalar);
        keyframes.push({
          time,
          pre: vec,
          post: vec,
          lerpMode: parseLerpMode(obj.lerp_mode),
        });
      } else {
        const post = toMolangVec3(obj.post ?? obj.pre, defaultScalar);
        const pre = obj.pre !== undefined ? toMolangVec3(obj.pre, defaultScalar) : post;
        keyframes.push({
          time,
          pre,
          post,
          lerpMode: parseLerpMode(obj.lerp_mode),
        });
      }
    }
  }

  keyframes.sort((a, b) => a.time - b.time);

  return {
    channel,
    keyframes,
  };
}

/**
 * Pure parser for Minecraft Bedrock 1.8.0+ animation JSON (`*.animation.json`).
 * Zero Three.js dependencies. Skips `anim_time_update` per spec.
 */
export class BedrockAnimationParser {
  /**
   * Parses a Bedrock animation JSON string or object into a normalized `ParsedAnimationSet`.
   */
  parse(input: string | Record<string, unknown>): ParsedAnimationSet {
    const raw: RawAnimationFile =
      typeof input === 'string'
        ? (JSON.parse(input) as RawAnimationFile)
        : (input as RawAnimationFile);

    if (!raw || typeof raw !== 'object' || !raw.animations || typeof raw.animations !== 'object') {
      throw new Error('BedrockAnimationParser: Missing top-level "animations" map.');
    }

    const formatVersion = typeof raw.format_version === 'string' ? raw.format_version : '1.8.0';
    const clips: Record<string, ParsedAnimationClip> = {};

    for (const [clipName, rawClip] of Object.entries(raw.animations)) {
      if (!rawClip || typeof rawClip !== 'object') continue;

      const bones: Record<string, ParsedBoneAnimation> = {};
      let inferredLength = 0;

      if (rawClip.bones && typeof rawClip.bones === 'object') {
        for (const [boneName, rawBoneAnim] of Object.entries(rawClip.bones)) {
          if (!rawBoneAnim || typeof rawBoneAnim !== 'object') continue;

          const rotation = parseChannel('rotation', rawBoneAnim.rotation);
          const position = parseChannel('position', rawBoneAnim.position);
          const scale = parseChannel('scale', rawBoneAnim.scale);

          for (const ch of [rotation, position, scale]) {
            if (ch && ch.keyframes.length > 0) {
              const lastTime = ch.keyframes[ch.keyframes.length - 1].time;
              if (lastTime > inferredLength) {
                inferredLength = lastTime;
              }
            }
          }

          if (rotation || position || scale) {
            bones[boneName] = {
              boneName,
              ...(rotation ? { rotation } : {}),
              ...(position ? { position } : {}),
              ...(scale ? { scale } : {}),
            };
          }
        }
      }

      const explicitLength =
        typeof rawClip.animation_length === 'number' && Number.isFinite(rawClip.animation_length)
          ? Math.max(0, rawClip.animation_length)
          : inferredLength;

      clips[clipName] = {
        name: clipName,
        length: explicitLength,
        loop: parseLoopMode(rawClip.loop),
        blendWeight: toMolangValue(rawClip.blend_weight, 1),
        bones,
        overridePreviousAnimation: Boolean(rawClip.override_previous_animation),
      };
    }

    return {
      formatVersion,
      clips,
    };
  }

  /**
   * Merges multiple parsed animation files into a single unified clip map.
   * Strips optional `animation.<model>.` prefixes as convenient short aliases if unambiguous.
   */
  mergeSets(sets: ParsedAnimationSet[]): Record<string, ParsedAnimationClip> {
    const merged: Record<string, ParsedAnimationClip> = {};
    for (const set of sets) {
      for (const [name, clip] of Object.entries(set.clips)) {
        merged[name] = clip;
      }
    }
    return merged;
  }
}
