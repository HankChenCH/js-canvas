/**
 * 二维码物化测试（go qr_test.go 移植验收面）：PNG 魔数、napi 可解码为正方形位图、
 * 整数块宽量化区间、margin=0（finder 角点即墨）、纯黑/纯白不透明、同输入确定性、
 * 宽 ≤0 钳 1、三种编码模式路径（numeric/alphanumeric/byte，无 Kanji 分支）。
 */
import { describe, expect, it } from 'vitest'

import { QRCodeMaterializer } from '../src/qr'
import { decodePixels, expectPixelNear } from './helpers'

const SAMPLE_TEXT = 'https://example.com/go-canvas'

async function materializeSample(width: number, text = SAMPLE_TEXT): Promise<Uint8Array> {
    return new QRCodeMaterializer().materialize(text, width)
}

describe('QRCodeMaterializer（对位 go qr.go QRMaterializer）', () => {
    it('产物 PNG 魔数 + 可解码为位图（工票验收面）', async () => {
        const data = await materializeSample(200)
        expect(Array.from(data.subarray(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47])
        const px = await decodePixels(data)
        expect(px.width).toBeGreaterThan(0)
    })

    it('正方形容器 + 整数块宽量化：边长 ∈ (目标宽/2, 目标宽]', async () => {
        const px = await decodePixels(await materializeSample(200))
        expect(px.width).toBe(px.height)
        // 块宽 = size/模块数 向零截断（对位 go WithQRWidth 整数块宽）：
        // 产物不超目标宽，量化至多损失一个块宽
        expect(px.width).toBeLessThanOrEqual(200)
        expect(px.width).toBeGreaterThan(100)
    })

    it('margin=0（库默认静区显式归零）：finder 外圈落在原点，原点即墨', async () => {
        const px = await decodePixels(await materializeSample(200))
        expectPixelNear(px, 0, 0, [0, 0, 0, 255])
    })

    it('纯黑前景/纯白背景、全程不透明', async () => {
        const px = await decodePixels(await materializeSample(120))
        for (let y = 0; y < px.height; y += 1) {
            for (let x = 0; x < px.width; x += 1) {
                const [r, g, b, a] = px.at(x, y)
                const black = r === 0 && g === 0 && b === 0 && a === 255
                const white = r === 255 && g === 255 && b === 255 && a === 255
                expect(black || white, `像素 (${x}, ${y}) 只允许纯黑/纯白`).toBe(true)
            }
        }
    })

    it('同输入两次产物逐字节一致（缓存键语义的前提）', async () => {
        const first = await materializeSample(200)
        const second = await materializeSample(200)
        expect(Array.from(first)).toEqual(Array.from(second))
    })

    it('宽 ≤0 钳到 1：退化为块宽 1 的最小可用二维码（size=max(图层宽,1)）', async () => {
        for (const width of [0, -5]) {
            const px = await decodePixels(await materializeSample(width))
            expect(px.width).toBe(px.height)
            expect(px.width).toBeGreaterThanOrEqual(21) // QR 最小版本模块数
        }
    })

    it('三种编码模式路径全通（numeric/alphanumeric/byte，无 Kanji 分支——bacon chooseMode 复刻）', async () => {
        for (const text of ['1234567890', 'HTTPS://EXAMPLE.COM/GO-CANVAS', '中文内容+https://example.com']) {
            const px = await decodePixels(await materializeSample(160, text))
            expectPixelNear(px, 0, 0, [0, 0, 0, 255])
        }
    })
})
