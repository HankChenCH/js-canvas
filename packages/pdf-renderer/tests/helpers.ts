/**
 * 测试工具（对位 go pdf-renderer helpers_test.go 的手法平移）：
 * - 纯 JS 夹具编码：PNG（zlib deflate 手拼）/ JPEG（jpeg-js）/ EXIF APP1 拼装
 *   （对位 go tiffWithOrientation + jpegWithExifOrientation 手法）；
 * - poppler 四件套包装（pdfinfo/pdftoppm/pdftotext/pdffonts）+ PPM 栅格取样断言；
 *   无黄金文件：结构断言 + 实心区内部点取样（-r 96 恰好 1:1 还原像素网格）；
 * - CJK 字体探针（单体 TTF，缺席 skip，对位 go probeCJKFont）。
 * poppler 四件套在场时跑结构断言，缺席 describe.skip（工票 11 明写「在场时跑」，
 * 与 go 的 Fatal 不同）。
 */
import { execFileSync } from 'node:child_process'
import { deflateSync } from 'node:zlib'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import jpeg from 'jpeg-js'
import { expect } from 'vitest'

/** 像素取值器：返回 [r, g, b] */
export type PixelFn = (x: number, y: number) => readonly [number, number, number]

export function solidPixel(color: readonly [number, number, number]): PixelFn {
    return () => color
}

// ---- PNG 编码（最小实现：8 位 RGB、filter 0、无隔行）----

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function crc32(buf: Buffer): number {
    let table = CRC_TABLE
    let crc = 0xffffffff
    for (const byte of buf) {
        crc = (crc >>> 8) ^ table[(crc ^ byte) & 0xff]!
    }
    return (crc ^ 0xffffffff) >>> 0
}

const CRC_TABLE = (() => {
    const table = new Array<number>(256)
    for (let n = 0; n < 256; n += 1) {
        let c = n
        for (let k = 0; k < 8; k += 1) {
            c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
        }
        table[n] = c
    }
    return table
})()

function pngChunk(type: string, data: Buffer): Buffer {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body))
    return Buffer.concat([len, body, crc])
}

/** 编码最小 PNG（8 位 RGB、filter 0）。魔数嗅探与 IHDR 尺寸解析的真实载体 */
export function encodePng(width: number, height: number, pixel: PixelFn): Uint8Array {
    const ihdr = Buffer.alloc(13)
    ihdr.writeUInt32BE(width, 0)
    ihdr.writeUInt32BE(height, 4)
    ihdr[8] = 8 // bit depth
    ihdr[9] = 2 // color type: RGB
    const raw = Buffer.alloc(height * (1 + width * 3))
    for (let y = 0; y < height; y += 1) {
        const row = y * (1 + width * 3)
        raw[row] = 0 // filter none
        for (let x = 0; x < width; x += 1) {
            const [r, g, b] = pixel(x, y)
            const o = row + 1 + x * 3
            raw[o] = r
            raw[o + 1] = g
            raw[o + 2] = b
        }
    }
    return new Uint8Array(
        Buffer.concat([
            PNG_SIGNATURE,
            pngChunk('IHDR', ihdr),
            pngChunk('IDAT', deflateSync(raw)),
            pngChunk('IEND', Buffer.alloc(0)),
        ]),
    )
}

/** RGBA 像素取值器：返回 [r, g, b, a] */
export type RgbaPixelFn = (x: number, y: number) => readonly [number, number, number, number]

/**
 * 编码 8 位 RGBA PNG（colorType 6、filter 0、非隔行）。评审 P0-1 夹具盲区的补口：
 * `qrcode` 包物化产物与带 alpha 的用户图恒为此形态——此前 helpers 只产 RGB，
 * RGBA 嵌入截断问题无测试可达
 */
export function encodePngRgba(width: number, height: number, pixel: RgbaPixelFn): Uint8Array {
    const ihdr = Buffer.alloc(13)
    ihdr.writeUInt32BE(width, 0)
    ihdr.writeUInt32BE(height, 4)
    ihdr[8] = 8 // bit depth
    ihdr[9] = 6 // color type: RGBA
    const raw = Buffer.alloc(height * (1 + width * 4))
    for (let y = 0; y < height; y += 1) {
        const row = y * (1 + width * 4)
        raw[row] = 0 // filter none
        for (let x = 0; x < width; x += 1) {
            const [r, g, b, a] = pixel(x, y)
            const o = row + 1 + x * 4
            raw[o] = r
            raw[o + 1] = g
            raw[o + 2] = b
            raw[o + 3] = a
        }
    }
    return new Uint8Array(
        Buffer.concat([
            PNG_SIGNATURE,
            pngChunk('IHDR', ihdr),
            pngChunk('IDAT', deflateSync(raw)),
            pngChunk('IEND', Buffer.alloc(0)),
        ]),
    )
}

