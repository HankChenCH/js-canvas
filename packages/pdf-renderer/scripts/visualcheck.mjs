/**
 * 目验样张脚本（工票 12，对位 go-canvas/pdf-renderer/cmd/visualcheck）：一条命令
 * 渲染多页综合样张 PDF；poppler 在场时顺带 pdftoppm -r 96 栅格化 PNG 预览（缺席
 * 只出 .pdf 不报错，go 同款纪律）。像素取样、结构断言之外的人眼验收面（07 号决议）。
 *
 * 页 1（400×310，元素几何逐项复刻 go 版 buildSample）：
 *  - 头图色块 400×90 #2d6cdf + 白字标题 24px 双居中（画布白底先色后图层）；
 *  - PNG 直嵌条带 200×50 @(20,110)（左红右蓝程序生成，JPEG/PNG 直嵌零重编码路径）；
 *  - 黄底 + 四边异色 3px 边框盒 120×50 @(240,110)（#409eff/#67c23a/#e6a23c/#f56c6c
 *    ——盒内嵌色带目验、后画覆盖先画序可见）；
 *  - 二维码 80×80 @(300,180)（扫码可得仓址）；
 *  - CJK 左上对齐文本（有 CJK 单体 TTF 时才加）+ ASCII 文本（px→pt 口径说明字样）；
 *  - 90° 逆时针旋转文本（20×120 盒 @(385,300)，角度标定与 go 同式）；
 *  - 表格一行两列 auto 行高 @(20,260)（单元格下钻 + 边框）。
 * 页 2（300×200）：不同底色 + 标记文本 + 色块——多页续页语义（逐页独立 MediaBox）
 * 的人眼面（工票 12 增补：node 版样张为多页，go 版单页）。
 *
 * 对 go 版的有意差异（工票 12 报告记档）：
 *  - 品牌字样/二维码内容改写为 js-canvas（go docs 双端对照纪律：布局级一致、像素不求等）。
 *
 * 字体探针纪律（对位 go pickFont 的 node 收紧版）：候选只认单体 TTF（PDF 子集内嵌
 * 不支持 TTC 字体集；node 侧两后端统一 fail-fast 拒收 TTC，go pdf 侧的「非 ttcf
 * 魔数」判据在 node 升级为渲染端同入口试渲染）；判据 =「存在且可加载」——探针用
 * 渲染端同一管线（PdfRenderer + 核心编排渲染一枚迷你文本样张）真实走 registerFont
 * → 子集内嵌全程，解析失败在探针期即暴露，不留到渲染中段。JS_CANVAS_VISUAL_FONT
 * 环境变量可覆写候选（对位 GO_CANVAS_VISUAL_FONT）。全缺降级 Helvetica 只排 ASCII
 * 并 stderr 响亮提示（go 同款：pdf 有核心字体兜底可渲，与 image 侧「全缺报错」
 * 分工不同——中文位置以 CJK 图层缺席呈现）。
 *
 * 用法：node scripts/visualcheck.mjs [输出基名]
 *   缺省 <包根>/visualcheck-output/visual-check → visual-check.pdf + visual-check-1.png
 *   等逐页预览（已 gitignore；对位 go make visual-check 产物 pdf-renderer/visual-check.*）。
 * 消费面：workspace 已构建 dist（先 pnpm -r build）经 node_modules 依赖解析，
 * 与真实消费方同一条 exports 入口。
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync, inflateSync } from 'node:zlib'

import { decodeGraph, renderAs } from '@hankchen/canvas'
import { createDefaultResolver, PdfRenderer, QrCodeMaterializer, renderPagesAsPdf } from '@hankchen/canvas-pdf-renderer'

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** CJK 字体候选（单体 TTF；go pdf 版候选列表原样平移——它本就只认单体 TTF）：
 *  - ipag.ttf 两个发行路径（Linux apt fonts-ipafont-gothic，CI ubuntu 显式安装）；
 *  - macOS 自带 Arial Unicode（单体 TTF 含 CJK）。 */
