# @hankchen/canvas-image-renderer

graph → 透明底 PNG 的 Node 渲染后端（无头、零 DOM）：消费 `@hankchen/canvas` 的
五原语渲染契约（`RenderBackend`）与资源物化缝（`ResourceResolver`），对位
go-canvas/image-renderer module。

- 五原语（`ImageRendererBackend`）：`begin`/`end`（`encodeSync('png')` 透明底产物）、
  `drawRect`（背景色 + 盒内嵌边框带）、`drawImage`（双矩形 blit + EXIF raw→canonical
  窗口映射）、`drawText`（真实字体、对齐锚点、角度旋转）、`imageIntrinsicSize`
  （raw 内在尺寸查询）。
- EXIF 混合口径（04 号决议）：像素面吃 napi 解码层自动转正（canonical），查询面
  返 raw 尺寸（orientation ≥5 互换宽高）；取舍见 `docs/adr/0001-*.md`。
- 文本：原语层永远真实字体绘制（TTC 魔数嗅探 fail-fast 拒收；空串/纯数字字体 id =
  内置默认字体）；`createNapiMeasurerFactory` 为 08 号决议的 v1 增强度量器，
  经核心 `TextLayoutPolicies.measurerFactory` 显式注入，缺省不注入（启发式对齐版）。
- 资源物化默认接线（`createDefaultResolver`）：HTTP 下载 + 内存/可选落盘缓存 +
  QR 物化（纠错 H、quiet zone 0、正方形 PNG），字节经 `setImage` 以 wire src 同键
  登记，物化不进 wire。

## 用法

```ts
import { decodeGraph, renderAs } from '@hankchen/canvas'
import { ImageRendererBackend, createDefaultResolver } from '@hankchen/canvas-image-renderer'

const canvas = decodeGraph(wireJson)
const backend = new ImageRendererBackend()
await createDefaultResolver().resolve(canvas, backend) // 渲染前异步物化（可选）
const png: Uint8Array = renderAs<Uint8Array>(canvas, backend)
```

## 平台支持面

- **macOS / Linux 明确支持**（CI 双平台矩阵验证；`@napi-rs/canvas` 1.0.13 预编译
  native 包按 platform 自动安装，darwin-x64/arm64 与 linux-x64/arm64/glibc/musl
  均在发布面）。
- **Windows 不承诺**：napi 有 win32 包但本仓不在 CI 验证，出问题按社区包自行排查；
  预编译 native 包体积较大（每个平台包数十 MB，安装时按 `os`/`cpu` 只拉对应
  optional dependency）。

## 目验样张

```sh
pnpm visualcheck   # 仓根一键两包；或本包内 node scripts/visualcheck.mjs [输出路径]
```

400×520 综合样张（九条验收线：叠加次序/中文禁则断行/表格嵌套/QR/cover/自适应宽/
页脚等）输出到 `visualcheck-output/`（gitignore）。字体探针纪律：候选逐个以渲染端
同一入口「存在且可加载」判取（TTC 拒收），全缺报错逐条列原因；`JS_CANVAS_VISUAL_FONT`
可指定单体 TTF，CI 冒烟可设 `JS_CANVAS_ALLOW_NO_FONT=1` 让字体腿 skip。底座升级
必须先过样张目验门禁（AGENTS.md「版本升级样张门禁」条款）。