/**
 * 编码 8 位调色板 PNG + tRNS 透明色板（colorType 3 + tRNS）：pdfkit 的
 * loadIndexedAlphaChannel() 异步臂（与 RGBA 的 splitAlphaChannel 同门截断）
 * 的夹具载体。palette 为 RGB 三元组数组，alphaByIndex 与之等长（255 = 不透明）
 */
export function encodePngPaletteTrns(width: number, height: number, palette: ReadonlyArray<readonly [number, number, number]>, alphaByIndex: ReadonlyArray<number>, indexAt: (x: number, y: number) => number): Uint8Array {
    const ihdr = Buffer.alloc(13)
    ihdr.writeUInt32BE(width, 0)
    ihdr.writeUInt32BE(height, 4)
    ihdr[8] = 8 // bit depth
    ihdr[9] = 3 // color type: indexed
    const plte = Buffer.alloc(palette.length * 3)
    palette.forEach(([r, g, b], i) => {
        plte[i * 3] = r
        plte[i * 3 + 1] = g
        plte[i * 3 + 2] = b
    })
    const trns = Buffer.from(alphaByIndex)
    const raw = Buffer.alloc(height * (1 + width))
    for (let y = 0; y < height; y += 1) {
        const row = y * (1 + width)
        raw[row] = 0 // filter none
        for (let x = 0; x < width; x += 1) {
            raw[row + 1 + x] = indexAt(x, y)
        }
    }
    return new Uint8Array(
        Buffer.concat([
            PNG_SIGNATURE,
            pngChunk('IHDR', ihdr),
            pngChunk('PLTE', plte),
            pngChunk('tRNS', trns),
            pngChunk('IDAT', deflateSync(raw)),
            pngChunk('IEND', Buffer.alloc(0)),
        ]),
    )
}

/**
 * 隔行（Adam7）标记的 PNG 头夹具：IHDR interlace=1 + 占位 IDAT。仅供「隔行输入
 * 响亮报错」断言用——拍平器不支持 Adam7 重构，PDF 产物守门在报错面而非字节面
 */
export function encodePngInterlacedStub(width: number, height: number): Uint8Array {
    const ihdr = Buffer.alloc(13)
    ihdr.writeUInt32BE(width, 0)
    ihdr.writeUInt32BE(height, 4)
    ihdr[8] = 8
    ihdr[9] = 2 // RGB
    ihdr[12] = 1 // interlace: Adam7
    return new Uint8Array(
        Buffer.concat([
            PNG_SIGNATURE,
            pngChunk('IHDR', ihdr),
            pngChunk('IDAT', deflateSync(Buffer.alloc(8))),
            pngChunk('IEND', Buffer.alloc(0)),
        ]),
    )
}

// ---- JPEG 编码（jpeg-js，测试专用 devDep）与 EXIF APP1 拼装 ----

/** 编码基线 JPEG（jpeg-js 默认质量） */
export function encodeJpeg(width: number, height: number, pixel: PixelFn): Uint8Array {
    const data = Buffer.alloc(width * height * 4)
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const [r, g, b] = pixel(x, y)
            const o = (y * width + x) * 4
            data[o] = r
            data[o + 1] = g
            data[o + 2] = b
            data[o + 3] = 255
        }
    }
    const out = jpeg.encode({ data, width, height }, 95)
    return new Uint8Array(out.data)
}

/** 组装仅含 orientation 标签的 TIFF 块（IFD0 单条目；对位 go tiffWithOrientation） */
export function tiffWithOrientation(littleEndian: boolean, type: 3 | 4, orientation: number): Uint8Array {
    const chunks: Buffer[] = []
    const u16 = (v: number) => {
        const b = Buffer.alloc(2)
        b[littleEndian ? 'writeUInt16LE' : 'writeUInt16BE'](v)
        return b
    }
    const u32 = (v: number) => {
        const b = Buffer.alloc(4)
        b[littleEndian ? 'writeUInt32LE' : 'writeUInt32BE'](v)
        return b
    }
    chunks.push(Buffer.from(littleEndian ? 'II' : 'MM', 'latin1'))
    chunks.push(u16(42)) // 魔数
    chunks.push(u32(8)) // IFD0 偏移紧随头部
    chunks.push(u16(1)) // 条目数
    chunks.push(u16(0x0112)) // Orientation
    chunks.push(u16(type))
    chunks.push(u32(1)) // 计数
    if (type === 3) {
        chunks.push(u16(orientation))
        chunks.push(u16(0)) // SHORT 内联于值字段前 2 字节
    } else {
        chunks.push(u32(orientation)) // LONG
    }
    chunks.push(u32(0)) // 下一 IFD 偏移
    return new Uint8Array(Buffer.concat(chunks))
}