const FONT_CANDIDATES = [
    '/usr/share/fonts/truetype/fonts-ipafont-gothic/ipag.ttf',
    '/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf',
    '/System/Library/Fonts/Supplemental/Arial Unicode.ttf',
]

/**
 * pickFont 取首个「存在且可加载」候选：探针 = 渲染端同一管线渲染迷你文本样张
 * （40×20 一行 14px 文本；PdfRenderer.drawText 的本地路径直读 → TTC 拒收 →
 * pdfkit/fontkit 解析注册 → 子集内嵌全程实弹）。全缺返回空串降级 Helvetica
 * （ASCII 可渲、CJK 缺字形），落选原因逐条 stderr 列明——降级响亮不静默
 */
function pickFont(candidates) {
    const override = process.env.JS_CANVAS_VISUAL_FONT
    // env 覆写为绝对替换（对位 go GO_CANVAS_VISUAL_FONT：失手不回落系统候选）
    const list = override ? [override] : candidates
    const tried = []
    for (const c of list) {
        try {
            probeRenderable(c)
            return c
        } catch (error) {
            tried.push(`  - ${c}(${error.message})`)
        }
    }
    process.stderr.write(`visual-check: 未找到可用的 CJK 单体 TTF，降级 Helvetica 只排 ASCII（中文图层缺席）；可设 JS_CANVAS_VISUAL_FONT 指向单体 .ttf。已依次检查：\n${tried.join('\n')}\n`)
    return ''
}

/** 迷你文本样张试渲染（「存在且可加载」判据的渲染端同入口实现） */
function probeRenderable(font) {
    const probe = decodeGraph({
        canvas: { width: 40, height: 20 },
        layers: [
            {
                type: 'TextLayer',
                spec: {
                    shape: { width: 40, height: 20 },
                    fontFamily: { font, fontSize: 14, fontColor: '#000000' },
                    align: { horizontal: 'left', vertical: 'top' },
                    position: { x: 0, y: 0 },
                },
                data: { valueType: 'StaticValue', value: 'probe 测' },
            },
        ],
    })
    renderAs(probe, createBareBackend())
}

/** 裸后端（不带默认物化器：探针资源全为本地路径，无物化需求） */
function createBareBackend() {
    return new PdfRenderer()
}

// ---- wire 图层构造辅助（与 image 侧脚本同式；wire 形态见核心 decode.ts） ----

/** 文本层 */
function textLayer({ text, font, fontSize, fontColor, x, y, width, height, autoHeight = false, backgroundColor = null, padding = null, border = null, align = null, autowrap = false, angle = 0, priority = 4 }) {
    const shape = { width, height, autoHeight }
    if (backgroundColor !== null) shape.backgroundColor = backgroundColor
    if (padding !== null) shape.padding = { top: padding, right: padding, bottom: padding, left: padding }
    if (border !== null) shape.border = { top: border, bottom: border, left: border, right: border }
    const layer = {
        type: 'TextLayer',
        priority,
        spec: {
            shape,
            fontFamily: { font, fontSize, fontColor, angle, autowrap },
        },
        data: { valueType: 'StaticValue', value: text },
    }
    if (align !== null) layer.spec.align = { horizontal: align[0], vertical: align[1] }
    layer.spec.position = { x, y }
    return layer
}

/** 图层盒（色块/条带/边框盒/二维码共用的最小 ImageLayer/QrCodeLayer 构造） */
function boxLayer(type, { x, y, width, height, backgroundColor = null, border = null, priority = 4, value = null }) {
    const shape = { width, height }
    if (backgroundColor !== null) shape.backgroundColor = backgroundColor
    if (border !== null) shape.border = border
    const layer = { type, priority, spec: { shape, position: { x, y } } }
    if (value !== null) layer.data = { valueType: 'StaticValue', value }
    return layer
}

/** 双色条带 PNG（左红右蓝，200×50）：最小 PNG 编码器手拼（8 位 RGB、filter 0，
 *  同式复制自 pdf-renderer tests/helpers.ts encodePng——脚本不引测试文件，零新增依赖） */
