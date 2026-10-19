/**
 * 布局纯函数：逐值镜像 php-canvas-next 的尺寸/锚点语义（向零截断、锚点解析不钳位）。
 * GD 基线魔数不移植；文本 y 坐标差属预期差异字段（三端测试决策），由渲染端
 * TextMetrics 消化。
 */
import {
    createUax14LineBreaker,
    heuristicMeasurerFactory,
    type LineBreaker,
    type TextMeasurerFactory,
} from './text'
import type { Anchor, ImageLayer, Layer, QrCodeLayer, TextLayer } from './types'

/**
 * 文本布局策略（注入缝）：断行器 + 度量器工厂。缺省 = UAX14 简化断行器 +
 * 启发式度量（ASCII 0.55，对齐 PHP/Go 两端默认行为）；增强模式（字体度量表/
 * measureText）经此显式注入，不隐式切换
 */
export interface TextLayoutPolicies {
    readonly lineBreaker?: LineBreaker
    readonly measurerFactory?: TextMeasurerFactory
}

const DEFAULT_LINE_BREAKER = createUax14LineBreaker()

function resolvePolicies(policies?: TextLayoutPolicies): {
    lineBreaker: LineBreaker
    measurerFactory: TextMeasurerFactory
} {
    return {
        lineBreaker: policies?.lineBreaker ?? DEFAULT_LINE_BREAKER,
        measurerFactory: policies?.measurerFactory ?? heuristicMeasurerFactory,
    }
}

/** 归一 -0（PHP 整数域无 -0） */
function normZero(value: number): number {
    return value === 0 ? 0 : value
}

function trunc(value: number): number {
    return normZero(Math.trunc(value))
}

/**
 * 图层宽（PHP getWidth 语义）：
 * - 通用：声明宽
 * - Text：autoWidth 时 = 未断行自然宽（ADR 0014）——按显式换行拆段取最大度量宽
 *   （ceil）+ 横向 padding（trunc 求和，镜像 autoHeight 纵向 padding）；空文本 =
 *   0 + 横向 padding（空串拆段得 ['']，度量宽 0 自然落到该分支）。求值忽略
 *   autowrap——内容盒宽即自然宽，断行不再切分（除显式换行），组合退化为不折行，
 *   autowrap 标志留在结构不动；拆段只按 \n 硬拆、不经 LineBreaker 缝（断行策略属
 *   autowrap 渲染路径）。度量经 TextLayoutPolicies 缝（缺省启发式，可注入增强），
 *   字体用原始引用（布局不依赖物化）
 */
export function layerWidth(layer: Layer, policies?: TextLayoutPolicies): number {
    switch (layer.type) {
        case 'TextLayer': {
            if (!layer.shape.autoWidth) return layer.shape.width

            const { measurerFactory } = resolvePolicies(policies)
            const measurer = measurerFactory(layer.font, layer.fontSize)

            let natural = 0
            for (const segment of layer.text.split('\n')) {
                natural = Math.max(natural, measurer.measure(segment))
            }

            return trunc(Math.ceil(natural)) + trunc(layer.shape.padding.left + layer.shape.padding.right)
        }
        default:
            return layer.shape.width
    }
}

/** 单行高（PHP lineHeightPx）：字号 × 行高倍数，向上取整 */
export function lineHeightPx(layer: TextLayer): number {
    return Math.ceil(layer.fontSize * layer.shape.lineHeight)
}

/**
 * 断行结果（PHP TextLayer::getLines，纯布局函数）：autowrap 开启时按内容盒宽断行，
 * 否则整段单行（含空文本）；度量工厂实参 = 图层原始字体引用与字号
 */
export function textLines(layer: TextLayer, policies?: TextLayoutPolicies): string[] {
    if (!layer.autowrap) return [layer.text]

    const { lineBreaker, measurerFactory } = resolvePolicies(policies)
    return lineBreaker(layer.text, contentWidth(layer, policies), measurerFactory(layer.font, layer.fontSize))
}

/**
 * 图层高（PHP getHeight 语义）：
 * - 通用：声明高
 * - Text：autoHeight 时 autowrap = 行高 × 行数 + 纵向 padding，否则单行高 + 纵向
 *   padding（空文本只剩 padding）
 * - QrCode：未声明有效高时按宽兜底正方形
 */
