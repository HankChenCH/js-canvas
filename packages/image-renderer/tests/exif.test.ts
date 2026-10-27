/**
 * EXIF 三段测试（go exif_test.go 同手法移植）：字节流解析（手拼 JPEG/APP1/TIFF）、
 * raw→canonical 窗口映射（手算字面量）、以及「napi 自动转正 == go applyOrientation」
 * 八向栅格互检——映射缝（04 号决议像素面口径的落地机制）的正确性以 go 期望栅格
 * 为独立事实源钉死。
 */
import { describe, expect, it } from 'vitest'

import { canvasJpeg, canvasPng, decodePixels, jpegWithExifOrientation, makeCanvas } from './helpers'
import { canonicalSourceRect, exifOrientation } from '../src/exif'

/** 8×16 上红下蓝（go twoBandExifJpeg 的源图；色度块上下分开便于集成断言） */
function twoBandJpegBody(): Uint8Array {
    const { canvas, ctx } = makeCanvas(8, 16)
    ctx.fillStyle = '#f00'
    ctx.fillRect(0, 0, 8, 8)
    ctx.fillStyle = '#00f'
    ctx.fillRect(0, 8, 8, 8)
    return canvasJpeg(canvas)
}

// ---- 解析 ----

describe('exifOrientation 字节流解析（go TestExifOrientationFromJPEGBytes 移植）', () => {
    const body = twoBandJpegBody()

    it('无 APP1 归 1', () => {
        expect(exifOrientation(body)).toBe(1)
    })

    it('II SHORT / MM SHORT / MM LONG 均解析', () => {
        expect(exifOrientation(jpegWithExifOrientation(body, 'II', 3, 6))).toBe(6)
        expect(exifOrientation(jpegWithExifOrientation(body, 'MM', 3, 8))).toBe(8)
        expect(exifOrientation(jpegWithExifOrientation(body, 'MM', 4, 3))).toBe(3)
    })

    it('越界值（>8）归 1', () => {
        expect(exifOrientation(jpegWithExifOrientation(body, 'II', 3, 9))).toBe(1)
    })

    it('非 JPEG（PNG 不携带该 EXIF 结构）归 1', () => {
        const { canvas } = makeCanvas(8, 16)
        expect(exifOrientation(canvasPng(canvas))).toBe(1)
    })

    it('截断字节流归 1', () => {
        expect(exifOrientation(jpegWithExifOrientation(body, 'II', 3, 6).subarray(0, 10))).toBe(1)
        expect(exifOrientation(new Uint8Array([0xff, 0xd8]))).toBe(1)
    })
})

// ---- raw→canonical 窗口映射 ----

describe('canonicalSourceRect raw→canonical 窗口映射（手算字面量）', () => {
    // raw 48×32，窗口 (10,5,8,6)；期望值由「canonical(dx,dy)=raw(sx,sy)」八向公式
    // 手工反解（独立事实源，与实现同构即失败）
    const sw = 48
    const sh = 32
    const raw = { x: 10, y: 5, width: 8, height: 6 }

    const want: Record<number, { x: number; y: number; width: number; height: number }> = {
        1: { x: 10, y: 5, width: 8, height: 6 },
        // 2–4 镜像族：维度不变，原点按镜像轴翻折
        2: { x: 30, y: 5, width: 8, height: 6 },
        3: { x: 30, y: 21, width: 8, height: 6 },
        4: { x: 10, y: 21, width: 8, height: 6 },
        // 5–8 旋转族：宽高互换，原点按转置轴翻折
        5: { x: 5, y: 10, width: 6, height: 8 },
        6: { x: 21, y: 10, width: 6, height: 8 },
        7: { x: 21, y: 30, width: 6, height: 8 },
        8: { x: 5, y: 30, width: 6, height: 8 },
    }

    for (const orientation of [1, 2, 3, 4, 5, 6, 7, 8]) {
        it(`orientation ${orientation}`, () => {
            expect(canonicalSourceRect(raw, orientation, sw, sh)).toEqual(want[orientation])
        })
    }
})

// ---- napi 自动转正与 go applyOrientation 互检 ----

/**
 * 3×2 字母栅格 A B C / D E F 放大到 48×32（每格 16×16，格心远离 JPEG 块边界），
 * 期望栅格 = go exif_test.go TestApplyOrientationAllDirections 的独立事实源
 * （栅格行按 / 分隔；5–8 为 90° 族，宽高互换）
 */
const LETTERS = 'ABCDEF'
const EXPECTED_GRID: Record<number, string> = {
    1: 'ABC/DEF',
    2: 'CBA/FED', // 水平镜像
    3: 'FED/CBA', // 旋转 180°
    4: 'DEF/ABC', // 垂直镜像
    5: 'AD/BE/CF', // 转置（主对角镜像）
    6: 'DA/EB/FC', // 旋转 90° 顺时针
    7: 'FC/EB/DA', // 反转置（反对角镜像）
    8: 'CF/BE/AD', // 旋转 90° 逆时针
}

function letterGridJpegWithExif(orientation: number): Uint8Array {
    const cell = 16
    const { canvas, ctx } = makeCanvas(3 * cell, 2 * cell)
    for (let i = 0; i < LETTERS.length; i += 1) {
        const x = (i % 3) * cell
        const y = Math.floor(i / 3) * cell
        ctx.fillStyle = `rgb(${i * 40},0,0)`
        ctx.fillRect(x, y, cell, cell)
    }
    return jpegWithExifOrientation(canvasJpeg(canvas), 'II', 3, orientation)
}

describe('napi 自动转正 == go applyOrientation（八向栅格互检）', () => {
    for (const orientation of [1, 2, 3, 4, 5, 6, 7, 8]) {
        it(`orientation ${orientation}: ${EXPECTED_GRID[orientation]}`, async () => {
            const px = await decodePixels(letterGridJpegWithExif(orientation))
            const rows = EXPECTED_GRID[orientation]!.split('/')
            expect(px.width).toBe(rows[0]!.length * 16)
            expect(px.height).toBe(rows.length * 16)

            // 格心取样；JPEG 有损容差按色阶半格 20（格心距块边界远，稳定落在档内）
            for (let gy = 0; gy < rows.length; gy += 1) {
                for (let gx = 0; gx < rows[gy]!.length; gx += 1) {
                    const [r] = px.at(gx * 16 + 8, gy * 16 + 8)
                    const letter = LETTERS[Math.round(r! / 40)]
                    expect(letter, `canonical 格 (${gx}, ${gy})`).toBe(rows[gy]![gx])
                }
            }
        })
    }
})
