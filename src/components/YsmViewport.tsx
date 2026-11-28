import {
  forwardRef, useEffect, useImperativeHandle, useRef, type CSSProperties,
} from 'react';
import {
  createYsmViewport, type YsmViewportController, type YsmViewportHandle,
  type ViewportTelemetry, type MolangQueryContext, type YsmModelInstance,
} from '../lib';

export type { CameraPreset, ViewportTelemetry, YsmViewportHandle } from '../lib';

export interface YsmViewportProps {
  queryRef: React.MutableRefObject<MolangQueryContext>;
  pausedRef: React.MutableRefObject<boolean>;
  onTelemetry: (telemetry: ViewportTelemetry) => void;
  onContextLost?: (lost: boolean) => void;
  onError?: (error: Error) => void;
  className?: string;
  style?: CSSProperties;
  /** Set false when the caller owns and disposes the model instance. */
  disposeModelOnUnmount?: boolean;
}

/** React adapter for the framework-independent viewport. */
export const YsmViewport = forwardRef<YsmViewportHandle, YsmViewportProps>(function YsmViewport(props, ref) {
  const container = useRef<HTMLDivElement>(null);
  const viewport = useRef<YsmViewportController | null>(null);
  const pendingModel = useRef<YsmModelInstance | null>(null);
  const latest = useRef(props);
  latest.current = props;
  useImperativeHandle(ref, () => ({
    setModel(model) {
      pendingModel.current = model;
      viewport.current?.setModel(model);
    },
    setCameraPreset: (preset) => viewport.current?.setCameraPreset(preset),
    forceRenderFrame: () => viewport.current?.forceRenderFrame(),
    getMemorySnapshot: () => viewport.current?.getMemorySnapshot() ?? {
      geometries: 0, textures: 0, baselineGeometries: 0, baselineTextures: 0,
    },
  }), []);
  useEffect(() => {
    try {
      const instance = createYsmViewport(container.current!, {
        getQuery: () => latest.current.queryRef.current,
        getPaused: () => latest.current.pausedRef.current,
        onTelemetry: (value) => latest.current.onTelemetry(value),
        onContextLost: (value) => latest.current.onContextLost?.(value),
        // Read the latest ownership setting on unmount, as before.
        get disposeModelOnUnmount() { return latest.current.disposeModelOnUnmount; },
      });
      viewport.current = instance;
      if (pendingModel.current) instance.setModel(pendingModel.current);
      return () => {
        instance.dispose();
        viewport.current = null;
        pendingModel.current = null;
      };
    } catch (reason) {
      latest.current.onError?.(reason instanceof Error ? reason : new Error(String(reason)));
    }
  }, []);
  return <div ref={container} data-testid="ysm-webgl-canvas" className={props.className}
    style={{ width: '100%', height: '100%', position: 'relative', userSelect: 'none', ...props.style }} />;
});
