/**
 * 像素 seam 的测试工具（对位 go helpers_test.go：点位取样断言 + 测试图生成；
 * 像素取样即验收面）。napi canvas 无头绘图 + 同步编码/解码，零 DOM。
 */
import { createCanvas, Image, type Canvas, type SKRSContext2D } from '@napi-rs/canvas'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect } from 'vitest'

export type Painter = (ctx: SKRSContext2D) => void

/** 建透明渲染面并执行绘制 */
export function makeCanvas(width: number, height: number, paint?: Painter): { canvas: Canvas; ctx: SKRSContext2D } {
    const canvas = createCanvas(width, height)
    const ctx = canvas.getContext('2d')
    paint?.(ctx)
    return { canvas, ctx }
}

/** 逐像素填充（测试小图专用）：每像素一个 1×1 fillRect */
export function fillPixels(
    ctx: SKRSContext2D,
    width: number,
    height: number,
    pixel: (x: number, y: number) => [number, number, number, number],
): void {
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const [r, g, b, a] = pixel(x, y)
            ctx.fillStyle = `rgba(${r},${g},${b},${a / 255})`
            ctx.fillRect(x, y, 1, 1)
        }
    }
}

export function canvasPng(canvas: Canvas): Uint8Array {
    return new Uint8Array(canvas.encodeSync('png'))
}

export function canvasJpeg(canvas: Canvas): Uint8Array {
    return new Uint8Array(canvas.encodeSync('jpeg'))
}

/**
 * 解码 PNG/JPEG 字节为可取样位图。napi Image 同步只出尺寸、位图须 await
 * decode() 才可绘制（实测 1.0.13），故为异步工厂
 */
export async function decodePixels(bytes: Uint8Array): Promise<Pixels> {
    const img = new Image()
    img.src = Buffer.from(bytes)
    await img.decode()
    const { ctx } = makeCanvas(img.width, img.height)
    ctx.drawImage(img, 0, 0)
    return new Pixels(img.width, img.height, ctx.getImageData(0, 0, img.width, img.height).data)
}

export class Pixels {
    constructor(
        readonly width: number,
        readonly height: number,
        private readonly data: Uint8ClampedArray,
    ) {}

    /** 取样 (x, y) 直 alpha RGBA（napi 位图为非预乘） */
    at(x: number, y: number): [number, number, number, number] {
        const i = (y * this.width + x) * 4
        return [this.data[i]!, this.data[i + 1]!, this.data[i + 2]!, this.data[i + 3]!]
    }
}

/** 断言像素与期望逐通道相差 ≤ tol（有损编码/JPEG 容差取样，对位 assertPixelNear） */
export function expectPixelNear(
    px: Pixels,
    x: number,
    y: number,
    want: readonly [number, number, number, number],
    tol = 0,
): void {
    const got = px.at(x, y)
    for (let ch = 0; ch < 4; ch += 1) {
        const d = Math.abs(got[ch]! - want[ch]!)
        expect(d).toBeLessThanOrEqual(tol)
    }
}

/** 临时夹具目录（用完不清理，进程退出即弃——vitest 临时目录语义） */
export function tempFixtureDir(): string {
    return mkdtempSync(join(tmpdir(), 'image-renderer-test-'))
}

export function writeFixture(dir: string, name: string, bytes: Uint8Array): string {
    const p = join(dir, name)
    writeFileSync(p, bytes)
    return p
}

/**
 * 组装仅含 orientation 标签的 TIFF 块（IFD0 单条目；go exif_test.go
 * tiffWithOrientation 同式移植）
 */
export function tiffWithOrientation(
    order: 'II' | 'MM',
    type: 3 | 4,
    orientation: number,
): Uint8Array {
    const le = order === 'II'
    const view = new DataView(new ArrayBuffer(26))
    const u16 = (offset: number, v: number) => view.setUint16(offset, v, le)
    const u32 = (offset: number, v: number) => view.setUint32(offset, v, le)

    view.setUint8(0, order.charCodeAt(0))
    view.setUint8(1, order.charCodeAt(1))
    u16(2, 42) // 魔数
    u32(4, 8) // IFD0 偏移紧随头部
    u16(8, 1) // 条目数
    u16(10, 0x0112) // Orientation
    u16(12, type)
    u32(14, 1) // 计数
    if (type === 3) {
        u16(18, orientation) // SHORT 内联于值字段前 2 字节
        u16(20, 0)
    } else {
        u32(18, orientation) // LONG
    }
    u32(22, 0) // 下一 IFD 偏移
    return new Uint8Array(view.buffer)
}

/**
 * 以 jpegBody 为主体拼装 SOI + APP1(Exif) + 主体熵编码的 JPEG
 * （go exif_test.go jpegWithExifOrientation 同式移植：去掉主体自身的 SOI）
 */
export function jpegWithExifOrientation(
    jpegBody: Uint8Array,
    order: 'II' | 'MM',
    type: 3 | 4,
    orientation: number,
): Uint8Array {
    const payload = new Uint8Array(6 + 26)
    payload.set(new Uint8Array([0x45, 0x78, 0x69, 0x66, 0x00, 0x00]), 0) // "Exif\0\0"
    payload.set(tiffWithOrientation(order, type, orientation), 6)
    const segLen = payload.length + 2 // 段长字段含自身 2 字节
    const out = new Uint8Array(2 + 4 + payload.length + jpegBody.length - 2)
    out[0] = 0xff
    out[1] = 0xd8 // SOI
    out[2] = 0xff
    out[3] = 0xe1 // APP1
    out[4] = segLen >> 8
    out[5] = segLen & 0xff
    out.set(payload, 6)
    out.set(jpegBody.subarray(2), 6 + payload.length)
    return out
}