/** 以 body 为主体拼装 SOI + APP1(Exif) + 主体熵编码的 JPEG（对位 go jpegWithExifOrientation） */
export function jpegWithExifOrientation(body: Uint8Array, orientation: number): Uint8Array {
    const payload = Buffer.concat([
        Buffer.from('Exif\x00\x00', 'latin1'),
        Buffer.from(tiffWithOrientation(true, 3, orientation)),
    ])
    const segLen = payload.length + 2 // 段长字段含自身 2 字节
    const head = Buffer.from([0xff, 0xd8, 0xff, 0xe1, segLen >> 8, segLen & 0xff])
    // 去掉主体自身的 SOI（前 2 字节）
    return new Uint8Array(Buffer.concat([head, payload, Buffer.from(body.subarray(2))]))
}

/** 8×16 上红下蓝、带指定 EXIF orientation 的 JPEG（对位 go twoBandExifJpeg） */
export function twoBandExifJpeg(orientation: number): Uint8Array {
    return jpegWithExifOrientation(encodeJpeg(8, 16, (_x, y) => (y < 8 ? [255, 0, 0] : [0, 0, 255])), orientation)
}

/** 左右分色 PNG（splitX 为分界列；对位 go twoColorPng） */
export function twoColorPng(width: number, height: number, one: readonly [number, number, number], other: readonly [number, number, number], splitX: number): Uint8Array {
    return encodePng(width, height, (x) => (x < splitX ? one : other))
}

// ---- 格式魔数夹具（拒收测试用；嗅探先于解码，前缀字节即足） ----

export const GIF_MAGIC = new Uint8Array(Buffer.from('GIF89a\x01\x00\x01\x00', 'latin1'))
export const BMP_MAGIC = new Uint8Array(Buffer.from('BM\x00\x00\x00\x00', 'latin1'))
export const WEBP_MAGIC = new Uint8Array(Buffer.from('RIFF\x00\x00\x00\x00WEBPVP8 ', 'latin1'))

// ---- 临时文件 ----

export function writeTemp(name: string, data: Uint8Array, dir?: string): string {
    const target = dir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-renderer-test-'))
    const p = path.join(target, name)
    fs.writeFileSync(p, data)
    return p
}

export function makeTempDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-renderer-test-'))
}

// ---- poppler 四件套 ----

const POPPLER_BIN = '/opt/homebrew/bin'

function tool(name: string): string {
    return process.env.PDF_RENDERER_POPPLER_DIR
        ? path.join(process.env.PDF_RENDERER_POPPLER_DIR, name)
        : path.join(POPPLER_BIN, name)
}

/** poppler 四件套是否在场（缺席则结构断言腿整体 skip） */
export function popplerAvailable(): boolean {
    return ['pdfinfo', 'pdftoppm', 'pdftotext', 'pdffonts'].every((t) => fs.existsSync(tool(t)))
}

export function runPoppler(toolName: string, args: string[]): string {
    // utf8：pdftotext 的 ToUnicode 提取输出 UTF-8（latin1 读会出 mojibake）；
    // PPM 二进制不走本函数（fs 直读）
    return execFileSync(tool(toolName), args, { encoding: 'utf8' })
}

/** pdf 落临时盘后交 poppler（四件套都只吃文件） */
export function withPdfFile<T>(pdf: Uint8Array, fn: (pdfPath: string) => T): T {
    const dir = makeTempDir()
    const p = writeTemp('probe.pdf', pdf, dir)
    try {
        return fn(p)
    } finally {
        fs.rmSync(dir, { recursive: true, force: true })
    }
}

/**
 * 产物完整性守门（评审 P0-1 回归断言面）：%PDF 头 + startxref（xref 表在）+
 * %%EOF 尾在场。RGBA 截断史的残件缺 startxref/trailer——pdfinfo 读通之外的
 * 字节级逃逸检测，不依赖 poppler 在场
 */
export function expectWellFormedPdf(pdf: Uint8Array): void {
    const text = Buffer.from(pdf).toString('latin1')
    expect(text.startsWith('%PDF-'), '产物缺 %PDF 头').toBe(true)
    expect(text, '产物缺 startxref（xref 表缺席 = 截断残件）').toContain('startxref')
    expect(text.trimEnd().endsWith('%%EOF'), '产物缺 %%EOF 尾（截断残件）').toBe(true)
}

/** pdfinfo 输出取「key: value」字段值 */
export function pdfInfoField(info: string, key: string): string {
    for (const line of info.split('\n')) {
        const prefix = `${key}:`
        if (line.startsWith(prefix)) {
            return line.slice(prefix.length).trim()
        }
    }
    throw new Error(`pdfinfo 输出缺字段 ${key}:\n${info}`)
}

