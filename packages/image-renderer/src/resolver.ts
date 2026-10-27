/**
 * 默认 ResourceResolver（对位 go NewDefaultResolver + resolver/resolver.go 默认
 * 实现）：HTTP 下载（核心 FetchLike 结构面，Node ≥18 全局 fetch 即契合）+ 缓存
 * （进程内内存 + 可选落盘目录，缓存键同式：图片/字体 = sha256(完整URL) hex +
 * URL path 扩展名，QR = sha256(text_width) + .png）+ QR 物化前置注入（后置选项
 * 可覆写）。物化走画布树收集资源（背景图/ImageLayer src/TextLayer font/
 * QrCodeLayer value），字节经核心 setImage 缝以 wire src 同键登记——readonly
 * 领域树零拷贝，物化结果不进 wire（decode-encode 往返恒等不触碰，对位 go
 * 「resolver 回写图层 SetResolvedSrc」在 readonly 约束下的等价语义）。
 *
 * 字体物化：远程 URL 字体下载后经本包字体缝 registerFont 登记（字体非图像，
 * 不经 setImage——核心 resolver.ts 契约明文）；空串/纯数字/本地路径跳过（与
 * isBuiltinFont 同一口径，对位 go materializeFont 跳过条件）。本地路径字体由
 * drawText 直读。
 *
 * preload 预热接线：napi 位图异步解码的装配前提（backend.preload 缝，见
 * backend.ts 文件头）——遍历中对访问到的每个图像 src（含本地路径与 QR 键）
 * 预热，未命中/解码失败静默（渲染面按各自契约降级：drawImage 不画、
 * imageIntrinsicSize 走同步探测）。手写 setImage 的宿主不经此接线，需自行预热。
 *
 * 渲染期取消（go ctx 检查点）v1 不做（06 号决议 E1 记雾区）。
 */
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
    qrImageSrc,
    ResourceMaterializeError,
    layerWidth,
    type Canvas,
    type FetchLike,
    type ImageRegisteringBackend,
    type Layer,
    type QRMaterializer,
    type ResourceResolver,
} from '@hankchen/canvas'

import { QrCodeMaterializer } from './qr'
import { isNumeric, isRemoteURL } from './url'

/** 本包后端渲染缝的最小结构面：核心登记缝 + 字体登记 + 预热（均后端自决实现） */
export interface MaterializationBackend extends ImageRegisteringBackend {
    /** 字体物化缝（ImageRendererBackend 实现；远程 URL 字体字节按键登记） */
    registerFont?(ref: string, data: Uint8Array): void
    /** 渲染前异步预热缝（ImageRendererBackend 实现；位图装配前提） */
    preload?(src: string): Promise<boolean>
}

export interface DefaultResolverOptions {
    /** fetch 注入缝（代理/鉴权/测试桩）；缺省全局 fetch */
    fetchLike?: FetchLike
    /** 落盘缓存根目录；缺省仅内存缓存。子目录 img_layers/text_layers/qr_layers（go 同名） */
    cacheRoot?: string
    /** QR 物化缝；缺省接 QrCodeMaterializer（前置注入），显式 null = 不接线（遇
     * 二维码图层报 qr_materializer_required），传自定义实现则覆写默认 */
    qrMaterializer?: QRMaterializer | null
}

/** 缓存子目录（对位 go resolver：img_layers / text_layers / qr_layers） */
const SUB_IMAGES = 'img_layers'
const SUB_FONTS = 'text_layers'
const SUB_QR = 'qr_layers'

/**
 * 构造带二维码物化的默认解析器（对位 go NewDefaultResolver）：QR 缝固定前置
 * 注入，options 后置可覆写；fetch 缺省全局 fetch，缓存缺省仅内存。同一 resolver
 * 实例的内存缓存跨多次 resolve 共享（命中即跳过，不下载不覆写；对位 go 命中
 * 跳过语义，无失效机制）
 */
