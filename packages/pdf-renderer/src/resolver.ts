/**
 * 资源物化默认实现（核心 resolver.ts 缝契约的消费端；对位 go resolver 包 +
 * 两后端 qr.go 的 NewDefaultResolver/NewRenderer 接线形态）：
 * - 远程图片/字体经注入的 Downloader（默认全局 fetch）下载进内容寻址磁盘缓存，
 *   图片以 wire src 同键经 setImage 登记进后端（工票 09 物化缝形态），字体按原始
 *   引用经 registerFontData 登记（字体非图像，不经 setImage——核心契约注明）；
 * - 二维码内容经 QRMaterializer 缝物化为 PNG，以 qrImageSrc 同键（`qr:` 前缀）登记；
 * - 本地路径直通不登记（渲染端同步读盘，对位 go「本地路径直接使用」）。
 *
 * readonly 领域树零拷贝：物化结果不进 wire（decode-encode 往返恒等不触碰），只经
 * 后端登记缝进入渲染面。首个错误即中止（失败即抛 ResourceMaterializeError、稳定
 * code、渲染不启动）。
 */
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
    qrImageSrc,
    renderAs,
    renderPagesAs,
    ResourceMaterializeError,
    type Canvas,
    type Downloader,
    type ImageRegisteringBackend,
    type QRMaterializer,
    type ResourceResolver,
} from '@hankchen/canvas'
import type { Layer, RenderCanvasOptions, TextLayoutPolicies } from '@hankchen/canvas'

import { PdfRenderer } from './backend'
import { QrCodeMaterializer } from './qr'
import { isNumeric, isRemoteURL } from './url'

/** 后端包字体登记缝（核心契约注明「注册缝归后端包契约」的落点，与 PdfRenderer
 * registerFontData 同构——结构化匹配，物化器不依赖绘制原语） */
export interface FontRegisteringBackend {
    registerFontData?(key: string, data: Uint8Array): void
}

/** 组装选项：注入自定义下载器/fetch（代理、鉴权、测试桩）、缓存根与 QR 物化器 */
export interface ResolverOptions {
    downloader?: Downloader
    fetch?: (url: string) => Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer> }>
    cacheRoot?: string
    qrMaterializer?: QRMaterializer
}

/** 资源物化默认实现（实现核心 ResourceResolver 契约） */
export class DefaultResourceResolver implements ResourceResolver {
    private readonly downloader: Downloader
    private readonly qr: QRMaterializer
    private readonly cacheRoot: string

    constructor(options: ResolverOptions = {}) {
        this.downloader = options.downloader ?? createFetchDownloader(options.fetch ?? globalThis.fetch.bind(globalThis))
        this.qr = options.qrMaterializer ?? new QrCodeMaterializer()
        this.cacheRoot = options.cacheRoot ?? defaultCacheRoot()
    }

    /** resolve 物化画布全部资源：背景图、各图层图片 src、二维码内容、字体 URL。
     * 字体登记缝（registerFontData）与图像登记缝（setImage）同为可选能力口，缺席
     * 对应资源直通（对位 go 回写图层前不假设 setter 在场的防御形态） */
    async resolve(canvas: Canvas, backend: ImageRegisteringBackend): Promise<void> {
        if (canvas.background?.image !== null && canvas.background?.image !== undefined && canvas.background.image !== '') {
            await this.materializeImage(canvas.background.image, backend)
        }
        for (const layer of canvas.layers) {
            await this.resolveLayer(layer, backend)
        }
    }

    /** resolveLayer 物化单图层；容器递归下钻 表→行→单元格→内容层（对位 go 同名分派） */
    private async resolveLayer(layer: Layer, backend: ImageRegisteringBackend): Promise<void> {
        switch (layer.type) {
            case 'TableLayer':
                for (const row of layer.rows) {
                    await this.resolveLayer(row, backend)
                }
                break
            case 'TableRowLayer':
                for (const cell of layer.cells) {
                    await this.resolveLayer(cell, backend)
                }
                break
            case 'TableCellLayer':
                if (layer.content !== null) {
                    await this.resolveLayer(layer.content, backend)
                }
                break
            case 'ImageLayer':
                if (layer.src !== null) {
                    await this.materializeImage(layer.src, backend)
                }
                break
            case 'TextLayer':
                await this.materializeFont(layer, backend)
                break
            case 'QrCodeLayer':
                await this.materializeQrCode(layer.value, layer.shape.width, backend)
                break
        }
    }

    /** materializeImage 图片物化：仅远程 URL 才下载登记；本地路径直通（渲染端读盘） */
    private async materializeImage(
        src: string,
        backend: ImageRegisteringBackend,
    ): Promise<void> {
        if (!isRemoteURL(src)) {
            return
        }
        const bytes = await this.cachedRemoteFile('img_layers', src)
        if (typeof backend.setImage !== 'function') {
            return // 后端无登记缝（可选能力口缺席）：直通语义由渲染端处置
        }
        backend.setImage(src, bytes)
    }

