/**
 * 领域 → wire 编码：canonical 输出，键级对齐 php-canvas-next 的 graph()。
 * graph → 解码 → 编码往返恒等（硬契约）的另一半；缺省字段全量落键——
 * 例外是 name/visible 条件键（layer-panel-ux 工单 01）：仅 name 非空、visible 为 false
 * 时写键，缺省图层的 wire 字节面与无字段版本完全一致。
 */
import type {
    Border,
    Canvas,
    Layer,
} from './types'
import type { WireBorder, WireBorderSide, WireGraph, WireLayerNode, WirePadding } from './wire'

/**
 * 整形字段收整（向零截断 + -0 归零，decode.toInt 同折法）：wire 契约的这些字段是
 * 整数（PHP graph() 经 int 型别天然收整、Go wire int 字段直接 unmarshal）；JS 领域
 * 无 int 型别，编辑器手势（画拉/缩放/拖动按 zoom 折算、面板数字输入）会让几何字段
 * 携带分数。解码边界已按 toInt 收整（「严出」），编码是同一 wire 边界的另一半——
 * 分数几何不出边界。浮点字段（lineHeight、padding）不收。
 */
function toInt(value: number): number {
    const truncated = Math.trunc(value)
    return truncated === 0 ? 0 : truncated
}

function encodeBorderSide(side: Border['top']): WireBorderSide | null {
    return side ? { width: toInt(side.width), color: side.color } : null
}

function encodeLayerNode(layer: Layer): WireLayerNode {
    const base: WireLayerNode = {
        type: layer.type,
        // name/visible 条件写键（layer-panel-ux 工单 01）：name 仅非空、visible 仅 false，
        // 键序钉在 type 之后、priority 之前（三端字节 parity）；缺省态不落键
        ...(layer.name !== '' ? { name: layer.name } : {}),
        ...(layer.visible === false ? { visible: false } : {}),
        priority: toInt(layer.priority),
        spec: {
            shape: {
                width: toInt(layer.shape.width),
                height: toInt(layer.shape.height),
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
                x: toInt(layer.position.x),
                y: toInt(layer.position.y),
                position: layer.position.anchor,
            },
        },
    }

    switch (layer.type) {
        case 'ImageLayer':
            // 标记态三键（value 恒镜像 expression 原文）；未标记保持现状两键（条件写键，保三端字节 parity）
            return {
                ...base,
                data: layer.expression !== null
                    ? { valueType: 'ExpressionValue', expression: layer.expression, value: layer.src }
                    : { valueType: 'StaticValue', value: layer.src },
            }
        case 'TextLayer':
            // 无损：font 保留完整原始值；标记态三键，未标记恒写 expression 空串占位（现状形态）
            return {
                ...base,
                spec: {
                    ...base.spec,
                    fontFamily: {
                        font: layer.font,
                        fontSize: toInt(layer.fontSize),
                        fontColor: layer.fontColor,
                        angle: toInt(layer.angle),
                        autowrap: layer.autowrap,
                    },
                },
                data: layer.expression !== null
                    ? { valueType: 'ExpressionValue', expression: layer.expression, value: layer.text }
                    : { valueType: 'StaticValue', expression: '', value: layer.text },
            }
        case 'QrCodeLayer':
            // 无损：value 恒携带内容，与是否已物化无关；标记态三键、未标记两键（条件写键）
            return {
                ...base,
                data: layer.expression !== null
                    ? { valueType: 'ExpressionValue', expression: layer.expression, value: layer.value }
                    : { valueType: 'StaticValue', value: layer.value },
            }
        case 'TableLayer':
            // 模板态：条件写键 data/template，不写 rows（XOR，spec §2.2）；rowsPath 非空
            // 才写 data（键值仅 rowsPath）——不产出违反自身约束的中间 wire 形态；
            // 写键序 data → template 对齐 PHP graph()。V1 态：现状 rows 分支，不写
            // data/template（字节面零差异）
            if (layer.template !== null) {
                const node: WireLayerNode = { ...base }
                if (layer.rowsPath !== '') {
                    node.data = { rowsPath: layer.rowsPath }
                }
                node.template = encodeLayerNode(layer.template)
                return node
            }
            return { ...base, rows: layer.rows.map(encodeLayerNode) }
        case 'TableRowLayer':
            return { ...base, cells: layer.cells.map(encodeLayerNode) }
        case 'TableRowTemplate':
            // 单行循环体模板：与 TableRowLayer 同构（cells 容器）
            return { ...base, cells: layer.cells.map(encodeLayerNode) }
        case 'TableCellLayer':
            return { ...base, content: layer.content ? encodeLayerNode(layer.content) : null }
    }
}

/** 画布 → graph wire：图层按 priority 降序落键（等优先级保持原序，稳定排序） */
export function encodeGraph(canvas: Canvas): WireGraph {
    const sorted = [...canvas.layers].sort((a, b) => b.priority - a.priority)

    return {
        canvas: { width: toInt(canvas.width), height: toInt(canvas.height) },
        layers: sorted.map(encodeLayerNode),
    }
}

export function encodeLayer(layer: Layer): WireLayerNode {
    return encodeLayerNode(layer)
}
