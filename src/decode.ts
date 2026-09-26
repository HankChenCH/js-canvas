/**
 * wire → 领域解码：宽进（unknown，缺键、字符串数字都收），严出（领域类型必填且收整）。
 * 语义逐条镜像 php-canvas-next 的 applyGraph/setter：
 * - 缺键回填该层缺省；对齐缺省逐类型平移 PHP 属性默认（Image center/center、Text left/bottom）
 * - 数字收整向零截断（PHP intval/(float)）
 * - 'auto' 标志仅在 width/height 键在场时生效（PHP array_key_exists 门）
 * - 未知图层 type 报错（不静默丢弃）；解码时镜像 addRow/addCell/addContentLayer 的容器副作用
 * - 表格模板态与表达式标记逐条镜像 PHP V2 fromGraph（table-layer-v2 spec §2/§3.1）
 */
import { layerHeight } from './layout'
import {
    ANCHORS,
    HORIZONTAL_ALIGNS,
    VERTICAL_ALIGNS,
    type Align,
    type Border,
    type BorderSide,
    type Canvas,
    type Layer,
    type LayerType,
    type Padding,
    type Position,
    type Shape,
    type TableRowLayer,
    type TableRowTemplateLayer,
    type TableCellLayer,
} from './types'

export class UnknownLayerTypeError extends Error {
    readonly type: string

    constructor(type: string) {
        super(`未知图层类型: ${type}`)
        this.name = 'UnknownLayerTypeError'
        this.type = type
    }
}

/** template ⊕ rows 双键同现（spec §2.2；PHP DecodeException code 同名） */
export class TemplateRowsConflictError extends Error {
    readonly code = 'template_rows_conflict'

    constructor() {
        super('template_rows_conflict: template 与 rows 键不得同时出现')
        this.name = 'TemplateRowsConflictError'
    }
}

/** 模板态缺 data.rowsPath（spec §3.3；PHP DecodeException code 同名） */
export class RowsPathMissingError extends Error {
    readonly code = 'rows_path_missing'

    constructor() {
        super('rows_path_missing: 模板态表格缺少 data.rowsPath')
        this.name = 'RowsPathMissingError'
    }
}

/** PHP intval：向零截断；非数字串归 0（差异：PHP 取前导数字段，这里整串解析） */
function toInt(value: unknown): number {
    if (typeof value === 'number') return normZero(Math.trunc(value))
    if (typeof value === 'string') {
        const parsed = Number(value.trim())
        return Number.isFinite(parsed) ? normZero(Math.trunc(parsed)) : 0
    }
    if (typeof value === 'boolean') return value ? 1 : 0
    return 0
}

/** PHP (float)：非数字串归 0 */
function toFloat(value: unknown): number {
    if (typeof value === 'number') return value
    if (typeof value === 'string') {
        const parsed = Number(value.trim())
        return Number.isFinite(parsed) ? parsed : 0
    }
    if (typeof value === 'boolean') return value ? 1 : 0
    return 0
}

/** PHP (bool)/?: 真值语义：false/0/''/'0'/null/undefined 为假，其余为真 */
function toBool(value: unknown): boolean {
    if (typeof value === 'string') return value !== '' && value !== '0'
    if (typeof value === 'number') return value !== 0
    if (typeof value === 'boolean') return value
    return false
}

/** 归一 -0（PHP 整数域无 -0；Object.is 下 toBe(0) 会咬人） */
function normZero(value: number): number {
    return value === 0 ? 0 : value
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null
}

function isStringUnion<T extends string>(value: unknown, allowed: readonly T[]): value is T {
    return typeof value === 'string' && (allowed as readonly string[]).includes(value)
}

/** PHP empty() 同门：null/''/'0'/0/false/[] 皆为空 */
function isPhpEmpty(value: unknown): boolean {
    if (value == null) return true
    if (typeof value === 'string') return value === '' || value === '0'
    if (typeof value === 'number') return value === 0
    if (typeof value === 'boolean') return !value
    if (Array.isArray(value)) return value.length === 0
    return false
}

