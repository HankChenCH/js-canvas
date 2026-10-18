# AGENTS.md

## Purpose

graph 契约的 JS 端核心仓 `js-canvas`：**无 DOM 世界**——当前唯一包 `packages/canvas`（npm `@hankchen/canvas`）承载 wire 类型与解码/编码校验、画布/图层纯结构、布局纯函数、五原语渲染契约，零运行时依赖零 DOM。与 `php-canvas-next`（PHP 权威端）和 `go-canvas` 共享同一 wire 契约；DOM 系包（浏览器渲染后端、编辑器）住在 `canvas-web` 仓。中文注释；conventional commits + 中文 subject。

## Layout

- `packages/canvas/` — 唯一包。src 平铺 9 文件：`wire.ts`（宽松 wire 类型）/ `types.ts`（严格领域类型）/ `decode.ts` + `encode.ts`（宽进严出边界，graph → 解码 → 编码往返恒等是硬契约）/ `layout.ts` / `render.ts`（五原语渲染契约 + 可选度量能力口，ADR 0023）/ `text.ts` / `preview.ts` / `index.ts`（单 barrel + `PACKAGE_NAME`）。
- 构建产物：tsup（ESM + dts）→ `dist/`，exports 指向 dist；workspace 内 typecheck/test 直对 src（`tsc --noEmit` / vitest），不受构建影响。
- `tests/fixtures/layout-snapshot.json` — PHP 导出的布局快照，再生成用 php-canvas-next 仓 `scripts/export-layout-snapshot.php`（PHP 8.3 + ext-intl），人审 diff 后提交。

## Commands

```sh
export PATH="$(brew --prefix)/opt/node@22/bin:$PATH"   # Node 22 + pnpm 10（keg-only，不导出会用系统 node）
pnpm install
pnpm -r typecheck
pnpm -r test
pnpm -r build
```

## Rules and gotchas

- **零运行时依赖是硬红线**（对应 go-canvas ADR-0002）：引入任何 npm 运行时依赖前先停下来——文本度量/断行是纯函数契约，由宿主或渲染后端注入。
- **无 DOM lib**：tsconfig 不开 DOM，src 引 `document`/`window` 直接编译失败；需要 DOM 的包去 canvas-web 仓，未来 Node 渲染器也必须保持零 DOM。
- **往返恒等**：`decodeGraph → encodeGraph` 输出与输入键级恒等；改 decode/encode 前先确认 wire 面是否与 PHP/Go 对齐——wire 改动需三端同步 + fixture 重导。
- **发布**：`pnpm publish`（读 `publishConfig`，access public）；版本以 git tag 为准；仓库变多包后改用 per-package tag（如 `canvas/vX.Y.Z`）。
- `.npmrc` 不配镜像（CI 走 npmjs；本机安装按次指定 npmmirror）。
