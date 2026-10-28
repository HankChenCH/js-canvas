/**
 * @hankchen/canvas-pdf-renderer 公共出口。
 *
 * 画布页序列 → PDF 文档字节的 Node 渲染后端：pdfkit 底座实现核心五原语渲染契约
 * （对位 go-canvas pdf-renderer module），带默认资源物化器（HTTP 下载 + 缓存 +
 * QR 物化）组装入口。零 DOM（Node 世界）；包依赖红线：自带依赖、与 image-renderer
 * 包互不 import（共享小件同式复制并注明出处）。
 */
export { PdfRenderer, borderBands, rgbHex } from './backend'
export { parseColor, type Rgba } from './color'
export { hasPngSignature, imageDimensions, sniffType, type ImageFormat, type ImageDimensions } from './decode'
export { exifOrientation } from './exif'
export {
    PX_TO_PT,
    after,
    apply,
    embedBlit,
    orientAffine,
    placeMatrix,
    transformRect,
    type Affine,
    type IntRect,
} from './image'
export { QrCodeMaterializer } from './qr'
export {
    createDefaultResolver,
    createFetchDownloader,
    createRenderer,
    DefaultResourceResolver,
    renderCanvasAsPdf,
    renderPagesAsPdf,
    type FontRegisteringBackend,
    type ResolverOptions,
} from './resolver'
export { drawTextLine } from './text'
export { isNumeric, isRemoteURL } from './url'
