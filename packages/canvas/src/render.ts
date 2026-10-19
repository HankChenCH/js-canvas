/**
 * 五原语渲染契约 + 渲染模板（镜像 php-canvas-next AbstractRenderer）：
 * 物化（工单 04 接入）→ begin → 按 priority 序遍历分派 → 容器下钻 → end。
 * 遍历/锚点合成/嵌套几何收在本模板；具体后端只实现五个绘制原语。drawImage 为
 * 双矩形 blit（ADR 0024）：srcRect → dstRect 拉伸搬运，原语零 fit 语义、零内在尺寸
 * 读取——四档 fit 的几何全部在分派层算定。另带可选内在尺寸度量能力口
 * imageIntrinsicSize?（ADR 0023 引入、ADR 0024 扩为全 fit 前置，查询而非绘制原语）。
 * 文本布局策略（断行/度量）经 policies 注入，缺省为启发式对齐版（见 layout.ts）。
 */
import {
    anchorOffset,
    contentHeight,
    contentWidth,
    containRect,
    coverSourceRect,
    coverSourceWindow,
    imageOrigin,
    layerHeight,
    layerWidth,
    lineHeightPx,
    qrContentSide,
    qrOrigin,
    textLines,
    textOrigin,
    tileRects,
    type TextLayoutPolicies,
} from './layout'
import {
    IMAGE_FIT_CONTAIN,
    IMAGE_FIT_FILL,
    IMAGE_FIT_TILE,
    type Border,
    type Canvas,
    type HorizontalAlign,
    type Layer,
    type VerticalAlign,
} from './types'

/** 背景铺色用无边框形态（背景非图层盒，永无边框；decode NO_BORDER 同构） */
const NO_BORDER: Border = { top: null, bottom: null, left: null, right: null }

/**
 * blit 矩形（ADR 0024）：源窗口（源图坐标）与目标矩形（渲染面坐标）共用形态。
 * srcRect 零宽高哨兵 = 整图语义（后端按解码实际尺寸取整图）——内在尺寸读取失败的
 * fill 形态退化与 QR 整图 blit 都借它表达
 */
export interface BlitRect {
    x: number
    y: number
    width: number
    height: number
}

/** 整图 srcRect：零参 = 零宽高哨兵（尺寸未知），传内在尺寸 = 已知尺寸整图；每次新建防后端改写共享对象 */
function wholeImageRect(width = 0, height = 0): BlitRect {
    return { x: 0, y: 0, width, height }
}

/** 内在尺寸可用判定（全 fit 前置的守门谓词，ADR 0024）：null/零维/负维均不可用 */
function usableIntrinsic(size: { width: number; height: number } | null): size is { width: number; height: number } {
    return size !== null && size.width > 0 && size.height > 0
}

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
    /**
     * 图片双矩形 blit（ADR 0024）：把 src 的 srcRect 子矩形拉伸搬运到 dstRect——
     * 原语零 fit 语义、零内在尺寸读取（四档 fit 的几何全部分派层算定）。
     * srcRect 零宽高哨兵 = 整图（后端按解码实际尺寸取整图）。src 引用查不到/解码
     * 失败由后端处置（静默不画为缺省约定，JS 坏图现状 parity）
     */
    drawImage(src: string, srcRect: BlitRect, dstRect: BlitRect): void
    /** 单行文本，(x, y) 为对齐语义锚点（基线差由后端以字体 metrics 消化） */
    drawText(line: string, x: number, y: number, options: TextDrawOptions): void
    /**
     * 源图内在尺寸度量（ADR 0023 引入、ADR 0024 扩为全 fit 前置）：四档 fit 的分派
     * 几何全部依赖内在比例（cover 裁窗 / fill 整图 / contain 收缩 / tile 单元），尺寸
     * 由渲染端供给（浏览器 naturalWidth/naturalHeight、Node 端解码头部），查询键与
     * drawImage 同一 src 引用。未实现本能力（可选成员，既有后端零破坏）、返回 null
     * 或非法尺寸（≤0）→ 统一退化 fill 形态（整图拉伸进目标矩形；真损坏图由后端解码
     * 处置，结局 parity）。五原语绘制契约冻结（ADR 0022/0024）——本能力是查询口，
     * 非绘制原语
     */
    imageIntrinsicSize?(src: string): { width: number; height: number } | null
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
    paintBackground(canvas, backend)
    forEachLayerBox(canvas, (layer, box) => {
        backend.drawRect(box.x, box.y, box.width, box.height, layer.shape.backgroundColor, layer.shape.border)
        if (options?.skipContent?.(layer)) return
        paintContent(layer, box, backend, policies)
    }, policies)
    backend.end()
}

/**
 * 画布背景铺装（ADR 0022 / canvas-background spec §4）：begin 之后、根层循环之前
 * 的唯一插入点，先色后图——背景之下无物（画布初始透明保留），背景图透明区露背景
 * 色。铺色复用 drawRect 原语（无边框），铺图复用 drawImage 原语（blit 双矩形，
 * ADR 0024：铺装恒 cover，分派点读内在尺寸算等比居中裁窗——与图片臂共用同一公式
 * coverSourceWindow；能力缺席/读取失败退化 fill 形态，零哨兵整图由后端按解码实际
 * 尺寸取整，真损坏图在后端解码处置，结局 parity）；资源物化属宿主/后端缝，核心模板
 * 只递原始引用；无背景零开销。单图层便捷渲染入口不存在背景语义（无画布矩形），
 * 与 PHP renderLayer / Go RenderLayer 同门
 */
