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

/** 图层公共设定（wire 键 name/visible 见 LayerBase 字段注释） */
export interface LayerBase {
    /**
     * 用户命名（layer-panel-ux 工单 01）：缺省 ''；wire 上仅非空写键（缺省态字节面与
     * 无字段版本一致，保往返恒等）
     */
    readonly name: string
    /**
     * 显隐设定（layer-panel-ux 工单 01）：缺省 true；wire 上仅 false 写键；
     * 渲染循环跳过 false 的根图层（隐藏 = 最终输出排除，Figma 语义）
     */
    readonly visible: boolean
    readonly priority: number
    readonly shape: Shape
    readonly align: Align
    readonly position: Position
}

/**
 * 适配模式已知值（ADR 0023/0024，PHP ImageLayer::FIT_* 同名对齐）：值是透传字符串，
 * 枚举扩展 wire 零成本；白名单在渲染臂，未知值渲染面按 cover 降级
 */
export const IMAGE_FIT_COVER = 'cover'
export const IMAGE_FIT_CONTAIN = 'contain'
export const IMAGE_FIT_FILL = 'fill'
export const IMAGE_FIT_TILE = 'tile'

/**
 * 裁剪形状已知值（ADR 0026，PHP ImageLayer::CLIP_* 同名对齐）：值是透传字符串，
 * 枚举扩展 wire 零成本；白名单在渲染臂，未知值渲染面按矩形降级
 */
export const IMAGE_CLIP_RECT = 'rect'
export const IMAGE_CLIP_CIRCLE = 'circle'

export interface ImageLayer extends LayerBase {
    readonly type: 'ImageLayer'
    /** 原始资源引用（URL/路径）；物化结果不进文档（图层 setter 禁 I/O 红线的编辑器延伸） */
    readonly src: string | null
    /** 数据表达式标记：null = 未标记（字面直通）；非 null = 已标记，src 恒镜像表达式原文 */
    readonly expression: string | null
    /**
     * 适配模式（ADR 0023/0024）：'contain' = 等比收缩至完整落入内容盒、按对齐放置、
     * 空隙透明；'fill' = 整图拉伸铺满内容盒（不裁切不保比）；'tile' = 内在尺寸 1:1
     * 平铺、aligned 锚定、绘制面止于内容盒；undefined = cover 缺省（等比铺满裁切、
     * 溢出居中）。条件写键——仅 ≠cover 落键（殿后 spec 末位 shape/align/position/fit），
     * 缺省态字节面与无字段版本一致；未知值宽容透传（往返恒等，`(string & {})` 保字面
     * 补全），渲染面未知值按 cover 降级（白名单在渲染臂）。静态声明：不进 hydrate
     * 改写面与表达式白名单
     */
    readonly fit?: 'contain' | 'fill' | 'tile' | (string & {})
    /**
     * 裁剪形状（ADR 0026）：'circle' = 完整圆形框——背景色填充进内切圆、内容按 fit
     * 绘出后遮罩进圆、边框沿圆周描成环；undefined = rect 缺省（不裁）。条件写键——
     * 仅 ≠rect 落键（殿后 spec 末位 fit 之后，shape/align/position/fit/clip），
     * 缺省态字节面与无字段版本一致；未知值宽容透传（往返恒等，`(string & {})` 保字面
     * 补全），渲染面未知值降级矩形（白名单在渲染臂）。静态声明：不进 hydrate
     * 改写面与表达式白名单
     */
    readonly clip?: 'circle' | 'rect' | (string & {})
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

/**
 * 画布背景（ADR 0022 / canvas-background spec §3）：画布级声明式填充，纯值对象。
 * 渲染语义字段、不属图层树：无显隐、无优先级、不进命中面；静态——不进 hydrate
 * 改写面与表达式白名单，展开/预览仅透传。适配固定 cover，无 fit 字段
 */
export interface CanvasBackground {
    /** 背景色（与图层 shape.backgroundColor 同格式域）；null = 未设 */
    readonly color: string | null
    /** 背景图资源引用（URL 或本地路径，与 ImageLayer src 同构）；null = 未设 */
    readonly image: string | null
}

/** 画布：纯结构容器。layers 按 priority 降序（等优先级保持插入序），数组头先画垫底 */
export interface Canvas {
    readonly width: number
    readonly height: number
    /**
     * 画布背景（ADR 0022）：null = 无背景（wire 整键不落，缺省态字节面与无字段
     * 版本一致）；渲染语义见 CanvasBackground。解码恒产出（缺键回填 null）
     */
    readonly background: CanvasBackground | null
    readonly layers: readonly Layer[]
}
