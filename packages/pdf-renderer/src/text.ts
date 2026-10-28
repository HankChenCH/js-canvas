/**
 * 文本绘制原语（对位 go pdf-renderer/text.go DrawText/addUTF8Font）：TTF 子集内嵌
 * （pdfkit/fontkit 默认 Identity-H 子集，CJK 门槛）+ 对齐锚点落笔 + 角度旋转。
 * (x, y) 为对齐语义锚点——水平按实测文本宽度（widthOfString，与落笔 Tj 同一度量
 * 路径）偏移，垂直用字体 metrics（per-1000 归一）把基线落到锚点语义对应位置；布局层
 * 只返回纯对齐锚点，字体基线差统一在渲染端消化（ADR-0003）。内置默认字体兜底 =
 * PDF 核心字体 Helvetica（ASCII-only，语义对齐位图后端 basicfont：ASCII 可渲、CJK
 * 必须真实字体文件）。
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

import type { TextDrawOptions } from '@hankchen/canvas'

import { parseColor } from './color'
import { PX_TO_PT } from './image'
import { isRemoteURL, isNumeric } from './url'

/** pdfkit 文档类型（@types/pdfkit 全局命名空间） */
type PdfDoc = PDFKit.PDFDocument

/**
 * helvetica 标准 14 字体的度量（Adobe Helvetica AFM:Ascender 718 / Descender -207,
 * per-1000）。核心字体不走 TTF 解析，度量是 PDF 标准字体规范值而非实现细节——与
 * pdfkit 内置 AFM 数据同源（实测 doc._font.ascender = 718），仍以常量持有对位 go
 * text.go 的显式常量，度量口径不依赖库内面
 */
const HELVETICA_ASCENT_PER_EM = 718
const HELVETICA_DESCENT_PER_EM = -207

/**
 * drawTextLine 单行文本落笔：空行零副作用（PHP 同款空串守卫）；字号 px→pt ×0.75，
 * sizePt ≤0 报错；水平对齐偏移 = 实测文本宽度 × 对齐语义；垂直基线 = 锚点 + metrics
 * 偏移（top: +ascent / center: +(ascent+descent)/2 / bottom: -descent，descent 为负，
 * 未知取值归 top——go text.go 同一公式）。角度为度，正值逆时针绕锚点（GD 惯例；
 * pdfkit rotate 正值 = 顺时针视觉，取负对位 go TransformRotate 的逆时针语义——
 * 底座坐标系差异同 placeMatrix）。
 *
 * **对齐偏移不二次换算**：penX/baselineY 已由实测宽度/metrics 以 pt 计，只有锚点
 * tx/ty 乘 PX_TO_PT——两者相加后再乘系数会把对齐整体缩水 0.75（go 曾踩：右对齐
 * 墨迹越锚 7px）
 */
export function drawTextLine(
    doc: PdfDoc,
    fonts: Map<string, string>,
    fontData: Map<string, Uint8Array>,
    line: string,
    x: number,
    y: number,
    options: TextDrawOptions,
): void {
    if (line === '') {
        return
    }
    const c = parseColor(options.fontColor) // 失败即抛（失败即抛纪律：解析字色失败中止）

    const sizePt = options.fontSize * PX_TO_PT
    if (sizePt <= 0) {
        throw new Error(`字号非法: ${options.fontSize}`)
    }

    // 字体分派：空串/纯数字 = 内置默认字体语义 → 核心字体 Helvetica（ASCII-only 兜底）；
    // 其余按物化引用 TTF 子集内嵌（CJK 硬门槛）
    let ascentPt: number
    let descentPt: number
    if (options.font === '' || isNumeric(options.font)) {
        doc.font('Helvetica').fontSize(sizePt)
        ascentPt = (HELVETICA_ASCENT_PER_EM / 1000) * sizePt
        descentPt = (HELVETICA_DESCENT_PER_EM / 1000) * sizePt
    } else {
        const family = ensureFontFamily(doc, fonts, fontData, options.font)
        doc.font(family).fontSize(sizePt)
        // doc._font.ascender/descender：per-1000 归一度量（AFM 核心字体 718/-207；
        // TTF 内嵌字体经 fontkit hhea 解析归一，实测 2189/2048×1000 = 1068.85 同式），
        // 与 go GetFontDesc 的 per-1000 口径一致
        const font = (doc as unknown as { _font: { ascender: number; descender: number } })._font
        ascentPt = (font.ascender / 1000) * sizePt
        descentPt = (font.descender / 1000) * sizePt
    }

    // 水平：笔起点相对锚点的偏移（left: 0 / center: -宽一半 / right: -宽；
    // widthOfString 与落笔同一度量路径）
    const widthPt = doc.widthOfString(line)
    let penX = 0
    switch (options.horizontalAlign) {
        case 'center':
            penX = -widthPt / 2
            break
        case 'right':
            penX = -widthPt
            break
        default:
            penX = 0 // left 及未知取值（解码已收口，此处锁纯函数自身）
    }

    // 垂直：基线相对锚点的偏移，由字体 metrics 消化基线差（ADR-0003）；未知取值归 top
    let baselineY = ascentPt
    switch (options.verticalAlign) {
        case 'center':
            baselineY = (ascentPt + descentPt) / 2
            break
        case 'bottom':
            baselineY = -descentPt // descent 为负：抬起一个 descent 量
            break
        default:
            baselineY = ascentPt
    }

    // 锚点 px→pt；对齐偏移（penX/baselineY）已以 pt 计，不再乘换算系数
    const tx = x * PX_TO_PT + penX
    const ty = y * PX_TO_PT + baselineY

    doc.fillOpacity(c.a / 255)
    doc.fillColor(rgbHex(c))
    // baseline:'alphabetic' 显式声明——pdfkit 缺省 baseline 是 'top'（y = ascent 盒顶，
    // dy = ascender，源码 4497-4520 行实证），显式声明后 y 即基线，go 公式逐项成立
    const textOptions = { lineBreak: false, baseline: 'alphabetic' } as const
    if (options.angle === 0) {
        doc.text(line, tx, ty, textOptions)
    } else {
        // 正值逆时针绕锚点旋转：pdfkit 翻转用户空间里 rotate 正值 = 顺时针视觉，
        // 取负对位 go TransformRotate（逆时针）；对齐偏移随落笔点一起绕锚点旋转
        doc.save()
        doc.rotate(-options.angle, { origin: [x * PX_TO_PT, y * PX_TO_PT] })
        doc.text(line, tx, ty, textOptions)
        doc.restore()
    }
    doc.fillOpacity(1)
}

