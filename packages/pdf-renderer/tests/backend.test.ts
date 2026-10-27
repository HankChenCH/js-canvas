import { describe, expect, it } from 'vitest'

import { decodeGraph, renderAs } from '@hankchen/canvas'
import type { Canvas } from '@hankchen/canvas'

import { PdfRenderer, borderBands } from '../src/backend'
import {
    BLUE,
    GREEN,
    RED,
    WHITE,
    expectPageSize,
    expectPixel,
    pdfInfoField,
    popplerAvailable,
    rasterizePage,
    runPoppler,
    withPdfFile,
} from './helpers'

/**
 * 结构与矩形原语测试（对位 go pdf-renderer backend_test.go）：pdfinfo 页数/页尺寸、
 * 背景色中心点、四边边框色带内侧采样（避开抗锯齿边缘）。poppler 四件套在场时跑
 * 结构断言（工票 11：缺席 skip，与 go 的 Fatal 不同）。
 */

/** 单层纯色页（盒原点 = 画布原点，复用核心测试同款 wire 字面量构造） */
export function solidPage(width: number, height: number, color: string): Canvas {
    return decodeGraph({
        canvas: { width, height },
        layers: [{ type: 'ImageLayer', spec: { shape: { width, height, backgroundColor: color } } }],
    })
}

/** 渲染单页为 PDF 字节（经核心 renderAs 断言入口） */
export function renderPdf(canvas: Canvas, backend: PdfRenderer): Uint8Array {
    const product = renderAs<Uint8Array>(canvas, backend)
    expect(product.length).toBeGreaterThan(0)
    return product
}

const maybePoppler = popplerAvailable() ? describe : describe.skip

describe('begin/end 会话（对位 go backend.go Begin/End）', () => {
    it('尺寸防线：非正尺寸报错且不建面', () => {
        const r = new PdfRenderer()
        expect(() => r.begin(0, 10)).toThrow('渲染面尺寸非法')
        expect(() => r.begin(10, -1)).toThrow('渲染面尺寸非法')
        expect(r.end()).toBeNull() // 未建面无产物（核心 renderAs 面即 product_type_mismatch）
    })

    it('未建面调绘制原语报错（模板保证先 begin，防御直调）', () => {
        const r = new PdfRenderer()
        expect(() => r.drawRect(0, 0, 1, 1, '#000', { top: null, bottom: null, left: null, right: null })).toThrow('PDF 渲染面未初始化')
        expect(() => r.drawImage('x.png', { x: 0, y: 0, width: 0, height: 0 }, { x: 0, y: 0, width: 1, height: 1 })).toThrow('PDF 渲染面未初始化')
        expect(() => r.drawText('x', 0, 0, { font: '', fontSize: 12, fontColor: '#000', horizontalAlign: 'left', verticalAlign: 'top', angle: 0 })).toThrow('PDF 渲染面未初始化')
    })

    it('end 同步返回完整 %PDF 字节（Uint8Array），end 后实例复用得到干净新文档', () => {
        const r = new PdfRenderer()
        r.begin(10, 10)
        r.drawRect(0, 0, 10, 10, '#ff0000', { top: null, bottom: null, left: null, right: null })
        const product = r.end()
        expect(product).toBeInstanceOf(Uint8Array)
        expect(Buffer.from(product!.subarray(0, 5)).toString('latin1')).toBe('%PDF-')

        // End 后复用：再次 begin 建档新文档（续页分支只活在单次渲染会话内）
        r.begin(20, 10)
        r.drawRect(0, 0, 20, 10, '#00ff00', { top: null, bottom: null, left: null, right: null })
        const second = r.end()!
        expect(Buffer.from(second.subarray(0, 5)).toString('latin1')).toBe('%PDF-')
        if (popplerAvailable()) {
            expect(pdfInfoField(withPdfFile(second, (p) => runPoppler('pdfinfo', [p])), 'Pages')).toBe('1')
        }
    })

    it('多页续页语义：同一实例连续 begin 多次 → 单文档多页，end 一次终结（renderPages 编排的落点）', () => {
        const r = new PdfRenderer()
        r.begin(60, 40)
        r.begin(30, 20)
        const pdf = r.end()!
        if (popplerAvailable()) {
            const info = withPdfFile(pdf, (p) => runPoppler('pdfinfo', [p]))
            expect(pdfInfoField(info, 'Pages')).toBe('2')
        }
    })
})

describe('原子性与失败纪律（05 号决议补件 #4：失败弃件、无产物逃逸）', () => {
    it('绘制原语失败后 end() 无产物逃逸（渲染面已弃件），后续 begin 正常建档（防御面）', () => {
        const r = new PdfRenderer()
        r.begin(10, 10)
        expect(() =>
            r.drawRect(0, 0, 10, 10, '#zzzzzz', { top: null, bottom: null, left: null, right: null }),
        ).toThrow(/无法解析颜色/)
        expect(r.end()).toBeNull() // 失败路径无半截产物
        // 弃件后实例防御性可用：重建会话得到干净文档（纪律上失败实例应弃用，此处锁防线）
        r.begin(10, 10)
        expect(r.end()).not.toBeNull()
    })

    it('经核心模板的失败路径：原语 throw 即中止，end 不达（renderAs 以 throw 退出）', () => {
        const r = new PdfRenderer()
        r.begin(20, 20)
        expect(() =>
            r.drawRect(0, 0, 20, 20, '#ff0000', {
                top: { width: 2, color: 'not-a-color' },
                bottom: null,
                left: null,
                right: null,
            }),
        ).toThrow(/解析边框色/)
    })
})


