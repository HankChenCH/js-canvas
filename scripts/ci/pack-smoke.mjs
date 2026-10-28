/**
 * pack 安装冒烟（工票 12 CI 腿二，对位 go tests.yml 的 GOWORK=off 消费腿）：最小
 * 渲染冒烟只消费 npm 安装后的 `node_modules/@hankchen/*`（真实消费方解析面），
 * 不触 workspace src/dist。
 *
 * 注意：本脚本由 CI 的 pack-smoke.sh 拷入独立临时目录后以该目录为 cwd 运行——
 * ESM 裸说明符按脚本文件位置解析，放仓内运行会错误命中 workspace 依赖。
 *
 * 断言面（07 号决议「最小渲染冒烟」）：
 *  - image 后端：graph JSON → decodeGraph → 默认物化（含 QR）→ renderAs 出 PNG，
 *    断言 PNG 魔数 + IHDR 尺寸；
 *  - pdf 后端：graph 带 QR 层 + 本地 PNG 图片层 + 标记文本 → renderPagesAsPdf 出
 *    PDF，断言 %PDF 头 + startxref + %%EOF 尾。QR/图片层曾因 pdfkit 对带 alpha
 *    通道 PNG 的异步收尾臂产出截断残件而被本腿剔除（工票 12 记档）——src 级修复
 *    已落（embed 前同步拍平，评审 P0-1），恢复为常驻冒烟面。
 */
import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import { deflateSync } from 'node:zlib'

import { decodeGraph, renderAs } from '@hankchen/canvas'
import { ImageRendererBackend, createDefaultResolver } from '@hankchen/canvas-image-renderer'
import { renderPagesAsPdf } from '@hankchen/canvas-pdf-renderer'

// ---- image 腿：40×30 白底 + 蓝色块 + QR（QR 物化走安装面 qrcode 传递依赖） ----

const imageDoc = decodeGraph({
    canvas: { width: 40, height: 30, background: { color: '#ffffff' } },
    layers: [
        {
            type: 'ImageLayer',
            priority: 4,
            spec: { shape: { width: 20, height: 10, backgroundColor: '#2d6cdf' }, position: { x: 10, y: 10 } },
        },
        {
            type: 'QrCodeLayer',
            priority: 4,
            spec: { shape: { width: 16, height: 16 }, position: { x: 20, y: 12 } },
            data: { valueType: 'StaticValue', value: 'https://github.com/HankChenCH/js-canvas' },
        },
    ],
})
const imageBackend = new ImageRendererBackend()
await createDefaultResolver().resolve(imageDoc, imageBackend)
const png = renderAs(imageDoc, imageBackend)

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
for (let i = 0; i < PNG_MAGIC.length; i += 1) {
    assert.equal(png[i], PNG_MAGIC[i], `PNG 魔数字节 ${i} 不符`)
}
// IHDR：宽高大端 4 字节，紧跟魔数 8 + 长度 4 + "IHDR" 4
const view = new DataView(png.buffer, png.byteOffset, png.byteLength)
assert.equal(view.getUint32(16), 40, 'PNG 宽应为 40')
assert.equal(view.getUint32(20), 30, 'PNG 高应为 30')
console.log(`pack 冒烟 image 腿: PNG ${png.length} 字节 40x30 ✓`)

// ---- pdf 腿：QR 层 + 本地 PNG 图片层 + 标记文本（多页续页语义过一遍） ----

/** 最小 PNG 编码（8 位 RGB、filter 0；同式复制自 pdf-renderer tests/helpers.ts
 *  encodePng——冒烟脚本零依赖约束下不复用测试文件） */
function solidPng(width, height, [r, g, b]) {
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
            const o = row + 1 + x * 3
            raw[o] = r
            raw[o + 1] = g
            raw[o + 2] = b
        }
    }
    const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    return Buffer.concat([signature, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

function markerPageWire(width, height, bg, text, imageSrc) {
    const layers = [
        {
            type: 'ImageLayer',
            priority: 5,
            spec: { shape: { width: 12, height: 6 }, position: { x: width - 16, y: 2 } },
            data: { valueType: 'StaticValue', value: imageSrc },
        },
    ]
    if (text !== null) {
        layers.push({
            type: 'TextLayer',
            priority: 4,
            spec: {
                shape: { width, height },
                fontFamily: { font: '', fontSize: 12, fontColor: '#111111' },
                align: { horizontal: 'left', vertical: 'top' },
                position: { x: 4, y: 4 },
            },
            data: { valueType: 'StaticValue', value: text },
        })
    }
    return { canvas: { width, height, background: { color: bg } }, layers }
}

/** QR 层 wire（含 CJK 内容：qrcode 产物恒 RGBA，pdf 侧 embed 前拍平的常驻冒烟面） */
function qrLayer(x, y, size, value) {
    return {
        type: 'QrCodeLayer',
        priority: 6,
        spec: { shape: { width: size, height: size }, position: { x, y } },
        data: { valueType: 'StaticValue', value },
    }
}

// 图片层源落脚本 cwd（pack-smoke.sh 的临时目录）；页 1 追加 QR 层后整页解码
// （wire 先组齐再过 decodeGraph，解码后形态不得混入 wire 层）
const stripPath = path.join(process.cwd(), 'pack-smoke-strip.png')
fs.writeFileSync(stripPath, solidPng(12, 6, [0x2d, 0x6c, 0xdf]))
const pageOneWire = markerPageWire(120, 80, '#ff0000', 'SMOKE-PAGE-ONE', stripPath)
pageOneWire.layers.push(qrLayer(70, 30, 32, 'pack 冒烟 二维码腿'))
const pdf = await renderPagesAsPdf([decodeGraph(pageOneWire), decodeGraph(markerPageWire(90, 60, '#00ff00', 'SMOKE-PAGE-TWO', stripPath))])

assert.equal(Buffer.from(pdf.subarray(0, 5)).toString('latin1'), '%PDF-', 'PDF 头不符')
// 尾断言取末 16 字节判 `%%EOF\n`（PDF 恒以换行收尾；subarray 是真 Uint8Array，
// latin1 解码须经 Buffer——原生 TypedArray toString 不吃编码参数）
assert.ok(
    Buffer.from(pdf.subarray(-16)).toString('latin1').endsWith('%%EOF\n'),
    'PDF 尾缺 %%EOF（产物截断）',
)
// startxref 在场：xref 表收尾完整（截断残件的字节级指纹）
assert.ok(Buffer.from(pdf).toString('latin1').includes('startxref'), 'PDF 缺 startxref（xref 表缺席）')
console.log(`pack 冒烟 pdf 腿: PDF ${pdf.length} 字节 2 页（含 QR 层 + PNG 图片层）✓`)
console.log('pack 安装冒烟通过（消费面 = npm 安装的 node_modules/@hankchen/*）')
