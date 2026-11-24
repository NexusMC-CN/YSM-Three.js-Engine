import type {
  AnimationLoopMode,
  ParsedAnimationClip,
  Vec3,
} from '../parser/types';
import {
  MolangEvaluator,
  type CompiledMolangFn,
  type MolangEvalContext,
  type MolangQueryContext,
} from '../molang/MolangEvaluator';
import { KeyframeTrack } from './KeyframeTrack';

export interface PlayOptions {
  /** Override clip loop mode: true -> 'loop', false -> 'once', or 'hold_on_last_frame' */
  loop?: boolean | AnimationLoopMode;
  /** Fade-in duration in seconds (default 0) */
  fadeIn?: number;
  /** Fade-out duration in seconds when finishing or stopping (default 0) */
  fadeOut?: number;
  /** Playback speed multiplier (default 1) */
  timeScale?: number;
  /** Target blend weight in [0, 1] (default 1) */
  weight?: number;
  /** Reset playback time to 0 if already playing (default true) */
  resetTime?: boolean;
}

export interface BonePoseDelta {
  rotation: Vec3;
  position: Vec3;
  scale: Vec3;
}

export interface ActiveLayerInfo {
  name: string;
  time: number;
  length: number;
  weight: number;
  timeScale: number;
  loop: AnimationLoopMode;
  fadingOut: boolean;
}

interface CompiledBoneTracks {
  boneName: string;
  rotation?: KeyframeTrack;
  position?: KeyframeTrack;
  scale?: KeyframeTrack;
}

interface CompiledClip {
  name: string;
  length: number;
  loop: AnimationLoopMode;
  blendWeight: number | CompiledMolangFn;
  tracks: CompiledBoneTracks[];
}

interface AnimationLayer {
  clip: CompiledClip;
  time: number;
  loop: AnimationLoopMode;
  timeScale: number;
  targetWeight: number;
  weight: number;
  fadeInDuration: number;
  fadeOutDuration: number;
  fadingOut: boolean;
  fadeElapsed: number;
  fadeStartWeight: number;
  finished: boolean;
}

function normalizeLoopOption(
  option: boolean | AnimationLoopMode | undefined,
  fallback: AnimationLoopMode,
): AnimationLoopMode {
  if (option === undefined) return fallback;
  if (option === true) return 'loop';
  if (option === false) return 'once';
  return option;
}

/**
 * Hand-written multi-layer Additive AnimationController (zero Three.js dependencies).
 *
 * - Supports simultaneous additive animation layers blended over the model's bind pose
 * - Supports `play`, `crossFadeTo`, `stop`, `stopAll`, `setTimeScale`
 * - Persists per-instance MoLang `variable.*` state across frames and expressions
 */
export class AnimationController {
  readonly evaluator: MolangEvaluator;
  readonly variables: Record<string, number> = {};

  private readonly clips = new Map<string, CompiledClip>();
  private readonly layers = new Map<string, AnimationLayer>();
  private readonly poseDeltas = new Map<string, BonePoseDelta>();

  private lifeTime = 0;
  private readonly _sample: Vec3 = [0, 0, 0];
  private readonly _evalCtx: MolangEvalContext;

  constructor(
    parsedClips: Record<string, ParsedAnimationClip>,
    boneNames: string[],
    evaluator?: MolangEvaluator,
  ) {
    this.evaluator = evaluator ?? new MolangEvaluator();
    this._evalCtx = {
      query: {
        anim_time: 0,
        life_time: 0,
        delta_time: 0,
        ground_speed: 0,
        is_on_ground: 1,
      },
      variables: this.variables,
    };

    for (const name of boneNames) {
      this.poseDeltas.set(name, {
        rotation: [0, 0, 0],
        position: [0, 0, 0],
        scale: [1, 1, 1],
      });
    }

    for (const clip of Object.values(parsedClips)) {
      this.registerClip(clip);
    }
  }

  /** Compiles and registers an animation clip */
  registerClip(parsed: ParsedAnimationClip): void {
    const tracks: CompiledBoneTracks[] = [];
    for (const boneAnim of Object.values(parsed.bones)) {
      tracks.push({
        boneName: boneAnim.boneName,
        ...(boneAnim.rotation
          ? { rotation: new KeyframeTrack(boneAnim.rotation, this.evaluator) }
          : {}),
        ...(boneAnim.position
          ? { position: new KeyframeTrack(boneAnim.position, this.evaluator) }
          : {}),
        ...(boneAnim.scale
          ? { scale: new KeyframeTrack(boneAnim.scale, this.evaluator) }
          : {}),
      });
    }

    const blendWeight =
      typeof parsed.blendWeight === 'number'
        ? parsed.blendWeight
        : this.evaluator.compile(parsed.blendWeight);

    const compiled: CompiledClip = {
      name: parsed.name,
      length: parsed.length,
      loop: parsed.loop,
      blendWeight,
      tracks,
    };

    this.clips.set(parsed.name, compiled);
  }

