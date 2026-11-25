import { useRef, useState } from 'react';
import {
  Box,
  ChevronDown,
  ChevronUp,
  Cpu,
  Download,
  FolderOpen,
  Layers,
  Pause,
  Play,
  RotateCcw,
  ShieldCheck,
  Sliders,
  Trash2,
  Upload,
} from 'lucide-react';
import type { BuiltInPackMeta } from '../demo/builtInPacks';
import type { ActiveLayerInfo } from '../lib';
import type { CameraPreset, ViewportTelemetry } from './YsmViewport';

export type DockTab = 'models' | 'mixer' | 'molang' | 'debug';

export interface LeakTestResult {
  passed: boolean;
  beforeGeometries: number;
  beforeTextures: number;
  loadedGeometries: number;
  loadedTextures: number;
  afterDisposeGeometries: number;
  afterDisposeTextures: number;
  timestamp: string;
}

interface ControlDockProps {
  packs: BuiltInPackMeta[];
  activePackId: string;
  customPackName: string | null;
  availableAnimations: string[];
  activeBaseAnim: string;
  fadeDuration: number;
  timeScale: number;
  paused: boolean;
  groundSpeed: number;
  isOnGround: boolean;
  debugEnabled: boolean;
  showPivots: boolean;
  showBounds: boolean;
  isDisposed: boolean;
  isLoading: boolean;
  telemetry: ViewportTelemetry;
  leakTestResult: LeakTestResult | null;
  molangOutput: { expr: string; result: string; error?: string } | null;
  onSelectPack: (packId: string) => void;
  onLoadZipRoundTrip: () => void;
  onExportCurrentZip: () => void;
  onUploadFiles: (files: FileList) => void;
  onCrossFadeAnim: (name: string) => void;
  onPlayAdditiveAnim: (name: string) => void;
  onStopAnim: (name: string) => void;
  onResetPose: () => void;
  onFadeDurationChange: (val: number) => void;
  onTimeScaleChange: (val: number) => void;
  onTogglePause: () => void;
  onGroundSpeedChange: (val: number) => void;
  onIsOnGroundChange: (val: boolean) => void;
  onEvalMolang: (expr: string) => void;
  onToggleDebug: (enabled: boolean) => void;
  onTogglePivots: (show: boolean) => void;
  onToggleBounds: (show: boolean) => void;
  onCameraPreset: (preset: CameraPreset) => void;
  onDisposeModel: () => void;
  onReloadModel: () => void;
  onRunLeakTest: () => void;
}

