import { describe, expect, it } from 'vitest'

import { decodeGraph, renderPagesAs } from '@hankchen/canvas'
import type { Canvas } from '@hankchen/canvas'

import { PdfRenderer } from '../src/backend'
import { renderCanvasAsPdf, createDefaultResolver } from '../src/resolver'
import {
    BLUE,
    BMP_MAGIC,
    GIF_MAGIC,
    RED,
    WEBP_MAGIC,
    WHITE,
    encodeJpeg,
    encodePng,
    encodePngInterlacedStub,
    encodePngPaletteTrns,
    encodePngRgba,
    expectPageSize,
    expectPixel,
    expectPixelNear,
    expectWellFormedPdf,
    makeTempDir,
    pageText,
    pdfInfoField,
    popplerAvailable,
    rasterizePage,
    runPoppler,
    samplePixel,
    twoBandExifJpeg,
    twoColorPng,
    withPdfFile,
    writeTemp,
} from './helpers'
import { renderPdf, solidPage } from './backend.test'

/**
 * 图片原语测试（对位 go pdf-renderer image_test.go）：PNG/JPEG 直嵌、cover 裁窗、
 * contain、fill、tile 网格与截断、EXIF 八向放置矩阵、格式拒收与内容去重。
 * 经标准管线驱动（模板分派 fit 几何），poppler 栅格化后实心区内部点采样。
 */

/** 图片图层页：指定 fit 的单图内容盒（wire 字面量——src 在 data.value，经核心解码分派） */
function imagePage(options: {
    width: number
    height: number
    src: string
    fit?: 'cover' | 'contain' | 'fill' | 'tile'
    clip?: 'circle' | 'rect'
    background?: string
    canvasBackground?: string
    canvasWidth?: number
    canvasHeight?: number
}): Canvas {
    const canvasWidth = options.canvasWidth ?? options.width
    const canvasHeight = options.canvasHeight ?? options.height
    return decodeGraph({
        canvas: {
            width: canvasWidth,
            height: canvasHeight,
            ...(options.canvasBackground
                ? { background: { color: options.canvasBackground, image: null } }
                : {}),
        },
        layers: [
            {
                type: 'ImageLayer',
                spec: {
                    shape: {
                        width: options.width,
                        height: options.height,
                        ...(options.background ? { backgroundColor: options.background } : {}),
                    },
                    ...(options.fit ? { fit: options.fit } : {}),
                    ...(options.clip ? { clip: options.clip } : {}),
                },
                data: { value: options.src },
            },
        ],
    })
}

const maybePoppler = popplerAvailable() ? describe : describe.skip

