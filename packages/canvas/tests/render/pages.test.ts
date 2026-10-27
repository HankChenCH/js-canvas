import { describe, expect, it } from 'vitest'

import {
    ProductTypeMismatchError,
    decodeGraph,
    renderAs,
    renderCanvas,
    renderPages,
    renderPagesAs,
} from '../../src/index'
import type { Canvas, RenderBackend } from '../../src/index'

interface CallRecord {
    op: 'begin' | 'end' | 'rect' | 'image' | 'text'
    [key: string]: unknown
}

/**
 * 录制后端：只记录原语调用序与几何，不产像素（渲染端测试走点位/调用序断言，不做逐像素
 * 复刻）。product 模拟产物后端的 end() 返回值（undefined = 预览型就地绘制后端）。
 */
function recordingBackend(product?: unknown) {
    const calls: CallRecord[] = []
    const backend: RenderBackend = {
        begin(width, height) {
            calls.push({ op: 'begin', width, height })
        },
        end() {
            calls.push({ op: 'end' })
            return product
        },
        drawRect(x, y, width, height, bgColor, border) {
            calls.push({ op: 'rect', x, y, width, height, bgColor, border })
        },
        drawImage(src, srcRect, dstRect) {
            calls.push({ op: 'image', src, srcRect: { ...srcRect }, x: dstRect.x, y: dstRect.y, width: dstRect.width, height: dstRect.height })
        },
        drawText(line, x, y) {
            calls.push({ op: 'text', line, x, y })
        },
    }
    return { calls, backend }
}

/** 单层纯色页（盒原点 = 画布原点，一个 rect 即整页绘制指纹） */
function solidPage(width: number, height: number, color: string): Canvas {
    return decodeGraph({
        canvas: { width, height },
        layers: [{ type: 'ImageLayer', spec: { shape: { width, height, backgroundColor: color } } }],
    })
}

function blankPage(width: number, height: number): Canvas {
    return decodeGraph({ canvas: { width, height }, layers: [] })
}

describe('renderPages 多页编排（对位 go renderer/renderpages.go + renderer.go renderPages/paintPage）', () => {
    it('n 页 n 次 begin（各页取自身尺寸）+ 单文档统一一次 end，页序即绘制序', () => {
        const { calls, backend } = recordingBackend()
        renderPages([solidPage(320, 200, '#p1'), solidPage(160, 90, '#p2'), blankPage(80, 60)], backend)

        // 逐页页内段：每页一次 begin(该页 width, height) → 背景铺装 → 逐层
        expect(calls[0]).toEqual({ op: 'begin', width: 320, height: 200 })
        expect(calls[2]).toEqual({ op: 'begin', width: 160, height: 90 })
        expect(calls[4]).toEqual({ op: 'begin', width: 80, height: 60 })
        expect(calls.filter((call) => call.op === 'begin')).toHaveLength(3)
        // 单文档统一一次 end，且必在全部页绘制完成之后（末尾）
        expect(calls[calls.length - 1]).toEqual({ op: 'end' })
        expect(calls.filter((call) => call.op === 'end')).toHaveLength(1)
    })

    it('空页序列报错且不触达任何原语（0 次 begin + 0 次 end；零页文档无意义不由模板代答）', () => {
        const { calls, backend } = recordingBackend()
        expect(() => renderPages([], backend)).toThrow('页序列为空')
        expect(calls).toEqual([])
    })

    it('首页失败即中止：end 不达、无产物逃逸（throw 路径函数不返回产物）', () => {
        const { calls, backend: base } = recordingBackend('#product-bytes')
        const backend: RenderBackend = {
            ...base,
            drawRect() {
                throw new Error('首页绘制失败')
            },
        }
        expect(() => renderPages([solidPage(100, 100, '#a'), solidPage(50, 50, '#b')], backend)).toThrow('首页绘制失败')
        expect(calls[0]).toMatchObject({ op: 'begin', width: 100, height: 100 })
        expect(calls.filter((call) => call.op === 'end')).toHaveLength(0)
    })

    it('次页失败即中止：首页绘制已发生（不回滚）、end 不达、无产物逃逸', () => {
        const { calls, backend: base } = recordingBackend('#product-bytes')
        let rects = 0
        const backend: RenderBackend = {
            ...base,
            drawRect(x, y, width, height, bgColor, border) {
                rects += 1
                if (rects > 1) throw new Error('次页绘制失败')
                base.drawRect(x, y, width, height, bgColor, border)
            },
        }
        expect(() => renderPages([solidPage(100, 100, '#a'), solidPage(50, 50, '#b')], backend)).toThrow('次页绘制失败')
        // 页 1 完整（begin+rect），页 2 begin 已发生、绘制抛出即中止
        expect(calls.map((call) => call.op)).toEqual(['begin', 'rect', 'begin'])
        expect(calls.filter((call) => call.op === 'end')).toHaveLength(0)
    })

    it('单页退化为单页编排（与 renderCanvas 同语义；产物走返回值而非 void）', () => {
        const { calls, backend } = recordingBackend()
        renderPages([solidPage(320, 200, '#only')], backend)
        expect(calls.map((call) => call.op)).toEqual(['begin', 'rect', 'end'])
    })

    it('产物通道：单文档统一 end 的返回值原样透出（unknown，类型由后端决定）', () => {
        const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47])
        const { backend } = recordingBackend(PNG_BYTES)
        const product: unknown = renderPages([blankPage(10, 10)], backend)
        expect(product).toBe(PNG_BYTES)
    })
})