/** pdfinfo 结构断言辅助：页尺寸字段值 = px × 0.75 pt（与后端同一换算点） */
export function expectPageSize(widthPx: number, heightPx: number): string {
    return `${fmt(widthPx * 0.75)} x ${fmt(heightPx * 0.75)} pts`
}

/** pdfinfo 的 %g 尺寸格式（整数不带小数点） */
function fmt(n: number): string {
    return String(n)
}

/** PPM(P6) 栅格：取样用 */
export interface PpmImage {
    width: number
    height: number
    data: Uint8Array
}

/** pdftoppm 栅格化为 PPM（P6 二进制，免 PNG 解码依赖） */
export function rasterizePage(pdf: Uint8Array, page: number, width: number, height: number): PpmImage {
    return withPdfFile(pdf, (p) => {
        const dir = makeTempDir()
        try {
            const base = path.join(dir, 'grid')
            runPoppler('pdftoppm', ['-r', '96', '-singlefile', '-f', String(page), '-l', String(page), p, base])
            const ppmPath = `${base}.ppm`
            const buf = fs.readFileSync(ppmPath)
            const m = buf.subarray(0, 64).toString('latin1').match(/^P6\s+(\d+)\s+(\d+)\s+(\d+)\s/)
            if (!m) throw new Error(`pdftoppm 输出不可解析（非 P6）: ${ppmPath}`)
            const img: PpmImage = {
                width: Number(m[1]),
                height: Number(m[2]),
                data: buf.subarray(m[0].length),
            }
            if (img.width !== width || img.height !== height) {
                throw new Error(`栅格化尺寸 = ${img.width}x${img.height}, want ${width}x${height}（-r 96 应 1:1 还原像素网格）`)
            }
            return img
        } finally {
            fs.rmSync(dir, { recursive: true, force: true })
        }
    })
}

export function samplePixel(img: PpmImage, x: number, y: number): [number, number, number] {
    const o = (y * img.width + x) * 3
    return [img.data[o]!, img.data[o + 1]!, img.data[o + 2]!]
}

export function expectPixel(img: PpmImage, x: number, y: number, want: readonly [number, number, number]): void {
    const got = samplePixel(img, x, y)
    const near = got.every((v, i) => Math.abs(v - want[i]!) <= 0)
    if (!near) {
        throw new Error(`像素 (${x}, ${y}) = [${got.join(',')}], want [${want.join(',')}]`)
    }
}

/** 容差取样（矢量抗锯齿/有损编码） */
export function expectPixelNear(img: PpmImage, x: number, y: number, want: readonly [number, number, number], tol: number): void {
    const got = samplePixel(img, x, y)
    const far = got.findIndex((v, i) => Math.abs(v - want[i]!) > tol)
    if (far >= 0) {
        throw new Error(`像素 (${x}, ${y}) 通道 ${far} = ${got[far]}, 与 ${want[far]} 相差超容差 ${tol}（实际 [${got.join(',')}]）`)
    }
}

/** pdftotext 按页提取 */
export function pageText(pdf: Uint8Array, page: number): string {
    return withPdfFile(pdf, (p) => runPoppler('pdftotext', ['-f', String(page), '-l', String(page), p, '-']))
}

/** pdffonts 原始输出 */
export function pdfFonts(pdf: Uint8Array): string {
    return withPdfFile(pdf, (p) => runPoppler('pdffonts', [p]))
}

// ---- CJK 字体探针（单体 TTF；TTC 拒收口径一致） ----

/** 取可用 CJK 单体 TTF：环境变量优先，再探 CI 显式安装与 macOS 自带；全缺返回 null（调用方 skip） */
export function probeCjkFont(): string | null {
    const candidates = [
        ...(process.env.JS_CANVAS_TEST_CJK_FONT ? [process.env.JS_CANVAS_TEST_CJK_FONT] : []),
        '/usr/share/fonts/truetype/fonts-ipafont-gothic/ipag.ttf',
        '/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf',
        '/System/Library/Fonts/Supplemental/Arial Unicode.ttf',
    ]
    for (const c of candidates) {
        try {
            const data = fs.readFileSync(c)
            if (data.subarray(0, 4).toString('latin1') === 'ttcf') continue // 字体集不认
            return c
        } catch {
            // 缺席探下一个
        }
    }
    return null
}

// ---- 颜色常量（对位 go helpers_test 共享色值） ----

export const RED: readonly [number, number, number] = [255, 0, 0]
export const GREEN: readonly [number, number, number] = [0, 255, 0]
export const BLUE: readonly [number, number, number] = [0, 0, 255]
export const WHITE: readonly [number, number, number] = [255, 255, 255]