export function createDefaultResolver(options: DefaultResolverOptions = {}): ResourceResolver {
    const fetchLike = options.fetchLike ?? ((url: string) => globalThis.fetch(url))
    const qr = options.qrMaterializer === undefined ? new QrCodeMaterializer() : options.qrMaterializer
    const memory = new Map<string, Uint8Array>()
    const cacheRoot = options.cacheRoot

    async function cachedRemoteBytes(sub: string, rawUrl: string): Promise<Uint8Array> {
        const key = `${sub}:${cacheKey(rawUrl)}`
        const hit = memory.get(key)
        if (hit !== undefined) {
            return hit
        }

        const file = cacheRoot === undefined ? null : join(cacheRoot, sub, cacheKey(rawUrl))
        if (file !== null) {
            try {
                const bytes = new Uint8Array(readFileSync(file))
                memory.set(key, bytes)
                return bytes
            } catch {
                // 磁盘未命中走下载
            }
        }

        const content = await download(rawUrl, fetchLike)
        if (file !== null) {
            try {
                mkdirSync(join(cacheRoot!, sub), { recursive: true })
                writeFileSync(file, content)
            } catch (error) {
                throw new ResourceMaterializeError(
                    'resource_save_failed',
                    `remote file(${rawUrl}) save to cache path failed: ${(error as Error).message}`,
                )
            }
        }
        memory.set(key, content)
        return content
    }

    /**
     * QR 字节缓存（对位 go materializeQrCode：缓存键 = 内容+宽度 hash，命中不再
     * 生成）。落盘失败归 qr_generate_failed（对位 go ErrQRGenerateFailed 的
     * save 臂；与图片/字体的 resource_save_failed 分工同门）
     */
    async function cachedQrBytes(text: string, width: number): Promise<Uint8Array> {
        const key = `qr:${qrCacheKey(text, width)}`
        const hit = memory.get(key)
        if (hit !== undefined) {
            return hit
        }

        const file = cacheRoot === undefined ? null : join(cacheRoot, SUB_QR, qrCacheKey(text, width))
        if (file !== null) {
            try {
                const bytes = new Uint8Array(readFileSync(file))
                memory.set(key, bytes)
                return bytes
            } catch {
                // 磁盘未命中走生成
            }
        }

        const bytes = await qr!.materialize(text, width)
        if (file !== null) {
            try {
                mkdirSync(join(cacheRoot!, SUB_QR), { recursive: true })
                writeFileSync(file, bytes)
            } catch (error) {
                throw new ResourceMaterializeError('qr_generate_failed', `qr code save to cache path failed: ${(error as Error).message}`)
            }
        }
        memory.set(key, bytes)
        return bytes
    }

    async function registerImage(backend: MaterializationBackend, key: string, bytes: Uint8Array): Promise<void> {
        if (typeof backend.setImage !== 'function') {
            // 物化结果无处登记属用法错误（不设稳定 code；对位 go 的编译期接口保证）
            throw new Error('资源物化需要后端实现 setImage 登记缝（ImageRendererBackend 即契合）')
        }
        backend.setImage(key, bytes)
        await preloadQuietly(backend, key)
    }

    /** 预热失败静默（渲染面按各自契约降级，物化阶段不因位图装配失败中止） */
    async function preloadQuietly(backend: MaterializationBackend, src: string): Promise<void> {
        if (typeof backend.preload === 'function') {
            await backend.preload(src)
        }
    }

    async function resolve(canvas: Canvas, backend: ImageRegisteringBackend): Promise<void> {
        const materialization = backend as MaterializationBackend

        if (canvas.background !== null && canvas.background.image !== null) {
            const image = canvas.background.image
            if (isRemoteURL(image)) {
                await registerImage(materialization, image, await cachedRemoteBytes(SUB_IMAGES, image))
            } else {
                await preloadQuietly(materialization, image)
            }
        }

        for (const layer of canvas.layers) {
            await resolveLayer(layer, materialization)
        }
    }

    async function resolveLayer(layer: Layer, backend: MaterializationBackend): Promise<void> {
        switch (layer.type) {
            case 'TableLayer':
                for (const row of layer.rows) {
                    await resolveLayer(row, backend)
                }
                break
            case 'TableRowLayer':
                for (const cell of layer.cells) {
                    await resolveLayer(cell, backend)
                }
                break
            case 'TableCellLayer':
                if (layer.content !== null) {
                    await resolveLayer(layer.content, backend)
                }
                break
            case 'ImageLayer': {
                const src = layer.src
                if (src === null) {
                    break
                }
                if (isRemoteURL(src)) {
                    await registerImage(backend, src, await cachedRemoteBytes(SUB_IMAGES, src))
                } else {
                    // 本地路径/data URL 由 drawImage 直读，只做位图预热
                    await preloadQuietly(backend, src)
                }
                break
            }
            case 'TextLayer': {
                const font = layer.font
                // 空串/纯数字 = 渲染端内置默认字体语义（IsBuiltinFont 同口径）；非 URL 本地路径直读
                if (font === '' || isNumeric(font) || !isRemoteURL(font)) {
                    break
                }
                const bytes = await cachedRemoteBytes(SUB_FONTS, font)
                if (typeof backend.registerFont !== 'function') {
                    throw new Error('远程字体物化需要后端实现 registerFont 缝（ImageRendererBackend 即契合）')
                }
                // 注册/TTC 拒收归后端缝实现（字体非图像不经 setImage；resolver 只交字节）
                backend.registerFont(font, bytes)
                break
            }
            case 'QrCodeLayer': {
                const value = layer.value
                if (value === '') {
                    break
                }
                if (qr === null) {
                    throw new ResourceMaterializeError(
                        'qr_materializer_required',
                        '二维码图层物化需要注入 QRMaterializer（ADR-0002：实现在渲染后端包）',
                    )
                }
                // 宽度 = 图层宽（对位 go materializeQrCode 的 l.Width()）
                await registerImage(backend, qrImageSrc(value), await cachedQrBytes(value, layerWidth(layer)))
                break
            }
        }
    }

    return { resolve }
}

