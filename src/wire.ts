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
    /**
     * 表达式标记（table-layer-v2 spec §3.1）：'ExpressionValue' = 已标记，
     * value 恒镜像 expression 原文；'StaticValue' = 字面直通。
     * expression 键 Image/Qr 条件写键（未标记不带键）、Text 恒写。
     */
    valueType?: 'StaticValue' | 'ExpressionValue'
    expression?: string
    value?: string | null
    /** TableLayer 模板态专属：取行路径（点路径字符串），data 键此时仅含该键 */
    rowsPath?: string
}

export interface WireLayerNode {
    type?: string
    priority?: number
    spec?: WireSpec
    data?: WireData
    /** TableLayer 专属 */
    rows?: WireLayerNode[]
    /** TableLayer 模板态专属（V2）：整行模板 graph（内嵌 type: 'TableRowTemplate'） */
    template?: WireLayerNode
    /** TableRowLayer / TableRowTemplate 专属 */
    cells?: WireLayerNode[]
    /** TableCellLayer 专属 */
    content?: WireLayerNode | null
}

export interface WireGraph {
    canvas?: WireCanvas
    layers?: WireLayerNode[]
}
