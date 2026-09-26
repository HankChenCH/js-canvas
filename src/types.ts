/**
 * 领域类型：严格、必填、7 种 type 可辨识联合。由 wire 解码而来（decode.ts），
 * 编辑器内核与渲染端只消费这层；宽松的 wire 形态见 wire.ts。
 */

/** 图层类型标识（graph.type）：与 PHP 类名常量同名，跨端固定（注册表） */
export const LAYER_TYPES = [
    'ImageLayer',
    'TextLayer',
    'QrCodeLayer',
    'TableLayer',
    'TableRowLayer',
    'TableCellLayer',
    'TableRowTemplate',
] as const

export type LayerType = (typeof LAYER_TYPES)[number]

/** 九锚点（wire position.position） */
export const ANCHORS = [
    'top-left',
    'top',
    'top-right',
    'left',
    'center',
    'right',
    'bottom-left',
    'bottom',
    'bottom-right',
] as const

export type Anchor = (typeof ANCHORS)[number]

/** 水平对齐 */
export const HORIZONTAL_ALIGNS = ['left', 'center', 'right'] as const
export type HorizontalAlign = (typeof HORIZONTAL_ALIGNS)[number]

/** 垂直对齐 */
export const VERTICAL_ALIGNS = ['top', 'center', 'bottom'] as const
export type VerticalAlign = (typeof VERTICAL_ALIGNS)[number]

/** 内边距（四边，浮点像素） */
export interface Padding {
    readonly top: number
    readonly bottom: number
    readonly left: number
    readonly right: number
}

/** 单边边框（width 整数像素） */
export interface BorderSide {
    readonly width: number
    readonly color: string
}

/** 四边边框；null = 该边无边框 */
export interface Border {
    readonly top: BorderSide | null
    readonly bottom: BorderSide | null
    readonly left: BorderSide | null
    readonly right: BorderSide | null
}

/** 形状设定（wire spec.shape 的严格形态） */
export interface Shape {
    readonly width: number
    readonly height: number
    readonly autoWidth: boolean
    readonly autoHeight: boolean
    readonly lineHeight: number
    readonly padding: Padding
    readonly border: Border
    readonly backgroundColor: string | null
}

export interface Align {
    readonly horizontal: HorizontalAlign
    readonly vertical: VerticalAlign
}

/** 定位：锚点 + 相对锚点的偏移；偏移可为负（溢出摆放，不钳位） */
export interface Position {
    readonly anchor: Anchor
    readonly x: number
    readonly y: number
}

/** 图层公共设定 */
export interface LayerBase {
    readonly priority: number
    readonly shape: Shape
    readonly align: Align
    readonly position: Position
}

export interface ImageLayer extends LayerBase {
    readonly type: 'ImageLayer'
    /** 原始资源引用（URL/路径）；物化结果不进文档（图层 setter 禁 I/O 红线的编辑器延伸） */
    readonly src: string | null
    /** 数据表达式标记：null = 未标记（字面直通）；非 null = 已标记，src 恒镜像表达式原文 */
    readonly expression: string | null
}

export interface TextLayer extends LayerBase {
    readonly type: 'TextLayer'
    readonly text: string
    /** 数据表达式标记：null = 未标记；非 null = 已标记，text 恒镜像表达式原文 */
    readonly expression: string | null
    /** 字体路径/URL；空串 = 渲染端内置默认字体 */
    readonly font: string
    readonly fontSize: number
    readonly fontColor: string
    /** 文字旋转角：唯一 angle 语义，属渲染端，盒模型不旋转 */
    readonly angle: number
    readonly autowrap: boolean
}

export interface QrCodeLayer extends LayerBase {
    readonly type: 'QrCodeLayer'
    /** 二维码内容；图像由物化阶段生成，不进文档 */
    readonly value: string
    /** 数据表达式标记：null = 未标记；非 null = 已标记，value 恒镜像表达式原文 */
    readonly expression: string | null
}

export interface TableLayer extends LayerBase {
    readonly type: 'TableLayer'
    /**
     * 行模板声明（TableLayer V2）：null = V1 形态（rows 全量行预声明）；
     * 非 null = 模板态，与 rows XOR（wire 上 template ⊕ rows，decode 期强校验）
     */
    readonly template: TableRowTemplateLayer | null
    /** 取行路径（点路径字符串）：仅模板态有意义（展开时从数据集定位行数组）；V1 恒 '' */
    readonly rowsPath: string
    readonly rows: readonly TableRowLayer[]
}

export interface TableRowLayer extends LayerBase {
    readonly type: 'TableRowLayer'
    readonly cells: readonly TableCellLayer[]
}

/**
 * 表格行模板（TableLayer V2）：单行循环体声明，与 TableRowLayer 同构（cells 容器）。
 * 仅合法出现在 TableLayer 的 template 字段内（出现在画布图层序列 / rows / cells /
 * content 属非法 wire，工厂宽容解码不拒绝，契约禁止）
 */
export interface TableRowTemplateLayer extends LayerBase {
    readonly type: 'TableRowTemplate'
    readonly cells: readonly TableCellLayer[]
}

export interface TableCellLayer extends LayerBase {
    readonly type: 'TableCellLayer'
    readonly content: Layer | null
}

export type Layer =
    | ImageLayer
    | TextLayer
    | QrCodeLayer
    | TableLayer
    | TableRowLayer
    | TableCellLayer
    | TableRowTemplateLayer

/** 画布：纯结构容器。layers 按 priority 降序（等优先级保持插入序），数组头先画垫底 */
export interface Canvas {
    readonly width: number
    readonly height: number
    readonly layers: readonly Layer[]
}