/**
 * ensureFontFamily 注册 TTF 子集内嵌字体，返回合成字体族名（会话缓存：同一路径只
 * 读盘/注册一次；pdfkit 按字体键去重，整文档同一字体只嵌一份子集）。
 *
 * 族名 = "f" + 引用键 sha256 前 16 位 hex——**不得用原始路径/URL**：族名会写进
 * PDF Name 对象（/BaseFont），其中的 "/" 与空格破坏字典解析（poppler 报
 * "Dictionary key must be a name object" 且字体面整体降级；go text.go 同款防线）。
 *
 * 字节来源：登记表（registerFontData 缝，远程字体经 resolver 物化）优先，本地路径
 * 同步读盘；远程引用未登记报物化缺失（对位 go os.ReadFile 失败即错）。
 * TTC/OTC 字体集显式拒收（魔数嗅探 fail-fast）：fontkit 认 ttcf 并静默取首面，与
 * 05 号决议「node 两后端统一 TTC 不可用」相悖，必须先拦；垃圾字体字节由 fontkit
 * 解析抛错兜底（解析失败的字节缓存不得入册）
 */
function ensureFontFamily(doc: PdfDoc, fonts: Map<string, string>, fontData: Map<string, Uint8Array>, fontFile: string): string {
    const cached = fonts.get(fontFile)
    if (cached !== undefined) {
        return cached // 本会话已注册
    }

    let data: Uint8Array
    const registered = fontData.get(fontFile)
    if (registered !== undefined) {
        data = registered
    } else if (isRemoteURL(fontFile)) {
        throw new Error(`读取字体 ${fontFile}: 远程引用未物化——应经 ResourceResolver 物化后经 registerFontData 登记`)
    } else {
        try {
            data = new Uint8Array(readFileSync(fontFile))
        } catch (err) {
            throw new Error(`读取字体 ${fontFile}: ${(err as Error).message}`)
        }
    }

    if (data.length >= 4 && latin1(data.subarray(0, 4)) === 'ttcf') {
        throw new Error(`字体 ${fontFile} 为 TTC/OTC 字体集:PDF 子集内嵌仅支持单体 TTF`)
    }

    const family = `f${createHash('sha256').update(fontFile, 'utf8').digest('hex').slice(0, 16)}`
    try {
        doc.registerFont(family, Buffer.from(data.buffer, data.byteOffset, data.byteLength))
        // pdfkit 0.20 registerFont 惰性存 src（fontkit.create 在 doc.font(name) 才发生，
        // 源码 3759 行实证）——垃圾字节在此刻才抛，注册后强制选装一次完成解析校验，
        // 解析失败的字节缓存不得入册（go GetFontDesc 非零校验同门）
        doc.font(family)
    } catch (err) {
        throw new Error(`注册字体 ${fontFile}: 字体解析失败(TTF 格式不合法或为不支持的变体): ${(err as Error).message}`)
    }
    fonts.set(fontFile, family)
    return family
}

function latin1(data: Uint8Array): string {
    let out = ''
    for (const byte of data) {
        out += String.fromCharCode(byte)
    }
    return out
}

/** rgbHex rgba → pdfkit 颜色串（与 backend 同式；独立小件避免循环 import） */
function rgbHex(c: { r: number; g: number; b: number }): string {
    const hex = (v: number) => v.toString(16).padStart(2, '0')
    return `#${hex(c.r)}${hex(c.g)}${hex(c.b)}`
}
