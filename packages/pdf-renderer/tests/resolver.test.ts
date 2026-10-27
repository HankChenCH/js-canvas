import { describe, expect, it } from 'vitest'

import fs from 'node:fs'
import path from 'node:path'

import {
    decodeGraph,
    qrImageSrc,
    ResourceMaterializeError,
    type Canvas,
    type ImageRegisteringBackend,
} from '@hankchen/canvas'

import { QrCodeMaterializer } from '../src/qr'
import { createDefaultResolver, createRenderer } from '../src/resolver'
import { makeTempDir } from './helpers'
import QRCode from 'qrcode'

/**
 * QR 物化与默认资源解析器测试（对位 go qr_test.go / resolver 侧手法）：
 * 物化字节面（PNG 形态/确定性/尺寸量化）、缝接线（wire src 同键登记）、
 * 稳定错误 code（download/save/qr 三族）、缓存命中跳过。
 */

describe('QrCodeMaterializer 固定选项（纠错 H、边距 0、正方形 PNG）', () => {
    it('产物为 PNG 字节（魔数 + IHDR 正方形），同输入字节确定', async () => {
        const m = new QrCodeMaterializer()
        const bytes = await m.materialize('https://example.com/join', 120)
        expect(Buffer.from(bytes.subarray(0, 8)).toString('latin1')).toBe('\x89PNG\r\n\x1a\n')
        // IHDR 宽高（大端）：正方形
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
        const w = view.getUint32(16)
        const h = view.getUint32(20)
        expect(w).toBe(h)
        expect(w).toBeGreaterThan(0)
        const again = await m.materialize('https://example.com/join', 120)
        expect(Buffer.from(again).equals(Buffer.from(bytes))).toBe(true)
    })

    it('宽度向下取整到模块数（块宽量化）：过小宽度仍出图（钳到矩阵边长）', async () => {
        const m = new QrCodeMaterializer()
        const bytes = await m.materialize('HELLO', 4)
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
        expect(view.getUint32(16)).toBeGreaterThan(0)
    })

    it('生成失败报错（空内容），消息含内容上下文', async () => {
        const m = new QrCodeMaterializer()
        await expect(m.materialize('', 100)).rejects.toThrow(/生成二维码矩阵/)
    })
})

describe('编码模式分派（评审 P0-2：与 image 包 pickEncMode 同口径，显式 segment 压制 auto 拆分）', () => {
    /** 与被测实现同参数的参照字节面（显式单 segment） */
    function referenceBuffer(text: string, mode: 'numeric' | 'alphanumeric' | 'byte', size: number): Promise<Buffer> {
        const segment =
            mode === 'byte'
                ? { data: Buffer.from(text, 'utf8'), mode: 'byte' }
                : { data: text, mode }
        return QRCode.toBuffer([segment], {
            errorCorrectionLevel: 'H',
            margin: 0,
            width: size,
            color: { dark: '#000000ff', light: '#ffffffff' },
            type: 'png',
        })
    }

    it('混合内容（数字段+CJK）走整串单 byte 段：字节级等于显式 segment 参照、异于 auto 拆分（反例域）', async () => {
        // auto 对该内容拆多段（数字段 Numeric），位面与整串 byte 段数百 bit 不同
        const text = 'ORDER 2026-10-27 #8899 号单'
        const got = await new QrCodeMaterializer().materialize(text, 240)
        expect(Buffer.from(got).equals(await referenceBuffer(text, 'byte', 240))).toBe(true)
        const auto = await QRCode.toBuffer(text, { errorCorrectionLevel: 'H', margin: 0, width: 240, type: 'png' })
        expect(Buffer.from(got).equals(auto)).toBe(false)
    })

    it('纯数字走 Numeric 段；大写字母数字集走 Alphanumeric 段（字节级对照）', async () => {
        const m = new QrCodeMaterializer()
        expect(Buffer.from(await m.materialize('20261027088999', 160)).equals(await referenceBuffer('20261027088999', 'numeric', 160))).toBe(true)
        expect(Buffer.from(await m.materialize('HTTPS://EXAMPLE.COM/JOIN', 160)).equals(await referenceBuffer('HTTPS://EXAMPLE.COM/JOIN', 'alphanumeric', 160))).toBe(true)
    })

    it('纯 CJK 内容走 byte 段：与 image 包同矩阵口径（字节级对照；无 Kanji 分支）', async () => {
        const text = '证书批量生成：图层树'
        const got = await new QrCodeMaterializer().materialize(text, 200)
        expect(Buffer.from(got).equals(await referenceBuffer(text, 'byte', 200))).toBe(true)
    })
})