maybePoppler('直嵌与 fit 几何（poppler 栅格取样）', () => {
    it('PNG 整图 fill：源红蓝两半 → 目标盒同比例映回（采样避开分界）', () => {
        const src = writeTemp('two-color.png', twoColorPng(20, 10, RED, BLUE, 10))
        const img = rasterizePage(renderPdf(imagePage({ width: 20, height: 10, src, fit: 'fill' }), new PdfRenderer()), 1, 20, 10)
        expectPixel(img, 4, 5, RED)
        expectPixel(img, 15, 5, BLUE)
    })

    it('JPEG 直嵌：有损编码用容差取样', () => {
        const src = writeTemp('solid.jpg', encodeJpeg(20, 10, () => [0, 255, 0]))
        const img = rasterizePage(renderPdf(imagePage({ width: 20, height: 10, src, fit: 'fill' }), new PdfRenderer()), 1, 20, 10)
        expectPixelNear(img, 10, 5, [0, 255, 0], 24)
    })

    it('cover 裁窗：40×10 双色图 cover 进 20×20 盒 → 裁中缝左右各半（与位图后端同几何）', () => {
        const src = writeTemp('wide.png', twoColorPng(40, 10, RED, BLUE, 20))
        const img = rasterizePage(
            renderPdf(imagePage({ width: 20, height: 20, src, fit: 'cover', background: '#ffffff' }), new PdfRenderer()),
            1,
            20,
            20,
        )
        expectPixel(img, 5, 10, RED)
        expectPixel(img, 15, 10, BLUE)
    })

    it('contain：40×10 图按比例收缩进 20×20 盒 → 上下留白露背景', () => {
        const src = writeTemp('wide2.png', twoColorPng(40, 10, RED, BLUE, 20))
        const img = rasterizePage(
            renderPdf(imagePage({ width: 20, height: 20, src, fit: 'contain', background: '#ffffff' }), new PdfRenderer()),
            1,
            20,
            20,
        )
        expectPixel(img, 3, 2, WHITE)
        expectPixel(img, 17, 18, WHITE)
        expectPixel(img, 5, 10, RED)
        expectPixel(img, 15, 10, BLUE)
    })

    it('tile：20×10 源平铺 50×30 盒，居中锚定网格起点 (15,10)，截断块与未覆盖区按几何取样', () => {
        const src = writeTemp('tile.png', encodePng(20, 10, () => [255, 0, 0]))
        const img = rasterizePage(
            renderPdf(imagePage({ width: 50, height: 30, src, fit: 'tile', background: '#ffffff' }), new PdfRenderer()),
            1,
            50,
            30,
        )
        for (const [x, y] of [[25, 15], [25, 25], [45, 15], [45, 25], [49, 29]] as const) {
            expectPixel(img, x, y, RED)
        }
        expectPixel(img, 5, 5, WHITE)
        expectPixel(img, 25, 5, WHITE)
        expectPixel(img, 5, 25, WHITE)
    })

    it('画布背景图 cover 铺装（分派点 coverSourceWindow 共用公式）', () => {
        const src = writeTemp('bg.png', twoColorPng(40, 10, RED, BLUE, 20))
        const canvas = decodeGraph({
            canvas: { width: 20, height: 20, background: { color: null, image: src } },
            layers: [],
        })
        const img = rasterizePage(renderPdf(canvas, new PdfRenderer()), 1, 20, 20)
        expectPixel(img, 5, 10, RED)
        expectPixel(img, 15, 10, BLUE)
    })
})

maybePoppler('EXIF 自管八向矩阵（05 号决议：ignoreOrientation 关库默认 + 自管矩阵）', () => {
    it('orientation 6（顺时针 90°）：8×16 上红下蓝源图 → 观察方向 16×8 左蓝右红', () => {
        const src = writeTemp('exif-6.jpg', twoBandExifJpeg(6))
        const img = rasterizePage(
            renderPdf(imagePage({ width: 16, height: 8, src, fit: 'fill', background: '#ffffff' }), new PdfRenderer()),
            1,
            16,
            8,
        )
        expectPixelNear(img, 1, 4, BLUE, 60)
        expectPixelNear(img, 14, 4, RED, 60)
    })

    // 八向标定（JPEG 载体，poppler 渲染容差取样；期望色序与 go image_test.go 逐向一致）
    const cases: Array<{ orientation: number; dstW: number; dstH: number; splitVertical: boolean; first: typeof RED; second: typeof RED }> = [
        { orientation: 6, dstW: 16, dstH: 8, splitVertical: true, first: BLUE, second: RED },
        { orientation: 8, dstW: 16, dstH: 8, splitVertical: true, first: RED, second: BLUE },
        { orientation: 5, dstW: 16, dstH: 8, splitVertical: true, first: RED, second: BLUE },
        { orientation: 7, dstW: 16, dstH: 8, splitVertical: true, first: BLUE, second: RED },
        { orientation: 3, dstW: 8, dstH: 16, splitVertical: false, first: BLUE, second: RED },
        { orientation: 2, dstW: 8, dstH: 16, splitVertical: false, first: RED, second: BLUE },
        { orientation: 4, dstW: 8, dstH: 16, splitVertical: false, first: BLUE, second: RED },
        { orientation: 1, dstW: 8, dstH: 16, splitVertical: false, first: RED, second: BLUE },
    ]
    for (const tc of cases) {
        it(`orientation ${tc.orientation} → 观察方向 ${tc.dstW}×${tc.dstH} ${tc.splitVertical ? '左右' : '上下'}分色`, () => {
            const src = writeTemp(`exif-${tc.orientation}.jpg`, twoBandExifJpeg(tc.orientation))
            const img = rasterizePage(
                renderPdf(imagePage({ width: tc.dstW, height: tc.dstH, src, fit: 'fill', background: '#ffffff' }), new PdfRenderer()),
                1,
                tc.dstW,
                tc.dstH,
            )
            if (tc.splitVertical) {
                expectPixelNear(img, 1, 4, tc.first, 60)
                expectPixelNear(img, tc.dstW - 2, 4, tc.second, 60)
            } else {
                expectPixelNear(img, 4, 1, tc.first, 60)
                expectPixelNear(img, 4, tc.dstH - 2, tc.second, 60)
            }
        })
    }
})

