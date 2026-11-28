'use client';

import {
  forwardRef, useEffect, useImperativeHandle, useRef, useState,
  type CSSProperties, type ReactNode,
} from 'react';
import {
  createYsmViewer, type YsmViewerController, type YsmViewerOptions,
  type YsmViewerState, type YsmViewerHandle,
} from '../lib';

export type { YsmViewerHandle } from '../lib';

export interface YsmViewerProps extends Omit<YsmViewerOptions, 'onStateChange'> {
  className?: string;
  style?: CSSProperties;
  loadingFallback?: ReactNode;
}

/** React lifecycle and UI adapter. Model ownership and rendering live in the engine. */
export const YsmViewer = forwardRef<YsmViewerHandle, YsmViewerProps>(function YsmViewer(props, ref) {
  const container = useRef<HTMLDivElement>(null);
  const controller = useRef<YsmViewerController | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const [state, setState] = useState<YsmViewerState>({ loading: false, error: null });
  useImperativeHandle(ref, () => ({
    getModel: () => controller.current?.getModel() ?? null,
    play: (name, options) => controller.current?.play(name, options) ?? false,
    crossFadeTo: (name, duration, options) => controller.current?.crossFadeTo(name, duration, options) ?? false,
    stop: (name, fadeOut) => controller.current?.stop(name, fadeOut) ?? false,
    resetPose: () => controller.current?.resetPose(),
    setCameraPreset: (preset) => controller.current?.setCameraPreset(preset),
    getMemorySnapshot: () => controller.current?.getMemorySnapshot() ?? null,
  }), []);
  useEffect(() => {
    try {
      const instance = createYsmViewer(container.current!, { ...latest.current, onStateChange: setState });
      controller.current = instance;
      return () => { instance.dispose(); controller.current = null; };
    } catch (reason) {
      const error = reason instanceof Error ? reason : new Error(String(reason));
      setState({ loading: false, error });
      latest.current.onError?.(error);
    }
  }, []);
  useEffect(() => {
    // Explicit undefined fields reset removed props to the engine defaults.
    controller.current?.update({
      source: props.source, loadOptions: props.loadOptions, animation: props.animation,
      paused: props.paused, timeScale: props.timeScale, loop: props.loop, fadeDuration: props.fadeDuration,
      query: props.query, debug: props.debug, showPivots: props.showPivots, showBounds: props.showBounds,
      cameraPreset: props.cameraPreset, onLoad: props.onLoad, onError: props.onError,
      onWarnings: props.onWarnings, onLoadingChange: props.onLoadingChange,
      onTelemetry: props.onTelemetry, onContextLost: props.onContextLost,
    });
  });
  return (
    <div className={props.className} style={{ width: '100%', height: 400, position: 'relative', ...props.style }} aria-busy={state.loading}>
      <div ref={container} data-testid="ysm-webgl-canvas" style={{ width: '100%', height: '100%', position: 'relative', userSelect: 'none' }} />
      {state.loading && props.loadingFallback != null && (
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none' }}>
          {props.loadingFallback}
        </div>
      )}
      {state.error && <div role="alert" style={{ position: 'absolute', inset: '12px 12px auto', color: '#fda4af', background: '#151820', padding: 12 }}>{state.error.message}</div>}
    </div>
  );
});
