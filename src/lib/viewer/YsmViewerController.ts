import type { PlayOptions, AnimationExpressionWarning } from '../animation/AnimationController';
import { YsmModelLoader } from '../loader/YsmModelLoader';
import type { YsmModelInstance } from '../loader/YsmModelInstance';
import type { YsmLoadOptions, YsmLoadSource } from '../loader/types';
import type { MolangQueryContext } from '../molang/MolangEvaluator';
import {
  createYsmViewport, type CameraPreset, type ViewportTelemetry,
  type YsmViewportController, type YsmViewportHandle,
} from './YsmViewport';

export interface YsmViewerSettings {
  source?: YsmLoadSource | null;
  loadOptions?: YsmLoadOptions;
  /** Defaults to idle, or the first clip when idle is unavailable. Null stops the main clip. */
  animation?: string | null;
  paused?: boolean;
  timeScale?: number;
  loop?: PlayOptions['loop'];
  fadeDuration?: number;
  query?: MolangQueryContext;
  debug?: boolean;
  showPivots?: boolean;
  showBounds?: boolean;
  /** Omit to automatically frame the loaded model. */
  cameraPreset?: CameraPreset;
}

export interface YsmViewerState {
  loading: boolean;
  error: Error | null;
}

export interface YsmViewerOptions extends YsmViewerSettings {
  onLoad?: (model: YsmModelInstance) => void;
  onError?: (error: Error) => void;
  onWarnings?: (warnings: AnimationExpressionWarning[]) => void;
  onLoadingChange?: (loading: boolean) => void;
  onTelemetry?: (telemetry: ViewportTelemetry) => void;
  onContextLost?: (lost: boolean) => void;
  onStateChange?: (state: YsmViewerState) => void;
}

export interface YsmViewerHandle {
  /** Owned by the viewer; released when the source changes or the viewer is disposed. */
  getModel(): YsmModelInstance | null;
  play(name: string, options?: PlayOptions): boolean;
  crossFadeTo(name: string, duration?: number, options?: PlayOptions): boolean;
  stop(name: string, fadeOut?: number): boolean;
  resetPose(): void;
  setCameraPreset(preset: CameraPreset): void;
  getMemorySnapshot(): ReturnType<YsmViewportHandle['getMemorySnapshot']> | null;
}

type NormalizedOptions = YsmViewerOptions & Required<Pick<YsmViewerOptions,
  'animation' | 'paused' | 'timeScale' | 'fadeDuration' | 'debug' | 'showPivots' | 'showBounds'>>;

function normalize(options: YsmViewerOptions): NormalizedOptions {
  return {
    ...options,
    source: options.source ?? null,
    // Snapshot option fields so equivalent inline objects do not restart loading.
    loadOptions: { ...options.loadOptions },
    animation: options.animation === undefined ? 'idle' : options.animation,
    paused: options.paused ?? false,
    timeScale: options.timeScale ?? 1,
    fadeDuration: options.fadeDuration ?? 0.2,
    debug: options.debug ?? false,
    showPivots: options.showPivots ?? true,
    showBounds: options.showBounds ?? true,
  };
}

const loadKeys = ['filename', 'geometryIdentifier', 'unitScale', 'evaluator', 'fetchFn'] as const;
const playbackKeys = ['animation', 'timeScale', 'loop', 'fadeDuration'] as const;
const debugKeys = ['debug', 'showPivots', 'showBounds'] as const;

/** Framework-independent owner of the viewport, asynchronous loads and playback settings. */
export class YsmViewerController implements YsmViewerHandle {
  private readonly viewport: YsmViewportController;
  private readonly loader = new YsmModelLoader();
  private options: NormalizedOptions = normalize({});
  private model: YsmModelInstance | null = null;
  private mainClip: string | null = null;
  private generation = 0;
  private disposed = false;
  private initialized = false;
  private state: YsmViewerState = { loading: false, error: null };
  private pending: Promise<YsmModelInstance | null> = Promise.resolve(null);

  constructor(container: HTMLElement, options: YsmViewerOptions = {}) {
    this.viewport = createYsmViewport(container, {
      getQuery: () => this.options.query ?? {},
      getPaused: () => this.options.paused ?? false,
      onTelemetry: (value) => this.options.onTelemetry?.(value),
      onContextLost: (value) => this.options.onContextLost?.(value),
      disposeModelOnUnmount: false,
    });
    this.update(options);
  }

