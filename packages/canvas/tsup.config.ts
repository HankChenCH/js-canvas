import { defineConfig } from 'tsup'

// ESM 单出口：src 零 node 内置依赖、零运行时依赖,dts 随构建产出
export default defineConfig({
    entry: ['src/index.ts'],
    format: ['esm'],
    dts: true,
    clean: true,
    sourcemap: true,
    target: 'es2022',
})