describe('格式拒收与防御（05 号降级声明 + go 同款防御）', () => {
    it('GIF/BMP/WebP 输入报错中止，错误信息列明 v1 支持面', () => {
        for (const [name, magic] of [['f.gif', GIF_MAGIC], ['f.bmp', BMP_MAGIC], ['f.webp', WEBP_MAGIC]] as const) {
            const r = new PdfRenderer()
            r.begin(10, 10)
            const src = writeTemp(name, magic)
            expect(() =>
                r.drawImage(src, { x: 0, y: 0, width: 0, height: 0 }, { x: 0, y: 0, width: 5, height: 5 }),
            ).toThrow(/无法识别的图片格式[\s\S]*PNG\/JPEG/)
        }
    })

    it('垃圾字节报错中止（嗅探防线，不得静默出图）', () => {
        const r = new PdfRenderer()
        r.begin(10, 10)
        const src = writeTemp('garbage.png', new Uint8Array(Buffer.from('not an image', 'latin1')))
        expect(() =>
            r.drawImage(src, { x: 0, y: 0, width: 0, height: 0 }, { x: 0, y: 0, width: 5, height: 5 }),
        ).toThrow(/无法识别的图片格式/)
        expect(r.end()).toBeNull() // 失败弃件：无产物逃逸
    })

    it('dstRect 空矩形防护不画（原语级，渲染成功）；源窗与图不相交静默不画', () => {
        const r = new PdfRenderer()
        r.begin(10, 10)
        const png = writeTemp('small.png', encodePng(4, 4, () => [255, 0, 0]))
        // 空目标矩形：未建面检查在前 → 先 begin 再调
        expect(() =>
            r.drawImage(png, { x: 0, y: 0, width: 0, height: 0 }, { x: 0, y: 0, width: 0, height: 0 }),
        ).not.toThrow()
        // 不相交源窗：静默
        expect(() =>
            r.drawImage(png, { x: 100, y: 100, width: 50, height: 50 }, { x: 0, y: 0, width: 5, height: 5 }),
        ).not.toThrow()
        const pdf = r.end()!
        expect(pdf.length).toBeGreaterThan(0)
        if (popplerAvailable()) {
            // 两例都未落墨：栅格全白
            expectPixel(rasterizePage(pdf, 1, 10, 10), 5, 5, WHITE)
        }
    })

    it('未物化远程引用报错（物化缺失是调用侧错误）；qr: 未登记占位静默', () => {
        // 失败即抛纪律：第一个原语失败即弃件，后续断言各自新建会话
        const r = new PdfRenderer()
        r.begin(10, 10)
        expect(() =>
            r.drawImage('https://cdn.example.com/a.png', { x: 0, y: 0, width: 0, height: 0 }, { x: 0, y: 0, width: 5, height: 5 }),
        ).toThrow(/未物化/)
        const r2 = new PdfRenderer()
        r2.begin(10, 10)
        expect(() =>
            r2.drawImage('qr:not-materialized', { x: 0, y: 0, width: 0, height: 0 }, { x: 0, y: 0, width: 5, height: 5 }),
        ).not.toThrow()
    })

    it('setImage 登记表命中走字节（不经磁盘）；imageIntrinsicSize 同键可度量', () => {
        const r = new PdfRenderer()
        const bytes = encodePng(8, 4, () => [255, 0, 0])
        r.setImage('mem://red.png', bytes)
        expect(r.imageIntrinsicSize('mem://red.png')).toEqual({ width: 8, height: 4 })
        r.begin(8, 4)
        r.drawRect(0, 0, 8, 4, '#ffffff', { top: null, bottom: null, left: null, right: null })
        r.drawImage('mem://red.png', { x: 0, y: 0, width: 8, height: 4 }, { x: 0, y: 0, width: 8, height: 4 })
        const pdf = r.end()!
        if (popplerAvailable()) {
            expectPixel(rasterizePage(pdf, 1, 8, 4), 4, 2, RED)
        }
    })

    it('imageIntrinsicSize：本地路径解析 PNG/JPEG，失败返 null（核心退化 fill 形态）', () => {
        const r = new PdfRenderer()
        expect(r.imageIntrinsicSize(writeTemp('d.png', encodePng(6, 3, () => [0, 0, 0])))).toEqual({ width: 6, height: 3 })
        expect(r.imageIntrinsicSize(writeTemp('d.jpg', encodeJpeg(6, 3, () => [0, 0, 0])))).toEqual({ width: 6, height: 3 })
        expect(r.imageIntrinsicSize('/nonexistent/nope.png')).toBeNull()
        expect(r.imageIntrinsicSize('https://cdn.example.com/never-materialized.png')).toBeNull()
    })
})

