import { describe, expect, it } from 'vitest'

import {
    contentWidth,
    createHeuristicMeasurer,
    layerHeight,
    textLines,
    textOrigin,
    imageOrigin,
    type LineBreaker,
    type TextMeasurer,
    type TextMeasurerFactory,
    type TextLayer,
} from '../../src/index'

/** 领域 TextLayer 构造助手（对齐 geometry.test.ts 同款缺省：left/bottom、autoHeight） */
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
        expression: null,
        font: '',
        fontSize: 12,
        fontColor: '#000000',
        angle: 0,
        autowrap: false,
        ...overrides,
    }
}

function imageLayer(overrides: {
    width?: number
    height?: number
    padding?: { top: number; bottom: number; left: number; right: number }
    horizontal?: 'left' | 'center' | 'right'
    vertical?: 'top' | 'center' | 'bottom'
}) {
    const width = overrides.width ?? 100
    const height = overrides.height ?? 100
    const padding = overrides.padding ?? { top: 0, bottom: 0, left: 0, right: 0 }
    return {
        type: 'ImageLayer' as const,
        priority: 0,
        shape: {
            width,
            height,
            autoWidth: false,
            autoHeight: false,
            lineHeight: 1,
            padding,
            border: { top: null, bottom: null, left: null, right: null },
            backgroundColor: null,
        },
        align: {
            horizontal: overrides.horizontal ?? 'center',
            vertical: overrides.vertical ?? 'center',
        },
        position: { x: 0, y: 0, anchor: 'top-left' as const },
        src: null,
        expression: null as string | null,
    }
}

/** 平移 phpunit TextLayerTest 的动态高与断行行数用例 */
describe('文本行数与动态高（layerHeight/textLines）', () => {
    it('autowrap 行数跟断行：盒宽 50、字号 10 → 一二三四五六七 断为两行、高 20（平移 testAutowrapHeightFollowsBrokenLines）', () => {
        const layer = textLayer({
            shape: { ...textLayer({}).shape, width: 50 },
            text: '一二三四五六七',
            fontSize: 10,
            autowrap: true,
        })

        expect(textLines(layer)).toEqual(['一二三四五', '六七'])
        expect(layerHeight(layer)).toBe(20)
    })

    it('autowrap 保留显式换行（平移 testAutowrapKeepsExplicitNewlines）', () => {
        const layer = textLayer({
            shape: { ...textLayer({}).shape, width: 500 },
            text: 'ab\ncd',
            autowrap: true,
        })
        expect(textLines(layer)).toEqual(['ab', 'cd'])
    })

    it('非 autowrap 整段单行（平移 testGetLinesWithoutAutowrapReturnsSingleLine）', () => {
        const layer = textLayer({
            shape: { ...textLayer({}).shape, width: 50 },
            text: '很长很长很长很长很长很长很长很长',
        })
        expect(textLines(layer)).toEqual(['很长很长很长很长很长很长很长很长'])
    })

    it('空文本非 autowrap 也是单空行（PHP getLines 同门）；autowrap 空文本不产行、高只剩 padding', () => {
        expect(textLines(textLayer({}))).toEqual([''])
        const emptyAutowrap = textLayer({
            shape: { ...textLayer({}).shape, padding: { top: 10, bottom: 10, left: 0, right: 0 } },
            autowrap: true,
        })
        expect(textLines(emptyAutowrap)).toEqual([])
        expect(layerHeight(emptyAutowrap)).toBe(20)
    })
})