export function layerHeight(layer: Layer, policies?: TextLayoutPolicies): number {
    switch (layer.type) {
        case 'TextLayer': {
            if (!layer.shape.autoHeight) return layer.shape.height
            const padHeight = trunc(layer.shape.padding.top + layer.shape.padding.bottom)
            if (layer.autowrap) {
                return lineHeightPx(layer) * textLines(layer, policies).length + padHeight
            }
            if (layer.text === '') return padHeight
            return lineHeightPx(layer) + padHeight
        }
        case 'QrCodeLayer':
            if (!layer.shape.autoHeight && layer.shape.height > 0) return layer.shape.height
            return layerWidth(layer, policies)
        default:
            return layer.shape.height
    }
}

/** 内容区宽 = 宽 - 左右 padding（PHP getContentWidth，向零截断；宽经 layerWidth 动态求值） */
export function contentWidth(layer: Layer, policies?: TextLayoutPolicies): number {
    return trunc(layerWidth(layer, policies) - layer.shape.padding.left - layer.shape.padding.right)
}

/** 内容区高 = 动态高 - 上下 padding（PHP 动态分派：经 getHeight 派生） */
export function contentHeight(layer: Layer, policies?: TextLayoutPolicies): number {
    return trunc(layerHeight(layer, policies) - layer.shape.padding.top - layer.shape.padding.bottom)
}

/**
 * 文本在内容盒内的绘制基准点（PHP TextLayer::getTextOrigin：对齐 + 行数），纯布局计算，
 * 渲染端共用。返回纯对齐锚点——PHP bottom+autowrap 分支的 GD 基线魔数
 * -round(fontSize*0.1) 不移植（渲染后端 drawText 以 TextMetrics 消化基线差），
 * 其余分支结构与 PHP 逐条对应
 */
export function textOrigin(layer: TextLayer, policies?: TextLayoutPolicies): { x: number; y: number } {
    const lineCount = Math.max(textLines(layer, policies).length, 1)
    const lineH = lineHeightPx(layer)

    // 取值 left/center/right，其余归 0（PHP match default 臂）
    const x = layer.align.horizontal === 'center'
        ? trunc(contentWidth(layer, policies) / 2)
        : layer.align.horizontal === 'right'
            ? contentWidth(layer, policies)
            : 0

    // 取值 top/center/bottom，其余归 0（PHP match default 臂）
    const y = layer.align.vertical === 'center'
        ? layer.shape.autoHeight
            ? trunc(lineH / 2)
            : trunc((contentHeight(layer, policies) - lineH * (lineCount - 1)) / 2)
        : layer.align.vertical === 'bottom'
            ? layer.autowrap
                ? contentHeight(layer, policies) - lineH * (lineCount - 1)
                : contentHeight(layer, policies)
            : 0

    return { x, y }
}

/**
 * 对齐放置公式（align + padding 同门，PHP ImageLayer alignedX/alignedY 同源防漂移）：
 * placedWidth×placedHeight 的内容在整盒（boxWidth×boxHeight）内的起点。
 * center = (整盒 - 内容)/2 向零截断；left/top = padding 原点；right/bottom = 整盒 - 内容
 * （未知对齐取值走 left/top 分支，对齐解码已收口、此处锁纯函数自身）
 */
function alignedOrigin(
    layer: ImageLayer,
    boxWidth: number,
    boxHeight: number,
    placedWidth: number,
    placedHeight: number,
): { x: number; y: number } {
    const x = layer.align.horizontal === 'center'
        ? trunc((boxWidth - placedWidth) / 2)
        : layer.align.horizontal === 'right'
            ? boxWidth - placedWidth
            : trunc(layer.shape.padding.left)

    const y = layer.align.vertical === 'center'
        ? trunc((boxHeight - placedHeight) / 2)
        : layer.align.vertical === 'bottom'
            ? boxHeight - placedHeight
            : trunc(layer.shape.padding.top)

    return { x, y }
}

/**
 * 内容区内图片的绘制起点（PHP ImageLayer::getImageOrigin：对齐 + padding），纯布局计算，
 * 渲染端共用。policies 随布局函数族贯通（Image 宽高无求值，当前恒声明值——与 PHP
 * 动态分派在 Image 上无覆写同门）
 */
