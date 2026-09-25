/**
 * @hankchen/canvas-next 文档模型公共出口。
 *
 * graph wire 类型与解码校验、画布/图层纯结构（6 种 type 可辨识联合）、
 * 布局纯函数、五原语渲染契约。红线：零 DOM、零运行时依赖
 * （tsconfig 无 DOM lib + dependency-cruiser 双闸锁死）。
 */
export const PACKAGE_NAME = '@hankchen/canvas-next' as const

export * from './types'
export * from './wire'
export { UnknownLayerTypeError, decodeGraph, decodeLayer } from './decode'
export { encodeGraph, encodeLayer } from './encode'
export {
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
export {
    type LayerBox,
    type RenderBackend,
    type RenderCanvasOptions,
    type TextDrawOptions,
    forEachLayerBox,
    qrImageSrc,
    renderCanvas,
    resolveChildAt,
    resolveLayerBox,
} from './render'
export {
    LINE_END_FORBIDDEN,
    LINE_START_FORBIDDEN,
    type LineBreaker,
    type TextMeasurer,
    type TextMeasurerFactory,
    createHeuristicMeasurer,
    createUax14LineBreaker,
    heuristicMeasurerFactory,
    splitGraphemes,
} from './text'
