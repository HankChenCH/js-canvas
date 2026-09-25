/**
 * 五原语渲染契约 + 渲染模板（镜像 php-canvas-next AbstractRenderer）：
 * 物化（工单 04 接入）→ begin → 按 priority 序遍历分派 → 容器下钻 → end。
 * 遍历/锚点合成/嵌套几何收在本模板；具体后端只实现五个绘制原语。
 */
import { anchorOffset, contentHeight, contentWidth, layerHeight, layerWidth } from './layout'
import type { Border, Canvas, HorizontalAlign, Layer, VerticalAlign } from './types'

export interface TextDrawOptions {
    /** 字体路径/URL；空串 = 渲染端内置默认字体 */
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
    /** 图片：cover 裁切至 width×height 后放置于 (x, y)（工单 03 起被模板调用） */
    drawImage(src: string, x: number, y: number, width: number, height: number): void
    /** 单行文本，(x, y) 为对齐语义锚点（工单 03 起被模板调用） */
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
): LayerBox {
    const width = layerWidth(layer)
    const height = layerHeight(layer)
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
        contentWidth: contentWidth(layer),
        contentHeight: contentHeight(layer),
    }
}

/** 渲染整棵结构树；canvas.layers 已按 priority 降序（数组头先画垫底） */
export function renderCanvas(canvas: Canvas, backend: RenderBackend): void {
    backend.begin(canvas.width, canvas.height)
    forEachLayerBox(canvas, (layer, box) => {
        backend.drawRect(box.x, box.y, box.width, box.height, layer.shape.backgroundColor, layer.shape.border)
    })
    backend.end()
}

/**
 * 按渲染模板的同一遍历与几何访问每层（含容器下钻：行纵向/格横向/内容同原点推进）。
 * gizmo、命中测试、目验辅助等工具层共用，保证与绘制几何不漂移。
 */
export function forEachLayerBox(
    canvas: Canvas,
    visit: (layer: Layer, box: LayerBox) => void,
): void {
    for (const layer of canvas.layers) {
        walkLayer(layer, 0, 0, canvas.width, canvas.height, visit)
    }
}

function walkLayer(
    layer: Layer,
    originX: number,
    originY: number,
    parentWidth: number,
    parentHeight: number,
    visit: (layer: Layer, box: LayerBox) => void,
): void {
    const box = resolveLayerBox(layer, originX, originY, parentWidth, parentHeight)
    visit(layer, box)

    switch (layer.type) {
        case 'TableLayer': {
            // 行纵向堆叠：行高累加推进（PHP paintTable）
            let posy = box.y
            for (const row of layer.rows) {
                walkLayer(row, box.x, posy, box.width, box.height, visit)
                posy += layerHeight(row)
            }
            break
        }
        case 'TableRowLayer': {
            // 单元格横向排布：单元宽累加推进（PHP paintRow）
            let posx = box.x
            for (const cell of layer.cells) {
                walkLayer(cell, posx, box.y, box.width, box.height, visit)
                posx += layerWidth(cell)
            }
            break
        }
        case 'TableCellLayer':
            // 内容层与单元格同原点（PHP paintCell）
            if (layer.content) walkLayer(layer.content, box.x, box.y, box.width, box.height, visit)
            break
        case 'ImageLayer':
        case 'TextLayer':
        case 'QrCodeLayer':
            // 工单 02 占位盒：只画盒；内容绘制（cover 图/断行文本/QR）在工单 03、04 接入
            break
    }
}
