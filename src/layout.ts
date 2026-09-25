/**
 * 布局纯函数：逐值镜像 php-canvas-next 的尺寸/锚点语义（向零截断、锚点解析不钳位）。
 * GD 基线魔数不移植；文本 y 坐标差属预期差异字段（三端测试决策）。
 */
import type { Anchor, Layer, TextLayer } from './types'

/** 归一 -0（PHP 整数域无 -0） */
function normZero(value: number): number {
    return value === 0 ? 0 : value
}

function trunc(value: number): number {
    return normZero(Math.trunc(value))
}

/** 图层宽（PHP getWidth：无覆写；autoWidth 布局求值在工单 03 补内容宽注入） */
export function layerWidth(layer: Layer): number {
    return layer.shape.width
}

/** 单行高（PHP lineHeightPx）：字号 × 行高倍数，向上取整 */
export function lineHeightPx(layer: TextLayer): number {
    return Math.ceil(layer.fontSize * layer.shape.lineHeight)
}

/**
 * 图层高（PHP getHeight 语义）：
 * - 通用：声明高
 * - Text：autoHeight 时 = 行高 × 行数 + 纵向 padding；autowrap 的断行器注入点在工单 03
 *   （当前按未断行单行计，仅保证占位盒不塌陷）
 * - QrCode：未声明有效高时按宽兜底正方形
 */
export function layerHeight(layer: Layer): number {
    switch (layer.type) {
        case 'TextLayer': {
            if (!layer.shape.autoHeight) return layer.shape.height
            const padHeight = trunc(layer.shape.padding.top + layer.shape.padding.bottom)
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
export function contentHeight(layer: Layer): number {
    return trunc(layerHeight(layer) - layer.shape.padding.top - layer.shape.padding.bottom)
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
