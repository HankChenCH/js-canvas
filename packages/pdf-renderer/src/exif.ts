/**
 * EXIF orientation 最小解析（对位 go pdf-renderer/exif.go，与 go-canvas
 * image-renderer/exif.go 同式复制的第三份平移——转正契约的一部分，多后端防线
 * 必须对称）。JPEG 的 APP1(Exif) 段携带拍摄方向，放置前需归正到观察方向；
 * 差异只在消化手段：位图后端搬像素，PDF 后端经放置矩阵（image.ts orientAffine）
 * 归正，直嵌字节零重编码。
 */

/** exifOrientation 从图片字节流解析 EXIF orientation（1–8）。非 JPEG、无 EXIF、结构截断/非法一律归 1（无需转正） */
export function exifOrientation(data: Uint8Array): number {
    if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) {
        return 1 // 非 JPEG（PNG 不携带该 EXIF 结构）
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
        if (marker === 0xe1 && segLen >= 8 && latin1(data, pos + 4, 6) === 'Exif\x00\x00') {
            return parseTiffOrientation(data.subarray(pos + 10, pos + 2 + segLen))
        }
        pos += 2 + segLen
    }
    return 1
}

function latin1(data: Uint8Array, offset: number, length: number): string {
    let out = ''
    for (let i = 0; i < length; i += 1) {
        out += String.fromCharCode(data[offset + i]!)
    }
    return out
}

/** parseTiffOrientation 从 TIFF 头起解析 IFD0 的 Orientation 值（SHORT/LONG 均兼容） */
function parseTiffOrientation(tiff: Uint8Array): number {
    if (tiff.length < 8) return 1
    const view = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength)
    const order = latin1(tiff, 0, 2)
    const littleEndian = order === 'II'
    if (!littleEndian && order !== 'MM') return 1
    if (view.getUint16(2, littleEndian) !== 42) return 1
    const ifd0 = view.getUint32(4, littleEndian)
    if (ifd0 < 8 || ifd0 + 2 > tiff.length) return 1
    const entries = view.getUint16(ifd0, littleEndian)
    for (let i = 0; i < entries; i += 1) {
        const e = ifd0 + 2 + i * 12
        if (e + 12 > tiff.length) return 1
        if (view.getUint16(e, littleEndian) !== 0x0112) continue // Orientation
        let v: number
        switch (view.getUint16(e + 2, littleEndian)) {
            case 3: // SHORT：值内联于条目
                v = view.getUint16(e + 8, littleEndian)
                break
            case 4: // LONG：值内联于条目
                v = view.getUint32(e + 8, littleEndian)
                break
            default:
                return 1
        }
        return v >= 1 && v <= 8 ? v : 1
    }
    return 1
}
