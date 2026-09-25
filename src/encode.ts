/**
 * 领域 → wire 编码：canonical 输出，键级对齐 php-canvas-next 的 graph()。
 * graph → 解码 → 编码往返恒等（硬契约）的另一半；缺省字段全量落键。
 */
import type {
    Border,
    Canvas,
    Layer,
} from './types'
import type { WireBorder, WireBorderSide, WireGraph, WireLayerNode, WirePadding } from './wire'

function encodeBorderSide(side: Border['top']): WireBorderSide | null {
    return side ? { width: side.width, color: side.color } : null
}

function encodeLayerNode(layer: Layer): WireLayerNode {
    const base: WireLayerNode = {
        type: layer.type,
        priority: layer.priority,
        spec: {
            shape: {
                width: layer.shape.width,
                height: layer.shape.height,
                autoWidth: layer.shape.autoWidth,
                autoHeight: layer.shape.autoHeight,
                lineHeight: layer.shape.lineHeight,
                padding: {
                    top: layer.shape.padding.top,
                    bottom: layer.shape.padding.bottom,
                    left: layer.shape.padding.left,
                    right: layer.shape.padding.right,
                } satisfies WirePadding,
                border: {
                    top: encodeBorderSide(layer.shape.border.top),
                    bottom: encodeBorderSide(layer.shape.border.bottom),
                    left: encodeBorderSide(layer.shape.border.left),
                    right: encodeBorderSide(layer.shape.border.right),
                } satisfies WireBorder,
                backgroundColor: layer.shape.backgroundColor,
            },
            align: {
                horizontal: layer.align.horizontal,
                vertical: layer.align.vertical,
            },
            // 领域锚点 anchor 映射回 wire 的 position 键
            position: {
                x: layer.position.x,
                y: layer.position.y,
                position: layer.position.anchor,
            },
        },
    }

    switch (layer.type) {
        case 'ImageLayer':
            return { ...base, data: { valueType: 'StaticValue', value: layer.src } }
        case 'TextLayer':
            // 无损：font 保留完整原始值；expression 为表达式引擎裁撤后的空串占位
            return {
                ...base,
                spec: {
                    ...base.spec,
                    fontFamily: {
                        font: layer.font,
                        fontSize: layer.fontSize,
                        fontColor: layer.fontColor,
                        angle: layer.angle,
                        autowrap: layer.autowrap,
                    },
                },
                data: { valueType: 'StaticValue', expression: '', value: layer.text },
            }
        case 'QrCodeLayer':
            // 无损：value 恒携带内容，与是否已物化无关
            return { ...base, data: { valueType: 'StaticValue', value: layer.value } }
        case 'TableLayer':
            return { ...base, rows: layer.rows.map(encodeLayerNode) }
        case 'TableRowLayer':
            return { ...base, cells: layer.cells.map(encodeLayerNode) }
        case 'TableCellLayer':
            return { ...base, content: layer.content ? encodeLayerNode(layer.content) : null }
    }
}

/** 画布 → graph wire：图层按 priority 降序落键（等优先级保持原序，稳定排序） */
export function encodeGraph(canvas: Canvas): WireGraph {
    const sorted = [...canvas.layers].sort((a, b) => b.priority - a.priority)

    return {
        canvas: { width: canvas.width, height: canvas.height },
        layers: sorted.map(encodeLayerNode),
    }
}

export function encodeLayer(layer: Layer): WireLayerNode {
    return encodeLayerNode(layer)
}
