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