function twoBandPng() {
    const width = 200
    const height = 50
    const crcTable = (() => {
        const table = new Array(256)
        for (let n = 0; n < 256; n += 1) {
            let c = n
            for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
            table[n] = c >>> 0
        }
        return table
    })()
    const crc32 = (buf) => {
        let crc = 0xffffffff
        for (const byte of buf) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff]
        return (crc ^ 0xffffffff) >>> 0
    }
    const chunk = (type, data) => {
        const len = Buffer.alloc(4)
        len.writeUInt32BE(data.length)
        const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
        const crc = Buffer.alloc(4)
        crc.writeUInt32BE(crc32(body))
        return Buffer.concat([len, body, crc])
    }
    const ihdr = Buffer.alloc(13)
    ihdr.writeUInt32BE(width, 0)
    ihdr.writeUInt32BE(height, 4)
    ihdr[8] = 8 // bit depth
    ihdr[9] = 2 // color type RGB
    const raw = Buffer.alloc(height * (1 + width * 3))
    for (let y = 0; y < height; y += 1) {
        const row = y * (1 + width * 3)
        raw[row] = 0 // filter none
        for (let x = 0; x < width; x += 1) {
            const [r, g, b] = x < 100 ? [0xff, 0, 0] : [0, 0, 0xff]
            const o = row + 1 + x * 3
            raw[o] = r
            raw[o + 1] = g
            raw[o + 2] = b
        }
    }
    const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    return new Uint8Array(Buffer.concat([signature, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]))
}

/** 页 1 wire（几何逐项对位 go buildSample；品牌字样改写） */
function buildPage1(font, stripPath) {
    const header = boxLayer('ImageLayer', { x: 0, y: 0, width: 400, height: 90, backgroundColor: '#2d6cdf', priority: 10 })
    const layers = [header]

    layers.push(textLayer({
        text: 'js-canvas PDF 目验样张',
        font,
        fontSize: 24,
        fontColor: '#ffffff',
        x: 0, y: 0, width: 400, height: 90,
        align: ['center', 'center'],
        priority: 5,
    }))

    // PNG 直嵌条带（左红右蓝）
    layers.push(boxLayer('ImageLayer', { x: 20, y: 110, width: 200, height: 50, backgroundColor: '#ffffff', value: stripPath }))

    // 黄底 + 四边异色 3px 边框盒（盒内嵌色带目验）
    layers.push(boxLayer('ImageLayer', {
        x: 240, y: 110, width: 120, height: 50,
        backgroundColor: '#fff7e6',
        border: {
            top: { width: 3, color: '#409eff' },
            bottom: { width: 3, color: '#67c23a' },
            left: { width: 3, color: '#e6a23c' },
            right: { width: 3, color: '#f56c6c' },
        },
    }))

    layers.push(boxLayer('QrCodeLayer', { x: 300, y: 180, width: 80, height: 80, value: 'https://github.com/HankChenCH/js-canvas' }))

    // CJK 左上对齐文本（有 CJK 字体时才加，go 同门；降级时中文以图层缺席呈现）
    if (font !== '') {
        layers.push(textLayer({
            text: '证书批量生成：图层树 → PDF 直嵌',
            font,
            fontSize: 14,
            fontColor: '#303133',
            x: 20, y: 180, width: 260, height: 30,
            align: ['left', 'top'],
        }))
    }

    // ASCII 文本（px -> pt 口径说明字样；font 空串 = Helvetica 核心字体兜底）
    layers.push(textLayer({
        text: 'px -> pt (96dpi): page 400px = 300pt',
        font,
        fontSize: 12,
        fontColor: '#606266',
        x: 20, y: 215, width: 260, height: 30,
        align: ['left', 'top'],
    }))

    // 90° 逆时针旋转文本（20×120 盒 @(385,300)，坐标与 go 逐项一致）
    layers.push(textLayer({
        text: 'rotated 90 CCW',
        font,
        fontSize: 12,
        fontColor: '#909399',
        x: 385, y: 300, width: 20, height: 120,
        align: ['left', 'top'],
        angle: 90,
    }))

    // 表格一行两列 auto 行高（行宽 360、格 180、内容宽经解码同步为格宽）
    const cell = {
        type: 'TableCellLayer',
        spec: {
            shape: {
                width: 180, height: 0, autoHeight: true,
                backgroundColor: '#eef3fd',
                border: { top: { width: 1, color: '#dddddd' }, bottom: { width: 1, color: '#dddddd' }, left: { width: 1, color: '#dddddd' }, right: { width: 1, color: '#dddddd' } },
            },
        },
        content: textLayer({ text: '表格行：单元格下钻', font, fontSize: 12, fontColor: '#222222', x: 0, y: 0, width: 168, height: 0, autoHeight: true, padding: 6 }),
    }
    layers.push({
        type: 'TableLayer',
        priority: 4,
        spec: {
            shape: { width: 360, height: 40, backgroundColor: '#ffffff', border: { top: { width: 1, color: '#dddddd' }, bottom: { width: 1, color: '#dddddd' }, left: { width: 1, color: '#dddddd' }, right: { width: 1, color: '#dddddd' } } },
            position: { x: 20, y: 260 },
        },
        rows: [{ type: 'TableRowLayer', spec: { shape: { width: 360, height: 0, autoHeight: true } }, cells: [cell] }],
    })

    return { canvas: { width: 400, height: 310, background: { color: '#ffffff' } }, layers }
}