  /** Lists all available clip names */
  getClipNames(): string[] {
    return Array.from(this.clips.keys());
  }

  /** Resolves either an exact clip name or suffix shorthand (e.g. "walk" -> "animation.fox.walk") */
  resolveClipName(name: string): string | undefined {
    if (this.clips.has(name)) return name;
    const suffix = `.${name}`;
    for (const key of this.clips.keys()) {
      if (key.endsWith(suffix)) return key;
    }
    return undefined;
  }

  /**
   * Starts or updates an additive animation layer.
   */
  play(name: string, options: PlayOptions = {}): boolean {
    const resolved = this.resolveClipName(name);
    if (!resolved) return false;

    const clip = this.clips.get(resolved)!;
    const existing = this.layers.get(resolved);
    const fadeIn = Math.max(0, options.fadeIn ?? 0);
    const fadeOut = Math.max(0, options.fadeOut ?? 0);
    const targetWeight = options.weight ?? 1;
    const timeScale = options.timeScale ?? existing?.timeScale ?? 1;
    const loop = normalizeLoopOption(options.loop, clip.loop);
    const resetTime = options.resetTime ?? true;

    if (existing) {
      if (resetTime) existing.time = 0;
      existing.loop = loop;
      existing.timeScale = timeScale;
      existing.targetWeight = targetWeight;
      existing.fadeOutDuration = fadeOut;
      existing.fadingOut = false;
      existing.finished = false;
      if (fadeIn > 0) {
        existing.fadeInDuration = fadeIn;
        existing.fadeElapsed = 0;
        existing.fadeStartWeight = existing.weight;
      } else {
        existing.fadeInDuration = 0;
        existing.weight = targetWeight;
      }
      return true;
    }

    const layer: AnimationLayer = {
      clip,
      time: 0,
      loop,
      timeScale,
      targetWeight,
      weight: fadeIn > 0 ? 0 : targetWeight,
      fadeInDuration: fadeIn,
      fadeOutDuration: fadeOut,
      fadingOut: false,
      fadeElapsed: 0,
      fadeStartWeight: 0,
      finished: false,
    };

    this.layers.set(resolved, layer);
    return true;
  }

  /**
   * Smoothly fades out all other currently playing layers while fading in `name` over `duration` seconds.
   */
  crossFadeTo(name: string, duration = 0.25, options: PlayOptions = {}): boolean {
    const resolved = this.resolveClipName(name);
    if (!resolved) return false;

    const fade = Math.max(0, duration);
    for (const [layerName, layer] of this.layers.entries()) {
      if (layerName !== resolved) {
        this.beginFadeOut(layer, fade);
      }
    }

    return this.play(resolved, {
      ...options,
      fadeIn: fade,
    });
  }

  /**
   * Stops a specific animation layer (optionally fading out smoothly).
   */
  stop(name: string, fadeOut?: number): boolean {
    const resolved = this.resolveClipName(name) ?? name;
    const layer = this.layers.get(resolved);
    if (!layer) return false;

    const duration = fadeOut !== undefined ? Math.max(0, fadeOut) : layer.fadeOutDuration;
    if (duration <= 0) {
      this.layers.delete(resolved);
    } else {
      this.beginFadeOut(layer, duration);
    }
    return true;
  }

  /** Stops all active animation layers */
  stopAll(fadeOut = 0): void {
    if (fadeOut <= 0) {
      this.layers.clear();
      return;
    }
    for (const layer of this.layers.values()) {
      this.beginFadeOut(layer, fadeOut);
    }
  }

  /** Sets playback speed multiplier for an active layer */
  setTimeScale(name: string, factor: number): boolean {
    const resolved = this.resolveClipName(name) ?? name;
    const layer = this.layers.get(resolved);
    if (!layer) return false;
    layer.timeScale = Number.isFinite(factor) ? factor : 1;
    return true;
  }

  /** Returns snapshot metadata of currently active layers */
  getActiveLayers(): ActiveLayerInfo[] {
    const out: ActiveLayerInfo[] = [];
    for (const layer of this.layers.values()) {
      out.push({
        name: layer.clip.name,
        time: layer.time,
        length: layer.clip.length,
        weight: layer.weight,
        timeScale: layer.timeScale,
        loop: layer.loop,
        fadingOut: layer.fadingOut,
      });
    }
    return out;
  }