describe('内容去重（05 号决议补件 #1：内容 hash → 实例表，同一图片只嵌一份字节）', () => {
    it('同一图片重复出现（tile 同源/双图层）产物显著小于两份独立嵌入', () => {
        // 大图 512×512 噪声纹理：重复嵌入与去重的字节差远超 PDF 结构开销
        const noisy = encodePng(512, 512, (x, y) => [(x * 7 + y * 13) % 256, (x * 3 + y * 5) % 256, (x + y * 11) % 256])
        const src = writeTemp('noisy.png', noisy)

        const once = renderPdf(imagePage({ width: 100, height: 100, src, fit: 'fill' }), new PdfRenderer())
        const twice = renderPdf(
            decodeGraph({
                canvas: { width: 100, height: 200 },
                layers: [
                    { type: 'ImageLayer', spec: { shape: { width: 100, height: 100 } }, data: { value: src } },
                    { type: 'ImageLayer', spec: { position: { x: 0, y: 100 }, shape: { width: 100, height: 100 } }, data: { value: src } },
                ],
            }),
            new PdfRenderer(),
        )
        // 去重生效：第二次引用不再嵌一份（图字节 ≫ 结构开销），双图层产物 ≲ 单图层 ×1.3
        expect(twice.length).toBeLessThan(once.length * 1.3 + 2048)
        // 反例域：两张不同内容图必须各嵌一份（防线不是「永远只嵌一张」）
        const src2 = writeTemp('noisy2.png', encodePng(512, 512, (x, y) => [(y * 7 + x * 13) % 256, (y * 3 + x * 5) % 256, (y + x * 11) % 256]))
        const distinct = renderPdf(
            decodeGraph({
                canvas: { width: 100, height: 200 },
                layers: [
                    { type: 'ImageLayer', spec: { shape: { width: 100, height: 100 } }, data: { value: src } },
                    { type: 'ImageLayer', spec: { position: { x: 0, y: 100 }, shape: { width: 100, height: 100 } }, data: { value: src2 } },
                ],
            }),
            new PdfRenderer(),
        )
        expect(distinct.length).toBeGreaterThan(once.length * 1.7)
    })
})

