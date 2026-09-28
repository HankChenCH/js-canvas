/**
 * 预览视图变换（编辑器渲染关切，渲染契约零改动）：
 *
 * 模板态表格（TableLayer V2）在渲染端没有行输出是 wire 契约的刻意结果
 * （template ⊕ rows XOR，ADR 0006——行由展开阶段实例化，Web 侧 expand 未建）。
 * 编辑器在设计态没有数据集，画布预览/导出/命中消费本模块产出的**预览视图**：
 * 模板态表格在内存视图里实例化出一行预览行（真实 TableRowLayer），渲染模板与
 * 命中测试零改动即可呈现「一行输出效果」。
 *
 * - 视图是文档的只读衍生物：源画布不被改写，未涉及子树结构共享引用（引用相等
 *   即未变的语义依赖此）；永不回写 graph（图层 setter 禁 I/O 红线的编辑器延伸）。
 * - 预览行内容语义（决策 2026-09）：文本格字面直通——标记格 text 恒镜像表达式
 *   原文，视图原样呈现即「绑定什么」的诚实展示；标记图片/二维码格置空
 *   （src null / value ''），复用「未物化只画盒」的占位语义；字面内容原样进视图。
 * - 预览行几何：声明高非 auto 原样保留；auto 高按「单行展开」合成（auto 格取
 *   内容动态高、auto 行取最高格，layerHeight 同式）——解码对 auto 标志恒清零
 *   声明高，不合成则预览行盒高为 0，命中/选中/gizmo 全部退化。合成只改视图
 *   实例数值，文档与 wire 零触碰，行高定稿仍留给展开。只画一行、置于表格
 *   顶部，剩余高度留白（行数由数据决定，预览不伪造）。
 * - 路径映射：视图里的预览行段 ['rows', 0] ↔ 文档的 ['template'] 段，命中测试
 *   在视图上执行后经映射落回文档路径身份（选中/属性编辑写文档）。
 *
 * 本模块是「展开（expand）」的结构侧单行无数据版：将来实现完整 expand 时，
 * 实例化与置空规则可升级复用。纯函数、零 DOM。
 */
import { layerHeight, type TextLayoutPolicies } from './layout'
import type { Canvas, Layer, TableLayer, TableCellLayer, TableRowLayer, TableRowTemplateLayer } from './types'

type PathSegment = string | number

/** 模板态表格判定 */
function isTemplateTable(layer: Layer): layer is TableLayer & { template: TableRowTemplateLayer } {
    return layer.type === 'TableLayer' && layer.template !== null
}

/** 行集合变换：无任何变化时原数组返回（结构共享） */
function previewRows(rows: readonly TableRowLayer[]): readonly TableRowLayer[] {
    let changed = false
    const next = rows.map((row) => {
        const mapped = previewRow(row)
        if (mapped !== row) changed = true
        return mapped
    })
    return changed ? next : rows
}

/**
 * 行/格内容的统一预览变换：模板行重标定为真实行；未涉及子树原引用返回。
 * 标记图片/二维码置空走占位盒语义；文本格字面直通（标记格 text 恒镜像原文）。
 * 高度合成只发生在模板行实例化路径（instantiatePreviewRow）——V1 子树视图与
 * 文档几何必须逐盒一致（gizmo/命中同源），绝不在通用递归里动声明几何。
 */
function previewContent(layer: Layer, policies?: TextLayoutPolicies): Layer {
    switch (layer.type) {
        case 'ImageLayer':
            // 标记态 src 恒镜像表达式原文，不是可物化引用——置空走占位盒
            return layer.expression !== null ? { ...layer, src: null } : layer
        case 'QrCodeLayer':
            return layer.expression !== null ? { ...layer, value: '' } : layer
        case 'TableLayer':
            if (layer.template !== null) {
                // 模板态：视图 rows 只含预览行；template 字段原样保留（视图不落
                // wire，XOR 是 wire 不变量——路径映射依赖它定位模板子树）
                return { ...layer, rows: [instantiatePreviewRow(layer.template, policies)] }
            }
            if (layer.rows.length === 0) return layer
            return { ...layer, rows: previewRows(layer.rows) }
        case 'TableRowTemplate':
            return instantiatePreviewRow(layer, policies)
        case 'TableRowLayer':
            return previewRow(layer)
        case 'TableCellLayer': {
            if (layer.content === null) return layer
            const content = previewContent(layer.content, policies)
            return content === layer.content ? layer : { ...layer, content }
        }
        default:
            return layer
    }
}

/** 行 → 预览行（V1 行）：类型不变、仅递归子树；无变化的原引用返回 */
function previewRow(row: TableRowLayer, policies?: TextLayoutPolicies): TableRowLayer {
    let cellsChanged = false
    const cells = row.cells.map((cell) => {
        const mapped = previewContent(cell, policies) as TableCellLayer
        if (mapped !== cell) cellsChanged = true
        return mapped
    })
    if (!cellsChanged) return row
    return { ...row, cells }
}

