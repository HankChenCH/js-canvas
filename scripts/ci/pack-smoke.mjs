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
 *  - pdf 后端：页序列 → renderPagesAsPdf 出 PDF，断言 %PDF 头 + %%EOF 尾。
 *    pdf 腿不放 QR/图片层——pdfkit 对带 alpha 通道的 PNG 走异步分派、产物截断且
 *    无报错（工票 12 实测的 src 级问题，报告记档），冒烟不放行残缺产物路径。
 */
import assert from 'node:assert'

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

// ---- pdf 腿：两页两尺寸两底色 + 默认字体标记文本（多页续页语义过一遍） ----

function markerPage(width, height, bg, text) {
    return decodeGraph({
        canvas: { width, height, background: { color: bg } },
        layers: [
            {
                type: 'TextLayer',
                priority: 4,
                spec: {
                    shape: { width, height },
                    fontFamily: { font: '', fontSize: 12, fontColor: '#111111' },
                    align: { horizontal: 'left', vertical: 'top' },
                    position: { x: 4, y: 4 },
                },
                data: { valueType: 'StaticValue', value: text },
            },
        ],
    })
}
const pdf = await renderPagesAsPdf([markerPage(120, 80, '#ff0000', 'SMOKE-PAGE-ONE'), markerPage(90, 60, '#00ff00', 'SMOKE-PAGE-TWO')])

assert.equal(Buffer.from(pdf.subarray(0, 5)).toString('latin1'), '%PDF-', 'PDF 头不符')
// 尾断言取末 16 字节判 `%%EOF\n`（PDF 恒以换行收尾；subarray 是真 Uint8Array，
// latin1 解码须经 Buffer——原生 TypedArray toString 不吃编码参数）
assert.ok(
    Buffer.from(pdf.subarray(-16)).toString('latin1').endsWith('%%EOF\n'),
    'PDF 尾缺 %%EOF（产物截断）',
)
console.log(`pack 冒烟 pdf 腿: PDF ${pdf.length} 字节 2 页 ✓`)
console.log('pack 安装冒烟通过（消费面 = npm 安装的 node_modules/@hankchen/*）')
