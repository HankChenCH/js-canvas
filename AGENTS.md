# AGENTS.md

## Purpose

graph 契约的 JS 端核心仓 `js-canvas`：**无 DOM 世界**——当前唯一包 `packages/canvas`（npm `@hankchen/canvas`）承载 wire 类型与解码/编码校验、画布/图层纯结构、布局纯函数、五原语渲染契约，零运行时依赖零 DOM。与 `php-canvas-next`（PHP 权威端）和 `go-canvas` 共享同一 wire 契约；DOM 系包（浏览器渲染后端、编辑器）住在 `canvas-web` 仓。中文注释；conventional commits + 中文 subject。

## Layout

- `packages/canvas/` — 核心契约包。src 平铺 9 文件：`wire.ts`（宽松 wire 类型）/ `types.ts`（严格领域类型）/ `decode.ts` + `encode.ts`（宽进严出边界，graph → 解码 → 编码往返恒等是硬契约）/ `layout.ts` / `render.ts`（五原语渲染契约 + 可选度量能力口，ADR 0023）/ `text.ts` / `preview.ts` / `index.ts`（单 barrel + `PACKAGE_NAME`）。
- `packages/image-renderer/`、`packages/pdf-renderer/` — Node 渲染后端（graph → PNG / 页序列 → PDF），各自带 `scripts/visualcheck.mjs` 目验样张脚本（`pnpm visualcheck` 一键两包）。
- 构建产物：tsup（ESM + dts）→ `dist/`，exports 指向 dist；workspace 内 typecheck/test 直对 src（`tsc --noEmit` / vitest），不受构建影响。
- `tests/fixtures/layout-snapshot.json` — PHP 导出的布局快照，再生成用 php-canvas-next 仓 `scripts/export-layout-snapshot.php`（PHP 8.3 + ext-intl），人审 diff 后提交。

## Commands

```sh
export PATH="$(brew --prefix)/opt/node@22/bin:$PATH"   # Node 22 + pnpm 10（keg-only，不导出会用系统 node）
pnpm install
pnpm -r build        # 先 build：后端包 typecheck/test 依赖核心 dist
pnpm -r typecheck
pnpm -r test
pnpm visualcheck     # 两后端目验样张一键出图（产物 gitignore，人审）
```

## Rules and gotchas

- **零运行时依赖是硬红线**（对应 go-canvas ADR-0002）：引入任何 npm 运行时依赖前先停下来——文本度量/断行是纯函数契约，由宿主或渲染后端注入。
- **包依赖红线四条款**（06 号决议定稿，node-renderers 工票）：
  1. 核心包 `packages/canvas` 零运行时依赖（含上文硬红线）；
  2. 渲染后端包（如 `canvas-image-renderer` / `canvas-pdf-renderer`）自带依赖——HTTP 客户端、QR 编码器等 npm 依赖进后端包，绝不进核心；
  3. 后端包互不 import（包间不建依赖边，共享知识上移核心或按 4 复制）；
  4. 共享小件同式复制并注明出处（对位 go-canvas color/exif/qr 四小件在两 module 复制的先例），不做共享小工具包。
- **无 DOM lib**：tsconfig 不开 DOM，src 引 `document`/`window` 直接编译失败；需要 DOM 的包去 canvas-web 仓，未来 Node 渲染器也必须保持零 DOM。
- **往返恒等**：`decodeGraph → encodeGraph` 输出与输入键级恒等；改 decode/encode 前先确认 wire 面是否与 PHP/Go 对齐——wire 改动需三端同步 + fixture 重导。
- **底座升级必须过目验样张门禁**（工票 12 成文，04/05 号决议的纪律）：`@napi-rs/canvas` 与 `pdfkit` 都精确钉版本——native 库/pdfkit 行为即渲染契约，任何一方版本升级必须先 `pnpm visualcheck` 出两后端样张人工目验通过（九条验收线逐条在位），再合入；只过单测不过样张不算通过（对位 go-canvas「升级必须过 make visual-check」同款纪律）。
- **发布**：`pnpm publish`（读 `publishConfig`，access public）；版本以 git tag 为准；仓库变多包后改用 per-package tag（如 `canvas/vX.Y.Z`）。
- `.npmrc` 不配镜像（CI 走 npmjs；本机安装按次指定 npmmirror）。