  /** Apply only the supplied fields. Passing undefined restores that field's default. */
  update(changes: Partial<YsmViewerOptions>): void {
    if (this.disposed) return;
    const previous = this.options;
    const next = this.options = normalize({ ...previous, ...changes });
    const reload = !this.initialized || previous.source !== next.source
      || loadKeys.some((key) => previous.loadOptions?.[key] !== next.loadOptions?.[key]);
    this.initialized = true;
    if (reload) {
      this.pending = this.loadCurrentSource();
      return;
    }
    if (playbackKeys.some((key) => previous[key] !== next[key])) this.applyPlayback();
    if (debugKeys.some((key) => previous[key] !== next[key])) this.applyDebug();
    if (next.cameraPreset && previous.cameraPreset !== next.cameraPreset) {
      this.viewport.setCameraPreset(next.cameraPreset);
    }
  }

  /** Load a source, or await an already pending load. Stale/failed loads resolve to null; errors use onError. */
  load(source: YsmLoadSource | null, options = this.options.loadOptions): Promise<YsmModelInstance | null> {
    if (this.disposed) return Promise.resolve(null);
    this.update({ source, loadOptions: options });
    return this.pending;
  }

  getState(): YsmViewerState { return { ...this.state }; }
  getModel(): YsmModelInstance | null { return this.model; }
  play(name: string, options?: PlayOptions): boolean { return this.model?.play(name, options) ?? false; }
  crossFadeTo(name: string, duration?: number, options?: PlayOptions): boolean {
    const played = this.model?.crossFadeTo(name, duration, options) ?? false;
    if (played) this.mainClip = name;
    return played;
  }
  stop(name: string, fadeOut?: number): boolean { return this.model?.stop(name, fadeOut) ?? false; }
  resetPose(): void { this.model?.resetPose(); this.mainClip = null; }
  setCameraPreset(preset: CameraPreset): void { if (!this.disposed) this.viewport.setCameraPreset(preset); }
  getMemorySnapshot(): ReturnType<YsmViewerHandle['getMemorySnapshot']> {
    return this.disposed ? null : this.viewport.getMemorySnapshot();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.generation++;
    this.releaseModel();
    this.viewport.dispose();
    this.state = { loading: false, error: null };
  }

  private releaseModel(): void {
    this.viewport.setModel(null);
    this.model?.dispose();
    this.model = null;
    this.mainClip = null;
  }

  private publishState(state: YsmViewerState): void {
    const loadingChanged = this.state.loading !== state.loading;
    this.state = state;
    this.options.onStateChange?.({ ...state });
    if (loadingChanged && this.state === state && !this.disposed) this.options.onLoadingChange?.(state.loading);
  }

  private async loadCurrentSource(): Promise<YsmModelInstance | null> {
    const generation = ++this.generation;
    const { source, loadOptions } = this.options;
    this.releaseModel();
    this.publishState({ loading: source != null, error: null });
    if (this.disposed || generation !== this.generation) return null;
    if (source == null) return null;
    let loaded: YsmModelInstance;
    try {
      loaded = await this.loader.load(source, loadOptions);
    } catch (reason) {
      if (this.disposed || generation !== this.generation) return null;
      const error = reason instanceof Error ? reason : new Error(String(reason));
      this.publishState({ loading: false, error });
      if (!this.disposed && generation === this.generation) this.options.onError?.(error);
      return null;
    }
    if (this.disposed || generation !== this.generation) {
      loaded.dispose();
      return null;
    }
    this.model = loaded;
    this.viewport.setModel(loaded);
    this.applyPlayback();
    this.applyDebug();
    if (this.options.cameraPreset) this.viewport.setCameraPreset(this.options.cameraPreset);
    this.publishState({ loading: false, error: null });
    if (this.disposed || generation !== this.generation) return null;
    this.options.onLoad?.(loaded);
    if (!this.disposed && generation === this.generation) {
      this.options.onWarnings?.(loaded.controller.getExpressionWarnings());
    }
    return !this.disposed && generation === this.generation ? loaded : null;
  }

  private applyPlayback(): void {
    const model = this.model;
    if (!model || model.isDisposed) return;
    const { animation, fadeDuration, timeScale, loop } = this.options;
    if (animation === null) {
      if (this.mainClip) model.stop(this.mainClip, fadeDuration);
      this.mainClip = null;
      return;
    }
    const name = model.animations.includes(animation) ? animation
      : animation === 'idle' ? model.animations[0] : animation;
    if (name && model.crossFadeTo(name, fadeDuration, { timeScale, loop })) this.mainClip = name;
  }

  private applyDebug(): void {
    const { debug, showPivots, showBounds } = this.options;
    this.model?.setDebugVisible(debug, { showPivots, showBounds });
  }
}

/** Creates a complete viewer without React or Vue. The container must have a nonzero height. */
export function createYsmViewer(container: HTMLElement, options: YsmViewerOptions = {}): YsmViewerController {
  return new YsmViewerController(container, options);
}
