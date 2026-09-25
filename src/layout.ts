/**
 * 布局纯函数：逐值镜像 php-canvas-next 的尺寸/锚点语义（向零截断、锚点解析不钳位）。
 * GD 基线魔数不移植；文本 y 坐标差属预期差异字段（三端测试决策），由渲染端
 * TextMetrics 消化。
 */
import {
    createUax14LineBreaker,
    heuristicMeasurerFactory,
    type LineBreaker,
    type TextMeasurerFactory,
} from './text'
import type { Anchor, ImageLayer, Layer, TextLayer } from './types'

/**
 * 文本布局策略（注入缝）：断行器 + 度量器工厂。缺省 = UAX14 简化断行器 +
 * 启发式度量（ASCII 0.55，对齐 PHP/Go 两端默认行为）；增强模式（字体度量表/
 * measureText）经此显式注入，不隐式切换
 */
export interface TextLayoutPolicies {
    readonly lineBreaker?: LineBreaker
    readonly measurerFactory?: TextMeasurerFactory
}

const DEFAULT_LINE_BREAKER = createUax14LineBreaker()

function resolvePolicies(policies?: TextLayoutPolicies): {
    lineBreaker: LineBreaker
    measurerFactory: TextMeasurerFactory
} {
    return {
        lineBreaker: policies?.lineBreaker ?? DEFAULT_LINE_BREAKER,
        measurerFactory: policies?.measurerFactory ?? heuristicMeasurerFactory,
    }
}

/** 归一 -0（PHP 整数域无 -0） */
function normZero(value: number): number {
    return value === 0 ? 0 : value
}

function trunc(value: number): number {
    return normZero(Math.trunc(value))
}

/** 图层宽（PHP getWidth：无覆写；autoWidth 布局求值暂无内容宽注入点，与两端一致） */
export function layerWidth(layer: Layer): number {
    return layer.shape.width
}

/** 单行高（PHP lineHeightPx）：字号 × 行高倍数，向上取整 */
export function lineHeightPx(layer: TextLayer): number {
    return Math.ceil(layer.fontSize * layer.shape.lineHeight)
}

/**
 * 断行结果（PHP TextLayer::getLines，纯布局函数）：autowrap 开启时按内容盒宽断行，
 * 否则整段单行（含空文本）；度量工厂实参 = 图层原始字体引用与字号
 */
export function textLines(layer: TextLayer, policies?: TextLayoutPolicies): string[] {
    if (!layer.autowrap) return [layer.text]

    const { lineBreaker, measurerFactory } = resolvePolicies(policies)
    return lineBreaker(layer.text, contentWidth(layer), measurerFactory(layer.font, layer.fontSize))
}

/**
 * 图层高（PHP getHeight 语义）：
 * - 通用：声明高
 * - Text：autoHeight 时 autowrap = 行高 × 行数 + 纵向 padding，否则单行高 + 纵向
 *   padding（空文本只剩 padding）
 * - QrCode：未声明有效高时按宽兜底正方形
 */
export function layerHeight(layer: Layer, policies?: TextLayoutPolicies): number {
    switch (layer.type) {
        case 'TextLayer': {
            if (!layer.shape.autoHeight) return layer.shape.height
            const padHeight = trunc(layer.shape.padding.top + layer.shape.padding.bottom)
            if (layer.autowrap) {
                return lineHeightPx(layer) * textLines(layer, policies).length + padHeight
            }
            if (layer.text === '') return padHeight
            return lineHeightPx(layer) + padHeight
        }
        case 'QrCodeLayer':
            if (!layer.shape.autoHeight && layer.shape.height > 0) return layer.shape.height
            return layerWidth(layer)
        default:
            return layer.shape.height
    }
}

/** 内容区宽 = 宽 - 左右 padding（PHP getContentWidth，向零截断） */
export function contentWidth(layer: Layer): number {
    return trunc(layerWidth(layer) - layer.shape.padding.left - layer.shape.padding.right)
}

/** 内容区高 = 动态高 - 上下 padding（PHP 动态分派：经 getHeight 派生） */
export function contentHeight(layer: Layer, policies?: TextLayoutPolicies): number {
    return trunc(layerHeight(layer, policies) - layer.shape.padding.top - layer.shape.padding.bottom)
}

/**
 * 文本在内容盒内的绘制基准点（PHP TextLayer::getTextOrigin：对齐 + 行数），纯布局计算，
 * 渲染端共用。返回纯对齐锚点——PHP bottom+autowrap 分支的 GD 基线魔数
 * -round(fontSize*0.1) 不移植（渲染后端 drawText 以 TextMetrics 消化基线差），
 * 其余分支结构与 PHP 逐条对应
 */
export function textOrigin(layer: TextLayer, policies?: TextLayoutPolicies): { x: number; y: number } {
    const lineCount = Math.max(textLines(layer, policies).length, 1)
    const lineH = lineHeightPx(layer)

    // 取值 left/center/right，其余归 0（PHP match default 臂）
    const x = layer.align.horizontal === 'center'
        ? trunc(contentWidth(layer) / 2)
        : layer.align.horizontal === 'right'
            ? contentWidth(layer)
            : 0

    // 取值 top/center/bottom，其余归 0（PHP match default 臂）
    const y = layer.align.vertical === 'center'
        ? layer.shape.autoHeight
            ? trunc(lineH / 2)
            : trunc((contentHeight(layer, policies) - lineH * (lineCount - 1)) / 2)
        : layer.align.vertical === 'bottom'
            ? layer.autowrap
                ? contentHeight(layer, policies) - lineH * (lineCount - 1)
                : contentHeight(layer, policies)
            : 0

    return { x, y }
}

/**
 * 内容区内图片的绘制起点（PHP ImageLayer::getImageOrigin：对齐 + padding），纯布局计算。
 * center = (盒尺寸 - 内容盒尺寸)/2 向零截断；left/top = padding 原点；
 * right/bottom = 盒尺寸 - 内容盒尺寸
 */
export function imageOrigin(layer: ImageLayer): { x: number; y: number } {
    const width = layerWidth(layer)
    const height = layerHeight(layer)

    // 取值 left/center/right，其余归 0（PHP match default 臂）
    const x = layer.align.horizontal === 'center'
        ? trunc((width - contentWidth(layer)) / 2)
        : layer.align.horizontal === 'right'
            ? width - contentWidth(layer)
            : trunc(layer.shape.padding.left)

    const y = layer.align.vertical === 'center'
        ? trunc((height - contentHeight(layer)) / 2)
        : layer.align.vertical === 'bottom'
            ? height - contentHeight(layer)
            : trunc(layer.shape.padding.top)

    return { x, y }
}

/**
 * 九锚点偏移（PHP PositionResolver）：把锚点串换算为子层在父盒内的偏移。
 * 不钳位——子层大于父盒时得到负偏移即溢出摆放。
 */
export function anchorOffset(
    anchor: Anchor,
    parentWidth: number,
    parentHeight: number,
    childWidth: number,
    childHeight: number,
): { x: number; y: number } {
    const x = anchor === 'top-right' || anchor === 'right' || anchor === 'bottom-right'
        ? parentWidth - childWidth
        : anchor === 'top' || anchor === 'center' || anchor === 'bottom'
            ? trunc((parentWidth - childWidth) / 2)
            : 0

    const y = anchor === 'bottom-left' || anchor === 'bottom' || anchor === 'bottom-right'
        ? parentHeight - childHeight
        : anchor === 'left' || anchor === 'center' || anchor === 'right'
            ? trunc((parentHeight - childHeight) / 2)
            : 0

    return { x, y }
}
