/**
 * 五原语渲染契约 + 渲染模板（镜像 php-canvas-next AbstractRenderer）：
 * 物化（工单 04 接入）→ begin → 按 priority 序遍历分派 → 容器下钻 → end。
 * 遍历/锚点合成/嵌套几何收在本模板；具体后端只实现五个绘制原语。
 * 文本布局策略（断行/度量）经 policies 注入，缺省为启发式对齐版（见 layout.ts）。
 */
import {
    anchorOffset,
    contentHeight,
    contentWidth,
    imageOrigin,
    layerHeight,
    layerWidth,
    lineHeightPx,
    textLines,
    textOrigin,
    type TextLayoutPolicies,
} from './layout'
import type { Border, Canvas, HorizontalAlign, Layer, VerticalAlign } from './types'

export interface TextDrawOptions {
    /** 字体路径/URL；空串/纯数字 = 渲染端内置默认字体 */
    font: string
    fontSize: number
    fontColor: string
    horizontalAlign: HorizontalAlign
    verticalAlign: VerticalAlign
    angle: number
}

/** 渲染后端需实现的五个绘制原语 */
export interface RenderBackend {
    /** 创建渲染面 */
    begin(width: number, height: number): void
    /** 收尾；产物语义由后端决定（预览就地绘制可无返回） */
    end(): void
    /** 矩形盒：背景色 + 四边边框 */
    drawRect(
        x: number,
        y: number,
        width: number,
        height: number,
        bgColor: string | null,
        border: Border,
    ): void
    /** 图片：cover 裁切至 width×height 后放置于 (x, y) */
    drawImage(src: string, x: number, y: number, width: number, height: number): void
    /** 单行文本，(x, y) 为对齐语义锚点（基线差由后端以字体 metrics 消化） */
    drawText(line: string, x: number, y: number, options: TextDrawOptions): void
}

/** 图层盒的绝对几何；内容盒供 gizmo/命中测试/目验辅助共用 */
export interface LayerBox {
    x: number
    y: number
    width: number
    height: number
    contentX: number
    contentY: number
    contentWidth: number
    contentHeight: number
}

/** 图层盒几何：锚点解析（不钳位）+ 定位偏移 + padding 内容盒（纯函数，工具层共用） */
export function resolveLayerBox(
    layer: Layer,
    originX: number,
    originY: number,
    parentWidth: number,
    parentHeight: number,
    policies?: TextLayoutPolicies,
): LayerBox {
    const width = layerWidth(layer, policies)
    const height = layerHeight(layer, policies)
    const offset = anchorOffset(layer.position.anchor, parentWidth, parentHeight, width, height)
    const x = originX + offset.x + layer.position.x
    const y = originY + offset.y + layer.position.y

    return {
        x,
        y,
        width,
        height,
        contentX: x + layer.shape.padding.left,
        contentY: y + layer.shape.padding.top,
        contentWidth: contentWidth(layer, policies),
        contentHeight: contentHeight(layer, policies),
    }
}

/**
 * QR 图层的绘制引用键：内容加 `qr:` 前缀命名空间，避免与 ImageLayer 的资源 URL
 * 混淆。物化器（工单 04）生成二维码位图后以同键经后端 setImage 回写，模板据此取图。
 */
export function qrImageSrc(value: string): string {
    return `qr:${value}`
}

/** 渲染模板的可选行为（编辑器等工具层的挂钩；缺省全量绘制） */
export interface RenderCanvasOptions {
    /**
     * 返回 true 的图层跳过内容绘制（盒/背景/边框照常画）。编辑器文本编辑态用：
     * 该层文字由 textarea overlay 呈现，canvas 再画一份会与浏览器断行叠加成重影
     * （断行允许与预览不同，决策 A）。
     */
    skipContent?: (layer: Layer) => boolean
}

/** 渲染整棵结构树；canvas.layers 已按 priority 降序（数组头先画垫底） */
export function renderCanvas(
    canvas: Canvas,
    backend: RenderBackend,
    policies?: TextLayoutPolicies,
    options?: RenderCanvasOptions,
): void {
    backend.begin(canvas.width, canvas.height)
    forEachLayerBox(canvas, (layer, box) => {
        backend.drawRect(box.x, box.y, box.width, box.height, layer.shape.backgroundColor, layer.shape.border)
        if (options?.skipContent?.(layer)) return
        paintContent(layer, box, backend, policies)
    }, policies)
    backend.end()
}

/** 盒绘制之后的内容分派（镜像 PHP paintImage/paintText；QR 内容绘制在工单 04 接入） */
function paintContent(
    layer: Layer,
    box: LayerBox,
    backend: RenderBackend,
    policies?: TextLayoutPolicies,
): void {
    switch (layer.type) {
        case 'ImageLayer':
            // 原始引用为 null 只画盒（未物化/未加载的占位语义）
            if (layer.src !== null) {
                const origin = imageOrigin(layer, policies)
                backend.drawImage(
                    layer.src,
                    box.x + origin.x,
                    box.y + origin.y,
                    box.contentWidth,
                    box.contentHeight,
                )
            }
            break
        case 'TextLayer': {
            const origin = textOrigin(layer, policies)
            const posx = box.x + layer.shape.padding.left + origin.x
            let posy = box.y + layer.shape.padding.top + origin.y
            for (const line of textLines(layer, policies)) {
                backend.drawText(line, posx, posy, {
                    font: layer.font,
                    fontSize: layer.fontSize,
                    fontColor: layer.fontColor,
                    horizontalAlign: layer.align.horizontal,
                    verticalAlign: layer.align.vertical,
                    angle: layer.angle,
                })
                posy += lineHeightPx(layer)
            }
            break
        }
        case 'QrCodeLayer':
            // 镜像 PHP paintQrCode：二维码图像按宽度正方形铺放于图层原点（padding/align
            // 不参与，声明高 ≠ 宽时图像仍宽×宽）；空值无内容（PHP resolvedSrc null 同门）。
            // 未物化时后端查不到键只画盒——占位语义（工单 04 物化器回写 qrImageSrc 键）
            if (layer.value !== '') {
                backend.drawImage(qrImageSrc(layer.value), box.x, box.y, box.width, box.width)
            }
            break
        default:
            break
    }
}

