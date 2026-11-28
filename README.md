# @lemwood/ysm-threejs-engine

在网页中加载和播放 Minecraft Yes Steve Model 模型。提供框架无关的 Three.js 引擎、原生查看器、React / Vue 3 组件及独立的解析/动画模块，支持普通 ZIP 和 YSGP `.ysm` 模型包。

## 安装

React 项目：

```sh
npm install @lemwood/ysm-threejs-engine three react react-dom
```

Vue 3 项目：

```sh
npm install @lemwood/ysm-threejs-engine three vue
```

已有 React 项目只需添加组件库和 `three`。TypeScript 项目还需安装对应的类型：

```sh
npm install -D @types/three @types/react
```

已有 Vue 项目只需添加组件库和 `three`，TypeScript 项目添加 `@types/three`。原生引擎无需安装 React / Vue；只使用 `/core` 入口时也无需安装 Three.js。

| 入口 | 用途 | 所需运行时 |
| --- | --- | --- |
| `@lemwood/ysm-threejs-engine` | 加载器、原生查看器、视口、Three.js rig、动画及解析 API | `three` |
| `@lemwood/ysm-threejs-engine/react` | `YsmViewer`、`YsmViewport` 和组件类型 | `react`、`three` |
| `@lemwood/ysm-threejs-engine/vue` | Vue 3 `YsmViewer` 和组件类型 | `vue`、`three` |
| `@lemwood/ysm-threejs-engine/core` | JSON 解析、MoLang、关键帧、动画控制器 | 无 |

提供 ESM、CommonJS 及 TypeScript 声明，支持 NodeNext/Bundler 类型解析。React 18.3/19；Vue 3.3+；Three.js r170–r187。SSR 可导入组件，渲染需要浏览器 WebGL2；Next.js 中请在客户端组件使用。React、Vue 入口各自独立，不会加载另一个框架。

## Vue 查看器

```vue
<script setup lang="ts">
import { ref, shallowRef } from 'vue';
import { YsmViewer, type YsmViewerHandle } from '@lemwood/ysm-threejs-engine/vue';

const viewer = ref<YsmViewerHandle | null>(null);
const file = shallowRef<File | null>(null);
function selectFile(event: Event) {
  file.value = (event.target as HTMLInputElement).files?.[0] ?? null;
}
</script>

<template>
  <input type="file" accept=".ysm,.zip" @change="selectFile" />
  <YsmViewer
    ref="viewer"
    :source="file"
    animation="idle"
    :query="{ ground_speed: 0.8, is_on_ground: 1 }"
    :style="{ height: '480px' }"
    @load="model => console.log(model.animations)"
    @error="error => console.error(error)"
  >
    <template #loading>正在加载模型…</template>
    <template #error="{ error }">加载失败：{{ error.message }}</template>
  </YsmViewer>
  <button @click="viewer?.crossFadeTo('walk', 0.25)">行走</button>
</template>
```

Vue 与 React 共用下表中的模型、动画、查询和相机属性；Vue 使用 `class` / `style` 设置外观，以 `#loading` / `#error="{ error }"` 插槽定制状态。事件为 `@load`、`@error`、`@warnings`、`@loading-change`、`@telemetry`、`@context-lost`，参数与 React 回调一致。模板 ref 提供相同的 `YsmViewerHandle` 方法。

组件在 `onMounted` 创建视口，在卸载时释放模型和画布，可用于 Nuxt / Vue SSR。模型实例使用 `markRaw` 保持原始对象；在业务代码保存模型或文件包时建议使用 `shallowRef`，避免深层代理 Three.js 对象。完整示例见 [examples/vue](examples/vue)。

## 原生 JavaScript 查看器

模型加载、异步竞态处理、动画设置和 GPU 资源释放均在框架无关的核心控制器中实现。React / Vue 只负责生命周期和状态展示。

```ts
import { createYsmViewer } from '@lemwood/ysm-threejs-engine';

// 容器需有明确尺寸，例如 <div id="viewer" style="height:480px"></div>。
const viewer = createYsmViewer(document.querySelector<HTMLElement>('#viewer')!, {
  animation: 'idle',
  onError: console.error,
  onStateChange: ({ loading }) => console.log({ loading }),
});
await viewer.load('/models/player.ysm');
viewer.update({ paused: true, query: { ground_speed: 1 } });
viewer.crossFadeTo('walk', 0.25);

// 页面移除或路由切换时调用。
viewer.dispose();
```

`createYsmViewer(container, options)` 返回 `YsmViewerController`，包含组件 ref 的所有方法，以及 `load(source, loadOptions?)`、`update(partialOptions)`、`getState()` 和 `dispose()`。`update` 仅更新传入字段，传 `undefined` 恢复该字段默认值；输入与加载选项不变时不会重新加载。加载失败或结果已过期时 `load` 返回 `null`，失败详情通过 `onError` / `getState().error` 获取。核心只管理画布，状态 UI 由调用方决定。

手动管理模型时，使用 `createYsmViewport(container, { getQuery, getPaused, onTelemetry, disposeModelOnUnmount: false })`，再调用 `setModel(model)`、`setCameraPreset()`、`forceRenderFrame()`、`getMemorySnapshot()` 和 `dispose()`。移除或替换模型不会自动释放旧实例，由调用方管理；视口销毁默认释放当前实例。原生 API 只在创建视口时访问 DOM，模块可在 SSR 中安全导入。

