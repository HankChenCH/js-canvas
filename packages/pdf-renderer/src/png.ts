/**
 * PNG 嵌入前置拍平（评审 P0-1 的 src 级修复）：把会触发 pdfkit 异步收尾的 PNG
 * 在 openImage 之前同步解码拍平成 8 位 RGB PNG，其余字节原样直嵌。
 *
 * **根因实证（pdfkit 0.20.2 + png-js 2.0.0）**：pdfkit PNGImage.embed 对带 alpha
 * 通道的 PNG（colorType 4/6）走 splitAlphaChannel()、对调色板 tRNS 走
 * loadIndexedAlphaChannel()、对隔行走 decodeData()——三者都依赖 png-js 的
 * decodePixels 回调，而 png-js 2.0.0 的 decodePixels 用 node `zlib.inflate(data, cb)`
 * 解压（回调异步触发，实测 emit 前后位翻转）。于是 finalize()（写 XObject 流 +
 * 收尾）落在 doc.end() **同步排空之后**，XObject 永不收尾 → 产出无 startxref/
 * %%EOF 的残件，全程零 JS 报错。`end(): Uint8Array` 同步契约下无法等待异步收尾
 * （「异步收尾等待」路不通），故 embed 前统一拍平：拍平产物走 pdfkit 的健康
 * RGB 同步路径（IDAT 原样作 FladeDecode 流 + PNG predictor DecodeParms）。
 *
 * **拍平语义**：alpha 非 255 的像素按 source-over 合成到白底（qrcode 物化器前景
 * 色 dark=#000000ff/light=#ffffffff 恒不透明，拍平逐字节恒等；部分透明图与 go
 * fpdf 的 SMask 保留 alpha 有已记录的分歧——node 侧 v1 以直嵌健康路径优先）。
 * JPEG 不经本件（直嵌零重编码保留）；无 alpha 的 RGB/灰度 PNG、灰度/RGB 带
 * tRNS 透明键（pdfkit 走同步 Mask 数组臂）均原样直嵌不拍平。
 *
 * 解码面（非隔行）：colorType 0/2/3/4/6、位深 8/16（16 位取高字节）；调色板
 * 1/2/4 位子字节位包展开。隔行（Adam7）不重构——响亮报错取代静默截断（与
 * 「无产物逃逸」纪律同门：残件不可分发，可读报错立即中止）。
 */
import { deflateSync, inflateSync } from 'node:zlib'

import { hasPngSignature } from './decode'

const PNG_SIGNATURE = 0x89504e47

/** IHDR 关键字段（拍平判定与解码共用输入） */
interface PngHeader {
    width: number
    height: number
    bitDepth: number
    colorType: number
    interlace: number
}

/** 最小 chunk 解析：只取 IHDR/PLTE/tRNS/IDAT（其余辅助块一律跳过） */
interface PngChunks {
    header: PngHeader
    palette: Uint8Array | null
    trns: Uint8Array | null
    idat: Uint8Array[]
}

function parseChunks(data: Uint8Array): PngChunks {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
    if (data.length < 8 || view.getUint32(0) !== PNG_SIGNATURE) {
        throw new Error('PNG 拍平器: 缺 PNG 签名（调用方魔数嗅探失守）')
    }
    let header: PngHeader | null = null
    let palette: Uint8Array | null = null
    let trns: Uint8Array | null = null
    const idat: Uint8Array[] = []
    let offset = 8
    while (offset + 8 <= data.length) {
        const length = view.getUint32(offset)
        const type = String.fromCharCode(data[offset + 4]!, data[offset + 5]!, data[offset + 6]!, data[offset + 7]!)
        const start = offset + 8
        if (start + length + 4 > data.length) {
            throw new Error('PNG 拍平器: chunk 越界（截断或损坏文件）')
        }
        const body = data.subarray(start, start + length)
        if (type === 'IHDR') {
            header = {
                width: view.getUint32(start),
                height: view.getUint32(start + 4),
                bitDepth: body[8]!,
                colorType: body[9]!,
                interlace: body[12]!,
            }
        } else if (type === 'PLTE') {
            palette = new Uint8Array(body)
        } else if (type === 'tRNS') {
            trns = new Uint8Array(body)
        } else if (type === 'IDAT') {
            idat.push(body)
        } else if (type === 'IEND') {
            break
        }
        offset = start + length + 4 // 跳过 CRC
    }
    if (header === null) {
        throw new Error('PNG 拍平器: 缺 IHDR 头块')
    }
    return { header, palette, trns, idat }
}

/**
 * 是否需要拍平后才能安全嵌入：与 pdfkit PNGImage.embed 的异步收尾分支逐条对位
 * （见文件头根因）——alpha 通道（colorType 4/6）、调色板 tRNS、隔行三入口。
 * 灰度/RGB 的 tRNS 透明键走 pdfkit 同步 Mask 臂，不在列
 */
