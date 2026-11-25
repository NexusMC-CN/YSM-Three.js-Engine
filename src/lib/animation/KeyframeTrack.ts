import type {
  BoneChannelType,
  InterpolationMode,
  MolangValue,
  MolangVec3,
  ParsedBoneChannel,
  Vec3,
} from '../parser/types';
import {
  MolangEvaluator,
  type CompiledMolangFn,
  type MolangEvalContext,
} from '../molang/MolangEvaluator';

type CompiledScalar = number | CompiledMolangFn;
type CompiledVec3 = [CompiledScalar, CompiledScalar, CompiledScalar];

export interface KeyframeExpressionWarning {
  channel: BoneChannelType;
  time?: number;
  axis: 0 | 1 | 2;
  expression: string;
  fallback: number;
  message: string;
}

interface CompiledKeyframe {
  time: number;
  pre: CompiledVec3;
  post: CompiledVec3;
  lerpMode: InterpolationMode;
}

function evalScalar(val: CompiledScalar, ctx: MolangEvalContext): number {
  return typeof val === 'number' ? val : val(ctx);
}

function evalVec3(vec: CompiledVec3, ctx: MolangEvalContext, out: Vec3): Vec3 {
  out[0] = evalScalar(vec[0], ctx);
  out[1] = evalScalar(vec[1], ctx);
  out[2] = evalScalar(vec[2], ctx);
  return out;
}

/**
 * Evaluates a cubic Hermite / Catmull-Rom spline segment between p1 (at t1) and p2 (at t2)
 * using neighboring control points p0 (at t0) and p3 (at t3) to derive smooth tangents.
 */
function catmullRomComponent(
  p0: number,
  p1: number,
  p2: number,
  p3: number,
  t0: number,
  t1: number,
  t2: number,
  t3: number,
  u: number,
): number {
  const dt = t2 - t1;
  if (dt <= 1e-8) return p1;

  // Compute non-uniform Catmull-Rom tangents scaled to segment duration `dt`
  const span1 = t2 - t0;
  const span2 = t3 - t1;
  const m1 = span1 > 1e-8 ? ((p2 - p0) / span1) * dt : p2 - p1;
  const m2 = span2 > 1e-8 ? ((p3 - p1) / span2) * dt : p2 - p1;

  const u2 = u * u;
  const u3 = u2 * u;

  // Cubic Hermite basis functions
  const h00 = 2 * u3 - 3 * u2 + 1;
  const h10 = u3 - 2 * u2 + u;
  const h01 = -2 * u3 + 3 * u2;
  const h11 = u3 - u2;

  return h00 * p1 + h10 * m1 + h01 * p2 + h11 * m2;
}

/**
 * Hand-written KeyframeTrack (zero Three.js dependency, replaces THREE.AnimationMixer).
 *
 * Pre-compiles all MoLang expressions inside keyframes via `MolangEvaluator` so sampling
 * evaluates dynamic expressions at runtime with zero allocations and zero re-parsing.
 */
export class KeyframeTrack {
  readonly channel: BoneChannelType;
  private readonly staticCompiled?: CompiledVec3;
  private readonly keyframes: CompiledKeyframe[];

  // Reusable scratch buffers to keep per-frame evaluation GC-free
  private readonly _p0: Vec3 = [0, 0, 0];
  private readonly _p1: Vec3 = [0, 0, 0];
  private readonly _p2: Vec3 = [0, 0, 0];
  private readonly _p3: Vec3 = [0, 0, 0];

  constructor(
    parsed: ParsedBoneChannel,
    evaluator: MolangEvaluator,
    onWarning?: (warning: KeyframeExpressionWarning) => void,
  ) {
    this.channel = parsed.channel;
    const fallback = parsed.channel === 'scale' ? 1 : 0;
    const reported = new Set<string>();
    const compileScalar = (value: MolangValue, axis: 0 | 1 | 2, time?: number): CompiledScalar => {
      if (typeof value === 'number') return value;
      try {
        return evaluator.compile(value);
      } catch (error) {
        // Importers can recover one invalid scalar without losing the valid
        // axes or other clips. Standalone tracks remain strict by default.
        if (!onWarning) throw error;
        const key = JSON.stringify([time, axis, value]);
        if (!reported.has(key)) {
          reported.add(key);
          onWarning({
            channel: parsed.channel,
            ...(time !== undefined ? { time } : {}),
            axis, expression: value, fallback,
            message: error instanceof Error ? error.message : String(error),
          });
        }
        return fallback;
      }
    };
    const compileVec3 = (vec: MolangVec3, time?: number): CompiledVec3 => [
      compileScalar(vec[0], 0, time), compileScalar(vec[1], 1, time), compileScalar(vec[2], 2, time),
    ];
    if (parsed.staticValue) {
      this.staticCompiled = compileVec3(parsed.staticValue);
    }
    this.keyframes = parsed.keyframes.map((kf) => ({
      time: kf.time,
      pre: compileVec3(kf.pre, kf.time),
      post: compileVec3(kf.post, kf.time),
      lerpMode: kf.lerpMode,
    }));
  }