/** 页 2 wire（多页续页语义的人眼面：不同尺寸/底色 + 标记文本 + 色块） */
function buildPage2(font) {
    return {
        canvas: { width: 300, height: 200, background: { color: '#ecf5ff' } },
        layers: [
            boxLayer('ImageLayer', { x: 20, y: 120, width: 100, height: 60, backgroundColor: '#409eff' }),
            textLayer({
                text: '第二页：多页续页语义（逐页独立 MediaBox）',
                font,
                fontSize: 14,
                fontColor: '#303133',
                x: 20, y: 20, width: 260, height: 60,
                align: ['left', 'top'],
                autowrap: true,
            }),
        ],
    }
}

/**
 * 不透明化 QR 物化器（样张脚本侧 workaround，工票 12 报告记档的 src 级问题）：
 * `qrcode` 包产物恒为 colorType 6（RGBA，alpha 全 255）——pdfkit 对带 alpha 通道的
 * PNG 走 splitAlphaChannel() 的回调式异步解码，doc.end() 不等它，产物 PDF 截断
 * （无 xref/trailer、poppler 不可读、无任何报错）。src 契约不动，这里把 QR PNG
 * 拍平成 RGB（8 位、无 alpha、filter 0）后再交默认物化链，样张 QR 腿产出可读 PDF。
 * 修复应落在 pdf-renderer src（如 embed 前统一拍平/换同步路径），评审后另票处理。
 */
function opaqueQrResolver() {
    const inner = new QrCodeMaterializer()
    return createDefaultResolver({
        qrMaterializer: {
            async materialize(text, width) {
                return flattenPngToOpaqueRgb(await inner.materialize(text, width))
            },
        },
        // 缓存根指独立临时目录：样张渲染不做跨跑缓存复用——磁盘缓存若命中历史
        // RGBA 字节会绕过上面的拍平物化器（原样喂给 pdfkit 仍截断）；独立根同时
        // 让样张不读不写系统缓存（hermetic，重跑恒等）
        cacheRoot: fs.mkdtempSync(path.join(os.tmpdir(), 'js-canvas-visualcheck-cache-')),
    })
}

/** PNG 拍平：8 位 RGBA（colorType 6、非隔行）→ 8 位 RGB（colorType 2、filter 0）。
 *  zlib inflate 全量解压 → 逐行按 filter 还原 → 丢 alpha → filter 0 重行 → deflate。
 *  只服务 QR 物化字节（qrcode/pngjs 恒此格式），不追求通用 PNG 解码 */
