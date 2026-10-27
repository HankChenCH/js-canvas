/**
 * 文本绘制原语（对位 go-canvas/image-renderer/text.go）：单行、对齐锚点落笔、
 * 角度旋转。(x, y) 为对齐语义锚点——水平按真实文本宽度（ctx.measureText.width，
 * 与落笔同一度量路径，对位 go MeasureString）对齐；垂直用字盒基线差把基线落到
 * 锚点语义对应位置；布局层只返回纯对齐锚点，字体基线差统一在渲染端消化
 * （08 号决议分层纪律：原语层永远真实字体绘制）。
 *
 * 基线换算（关键缝，实测钉死见 typography.ts docblock）：canvas 的
 * fontBoundingBoxAscent/Descent 与 go x/image Metrics 的 Ascent/Descent 同号
 * 同义（正值、基线距字盒顶/底），go 的三条基线公式逐条平移——
 * top（含未知值缺省臂）: baseline = y + ascent
 * center: baseline = y + (ascent - descent) / 2
 * bottom: baseline = y - descent
 *
 * 角度：单位度，正值逆时针（GD 惯例）。路径对位 go drawRotatedText——离屏
 * 渲染后绕锚点旋转移到渲染面；canvas transform 矩阵与 go f64.Aff3 同式
 * （[[cos,sin],[-sin,cos]]，y 轴向下的视觉逆时针）。
 */
import { createCanvas, type SKRSContext2D } from '@napi-rs/canvas'
import type { TextDrawOptions } from '@hankchen/canvas'

import { cssColor, parseColor } from './color'
import { loadFontFamily } from './typography'

/** napi measureText 返回面（d.ts 内部接口未导出，经方法返回类型取） */
type TextMetricsLike = ReturnType<SKRSContext2D['measureText']>

/** 基线相对锚点的垂直偏移（go DrawText verticalAlign 三臂同式平移） */
function baselineOffset(metrics: TextMetricsLike, verticalAlign: string): number {
    const ascent = metrics.fontBoundingBoxAscent ?? metrics.actualBoundingBoxAscent
    const descent = metrics.fontBoundingBoxDescent ?? metrics.actualBoundingBoxDescent
    switch (verticalAlign) {
        case 'center':
            return (ascent - descent) / 2
        case 'bottom':
            return -descent
        default:
            return ascent // top 与未知值缺省臂（对位 go switch default）
    }
}

/** 笔起点相对锚点的水平偏移（go DrawText horizontalAlign 三臂同式平移） */
function penOffset(width: number, horizontalAlign: string): number {
    switch (horizontalAlign) {
        case 'center':
            return -width / 2
        case 'right':
            return -width
        default:
            return 0 // left 与未知值缺省臂
    }
}

/**
 * 在渲染面上绘制单行文本。空行零副作用（PHP 同款空串守卫）；字色解析失败
 * wrap「解析字色」上抛中止；字体装配失败（缺文件/TTC 拒收）上抛中止
 */
export function drawTextLine(ctx: SKRSContext2D, line: string, x: number, y: number, options: TextDrawOptions): void {
    if (line === '') {
        return
    }
    let fill: string
    try {
        fill = cssColor(parseColor(options.fontColor))
    } catch (error) {
        throw new Error(`解析字色: ${(error as Error).message}`)
    }

    const family = loadFontFamily(options.font)
    // 裸字面（别名 ncv-hex / sans-serif 均 CSS 安全）；带引号会按字面族名解析、
    // 回退到不可控的默认字体（实测 1.0.13）
    const shorthand = `${options.fontSize}px ${family}`
    ctx.font = shorthand
    ctx.textAlign = 'left' // 对齐偏移自算，免疫共享 ctx 的残留状态
    ctx.textBaseline = 'alphabetic'

    const metrics = ctx.measureText(line)
    const width = metrics.width
    const penX = penOffset(width, options.horizontalAlign)
    const baselineY = baselineOffset(metrics, options.verticalAlign)

    if (options.angle === 0) {
        ctx.fillStyle = fill
        ctx.fillText(line, x + penX, y + baselineY)
        return
    }

    drawRotatedText(ctx, line, fill, shorthand, metrics, x, y, options.angle, penX, baselineY)
}

/**
 * 角度支持（对位 go drawRotatedText）：文本先离屏渲染，再绕锚点 (x, y) 旋转
 * 合成到渲染面。离屏盒宽 = 文本宽向上取整、高 = 字盒高（ascent+descent），
 * 四周留白 margin = 2 + ceil(盒高/16)——字形可越出 em box，留白随字面高度比例
 * 放宽、下限 2px 兜底小字号（go 同式）。
 * 锚点在离屏中的位置 = 离屏笔起点 - (笔偏移, 基线偏移)；仿射矩阵按
 * 「源坐标 → 目标坐标」：dest = R(θ)·(src - 锚点离屏) + 锚点渲染面，经
 * translate(锚点) + transform(R, -锚点离屏) 合成（与 go f64.Aff3 展开式逐项等价）
 */
function drawRotatedText(
    ctx: SKRSContext2D,
    line: string,
    fill: string,
    shorthand: string,
    metrics: TextMetricsLike,
    x: number,
    y: number,
    angle: number,
    penX: number,
    baselineY: number,
): void {
    const ascent = metrics.fontBoundingBoxAscent ?? metrics.actualBoundingBoxAscent
    const descent = metrics.fontBoundingBoxDescent ?? metrics.actualBoundingBoxDescent
    const boxHeight = ascent + descent

    const margin = 2 + Math.ceil(boxHeight / 16)
    const offscreen = createCanvas(Math.ceil(metrics.width) + 2 * margin, Math.ceil(boxHeight) + 2 * margin)
    const offCtx = offscreen.getContext('2d')
    offCtx.font = shorthand
    offCtx.fillStyle = fill
    offCtx.textAlign = 'left'
    offCtx.textBaseline = 'alphabetic'
    offCtx.fillText(line, margin, margin + ascent)

    const ax = margin - penX
    const ay = margin + ascent - baselineY
    const rad = (angle * Math.PI) / 180
    const cos = Math.cos(rad)
    const sin = Math.sin(rad)

    ctx.save()
    ctx.translate(x, y)
    // canvas transform(a,b,c,d,e,f)：x' = a·x + c·y + e, y' = b·x + d·y + f；
    // (a,b,c,d) = (cos,-sin,sin,cos) 即视觉逆时针旋转阵（y 轴向下坐标系）
    ctx.transform(cos, -sin, sin, cos, -ax, -ay)
    ctx.drawImage(offscreen, 0, 0)
    ctx.restore()
}