/** PHP setWidth('auto')：'auto' 串（大小写不敏感）本身即 auto 标志 */
function isAutoString(value: unknown): boolean {
    return typeof value === 'string' && value.trim().toLowerCase() === 'auto'
}

const DEFAULT_PADDING: Padding = { top: 0, bottom: 0, left: 0, right: 0 }
const NO_BORDER: Border = { top: null, bottom: null, left: null, right: null }

/** 逐类型对齐缺省（PHP 各图层类的属性默认） */
const TYPE_ALIGN_DEFAULTS: Record<LayerType, Align> = {
    ImageLayer: { horizontal: 'center', vertical: 'center' },
    TextLayer: { horizontal: 'left', vertical: 'bottom' },
    QrCodeLayer: { horizontal: 'left', vertical: 'top' },
    TableLayer: { horizontal: 'left', vertical: 'top' },
    TableRowLayer: { horizontal: 'left', vertical: 'top' },
    TableCellLayer: { horizontal: 'left', vertical: 'top' },
    TableRowTemplate: { horizontal: 'left', vertical: 'top' },
}

interface LayerBaseFields {
    priority: number
    shape: Shape
    align: Align
    position: Position
}

function decodeBorderSide(value: unknown): BorderSide | null {
    const rec = asRecord(value)
    if (!rec) return null
    const width = toInt(rec.width ?? 0)
    // width 0 即无边框（借 PHP setBorder* 的清边语义做收整）
    if (width === 0) return null
    return { width, color: rec.color == null ? '#000' : String(rec.color) }
}

function decodeBase(node: Record<string, unknown>, type: LayerType): LayerBaseFields {
    const spec = asRecord(node.spec) ?? {}
    const shapeRec = asRecord(spec.shape) ?? {}
    const alignRec = asRecord(spec.align) ?? {}
    const posRec = asRecord(spec.position) ?? {}

    // 尺寸：键在场才生效；autoWidth 真值标志或 'auto' 字符串（PHP setWidth('auto')，
    // 大小写不敏感）都置 auto 并清零
    let width = 0
    let autoWidth = false
    if (Object.hasOwn(shapeRec, 'width')) {
        if (toBool(shapeRec.autoWidth) || isAutoString(shapeRec.width)) {
            autoWidth = true
        } else {
            width = toInt(shapeRec.width)
        }
    }
    let height = 0
    let autoHeight = false
    if (Object.hasOwn(shapeRec, 'height')) {
        if (toBool(shapeRec.autoHeight) || isAutoString(shapeRec.height)) {
            autoHeight = true
        } else {
            height = toInt(shapeRec.height)
        }
    }

    const paddingRec = asRecord(shapeRec.padding)
    const padding: Padding = paddingRec
        ? {
              top: toFloat(paddingRec.top ?? 0),
              bottom: toFloat(paddingRec.bottom ?? 0),
              left: toFloat(paddingRec.left ?? 0),
              right: toFloat(paddingRec.right ?? 0),
          }
        : DEFAULT_PADDING

    const borderRec = asRecord(shapeRec.border)
    const border: Border = borderRec
        ? {
              top: decodeBorderSide(borderRec.top),
              bottom: decodeBorderSide(borderRec.bottom),
              left: decodeBorderSide(borderRec.left),
              right: decodeBorderSide(borderRec.right),
          }
        : NO_BORDER

    // backgroundColor 键在场才生效；null/字符串原样保留（空串保留，往返恒等优先）
    const backgroundColor = Object.hasOwn(shapeRec, 'backgroundColor')
        ? shapeRec.backgroundColor == null
            ? null
            : String(shapeRec.backgroundColor)
        : null

    // 对齐缺省分两路：键缺席回填该层类型缺省（PHP 属性默认，Image center/center、
    // Text left/bottom）；键在场但取值未知回退 left/top——对齐 PHP 渲染端 match
    // default 兜底语义，保证同一份 junk wire 三端渲染一致
    const alignDefaults = TYPE_ALIGN_DEFAULTS[type]
    const align: Align = {
        horizontal: alignRec.horizontal == null
            ? alignDefaults.horizontal
            : isStringUnion(alignRec.horizontal, HORIZONTAL_ALIGNS)
                ? alignRec.horizontal
                : 'left',
        vertical: alignRec.vertical == null
            ? alignDefaults.vertical
            : isStringUnion(alignRec.vertical, VERTICAL_ALIGNS)
                ? alignRec.vertical
                : 'top',
    }

    // x/y 齐备才生效（PHP isset 双门）；未知 anchor 回退 top-left（领域严格、宽进严出）
    let position: Position = { anchor: 'top-left', x: 0, y: 0 }
    if (posRec.x != null && posRec.y != null) {
        position = {
            anchor: isStringUnion(posRec.position, ANCHORS) ? posRec.position : 'top-left',
            x: toInt(posRec.x),
            y: toInt(posRec.y),
        }
    }

    return {
        priority: node.priority != null ? toInt(node.priority) : 0,
        shape: {
            width,
            height,
            autoWidth,
            autoHeight,
            lineHeight: shapeRec.lineHeight != null ? toFloat(shapeRec.lineHeight) : 1,
            padding,
            border,
            backgroundColor,
        },
        align,
        position,
    }
}