/** 工单 03：默认启发式度量器 + 度量器工厂/断行器注入缝都有用例（换注入器布局随之变化） */
describe('度量器工厂与断行器注入缝', () => {
    const base = (): TextLayer =>
        textLayer({
            shape: { ...textLayer({}).shape, width: 50 },
            text: '一二三四五六七',
            fontSize: 10,
            autowrap: true,
        })

    it('默认注入 = UAX14 断行器 + 启发式度量器：每字 10px → 5 字/行', () => {
        expect(textLines(base())).toEqual(['一二三四五', '六七'])
        expect(layerHeight(base())).toBe(20)
    })

    it('换度量器工厂：每字 2.5 倍字宽 → 2 字/行，行数与动态高随之变化', () => {
        const wideFactory: TextMeasurerFactory = (_font, fontSize): TextMeasurer => ({
            measure: (text) => [...text].length * 2.5 * fontSize,
        })
        const layer = base()

        expect(textLines(layer, { measurerFactory: wideFactory })).toEqual([
            '一二',
            '三四',
            '五六',
            '七',
        ])
        expect(layerHeight(layer, { measurerFactory: wideFactory })).toBe(40)
    })

    it('换断行器：固定三行桩 → 动态高 = 3 × 行高（平移 testLineBreakerInjectable）', () => {
        const stubBreaker: LineBreaker = () => ['x', 'y', 'z']
        const layer = textLayer({ text: '任意', fontSize: 10, autowrap: true })

        expect(layerHeight(layer, { lineBreaker: stubBreaker })).toBe(30)
    })

    it('注入缝实参：断行器收到内容盒宽，度量工厂收到图层字体与字号', () => {
        const seenWidths: number[] = []
        const seenFactories: { font: string; fontSize: number }[] = []
        const spyBreaker: LineBreaker = (text, boxWidth) => {
            seenWidths.push(boxWidth)
            return text.split('')
        }
        const spyFactory: TextMeasurerFactory = (font, fontSize) => {
            seenFactories.push({ font, fontSize })
            return createHeuristicMeasurer(fontSize)
        }
        const layer = textLayer({
            shape: {
                ...textLayer({}).shape,
                width: 70,
                padding: { top: 0, bottom: 0, left: 10, right: 10 },
            },
            font: '/fonts/demo.ttf',
            fontSize: 14,
            autowrap: true,
        })

        textLines(layer, { lineBreaker: spyBreaker, measurerFactory: spyFactory })

        expect(seenWidths).toEqual([50])
        expect(seenFactories).toEqual([{ font: '/fonts/demo.ttf', fontSize: 14 }])
    })
})

/** 文本基点（textOrigin）：纯对齐锚点语义，值平移自布局快照 fixture align-origin-grid（GD 基线魔数不移植） */
describe('文本基点（textOrigin）', () => {
    /** 60×40、padding 4、字号 12、行高 1、单行 '对齐锚点'：内容盒 52×32 */
    function gridLayer(overrides: {
        horizontal?: 'left' | 'center' | 'right'
        vertical?: 'top' | 'center' | 'bottom'
        autoHeight?: boolean
        autowrap?: boolean
        height?: number
    }): TextLayer {
        return textLayer({
            shape: {
                ...textLayer({}).shape,
                width: 60,
                height: overrides.height ?? 40,
                autoHeight: overrides.autoHeight ?? false,
                lineHeight: 1,
                padding: { top: 4, bottom: 4, left: 4, right: 4 },
            },
            align: { horizontal: overrides.horizontal ?? 'left', vertical: overrides.vertical ?? 'top' },
            text: '对齐锚点',
            fontSize: 12,
            autowrap: overrides.autowrap ?? false,
        })
    }

    it('九种对齐组合的锚点（fixture align-origin-grid 同值）', () => {
        // 水平：left 0 / center ⌊52/2⌋=26 / right 52；垂直 top 0 / center ⌊(32-0)/2⌋=16 /
        // bottom（非 autowrap）= contentHeight 32
        expect(textOrigin(gridLayer({ horizontal: 'left', vertical: 'top' }))).toEqual({ x: 0, y: 0 })
        expect(textOrigin(gridLayer({ horizontal: 'center', vertical: 'top' }))).toEqual({ x: 26, y: 0 })
        expect(textOrigin(gridLayer({ horizontal: 'right', vertical: 'top' }))).toEqual({ x: 52, y: 0 })
        expect(textOrigin(gridLayer({ horizontal: 'left', vertical: 'center' }))).toEqual({ x: 0, y: 16 })
        expect(textOrigin(gridLayer({ horizontal: 'center', vertical: 'center' }))).toEqual({ x: 26, y: 16 })
        expect(textOrigin(gridLayer({ horizontal: 'right', vertical: 'center' }))).toEqual({ x: 52, y: 16 })
        expect(textOrigin(gridLayer({ horizontal: 'left', vertical: 'bottom' }))).toEqual({ x: 0, y: 32 })
        expect(textOrigin(gridLayer({ horizontal: 'center', vertical: 'bottom' }))).toEqual({ x: 26, y: 32 })
        expect(textOrigin(gridLayer({ horizontal: 'right', vertical: 'bottom' }))).toEqual({ x: 52, y: 32 })
    })

    it('center × autoHeight：首行锚点 = ⌊行高/2⌋（fixture y=250 同值）', () => {
        // 高 12+8=20、内容高 12；oy = ⌊12/2⌋ = 6
        const layer = gridLayer({ horizontal: 'center', vertical: 'center', autoHeight: true, height: 0 })
        expect(layerHeight(layer)).toBe(20)
        expect(textOrigin(layer)).toEqual({ x: 26, y: 6 })
    })

    it('bottom × autowrap 多行（固定高、零 padding）：锚点 = 内容高 - 行高×(行数-1)，GD 基线魔数不移植', () => {
        // '底部对齐多行文本' 内容盒宽 60 → 5 字/行 × 2 行；oy = 40 - 12×1 = 28
        // （fixture align-origin-grid 同款层：PHP 同分支另减 round(fontSize*0.1)=1，
        // 属渲染端 TextMetrics 消化的预期差异字段）
        const layer = textLayer({
            shape: {
                ...textLayer({}).shape,
                width: 60,
                height: 40,
                autoHeight: false,
                lineHeight: 1,
            },
            align: { horizontal: 'left', vertical: 'bottom' },
            text: '底部对齐多行文本',
            fontSize: 12,
            autowrap: true,
        })
        expect(textLines(layer)).toEqual(['底部对齐多', '行文本'])
        expect(textOrigin(layer)).toEqual({ x: 0, y: 28 })
    })

    it('未知对齐回退 left/top（PHP match default 臂；领域解码已收口，这里锁纯函数自身）', () => {
        const layer = { ...gridLayer({}), align: { horizontal: 'left' as const, vertical: 'top' as const } }
        expect(textOrigin(layer)).toEqual({ x: 0, y: 0 })
    })
})