function flattenPngToOpaqueRgb(png) {
    const view = new DataView(png.buffer, png.byteOffset, png.byteLength)
    // 遍历 chunk 收集 IHDR 与 IDAT（PNG 结构：len(4)+type(4)+data+crc(4)）
    let width = 0
    let height = 0
    const idat = []
    let offset = 8
    while (offset < png.length) {
        const length = view.getUint32(offset)
        const type = String.fromCharCode(png[offset + 4], png[offset + 5], png[offset + 6], png[offset + 7])
        const dataStart = offset + 8
        if (type === 'IHDR') {
            width = view.getUint32(dataStart)
            height = view.getUint32(dataStart + 4)
            if (png[dataStart + 8] !== 8 || png[dataStart + 9] !== 6) {
                throw new Error(`QR PNG 形态非 8 位 RGBA（bit=${png[dataStart + 8]}, color=${png[dataStart + 9]}），拍平器只处理该格式`)
            }
            if (png[dataStart + 12] !== 0) throw new Error('QR PNG 为隔行编码，拍平器不支持')
        } else if (type === 'IDAT') {
            idat.push(png.subarray(dataStart, dataStart + length))
        } else if (type === 'IEND') {
            break
        }
        offset = dataStart + length + 4
    }
    const total = idat.reduce((sum, part) => sum + part.length, 0)
    const compressed = new Uint8Array(total)
    let cursor = 0
    for (const part of idat) {
        compressed.set(part, cursor)
        cursor += part.length
    }
    const raw = inflateSync(compressed)
    const stride = width * 4
    // 逐行反滤波（PNG filter 0-4；前三行边界按零行处理）
    const pixels = new Uint8Array(height * stride)
    const bpp = 4
    for (let y = 0; y < height; y += 1) {
        const filter = raw[y * (stride + 1)]
        const srcRow = y * (stride + 1) + 1
        const outRow = y * stride
        for (let x = 0; x < stride; x += 1) {
            const rawByte = raw[srcRow + x]
            const left = x >= bpp ? pixels[outRow + x - bpp] : 0
            const up = y > 0 ? pixels[outRow - stride + x] : 0
            const upLeft = y > 0 && x >= bpp ? pixels[outRow - stride + x - bpp] : 0
            let value
            switch (filter) {
                case 0: value = rawByte; break
                case 1: value = rawByte + left; break
                case 2: value = rawByte + up; break
                case 3: value = rawByte + ((left + up) >> 1); break
                case 4: {
                    const p = left + up - upLeft
                    const pa = Math.abs(p - left)
                    const pb = Math.abs(p - up)
                    const pc = Math.abs(p - upLeft)
                    value = rawByte + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft)
                    break
                }
                default: throw new Error(`QR PNG 未知 filter 类型 ${filter}`)
            }
            pixels[outRow + x] = value & 0xff
        }
    }
    // 丢 alpha 重行（filter 0）→ deflate → 重新封装 PNG（CRC 只覆盖 type+data）
    const outStride = width * 3
    const rawOut = new Uint8Array(height * (outStride + 1))
    for (let y = 0; y < height; y += 1) {
        rawOut[y * (outStride + 1)] = 0
        for (let x = 0; x < width; x += 1) {
            const src = y * stride + x * 4
            const dst = y * (outStride + 1) + 1 + x * 3
            rawOut[dst] = pixels[src]
            rawOut[dst + 1] = pixels[src + 1]
            rawOut[dst + 2] = pixels[src + 2]
        }
    }
    return encodeRgbPng(width, height, rawOut)
}

