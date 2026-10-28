import { defineConfig } from 'tsup'

// ESM 单出口：与核心包同一产物管线；本包有运行时依赖（pdfkit/qrcode），
// tsup 只打本包 src、依赖面留给包管理器（external 默认排除 dependencies）
export default defineConfig({
    entry: ['src/index.ts'],
    format: ['esm'],
    dts: true,
    clean: true,
    sourcemap: true,
    target: 'es2022',
})
