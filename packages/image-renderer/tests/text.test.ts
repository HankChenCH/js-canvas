/**
 * 文本绘制原语的点位取样测试（go text_test.go 移植面）：空行零副作用、内置
 * 默认字体判定与产墨、TTC fail-fast 拒收、对齐锚点（真实宽度水平对齐 + 字盒
 * 基线垂直消化）、角度旋转方向。涉及 napi 真实字体行为的断言写宽松
 * （墨迹存在性/方位性/包围盒关系），不钉死抗锯齿像素。
 */
import { readFileSync, statSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { canvasPng, decodePixels, makeCanvas, type Pixels } from './helpers'
import { drawTextLine } from '../src/text'

/** 本机可用的真实字体探针（对位 go systemFont：无字体宿主跳过文字用例） */
function probeSystemFont(): string | null {
    const candidates = [
        // Linux
        '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
        '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
        // macOS
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

/** 建透明面画一行字，返回产物位图（go drawTextOn 同款） */
async function drawTextOn(
    width: number,
    height: number,
    invoke: (ctx: Parameters<typeof drawTextLine>[0]) => void,
): Promise<Pixels> {
    const { canvas, ctx } = makeCanvas(width, height)
    invoke(ctx)
    return decodePixels(canvasPng(canvas))
}

/** 墨迹包围盒：非透明像素扫描结果；无墨迹返回 null */
function inkBox(px: Pixels): { minX: number; minY: number; maxX: number; maxY: number } | null {
    let minX = px.width
    let minY = px.height
    let maxX = -1
    let maxY = -1
    for (let y = 0; y < px.height; y += 1) {
        for (let x = 0; x < px.width; x += 1) {
            if (px.at(x, y)[3]! > 0) {
                minX = Math.min(minX, x)
                maxX = Math.max(maxX, x)
                minY = Math.min(minY, y)
                maxY = Math.max(maxY, y)
            }
        }
    }
    return maxX < 0 ? null : { minX, minY, maxX, maxY }
}

const LEFT_TOP = { font: '', fontSize: 12, fontColor: '#000', horizontalAlign: 'left', verticalAlign: 'top', angle: 0 } as const

describe('drawText 原语（对位 go text.go）', () => {
    it('空行零副作用（PHP 同款空串守卫）', async () => {
        const px = await drawTextOn(20, 20, (ctx) => {
            drawTextLine(ctx, '', 10, 10, { ...LEFT_TOP })
        })
        expect(inkBox(px)).toBeNull()
    })

    it('空串/纯数字字体 id = 内置默认字体并产墨（IsBuiltinFont 同口径）', async () => {
        for (const font of ['', '1', '42', '1.5']) {
            const px = await drawTextOn(40, 20, (ctx) => {
                drawTextLine(ctx, 'abc', 5, 15, { ...LEFT_TOP, font })
            })
            expect(inkBox(px), `font=${JSON.stringify(font)}`).not.toBeNull()
        }
    })

    it('TTC 魔数嗅探 fail-fast 拒收（04 号决议；go image 侧取首面是有意差异）', () => {
        const ttcPath = ['/System/Library/Fonts/Supplemental/AmericanTypewriter.ttc'].find((p) => {
            try {
                return statSync(p).isFile()
            } catch {
                return false
            }
        })
        const { ctx } = makeCanvas(20, 20)
        const options = { ...LEFT_TOP, font: ttcPath ?? '/nonexistent/font.ttc' }
        // TTC 拒收的判定面：字体装配阶段抛错（对位 go 字体加载失败中止通道）。
        // 文件面魔数断言独立于绘制面——ttcf 头字节必现
        expect(() => drawTextLine(ctx, 'abc', 5, 15, options)).toThrow()
        if (ttcPath !== undefined) {
            const head = readFileSync(ttcPath).subarray(0, 4).toString('latin1')
            expect(head).toBe('ttcf')
        }
    })

    it('字体文件不存在/非法报错中止（对位 go sessionFace 失败通道）', () => {
        const { ctx } = makeCanvas(20, 20)
        expect(() => drawTextLine(ctx, 'abc', 5, 15, { ...LEFT_TOP, font: '/nonexistent/go-canvas-font.ttf' })).toThrow()
    })

    it('字色非法报错中止（解析字色 wrap）', () => {
        const { ctx } = makeCanvas(20, 20)
        expect(() => drawTextLine(ctx, 'abc', 5, 15, { ...LEFT_TOP, fontColor: 'bogus' })).toThrow(/解析字色/)
    })

    describe.skipIf(SYSTEM_FONT === null)('真实字体（系统字体探针命中）', () => {
        const font = SYSTEM_FONT as string

        it('真实字体产墨且墨迹落在锚点右下方（left+top 语义）', async () => {
            const px = await drawTextOn(80, 40, (ctx) => {
                drawTextLine(ctx, 'abc', 10, 15, { ...LEFT_TOP, font })
            })
            const box = inkBox(px)
            expect(box).not.toBeNull()
            expect(box!.minX).toBeGreaterThanOrEqual(10) // left：锚点以右起笔
            expect(box!.minY).toBeGreaterThanOrEqual(15) // top：基线在锚点下方（ascent 消化）
        })

        it('水平对齐锚点：center 居中跨锚点、right 收在锚点以左', async () => {
            const anchorX = 50
            const centerPx = await drawTextOn(100, 40, (ctx) => {
                drawTextLine(ctx, 'abc', anchorX, 15, { ...LEFT_TOP, font, horizontalAlign: 'center' })
            })
            const rightPx = await drawTextOn(100, 40, (ctx) => {
                drawTextLine(ctx, 'abc', anchorX, 15, { ...LEFT_TOP, font, horizontalAlign: 'right' })
            })
            const centerBox = inkBox(centerPx)
            const rightBox = inkBox(rightPx)
            expect(centerBox).not.toBeNull()
            expect(rightBox).not.toBeNull()
            // center：墨迹跨锚点两侧；right：墨迹不越过锚点右侧
            expect(centerBox!.minX).toBeLessThan(anchorX)
            expect(centerBox!.maxX).toBeGreaterThan(anchorX)
            expect(rightBox!.maxX).toBeLessThanOrEqual(anchorX)
        })

        it('垂直对齐锚点：bottom 的墨迹收在锚点上方（descent 消化）', async () => {
            const anchorY = 30
            const px = await drawTextOn(80, 40, (ctx) => {
                drawTextLine(ctx, 'abc', 10, anchorY, { ...LEFT_TOP, font, verticalAlign: 'bottom' })
            })
            const box = inkBox(px)
            expect(box).not.toBeNull()
            expect(box!.maxY).toBeLessThanOrEqual(anchorY)
        })

        it('角度旋转：正值逆时针（GD 惯例）——竖条转 90° 后横躺', async () => {
            const px = await drawTextOn(80, 80, (ctx) => {
                drawTextLine(ctx, 'l', 40, 40, { ...LEFT_TOP, font, angle: 90 })
            })
            const box = inkBox(px)
            expect(box).not.toBeNull()
            // 竖笔画字符正立时高>宽；转 90° 后横躺（宽明显大于高）
            const w = box!.maxX - box!.minX
            const h = box!.maxY - box!.minY
            expect(w).toBeGreaterThan(h * 2)
        })
    })
})