export function imageOrigin(layer: ImageLayer, policies?: TextLayoutPolicies): { x: number; y: number } {
    return alignedOrigin(layer, layerWidth(layer, policies), layerHeight(layer, policies), contentWidth(layer, policies), contentHeight(layer, policies))
}

/**
 * contain 收缩矩形（ADR 0023，PHP ImageLayer::getContainRect 同门）：按源图内在比例
 * 把内容盒收缩成等比矩形——两维同一缩放系数取 min（长边贴内容盒），放置复用
 * alignedOrigin（与 imageOrigin 同门）。返回矩形相对图层盒原点；imgWidth/imgHeight
 * 须为正（非法尺寸由调用方门控——读取失败按 cover 走，PHP getimagesize 失败同门），
 * 收缩结果 ≤0 由渲染后端 drawImage 防护只画盒
 */
export function containRect(
    layer: ImageLayer,
    imgWidth: number,
    imgHeight: number,
    policies?: TextLayoutPolicies,
): { x: number; y: number; width: number; height: number } {
    const scale = Math.min(contentWidth(layer, policies) / imgWidth, contentHeight(layer, policies) / imgHeight)
    const width = trunc(imgWidth * scale)
    const height = trunc(imgHeight * scale)

    return {
        ...alignedOrigin(layer, layerWidth(layer, policies), layerHeight(layer, policies), width, height),
        width,
        height,
    }
}

/**
 * cover 裁窗公式唯一落点（ADR 0024，PHP ImageLayer::coverSourceWindow 同门）：
 * 源图坐标系里与目标矩形同宽高比的窗口——窗外部分被裁切不绘制，恒居中裁（对齐不进
 * 源窗）。图片臂（内容盒）与画布背景臂（画布矩形）共用同一公式防数学漂移；
 * boxWidth×boxHeight 为目标矩形（无 padding 语义时传整盒），scale 公式与 containRect
 * 互为 max/min 镜像。imgWidth/imgHeight 须为正（非法尺寸由调用方门控——读取失败
 * 统一退化 fill 形态）；极端宽高比下窗口可合法算出零维，经 srcRect 整图哨兵
 * 落整图拉伸（ADR 0024 哨兵语义——非「后端只画盒」，目标矩形 ≤0 才是后端防护面）
 */
export function coverSourceWindow(
    boxWidth: number,
    boxHeight: number,
    imgWidth: number,
    imgHeight: number,
): { x: number; y: number; width: number; height: number } {
    const scale = Math.max(boxWidth / imgWidth, boxHeight / imgHeight)
    const width = trunc(boxWidth / scale)
    const height = trunc(boxHeight / scale)

    return {
        x: trunc((imgWidth - width) / 2),
        y: trunc((imgHeight - height) / 2),
        width,
        height,
    }
}

/**
 * cover 等比居中裁窗的图层版（ADR 0024，PHP ImageLayer::getCoverRect 同门）：
 * 目标矩形取内容盒——padding 经内容盒收缩间接收窄窗口，对齐不进源窗。返回矩形为
 * 源图坐标；imgWidth/imgHeight 须为正（非法尺寸由调用方门控——读取失败统一退化
 * fill 形态），与 containRect 同门纯布局函数
 */
export function coverSourceRect(
    layer: ImageLayer,
    imgWidth: number,
    imgHeight: number,
    policies?: TextLayoutPolicies,
): { x: number; y: number; width: number; height: number } {
    return coverSourceWindow(contentWidth(layer, policies), contentHeight(layer, policies), imgWidth, imgHeight)
}

/** tile 单个可见块：src（源图坐标）/dst（图层盒坐标，与 containRect 同门）可见子矩形一一对应 */
export interface TileBlock {
    src: { x: number; y: number; width: number; height: number }
    dst: { x: number; y: number; width: number; height: number }
}

