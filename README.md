# js-canvas

graph 契约的 JS 端核心（无 DOM 世界）：与 `php-canvas-next`（PHP 权威端）、[go-canvas](https://github.com/HankChenCH/go-canvas) 共享同一 graph wire 契约——同一份 graph JSON 三端互读。

| 包 | npm | 职责 |
| --- | --- | --- |
| `packages/canvas` | [@hankchen/canvas](https://www.npmjs.com/package/@hankchen/canvas) | wire 类型与解码/编码（往返恒等）、画布/图层纯结构、布局纯函数、五原语渲染契约 |

**DOM 边界不变量**：本仓所有包零 DOM——浏览器渲染后端、编辑器等 DOM 系包住在 [canvas-web](https://github.com/HankChenCH/canvas-web)；未来 Node 渲染器（`@hankchen/canvas-node-renderer`）以 workspace 成员加入本仓。

## 安装

```sh
npm install @hankchen/canvas
```

## 开发

```sh
pnpm install
pnpm -r typecheck && pnpm -r test && pnpm -r build
```

开发约定见 [AGENTS.md](AGENTS.md)。
