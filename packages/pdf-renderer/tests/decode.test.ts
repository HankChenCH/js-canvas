import { describe, expect, it } from 'vitest'

import { encodeJpeg, encodePng, GIF_MAGIC, BMP_MAGIC, WEBP_MAGIC, jpegWithExifOrientation, tiffWithOrientation } from './helpers'
import { imageDimensions, sniffType } from '../src/decode'
import { exifOrientation } from '../src/exif'

/**
 * 内在尺寸探测 + 魔数嗅探（对位 go decode.go decodeConfig/sniffType）与
 * EXIF orientation 最小解析（对位 go exif.go）：非 JPEG/无 EXIF/截断非法一律归 1。
 */
describe('sniffType 魔数嗅探（扩展名不可信，直嵌格式以嗅探为准）', () => {
    it('PNG/JPEG 魔数命中', () => {
        expect(sniffType(encodePng(4, 4, () => [255, 0, 0]))).toBe('png')
        expect(sniffType(encodeJpeg(4, 4, () => [255, 0, 0]))).toBe('jpg')
    })

    it('GIF/BMP/WebP/未知报错，错误信息列出 v1 支持面（05 号降级声明）', () => {
        for (const bytes of [GIF_MAGIC, BMP_MAGIC, WEBP_MAGIC]) {
            expect(() => sniffType(bytes)).toThrow(/无法识别的图片格式/)
            expect(() => sniffType(bytes)).toThrow(/PNG\/JPEG/)
        }
        expect(() => sniffType(new Uint8Array([1, 2, 3]))).toThrow(/无法识别的图片格式/)
    })
})

describe('imageDimensions 内在尺寸（raw 口径，未按 EXIF 转正）', () => {
    it('PNG 走 IHDR；JPEG 走 SOF', () => {
        expect(imageDimensions(encodePng(20, 10, () => [1, 2, 3]))).toEqual({ width: 20, height: 10 })
        expect(imageDimensions(encodeJpeg(20, 10, () => [1, 2, 3]))).toEqual({ width: 20, height: 10 })
    })

    it('JPEG 尺寸为 raw 尺寸：EXIF orientation ≥5 不互换（SOF 本身就是 raw，对位 go DecodeConfig）', () => {
        const body = encodeJpeg(8, 16, (_x, y) => (y < 8 ? [255, 0, 0] : [0, 0, 255]))
        for (const orientation of [1, 6, 8]) {
            const bytes = jpegWithExifOrientation(body, orientation)
            expect(imageDimensions(bytes)).toEqual({ width: 8, height: 16 })
        }
    })

    it('垃圾字节报错；非法尺寸报错', () => {
        expect(() => imageDimensions(new Uint8Array([0xff, 0xd8, 0x00, 0x01]))).toThrow()
        expect(() => imageDimensions(GIF_MAGIC)).toThrow()
    })
})

describe('exifOrientation 最小解析（APP1/IFD0 Orientation 标签，对位 go exif.go）', () => {
    it('非 JPEG 一律归 1（PNG 不携带该结构）', () => {
        expect(exifOrientation(encodePng(4, 4, () => [0, 0, 0]))).toBe(1)
        expect(exifOrientation(new Uint8Array([0x00, 0x01]))).toBe(1)
    })

    it('无 EXIF 的 JPEG 归 1', () => {
        expect(exifOrientation(encodeJpeg(4, 4, () => [0, 0, 0]))).toBe(1)
    })

    it('APP1/IFD0 八向取值（SHORT 内联）', () => {
        const body = encodeJpeg(4, 4, () => [0, 0, 0])
        for (const orientation of [1, 2, 3, 4, 5, 6, 7, 8]) {
            expect(exifOrientation(jpegWithExifOrientation(body, orientation))).toBe(orientation)
        }
    })

    it('LONG 类型条目同样兼容', () => {
        const body = encodeJpeg(4, 4, () => [0, 0, 0])
        const payload = Buffer.concat([
            Buffer.from('Exif\x00\x00', 'latin1'),
            Buffer.from(tiffWithOrientation(true, 4, 6)),
        ])
        const segLen = payload.length + 2
        const head = Buffer.from([0xff, 0xd8, 0xff, 0xe1, segLen >> 8, segLen & 0xff])
        const bytes = new Uint8Array(Buffer.concat([head, payload, Buffer.from(body.subarray(2))]))
        expect(exifOrientation(bytes)).toBe(6)
    })

    it('大端 TIFF 头（MM）兼容', () => {
        const body = encodeJpeg(4, 4, () => [0, 0, 0])
        const payload = Buffer.concat([
            Buffer.from('Exif\x00\x00', 'latin1'),
            Buffer.from(tiffWithOrientation(false, 3, 8)),
        ])
        const segLen = payload.length + 2
        const head = Buffer.from([0xff, 0xd8, 0xff, 0xe1, segLen >> 8, segLen & 0xff])
        const bytes = new Uint8Array(Buffer.concat([head, payload, Buffer.from(body.subarray(2))]))
        expect(exifOrientation(bytes)).toBe(8)
    })

    it('越界 orientation / 截断结构归 1（防御面）', () => {
        expect(exifOrientation(jpegWithExifOrientation(encodeJpeg(4, 4, () => [0, 0, 0]), 9))).toBe(1)
        // APP1 段长声明越界（截断）
        const truncated = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x7f, 0xff, 0x45, 0x78])
        expect(exifOrientation(truncated)).toBe(1)
    })
})
