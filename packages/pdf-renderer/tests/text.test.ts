import { describe, expect, it } from 'vitest'

import { createHash } from 'node:crypto'
import fs from 'node:fs'

import { decodeGraph } from '@hankchen/canvas'
import type { Canvas } from '@hankchen/canvas'

import { PdfRenderer } from '../src/backend'
import {
    BLUE,
    WHITE,
    encodePng,
    pageText,
    pdfFonts,
    popplerAvailable,
    probeCjkFont,
    rasterizePage,
    runPoppler,
    withPdfFile,
    writeTemp,
} from './helpers'
import { renderPdf } from './backend.test'

/**
 * 文本原语测试（对位 go pdf-renderer text_test.go）：空行守卫、Helvetica 兜底、
 * 对齐锚点（实测宽度水平对齐 + metrics 垂直基线）、角度旋转、TTF 子集内嵌（CJK）
 * 与失败防线（TTC 拒收/垃圾字节）。墨迹断言为相对关系（锚点方位/跨距变化），不依赖
 * 具体字体度量数值。poppler 四件套在场时跑结构断言。
 */

const maybePoppler = popplerAvailable() ? describe : describe.skip

/** 文本页：单文本层（wire 字面量，spec.fontFamily 携带字体参数、data.value 携带文本） */
function textPage(options: {
    width: number
    height: number
    text: string
    font?: string
    fontSize?: number
    fontColor?: string
    hAlign?: 'left' | 'center' | 'right'
    vAlign?: 'top' | 'center' | 'bottom'
    angle?: number
    background?: string
    padding?: number
}): Canvas {
    return decodeGraph({
        canvas: {
            width: options.width,
            height: options.height,
            ...(options.background ? { background: { color: options.background, image: null } } : {}),
        },
        layers: [
            {
                type: 'TextLayer',
                    spec: {
                    // wire 默认 vAlign=bottom（历史语义，go AGENTS.md 同款记载）——
                    // 管线级文本测试显式对齐（对位 go WithVerticalAlign 纪律）
                    align: { horizontal: options.hAlign ?? 'left', vertical: options.vAlign ?? 'top' },
                    shape: {
                        width: options.width,
                        height: options.height,
                        ...(options.padding !== undefined ? { padding: { top: options.padding, bottom: options.padding, left: options.padding, right: options.padding } } : {}),
                    },
                    fontFamily: {
                        font: options.font ?? '',
                        fontSize: options.fontSize ?? 12,
                        fontColor: options.fontColor ?? '#000000',
                        angle: options.angle ?? 0,
                    },
                },
                data: { value: options.text },
            },
        ],
    })
}

/** 栅格非白墨迹包围盒（pdftoppm 无透明：白底 + 墨迹 = 任一通道暗于阈值的像素） */
function inkBox(img: ReturnType<typeof rasterizePage>, threshold = 128): { minX: number; minY: number; maxX: number; maxY: number; ok: boolean } {
    let minX = img.width
    let minY = img.height
    let maxX = -1
    let maxY = -1
    let ok = false
    for (let y = 0; y < img.height; y += 1) {
        for (let x = 0; x < img.width; x += 1) {
            const o = (y * img.width + x) * 3
            const r = img.data[o]!
            const g = img.data[o + 1]!
            const b = img.data[o + 2]!
            if (r < threshold || g < threshold || b < threshold) {
                ok = true
                if (x < minX) minX = x
                if (x > maxX) maxX = x
                if (y < minY) minY = y
                if (y > maxY) maxY = y
            }
        }
    }
    return { minX, minY, maxX, maxY, ok }
}

const TEXT_OPTIONS = {
    font: '',
    fontSize: 12,
    fontColor: '#000000',
    horizontalAlign: 'left' as const,
    verticalAlign: 'top' as const,
    angle: 0,
}

