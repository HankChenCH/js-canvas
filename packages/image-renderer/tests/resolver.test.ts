/**
 * 默认 resolver 测试（对位 go NewDefaultResolver + resolver.go 默认实现）：
 * 资源树遍历（背景/图片/字体/二维码）、缓存键同式、错误 code 面、内存缓存、
 * 字体物化缝与 preload 预热接线。fetch 经 FetchLike 结构面注桩。
 */
import { decodeGraph, qrImageSrc, ResourceMaterializeError, type Canvas, type QRMaterializer } from '@hankchen/canvas'
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { createDefaultResolver } from '../src/resolver'
import { canvasPng, makeCanvas } from './helpers'

/** 记录型后端替身（ImageRegisteringBackend + 本包字体/预热缝的最小结构面） */
function recordingBackend() {
    const images: Array<{ key: string; data: Uint8Array }> = []
    const fonts: Array<{ ref: string; data: Uint8Array }> = []
    const preloads: string[] = []
    return {
        images,
        fonts,
        preloads,
        backend: {
            setImage: (key: string, data: Uint8Array) => {
                images.push({ key, data: new Uint8Array(data) })
            },
            registerFont: (ref: string, data: Uint8Array) => {
                fonts.push({ ref, data: new Uint8Array(data) })
            },
            preload: (src: string) => {
                preloads.push(src)
                return Promise.resolve(true)
            },
        },
    }
}

/** PNG 测试图字节（远程下载的桩响应体） */
function pngBytes(): Uint8Array {
    const { canvas } = makeCanvas(4, 4, (ctx) => {
        ctx.fillStyle = '#f00'
        ctx.fillRect(0, 0, 4, 4)
    })
    return canvasPng(canvas)
}

/** fetch 桩：按 URL 分发表 + 调用记录 */
function fetchStub(table: Record<string, Uint8Array | 'fail' | 'empty'>) {
    const calls: string[] = []
    const fetchLike = async (url: string) => {
        calls.push(url)
        const entry = table[url]
        if (entry === 'fail' || entry === undefined) {
            return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) }
        }
        if (entry === 'empty') {
            return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(0) }
        }
        const bytes = new Uint8Array(entry)
        return {
            ok: true,
            status: 200,
            arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
        }
    }
    return { calls, fetchLike }
}

/** 带远程图片 + 远程字体 + QR 的画布（decodeGraph wire 面） */
function docWithRemoteImageAndFont(): Canvas {
    return decodeGraph({
        canvas: {
            width: 100,
            height: 100,
            background: { color: null, image: 'https://cdn.example.com/bg.png' },
        },
        layers: [
            {
                type: 'ImageLayer',
                spec: { shape: { width: 40, height: 30 } },
                data: { valueType: 'StaticValue', value: 'https://cdn.example.com/photo.jpg' },
            },
            {
                type: 'ImageLayer',
                spec: { shape: { width: 40, height: 30 }, position: { y: 40 } },
                data: { valueType: 'StaticValue', value: '/local/images/plain.png' },
            },
            {
                type: 'TextLayer',
                spec: {
                    shape: { width: 80, height: 20, lineHeight: 1.2 },
                    position: { y: 80 },
                    fontFamily: { font: 'https://fonts.example.com/go-canvas.ttf' },
                },
                data: { valueType: 'StaticValue', value: '标题' },
            },
            {
                type: 'QrCodeLayer',
                spec: { shape: { width: 20, height: 20 }, position: { x: 80 } },
                data: { valueType: 'StaticValue', value: 'https://example.com/go-canvas' },
            },
        ],
    })
}