export function ControlDock(props: ControlDockProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [activeTab, setActiveTab] = useState<DockTab>('models');
  const [molangInput, setMolangInput] = useState(
    'math.sin(q.life_time * 90) * math.clamp(q.ground_speed + 0.5, 0.5, 2)',
  );

  const zipInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);

  const handleMolangSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (molangInput.trim()) {
      props.onEvalMolang(molangInput.trim());
    }
  };

  const tabItems: { id: DockTab; label: string; icon: React.ReactNode }[] = [
    { id: 'models', label: '模型与导入', icon: <Box className="w-3.5 h-3.5" /> },
    { id: 'mixer', label: '动画混合', icon: <Layers className="w-3.5 h-3.5" /> },
    { id: 'molang', label: 'MoLang 调试', icon: <Sliders className="w-3.5 h-3.5" /> },
    { id: 'debug', label: '骨骼与显存', icon: <Cpu className="w-3.5 h-3.5" /> },
  ];

  const varEntries = Object.entries(props.telemetry.variables);

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-20 w-[min(920px,95vw)] flex flex-col items-center pointer-events-none">
      {/* Collapse / Expand Handle */}
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={!collapsed}
        className="pointer-events-auto mb-1.5 inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-slate-200 bg-[#151820] border border-slate-700/70 rounded-md hover:border-amber-500/60 hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
      >
        {collapsed ? (
          <>
            <ChevronUp className="w-3.5 h-3.5 text-amber-400" />
            <span>展开调试控制台</span>
          </>
        ) : (
          <>
            <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
            <span>收起控制台</span>
          </>
        )}
      </button>

      {/* Unified Bottom Studio Dock (no backdrop-filter over WebGL) */}
      {!collapsed && (
        <section
          aria-label="YSM 调试控制台"
          className="pointer-events-auto w-full bg-[#151820] border border-slate-700/70 rounded-xl shadow-2xl overflow-hidden"
        >
          {/* Tab Bar + Quick Playback Controls */}
          <div className="flex items-center justify-between gap-4 px-4 py-2.5 border-b border-slate-800 bg-[#12151c]">
            <div role="tablist" aria-label="调试功能分页" className="flex items-center gap-1">
              {tabItems.map((tab) => {
                const selected = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    onClick={() => setActiveTab(tab.id)}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      selected
                        ? 'bg-amber-500 text-slate-950 font-semibold'
                        : 'text-slate-300 hover:text-white hover:bg-slate-800/80'
                    }`}
                  >
                    {tab.icon}
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={props.onTogglePause}
                aria-label={props.paused ? '继续播放动画' : '暂停动画'}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-200 bg-slate-800/90 border border-slate-700/80 rounded-md hover:border-slate-500 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                {props.paused ? <Play className="w-3.5 h-3.5 text-amber-400" /> : <Pause className="w-3.5 h-3.5 text-amber-400" />}
                <span>{props.paused ? '继续' : '暂停'}</span>
              </button>
              <button
                type="button"
                onClick={() => props.onToggleDebug(!props.debugEnabled)}
                aria-pressed={props.debugEnabled}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  props.debugEnabled
                    ? 'bg-sky-500/20 text-sky-300 border-sky-500/60'
                    : 'bg-slate-800/90 text-slate-300 border-slate-700/80 hover:border-slate-500'
                }`}
              >
                <span>骨骼调试</span>
              </button>
            </div>
          </div>

          {/* Tab Panel Body */}
          <div className="p-4 max-h-[48vh] overflow-y-auto overscroll-contain">
            {/* TAB 1: Models & Import */}
            {activeTab === 'models' && (
              <div className="space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
                  {props.packs.map((pack) => {
                    const isSelected = !props.customPackName && props.activePackId === pack.id;
                    return (
                      <button
                        key={pack.id}
                        type="button"
                        onClick={() => props.onSelectPack(pack.id)}
                        disabled={props.isLoading}
                        className={`text-left p-3 rounded-lg border transition-colors cursor-pointer ${
                          isSelected
                            ? 'bg-slate-800/95 border-amber-500/80'
                            : 'bg-[#191d27] border-slate-800 hover:border-slate-600'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-semibold text-slate-100 truncate">
                            {pack.name}
                          </span>
                          <span className="text-[11px] text-slate-400 whitespace-nowrap shrink-0">
                            {pack.author}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-amber-400/90 truncate">{pack.uvFeature}</p>
                        <p className="mt-1 text-xs text-slate-400 line-clamp-1">{pack.description}</p>
                      </button>
                    );
                  })}
                </div>

                {/* Local Import & Zip Roundtrip Bar */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-800">
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      ref={zipInputRef}
                      type="file"
                      accept=".zip,.ysm"
                      className="hidden"
                      onChange={(e) => {
                        if (e.target.files?.length) {
                          props.onUploadFiles(e.target.files);
                          e.target.value = '';
                        }
                      }}
                    />
                    <input
                      ref={folderInputRef}
                      type="file"
                      multiple
                      // @ts-expect-error webkitdirectory is standard in Chromium/Firefox/Safari
                      webkitdirectory=""
                      className="hidden"
                      onChange={(e) => {
                        if (e.target.files?.length) {
                          props.onUploadFiles(e.target.files);
                          e.target.value = '';
                        }
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => zipInputRef.current?.click()}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-200 bg-slate-800 border border-slate-700 rounded-md hover:border-amber-500/60 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <Upload className="w-3.5 h-3.5 text-amber-400" />
                      <span>导入 Zip / .ysm</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => folderInputRef.current?.click()}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-200 bg-slate-800 border border-slate-700 rounded-md hover:border-amber-500/60 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <FolderOpen className="w-3.5 h-3.5 text-sky-400" />
                      <span>选择本地文件夹</span>
                    </button>
                    <button
                      type="button"
                      onClick={props.onLoadZipRoundTrip}
                      disabled={props.isLoading}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-amber-200 bg-amber-500/15 border border-amber-500/40 rounded-md hover:bg-amber-500/25 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <span>验证 fflate Zip 加载链路</span>
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={props.onExportCurrentZip}
                    disabled={props.isLoading}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-300 hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>导出当前包 (.zip)</span>
                  </button>
                </div>
              </div>
            )}

            {/* TAB 2: Animation Mixer */}
            {activeTab === 'mixer' && (
              <div className="space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-start">
                  {/* Base CrossFade Switcher */}
                  <div className="md:col-span-7 space-y-2">
                    <div className="flex items-center justify-between text-xs text-slate-400">
                      <span>主动画切换（crossFadeTo 平滑过渡）</span>
                      <button
                        type="button"
                        onClick={props.onResetPose}
                        className="inline-flex items-center gap-1 text-slate-300 hover:text-white cursor-pointer"
                      >
                        <RotateCcw className="w-3 h-3" />
                        <span>重置基础姿态</span>
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {props.availableAnimations.map((animName) => {
                        const isBase = props.activeBaseAnim === animName;
                        return (
                          <button
                            key={animName}
                            type="button"
                            onClick={() => props.onCrossFadeAnim(animName)}
                            className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                              isBase
                                ? 'bg-amber-500 text-slate-950 border-amber-400 font-semibold'
                                : 'bg-[#191d27] text-slate-200 border-slate-700 hover:border-slate-500'
                            }`}
                          >
                            {animName}
                          </button>
                        );
                      })}
                    </div>

                    {/* Additive Overlay Trigger */}
                    <div className="pt-1">
                      <div className="text-xs text-slate-400 mb-1.5">
                        多动画 Additive 叠加层（不中断当前主动作，例如边 walk 边 attack）
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {props.availableAnimations.map((animName) => (
                          <button
                            key={`add-${animName}`}
                            type="button"
                            onClick={() => props.onPlayAdditiveAnim(animName)}
                            className="px-2.5 py-1 text-xs font-medium text-sky-200 bg-sky-500/12 border border-sky-500/35 rounded-md hover:bg-sky-500/22 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                          >
                            + 叠加 {animName}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Fade & Speed Sliders */}
                  <div className="md:col-span-5 space-y-2.5 border-t md:border-t-0 md:border-l border-slate-800 pt-2.5 md:pt-0 md:pl-4">
                    <label className="block">
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-slate-300">过渡时长 (CrossFade / FadeIn)</span>
                        <span className="font-mono-tabular text-amber-400">
                          {props.fadeDuration.toFixed(2)}s
                        </span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={0.8}
                        step={0.05}
                        value={props.fadeDuration}
                        onChange={(e) => props.onFadeDurationChange(Number(e.target.value))}
                        className="studio-slider w-full"
                      />
                    </label>

                    <label className="block">
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-slate-300">播放速率 (timeScale)</span>
                        <span className="font-mono-tabular text-amber-400">
                          {props.timeScale.toFixed(2)}x
                        </span>
                      </div>
                      <input
                        type="range"
                        min={0.1}
                        max={2.5}
                        step={0.05}
                        value={props.timeScale}
                        onChange={(e) => props.onTimeScaleChange(Number(e.target.value))}
                        className="studio-slider w-full"
                      />
                    </label>

                    {/* Active Layers Readout */}
                    <div className="pt-1 border-t border-slate-800">
                      <div className="text-[11px] text-slate-400 mb-1">
                        当前活跃轨道 ({props.telemetry.activeLayers.length})
                      </div>
                      {props.telemetry.activeLayers.length === 0 ? (
                        <div className="text-xs text-slate-500">静态 Bind Pose（无运行中动画）</div>
                      ) : (
                        <div className="space-y-1 max-h-20 overflow-y-auto">
                          {props.telemetry.activeLayers.map((layer: ActiveLayerInfo) => (
                            <div
                              key={layer.name}
                              className="flex items-center justify-between gap-2 text-xs font-mono-tabular bg-[#191d27] px-2 py-1 rounded"
                            >
                              <span className="text-slate-200 truncate">{layer.name}</span>
                              <div className="flex items-center gap-2 shrink-0 text-slate-400">
                                <span>
                                  {layer.time.toFixed(2)}/{layer.length.toFixed(2)}s
                                </span>
                                <span className="text-amber-400">
                                  w={layer.weight.toFixed(2)}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => props.onStopAnim(layer.name)}
                                  aria-label={`停止动画 ${layer.name}`}
                                  className="text-slate-400 hover:text-rose-400 cursor-pointer"
                                >
                                  停止
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 3: MoLang Live Context & Evaluator */}
            {activeTab === 'molang' && (
              <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-start">
                <div className="md:col-span-5 space-y-3">
                  <label className="block">
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-slate-300 font-mono-tabular">query.ground_speed</span>
                      <span className="font-mono-tabular text-amber-400">
                        {props.groundSpeed.toFixed(2)}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={2}
                      step={0.05}
                      value={props.groundSpeed}
                      onChange={(e) => props.onGroundSpeedChange(Number(e.target.value))}
                      className="studio-slider w-full"
                    />
                  </label>

                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-300 font-mono-tabular">
                      query.is_on_ground
                    </span>
                    <div className="flex items-center gap-1 p-0.5 bg-[#191d27] border border-slate-800 rounded-md">
                      <button
                        type="button"
                        onClick={() => props.onIsOnGroundChange(true)}
                        className={`px-2.5 py-1 text-xs rounded transition-colors cursor-pointer ${
                          props.isOnGround
                            ? 'bg-amber-500 text-slate-950 font-semibold'
                            : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        1 (着地)
                      </button>
                      <button
                        type="button"
                        onClick={() => props.onIsOnGroundChange(false)}
                        className={`px-2.5 py-1 text-xs rounded transition-colors cursor-pointer ${
                          !props.isOnGround
                            ? 'bg-amber-500 text-slate-950 font-semibold'
                            : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        0 (悬空)
                      </button>
                    </div>
                  </div>

                  <div className="pt-2 border-t border-slate-800 text-xs text-slate-400 flex items-center justify-between">
                    <span>已编译闭包缓存数</span>
                    <span className="font-mono-tabular text-slate-200">
                      {props.telemetry.molangCacheSize} 个表达式
                    </span>
                  </div>
                </div>

                <div className="md:col-span-7 space-y-2.5 border-t md:border-t-0 md:border-l border-slate-800 pt-2.5 md:pt-0 md:pl-4">
                  <form onSubmit={handleMolangSubmit} className="flex items-center gap-2">
                    <label htmlFor="molang-expr-input" className="sr-only">
                      MoLang 表达式
                    </label>
                    <input
                      id="molang-expr-input"
                      type="text"
                      value={molangInput}
                      onChange={(e) => setMolangInput(e.target.value)}
                      placeholder="输入 MoLang 表达式，例如 v.x = q.ground_speed * 2; return v.x;"
                      className="flex-1 px-3 py-1.5 text-xs font-mono-tabular bg-[#0f1115] border border-slate-700 rounded-md text-slate-100 focus:outline-none focus:border-amber-500"
                    />
                    <button
                      type="submit"
                      className="px-3 py-1.5 text-xs font-semibold text-slate-950 bg-amber-500 rounded-md hover:bg-amber-400 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      求值
                    </button>
                  </form>

                  {props.molangOutput && (
                    <div className="text-xs font-mono-tabular px-2.5 py-1.5 rounded bg-[#0f1115] border border-slate-800">
                      {props.molangOutput.error ? (
                        <span className="text-rose-400">{props.molangOutput.error}</span>
                      ) : (
                        <span className="text-emerald-400">
                          结果: {props.molangOutput.result}
                        </span>
                      )}
                    </div>
                  )}

                  <div>
                    <div className="text-[11px] text-slate-400 mb-1">
                      实例持久化变量（variable.*）
                    </div>
                    {varEntries.length === 0 ? (
                      <div className="text-xs text-slate-500">
                        暂无写入变量（切换 Chrono Automaton 或执行赋值语句可观测实时状态）
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs font-mono-tabular text-slate-200">
                        {varEntries.map(([k, v]) => (
                          <span key={k}>
                            <span className="text-slate-400">v.{k}=</span>
                            <span className="text-amber-300">{v.toFixed(2)}</span>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* TAB 4: Debug View, Camera Presets & WebGL Memory Leak Check */}
            {activeTab === 'debug' && (
              <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-start">
                <div className="md:col-span-6 space-y-3">
                  <div>
                    <div className="text-xs text-slate-400 mb-1.5">骨骼调试叠加层</div>
                    <div className="flex flex-wrap items-center gap-3 text-xs text-slate-200">
                      <label className="inline-flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={props.debugEnabled}
                          onChange={(e) => props.onToggleDebug(e.target.checked)}
                          className="accent-amber-500"
                        />
                        <span>启用调试视图</span>
                      </label>
                      <label className="inline-flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={props.showPivots}
                          disabled={!props.debugEnabled}
                          onChange={(e) => props.onTogglePivots(e.target.checked)}
                          className="accent-amber-500"
                        />
                        <span>骨骼轴心与连接线</span>
                      </label>
                      <label className="inline-flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={props.showBounds}
                          disabled={!props.debugEnabled}
                          onChange={(e) => props.onToggleBounds(e.target.checked)}
                          className="accent-amber-500"
                        />
                        <span>Cube 包围盒</span>
                      </label>
                    </div>
                  </div>

                  <div>
                    <div className="text-xs text-slate-400 mb-1.5">相机视角预设</div>
                    <div className="flex flex-wrap gap-1.5">
                      {(
                        [
                          ['quarter', '四分之三视角'],
                          ['front', '正面 (+Z)'],
                          ['side', '侧面'],
                          ['back', '背面 (-Z)'],
                          ['closeup', '头部特写'],
                        ] as [CameraPreset, string][]
                      ).map(([preset, label]) => (
                        <button
                          key={preset}
                          type="button"
                          onClick={() => props.onCameraPreset(preset)}
                          className="px-2.5 py-1 text-xs font-medium text-slate-200 bg-[#191d27] border border-slate-700 rounded-md hover:border-amber-500/60 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* WebGL Memory Lifecycle & Zero-Leak Test */}
                <div className="md:col-span-6 space-y-2.5 border-t md:border-t-0 md:border-l border-slate-800 pt-2.5 md:pt-0 md:pl-4">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-400">模型占用显存增量 (对比空场景基线)</span>
                    <span className="font-mono-tabular text-slate-100">
                      Geo +{props.telemetry.modelDeltaGeometries} · Tex +{props.telemetry.modelDeltaTextures}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {!props.isDisposed ? (
                      <button
                        type="button"
                        onClick={props.onDisposeModel}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-rose-200 bg-rose-500/15 border border-rose-500/40 rounded-md hover:bg-rose-500/25 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>销毁模型 (dispose)</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={props.onReloadModel}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-950 bg-amber-500 rounded-md hover:bg-amber-400 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>重新加载模型</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={props.onRunLeakTest}
                      disabled={props.isLoading}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-emerald-200 bg-emerald-500/15 border border-emerald-500/40 rounded-md hover:bg-emerald-500/25 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <ShieldCheck className="w-3.5 h-3.5" />
                      <span>执行显存零泄漏校验</span>
                    </button>
                  </div>

                  {props.leakTestResult && (
                    <div
                      data-testid="leak-test-result"
                      className={`text-xs font-mono-tabular px-2.5 py-1.5 rounded border ${
                        props.leakTestResult.passed
                          ? 'bg-emerald-950/50 border-emerald-600/50 text-emerald-300'
                          : 'bg-rose-950/50 border-rose-600/50 text-rose-300'
                      }`}
                    >
                      {props.leakTestResult.passed ? '校验通过（零泄漏）' : '检测到显存未归零'} — 基线{' '}
                      {props.leakTestResult.beforeGeometries}G/{props.leakTestResult.beforeTextures}T → 加载后{' '}
                      {props.leakTestResult.loadedGeometries}G/{props.leakTestResult.loadedTextures}T → 销毁后{' '}
                      {props.leakTestResult.afterDisposeGeometries}G/{props.leakTestResult.afterDisposeTextures}T
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