/** 8 位 RGB、filter 0 的最小 PNG 封装（chunk/CRC 同式复制自 twoBandPng 的同款小件） */
function encodeRgbPng(width, height, rawOut) {
    const crcTable = (() => {
        const table = new Array(256)
        for (let n = 0; n < 256; n += 1) {
            let c = n
            for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
            table[n] = c >>> 0
        }
        return table
    })()
    const crc32 = (buf) => {
        let crc = 0xffffffff
        for (const byte of buf) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff]
        return (crc ^ 0xffffffff) >>> 0
    }
    const chunk = (type, data) => {
        const len = Buffer.alloc(4)
        len.writeUInt32BE(data.length)
        const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
        const crc = Buffer.alloc(4)
        crc.writeUInt32BE(crc32(body))
        return Buffer.concat([len, body, crc])
    }
    const ihdr = Buffer.alloc(13)
    ihdr.writeUInt32BE(width, 0)
    ihdr.writeUInt32BE(height, 4)
    ihdr[8] = 8
    ihdr[9] = 2 // RGB
    const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    return new Uint8Array(Buffer.concat([signature, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(rawOut)), chunk('IEND', Buffer.alloc(0))]))
}

/** pdftoppm 可执行文件定位：PDF_RENDERER_POPPLER_DIR 优先，其余扫 PATH（go
 *  exec.LookPath 同义）；缺席返回 null（跳过预览只出 PDF，不报错） */function lookPdftoppm() {
    const dirs = []
    if (process.env.PDF_RENDERER_POPPLER_DIR) dirs.push(process.env.PDF_RENDERER_POPPLER_DIR)
    if (process.env.PATH) dirs.push(...process.env.PATH.split(path.delimiter))
    for (const dir of dirs) {
        if (!dir) continue
        const candidate = path.join(dir, 'pdftoppm')
        try {
            fs.accessSync(candidate, fs.constants.X_OK)
            return candidate
        } catch {
            // 探下一个目录
        }
    }
    return null
}

async function main() {
    const base = process.argv[2] ?? path.join(PACKAGE_ROOT, 'visualcheck-output', 'visual-check')
    fs.mkdirSync(path.dirname(base), { recursive: true })

    const font = pickFont(FONT_CANDIDATES)

    // 条带图落系统临时目录（对位 go os.TempDir()；重跑覆写）
    const stripPath = path.join(os.tmpdir(), 'js-canvas-pdf-visual-strip.png')
    fs.writeFileSync(stripPath, twoBandPng())

    const pages = [buildPage1(font, stripPath), buildPage2(font)].map((wire) => decodeGraph(wire))
    // 便捷入口一条龙：物化（QR 经不透明化物化器，绕 pdfkit alpha-PNG 异步嵌断，
    // 见 opaqueQrResolver 注）→ 核心多页编排 → 单 PDF 文档字节
    const pdf = await renderPagesAsPdf(pages, { resolver: opaqueQrResolver() })
    // 产物守门（对位 go 冒烟形态）：%PDF 头。注意原生 Uint8Array.prototype.toString
    // 不吃编码参数（join 语义），latin1 解码须过 Buffer（与 tests/backend.test.ts 同式）
    if (Buffer.from(pdf.subarray(0, 5)).toString('latin1') !== '%PDF-') {
        throw new Error('产物非 PDF（%PDF 头不符）')
    }
    const pdfPath = `${base}.pdf`
    fs.writeFileSync(pdfPath, pdf)
    console.log(`CJK 字体: ${font === '' ? '(无，降级 Helvetica 只排 ASCII)' : font}`)
    console.log(`已输出: ${pdfPath} (${pdf.length} 字节，${pages.length} 页)`)

    // pdftoppm 逐页预览：-r 96 恰好 1:1 还原像素网格；缺席只出 PDF 不报错（go 同款）
    const pdftoppm = lookPdftoppm()
    if (pdftoppm === null) {
        console.log('未找到 pdftoppm，跳过预览（安装 poppler 后重跑可得逐页 PNG）')
        return
    }
    for (let page = 1; page <= pages.length; page += 1) {
        const previewBase = `${base}-${page}`
        execFileSync(pdftoppm, ['-r', '96', '-png', '-singlefile', '-f', String(page), '-l', String(page), pdfPath, previewBase], { stdio: 'pipe' })
        console.log(`已输出: ${previewBase}.png（pdftoppm -r 96 预览，第 ${page} 页）`)
    }
}

main().catch((error) => {
    console.error('visual-check:', error.message)
    process.exit(1)
})