/**
 * 表达式标记解码（三内容层共用，镜像 PHP fromGraph 的 data 分支，spec §3.1）：
 * 标记 ⟺ valueType === 'ExpressionValue' 且 expression 键在场（PHP isset 门：
 * null 不算、'' 算）。标记态返回表达式原文——值字段恒镜像原文，wire 的 value
 * 不读（分歧时归一，PHP setExpression 同语义）；未标记返回 null。
 */
function decodeExpressionMark(data: Record<string, unknown> | null): string | null {
    if (data?.valueType !== 'ExpressionValue') return null
    return data.expression == null ? null : String(data.expression)
}

function decodeImageLayer(node: Record<string, unknown>): Layer {
    const data = asRecord(node.data)
    const expression = decodeExpressionMark(data)
    if (expression !== null) {
        // 标记态：src := expression 原样（'' 不做 →null 归一，PHP rawImg 同门）
        return { type: 'ImageLayer', ...decodeBase(node, 'ImageLayer'), src: expression, expression }
    }

    const raw = data?.value
    return {
        type: 'ImageLayer',
        ...decodeBase(node, 'ImageLayer'),
        // 空串与 null 归 null（PHP setImage 语义）；其余弱转字符串
        src: raw == null || raw === '' ? null : String(raw),
        expression: null,
    }
}

function decodeTextLayer(node: Record<string, unknown>): Layer {
    const spec = asRecord(node.spec) ?? {}
    const font = asRecord(spec.fontFamily) ?? {}
    const data = asRecord(node.data)
    const expression = decodeExpressionMark(data)
    const raw = data?.value

    return {
        type: 'TextLayer',
        ...decodeBase(node, 'TextLayer'),
        // 标记态 text := expression；未标记按现状读取（null → ''）
        text: expression !== null ? expression : raw == null ? '' : String(raw),
        expression,
        font: font.font == null ? '' : String(font.font),
        fontSize: font.fontSize != null ? toInt(font.fontSize) : 12,
        fontColor: font.fontColor == null ? '#000000' : String(font.fontColor),
        angle: font.angle != null ? toInt(font.angle) : 0,
        autowrap: font.autowrap != null ? toBool(font.autowrap) : false,
    }
}

function decodeQrCodeLayer(node: Record<string, unknown>): Layer {
    const data = asRecord(node.data)
    const expression = decodeExpressionMark(data)
    return {
        type: 'QrCodeLayer',
        ...decodeBase(node, 'QrCodeLayer'),
        value: expression !== null ? expression : data?.value == null ? '' : String(data.value),
        expression,
    }
}

