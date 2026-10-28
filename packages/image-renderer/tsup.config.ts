import { defineConfig } from 'tsup'

// ESM 单出口：与核心包同式；@napi-rs/canvas（native）/qrcode/@hankchen/canvas
// 均为运行时依赖，tsup 自动 external（dependencies 字段），产物进 dist
export default defineConfig({
    entry: ['src/index.ts'],
    format: ['esm'],
    dts: true,
    clean: true,
    sourcemap: true,
    target: 'es2022',
})
