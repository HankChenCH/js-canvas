/**
 * @hankchen/canvas 文档模型公共出口。
 *
 * graph wire 类型与解码校验、画布/图层纯结构（7 种 type 可辨识联合）、
 * 布局纯函数、五原语渲染契约。红线：零 DOM、零运行时依赖
 * （tsconfig 无 DOM lib + dependency-cruiser 双闸锁死）。
 */
export const PACKAGE_NAME = '@hankchen/canvas' as const

export * from './types'
export * from './wire'
export {
    RowsPathMissingError,
    TemplateRowsConflictError,
    UnknownLayerTypeError,
    decodeGraph,
    decodeLayer,
} from './decode'
export { encodeGraph, encodeLayer } from './encode'
export {
    docPathToViewPath,
    viewPathToDocPath,
    withTemplatePreview,
} from './preview'
export {
    anchorOffset,
    circleStroke,
    contentHeight,
    contentWidth,
    containRect,
    coverSourceRect,
    coverSourceWindow,
    imageOrigin,
    inscribedCircleRect,
    layerHeight,
    layerWidth,
    lineHeightPx,
    textLines,
    textOrigin,
    tileRects,
    type TextLayoutPolicies,
    type TileBlock,
} from './layout'
export {
    type BlitRect,
    type LayerBox,
    ProductTypeMismatchError,
    type RenderBackend,
    type RenderCanvasOptions,
    type ShapeCapableBackend,
    type TextDrawOptions,
    forEachLayerBox,
    qrImageSrc,
    renderAs,
    renderCanvas,
    renderPages,
    renderPagesAs,
    resolveChildAt,
    resolveLayerBox,
} from './render'
export {
    LINE_END_FORBIDDEN,
    LINE_START_FORBIDDEN,
    type LineBreaker,
    type MeasureTextMeasurerOptions,
    type MeasureTextSource,
    type TextMeasurer,
    type TextMeasurerFactory,
    createHeuristicMeasurer,
    createMeasureTextMeasurerFactory,
    createUax14LineBreaker,
    heuristicMeasurerFactory,
    splitGraphemes,
} from './text'
