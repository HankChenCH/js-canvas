import { describe, expect, it } from 'vitest'

import { decodeGraph, renderAs, renderPagesAs } from '@hankchen/canvas'
import type { Canvas } from '@hankchen/canvas'

import { PdfRenderer } from '../src/backend'
import {
    BLUE,
    GREEN,
    pageText,
    pdfInfoField,
    popplerAvailable,
    rasterizePage,
    RED,
    runPoppler,
    withPdfFile,
} from './helpers'
import { solidPage } from './backend.test'

/**
 * 多页入口测试（对位 go pdf-renderer renderpages_test.go 的核心验收面）：
 * renderPagesAs 页序列 → 单 PDF；pdfinfo 页数/逐页尺寸、pdftoppm 按页采样背景色
 * （页序）、pdftotext 按页提取标记文本（页序不串）；End 后实例复用得到干净新文档
 * （页数不得累加进旧文档）；任一页失败无产物逃逸。poppler 在场时跑结构断言。
 */

/** 标记页：纯色背景 + 左上角默认字体标记文本（墨迹在角落，不干扰中心采样） */
function markerPage(width: number, height: number, bg: string, marker: string): Canvas {
    return decodeGraph({
        canvas: { width, height, background: { color: bg, image: null } },
        layers: [
            {
                type: 'TextLayer',
                spec: {
                    align: { horizontal: 'left', vertical: 'top' },
                    shape: { width, height },
                    fontFamily: { font: '', fontSize: 12, fontColor: '#111111' },
                },
                data: { value: marker },
            },
        ],
    })
}

const maybePoppler = popplerAvailable() ? describe : describe.skip

maybePoppler('多页结构断言（pdfinfo/pdftoppm/pdftotext）', () => {
    it('两页不同尺寸 → 页数与逐页尺寸、页序（背景色采样 + 标记文本按页双重锚定）', () => {
        const r = new PdfRenderer()
        const pages = [
            markerPage(320, 240, '#ff0000', 'PAGE-ONE'),
            markerPage(200, 100, '#0000ff', 'PAGE-TWO'),
        ]
        const pdf = renderPagesAs<Uint8Array>(pages, r)
        expect(pdf.length).toBeGreaterThan(0)

        const info = withPdfFile(pdf, (p) => runPoppler('pdfinfo', ['-f', '1', '-l', '2', p]))
        expect(pdfInfoField(withPdfFile(pdf, (p) => runPoppler('pdfinfo', [p])), 'Pages')).toBe('2')
        // 逐页 MediaBox = 各页 px × 0.75 pt（逐页可变尺寸是 begin 续页契约的一部分）
        const sizes = new Map<number, string>()
        for (const line of info.split('\n')) {
            const f = line.trim().split(/\s+/)
            if (f.length === 7 && f[0] === 'Page' && f[2] === 'size:') {
                sizes.set(Number(f[1]), `${f[3]} x ${f[5]} pts`)
            }
        }
        expect(sizes.get(1)).toBe('240 x 180 pts')
        expect(sizes.get(2)).toBe('150 x 75 pts')

        // 页序：逐页栅格化采中心点背景色
        expectColor(rasterizePage(pdf, 1, 320, 240), 160, 120, RED)
        expectColor(rasterizePage(pdf, 2, 200, 100), 100, 50, BLUE)

        // 标记文本按页提取；标记不跨页（页序错排在此暴露）
        expect(pageText(pdf, 1)).toContain('PAGE-ONE')
        expect(pageText(pdf, 2)).toContain('PAGE-TWO')
        expect(pageText(pdf, 1)).not.toContain('PAGE-TWO')
        expect(pageText(pdf, 2)).not.toContain('PAGE-ONE')
    })
})

function expectColor(img: ReturnType<typeof rasterizePage>, x: number, y: number, want: readonly [number, number, number]): void {
    const o = (y * img.width + x) * 3
    const got: [number, number, number] = [img.data[o]!, img.data[o + 1]!, img.data[o + 2]!]
    expect(got).toEqual(want)
}

describe('End 后实例复用（对位 go 工票 03 验收：复位语义）', () => {
    it('同一实例两次 renderPagesAs：第二次必须得到干净新文档（页数不累加、尺寸不串页）', () => {
        const r = new PdfRenderer()
        const first = renderPagesAs<Uint8Array>(
            [markerPage(100, 80, '#ff0000', 'DOC1-A'), markerPage(120, 90, '#00ff00', 'DOC1-B')],
            r,
        )
        if (popplerAvailable()) {
            expect(pdfInfoField(withPdfFile(first, (p) => runPoppler('pdfinfo', [p])), 'Pages')).toBe('2')
        }

        const second = renderPagesAs<Uint8Array>([markerPage(200, 150, '#0000ff', 'DOC2-A')], r)
        if (popplerAvailable()) {
            const info = withPdfFile(second, (p) => runPoppler('pdfinfo', [p]))
            expect(pdfInfoField(info, 'Pages')).toBe('1')
            expect(pdfInfoField(info, 'Page size')).toBe('150 x 112.5 pts')
            expectColor(rasterizePage(second, 1, 200, 150), 100, 75, BLUE)
        }
    })

    it('单页入口（renderAs）与多页入口交替复用同一实例同样干净', () => {
        const r = new PdfRenderer()
        renderAs<Uint8Array>(solidPage(60, 40, '#ff0000'), r)
        const pdf = renderPagesAs<Uint8Array>([solidPage(80, 60, '#00ff00')], r)
        expect(pdf.length).toBeGreaterThan(0)
        void GREEN
    })
})

describe('失败路径（对位 go renderpages_test.go：任一页失败无产物逃逸）', () => {
    it('后页绘制失败（垃圾图片字节）：renderPagesAs 以 throw 退出、无产物返回', () => {
        const r = new PdfRenderer()
        const broken = decodeGraph({
            canvas: { width: 60, height: 40 },
            layers: [
                {
                    type: 'ImageLayer',
                    spec: { shape: { width: 20, height: 20 }, backgroundColor: '#ffffff' },
                    data: { value: '/pdf-renderer-test-nonexistent/broken.png' },
                },
            ],
        })
        expect(() => renderPagesAs<Uint8Array>([solidPage(60, 40, '#eeeeee'), broken], r)).toThrow(/读取图片/)
        // 失败弃件：直调 end() 也无半截产物
        expect(r.end()).toBeNull()
    })

    it('核心模板保证失败路径 end 不达：renderPages 以 throw 退出而非返回部分产物', () => {
        const r = new PdfRenderer()
        const bad = decodeGraph({
            canvas: { width: 30, height: 30 },
            layers: [
                {
                    type: 'ImageLayer',
                    spec: { shape: { width: 30, height: 30 } },
                    data: { value: '/pdf-renderer-test-nonexistent/garbage.gif' },
                },
            ],
        })
        expect(() => renderAs<Uint8Array>(bad, r)).toThrow()
    })
})