export function pngEmbedNeedsFlatten(data: Uint8Array): boolean {
    if (!hasPngSignature(data)) {
        return false // JPEG 直嵌与垃圾字节（嗅探防线在 embedBlit 前置）不经拍平面
    }
    const { header, trns } = parseChunks(data)
    return header.colorType === 4 || header.colorType === 6 || (header.colorType === 3 && trns !== null) || header.interlace === 1
}

const CHANNELS_BY_COLOR_TYPE: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }

/**
 * embed 前置拍平入口：需要拍平的 PNG 解码重编码为 8 位 RGB PNG（filter 0），
 * 不需要的原样返回（RGB PNG 与 JPEG 直嵌零重编码保留）。解码/形态不支持时报
 * 可读错误（fail-fast 取代 pdfkit 异步臂的静默截断残件）
 */
export function flattenPngForEmbed(data: Uint8Array): Uint8Array {
    if (!pngEmbedNeedsFlatten(data)) {
        return data
    }
    const parsed = parseChunks(data)
    const { header, palette, trns, idat } = parsed
    const { width, height, bitDepth, colorType, interlace } = header
    if (interlace !== 0) {
        throw new Error(`图片嵌入失败: PNG 为隔行编码（Adam7），拍平器不重构隔行扫描线（${width}x${height}）——请另存为非隔行 PNG`)
    }
    const channels = CHANNELS_BY_COLOR_TYPE[colorType]
    if (channels === undefined) {
        throw new Error(`图片嵌入失败: PNG colorType ${colorType} 不在支持面（0/2/3/4/6）`)
    }
    if (colorType === 3 && palette === null) {
        throw new Error('图片嵌入失败: 调色板 PNG 缺 PLTE 块')
    }
    if (bitDepth !== 8 && bitDepth !== 16 && !(colorType === 3 && (bitDepth === 1 || bitDepth === 2 || bitDepth === 4))) {
        throw new Error(`图片嵌入失败: PNG 位深 ${bitDepth}（colorType ${colorType}）不在拍平器支持面`)
    }
    const samples = unfilterScanlines(idat, width, height, channels, bitDepth)
    const rgb = compositeToRgb8(samples, width, height, channels, bitDepth, colorType, palette, trns)
    return encodeRgbPng(width, height, rgb)
}

/** 反滤波展开全部扫描线 → 连续样本字节流（8 位直接样本 / 16 位高低字节序原样） */
function unfilterScanlines(idat: Uint8Array[], width: number, height: number, channels: number, bitDepth: number): Uint8Array {
    const bpp = Math.max(1, Math.trunc((channels * bitDepth + 7) / 8)) // 反滤波前向参考的字节距
    const stride = Math.trunc((width * channels * bitDepth + 7) / 8)
    const compressed = Buffer.concat(idat.map((part) => Buffer.from(part)))
    let raw: Uint8Array
    try {
        raw = inflateSync(compressed)
    } catch (error) {
        throw new Error(`图片嵌入失败: PNG IDAT 解压失败（损坏文件?）: ${(error as Error).message}`)
    }
    if (raw.length < height * (stride + 1)) {
        throw new Error(`图片嵌入失败: PNG 像素数据不足（解压 ${raw.length} < 期望 ${height * (stride + 1)}）`)
    }
    const pixels = new Uint8Array(height * stride)
    for (let y = 0; y < height; y += 1) {
        const filter = raw[y * (stride + 1)]!
        const srcRow = y * (stride + 1) + 1
        const outRow = y * stride
        for (let x = 0; x < stride; x += 1) {
            const rawByte = raw[srcRow + x]!
            const left = x >= bpp ? pixels[outRow + x - bpp]! : 0
            const up = y > 0 ? pixels[outRow - stride + x]! : 0
            const upLeft = y > 0 && x >= bpp ? pixels[outRow - stride + x - bpp]! : 0
            let value: number
            switch (filter) {
                case 0: // None
                    value = rawByte
                    break
                case 1: // Sub
                    value = rawByte + left
                    break
                case 2: // Up
                    value = rawByte + up
                    break
                case 3: // Average
                    value = rawByte + ((left + up) >> 1)
                    break
                case 4: { // Paeth
                    const p = left + up - upLeft
                    const pa = Math.abs(p - left)
                    const pb = Math.abs(p - up)
                    const pc = Math.abs(p - upLeft)
                    value = rawByte + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft)
                    break
                }
                default:
                    throw new Error(`图片嵌入失败: PNG 未知行滤波类型 ${filter}`)
            }
            pixels[outRow + x] = value & 0xff
        }
    }
    return pixels
}

/** 样本读取：8 位直取；16 位取高字节（低字节对 8 位输出面的舍入差在拍平语义内） */
function sampleAt(pixels: Uint8Array, sampleIndex: number, bitDepth: number): number {
    if (bitDepth === 16) {
        return pixels[sampleIndex * 2]!
    }
    return pixels[sampleIndex]!
}