describe('createDefaultResolver 资源树遍历与登记（wire src 同键，物化不进 wire）', () => {
    it('远程图片/背景/字体下载登记，本地路径跳过下载但预热，QR 以 qr: 键登记', async () => {
        const doc = docWithRemoteImageAndFont()
        const stub = fetchStub({
            'https://cdn.example.com/bg.png': pngBytes(),
            'https://cdn.example.com/photo.jpg': pngBytes(),
            'https://fonts.example.com/go-canvas.ttf': new Uint8Array([1, 2, 3, 4]),
        })
        const { backend, images, fonts, preloads } = recordingBackend()

        await createDefaultResolver({ fetchLike: stub.fetchLike }).resolve(doc, backend)

        // 登记键 = wire src 原文（远程 URL）+ qr: 前缀键；本地路径不登记（drawImage 直读）
        expect(images.map((r) => r.key).sort()).toEqual(
            ['https://cdn.example.com/bg.png', 'https://cdn.example.com/photo.jpg', qrImageSrc('https://example.com/go-canvas')].sort(),
        )
        expect(images.find((r) => r.key === 'https://cdn.example.com/photo.jpg')!.data).toEqual(pngBytes())
        // 字体下载走字体缝（不经 setImage——字体非图像）
        expect(fonts).toEqual([{ ref: 'https://fonts.example.com/go-canvas.ttf', data: new Uint8Array([1, 2, 3, 4]) }])
        // 预热覆盖所有图像 src（含本地路径）与 QR 键，不含字体
        expect(preloads.sort()).toEqual(
            ['/local/images/plain.png', 'https://cdn.example.com/bg.png', 'https://cdn.example.com/photo.jpg', qrImageSrc('https://example.com/go-canvas')].sort(),
        )
        // wire 只读：物化不进 wire（decode-encode 往返恒等不触碰）
        expect((doc.layers[0] as { src: string | null }).src).toBe('https://cdn.example.com/photo.jpg')
        expect(stub.calls).toEqual([
            'https://cdn.example.com/bg.png',
            'https://cdn.example.com/photo.jpg',
            'https://fonts.example.com/go-canvas.ttf',
        ])
    })

    it('内存缓存：同一 resolver 跨 resolve 同 URL 只下载一次', async () => {
        const doc = docWithRemoteImageAndFont()
        const stub = fetchStub({
            'https://cdn.example.com/bg.png': pngBytes(),
            'https://cdn.example.com/photo.jpg': pngBytes(),
            'https://fonts.example.com/go-canvas.ttf': new Uint8Array([1, 2, 3, 4]),
        })
        const resolver = createDefaultResolver({ fetchLike: stub.fetchLike })
        await resolver.resolve(doc, recordingBackend().backend)
        await resolver.resolve(doc, recordingBackend().backend)
        expect(stub.calls.filter((u) => u === 'https://cdn.example.com/photo.jpg')).toHaveLength(1)
    })

    it('落盘缓存：命中文件不再下载，跨 resolver 实例共享', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'image-renderer-cache-'))
        const doc = decodeGraph({
            canvas: { width: 10, height: 10 },
            layers: [
                {
                    type: 'ImageLayer',
                    spec: { shape: { width: 10, height: 10 } },
                    data: { valueType: 'StaticValue', value: 'https://cdn.example.com/cached.png' },
                },
            ],
        })
        const stub = fetchStub({ 'https://cdn.example.com/cached.png': pngBytes() })
        await createDefaultResolver({ fetchLike: stub.fetchLike, cacheRoot: dir }).resolve(doc, recordingBackend().backend)
        expect(stub.calls).toHaveLength(1)
        // 子目录 img_layers + 缓存键 = sha256(URL) hex + 扩展名（对位 go cacheKey）
        const files = readdirSync(join(dir, 'img_layers'))
        expect(files).toHaveLength(1)
        expect(files[0]).toMatch(/^[0-9a-f]{64}\.png$/)
        // 新实例同 cacheRoot：磁盘命中，零下载
        await createDefaultResolver({ fetchLike: stub.fetchLike, cacheRoot: dir }).resolve(doc, recordingBackend().backend)
        expect(stub.calls).toHaveLength(1)
    })

    it('QR 缓存文件键 = sha256(text_width) + .png（对位 go qrCacheKey）', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'image-renderer-cache-'))
        const doc = decodeGraph({
            canvas: { width: 10, height: 10 },
            layers: [
                {
                    type: 'QrCodeLayer',
                    spec: { shape: { width: 10, height: 10 } },
                    data: { valueType: 'StaticValue', value: 'qr-content' },
                },
            ],
        })
        await createDefaultResolver({ cacheRoot: dir }).resolve(doc, recordingBackend().backend)
        const files = readdirSync(join(dir, 'qr_layers'))
        expect(files).toEqual([expect.stringMatching(/^[0-9a-f]{64}\.png$/)])
    })
})