function paintBackground(canvas: Canvas, backend: RenderBackend): void {
    const background = canvas.background
    if (!background) {
        return
    }

    if (background.color) {
        // 先铺色：复用 drawRect 原语，背景无边框
        backend.drawRect(0, 0, canvas.width, canvas.height, background.color, NO_BORDER)
    }

    if (background.image) {
        const size = backend.imageIntrinsicSize?.(background.image) ?? null
        const srcRect = usableIntrinsic(size)
            ? coverSourceWindow(canvas.width, canvas.height, size.width, size.height)
            : wholeImageRect()
        backend.drawImage(background.image, srcRect, { x: 0, y: 0, width: canvas.width, height: canvas.height })
    }
}

/** 盒绘制之后的内容分派（镜像 PHP paintImage/paintText；QR 内容绘制在工单 04 接入） */
function paintContent(
    layer: Layer,
    box: LayerBox,
    backend: RenderBackend,
    policies?: TextLayoutPolicies,
): void {
    switch (layer.type) {
        case 'ImageLayer': {
            // 原始引用为 null 只画盒（未物化/未加载的占位语义）
            if (layer.src === null) break

            // cover/fill 共用目标矩形（同门）：imageOrigin + 内容宽高
            const origin = imageOrigin(layer, policies)
            const dstRect: BlitRect = {
                x: box.x + origin.x,
                y: box.y + origin.y,
                width: box.contentWidth,
                height: box.contentHeight,
            }

            // 内在尺寸为全 fit 前置（ADR 0024）：绘制分派点一次；能力缺席（可选成员
            // 未实现）/返回 null/非法尺寸统一退化 fill 形态——零哨兵整图拉伸进目标
            // 矩形（blit 化后 cover 也依赖度量，不再有原语兜底；真损坏图由后端解码
            // 处置，渲染结局与迁移前 parity）
            const intrinsic = backend.imageIntrinsicSize?.(layer.src) ?? null
            if (!usableIntrinsic(intrinsic)) {
                backend.drawImage(layer.src, wholeImageRect(), dstRect)
                break
            }

            // 白名单分派（ADR 0024）：四档 fit 的几何全部在此算定，未知值落 cover 臂
            switch (layer.fit) {
                case IMAGE_FIT_CONTAIN: {
                    // contain（ADR 0023 语义不动）：按内在比例收缩目标矩形再整图 blit
                    const rect = containRect(layer, intrinsic.width, intrinsic.height, policies)
                    backend.drawImage(
                        layer.src,
                        wholeImageRect(intrinsic.width, intrinsic.height),
                        { x: box.x + rect.x, y: box.y + rect.y, width: rect.width, height: rect.height },
                    )
                    break
                }
                case IMAGE_FIT_TILE:
                    // tile：可见块逐块 blit（src/dst 1:1），裁切纯几何完成、原语零裁剪参数
                    for (const block of tileRects(layer, intrinsic.width, intrinsic.height, policies)) {
                        backend.drawImage(
                            layer.src,
                            block.src,
                            {
                                x: box.x + block.dst.x,
                                y: box.y + block.dst.y,
                                width: block.dst.width,
                                height: block.dst.height,
                            },
                        )
                    }
                    break
                case IMAGE_FIT_FILL:
                    // fill：整图进与 cover 相同的目标矩形（非等比拉伸，不裁切不留空隙）
                    backend.drawImage(layer.src, wholeImageRect(intrinsic.width, intrinsic.height), dstRect)
                    break
                default:
                    // cover（缺省/显式归一/未知值白名单外降级）：等比居中裁窗
                    backend.drawImage(layer.src, coverSourceRect(layer, intrinsic.width, intrinsic.height, policies), dstRect)
                    break
            }
            break
        }
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
            // 二维码内切于内容盒：边长 = min(内容区宽高)（quiet zone 语义——padding 留白
            // 即码外静区，露图层盒背景），对齐 + padding 定位（镜像 PHP paintQrCode /
            // paintImage 同族）；边长 ≤0 由后端 drawImage 防护只画盒。空值无内容（PHP
            // resolvedSrc null 同门）；未物化时后端查不到键只画盒——占位语义
            if (layer.value !== '') {
                const origin = qrOrigin(layer, policies)
                const side = qrContentSide(layer, policies)
                // 整图 blit（ADR 0024）：产物恒正方形、目标恒正方形，cover 窗 = 整图——
                // srcRect 零哨兵、零内在尺寸读取；quiet zone 语义（padding 留白即码外
                // 静区）与对齐 + padding 定位不变（镜像 PHP paintQrCode / paintImage
                // 同族）。空值无内容（PHP resolvedSrc null 同门）；未物化时后端查不到
                // 键只画盒——占位语义；边长 ≤0 由后端 drawImage 防护只画盒
                backend.drawImage(
                    qrImageSrc(layer.value),
                    wholeImageRect(),
                    { x: box.x + origin.x, y: box.y + origin.y, width: side, height: side },
                )
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