function decodeTableLayer(node: Record<string, unknown>): Layer {
    const base = decodeBase(node, 'TableLayer')

    // hasTemplate 镜像 PHP array_key_exists && !== null 门：template: null 不算模板态
    const hasTemplate = Object.hasOwn(node, 'template') && node.template != null
    if (hasTemplate && Object.hasOwn(node, 'rows')) {
        // XOR 强校验（spec §2.2）：rows 键在场即算，值任意（含 [] / null）
        throw new TemplateRowsConflictError()
    }

    if (hasTemplate) {
        // rowsPath 须为非空 string（data 缺失 / 键缺失 / 空串 / 非串都算缺，PHP is_string 同门）
        const rowsPath = asRecord(node.data)?.rowsPath
        if (typeof rowsPath !== 'string' || rowsPath === '') {
            throw new RowsPathMissingError()
        }

        // 模板装配：rows 空数组落域；行宽 := 表宽关 autoWidth（setTemplate→setWidth
        // 镜像）；高度豁免在 decodeTableRowTemplateLayer 内（spec §2.3）
        const template = decodeTableRowTemplateLayer(node.template)
        return {
            type: 'TableLayer',
            ...base,
            template: {
                ...template,
                shape: { ...template.shape, width: base.shape.width, autoWidth: false },
            },
            rows: [],
            rowsPath,
        }
    }

    // V1 现状逻辑零改动；wire 的 data 键不读（PHP V1 分支同门），域 template null / rowsPath ''
    const rows: TableRowLayer[] = []
    const rowsWire = Array.isArray(node.rows) ? node.rows : []
    for (const rowWire of rowsWire) {
        const row = decodeTableRowLayer(rowWire)
        // addRow 副作用：行宽同步表宽并关 autoWidth
        rows.push({
            ...row,
            shape: { ...row.shape, width: base.shape.width, autoWidth: false },
        })
    }

    return { type: 'TableLayer', ...base, template: null, rowsPath: '', rows }
}

function decodeTableRowLayer(node: unknown): TableRowLayer {
    const rec = asRecord(node) ?? {}
    const base = decodeBase(rec, 'TableRowLayer')
    const cells: TableCellLayer[] = []
    let height = base.shape.height
    let autoHeight = base.shape.autoHeight
    const cellsWire = Array.isArray(rec.cells) ? rec.cells : []
    for (const cellWire of cellsWire) {
        const cell = decodeTableCellLayer(cellWire)
        // addCell 副作用：行高取最高单元格，增长时固化（关 autoHeight）
        const cellHeight = layerHeight(cell)
        if (cellHeight > height) {
            height = cellHeight
            autoHeight = false
        }
        cells.push(cell)
    }

    return {
        type: 'TableRowLayer',
        ...base,
        shape: { ...base.shape, height, autoHeight },
        cells,
    }
}

function forceHeight(layer: Layer, height: number): Layer {
    return { ...layer, shape: { ...layer.shape, height, autoHeight: false } }
}

function decodeTableCellLayer(node: unknown): TableCellLayer {
    const rec = asRecord(node) ?? {}
    const base = decodeBase(rec, 'TableCellLayer')

    // content 与 PHP !empty 同门：''/'0'/0/false/[] 皆视为无内容
    if (isPhpEmpty(rec.content)) {
        return { type: 'TableCellLayer', ...base, content: null }
    }

    let content = decodeLayer(rec.content)
    // addContentLayer 副作用：内容宽同步 cell 宽并关 autoWidth
    content = { ...content, shape: { ...content.shape, width: base.shape.width, autoWidth: false } }

    if (base.shape.autoHeight) {
        // cell auto：采纳内容动态高并固化
        return {
            type: 'TableCellLayer',
            ...base,
            shape: { ...base.shape, height: layerHeight(content), autoHeight: false },
            content,
        }
    }

    // cell 固定：压平内容高并关内容 autoHeight
    return { type: 'TableCellLayer', ...base, content: forceHeight(content, base.shape.height) }
}

