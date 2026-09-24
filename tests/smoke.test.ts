import { describe, expect, it } from 'vitest'

import { PACKAGE_NAME } from '../src/index'

describe('包出口冒烟', () => {
    it('入口可导入（无 DOM、无运行时依赖的环境下）', () => {
        expect(PACKAGE_NAME).toBe('@hankchen/canvas-next')
    })

    it('运行环境确为 Node 无 DOM（内核测试必须在无 DOM 环境跑）', () => {
        // 不直接写 document/window——结构包 tsconfig 无 DOM lib，写了编译不过
        const host = globalThis as unknown as Record<string, unknown>
        expect(host.document).toBeUndefined()
        expect(host.window).toBeUndefined()
    })
})