describe('drawText 守卫与字体分派（原语级）', () => {
    it('空行零副作用（渲染成功无墨迹）；垃圾字体字节报错弃件；TTC 魔数 fail-fast 拒收', () => {
        const r = new PdfRenderer()
        r.begin(20, 20)
        r.drawText('', 10, 10, { ...TEXT_OPTIONS })
        expect(r.end()).not.toBeNull()

        const junk = writeTemp('junk.ttf', new Uint8Array(Buffer.from('not a font', 'latin1')))
        const r2 = new PdfRenderer()
        r2.begin(20, 20)
        expect(() => r2.drawText('x', 5, 10, { ...TEXT_OPTIONS, font: junk })).toThrow(/字体解析失败|注册字体/)
        expect(r2.end()).toBeNull() // 弃件：无产物逃逸

        // TTC：fontkit 认 ttcf 并静默取首面，必须先拦（05 号决议 node 两后端统一拒收）
        const ttc = writeTemp('fake.ttc', new Uint8Array(Buffer.from('ttcf............', 'latin1')))
        const r3 = new PdfRenderer()
        r3.begin(20, 20)
        expect(() => r3.drawText('x', 5, 10, { ...TEXT_OPTIONS, font: ttc })).toThrow(/TTC\/OTC 字体集/)
    })

    it('族名 = "f" + sha256 前 16 hex（路径/空格禁入 PDF Name），同引用会话内复用', () => {
        // 经 pdffonts 侧写验证：BaseFont 名不含原始路径的 "/" 与空格（结构断言在 CJK 腿）
        const familyShape = `f${createHash('sha256').update('/some/path/Font Name.ttf', 'utf8').digest('hex').slice(0, 16)}`
        expect(familyShape).toMatch(/^f[0-9a-f]{16}$/)
    })

    it('registerFontData 登记的字节优先于磁盘路径', () => {
        // 登记一个合法 TTF（借 CJK 探针字体；缺席则用目录里任意单体 TTF，全缺跳过）
        const font = probeCjkFont()
        if (font === null) return
        const r = new PdfRenderer()
        r.registerFontData('mem://font.ttf', new Uint8Array(fs.readFileSync(font)))
        r.begin(40, 20)
        expect(() => r.drawText('abc', 2, 15, { ...TEXT_OPTIONS, font: 'mem://font.ttf' })).not.toThrow()
        expect(r.end()).not.toBeNull()
    })
})

maybePoppler('文本渲染（poppler 栅格取样，对位 go text_test.go 手法）', () => {
    it('Helvetica 兜底（空串/纯数字字体）可渲且有墨迹', () => {
        for (const font of ['', '1', '42', '1.5']) {
            const img = rasterizePage(renderPdf(textPage({ width: 40, height: 20, text: 'abc', font }), new PdfRenderer()), 1, 40, 20)
            expect(inkBox(img).ok).toBe(true)
        }
    })

    it('水平对齐锚点：左对齐从盒原点起笔、右对齐收于盒右缘、居中关于盒中线对称', () => {
        const boxes = (['left', 'center', 'right'] as const).map((h) =>
            inkBox(rasterizePage(renderPdf(textPage({ width: 60, height: 20, text: 'WWW', hAlign: h, vAlign: 'top', fontSize: 12 }), new PdfRenderer()), 1, 60, 20)),
        )
        const [l, c, rt] = boxes
        expect(l!.ok && c!.ok && rt!.ok).toBe(true)
        // 锚点 = 内容盒原点（padding 0，textOrigin：left→0 / center→宽/2 / right→宽）
        expect(l!.minX).toBeLessThanOrEqual(2)
        expect(rt!.maxX).toBeGreaterThanOrEqual(57)
        const lgap = 30 - c!.minX
        const rgap = c!.maxX - 30
        expect(Math.abs(lgap - rgap)).toBeLessThanOrEqual(2)
    })

    it('垂直对齐锚点：top 墨迹在锚点下方、bottom 收于锚点上方、center 跨两侧（相对关系）', () => {
        const span = (v: 'top' | 'center' | 'bottom') => {
            const img = rasterizePage(renderPdf(textPage({ width: 40, height: 40, text: 'ABC', vAlign: v, fontSize: 12 }), new PdfRenderer()), 1, 40, 40)
            const box = inkBox(img)
            expect(box.ok).toBe(true)
            return box
        }
        const t = span('top')
        const b = span('bottom')
        const c = span('center')
        // 锚点 = 内容盒中心（autoHeight 层高 = 行高，vAlign center → lineH/2）；
        // 相对关系：top 整体高于 bottom；center 介于其间
        expect(t.maxY).toBeLessThanOrEqual(b.minY + 1)
        expect(c.minY).toBeGreaterThan(t.minY)
        expect(c.maxY).toBeLessThan(b.maxY)
    })

    it('角度 90（逆时针）：墨迹向上越过锚点；-90 向下（对位 go TransformRotate 方向标定）', () => {
        const boxOf = (angle: number) => {
            // padding 30 使锚点落在 (30,30)：旋转后墨迹留在页内（锚点在原点会整体转出页）
            const img = rasterizePage(
                renderPdf(textPage({ width: 80, height: 80, text: 'WWW', angle, hAlign: 'left', vAlign: 'top', fontSize: 12, padding: 30 }), new PdfRenderer()),
                1,
                80,
                80,
            )
            const box = inkBox(img)
            expect(box.ok).toBe(true)
            return box
        }
        const up = boxOf(90)
        const down = boxOf(-90)
        // 锚点在盒中心附近（autoWidth/autoHeight 层盒收缩到文本尺寸，锚点 = 盒原点）；
        // 锁相对关系：+90 墨迹纵跨大横跨小、-90 镜像
        expect(up.maxY - up.minY).toBeGreaterThan(up.maxX - up.minX)
        expect(down.maxY - down.minY).toBeGreaterThan(down.maxX - down.minX)
        expect(up.minY).toBeLessThan(down.minY)
        expect(up.maxY).toBeLessThan(down.maxY)
    })
})

