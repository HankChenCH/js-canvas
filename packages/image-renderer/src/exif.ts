/**
 * EXIF orientation：JPEG 的 APP1(Exif) 段携带拍摄方向。node 侧混合口径（04 号
 * 决议）——像素面吃 napi 解码层自动转正（canonical 空间），本模块只承担两件
 * 同步职责：① 从字节流读 orientation（drawImage 的 raw→canonical 窗口映射与
 * imageIntrinsicSize 的 raw 尺寸互换都需要它，二者皆为同步原语）；② 把 raw
 * （内在）坐标窗口映射进 canonical 位图坐标（canonicalSourceRect）。
 *
 * 解析器对位 go-canvas/image-renderer/exif.go 同式复制（注明出处；go 侧先例：
 * color/exif/qr 小件在两 module 复制）——只找 IFD0 的 Orientation 标签(0x0112)，
 * 其余结构一概不碰。工票原案「用 exifr 读 orientation」在同步原语契约下不可行
 * （exifr 全异步、核心 imageIntrinsicSize/drawImage 为同步口），改用本同式解析器：
 * 与 go 逐字节同语义、测试与 go exif_test 同手法互检，「≥5 互换返 raw」语义不变。
 */

/**
 * 从图片字节流解析 EXIF orientation(1–8)。非 JPEG、无 EXIF、结构截断/非法一律
 * 归 1（无需转正）——与 go exifOrientation 同语义
 */
export function exifOrientation(data: Uint8Array): number {
    if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) {
        return 1 // 非 JPEG（PNG/WebP 等不携带该 EXIF 结构）
    }
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
    let pos = 2
    while (pos + 4 <= data.length && data[pos] === 0xff) {
        const marker = data[pos + 1]!
        if (marker === 0xff) {
            pos += 1 // 标记前的填充字节，步进一位重新判读
            continue
        }
        if (marker === 0xd8 || marker === 0x01 || marker === 0xd9) {
            pos += 2 // SOI/TEM/EOI 无段载荷
            continue
        }
        const segLen = view.getUint16(pos + 2)
        if (segLen < 2 || pos + 2 + segLen > data.length) {
            return 1 // 截断或非法段长
        }
        if (marker === 0xda) {
            return 1 // SOS：熵编码开始，EXIF 只会更靠前
        }
        if (marker === 0xe1 && segLen >= 8 && isExifHeader(data, pos + 4)) {
            return parseTIFFOrientation(data.subarray(pos + 10, pos + 2 + segLen))
        }
        pos += 2 + segLen
    }
    return 1
}

function isExifHeader(data: Uint8Array, offset: number): boolean {
    // "Exif\0\0"
    return (
        data[offset] === 0x45 &&
        data[offset + 1] === 0x78 &&
        data[offset + 2] === 0x69 &&
        data[offset + 3] === 0x66 &&
        data[offset + 4] === 0x00 &&
        data[offset + 5] === 0x00
    )
}

/** 从 TIFF 头起解析 IFD0 的 Orientation 值（SHORT/LONG 均兼容） */
function parseTIFFOrientation(tiff: Uint8Array): number {
    if (tiff.length < 8) {
        return 1
    }
    const le = tiff[0] === 0x49 && tiff[1] === 0x49 // "II"
    const be = tiff[0] === 0x4d && tiff[1] === 0x4d // "MM"
    if (!le && !be) {
        return 1
    }
    const view = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength)
    const u16 = (o: number) => view.getUint16(o, le)
    const u32 = (o: number) => view.getUint32(o, le)

    if (u16(2) !== 42) {
        return 1
    }
    const ifd0 = u32(4)
    if (ifd0 < 8 || ifd0 + 2 > tiff.length) {
        return 1
    }
    const entries = u16(ifd0)
    for (let i = 0; i < entries; i += 1) {
        const e = ifd0 + 2 + i * 12
        if (e + 12 > tiff.length) {
            return 1
        }
        if (u16(e) !== 0x0112) {
            continue // Orientation
        }
        let v: number
        switch (u16(e + 2)) {
            // 字段类型：3 SHORT / 4 LONG，值内联于条目
            case 3:
                v = u16(e + 8)
                break
            case 4:
                v = u32(e + 8)
                break
            default:
                return 1
        }
        return v >= 1 && v <= 8 ? v : 1
    }
    return 1
}

/** blit 矩形（对位核心包 BlitRect；此处收窄为本包内用形，避免循环依赖负担） */
export interface SourceRect {
    x: number
    y: number
    width: number
    height: number
}

/**
 * raw（内在坐标）窗口 → canonical（napi 转正后位图）窗口。
 *
 * 04 号决议像素面口径的落地机制：go 是「先裁后转」（裁窗在内在坐标系、转正后置），
 * napi 是「解码即转正」——orientation 是逐像素双射，裁窗与转正可交换，把 raw 窗口
 * 经转正映射搬进 canonical 位图即得同一块像素（任意窗口精确等价，居中 cover 只是
 * 最常见入参）。映射公式由 go applyOrientation 的 canonical(dx,dy)=raw(sx,sy)
 * 八向公式反解（互检见 tests/exif.test.ts 的手算字面量与 go 期望栅格）：
 * - 2–4 镜像族：维度不变，原点按镜像轴翻折；
 * - 5–8 旋转族：宽高互换，原点按转置轴翻折。
 *
 * orientation 由 exifOrientation 保证在 1–8；sw/sh 为 raw 尺寸
 */
export function canonicalSourceRect(
    raw: SourceRect,
    orientation: number,
    sw: number,
    sh: number,
): SourceRect {
    const { x, y, width, height } = raw
    switch (orientation) {
        case 2: // 水平镜像
            return { x: sw - x - width, y, width, height }
        case 3: // 旋转 180°
            return { x: sw - x - width, y: sh - y - height, width, height }
        case 4: // 垂直镜像
            return { x, y: sh - y - height, width, height }
        case 5: // 转置（主对角镜像）
            return { x: y, y: x, width: height, height: width }
        case 6: // 旋转 90° 顺时针
            return { x: sh - y - height, y: x, width: height, height: width }
        case 7: // 反转置（反对角镜像）
            return { x: sh - y - height, y: sw - x - width, width: height, height: width }
        case 8: // 旋转 90° 逆时针
            return { x: y, y: sw - x - width, width: height, height: width }
        default: // 1 或未知：无 EXIF 语义，直通
            return { x, y, width, height }
    }
}

/**
 * canonical 位图尺寸对应的 raw 尺寸（imageIntrinsicSize 查询面）：orientation ≥5
 * （90° 族）时 napi 解出的 w/h 已互换，再换回来即 raw 内在尺寸——对位 go
 * image.DecodeConfig（内在坐标系未转正）与 PHP getimagesize
 */
export function rawDimensions(canonicalWidth: number, canonicalHeight: number, orientation: number): {
    width: number
    height: number
} {
    return orientation >= 5
        ? { width: canonicalHeight, height: canonicalWidth }
        : { width: canonicalWidth, height: canonicalHeight }
}