describe('createDefaultResolver 错误 code 面（失败即抛、首个错误中止）', () => {
    it('下载失败（非 2xx）→ resource_download_failed，消息含 URL', async () => {
        const doc = docWithRemoteImageAndFont()
        const stub = fetchStub({ 'https://cdn.example.com/bg.png': 'fail' })
        const error = await createDefaultResolver({ fetchLike: stub.fetchLike })
            .resolve(doc, recordingBackend().backend)
            .then(
                () => null,
                (e: unknown) => e,
            )
        expect(error).toBeInstanceOf(ResourceMaterializeError)
        expect((error as ResourceMaterializeError).code).toBe('resource_download_failed')
        expect((error as Error).message).toContain('https://cdn.example.com/bg.png')
    })

    it('空响应体视作失败（对位 go HTTPDownloader 失败面）', async () => {
        const doc = docWithRemoteImageAndFont()
        const stub = fetchStub({ 'https://cdn.example.com/bg.png': 'empty' })
        await expect(createDefaultResolver({ fetchLike: stub.fetchLike }).resolve(doc, recordingBackend().backend)).rejects.toMatchObject({
            code: 'resource_download_failed',
        })
    })

    it('缓存目录不可写 → resource_save_failed', async () => {
        const blocker = join(mkdtempSync(join(tmpdir(), 'image-renderer-block-')), 'not-a-dir')
        writeFileSync(blocker, 'x')
        const doc = docWithRemoteImageAndFont()
        const stub = fetchStub({ 'https://cdn.example.com/bg.png': pngBytes() })
        await expect(
            createDefaultResolver({ fetchLike: stub.fetchLike, cacheRoot: join(blocker, 'sub') }).resolve(doc, recordingBackend().backend),
        ).rejects.toMatchObject({ code: 'resource_save_failed' })
    })

    it('QR 未接线（显式置 null）→ qr_materializer_required，不静默缺码', async () => {
        const doc = docWithRemoteImageAndFont()
        const stub = fetchStub({
            'https://cdn.example.com/bg.png': pngBytes(),
            'https://cdn.example.com/photo.jpg': pngBytes(),
            'https://fonts.example.com/go-canvas.ttf': new Uint8Array([1, 2, 3, 4]),
        })
        await expect(
            createDefaultResolver({ fetchLike: stub.fetchLike, qrMaterializer: null }).resolve(doc, recordingBackend().backend),
        ).rejects.toMatchObject({ code: 'qr_materializer_required' })
    })

    it('后端缺 setImage 缝 → 用法错误（物化结果无处登记）', async () => {
        const doc = docWithRemoteImageAndFont()
        const stub = fetchStub({ 'https://cdn.example.com/bg.png': pngBytes() })
        await expect(createDefaultResolver({ fetchLike: stub.fetchLike }).resolve(doc, {})).rejects.toThrow(/setImage/)
    })
})

describe('字体物化跳过条件（对位 go materializeFont；与内置字体判定同一口径）', () => {
    async function resolveFont(font: string): Promise<{ fonts: Array<{ ref: string }>; calls: string[] }> {
        const doc = decodeGraph({
            canvas: { width: 10, height: 10 },
            layers: [
                {
                    type: 'TextLayer',
                    spec: { shape: { width: 10, height: 10 }, fontFamily: { font } },
                    data: { valueType: 'StaticValue', value: 'x' },
                },
            ],
        })
        const stub = fetchStub(font.startsWith('https://') ? { [font]: new Uint8Array([1, 2, 3, 4]) } : {})
        const { backend, fonts } = recordingBackend()
        await createDefaultResolver({ fetchLike: stub.fetchLike }).resolve(doc, backend)
        return { fonts, calls: stub.calls }
    }

    it('空串/纯数字/本地路径跳过下载', async () => {
        expect((await resolveFont('')).fonts).toHaveLength(0)
        expect((await resolveFont('12')).fonts).toHaveLength(0)
        expect((await resolveFont('1.5')).fonts).toHaveLength(0)
        expect((await resolveFont('/System/Library/Fonts/Supplemental/Arial.ttf')).fonts).toHaveLength(0)
        expect((await resolveFont('')).calls).toHaveLength(0)
    })

    it('非 URL 的真实字体引用跳过；URL 字体下载登记', async () => {
        expect((await resolveFont('Arial')).fonts).toHaveLength(0)
        const { fonts, calls } = await resolveFont('https://fonts.example.com/x.ttf')
        expect(fonts).toHaveLength(1)
        expect(calls).toEqual(['https://fonts.example.com/x.ttf'])
    })
})

describe('QR 物化缝可覆写（go NewDefaultResolver 后置 opts 覆写先例）', () => {
    it('注入自定义物化器：产物按注入走', async () => {
        const doc = decodeGraph({
            canvas: { width: 10, height: 10 },
            layers: [
                {
                    type: 'QrCodeLayer',
                    spec: { shape: { width: 10, height: 10 } },
                    data: { valueType: 'StaticValue', value: 'custom' },
                },
            ],
        })
        const custom: QRMaterializer = {
            materialize: (text, width) => Promise.resolve(new TextEncoder().encode(`${text}@${width}`)),
        }
        const { backend, images } = recordingBackend()
        await createDefaultResolver({ qrMaterializer: custom }).resolve(doc, backend)
        expect(images).toEqual([{ key: qrImageSrc('custom'), data: new TextEncoder().encode('custom@10') }])
    })
})