  /**
   * Advances all active layers by `dt` seconds, evaluates MoLang & KeyframeTracks,
   * and returns the accumulated additive pose deltas per bone.
   */
  evaluate(dt: number, queryOverrides: MolangQueryContext = {}): ReadonlyMap<string, BonePoseDelta> {
    const safeDt = Number.isFinite(dt) && dt >= 0 ? dt : 0;
    this.lifeTime += safeDt;

    // Reset reusable pose deltas to identity (zero allocations)
    for (const delta of this.poseDeltas.values()) {
      delta.rotation[0] = 0;
      delta.rotation[1] = 0;
      delta.rotation[2] = 0;
      delta.position[0] = 0;
      delta.position[1] = 0;
      delta.position[2] = 0;
      delta.scale[0] = 1;
      delta.scale[1] = 1;
      delta.scale[2] = 1;
    }

    // Update base query fields
    const query = this._evalCtx.query;
    query.delta_time = safeDt;
    query.life_time = this.lifeTime;
    query.ground_speed = queryOverrides.ground_speed ?? query.ground_speed ?? 0;
    query.is_on_ground = queryOverrides.is_on_ground ?? query.is_on_ground ?? 1;

    // Copy any extra caller-provided query variables
    for (const key in queryOverrides) {
      if (key !== 'anim_time' && key !== 'life_time' && key !== 'delta_time') {
        query[key] = queryOverrides[key];
      }
    }

    const toRemove: string[] = [];

    for (const [layerName, layer] of this.layers.entries()) {
      // Advance layer clock
      layer.time += safeDt * layer.timeScale;
      const len = layer.clip.length;

      if (len > 0) {
        if (layer.loop === 'loop') {
          layer.time = ((layer.time % len) + len) % len;
        } else if (layer.loop === 'hold_on_last_frame') {
          if (layer.time > len) layer.time = len;
          if (layer.time < 0) layer.time = 0;
        } else {
          // 'once'
          if (layer.time >= len) {
            layer.time = len;
            if (!layer.fadingOut) {
              if (layer.fadeOutDuration > 0) {
                this.beginFadeOut(layer, layer.fadeOutDuration);
              } else {
                layer.finished = true;
              }
            }
          } else if (layer.time < 0) {
            layer.time = 0;
          }
        }
      }

      // Update fade envelope
      if (layer.fadingOut) {
        layer.fadeElapsed += safeDt;
        const progress =
          layer.fadeOutDuration > 1e-6
            ? Math.min(1, layer.fadeElapsed / layer.fadeOutDuration)
            : 1;
        layer.weight = layer.fadeStartWeight * (1 - progress);
        if (progress >= 1 || layer.weight <= 1e-5) {
          layer.weight = 0;
          layer.finished = true;
        }
      } else if (layer.fadeInDuration > 0 && layer.weight < layer.targetWeight) {
        layer.fadeElapsed += safeDt;
        const progress = Math.min(1, layer.fadeElapsed / layer.fadeInDuration);
        layer.weight =
          layer.fadeStartWeight + (layer.targetWeight - layer.fadeStartWeight) * progress;
        if (progress >= 1) {
          layer.weight = layer.targetWeight;
          layer.fadeInDuration = 0;
        }
      }

      if (layer.finished) {
        toRemove.push(layerName);
        continue;
      }

      // Inject per-layer anim_time
      query.anim_time = layer.time;

      const clipWeight =
        typeof layer.clip.blendWeight === 'number'
          ? layer.clip.blendWeight
          : layer.clip.blendWeight(this._evalCtx);

      const effectiveWeight = layer.weight * Math.max(0, clipWeight);
      if (effectiveWeight <= 1e-6) continue;

      const tracks = layer.clip.tracks;
      for (let i = 0; i < tracks.length; i++) {
        const bt = tracks[i];
        let delta = this.poseDeltas.get(bt.boneName);
        if (!delta) {
          delta = {
            rotation: [0, 0, 0],
            position: [0, 0, 0],
            scale: [1, 1, 1],
          };
          this.poseDeltas.set(bt.boneName, delta);
        }

        if (bt.rotation) {
          bt.rotation.sample(layer.time, this._evalCtx, this._sample);
          delta.rotation[0] += this._sample[0] * effectiveWeight;
          delta.rotation[1] += this._sample[1] * effectiveWeight;
          delta.rotation[2] += this._sample[2] * effectiveWeight;
        }

        if (bt.position) {
          bt.position.sample(layer.time, this._evalCtx, this._sample);
          delta.position[0] += this._sample[0] * effectiveWeight;
          delta.position[1] += this._sample[1] * effectiveWeight;
          delta.position[2] += this._sample[2] * effectiveWeight;
        }

        if (bt.scale) {
          bt.scale.sample(layer.time, this._evalCtx, this._sample);
          // Blend scale multiplicatively toward 1 at weight=0
          delta.scale[0] *= 1 + (this._sample[0] - 1) * effectiveWeight;
          delta.scale[1] *= 1 + (this._sample[1] - 1) * effectiveWeight;
          delta.scale[2] *= 1 + (this._sample[2] - 1) * effectiveWeight;
        }
      }
    }

    for (const finishedName of toRemove) {
      this.layers.delete(finishedName);
    }

    return this.poseDeltas;
  }

  private beginFadeOut(layer: AnimationLayer, duration: number): void {
    layer.fadingOut = true;
    layer.fadeOutDuration = duration;
    layer.fadeElapsed = 0;
    layer.fadeStartWeight = layer.weight;
  }
}