/**
 * 行模板装配（TableLayer V2，镜像 TableRowTemplate::fromGraph + TableCellLayer::templateFromGraph）：
 * 宽度耦合沿用（模板格内容宽 := 格宽关 autoWidth，addTemplateContentLayer 镜像）、
 * 高度耦合全豁免（行/格/内容的声明高与 autoHeight 原样保留——不走 V1 的行高取最高格、
 * 格 auto 采纳/固定压平，实例高度由展开阶段定稿，spec §2.3）
 */
function decodeTableRowTemplateLayer(node: unknown): TableRowTemplateLayer {
    const rec = asRecord(node) ?? {}
    const base = decodeBase(rec, 'TableRowTemplate')
    const cells: TableCellLayer[] = []
    const cellsWire = Array.isArray(rec.cells) ? rec.cells : []
    for (const cellWire of cellsWire) {
        cells.push(decodeTemplateCellLayer(cellWire))
    }

    // addCell 副作用：只挂格，无任何行高耦合（PHP TableRowTemplate::addCell 同门）
    return { type: 'TableRowTemplate', ...base, cells }
}

function decodeTemplateCellLayer(node: unknown): TableCellLayer {
    const rec = asRecord(node) ?? {}
    const base = decodeBase(rec, 'TableCellLayer')

    // content 与 PHP !empty 同门：''/'0'/0/false/[] 皆视为无内容
    if (isPhpEmpty(rec.content)) {
        return { type: 'TableCellLayer', ...base, content: null }
    }

    // 内容层经通用 decodeLayer（嵌套表/模板都宽容，LayerFactory 同面）；
    // addTemplateContentLayer 副作用：只有宽度同步，格与内容的声明高/autoHeight 原样
    const content = decodeLayer(rec.content)
    return {
        type: 'TableCellLayer',
        ...base,
        content: { ...content, shape: { ...content.shape, width: base.shape.width, autoWidth: false } },
    }
}

/** 7 种 type 字面量注册表：type → 解码器（未知 type 由此报错） */
const LAYER_DECODERS: Record<LayerType, (node: Record<string, unknown>) => Layer> = {
    ImageLayer: decodeImageLayer,
    TextLayer: decodeTextLayer,
    QrCodeLayer: decodeQrCodeLayer,
    TableLayer: decodeTableLayer,
    TableRowLayer: decodeTableRowLayer,
    TableCellLayer: decodeTableCellLayer,
    // 工厂宽容面（spec §2.6「适配端可选拒绝」取不拒绝）：出现在画布序列/rows/cells/
    // content 属非法 wire 但可解码；无表宽上下文 → 不同步行宽
    TableRowTemplate: decodeTableRowTemplateLayer,
}

/** 单层解码（LayerFactory 对应物）；type 缺失或未知抛 UnknownLayerTypeError */
export function decodeLayer(node: unknown): Layer {
    const rec = asRecord(node)
    const type = typeof rec?.type === 'string' ? rec.type : ''
    const decoder = type in LAYER_DECODERS ? LAYER_DECODERS[type as LayerType] : undefined
    if (!decoder) throw new UnknownLayerTypeError(type)

    return decoder(rec ?? {})
}

/** graph → 画布：宽进（缺键/字符串数字），图层按 priority 降序（等优先级保持 wire 序） */
export function decodeGraph(input: unknown): Canvas {
    const rec = asRecord(input) ?? {}
    const canvasRec = asRecord(rec.canvas) ?? {}

    const layers: Layer[] = []
    const layersWire = Array.isArray(rec.layers) ? rec.layers : []
    for (const layerWire of layersWire) {
        layers.push(decodeLayer(layerWire))
    }

    // Array.prototype.sort 稳定（ES2019+），对齐 PHP 8 usort 语义
    const sorted = [...layers].sort((a, b) => b.priority - a.priority)

    return {
        width: toInt(canvasRec.width ?? 0),
        height: toInt(canvasRec.height ?? 0),
        layers: sorted,
    }
}
