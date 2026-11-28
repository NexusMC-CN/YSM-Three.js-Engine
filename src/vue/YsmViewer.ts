import {
  defineComponent, h, markRaw, onBeforeUnmount, onMounted, shallowRef, watch,
  type PropType, type SlotsType, type VNode,
} from 'vue';
import {
  createYsmViewer, type YsmViewerController, type YsmViewerHandle,
  type YsmViewerOptions, type YsmViewerSettings, type YsmViewerState,
  type YsmModelInstance, type AnimationExpressionWarning, type ViewportTelemetry,
} from '../lib';

export type YsmViewerProps = YsmViewerSettings;
export type { YsmViewerHandle } from '../lib';

/** Vue 3 adapter. Three.js instances are deliberately kept outside deep reactivity. */
export const YsmViewer = defineComponent({
  name: 'YsmViewer',
  props: {
    source: { type: [String, Object, Array] as PropType<YsmViewerSettings['source']>, default: null },
    loadOptions: Object as PropType<YsmViewerSettings['loadOptions']>,
    animation: { type: String as PropType<string | null>, default: 'idle' },
    paused: { type: Boolean, default: false },
    timeScale: { type: Number, default: 1 },
    loop: { type: [Boolean, String] as PropType<YsmViewerSettings['loop']>, default: undefined },
    fadeDuration: { type: Number, default: 0.2 },
    query: Object as PropType<YsmViewerSettings['query']>,
    debug: { type: Boolean, default: false },
    showPivots: { type: Boolean, default: true },
    showBounds: { type: Boolean, default: true },
    cameraPreset: String as PropType<YsmViewerSettings['cameraPreset']>,
  },
  emits: {
    load: (_model: YsmModelInstance) => true,
    error: (_error: Error) => true,
    warnings: (_warnings: AnimationExpressionWarning[]) => true,
    loadingChange: (_loading: boolean) => true,
    telemetry: (_telemetry: ViewportTelemetry) => true,
    contextLost: (_lost: boolean) => true,
  },
  slots: Object as SlotsType<{
    loading: () => VNode[];
    error: (props: { error: Error }) => VNode[];
  }>,
  setup(props, { emit, expose, slots }) {
    const container = shallowRef<HTMLElement | null>(null);
    const state = shallowRef<YsmViewerState>({ loading: false, error: null });
    let controller: YsmViewerController | null = null;
    const options = (): YsmViewerOptions => ({
      ...props,
      onLoad: (model) => emit('load', markRaw(model)),
      onError: (error) => emit('error', error),
      onWarnings: (warnings) => emit('warnings', warnings),
      onLoadingChange: (loading) => emit('loadingChange', loading),
      onTelemetry: (value) => emit('telemetry', value),
      onContextLost: (lost) => emit('contextLost', lost),
      onStateChange: (value) => { state.value = value; },
    });
    const handle: YsmViewerHandle = {
      getModel: () => controller?.getModel() ?? null,
      play: (name, options) => controller?.play(name, options) ?? false,
      crossFadeTo: (name, duration, options) => controller?.crossFadeTo(name, duration, options) ?? false,
      stop: (name, fadeOut) => controller?.stop(name, fadeOut) ?? false,
      resetPose: () => controller?.resetPose(),
      setCameraPreset: (preset) => controller?.setCameraPreset(preset),
      getMemorySnapshot: () => controller?.getMemorySnapshot() ?? null,
    };
    expose(handle);
    onMounted(() => {
      try {
        controller = createYsmViewer(container.value!, options());
      } catch (reason) {
        const error = reason instanceof Error ? reason : new Error(String(reason));
        state.value = { loading: false, error };
        emit('error', error);
      }
    });
    // Watch settings and individual load option values, never the model's Three.js graph.
    watch(() => [
      props.source, props.animation, props.paused, props.timeScale, props.loop, props.fadeDuration,
      props.query, props.debug, props.showPivots, props.showBounds, props.cameraPreset,
      props.loadOptions?.filename, props.loadOptions?.geometryIdentifier, props.loadOptions?.unitScale,
      props.loadOptions?.evaluator, props.loadOptions?.fetchFn,
    ], () => controller?.update(options()));
    onBeforeUnmount(() => { controller?.dispose(); controller = null; });
    return () => h('div', {
      style: { width: '100%', height: '400px', position: 'relative' },
      'aria-busy': state.value.loading,
    }, [
      h('div', { ref: container, 'data-testid': 'ysm-webgl-canvas', style: { width: '100%', height: '100%', position: 'relative', userSelect: 'none' } }),
      state.value.loading && slots.loading ? h('div', {
        style: { position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none' },
      }, slots.loading()) : null,
      state.value.error ? h('div', {
        role: 'alert', style: { position: 'absolute', inset: '12px 12px auto', color: '#fda4af', background: '#151820', padding: '12px' },
      }, slots.error ? slots.error({ error: state.value.error }) : state.value.error.message) : null,
    ]);
  },
});