/** 调色板索引行展开（1/2/4 位子字节位包，MSB 先行；8 位直取） */
function paletteIndexAt(pixels: Uint8Array, rowOffset: number, x: number, bitDepth: number): number {
    if (bitDepth === 8) {
        return pixels[rowOffset + x]!
    }
    const bitPos = x * bitDepth
    const shift = 8 - bitDepth - (bitPos & 7)
    return (pixels[rowOffset + (bitPos >> 3)]! >> shift) & ((1 << bitDepth) - 1)
}

/** alpha 合成到白底（source-over，整数舍入）：out = round((c·a + 255·(255−a)) / 255) */
function overWhite(color: number, alpha: number): number {
    return Math.trunc((color * alpha + 255 * (255 - alpha) + 127) / 255)
}

/** 全像素映射到 8 位 RGB（alpha 合成白底），返回 filter-0 行装帧前的连续 RGB 字节 */
function compositeToRgb8(
    pixels: Uint8Array,
    width: number,
    height: number,
    channels: number,
    bitDepth: number,
    colorType: number,
    palette: Uint8Array | null,
    trns: Uint8Array | null,
): Uint8Array {
    const out = new Uint8Array(width * height * 3)
    for (let y = 0; y < height; y += 1) {
        const rowOffset = y * Math.trunc((width * channels * bitDepth + 7) / 8)
        for (let x = 0; x < width; x += 1) {
            let r = 0
            let g = 0
            let b = 0
            let alpha = 255
            switch (colorType) {
                case 0: { // 灰度（拍平面不会到达：无 tRNS 走同步 Mask 臂；防御面保留）
                    const gray = sampleAt(pixels, rowOffset + x, bitDepth)
                    r = g = b = gray
                    break
                }
                case 2: { // RGB
                    r = sampleAt(pixels, rowOffset + x * 3, bitDepth)
                    g = sampleAt(pixels, rowOffset + x * 3 + 1, bitDepth)
                    b = sampleAt(pixels, rowOffset + x * 3 + 2, bitDepth)
                    break
                }
                case 3: { // 调色板：索引 → PLTE 颜色 + tRNS 逐索引 alpha
                    const index = paletteIndexAt(pixels, rowOffset, x, bitDepth)
                    if (index * 3 + 2 >= palette!.length) {
                        throw new Error(`图片嵌入失败: 调色板索引 ${index} 越出 PLTE（损坏文件?）`)
                    }
                    r = palette![index * 3]!
                    g = palette![index * 3 + 1]!
                    b = palette![index * 3 + 2]!
                    alpha = index < trns!.length ? trns![index]! : 255
                    break
                }
                case 4: { // 灰度 + alpha
                    const gray = sampleAt(pixels, rowOffset + x * 2, bitDepth)
                    alpha = sampleAt(pixels, rowOffset + x * 2 + 1, bitDepth)
                    r = g = b = gray
                    break
                }
                default: { // 6: RGBA
                    r = sampleAt(pixels, rowOffset + x * 4, bitDepth)
                    g = sampleAt(pixels, rowOffset + x * 4 + 1, bitDepth)
                    b = sampleAt(pixels, rowOffset + x * 4 + 2, bitDepth)
                    alpha = sampleAt(pixels, rowOffset + x * 4 + 3, bitDepth)
                    break
                }
            }
            const o = (y * width + x) * 3
            out[o] = overWhite(r, alpha)
            out[o + 1] = overWhite(g, alpha)
            out[o + 2] = overWhite(b, alpha)
        }
    }
    return out
}

// ---- 8 位 RGB PNG 重编码（filter 0；chunk/CRC 与 tests/helpers.ts 同式） ----

const CRC_TABLE = (() => {
    const table = new Array<number>(256)
    for (let n = 0; n < 256; n += 1) {
        let c = n
        for (let k = 0; k < 8; k += 1) {
            c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
        }
        table[n] = c >>> 0
    }
    return table
})()

function crc32(buf: Uint8Array): number {
    let crc = 0xffffffff
    for (const byte of buf) {
        crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff]!
    }
    return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type: string, data: Uint8Array): Buffer {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'latin1'), Buffer.from(data)])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body))
    return Buffer.concat([len, body, crc])
}

/** 8 位 RGB、filter 0 的最小 PNG 封装（pdfkit 健康同步臂的输入形态） */
function encodeRgbPng(width: number, height: number, rgb: Uint8Array): Uint8Array {
    const ihdr = Buffer.alloc(13)
    ihdr.writeUInt32BE(width, 0)
    ihdr.writeUInt32BE(height, 4)
    ihdr[8] = 8 // bit depth
    ihdr[9] = 2 // color type: RGB
    ihdr[12] = 0 // 非隔行
    const stride = width * 3
    const raw = new Uint8Array(height * (stride + 1))
    for (let y = 0; y < height; y += 1) {
        raw[y * (stride + 1)] = 0 // filter none
        raw.set(rgb.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1)
    }
    return new Uint8Array(
        Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), pngChunk('IHDR', ihdr), pngChunk('IDAT', deflateSync(raw)), pngChunk('IEND', new Uint8Array(0))]),
    )
}