describe('renderAs/renderPagesAs 产物断言入口（对位 go renderer/renderas.go，断言发生在渲染成功后）', () => {
    const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47])

    it('renderAs：渲染成功后断言，产物取自 end() 返回值', () => {
        const { calls, backend } = recordingBackend(PNG_BYTES)
        const product = renderAs<Uint8Array>(blankPage(10, 10), backend)
        expect(product).toBe(PNG_BYTES)
        // 断言发生在渲染成功之后：完整页内段 + end 都已发生
        expect(calls.map((call) => call.op)).toEqual(['begin', 'end'])
    })

    it('renderPagesAs：多页渲染成功后断言产物（n 页 n 次 begin + 统一 end + 断言）', () => {
        const { calls, backend } = recordingBackend(PNG_BYTES)
        const product = renderPagesAs<Uint8Array>([solidPage(100, 100, '#a'), blankPage(50, 50)], backend)
        expect(product).toBe(PNG_BYTES)
        expect(calls.filter((call) => call.op === 'begin')).toHaveLength(2)
        expect(calls[calls.length - 1]).toEqual({ op: 'end' })
    })

    it('渲染失败原样透传：错误上冒、end 不达、无产物逃逸', () => {
        const { calls, backend: base } = recordingBackend(PNG_BYTES)
        const backend: RenderBackend = {
            ...base,
            begin() {
                throw new Error('建面失败')
            },
        }
        expect(() => renderAs<Uint8Array>(blankPage(10, 10), backend)).toThrow('建面失败')
        expect(calls.filter((call) => call.op === 'end')).toHaveLength(0)
    })

    it('后端未产生产物（end 返回 undefined）报专门断言错误（code + name 形态对齐核心包错误类）', () => {
        const { backend } = recordingBackend(undefined)
        expect(() => renderAs<Uint8Array>(blankPage(10, 10), backend)).toThrow(ProductTypeMismatchError)

        try {
            renderAs<Uint8Array>(blankPage(10, 10), backend)
            expect.unreachable('应抛 ProductTypeMismatchError')
        } catch (error) {
            expect(error).toBeInstanceOf(ProductTypeMismatchError)
            expect((error as ProductTypeMismatchError).code).toBe('product_type_mismatch')
            expect((error as ProductTypeMismatchError).name).toBe('ProductTypeMismatchError')
        }
    })

    it('end(): void 既有实现仍可赋给 RenderBackend 并照常渲染（unknown 放宽非破坏）', () => {
        // 编译期断言即用例本体：void 返回的 end 实现可赋给 end(): unknown 契约（TS 结构化：void → unknown 可赋值）
        const legacy: RenderBackend = {
            begin() {},
            end() {},
            drawRect() {},
            drawImage() {},
            drawText() {},
        }
        expect(() => renderCanvas(blankPage(10, 10), legacy)).not.toThrow()
    })

    it('setImage 登记缝为可选能力口：带与不带的后端渲染面零差异（既有后端零破坏）', () => {
        const registered: Array<{ key: string; data: Uint8Array }> = []
        const plain = recordingBackend().backend
        const withSetImage: RenderBackend = {
            ...plain,
            setImage(key, data) {
                registered.push({ key, data })
            },
        }
        expect(() => renderCanvas(blankPage(10, 10), withSetImage)).not.toThrow()
        withSetImage.setImage?.('qr:hello', new Uint8Array([1]))
        expect(registered).toEqual([{ key: 'qr:hello', data: new Uint8Array([1]) }])
    })
})
