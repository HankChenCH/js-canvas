# @hankchen/canvas

graph 契约的 JS 端核心：wire 类型与解码/编码校验（`decodeGraph` / `encodeGraph`，往返恒等硬契约）、画布/图层纯结构、布局纯函数、五原语渲染契约。

- **零运行时依赖、零 DOM**：Node / edge / 浏览器 bundler 直接消费
- wire 键级对齐 PHP 权威端 `php-canvas-next` 的 `graph()` 产物，与 [go-canvas](https://github.com/HankChenCH/go-canvas) 同属三端同一契约
- 浏览器渲染后端见 [@hankchen/canvas-browser-renderer](https://github.com/HankChenCH/canvas-web)（canvas-web 仓）

## 安装

```sh
npm install @hankchen/canvas
```

## 使用

```ts
import { decodeGraph, encodeGraph } from '@hankchen/canvas'

const graph = decodeGraph(json)      // 宽进：宽松 wire 类型 + 逐字段校验
const canonical = encodeGraph(graph) // 严出：canonical 输出，键级对齐 PHP graph()
```

## 开发

```sh
pnpm install
pnpm -r typecheck && pnpm -r test && pnpm -r build
```

开发约定见 [AGENTS.md](../../AGENTS.md)。
