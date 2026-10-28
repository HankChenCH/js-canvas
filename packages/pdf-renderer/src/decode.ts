/**
 * 内在尺寸探测 + 魔数嗅探（对位 go pdf-renderer/decode.go decodeConfig/sniffType）。
 * go 用 image.DecodeConfig（gif 顺带覆盖）；node 侧手解析 PNG IHDR 与 JPEG SOF——
 * 零解码依赖、字节面直读，与 go 同一 raw 口径（未按 EXIF 转正，转正由放置矩阵消化）。
 *
 * 格式支持面（05 号决议降级声明）：JPEG/PNG 直嵌零重编码；GIF/BMP/WebP v1 报错
 * 不转码（go 侧 GIF 支持是 fpdf 的顺带覆盖，node v1 不引入解码依赖与重编码路径）。
 */

/** PNG 签名（8 字节） */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const

/** 图片内在尺寸（raw 空间，未转正） */
export interface ImageDimensions {
    width: number
    height: number
}

/** 直接支持直嵌的图片格式标签（魔数嗅探结果，扩展名不可信） */
export type ImageFormat = 'png' | 'jpg'

/**
 * sniffType 按魔数嗅探直嵌格式（pdfkit 的图像解析只认字节不认扩展名，而物化缓存键
 * 的扩展名来自 URL、不可信）。非 JPEG/PNG 一律报错并列明 v1 支持面——对齐 go
 * 「垃圾字节报错中止」的结局 parity（GIF/BMP/WebP 显式点名，05 号降级声明）。
 */
export function sniffType(data: Uint8Array): ImageFormat {
    if (hasPngSignature(data)) return 'png'
    if (data.length >= 2 && data[0] === 0xff && data[1] === 0xd8) return 'jpg'
    throw new Error('无法识别的图片格式:PDF 图片直嵌仅支持 PNG/JPEG（GIF/BMP/WebP v1 报错不转码）')
}

/** hasPngSignature PNG 魔数判定（sniffType 与 IHDR 解析共用） */
export function hasPngSignature(data: Uint8Array): boolean {
    if (data.length < 8) return false
    for (let i = 0; i < 8; i += 1) {
        if (data[i] !== PNG_SIGNATURE[i]) return false
    }
    return true
}

/**
 * imageDimensions 解码图片头块取内在尺寸（raw，未按 EXIF 转正）。blit 的 srcRect
 * 源窗与 imageIntrinsicSize 同处内在坐标系（ADR 0024），转正由 drawImage 以放置
 * 矩阵消化——orientation ≥5 的 SOF/IHDR 尺寸本身就是 raw，不需换回。
 * 魔数嗅探先于本函数（垃圾字节报错在前）；宽/高 ≤0 报错（对位 go 非法图片尺寸防线）。
 */
export function imageDimensions(data: Uint8Array): ImageDimensions {
    if (hasPngSignature(data)) {
        return requirePositive(pngDimensions(data), 'PNG')
    }
    if (data.length >= 2 && data[0] === 0xff && data[1] === 0xd8) {
        return requirePositive(jpegDimensions(data), 'JPEG')
    }
    throw new Error('无法识别的图片格式:仅支持 PNG/JPEG')
}

function requirePositive(d: ImageDimensions | null, kind: string): ImageDimensions {
    if (d === null || d.width <= 0 || d.height <= 0) {
        throw new Error(`非法图片尺寸 ${d ? `${d.width}x${d.height}` : '(解析失败)'}(${kind})`)
    }
    return d
}

/** pngDimensions 读 IHDR 块：签名(8) + 块长(4) + "IHDR" + 宽(4) + 高(4)，均大端 */
function pngDimensions(data: Uint8Array): ImageDimensions | null {
    if (data.length < 24) return null
    const type = String.fromCharCode(data[12]!, data[13]!, data[14]!, data[15]!)
    if (type !== 'IHDR') return null
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
    return { width: view.getUint32(16), height: view.getUint32(20) }
}

/**
 * JPEG SOF 标记集（基线/扩展/渐进/无损族；C4 DHT、C8 JPG、CC DAC 非帧标记）。
 * 与 pdfkit 内部 SOF 判定集同口径。
 */
const SOF_MARKERS = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
])

/** jpegDimensions 扫段找 SOF：段结构 = FF marker(1) + 段长(2, 含自身) + 载荷 */
function jpegDimensions(data: Uint8Array): ImageDimensions | null {
    let pos = 2 // 跳过 SOI
    while (pos + 4 <= data.length) {
        if (data[pos] !== 0xff) return null // 非法流
        const marker = data[pos + 1]!
        if (marker === 0xff) {
            pos += 1 // 填充字节，步进一位重新判读
            continue
        }
        if (marker === 0xd8 || marker === 0x01 || marker === 0xd9) {
            pos += 2 // SOI/TEM/EOI 无段载荷
            continue
        }
        const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
        const segLen = view.getUint16(pos + 2)
        if (segLen < 2 || pos + 2 + segLen > data.length) return null // 截断
        if (marker === 0xda) return null // SOS：熵编码开始，SOF 必然更靠前
        if (SOF_MARKERS.has(marker) && segLen >= 7) {
            // SOF 载荷：精度(1) + 高(2) + 宽(2)
            return {
                height: view.getUint16(pos + 5),
                width: view.getUint16(pos + 7),
            }
        }
        pos += 2 + segLen
    }
    return null
}
