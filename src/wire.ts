/**
 * graph wire 类型：跨端序列化契约，键级对齐 php-canvas-next 的 graph() 输出。
 * 宽松可选——宿主可能给出缺键、字符串数字的旧版或手写 JSON；严格领域形态见 types.ts。
 * 运行时解码（decode.ts）按 unknown 宽进并做缺省回填与数字收整，不信任这些静态类型。
 */

export interface WireCanvas {
    width?: number
    height?: number
}

export interface WireBorderSide {
    width?: number
    color?: string
}

export type WirePadding = Partial<Record<'top' | 'bottom' | 'left' | 'right', number>>

export type WireBorder = Partial<Record<'top' | 'bottom' | 'left' | 'right', WireBorderSide | null>>

export interface WireShape {
    width?: number
    height?: number
    autoWidth?: boolean
    autoHeight?: boolean
    lineHeight?: number
    padding?: WirePadding
    border?: WireBorder
    backgroundColor?: string | null
}

export interface WireAlign {
    horizontal?: 'left' | 'center' | 'right'
    vertical?: 'top' | 'center' | 'bottom'
}

export interface WirePosition {
    x?: number
    y?: number
    /** 九锚点串（领域侧改名 anchor，编码时映射回 position 键） */
    position?: string
}

export interface WireFontFamily {
    font?: string
    fontSize?: number
    fontColor?: string
    angle?: number
    autowrap?: boolean
}

export interface WireSpec {
    shape?: WireShape
    align?: WireAlign
    position?: WirePosition
    /** TextLayer 专属（嵌在 spec 内，键级对齐 PHP） */
    fontFamily?: WireFontFamily
}

export interface WireData {
    /** 表达式引擎已裁撤，恒 StaticValue；expression 仅 TextLayer 保留空串占位 */
    valueType?: 'StaticValue'
    expression?: string
    value?: string | null
}

export interface WireLayerNode {
    type?: string
    priority?: number
    spec?: WireSpec
    data?: WireData
    /** TableLayer 专属 */
    rows?: WireLayerNode[]
    /** TableRowLayer 专属 */
    cells?: WireLayerNode[]
    /** TableCellLayer 专属 */
    content?: WireLayerNode | null
}

export interface WireGraph {
    canvas?: WireCanvas
    layers?: WireLayerNode[]
}