/**
 * tile 可见块矩形组（ADR 0024，PHP ImageLayer::getTileRects 同门）：单元 = 内在尺寸
 * 1:1 零参数，首块左上锚定于对齐 + padding（alignedOrigin 同门——小图 center 网格
 * 整体居中、大图 center 锚点为负露出图片中部），网格自首块向右向下无限延伸，绘制面 =
 * 网格 ∩ 内容盒：末行末列半块截断、锚点未覆盖处空隙透明露下层，行主序。每块 src/dst
 * 一一对应（可见子矩形 1:1 映射，src 为源图坐标、dst 相对图层盒原点）；可见块数不设
 * 上限（静默截断是语义意外）。纯布局计算；imgWidth/imgHeight 须为正（非法尺寸由
 * 调用方门控），零块 = 内容区被 padding 吃满或交集为空
 */
export function tileRects(
    layer: ImageLayer,
    imgWidth: number,
    imgHeight: number,
    policies?: TextLayoutPolicies,
): TileBlock[] {
    const anchor = alignedOrigin(layer, layerWidth(layer, policies), layerHeight(layer, policies), imgWidth, imgHeight)
    const left = trunc(layer.shape.padding.left)
    const top = trunc(layer.shape.padding.top)
    const right = left + contentWidth(layer, policies)
    const bottom = top + contentHeight(layer, policies)

    const blocks: TileBlock[] = []
    for (let y = anchor.y; y < bottom; y += imgHeight) {
        const dstY = Math.max(y, top)
        const dstHeight = Math.min(y + imgHeight, bottom) - dstY
        if (dstHeight <= 0) continue
        for (let x = anchor.x; x < right; x += imgWidth) {
            const dstX = Math.max(x, left)
            const dstWidth = Math.min(x + imgWidth, right) - dstX
            if (dstWidth <= 0) continue
            blocks.push({
                src: { x: dstX - x, y: dstY - y, width: dstWidth, height: dstHeight },
                dst: { x: dstX, y: dstY, width: dstWidth, height: dstHeight },
            })
        }
    }

    return blocks
}

/**
 * 二维码内容边长 = min(内容区宽, 内容区高)：内切于内容盒的正方形（PHP getContentSide，
 * quiet zone 语义——padding 留白即码外静区）。内容区负值直通（trunc 不钳零，
 * ≤0 由渲染后端 drawImage 防护只画盒）
 */
export function qrContentSide(layer: QrCodeLayer, policies?: TextLayoutPolicies): number {
    return Math.min(contentWidth(layer, policies), contentHeight(layer, policies))
}

/**
 * 内容盒内二维码的绘制起点（PHP QrCodeLayer::getQrOrigin：对齐 + padding，
 * 镜像 imageOrigin——内容尺寸换成内切边长），纯布局计算。
 * left/top = padding 原点；center = (盒尺寸 - 边长)/2 向零截断；right/bottom = 盒尺寸 - 边长
 */
export function qrOrigin(layer: QrCodeLayer, policies?: TextLayoutPolicies): { x: number; y: number } {
    const width = layerWidth(layer, policies)
    const height = layerHeight(layer, policies)
    const side = qrContentSide(layer, policies)

    // 取值 left/center/right，其余归 0（PHP match default 臂）
    const x = layer.align.horizontal === 'center'
        ? trunc((width - side) / 2)
        : layer.align.horizontal === 'right'
            ? width - side
            : trunc(layer.shape.padding.left)

    const y = layer.align.vertical === 'center'
        ? trunc((height - side) / 2)
        : layer.align.vertical === 'bottom'
            ? height - side
            : trunc(layer.shape.padding.top)

    return { x, y }
}

/**
 * 九锚点偏移（PHP PositionResolver）：把锚点串换算为子层在父盒内的偏移。
 * 不钳位——子层大于父盒时得到负偏移即溢出摆放。
 */
export function anchorOffset(
    anchor: Anchor,
    parentWidth: number,
    parentHeight: number,
    childWidth: number,
    childHeight: number,
): { x: number; y: number } {
    const x = anchor === 'top-right' || anchor === 'right' || anchor === 'bottom-right'
        ? parentWidth - childWidth
        : anchor === 'top' || anchor === 'center' || anchor === 'bottom'
            ? trunc((parentWidth - childWidth) / 2)
            : 0

    const y = anchor === 'bottom-left' || anchor === 'bottom' || anchor === 'bottom-right'
        ? parentHeight - childHeight
        : anchor === 'left' || anchor === 'center' || anchor === 'right'
            ? trunc((parentHeight - childHeight) / 2)
            : 0

    return { x, y }
}
