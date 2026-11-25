'use client';

import {
  forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState,
  type CSSProperties, type ReactNode,
} from 'react';
import {
  YsmModelLoader, type YsmModelInstance, type YsmLoadSource, type YsmLoadOptions,
  type MolangQueryContext, type PlayOptions, type AnimationExpressionWarning,
} from '../lib';
import {
  YsmViewport, type YsmViewportHandle, type ViewportTelemetry, type CameraPreset,
} from '../components/YsmViewport';

export interface YsmViewerProps {
  /** URL, File, ZIP/YSM bytes, folder file list, or an in-memory model pack. */
  source?: YsmLoadSource | null;
  loadOptions?: YsmLoadOptions;
  /** Main clip. Defaults to idle, or the first clip when idle is unavailable. Null shows the base pose. */
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
  className?: string;
  style?: CSSProperties;
  loadingFallback?: ReactNode;
  onLoad?: (model: YsmModelInstance) => void;
  onError?: (error: Error) => void;
  onWarnings?: (warnings: AnimationExpressionWarning[]) => void;
  onLoadingChange?: (loading: boolean) => void;
  onTelemetry?: (telemetry: ViewportTelemetry) => void;
  onContextLost?: (lost: boolean) => void;
}

export interface YsmViewerHandle {
  /** The viewer owns this model and disposes it when the source changes or the viewer unmounts. */
  getModel(): YsmModelInstance | null;
  play(name: string, options?: PlayOptions): boolean;
  crossFadeTo(name: string, duration?: number, options?: PlayOptions): boolean;
  stop(name: string, fadeOut?: number): boolean;
  resetPose(): void;
  setCameraPreset(preset: CameraPreset): void;
  getMemorySnapshot(): ReturnType<YsmViewportHandle['getMemorySnapshot']> | null;
}

/** A self-contained YSM viewer. No CSS framework, global styles, or demo controls are required. */
export const YsmViewer = forwardRef<YsmViewerHandle, YsmViewerProps>(function YsmViewer(props, ref) {
  const {
    source, animation = 'idle', paused = false, timeScale = 1, loop, fadeDuration = 0.2,
    query, debug = false, showPivots = true, showBounds = true, cameraPreset,
    className, style, loadingFallback,
  } = props;
  const viewportRef = useRef<YsmViewportHandle>(null);
  const modelRef = useRef<YsmModelInstance | null>(null);
  const mainClipRef = useRef<{ model: YsmModelInstance; name: string } | null>(null);
  const queryRef = useRef<MolangQueryContext>({});
  const pausedRef = useRef(paused);
  queryRef.current = query ?? {};
  pausedRef.current = paused;
  const latest = useRef(props);
  latest.current = props;
  const [loader] = useState(() => new YsmModelLoader());
  const [model, setModel] = useState<YsmModelInstance | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const options = props.loadOptions;
  const loadOptions = useMemo<YsmLoadOptions>(() => ({
    filename: options?.filename, geometryIdentifier: options?.geometryIdentifier,
    unitScale: options?.unitScale, evaluator: options?.evaluator, fetchFn: options?.fetchFn,
  }), [options?.filename, options?.geometryIdentifier, options?.unitScale, options?.evaluator, options?.fetchFn]);

  const reportError = useCallback((reason: unknown) => {
    const error = reason instanceof Error ? reason : new Error(String(reason));
    setError(error);
    latest.current.onError?.(error);
  }, []);

  useImperativeHandle(ref, () => ({
    getModel: () => modelRef.current,
    play: (name, options) => modelRef.current?.play(name, options) ?? false,
    crossFadeTo: (name, duration, options) => modelRef.current?.crossFadeTo(name, duration, options) ?? false,
    stop: (name, fadeOut) => modelRef.current?.stop(name, fadeOut) ?? false,
    resetPose: () => modelRef.current?.resetPose(),
    setCameraPreset: (preset) => viewportRef.current?.setCameraPreset(preset),
    getMemorySnapshot: () => viewportRef.current?.getMemorySnapshot() ?? null,
  }), []);

  useEffect(() => {
    let cancelled = false;
    let owned: YsmModelInstance | null = null;
    setModel(null);
    setError(null);
    if (source == null) {
      setLoading(false);
      latest.current.onLoadingChange?.(false);
      return;
    }
    setLoading(true);
    latest.current.onLoadingChange?.(true);
    void loader.load(source, loadOptions).then((loaded) => {
      if (cancelled) { loaded.dispose(); return; }
      owned = loaded;
      modelRef.current = loaded;
      viewportRef.current?.setModel(loaded);
      setModel(loaded);
      latest.current.onLoad?.(loaded);
      latest.current.onWarnings?.(loaded.controller.getExpressionWarnings());
    }).catch((reason) => {
      if (!cancelled) reportError(reason);
    }).finally(() => {
      if (!cancelled) {
        setLoading(false);
        latest.current.onLoadingChange?.(false);
      }
    });
    return () => {
      cancelled = true;
      if (modelRef.current === owned) {
        viewportRef.current?.setModel(null);
        modelRef.current = null;
      }
      owned?.dispose();
    };
  }, [source, loadOptions, loader, reportError]);

  useEffect(() => {
    if (!model || model.isDisposed) return;
    if (animation === null) {
      const previous = mainClipRef.current;
      if (previous?.model === model) model.stop(previous.name, fadeDuration);
      mainClipRef.current = null;
      return;
    }
    const name = model.animations.includes(animation) ? animation
      : animation === 'idle' ? model.animations[0] : animation;
    if (name && model.crossFadeTo(name, fadeDuration, { timeScale, loop })) mainClipRef.current = { model, name };
  }, [model, animation, timeScale, loop, fadeDuration]);

  useEffect(() => {
    model?.setDebugVisible(debug, { showPivots, showBounds });
  }, [model, debug, showPivots, showBounds]);

  useEffect(() => {
    if (cameraPreset && model) viewportRef.current?.setCameraPreset(cameraPreset);
  }, [cameraPreset, model]);

  const onTelemetry = useCallback((value: ViewportTelemetry) => latest.current.onTelemetry?.(value), []);
  const onContextLost = useCallback((lost: boolean) => latest.current.onContextLost?.(lost), []);
  return (
    <div className={className} style={{ width: '100%', height: 400, position: 'relative', ...style }} aria-busy={loading}>
      <YsmViewport
        ref={viewportRef} queryRef={queryRef} pausedRef={pausedRef}
        onTelemetry={onTelemetry} onContextLost={onContextLost} onError={reportError}
        disposeModelOnUnmount={false}
      />
      {loading && loadingFallback != null && (
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none' }}>
          {loadingFallback}
        </div>
      )}
      {error && <div role="alert" style={{ position: 'absolute', inset: '12px 12px auto', color: '#fda4af', background: '#151820', padding: 12 }}>{error.message}</div>}
    </div>
  );
});