    /** materializeFont 字体物化：空串/纯数字 = 渲染端内置默认字体语义跳过；仅 URL 下载
     * 并按原始引用登记（渲染实际字体 = 登记字节优先）。isNumeric 与渲染后端回退默认
     * 字体是同一口径（防两处判定漂移，对位 go resolver.IsNumeric 导出分工） */
    private async materializeFont(
        layer: Extract<Layer, { type: 'TextLayer' }>,
        backend: ImageRegisteringBackend,
    ): Promise<void> {
        const font = layer.font
        if (font === '' || isNumeric(font) || !isRemoteURL(font)) {
            return
        }
        const bytes = await this.cachedRemoteFile('text_layers', font)
        const fontSink = backend as Partial<FontRegisteringBackend>
        if (typeof fontSink.registerFontData !== 'function') {
            return
        }
        fontSink.registerFontData(font, bytes)
    }

    /** materializeQrCode 二维码物化：空内容跳过；PNG 字节经 QRMaterializer 缝生成，
     * 缓存键 = 内容+宽度 hash，命中不再生成；以 qrImageSrc 同键（`qr:` 前缀）登记 */
    private async materializeQrCode(
        text: string,
        width: number,
        backend: ImageRegisteringBackend,
    ): Promise<void> {
        if (text === '') {
            return
        }
        if (typeof backend.setImage !== 'function') {
            return
        }
        const bytes = await this.cachedQrCode(text, width)
        backend.setImage(qrImageSrc(text), bytes)
    }

    /** cachedRemoteFile 远程文件落缓存：命中即跳过（不再下载、不覆写）；下载失败报
     * resource_download_failed、落盘失败报 resource_save_failed（对位 go 同名语义） */
    private async cachedRemoteFile(sub: string, rawUrl: string): Promise<Uint8Array> {
        const dir = this.ensureCacheDir(sub)
        const p = path.join(dir, cacheKey(rawUrl))
        const cached = readFileIfExists(p)
        if (cached !== null) {
            return cached
        }
        const content = await this.downloadOrThrow(rawUrl)
        this.writeFileOrThrow(p, content, `remote file(${rawUrl}) save to tmp path failed`)
        return content
    }

    /** cachedQrCode 二维码缓存：键 = sha256(内容_宽度) + ".png"（对位 go qrCacheKey） */
    private async cachedQrCode(text: string, width: number): Promise<Uint8Array> {
        const dir = this.ensureCacheDir('qr_layers')
        const sum = createHash('sha256').update(`${text}_${width}`, 'utf8').digest('hex')
        const p = path.join(dir, `${sum}.png`)
        const cached = readFileIfExists(p)
        if (cached !== null) {
            return cached
        }
        let png: Uint8Array
        try {
            png = await this.qr.materialize(text, width)
        } catch (err) {
            throw new ResourceMaterializeError('qr_generate_failed', `qr code generate failed(${text}): ${(err as Error).message}`)
        }
        try {
            fs.writeFileSync(p, png)
        } catch (err) {
            throw new ResourceMaterializeError('qr_generate_failed', `qr code save to tmp path failed: ${p}: ${(err as Error).message}`)
        }
        return png
    }

    private async downloadOrThrow(rawUrl: string): Promise<Uint8Array> {
        let content: Uint8Array
        try {
            content = await this.downloader.download(rawUrl)
        } catch (err) {
            throw new ResourceMaterializeError('resource_download_failed', `could not get remote file(${rawUrl}): ${(err as Error).message}`)
        }
        if (content.length === 0) {
            throw new ResourceMaterializeError('resource_download_failed', `could not get remote file(${rawUrl})`)
        }
        return content
    }

    private writeFileOrThrow(p: string, content: Uint8Array, what: string): void {
        try {
            fs.writeFileSync(p, content)
        } catch (err) {
            throw new ResourceMaterializeError('resource_save_failed', `${what}: ${p}: ${(err as Error).message}`)
        }
    }

    /** ensureCacheDir 确保缓存子目录存在且可写；默认根每次现算不回写（Resolve 可安全并发） */
    private ensureCacheDir(sub: string): string {
        const dir = path.join(this.cacheRoot, sub)
        try {
            fs.mkdirSync(dir, { recursive: true })
        } catch (err) {
            throw new ResourceMaterializeError('resource_save_failed', `tmp path can not writable: ${dir}: ${(err as Error).message}`)
        }
        return dir
    }
}

/** 缓存键 = sha256(完整 URL) + URL path 原扩展名（对位 go cacheKey：不同 URL 的
 * 同名文件不相互覆盖，键对查询串敏感；解析失败扩展名缺省） */