/** 下载：非 2xx/空响应体均失败（对位 go HTTPDownloader 失败面），消息含 URL */
async function download(rawUrl: string, fetchLike: FetchLike): Promise<Uint8Array> {
    let response: { ok: boolean; status: number; arrayBuffer: () => Promise<ArrayBuffer> }
    try {
        response = await fetchLike(rawUrl)
    } catch (error) {
        throw new ResourceMaterializeError('resource_download_failed', `could not get remote file(${rawUrl}): ${(error as Error).message}`)
    }
    if (!response.ok) {
        throw new ResourceMaterializeError('resource_download_failed', `could not get remote file(${rawUrl}): HTTP ${response.status}`)
    }
    const buffer = await response.arrayBuffer()
    if (buffer.byteLength === 0) {
        throw new ResourceMaterializeError('resource_download_failed', `could not get remote file(${rawUrl}): 空响应体`)
    }
    return new Uint8Array(buffer)
}

/**
 * 图片/字体缓存键 = sha256(完整 URL) 十六进制 + URL path 原扩展名（同式复制自
 * go resolver.go cacheKey）：有意偏离 PHP 的 basename 键——不同 URL 同名不互覆、
 * 键对查询串敏感；URL 解析失败扩展名缺省
 */
function cacheKey(rawUrl: string): string {
    const sum = createHash('sha256').update(rawUrl).digest('hex')
    let ext = ''
    try {
        const path = new URL(rawUrl).pathname
        ext = path.match(/(\.[a-zA-Z0-9]+)$/)?.[1] ?? ''
    } catch {
        // 扩展名缺省
    }
    return sum + ext
}

/** 二维码缓存键 = sha256(内容_宽度) 十六进制 + ".png"（同式复制自 go qrCacheKey） */
function qrCacheKey(text: string, width: number): string {
    return createHash('sha256').update(`${text}_${width}`).digest('hex') + '.png'
}
