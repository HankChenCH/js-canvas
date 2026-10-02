import { describe, expect, it } from 'vitest'

import {
    createMeasureTextMeasurerFactory,
    layerWidth,
    type MeasureTextSource,
    type TextLayer,
} from '../../src/index'

/**
 * measureText 度量器工厂（autowidth-content-injection 工单 04）：canvas 2D context
 * 按图层字体引用与字号构造度量器——每次度量前设置 ctx.font 简写、宽度取
 * metrics.width 原样浮点（取整决策留在求值点，layerWidth ceil）。导出面与启发式
 * 工厂并列，经 TextLayoutPolicies.measurerFactory 由宿主显式注入（增强模式不隐式
 * 切换）。canvas-next 零 DOM：上下文按最小结构面（MeasureTextSource）接纳，
 * CanvasRenderingContext2D 结构兼容。
 */

/** ctx 结构替身：记录 font 简写设置，measureText 按注入函数返回宽度 */
function stubContext(measure: (text: string) => number): { context: MeasureTextSource; seenFonts: string[] } {
    const seenFonts: string[] = []
    let fontValue = ''
    const context: MeasureTextSource = {
        get font() {
            return fontValue
        },
        set font(value: string) {
            fontValue = value
            seenFonts.push(value)
        },
        measureText(text: string) {
            return { width: measure(text) }
        },
    }
    return { context, seenFonts }
}

function textLayer(overrides: Partial<TextLayer>): TextLayer {
    return {
        type: 'TextLayer',
        name: '',
        visible: true,
        priority: 0,
        shape: {
            width: 100,
            height: 0,
            autoWidth: true,
            autoHeight: false,
            lineHeight: 1,
            padding: { top: 0, bottom: 0, left: 0, right: 0 },
            border: { top: null, bottom: null, left: null, right: null },
            backgroundColor: null,
        },
        align: { horizontal: 'left', vertical: 'bottom' },
        position: { x: 0, y: 0, anchor: 'top-left' },
        text: '',
        expression: null,
        font: '',
        fontSize: 12,
        fontColor: '#000000',
        angle: 0,
        autowrap: false,
        ...overrides,
    }
}

describe('measureText 度量器工厂', () => {
    it('度量走 context.measureText：宽度取 metrics.width 原样浮点，不在此取整', () => {
        const { context } = stubContext((text) => text.length * 19.3)
        const factory = createMeasureTextMeasurerFactory(context)

        expect(factory('sans-serif', 24).measure('ab')).toBe(38.6)
    })

    it('每次度量前设置 ctx.font 简写 = 字号 px + 字体引用（缺省恒等映射，仅适合 CSS 安全引用）', () => {
        const { context, seenFonts } = stubContext((text) => text.length * 10)
        const measurer = createMeasureTextMeasurerFactory(context)('Georgia', 24)

        expect(seenFonts).toEqual([]) // 构造期不设 font，度量期才设置
        measurer.measure('a')
        measurer.measure('b')
        expect(seenFonts).toEqual(['24px Georgia', '24px Georgia'])
    })

    it('空引用缺省映射 sans-serif 兜底（旧库 GD 内置字体的浏览器对应面）；正确映射属渲染端知识由宿主注入', () => {
        const { context, seenFonts } = stubContext(() => 0)
        const measurer = createMeasureTextMeasurerFactory(context)('', 16)

        measurer.measure('a')
        expect(seenFonts).toEqual(['16px sans-serif'])
    })

    it('注入 fontCssFamily 映射：结果进 ctx.font 简写（宿主接渲染端族名派生同源）', () => {
        const { context, seenFonts } = stubContext(() => 0)
        const factory = createMeasureTextMeasurerFactory(context, {
            fontCssFamily: (font) => (font === '' ? 'sans-serif' : `canvas-next-font-x, sans-serif`),
        })

        factory('/fonts/demo.ttf', 24).measure('a')
        factory('', 16).measure('a')
        expect(seenFonts).toEqual(['24px canvas-next-font-x, sans-serif', '16px sans-serif'])
    })

    it('同一工厂按图层 (font, fontSize) 各构造度量器：多图层字号互不串线', () => {
        const { context, seenFonts } = stubContext((text) => text.length * 10)
        const factory = createMeasureTextMeasurerFactory(context)

        factory('sans-serif', 12).measure('a')
        factory('sans-serif', 36).measure('a')
        expect(seenFonts).toEqual(['12px sans-serif', '36px sans-serif'])
    })

    it('经 TextLayoutPolicies.measurerFactory 注入：宽自适应求值走 measureText 真实度量（layerWidth ceil 收口）', () => {
        // 真实字体度量是浮点：a/b 各 19.3px → 'ab' = 38.6 → ceil 39（启发式会算 0.55×2×10 = 11）
        const { context } = stubContext((text) => text.length * 19.3)
        const layer = textLayer({ text: 'ab', fontSize: 10 })

        expect(layerWidth(layer, { measurerFactory: createMeasureTextMeasurerFactory(context) })).toBe(39)
        expect(layerWidth(layer)).toBe(11) // 缺省启发式不变（不隐式切换）
    })
})