## React 查看器

```tsx
import { useRef, useState } from 'react';
import { YsmViewer, type YsmViewerHandle } from '@lemwood/ysm-threejs-engine/react';

export function ModelPreview() {
  const viewer = useRef<YsmViewerHandle>(null);
  const [file, setFile] = useState<File | null>(null);

  return (
    <>
      <input type="file" accept=".ysm,.zip" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
      <YsmViewer
        ref={viewer}
        source={file}
        animation="idle"
        style={{ height: 480 }}
        loadingFallback="正在加载模型…"
        onLoad={(model) => console.log(model.animations)}
        onWarnings={(warnings) => console.log(warnings)}
        onError={(error) => console.error(error)}
      />
      <button onClick={() => viewer.current?.crossFadeTo('walk', 0.25)}>行走</button>
    </>
  );
}
```

`source` 也可传 URL（如 `/models/player.ysm`）、`FileList`、`Blob`、`Uint8Array` 或 `{ files: ... }`。保持内存文件对象引用稳定，避免每次 React 渲染重新加载。URL 需允许浏览器访问；本地文件只在浏览器中解析。

组件自带画布和摄影棚场景，不依赖 Tailwind、全局样式或调试控制台。默认宽度为父容器的 100%、高度为 400px；通过 `style`/`className` 设置尺寸，父容器变化会自动调整画布。

| 属性 | 默认值 | 说明 |
| --- | --- | --- |
| `source` | 空 | 模型输入；设为 `null` 清空模型 |
| `loadOptions` | `{}` | `filename`、`geometryIdentifier`、`unitScale`、`evaluator`、`fetchFn` |
| `animation` | `"idle"` | 主动画；缺少 idle 时选第一个；`null` 停止主动画 |
| `paused` | `false` | 暂停模型动画 |
| `timeScale` | `1` | 主动画播放倍率 |
| `loop` | 动画原设置 | `true`、`false` 或 `"hold_on_last_frame"` |
| `fadeDuration` | `0.2` | 主动画过渡秒数 |
| `query` | `{}` | MoLang 查询值，如 `{ ground_speed: 0.8, is_on_ground: 1 }` |
| `debug` / `showPivots` / `showBounds` | `false` / `true` / `true` | 骨骼调试 |
| `cameraPreset` | 自动取景 | `quarter`、`front`、`side`、`back`、`closeup` |
| `onLoad` / `onError` / `onWarnings` | — | 加载成功、失败及表达式修复诊断 |
| `onLoadingChange` / `onTelemetry` / `onContextLost` | — | 加载状态、渲染统计及上下文状态 |

ref 提供 `getModel()`、`play()`、`crossFadeTo()`、`stop()`、`resetPose()`、`setCameraPreset()`、`getMemorySnapshot()`。组件拥有加载出的模型，会在切换输入或卸载时释放 GPU 资源；过期的异步加载结果也会被释放。外部通过 `getModel()` 或 `onLoad` 获取的实例不应跨组件卸载继续使用。

`YsmViewport` 是底层画布组件，可通过 ref 的 `setModel()` 接入手动管理的实例；传 `disposeModelOnUnmount={false}` 时由调用方负责释放。

完整的独立示例见 [examples/react](examples/react)。进入该目录执行 `npm install` 和 `npm run dev` 即可运行。

## 在现有 Three.js 场景中使用

```ts
import { YsmModelLoader } from '@lemwood/ysm-threejs-engine';

const model = await new YsmModelLoader().load('/models/player.ysm');
scene.add(model.root);
model.play('idle');

// 在自己的渲染循环中调用，dt 单位为秒：
model.update(dt, { ground_speed: 0.8, is_on_ground: 1 });

// 移除模型时：
model.dispose();
```

不需要 React 或 Vue。模型图片解码和渲染依赖浏览器；Node 中可读取无贴图模型、调用 `unpackArchiveBytes()` 或使用纯解析接口。

## 纯解析与动画

```ts
import { BedrockModelParser, MolangEvaluator } from '@lemwood/ysm-threejs-engine/core';

const parsed = new BedrockModelParser().parse(geometryJson);
const value = new MolangEvaluator().evaluate('math.sin(q.anim_time * 180)', {
  query: { anim_time: 0.5 },
  variables: {},
});
```

解析器、MoLang 和动画模块可用于 Node、Worker 或其他渲染器。`.ysm` 支持 crypto 3、二进制格式 16–32；具体资源、常驻动画及兼容范围见 [格式说明](docs/ysm-format.md)。

## 开发与发布

```sh
npm ci
npm run dev            # 保留原有交互工作台
npm test
npm run lint
npm run build          # 构建工作台
npm run build:lib      # 构建组件库与类型声明
npm run test:package   # 打包后安装到独立临时项目，验证入口与类型
npm run test:react-package # 在浏览器验证已安装的组件；需 playwright install chromium
npm run test:vue-package # 验证已安装的 Vue 组件和原生控制器
npm pack               # 生成可 npm install 的 tgz
```

GitHub Actions 在 `v*` 标签或手动运行发布工作流时，使用仓库密钥 `NPM` 发布公开包。标签版本必须与 `package.json` 一致，避免误发版本。不要将凭据写入仓库。

源码采用 [MIT 许可证](LICENSE)。OpenYSM 衍生代码与解压库的 MIT 声明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。示例角色模型不包含在 npm 包内。