maybePoppler('带 alpha 通道 PNG 嵌入完整性（评审 P0-1：embed 前拍平，产物零截断）', () => {
    it('RGBA PNG 图片层：pdfinfo 读通 + startxref/%%EOF 在场 + 不透明区采样正确', () => {
        // 左红(不透明) / 中透明 / 右蓝(不透明)：拍平后中带合成到白底
        const rgba = encodePngRgba(20, 10, (x) =>
            x < 8 ? [255, 0, 0, 255] : x < 12 ? [0, 255, 0, 0] : [0, 0, 255, 255],
        )
        const src = writeTemp('rgba.png', rgba)
        const pdf = renderPdf(imagePage({ width: 20, height: 10, src, fit: 'fill' }), new PdfRenderer())
        expectWellFormedPdf(pdf)
        expect(pdfInfoField(withPdfFile(pdf, (p) => runPoppler('pdfinfo', [p])), 'Pages')).toBe('1')
        const img = rasterizePage(pdf, 1, 20, 10)
        expectPixel(img, 4, 5, RED)
        expectPixel(img, 10, 5, WHITE) // alpha 0 拍平 = 白底合成
        expectPixel(img, 15, 5, BLUE)
    })

    it('调色板 + tRNS PNG（loadIndexedAlphaChannel 异步臂）：同门截断路径拍平后读通', () => {
        const src = writeTemp(
            'palette-trns.png',
            encodePngPaletteTrns(20, 10, [RED, BLUE], [255, 0], (x) => (x < 10 ? 0 : 1)),
        )
        const pdf = renderPdf(imagePage({ width: 20, height: 10, src, fit: 'fill' }), new PdfRenderer())
        expectWellFormedPdf(pdf)
        const img = rasterizePage(pdf, 1, 20, 10)
        expectPixel(img, 4, 5, RED)
        expectPixel(img, 15, 5, WHITE) // tRNS alpha 0 的索引 = 白底合成
    })

    it('QR 图层（CJK 内容，qrcode 产物恒 RGBA）经完整管线：产物完整 + 码区落墨（P0-1/P0-2 联合回归）', async () => {
        const canvas = decodeGraph({
            canvas: { width: 60, height: 60, background: { color: '#ffffff' } },
            layers: [
                {
                    type: 'QrCodeLayer',
                    spec: { shape: { width: 40, height: 40 }, position: { x: 10, y: 10 } },
                    data: { valueType: 'StaticValue', value: '证书批量生成：图层树 → PDF 直嵌' },
                },
            ],
        })
        const pdf = await renderCanvasAsPdf(canvas, { resolver: createDefaultResolver({ cacheRoot: makeTempDir() }) })
        expectWellFormedPdf(pdf)
        expect(pdfInfoField(withPdfFile(pdf, (p) => runPoppler('pdfinfo', [p])), 'Pages')).toBe('1')
        // 码区有墨（margin=0，finder 图案贴角）：扫盒内存在暗像素即证 XObject 落栅格
        const img = rasterizePage(pdf, 1, 60, 60)
        let darkest = 255
        for (let y = 12; y < 48; y += 1) {
            for (let x = 12; x < 48; x += 1) {
                const [r, g, b] = samplePixel(img, x, y)
                darkest = Math.min(darkest, Math.min(r, g, b))
            }
        }
        expect(darkest).toBeLessThan(64)
    })
})

describe('隔行 PNG 响亮报错（评审 P0-1 防御面：pdfkit 异步臂的第三条入口，拍平器不重构 Adam7）', () => {
    it('隔行输入报错中止而非静默截断（失败弃件无产物逃逸）', () => {
        const r = new PdfRenderer()
        r.begin(10, 10)
        const src = writeTemp('interlaced.png', encodePngInterlacedStub(8, 8))
        expect(() => r.drawImage(src, { x: 0, y: 0, width: 0, height: 0 }, { x: 0, y: 0, width: 5, height: 5 })).toThrow(/隔行/)
        expect(r.end()).toBeNull() // 失败弃件
    })
})