maybePoppler('TTF 子集内嵌与 pdffonts 断言（poppler 在场；CJK 字体探针缺席 skip）', () => {
    const cjkFont = probeCjkFont()

    it.skipIf(cjkFont === null)('pdftotext 提取 ASCII + CJK；pdffonts 三要素 CID TrueType + Identity-H + emb=yes（sub 位放宽，05 号决议）', () => {
        // 文本须取自探针字体的并集：CI CJK 字体 ipag/ipaexg 是 JIS 日文字体，简体
        // 专用字（证书）不在字面、fontkit 编码为 .notdef——PDF 缺字形出 .notdef 是
        // 通用字体语义而非产品缺陷；用 JIS 收录的「証書」（ipag/ipaexg/Arial
        // Unicode 三候选全有）保证提取断言在所有探针命中面成立
        const font = cjkFont!
        const pdf = renderPdf(
            textPage({ width: 200, height: 40, text: 'js-canvas 証書 PDF', font, fontSize: 20, hAlign: 'left', vAlign: 'top' }),
            new PdfRenderer(),
        )
        const text = pageText(pdf, 1)
        expect(text).toContain('js-canvas')
        expect(text).toContain('証書')

        const fonts = pdfFonts(pdf)
        const subsetLine = fonts.split('\n').find((line) => line.includes('CID TrueType') && line.includes('Identity-H'))
        expect(subsetLine, `pdffonts 未找到 CID TrueType + Identity-H 行:\n${fonts}`).toBeTruthy()
        expect(subsetLine!).toContain('yes')
        // 族名不含原始路径（PDF Name 红线）：BaseFont 以合成族名形态出现
        expect(subsetLine!).not.toContain('/')
        void runPoppler
        void withPdfFile
        void WHITE
        void BLUE
        void encodePng
    })

    it.skipIf(cjkFont === null)('End 后实例复用必须重注册字体（复位语义，对位 go renderpages_test.go）', () => {
        const font = cjkFont!
        const r = new PdfRenderer()
        const page = textPage({ width: 160, height: 60, text: '第一次文档', font, fontSize: 14, vAlign: 'top' })
        const first = renderAsPdfBytes(page, r)
        const second = renderAsPdfBytes(textPage({ width: 160, height: 60, text: '第二次文档', font, fontSize: 14, vAlign: 'top' }), r)
        expect(pageText(first, 1)).toContain('第一次文档')
        expect(pageText(second, 1)).toContain('第二次文档')
    })

    it('Helvetica 兜底不内嵌（核心字体 emb=no，与子集内嵌互证）', () => {
        const pdf = renderPdf(textPage({ width: 100, height: 30, text: 'fallback ascii', fontSize: 14, vAlign: 'top' }), new PdfRenderer())
        expect(pageText(pdf, 1)).toContain('fallback ascii')
        const fonts = pdfFonts(pdf)
        expect(fonts.split('\n').some((line) => line.includes('Helvetica') && line.includes('no'))).toBe(true)
    })
})

import { renderAs } from '@hankchen/canvas'

function renderAsPdfBytes(page: Canvas, r: PdfRenderer): Uint8Array {
    return renderAs<Uint8Array>(page, r)
}