function cacheKey(rawUrl: string): string {
    const sum = createHash('sha256').update(rawUrl, 'utf8').digest('hex')
    let ext = ''
    try {
        ext = path.extname(new URL(rawUrl).pathname)
    } catch {
        // URL 解析失败扩展名缺省
    }
    return sum + ext
}

function readFileIfExists(p: string): Uint8Array | null {
    try {
        return new Uint8Array(fs.readFileSync(p))
    } catch {
        return null
    }
}

/** createFetchDownloader 默认 HTTP 下载器：Node ≥18 全局 fetch；非 2xx/空体失败
 * （对位 go HTTPDownloader 的失败面；取消信号 v1 不做，06 号决议 E1 记雾区） */
export function createFetchDownloader(fetchFn: (url: string) => Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer> }>): Downloader {
    return {
        async download(rawUrl: string): Promise<Uint8Array> {
            let response
            try {
                response = await fetchFn(rawUrl)
            } catch (err) {
                throw new Error(`fetch(${rawUrl}): ${(err as Error).message}`)
            }
            if (!response.ok) {
                throw new Error(`fetch(${rawUrl}): status ${response.status}`)
            }
            return new Uint8Array(await response.arrayBuffer())
        },
    }
}

/** defaultCacheDir 系统缓存根（对位 go os.UserCacheDir()/go-canvas 的 node 对位）：
 * XDG_CACHE_HOME → darwin ~/Library/Caches → ~/.cache，下挂 js-canvas */
function defaultCacheRoot(): string {
    if (process.env.XDG_CACHE_HOME !== undefined && process.env.XDG_CACHE_HOME !== '') {
        return path.join(process.env.XDG_CACHE_HOME, 'js-canvas')
    }
    const home = os.homedir()
    if (process.platform === 'darwin') {
        return path.join(home, 'Library', 'Caches', 'js-canvas')
    }
    return path.join(home, '.cache', 'js-canvas')
}

/**
 * createDefaultResolver 构造带二维码物化的默认解析器（对位 go NewDefaultResolver）：
 * 选项透传，QR 缝固定接本包 QrCodeMaterializer
 */
export function createDefaultResolver(options: ResolverOptions = {}): DefaultResourceResolver {
    return new DefaultResourceResolver(options)
}

/**
 * createRenderer 组装 PDF 渲染器（对位 go qr.go NewRenderer，PHP 侧 PdfRenderer 的
 * 对应物）：PDF 后端 + 自带默认物化器（backend.defaultResolver 挂载）。rs 缺省时取
 * createDefaultResolver()（二维码缝已接线、缓存根为系统默认）；传入自建解析器时按
 * 原样使用——自定义缓存根须经 createDefaultResolver({ cacheRoot }) 构造。核心管线
 * 消费形态（物化属渲染前的异步准备阶段，渲染本身保持同步管线）：
 *
 *     const backend = createRenderer()
 *     await backend.defaultResolver!.resolve(canvas, backend)   // 或自建 resolver
 *     const pdf = renderAs<Uint8Array>(canvas, backend)
 */
export function createRenderer(rs?: ResourceResolver): PdfRenderer {
    const backend = new PdfRenderer()
    backend.defaultResolver = rs ?? createDefaultResolver()
    return backend
}

/**
 * renderCanvasAsPdf 单页便捷入口（对位 go renderer.RenderAs[[]byte] 消费形态的本包
 * 具体化）：默认组装（自带默认物化器）→ 物化 → 核心单页编排直出 PDF 文档字节。
 * options.resolver 可注入自建解析器（自定义缓存根/下载器/QR 物化器）；policies 与
 * options 原样透传核心 renderAs
 */
export async function renderCanvasAsPdf(
    canvas: Canvas,
    options: {
        resolver?: ResourceResolver
        policies?: TextLayoutPolicies
        render?: RenderCanvasOptions
    } = {},
): Promise<Uint8Array> {
    const backend = createRenderer(options.resolver)
    await backend.defaultResolver!.resolve(canvas, backend)
    return renderAs<Uint8Array>(canvas, backend, options.policies, options.render)
}

/**
 * renderPagesAsPdf 多页便捷入口（对位 go pdf-renderer/renderpages.go RenderPages）：
 * 消费已分页页序列（帧序×页序）出单 PDF 文档字节。编排语义归核心 renderPagesAs
 * （n 页 n 次 begin + 单文档一次 end；空页序列报错；任一页失败无产物逃逸），
 * 本入口只做默认组装 + 物化接线
 */
export async function renderPagesAsPdf(
    pages: readonly Canvas[],
    options: {
        resolver?: ResourceResolver
        policies?: TextLayoutPolicies
        render?: RenderCanvasOptions
    } = {},
): Promise<Uint8Array> {
    const backend = createRenderer(options.resolver)
    for (const page of pages) {
        await backend.defaultResolver!.resolve(page, backend)
    }
    return renderPagesAs<Uint8Array>(pages, backend, options.policies, options.render)
}
