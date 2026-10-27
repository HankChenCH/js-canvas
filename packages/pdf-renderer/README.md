# @hankchen/canvas-pdf-renderer

画布页序列 → PDF 文档字节的 Node 渲染后端。以 [pdfkit](https://github.com/foliojs/pdfkit)（精确钉 `0.20.2`）为底座实现核心包 [`@hankchen/canvas`](../canvas) 的五原语渲染契约（对位 [go-canvas](https://github.com/HankChenCH/go-canvas) `pdf-renderer` module 的 TS 平移），零 DOM、Node ≥22。

## 能力

- **五原语**：`begin`（首次建档/续页）/ `end`（同步返回完整 PDF `Uint8Array`）/ `drawRect`（背景 + 四边内嵌边框带）/ `drawImage`（双矩形 blit：JPEG/PNG 直嵌零重编码、cover/contain/fill/tile 几何全在核心分派层）/ `drawText`（TTF 子集内嵌 Identity-H、Helvetica 核心字体兜底）。
- **多页**：消费核心 `renderPages`/`renderPagesAs` 编排（n 页 n 次 `begin` + 单文档一次 `end`），逐页任意尺寸。
- **EXIF 自管八向矩阵**：`doc.image(..., { ignoreOrientation: true })` 关库默认归正，适配层矩阵对位 go `orientAffine`，字节零重编码。
- **形状能力口**（ADR 0026）：`drawEllipse` + `drawImageMasked`（内切椭圆掩码 blit），`clip=circle` 走圆形三步。
- **资源物化**：`createDefaultResolver` 默认实现——HTTP 下载（可注入 fetch/Downloader）+ 内容寻址磁盘缓存 + QR 物化（`qrcode` 纠错 H/margin 0，`qr:` 前缀同键登记）+ 远程字体登记。
- **查询口**：`imageIntrinsicSize`（PNG IHDR / JPEG SOF，raw 空间口径）供核心全 fit 前置。

## 使用

```ts
import { decodeGraph, renderAs } from '@hankchen/canvas'
import { createDefaultResolver, createRenderer, renderCanvasAsPdf } from '@hankchen/canvas-pdf-renderer'

// 便捷入口（物化 → 渲染一条龙）
const pdf = await renderCanvasAsPdf(canvas)

// 显式两步（物化属渲染前的异步准备阶段，渲染本身同步）
const backend = createRenderer(createDefaultResolver({ cacheRoot: '/tmp/cache' }))
await backend.defaultResolver!.resolve(canvas, backend)
const bytes = renderAs<Uint8Array>(canvas, backend)
```

## 纪律

- 失败即抛：任一原语失败即弃件（会话复位、实例不复用），渲染模板的 `end()` 不达，无半截产物逃逸；`end()` 未建面返回 `null`（核心断言面报 `product_type_mismatch`）。
- 单位口径：核心接口坐标恒抽象像素，`pt = px × 0.75` 换算责任全在后端（`PX_TO_PT` 唯一换算点）。
- v1 降级声明：GIF/BMP/WebP 输入报错不转码；pdffonts 断言放宽 sub 位（CID TrueType + Identity-H + emb=yes 三要素）；TTC/OTC 字体集 fail-fast 拒收。
- 包依赖红线：核心包零运行时依赖；本包自带依赖；与 `@hankchen/canvas-image-renderer` 互不 import（共享小件同式复制并注明出处）。

## 开发

```sh
export PATH="$(brew --prefix)/opt/node@22/bin:$PATH"
pnpm install
pnpm --filter @hankchen/canvas-pdf-renderer typecheck
pnpm --filter @hankchen/canvas-pdf-renderer test   # poppler 四件套在场时跑结构断言，缺席自动 skip
```

CJK 文本腿需系统单体 TTF（macOS 自带 `Arial Unicode.ttf`；CI 装 `fonts-ipafont-gothic`），可用 `JS_CANVAS_TEST_CJK_FONT` 指定；poppler 路径可用 `PDF_RENDERER_POPPLER_DIR` 覆写。

## 平台支持面

- **macOS / Linux 明确支持**（CI 双平台矩阵验证；pdfkit 纯 JS 底座，无 native
  依赖；poppler 结构断言腿跑 ubuntu，macOS 缺 poppler 自动 skip）。
- **Windows 不承诺**：本仓不在 CI 验证 win32；依赖本身无 native 编译负担，但
  未验证面按「不承诺」处理。

## 目验样张

```sh
pnpm visualcheck   # 仓根一键两包；或本包内 node scripts/visualcheck.mjs [输出基名]
```

多页综合样张输出 `visualcheck-output/`（.pdf + pdftoppm 在场时的逐页 .png 预览，
gitignore）。CJK 字体探针纪律：候选只认单体 TTF、以渲染端同一管线试渲染判「存在
且可加载」，全缺降级 Helvetica 只排 ASCII（stderr 响亮提示）；`JS_CANVAS_VISUAL_FONT`
可指定。底座升级必须先过样张目验门禁（AGENTS.md「版本升级样张门禁」条款）。
