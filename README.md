# @lemwood/ysm-threejs-engine

在网页中加载和播放 Minecraft Yes Steve Model 模型。提供 Three.js 引擎、React 查看器及独立的解析/动画模块，支持普通 ZIP 和 YSGP `.ysm` 模型包。

## 安装

React 项目：

```sh
npm install @lemwood/ysm-threejs-engine three react react-dom
```

已有 React 项目只需添加组件库和 `three`。TypeScript 项目还需安装对应的类型：

```sh
npm install -D @types/three @types/react
```

引擎可独立使用；只使用 `/core` 入口时无需安装 React 或 Three.js。

| 入口 | 用途 | 所需运行时 |
| --- | --- | --- |
| `@lemwood/ysm-threejs-engine` | 模型加载器、Three.js rig、动画及解析 API | `three` |
| `@lemwood/ysm-threejs-engine/react` | `YsmViewer`、`YsmViewport` 和组件类型 | `react`、`three` |
| `@lemwood/ysm-threejs-engine/core` | JSON 解析、MoLang、关键帧、动画控制器 | 无 |

提供 ESM、CommonJS 及 TypeScript 声明，支持 NodeNext/Bundler 类型解析。React 18.3/19；Three.js r170–r187。SSR 可导入组件，渲染需要浏览器 WebGL2；Next.js 中请在客户端组件使用。

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

不需要 React。模型图片解码和渲染依赖浏览器；Node 中可读取无贴图模型、调用 `unpackArchiveBytes()` 或使用纯解析接口。

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
npm pack               # 生成可 npm install 的 tgz
```

GitHub Actions 在 `v*` 标签或手动运行发布工作流时，使用仓库密钥 `NPM` 发布公开包。标签版本必须与 `package.json` 一致，避免误发版本。不要将凭据写入仓库。

源码采用 [MIT 许可证](LICENSE)。OpenYSM 衍生代码与解压库的 MIT 声明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。示例角色模型不包含在 npm 包内。