/** 图片基点（imageOrigin）：值平移 PHP ImageLayer::getImageOrigin 语义 */
describe('图片基点（imageOrigin）', () => {
    it('默认 center/center：锚点 = (盒 - 内容盒)/2 向零截断', () => {
        // 100×100、padding 10 → 内容盒 80×80 → (10, 10)
        expect(imageOrigin(imageLayer({ padding: { top: 10, bottom: 10, left: 10, right: 10 } }))).toEqual({ x: 10, y: 10 })
    })

    it('非对称 padding：center = (宽 - 内容宽)/2 与 (高 - 内容高)/2 各自截断', () => {
        const layer = imageLayer({
            width: 100,
            height: 80,
            padding: { top: 2, bottom: 8, left: 5, right: 15 },
        })
        // 内容盒 80×70 → x = ⌊(100-80)/2⌋ = 10，y = ⌊(80-70)/2⌋ = 5
        expect(imageOrigin(layer)).toEqual({ x: 10, y: 5 })
    })

    it('left/top = padding 原点；right/bottom = 盒减内容盒（PHP intval 向零截断）', () => {
        const padding = { top: 2.5, bottom: 4, left: 3.5, right: 6 }
        const layer = imageLayer({ width: 100, height: 100, padding })

        // 内容宽 = ⌊100-3.5-6⌋ = 90，内容高 = ⌊100-2.5-4⌋ = 93；left → ⌊3.5⌋ = 3；right → 100-90 = 10
        expect(imageOrigin({ ...layer, align: { horizontal: 'left', vertical: 'top' } })).toEqual({ x: 3, y: 2 })
        expect(imageOrigin({ ...layer, align: { horizontal: 'right', vertical: 'bottom' } })).toEqual({ x: 10, y: 7 })
    })

    it('padding 吃满整盒：内容宽 0 → center 锚点 = ⌊盒宽/2⌋（绘制端对内容盒 ≤0 跳过）', () => {
        const layer = imageLayer({ width: 50, height: 40, padding: { top: 0, bottom: 0, left: 25, right: 25 } })
        expect(contentWidth(layer)).toBe(0)
        expect(imageOrigin(layer)).toEqual({ x: 25, y: 0 })
    })
})