  get keyframeCount(): number {
    return this.keyframes.length;
  }

  /**
   * Samples the track at `time` (seconds) and writes `[x, y, z]` into `out`.
   */
  sample(time: number, ctx: MolangEvalContext, out: Vec3): Vec3 {
    // 1. Static / continuous MoLang channel (no timestamp array)
    if (this.staticCompiled) {
      return evalVec3(this.staticCompiled, ctx, out);
    }

    const kfs = this.keyframes;
    const count = kfs.length;
    if (count === 0) {
      const def = this.channel === 'scale' ? 1 : 0;
      out[0] = def;
      out[1] = def;
      out[2] = def;
      return out;
    }

    // Before or at first keyframe
    if (count === 1 || time <= kfs[0].time) {
      return evalVec3(kfs[0].post, ctx, out);
    }

    // At or after last keyframe
    const lastIdx = count - 1;
    if (time >= kfs[lastIdx].time) {
      return evalVec3(kfs[lastIdx].pre, ctx, out);
    }

    // Binary search for segment [idx, idx + 1] such that kfs[idx].time <= time < kfs[idx+1].time
    let lo = 0;
    let hi = lastIdx - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      if (kfs[mid].time <= time) {
        if (time < kfs[mid + 1].time) {
          lo = mid;
          break;
        }
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }

    const idx = Math.max(0, Math.min(lastIdx - 1, lo));
    const k1 = kfs[idx];
    const k2 = kfs[idx + 1];

    // Step interpolation: hold left keyframe's outgoing value
    if (k1.lerpMode === 'step') {
      return evalVec3(k1.post, ctx, out);
    }

    const span = k2.time - k1.time;
    const u = span > 1e-8 ? (time - k1.time) / span : 0;

    evalVec3(k1.post, ctx, this._p1);
    evalVec3(k2.pre, ctx, this._p2);

    // Catmull-Rom spline interpolation (triggered if either endpoint requests catmullrom)
    if (k1.lerpMode === 'catmullrom' || k2.lerpMode === 'catmullrom') {
      const k0 = idx > 0 ? kfs[idx - 1] : k1;
      const k3 = idx + 2 <= lastIdx ? kfs[idx + 2] : k2;

      const t0 = idx > 0 ? k0.time : k1.time - span;
      const t3 = idx + 2 <= lastIdx ? k3.time : k2.time + span;

      if (idx > 0) {
        evalVec3(k0.post, ctx, this._p0);
      } else {
        // Mirror virtual point p0 = p1 - (p2 - p1) for smooth start tangent
        this._p0[0] = 2 * this._p1[0] - this._p2[0];
        this._p0[1] = 2 * this._p1[1] - this._p2[1];
        this._p0[2] = 2 * this._p1[2] - this._p2[2];
      }

      if (idx + 2 <= lastIdx) {
        evalVec3(k3.pre, ctx, this._p3);
      } else {
        // Mirror virtual point p3 = p2 + (p2 - p1) for smooth end tangent
        this._p3[0] = 2 * this._p2[0] - this._p1[0];
        this._p3[1] = 2 * this._p2[1] - this._p1[1];
        this._p3[2] = 2 * this._p2[2] - this._p1[2];
      }

      out[0] = catmullRomComponent(
        this._p0[0],
        this._p1[0],
        this._p2[0],
        this._p3[0],
        t0,
        k1.time,
        k2.time,
        t3,
        u,
      );
      out[1] = catmullRomComponent(
        this._p0[1],
        this._p1[1],
        this._p2[1],
        this._p3[1],
        t0,
        k1.time,
        k2.time,
        t3,
        u,
      );
      out[2] = catmullRomComponent(
        this._p0[2],
        this._p1[2],
        this._p2[2],
        this._p3[2],
        t0,
        k1.time,
        k2.time,
        t3,
        u,
      );
      return out;
    }

    // Default linear interpolation
    out[0] = this._p1[0] + (this._p2[0] - this._p1[0]) * u;
    out[1] = this._p1[1] + (this._p2[1] - this._p1[1]) * u;
    out[2] = this._p1[2] + (this._p2[2] - this._p1[2]) * u;
    return out;
  }
}
