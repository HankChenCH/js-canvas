import { describe, expect, it } from 'vitest'

import { anchorOffset, contentHeight, contentWidth, layerHeight, lineHeightPx } from '../../src/index'
import type { Anchor, TextLayer } from '../../src/index'

/** 平移 php-canvas-next PositionResolverTest：九锚点逐值 + 负溢出不钳位 */
describe('九锚点偏移（anchorOffset）', () => {
    const PARENT_W = 100
    const PARENT_H = 80
    const CHILD_W = 20
    const CHILD_H = 10

    const cases: Array<[Anchor, number, number]> = [
        ['top-left', 0, 0],
        ['top', 40, 0],
        ['top-right', 80, 0],
        ['left', 0, 35],
        ['center', 40, 35],
        ['right', 80, 35],
        ['bottom-left', 0, 70],
        ['bottom', 40, 70],
        ['bottom-right', 80, 70],
    ]

    it.each(cases)('锚点 %s → (%i, %i)', (anchor, x, y) => {
        expect(anchorOffset(anchor, PARENT_W, PARENT_H, CHILD_W, CHILD_H)).toEqual({ x, y })
    })

    it('子层大于父盒：负偏移即溢出摆放，不钳位（平移 testChildLargerThanParentAllowsNegativeOverflow）', () => {
        expect(anchorOffset('bottom-right', 10, 10, 50, 50)).toEqual({ x: -40, y: -40 })
    })

    it('中心锚点向零截断（PHP intval），含负半值', () => {
        // (100 - 21) / 2 = 39.5 → 39；(80 - 11) / 2 = 34.5 → 34
        expect(anchorOffset('center', 100, 80, 21, 11)).toEqual({ x: 39, y: 34 })
        // (10 - 21) / 2 = -5.5 → -5（向零，非向下取整）
        expect(anchorOffset('center', 10, 10, 21, 21)).toEqual({ x: -5, y: -5 })
        // 负半值归零不出现 -0：(10 - 11) / 2 = -0.5 → 0
        expect(anchorOffset('center', 10, 10, 11, 11)).toEqual({ x: 0, y: 0 })
    })
})

/** 平移 TextLayerTest/QrCodeLayerTest 的动态高度用例（不经过断行器的部分） */
describe('动态尺寸（layerHeight/内容盒）', () => {
    function textLayer(overrides: Partial<TextLayer>): TextLayer {
        return {
            type: 'TextLayer',
            priority: 0,
            shape: {
                width: 100,
                height: 0,
                autoWidth: false,
                autoHeight: true,
                lineHeight: 1,
                padding: { top: 0, bottom: 0, left: 0, right: 0 },
                border: { top: null, bottom: null, left: null, right: null },
                backgroundColor: null,
            },
            align: { horizontal: 'left', vertical: 'bottom' },
            position: { x: 0, y: 0, anchor: 'top-left' },
            text: '',
            font: '',
            fontSize: 12,
            fontColor: '#000000',
            angle: 0,
            autowrap: false,
            ...overrides,
        }
    }

    it('固定高直接返回声明值（平移 testFixedHeightReturnsDeclaredHeight）', () => {
        const layer = textLayer({ shape: { ...textLayer({}).shape, width: 100, height: 40, autoHeight: false }, text: '内容' })
        expect(layerHeight(layer)).toBe(40)
    })

    it('autoHeight 单行 = 行高（平移 testAutoHeightSingleLineUsesLineHeight）', () => {
        const layer = textLayer({ fontSize: 20, text: '内容' })
        expect(layerHeight(layer)).toBe(20)
    })

    it('autoHeight 空文本只剩纵向 padding（平移 testAutoHeightPaddingOnlyWhenTextEmpty）', () => {
        const layer = textLayer({ shape: { ...textLayer({}).shape, padding: { top: 10, bottom: 10, left: 0, right: 0 } } })
        expect(layerHeight(layer)).toBe(20)
    })

    it('autoHeight 尊重行高倍数（平移 testAutoHeightRespectsLineHeight）', () => {
        const layer = textLayer({ fontSize: 20, text: '内容', shape: { ...textLayer({}).shape, lineHeight: 1.5 } })
        expect(lineHeightPx(layer)).toBe(30)
        expect(layerHeight(layer)).toBe(30)
    })

    it('autowrap 的行数依赖断行器：内容盒宽 50、字号 10 → 两行（工单 03 接入默认断行器）', () => {
        const layer = textLayer({
            shape: { ...textLayer({}).shape, width: 50 },
            fontSize: 10,
            text: '一二三四五六七',
            autowrap: true,
        })
        expect(layerHeight(layer)).toBe(20)
    })

    it('内容盒扣减 padding 且向零截断（平移 testContentSizeSubtractsPadding）', () => {
        const image = {
            type: 'ImageLayer',
            priority: 0,
            shape: {
                width: 100,
                height: 50,
                autoWidth: false,
                autoHeight: false,
                lineHeight: 1,
                padding: { top: 10, bottom: 10, left: 20, right: 20 },
                border: { top: null, bottom: null, left: null, right: null },
                backgroundColor: null,
            },
            align: { horizontal: 'center', vertical: 'center' },
            position: { x: 0, y: 0, anchor: 'top-left' },
            src: null,
        } as const

        expect(contentWidth(image)).toBe(60)
        expect(contentHeight(image)).toBe(30)
    })

    it('QR 声明高优先生效（平移 testDeclaredHeightWinsWhenNotAuto）', () => {
        const qr = {
            type: 'QrCodeLayer',
            priority: 0,
            shape: {
                width: 80,
                height: 40,
                autoWidth: false,
                autoHeight: false,
                lineHeight: 1,
                padding: { top: 0, bottom: 0, left: 0, right: 0 },
                border: { top: null, bottom: null, left: null, right: null },
                backgroundColor: null,
            },
            align: { horizontal: 'left', vertical: 'top' },
            position: { x: 0, y: 0, anchor: 'top-left' },
            value: 'https://example.com',
        } as const
        expect(layerHeight(qr)).toBe(40)
    })

    it('QR 无有效高时按宽兜底正方形（平移 testHeightFallsBackToWidth）', () => {
        const autoQr = {
            type: 'QrCodeLayer',
            priority: 0,
            shape: {
                width: 60,
                height: 0,
                autoWidth: false,
                autoHeight: true,
                lineHeight: 1,
                padding: { top: 0, bottom: 0, left: 0, right: 0 },
                border: { top: null, bottom: null, left: null, right: null },
                backgroundColor: null,
            },
            align: { horizontal: 'left', vertical: 'top' },
            position: { x: 0, y: 0, anchor: 'top-left' },
            value: 'https://example.com',
        } as const
        expect(layerHeight(autoQr)).toBe(60)
    })
})