maybePoppler('结构断言（pdfinfo；poppler 在场）', () => {
    it('单页尺寸 = px × 0.75 pt（200×100 px → 150×75 pt）', () => {
        const pdf = renderPdf(solidPage(200, 100, '#ff0000'), new PdfRenderer())
        const info = withPdfFile(pdf, (p) => runPoppler('pdfinfo', [p]))
        expect(pdfInfoField(info, 'Pages')).toBe('1')
        expect(pdfInfoField(info, 'Page size')).toBe(expectPageSize(200, 100))
    })

    it('背景填充：实心区中心点精确取样', () => {
        const pdf = renderPdf(solidPage(20, 10, '#ff0000'), new PdfRenderer())
        expectPixel(rasterizePage(pdf, 1, 20, 10), 10, 5, RED)
    })

    it('四边异色边框：每边色带内侧采样，绘制序 top/bottom/left/right 后画覆盖先画', () => {
        const canvas = decodeGraph({
            canvas: { width: 30, height: 20 },
            layers: [
                {
                    type: 'ImageLayer',
                    spec: {
                        shape: {
                            width: 30,
                            height: 20,
                            backgroundColor: '#ffffff',
                            border: {
                                top: { width: 4, color: '#0000ff' },
                                bottom: { width: 4, color: '#0000ff' },
                                left: { width: 4, color: '#ff0000' },
                                right: { width: 4, color: '#ff0000' },
                            },
                        },
                    },
                },
            ],
        })
        const pdf = renderPdf(canvas, new PdfRenderer())
        const img = rasterizePage(pdf, 1, 30, 20)
        expectPixel(img, 15, 10, WHITE) // 白底中心
        expectPixel(img, 15, 1, BLUE) // top 色带内侧
        expectPixel(img, 15, 18, BLUE) // bottom 色带内侧
        expectPixel(img, 1, 10, RED) // left 色带内侧（行中段避角部覆盖序）
        expectPixel(img, 28, 10, RED) // right 色带内侧
    })

    it('画布背景铺装先色后图层（ADR 0022）：色块被后绘图层盒覆盖', () => {
        const canvas = decodeGraph({
            canvas: { width: 20, height: 20, background: { color: '#ff0000', image: null } },
            layers: [
                {
                    type: 'ImageLayer',
                    spec: { position: { x: 5, y: 5 }, shape: { width: 10, height: 10, backgroundColor: '#ffffff' } },
                },
            ],
        })
        const pdf = renderPdf(canvas, new PdfRenderer())
        const img = rasterizePage(pdf, 1, 20, 20)
        expectPixel(img, 2, 2, RED)
        expectPixel(img, 10, 10, WHITE)
    })

    it('画布背景色 + 图层色贯通多色渲染取样', () => {
        const canvas = decodeGraph({
            canvas: { width: 30, height: 10, background: { color: '#00ff00', image: null } },
            layers: [
                { type: 'ImageLayer', spec: { position: { x: 0, y: 0 }, shape: { width: 10, height: 10, backgroundColor: '#ff0000' } } },
                { type: 'ImageLayer', spec: { position: { x: 20, y: 0 }, shape: { width: 10, height: 10, backgroundColor: '#0000ff' } } },
            ],
        })
        const img = rasterizePage(renderPdf(canvas, new PdfRenderer()), 1, 30, 10)
        expectPixel(img, 5, 5, RED)
        expectPixel(img, 15, 5, GREEN)
        expectPixel(img, 25, 5, BLUE)
    })
})

describe('borderBands 四边带公式（对位 go backend.go borderBands 同式）', () => {
    it('序 top/bottom/left/right；未设与 width≤0 的边不计；bottom/right 向内收缩钳位', () => {
        const bands = borderBands(10, 20, 30, 40, {
            top: { width: 3, color: '#111111' },
            bottom: { width: 4, color: '#222222' },
            left: { width: 0, color: '#333333' }, // width≤0 不计
            right: null,
        })
        expect(bands.map((b) => b.side.color)).toEqual(['#111111', '#222222'])
        expect(bands[0]!.band).toEqual({ x: 10, y: 20, width: 30, height: 3 })
        expect(bands[1]!.band).toEqual({ x: 10, y: 56, width: 30, height: 4 })
    })

    it('边宽带大于盒宽时向内钳位（max 收缩，带不越盒）', () => {
        const bands = borderBands(0, 0, 10, 10, {
            top: null,
            bottom: null,
            left: { width: 20, color: '#444444' },
            right: null,
        })
        expect(bands).toHaveLength(1)
        expect(bands[0]!.band).toEqual({ x: 0, y: 0, width: 20, height: 10 })
        const right = borderBands(0, 0, 10, 10, {
            top: null,
            bottom: null,
            left: null,
            right: { width: 20, color: '#444444' },
        })
        // go 公式 max(x, x+width-w) = max(0, -10) = 0：带钳回盒内
        expect(right[0]!.band).toEqual({ x: 0, y: 0, width: 10, height: 10 })
    })
})