/**
 * 按渲染模板的同一遍历与几何访问每层（含容器下钻：行纵向/格横向/内容同原点推进）。
 * gizmo、命中测试、目验辅助等工具层共用，保证与绘制几何不漂移。
 *
 * 根层遍历跳过 visible=false（layer-panel-ux 工单 01，隐藏 = 最终输出排除，Figma 语义）：
 * 与 PHP AbstractRenderer::render / Go renderer.Render 同门；容器子层不下钻显隐
 * （显隐面仅根图层）。
 */
export function forEachLayerBox(
    canvas: Canvas,
    visit: (layer: Layer, box: LayerBox) => void,
    policies?: TextLayoutPolicies,
): void {
    for (const layer of canvas.layers) {
        if (layer.visible === false) continue
        walkLayer(layer, 0, 0, canvas.width, canvas.height, visit, policies)
    }
}

/**
 * 容器子层的随机访问下钻：行纵向累加 y（前序行高之和）、格横向累加 x（前序格宽之和）、
 * 格内容与格同原点（PHP paintTable/paintRow/paintCell 同式）。命中测试、gizmo、
 * 路径寻盒等按索引直达子层的工具层共用，保证与顺序遍历（walkLayer）的几何不漂移；
 * walkLayer 本体保持 O(n) 顺序推进不经此。
 *
 * 'template' 段（无下标，index 忽略）：下钻到表的内嵌行模板，盒与首行同位
 * （表原点）——编辑器 gizmo/寻层对模板子树的几何解析与预览视图行（置于表格
 * 顶部第一行位）共用同一推进公式，两侧不漂移。
 */
export function resolveChildAt(
    parent: Layer,
    parentBox: LayerBox,
    key: 'rows' | 'cells' | 'content' | 'template',
    index: number,
    policies?: TextLayoutPolicies,
): { layer: Layer; box: LayerBox } | null {
    if (key === 'content') {
        if (parent.type !== 'TableCellLayer' || parent.content === null) return null
        return {
            layer: parent.content,
            box: resolveLayerBox(parent.content, parentBox.x, parentBox.y, parentBox.width, parentBox.height, policies),
        }
    }

    if (key === 'template') {
        if (parent.type !== 'TableLayer' || parent.template === null) return null
        return {
            layer: parent.template,
            box: resolveLayerBox(parent.template, parentBox.x, parentBox.y, parentBox.width, parentBox.height, policies),
        }
    }

    let children: readonly Layer[] | null = null
    if (key === 'rows') children = parent.type === 'TableLayer' ? parent.rows : null
    // 行模板的 cells 容器与具体行同构（编辑器经模板段寻格，几何同一公式）
    if (key === 'cells') {
        children = parent.type === 'TableRowLayer' || parent.type === 'TableRowTemplate' ? parent.cells : null
    }
    if (!children || !Number.isSafeInteger(index) || index < 0 || index >= children.length) return null

    let originX = parentBox.x
    let originY = parentBox.y
    for (let i = 0; i < index; i += 1) {
        const prev = children[i]!
        if (key === 'rows') originY += layerHeight(prev, policies)
        else originX += layerWidth(prev, policies)
    }
    const layer = children[index]!
    return { layer, box: resolveLayerBox(layer, originX, originY, parentBox.width, parentBox.height, policies) }
}

function walkLayer(
    layer: Layer,
    originX: number,
    originY: number,
    parentWidth: number,
    parentHeight: number,
    visit: (layer: Layer, box: LayerBox) => void,
    policies?: TextLayoutPolicies,
): void {
    const box = resolveLayerBox(layer, originX, originY, parentWidth, parentHeight, policies)
    visit(layer, box)

    switch (layer.type) {
        case 'TableLayer': {
            // 行纵向堆叠：行高累加推进（PHP paintTable）
            let posy = box.y
            for (const row of layer.rows) {
                walkLayer(row, box.x, posy, box.width, box.height, visit, policies)
                posy += layerHeight(row, policies)
            }
            break
        }
        case 'TableRowLayer': {
            // 单元格横向排布：单元宽累加推进（PHP paintRow）
            let posx = box.x
            for (const cell of layer.cells) {
                walkLayer(cell, posx, box.y, box.width, box.height, visit, policies)
                posx += layerWidth(cell, policies)
            }
            break
        }
        case 'TableCellLayer':
            // 内容层与单元格同原点（PHP paintCell）
            if (layer.content) walkLayer(layer.content, box.x, box.y, box.width, box.height, visit, policies)
            break
        case 'ImageLayer':
        case 'TextLayer':
        case 'QrCodeLayer':
            break
    }
}
