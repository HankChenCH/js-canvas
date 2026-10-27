/**
 * @hankchen/canvas-image-renderer 公共出口：位图渲染后端（五原语 + setImage/
 * registerFont/preload 装配缝）、EXIF 混合口径映射件、napi 度量增强件（08 号
 * 决议，显式注入）、QR 物化与默认 resolver（对位 go image-renderer module 的
 * 导出面）。渲染契约与物化契约类型来自 @hankchen/canvas，不在此重复导出。
 */
export const PACKAGE_NAME = '@hankchen/canvas-image-renderer' as const

export { ImageRendererBackend } from './backend'
export {
    createDefaultResolver,
    type DefaultResolverOptions,
    type MaterializationBackend,
} from './resolver'
export { QrCodeMaterializer } from './qr'
export { createNapiMeasurerFactory, isBuiltinFont, loadFontFamily, registerFontData } from './typography'
export { drawTextLine } from './text'
export { parseColor, cssColor, type NrgbaColor } from './color'
export { canonicalSourceRect, exifOrientation, rawDimensions, type SourceRect } from './exif'
export { decodeDrawableImage, decodeHeaderSize, loadSourceBytes, type ByteRegistry } from './decode'
