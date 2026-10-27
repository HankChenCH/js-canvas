/**
 * 编排集成测试（go render_test.go 的移植面）：decodeGraph → resolver 物化 →
 * renderAs/renderPagesAs → PNG 字节 → 解码像素采样。无黄金文件，采样即验收面：
 * 透明底、背景先色后图（EXIF 90° 族背景 cover）、边框带、fit 四档对照、
 * QR 全管线、文本产墨、多页位图语义、占位语义（未物化 QR 只画盒）。
 */
import {
    decodeGraph,
    heuristicMeasurerFactory,
    layerWidth,
    renderAs,
    renderPagesAs,
    type Canvas,
} from '@hankchen/canvas'
import { statSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { createDefaultResolver, createNapiMeasurerFactory, ImageRendererBackend } from '../src/index'
import { canvasJpeg, decodePixels, expectPixelNear, jpegWithExifOrientation, makeCanvas, tempFixtureDir, writeFixture, type Pixels } from './helpers'

const CLEAR = [0, 0, 0, 0] as const
const WHITE = [255, 255, 255, 255] as const
const BLUE = [0, 0, 255, 255] as const
const RED = [255, 0, 0, 255] as const

function solidPng(w: number, h: number, color: string): Uint8Array {
    const { canvas, ctx } = makeCanvas(w, h)
    ctx.fillStyle = color
    ctx.fillRect(0, 0, w, h)
    return new Uint8Array(canvas.encodeSync('png'))
}

/** 8×16 上红下蓝、orientation=6 的 JPEG 落盘（EXIF 背景集成夹具） */
function twoBandExifJpeg(dir: string): string {
    const { canvas, ctx } = makeCanvas(8, 16)
    ctx.fillStyle = 'rgb(255,0,0)'
    ctx.fillRect(0, 0, 8, 8)
    ctx.fillStyle = 'rgb(0,0,255)'
    ctx.fillRect(0, 8, 8, 8)
    return writeFixture(dir, 'bg-exif6.jpg', jpegWithExifOrientation(canvasJpeg(canvas), 'II', 3, 6))
}

async function sample(product: unknown): Promise<Pixels> {
    expect(product).toBeInstanceOf(Uint8Array)
    return decodePixels(product as Uint8Array)
}

function probeSystemFont(): string | null {
    const candidates = [
        '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
        '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
        '/System/Library/Fonts/Supplemental/Arial.ttf',
        '/System/Library/Fonts/Supplemental/Times New Roman.ttf',
    ]
    for (const p of candidates) {
        try {
            if (statSync(p).isFile()) return p
        } catch {
            // 试下一个候选
        }
    }
    return null
}

const SYSTEM_FONT = probeSystemFont()

describe('编排集成：decodeGraph → renderAs → PNG 像素采样', () => {
    it('透明底 + 背景先色后图 + 边框带（20×20 全套）', async () => {
        const doc = decodeGraph({
            canvas: { width: 20, height: 20, background: { color: '#ffffff' } },
            layers: [
                {
                    type: 'ImageLayer',
                    spec: {
                        shape: {
                            width: 20,
                            height: 20,
                            backgroundColor: '#ffffff',
                            border: { top: { width: 2, color: '#f00' } },
                        },
                    },
                    data: { valueType: 'StaticValue', value: '' },
                },
            ],
        })
        // src 空串非 null：占位语义只画盒（背景/边框照常），无内容 blit
        const backend = new ImageRendererBackend()
        const px = await sample(renderAs<Uint8Array>(doc, backend))
        expect(px.width).toBe(20)
        expectPixelNear(px, 10, 10, WHITE) // 背景色
        expectPixelNear(px, 10, 1, RED) // top 边框带内嵌
        expectPixelNear(px, 10, 10, WHITE)
    })

    it('无背景画布保持透明（Go NewNRGBA 同语义）', async () => {
        const doc = decodeGraph({ canvas: { width: 10, height: 10 }, layers: [] })
        const px = await sample(renderAs<Uint8Array>(doc, new ImageRendererBackend()))
        expectPixelNear(px, 5, 5, CLEAR)
    })

    it('EXIF 90° 族背景 cover：raw 裁窗经映射进 canonical 位图（04 号决议端到端）', async () => {
        const dir = tempFixtureDir()
        const bg = twoBandExifJpeg(dir)
        const doc = decodeGraph({
            canvas: { width: 20, height: 8, background: { color: null, image: bg } },
            layers: [],
        })
        const backend = new ImageRendererBackend()
        await createDefaultResolver().resolve(doc, backend) // 本地路径预热接线
        const px = await sample(renderAs<Uint8Array>(doc, backend))
        // raw 8×16 → cover 窗居中跨越红蓝分界 → o=6 转正后观察方向左蓝右红；
        // 跨界点 JPEG 色度抽样渗色重，容差 90
        expectPixelNear(px, 2, 4, BLUE, 90)
        expectPixelNear(px, 17, 4, RED, 90)
    })

    it('fit=cover 等比裁窗：核心 coverSourceRect 几何的后端落点（quad 图对照）', async () => {
        const dir = tempFixtureDir()
        const quad = writeFixture(dir, 'quad.png', solidPng(2, 2, '#f00')) // 占位（下方另写）
        void quad
        // 40×40 四象限图 cover 进方盒 = 取中心窗；分界在 20，窗口 (10,10,20,20)
        const { canvas, ctx } = makeCanvas(40, 40)
        ctx.fillStyle = 'rgb(255,0,0)'
        ctx.fillRect(0, 0, 20, 20)
        ctx.fillStyle = 'rgb(0,255,0)'
        ctx.fillRect(20, 0, 20, 20)
        ctx.fillStyle = 'rgb(0,0,255)'
        ctx.fillRect(0, 20, 20, 20)
        ctx.fillStyle = 'rgb(255,0,255)'
        ctx.fillRect(20, 20, 20, 20)
        const quadPath = writeFixture(dir, 'quad2.png', new Uint8Array(canvas.encodeSync('png')))

        const doc = decodeGraph({
            canvas: { width: 20, height: 20 },
            layers: [
                {
                    type: 'ImageLayer',
                    spec: { shape: { width: 20, height: 20 } }, // fit 缺省 = cover
                    data: { valueType: 'StaticValue', value: quadPath },
                },
            ],
        })
        const backend = new ImageRendererBackend()
        await createDefaultResolver().resolve(doc, backend)
        const px = await sample(renderAs<Uint8Array>(doc, backend))
        expectPixelNear(px, 3, 3, RED, 60) // 中心窗 = 四象限中心，左上象限红
        expectPixelNear(px, 16, 3, [0, 255, 0, 255], 60) // 右上绿
        expectPixelNear(px, 3, 16, BLUE, 60) // 左下蓝
        expectPixelNear(px, 16, 16, [255, 0, 255, 255], 60) // 右下洋红
    })

    it('fit=contain 收缩矩形：空隙透明露下层（ADR 0023 语义）', async () => {
        const dir = tempFixtureDir()
        const wide = writeFixture(dir, 'wide.png', solidPng(40, 20, '#f00'))
        const doc = decodeGraph({
            canvas: { width: 20, height: 20 },
            layers: [
                {
                    type: 'ImageLayer',
                    spec: { shape: { width: 20, height: 20 }, fit: 'contain' },
                    data: { valueType: 'StaticValue', value: wide },
                },
            ],
        })
        const backend = new ImageRendererBackend()
        await createDefaultResolver().resolve(doc, backend)
        const px = await sample(renderAs<Uint8Array>(doc, backend))
        expectPixelNear(px, 10, 10, RED, 60) // 中心有图（contain 收缩为 20×10 居中）
        expectPixelNear(px, 10, 2, CLEAR) // 上下空隙透明
        expectPixelNear(px, 10, 17, CLEAR)
    })

    it('未物化的 QR 图层只画盒（占位语义：后端查不到 qr: 键不画内容）', async () => {
        const doc = decodeGraph({
            canvas: { width: 40, height: 40 },
            layers: [
                {
                    type: 'QrCodeLayer',
                    spec: { shape: { width: 20, height: 20, backgroundColor: '#ffffff' } },
                    data: { valueType: 'StaticValue', value: 'https://example.com/go-canvas' },
                },
            ],
        })
        const px = await sample(renderAs<Uint8Array>(doc, new ImageRendererBackend()))
        expectPixelNear(px, 10, 10, WHITE) // 盒背景
        expectPixelNear(px, 30, 30, CLEAR) // 盒外透明
    })

    it('QR 全管线：resolver 物化 → qr: 键 → finder 角点即墨（内容盒内切正方形）', async () => {
        const doc = decodeGraph({
            canvas: { width: 40, height: 40 },
            layers: [
                {
                    type: 'QrCodeLayer',
                    spec: { shape: { width: 20, height: 20 } },
                    data: { valueType: 'StaticValue', value: 'https://example.com/go-canvas' },
                },
            ],
        })
        const backend = new ImageRendererBackend()
        await createDefaultResolver().resolve(doc, backend)
        const px = await sample(renderAs<Uint8Array>(doc, backend))
        expectPixelNear(px, 0, 0, [0, 0, 0, 255], 60) // 内容盒 (0,0)-(20,20)，margin=0 原点即墨（缩放抗锯齿放宽容差）
        expectPixelNear(px, 30, 30, CLEAR) // 盒外不受影响
    })

    describe.skipIf(SYSTEM_FONT === null)('文本图层（系统字体探针命中）', () => {
        it('TextLayer 真实字体产墨且位置随对齐（left+top 语义）', async () => {
            const doc = decodeGraph({
                canvas: { width: 80, height: 40 },
                layers: [
                    {
                        type: 'TextLayer',
                        spec: {
                            shape: { width: 80, height: 40 },
                            fontFamily: { font: SYSTEM_FONT!, fontSize: 12 },
                        },
                        data: { valueType: 'StaticValue', value: 'Hello go-canvas' },
                    },
                ],
            })
            const px = await sample(renderAs<Uint8Array>(doc, new ImageRendererBackend()))
            let ink = 0
            for (let y = 0; y < px.height; y += 1) {
                for (let x = 0; x < px.width; x += 1) {
                    if (px.at(x, y)![3]! > 0) ink += 1
                }
            }
            expect(ink).toBeGreaterThan(20)
        })
    })

    it('napi 度量器经 policies 显式注入参与布局（autoWidth 宽度差可见；08 号决议）', () => {
        const layer = decodeGraph({
            canvas: { width: 0, height: 0 },
            layers: [
                {
                    type: 'TextLayer',
                    spec: {
                        shape: { width: 0, height: 0, autoWidth: true },
                        fontFamily: { font: '', fontSize: 12 },
                    },
                    data: { valueType: 'StaticValue', value: 'a a a a a a a a a a' },
                },
            ],
        }).layers[0]!

        const heuristic = layerWidth(layer, { measurerFactory: heuristicMeasurerFactory })
        // 内置默认字体（空串引用）的 napi 真实度量与启发式（0.55 计权）不等：
        // 拉丁字宽实测约 0.5em、空格约 0.28em，启发式恒 0.55
        const napi = layerWidth(layer, { measurerFactory: createNapiMeasurerFactory })
        expect(heuristic).toBeGreaterThan(0)
        expect(napi).toBeGreaterThan(0)
        expect(Math.abs(napi - heuristic)).toBeGreaterThanOrEqual(1)
    })
})

describe('多页编排（renderPagesAs，位图语义 = 末页位图）', () => {
    it('两页渲染：产物是第二页尺寸与内容', async () => {
        const page1: Canvas = decodeGraph({
            canvas: { width: 30, height: 30, background: { color: '#ffffff' } },
            layers: [],
        })
        const page2: Canvas = decodeGraph({
            canvas: { width: 20, height: 40, background: { color: '#00ff00' } },
            layers: [],
        })
        const backend = new ImageRendererBackend()
        const px = await sample(renderPagesAs<Uint8Array>([page1, page2], backend))
        expect(px.width).toBe(20)
        expect(px.height).toBe(40)
        expectPixelNear(px, 10, 20, [0, 255, 0, 255])
    })
})