/** 登记录制后端：只录 setImage/registerFontData 调用（物化缝的结构化消费面） */
function recordingBackend() {
    const images = new Map<string, Uint8Array>()
    const fonts = new Map<string, Uint8Array>()
    const backend: ImageRegisteringBackend & { registerFontData?(key: string, data: Uint8Array): void } = {
        setImage: (key, data) => {
            images.set(key, data)
        },
        registerFontData: (key, data) => {
            fonts.set(key, data)
        },
    }
    return { images, fonts, backend }
}

/** 假 fetch：按 URL 出字节，记录调用（缓存命中断言用） */
function fakeFetch(responses: Record<string, Uint8Array | { status: number }>) {
    const calls: string[] = []
    const fetchFn = async (url: string) => {
        calls.push(url)
        const r = responses[url]
        if (r === undefined) throw new Error('no route')
        if ('status' in r) return { ok: false, status: r.status, arrayBuffer: async () => new ArrayBuffer(0) }
        return {
            ok: true,
            status: 200,
            arrayBuffer: async () => r.slice().buffer as ArrayBuffer,
        }
    }
    return { calls, fetchFn }
}

/** 单图层画布构造（wire 字面量） */
function pageWith(layers: Array<Record<string, unknown>>, background?: { color: string | null; image: string | null }): Canvas {
    return decodeGraph({
        canvas: { width: 50, height: 50, ...(background ? { background } : {}) },
        layers,
    })
}