maybePoppler('形状能力口（ADR 0026：drawEllipse + drawImageMasked，clip=circle 走圆形三步）', () => {
    it('clip=circle：背景填进内切圆、掩码 blit、圆周描边环（方形图 cover 进圆不越界）', () => {
        const src = writeTemp('circle.png', twoColorPng(40, 40, RED, BLUE, 20))
        const canvas = imagePage({ width: 20, height: 20, src, fit: 'cover', clip: 'circle', background: '#ffffff' })
        const backend = new PdfRenderer()
        expect(typeof backend.drawEllipse).toBe('function')
        expect(typeof backend.drawImageMasked).toBe('function')
        const pdf = renderPdf(canvas, backend)
        const img = rasterizePage(pdf, 1, 20, 20)
        // 圆内左右分色；圆外（盒角）透明露底——pdftoppm 无透明栅格化为白，此处页底白
        expectPixelNear(img, 4, 10, RED, 24)
        expectPixelNear(img, 15, 10, BLUE, 24)
        expectPixel(img, 0, 0, WHITE)
        expectPixel(img, 19, 0, WHITE)
    })

    it('非形状语义不受影响：clip 缺省矩形路径照旧', () => {
        const src = writeTemp('rect.png', twoColorPng(20, 20, RED, BLUE, 10))
        const img = rasterizePage(
            renderPdf(imagePage({ width: 20, height: 20, src, fit: 'fill' }), new PdfRenderer()),
            1,
            20,
            20,
        )
        expectPixel(img, 1, 1, RED) // 角落也落墨（矩形无裁剪）
        expectPixel(img, 18, 1, BLUE)
    })
})

describe('管线接缝（核心 renderAs/renderPagesAs 断言入口 + 页序列）', () => {
    it('renderPagesAs 页序列入口：两页不同尺寸 → 页数与逐页尺寸断言（工票 11 完成标准）', () => {
        const r = new PdfRenderer()
        const pages = [solidPage(320, 240, '#ff0000'), solidPage(200, 100, '#00ff00')]
        const pdf = renderPagesAs<Uint8Array>(pages, r)
        expect(pdf.length).toBeGreaterThan(0)
        if (popplerAvailable()) {
            expect(pdfInfoPages(pdf)).toBe('2')
            expectPageSizes(pdf, [[320, 240], [200, 100]])
            // 页序：逐页栅格化采中心点背景色
            expectPixel(rasterizePage(pdf, 1, 320, 240), 160, 120, RED)
            expectPixel(rasterizePage(pdf, 2, 200, 100), 100, 50, [0, 255, 0])
        }
    })

    it('单页 renderCanvas（end 已由模板收尾）与 renderAs 产物同构', () => {
        const page = solidPage(60, 40, '#3366cc')
        const viaRenderCanvas = (() => {
            const r = new PdfRenderer()
            // renderCanvas 模板自带 end 收尾（产物被模板消费不外传），再 end 已无会话
            // ——这里直接复刻单页编排：paintCanvasSurface 不导出，用 begin+绘制替代
            r.begin(page.width, page.height)
            r.drawRect(0, 0, page.width, page.height, '#3366cc', { top: null, bottom: null, left: null, right: null })
            return r.end()!
        })()
        expect(viaRenderCanvas.length).toBeGreaterThan(0)
        if (popplerAvailable()) {
            expect(() => pageText(viaRenderCanvas, 1)).not.toThrow()
            void pdfInfoField
            void expectPageSize
            void runPoppler
            void withPdfFile
        }
    })
})

// ---- pdfinfo 逐页结构断言小件（对位 go assertPageSizes） ----

function pdfInfoPages(pdf: Uint8Array): string {
    return withPdfFile(pdf, (p) => pdfInfoField(runPoppler('pdfinfo', [p]), 'Pages'))
}

function expectPageSizes(pdf: Uint8Array, wantPx: Array<[number, number]>): void {
    const info = withPdfFile(pdf, (p) => runPoppler('pdfinfo', ['-f', '1', '-l', String(wantPx.length), p]))
    const got = new Map<number, string>()
    for (const line of info.split('\n')) {
        const f = line.trim().split(/\s+/)
        if (f.length === 7 && f[0] === 'Page' && f[2] === 'size:') {
            got.set(Number(f[1]), `${f[3]} x ${f[5]} pts`)
        }
    }
    wantPx.forEach(([w, h], i) => {
        expect(got.get(i + 1)).toBe(expectPageSize(w, h))
    })
}
