import type * as THREE from 'three';
import type { ParsedModel, YsmManifest } from '../parser/types';
import type { MolangQueryContext } from '../molang/MolangEvaluator';
import {
  AnimationController,
  type ActiveLayerInfo,
  type PlayOptions,
} from '../animation/AnimationController';
import type { BoneRigNode, BuiltRig } from '../renderer/RigBuilder';

export interface DebugDisplayOptions {
  showPivots?: boolean;
  showBounds?: boolean;
}

export interface ModelResourceStats {
  geometries: number;
  materials: number;
  textures: number;
  bones: number;
  cubes: number;
  disposed: boolean;
}

/**
 * Runtime instance of a loaded Yes Steve Model (YSM) ready to be mounted into a Three.js scene.
 *
 * ```ts
 * scene.add(model.root);
 * model.play('walk');
 * // Per frame:
 * model.update(dt, { ground_speed: 0.8, is_on_ground: 1 });
 * // On teardown:
 * model.dispose();
 * ```
 */
export class YsmModelInstance {
  readonly root: THREE.Group;
  readonly model: ParsedModel;
  readonly manifest?: YsmManifest;
  readonly controller: AnimationController;
  readonly bones: Map<string, BoneRigNode>;

  private readonly rig: BuiltRig;
  private disposed = false;

  constructor(
    model: ParsedModel,
    rig: BuiltRig,
    controller: AnimationController,
    manifest?: YsmManifest,
  ) {
    this.model = model;
    this.rig = rig;
    this.root = rig.root;
    this.bones = rig.bones;
    this.controller = controller;
    this.manifest = manifest;
  }

  /** Available animation clip names */
  get animations(): string[] {
    return this.controller.getClipNames();
  }

  /** Whether this model instance has already been disposed */
  get isDisposed(): boolean {
    return this.disposed;
  }

  /**
   * Starts playing an animation clip (additively blended over the base pose).
   */
  play(name: string, options?: PlayOptions): boolean {
    if (this.disposed) return false;
    return this.controller.play(name, options);
  }

  /**
   * Smoothly cross-fades from all active animations to `name` over `duration` seconds.
   */
  crossFadeTo(name: string, duration = 0.25, options?: PlayOptions): boolean {
    if (this.disposed) return false;
    return this.controller.crossFadeTo(name, duration, options);
  }

  /**
   * Stops a specific animation clip (with optional fadeOut in seconds).
   */
  stop(name: string, fadeOut?: number): boolean {
    if (this.disposed) return false;
    return this.controller.stop(name, fadeOut);
  }

  /**
   * Stops all active animations and optionally fades them out.
   */
  stopAll(fadeOut = 0): void {
    if (this.disposed) return;
    this.controller.stopAll(fadeOut);
  }

  /**
   * Adjusts playback speed multiplier for an active animation clip.
   */
  setTimeScale(name: string, factor: number): boolean {
    if (this.disposed) return false;
    return this.controller.setTimeScale(name, factor);
  }

  /**
   * Advances animations by `dt` seconds with optional MoLang `query` context
   * and applies the resulting additive bone transforms to the Three.js rig.
   */
  update(dt: number, context?: MolangQueryContext): void {
    if (this.disposed) return;
    const deltas = this.controller.evaluate(dt, context);
    this.rig.applyPose(deltas);
  }

  /**
   * Resets all bones to their static bind pose without removing clips.
   */
  resetPose(): void {
    if (this.disposed) return;
    this.controller.stopAll(0);
    this.rig.resetBindPose();
  }

  /**
   * Toggles the bone debug view (pivot axes, hierarchy links, and cube bounding boxes).
   */
  setDebugVisible(visible: boolean, options?: DebugDisplayOptions): void {
    if (this.disposed) return;
    if (options?.showPivots !== undefined) {
      this.rig.debug.setShowPivots(options.showPivots);
    }
    if (options?.showBounds !== undefined) {
      this.rig.debug.setShowBounds(options.showBounds);
    }
    this.rig.debug.setVisible(visible);
  }

  /** Returns active animation layer states (useful for debugger UIs) */
  getActiveLayers(): ActiveLayerInfo[] {
    return this.controller.getActiveLayers();
  }

  /** Returns a shallow snapshot of persisted per-instance MoLang variables (`variable.*`) */
  getVariables(): Record<string, number> {
    return { ...this.controller.variables };
  }

  /** Returns GPU resource counts owned by this model instance */
  getResourceStats(): ModelResourceStats {
    return {
      geometries: this.disposed ? 0 : this.rig.geometryCount,
      materials: this.disposed ? 0 : this.rig.materialCount,
      textures: this.disposed ? 0 : this.rig.textureCount,
      bones: this.model.bones.length,
      cubes: this.model.cubeCount,
      disposed: this.disposed,
    };
  }

  /**
   * Detaches the model from its parent scene and releases every Geometry, Material,
   * Texture, and debug helper so `renderer.info.memory` returns to zero.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.controller.stopAll(0);
    this.root.removeFromParent();
    this.rig.dispose();
  }
}