describe('DefaultResourceResolver 默认物化（对位 go resolver + NewDefaultResolver 接线）', () => {
    it('远程图片下载 → wire src 同键 setImage 登记；本地路径直通不登记', async () => {
        const cacheRoot = makeTempDir()
        const bytes = new Uint8Array([1, 2, 3, 4])
        const { calls, fetchFn } = fakeFetch({ 'https://cdn.example.com/a.png': bytes })
        const resolver = createDefaultResolver({ fetch: fetchFn, cacheRoot })
        const { backend, images } = recordingBackend()
        const canvas = pageWith(
            [
                { type: 'ImageLayer', spec: { shape: { width: 50, height: 50 } }, data: { value: 'https://cdn.example.com/a.png' } },
                { type: 'ImageLayer', spec: { shape: { width: 10, height: 10 } }, data: { value: '/local/path.png' } },
            ],
        )
        await resolver.resolve(canvas, backend)
        expect(images.get('https://cdn.example.com/a.png')).toEqual(bytes)
        expect(images.has('/local/path.png')).toBe(false)
        expect(calls).toEqual(['https://cdn.example.com/a.png'])
    })

    it('缓存命中跳过下载（同 URL 第二次 resolve 不再 fetch），落盘键 = sha256(url)+ext', async () => {
        const cacheRoot = makeTempDir()
        const { calls, fetchFn } = fakeFetch({ 'https://cdn.example.com/b.png': new Uint8Array([9, 9]) })
        const resolver = createDefaultResolver({ fetch: fetchFn, cacheRoot })
        const { backend } = recordingBackend()
        const make = () => pageWith([{ type: 'ImageLayer', spec: { shape: { width: 10, height: 10 } }, data: { value: 'https://cdn.example.com/b.png' } }])
        await resolver.resolve(make(), backend)
        await resolver.resolve(make(), backend)
        expect(calls).toHaveLength(1)
        // 键 = sha256(url) + '.png'
        const { createHash } = await import('node:crypto')
        const key = createHash('sha256').update('https://cdn.example.com/b.png', 'utf8').digest('hex') + '.png'
        expect(fs.existsSync(path.join(cacheRoot, 'img_layers', key))).toBe(true)
    })

    it('二维码图层 → qrImageSrc 同键登记 PNG；缓存键 = sha256(内容_宽度).png', async () => {
        const cacheRoot = makeTempDir()
        const resolver = createDefaultResolver({ cacheRoot })
        const { backend, images } = recordingBackend()
        const canvas = pageWith([{ type: 'QrCodeLayer', spec: { shape: { width: 80, height: 80 } }, data: { value: 'https://example.com/join' } }])
        await resolver.resolve(canvas, backend)
        const png = images.get(qrImageSrc('https://example.com/join'))
        expect(png).toBeDefined()
        expect(Buffer.from(png!.subarray(0, 8)).toString('latin1')).toBe('\x89PNG\r\n\x1a\n')
        const { createHash } = await import('node:crypto')
        const key = createHash('sha256').update('https://example.com/join_80', 'utf8').digest('hex') + '.png'
        expect(fs.existsSync(path.join(cacheRoot, 'qr_layers', key))).toBe(true)
    })

    it('远程字体 → registerFontData 按原始引用登记；本地/纯数字/空串字体跳过', async () => {
        const cacheRoot = makeTempDir()
        const fontBytes = new Uint8Array([77, 79, 77])
        const { fetchFn } = fakeFetch({ 'https://cdn.example.com/msyh.ttf': fontBytes })
        const resolver = createDefaultResolver({ fetch: fetchFn, cacheRoot })
        const { backend, fonts } = recordingBackend()
        const mk = (font: string) => pageWith([{ type: 'TextLayer', spec: { shape: { width: 50, height: 50 }, fontFamily: { font, fontSize: 12, fontColor: '#000' } }, data: { value: 'x' } }])
        await resolver.resolve(mk('https://cdn.example.com/msyh.ttf'), backend)
        await resolver.resolve(mk('/local/font.ttf'), backend)
        await resolver.resolve(mk('123'), backend)
        await resolver.resolve(mk(''), backend)
        expect(fonts.get('https://cdn.example.com/msyh.ttf')).toEqual(fontBytes)
        expect(fonts.size).toBe(1)
    })

    it('画布背景图同语义物化（ResolveBackground 对位）', async () => {
        const cacheRoot = makeTempDir()
        const { fetchFn } = fakeFetch({ 'https://cdn.example.com/bg.png': new Uint8Array([7, 7, 7]) })
        const resolver = createDefaultResolver({ fetch: fetchFn, cacheRoot })
        const { backend, images } = recordingBackend()
        const canvas = pageWith([], { color: null, image: 'https://cdn.example.com/bg.png' })
        await resolver.resolve(canvas, backend)
        expect(images.get('https://cdn.example.com/bg.png')).toEqual(new Uint8Array([7, 7, 7]))
    })

    it('稳定错误 code：下载失败/空响应 resource_download_failed；落盘失败 resource_save_failed', async () => {
        const cacheRoot = makeTempDir()
        const { fetchFn } = fakeFetch({
            'https://cdn.example.com/broken.png': { status: 404 },
            'https://cdn.example.com/empty.png': new Uint8Array([]),
        })
        const resolver = createDefaultResolver({ fetch: fetchFn, cacheRoot })
        const { backend } = recordingBackend()
        const mk = (url: string) => pageWith([{ type: 'ImageLayer', spec: { shape: { width: 10, height: 10 } }, data: { value: url } }])

        await expect(resolver.resolve(mk('https://cdn.example.com/broken.png'), backend)).rejects.toMatchObject({
            code: 'resource_download_failed',
        })
        await expect(resolver.resolve(mk('https://cdn.example.com/empty.png'), backend)).rejects.toBeInstanceOf(ResourceMaterializeError)

        // 落盘失败：缓存根指向一个普通文件（mkdir 失败）
        const blocker = makeTempDir()
        const filePath = path.join(blocker, 'not-a-dir')
        fs.writeFileSync(filePath, 'x')
        const resolver2 = createDefaultResolver({ fetch: fetchFn, cacheRoot: filePath })
        await expect(resolver2.resolve(mk('https://cdn.example.com/x1.png'), backend)).rejects.toMatchObject({
            code: 'resource_save_failed',
        })
    })

    it('QR 物化失败包 qr_generate_failed code', async () => {
        const cacheRoot = makeTempDir()
        const resolver = createDefaultResolver({
            cacheRoot,
            qrMaterializer: {
                async materialize() {
                    throw new Error('boom')
                },
            },
        })
        const { backend } = recordingBackend()
        const canvas = pageWith([{ type: 'QrCodeLayer', spec: { shape: { width: 80, height: 80 } }, data: { value: 'https://x' } }])
        await expect(resolver.resolve(canvas, backend)).rejects.toMatchObject({ code: 'qr_generate_failed' })
    })
})

describe('createRenderer 组装（对位 go NewRenderer）', () => {
    it('缺省组装自带默认物化器；传自建解析器按原样使用', () => {
        const backend = createRenderer()
        expect(backend.defaultResolver).toBeInstanceOf(DefaultResourceResolver2)
        const custom = createDefaultResolver({ cacheRoot: makeTempDir() })
        expect(createRenderer(custom).defaultResolver).toBe(custom)
    })
})

// 避免与测试文件顶部直接 import 的类名冲突：结构化断言用
import { DefaultResourceResolver as DefaultResourceResolver2 } from '../src/resolver'