/**
 * 行模板 → 预览行：类型重标定为真实行 + auto 高度合成。模板态高度耦合全豁免
 * （ADR 0006），解码对 auto 标志恒清零声明高——预览视图按「单行展开」补一个
 * 合理高度：auto 格取内容动态高（layerHeight 同式），auto 行取最高格；声明高
 * 非 auto 原样保留。合成只改视图实例的数值，文档与 wire 零触碰（行高定稿仍
 * 留给展开，预览不伪造终值）。
 */
function instantiatePreviewRow(template: TableRowTemplateLayer, policies?: TextLayoutPolicies): TableRowLayer {
    const cells = template.cells.map((cell) => instantiatePreviewCell(cell, policies))
    const rowHeight = template.shape.autoHeight
        ? cells.reduce((max, cell) => Math.max(max, layerHeight(cell, policies)), 0)
        : template.shape.height
    return {
        ...template,
        type: 'TableRowLayer',
        shape: template.shape.autoHeight ? { ...template.shape, height: rowHeight } : template.shape,
        cells,
    }
}

function instantiatePreviewCell(cell: TableCellLayer, policies?: TextLayoutPolicies): TableCellLayer {
    const content = cell.content === null ? null : previewContent(cell.content, policies)
    const cellHeight = cell.shape.autoHeight
        ? (content !== null ? layerHeight(content, policies) : 0)
        : cell.shape.height
    return {
        ...cell,
        content,
        shape: cell.shape.autoHeight ? { ...cell.shape, height: cellHeight } : cell.shape,
    }
}

/**
 * 文档 → 预览视图：模板态表格实例化一行预览行，其余子树结构共享引用。
 * 输入画布不被改写。文本策略注入缝与渲染/命中同一注入值（断行/度量不分叉）。
 */
export function withTemplatePreview(canvas: Canvas, policies?: TextLayoutPolicies): Canvas {
    let changed = false
    const layers = canvas.layers.map((layer) => {
        const next = previewContent(layer, policies)
        if (next !== layer) changed = true
        return next
    })
    return changed ? { ...canvas, layers } : canvas
}

/**
 * 视图路径 → 文档路径：预览行段 ['rows', 0] 替换为 ['template']，其余段原样。
 * 沿视图结构逐段下降验证（模板表上 rows 越界/路径形态不符返回 null）。
 */
export function viewPathToDocPath(
    view: Canvas,
    path: readonly PathSegment[],
): readonly PathSegment[] | null {
    if (path.length < 2 || path[0] !== 'layers' || typeof path[1] !== 'number') return null
    const root = view.layers[path[1]]
    if (root === undefined) return null

    const out: PathSegment[] = ['layers', path[1]]
    let current: Layer = root
    let i = 2
    while (i < path.length) {
        const key = path[i]
        const index = path[i + 1]
        if (key === 'rows' && current.type === 'TableLayer') {
            if (isTemplateTable(current)) {
                // 预览行段：视图模板表 rows 只有一行，越界即路径失效
                if (index !== 0) return null
                out.push('template')
                current = current.template
            } else {
                if (typeof index !== 'number' || index >= current.rows.length) return null
                out.push('rows', index)
                current = current.rows[index]!
            }
            i += 2
            continue
        }
        if (key === 'cells' && (current.type === 'TableRowLayer' || current.type === 'TableRowTemplate')) {
            if (typeof index !== 'number' || index >= current.cells.length) return null
            out.push('cells', index)
            current = current.cells[index]!
            i += 2
            continue
        }
        if (key === 'content' && current.type === 'TableCellLayer') {
            if (current.content === null) return null
            out.push('content')
            current = current.content
            i += 1
            continue
        }
        return null
    }
    return out
}

/**
 * 文档路径 → 视图路径：['template'] 段替换为 ['rows', 0]，其余段原样。
 * 沿文档结构逐段下降验证（模板态表上出现 rows 段即域形态失效，返回 null）。
 */
export function docPathToViewPath(
    doc: Canvas,
    path: readonly PathSegment[],
): readonly PathSegment[] | null {
    if (path.length < 2 || path[0] !== 'layers' || typeof path[1] !== 'number') return null
    const root = doc.layers[path[1]]
    if (root === undefined) return null

    const out: PathSegment[] = ['layers', path[1]]
    let current: Layer = root
    let i = 2
    while (i < path.length) {
        const key = path[i]
        const index = path[i + 1]
        if (key === 'template') {
            if (!isTemplateTable(current)) return null
            out.push('rows', 0)
            current = current.template
            i += 1
            continue
        }
        if (key === 'rows' && current.type === 'TableLayer') {
            // 模板态表的 rows 恒空：路径落在这里即域形态失效
            if (current.template !== null) return null
            if (typeof index !== 'number' || index >= current.rows.length) return null
            out.push('rows', index)
            current = current.rows[index]!
            i += 2
            continue
        }
        if (key === 'cells' && (current.type === 'TableRowLayer' || current.type === 'TableRowTemplate')) {
            if (typeof index !== 'number' || index >= current.cells.length) return null
            out.push('cells', index)
            current = current.cells[index]!
            i += 2
            continue
        }
        if (key === 'content' && current.type === 'TableCellLayer') {
            if (current.content === null) return null
            out.push('content')
            current = current.content
            i += 1
            continue
        }
        return null
    }
    return out
}
