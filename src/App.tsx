import { useCallback, useEffect, useRef, useState } from 'react';
import {
  YsmModelInstance,
  YsmModelLoader,
  type MolangQueryContext,
  type YsmLoadSource,
} from './lib';
import {
  BUILT_IN_YSM_PACKS,
  exportBuiltInPackAsZip,
} from './demo/builtInPacks';
import {
  YsmViewport,
  type CameraPreset,
  type ViewportTelemetry,
  type YsmViewportHandle,
} from './components/YsmViewport';
import { ControlDock, type LeakTestResult } from './components/ControlDock';

const INITIAL_TELEMETRY: ViewportTelemetry = {
  fps: 60,
  rendererGeometries: 0,
  rendererTextures: 0,
  baselineGeometries: 0,
  baselineTextures: 0,
  modelDeltaGeometries: 0,
  modelDeltaTextures: 0,
  drawCalls: 0,
  triangles: 0,
  activeLayers: [],
  variables: {},
  molangCacheSize: 0,
  isSoftwareGl: false,
};

export default function App() {
  const viewportRef = useRef<YsmViewportHandle | null>(null);
  const loaderRef = useRef<YsmModelLoader | null>(null);
  if (!loaderRef.current) {
    loaderRef.current = new YsmModelLoader();
  }

  const instanceRef = useRef<YsmModelInstance | null>(null);
  const queryRef = useRef<MolangQueryContext>({
    ground_speed: 0.8,
    is_on_ground: 1,
  });
  const pausedRef = useRef(false);

  const [activePackId, setActivePackId] = useState(BUILT_IN_YSM_PACKS[0].id);
  const [customPackName, setCustomPackName] = useState<string | null>(null);
  const [modelTitle, setModelTitle] = useState(BUILT_IN_YSM_PACKS[0].name);
  const [modelMeta, setModelMeta] = useState({
    bones: 0,
    cubes: 0,
    textures: 0,
    sourceLabel: '内置示例包',
  });
  const [availableAnimations, setAvailableAnimations] = useState<string[]>([]);
  const [activeBaseAnim, setActiveBaseAnim] = useState('idle');
  const [fadeDuration, setFadeDuration] = useState(0.25);
  const [timeScale, setTimeScale] = useState(1.0);
  const [paused, setPaused] = useState(false);
  const [groundSpeed, setGroundSpeed] = useState(0.8);
  const [isOnGround, setIsOnGround] = useState(true);
  const [debugEnabled, setDebugEnabled] = useState(false);
  const [showPivots, setShowPivots] = useState(true);
  const [showBounds, setShowBounds] = useState(true);
  const [isDisposed, setIsDisposed] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);
  const [contextLost, setContextLost] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [telemetry, setTelemetry] = useState<ViewportTelemetry>(INITIAL_TELEMETRY);
  const [leakTestResult, setLeakTestResult] = useState<LeakTestResult | null>(null);
  const [molangOutput, setMolangOutput] = useState<{
    expr: string;
    result: string;
    error?: string;
  } | null>(null);

  const debugStateRef = useRef({ enabled: false, pivots: true, bounds: true });
  debugStateRef.current = { enabled: debugEnabled, pivots: showPivots, bounds: showBounds };

  const mountLoadedModel = useCallback(
    (
      loaded: YsmModelInstance,
      displayTitle: string,
      sourceLabel: string,
      defaultAnim?: string,
    ) => {
      // Dispose previous instance cleanly before mounting next
      const prev = instanceRef.current;
      if (prev && !prev.isDisposed) {
        viewportRef.current?.setModel(null);
        prev.dispose();
      }

      instanceRef.current = loaded;
      loaded.setDebugVisible(debugStateRef.current.enabled, {
        showPivots: debugStateRef.current.pivots,
        showBounds: debugStateRef.current.bounds,
      });

      const animList = loaded.animations;
      setAvailableAnimations(animList);

      const initialClip =
        (defaultAnim && animList.includes(defaultAnim) ? defaultAnim : undefined) ??
        (animList.includes('idle') ? 'idle' : animList[0]);

      if (initialClip) {
        loaded.play(initialClip, { fadeIn: 0.15, timeScale });
        setActiveBaseAnim(initialClip);
      } else {
        setActiveBaseAnim('');
      }

      const stats = loaded.getResourceStats();
      setModelTitle(loaded.manifest?.name ?? displayTitle);
      setModelMeta({
        bones: stats.bones,
        cubes: stats.cubes,
        textures: stats.textures,
        sourceLabel,
      });
      setIsDisposed(false);
      setErrorMsg(null);
      viewportRef.current?.setModel(loaded);
    },
    [timeScale],
  );

  const loadBuiltInPack = useCallback(
    async (packId: string) => {
      const pack = BUILT_IN_YSM_PACKS.find((p) => p.id === packId) ?? BUILT_IN_YSM_PACKS[0];
      setIsLoading(true);
      setErrorMsg(null);
      setStatusNotice(null);
      try {
        const loaded = await loaderRef.current!.load(pack.buildFiles());
        setActivePackId(pack.id);
        setCustomPackName(null);
        mountLoadedModel(loaded, pack.name, '内置 YSM 规范包', pack.defaultAnimation);
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : String(err));
      } finally {
        setIsLoading(false);
      }
    },
    [mountLoadedModel],
  );

  // Initial load on mount
  useEffect(() => {
    void loadBuiltInPack(BUILT_IN_YSM_PACKS[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadArbitrarySource = useCallback(
    async (source: YsmLoadSource, label: string, filename?: string) => {
      setIsLoading(true);
      setErrorMsg(null);
      setStatusNotice(null);
      try {
        const loaded = await loaderRef.current!.load(source, { filename });
        setCustomPackName(label);
        mountLoadedModel(loaded, label, '外部导入');
        const warnings = loaded.controller.getExpressionWarnings();
        const firstWarning = warnings[0];
        const warningNotice = firstWarning
          ? `；${warnings.length} 处无效动画表达式已使用默认值（${firstWarning.animation} / ${firstWarning.bone ?? firstWarning.channel}）`
          : '';
        setStatusNotice(`已成功加载「${loaded.manifest?.name ?? label}」${warningNotice}`);
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : String(err));
      } finally {
        setIsLoading(false);
      }
    },
    [mountLoadedModel],
  );

  const handleLoadZipRoundTrip = useCallback(async () => {
    const pack = BUILT_IN_YSM_PACKS.find((p) => p.id === activePackId) ?? BUILT_IN_YSM_PACKS[0];
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const zipBlob = await exportBuiltInPackAsZip(pack);
      const loaded = await loaderRef.current!.load(zipBlob, { filename: `${pack.id}.zip` });
      setCustomPackName(null);
      mountLoadedModel(
        loaded,
        pack.name,
        `fflate Zip (${(zipBlob.size / 1024).toFixed(1)} KB)`,
        pack.defaultAnimation,
      );
      setStatusNotice(
        `已完成 Zip 打包 (${(zipBlob.size / 1024).toFixed(1)} KB) 并通过 fflate 解包渲染`,
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, [activePackId, mountLoadedModel]);

  const handleExportCurrentZip = useCallback(async () => {
    const pack = BUILT_IN_YSM_PACKS.find((p) => p.id === activePackId) ?? BUILT_IN_YSM_PACKS[0];
    try {
      const blob = await exportBuiltInPackAsZip(pack);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${pack.id}.ysm-pack.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatusNotice(`已导出 ${pack.id}.ysm-pack.zip (${(blob.size / 1024).toFixed(1)} KB)`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  }, [activePackId]);

  const handleUploadFiles = useCallback(
    (files: FileList) => {
      if (files.length === 0) return;
      const first = files[0];
      const label =
        files.length === 1
          ? first.name
          : (first.webkitRelativePath?.split('/')[0] || '本地文件夹');
      void loadArbitrarySource(files, label, first.name);
    },
    [loadArbitrarySource],
  );

  const handleCrossFadeAnim = useCallback(
    (name: string) => {
      const model = instanceRef.current;
      if (!model || model.isDisposed) return;
      model.crossFadeTo(name, fadeDuration, { timeScale });
      setActiveBaseAnim(name);
    },
    [fadeDuration, timeScale],
  );

  const handlePlayAdditiveAnim = useCallback(
    (name: string) => {
      const model = instanceRef.current;
      if (!model || model.isDisposed) return;
      model.play(name, {
        fadeIn: Math.min(0.12, fadeDuration),
        fadeOut: Math.min(0.18, fadeDuration || 0.15),
        timeScale,
        resetTime: true,
      });
    },
    [fadeDuration, timeScale],
  );

  const handleStopAnim = useCallback(
    (name: string) => {
      const model = instanceRef.current;
      if (!model || model.isDisposed) return;
      model.stop(name, Math.min(0.15, fadeDuration));
      if (activeBaseAnim === name) {
        setActiveBaseAnim('');
      }
    },
    [activeBaseAnim, fadeDuration],
  );

  const handleResetPose = useCallback(() => {
    const model = instanceRef.current;
    if (!model || model.isDisposed) return;
    model.resetPose();
    setActiveBaseAnim('');
  }, []);

  const handleTimeScaleChange = useCallback((val: number) => {
    setTimeScale(val);
    const model = instanceRef.current;
    if (!model || model.isDisposed) return;
    for (const layer of model.getActiveLayers()) {
      model.setTimeScale(layer.name, val);
    }
  }, []);

  const handleTogglePause = useCallback(() => {
    setPaused((p) => {
      const next = !p;
      pausedRef.current = next;
      return next;
    });
  }, []);

  const handleGroundSpeedChange = useCallback((val: number) => {
    setGroundSpeed(val);
    queryRef.current.ground_speed = val;
  }, []);

  const handleIsOnGroundChange = useCallback((val: boolean) => {
    setIsOnGround(val);
    queryRef.current.is_on_ground = val ? 1 : 0;
  }, []);

  const handleEvalMolang = useCallback((expr: string) => {
    const model = instanceRef.current;
    if (!model || model.isDisposed) {
      setMolangOutput({ expr, result: '', error: '请先加载模型后再求值' });
      return;
    }
    try {
      const result = model.controller.evaluator.evaluate(expr, {
        query: {
          ...queryRef.current,
          anim_time: model.getActiveLayers()[0]?.time ?? 0,
          life_time: performance.now() / 1000,
          delta_time: 1 / 60,
        },
        variables: model.controller.variables,
        readBoneRotation: model.readBoneRotation,
      });
      setMolangOutput({ expr, result: Number(result).toFixed(4) });
    } catch (err) {
      setMolangOutput({
        expr,
        result: '',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }, []);

  const handleToggleDebug = useCallback(
    (enabled: boolean) => {
      setDebugEnabled(enabled);
      instanceRef.current?.setDebugVisible(enabled, { showPivots, showBounds });
    },
    [showPivots, showBounds],
  );

  const handleTogglePivots = useCallback(
    (show: boolean) => {
      setShowPivots(show);
      instanceRef.current?.setDebugVisible(debugEnabled, { showPivots: show, showBounds });
    },
    [debugEnabled, showBounds],
  );

  const handleToggleBounds = useCallback(
    (show: boolean) => {
      setShowBounds(show);
      instanceRef.current?.setDebugVisible(debugEnabled, { showPivots, showBounds: show });
    },
    [debugEnabled, showPivots],
  );

  const handleCameraPreset = useCallback((preset: CameraPreset) => {
    viewportRef.current?.setCameraPreset(preset);
  }, []);

  const handleDisposeModel = useCallback(() => {
    const model = instanceRef.current;
    if (model && !model.isDisposed) {
      viewportRef.current?.setModel(null);
      model.dispose();
    }
    setIsDisposed(true);
    setActiveBaseAnim('');
    setStatusNotice('已调用 model.dispose() 释放全部几何体、材质与贴图');
  }, []);

  const handleReloadModel = useCallback(() => {
    void loadBuiltInPack(activePackId);
  }, [activePackId, loadBuiltInPack]);

  const handleRunLeakTest = useCallback(async () => {
    const vp = viewportRef.current;
    if (!vp) return;
    setIsLoading(true);
    setStatusNotice(null);
    try {
      // 1. Dispose current model to establish clean baseline
      if (instanceRef.current && !instanceRef.current.isDisposed) {
        vp.setModel(null);
        instanceRef.current.dispose();
      }
      vp.forceRenderFrame();
      const before = vp.getMemorySnapshot();

      // 2. Load current pack into scene and render once so WebGL uploads geometries/textures
      const pack = BUILT_IN_YSM_PACKS.find((p) => p.id === activePackId) ?? BUILT_IN_YSM_PACKS[0];
      const tempInstance = await loaderRef.current!.load(pack.buildFiles());
      vp.setModel(tempInstance);
      vp.forceRenderFrame();
      const loaded = vp.getMemorySnapshot();

      // 3. Dispose completely and verify memory returns exactly to baseline
      vp.setModel(null);
      tempInstance.dispose();
      vp.forceRenderFrame();
      const after = vp.getMemorySnapshot();

      const passed =
        after.geometries === before.geometries &&
        after.textures === before.textures &&
        loaded.geometries > before.geometries;

      setLeakTestResult({
        passed,
        beforeGeometries: before.geometries,
        beforeTextures: before.textures,
        loadedGeometries: loaded.geometries,
        loadedTextures: loaded.textures,
        afterDisposeGeometries: after.geometries,
        afterDisposeTextures: after.textures,
        timestamp: new Date().toLocaleTimeString(),
      });

      // Reload the pack so the viewport stays populated for the user
      const restored = await loaderRef.current!.load(pack.buildFiles());
      mountLoadedModel(restored, pack.name, '内置 YSM 规范包', pack.defaultAnimation);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, [activePackId, mountLoadedModel]);

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleUploadFiles(e.dataTransfer.files);
    }
  };

  return (
    <div
      data-testid="ysm-app-shell"
      data-model-id={activePackId}
      data-disposed={String(isDisposed)}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      className="relative w-screen h-screen overflow-hidden bg-[#11141b] text-slate-100"
    >
      {/* Full-Viewport WebGL2 3D Canvas */}
      <YsmViewport
        ref={viewportRef}
        queryRef={queryRef}
        pausedRef={pausedRef}
        onTelemetry={setTelemetry}
        onContextLost={setContextLost}
      />

      {/* Minimal Top Studio Header Bar (3-zone contract, zero pill clutter, zero pulsing dots) */}
      <header className="fixed top-0 inset-x-0 z-20 flex items-center justify-between gap-6 px-5 py-3 bg-[#11141b]/90 border-b border-slate-800/80 pointer-events-none">
        <div className="flex items-center gap-4 min-w-0 pointer-events-auto">
          <h1 className="text-sm font-bold tracking-tight text-slate-100 whitespace-nowrap shrink-0">
            YSM Three.js Engine
          </h1>
          <div className="hidden sm:flex items-center gap-2 text-xs text-slate-400 truncate">
            <span className="text-slate-200 font-medium truncate">{modelTitle}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono-tabular whitespace-nowrap">
              {modelMeta.bones} 骨骼 / {modelMeta.cubes} 方块 / {modelMeta.textures} 贴图
            </span>
            <span aria-hidden="true">·</span>
            <span className="whitespace-nowrap">{modelMeta.sourceLabel}</span>
          </div>
        </div>

        <div
          data-testid="webgl-memory-bar"
          className="flex items-center gap-4 text-xs font-mono-tabular text-slate-300 whitespace-nowrap shrink-0 pointer-events-auto"
        >
          <span>
            <span className="text-slate-500">FPS </span>
            <span className="text-amber-400 font-semibold">{telemetry.fps}</span>
          </span>
          <span aria-hidden="true" className="text-slate-700">
            /
          </span>
          <span>
            <span className="text-slate-500">模型显存 </span>
            <span className="text-slate-100">
              {telemetry.modelDeltaGeometries}G · {telemetry.modelDeltaTextures}T
            </span>
          </span>
          <span aria-hidden="true" className="hidden md:inline text-slate-700">
            /
          </span>
          <span className="hidden md:inline text-slate-400">
            总计 {telemetry.rendererGeometries}G · {telemetry.rendererTextures}T · {telemetry.drawCalls} DC
          </span>
        </div>
      </header>

      {/* Non-blocking Status / Error Banner positioned cleanly under the top bar */}
      {(errorMsg || statusNotice || contextLost) && (
        <div className="fixed top-14 left-1/2 -translate-x-1/2 z-30 max-w-xl px-4 py-2 rounded-lg text-xs border bg-[#151820] border-slate-700 text-slate-200 flex items-center gap-3 shadow-lg">
          <span className={errorMsg || contextLost ? 'text-rose-300' : 'text-emerald-300'}>
            {contextLost
              ? 'WebGL2 上下文已丢失，正在尝试恢复…'
              : errorMsg ?? statusNotice}
          </span>
          <button
            type="button"
            onClick={() => {
              setErrorMsg(null);
              setStatusNotice(null);
            }}
            className="text-slate-400 hover:text-white shrink-0 cursor-pointer"
          >
            关闭
          </button>
        </div>
      )}

      {/* Drag-and-Drop Overlay */}
      {dragOver && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-[#0f1115]/85 border-2 border-dashed border-amber-500 pointer-events-none">
          <div className="text-center space-y-1">
            <p className="text-base font-semibold text-amber-400">
              释放以加载 YSM 模型包
            </p>
            <p className="text-xs text-slate-300">
              支持 .zip / .ysm 模型包或包含 main.json / *.animation.json / *.png 的文件集
            </p>
          </div>
        </div>
      )}

      {/* Collapsible Unified Bottom Control Dock */}
      <ControlDock
        packs={BUILT_IN_YSM_PACKS}
        activePackId={activePackId}
        customPackName={customPackName}
        availableAnimations={availableAnimations}
        activeBaseAnim={activeBaseAnim}
        fadeDuration={fadeDuration}
        timeScale={timeScale}
        paused={paused}
        groundSpeed={groundSpeed}
        isOnGround={isOnGround}
        debugEnabled={debugEnabled}
        showPivots={showPivots}
        showBounds={showBounds}
        isDisposed={isDisposed}
        isLoading={isLoading}
        telemetry={telemetry}
        leakTestResult={leakTestResult}
        molangOutput={molangOutput}
        onSelectPack={(id) => void loadBuiltInPack(id)}
        onLoadZipRoundTrip={() => void handleLoadZipRoundTrip()}
        onExportCurrentZip={() => void handleExportCurrentZip()}
        onUploadFiles={handleUploadFiles}
        onCrossFadeAnim={handleCrossFadeAnim}
        onPlayAdditiveAnim={handlePlayAdditiveAnim}
        onStopAnim={handleStopAnim}
        onResetPose={handleResetPose}
        onFadeDurationChange={setFadeDuration}
        onTimeScaleChange={handleTimeScaleChange}
        onTogglePause={handleTogglePause}
        onGroundSpeedChange={handleGroundSpeedChange}
        onIsOnGroundChange={handleIsOnGroundChange}
        onEvalMolang={handleEvalMolang}
        onToggleDebug={handleToggleDebug}
        onTogglePivots={handleTogglePivots}
        onToggleBounds={handleToggleBounds}
        onCameraPreset={handleCameraPreset}
        onDisposeModel={handleDisposeModel}
        onReloadModel={handleReloadModel}
        onRunLeakTest={() => void handleRunLeakTest()}
      />
    </div>
  );
}
